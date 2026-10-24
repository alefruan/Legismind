import type { SupabaseClient } from '@supabase/supabase-js'
import { validateAmendment } from '../../shared/domain/amendments/engine.js'
import type {
  AmendmentFacts,
  CatalogFacts,
  Commitments,
  ProposedClassification,
  RuleDefinition,
  ValidationContext,
  ValidationReport,
} from '../../shared/domain/amendments/types.js'
import { toCents, toCentsOrNull } from '../../shared/domain/money.js'
import {
  ALLOCATION_VIEW_COLUMNS,
  type AmendmentAllocationRow,
  type AmendmentCancellationRow,
  type AmendmentModalityRow,
  type AmendmentRow,
  type BudgetAllocationViewRow,
  type FiscalYearRow,
  type LegalRuleRow,
  type OrganizationRow,
} from '../../shared/types/db.js'
import { toAllocationFacts } from '../budget/mappers.js'
import { forbidden, notFound } from '../http/errors.js'
import type { RequestContext } from '../http/auth.js'
import { unwrap } from '../supabase.js'

export function todayInBrazil(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
}

/** Lê a emenda com o cliente do usuário: se o RLS não permitir, a emenda "não existe". */
export async function readAmendmentAsUser(ctx: Pick<RequestContext, 'db'>, amendmentId: string): Promise<AmendmentRow> {
  const { data, error } = await ctx.db.from('amendments').select('*').eq('id', amendmentId).maybeSingle()
  if (error) throw error
  if (!data) throw notFound('Emenda não encontrada ou sem permissão de acesso.')
  return data as AmendmentRow
}

export async function loadAllocationsByIds(client: SupabaseClient, ids: string[]): Promise<Map<string, BudgetAllocationViewRow>> {
  if (ids.length === 0) return new Map()
  const rows = unwrap(await client.from('budget_allocations_view').select(ALLOCATION_VIEW_COLUMNS).in('id', [...new Set(ids)])) as unknown as BudgetAllocationViewRow[]
  return new Map(rows.map((r) => [r.id, r]))
}

export async function loadCommitments(admin: SupabaseClient, allocationIds: string[], excludeAmendmentId: string | null): Promise<Map<string, Commitments>> {
  if (allocationIds.length === 0) return new Map()
  const rows = unwrap(
    await admin.rpc('allocation_commitments', { p_allocation_ids: [...new Set(allocationIds)], p_exclude_amendment: excludeAmendmentId }),
  ) as Array<{ allocation_id: string; firm_amount: string; pending_amount: string; amendments_count: number }>
  return new Map(
    rows.map((r) => [r.allocation_id, { firmCents: toCents(r.firm_amount), pendingCents: toCents(r.pending_amount), amendmentsCount: r.amendments_count }]),
  )
}

let catalogCache: { at: number; value: CatalogFacts } | null = null

export async function loadCatalog(admin: SupabaseClient): Promise<CatalogFacts> {
  if (catalogCache && Date.now() - catalogCache.at < 10 * 60_000) return catalogCache.value
  const [fn, sf, mo, el] = await Promise.all([
    admin.from('catalog_functions').select('code'),
    admin.from('catalog_subfunctions').select('code'),
    admin.from('catalog_application_modalities').select('code'),
    admin.from('catalog_expense_elements').select('code'),
  ])
  const codes = (r: { data: Array<{ code: string }> | null; error: unknown }) => unwrap(r)!.map((x) => x.code.trim())
  const value = { functionCodes: codes(fn), subfunctionCodes: codes(sf), modalityCodes: codes(mo), elementCodes: codes(el) }
  catalogCache = { at: Date.now(), value }
  return value
}

export async function loadActiveRules(admin: SupabaseClient, organizationId: string, onDate: string): Promise<RuleDefinition[]> {
  const rows = unwrap(
    await admin.from('legal_rules').select('*').eq('organization_id', organizationId).eq('status', 'active').order('code'),
  ) as LegalRuleRow[]
  return rows
    .filter((r) => (!r.effective_from || r.effective_from <= onDate) && (!r.effective_to || r.effective_to >= onDate))
    .map((r) => ({
      id: r.id,
      code: r.code,
      version: r.version,
      name: r.name,
      ruleType: r.rule_type,
      params: r.params,
      legalBasis: r.legal_basis,
      severity: r.severity,
      appliesToModalities: r.applies_to_modalities,
    }))
}

