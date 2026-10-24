import { z } from 'zod'
import { extractIntentHeuristics } from '../../shared/domain/amendments/intent.js'
import type { AssistantChatRequest, AssistantStreamEvent, ToolEventRecord } from '../../shared/types/assistant.js'
import type { AiMessageRow, FiscalYearRow, OfficeRow, OrganizationRow } from '../../shared/types/db.js'
import { todayInBrazil } from '../amendments/service.js'
import { env } from '../env.js'
import { rateLimit, requireOfficeMember, requireOrgMember, type RequestContext } from '../http/auth.js'
import { badRequest, HttpError, notFound } from '../http/errors.js'
import { unwrap } from '../supabase.js'
import { getEmbeddingProvider } from './embeddings.js'
import { ASSISTANT_SYSTEM_PROMPT, buildContextPreamble } from './prompts.js'
import { getLlmProvider } from './providers/index.js'
import { assistantTools, toolsByName } from './tools/index.js'
import { toToolSpec, ToolUserError, type ToolContext } from './tools/registry.js'
import { addUsage, emptyUsage, LlmProviderError, type HistoryMessage, type ToolResultInput } from './types.js'

export const chatRequestSchema = z.object({
  organizationId: z.string().uuid(),
  officeId: z.string().uuid().nullish(),
  fiscalYearId: z.string().uuid().nullish(),
  conversationId: z.string().uuid().nullish(),
  message: z.string().trim().min(1, 'Escreva uma mensagem.').max(8000, 'Mensagem muito longa (máximo de 8.000 caracteres).'),
}) satisfies z.ZodType<AssistantChatRequest>

type Send = (event: AssistantStreamEvent) => void

const toolSpecs = assistantTools.map(toToolSpec)

/** Verifica se a instituição pode usar IA (configuração e cota mensal). */
async function assertQuota(ctx: RequestContext, organizationId: string) {
  const { data, error } = await ctx.admin.rpc('ai_quota_status', { p_org: organizationId })
  if (error) throw error
  const status = (data as Array<{ requests_used: number; tokens_used: number; request_limit: number | null; token_limit: number | null; ai_enabled: boolean }>)[0]
  if (!status) return
  if (!status.ai_enabled) throw new HttpError(403, 'ai_disabled', 'O uso de IA está desativado pela administração da instituição.')
  if (status.request_limit !== null && status.requests_used >= status.request_limit) {
    throw new HttpError(429, 'ai_quota', 'A cota mensal de requisições de IA da instituição foi atingida.')
  }
  if (status.token_limit !== null && status.tokens_used >= status.token_limit) {
    throw new HttpError(429, 'ai_quota', 'A cota mensal de tokens de IA da instituição foi atingida.')
  }
}

/** Reconstrói o histórico em texto (inclui notas das ferramentas para manter referências como IDs). */
function toHistory(rows: AiMessageRow[]): HistoryMessage[] {
  const history: HistoryMessage[] = []
  for (const row of rows) {
    let text = row.content
    if (row.role === 'assistant') {
      const tools = (row.blocks as ToolEventRecord[]).filter((b) => b && typeof b === 'object' && 'name' in b)
      if (tools.length) {
        const notes = tools.map((t) => {
          const ref = t.card && 'amendmentId' in t.card ? ` [amendment_id=${t.card.amendmentId}]` : ''
          return `- ${t.name}: ${t.summary}${ref}`
        })
        text = `${text}\n\n[Ferramentas utilizadas neste turno]\n${notes.join('\n')}`
      }
    }
    if (!text.trim()) continue
    // A API exige alternância começando por usuário; turnos consecutivos do mesmo papel são agrupados.
    const last = history[history.length - 1]
    if (last && last.role === row.role) last.text += `\n\n${text}`
    else history.push({ role: row.role, text })
  }
  while (history[0]?.role === 'assistant') history.shift()
  return history
}

