import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ClipboardCheck, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { DemoBadge, Pill } from '@/components/common/badges'
import { NativeSelect } from '@/components/common/form'
import { PageHeader } from '@/components/common/page-header'
import { EmptyState, ErrorState, LoadingRows } from '@/components/common/states'
import { PageContainer } from '@/components/layout/app-shell'
import { Forbidden } from '@/features/auth/guards'
import { centsToDecimal } from '@shared/domain/money'
import { parseExpenseNature } from '@shared/domain/budget/codes'
import { supabase, unwrap } from '@/lib/supabase'
import { centsToInput, money, parseMoneyInput, toCents } from '@/lib/format'
import { useRequiredWorkspace } from '@/providers/workspace'

interface PendingRow {
  id: string
  programmatic_code: string
  action_name: string
  expense_nature: string
  source_code: string
  authorized_amount: string
  source_page: number | null
  source_document_title: string | null
  source_version_id: string | null
  is_demo: boolean
}

function EditableRow({ row, selected, onToggle, onSaved }: { row: PendingRow & { raw_text?: string | null; extraction_confidence?: string | null }; selected: boolean; onToggle: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState(centsToInput(toCents(row.authorized_amount)))
  const [nature, setNature] = useState(row.expense_nature)
  const [busy, setBusy] = useState(false)
  const save = async (status: 'confirmed' | 'rejected') => {
    const cents = parseMoneyInput(amount)
    const parsedNature = parseExpenseNature(nature)
    if (status === 'confirmed' && (!cents || !parsedNature)) {
      toast.error('Corrija o valor ou a natureza antes de confirmar.')
      return
    }
    setBusy(true)
    const patch: Record<string, unknown> = { verification_status: status }
    if (status === 'confirmed') {
      patch.authorized_amount = centsToDecimal(cents!)
      patch.expense_nature = parsedNature!.code
    }
    const { error } = await supabase.from('budget_allocations').update(patch).eq('id', row.id)
    setBusy(false)
    if (error) toast.error(error.message)
    else onSaved()
  }
  return (
    <li className="grid gap-3 p-3 lg:grid-cols-[auto_1fr_auto]">
      <Checkbox checked={selected} onCheckedChange={onToggle} aria-label="Selecionar" className="mt-1" />
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs">{row.programmatic_code}</span>
          <span className="text-xs text-muted-foreground">Fonte {row.source_code}</span>
          {row.extraction_confidence && <Pill tone={Number(row.extraction_confidence) < 0.8 ? 'warning' : 'neutral'}>confiança {Math.round(Number(row.extraction_confidence) * 100)}%</Pill>}
          {row.is_demo && <DemoBadge />}
        </div>
        <p className="text-sm">{row.action_name}</p>
        <p className="text-xs text-muted-foreground">
          {row.source_document_title ?? 'Origem não vinculada'}
          {row.source_page ? `, p. ${row.source_page}` : ''}
        </p>
        {row.raw_text && <pre className="max-h-20 overflow-auto rounded bg-muted p-2 text-[11px] whitespace-pre-wrap">{row.raw_text}</pre>}
      </div>
      <div className="flex flex-wrap items-end gap-2 lg:flex-col lg:items-end">
        <div className="flex gap-2">
          <Input value={nature} onChange={(e) => setNature(e.target.value)} className="h-8 w-28 font-mono text-xs" aria-label="Natureza" />
          <Input value={amount} onChange={(e) => setAmount(e.target.value)} className="h-8 w-32 text-right text-sm tabular" aria-label="Valor" />
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" onClick={() => void save('rejected')} disabled={busy}>
            <X /> Rejeitar
          </Button>
          <Button size="sm" onClick={() => void save('confirmed')} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Check />} Confirmar
          </Button>
        </div>
      </div>
    </li>
  )
}

