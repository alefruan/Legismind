/**
 * Tipos das linhas retornadas pelo Supabase (espelham as migrations).
 * Para gerar tipos completos: `supabase gen types typescript --linked > shared/types/supabase.ts`.
 */
import type { AmendmentStatus } from '../domain/amendments/status.js'
import type { ValidationOutcome } from '../domain/amendments/types.js'

export type MemberRole = 'org_admin' | 'parliamentarian' | 'advisor' | 'reviewer'
export type OfficeRole = 'titular' | 'chief_of_staff' | 'advisor'
export type OrgKind = 'camara_municipal' | 'assembleia_legislativa' | 'camara_legislativa_df'
export type OrgStatus = 'trial' | 'active' | 'suspended' | 'archived'
export type FiscalPhase = 'ploa' | 'loa' | 'execution' | 'closed'
export type VerificationStatus = 'confirmed' | 'pending_review' | 'rejected'
export type ProcessingStatus = 'pending_upload' | 'queued' | 'processing' | 'needs_review' | 'completed' | 'failed'
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
export type RuleStatus = 'draft' | 'active' | 'archived'
export type DocumentTypeCode =
  | 'loa' | 'ploa' | 'ldo' | 'ppa' | 'constituicao_federal' | 'constituicao_estadual' | 'lei_organica'
  | 'regimento_interno' | 'lei_complementar' | 'lei_ordinaria' | 'resolucao' | 'decreto' | 'manual_tecnico'
  | 'modelo_emenda' | 'anexo_orcamentario' | 'outro'

export interface OrganizationRow {
  id: string
  name: string
  short_name: string | null
  kind: OrgKind
  uf: string
  municipality: string | null
  ibge_code: string | null
  cnpj: string | null
  slug: string
  status: OrgStatus
  plan_id: string | null
  is_demo: boolean
  parliamentarians_count: number | null
  created_at: string
}

export interface OrganizationSettingsRow {
  organization_id: string
  institution_header: string | null
  institution_address: string | null
  amendment_number_prefix: string
  require_reviewer_approval: boolean
  ai_enabled: boolean
  ai_monthly_request_limit: number | null
  ai_message_retention_days: number
  audit_retention_days: number
  expense_nature_format: 'c.g.mm.ee' | 'cg.mm.ee'
  signature_city: string | null
  updated_at: string
}

export interface ProfileRow {
  id: string
  email: string
  full_name: string | null
  display_name: string | null
  job_title: string | null
  phone: string | null
  last_organization_id: string | null
  last_office_id: string | null
  onboarded_at: string | null
}

export interface MembershipRow {
  id: string
  organization_id: string
  user_id: string
  role: MemberRole
  status: 'active' | 'suspended'
  created_at: string
}

export interface OfficeRow {
  id: string
  organization_id: string
  name: string
  parliamentarian_name: string
  parliamentarian_user_id: string | null
  parliamentarian_title: string | null
  party: string | null
  legislative_term_id: string | null
  status: 'active' | 'inactive'
}

export interface OfficeMemberRow {
  office_id: string
  organization_id: string
  user_id: string
  office_role: OfficeRole
}

export interface FiscalYearRow {
  id: string
  organization_id: string
  year: number
  phase: FiscalPhase
  is_active: boolean
  rcl_amount: string | null
  rcl_reference: string | null
  amendment_deadline: string | null
  notes: string | null
  bill_number: string | null
  bill_summary: string | null
}

export interface InvitationRow {
  id: string
  organization_id: string
  email: string
  role: MemberRole
  office_id: string | null
  office_role: OfficeRole | null
  status: 'pending' | 'accepted' | 'revoked'
  expires_at: string
  created_at: string
}

