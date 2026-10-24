import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Download, FileText, Loader2, Printer } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/common/states'
import { DocumentSheet } from '@/components/document/document-preview'
import type { AmendmentDocument } from '@shared/domain/amendments/document'
import { apiDownload, apiFetch } from '@/lib/api'
import type { AmendmentDetail } from '../hooks'

export function DocumentTab({ amendment }: { amendment: AmendmentDetail }) {
  const [downloading, setDownloading] = useState<'docx' | 'pdf' | null>(null)
  const document = useQuery({
    queryKey: ['amendment-document', amendment.id, amendment.revision, amendment.status, amendment.validated_revision],
    queryFn: () => apiFetch<AmendmentDocument>(`/amendments/${amendment.id}/document`),
  })

  const download = async (format: 'docx' | 'pdf') => {
    setDownloading(format)
    try {
      await apiDownload(`/amendments/${amendment.id}/export?format=${format}`, `emenda.${format}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha na exportação.')
    } finally {
      setDownloading(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">Minuta gerada no modelo oficial da instituição. Edite os dados nas outras abas; a prévia é atualizada automaticamente.</p>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer /> Imprimir
          </Button>
          <Button variant="outline" size="sm" onClick={() => void download('docx')} disabled={downloading !== null}>
            {downloading === 'docx' ? <Loader2 className="animate-spin" /> : <FileText />} DOCX
          </Button>
          <Button size="sm" onClick={() => void download('pdf')} disabled={downloading !== null}>
            {downloading === 'pdf' ? <Loader2 className="animate-spin" /> : <Download />} PDF
          </Button>
        </div>
      </div>

      {document.error ? (
        <ErrorState error={document.error} onRetry={() => document.refetch()} />
      ) : document.isLoading ? (
        <Skeleton className="h-[32rem]" />
      ) : (
        <>
          {document.data!.pendingItems.length > 0 && (
            <div className="flex gap-2 rounded-md border border-warning/30 bg-warning-soft p-3 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
              <div>
                <p className="font-medium">Pendências no documento</p>
                <p className="text-muted-foreground">{document.data!.pendingItems.join('; ')}.</p>
              </div>
            </div>
          )}
          <Card className="overflow-hidden bg-neutral-100 dark:bg-neutral-900">
            <CardContent className="p-3 sm:p-8">
              <DocumentSheet id="print-area" document={document.data!} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