/** Conferência humana de dotações extraídas automaticamente (nunca tratadas como confirmadas sem revisão). */
export function ReviewQueuePage() {
  const ws = useRequiredWorkspace()
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const versionFilter = params.get('versao')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const queue = useQuery({
    queryKey: ['review-queue', ws.fiscalYear?.id, versionFilter],
    enabled: Boolean(ws.fiscalYear),
    queryFn: async () => {
      let q = supabase
        .from('budget_allocations_view')
        .select('id, programmatic_code, action_name, expense_nature, source_code, authorized_amount, source_page, source_document_title, source_version_id, is_demo')
        .eq('fiscal_year_id', ws.fiscalYear!.id)
        .eq('verification_status', 'pending_review')
        .eq('is_current', true)
        .order('programmatic_code')
        .limit(200)
      if (versionFilter) q = q.eq('source_version_id', versionFilter)
      const rows = unwrap<PendingRow[]>(await q)
      const extra = rows.length
        ? unwrap<Array<{ id: string; raw_text: string | null; extraction_confidence: string | null }>>(
            await supabase.from('budget_allocations').select('id, raw_text, extraction_confidence').in('id', rows.map((r) => r.id)),
          )
        : []
      const byId = new Map(extra.map((e) => [e.id, e]))
      return rows.map((r) => ({ ...r, ...byId.get(r.id) }))
    },
  })

  const sources = useQuery({
    queryKey: ['sources-earmark', ws.fiscalYear?.id],
    enabled: Boolean(ws.fiscalYear),
    queryFn: async () =>
      unwrap<Array<{ id: string; code: string; name: string; is_earmarked: boolean | null; verification_status: string }>>(
        await supabase.from('budget_sources').select('id, code, name, is_earmarked, verification_status').eq('fiscal_year_id', ws.fiscalYear!.id).order('code'),
      ),
  })

  const bulk = useMutation({
    mutationFn: async () => unwrap(await supabase.from('budget_allocations').update({ verification_status: 'confirmed' }).in('id', [...selected])),
    onSuccess: () => {
      toast.success(`${selected.size} dotação(ões) confirmada(s).`)
      setSelected(new Set())
      void queryClient.invalidateQueries({ queryKey: ['review-queue'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const setEarmark = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: string }) =>
      unwrap(await supabase.from('budget_sources').update({ is_earmarked: value === '' ? null : value === 'true', verification_status: value === '' ? 'pending_review' : 'confirmed' }).eq('id', id)),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['sources-earmark'] }),
    onError: (e: Error) => toast.error(e.message),
  })

  if (!ws.isOrgAdmin && !ws.isReviewer) return <Forbidden message="A conferência de dotações é feita por administradores e revisores." />

  const rows = queue.data ?? []
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  return (
    <PageContainer wide>
      <PageHeader
        title="Conferência de dotações"
        description="Dotações extraídas automaticamente permanecem pendentes até a confirmação humana. Somente dotações conferidas permitem validação técnica de emendas."
        actions={
          selected.size > 0 && (
            <Button onClick={() => bulk.mutate()} disabled={bulk.isPending}>
              {bulk.isPending && <Loader2 className="animate-spin" />} Confirmar {selected.size} selecionada(s)
            </Button>
          )
        }
      />
      {versionFilter && (
        <p className="mb-4 flex items-center gap-2 text-sm">
          Filtrando por versão de documento.{' '}
          <button type="button" className="text-brand hover:underline" onClick={() => setParams({}, { replace: true })}>
            Ver todas
          </button>
        </p>
      )}
      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <div>
          {queue.error ? (
            <ErrorState error={queue.error} onRetry={() => queue.refetch()} />
          ) : queue.isLoading ? (
            <LoadingRows rows={6} />
          ) : rows.length === 0 ? (
            <EmptyState icon={ClipboardCheck} title="Nenhuma dotação pendente" description="Todas as dotações deste exercício foram conferidas." />
          ) : (
            <>
              <div className="mb-2 flex items-center gap-2 text-sm">
                <Checkbox checked={selected.size === rows.length} onCheckedChange={(v) => setSelected(v ? new Set(rows.map((r) => r.id)) : new Set())} aria-label="Selecionar todas" />
                <span className="text-muted-foreground">
                  {rows.length} pendente(s) · {money(rows.reduce((s, r) => s + Number(r.authorized_amount), 0))}
                </span>
              </div>
              <ul className="divide-y rounded-lg border">
                {rows.map((row) => (
                  <EditableRow key={row.id} row={row} selected={selected.has(row.id)} onToggle={() => toggle(row.id)} onSaved={() => void queryClient.invalidateQueries({ queryKey: ['review-queue'] })} />
                ))}
              </ul>
            </>
          )}
        </div>
        <Card className="h-fit">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Vinculação das fontes</CardTitle>
            <p className="text-xs text-muted-foreground">Necessária para verificar a compatibilidade de fontes nas anulações.</p>
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="space-y-2">
              {(sources.data ?? []).map((s) => (
                <li key={s.id} className="space-y-1">
                  <p className="text-xs">
                    <span className="font-mono">{s.code}</span> — {s.name}
                  </p>
                  <NativeSelect
                    value={s.is_earmarked === null ? '' : String(s.is_earmarked)}
                    onChange={(e) => setEarmark.mutate({ id: s.id, value: e.target.value })}
                    className="h-8 text-xs"
                    aria-label={`Vinculação da fonte ${s.code}`}
                  >
                    <option value="">Não informado</option>
                    <option value="false">Não vinculada (livre)</option>
                    <option value="true">Vinculada</option>
                  </NativeSelect>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}
