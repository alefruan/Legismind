import type {
  AllocationFacts,
  AmendmentFacts,
  CancellationFacts,
  RuleDefinition,
  ValidationContext,
} from '../../shared/domain/amendments/types'

export const FY = 'fy-2027'

export function allocation(overrides: Partial<AllocationFacts> & Pick<AllocationFacts, 'id'>): AllocationFacts {
  const nature = overrides.expenseNature ?? '3.3.90.39'
  const [, group, modality, element] = nature.split('.')
  return {
    organizationId: 'org-1',
    fiscalYearId: FY,
    fiscalYear: 2027,
    programmaticCode: '10.001.27.812.0005.2050',
    agencyCode: '10',
    agencyName: 'Secretaria Municipal de Esportes e Lazer',
    unitCode: '10.001',
    unitName: 'Secretaria Municipal de Esportes e Lazer',
    functionCode: '27',
    functionName: 'Desporto e Lazer',
    subfunctionCode: '812',
    subfunctionName: 'Desporto Comunitário',
    programCode: '0005',
    programName: 'Esporte para Todos',
    ppaReference: 'PPA 2026–2029 — Programa 0005',
    actionCode: '2050',
    actionName: 'Manutenção das Atividades Esportivas Comunitárias',
    expenseNature: nature,
    groupCode: group!,
    modalityCode: modality!,
    elementCode: element!,
    elementName: null,
    sourceCode: '1.500.0000',
    sourceName: 'Recursos não Vinculados de Impostos',
    sourceIsEarmarked: false,
    description: null,
    authorizedCents: 100_000_000,
    availableCents: null,
    availableAsOf: null,
    availableSource: null,
    verificationStatus: 'confirmed',
    isCurrent: true,
    isDemo: false,
    extraIdentifiers: {},
    sourceDocumentTitle: 'PLOA 2027',
    sourcePage: 112,
    sourceReference: null,
    ...overrides,
  }
}

export const allocations = {
  oscSport: allocation({
    id: 'a-1501',
    programmaticCode: '10.001.27.812.0005.2051',
    actionCode: '2051',
    actionName: 'Apoio a Projetos Esportivos de Organizações da Sociedade Civil',
    expenseNature: '3.3.50.41',
    groupCode: '3',
    modalityCode: '50',
    elementCode: '41',
    authorizedCents: 40_000_000,
  }),
  sportServices: allocation({ id: 'a-1502', expenseNature: '3.3.90.39', authorizedCents: 85_000_000 }),
  personnel: allocation({
    id: 'a-1509',
    programmaticCode: '06.001.10.301.0012.2120',
    functionCode: '10',
    subfunctionCode: '301',
    expenseNature: '3.1.90.11',
    groupCode: '1',
    modalityCode: '90',
    elementCode: '11',
    authorizedCents: 980_000_000,
  }),
  susEarmarked: allocation({
    id: 'a-1510',
    programmaticCode: '06.001.10.301.0012.2122',
    functionCode: '10',
    subfunctionCode: '301',
    expenseNature: '3.3.50.43',
    groupCode: '3',
    modalityCode: '50',
    elementCode: '43',
    sourceCode: '1.600.0000',
    sourceIsEarmarked: true,
    authorizedCents: 50_000_000,
  }),
  roads: allocation({
    id: 'a-1511',
    programmaticCode: '12.001.15.452.0020.2200',
    functionCode: '15',
    subfunctionCode: '452',
    expenseNature: '3.3.90.39',
    authorizedCents: 350_000_000,
  }),
  publicity: allocation({
    id: 'a-1512',
    programmaticCode: '02.001.04.131.0030.2300',
    functionCode: '04',
    subfunctionCode: '131',
    expenseNature: '3.3.90.39',
    authorizedCents: 90_000_000,
    availableCents: 20_000_000,
    availableAsOf: '2026-09-30',
    availableSource: 'Relatório de execução',
  }),
  generalReserve: allocation({
    id: 'a-1517',
    programmaticCode: '99.999.99.999.9999.9999',
    functionCode: '99',
    subfunctionCode: '999',
    expenseNature: '9.9.99.99.99',
    groupCode: '9',
    modalityCode: '99',
    elementCode: '99',
    authorizedCents: 200_000_000,
  }),
  amendmentReserve: allocation({
    id: 'a-1518',
    programmaticCode: '99.999.99.999.9999.9998',
    functionCode: '99',
    subfunctionCode: '999',
    expenseNature: '9.9.99.99.99',
    groupCode: '9',
    modalityCode: '99',
    elementCode: '99',
    authorizedCents: 960_000_000,
    extraIdentifiers: { reserva_emendas: true },
  }),
}

