import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, ArrowUp, CalendarClock, FileSignature, FileText, Gavel, Info, Library, MessagesSquare, ScrollText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { AmendmentStatusBadge } from '@/components/common/badges'
import { ErrorState } from '@/components/common/states'
import { PageContainer } from '@/components/layout/app-shell'
import { amendmentStatusLabels, type AmendmentStatus } from '@shared/domain/amendments/status'
import { fiscalPhaseLabels } from '@shared/domain/labels'
import { supabase, unwrap } from '@/lib/supabase'
import { formatDate, money, timeAgo } from '@/lib/format'
import { useAuth } from '@/providers/auth'
import { useRequiredWorkspace } from '@/providers/workspace'
import { cn } from '@/lib/utils'

const suggestions = [
  'Quero criar uma emenda parlamentar.',
  'Preciso consultar uma dotação orçamentária.',
  'Quero analisar um projeto de lei.',
  'Preciso elaborar um requerimento.',
]

interface Summary {
  amendments_total: number
  amendments_draft: number
  amendments_in_review: number
  amendments_ready: number
  amendments_filed: number
  amendments_stale_validation: number
  amount_total: string
  reviews_pending: number | null
  documents_processed: number
  documents_processing: number
  documents_needing_review: number
  allocations_pending_review: number
  allocations_total: number
  active_rules: number
}

function greeting() {
  const hour = new Date().getHours()
  return hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite'
}

function Metric({ label, value, hint, loading, to }: { label: string; value: React.ReactNode; hint?: string; loading?: boolean; to?: string }) {
  const content = (
    <div className="flex h-full flex-col rounded-lg border bg-card p-4 transition-colors hover:border-brand/30">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {loading ? <Skeleton className="mt-2 h-7 w-16" /> : <span className="mt-1.5 text-2xl font-semibold tracking-tight tabular">{value}</span>}
      {hint && <span className="mt-auto pt-2 text-xs text-muted-foreground">{hint}</span>}
    </div>
  )
  return to ? (
    <Link to={to} className="rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
      {content}
    </Link>
  ) : (
    content
  )
}

