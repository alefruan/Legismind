import { formatBRL, type Cents } from '../money.js'
import { isContingencyReserve } from '../budget/codes.js'
import {
  checkProtection,
  checkSourceCompatibility,
  computeAvailability,
  parseRuleParams,
  ruleParamSchemas,
  type Availability,
} from './rules.js'
import type { AllocationFacts, Commitments, RuleDefinition } from './types.js'
import type { z } from 'zod'

export interface CandidateInput {
  allocation: AllocationFacts
  commitments: Commitments
}

export interface DestinationSource {
  code: string | null
  isEarmarked: boolean | null
}

export interface CandidateEvaluation {
  allocation: AllocationFacts
  eligible: boolean
  exclusionReasons: string[]
  warnings: string[]
  availability: Availability
  score: number
}

export interface CancellationPlanItem {
  allocationId: string
  amountCents: Cents
  programmaticCode: string
  expenseNature: string
  sourceCode: string
  availabilityBasis: Availability['basis']
}

export interface CancellationAnalysis {
  requestedCents: Cents
  eligible: CandidateEvaluation[]
  excluded: CandidateEvaluation[]
  /** Sugestão de composição — sempre sujeita à aprovação explícita do gabinete. */
  suggestion: CancellationPlanItem[]
  coveredCents: Cents
  notes: string[]
  rulesApplied: Array<{ code: string; version: number }>
}

type ProtectedParams = z.infer<(typeof ruleParamSchemas)['protected_expenses']>
type SourceParams = z.infer<(typeof ruleParamSchemas)['source_compatibility']>

function findParams<T>(rules: RuleDefinition[], type: string): { params: T; rule: RuleDefinition } | null {
  const rule = rules.find((r) => r.ruleType === type)
  if (!rule) return null
  const parsed = parseRuleParams(rule)
  if (!parsed.ok) return null
  return { params: parsed.parsed.params as T, rule }
}

/**
 * Identifica dotações potencialmente elegíveis para anulação compensatória.
 * Aplica as mesmas regras do motor de validação (despesas protegidas e fontes),
 * nunca presume que o valor total da dotação está disponível e retorna as
 * exclusões com justificativa para auditoria.
 */
