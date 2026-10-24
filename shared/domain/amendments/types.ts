import type { Cents } from '../money.js'

export type ValidationOutcome = 'validated' | 'pending' | 'inconsistent' | 'not_verifiable'
export type CheckSeverity = 'blocking' | 'warning' | 'info'
export type VerificationStatus = 'confirmed' | 'pending_review' | 'rejected'
export type BeneficiaryType = 'none' | 'osc' | 'public_entity' | 'own_administration' | 'other'

/** Dotação orçamentária como registrada em dados estruturados oficiais. */
export interface AllocationFacts {
  id: string
  organizationId: string
  fiscalYearId: string
  fiscalYear: number
  programmaticCode: string
  agencyCode: string
  agencyName: string
  unitCode: string
  unitName: string
  functionCode: string
  functionName: string | null
  subfunctionCode: string
  subfunctionName: string | null
  programCode: string
  programName: string
  ppaReference: string | null
  actionCode: string
  actionName: string
  expenseNature: string
  groupCode: string
  modalityCode: string
  elementCode: string
  elementName: string | null
  sourceCode: string
  sourceName: string
  sourceIsEarmarked: boolean | null
  description: string | null
  authorizedCents: Cents
  availableCents: Cents | null
  availableAsOf: string | null
  availableSource: string | null
  verificationStatus: VerificationStatus
  isCurrent: boolean
  isDemo: boolean
  extraIdentifiers: Record<string, unknown>
  sourceDocumentTitle: string | null
  sourcePage: number | null
  sourceReference: string | null
}

/** Nova programação (inexistente no orçamento): nunca tratada como dado oficial. */
export interface ProposedClassification {
  description: string
  functionCode?: string | null
  subfunctionCode?: string | null
  programCode?: string | null
  actionName?: string | null
  expenseNature?: string | null
  sourceCode?: string | null
}

export interface DestinationFacts {
  id: string
  amountCents: Cents
  allocation: AllocationFacts | null
  proposedClassification: ProposedClassification | null
}

export interface Commitments {
  firmCents: Cents
  pendingCents: Cents
  amendmentsCount: number
}

export interface CancellationFacts {
  id: string
  amountCents: Cents
  allocation: AllocationFacts
  justification: string | null
  approved: boolean
  approvedBy: string | null
  approvedAt: string | null
  commitments: Commitments
}

export type ModalityKind = 'budget' | 'text'
export type TextSubtype = 'aditiva' | 'modificativa' | 'supressiva'

export interface ModalityFacts {
  id: string
  code: string
  name: string
  requiresCancellation: boolean
  isImpositive: boolean
  countsTowardIndividualLimit: boolean
  /** Emenda orçamentária (programação/anulação) ou emenda ao texto do projeto. */
  kind: ModalityKind
  textSubtype: TextSubtype | null
}

export interface AmendmentFacts {
  id: string
  organizationId: string
  officeId: string
  fiscalYearId: string
  revision: number
  title: string
  object: string | null
  purpose: string | null
  justification: string | null
  legalGrounds: string | null
  beneficiaryType: BeneficiaryType
  beneficiaryName: string | null
  beneficiaryCnpj: string | null
  transferInstrument: string | null
  /** Meta física esperada. */
  physicalGoal?: string | null
  /** Localização geográfica / endereço do beneficiário ou equipamento público. */
  beneficiaryLocation?: string | null
  /** Emendas ao texto. */
  textTarget?: string | null
  textCommand?: string | null
  originalText?: string | null
  newText?: string | null
  modality: ModalityFacts
  destinations: DestinationFacts[]
  cancellations: CancellationFacts[]
}

export interface FiscalYearFacts {
  id: string
  year: number
  phase: 'ploa' | 'loa' | 'execution' | 'closed'
  isActive: boolean
  rclCents: Cents | null
  rclReference: string | null
  amendmentDeadline: string | null
}

export interface CatalogFacts {
  functionCodes: string[]
  subfunctionCodes: string[]
  modalityCodes: string[]
  elementCodes: string[]
}

export interface ValidationContext {
  /** Data de referência (AAAA-MM-DD) — injetada para manter a validação determinística. */
  today: string
  organization: { id: string; isDemo: boolean; parliamentariansCount: number | null }
  fiscalYear: FiscalYearFacts
  /** Totais de OUTRAS emendas do gabinete que contam para o limite individual, por função. */
  officeTotals: Array<{ functionCode: string; totalCents: Cents }>
  catalog: CatalogFacts
}

export interface RuleDefinition {
  id: string
  code: string
  version: number
  name: string
  ruleType: string
  params: unknown
  legalBasis: string
  severity: 'blocking' | 'warning'
  appliesToModalities: string[] | null
}

export interface Evidence {
  kind: 'allocation' | 'document' | 'rule' | 'fiscal_year' | 'computation' | 'human_decision'
  label: string
  allocationId?: string
  documentTitle?: string | null
  page?: number | null
  value?: string
}

export interface CheckResult {
  checkCode: string
  ruleId?: string
  ruleVersion?: number
  outcome: ValidationOutcome
  severity: CheckSeverity
  title: string
  message: string
  legalBasis?: string
  details?: Record<string, unknown>
  evidence?: Evidence[]
  requiresHumanDecision?: boolean
}

export interface ValidationSummary {
  validated: number
  pending: number
  inconsistent: number
  notVerifiable: number
  blockingIssues: number
  warnings: number
  humanDecisions: number
}

export interface ValidationReport {
  outcome: ValidationOutcome
  engineVersion: string
  checks: CheckResult[]
  summary: ValidationSummary
}