async function resolveWorkspace(ctx: RequestContext, input: z.infer<typeof chatRequestSchema>) {
  await requireOrgMember(ctx, input.organizationId)
  if (input.officeId) await requireOfficeMember(ctx, input.officeId)

  const org = unwrap(await ctx.db.from('organizations').select('*').eq('id', input.organizationId).single()) as OrganizationRow
  const office = input.officeId
    ? (unwrap(await ctx.db.from('offices').select('*').eq('id', input.officeId).single()) as OfficeRow)
    : null
  let fiscalYear: FiscalYearRow | null = null
  if (input.fiscalYearId) {
    fiscalYear = unwrap(
      await ctx.db.from('fiscal_years').select('*').eq('id', input.fiscalYearId).eq('organization_id', input.organizationId).maybeSingle(),
    ) as FiscalYearRow | null
    if (!fiscalYear) throw notFound('Exercício não encontrado nesta instituição.')
  } else {
    fiscalYear = unwrap(
      await ctx.db.from('fiscal_years').select('*').eq('organization_id', input.organizationId).eq('is_active', true).maybeSingle(),
    ) as FiscalYearRow | null
  }
  return { org, office, fiscalYear }
}

async function ensureConversation(ctx: RequestContext, input: z.infer<typeof chatRequestSchema>, fiscalYearId: string | null) {
  if (input.conversationId) {
    const conversation = unwrap(
      await ctx.db.from('ai_conversations').select('id, title, organization_id').eq('id', input.conversationId).maybeSingle(),
    ) as { id: string; title: string; organization_id: string } | null
    if (!conversation || conversation.organization_id !== input.organizationId) throw notFound('Conversa não encontrada.')
    return { id: conversation.id, title: conversation.title, isNew: false }
  }
  const title = input.message.replace(/\s+/g, ' ').slice(0, 80)
  const created = unwrap(
    await ctx.db
      .from('ai_conversations')
      .insert({ organization_id: input.organizationId, office_id: input.officeId ?? null, fiscal_year_id: fiscalYearId, title, user_id: ctx.user.id })
      .select('id, title')
      .single(),
  ) as { id: string; title: string }
  return { id: created.id, title: created.title, isNew: true }
}

