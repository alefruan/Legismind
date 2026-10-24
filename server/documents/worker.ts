import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { chunkPages, estimateTokens, type PageText } from '../../shared/domain/documents/chunking.js'
import { parseBudgetRows, parseBudgetText, type ParseIssue } from '../../shared/domain/documents/budget-parser.js'
import { detectPromptInjection, verifyFileContent } from '../../shared/domain/documents/security.js'
import { budgetDocumentTypes } from '../../shared/domain/labels.js'
import type { DocumentRow, DocumentVersionRow, ProcessingJobRow } from '../../shared/types/db.js'
import { getEmbeddingProvider, toPgVector } from '../ai/embeddings.js'
import { fetchAll, unwrap } from '../supabase.js'
import { importBudgetAllocations } from './budget-import.js'
import { extractDocument } from './extract.js'
import { getOcrProvider } from './ocr.js'

type Stage = 'extract' | 'ocr' | 'chunk' | 'budget' | 'embed' | 'finalize'

interface JobState {
  stage?: Stage
  pageCount?: number
  ocrPending?: number[]
  isBudget?: boolean
  chunks?: number
  allocations?: number
  embedded?: number
  warnings?: string[]
}

const stageProgress: Record<Stage, number> = { extract: 5, ocr: 15, chunk: 45, budget: 60, embed: 70, finalize: 95 }

class FatalJobError extends Error {}

interface JobContext {
  admin: SupabaseClient
  job: ProcessingJobRow
  version: DocumentVersionRow
  document: DocumentRow
  state: JobState
  deadline: number
}

async function logEvent(ctx: JobContext, level: 'info' | 'warning' | 'error', message: string, details?: unknown) {
  await ctx.admin.from('processing_job_events').insert({ job_id: ctx.job.id, organization_id: ctx.job.organization_id, level, message, details: details ?? null })
}

async function addIssues(ctx: JobContext, issues: Array<ParseIssue & { page?: number | null }>) {
  if (issues.length === 0) return
  const rows = issues.slice(0, 500).map((i) => ({
    organization_id: ctx.job.organization_id,
    version_id: ctx.version.id,
    severity: i.severity,
    code: i.code,
    message: i.message,
    page: i.page ?? null,
    excerpt: i.excerpt?.slice(0, 1000) ?? null,
  }))
  await ctx.admin.from('extraction_issues').insert(rows)
}

async function saveProgress(ctx: JobContext, stage: Stage, extraProgress = 0) {
  ctx.state.stage = stage
  await ctx.admin
    .from('processing_jobs')
    .update({ stage, state: ctx.state, progress: Math.min(99, stageProgress[stage] + extraProgress) })
    .eq('id', ctx.job.id)
}

async function download(ctx: JobContext): Promise<Uint8Array> {
  const { data, error } = await ctx.admin.storage.from('documents').download(ctx.version.storage_path)
  if (error || !data) throw new Error(`Não foi possível baixar o arquivo do armazenamento: ${error?.message ?? 'arquivo ausente'}`)
  return new Uint8Array(await data.arrayBuffer())
}

function isBudgetDocument(ctx: JobContext, kind: string) {
  return budgetDocumentTypes.includes(ctx.document.doc_type) || (kind === 'table' && ctx.document.doc_type !== 'outro')
}