export interface BudgetAllocationViewRow {
  id: string
  organization_id: string
  fiscal_year_id: string
  fiscal_year: number
  agency_id: string
  agency_code: string
  agency_name: string
  unit_id: string
  unit_code: string
  unit_name: string
  function_code: string
  function_name: string | null
  subfunction_code: string
  subfunction_name: string | null
  program_id: string
  program_code: string
  program_name: string
  ppa_reference: string | null
  action_id: string
  action_code: string
  action_name: string
  action_kind: string
  expense_nature: string
  category_code: string
  group_code: string
  modality_code: string
  modality_name: string | null
  element_code: string
  element_name: string | null
  source_id: string
  source_code: string
  source_name: string
  source_is_earmarked: boolean | null
  allocation_code: string | null
  description: string | null
  authorized_amount: string
  available_amount: string | null
  available_as_of: string | null
  available_source: string | null
  extra_identifiers: Record<string, unknown>
  source_version_id: string | null
  source_document_id: string | null
  source_document_title: string | null
  source_page: number | null
  source_reference: string | null
  extraction_confidence: string | null
  verification_status: VerificationStatus
  verified_at: string | null
  is_current: boolean
  is_demo: boolean
  programmatic_code: string
}

export const ALLOCATION_VIEW_COLUMNS =
  'id, organization_id, fiscal_year_id, fiscal_year, agency_id, agency_code, agency_name, unit_id, unit_code, unit_name, function_code, function_name, subfunction_code, subfunction_name, program_id, program_code, program_name, ppa_reference, action_id, action_code, action_name, action_kind, expense_nature, category_code, group_code, modality_code, modality_name, element_code, element_name, source_id, source_code, source_name, source_is_earmarked, allocation_code, description, authorized_amount, available_amount, available_as_of, available_source, extra_identifiers, source_version_id, source_document_id, source_document_title, source_page, source_reference, extraction_confidence, verification_status, verified_at, is_current, is_demo, programmatic_code'

export interface AmendmentModalityRow {
  id: string
  organization_id: string
  code: string
  name: string
  description: string | null
  requires_cancellation: boolean
  is_impositive: boolean
  counts_toward_individual_limit: boolean
  legal_basis: string | null
  is_active: boolean
  kind: 'budget' | 'text'
  text_subtype: 'aditiva' | 'modificativa' | 'supressiva' | null
  type_label: string | null
  template_id: string | null
}

