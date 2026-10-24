import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { FileSignature, Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AmendmentStatusBadge, OutcomeBadge } from '@/components/common/badges'
import { PageHeader } from '@/components/common/page-header'
import { EmptyState, ErrorState, LoadingRows } from '@/components/common/states'
import { PageContainer } from '@/components/layout/app-shell'
import { amendmentStatusLabels, type AmendmentStatus } from '@shared/domain/amendments/status'
import { supabase, unwrap } from '@/lib/supabase'
import { amendmentNumber, money, timeAgo } from '@/lib/format'
import { useRequiredWorkspace } from '@/providers/workspace'
import { amendmentKeys, type AmendmentListItem } from './hooks'

const statuses = Object.keys(amendmentStatusLabels) as AmendmentStatus[]

export function AmendmentsListPage() {
  const ws = useRequiredWorkspace()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState(params.get('q') ?? '')
  const status = params.get('status') ?? 'all'
  const scope = params.get('escopo') ?? (ws.office ? 'office' : 'all')

  const filters = { status, scope, q: params.get('q') ?? '', fy: ws.fiscalYear?.id ?? null, office: ws.office?.id ?? null }
  const query = useQuery({
    queryKey: amendmentKeys.list(ws.organization.id, filters),
    queryFn: async () => {
      let q = supabase
        .from('amendments')
        .select('id, title, sequence_number, status, total_amount, revision, validated_revision, validation_outcome, visibility, updated_at, office_id, office:offices(name), modality:amendment_modalities(name), fiscal_year:fiscal_years(year)')
        .eq('organization_id', ws.organization.id)
        .order('updated_at', { ascending: false })
        .limit(200)
      if (filters.fy) q = q.eq('fiscal_year_id', filters.fy)
      if (status !== 'all') q = status === 'draft' ? q.in('status', ['draft', 'needs_correction']) : q.eq('status', status)
      if (scope === 'office' && filters.office) q = q.eq('office_id', filters.office)
      if (filters.q) q = q.ilike('title', `%${filters.q.replace(/[%_]/g, '')}%`)
      return unwrap<AmendmentListItem[]>(await q)
    },
  })

  const update = (key: string, value: string | null) => {
    const next = new URLSearchParams(params)
    if (value && value !== 'all') next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  const totals = useMemo(() => {
    const list = query.data ?? []
    return { count: list.length, amount: list.reduce((s, a) => s + Number(a.total_amount), 0) }
  }, [query.data])

  return (
    <PageContainer wide>
      <PageHeader
        title="Emendas"
        description={`Biblioteca de emendas ${ws.fiscalYear ? `do exercício ${ws.fiscalYear.year}` : ''} visíveis para você: do seu gabinete, compartilhadas com a instituição e, para revisores, as enviadas para análise.`}
        actions={
          ws.office && (
            <Button asChild>
              <Link to="/emendas/nova">
                <Plus /> Nova emenda
              </Link>
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <form
          className="relative flex-1"
          onSubmit={(e) => {
            e.preventDefault()
            update('q', search.trim() || null)
          }}
        >
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Pesquisar por título" className="pl-9" aria-label="Pesquisar emendas" />
        </form>
        <Select value={status} onValueChange={(v) => update('status', v)}>
          <SelectTrigger className="sm:w-56" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            {statuses.map((s) => (
              <SelectItem key={s} value={s}>
                {amendmentStatusLabels[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {ws.office && (
          <Select value={scope} onValueChange={(v) => update('escopo', v)}>
            <SelectTrigger className="sm:w-52" aria-label="Escopo">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="office">Meu gabinete</SelectItem>
              <SelectItem value="all">Todas as visíveis</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>

      {query.error ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : query.isLoading ? (
        <LoadingRows rows={6} />
      ) : (query.data ?? []).length === 0 ? (
        <EmptyState
          icon={FileSignature}
          title="Nenhuma emenda encontrada"
          description={ws.office ? 'Crie uma emenda manualmente ou peça ao Assistente para elaborá-la a partir de uma descrição.' : 'Não há emendas visíveis para você com estes filtros.'}
          action={
            ws.office && (
              <div className="flex gap-2">
                <Button asChild variant="outline">
                  <Link to="/assistente">Usar o Assistente</Link>
                </Button>
                <Button asChild>
                  <Link to="/emendas/nova">Nova emenda</Link>
                </Button>
              </div>
            )
          }
        />
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="w-32">Número</TableHead>
                  <TableHead>Título</TableHead>
                  <TableHead className="hidden lg:table-cell">Gabinete</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Validação</TableHead>
                  <TableHead className="hidden xl:table-cell">Atualizada</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data!.map((a) => (
                  <TableRow key={a.id} className="cursor-pointer" onClick={() => navigate(`/emendas/${a.id}`)}>
                    <TableCell className="font-mono text-xs">{amendmentNumber(ws.settings?.amendment_number_prefix, a.fiscal_year?.year, a.sequence_number)}</TableCell>
                    <TableCell className="max-w-[28rem]">
                      <Link to={`/emendas/${a.id}`} className="block truncate font-medium hover:text-brand" onClick={(e) => e.stopPropagation()}>
                        {a.title}
                      </Link>
                      <span className="text-xs text-muted-foreground">{a.modality?.name}</span>
                    </TableCell>
                    <TableCell className="hidden max-w-56 truncate text-sm text-muted-foreground lg:table-cell">{a.office?.name}</TableCell>
                    <TableCell className="text-right tabular">{money(a.total_amount)}</TableCell>
                    <TableCell>
                      <AmendmentStatusBadge status={a.status} />
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <OutcomeBadge outcome={a.validation_outcome} stale={a.validation_outcome !== null && a.validated_revision !== a.revision} />
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground xl:table-cell">{timeAgo(a.updated_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {totals.count} emenda(s) · {money(totals.amount)}
          </p>
        </>
      )}
    </PageContainer>
  )
}
