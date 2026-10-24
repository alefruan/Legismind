import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { FileUp, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Textarea } from '@/components/ui/textarea'
import { Field, NativeSelect } from '@/components/common/form'
import { budgetDocumentTypes, documentTypeLabels, type DocumentType } from '@shared/domain/labels'
import { MAX_UPLOAD_BYTES, mimeFromFileName, sanitizeFileName } from '@shared/domain/documents/security'
import type { DocumentRow } from '@shared/types/db'
import { apiFetch } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import { formatBytes } from '@/lib/format'
import { useRequiredWorkspace } from '@/providers/workspace'

async function sha256(file: File) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

type Step = 'idle' | 'hash' | 'register' | 'upload' | 'enqueue'
const stepLabels: Record<Step, string> = {
  idle: '',
  hash: 'Calculando assinatura do arquivo…',
  register: 'Registrando documento…',
  upload: 'Enviando ao armazenamento privado…',
  enqueue: 'Iniciando processamento…',
}

/** Envio de novo documento ou de nova versão de um documento existente. */
export function UploadDialog({ open, onOpenChange, document }: { open: boolean; onOpenChange: (v: boolean) => void; document?: DocumentRow }) {
  const ws = useRequiredWorkspace()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [step, setStep] = useState<Step>('idle')
  const [error, setError] = useState<string | null>(null)
  const [meta, setMeta] = useState({
    title: '',
    doc_type: 'ldo' as DocumentType,
    fiscal_year_id: ws.fiscalYear?.id ?? '',
    legal_reference: '',
    sphere: 'municipal',
    publication_date: '',
    effective_from: '',
    effective_to: '',
    source_url: '',
    description: '',
    change_notes: '',
  })
  const isBudget = budgetDocumentTypes.includes(document?.doc_type ?? meta.doc_type)

  const pick = (f: File | null) => {
    setError(null)
    if (!f) return setFile(null)
    const mime = mimeFromFileName(f.name)
    if (!mime) return setError('Formato não aceito. Envie PDF, DOCX, XLSX ou CSV.')
    if (f.size > MAX_UPLOAD_BYTES) return setError(`Arquivo excede o limite de ${formatBytes(MAX_UPLOAD_BYTES)}.`)
    if (f.size === 0) return setError('Arquivo vazio.')
    setFile(f)
    if (!document && !meta.title) setMeta((m) => ({ ...m, title: f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ') }))
  }

  const submit = async () => {
    setError(null)
    if (!file) return setError('Selecione o arquivo.')
    const mime = mimeFromFileName(file.name)!
    if (!document && meta.title.trim().length < 3) return setError('Informe o título do documento.')
    if (isBudget && !(document?.fiscal_year_id ?? meta.fiscal_year_id)) return setError('Documentos orçamentários precisam estar vinculados a um exercício.')
    if (meta.source_url && !/^https?:\/\//i.test(meta.source_url)) return setError('A URL oficial deve começar com http:// ou https://')

    try {
      setStep('hash')
      const hash = await sha256(file)

      setStep('register')
      let documentId = document?.id
      if (!documentId) {
        const { data, error: docError } = await supabase
          .from('documents')
          .insert({
            organization_id: ws.organization.id,
            title: meta.title.trim(),
            doc_type: meta.doc_type,
            fiscal_year_id: meta.fiscal_year_id || null,
            legal_reference: meta.legal_reference.trim() || null,
            sphere: meta.sphere,
            publication_date: meta.publication_date || null,
            effective_from: meta.effective_from || null,
            effective_to: meta.effective_to || null,
            source_url: meta.source_url.trim() || null,
            description: meta.description.trim() || null,
          })
          .select('id')
          .single()
        if (docError || !data) throw new Error(docError?.message ?? 'Falha ao registrar o documento.')
        documentId = data.id
      }
      const versionId = crypto.randomUUID()
      const storagePath = `${ws.organization.id}/${documentId}/${versionId}/${sanitizeFileName(file.name)}`
      const { error: versionError } = await supabase.from('document_versions').insert({
        id: versionId,
        organization_id: ws.organization.id,
        document_id: documentId,
        version_number: 0,
        storage_path: storagePath,
        file_name: file.name.slice(0, 255),
        mime_type: mime,
        size_bytes: file.size,
        sha256: hash,
        change_notes: meta.change_notes.trim() || null,
      })
      if (versionError) throw new Error(versionError.message)

      setStep('upload')
      const { error: uploadError } = await supabase.storage.from('documents').upload(storagePath, file, { contentType: mime, upsert: false })
      if (uploadError) throw new Error(`Falha no envio: ${uploadError.message}`)

      setStep('enqueue')
      await apiFetch(`/documents/versions/${versionId}/process`, { method: 'POST', json: {} })

      toast.success('Documento enviado. O processamento continua em segundo plano.')
      void queryClient.invalidateQueries({ queryKey: ['documents'] })
      onOpenChange(false)
      navigate(`/base/${documentId}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha no envio.')
    } finally {
      setStep('idle')
    }
  }

  const busy = step !== 'idle'
  const progress = { idle: 0, hash: 15, register: 35, upload: 65, enqueue: 90 }[step]

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{document ? `Nova versão — ${document.title}` : 'Enviar documento'}</DialogTitle>
          <DialogDescription>
            O arquivo original fica em armazenamento privado da instituição. O texto, as tabelas e as dotações são extraídos de forma assíncrona e as extrações
            ambíguas ficam pendentes de conferência humana.
          </DialogDescription>
        </DialogHeader>

        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center transition-colors hover:border-brand/50 hover:bg-brand-soft/40">
          <FileUp className="size-6 text-muted-foreground" />
          {file ? (
            <span className="text-sm">
              <strong>{file.name}</strong> · {formatBytes(file.size)}
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">Clique para selecionar PDF, DOCX, XLSX ou CSV (até 100 MB)</span>
          )}
          <input type="file" accept=".pdf,.docx,.xlsx,.csv" className="sr-only" onChange={(e) => pick(e.target.files?.[0] ?? null)} disabled={busy} />
        </label>

        {!document && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Título" htmlFor="doc-title" required className="sm:col-span-2">
              <Input id="doc-title" value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} />
            </Field>
            <Field label="Tipo" htmlFor="doc-type" required>
              <NativeSelect id="doc-type" value={meta.doc_type} onChange={(e) => setMeta({ ...meta, doc_type: e.target.value as DocumentType })}>
                {Object.entries(documentTypeLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Exercício" htmlFor="doc-fy" required={isBudget} hint={isBudget ? 'Obrigatório para LOA, PLOA e anexos.' : 'Opcional (ex.: LDO do exercício).'}>
              <NativeSelect id="doc-fy" value={meta.fiscal_year_id} onChange={(e) => setMeta({ ...meta, fiscal_year_id: e.target.value })}>
                <option value="">Nenhum</option>
                {ws.fiscalYears.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.year}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Referência legal" htmlFor="doc-ref" hint="Ex.: Lei Municipal nº 1.234, de 20/12/2026">
              <Input id="doc-ref" value={meta.legal_reference} onChange={(e) => setMeta({ ...meta, legal_reference: e.target.value })} />
            </Field>
            <Field label="Esfera" htmlFor="doc-sphere">
              <NativeSelect id="doc-sphere" value={meta.sphere} onChange={(e) => setMeta({ ...meta, sphere: e.target.value })}>
                <option value="municipal">Municipal</option>
                <option value="estadual">Estadual</option>
                <option value="federal">Federal</option>
              </NativeSelect>
            </Field>
            <Field label="Data de publicação" htmlFor="doc-pub">
              <Input id="doc-pub" type="date" value={meta.publication_date} onChange={(e) => setMeta({ ...meta, publication_date: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Vigência — início" htmlFor="doc-from">
                <Input id="doc-from" type="date" value={meta.effective_from} onChange={(e) => setMeta({ ...meta, effective_from: e.target.value })} />
              </Field>
              <Field label="Vigência — fim" htmlFor="doc-to">
                <Input id="doc-to" type="date" value={meta.effective_to} onChange={(e) => setMeta({ ...meta, effective_to: e.target.value })} />
              </Field>
            </div>
            <Field label="URL oficial (origem)" htmlFor="doc-url" className="sm:col-span-2">
              <Input id="doc-url" type="url" value={meta.source_url} onChange={(e) => setMeta({ ...meta, source_url: e.target.value })} placeholder="https://" />
            </Field>
            <Field label="Descrição" htmlFor="doc-desc" className="sm:col-span-2">
              <Textarea id="doc-desc" rows={2} value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })} />
            </Field>
          </div>
        )}
        <Field label="Notas desta versão" htmlFor="doc-notes">
          <Input id="doc-notes" value={meta.change_notes} onChange={(e) => setMeta({ ...meta, change_notes: e.target.value })} placeholder="Ex.: versão publicada no Diário Oficial de 22/12" />
        </Field>

        {busy && (
          <div className="space-y-1.5">
            <Progress value={progress} />
            <p className="text-xs text-muted-foreground">{stepLabels[step]}</p>
          </div>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={busy || !file}>
            {busy && <Loader2 className="animate-spin" />} Enviar e processar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
