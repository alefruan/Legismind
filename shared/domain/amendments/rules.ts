import { z } from 'zod'
import { formatBRL, toCents, type Cents } from '../money.js'
import { isContingencyReserve, isValidCnpj } from '../budget/codes.js'
import type {
  AllocationFacts,
  AmendmentFacts,
  CancellationFacts,
  CheckResult,
  Commitments,
  Evidence,
  RuleDefinition,
  ValidationContext,
  ValidationOutcome,
} from './types.js'

// -----------------------------------------------------------------------------
// Parâmetros de cada tipo de regra (validados antes da avaliação)
// -----------------------------------------------------------------------------
const codeList = z.array(z.string().regex(/^\d{1,2}$/))

export const ruleParamSchemas = {
  cancellation_required: z.object({}).passthrough(),
  cancellation_balance: z.object({ tolerance_cents: z.number().int().min(0).max(100).default(0) }),
  protected_expenses: z.object({
    protected_groups: codeList.default(['1', '2', '6']),
    protected_elements: codeList.default(['81']),
    reserve_policy: z.enum(['forbidden', 'allowed', 'only_flagged']).default('only_flagged'),
  }),
  source_compatibility: z.object({ mode: z.enum(['same_source', 'same_or_unearmarked']).default('same_or_unearmarked') }),
  cancellation_within_allocation: z.object({ consider_pending_commitments: z.boolean().default(true) }),
  individual_amendment_limit: z.object({
    percent_of_rcl: z.number().positive().max(100),
    split: z.enum(['equal', 'none']).default('equal'),
    quota_override_amount: z.number().positive().nullable().optional(),
  }),
  health_share_minimum: z.object({
    min_share_percent: z.number().min(0).max(100).default(50),
    health_function_code: z.string().regex(/^\d{2}$/).default('10'),
  }),
  amount_range: z.object({
    min_amount: z.number().nonnegative().nullable().default(null),
    max_amount: z.number().positive().nullable().default(null),
  }),
  osc_transfer_requirements: z.object({
    required_modality: z.string().regex(/^\d{2}$/).default('50'),
    allowed_elements: codeList.default(['41', '42', '43']),
    require_cnpj: z.boolean().default(true),
    ldo_authorization_reference: z.string().min(3).nullable().default(null),
  }),
  ppa_compatibility: z.object({}).passthrough(),
  destination_restrictions: z.object({
    forbidden_groups: codeList.default([]),
    forbidden_elements: codeList.default([]),
  }),
  submission_deadline: z.object({}).passthrough(),
  required_fields: z.object({
    fields: z.array(z.enum(['object', 'purpose', 'justification', 'legal_grounds', 'physical_goal', 'beneficiary_location', 'beneficiary_name'])).min(1),
  }),
} as const

export const requiredFieldLabels: Record<string, string> = {
  object: 'descrição da despesa (objeto)',
  purpose: 'finalidade',
  justification: 'justificativa e interesse público',
  legal_grounds: 'fundamentação',
  physical_goal: 'meta física esperada',
  beneficiary_location: 'localização geográfica / endereço',
  beneficiary_name: 'beneficiário',
}

/** Tipos de regra que também se aplicam a emendas ao texto. */
export const TEXT_AMENDMENT_RULE_TYPES = new Set(['submission_deadline'])

export type RuleType = keyof typeof ruleParamSchemas
export const RULE_TYPES = Object.keys(ruleParamSchemas) as RuleType[]

export function isRuleType(value: string): value is RuleType {
  return value in ruleParamSchemas
}

export const ruleTypeLabels: Record<RuleType, string> = {
  cancellation_required: 'Anulação compensatória obrigatória',
  cancellation_balance: 'Equilíbrio entre destinação e anulação',
  protected_expenses: 'Despesas protegidas contra anulação',
  source_compatibility: 'Compatibilidade de fontes',
  cancellation_within_allocation: 'Anulação limitada ao disponível',
  individual_amendment_limit: 'Limite de emendas individuais',
  health_share_minimum: 'Parcela mínima para saúde',
  amount_range: 'Valor mínimo/máximo por emenda',
  osc_transfer_requirements: 'Requisitos para transferência a OSC',
  ppa_compatibility: 'Compatibilidade com o PPA',
  destination_restrictions: 'Restrições de destinação',
  submission_deadline: 'Prazo de apresentação',
  required_fields: 'Campos obrigatórios do formulário',
}

