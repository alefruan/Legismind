import { z } from 'zod'
import { extractIntentHeuristics } from '../../shared/domain/amendments/intent.js'
import type { BudgetAllocationViewRow, FiscalYearRow } from '../../shared/types/db.js'
import { getLlmProvider } from '../ai/providers/index.js'
import { LlmRefusalError } from '../ai/types.js'
import { env } from '../env.js'
import { rateLimit, requireOrgMember, type RequestContext } from '../http/auth.js'
import { badRequest, HttpError, notFound } from '../http/errors.js'
import { unwrap } from '../supabase.js'

export const nlQueryRequestSchema = z.object({
  organizationId: z.string().uuid(),
  fiscalYearId: z.string().uuid().nullish(),
  question: z.string().trim().min(3).max(500),
})

/**
 * Esquema "frouxo" entregue ao modelo (saídas estruturadas aceitam um subconjunto
 * de JSON Schema). O resultado é revalidado com o esquema estrito antes da consulta.
 */
const llmFilterSchema = z.object({
  search_text: z.string().nullable(),
  function_codes: z.array(z.string()),
  subfunction_codes: z.array(z.string()),
  modality_codes: z.array(z.string()),
  group_codes: z.array(z.string()),
  fiscal_year: z.number().nullable(),
  min_amount: z.number().nullable(),
  only_confirmed: z.boolean(),
  explanation: z.string(),
})

const strictFilters = z.object({
  search_text: z.string().max(200).nullable(),
  function_codes: z.array(z.string().regex(/^\d{2}$/)).max(10),
  subfunction_codes: z.array(z.string().regex(/^\d{3}$/)).max(10),
  modality_codes: z.array(z.string().regex(/^\d{2}$/)).max(10),
  group_codes: z.array(z.string().regex(/^\d$/)).max(6),
  fiscal_year: z.number().int().min(2000).max(2100).nullable(),
  min_amount: z.number().nonnegative().nullable(),
  only_confirmed: z.boolean(),
  explanation: z.string().max(600),
})

export type BudgetFilters = z.infer<typeof strictFilters>

const SYSTEM = `Você converte perguntas sobre orçamento público brasileiro em FILTROS de busca para uma base estruturada de dotações.
Regras:
- Não responda à pergunta; apenas produza os filtros.
- Use códigos de função (2 dígitos) e subfunção (3 dígitos) da Portaria MOG nº 42/1999 somente quando houver correspondência clara (ex.: esporte → função 27, subfunções 811/812/813; saúde → 10; educação → 12; assistência social → 08; criança e adolescente → subfunção 243).
- Modalidade de aplicação 50 = instituições privadas sem fins lucrativos; 90 = aplicação direta.
- Grupos de natureza: 1 pessoal, 3 outras despesas correntes, 4 investimentos.
- search_text: poucas palavras-chave em português, sem pontuação.
- explanation: uma frase explicando os filtros escolhidos.
- Se a pergunta não tratar de orçamento, deixe filtros vazios e explique.`

export async function runBudgetNlQuery(ctx: RequestContext, raw: unknown) {
  const input = nlQueryRequestSchema.parse(raw)
  await requireOrgMember(ctx, input.organizationId)
  await rateLimit(ctx, `budget-nl:${ctx.user.id}`, env.limits.apiPerMinute)

  const years = unwrap(
    await ctx.db.from('fiscal_years').select('*').eq('organization_id', input.organizationId).order('year', { ascending: false }),
  ) as FiscalYearRow[]
  if (years.length === 0) throw notFound('A instituição ainda não possui exercícios cadastrados.')

  let filters: BudgetFilters
  let mode: 'llm' | 'heuristic' = 'heuristic'
  const provider = getLlmProvider()
  if (provider) {
    try {
      const result = await provider.extractStructured({
        system: SYSTEM,
        prompt: `Pergunta: ${input.question}\nExercícios disponíveis: ${years.map((y) => y.year).join(', ')}`,
        schema: llmFilterSchema,
        maxTokens: 2_000,
      })
      const checked = strictFilters.safeParse({
        ...result.data,
        function_codes: result.data.function_codes.filter((c) => /^\d{2}$/.test(c)).slice(0, 10),
        subfunction_codes: result.data.subfunction_codes.filter((c) => /^\d{3}$/.test(c)).slice(0, 10),
        modality_codes: result.data.modality_codes.filter((c) => /^\d{2}$/.test(c)).slice(0, 10),
        group_codes: result.data.group_codes.filter((c) => /^\d$/.test(c)).slice(0, 6),
        search_text: result.data.search_text?.slice(0, 200) ?? null,
        explanation: result.data.explanation.slice(0, 600),
      })
      if (!checked.success) throw badRequest('A interpretação da pergunta gerou filtros inválidos.')
      filters = checked.data
      mode = 'llm'
      await ctx.admin.from('ai_usage').insert({
        organization_id: input.organizationId,
        user_id: ctx.user.id,
        feature: 'budget_nl_query',
        provider: provider.name,
        model: result.model,
        input_tokens: result.usage.inputTokens,
        output_tokens: result.usage.outputTokens,
        cache_read_tokens: result.usage.cacheReadTokens,
      })
    } catch (error) {
      if (error instanceof HttpError) throw error
      if (!(error instanceof LlmRefusalError)) console.error('[budget-nl]', error)
      filters = heuristicFilters(input.question)
    }
  } else {
    filters = heuristicFilters(input.question)
  }

  const fiscalYear =
    (filters.fiscal_year ? years.find((y) => y.year === filters.fiscal_year) : null) ??
    (input.fiscalYearId ? years.find((y) => y.id === input.fiscalYearId) : null) ??
    years.find((y) => y.is_active) ??
    years[0]!

  const run = async (f: BudgetFilters) =>
    unwrap(
      await ctx.db.rpc('search_budget_allocations', {
        p_fiscal_year_id: fiscalYear.id,
        p_query: f.search_text,
        p_function_codes: f.function_codes.length ? f.function_codes : null,
        p_subfunction_codes: f.subfunction_codes.length ? f.subfunction_codes : null,
        p_modality_codes: f.modality_codes.length ? f.modality_codes : null,
        p_group_codes: f.group_codes.length ? f.group_codes : null,
        p_source_codes: null,
        p_min_amount: f.min_amount,
        p_only_confirmed: f.only_confirmed,
        p_limit: 50,
      }),
    ) as Array<BudgetAllocationViewRow & { relevance: number }>

  let rows = await run(filters)
  let relaxed = false
  if (rows.length === 0 && filters.subfunction_codes.length) {
    rows = await run({ ...filters, subfunction_codes: [] })
    relaxed = rows.length > 0
  }

  return {
    mode,
    fiscalYear: { id: fiscalYear.id, year: fiscalYear.year },
    filters,
    relaxed,
    rows,
  }
}

function heuristicFilters(question: string): BudgetFilters {
  const intent = extractIntentHeuristics(question)
  const year = /\b(20[2-9]\d)\b/.exec(question)
  const keywords = question
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !['mostre', 'quero', 'quais', 'sobre', 'relacionados', 'programas', 'orcamento', 'dotacoes', 'acoes'].includes(w) && !/^20\d\d$/.test(w))
  return {
    search_text: keywords.slice(0, 6).join(' ') || null,
    function_codes: intent.functionCodeHints,
    subfunction_codes: [],
    modality_codes: [],
    group_codes: [],
    fiscal_year: year ? Number(year[1]) : null,
    min_amount: null,
    only_confirmed: false,
    explanation: 'Interpretação automática por palavras-chave (sem IA).',
  }
}
