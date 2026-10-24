import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowLeft, Download, FileUp, Info, Loader2, RefreshCcw, Star, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Pill, ProcessingBadge } from '@/components/common/badges'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { NativeSelect } from '@/components/common/form'
import { EmptyState, ErrorState } from '@/components/common/states'
import { PageContainer } from '@/components/layout/app-shell'
import { documentStatusLabels, documentTypeLabels, jobStageLabels } from '@shared/domain/labels'
import type { DocumentRow, DocumentVersionRow, ExtractionIssueRow, ProcessingJobRow } from '@shared/types/db'
import { apiFetch } from '@/lib/api'
import { supabase, unwrap } from '@/lib/supabase'
import { formatBytes, formatDate, formatDateTime, timeAgo } from '@/lib/format'
import { useRequiredWorkspace } from '@/providers/workspace'
import { cn } from '@/lib/utils'
import { UploadDialog } from './upload-dialog'

type DetailDocument = DocumentRow & { fiscal_year: { year: number } | null }

function useDocument(id: string) {
  return useQuery({
    queryKey: ['document', id],
    queryFn: async () => {
      const [doc, versions] = await Promise.all([
        supabase.from('documents').select('*, fiscal_year:fiscal_years(year)').eq('id', id).maybeSingle(),
        supabase.from('document_versions').select('*').eq('document_id', id).order('version_number', { ascending: false }),
      ])
      return { document: unwrap<DetailDocument | null>(doc), versions: unwrap<DocumentVersionRow[]>(versions) }
    },
  })
}

