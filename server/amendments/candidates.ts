import type { SupabaseClient } from '@supabase/supabase-js'
import { analyzeCancellationCandidates, type CancellationAnalysis } from '../../shared/domain/amendments/cancellation.js'
import { formatBRL, type Cents } from '../../shared/domain/money.js'
import { ALLOCATION_VIEW_COLUMNS, type BudgetAllocationViewRow } from '../../shared/types/db.js'
import { toAllocationFacts } from '../budget/mappers.js'
import { badRequest } from '../http/errors.js'
import { unwrap } from '../supabase.js'
import { loadActiveRules, loadCommitments, todayInBrazil } from './service.js'

const PAGE = 1000
const MAX_CANDIDATES = 30_000

export interface CandidateQuery {
  organizationId: string
  fiscalYearId: string
  amountCents: Cents
  destinationAllocationIds: string[]
  destinationSourceCode?: string | null
  excludeAmendmentId?: string | null
  /** Dotações a desconsiderar além das de destino (ex.: já anuladas nesta emenda). */
  excludeAllocationIds?: string[]
  limit?: number
}

export interface CandidateReport {
  analysis: CancellationAnalysis
  eligible: Array<{
    allocationId: string
    programmaticCode: string
    actionName: string
    expenseNature: string
    sourceCode: string
    authorizedCents: Cents
    maxCents: Cents
    availabilityBasis: string
    verificationStatus: string
    warnings: string[]
    isDemo: boolean
    sourceDocument: string | null
    page: number | null
  }>
  exclusionSummary: Array<{ reason: string; count: number; examples: string[] }>
  totalCandidates: number
}

/**
 * Lê dotações com o cliente do usuário (RLS) e compromissos/regras com service
 * role — os compromissos são apenas agregados, sem expor emendas de outros gabinetes.
 */
export async function findCancellationCandidates(db: SupabaseClient, admin: SupabaseClient, query: CandidateQuery): Promise<CandidateReport> {
  if (query.amountCents <= 0) throw badRequest('Informe um valor positivo para a anulação.')

  // O PostgREST limita cada resposta (padrão: 1.000 linhas): pagina até cobrir o orçamento inteiro.
  const rows: BudgetAllocationViewRow[] = []
  for (let from = 0; from < MAX_CANDIDATES; from += PAGE) {
    const page = unwrap(
      await db
        .from('budget_allocations_view')
        .select(ALLOCATION_VIEW_COLUMNS)
        .eq('fiscal_year_id', query.fiscalYearId)
        .eq('is_current', true)
        .neq('verification_status', 'rejected')
        .order('id')
        .range(from, from + PAGE - 1),
    ) as unknown as BudgetAllocationViewRow[]
    rows.push(...page)
    if (page.length < PAGE) break
  }

  const destinations = rows.filter((r) => query.destinationAllocationIds.includes(r.id))
  const destinationSources = destinations.length
    ? destinations.map((d) => ({ code: d.source_code as string | null, isEarmarked: d.source_is_earmarked }))
    : [{ code: query.destinationSourceCode ?? null, isEarmarked: null }]

  const commitments = await loadCommitments(admin, rows.map((r) => r.id), query.excludeAmendmentId ?? null)
  const rules = await loadActiveRules(admin, query.organizationId, todayInBrazil())

  const analysis = analyzeCancellationCandidates({
    requestedCents: query.amountCents,
    fiscalYearId: query.fiscalYearId,
    destinationSources,
    candidates: rows.map((r) => ({ allocation: toAllocationFacts(r), commitments: commitments.get(r.id) ?? { firmCents: 0, pendingCents: 0, amendmentsCount: 0 } })),
    rules,
    excludeAllocationIds: [...query.destinationAllocationIds, ...(query.excludeAllocationIds ?? [])],
  })

  const byId = new Map(rows.map((r) => [r.id, r]))
  const limit = query.limit ?? 8
  const reasons = new Map<string, { count: number; examples: string[] }>()
  for (const ex of analysis.excluded) {
    const reason = ex.exclusionReasons[0] ?? 'Não elegível'
    const key = reason.replace(/\d[\d.,/]*/g, '#').slice(0, 120)
    const entry = reasons.get(key) ?? { count: 0, examples: [] }
    entry.count++
    if (entry.examples.length < 3) entry.examples.push(`${ex.allocation.programmaticCode} ${ex.allocation.expenseNature} (${formatBRL(ex.allocation.authorizedCents)}): ${reason}`)
    reasons.set(key, entry)
  }

  return {
    analysis: { ...analysis, eligible: analysis.eligible.slice(0, limit), excluded: [] },
    eligible: analysis.eligible.slice(0, limit).map((e) => {
      const row = byId.get(e.allocation.id)!
      return {
        allocationId: e.allocation.id,
        programmaticCode: e.allocation.programmaticCode,
        actionName: e.allocation.actionName,
        expenseNature: e.allocation.expenseNature,
        sourceCode: e.allocation.sourceCode,
        authorizedCents: e.allocation.authorizedCents,
        maxCents: e.availability.maxCents,
        availabilityBasis: e.availability.basis,
        verificationStatus: e.allocation.verificationStatus,
        warnings: e.warnings,
        isDemo: e.allocation.isDemo,
        sourceDocument: row.source_document_title ?? row.source_reference,
        page: row.source_page,
      }
    }),
    exclusionSummary: [...reasons.entries()].map(([reason, v]) => ({ reason, count: v.count, examples: v.examples })).sort((a, b) => b.count - a.count),
    totalCandidates: rows.length,
  }
}
