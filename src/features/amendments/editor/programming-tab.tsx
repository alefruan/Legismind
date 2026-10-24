import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Loader2, Plus, Sparkles, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { AllocationPicker } from '@/components/budget/allocation-picker'
import { DemoBadge, Pill, VerificationBadge } from '@/components/common/badges'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { EmptyState, ErrorState } from '@/components/common/states'
import type { BudgetAllocationViewRow } from '@shared/types/db'
import { centsToDecimal, formatBRL } from '@shared/domain/money'
import { apiFetch } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import { centsToInput, money, parseMoneyInput, toCents } from '@/lib/format'
import { amendmentKeys, useAmendmentLines, type AmendmentDetail } from '../hooks'

interface CandidateReport {
  eligible: Array<{
    allocationId: string
    programmaticCode: string
    actionName: string
    expenseNature: string
    sourceCode: string
    authorizedCents: number
    maxCents: number
    availabilityBasis: string
    verificationStatus: string
    warnings: string[]
    isDemo: boolean
    sourceDocument: string | null
    page: number | null
  }>
  exclusionSummary: Array<{ reason: string; count: number; examples: string[] }>
  analysis: { suggestion: Array<{ allocationId: string; amountCents: number }>; coveredCents: number; requestedCents: number; notes: string[] }
  totalCandidates: number
}

function AllocationSummary({ allocation }: { allocation: BudgetAllocationViewRow | null }) {
  if (!allocation) return <span className="text-sm text-muted-foreground">Nova programação (depende de autorização normativa)</span>
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs">
        <span>{allocation.programmatic_code}</span>
        <span className="text-muted-foreground">{allocation.expense_nature}</span>
        <span className="text-muted-foreground">Fonte {allocation.source_code}</span>
      </div>
      <p className="text-sm">{allocation.action_name}</p>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        <span>Dotação {money(allocation.authorized_amount)}</span>
        {allocation.source_document_title && (
          <span>
            · {allocation.source_document_title}
            {allocation.source_page ? `, p. ${allocation.source_page}` : ''}
          </span>
        )}
        <VerificationBadge status={allocation.verification_status} />
        {allocation.is_demo && <DemoBadge />}
      </div>
    </div>
  )
}

