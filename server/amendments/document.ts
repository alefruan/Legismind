import { renderAmendmentDocument, type AmendmentDocument, type DocumentAllocationLine } from '../../shared/domain/amendments/document.js'
import { defaultTemplateFor } from '../../shared/domain/amendments/templates.js'
import { toCents } from '../../shared/domain/money.js'
import type { AmendmentRow, FiscalYearRow, OfficeRow, OrganizationRow, OrganizationSettingsRow } from '../../shared/types/db.js'
import type { RequestContext } from '../http/auth.js'
import { unwrap } from '../supabase.js'
import { loadAmendmentFacts, readAmendmentAsUser, todayInBrazil } from './service.js'

export function amendmentNumber(prefix: string, year: number, sequence: number | null) {
  return sequence ? `${prefix}-${year}/${String(sequence).padStart(4, '0')}` : null
}

export interface BuiltDocument {
  document: AmendmentDocument
  amendment: AmendmentRow
  fileBase: string
}

async function templateBody(ctx: RequestContext, id: string | null) {
  if (!id) return null
  const row = unwrap(await ctx.admin.from('document_templates').select('body').eq('id', id).maybeSingle()) as { body: string } | null
  return row?.body ?? null
}

/** Local da assinatura: configuração explícita ou "Município - UF" para Câmaras Municipais. */
function signatureCity(settings: OrganizationSettingsRow, org: OrganizationRow) {
  if (settings.signature_city?.trim()) return settings.signature_city.trim()
  const municipality = org.municipality?.replace(/\s*\(.*\)$/, '').trim()
  return municipality ? `${municipality} - ${org.uf}` : null
}

export async function buildAmendmentDocument(ctx: RequestContext, amendmentId: string): Promise<BuiltDocument> {
  const row = await readAmendmentAsUser(ctx, amendmentId)
  const loaded = await loadAmendmentFacts(ctx.admin, row)

  const [orgRes, settingsRes, officeRes, fyRes] = await Promise.all([
    ctx.admin.from('organizations').select('*').eq('id', row.organization_id).single(),
    ctx.admin.from('organization_settings').select('*').eq('organization_id', row.organization_id).single(),
    ctx.admin.from('offices').select('*').eq('id', row.office_id).single(),
    ctx.admin.from('fiscal_years').select('*').eq('id', row.fiscal_year_id).single(),
  ])
  const org = unwrap(orgRes) as OrganizationRow
  const settings = unwrap(settingsRes) as OrganizationSettingsRow
  const office = unwrap(officeRes) as OfficeRow
  const fy = unwrap(fyRes) as FiscalYearRow
  const kind = loaded.modality.kind ?? 'budget'

  // Modelo: da emenda → da modalidade → padrão da instituição (orçamentárias) → padrão do LegisMind
  let body = (await templateBody(ctx, row.template_id)) ?? (await templateBody(ctx, loaded.modality.template_id))
  if (!body && kind === 'budget') {
    const fallback = unwrap(
      await ctx.admin
        .from('document_templates')
        .select('body')
        .eq('organization_id', row.organization_id)
        .eq('kind', 'emenda_orcamentaria')
        .eq('status', 'active')
        .eq('is_default', true)
        .maybeSingle(),
    ) as { body: string } | null
    body = fallback?.body ?? null
  }
  body ??= defaultTemplateFor(kind, loaded.modality.text_subtype)

  const line = (allocationId: string | null, amount: string, proposed: Record<string, unknown> | null): DocumentAllocationLine => {
    const alloc = allocationId ? loaded.allocations.get(allocationId) : undefined
    if (alloc) {
      return {
        programmaticCode: alloc.programmatic_code,
        agencyCode: alloc.agency_code,
        agencyName: alloc.agency_name,
        unitCode: alloc.unit_code,
        unitName: alloc.unit_name,
        functionCode: alloc.function_code,
        subfunctionCode: alloc.subfunction_code,
        programCode: alloc.program_code,
        actionCode: alloc.action_code,
        actionName: alloc.action_name,
        expenseNature: alloc.expense_nature,
        sourceCode: alloc.source_code,
        amountCents: toCents(amount),
      }
    }
    return {
      programmaticCode: 'NOVA PROGRAMAÇÃO',
      actionName: String(proposed?.description ?? 'Programação a criar'),
      expenseNature: String(proposed?.expenseNature ?? '—'),
      sourceCode: String(proposed?.sourceCode ?? '—'),
      amountCents: toCents(amount),
      note: 'depende de autorização normativa',
    }
  }

  const number = row.protocol_number ?? amendmentNumber(settings.amendment_number_prefix, fy.year, row.sequence_number)
  const document = renderAmendmentDocument(body, {
    institutionHeader: settings.institution_header ?? org.name.toUpperCase(),
    number,
    protocolNumber: row.protocol_number,
    fiscalYear: fy.year,
    billNumber: fy.bill_number,
    billSummary: fy.bill_summary,
    modalityName: loaded.modality.name,
    modalityKind: kind,
    typeLabel: loaded.modality.type_label,
    textSubtype: loaded.modality.text_subtype,
    isImpositive: loaded.modality.is_impositive,
    parliamentarianName: office.parliamentarian_name,
    parliamentarianTitle: office.parliamentarian_title,
    party: office.party,
    officeName: office.name,
    object: row.object,
    purpose: row.purpose,
    justification: row.justification,
    legalGrounds: row.legal_grounds,
    physicalGoal: row.physical_goal,
    beneficiaryLocation: row.beneficiary_location,
    beneficiaryType: row.beneficiary_type,
    beneficiaryName: row.beneficiary_name,
    beneficiaryCnpj: row.beneficiary_cnpj,
    textTarget: row.text_target,
    textCommand: row.text_command,
    originalText: row.original_text,
    newText: row.new_text,
    destinations: loaded.destinations.map((d) => line(d.allocation_id, d.amount, d.proposed_classification)),
    cancellations: loaded.cancellations.map((c) => line(c.allocation_id, c.amount, null)),
    requiresCancellation: loaded.modality.requires_cancellation,
    city: signatureCity(settings, org),
    date: todayInBrazil(),
    indicationDate: row.indication_date,
    natureFormat: settings.expense_nature_format ?? 'c.g.mm.ee',
    validationOutcome: row.validation_outcome,
    validationCurrent: row.last_validation_run_id !== null && row.validated_revision === row.revision,
    status: row.status,
    isDemo: org.is_demo,
  })

  const fileBase = `emenda-${(number ?? row.id.slice(0, 8)).replace(/[^\w-]+/g, '-')}`
  return { document, amendment: row, fileBase }
}