// -----------------------------------------------------------------------------
// Utilitários compartilhados com o motor de cancelamentos
// -----------------------------------------------------------------------------
const outcomeRank: Record<ValidationOutcome, number> = { validated: 0, pending: 1, not_verifiable: 2, inconsistent: 3 }

export function worstOutcome(outcomes: ValidationOutcome[]): ValidationOutcome {
  return outcomes.reduce<ValidationOutcome>((worst, o) => (outcomeRank[o] > outcomeRank[worst] ? o : worst), 'validated')
}

export function allocationEvidence(a: AllocationFacts): Evidence {
  return {
    kind: 'allocation',
    label: `${a.programmaticCode} · ${a.expenseNature} · Fonte ${a.sourceCode}`,
    allocationId: a.id,
    documentTitle: a.sourceDocumentTitle ?? a.sourceReference,
    page: a.sourcePage,
    value: formatBRL(a.authorizedCents),
  }
}

export interface ProtectionVerdict {
  protected: boolean
  reason: string | null
}

export function checkProtection(allocation: AllocationFacts, params: z.infer<(typeof ruleParamSchemas)['protected_expenses']>): ProtectionVerdict {
  if (isContingencyReserve(allocation.expenseNature)) {
    if (params.reserve_policy === 'forbidden') {
      return { protected: true, reason: 'Reserva de contingência não pode ser anulada pela norma configurada.' }
    }
    if (params.reserve_policy === 'only_flagged' && allocation.extraIdentifiers['reserva_emendas'] !== true) {
      return { protected: true, reason: 'Somente a reserva específica para emendas pode ser anulada; esta é a reserva de contingência geral.' }
    }
    return { protected: false, reason: null }
  }
  if (params.protected_groups.includes(allocation.groupCode)) {
    const labels: Record<string, string> = { '1': 'pessoal e encargos sociais', '2': 'juros e encargos da dívida', '6': 'amortização da dívida' }
    return { protected: true, reason: `Grupo de natureza de despesa ${allocation.groupCode} (${labels[allocation.groupCode] ?? 'protegido'}) não admite anulação.` }
  }
  if (params.protected_elements.includes(allocation.elementCode)) {
    return { protected: true, reason: `Elemento de despesa ${allocation.elementCode} protegido (ex.: transferências constitucionais).` }
  }
  return { protected: false, reason: null }
}

export type SourceVerdict = { outcome: ValidationOutcome; reason: string }

export function checkSourceCompatibility(
  cancellationSource: { code: string; isEarmarked: boolean | null },
  destinationSource: { code: string | null; isEarmarked: boolean | null },
  mode: 'same_source' | 'same_or_unearmarked',
): SourceVerdict {
  if (!destinationSource.code) {
    return { outcome: 'not_verifiable', reason: 'Fonte da programação de destino não informada.' }
  }
  if (cancellationSource.code === destinationSource.code) {
    return { outcome: 'validated', reason: `Mesma fonte (${cancellationSource.code}).` }
  }
  if (mode === 'same_source') {
    return { outcome: 'inconsistent', reason: `Fonte ${cancellationSource.code} difere da fonte de destino ${destinationSource.code}.` }
  }
  if (cancellationSource.isEarmarked === null || destinationSource.isEarmarked === null) {
    return { outcome: 'not_verifiable', reason: 'Não há informação sobre vinculação de uma das fontes.' }
  }
  if (!cancellationSource.isEarmarked && !destinationSource.isEarmarked) {
    return { outcome: 'validated', reason: `Fontes distintas, ambas não vinculadas (${cancellationSource.code} → ${destinationSource.code}).` }
  }
  return {
    outcome: 'inconsistent',
    reason: `Fonte vinculada não pode custear objeto diverso (${cancellationSource.code} → ${destinationSource.code}).`,
  }
}

export interface Availability {
  basis: 'official_balance' | 'estimated_from_authorized'
  baseCents: Cents
  firmCents: Cents
  pendingCents: Cents
  /** Máximo seguro considerando compromissos firmes e pendentes. */
  maxCents: Cents
  /** Máximo considerando apenas compromissos firmes. */
  maxIgnoringPendingCents: Cents
  asOf: string | null
}

