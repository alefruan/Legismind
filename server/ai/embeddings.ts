import { EMBEDDING_DIMENSIONS, env } from '../env.js'

/**
 * Embeddings para a busca semântica (pgvector, 1024 dimensões).
 * Provedores: Voyage AI (recomendado) ou OpenAI. Sem provedor configurado,
 * a Base Legislativa funciona apenas com busca textual e filtros estruturados.
 */
export interface EmbeddingProvider {
  name: string
  model: string
  embed(texts: string[], kind: 'document' | 'query'): Promise<number[][]>
}

async function postJson(url: string, apiKey: string, body: unknown) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Falha no provedor de embeddings (${response.status}): ${text.slice(0, 200)}`)
  }
  return (await response.json()) as { data: Array<{ embedding: number[]; index: number }> }
}

function sortByIndex(data: Array<{ embedding: number[]; index: number }>) {
  return [...data].sort((a, b) => a.index - b.index).map((d) => d.embedding)
}

function assertDimensions(vectors: number[][]) {
  for (const v of vectors) {
    if (v.length !== EMBEDDING_DIMENSIONS) throw new Error(`Embedding com ${v.length} dimensões; esperado ${EMBEDDING_DIMENSIONS}.`)
  }
  return vectors
}

export function getEmbeddingProvider(): EmbeddingProvider | null {
  const provider = env.embeddings.provider
  if (provider === 'voyage' && env.embeddings.voyageApiKey) {
    const apiKey = env.embeddings.voyageApiKey
    const model = env.embeddings.voyageModel
    return {
      name: 'voyage',
      model,
      async embed(texts, kind) {
        const result = await postJson('https://api.voyageai.com/v1/embeddings', apiKey, {
          input: texts,
          model,
          input_type: kind,
          output_dimension: EMBEDDING_DIMENSIONS,
        })
        return assertDimensions(sortByIndex(result.data))
      },
    }
  }
  if (provider === 'openai' && env.embeddings.openaiApiKey) {
    const apiKey = env.embeddings.openaiApiKey
    const model = env.embeddings.openaiModel
    return {
      name: 'openai',
      model,
      async embed(texts) {
        const result = await postJson('https://api.openai.com/v1/embeddings', apiKey, { input: texts, model, dimensions: EMBEDDING_DIMENSIONS })
        return assertDimensions(sortByIndex(result.data))
      },
    }
  }
  return null
}

export function toPgVector(vector: number[]): string {
  return `[${vector.map((v) => (Number.isFinite(v) ? v.toFixed(7) : '0')).join(',')}]`
}