export function DashboardPage() {
  const { profile, user } = useAuth()
  const ws = useRequiredWorkspace()
  const navigate = useNavigate()
  const [prompt, setPrompt] = useState('')

  const summary = useQuery({
    queryKey: ['dashboard-summary', ws.organization.id, ws.office?.id, ws.fiscalYear?.id],
    queryFn: async () =>
      unwrap<Summary>(
        await supabase.rpc('dashboard_summary', { p_org: ws.organization.id, p_office: ws.office?.id ?? null, p_fiscal_year: ws.fiscalYear?.id ?? null }),
      ),
  })

  const activity = useQuery({
    queryKey: ['dashboard-activity', ws.organization.id, ws.office?.id],
    queryFn: async () => {
      const [history, docs, conversations] = await Promise.all([
        supabase
          .from('amendment_status_history')
          .select('id, amendment_id, from_status, to_status, created_at, amendment:amendments(title)')
          .eq('organization_id', ws.organization.id)
          .order('created_at', { ascending: false })
          .limit(6),
        supabase
          .from('document_versions')
          .select('id, document_id, file_name, processing_status, processed_at, created_at, document:documents!document_versions_document_id_organization_id_fkey(title)')
          .eq('organization_id', ws.organization.id)
          .order('created_at', { ascending: false })
          .limit(4),
        supabase.from('ai_conversations').select('id, title, updated_at').eq('organization_id', ws.organization.id).eq('user_id', user!.id).order('updated_at', { ascending: false }).limit(4),
      ])
      type Item = { id: string; at: string; icon: React.ComponentType<{ className?: string }>; text: string; to: string }
      const items: Item[] = [
        ...unwrap<Array<{ id: number; amendment_id: string; to_status: AmendmentStatus; created_at: string; amendment: { title: string } | null }>>(history).map((h) => ({
          id: `h${h.id}`,
          at: h.created_at,
          icon: FileSignature,
          text: `“${h.amendment?.title ?? 'Emenda'}” → ${amendmentStatusLabels[h.to_status]}`,
          to: `/emendas/${h.amendment_id}`,
        })),
        ...unwrap<Array<{ id: string; document_id: string; file_name: string; created_at: string; document: { title: string } | null }>>(docs).map((d) => ({
          id: `d${d.id}`,
          at: d.created_at,
          icon: Library,
          text: `Documento enviado: ${d.document?.title ?? d.file_name}`,
          to: `/base/${d.document_id}`,
        })),
        ...unwrap<Array<{ id: string; title: string; updated_at: string }>>(conversations).map((c) => ({
          id: `c${c.id}`,
          at: c.updated_at,
          icon: MessagesSquare,
          text: `Conversa: ${c.title}`,
          to: `/assistente/${c.id}`,
        })),
      ]
      return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8)
    },
  })

  const recent = useQuery({
    queryKey: ['dashboard-recent-amendments', ws.office?.id, ws.fiscalYear?.id],
    enabled: Boolean(ws.office),
    queryFn: async () =>
      unwrap<Array<{ id: string; title: string; status: AmendmentStatus; total_amount: string; updated_at: string }>>(
        await supabase.from('amendments').select('id, title, status, total_amount, updated_at').eq('office_id', ws.office!.id).order('updated_at', { ascending: false }).limit(5),
      ),
  })

  const s = summary.data
  const alerts: Array<{ tone: 'warning' | 'info'; text: string; to?: string }> = []
  if (!ws.fiscalYear) alerts.push({ tone: 'warning', text: 'Nenhum exercício orçamentário cadastrado. A administração precisa cadastrar e ativar um exercício.', to: '/admin/exercicios' })
  if (s) {
    if (s.active_rules === 0) alerts.push({ tone: 'warning', text: 'Nenhuma regra normativa ativa: emendas não podem ser validadas tecnicamente.', to: ws.isOrgAdmin ? '/admin/regras' : undefined })
    if (s.allocations_total === 0 && ws.fiscalYear) alerts.push({ tone: 'warning', text: `Sem dotações estruturadas para ${ws.fiscalYear.year}. Importe a LOA/PLOA na Base Legislativa.`, to: '/base' })
    if (s.allocations_pending_review > 0) alerts.push({ tone: 'info', text: `${s.allocations_pending_review} dotação(ões) extraída(s) aguardam conferência humana.`, to: '/base/conferencia' })
    if (s.documents_needing_review > 0) alerts.push({ tone: 'info', text: `${s.documents_needing_review} documento(s) processado(s) com itens para conferência.`, to: '/base' })
    if (s.amendments_stale_validation > 0) alerts.push({ tone: 'info', text: `${s.amendments_stale_validation} emenda(s) alterada(s) após a última validação.`, to: '/emendas' })
  }
  if (ws.fiscalYear?.amendment_deadline) {
    const days = Math.ceil((new Date(`${ws.fiscalYear.amendment_deadline}T23:59:59`).getTime() - Date.now()) / 86_400_000)
    if (days >= 0 && days <= 20) alerts.push({ tone: 'warning', text: `Prazo de apresentação de emendas em ${days} dia(s) (${formatDate(ws.fiscalYear.amendment_deadline)}).` })
  }

  const start = (text: string) => {
    if (!text.trim()) return
    navigate('/assistente', { state: { prompt: text.trim() } })
  }

  const firstName = (profile?.display_name || profile?.full_name || '').split(' ')[0]

  return (
    <PageContainer>
      <div className="mb-8 flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">
          {ws.organization.name}
          {ws.office ? ` · ${ws.office.name}` : ''}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[1.7rem]">
          {greeting()}
          {firstName ? `, ${firstName}` : ''}.
        </h1>
        {ws.fiscalYear && (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <CalendarClock className="size-3.5" />
            Exercício {ws.fiscalYear.year} · {fiscalPhaseLabels[ws.fiscalYear.phase]}
            {ws.fiscalYear.amendment_deadline && ` · prazo de emendas ${formatDate(ws.fiscalYear.amendment_deadline)}`}
          </p>
        )}
      </div>

      <Card className="mb-8 overflow-hidden border-brand/20 shadow-sm">
        <CardContent className="p-5 sm:p-6">
          <label htmlFor="today-prompt" className="text-base font-semibold">
            O que você deseja fazer hoje?
          </label>
          <form
            className="relative mt-3"
            onSubmit={(e) => {
              e.preventDefault()
              start(prompt)
            }}
          >
            <Textarea
              id="today-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  start(prompt)
                }
              }}
              placeholder="Ex.: Quero destinar R$ 150 mil para uma ONG desenvolver atividades esportivas para crianças e adolescentes."
              className="min-h-24 resize-none pr-14 text-[15px]"
            />
            <Button type="submit" size="icon" className="absolute right-3 bottom-3" disabled={!prompt.trim()} aria-label="Enviar ao assistente">
              <ArrowUp />
            </Button>
          </form>
          <div className="mt-3 flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => start(s)}
                className="rounded-full border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-brand/40 hover:bg-brand-soft hover:text-foreground"
              >
                {s}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {summary.error ? (
        <ErrorState error={summary.error} onRetry={() => summary.refetch()} className="mb-8" />
      ) : (
        <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Metric label="Emendas criadas" value={s?.amendments_total ?? 0} hint={s ? `${money(s.amount_total)} no total` : undefined} loading={summary.isLoading} to="/emendas" />
          <Metric label="Em elaboração" value={s?.amendments_draft ?? 0} hint="Rascunhos e correções" loading={summary.isLoading} to="/emendas?status=draft" />
          <Metric
            label={s?.reviews_pending !== null && s?.reviews_pending !== undefined ? 'Aguardando sua revisão' : 'Pendentes de revisão'}
            value={s?.reviews_pending ?? s?.amendments_in_review ?? 0}
            hint={s ? `${s.amendments_ready} pronta(s) para assinatura` : undefined}
            loading={summary.isLoading}
            to="/emendas?status=in_review"
          />
          <Metric label="Documentos processados" value={s?.documents_processed ?? 0} hint={s?.documents_processing ? `${s.documents_processing} em processamento` : 'Base Legislativa'} loading={summary.isLoading} to="/base" />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader className="flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm">Emendas recentes do gabinete</CardTitle>
              <Button asChild variant="ghost" size="sm">
                <Link to="/emendas">
                  Ver todas <ArrowRight />
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="pt-0">
              {!ws.office ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Você não integra um gabinete nesta instituição.</p>
              ) : recent.isLoading ? (
                <div className="space-y-2">
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-11" />
                  ))}
                </div>
              ) : (recent.data ?? []).length === 0 ? (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  Nenhuma emenda ainda.{' '}
                  <Link to="/emendas/nova" className="font-medium text-brand hover:underline">
                    Criar a primeira
                  </Link>
                </div>
              ) : (
                <ul className="divide-y">
                  {recent.data!.map((a) => (
                    <li key={a.id}>
                      <Link to={`/emendas/${a.id}`} className="flex items-center gap-3 py-2.5 hover:text-brand">
                        <FileText className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate text-sm">{a.title}</span>
                        <span className="hidden text-xs text-muted-foreground tabular sm:inline">{money(a.total_amount)}</span>
                        <AmendmentStatusBadge status={a.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Histórico de atividades</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {activity.isLoading ? (
                <div className="space-y-2">
                  {[0, 1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-8" />
                  ))}
                </div>
              ) : (activity.data ?? []).length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Sem atividades recentes.</p>
              ) : (
                <ul className="space-y-1">
                  {activity.data!.map((item) => (
                    <li key={item.id}>
                      <Link to={item.to} className="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
                        <item.icon className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate">{item.text}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(item.at)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Alertas de legislação e orçamento</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {summary.isLoading ? (
                <Skeleton className="h-20" />
              ) : alerts.length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground">Nenhum alerta no momento.</p>
              ) : (
                <ul className="space-y-2">
                  {alerts.map((alert, i) => {
                    const Icon = alert.tone === 'warning' ? AlertTriangle : Info
                    const body = (
                      <span className={cn('flex gap-2.5 rounded-md border p-3 text-sm', alert.tone === 'warning' ? 'border-warning/30 bg-warning-soft' : 'bg-muted/50')}>
                        <Icon className={cn('mt-0.5 size-4 shrink-0', alert.tone === 'warning' ? 'text-warning' : 'text-brand')} />
                        <span>{alert.text}</span>
                      </span>
                    )
                    return <li key={i}>{alert.to ? <Link to={alert.to}>{body}</Link> : body}</li>
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Atalhos</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 pt-0">
              {[
                { to: '/emendas/nova', icon: FileSignature, label: 'Nova emenda manual' },
                { to: '/orcamento', icon: ScrollText, label: 'Explorar dotações' },
                { to: '/base', icon: Library, label: 'Consultar a Base Legislativa' },
                { to: '/consultor', icon: Gavel, label: 'Consultor jurídico' },
              ].map((a) => (
                <Link key={a.to} to={a.to} className="flex items-center gap-3 rounded-md border px-3 py-2.5 text-sm transition-colors hover:border-brand/30 hover:bg-accent">
                  <a.icon className="size-4 text-muted-foreground" />
                  <span className="flex-1">{a.label}</span>
                  <ArrowRight className="size-3.5 text-muted-foreground" />
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </PageContainer>
  )
}