export function computeAvailability(allocation: AllocationFacts, commitments: Commitments, considerPending = true): Availability {
  const official = allocation.availableCents !== null
  const base = official ? allocation.availableCents! : allocation.authorizedCents
  const maxIgnoringPending = Math.max(0, base - commitments.firmCents)
  const max = Math.max(0, maxIgnoringPending - (considerPending ? commitments.pendingCents : 0))
  return {
    basis: official ? 'official_balance' : 'estimated_from_authorized',
    baseCents: base,
    firmCents: commitments.firmCents,
    pendingCents: commitments.pendingCents,
    maxCents: max,
    maxIgnoringPendingCents: maxIgnoringPending,
    asOf: official ? allocation.availableAsOf : null,
  }
}

function destinationSourceOf(amendment: AmendmentFacts) {
  const sources = amendment.destinations.map((d) =>
    d.allocation
      ? { code: d.allocation.sourceCode as string | null, isEarmarked: d.allocation.sourceIsEarmarked }
      : { code: d.proposedClassification?.sourceCode ?? null, isEarmarked: null },
  )
  return sources
}

function totalDestinations(a: AmendmentFacts): Cents {
  return a.destinations.reduce((sum, d) => sum + d.amountCents, 0)
}

function totalCancellations(a: AmendmentFacts): Cents {
  return a.cancellations.reduce((sum, c) => sum + c.amountCents, 0)
}

// -----------------------------------------------------------------------------
// Avaliadores
// -----------------------------------------------------------------------------
type Evaluation = Omit<CheckResult, 'checkCode' | 'ruleId' | 'ruleVersion' | 'severity' | 'legalBasis' | 'title'> & { title?: string }
type Evaluator<T extends RuleType> = (params: z.infer<(typeof ruleParamSchemas)[T]>, amendment: AmendmentFacts, ctx: ValidationContext) => Evaluation