export interface LoadedAmendment {
  row: AmendmentRow
  facts: AmendmentFacts
  allocations: Map<string, BudgetAllocationViewRow>
  destinations: AmendmentAllocationRow[]
  cancellations: AmendmentCancellationRow[]
  modality: AmendmentModalityRow
}

export async function loadAmendmentFacts(admin: SupabaseClient, row: AmendmentRow): Promise<LoadedAmendment> {
  const [destinations, cancellations, modality] = await Promise.all([
    admin.from('amendment_allocations').select('*').eq('amendment_id', row.id).order('created_at'),
    admin.from('amendment_cancellations').select('*').eq('amendment_id', row.id).order('created_at'),
    admin.from('amendment_modalities').select('*').eq('id', row.modality_id).single(),
  ])
  const dest = unwrap(destinations) as AmendmentAllocationRow[]
  const canc = unwrap(cancellations) as AmendmentCancellationRow[]
  const mod = unwrap(modality) as AmendmentModalityRow

  const ids = [...dest.map((d) => d.allocation_id).filter((x): x is string => Boolean(x)), ...canc.map((c) => c.allocation_id)]
  const allocations = await loadAllocationsByIds(admin, ids)
  const commitments = await loadCommitments(admin, canc.map((c) => c.allocation_id), row.id)

  const facts: AmendmentFacts = {
    id: row.id,
    organizationId: row.organization_id,
    officeId: row.office_id,
    fiscalYearId: row.fiscal_year_id,
    revision: row.revision,
    title: row.title,
    object: row.object,
    purpose: row.purpose,
    justification: row.justification,
    legalGrounds: row.legal_grounds,
    beneficiaryType: row.beneficiary_type,
    beneficiaryName: row.beneficiary_name,
    beneficiaryCnpj: row.beneficiary_cnpj,
    transferInstrument: row.transfer_instrument,
    physicalGoal: row.physical_goal,
    beneficiaryLocation: row.beneficiary_location,
    textTarget: row.text_target,
    textCommand: row.text_command,
    originalText: row.original_text,
    newText: row.new_text,
    modality: {
      id: mod.id,
      code: mod.code,
      name: mod.name,
      requiresCancellation: mod.requires_cancellation,
      isImpositive: mod.is_impositive,
      countsTowardIndividualLimit: mod.counts_toward_individual_limit,
      kind: mod.kind ?? 'budget',
      textSubtype: mod.text_subtype ?? null,
    },
    destinations: dest.map((d) => ({
      id: d.id,
      amountCents: toCents(d.amount),
      allocation: d.allocation_id && allocations.has(d.allocation_id) ? toAllocationFacts(allocations.get(d.allocation_id)!) : null,
      proposedClassification: d.proposed_classification ? (d.proposed_classification as unknown as ProposedClassification) : null,
    })),
    cancellations: canc
      .filter((c) => allocations.has(c.allocation_id))
      .map((c) => ({
        id: c.id,
        amountCents: toCents(c.amount),
        allocation: toAllocationFacts(allocations.get(c.allocation_id)!),
        justification: c.justification,
        approved: c.approved,
        approvedBy: c.approved_by,
        approvedAt: c.approved_at,
        commitments: commitments.get(c.allocation_id) ?? { firmCents: 0, pendingCents: 0, amendmentsCount: 0 },
      })),
  }
  return { row, facts, allocations, destinations: dest, cancellations: canc, modality: mod }
}