export async function runAssistantChat(ctx: RequestContext, rawInput: unknown, send: Send, signal: AbortSignal) {
  const parsed = chatRequestSchema.safeParse(rawInput)
  if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'Requisição inválida.')
  const input = parsed.data

  await rateLimit(ctx, `chat:${ctx.user.id}`, env.limits.chatPerMinute)
  const { org, office, fiscalYear } = await resolveWorkspace(ctx, input)
  const conversation = await ensureConversation(ctx, input, fiscalYear?.id ?? null)
  send({ type: 'conversation', conversationId: conversation.id, title: conversation.title })

  // Histórico anterior (antes de gravar a nova mensagem)
  const previous = unwrap(
    await ctx.admin
      .from('ai_messages')
      .select('id, conversation_id, role, content, blocks, model, created_at')
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: false })
      .limit(24),
  ) as AiMessageRow[]

  await ctx.admin.from('ai_messages').insert({ conversation_id: conversation.id, organization_id: org.id, role: 'user', content: input.message })

  const provider = getLlmProvider()
  if (!provider) {
    await respondWithoutLlm(ctx, { conversationId: conversation.id, organizationId: org.id, message: input.message, fiscalYear }, send)
    return
  }
  await assertQuota(ctx, org.id)

  const toolContext: ToolContext = {
    req: ctx,
    organizationId: org.id,
    officeId: office?.id ?? null,
    fiscalYearId: fiscalYear?.id ?? null,
    fiscalYear: fiscalYear?.year ?? null,
    isDemo: org.is_demo,
    conversationId: conversation.id,
    embeddings: getEmbeddingProvider(),
    createdAmendments: [],
  }

  const session = provider.startSession({
    system: ASSISTANT_SYSTEM_PROMPT,
    tools: toolSpecs,
    history: toHistory(previous.reverse()),
    userMessage: input.message,
    contextPreamble: buildContextPreamble({
      today: todayInBrazil(),
      organizationName: org.name,
      organizationKind: org.kind,
      isDemo: org.is_demo,
      officeName: office?.name ?? null,
      parliamentarianName: office?.parliamentarian_name ?? null,
      fiscalYear: fiscalYear?.year ?? null,
      fiscalPhase: fiscalYear?.phase ?? null,
    }),
  })

  let usage = emptyUsage()
  let model = provider.model
  const texts: string[] = []
  const toolEvents: ToolEventRecord[] = []
  let rounds = 0
  let errorMessage: string | null = null

  try {
    for (;;) {
      if (signal.aborted) break
      let turnText = ''
      const turn = await session.runTurn({
        signal,
        onText: (delta) => {
          turnText += delta
          send({ type: 'text', delta })
        },
      })
      usage = addUsage(usage, turn.usage)
      model = turn.model
      if (turn.text.trim()) texts.push(turn.text)
      else if (turnText.trim()) texts.push(turnText)

      if (turn.stopReason === 'refusal') {
        const message = 'O assistente não pôde concluir esta solicitação por restrições de segurança do provedor de IA. Reformule o pedido ou utilize o editor manualmente.'
        send({ type: 'notice', level: 'warning', message })
        texts.push(`_${message}_`)
        break
      }
      if (turn.stopReason === 'max_tokens') {
        const message = 'A resposta atingiu o limite de tamanho e pode estar incompleta.'
        send({ type: 'notice', level: 'warning', message })
        break
      }
      if (turn.stopReason === 'pause') continue
      if (turn.stopReason !== 'tool_use' || turn.toolCalls.length === 0) break

      if (++rounds > env.llm.maxToolRounds) {
        const message = 'Limite de etapas automáticas atingido nesta resposta. Peça para continuar, se necessário.'
        send({ type: 'notice', level: 'info', message })
        // responde às chamadas pendentes para manter o histórico consistente
        session.addToolResults(turn.toolCalls.map((c) => ({ callId: c.id, content: 'Não executado: limite de etapas atingido.', isError: true })))
        break
      }

      const results: ToolResultInput[] = []
      for (const call of turn.toolCalls) {
        const tool = toolsByName.get(call.name)
        const label = tool?.label ?? call.name
        send({ type: 'tool_start', id: call.id, name: call.name, label })
        if (!tool) {
          results.push({ callId: call.id, content: `Ferramenta desconhecida: ${call.name}`, isError: true })
          send({ type: 'tool_end', id: call.id, name: call.name, label, ok: false, summary: 'Ferramenta desconhecida' })
          continue
        }
        // Com eager_input_streaming a API não valida a entrada: validamos sempre.
        const validated = tool.schema.safeParse(call.input)
        if (!validated.success) {
          const detail = validated.error.issues.map((i) => `${i.path.join('.') || 'entrada'}: ${i.message}`).join('; ')
          results.push({ callId: call.id, content: `INVALID_INPUT: ${detail}`, isError: true })
          send({ type: 'tool_end', id: call.id, name: call.name, label, ok: false, summary: 'Parâmetros inválidos' })
          continue
        }
        try {
          const output = await tool.execute(toolContext, validated.data)
          const content = typeof output.content === 'string' ? output.content : JSON.stringify(output.content)
          results.push({ callId: call.id, content })
          const record: ToolEventRecord = { id: call.id, name: call.name, label, ok: true, summary: output.summary, card: output.card }
          toolEvents.push(record)
          send({ type: 'tool_end', ...record })
        } catch (error) {
          const message =
            error instanceof ToolUserError || error instanceof HttpError
              ? error.message
              : 'Falha ao executar a ferramenta. Informe o usuário e não presuma o resultado.'
          if (!(error instanceof ToolUserError) && !(error instanceof HttpError)) console.error(`[tool:${call.name}]`, error)
          results.push({ callId: call.id, content: message, isError: true })
          const record: ToolEventRecord = { id: call.id, name: call.name, label, ok: false, summary: message }
          toolEvents.push(record)
          send({ type: 'tool_end', ...record })
        }
      }
      session.addToolResults(results)
    }
  } catch (error) {
    if (!signal.aborted) {
      console.error('[assistant]', error)
      errorMessage =
        error instanceof LlmProviderError
          ? error.configuration
            ? `${error.message} Avise a administração da plataforma.`
            : error.message
          : 'Falha ao comunicar com o provedor de IA. Tente novamente em instantes.'
    }
  }

  const content = texts.join('\n\n').trim()
  const saved = await ctx.admin
    .from('ai_messages')
    .insert({
      conversation_id: conversation.id,
      organization_id: org.id,
      role: 'assistant',
      content: content || (errorMessage ? `_${errorMessage}_` : ''),
      blocks: toolEvents,
      provider: provider.name,
      model,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
    })
    .select('id')
    .single()

  await ctx.admin.from('ai_usage').insert({
    organization_id: org.id,
    user_id: ctx.user.id,
    conversation_id: conversation.id,
    feature: 'assistant',
    provider: provider.name,
    model,
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    cache_read_tokens: usage.cacheReadTokens,
    request_count: 1,
  })

  const conversationPatch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (toolContext.createdAmendments.length) conversationPatch.amendment_id = toolContext.createdAmendments[toolContext.createdAmendments.length - 1]
  await ctx.admin.from('ai_conversations').update(conversationPatch).eq('id', conversation.id)

  if (errorMessage) send({ type: 'error', code: 'llm_error', message: errorMessage })
  send({ type: 'done', conversationId: conversation.id, messageId: saved.data?.id ?? null, usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } })
}