function JobPanel({ version, organizationId, canDrive }: { version: DocumentVersionRow; organizationId: string; canDrive: boolean }) {
  const queryClient = useQueryClient()
  const job = useQuery({
    queryKey: ['job', version.id],
    refetchInterval: (q) => {
      const data = q.state.data as { job: ProcessingJobRow | null } | undefined
      return data?.job && ['queued', 'running'].includes(data.job.status) ? 3000 : false
    },
    queryFn: async () => {
      const jobs = unwrap<ProcessingJobRow[]>(await supabase.from('processing_jobs').select('*').eq('document_version_id', version.id).order('created_at', { ascending: false }).limit(1))
      const current = jobs[0] ?? null
      const events = current && canDrive
        ? unwrap<Array<{ id: number; level: string; message: string; created_at: string }>>(
            await supabase.from('processing_job_events').select('id, level, message, created_at').eq('job_id', current.id).order('created_at', { ascending: false }).limit(15),
          )
        : []
      return { job: current, events }
    },
  })

  const active = job.data?.job && ['queued', 'running'].includes(job.data.job.status)

  // Enquanto houver processamento ativo, a interface aciona ciclos curtos do worker (além do agendador).
  useEffect(() => {
    if (!active || !canDrive) return
    let cancelled = false
    const tick = async () => {
      try {
        await apiFetch('/jobs/tick', { method: 'POST', json: { organizationId } })
      } catch {
        // o agendador continuará o processamento
      }
      if (!cancelled) {
        void queryClient.invalidateQueries({ queryKey: ['job', version.id] })
        void queryClient.invalidateQueries({ queryKey: ['document', version.document_id] })
      }
    }
    const interval = setInterval(tick, 8000)
    void tick()
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [active, canDrive, organizationId, version.id, version.document_id, queryClient])

  if (job.isLoading) return <Skeleton className="h-24" />
  const j = job.data?.job
  if (!j) return <p className="text-sm text-muted-foreground">Nenhum processamento registrado para esta versão.</p>
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Progress value={Number(j.progress)} className="flex-1" />
        <span className="w-12 text-right text-xs tabular">{Math.round(Number(j.progress))}%</span>
      </div>
      <p className="flex items-center gap-2 text-sm">
        {active && <Loader2 className="size-3.5 animate-spin text-brand" />}
        {jobStageLabels[j.stage] ?? j.stage}
        {j.attempts > 0 && <span className="text-xs text-muted-foreground">· tentativas com falha: {j.attempts}</span>}
      </p>
      {j.last_error && <p className="rounded-md bg-danger-soft px-3 py-2 text-xs text-danger">{j.last_error}</p>}
      {job.data!.events.length > 0 && (
        <ul className="space-y-1 text-xs">
          {job.data!.events.map((e) => (
            <li key={e.id} className="flex gap-2">
              <span className="w-28 shrink-0 text-muted-foreground">{formatDateTime(e.created_at)}</span>
              <span className={cn(e.level === 'error' && 'text-danger', e.level === 'warning' && 'text-warning')}>{e.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function IssuesPanel({ versionId, canResolve }: { versionId: string; canResolve: boolean }) {
  const queryClient = useQueryClient()
  const issues = useQuery({
    queryKey: ['issues', versionId],
    queryFn: async () => unwrap<ExtractionIssueRow[]>(await supabase.from('extraction_issues').select('*').eq('version_id', versionId).order('severity').order('created_at').limit(300)),
  })
  const update = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'resolved' | 'dismissed' | 'open' }) => unwrap(await supabase.from('extraction_issues').update({ status }).eq('id', id)),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['issues', versionId] }),
    onError: (e: Error) => toast.error(e.message),
  })
  if (issues.isLoading) return <Skeleton className="h-24" />
  if ((issues.data ?? []).length === 0) return <p className="text-sm text-muted-foreground">Nenhuma inconsistência registrada na extração.</p>
  return (
    <ul className="divide-y rounded-md border">
      {issues.data!.map((i) => {
        const Icon = i.severity === 'error' ? XCircle : i.severity === 'warning' ? AlertTriangle : Info
        return (
          <li key={i.id} className={cn('flex gap-3 p-3', i.status !== 'open' && 'opacity-55')}>
            <Icon className={cn('mt-0.5 size-4 shrink-0', i.severity === 'error' ? 'text-danger' : i.severity === 'warning' ? 'text-warning' : 'text-brand')} />
            <div className="min-w-0 flex-1">
              <p className="text-sm">{i.message}</p>
              <p className="text-xs text-muted-foreground">
                {i.code}
                {i.page ? ` · p. ${i.page}` : ''}
                {i.status !== 'open' ? ` · ${i.status === 'resolved' ? 'resolvido' : 'descartado'}` : ''}
              </p>
              {i.excerpt && <pre className="mt-1 max-h-24 overflow-auto rounded bg-muted p-2 text-[11px] whitespace-pre-wrap">{i.excerpt}</pre>}
            </div>
            {canResolve && (
              <div className="flex shrink-0 flex-col gap-1">
                {i.status === 'open' ? (
                  <>
                    <Button size="xs" variant="outline" onClick={() => update.mutate({ id: i.id, status: 'resolved' })}>
                      Resolvido
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => update.mutate({ id: i.id, status: 'dismissed' })}>
                      Descartar
                    </Button>
                  </>
                ) : (
                  <Button size="xs" variant="ghost" onClick={() => update.mutate({ id: i.id, status: 'open' })}>
                    Reabrir
                  </Button>
                )}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function PagesPanel({ version }: { version: DocumentVersionRow }) {
  const [page, setPage] = useState(1)
  const pages = useQuery({
    queryKey: ['pages', version.id],
    queryFn: async () => unwrap<Array<{ page: number; char_count: number; ocr: boolean }>>(await supabase.from('document_pages').select('page, char_count, ocr').eq('version_id', version.id).order('page')),
  })
  const text = useQuery({
    queryKey: ['page-text', version.id, page],
    enabled: (pages.data ?? []).length > 0,
    queryFn: async () => unwrap<{ text: string } | null>(await supabase.from('document_pages').select('text').eq('version_id', version.id).eq('page', page).maybeSingle()),
  })
  if (pages.isLoading) return <Skeleton className="h-40" />
  if ((pages.data ?? []).length === 0) return <p className="text-sm text-muted-foreground">Texto ainda não extraído.</p>
  const meta = pages.data!.find((p) => p.page === page)
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <NativeSelect value={page} onChange={(e) => setPage(Number(e.target.value))} className="w-40" aria-label="Página">
          {pages.data!.map((p) => (
            <option key={p.page} value={p.page}>
              {version.mime_type.includes('word') ? 'Seção' : 'Página'} {p.page}
              {p.char_count < 40 ? ' (sem texto)' : ''}
            </option>
          ))}
        </NativeSelect>
        {meta?.ocr && <Pill tone="warning">Texto obtido por OCR</Pill>}
      </div>
      <pre className="max-h-[28rem] overflow-auto rounded-md border bg-muted/40 p-4 text-xs leading-relaxed whitespace-pre-wrap">{text.data?.text || '(página sem texto extraído)'}</pre>
    </div>
  )
}

export function DocumentDetailPage() {
  const { id = '' } = useParams()
  const ws = useRequiredWorkspace()
  const queryClient = useQueryClient()
  const detail = useDocument(id)
  const [versionId, setVersionId] = useState<string | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['document', id] })
    void queryClient.invalidateQueries({ queryKey: ['documents'] })
  }

  const setCurrent = useMutation({
    mutationFn: async (vid: string) => unwrap(await supabase.rpc('set_current_document_version', { p_version_id: vid })),
    onSuccess: () => {
      toast.success('Versão vigente atualizada.')
      invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const reprocess = useMutation({
    mutationFn: async ({ vid, reindex }: { vid: string; reindex: boolean }) => apiFetch(`/documents/versions/${vid}/process`, { method: 'POST', json: { reindex } }),
    onSuccess: () => {
      toast.success('Processamento enfileirado.')
      invalidate()
      void queryClient.invalidateQueries({ queryKey: ['job'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const setStatus = useMutation({
    mutationFn: async (status: 'active' | 'obsolete') => unwrap(await supabase.from('documents').update({ status }).eq('id', id)),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  })
  const download = async (version: DocumentVersionRow) => {
    const { data, error } = await supabase.storage.from('documents').createSignedUrl(version.storage_path, 60, { download: version.file_name })
    if (error || !data) {
      toast.error('Arquivo original indisponível.')
      return
    }
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  if (detail.error) return <PageContainer><ErrorState error={detail.error} onRetry={() => detail.refetch()} /></PageContainer>
  if (detail.isLoading) return <PageContainer><Skeleton className="h-96" /></PageContainer>
  const doc = detail.data!.document
  if (!doc) return <PageContainer><EmptyState title="Documento não encontrado" /></PageContainer>
  const versions = detail.data!.versions
  const version = versions.find((v) => v.id === versionId) ?? versions.find((v) => v.id === doc.current_version_id) ?? versions[0]

  return (
    <PageContainer wide>
      <Link to="/base" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Base Legislativa
      </Link>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-1.5">
            <Pill>{documentTypeLabels[doc.doc_type]}</Pill>
            <Pill tone={doc.status === 'active' ? 'success' : 'neutral'}>{documentStatusLabels[doc.status]}</Pill>
            {doc.fiscal_year && <Pill tone="info">Exercício {doc.fiscal_year.year}</Pill>}
          </div>
          <h1 className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl">{doc.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {doc.legal_reference ?? 'Sem referência legal'} · publicação {formatDate(doc.publication_date)} · vigência {formatDate(doc.effective_from)} a {doc.effective_to ? formatDate(doc.effective_to) : 'indeterminada'}
          </p>
          {doc.source_url && (
            <a href={doc.source_url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-sm text-brand hover:underline">
              Origem oficial
            </a>
          )}
          {doc.description && <p className="mt-2 max-w-3xl text-sm">{doc.description}</p>}
        </div>
        {ws.isOrgAdmin && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button variant="outline" onClick={() => setUploadOpen(true)}>
              <FileUp /> Nova versão
            </Button>
            {doc.status === 'active' ? (
              <ConfirmDialog
                trigger={<Button variant="outline">Marcar obsoleto</Button>}
                title="Marcar documento como obsoleto?"
                description="Documentos obsoletos deixam de ser usados nas buscas do assistente, mas permanecem para rastreabilidade histórica."
                onConfirm={() => setStatus.mutateAsync('obsolete')}
              />
            ) : (
              <Button variant="outline" onClick={() => setStatus.mutate('active')}>
                Reativar
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-[22rem_1fr]">
        <Card className="h-fit">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Versões</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {versions.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma versão enviada.</p>
            ) : (
              <ul className="space-y-1">
                {versions.map((v) => (
                  <li key={v.id}>
                    <button
                      type="button"
                      onClick={() => setVersionId(v.id)}
                      className={cn('w-full rounded-md border p-2.5 text-left transition-colors hover:bg-accent', v.id === version?.id && 'border-brand/40 bg-brand-soft')}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs">v{v.version_number}</span>
                        {v.id === doc.current_version_id && (
                          <span className="inline-flex items-center gap-0.5 text-[11px] text-brand">
                            <Star className="size-3 fill-current" /> vigente
                          </span>
                        )}
                        <span className="ml-auto">
                          <ProcessingBadge status={v.processing_status} />
                        </span>
                      </div>
                      <p className="mt-1 truncate text-xs">{v.file_name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {formatBytes(v.size_bytes)} · {timeAgo(v.created_at)}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {version && (
          <div className="space-y-6">
            <Card>
              <CardContent className="space-y-4 p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium">
                    Versão {version.version_number} · {version.file_name}
                  </p>
                  <ProcessingBadge status={version.processing_status} />
                  {version.ocr_used && <Pill tone="warning">OCR</Pill>}
                  <div className="ml-auto flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => void download(version)}>
                      <Download /> Original
                    </Button>
                    {ws.isOrgAdmin && version.id !== doc.current_version_id && ['completed', 'needs_review'].includes(version.processing_status) && (
                      <Button size="sm" variant="outline" onClick={() => setCurrent.mutate(version.id)}>
                        <Star /> Tornar vigente
                      </Button>
                    )}
                    {ws.isOrgAdmin && ['completed', 'needs_review', 'failed'].includes(version.processing_status) && (
                      <>
                        <Button size="sm" variant="outline" disabled={reprocess.isPending} onClick={() => reprocess.mutate({ vid: version.id, reindex: false })}>
                          <RefreshCcw /> Reprocessar
                        </Button>
                        <Button size="sm" variant="ghost" disabled={reprocess.isPending} onClick={() => reprocess.mutate({ vid: version.id, reindex: true })}>
                          Reconstruir índice
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                {version.error_message && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{version.error_message}</p>}
                <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  {[
                    ['Páginas/seções', version.page_count ?? '—'],
                    ['Trechos indexados', (version.stats as { chunks?: number }).chunks ?? '—'],
                    ['Dotações extraídas', (version.stats as { allocations?: number }).allocations ?? '—'],
                    ['Embeddings', (version.stats as { embedded?: number }).embedded ?? '—'],
                  ].map(([label, value]) => (
                    <div key={label as string} className="rounded-md bg-muted/50 p-3">
                      <dt className="text-xs text-muted-foreground">{label}</dt>
                      <dd className="mt-0.5 text-lg font-semibold tabular">{value as React.ReactNode}</dd>
                    </div>
                  ))}
                </dl>
                <p className="font-mono text-[10px] break-all text-muted-foreground">SHA-256 {version.sha256 ?? 'não calculado'}</p>
              </CardContent>
            </Card>

            <Tabs defaultValue="processamento">
              <TabsList>
                <TabsTrigger value="processamento">Processamento</TabsTrigger>
                <TabsTrigger value="inconsistencias">Inconsistências</TabsTrigger>
                <TabsTrigger value="texto">Texto extraído</TabsTrigger>
              </TabsList>
              <TabsContent value="processamento">
                <Card>
                  <CardContent className="p-5">
                    <JobPanel version={version} organizationId={ws.organization.id} canDrive={ws.isOrgAdmin} />
                  </CardContent>
                </Card>
              </TabsContent>
              <TabsContent value="inconsistencias">
                <IssuesPanel versionId={version.id} canResolve={ws.isOrgAdmin || ws.isReviewer} />
              </TabsContent>
              <TabsContent value="texto">
                <PagesPanel version={version} />
              </TabsContent>
            </Tabs>
            {(version.stats as { allocations?: number }).allocations ? (
              <p className="text-sm">
                <Link to={`/base/conferencia?versao=${version.id}`} className="font-medium text-brand hover:underline">
                  Conferir as dotações extraídas desta versão →
                </Link>
              </p>
            ) : null}
          </div>
        )}
      </div>
      {uploadOpen && <UploadDialog open onOpenChange={setUploadOpen} document={doc} />}
    </PageContainer>
  )
}
