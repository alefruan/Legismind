import { z } from 'zod'
import { parseBRLExpression, type Cents } from '../money.js'

/** Estrutura extraída de um pedido em linguagem natural (via LLM ou heurística). */
export const amendmentIntentSchema = z.object({
  intent: z.enum(['create_amendment', 'consult_allocation', 'analyze_bill', 'draft_document', 'legal_question', 'other']),
  amendmentType: z.enum(['individual_impositiva', 'remanejamento', 'outra', 'nao_informado']),
  object: z.string().nullable(),
  purpose: z.string().nullable(),
  amountCents: z.number().int().positive().nullable(),
  policyArea: z.string().nullable(),
  functionCodeHints: z.array(z.string().regex(/^\d{2}$/)).max(4),
  subfunctionCodeHints: z.array(z.string().regex(/^\d{3}$/)).max(6),
  searchTerms: z.array(z.string()).max(8),
  beneficiaryType: z.enum(['none', 'osc', 'public_entity', 'own_administration', 'other', 'nao_informado']),
  beneficiaryName: z.string().nullable(),
  beneficiaryCnpj: z.string().nullable(),
  transferInstrument: z.enum(['termo_fomento', 'termo_colaboracao', 'acordo_cooperacao', 'convenio', 'transferencia_fundo_a_fundo', 'aplicacao_direta', 'outro', 'nao_informado']),
  fiscalYear: z.number().int().min(2000).max(2100).nullable(),
  missingInformation: z.array(z.string()).max(10),
})

export type AmendmentIntent = z.infer<typeof amendmentIntentSchema>

interface AreaHint {
  pattern: RegExp
  area: string
  functions: string[]
  subfunctions: string[]
  terms: string[]
}

/**
 * Dicas de área de política pública → função/subfunção (Portaria MOG nº 42/1999).
 * São apenas pistas de busca: a classificação final sempre vem da dotação oficial.
 */
const areaHints: AreaHint[] = [
  { pattern: /\b(esport|desport|futebol|quadra|atleta|olimp|jogos)/, area: 'Desporto e Lazer', functions: ['27'], subfunctions: ['812'], terms: ['esporte', 'esportivo', 'desporto'] },
  { pattern: /\blazer\b/, area: 'Desporto e Lazer', functions: ['27'], subfunctions: ['813'], terms: ['lazer'] },
  { pattern: /\b(crianc|adolescen|infanc|juvent)/, area: 'Assistência à Criança e ao Adolescente', functions: ['08'], subfunctions: ['243'], terms: ['criança', 'adolescente'] },
  { pattern: /\b(saude|ubs|hospital|posto de saude|medic)/, area: 'Saúde', functions: ['10'], subfunctions: ['301', '302'], terms: ['saúde'] },
  { pattern: /\b(escola|educac|ensino|creche|alun)/, area: 'Educação', functions: ['12'], subfunctions: ['361', '365'], terms: ['educação', 'ensino'] },
  { pattern: /\b(cultur|teatro|musica|artist|patrimonio)/, area: 'Cultura', functions: ['13'], subfunctions: ['392'], terms: ['cultura', 'cultural'] },
  { pattern: /\b(assistencia social|vulnerab|idos|cras|creas)/, area: 'Assistência Social', functions: ['08'], subfunctions: ['244', '241'], terms: ['assistência social'] },
  { pattern: /\b(pavimenta|asfalt|via|calcad|ilumina|praca)/, area: 'Urbanismo', functions: ['15'], subfunctions: ['451', '452'], terms: ['vias', 'urbana'] },
]

const oscPattern = /\b(ong|osc|organizac(ao|oes) da sociedade civil|entidade|associac|instituto|fundac|sem fins lucrativos|ong's)\b/

function normalize(text: string) {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/**
 * Extração determinística (sem LLM) usada como base, fallback e verificação
 * cruzada da interpretação do modelo — especialmente do valor monetário.
 */
export function extractIntentHeuristics(text: string, defaults: { fiscalYear?: number | null } = {}): AmendmentIntent {
  const norm = normalize(text)
  const amountCents: Cents | null = parseBRLExpression(text)
  const matched = areaHints.filter((h) => h.pattern.test(norm))
  const isOsc = oscPattern.test(norm)
  const isAmendment = /\b(emenda|destinar|destinacao|alocar|repassar|recurso)/.test(norm)
  const isConsult = /\b(consultar|dotac|quanto (ha|tem)|programa|acao orcament)/.test(norm)
  const yearMatch = /\b(20[2-9]\d)\b/.exec(norm)

  const missing: string[] = []
  if (isAmendment && amountCents === null) missing.push('valor da emenda')
  if (isAmendment && matched.length === 0) missing.push('área ou objeto da política pública')
  if (isOsc) missing.push('nome e CNPJ da organização beneficiária')

  return {
    intent: isAmendment ? 'create_amendment' : isConsult ? 'consult_allocation' : 'other',
    amendmentType: /\bremanejament/.test(norm) ? 'remanejamento' : /\bimpositiv|individual/.test(norm) ? 'individual_impositiva' : 'nao_informado',
    object: isAmendment ? text.trim().slice(0, 400) : null,
    purpose: null,
    amountCents,
    policyArea: matched[0]?.area ?? null,
    functionCodeHints: [...new Set(matched.flatMap((m) => m.functions))].slice(0, 4),
    subfunctionCodeHints: [...new Set(matched.flatMap((m) => m.subfunctions))].slice(0, 6),
    searchTerms: [...new Set(matched.flatMap((m) => m.terms).concat(isOsc ? ['organizações da sociedade civil'] : []))].slice(0, 8),
    beneficiaryType: isOsc ? 'osc' : 'nao_informado',
    beneficiaryName: null,
    beneficiaryCnpj: null,
    transferInstrument: isOsc ? 'termo_fomento' : 'nao_informado',
    fiscalYear: yearMatch ? Number(yearMatch[1]) : defaults.fiscalYear ?? null,
    missingInformation: missing,
  }
}
