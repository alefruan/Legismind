import type { ValidationOutcome } from './types.js'

export type AmendmentStatus =
  | 'draft'
  | 'in_review'
  | 'needs_correction'
  | 'technically_validated'
  | 'awaiting_signature'
  | 'filed'
  | 'archived'

export const amendmentStatusLabels: Record<AmendmentStatus, string> = {
  draft: 'Rascunho',
  in_review: 'Em análise',
  needs_correction: 'Pendente de correção',
  technically_validated: 'Validada tecnicamente',
  awaiting_signature: 'Aguardando assinatura',
  filed: 'Protocolada',
  archived: 'Arquivada',
}

export const validationOutcomeLabels: Record<ValidationOutcome, string> = {
  validated: 'Validado',
  pending: 'Pendente de conferência',
  inconsistent: 'Inconsistente',
  not_verifiable: 'Não verificável',
}

export const EDITABLE_STATUSES: AmendmentStatus[] = ['draft', 'needs_correction']

export type Actor = 'office' | 'reviewer' | 'admin'

export interface TransitionSpec {
  to: AmendmentStatus
  label: string
  actors: Actor[]
  requiresCurrentValidation?: boolean
  requiresValidatedOutcome?: boolean
  requiresProtocol?: boolean
  requiresReason?: boolean
  tone?: 'default' | 'destructive' | 'secondary'
}

/** Espelha public.transition_amendment_status() — o banco é a fonte da verdade. */
export const transitions: Record<AmendmentStatus, TransitionSpec[]> = {
  draft: [
    { to: 'in_review', label: 'Enviar para análise', actors: ['office'], requiresCurrentValidation: true },
    { to: 'archived', label: 'Arquivar', actors: ['office', 'admin'], tone: 'secondary' },
  ],
  needs_correction: [
    { to: 'in_review', label: 'Reenviar para análise', actors: ['office'], requiresCurrentValidation: true },
    { to: 'archived', label: 'Arquivar', actors: ['office', 'admin'], tone: 'secondary' },
  ],
  in_review: [
    { to: 'technically_validated', label: 'Validar tecnicamente', actors: ['reviewer'], requiresCurrentValidation: true, requiresValidatedOutcome: true },
    { to: 'needs_correction', label: 'Solicitar correções', actors: ['reviewer', 'office'], requiresReason: true, tone: 'secondary' },
    { to: 'archived', label: 'Arquivar', actors: ['office', 'admin'], tone: 'secondary' },
  ],
  technically_validated: [
    { to: 'awaiting_signature', label: 'Liberar para assinatura', actors: ['office', 'reviewer'], requiresCurrentValidation: true, requiresValidatedOutcome: true },
    { to: 'needs_correction', label: 'Reabrir para correção', actors: ['reviewer', 'office'], requiresReason: true, tone: 'secondary' },
    { to: 'archived', label: 'Arquivar', actors: ['office', 'admin'], tone: 'secondary' },
  ],
  awaiting_signature: [
    { to: 'filed', label: 'Registrar protocolo', actors: ['office', 'admin'], requiresProtocol: true },
    { to: 'needs_correction', label: 'Reabrir para correção', actors: ['reviewer', 'office'], requiresReason: true, tone: 'secondary' },
    { to: 'archived', label: 'Arquivar', actors: ['office', 'admin'], tone: 'secondary' },
  ],
  filed: [{ to: 'archived', label: 'Arquivar', actors: ['office', 'admin'], tone: 'secondary' }],
  archived: [{ to: 'draft', label: 'Reabrir como rascunho', actors: ['office'] }],
}

export interface TransitionContext {
  status: AmendmentStatus
  actors: Actor[]
  validationCurrent: boolean
  validationOutcome: ValidationOutcome | null
  hasProtocol?: boolean
}

export function availableTransitions(ctx: TransitionContext) {
  return transitions[ctx.status]
    .filter((t) => t.actors.some((a) => ctx.actors.includes(a)))
    // emenda protocolada e arquivada não pode ser reaberta
    .filter(() => !(ctx.status === 'archived' && ctx.hasProtocol))
    .map((t) => {
      let blockedReason: string | null = null
      if (t.requiresCurrentValidation && !ctx.validationCurrent) {
        blockedReason = 'Execute a validação técnica da versão atual.'
      } else if (t.requiresValidatedOutcome && ctx.validationOutcome !== 'validated') {
        blockedReason = 'Todas as verificações obrigatórias precisam estar validadas.'
      }
      return { ...t, blockedReason }
    })
}
