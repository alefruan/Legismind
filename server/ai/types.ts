import type { z } from 'zod'

/**
 * Contratos independentes de provedor. O orquestrador do assistente e as
 * ferramentas só conhecem estes tipos; cada provedor (Anthropic hoje, outros
 * no futuro) traduz para o seu formato nativo.
 */

export interface ToolSpec {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface HistoryMessage {
  role: 'user' | 'assistant'
  text: string
}

export interface ToolCall {
  id: string
  name: string
  input: unknown
}

export interface Usage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
}

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'pause' | 'other'

export interface TurnResult {
  stopReason: StopReason
  text: string
  toolCalls: ToolCall[]
  usage: Usage
  model: string
  refusal?: { category: string | null; explanation: string | null }
}

export interface ToolResultInput {
  callId: string
  content: string
  isError?: boolean
}

export interface LlmSession {
  runTurn(opts: { onText: (delta: string) => void; signal?: AbortSignal }): Promise<TurnResult>
  addToolResults(results: ToolResultInput[]): void
}

export interface StartSessionOptions {
  system: string
  tools: ToolSpec[]
  history: HistoryMessage[]
  userMessage: string
  /** Contexto operacional da sessão (data, instituição, exercício). */
  contextPreamble?: string
  maxTokens?: number
}

export interface LlmProvider {
  readonly name: string
  readonly model: string
  startSession(options: StartSessionOptions): LlmSession
  extractStructured<T>(options: {
    system: string
    prompt: string
    schema: z.ZodType<T>
    maxTokens?: number
    signal?: AbortSignal
  }): Promise<{ data: T; usage: Usage; model: string }>
  transcribePdf(options: { pdf: Uint8Array; instructions: string; signal?: AbortSignal }): Promise<{ text: string; usage: Usage; model: string }>
}

export class LlmRefusalError extends Error {
  constructor(public readonly category: string | null) {
    super('O modelo recusou a solicitação.')
  }
}

/** Falha do provedor com mensagem segura para o usuário (sem segredos) e indicação de erro de configuração. */
export class LlmProviderError extends Error {
  constructor(
    message: string,
    public readonly configuration: boolean,
    options?: { cause?: unknown },
  ) {
    super(message, options)
  }
}

export const emptyUsage = (): Usage => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 })

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  }
}
