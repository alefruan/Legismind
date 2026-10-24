import { toCents, toCentsOrNull } from '../../shared/domain/money.js'
import type { AllocationFacts } from '../../shared/domain/amendments/types.js'
import type { BudgetAllocationViewRow } from '../../shared/types/db.js'

export function toAllocationFacts(row: BudgetAllocationViewRow): AllocationFacts {
  return {
    id: row.id,
    organizationId: row.organization_id,
    fiscalYearId: row.fiscal_year_id,
    fiscalYear: row.fiscal_year,
    programmaticCode: row.programmatic_code,
    agencyCode: row.agency_code,
    agencyName: row.agency_name,
    unitCode: row.unit_code,
    unitName: row.unit_name,
    functionCode: row.function_code,
    functionName: row.function_name,
    subfunctionCode: row.subfunction_code,
    subfunctionName: row.subfunction_name,
    programCode: row.program_code,
    programName: row.program_name,
    ppaReference: row.ppa_reference,
    actionCode: row.action_code,
    actionName: row.action_name,
    expenseNature: row.expense_nature,
    groupCode: row.group_code,
    modalityCode: row.modality_code,
    elementCode: row.element_code,
    elementName: row.element_name,
    sourceCode: row.source_code,
    sourceName: row.source_name,
    sourceIsEarmarked: row.source_is_earmarked,
    description: row.description,
    authorizedCents: toCents(row.authorized_amount),
    availableCents: toCentsOrNull(row.available_amount),
    availableAsOf: row.available_as_of,
    availableSource: row.available_source,
    verificationStatus: row.verification_status,
    isCurrent: row.is_current,
    isDemo: row.is_demo,
    extraIdentifiers: row.extra_identifiers ?? {},
    sourceDocumentTitle: row.source_document_title,
    sourcePage: row.source_page,
    sourceReference: row.source_reference,
  }
}

/** Representação compacta para a IA e para cartões da interface. */
export function summarizeAllocation(row: BudgetAllocationViewRow) {
  return {
    allocation_id: row.id,
    classificacao: row.programmatic_code,
    orgao: `${row.agency_code} — ${row.agency_name}`,
    unidade: `${row.unit_code} — ${row.unit_name}`,
    funcao: `${row.function_code} — ${row.function_name ?? 'não catalogada'}`,
    subfuncao: `${row.subfunction_code} — ${row.subfunction_name ?? 'não catalogada'}`,
    programa: `${row.program_code} — ${row.program_name}`,
    acao: `${row.action_code} — ${row.action_name}`,
    natureza: row.expense_nature,
    modalidade_aplicacao: `${row.modality_code} — ${row.modality_name ?? 'não catalogada'}`,
    elemento: `${row.element_code} — ${row.element_name ?? 'não catalogado'}`,
    fonte: `${row.source_code} — ${row.source_name}${row.source_is_earmarked === true ? ' (vinculada)' : row.source_is_earmarked === false ? ' (não vinculada)' : ''}`,
    valor_autorizado: row.authorized_amount,
    saldo_disponivel_oficial: row.available_amount ? { valor: row.available_amount, data: row.available_as_of, origem: row.available_source } : null,
    situacao_conferencia: row.verification_status,
    referencia_ppa: row.ppa_reference,
    origem_documental: row.source_document_title ?? row.source_reference,
    pagina: row.source_page,
    dados_ficticios: row.is_demo,
  }
}