let ruleSeq = 0
function rule(code: string, ruleType: string, params: unknown, severity: 'blocking' | 'warning' = 'blocking', appliesToModalities: string[] | null = null): RuleDefinition {
  ruleSeq++
  return { id: `rule-${ruleSeq}`, code, version: 1, name: code, ruleType, params, legalBasis: `Base de ${code}`, severity, appliesToModalities }
}

export const demoRules: RuleDefinition[] = [
  rule('ANULACAO_OBRIGATORIA', 'cancellation_required', {}),
  rule('EQUILIBRIO_ANULACAO', 'cancellation_balance', { tolerance_cents: 0 }),
  rule('DESPESAS_PROTEGIDAS', 'protected_expenses', { protected_groups: ['1', '2', '6'], protected_elements: ['81'], reserve_policy: 'only_flagged' }),
  rule('COMPATIBILIDADE_FONTES', 'source_compatibility', { mode: 'same_or_unearmarked' }),
  rule('ANULACAO_LIMITE_DOTACAO', 'cancellation_within_allocation', { consider_pending_commitments: true }),
  rule('LIMITE_EMENDAS_INDIVIDUAIS', 'individual_amendment_limit', { percent_of_rcl: 2.0, split: 'equal' }, 'blocking', ['individual_impositiva']),
  rule('SAUDE_METADE', 'health_share_minimum', { min_share_percent: 50, health_function_code: '10' }, 'warning', ['individual_impositiva']),
  rule('REQUISITOS_OSC', 'osc_transfer_requirements', { required_modality: '50', allowed_elements: ['41', '42', '43'], require_cnpj: true, ldo_authorization_reference: 'LDO 2027, art. 35' }),
  rule('COMPATIBILIDADE_PPA', 'ppa_compatibility', {}),
  rule('RESTRICOES_DESTINACAO', 'destination_restrictions', { forbidden_groups: ['1', '2', '6'], forbidden_elements: [] }),
  rule('PRAZO_APRESENTACAO', 'submission_deadline', {}, 'warning'),
]

export function context(overrides: Partial<ValidationContext> = {}): ValidationContext {
  return {
    today: '2026-10-22',
    organization: { id: 'org-1', isDemo: false, parliamentariansCount: 15 },
    fiscalYear: {
      id: FY,
      year: 2027,
      phase: 'ploa',
      isActive: true,
      rclCents: 48_000_000_000,
      rclReference: 'RREO de referência',
      amendmentDeadline: '2026-11-30',
    },
    officeTotals: [],
    catalog: {
      functionCodes: ['04', '08', '10', '12', '15', '27', '99'],
      subfunctionCodes: ['131', '243', '301', '452', '812', '813', '999'],
      modalityCodes: ['50', '90', '99'],
      elementCodes: ['11', '39', '41', '43', '99'],
    },
    ...overrides,
  }
}

export function cancellation(alloc: AllocationFacts, amountCents: number, overrides: Partial<CancellationFacts> = {}): CancellationFacts {
  return {
    id: `c-${alloc.id}`,
    amountCents,
    allocation: alloc,
    justification: 'Utilização da reserva específica para emendas individuais.',
    approved: true,
    approvedBy: 'user-1',
    approvedAt: '2026-10-22T12:00:00Z',
    commitments: { firmCents: 0, pendingCents: 0, amendmentsCount: 0 },
    ...overrides,
  }
}

/** Caso de uso obrigatório: R$ 150 mil para OSC realizar atividades esportivas para crianças e adolescentes. */
export function sportsOscAmendment(overrides: Partial<AmendmentFacts> = {}): AmendmentFacts {
  return {
    id: 'am-1',
    organizationId: 'org-1',
    officeId: 'office-1',
    fiscalYearId: FY,
    revision: 3,
    title: 'Atividades esportivas para crianças e adolescentes',
    object: 'Apoio a projeto esportivo de OSC voltado a crianças e adolescentes.',
    purpose: 'Ampliar o acesso ao esporte comunitário.',
    justification: 'A prática esportiva contribui para o desenvolvimento integral de crianças e adolescentes.',
    legalGrounds: 'Lei nº 13.019/2014.',
    beneficiaryType: 'osc',
    beneficiaryName: 'Associação Esportiva Exemplo',
    beneficiaryCnpj: '11222333000181',
    transferInstrument: 'termo_fomento',
    modality: {
      id: 'mod-1',
      code: 'individual_impositiva',
      name: 'Emenda individual impositiva',
      requiresCancellation: true,
      kind: 'budget',
      textSubtype: null,
      isImpositive: true,
      countsTowardIndividualLimit: true,
    },
    destinations: [{ id: 'd-1', amountCents: 15_000_000, allocation: allocations.oscSport, proposedClassification: null }],
    cancellations: [
      cancellation(allocations.amendmentReserve, 15_000_000, { commitments: { firmCents: 0, pendingCents: 30_000_000, amendmentsCount: 1 } }),
    ],
    ...overrides,
  }
}