const evaluators: { [K in RuleType]: Evaluator<K> } = {
  cancellation_required: (_params, a) => {
    if (!a.modality.requiresCancellation) {
      return { outcome: 'validated', message: `A modalidade "${a.modality.name}" não exige anulação compensatória.` }
    }
    if (a.cancellations.length === 0) {
      return { outcome: 'pending', message: 'Indique a dotação a ser anulada para custear a emenda.' }
    }
    return { outcome: 'validated', message: `${a.cancellations.length} anulação(ões) compensatória(s) indicada(s).` }
  },

  cancellation_balance: (params, a) => {
    const dest = totalDestinations(a)
    const canc = totalCancellations(a)
    if (a.cancellations.length === 0 && !a.modality.requiresCancellation) {
      return { outcome: 'validated', message: 'Modalidade sem anulação compensatória.' }
    }
    const diff = canc - dest
    const evidence: Evidence[] = [
      { kind: 'computation', label: 'Total de destinações', value: formatBRL(dest) },
      { kind: 'computation', label: 'Total de anulações', value: formatBRL(canc) },
    ]
    if (Math.abs(diff) <= params.tolerance_cents) {
      return { outcome: 'validated', message: `Destinação e anulação equilibradas em ${formatBRL(dest)}.`, evidence }
    }
    if (a.cancellations.length === 0) {
      return { outcome: 'pending', message: `Falta indicar anulações no total de ${formatBRL(dest)}.`, evidence }
    }
    return {
      outcome: 'inconsistent',
      message: diff > 0
        ? `Anulações excedem as destinações em ${formatBRL(diff)}.`
        : `Anulações insuficientes: faltam ${formatBRL(-diff)} para equilibrar a emenda.`,
      evidence,
      details: { destinationsCents: dest, cancellationsCents: canc, differenceCents: diff },
    }
  },

  protected_expenses: (params, a) => {
    if (a.cancellations.length === 0) return { outcome: 'validated', message: 'Nenhuma anulação indicada.' }
    const items = a.cancellations.map((c) => ({ c, verdict: checkProtection(c.allocation, params) }))
    const blocked = items.filter((i) => i.verdict.protected)
    if (blocked.length > 0) {
      return {
        outcome: 'inconsistent',
        message: blocked.map((b) => `${b.c.allocation.programmaticCode} (${b.c.allocation.expenseNature}): ${b.verdict.reason}`).join(' '),
        evidence: blocked.map((b) => allocationEvidence(b.c.allocation)),
      }
    }
    return {
      outcome: 'validated',
      message: 'Nenhuma anulação incide sobre despesas protegidas.',
      evidence: a.cancellations.map((c) => allocationEvidence(c.allocation)),
    }
  },

  source_compatibility: (params, a) => {
    if (a.cancellations.length === 0) return { outcome: 'validated', message: 'Nenhuma anulação indicada.' }
    const destinations = destinationSourceOf(a)
    if (destinations.length === 0) return { outcome: 'pending', message: 'Indique a programação de destino.' }
    const verdicts = a.cancellations.flatMap((c) =>
      destinations.map((d) => ({
        c,
        v: checkSourceCompatibility({ code: c.allocation.sourceCode, isEarmarked: c.allocation.sourceIsEarmarked }, d, params.mode),
      })),
    )
    const outcome = worstOutcome(verdicts.map((x) => x.v.outcome))
    const messages = [...new Set(verdicts.filter((x) => x.v.outcome === outcome).map((x) => x.v.reason))]
    return {
      outcome,
      message: outcome === 'validated' ? 'Fontes de anulação compatíveis com a destinação.' : messages.join(' '),
      evidence: a.cancellations.map((c) => allocationEvidence(c.allocation)),
    }
  },

  cancellation_within_allocation: (params, a) => {
    if (a.cancellations.length === 0) return { outcome: 'validated', message: 'Nenhuma anulação indicada.' }
    const items = a.cancellations.map((c) => evaluateCancellationAmount(c, params.consider_pending_commitments))
    const outcome = worstOutcome(items.map((i) => i.outcome))
    return {
      outcome,
      message: items.map((i) => i.message).join(' '),
      requiresHumanDecision: items.some((i) => i.requiresHumanDecision),
      evidence: items.flatMap((i) => i.evidence),
      details: { items: items.map((i) => i.details) },
    }
  },

  individual_amendment_limit: (params, a, ctx) => {
    if (!a.modality.countsTowardIndividualLimit) {
      return { outcome: 'validated', message: 'Modalidade não sujeita ao limite individual.' }
    }
    const thisTotal = totalDestinations(a)
    const others = ctx.officeTotals.reduce((s, t) => s + t.totalCents, 0)
    let quota: Cents | null = null
    const evidence: Evidence[] = []
    if (params.quota_override_amount) {
      quota = toCents(params.quota_override_amount)
      evidence.push({ kind: 'rule', label: 'Cota fixada na regra', value: formatBRL(quota) })
    } else {
      if (ctx.fiscalYear.rclCents === null) {
        return { outcome: 'not_verifiable', message: 'RCL de referência não cadastrada no exercício — limite não verificável.' }
      }
      const pool = Math.floor((ctx.fiscalYear.rclCents * params.percent_of_rcl) / 100)
      evidence.push({ kind: 'fiscal_year', label: `RCL de referência (${ctx.fiscalYear.rclReference ?? 'fonte não informada'})`, value: formatBRL(ctx.fiscalYear.rclCents) })
      evidence.push({ kind: 'computation', label: `${params.percent_of_rcl}% da RCL`, value: formatBRL(pool) })
      if (params.split === 'equal') {
        const count = ctx.organization.parliamentariansCount
        if (!count) {
          return { outcome: 'not_verifiable', message: 'Número de parlamentares não cadastrado — rateio do limite não verificável.', evidence }
        }
        quota = Math.floor(pool / count)
        evidence.push({ kind: 'computation', label: `Cota por parlamentar (÷ ${count})`, value: formatBRL(quota) })
      } else {
        quota = pool
      }
    }
    const used = others + thisTotal
    evidence.push({ kind: 'computation', label: 'Outras emendas do gabinete', value: formatBRL(others) })
    evidence.push({ kind: 'computation', label: 'Esta emenda', value: formatBRL(thisTotal) })
    const details = { quotaCents: quota, usedCents: used, othersCents: others, remainingCents: quota - used }
    if (used > quota) {
      return { outcome: 'inconsistent', message: `Limite individual excedido em ${formatBRL(used - quota)} (cota ${formatBRL(quota)}).`, evidence, details }
    }
    return { outcome: 'validated', message: `Dentro da cota individual: utilizado ${formatBRL(used)} de ${formatBRL(quota)}.`, evidence, details }
  },

  health_share_minimum: (params, a, ctx) => {
    if (!a.modality.countsTowardIndividualLimit) {
      return { outcome: 'validated', message: 'Modalidade não sujeita à parcela mínima de saúde.' }
    }
    const healthCode = params.health_function_code
    const thisTotal = totalDestinations(a)
    const thisHealth = a.destinations
      .filter((d) => (d.allocation?.functionCode ?? d.proposedClassification?.functionCode) === healthCode)
      .reduce((s, d) => s + d.amountCents, 0)
    const othersTotal = ctx.officeTotals.reduce((s, t) => s + t.totalCents, 0)
    const othersHealth = ctx.officeTotals.filter((t) => t.functionCode === healthCode).reduce((s, t) => s + t.totalCents, 0)
    const total = othersTotal + thisTotal
    const health = othersHealth + thisHealth
    if (total === 0) return { outcome: 'pending', message: 'Sem destinações para apurar a parcela de saúde.' }
    const share = (health / total) * 100
    const required = Math.ceil((total * params.min_share_percent) / 100)
    const evidence: Evidence[] = [
      { kind: 'computation', label: 'Total das emendas individuais do gabinete', value: formatBRL(total) },
      { kind: 'computation', label: `Destinado à função ${healthCode}`, value: formatBRL(health) },
    ]
    if (share + 1e-9 >= params.min_share_percent) {
      return { outcome: 'validated', message: `Parcela de saúde de ${share.toFixed(1)}% atende ao mínimo de ${params.min_share_percent}%.`, evidence }
    }
    return {
      outcome: 'pending',
      message: `O conjunto de emendas individuais do gabinete destina ${share.toFixed(1)}% à saúde; faltam ${formatBRL(required - health)} para atingir ${params.min_share_percent}%. Pode ser atendido por outras emendas.`,
      evidence,
      details: { sharePercent: share, missingCents: required - health },
    }
  },

  amount_range: (params, a) => {
    const total = totalDestinations(a)
    if (params.min_amount === null && params.max_amount === null) {
      return { outcome: 'validated', message: 'Sem limites de valor configurados.' }
    }
    if (params.min_amount !== null && total < toCents(params.min_amount)) {
      return { outcome: 'inconsistent', message: `Valor ${formatBRL(total)} abaixo do mínimo de ${formatBRL(toCents(params.min_amount))}.` }
    }
    if (params.max_amount !== null && total > toCents(params.max_amount)) {
      return { outcome: 'inconsistent', message: `Valor ${formatBRL(total)} acima do máximo de ${formatBRL(toCents(params.max_amount))}.` }
    }
    return { outcome: 'validated', message: `Valor ${formatBRL(total)} dentro dos limites configurados.` }
  },

  osc_transfer_requirements: (params, a) => {
    const toOscModality = a.destinations.some((d) => d.allocation?.modalityCode === params.required_modality)
    if (a.beneficiaryType !== 'osc') {
      if (toOscModality) {
        return {
          outcome: 'pending',
          message: `A programação de destino usa modalidade ${params.required_modality} (instituições privadas sem fins lucrativos), mas o beneficiário não foi identificado como OSC.`,
        }
      }
      return { outcome: 'validated', message: 'Emenda sem transferência a organização da sociedade civil.' }
    }
    const findings: Array<{ outcome: ValidationOutcome; message: string }> = []
    for (const d of a.destinations) {
      if (!d.allocation) {
        findings.push({ outcome: 'pending', message: 'Destinação em nova programação: confirme a modalidade 50 e o elemento de despesa.' })
        continue
      }
      if (d.allocation.modalityCode !== params.required_modality) {
        findings.push({
          outcome: 'inconsistent',
          message: `Dotação ${d.allocation.programmaticCode} usa modalidade ${d.allocation.modalityCode}; transferência a OSC exige modalidade ${params.required_modality}.`,
        })
      }
      if (!params.allowed_elements.includes(d.allocation.elementCode)) {
        findings.push({
          outcome: 'inconsistent',
          message: `Elemento ${d.allocation.elementCode} não está entre os admitidos para OSC (${params.allowed_elements.join(', ')}).`,
        })
      }
    }
    if (!a.beneficiaryName?.trim()) findings.push({ outcome: 'pending', message: 'Informe a razão social da OSC beneficiária.' })
    if (params.require_cnpj) {
      if (!a.beneficiaryCnpj) findings.push({ outcome: 'pending', message: 'Informe o CNPJ da OSC beneficiária.' })
      else if (!isValidCnpj(a.beneficiaryCnpj)) findings.push({ outcome: 'inconsistent', message: 'CNPJ da OSC inválido (dígitos verificadores).' })
    }
    if (!params.ldo_authorization_reference) {
      findings.push({ outcome: 'not_verifiable', message: 'Dispositivo da LDO que autoriza transferências a entidades privadas não configurado na regra.' })
    }
    const outcome = worstOutcome(findings.map((f) => f.outcome))
    const base = 'Parcerias com OSC decorrentes de emendas parlamentares dispensam chamamento público (Lei nº 13.019/2014, art. 29), mantidos os demais requisitos da lei.'
    return {
      outcome,
      message: findings.length > 0 ? `${findings.map((f) => f.message).join(' ')} ${base}` : `Requisitos verificados${params.ldo_authorization_reference ? ` (autorização: ${params.ldo_authorization_reference})` : ''}. ${base}`,
      details: { findings },
    }
  },

  ppa_compatibility: (_params, a) => {
    if (a.destinations.length === 0) return { outcome: 'pending', message: 'Indique a programação de destino.' }
    const findings = a.destinations.map((d): { outcome: ValidationOutcome; message: string } => {
      if (!d.allocation) return { outcome: 'pending', message: 'Nova programação: a inclusão no PPA depende de verificação e autorização normativa.' }
      if (!d.allocation.ppaReference) {
        return { outcome: 'not_verifiable', message: `Programa ${d.allocation.programCode} sem conferência com o PPA cadastrada.` }
      }
      return { outcome: 'validated', message: `Programa ${d.allocation.programCode} consta do PPA (${d.allocation.ppaReference}).` }
    })
    return { outcome: worstOutcome(findings.map((f) => f.outcome)), message: findings.map((f) => f.message).join(' ') }
  },

  destination_restrictions: (params, a) => {
    const violations = a.destinations
      .filter((d) => d.allocation)
      .filter((d) => params.forbidden_groups.includes(d.allocation!.groupCode) || params.forbidden_elements.includes(d.allocation!.elementCode))
    if (violations.length > 0) {
      return {
        outcome: 'inconsistent',
        message: violations.map((v) => `Destinação em ${v.allocation!.expenseNature} é vedada pela norma configurada.`).join(' '),
        evidence: violations.map((v) => allocationEvidence(v.allocation!)),
      }
    }
    return { outcome: 'validated', message: 'Destinações em grupos e elementos permitidos.' }
  },

  required_fields: (params, a) => {
    const values: Record<string, string | null | undefined> = {
      object: a.object,
      purpose: a.purpose,
      justification: a.justification,
      legal_grounds: a.legalGrounds,
      physical_goal: a.physicalGoal,
      beneficiary_location: a.beneficiaryLocation,
      beneficiary_name: a.beneficiaryName,
    }
    const missing = params.fields.filter((f) => !values[f]?.trim())
    if (missing.length === 0) return { outcome: 'validated', message: 'Campos obrigatórios do formulário preenchidos.' }
    return {
      outcome: 'pending',
      message: `Preencha: ${missing.map((f) => requiredFieldLabels[f]).join(', ')}.`,
      details: { missing },
    }
  },

  submission_deadline: (_params, _a, ctx) => {
    const deadline = ctx.fiscalYear.amendmentDeadline
    if (!deadline) return { outcome: 'not_verifiable', message: 'Prazo de apresentação não cadastrado no exercício.' }
    if (ctx.today > deadline) {
      return { outcome: 'inconsistent', message: `Prazo de apresentação encerrado em ${formatDate(deadline)}.` }
    }
    const days = Math.round((Date.parse(deadline) - Date.parse(ctx.today)) / 86_400_000)
    return { outcome: 'validated', message: `Dentro do prazo (${formatDate(deadline)}; restam ${days} dia(s)).` }
  },
}

