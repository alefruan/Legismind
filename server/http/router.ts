import { z } from 'zod'
import { runAssistantChat } from '../ai/assistant.js'
import { getEmbeddingProvider } from '../ai/embeddings.js'
import { describeLlmConfiguration } from '../ai/providers/index.js'
import { findCancellationCandidates } from '../amendments/candidates.js'
import { buildAmendmentDocument } from '../amendments/document.js'
import { readAmendmentAsUser, runAmendmentValidation } from '../amendments/service.js'
import { createOrganization, inviteUser, setMembershipStatus } from '../admin/service.js'
import { runBudgetNlQuery } from '../budget/nl-query.js'
import { runWorkerTick } from '../documents/worker.js'
import { getOcrProvider } from '../documents/ocr.js'
import { renderDocx } from '../export/docx.js'
import { renderPdf } from '../export/pdf.js'
import { env } from '../env.js'
import { toCents } from '../../shared/domain/money.js'
import { getAdminClient } from '../supabase.js'
import { isCronRequest, rateLimit, requireOrgRole, requireUser } from './auth.js'
import { badRequest, notFound, unauthorized } from './errors.js'
import { errorResponse, file, json, readJson, sse } from './respond.js'

type Handler = (request: Request, params: Record<string, string>, url: URL) => Promise<Response>

interface Route {
  method: string
  pattern: RegExp
  keys: string[]
  handler: Handler
}

const routes: Route[] = []

function route(method: string, path: string, handler: Handler) {
  const keys: string[] = []
  const pattern = new RegExp(
    '^' + path.replace(/:([a-zA-Z]+)/g, (_, key: string) => {
      keys.push(key)
      return '([^/]+)'
    }) + '/?$',
  )
  routes.push({ method, pattern, keys, handler })
}

const uuid = z.string().uuid('Identificador inválido.')

function generatedAt() {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date())
}

// -----------------------------------------------------------------------------
// Rotas
// -----------------------------------------------------------------------------
route('GET', '/health', async () => {
  let supabase = false
  try {
    supabase = Boolean(env.supabaseUrl && env.supabaseAnonKey && env.supabaseServiceRoleKey)
  } catch {
    supabase = false
  }
  const embeddings = getEmbeddingProvider()
  const ocr = getOcrProvider()
  return json({
    ok: true,
    services: {
      supabase,
      llm: describeLlmConfiguration(),
      embeddings: embeddings ? { provider: embeddings.name, model: embeddings.model } : null,
      ocr: ocr ? { provider: ocr.name } : null,
    },
  })
})

route('POST', '/assistant/chat', async (request) => {
  const ctx = await requireUser(request)
  const body = await readJson(request, 64 * 1024)
  return sse((send, signal) => runAssistantChat(ctx, body, send, signal), request.signal)
})

route('POST', '/budget/query', async (request) => {
  const ctx = await requireUser(request)
  return json(await runBudgetNlQuery(ctx, await readJson(request)))
})

route('POST', '/amendments/:id/validate', async (request, params) => {
  const ctx = await requireUser(request)
  await rateLimit(ctx, `validate:${ctx.user.id}`, env.limits.apiPerMinute)
  const result = await runAmendmentValidation(ctx, uuid.parse(params.id))
  return json(result)
})

route('GET', '/amendments/:id/candidates', async (request, params, url) => {
  const ctx = await requireUser(request)
  await rateLimit(ctx, `candidates:${ctx.user.id}`, env.limits.apiPerMinute)
  const amendment = await readAmendmentAsUser(ctx, uuid.parse(params.id))
  const amount = Number(url.searchParams.get('amount') ?? amendment.total_amount)
  if (!Number.isFinite(amount) || amount <= 0) throw badRequest('Informe o valor a anular.')
  const [destinations, cancellations] = await Promise.all([
    ctx.db.from('amendment_allocations').select('allocation_id').eq('amendment_id', amendment.id),
    ctx.db.from('amendment_cancellations').select('allocation_id').eq('amendment_id', amendment.id),
  ])
  const report = await findCancellationCandidates(ctx.db, ctx.admin, {
    organizationId: amendment.organization_id,
    fiscalYearId: amendment.fiscal_year_id,
    amountCents: toCents(amount),
    destinationAllocationIds: (destinations.data ?? []).map((d) => d.allocation_id).filter((x): x is string => Boolean(x)),
    excludeAllocationIds: (cancellations.data ?? []).map((c) => c.allocation_id as string),
    excludeAmendmentId: amendment.id,
    limit: 20,
  })
  return json(report)
})