// -----------------------------------------------------------------------------
// Etapas
// -----------------------------------------------------------------------------
async function stageExtract(ctx: JobContext): Promise<Stage> {
  const bytes = await download(ctx)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (ctx.version.sha256 && ctx.version.sha256 !== sha256) {
    throw new FatalJobError('O arquivo armazenado não corresponde ao hash informado no envio.')
  }
  const verdict = verifyFileContent(ctx.version.mime_type, bytes)
  if (!verdict.ok) {
    // arquivo rejeitado não permanece no armazenamento
    await ctx.admin.storage.from('documents').remove([ctx.version.storage_path])
    throw new FatalJobError(`Arquivo rejeitado na verificação de segurança: ${verdict.reason}`)
  }
  await ctx.admin.from('document_versions').update({ sha256, size_bytes: bytes.length }).eq('id', ctx.version.id)

  const extraction = await extractDocument(ctx.version.mime_type, bytes)
  await ctx.admin.from('document_pages').delete().eq('version_id', ctx.version.id)
  for (let i = 0; i < extraction.pages.length; i += 200) {
    const batch = extraction.pages.slice(i, i + 200).map((p) => ({
      version_id: ctx.version.id,
      organization_id: ctx.job.organization_id,
      page: p.page,
      text: p.text,
    }))
    const { error } = await ctx.admin.from('document_pages').insert(batch)
    if (error) throw error
  }
  ctx.state.pageCount = extraction.pageCount
  ctx.state.isBudget = isBudgetDocument(ctx, extraction.kind)
  ctx.state.warnings = extraction.warnings
  await ctx.admin.from('document_versions').update({ page_count: extraction.pageCount }).eq('id', ctx.version.id)
  if (extraction.warnings.length) await logEvent(ctx, 'warning', 'Avisos de extração', extraction.warnings)

  if (extraction.pages.length === 0) {
    await addIssues(ctx, [{ severity: 'error', code: 'empty_document', message: 'Nenhum texto pôde ser extraído do arquivo.' }])
  }

  if (extraction.lowTextPages.length > 0) {
    const ocr = getOcrProvider()
    if (ocr) {
      ctx.state.ocrPending = extraction.lowTextPages
      await logEvent(ctx, 'info', `${extraction.lowTextPages.length} página(s) sem camada de texto serão processadas por OCR (${ocr.name}).`)
      return 'ocr'
    }
    await addIssues(ctx, [
      {
        severity: extraction.lowTextPages.length > extraction.pageCount / 2 ? 'error' : 'warning',
        code: 'scanned_without_ocr',
        message: `${extraction.lowTextPages.length} página(s) parecem digitalizadas e não há serviço de OCR configurado (OCR_PROVIDER). Páginas: ${extraction.lowTextPages.slice(0, 30).join(', ')}${extraction.lowTextPages.length > 30 ? '…' : ''}.`,
      },
    ])
  }
  return 'chunk'
}

async function stageOcr(ctx: JobContext): Promise<Stage> {
  const ocr = getOcrProvider()
  const pending = ctx.state.ocrPending ?? []
  if (!ocr || pending.length === 0) return 'chunk'
  const bytes = await download(ctx)
  while (pending.length > 0 && Date.now() < ctx.deadline) {
    const batch = pending.splice(0, ocr.pagesPerBatch)
    const result = await ocr.transcribe(bytes, batch)
    for (const page of result.pages) {
      await ctx.admin.from('document_pages').upsert({ version_id: ctx.version.id, organization_id: ctx.job.organization_id, page: page.page, text: page.text, ocr: true })
    }
    if (result.usage) {
      await ctx.admin.from('ai_usage').insert({
        organization_id: ctx.job.organization_id,
        feature: 'ocr',
        provider: 'anthropic',
        model: result.model ?? 'desconhecido',
        input_tokens: result.usage.inputTokens,
        output_tokens: result.usage.outputTokens,
      })
    }
    ctx.state.ocrPending = pending
    const total = ctx.state.pageCount ?? 1
    await saveProgress(ctx, 'ocr', Math.round(((total - pending.length) / total) * 25))
  }
  await ctx.admin.from('document_versions').update({ ocr_used: true }).eq('id', ctx.version.id)
  if (pending.length > 0) return 'ocr'
  await addIssues(ctx, [{ severity: 'info', code: 'ocr_applied', message: 'Texto obtido por OCR: confira trechos e valores antes de utilizá-los.' }])
  return 'chunk'
}

async function loadPages(ctx: JobContext): Promise<PageText[]> {
  return fetchAll<PageText>(
    (from, to) => ctx.admin.from('document_pages').select('page, text').eq('version_id', ctx.version.id).order('page').range(from, to),
    { pageSize: 500 },
  )
}

async function stageChunk(ctx: JobContext): Promise<Stage> {
  const pages = await loadPages(ctx)
  const chunks = chunkPages(pages)
  const isDocx = ctx.version.mime_type.includes('wordprocessing')
  await ctx.admin.from('document_chunks').delete().eq('version_id', ctx.version.id)
  const suspicious: Array<ParseIssue & { page?: number | null }> = []
  const rows = chunks.map((c) => {
    const flags = detectPromptInjection(c.content)
    if (flags.length) {
      suspicious.push({
        severity: 'warning',
        code: 'possible_prompt_injection',
        message: `Trecho com padrões de instrução a sistemas de IA (${flags.join(', ')}). Será tratado como texto citado.`,
        page: isDocx ? null : c.pageStart,
        excerpt: c.content.slice(0, 400),
      })
    }
    return {
      organization_id: ctx.job.organization_id,
      document_id: ctx.document.id,
      version_id: ctx.version.id,
      chunk_index: c.index,
      page_start: isDocx ? null : c.pageStart,
      page_end: isDocx ? null : c.pageEnd,
      section_path: c.sectionPath,
      content: c.content,
      token_estimate: estimateTokens(c.content),
      flags: flags.length ? ['possible_prompt_injection', ...flags] : [],
    }
  })
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await ctx.admin.from('document_chunks').insert(rows.slice(i, i + 200))
    if (error) throw error
  }
  await addIssues(ctx, suspicious)
  ctx.state.chunks = rows.length
  return ctx.state.isBudget ? 'budget' : getEmbeddingProvider() ? 'embed' : 'finalize'
}

