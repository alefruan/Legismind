import { Link } from 'react-router'
import { AlertTriangle, ArrowRight, BookOpen, CheckCircle2, ChevronDown, FileText, Loader2, XCircle } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Button } from '@/components/ui/button'
import { AmendmentStatusBadge, DemoBadge, OutcomeBadge, OutcomeIcon, Pill, VerificationBadge } from '@/components/common/badges'
import type { ToolCard, ToolEventRecord } from '@shared/types/assistant'
import type { AmendmentStatus } from '@shared/domain/amendments/status'
import { formatBRL } from '@shared/domain/money'
import { money } from '@/lib/format'
import { cn } from '@/lib/utils'

export interface LiveToolRecord extends Partial<ToolEventRecord> {
  id: string
  name: string
  label: string
  running: boolean
}

function CardFrame({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('mt-2 rounded-lg border bg-card text-sm', className)}>{children}</div>
}

function AllocationsCard({ card }: { card: Extract<ToolCard, { kind: 'allocations' }> }) {
  if (card.items.length === 0) return null
  return (
    <CardFrame>
      <ul className="divide-y">
        {card.items.slice(0, 8).map((item) => (
          <li key={item.id} className="flex flex-col gap-1 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-xs">{item.code}</span>
                <span className="font-mono text-xs text-muted-foreground">{item.nature}</span>
                <span className="text-xs text-muted-foreground">Fonte {item.source}</span>
              </div>
              <p className="truncate text-[13px]">{item.action}</p>
              {item.document && (
                <p className="text-[11px] text-muted-foreground">
                  {item.document}
                  {item.page ? `, p. ${item.page}` : ''}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-[13px] font-medium tabular">{money(item.amount)}</span>
              <VerificationBadge status={item.verification} />
              {item.isDemo && <DemoBadge />}
              <Button asChild variant="ghost" size="icon-xs" aria-label="Abrir no Explorador Orçamentário">
                <Link to={`/orcamento?dotacao=${item.id}`}>
                  <ArrowRight />
                </Link>
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {card.items.length > 8 && <p className="border-t px-3 py-2 text-xs text-muted-foreground">+ {card.items.length - 8} dotação(ões)</p>}
    </CardFrame>
  )
}

function CitationsCard({ card }: { card: Extract<ToolCard, { kind: 'citations' }> }) {
  if (card.items.length === 0) return null
  return (
    <CardFrame>
      <ul className="divide-y">
        {card.items.map((c, i) => (
          <li key={i} className="px-3 py-2.5">
            <div className="flex items-start gap-2">
              <BookOpen className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="text-[13px] font-medium">{c.title}</p>
                <p className="text-[11px] text-muted-foreground">{c.reference}</p>
                <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">“{c.excerpt}…”</p>
                {c.suspicious && (
                  <p className="mt-1 flex items-center gap-1 text-[11px] text-warning">
                    <AlertTriangle className="size-3" /> Trecho contém comandos dirigidos a IA — tratado apenas como texto citado.
                  </p>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </CardFrame>
  )
}

function CandidatesCard({ card }: { card: Extract<ToolCard, { kind: 'candidates' }> }) {
  return (
    <CardFrame className="p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>
          Solicitado <strong className="text-foreground">{formatBRL(card.requested)}</strong>
        </span>
        <span>·</span>
        <span>
          Coberto pela sugestão <strong className="text-foreground">{formatBRL(card.covered)}</strong>
        </span>
        <span>·</span>
        <span>{card.eligible} elegível(is)</span>
      </div>
      {card.suggestion.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {card.suggestion.map((s) => (
            <li key={s.allocationId} className="flex flex-wrap items-center gap-2 rounded-md bg-muted/60 px-2.5 py-1.5">
              <span className="font-mono text-xs">{s.code}</span>
              <span className="font-mono text-xs text-muted-foreground">{s.nature}</span>
              <span className="ml-auto text-[13px] font-medium tabular">{formatBRL(s.amountCents)}</span>
              {s.basis !== 'official_balance' && <Pill tone="warning">Exige confirmação humana</Pill>}
            </li>
          ))}
        </ul>
      )}
      {card.exclusions.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger className="mt-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ChevronDown className="size-3" /> Dotações excluídas ({card.exclusions.reduce((s, e) => s + e.count, 0)})
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="mt-1.5 space-y-1 text-xs text-muted-foreground">
              {card.exclusions.map((e, i) => (
                <li key={i}>
                  <strong className="text-foreground">{e.count}</strong> · {e.reason}
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}
    </CardFrame>
  )
}

function ChecksList({ checks }: { checks: Array<{ code: string; title: string; outcome: 'validated' | 'pending' | 'inconsistent' | 'not_verifiable'; message: string; severity?: string; human?: boolean }> }) {
  return (
    <ul className="divide-y">
      {checks.map((c) => (
        <li key={c.code} className="flex gap-2.5 px-3 py-2">
          <OutcomeIcon outcome={c.outcome} className="mt-0.5" />
          <div className="min-w-0">
            <p className="text-[13px] font-medium">
              {c.title}
              {c.severity === 'warning' && <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">(aviso)</span>}
              {c.human && <span className="ml-1.5 text-[11px] font-normal text-warning">· decisão humana</span>}
            </p>
            <p className="text-xs text-muted-foreground">{c.message}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}

function ValidationCard({ card }: { card: Extract<ToolCard, { kind: 'validation' }> }) {
  const issues = card.checks.filter((c) => c.outcome !== 'validated' && c.severity !== 'info')
  const ok = card.checks.filter((c) => c.outcome === 'validated')
  return (
    <CardFrame>
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2.5">
        <OutcomeBadge outcome={card.outcome} />
        <span className="text-xs text-muted-foreground">
          {card.counts.validated} validada(s) · {card.counts.pending} pendente(s) · {card.counts.inconsistent} inconsistente(s) · {card.counts.notVerifiable} não verificável(is)
        </span>
        <Button asChild variant="ghost" size="xs" className="ml-auto">
          <Link to={`/emendas/${card.amendmentId}?aba=validacao`}>
            Relatório completo <ArrowRight />
          </Link>
        </Button>
      </div>
      {issues.length > 0 && <ChecksList checks={issues} />}
      {ok.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger className="flex w-full items-center gap-1 border-t px-3 py-2 text-xs text-muted-foreground hover:text-foreground">
            <ChevronDown className="size-3" /> Verificações aprovadas ({ok.length})
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ChecksList checks={ok} />
          </CollapsibleContent>
        </Collapsible>
      )}
    </CardFrame>
  )
}

export function ToolCardView({ card }: { card: ToolCard }) {
  switch (card.kind) {
    case 'allocations':
      return <AllocationsCard card={card} />
    case 'citations':
      return <CitationsCard card={card} />
    case 'candidates':
      return <CandidatesCard card={card} />
    case 'checks':
      return (
        <CardFrame>
          <ChecksList checks={card.checks} />
        </CardFrame>
      )
    case 'validation':
      return <ValidationCard card={card} />
    case 'amendment':
      return (
        <CardFrame className="flex flex-wrap items-center gap-3 p-3">
          <FileText className="size-4 text-brand" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium">{card.title}</p>
            <p className="text-xs text-muted-foreground">
              {card.created ? 'Rascunho criado' : 'Emenda atualizada'} · {formatBRL(card.totalCents)}
            </p>
          </div>
          <AmendmentStatusBadge status={card.status as AmendmentStatus} />
          <Button asChild size="sm">
            <Link to={`/emendas/${card.amendmentId}`}>Abrir no editor</Link>
          </Button>
        </CardFrame>
      )
    case 'document':
      return (
        <CardFrame className="p-3">
          <div className="flex flex-wrap items-center gap-2">
            <FileText className="size-4 text-brand" />
            <span className="text-[13px] font-medium">Minuta gerada</span>
            {card.watermark && <Pill tone="warning">{card.watermark}</Pill>}
            <Button asChild variant="outline" size="sm" className="ml-auto">
              <Link to={`/emendas/${card.amendmentId}?aba=documento`}>Visualizar e exportar</Link>
            </Button>
          </div>
          {card.pending.length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
              {card.pending.map((p) => (
                <li key={p}>Pendente: {p}</li>
              ))}
            </ul>
          )}
        </CardFrame>
      )
    case 'interpretation':
      return (
        <CardFrame className="grid gap-1 p-3 text-xs">
          <p>
            <span className="text-muted-foreground">Valor identificado:</span> {card.amountCents !== null ? formatBRL(card.amountCents) : 'não identificado'}
          </p>
          <p>
            <span className="text-muted-foreground">Área:</span> {card.area ?? 'não identificada'}
            {card.functions.length > 0 && ` (funções ${card.functions.join(', ')})`}
          </p>
          {card.beneficiary && (
            <p>
              <span className="text-muted-foreground">Beneficiário:</span> {card.beneficiary}
            </p>
          )}
          {card.missing.length > 0 && <p className="text-warning">Informações a complementar: {card.missing.join('; ')}.</p>}
        </CardFrame>
      )
    case 'context':
      return null
  }
}

export function ToolActivity({ record }: { record: LiveToolRecord }) {
  return (
    <div className="text-sm">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {record.running ? (
          <Loader2 className="size-3.5 animate-spin text-brand" />
        ) : record.ok === false ? (
          <XCircle className="size-3.5 text-danger" />
        ) : (
          <CheckCircle2 className="size-3.5 text-success" />
        )}
        <span className={cn(record.running && 'text-foreground')}>{record.label}</span>
        {!record.running && record.summary && <span className="truncate">— {record.summary}</span>}
      </div>
      {!record.running && record.card && <ToolCardView card={record.card} />}
    </div>
  )
}
