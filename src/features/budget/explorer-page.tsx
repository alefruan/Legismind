import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Filter, Loader2, Sparkles, Wallet, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DemoBadge, Pill, VerificationBadge } from '@/components/common/badges'
import { Field, NativeSelect } from '@/components/common/form'
import { PageHeader } from '@/components/common/page-header'
import { EmptyState, ErrorState, LoadingRows } from '@/components/common/states'
import { PageContainer } from '@/components/layout/app-shell'
import { ALLOCATION_VIEW_COLUMNS, type BudgetAllocationViewRow } from '@shared/types/db'
import { apiFetch } from '@/lib/api'
import { supabase, unwrap } from '@/lib/supabase'
import { money, parseMoneyInput } from '@/lib/format'
import { useRequiredWorkspace } from '@/providers/workspace'
import { AllocationDetailSheet } from './allocation-detail'

const PAGE_SIZE = 25

interface Filters {
  q: string
  funcao: string
  subfuncao: string
  programa: string
  fonte: string
  modalidade: string
  grupo: string
  conferencia: string
  min: string
  max: string
}

const emptyFilters: Filters = { q: '', funcao: '', subfuncao: '', programa: '', fonte: '', modalidade: '', grupo: '', conferencia: '', min: '', max: '' }

interface NlResult {
  mode: 'llm' | 'heuristic'
  fiscalYear: { id: string; year: number }
  filters: { search_text: string | null; function_codes: string[]; subfunction_codes: string[]; modality_codes: string[]; group_codes: string[]; min_amount: number | null; only_confirmed: boolean; explanation: string }
  relaxed: boolean
  rows: BudgetAllocationViewRow[]
}