route('GET', '/amendments/:id/document', async (request, params) => {
  const ctx = await requireUser(request)
  const built = await buildAmendmentDocument(ctx, uuid.parse(params.id))
  return json(built.document)
})

route('GET', '/amendments/:id/export', async (request, params, url) => {
  const ctx = await requireUser(request)
  await rateLimit(ctx, `export:${ctx.user.id}`, 30)
  const format = url.searchParams.get('format')
  if (format !== 'docx' && format !== 'pdf') throw badRequest('Formato inválido: use docx ou pdf.')
  const built = await buildAmendmentDocument(ctx, uuid.parse(params.id))
  await ctx.admin.rpc('write_audit_log', {
    p_organization_id: built.amendment.organization_id,
    p_action: `export_${format}`,
    p_entity_type: 'amendments',
    p_entity_id: built.amendment.id,
    p_summary: null,
    p_metadata: { revision: built.amendment.revision, user_id: ctx.user.id },
  })
  if (format === 'docx') {
    const bytes = await renderDocx(built.document, { generatedAt: generatedAt() })
    return file(bytes, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', `${built.fileBase}.docx`)
  }
  const bytes = await renderPdf(built.document, { generatedAt: generatedAt() })
  return file(bytes, 'application/pdf', `${built.fileBase}.pdf`)
})

route('POST', '/documents/versions/:id/process', async (request, params) => {
  const ctx = await requireUser(request)
  const versionId = uuid.parse(params.id)
  const body = (await readJson<{ reindex?: boolean }>(request)) ?? {}
  const { data: jobId, error } = await ctx.db.rpc('enqueue_document_processing', {
    p_version_id: versionId,
    p_job_type: body.reindex ? 'reindex_document' : 'ingest_document',
  })
  if (error) throw error
  const { data: version } = await ctx.db.from('document_versions').select('organization_id').eq('id', versionId).single()
  // Primeiro ciclo imediato e curto; os seguintes são acionados pela interface ou pelo agendador.
  const tick = await runWorkerTick(ctx.admin, { budgetMs: Math.min(env.limits.workerBudgetMs, 20_000), organizationId: version?.organization_id, workerId: `api:${ctx.user.id}` })
  return json({ jobId, tick })
})

route('POST', '/jobs/tick', async (request) => {
  if (isCronRequest(request)) {
    return json(await runWorkerTick(getAdminClient(), { budgetMs: env.limits.cronWorkerBudgetMs, workerId: 'cron' }))
  }
  const ctx = await requireUser(request)
  const body = await readJson<{ organizationId?: string }>(request)
  const organizationId = uuid.parse(body.organizationId)
  await requireOrgRole(ctx, organizationId, ['org_admin'])
  await rateLimit(ctx, `tick:${organizationId}`, 20)
  return json(await runWorkerTick(ctx.admin, { budgetMs: env.limits.workerBudgetMs, organizationId, workerId: `ui:${ctx.user.id}` }))
})

route('GET', '/jobs/cron', async (request) => {
  if (!isCronRequest(request)) throw unauthorized('Agendador não autorizado.')
  return json(await runWorkerTick(getAdminClient(), { budgetMs: env.limits.cronWorkerBudgetMs, workerId: 'cron' }))
})

route('POST', '/admin/invitations', async (request) => {
  const ctx = await requireUser(request)
  return json(await inviteUser(ctx, await readJson(request)))
})

route('POST', '/admin/memberships/status', async (request) => {
  const ctx = await requireUser(request)
  return json(await setMembershipStatus(ctx, await readJson(request)))
})

route('POST', '/platform/organizations', async (request) => {
  const ctx = await requireUser(request)
  return json(await createOrganization(ctx, await readJson(request)))
})

// -----------------------------------------------------------------------------
// Despacho
// -----------------------------------------------------------------------------

/** Resolve o caminho da rota: reescrita da Vercel (?__route=) ou caminho original (/api/...). */
export function resolvePath(url: URL): string {
  const rewritten = url.searchParams.get('__route')
  if (rewritten) return '/' + rewritten.replace(/^\/+/, '')
  return url.pathname.replace(/^\/api/, '') || '/'
}

export async function handleApiRequest(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const path = resolvePath(url)
  try {
    let methodMismatch = false
    for (const r of routes) {
      const match = r.pattern.exec(path)
      if (!match) continue
      if (r.method !== request.method) {
        methodMismatch = true
        continue
      }
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(match[i + 1]!)]))
      return await r.handler(request, params, url)
    }
    if (methodMismatch) return json({ error: { code: 'method_not_allowed', message: 'Método não permitido.' } }, { status: 405 })
    throw notFound('Rota de API inexistente.')
  } catch (error) {
    return errorResponse(error)
  }
}
