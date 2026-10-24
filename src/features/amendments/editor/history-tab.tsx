import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { GitCompare, History, Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { AmendmentStatusBadge } from '@/components/common/badges'
import { EmptyState, ErrorState } from '@/components/common/states'
import { amendmentStatusLabels, type AmendmentStatus } from '@shared/domain/amendments/status'
import { supabase, unwrap } from '@/lib/supabase'
import { formatDateTime, money } from '@/lib/format'
import { cn } from '@/lib/utils'
import { amendmentKeys, type AmendmentDetail } from '../hooks'

interface VersionRow {
  id: string
  version_number: number
  amendment_revision: number
  status: AmendmentStatus
  snapshot: Snapshot
  change_summary: string | null
  created_by: string | null
  created_at: string
}

interface Snapshot {
  amendment: Record<string, unknown>
  destinations: Array<{ amount: string; allocation: { programmatic_code?: string; expense_nature?: string } | null }>
  cancellations: Array<{ amount: string; approved: boolean; allocation: { programmatic_code?: string; expense_nature?: string } | null }>
}

const fieldLabels: Record<string, string> = {
  title: 'Título',
  object: 'Objeto',
  purpose: 'Finalidade',
  justification: 'Justificativa',
  legal_grounds: 'Fundamentação',
  beneficiary_name: 'Beneficiário',
  beneficiary_cnpj: 'CNPJ',
  total_amount: 'Valor total',
  status: 'Status',
}

function lines(snapshot: Snapshot, key: 'destinations' | 'cancellations') {
  return snapshot[key].map((l) => `${l.allocation?.programmatic_code ?? 'nova programação'} ${l.allocation?.expense_nature ?? ''} — ${money(l.amount)}`).join('\n') || '—'
}

function compare(a: Snapshot, b: Snapshot) {
  const diffs: Array<{ field: string; before: string; after: string }> = []
  for (const [field, label] of Object.entries(fieldLabels)) {
    const before = String(a.amendment[field] ?? '—')
    const after = String(b.amendment[field] ?? '—')
    if (before !== after) diffs.push({ field: label, before: field === 'total_amount' ? money(before) : before, after: field === 'total_amount' ? money(after) : after })
  }
  for (const key of ['destinations', 'cancellations'] as const) {
    const before = lines(a, key)
    const after = lines(b, key)
    if (before !== after) diffs.push({ field: key === 'destinations' ? 'Destinações' : 'Anulações', before, after })
  }
  return diffs
}

export function HistoryTab({ amendment, canSaveVersion }: { amendment: AmendmentDetail; canSaveVersion: boolean }) {
  const queryClient = useQueryClient()
  const [summary, setSummary] = useState('')
  const [selected, setSelected] = useState<string[]>([])

  const history = useQuery({
    queryKey: amendmentKeys.history(amendment.id),
    queryFn: async () => {
      const [versions, statuses] = await Promise.all([
        supabase.from('amendment_versions').select('*').eq('amendment_id', amendment.id).order('version_number', { ascending: false }),
        supabase.from('amendment_status_history').select('*').eq('amendment_id', amendment.id).order('created_at', { ascending: false }),
      ])
      return {
        versions: unwrap<VersionRow[]>(versions),
        statuses: unwrap<Array<{ id: number; from_status: AmendmentStatus | null; to_status: AmendmentStatus; reason: string | null; created_at: string }>>(statuses),
      }
    },
  })

  const save = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('save_amendment_version', { p_amendment: amendment.id, p_summary: summary.trim() || null })),
    onSuccess: () => {
      toast.success('Versão salva.')
      setSummary('')
      void queryClient.invalidateQueries({ queryKey: amendmentKeys.history(amendment.id) })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const diff = useMemo(() => {
    if (selected.length !== 2 || !history.data) return null
    const [a, b] = selected
      .map((id) => history.data!.versions.find((v) => v.id === id)!)
      .sort((x, y) => x.version_number - y.version_number)
    return { from: a!, to: b!, changes: compare(a!.snapshot, b!.snapshot) }
  }, [selected, history.data])

  if (history.error) return <ErrorState error={history.error} onRetry={() => history.refetch()} />
  if (history.isLoading) return <Skeleton className="h-64" />

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s.slice(-1), id]))

  return (
    <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
      <div className="space-y-6">
        {canSaveVersion && (
          <Card>
            <CardContent className="flex flex-col gap-2 p-4 sm:flex-row">
              <Input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Resumo das alterações desta versão (opcional)" maxLength={300} />
              <Button onClick={() => save.mutate()} disabled={save.isPending} className="shrink-0">
                {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} Salvar versão
              </Button>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <GitCompare className="size-4" /> Versões
            </CardTitle>
            <p className="text-xs text-muted-foreground">Selecione duas versões para comparar. Versões são criadas automaticamente na tramitação.</p>
          </CardHeader>
          <CardContent className="pt-0">
            {history.data!.versions.length === 0 ? (
              <EmptyState title="Nenhuma versão registrada" />
            ) : (
              <ul className="divide-y rounded-md border">
                {history.data!.versions.map((v) => (
                  <li key={v.id}>
                    <label className={cn('flex cursor-pointer items-center gap-3 p-3 hover:bg-accent', selected.includes(v.id) && 'bg-brand-soft')}>
                      <input type="checkbox" checked={selected.includes(v.id)} onChange={() => toggle(v.id)} className="size-4 accent-[var(--brand)]" />
                      <span className="w-10 font-mono text-xs">v{v.version_number}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{v.change_summary ?? 'Versão'}</span>
                        <span className="text-xs text-muted-foreground">
                          revisão {v.amendment_revision} · {formatDateTime(v.created_at)}
                        </span>
                      </span>
                      <AmendmentStatusBadge status={v.status} />
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        {diff && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                Comparação v{diff.from.version_number} → v{diff.to.version_number}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {diff.changes.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sem diferenças nos campos principais.</p>
              ) : (
                <div className="space-y-3">
                  {diff.changes.map((c) => (
                    <div key={c.field} className="rounded-md border">
                      <p className="border-b bg-muted/50 px-3 py-1.5 text-xs font-medium">{c.field}</p>
                      <div className="grid text-xs sm:grid-cols-2">
                        <pre className="max-h-48 overflow-auto bg-danger-soft/50 p-3 font-sans whitespace-pre-wrap">{c.before}</pre>
                        <pre className="max-h-48 overflow-auto bg-success-soft/50 p-3 font-sans whitespace-pre-wrap">{c.after}</pre>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <History className="size-4" /> Tramitação
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {history.data!.statuses.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">Ainda em elaboração (rascunho).</p>
          ) : (
            <ol className="relative space-y-4 border-l pl-5">
              {history.data!.statuses.map((s) => (
                <li key={s.id} className="relative">
                  <span className="absolute top-1.5 -left-[25px] size-2.5 rounded-full border-2 border-background bg-brand" />
                  <p className="text-sm">
                    {s.from_status ? `${amendmentStatusLabels[s.from_status]} → ` : ''}
                    <strong>{amendmentStatusLabels[s.to_status]}</strong>
                  </p>
                  {s.reason && <p className="text-xs text-muted-foreground">“{s.reason}”</p>}
                  <p className="text-xs text-muted-foreground">{formatDateTime(s.created_at)}</p>
                </li>
              ))}
            </ol>
          )}
          {amendment.protocol_number && (
            <p className="mt-4 rounded-md bg-success-soft px-3 py-2 text-sm">
              Protocolo nº <strong>{amendment.protocol_number}</strong> registrado manualmente.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