function formatDate(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

export function evaluateCancellationAmount(c: CancellationFacts, considerPending: boolean) {
  const availability = computeAvailability(c.allocation, c.commitments, considerPending)
  const evidence: Evidence[] = [allocationEvidence(c.allocation)]
  const label = c.allocation.programmaticCode
  const details = { cancellationId: c.id, amountCents: c.amountCents, ...availability }
  if (c.amountCents > c.allocation.authorizedCents) {
    return {
      outcome: 'inconsistent' as ValidationOutcome,
      message: `Anulação de ${formatBRL(c.amountCents)} em ${label} supera o valor da dotação (${formatBRL(c.allocation.authorizedCents)}).`,
      requiresHumanDecision: false,
      evidence,
      details,
    }
  }
  if (c.amountCents > availability.maxIgnoringPendingCents) {
    return {
      outcome: 'inconsistent' as ValidationOutcome,
      message: `Anulação em ${label} supera o disponível após compromissos firmes de outras emendas (máximo ${formatBRL(availability.maxIgnoringPendingCents)}).`,
      requiresHumanDecision: false,
      evidence,
      details,
    }
  }
  if (c.amountCents > availability.maxCents) {
    return {
      outcome: 'pending' as ValidationOutcome,
      message: `Outras ${c.commitments.amendmentsCount} emenda(s) em elaboração também indicam ${label} (${formatBRL(availability.pendingCents)}); o valor pode não estar disponível.`,
      requiresHumanDecision: true,
      evidence,
      details,
    }
  }
  if (availability.basis === 'official_balance') {
    evidence.push({ kind: 'document', label: `Saldo oficial em ${availability.asOf}`, documentTitle: c.allocation.availableSource, value: formatBRL(availability.baseCents) })
    return {
      outcome: 'validated' as ValidationOutcome,
      message: `Anulação em ${label} dentro do saldo disponível informado em ${availability.asOf}.`,
      requiresHumanDecision: false,
      evidence,
      details,
    }
  }
  // Sem saldo oficial: o valor total da dotação NÃO é presumido disponível.
  if (c.approved) {
    evidence.push({ kind: 'human_decision', label: `Disponibilidade confirmada por decisão humana em ${c.approvedAt?.slice(0, 10) ?? 'data não registrada'}` })
    return {
      outcome: 'validated' as ValidationOutcome,
      message: `Anulação em ${label} dentro do valor estimado (${formatBRL(availability.maxCents)}); disponibilidade confirmada por aprovação explícita.`,
      requiresHumanDecision: false,
      evidence,
      details,
    }
  }
  return {
    outcome: 'pending' as ValidationOutcome,
    message: `Sem saldo oficial atualizado para ${label}: o valor estimado é ${formatBRL(availability.maxCents)}, mas a disponibilidade exige conferência e aprovação humana.`,
    requiresHumanDecision: true,
    evidence,
    details,
  }
}

export interface ParsedRule {
  rule: RuleDefinition
  type: RuleType
  params: unknown
}

export function parseRuleParams(rule: RuleDefinition): { ok: true; parsed: ParsedRule } | { ok: false; error: string } {
  if (!isRuleType(rule.ruleType)) return { ok: false, error: `Tipo de regra desconhecido: ${rule.ruleType}` }
  const schema = ruleParamSchemas[rule.ruleType]
  const result = schema.safeParse(rule.params ?? {})
  if (!result.success) {
    return { ok: false, error: result.error.issues.map((i) => `${i.path.join('.') || 'params'}: ${i.message}`).join('; ') }
  }
  return { ok: true, parsed: { rule, type: rule.ruleType, params: result.data } }
}

export function evaluateRule(parsed: ParsedRule, amendment: AmendmentFacts, ctx: ValidationContext): CheckResult {
  const evaluator = evaluators[parsed.type] as Evaluator<RuleType>
  const evaluation = evaluator(parsed.params as never, amendment, ctx)
  const severity = parsed.rule.severity
  return {
    checkCode: parsed.rule.code,
    ruleId: parsed.rule.id,
    ruleVersion: parsed.rule.version,
    title: evaluation.title ?? parsed.rule.name,
    legalBasis: parsed.rule.legalBasis,
    severity,
    outcome: evaluation.outcome,
    message: evaluation.message,
    evidence: evaluation.evidence,
    details: evaluation.details,
    requiresHumanDecision: evaluation.requiresHumanDecision,
  }
}