export interface AmendmentRow {
  id: string
  organization_id: string
  office_id: string
  fiscal_year_id: string
  modality_id: string
  sequence_number: number | null
  title: string
  object: string | null
  purpose: string | null
  policy_area: string | null
  beneficiary_type: 'none' | 'osc' | 'public_entity' | 'own_administration' | 'other'
  beneficiary_name: string | null
  beneficiary_cnpj: string | null
  transfer_instrument: string | null
  total_amount: string
  justification: string | null
  legal_grounds: string | null
  physical_goal: string | null
  beneficiary_location: string | null
  indication_date: string | null
  text_target: string | null
  text_command: string | null
  original_text: string | null
  new_text: string | null
  body: Record<string, unknown>
  template_id: string | null
  status: AmendmentStatus
  visibility: 'office' | 'organization'
  revision: number
  last_validation_run_id: string | null
  validation_outcome: ValidationOutcome | null
  validated_revision: number | null
  protocol_number: string | null
  protocol_date: string | null
  source_conversation_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface AmendmentAllocationRow {
  id: string
  amendment_id: string
  organization_id: string
  fiscal_year_id: string
  allocation_id: string | null
  proposed_classification: Record<string, unknown> | null
  requires_normative_authorization: boolean
  amount: string
  notes: string | null
  origin: 'user' | 'assistant' | 'explorer'
  created_at: string
}

export interface AmendmentCancellationRow {
  id: string
  amendment_id: string
  organization_id: string
  fiscal_year_id: string
  allocation_id: string
  amount: string
  justification: string | null
  origin: 'user' | 'assistant' | 'explorer'
  approved: boolean
  approved_by: string | null
  approved_at: string | null
  created_at: string
}

export interface ValidationRunRow {
  id: string
  amendment_id: string
  organization_id: string
  amendment_revision: number
  outcome: ValidationOutcome
  engine_version: string
  summary: Record<string, unknown>
  executed_by: string | null
  executed_at: string
}

export interface ValidationItemRow {
  id: string
  run_id: string
  check_code: string
  rule_id: string | null
  rule_version: number | null
  outcome: ValidationOutcome
  severity: 'blocking' | 'warning' | 'info'
  title: string
  message: string
  legal_basis: string | null
  details: Record<string, unknown>
  evidence: Array<Record<string, unknown>>
  requires_human_decision: boolean
  position: number
}

export interface LegalRuleRow {
  id: string
  organization_id: string
  code: string
  version: number
  name: string
  description: string | null
  rule_type: string
  params: Record<string, unknown>
  legal_basis: string
  source_document_id: string | null
  sphere: 'federal' | 'estadual' | 'municipal' | 'interna'
  severity: 'blocking' | 'warning'
  applies_to_modalities: string[] | null
  status: RuleStatus
  local_incidence_confirmed: boolean
  incidence_note: string | null
  confirmed_by: string | null
  confirmed_at: string | null
  effective_from: string | null
  effective_to: string | null
  template_code: string | null
  created_at: string
}

export interface RuleTemplateRow {
  id: string
  code: string
  name: string
  description: string
  rule_type: string
  default_params: Record<string, unknown>
  legal_basis: string
  sphere: 'federal' | 'estadual' | 'municipal' | 'interna'
  severity: 'blocking' | 'warning'
  applicability_note: string
}

export interface DocumentTemplateRow {
  id: string
  organization_id: string
  kind: string
  name: string
  description: string | null
  body: string
  version: number
  status: RuleStatus
  is_default: boolean
  updated_at: string
}

export interface DocumentRow {
  id: string
  organization_id: string
  fiscal_year_id: string | null
  doc_type: DocumentTypeCode
  title: string
  legal_reference: string | null
  sphere: 'federal' | 'estadual' | 'municipal'
  description: string | null
  publication_date: string | null
  effective_from: string | null
  effective_to: string | null
  source_url: string | null
  status: 'active' | 'obsolete' | 'draft'
  current_version_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface DocumentVersionRow {
  id: string
  organization_id: string
  document_id: string
  version_number: number
  storage_path: string
  file_name: string
  mime_type: string
  size_bytes: number
  sha256: string | null
  processing_status: ProcessingStatus
  page_count: number | null
  ocr_used: boolean
  stats: Record<string, unknown>
  error_message: string | null
  change_notes: string | null
  uploaded_by: string | null
  created_at: string
  processed_at: string | null
}

export interface ProcessingJobRow {
  id: string
  organization_id: string
  document_version_id: string
  job_type: 'ingest_document' | 'reindex_document' | 'embed_chunks'
  status: JobStatus
  stage: string
  progress: string | number
  attempts: number
  max_attempts: number
  state: Record<string, unknown>
  run_after: string
  locked_at: string | null
  last_error: string | null
  created_at: string
  updated_at: string
  started_at: string | null
  finished_at: string | null
}

export interface ExtractionIssueRow {
  id: string
  organization_id: string
  version_id: string
  severity: 'info' | 'warning' | 'error'
  code: string
  message: string
  page: number | null
  excerpt: string | null
  status: 'open' | 'resolved' | 'dismissed'
  resolution_note: string | null
  created_at: string
}

export interface AiConversationRow {
  id: string
  organization_id: string
  office_id: string | null
  user_id: string
  fiscal_year_id: string | null
  amendment_id: string | null
  title: string
  archived_at: string | null
  created_at: string
  updated_at: string
}

export interface AiMessageRow {
  id: string
  conversation_id: string
  role: 'user' | 'assistant'
  content: string
  blocks: unknown[]
  model: string | null
  created_at: string
}

export interface AuditLogRow {
  id: number
  organization_id: string | null
  actor_id: string | null
  action: string
  entity_type: string
  entity_id: string | null
  summary: string | null
  metadata: Record<string, unknown>
  created_at: string
}
