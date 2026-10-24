import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { ClipboardCheck, Library, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Pill, ProcessingBadge } from '@/components/common/badges'
import { PageHeader } from '@/components/common/page-header'
import { EmptyState, ErrorState, LoadingRows } from '@/components/common/states'
import { PageContainer } from '@/components/layout/app-shell'
import { documentStatusLabels, documentTypeLabels } from '@shared/domain/labels'
import type { DocumentRow, DocumentVersionRow } from '@shared/types/db'
import { supabase, unwrap } from '@/lib/supabase'
import { formatDate, timeAgo } from '@/lib/format'
import { useRequiredWorkspace } from '@/providers/workspace'
import { UploadDialog } from './upload-dialog'

type DocumentWithVersions = DocumentRow & {
  fiscal_year: { year: number } | null
  versions: Array<Pick<DocumentVersionRow, 'id' | 'version_number' | 'processing_status' | 'created_at'>>
}

export function DocumentsPage() {
  const ws = useRequiredWorkspace()
  const navigate = useNavigate()
  const [type, setType] = useState('all')
  const [status, setStatus] = useState('active')
  const [uploadOpen, setUploadOpen] = useState(false)

  const documents = useQuery({
    queryKey: ['documents', ws.organization.id, type, status],
    refetchInterval: (query) =>
      (query.state.data as DocumentWithVersions[] | undefined)?.some((d) => d.versions.some((v) => ['queued', 'processing'].includes(v.processing_status))) ? 5000 : false,
    queryFn: async () => {
      let q = supabase
        .from('documents')
        .select('*, fiscal_year:fiscal_years(year), versions:document_versions!document_versions_document_id_organization_id_fkey(id, version_number, processing_status, created_at)')
        .eq('organization_id', ws.organization.id)
        .order('updated_at', { ascending: false })
      if (type !== 'all') q = q.eq('doc_type', type)
      if (status !== 'all') q = q.eq('status', status)
      return unwrap<DocumentWithVersions[]>(await q)
    },
  })

  return (
    <PageContainer wide>
      <PageHeader
        title="Base Legislativa"
        description="Orçamento, leis e normas internas da instituição que fundamentam as consultas e validações. Toda resposta do assistente cita estes documentos."
        actions={
          <>
            {(ws.isOrgAdmin || ws.isReviewer) && (
              <Button asChild variant="outline">
                <Link to="/base/conferencia">
                  <ClipboardCheck /> Conferência de dotações
                </Link>
              </Button>
            )}
            {ws.isOrgAdmin && (
              <Button onClick={() => setUploadOpen(true)}>
                <Upload /> Enviar documento
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="sm:w-64" aria-label="Tipo de documento">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tipos</SelectItem>
            {Object.entries(documentTypeLabels).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="sm:w-48" aria-label="Situação">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as situações</SelectItem>
            {Object.entries(documentStatusLabels).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {documents.error ? (
        <ErrorState error={documents.error} onRetry={() => documents.refetch()} />
      ) : documents.isLoading ? (
        <LoadingRows rows={6} />
      ) : (documents.data ?? []).length === 0 ? (
        <EmptyState
          icon={Library}
          title="Nenhum documento"
          description="Cadastre a LOA (ou PLOA), a LDO, o PPA, a Lei Orgânica ou Constituição Estadual, o Regimento Interno e as resoluções aplicáveis."
          action={ws.isOrgAdmin && <Button onClick={() => setUploadOpen(true)}>Enviar documento</Button>}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>Documento</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="hidden md:table-cell">Exercício</TableHead>
                <TableHead className="hidden lg:table-cell">Publicação</TableHead>
                <TableHead>Versão vigente</TableHead>
                <TableHead className="hidden sm:table-cell">Atualizado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.data!.map((d) => {
                const current = d.versions.find((v) => v.id === d.current_version_id)
                const latest = [...d.versions].sort((a, b) => b.version_number - a.version_number)[0]
                return (
                  <TableRow key={d.id} className="cursor-pointer" onClick={() => navigate(`/base/${d.id}`)}>
                    <TableCell className="max-w-[30rem]">
                      <span className="block truncate font-medium">{d.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">{d.legal_reference ?? d.description ?? '—'}</span>
                    </TableCell>
                    <TableCell>
                      <Pill>{documentTypeLabels[d.doc_type]}</Pill>
                    </TableCell>
                    <TableCell className="hidden text-sm md:table-cell">{d.fiscal_year?.year ?? '—'}</TableCell>
                    <TableCell className="hidden text-sm lg:table-cell">{formatDate(d.publication_date)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{current ? `v${current.version_number}` : '—'}</span>
                        {latest && <ProcessingBadge status={latest.processing_status} />}
                        {d.status !== 'active' && <Pill tone="neutral">{documentStatusLabels[d.status]}</Pill>}
                      </div>
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">{timeAgo(d.updated_at)}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
      {uploadOpen && <UploadDialog open onOpenChange={setUploadOpen} />}
    </PageContainer>
  )
}
