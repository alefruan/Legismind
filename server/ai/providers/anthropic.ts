import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { z } from 'zod'
import { env } from '../../env.js'
import {
  LlmProviderError,
  LlmRefusalError,
  type LlmProvider,
  type LlmSession,
  type StartSessionOptions,
  type StopReason,
  type ToolResultInput,
  type TurnResult,
  type Usage,
} from '../types.js'

/** Modelos que aceitam o fallback de recusa no servidor (`fallbacks: "default"`). */
const SUPPORTS_SERVER_FALLBACK = /^claude-(opus-5-5|opus-5|sonnet-5-5|fable-5-1)$/
const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

/**
 * Traduz erros da API em mensagens seguras para o usuário. Erros de configuração (chave,
 * workspace, permissão, saldo) são sinalizados para que a interface oriente a administração.
 */
export function toProviderError(error: unknown): unknown {
  if (!(error instanceof Anthropic.APIError)) return error
  const detail = String((error.error as { error?: { message?: string } } | undefined)?.error?.message ?? error.message ?? '')
  const status = error.status ?? 0
  if (/workspace/i.test(detail)) {
    return new LlmProviderError(
      'A chave da API Anthropic não está vinculada a um workspace. Crie uma chave dentro de um workspace no Console da Anthropic ou informe ANTHROPIC_WORKSPACE_ID no servidor.',
      true,
      { cause: error },
    )
  }
  if (status === 401) return new LlmProviderError('Chave da API Anthropic inválida ou revogada (ANTHROPIC_API_KEY).', true, { cause: error })
  if (status === 403) return new LlmProviderError('A chave da API Anthropic não tem permissão para este modelo ou recurso.', true, { cause: error })
  if (status === 404) return new LlmProviderError(`Modelo não encontrado para esta chave (ANTHROPIC_MODEL).`, true, { cause: error })
  if (status === 400 && /credit|balance|billing/i.test(detail)) {
    return new LlmProviderError('Saldo insuficiente na conta da Anthropic (Console → Billing).', true, { cause: error })
  }
  if (status === 429) return new LlmProviderError('Limite de requisições do provedor de IA atingido. Aguarde alguns instantes.', false, { cause: error })
  if (status === 529 || status >= 500) return new LlmProviderError('O provedor de IA está temporariamente indisponível. Tente novamente em instantes.', false, { cause: error })
  return new LlmProviderError(`O provedor de IA rejeitou a requisição (HTTP ${status}).`, status === 400, { cause: error })
}

function usageFrom(message: { usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null } }): Usage {
  return {
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
  }
}

function mapStop(reason: string | null | undefined): StopReason {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'end_turn'
    case 'tool_use':
      return 'tool_use'
    case 'max_tokens':
      return 'max_tokens'
    case 'refusal':
      return 'refusal'
    case 'pause_turn':
      return 'pause'
    default:
      return 'other'
  }
}

class AnthropicSession implements LlmSession {
  private readonly messages: Anthropic.Beta.BetaMessageParam[]
  private readonly tools: Anthropic.Beta.BetaTool[]
  private readonly system: Anthropic.Beta.BetaTextBlockParam[]