export function BudgetExplorerPage() {
  const ws = useRequiredWorkspace()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [draft, setDraft] = useState<Filters>(() => ({ ...emptyFilters, ...Object.fromEntries([...params.entries()].filter(([k]) => k in emptyFilters)) }))
  const [showFilters, setShowFilters] = useState(false)
  const [question, setQuestion] = useState('')
  const [nl, setNl] = useState<NlResult | null>(null)
  const page = Number(params.get('pagina') ?? '1')
  const selectedId = params.get('dotacao')

  const applied: Filters = useMemo(() => ({ ...emptyFilters, ...Object.fromEntries([...params.entries()].filter(([k]) => k in emptyFilters)) }), [params])

  const catalog = useQuery({
    queryKey: ['catalog-functions'],
    staleTime: Infinity,
    queryFn: async () => {
      const [fn, sf, mo] = await Promise.all([
        supabase.from('catalog_functions').select('code, name').order('code'),
        supabase.from('catalog_subfunctions').select('code, name, typical_function_code').order('code'),
        supabase.from('catalog_application_modalities').select('code, name').order('code'),
      ])
      return {
        functions: unwrap<Array<{ code: string; name: string }>>(fn),
        subfunctions: unwrap<Array<{ code: string; name: string; typical_function_code: string | null }>>(sf),
        modalities: unwrap<Array<{ code: string; name: string }>>(mo),
      }
    },
  })

  const sources = useQuery({
    queryKey: ['budget-sources', ws.fiscalYear?.id],
    enabled: Boolean(ws.fiscalYear),
    queryFn: async () => unwrap<Array<{ code: string; name: string }>>(await supabase.from('budget_sources').select('code, name').eq('fiscal_year_id', ws.fiscalYear!.id).order('code')),
  })

  const results = useQuery({
    queryKey: ['explorer', ws.fiscalYear?.id, applied, page],
    enabled: Boolean(ws.fiscalYear) && !nl,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let q = supabase.from('budget_allocations_view').select(ALLOCATION_VIEW_COLUMNS, { count: 'exact' }).eq('fiscal_year_id', ws.fiscalYear!.id).eq('is_current', true)
      if (applied.q.trim()) q = q.textSearch('search_tsv', applied.q.trim(), { type: 'websearch', config: 'pt_unaccent' })
      if (applied.funcao) q = q.eq('function_code', applied.funcao)
      if (applied.subfuncao) q = q.eq('subfunction_code', applied.subfuncao)
      if (applied.programa) q = q.eq('program_code', applied.programa)
      if (applied.fonte) q = q.eq('source_code', applied.fonte)
      if (applied.modalidade) q = q.eq('modality_code', applied.modalidade)
      if (applied.grupo) q = q.eq('group_code', applied.grupo)
      if (applied.conferencia) q = q.eq('verification_status', applied.conferencia)
      const min = applied.min ? parseMoneyInput(applied.min) : null
      const max = applied.max ? parseMoneyInput(applied.max) : null
      if (min) q = q.gte('authorized_amount', min / 100)
      if (max) q = q.lte('authorized_amount', max / 100)
      const from = (page - 1) * PAGE_SIZE
      const { data, error, count } = await q.order('authorized_amount', { ascending: false }).range(from, from + PAGE_SIZE - 1)
      if (error) throw new Error(error.message)
      return { rows: (data ?? []) as unknown as BudgetAllocationViewRow[], count: count ?? 0 }
    },
  })

  const ask = useMutation({
    mutationFn: () => apiFetch<NlResult>('/budget/query', { method: 'POST', json: { organizationId: ws.organization.id, fiscalYearId: ws.fiscalYear?.id ?? null, question } }),
    onSuccess: (data) => setNl(data),
    onError: (e: Error) => toast.error(e.message),
  })

  const apply = (next: Filters) => {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries(next)) if (v) p.set(k, v)
    if (selectedId) p.set('dotacao', selectedId)
    setParams(p, { replace: true })
    setNl(null)
  }

  const setPage = (n: number) => {
    const p = new URLSearchParams(params)
    p.set('pagina', String(n))
    setParams(p, { replace: true })
  }

  const openDetail = (id: string | null) => {
    const p = new URLSearchParams(params)
    if (id) p.set('dotacao', id)
    else p.delete('dotacao')
    setParams(p, { replace: true })
  }

  const rows = nl ? nl.rows : results.data?.rows ?? []
  const total = nl ? nl.rows.length : results.data?.count ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const activeCount = Object.entries(applied).filter(([k, v]) => v && k !== 'q').length

  if (!ws.fiscalYear) {
    return (
      <PageContainer>
        <PageHeader title="Explorador Orçamentário" />
        <EmptyState icon={Wallet} title="Nenhum exercício orçamentário" description="A administração precisa cadastrar um exercício e importar a LOA/PLOA." />
      </PageContainer>
    )
  }

  return (
    <PageContainer wide>
      <PageHeader
        title="Explorador Orçamentário"
        description={`Dotações estruturadas do exercício ${ws.fiscalYear.year}, com origem documental e situação de conferência. Consultas determinísticas sobre os dados oficiais carregados.`}
      />

      <Card className="mb-4">
        <CardContent className="p-4">
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault()
              if (question.trim().length >= 3) ask.mutate()
            }}
          >
            <div className="relative flex-1">
              <Sparkles className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-brand" />
              <Input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder={`Pergunte em linguagem natural — ex.: "Mostre programas relacionados a esportes e lazer no orçamento de ${ws.fiscalYear.year}."`}
                className="pl-9"
                aria-label="Busca em linguagem natural"
              />
            </div>
            <Button type="submit" disabled={ask.isPending || question.trim().length < 3}>
              {ask.isPending && <Loader2 className="animate-spin" />} Interpretar e buscar
            </Button>
          </form>
          {nl && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md bg-brand-soft px-3 py-2 text-xs">
              <Pill tone="info">{nl.mode === 'llm' ? 'Interpretado por IA' : 'Interpretação por palavras-chave'}</Pill>
              <span className="text-foreground">{nl.filters.explanation}</span>
              {nl.filters.function_codes.length > 0 && <span className="text-muted-foreground">Funções: {nl.filters.function_codes.join(', ')}</span>}
              {nl.filters.subfunction_codes.length > 0 && <span className="text-muted-foreground">Subfunções: {nl.filters.subfunction_codes.join(', ')}</span>}
              {nl.filters.search_text && <span className="text-muted-foreground">Termos: “{nl.filters.search_text}”</span>}
              <span className="text-muted-foreground">Exercício {nl.fiscalYear.year}</span>
              {nl.relaxed && <span className="text-warning">Filtro de subfunção removido por falta de resultados.</span>}
              <Button variant="ghost" size="xs" className="ml-auto" onClick={() => setNl(null)}>
                <X /> Limpar
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <form
        className="mb-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          apply(draft)
        }}
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input value={draft.q} onChange={(e) => setDraft({ ...draft, q: e.target.value })} placeholder="Palavra-chave (ação, programa, órgão, descrição)" className="flex-1" aria-label="Palavra-chave" />
          <Button type="button" variant="outline" onClick={() => setShowFilters((v) => !v)}>
            <Filter /> Filtros{activeCount ? ` (${activeCount})` : ''}
          </Button>
          <Button type="submit" variant="secondary">
            Buscar
          </Button>
        </div>
        {showFilters && (
          <Card>
            <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Função" htmlFor="f-funcao">
                <NativeSelect id="f-funcao" value={draft.funcao} onChange={(e) => setDraft({ ...draft, funcao: e.target.value, subfuncao: '' })}>
                  <option value="">Todas</option>
                  {catalog.data?.functions.map((f) => (
                    <option key={f.code} value={f.code}>
                      {f.code} — {f.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Subfunção" htmlFor="f-subfuncao">
                <NativeSelect id="f-subfuncao" value={draft.subfuncao} onChange={(e) => setDraft({ ...draft, subfuncao: e.target.value })}>
                  <option value="">Todas</option>
                  {catalog.data?.subfunctions
                    .filter((s) => !draft.funcao || s.typical_function_code === draft.funcao)
                    .map((s) => (
                      <option key={s.code} value={s.code}>
                        {s.code} — {s.name}
                      </option>
                    ))}
                </NativeSelect>
              </Field>
              <Field label="Programa (código)" htmlFor="f-programa">
                <Input id="f-programa" value={draft.programa} onChange={(e) => setDraft({ ...draft, programa: e.target.value.replace(/\D/g, '') })} placeholder="0005" />
              </Field>
              <Field label="Fonte" htmlFor="f-fonte">
                <NativeSelect id="f-fonte" value={draft.fonte} onChange={(e) => setDraft({ ...draft, fonte: e.target.value })}>
                  <option value="">Todas</option>
                  {sources.data?.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.code} — {s.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Modalidade de aplicação" htmlFor="f-mod">
                <NativeSelect id="f-mod" value={draft.modalidade} onChange={(e) => setDraft({ ...draft, modalidade: e.target.value })}>
                  <option value="">Todas</option>
                  {catalog.data?.modalities.map((m) => (
                    <option key={m.code} value={m.code}>
                      {m.code} — {m.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Grupo de natureza" htmlFor="f-grupo">
                <NativeSelect id="f-grupo" value={draft.grupo} onChange={(e) => setDraft({ ...draft, grupo: e.target.value })}>
                  <option value="">Todos</option>
                  <option value="1">1 — Pessoal e encargos</option>
                  <option value="2">2 — Juros e encargos da dívida</option>
                  <option value="3">3 — Outras despesas correntes</option>
                  <option value="4">4 — Investimentos</option>
                  <option value="5">5 — Inversões financeiras</option>
                  <option value="6">6 — Amortização da dívida</option>
                  <option value="9">9 — Reserva de contingência</option>
                </NativeSelect>
              </Field>
              <Field label="Conferência" htmlFor="f-conf">
                <NativeSelect id="f-conf" value={draft.conferencia} onChange={(e) => setDraft({ ...draft, conferencia: e.target.value })}>
                  <option value="">Todas</option>
                  <option value="confirmed">Conferidas</option>
                  <option value="pending_review">Pendentes de conferência</option>
                </NativeSelect>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Valor mínimo" htmlFor="f-min">
                  <Input id="f-min" value={draft.min} onChange={(e) => setDraft({ ...draft, min: e.target.value })} placeholder="100 mil" />
                </Field>
                <Field label="Valor máximo" htmlFor="f-max">
                  <Input id="f-max" value={draft.max} onChange={(e) => setDraft({ ...draft, max: e.target.value })} placeholder="1 milhão" />
                </Field>
              </div>
              <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
                <Button type="submit">Aplicar filtros</Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setDraft(emptyFilters)
                    apply(emptyFilters)
                  }}
                >
                  Limpar
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </form>

      {results.error && !nl ? (
        <ErrorState error={results.error} onRetry={() => results.refetch()} />
      ) : results.isLoading && !nl ? (
        <LoadingRows rows={8} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="Nenhuma dotação encontrada"
          description={
            <>
              Ajuste os filtros. Se a base estiver vazia, importe a LOA/PLOA na{' '}
              <Link to="/base" className="font-medium text-brand hover:underline">
                Base Legislativa
              </Link>
              .
            </>
          }
        />
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead>Classificação</TableHead>
                  <TableHead>Ação</TableHead>
                  <TableHead className="hidden md:table-cell">Natureza</TableHead>
                  <TableHead className="hidden lg:table-cell">Fonte</TableHead>
                  <TableHead className="text-right">Valor autorizado</TableHead>
                  <TableHead className="hidden sm:table-cell">Conferência</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => openDetail(r.id)} data-state={r.id === selectedId ? 'selected' : undefined}>
                    <TableCell className="font-mono text-xs whitespace-nowrap">{r.programmatic_code}</TableCell>
                    <TableCell className="max-w-[26rem]">
                      <span className="block truncate text-sm">{r.action_name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {r.function_name} · {r.unit_name}
                      </span>
                    </TableCell>
                    <TableCell className="hidden font-mono text-xs md:table-cell">{r.expense_nature}</TableCell>
                    <TableCell className="hidden font-mono text-xs lg:table-cell">{r.source_code}</TableCell>
                    <TableCell className="text-right tabular">{money(r.authorized_amount)}</TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <div className="flex gap-1">
                        <VerificationBadge status={r.verification_status} />
                        {r.is_demo && <DemoBadge />}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {!nl && (
            <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {total} dotação(ões) · página {page} de {pages}
              </span>
              <div className="flex gap-1">
                <Button variant="outline" size="icon-sm" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Página anterior">
                  <ChevronLeft />
                </Button>
                <Button variant="outline" size="icon-sm" disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label="Próxima página">
                  <ChevronRight />
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      <AllocationDetailSheet
        allocationId={selectedId}
        onClose={() => openDetail(null)}
        onUse={(id, amendmentId) => navigate(amendmentId ? `/emendas/${amendmentId}?aba=programacao&adicionar=${id}` : `/emendas/nova?dotacao=${id}`)}
      />
    </PageContainer>
  )
}
