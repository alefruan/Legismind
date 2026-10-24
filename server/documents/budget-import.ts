import type { SupabaseClient } from '@supabase/supabase-js'
import type { ParsedAllocation } from '../../shared/domain/documents/budget-parser.js'
import { centsToDecimal } from '../../shared/domain/money.js'
import { fetchAll, unwrap } from '../supabase.js'

interface ImportContext {
  admin: SupabaseClient
  organizationId: string
  fiscalYearId: string
  documentId: string
  versionId: string
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * Insere estruturas ausentes sem sobrescrever registros existentes (que podem
 * ter sido conferidos por humanos) e retorna o mapa código → id.
 */
async function ensureRows(
  admin: SupabaseClient,
  table: string,
  rows: Array<Record<string, unknown>>,
  onConflict: string,
  keyOf: (row: Record<string, unknown>) => string,
  columns: string,
  fiscalYearId: string,
) {
  for (const batch of chunk(rows, 500)) {
    const { error } = await admin.from(table).upsert(batch, { onConflict, ignoreDuplicates: true })
    if (error) throw error
  }
  const existing = await fetchAll<Record<string, unknown>>((from, to) =>
    admin.from(table).select(columns).eq('fiscal_year_id', fiscalYearId).order('id').range(from, to) as unknown as PromiseLike<{ data: Record<string, unknown>[] | null; error: unknown }>,
  )
  return new Map(existing.map((r) => [keyOf(r), r.id as string]))
}

export async function importBudgetAllocations(ctx: ImportContext, parsed: ParsedAllocation[]) {
  const base = { organization_id: ctx.organizationId, fiscal_year_id: ctx.fiscalYearId, verification_status: 'pending_review', source_version_id: ctx.versionId }

  const agencies = new Map<string, string | null>()
  const units = new Map<string, { agency: string; name: string | null }>()
  const programs = new Map<string, string | null>()
  const actions = new Map<string, { program: string; name: string | null; kind: string }>()
  const sources = new Map<string, string | null>()
  for (const a of parsed) {
    if (!agencies.has(a.agencyCode) || (!agencies.get(a.agencyCode) && a.agencyName)) agencies.set(a.agencyCode, a.agencyName)
    if (!units.has(`${a.agencyCode}|${a.unitCode}`)) units.set(`${a.agencyCode}|${a.unitCode}`, { agency: a.agencyCode, name: a.unitName })
    if (!programs.has(a.programCode) || (!programs.get(a.programCode) && a.programName)) programs.set(a.programCode, a.programName)
    if (!actions.has(`${a.programCode}|${a.actionCode}`)) actions.set(`${a.programCode}|${a.actionCode}`, { program: a.programCode, name: a.actionName, kind: a.actionKind })
    if (!sources.has(a.sourceCode) || (!sources.get(a.sourceCode) && a.sourceName)) sources.set(a.sourceCode, a.sourceName)
  }

  const agencyIds = await ensureRows(
    ctx.admin,
    'budget_agencies',
    [...agencies].map(([code, name]) => ({ ...base, code, name: name ?? `Órgão ${code} (nome não identificado)` })),
    'fiscal_year_id,code',
    (r) => r.code as string,
    'id, code',
    ctx.fiscalYearId,
  )

  const unitRows = [...units].map(([key, u]) => ({
    ...base,
    agency_id: agencyIds.get(u.agency),
    code: key.split('|')[1],
    name: u.name ?? `Unidade ${key.split('|')[1]} (nome não identificado)`,
  }))
  const unitIds = await ensureRows(
    ctx.admin,
    'budget_units',
    unitRows,
    'agency_id,code',
    (r) => `${r.agency_id}|${r.code}`,
    'id, agency_id, code',
    ctx.fiscalYearId,
  )

  const programIds = await ensureRows(
    ctx.admin,
    'budget_programs',
    [...programs].map(([code, name]) => ({ ...base, code, name: name ?? `Programa ${code} (nome não identificado)` })),
    'fiscal_year_id,code',
    (r) => r.code as string,
    'id, code',
    ctx.fiscalYearId,
  )

  const actionIds = await ensureRows(
    ctx.admin,
    'budget_actions',
    [...actions].map(([key, a]) => ({
      ...base,
      program_id: programIds.get(a.program),
      code: key.split('|')[1],
      name: a.name ?? `Ação ${key.split('|')[1]} (nome não identificado)`,
      action_kind: a.kind,
    })),
    'program_id,code',
    (r) => `${r.program_id}|${r.code}`,
    'id, program_id, code',
    ctx.fiscalYearId,
  )

  const sourceIds = await ensureRows(
    ctx.admin,
    'budget_sources',
    [...sources].map(([code, name]) => ({ ...base, code, name: name ?? `Fonte ${code} (descrição não identificada)`, is_earmarked: null })),
    'fiscal_year_id,code',
    (r) => r.code as string,
    'id, code',
    ctx.fiscalYearId,
  )

  // Versões anteriores do mesmo documento deixam de ser vigentes (permanecem para rastreabilidade).
  const previousVersions = unwrap(
    await ctx.admin.from('document_versions').select('id').eq('document_id', ctx.documentId).neq('id', ctx.versionId),
  ) as Array<{ id: string }>
  if (previousVersions.length) {
    await ctx.admin.from('budget_allocations').update({ is_current: false }).in('source_version_id', previousVersions.map((v) => v.id))
  }

  // Idempotência em reprocessamento: remove o que esta versão já havia inserido (se não referenciado).
  const { error: cleanupError } = await ctx.admin.from('budget_allocations').delete().eq('source_version_id', ctx.versionId)
  if (cleanupError) {
    await ctx.admin.from('budget_allocations').update({ is_current: false }).eq('source_version_id', ctx.versionId)
  }

  const allocationRows = parsed.map((a) => {
    const agencyId = agencyIds.get(a.agencyCode)
    const programId = programIds.get(a.programCode)
    return {
      ...base,
      agency_id: agencyId,
      unit_id: unitIds.get(`${agencyId}|${a.unitCode}`),
      function_code: a.functionCode,
      subfunction_code: a.subfunctionCode,
      program_id: programId,
      action_id: actionIds.get(`${programId}|${a.actionCode}`),
      expense_nature: a.expenseNature,
      source_id: sourceIds.get(a.sourceCode),
      allocation_code: a.allocationCode,
      description: a.description,
      authorized_amount: centsToDecimal(a.amountCents),
      source_page: a.page,
      source_reference: a.ref,
      raw_text: a.raw,
      extraction_confidence: Number(a.confidence.toFixed(3)),
      extra_identifiers: a.warnings.length ? { alertas_extracao: a.warnings } : {},
    }
  })

  let inserted = 0
  for (const batch of chunk(allocationRows, 500)) {
    const { error } = await ctx.admin.from('budget_allocations').insert(batch)
    if (error) throw error
    inserted += batch.length
  }
  return { inserted, agencies: agencies.size, programs: programs.size, actions: actions.size, sources: sources.size }
}