/**
 * Sem credenciais de LLM: informa claramente a indisponibilidade e oferece a
 * interpretação determinística do pedido (sem apresentar nada como conclusão da IA).
 */
async function respondWithoutLlm(
  ctx: RequestContext,
  args: { conversationId: string; organizationId: string; message: string; fiscalYear: FiscalYearRow | null },
  send: Send,
) {
  const intent = extractIntentHeuristics(args.message, { fiscalYear: args.fiscalYear?.year ?? null })
  const text = [
    '**Assistente de IA indisponível:** nenhum provedor de LLM está configurado neste ambiente (variável `ANTHROPIC_API_KEY`).',
    '',
    'Enquanto isso, a interpretação automática (sem IA) do seu pedido está no cartão abaixo. Você pode usar o **Explorador Orçamentário** para localizar dotações e o **editor de emendas** para elaborar a minuta manualmente — a validação técnica funciona normalmente, pois não depende de IA.',
  ].join('\n')
  send({ type: 'text', delta: text })
  const record: ToolEventRecord = {
    id: 'heuristica',
    name: 'interpretacao_deterministica',
    label: 'Interpretação automática (sem IA)',
    ok: true,
    summary: 'Interpretação determinística do pedido',
    card: {
      kind: 'interpretation',
      amountCents: intent.amountCents,
      area: intent.policyArea,
      beneficiary: intent.beneficiaryType === 'osc' ? 'Organização da sociedade civil' : null,
      functions: intent.functionCodeHints,
      missing: intent.missingInformation,
    },
  }
  send({ type: 'tool_end', ...record })
  const saved = await ctx.admin
    .from('ai_messages')
    .insert({ conversation_id: args.conversationId, organization_id: args.organizationId, role: 'assistant', content: text, blocks: [record] })
    .select('id')
    .single()
  send({ type: 'done', conversationId: args.conversationId, messageId: saved.data?.id ?? null, usage: { inputTokens: 0, outputTokens: 0 } })
}