async function stageBudget(ctx: JobContext): Promise<Stage> {
  if (!ctx.document.fiscal_year_id) {
    await addIssues(ctx, [{ severity: 'error', code: 'missing_fiscal_year', message: 'Documento orçamentário sem exercício associado: edite o documento, informe o exercício e reprocesse.' }])
    return getEmbeddingProvider() ? 'embed' : 'finalize'
  }
  let result
  if (ctx.version.mime_type === 'text/csv' || ctx.version.mime_type.includes('spreadsheet')) {
    const extraction = await extractDocument(ctx.version.mime_type, await download(ctx))
    result = parseBudgetRows(extraction.rows ?? [], { startLine: (extraction.headerLine ?? 1) + 1 })
  } else {
    result = parseBudgetText(await loadPages(ctx))
  }
  await addIssues(ctx, result.issues)
  if (result.allocations.length > 0) {
    const summary = await importBudgetAllocations(
      { admin: ctx.admin, organizationId: ctx.job.organization_id, fiscalYearId: ctx.document.fiscal_year_id, documentId: ctx.document.id, versionId: ctx.version.id },
      result.allocations,
    )
    ctx.state.allocations = summary.inserted
    await logEvent(ctx, 'info', `${summary.inserted} dotação(ões) extraída(s) e registradas como pendentes de conferência.`, summary)
  } else {
    await logEvent(ctx, 'warning', 'Nenhuma dotação estruturada identificada no documento.', result.stats)
  }
  return getEmbeddingProvider() ? 'embed' : 'finalize'
}

async function stageEmbed(ctx: JobContext): Promise<Stage> {
  const provider = getEmbeddingProvider()
  if (!provider) return 'finalize'
  for (;;) {
    if (Date.now() > ctx.deadline) return 'embed'
    const rows = unwrap(
      await ctx.admin.from('document_chunks').select('id, section_path, content').eq('version_id', ctx.version.id).is('embedding', null).order('chunk_index').limit(64),
    ) as Array<{ id: string; section_path: string | null; content: string }>
    if (rows.length === 0) return 'finalize'
    const vectors = await provider.embed(rows.map((r) => `${r.section_path ?? ''}\n${r.content}`.trim()), 'document')
    await Promise.all(
      rows.map((r, i) => ctx.admin.from('document_chunks').update({ embedding: toPgVector(vectors[i]!), embedding_model: `${provider.name}:${provider.model}` }).eq('id', r.id)),
    )
    ctx.state.embedded = (ctx.state.embedded ?? 0) + rows.length
    await ctx.admin.from('ai_usage').insert({
      organization_id: ctx.job.organization_id,
      feature: 'embeddings',
      provider: provider.name,
      model: provider.model,
      input_tokens: rows.reduce((s, r) => s + estimateTokens(r.content), 0),
      output_tokens: 0,
    })
    const total = ctx.state.chunks || 1
    await saveProgress(ctx, 'embed', Math.round((Math.min(ctx.state.embedded, total) / total) * 25))
  }
}

