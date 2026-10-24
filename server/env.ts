/**
 * Configuração do servidor. Nenhum segredo é exposto ao frontend: somente
 * variáveis com prefixo VITE_ chegam ao navegador, e elas contêm apenas a URL
 * do Supabase e a chave anônima (protegida por RLS).
 */

function read(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]
    if (value && value.trim()) return value.trim()
  }
  return undefined
}

export class ConfigError extends Error {
  constructor(public readonly variable: string) {
    super(`Variável de ambiente ausente: ${variable}`)
  }
}

function required(...names: string[]): string {
  const value = read(...names)
  if (!value) throw new ConfigError(names[0]!)
  return value
}

function int(name: string, fallback: number): number {
  const value = Number(read(name))
  return Number.isFinite(value) && value > 0 ? value : fallback
}

export const env = {
  get supabaseUrl() {
    return required('SUPABASE_URL', 'VITE_SUPABASE_URL')
  },
  get supabaseAnonKey() {
    return required('SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY')
  },
  get supabaseServiceRoleKey() {
    return required('SUPABASE_SERVICE_ROLE_KEY')
  },
  get appUrl() {
    return read('APP_URL') ?? 'http://localhost:5173'
  },
  get cronSecret() {
    return read('CRON_SECRET')
  },
  llm: {
    get provider() {
      return (read('LLM_PROVIDER') ?? 'anthropic').toLowerCase()
    },
    get anthropicApiKey() {
      return read('ANTHROPIC_API_KEY')
    },
    /** Necessário apenas para chaves de API não vinculadas a um workspace (cabeçalho anthropic-workspace-id). */
    get anthropicWorkspaceId() {
      return read('ANTHROPIC_WORKSPACE_ID')
    },
    get anthropicModel() {
      return read('ANTHROPIC_MODEL') ?? 'claude-opus-5-5'
    },
    get anthropicEffort(): 'low' | 'medium' | 'high' | 'xhigh' | 'max' {
      const value = (read('ANTHROPIC_EFFORT') ?? 'high').toLowerCase()
      return (['low', 'medium', 'high', 'xhigh', 'max'].includes(value) ? value : 'high') as 'high'
    },
    get refusalFallback() {
      return (read('ANTHROPIC_REFUSAL_FALLBACK') ?? 'default') !== 'off'
    },
    get maxToolRounds() {
      return int('ASSISTANT_MAX_TOOL_ROUNDS', 10)
    },
  },
  embeddings: {
    get provider() {
      return (read('EMBEDDINGS_PROVIDER') ?? 'none').toLowerCase()
    },
    get voyageApiKey() {
      return read('VOYAGE_API_KEY')
    },
    get voyageModel() {
      return read('VOYAGE_EMBEDDINGS_MODEL') ?? 'voyage-3.5'
    },
    get openaiApiKey() {
      return read('OPENAI_API_KEY')
    },
    get openaiModel() {
      return read('OPENAI_EMBEDDINGS_MODEL') ?? 'text-embedding-3-small'
    },
  },
  ocr: {
    get provider() {
      return (read('OCR_PROVIDER') ?? 'none').toLowerCase()
    },
    get httpEndpoint() {
      return read('OCR_HTTP_ENDPOINT')
    },
    get httpApiKey() {
      return read('OCR_HTTP_API_KEY')
    },
  },
  limits: {
    get chatPerMinute() {
      return int('RATE_LIMIT_CHAT_PER_MINUTE', 12)
    },
    get apiPerMinute() {
      return int('RATE_LIMIT_API_PER_MINUTE', 60)
    },
    get workerBudgetMs() {
      return int('WORKER_TIME_BUDGET_MS', 25_000)
    },
    get cronWorkerBudgetMs() {
      return int('CRON_WORKER_TIME_BUDGET_MS', 240_000)
    },
  },
}

export const EMBEDDING_DIMENSIONS = 1024