export function analyzeCancellationCandidates(input: {
  requestedCents: Cents
  fiscalYearId: string
  destinationSources: DestinationSource[]
  candidates: CandidateInput[]
  rules: RuleDefinition[]
  excludeAllocationIds?: string[]
}): CancellationAnalysis {
  const notes: string[] = []
  const rulesApplied: Array<{ code: string; version: number }> = []

  const protectedRule = findParams<ProtectedParams>(input.rules, 'protected_expenses')
  const sourceRule = findParams<SourceParams>(input.rules, 'source_compatibility')
  const withinRule = findParams<{ consider_pending_commitments: boolean }>(input.rules, 'cancellation_within_allocation')

  const protectedParams: ProtectedParams = protectedRule?.params ?? ruleParamSchemas.protected_expenses.parse({})
  if (protectedRule) rulesApplied.push({ code: protectedRule.rule.code, version: protectedRule.rule.version })
  else notes.push('Regra de despesas protegidas não configurada: aplicada a proteção constitucional padrão (pessoal, dívida e transferências constitucionais), sujeita a confirmação.')

  const sourceMode: SourceParams['mode'] = sourceRule?.params.mode ?? 'same_or_unearmarked'
  if (sourceRule) rulesApplied.push({ code: sourceRule.rule.code, version: sourceRule.rule.version })
  else notes.push('Regra de compatibilidade de fontes não configurada: exigida fonte idêntica ou ambas não vinculadas.')

  const considerPending = withinRule?.params.consider_pending_commitments ?? true

  const excludeIds = new Set(input.excludeAllocationIds ?? [])
  const evaluations: CandidateEvaluation[] = input.candidates.map(({ allocation, commitments }) => {
    const reasons: string[] = []
    const warnings: string[] = []

    if (excludeIds.has(allocation.id)) reasons.push('Dotação já utilizada nesta emenda (destino ou anulação).')
    if (allocation.fiscalYearId !== input.fiscalYearId) reasons.push('Dotação de outro exercício.')
    if (!allocation.isCurrent) reasons.push('Dotação de versão substituída do orçamento.')
    if (allocation.verificationStatus === 'rejected') reasons.push('Dotação rejeitada na conferência.')
    if (allocation.verificationStatus === 'pending_review') warnings.push('Dotação extraída automaticamente, ainda não conferida.')

    const protection = checkProtection(allocation, protectedParams)
    if (protection.protected) reasons.push(protection.reason!)

    for (const destination of input.destinationSources) {
      const verdict = checkSourceCompatibility({ code: allocation.sourceCode, isEarmarked: allocation.sourceIsEarmarked }, destination, sourceMode)
      if (verdict.outcome === 'inconsistent') reasons.push(verdict.reason)
      if (verdict.outcome === 'not_verifiable') warnings.push(verdict.reason)
    }

    const availability = computeAvailability(allocation, commitments, considerPending)
    if (availability.maxCents <= 0) reasons.push('Sem valor disponível após compromissos de outras emendas.')
    if (availability.basis === 'estimated_from_authorized') {
      warnings.push('Sem saldo oficial: disponibilidade estimada a partir do valor autorizado, exige confirmação humana.')
    }
    if (commitments.pendingCents > 0) {
      warnings.push(`${commitments.amendmentsCount} outra(s) emenda(s) indicam esta dotação (${formatBRL(commitments.pendingCents + commitments.firmCents)}).`)
    }

    // Pontuação: reserva específica para emendas, saldo oficial, dados conferidos e folga de valor.
    let score = 0
    if (isContingencyReserve(allocation.expenseNature) && allocation.extraIdentifiers['reserva_emendas'] === true) score += 50
    if (availability.basis === 'official_balance') score += 15
    if (allocation.verificationStatus === 'confirmed') score += 15
    if (input.destinationSources.every((d) => d.code === allocation.sourceCode)) score += 10
    if (availability.maxCents >= input.requestedCents) score += 10
    score += Math.min(10, Math.log10(Math.max(1, availability.maxCents / 100)))

    return { allocation, eligible: reasons.length === 0, exclusionReasons: reasons, warnings, availability, score }
  })

  const eligible = evaluations.filter((e) => e.eligible).sort((a, b) => b.score - a.score)
  const excluded = evaluations.filter((e) => !e.eligible)

  // Composição sugerida: preferir uma única dotação que cubra o valor; senão, somar as melhores.
  const suggestion: CancellationPlanItem[] = []
  let remaining = input.requestedCents
  const single = eligible.find((e) => e.availability.maxCents >= input.requestedCents)
  const ordered = single ? [single] : eligible
  for (const candidate of ordered) {
    if (remaining <= 0) break
    const take = Math.min(remaining, candidate.availability.maxCents)
    if (take <= 0) continue
    suggestion.push({
      allocationId: candidate.allocation.id,
      amountCents: take,
      programmaticCode: candidate.allocation.programmaticCode,
      expenseNature: candidate.allocation.expenseNature,
      sourceCode: candidate.allocation.sourceCode,
      availabilityBasis: candidate.availability.basis,
    })
    remaining -= take
  }
  const covered = input.requestedCents - Math.max(0, remaining)
  if (eligible.length === 0) {
    notes.push('Nenhuma dotação elegível encontrada nos dados estruturados. Verifique se o orçamento foi importado e conferido.')
  } else if (remaining > 0) {
    notes.push(`As dotações elegíveis cobrem ${formatBRL(covered)} de ${formatBRL(input.requestedCents)} solicitados.`)
  }
  notes.push('A sugestão não é definitiva: cada anulação exige justificativa e aprovação explícita do gabinete.')

  return { requestedCents: input.requestedCents, eligible, excluded, suggestion, coveredCents: covered, notes, rulesApplied }
}
