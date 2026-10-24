import { AlertOctagon, CheckCircle2, CircleDashed, HelpCircle, Clock, FlaskConical } from 'lucide-react'
import { amendmentStatusLabels, validationOutcomeLabels, type AmendmentStatus } from '@shared/domain/amendments/status'
import type { ValidationOutcome } from '@shared/domain/amendments/types'
import { processingStatusLabels, verificationStatusLabels } from '@shared/domain/labels'
import type { ProcessingStatus, VerificationStatus } from '@shared/types/db'
import { cn } from '@/lib/utils'

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'brand'

const toneClasses: Record<Tone, string> = {
  neutral: 'bg-neutral-soft text-muted-foreground ring-border',
  info: 'bg-brand-soft text-brand ring-brand/20',
  brand: 'bg-primary text-primary-foreground ring-primary',
  success: 'bg-success-soft text-success ring-success/25',
  warning: 'bg-warning-soft text-warning ring-warning/30',
  danger: 'bg-danger-soft text-danger ring-danger/25',
}

export function Pill({ tone = 'neutral', className, children, icon: Icon }: { tone?: Tone; className?: string; children: React.ReactNode; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <span className={cn('inline-flex h-5.5 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-medium whitespace-nowrap ring-1 ring-inset', toneClasses[tone], className)}>
      {Icon && <Icon className="size-3" />}
      {children}
    </span>
  )
}

const statusTone: Record<AmendmentStatus, Tone> = {
  draft: 'neutral',
  in_review: 'info',
  needs_correction: 'warning',
  technically_validated: 'success',
  awaiting_signature: 'brand',
  filed: 'success',
  archived: 'neutral',
}

export function AmendmentStatusBadge({ status }: { status: AmendmentStatus }) {
  return <Pill tone={statusTone[status]}>{amendmentStatusLabels[status]}</Pill>
}

const outcomeMeta: Record<ValidationOutcome, { tone: Tone; icon: React.ComponentType<{ className?: string }> }> = {
  validated: { tone: 'success', icon: CheckCircle2 },
  pending: { tone: 'warning', icon: Clock },
  inconsistent: { tone: 'danger', icon: AlertOctagon },
  not_verifiable: { tone: 'neutral', icon: HelpCircle },
}

export function OutcomeBadge({ outcome, stale = false }: { outcome: ValidationOutcome | null | undefined; stale?: boolean }) {
  if (!outcome) return <Pill icon={CircleDashed}>Não validada</Pill>
  if (stale) return <Pill tone="warning" icon={Clock}>Validação desatualizada</Pill>
  const meta = outcomeMeta[outcome]
  return (
    <Pill tone={meta.tone} icon={meta.icon}>
      {validationOutcomeLabels[outcome]}
    </Pill>
  )
}

export function OutcomeIcon({ outcome, className }: { outcome: ValidationOutcome; className?: string }) {
  const meta = outcomeMeta[outcome]
  const color = { success: 'text-success', warning: 'text-warning', danger: 'text-danger', neutral: 'text-muted-foreground', info: 'text-brand', brand: 'text-primary' }[meta.tone]
  return <meta.icon className={cn('size-4 shrink-0', color, className)} />
}

export function VerificationBadge({ status }: { status: VerificationStatus }) {
  const tone: Tone = status === 'confirmed' ? 'success' : status === 'pending_review' ? 'warning' : 'danger'
  return <Pill tone={tone}>{verificationStatusLabels[status]}</Pill>
}

export function ProcessingBadge({ status }: { status: ProcessingStatus }) {
  const tone: Tone = { pending_upload: 'neutral', queued: 'info', processing: 'info', needs_review: 'warning', completed: 'success', failed: 'danger' }[status] as Tone
  return <Pill tone={tone}>{processingStatusLabels[status]}</Pill>
}

export function DemoBadge() {
  return (
    <Pill tone="warning" icon={FlaskConical}>
      Fictício
    </Pill>
  )
}
