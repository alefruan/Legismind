import { env } from '../../env.js'
import type { LlmProvider } from '../types.js'
import { AnthropicProvider } from './anthropic.js'

let cached: { key: string; provider: LlmProvider } | null = null

/**
 * Seleciona o provedor de LLM pela configuração (LLM_PROVIDER).
 * Para adicionar outro provedor, implemente LlmProvider e registre-o aqui.
 */
export function getLlmProvider(): LlmProvider | null {
  const provider = env.llm.provider
  if (provider === 'anthropic') {
    const apiKey = env.llm.anthropicApiKey
    if (!apiKey) return null
    const workspaceId = env.llm.anthropicWorkspaceId
    const key = `anthropic:${env.llm.anthropicModel}:${workspaceId ?? ''}`
    if (cached?.key !== key) cached = { key, provider: new AnthropicProvider(apiKey, env.llm.anthropicModel, workspaceId) }
    return cached.provider
  }
  return null
}

export function describeLlmConfiguration() {
  const provider = env.llm.provider
  const configured = getLlmProvider() !== null
  return {
    provider,
    model: provider === 'anthropic' ? env.llm.anthropicModel : null,
    configured,
    missing: configured ? null : provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : `Provedor "${provider}" não suportado`,
  }
}