  constructor(
    private readonly client: Anthropic,
    private readonly model: string,
    private readonly options: StartSessionOptions,
  ) {
    // Prefixo estável (ferramentas + sistema) em cache por 1h: instituições usam o assistente de
    // forma esparsa, então o TTL padrão de 5 min expiraria entre mensagens na maioria das sessões.
    this.system = [{ type: 'text', text: options.system, cache_control: { type: 'ephemeral', ttl: '1h' } }]
    this.tools = options.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Beta.BetaTool['input_schema'],
      eager_input_streaming: true,
    }))
    // Conteúdo em blocos (não string) para permitir marcar o cache_control dinâmico em runTurn.
    this.messages = options.history.map((m) => ({ role: m.role, content: [{ type: 'text' as const, text: m.text }] }))
    const userContent: Anthropic.Beta.BetaTextBlockParam[] = []
    if (options.contextPreamble) userContent.push({ type: 'text', text: options.contextPreamble })
    userContent.push({ type: 'text', text: options.userMessage })
    this.messages.push({ role: 'user', content: userContent })
  }

  /**
   * Marca a última mensagem como ponto de cache (o histórico até aqui já foi cacheado no turno
   * anterior, com o mesmo conteúdo em bytes). Evita reprocessar a conversa inteira a cada rodada
   * do loop de ferramentas. Não persiste a marca em `this.messages` para não acumular breakpoints
   * além do limite de 4 por requisição.
   */
  private messagesWithCacheBreakpoint(): Anthropic.Beta.BetaMessageParam[] {
    if (this.messages.length === 0) return this.messages
    const last = this.messages[this.messages.length - 1]
    if (last.role === 'system') return this.messages
    const content = Array.isArray(last.content) ? [...last.content] : [{ type: 'text' as const, text: String(last.content) }]
    if (content.length === 0) return this.messages
    const lastIndex = content.length - 1
    content[lastIndex] = { ...content[lastIndex], cache_control: { type: 'ephemeral' } } as (typeof content)[number]
    return [...this.messages.slice(0, -1), { ...last, content }]
  }

  async runTurn({ onText, signal }: { onText: (delta: string) => void; signal?: AbortSignal }): Promise<TurnResult> {
    const useFallback = env.llm.refusalFallback && SUPPORTS_SERVER_FALLBACK.test(this.model)
    let jsonRetries = 0
    for (;;) {
      const stream = this.client.beta.messages.stream(
        {
          model: this.model,
          max_tokens: this.options.maxTokens ?? 32_000,
          system: this.system,
          tools: this.tools,
          messages: this.messagesWithCacheBreakpoint(),
          thinking: { type: 'adaptive' },
          output_config: { effort: env.llm.anthropicEffort },
          ...(useFallback ? { betas: [FALLBACK_BETA], fallbacks: 'default' as const } : {}),
        },
        { signal },
      )
      stream.on('text', (delta) => onText(delta))

      let message: Anthropic.Beta.BetaMessage
      try {
        message = await stream.finalMessage()
      } catch (error) {
        // Com eager_input_streaming, uma entrada de ferramenta malformada rejeita o turno: reemite (no máximo 2x).
        if (error instanceof Anthropic.APIError) throw toProviderError(error)
        if (signal?.aborted || jsonRetries++ >= 2) throw error
        continue
      }

      const toolCalls = message.content
        .filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
        .map((b) => ({ id: b.id, name: b.name, input: b.input }))
      const text = message.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
      const stopReason = mapStop(message.stop_reason)

      // O histórico é apenas acrescido (preserva blocos de raciocínio e o cache de prompt).
      if (stopReason === 'tool_use' || stopReason === 'pause') {
        this.messages.push({ role: 'assistant', content: message.content })
      }

      const details = (message as unknown as { stop_details?: { category?: string | null; explanation?: string | null } | null }).stop_details
      return {
        stopReason,
        text,
        toolCalls: stopReason === 'tool_use' ? toolCalls : [],
        usage: usageFrom(message),
        model: message.model,
        refusal: stopReason === 'refusal' ? { category: details?.category ?? null, explanation: details?.explanation ?? null } : undefined,
      }
    }
  }

  addToolResults(results: ToolResultInput[]) {
    // Todos os resultados do turno em uma única mensagem (preserva chamadas paralelas).
    this.messages.push({
      role: 'user',
      content: results.map((r) => ({
        type: 'tool_result' as const,
        tool_use_id: r.callId,
        content: r.content,
        ...(r.isError ? { is_error: true } : {}),
      })),
    })
  }
}

export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic'
  readonly model: string
  private readonly client: Anthropic

  constructor(apiKey: string, model: string, workspaceId?: string | null) {
    // Chaves não vinculadas a um workspace exigem o cabeçalho anthropic-workspace-id.
    this.client = new Anthropic({ apiKey, maxRetries: 2, defaultHeaders: workspaceId ? { 'anthropic-workspace-id': workspaceId } : undefined })
    this.model = model
  }

  startSession(options: StartSessionOptions): LlmSession {
    return new AnthropicSession(this.client, this.model, options)
  }

  async extractStructured<T>({ system, prompt, schema, maxTokens, signal }: {
    system: string
    prompt: string
    schema: z.ZodType<T>
    maxTokens?: number
    signal?: AbortSignal
  }) {
    const response = await this.client.messages
      .parse(
        {
          model: this.model,
          max_tokens: maxTokens ?? 8_000,
          system,
          messages: [{ role: 'user', content: prompt }],
          output_config: { format: zodOutputFormat(schema as z.ZodType), effort: 'low' },
        },
        { signal },
      )
      .catch((error: unknown) => {
        throw toProviderError(error)
      })
    if (response.stop_reason === 'refusal') throw new LlmRefusalError(null)
    if (response.parsed_output === null || response.parsed_output === undefined) {
      throw new Error('O modelo não retornou uma estrutura válida.')
    }
    return { data: response.parsed_output as T, usage: usageFrom(response), model: response.model }
  }

  async transcribePdf({ pdf, instructions, signal }: { pdf: Uint8Array; instructions: string; signal?: AbortSignal }) {
    const stream = this.client.messages.stream(
      {
        model: this.model,
        max_tokens: 32_000,
        output_config: { effort: 'low' },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from(pdf).toString('base64') } },
              { type: 'text', text: instructions },
            ],
          },
        ],
      },
      { signal },
    )
    const message = await stream.finalMessage().catch((error: unknown) => {
      throw toProviderError(error)
    })
    if (message.stop_reason === 'refusal') throw new LlmRefusalError(null)
    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
    return { text, usage: usageFrom(message), model: message.model }
  }
}
