import { useState } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, FilePlus2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { DemoBadge, VerificationBadge } from '@/components/common/badges'
import { NativeSelect } from '@/components/common/form'
import { ErrorState } from '@/components/common/states'
import { actionKindLabels } from '@shared/domain/labels'
import { isContingencyReserve } from '@shared/domain/budget/codes'
import { ALLOCATION_VIEW_COLUMNS, type BudgetAllocationViewRow } from '@shared/types/db'
import { supabase, unwrap } from '@/lib/supabase'
import { formatDate, money } from '@/lib/format'
import { useWorkspace } from '@/providers/workspace'

function Row({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-3 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? 'font-mono text-xs leading-5' : ''}>{value}</dd>
    </div>
  )
}

export function AllocationDetailSheet({ allocationId, onClose, onUse }: { allocationId: string | null; onClose: () => void; onUse: (id: string, amendmentId: string | null) => void }) {
  const ws = useWorkspace()
  const [target, setTarget] = useState('')
  const queryClient = useQueryClient()
  const reserveFlag = useMutation({
    mutationFn: async ({ id, extra, value }: { id: string; extra: Record<string, unknown>; value: boolean }) => {
      const next = { ...extra }
      if (value) next['reserva_emendas'] = true
      else delete next['reserva_emendas']
      const { data, error } = await supabase.from('budget_allocations').update({ extra_identifiers: next }).eq('id', id).select('id')
      if (error) throw error
      if (!data?.length) throw new Error('Sem permissão para alterar esta dotação.')
    },
    onSuccess: (_, v) => {
      toast.success(v.value ? 'Dotação identificada como reserva para emendas.' : 'Identificação removida.')
      void queryClient.invalidateQueries({ queryKey: ['allocation-detail', allocationId] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const canFlagReserve = ws.isOrgAdmin || ws.isReviewer
  const detail = useQuery({
    queryKey: ['allocation-detail', allocationId],
    enabled: Boolean(allocationId),
    queryFn: async () => {
      const row = unwrap<BudgetAllocationViewRow | null>(await supabase.from('budget_allocations_view').select(ALLOCATION_VIEW_COLUMNS).eq('id', allocationId!).maybeSingle())
      if (!row) return null
      const [commitments, siblings, raw] = await Promise.all([
        supabase.rpc('allocation_commitments', { p_allocation_ids: [row.id], p_exclude_amendment: null }),
        supabase.from('budget_allocations_view').select('id, expense_nature, source_code, authorized_amount').eq('action_id', row.action_id).eq('is_current', true).neq('id', row.id).limit(10),
        supabase.from('budget_allocations').select('raw_text, extraction_confidence').eq('id', row.id).maybeSingle(),
      ])
      return {
        row,
        commitments: (commitments.data as Array<{ firm_amount: string; pending_amount: string; amendments_count: number }> | null)?.[0] ?? null,
        siblings: (siblings.data ?? []) as Array<{ id: string; expense_nature: string; source_code: string; authorized_amount: string }>,
        raw: raw.data as { raw_text: string | null; extraction_confidence: string | null } | null,
      }
    },
  })

  const drafts = useQuery({
    queryKey: ['office-drafts', ws.office?.id, ws.fiscalYear?.id],
    enabled: Boolean(allocationId && ws.office && ws.fiscalYear),
    queryFn: async () =>
      unwrap<Array<{ id: string; title: string }>>(
        await supabase.from('amendments').select('id, title').eq('office_id', ws.office!.id).eq('fiscal_year_id', ws.fiscalYear!.id).in('status', ['draft', 'needs_correction']).order('updated_at', { ascending: false }),
      ),
  })

  const d = detail.data
  return (
    <Sheet open={Boolean(allocationId)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Detalhe da dotação</SheetTitle>
          <SheetDescription>Classificação completa conforme os dados estruturados do orçamento.</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-6">
          {detail.error ? (
            <ErrorState error={detail.error} />
          ) : detail.isLoading ? (
            <Skeleton className="h-96" />
          ) : !d ? (
            <p className="text-sm text-muted-foreground">Dotação não encontrada.</p>
          ) : (
            <div className="space-y-5">
              <div>
                <p className="font-mono text-sm">{d.row.programmatic_code}</p>
                <p className="mt-1 text-base font-medium">{d.row.action_name}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <VerificationBadge status={d.row.verification_status} />
                  {d.row.is_demo && <DemoBadge />}
                  {!d.row.is_current && <span className="text-xs text-danger">Versão substituída</span>}
                </div>
              </div>
              <dl className="divide-y">
                <Row label="Exercício" value={d.row.fiscal_year} />
                <Row label="Órgão" value={`${d.row.agency_code} — ${d.row.agency_name}`} />
                <Row label="Unidade" value={`${d.row.unit_code} — ${d.row.unit_name}`} />
                <Row label="Função" value={`${d.row.function_code} — ${d.row.function_name ?? 'não catalogada'}`} />
                <Row label="Subfunção" value={`${d.row.subfunction_code} — ${d.row.subfunction_name ?? 'não catalogada'}`} />
                <Row label="Programa" value={`${d.row.program_code} — ${d.row.program_name}`} />
                <Row label="Referência PPA" value={d.row.ppa_reference ?? <span className="text-warning">não conferida</span>} />
                <Row label="Ação" value={`${d.row.action_code} — ${d.row.action_name} (${actionKindLabels[d.row.action_kind as keyof typeof actionKindLabels] ?? d.row.action_kind})`} />
                <Row label="Natureza" value={d.row.expense_nature} mono />
                <Row label="Modalidade" value={`${d.row.modality_code} — ${d.row.modality_name ?? 'não catalogada'}`} />
                <Row label="Elemento" value={`${d.row.element_code} — ${d.row.element_name ?? 'não catalogado'}`} />
                <Row label="Fonte" value={`${d.row.source_code} — ${d.row.source_name}${d.row.source_is_earmarked ? ' (vinculada)' : d.row.source_is_earmarked === false ? ' (não vinculada)' : ' (vinculação não informada)'}`} />
                {d.row.allocation_code && <Row label="Código reduzido" value={d.row.allocation_code} mono />}
                {d.row.description && <Row label="Descrição" value={d.row.description} />}
                <Row label="Valor autorizado" value={<strong className="tabular">{money(d.row.authorized_amount)}</strong>} />
                <Row
                  label="Saldo disponível"
                  value={d.row.available_amount ? `${money(d.row.available_amount)} em ${formatDate(d.row.available_as_of)} (${d.row.available_source ?? 'fonte não informada'})` : <span className="text-muted-foreground">Não informado por fonte oficial</span>}
                />
                <Row
                  label="Em outras emendas"
                  value={d.commitments ? `${money(Number(d.commitments.firm_amount) + Number(d.commitments.pending_amount))} em ${d.commitments.amendments_count} emenda(s)` : 'Nenhuma indicação'}
                />
                <Row
                  label="Origem documental"
                  value={
                    d.row.source_document_id ? (
                      <Link to={`/base/${d.row.source_document_id}`} className="inline-flex items-center gap-1 text-brand hover:underline">
                        {d.row.source_document_title}
                        {d.row.source_page ? `, p. ${d.row.source_page}` : ''} <ExternalLink className="size-3" />
                      </Link>
                    ) : (
                      d.row.source_reference ?? '—'
                    )
                  }
                />
                {isContingencyReserve(d.row.expense_nature) && (
                  <Row
                    label="Reserva para emendas"
                    value={
                      <label className="flex items-start gap-2">
                        <Switch
                          checked={d.row.extra_identifiers?.['reserva_emendas'] === true}
                          disabled={!canFlagReserve || reserveFlag.isPending}
                          onCheckedChange={(v) => reserveFlag.mutate({ id: d.row.id, extra: d.row.extra_identifiers ?? {}, value: v })}
                        />
                        <span className="text-xs text-muted-foreground">
                          Reserva destinada às emendas parlamentares (cota-parte). Somente reservas assim identificadas podem ser anuladas quando a regra de despesas protegidas exige marcação.
                          {!canFlagReserve && ' Alteração restrita a administradores e revisores.'}
                        </span>
                      </label>
                    }
                  />
                )}
                {d.raw?.extraction_confidence && <Row label="Confiança da extração" value={`${Math.round(Number(d.raw.extraction_confidence) * 100)}%`} />}
              </dl>
              {d.raw?.raw_text && (
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">Texto original extraído</p>
                  <pre className="max-h-32 overflow-auto rounded-md bg-muted p-2 text-[11px] whitespace-pre-wrap">{d.raw.raw_text}</pre>
                </div>
              )}
              {d.siblings.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">Outras dotações da mesma ação</p>
                  <ul className="space-y-1 text-xs">
                    {d.siblings.map((s) => (
                      <li key={s.id} className="flex gap-2">
                        <span className="font-mono">{s.expense_nature}</span>
                        <span className="text-muted-foreground">Fonte {s.source_code}</span>
                        <span className="ml-auto tabular">{money(s.authorized_amount)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <Separator />
              {ws.office ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Usar em emenda</p>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <NativeSelect value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Emenda de destino">
                      <option value="">Nova emenda</option>
                      {drafts.data?.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.title}
                        </option>
                      ))}
                    </NativeSelect>
                    <Button onClick={() => onUse(d.row.id, target || null)} className="shrink-0">
                      <FilePlus2 /> Usar como destino
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Integre um gabinete para utilizar dotações em emendas.</p>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