async function stageFinalize(ctx: JobContext): Promise<null> {
  const count = async (severity: string) => {
    const { count: n, error } = await ctx.admin
      .from('extraction_issues')
      .select('id', { count: 'exact', head: true })
      .eq('version_id', ctx.version.id)
      .eq('status', 'open')
      .eq('severity', severity)
    if (error) throw error
    return n ?? 0
  }
  const [errors, warnings, infos] = await Promise.all([count('error'), count('warning'), count('info')])
  const needsReview = errors > 0 || warnings > 0 || (ctx.state.allocations ?? 0) > 0
  const stats = {
    pages: ctx.state.pageCount ?? 0,
    chunks: ctx.state.chunks ?? 0,
    embedded: ctx.state.embedded ?? 0,
    allocations: ctx.state.allocations ?? 0,
    issues: { errors, warnings, total: errors + warnings + infos },
  }
  await ctx.admin
    .from('document_versions')
    .update({ processing_status: needsReview ? 'needs_review' : 'completed', stats, processed_at: new Date().toISOString(), error_message: null })
    .eq('id', ctx.version.id)

  // Define a versão vigente quando ainda não há uma ou quando esta é mais recente.
  const current = ctx.document.current_version_id
    ? (unwrap(await ctx.admin.from('document_versions').select('version_number').eq('id', ctx.document.current_version_id).maybeSingle()) as { version_number: number } | null)
    : null
  if (!current || current.version_number < ctx.version.version_number) {
    await ctx.admin.from('documents').update({ current_version_id: ctx.version.id }).eq('id', ctx.document.id)
  }
  await ctx.admin
    .from('processing_jobs')
    .update({ status: 'succeeded', stage: 'done', progress: 100, state: ctx.state, finished_at: new Date().toISOString(), locked_at: null, locked_by: null, last_error: null })
    .eq('id', ctx.job.id)
  await logEvent(ctx, 'info', needsReview ? 'Processamento concluído: há itens para conferência humana.' : 'Processamento concluído.', stats)
  return null
}

const handlers: Record<Stage, (ctx: JobContext) => Promise<Stage | null>> = {
  extract: stageExtract,
  ocr: stageOcr,
  chunk: stageChunk,
  budget: stageBudget,
  embed: stageEmbed,
  finalize: stageFinalize,
}

async function processJob(admin: SupabaseClient, job: ProcessingJobRow, deadline: number) {
  const version = unwrap(await admin.from('document_versions').select('*').eq('id', job.document_version_id).single()) as DocumentVersionRow
  const document = unwrap(await admin.from('documents').select('*').eq('id', version.document_id).single()) as DocumentRow
  const state = (job.state ?? {}) as JobState
  const ctx: JobContext = { admin, job, version, document, state, deadline }

  if (!state.stage) {
    state.stage = job.job_type === 'reindex_document' ? 'chunk' : 'extract'
    await admin.from('extraction_issues').delete().eq('version_id', version.id).eq('status', 'open')
    await logEvent(ctx, 'info', job.job_type === 'reindex_document' ? 'Reindexação iniciada.' : 'Processamento iniciado.')
  }
  await admin.from('document_versions').update({ processing_status: 'processing' }).eq('id', version.id)

  try {
    let stage: Stage | null = state.stage
    while (stage) {
      await saveProgress(ctx, stage)
      const next: Stage | null = await handlers[stage](ctx)
      if (next && Date.now() > deadline) {
        // tempo esgotado: devolve à fila para continuar no próximo ciclo
        ctx.state.stage = next
        await admin.from('processing_jobs').update({ status: 'queued', stage: next, state: ctx.state, run_after: new Date().toISOString(), locked_at: null, locked_by: null, attempts: 0 }).eq('id', job.id)
        return
      }
      stage = next
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const fatal = error instanceof FatalJobError
    const attempts = job.attempts + 1
    const failed = fatal || attempts >= job.max_attempts
    console.error('[worker]', job.id, message)
    await logEvent(ctx, 'error', message)
    await admin
      .from('processing_jobs')
      .update({
        status: failed ? 'failed' : 'queued',
        attempts,
        last_error: message.slice(0, 2000),
        locked_at: null,
        locked_by: null,
        run_after: new Date(Date.now() + Math.min(3_600_000, 30_000 * 2 ** attempts)).toISOString(),
        finished_at: failed ? new Date().toISOString() : null,
        state: ctx.state,
      })
      .eq('id', job.id)
    if (failed) {
      await admin.from('document_versions').update({ processing_status: 'failed', error_message: message.slice(0, 2000) }).eq('id', version.id)
    }
  }
}

/**
 * Executa jobs da fila até o limite de tempo. Pode ser acionado pelo Vercel Cron,
 * pelo pg_cron ou pela interface (enquanto houver processamento em andamento).
 */
export async function runWorkerTick(admin: SupabaseClient, options: { budgetMs: number; organizationId?: string | null; workerId: string }) {
  const started = Date.now()
  const deadline = started + options.budgetMs
  let processed = 0
  while (Date.now() < deadline - 2_000) {
    const { data, error } = await admin.rpc('claim_processing_job', {
      p_worker: options.workerId,
      p_lock_timeout: '10 minutes',
      p_organization_id: options.organizationId ?? null,
    })
    if (error) throw error
    const job = (data as ProcessingJobRow[])[0]
    if (!job) break
    await processJob(admin, job, deadline)
    processed++
  }
  return { processed, elapsedMs: Date.now() - started }
}