export async function loadValidationContext(admin: SupabaseClient, row: AmendmentRow, today = todayInBrazil()): Promise<ValidationContext> {
  const [fy, org, totals, catalog] = await Promise.all([
    admin.from('fiscal_years').select('*').eq('id', row.fiscal_year_id).single(),
    admin.from('organizations').select('id, is_demo, parliamentarians_count').eq('id', row.organization_id).single(),
    admin.rpc('office_amendment_totals', { p_office: row.office_id, p_fiscal_year: row.fiscal_year_id, p_exclude_amendment: row.id }),
    loadCatalog(admin),
  ])
  const fiscal = unwrap(fy) as FiscalYearRow
  const organization = unwrap(org) as Pick<OrganizationRow, 'id' | 'is_demo' | 'parliamentarians_count'>
  const officeTotals = (unwrap(totals) as Array<{ function_code: string; total: string }>).map((t) => ({
    functionCode: t.function_code,
    totalCents: toCents(t.total),
  }))
  return {
    today,
    organization: { id: organization.id, isDemo: organization.is_demo, parliamentariansCount: organization.parliamentarians_count },
    fiscalYear: {
      id: fiscal.id,
      year: fiscal.year,
      phase: fiscal.phase,
      isActive: fiscal.is_active,
      rclCents: toCentsOrNull(fiscal.rcl_amount),
      rclReference: fiscal.rcl_reference,
      amendmentDeadline: fiscal.amendment_deadline,
    },
    officeTotals,
    catalog,
  }
}

async function canRunValidation(ctx: RequestContext, row: AmendmentRow) {
  const [office, reviewer] = await Promise.all([
    ctx.db.rpc('is_office_member', { p_office: row.office_id }),
    ctx.db.rpc('has_org_role', { p_org: row.organization_id, p_roles: ['reviewer'] }),
  ])
  return office.data === true || (reviewer.data === true && row.status !== 'draft')
}

export interface ValidationResult {
  runId: string
  report: ValidationReport
  revision: number
}

/**
 * Executa a validação determinística e grava o resultado de forma atômica,
 * vinculado à revisão da emenda (record_validation_run rejeita revisão obsoleta).
 */
export async function runAmendmentValidation(ctx: RequestContext, amendmentId: string): Promise<ValidationResult> {
  const row = await readAmendmentAsUser(ctx, amendmentId)
  if (!(await canRunValidation(ctx, row))) throw forbidden('Somente o gabinete autor ou revisores podem validar esta emenda.')

  const today = todayInBrazil()
  const loaded = await loadAmendmentFacts(ctx.admin, row)
  const [validationContext, rules] = await Promise.all([
    loadValidationContext(ctx.admin, row, today),
    loadActiveRules(ctx.admin, row.organization_id, today),
  ])
  const report = validateAmendment(loaded.facts, rules, validationContext)

  const dataSnapshot = {
    today,
    fiscal_year: validationContext.fiscalYear,
    organization: validationContext.organization,
    office_totals: validationContext.officeTotals,
    allocations: [...loaded.allocations.values()],
    destinations: loaded.destinations,
    cancellations: loaded.cancellations,
    commitments: loaded.facts.cancellations.map((c) => ({ allocation_id: c.allocation.id, ...c.commitments })),
  }
  const results = report.checks.map((c) => ({
    check_code: c.checkCode,
    rule_id: c.ruleId ?? null,
    rule_version: c.ruleVersion ?? null,
    outcome: c.outcome,
    severity: c.severity,
    title: c.title,
    message: c.message,
    legal_basis: c.legalBasis ?? null,
    details: c.details ?? {},
    evidence: c.evidence ?? [],
    requires_human_decision: c.requiresHumanDecision ?? false,
  }))

  const runId = unwrap(
    await ctx.admin.rpc('record_validation_run', {
      p_amendment: row.id,
      p_revision: row.revision,
      p_outcome: report.outcome,
      p_engine_version: report.engineVersion,
      p_rules_snapshot: rules.map((r) => ({ id: r.id, code: r.code, version: r.version, rule_type: r.ruleType, params: r.params, legal_basis: r.legalBasis })),
      p_data_snapshot: dataSnapshot,
      p_summary: report.summary,
      p_results: results,
      p_executed_by: ctx.user.id,
    }),
  ) as string

  return { runId, report, revision: row.revision }
}