function AmountEditor({ value, disabled, onSave }: { value: string; disabled: boolean; onSave: (decimal: string) => Promise<void> }) {
  const [text, setText] = useState(centsToInput(toCents(value)))
  const [saving, setSaving] = useState(false)
  useEffect(() => setText(centsToInput(toCents(value))), [value])
  const commit = async () => {
    const cents = parseMoneyInput(text)
    if (!cents || cents <= 0) {
      toast.error('Valor inválido.')
      setText(centsToInput(toCents(value)))
      return
    }
    if (cents === toCents(value)) return
    setSaving(true)
    try {
      await onSave(centsToDecimal(cents))
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="relative w-36">
      <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-muted-foreground">R$</span>
      <Input
        value={text}
        disabled={disabled || saving}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        className="h-8 pl-8 text-right text-sm tabular"
        aria-label="Valor"
      />
    </div>
  )
}

export function ProgrammingTab({ amendment, canEdit }: { amendment: AmendmentDetail; canEdit: boolean }) {
  const queryClient = useQueryClient()
  const lines = useAmendmentLines(amendment.id)
  const [params, setParams] = useSearchParams()
  const [pickerOpen, setPickerOpen] = useState<'destination' | 'cancellation' | null>(null)
  const [showCandidates, setShowCandidates] = useState(false)

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: amendmentKeys.lines(amendment.id) })
    void queryClient.invalidateQueries({ queryKey: amendmentKeys.detail(amendment.id) })
  }

  // Dotação escolhida no Explorador Orçamentário (?adicionar=<id>)
  const preselected = params.get('adicionar')
  useEffect(() => {
    if (preselected && canEdit) setPickerOpen('destination')
  }, [preselected, canEdit])

  const destinationTotal = (lines.data?.destinations ?? []).reduce((s, d) => s + toCents(d.amount), 0)
  const cancellationTotal = (lines.data?.cancellations ?? []).reduce((s, c) => s + toCents(c.amount), 0)
  const difference = cancellationTotal - destinationTotal

  // Analisa o valor ainda descoberto; se já houver anulações suficientes, reanalisa o total.
  const uncovered = destinationTotal - cancellationTotal
  const analysisCents = uncovered > 0 ? uncovered : destinationTotal
  const candidates = useQuery({
    queryKey: ['candidates', amendment.id, analysisCents],
    enabled: showCandidates && destinationTotal > 0,
    queryFn: () => apiFetch<CandidateReport>(`/amendments/${amendment.id}/candidates?amount=${analysisCents / 100}`),
  })

  const addLine = async (table: 'amendment_allocations' | 'amendment_cancellations', allocationId: string, amount: number, justification?: string) => {
    const { error } = await supabase.from(table).insert({
      amendment_id: amendment.id,
      organization_id: amendment.organization_id,
      fiscal_year_id: amendment.fiscal_year_id,
      allocation_id: allocationId,
      amount: centsToDecimal(Math.round(amount * 100)),
      origin: preselected ? 'explorer' : 'user',
      ...(table === 'amendment_cancellations' ? { justification: justification ?? null, approved: false } : {}),
    })
    if (error) throw new Error(error.code === '23505' ? 'Esta dotação já foi indicada nesta emenda.' : error.code === '23503' ? 'Dotação inválida para este exercício.' : error.message)
    invalidate()
    if (preselected) {
      params.delete('adicionar')
      setParams(params, { replace: true })
    }
  }

  const updateLine = useMutation({
    mutationFn: async ({ table, id, patch }: { table: 'amendment_allocations' | 'amendment_cancellations'; id: string; patch: Record<string, unknown> }) => {
      const { error } = await supabase.from(table).update(patch).eq('id', id)
      if (error) throw new Error(error.message)
    },
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  })

  const removeLine = async (table: 'amendment_allocations' | 'amendment_cancellations', id: string) => {
    const { error } = await supabase.from(table).delete().eq('id', id)
    if (error) toast.error(error.message)
    else invalidate()
  }

  const applySuggestion = useMutation({
    mutationFn: async (report: CandidateReport) => {
      const justification = 'Anulação indicada a partir da análise de candidatas do LegisMind; disponibilidade a confirmar pelo gabinete.'
      for (const item of report.analysis.suggestion) {
        await addLine('amendment_cancellations', item.allocationId, item.amountCents / 100, justification)
      }
    },
    onSuccess: () => {
      toast.success('Sugestão aplicada. Revise e aprove cada anulação.')
      setShowCandidates(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (lines.error) return <ErrorState error={lines.error} onRetry={() => lines.refetch()} />
  if (lines.isLoading) return <Skeleton className="h-64" />
  const { destinations, cancellations } = lines.data!

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3 pb-3">
          <div>
            <CardTitle className="text-sm">Programação de destino (acréscimo)</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Somente dotações existentes nos dados orçamentários estruturados.</p>
          </div>
          {canEdit && (
            <Button size="sm" variant="outline" onClick={() => setPickerOpen('destination')}>
              <Plus /> Adicionar destino
            </Button>
          )}
        </CardHeader>
        <CardContent className="pt-0">
          {destinations.length === 0 ? (
            <EmptyState title="Nenhuma programação de destino" description="Indique a dotação que receberá os recursos da emenda." />
          ) : (
            <ul className="divide-y rounded-md border">
              {destinations.map((d) => (
                <li key={d.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <AllocationSummary allocation={d.allocation} />
                  </div>
                  <div className="flex items-center gap-2">
                    <AmountEditor value={d.amount} disabled={!canEdit} onSave={(amount) => updateLine.mutateAsync({ table: 'amendment_allocations', id: d.id, patch: { amount } })} />
                    {canEdit && (
                      <Button size="icon-sm" variant="ghost" onClick={() => void removeLine('amendment_allocations', d.id)} aria-label="Remover destino">
                        <Trash2 />
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-right text-sm">
            Total destinado: <strong className="tabular">{formatBRL(destinationTotal)}</strong>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3 pb-3">
          <div>
            <CardTitle className="text-sm">Anulação compensatória</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              {amendment.modality.requires_cancellation ? 'Exigida pela modalidade.' : 'Não exigida pela modalidade.'} Cada anulação exige justificativa e aprovação explícita.
            </p>
          </div>
          {canEdit && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={destinationTotal === 0} onClick={() => setShowCandidates((v) => !v)}>
                <Sparkles /> Analisar candidatas
              </Button>
              <Button size="sm" variant="outline" onClick={() => setPickerOpen('cancellation')}>
                <Plus /> Adicionar
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          {showCandidates && (
            <div className="rounded-md border bg-muted/30 p-3">
              {candidates.isLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Aplicando regras de despesas protegidas, fontes e disponibilidade…
                </div>
              ) : candidates.error ? (
                <ErrorState error={candidates.error} onRetry={() => candidates.refetch()} />
              ) : candidates.data ? (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    {candidates.data.totalCandidates} dotação(ões) analisada(s). Sugestão cobre {formatBRL(candidates.data.analysis.coveredCents)} de{' '}
                    {formatBRL(candidates.data.analysis.requestedCents)}.
                  </p>
                  <ul className="space-y-1.5">
                    {candidates.data.eligible.map((c) => {
                      const suggested = candidates.data!.analysis.suggestion.find((s) => s.allocationId === c.allocationId)
                      return (
                        <li key={c.allocationId} className="rounded-md border bg-background p-2.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs">{c.programmaticCode}</span>
                            <span className="font-mono text-xs text-muted-foreground">{c.expenseNature}</span>
                            <span className="text-xs text-muted-foreground">Fonte {c.sourceCode}</span>
                            {suggested && <Pill tone="info">Sugerida: {formatBRL(suggested.amountCents)}</Pill>}
                            {c.isDemo && <DemoBadge />}
                            <span className="ml-auto text-xs tabular">até {formatBRL(c.maxCents)}</span>
                          </div>
                          <p className="text-[13px]">{c.actionName}</p>
                          {c.warnings.length > 0 && <p className="mt-1 text-[11px] text-warning">{c.warnings.join(' ')}</p>}
                        </li>
                      )
                    })}
                  </ul>
                  {candidates.data.exclusionSummary.length > 0 && (
                    <details className="text-xs text-muted-foreground">
                      <summary className="cursor-pointer">Exclusões ({candidates.data.exclusionSummary.reduce((s, e) => s + e.count, 0)})</summary>
                      <ul className="mt-1 space-y-1">
                        {candidates.data.exclusionSummary.map((e, i) => (
                          <li key={i}>
                            <strong>{e.count}</strong> · {e.reason}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  {candidates.data.analysis.notes.map((n, i) => (
                    <p key={i} className="text-[11px] text-muted-foreground">
                      {n}
                    </p>
                  ))}
                  {candidates.data.analysis.suggestion.length > 0 && (
                    <Button size="sm" onClick={() => applySuggestion.mutate(candidates.data!)} disabled={applySuggestion.isPending}>
                      {applySuggestion.isPending && <Loader2 className="animate-spin" />}
                      Aplicar sugestão (pendente de aprovação)
                    </Button>
                  )}
                </div>
              ) : null}
            </div>
          )}

          {cancellations.length === 0 ? (
            <EmptyState title="Nenhuma anulação indicada" description={amendment.modality.requires_cancellation ? 'Esta modalidade exige anulação compensatória.' : undefined} />
          ) : (
            <ul className="divide-y rounded-md border">
              {cancellations.map((c) => (
                <li key={c.id} className="space-y-3 p-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <AllocationSummary allocation={c.allocation} />
                    </div>
                    <div className="flex items-center gap-2">
                      <AmountEditor value={c.amount} disabled={!canEdit} onSave={(amount) => updateLine.mutateAsync({ table: 'amendment_cancellations', id: c.id, patch: { amount } })} />
                      {canEdit && (
                        <ConfirmDialog
                          trigger={
                            <Button size="icon-sm" variant="ghost" aria-label="Remover anulação">
                              <Trash2 />
                            </Button>
                          }
                          title="Remover anulação?"
                          description="A emenda precisará ser validada novamente."
                          confirmLabel="Remover"
                          destructive
                          onConfirm={() => removeLine('amendment_cancellations', c.id)}
                        />
                      )}
                    </div>
                  </div>
                  <Input
                    defaultValue={c.justification ?? ''}
                    disabled={!canEdit}
                    placeholder="Justificativa técnica da anulação"
                    onBlur={(e) => {
                      if (e.target.value !== (c.justification ?? '')) updateLine.mutate({ table: 'amendment_cancellations', id: c.id, patch: { justification: e.target.value || null } })
                    }}
                    className="h-8 text-sm"
                    aria-label="Justificativa da anulação"
                  />
                  <label className="flex items-start gap-2.5 text-sm">
                    <Checkbox
                      checked={c.approved}
                      disabled={!canEdit || updateLine.isPending}
                      onCheckedChange={(checked) => updateLine.mutate({ table: 'amendment_cancellations', id: c.id, patch: { approved: checked === true } })}
                      className="mt-0.5"
                    />
                    <span>
                      {c.approved ? (
                        <span className="inline-flex items-center gap-1 font-medium text-success">
                          <CheckCircle2 className="size-3.5" /> Anulação aprovada pelo gabinete
                        </span>
                      ) : (
                        <span className="font-medium">Aprovar esta anulação</span>
                      )}
                      <span className="block text-xs text-muted-foreground">
                        Confirmo que conferi a disponibilidade e assumo a indicação desta dotação. Alterar o valor desfaz a aprovação.
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-col items-end gap-1 text-sm">
            <p>
              Total anulado: <strong className="tabular">{formatBRL(cancellationTotal)}</strong>
            </p>
            {amendment.modality.requires_cancellation && difference !== 0 && destinationTotal > 0 && (
              <p className="flex items-center gap-1.5 text-xs text-warning">
                <AlertTriangle className="size-3.5" />
                {difference < 0 ? `Faltam ${formatBRL(-difference)} em anulações.` : `Anulações excedem o destino em ${formatBRL(difference)}.`}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {pickerOpen && (
        <AllocationPicker
          open
          onOpenChange={(open) => !open && setPickerOpen(null)}
          fiscalYearId={amendment.fiscal_year_id}
          title={pickerOpen === 'destination' ? 'Adicionar programação de destino' : 'Adicionar anulação compensatória'}
          description={
            pickerOpen === 'destination'
              ? 'Escolha a dotação que receberá o acréscimo.'
              : 'Escolha a dotação a ser anulada. A validação verificará despesas protegidas, fontes e disponibilidade.'
          }
          defaultQuery={pickerOpen === 'destination' && preselected ? '' : amendment.policy_area ?? ''}
          defaultAmount={pickerOpen === 'cancellation' && difference < 0 ? centsToInput(-difference) : undefined}
          requireJustification={pickerOpen === 'cancellation'}
          initialAllocationId={pickerOpen === 'destination' ? preselected : null}
          onConfirm={({ allocation, amount, justification }) =>
            addLine(pickerOpen === 'destination' ? 'amendment_allocations' : 'amendment_cancellations', allocation.id, amount, justification)
          }
        />
      )}
    </div>
  )
}
