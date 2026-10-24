import { formatBRL } from '../money.js'
import { allocationEvidence, evaluateRule, parseRuleParams, TEXT_AMENDMENT_RULE_TYPES, worstOutcome } from './rules.js'
import type {
  AmendmentFacts,
  CheckResult,
  RuleDefinition,
  ValidationContext,
  ValidationOutcome,
  ValidationReport,
  ValidationSummary,
} from './types.js'

export const ENGINE_VERSION = 'legismind-engine/1.1.0'

/**
 * Motor determinístico de validação de emendas.
 * Combina verificações estruturais (sempre executadas) com as regras normativas
 * configuradas e versionadas pela instituição. Nenhuma conclusão depende de LLM.
 */
export function validateAmendment(amendment: AmendmentFacts, rules: RuleDefinition[], ctx: ValidationContext): ValidationReport {
  if (amendment.modality.kind === 'text') return validateTextAmendment(amendment, rules, ctx)

  const checks: CheckResult[] = [
    checkRequiredFields(amendment),
    checkFiscalYear(amendment, ctx),
    checkDestinationData(amendment),
    checkCancellationData(amendment),
    checkCatalog(amendment, ctx),
  ]

  const applicable = rules.filter((r) => !r.appliesToModalities || r.appliesToModalities.length === 0 || r.appliesToModalities.includes(amendment.modality.code))

  if (applicable.length === 0) {
    checks.push({
      checkCode: 'BASE_RULESET',
      title: 'Regras normativas configuradas',
      severity: 'blocking',
      outcome: 'not_verifiable',
      message: 'Nenhuma regra normativa ativa se aplica a esta modalidade. A validação jurídica e orçamentária não pode ser concluída até que a administração configure e ative as regras locais.',
    })
  }

  runRules(checks, applicable, amendment, ctx)
  pushDemoNotice(checks, amendment, ctx)
  return buildReport(checks)
}

function pushDemoNotice(checks: CheckResult[], amendment: AmendmentFacts, ctx: ValidationContext) {
  if (ctx.organization.isDemo || [...amendment.destinations.map((d) => d.allocation), ...amendment.cancellations.map((c) => c.allocation)].some((a) => a?.isDemo)) {
    checks.push({
      checkCode: 'BASE_DEMO_DATA',
      title: 'Dados de demonstração',
      severity: 'info',
      outcome: 'not_verifiable',
      message: 'Esta emenda utiliza dados FICTÍCIOS de demonstração. O resultado ilustra o funcionamento do sistema e não tem valor oficial.',
    })
  }
}

function runRules(checks: CheckResult[], rules: RuleDefinition[], amendment: AmendmentFacts, ctx: ValidationContext) {
  for (const rule of rules) {
    const parsed = parseRuleParams(rule)
    if (!parsed.ok) {
      checks.push({
        checkCode: rule.code,
        ruleId: rule.id,
        ruleVersion: rule.version,
        title: rule.name,
        legalBasis: rule.legalBasis,
        severity: 'blocking',
        outcome: 'not_verifiable',
        message: `Parâmetros da regra inválidos: ${parsed.error}. Corrija a configuração da regra.`,
      })
      continue
    }
    checks.push(evaluateRule(parsed.parsed, amendment, ctx))
  }
}

/**
 * Emendas ao texto (aditiva, modificativa, supressiva): não movimentam dotações.
 * As verificações automáticas são estruturais; a conformidade material (matéria
 * vedada, matéria obrigatória, efeitos sobre despesa e receita) é de revisão humana.
 */
function validateTextAmendment(amendment: AmendmentFacts, rules: RuleDefinition[], ctx: ValidationContext): ValidationReport {
  const subtype = amendment.modality.textSubtype
  const missing: string[] = []
  if (!amendment.title.trim()) missing.push('título')
  if (!amendment.textTarget?.trim() && !amendment.textCommand?.trim()) missing.push('dispositivo alcançado ou comando da emenda')
  if ((subtype === 'modificativa' || subtype === 'supressiva') && !amendment.originalText?.trim()) missing.push('texto original')
  if ((subtype === 'aditiva' || subtype === 'modificativa') && !amendment.newText?.trim()) missing.push(subtype === 'aditiva' ? 'texto a ser acrescido' : 'nova redação')
  if (!subtype) missing.push('subtipo da emenda ao texto (configuração da modalidade)')

  const checks: CheckResult[] = [
    {
      checkCode: 'BASE_TEXT_FIELDS',
      title: 'Elementos da emenda ao texto',
      severity: 'blocking',
      outcome: missing.length ? 'pending' : 'validated',
      message: missing.length ? `Pendências: ${missing.join(', ')}.` : 'Dispositivo, comando e redação informados.',
      details: { missing },
    },
    {
      checkCode: 'BASE_TEXT_NO_BUDGET',
      title: 'Ausência de programação orçamentária',
      severity: 'blocking',
      outcome: amendment.destinations.length || amendment.cancellations.length ? 'inconsistent' : 'validated',
      message:
        amendment.destinations.length || amendment.cancellations.length
          ? 'Emenda ao texto não pode conter destinações ou anulações; use uma modalidade orçamentária.'
          : 'A emenda não altera dotações (não modifica o total da despesa fixada nem a receita prevista).',
    },
    {
      checkCode: 'BASE_TEXT_FISCAL_YEAR',
      title: 'Exercício orçamentário',
      severity: 'blocking',
      outcome: ctx.fiscalYear.phase === 'closed' ? 'inconsistent' : 'validated',
      message: ctx.fiscalYear.phase === 'closed' ? `O exercício ${ctx.fiscalYear.year} está encerrado.` : `Emenda ao projeto do exercício ${ctx.fiscalYear.year}.`,
    },
    {
      checkCode: 'BASE_TEXT_HUMAN_REVIEW',
      title: 'Conformidade material',
      severity: 'info',
      outcome: 'pending',
      requiresHumanDecision: true,
      message: 'Verificar na revisão jurídica se a emenda não exclui matéria obrigatória nem inclui matéria vedada (declaração de conformidade do formulário).',
    },
  ]

  const applicable = rules.filter(
    (r) =>
      (r.appliesToModalities?.includes(amendment.modality.code) ?? false) ||
      ((!r.appliesToModalities || r.appliesToModalities.length === 0) && TEXT_AMENDMENT_RULE_TYPES.has(r.ruleType)),
  )
  runRules(checks, applicable, amendment, ctx)
  pushDemoNotice(checks, amendment, ctx)
  return buildReport(checks)
}

export function buildReport(checks: CheckResult[]): ValidationReport {
  const blocking = checks.filter((c) => c.severity === 'blocking')
  const outcome: ValidationOutcome = worstOutcome(blocking.map((c) => c.outcome))
  const summary: ValidationSummary = {
    validated: checks.filter((c) => c.outcome === 'validated').length,
    pending: checks.filter((c) => c.outcome === 'pending').length,
    inconsistent: checks.filter((c) => c.outcome === 'inconsistent').length,
    notVerifiable: checks.filter((c) => c.outcome === 'not_verifiable').length,
    blockingIssues: blocking.filter((c) => c.outcome !== 'validated').length,
    warnings: checks.filter((c) => c.severity === 'warning' && c.outcome !== 'validated').length,
    humanDecisions: checks.filter((c) => c.requiresHumanDecision).length,
  }
  return { outcome, engineVersion: ENGINE_VERSION, checks, summary }
}

// -----------------------------------------------------------------------------
// Verificações estruturais
// -----------------------------------------------------------------------------
function checkRequiredFields(a: AmendmentFacts): CheckResult {
  const missing: string[] = []
  if (!a.title.trim()) missing.push('título')
  if (!a.object?.trim()) missing.push('objeto')
  if (!a.justification?.trim()) missing.push('justificativa')
  if (a.destinations.length === 0) missing.push('programação de destino')
  if (a.beneficiaryType === 'osc' && !a.beneficiaryName?.trim()) missing.push('nome da entidade beneficiária')
  return {
    checkCode: 'BASE_REQUIRED_FIELDS',
    title: 'Campos obrigatórios',
    severity: 'blocking',
    outcome: missing.length === 0 ? 'validated' : 'pending',
    message: missing.length === 0 ? 'Todos os campos obrigatórios foram preenchidos.' : `Pendências: ${missing.join(', ')}.`,
    details: { missing },
  }
}

function checkFiscalYear(a: AmendmentFacts, ctx: ValidationContext): CheckResult {
  const allocations = [...a.destinations.map((d) => d.allocation), ...a.cancellations.map((c) => c.allocation)].filter(
    (x): x is NonNullable<typeof x> => Boolean(x),
  )
  const mismatched = allocations.filter((x) => x.fiscalYearId !== a.fiscalYearId)
  if (mismatched.length > 0) {
    return {
      checkCode: 'BASE_FISCAL_YEAR',
      title: 'Exercício orçamentário',
      severity: 'blocking',
      outcome: 'inconsistent',
      message: `${mismatched.length} dotação(ões) pertencem a outro exercício (${[...new Set(mismatched.map((m) => m.fiscalYear))].join(', ')}). Use dotações de ${ctx.fiscalYear.year}.`,
      evidence: mismatched.map(allocationEvidence),
    }
  }
  if (ctx.fiscalYear.phase === 'closed') {
    return {
      checkCode: 'BASE_FISCAL_YEAR',
      title: 'Exercício orçamentário',
      severity: 'blocking',
      outcome: 'inconsistent',
      message: `O exercício ${ctx.fiscalYear.year} está encerrado.`,
    }
  }
  return {
    checkCode: 'BASE_FISCAL_YEAR',
    title: 'Exercício orçamentário',
    severity: 'blocking',
    outcome: 'validated',
    message: `Todas as dotações pertencem ao exercício ${ctx.fiscalYear.year}${ctx.fiscalYear.isActive ? ' (ativo)' : ' (não ativo)'}.`,
  }
}

function checkDestinationData(a: AmendmentFacts): CheckResult {
  if (a.destinations.length === 0) {
    return {
      checkCode: 'BASE_DESTINATION',
      title: 'Programação de destino',
      severity: 'blocking',
      outcome: 'pending',
      message: 'Nenhuma programação de destino indicada.',
    }
  }
  const findings: Array<{ outcome: ValidationOutcome; message: string; human?: boolean }> = []
  for (const d of a.destinations) {
    if (d.amountCents <= 0) findings.push({ outcome: 'inconsistent', message: 'Valor de destinação deve ser positivo.' })
    if (!d.allocation) {
      findings.push({
        outcome: 'pending',
        human: true,
        message: `Nova programação proposta ("${d.proposedClassification?.description ?? 'sem descrição'}"): não existe no orçamento e depende de autorização normativa e conferência humana.`,
      })
      continue
    }
    const al = d.allocation
    if (al.verificationStatus === 'rejected') {
      findings.push({ outcome: 'inconsistent', message: `Dotação ${al.programmaticCode} foi rejeitada na conferência.` })
    } else if (al.verificationStatus === 'pending_review') {
      findings.push({ outcome: 'pending', human: true, message: `Dotação ${al.programmaticCode} foi extraída automaticamente e aguarda conferência humana.` })
    }
    if (!al.isCurrent) {
      findings.push({ outcome: 'inconsistent', message: `Dotação ${al.programmaticCode} pertence a versão substituída do documento orçamentário.` })
    }
  }
  const outcome = worstOutcome(findings.map((f) => f.outcome))
  return {
    checkCode: 'BASE_DESTINATION',
    title: 'Programação de destino',
    severity: 'blocking',
    outcome,
    message: findings.length === 0
      ? `${a.destinations.length} destinação(ões) em dotações conferidas, total ${formatBRL(a.destinations.reduce((s, d) => s + d.amountCents, 0))}.`
      : findings.map((f) => f.message).join(' '),
    requiresHumanDecision: findings.some((f) => f.human),
    evidence: a.destinations.filter((d) => d.allocation).map((d) => allocationEvidence(d.allocation!)),
  }
}

function checkCancellationData(a: AmendmentFacts): CheckResult {
  if (a.cancellations.length === 0) {
    return {
      checkCode: 'BASE_CANCELLATION',
      title: 'Dados das anulações',
      severity: 'blocking',
      outcome: 'validated',
      message: 'Nenhuma anulação indicada (exigência avaliada pelas regras normativas).',
    }
  }
  const findings: Array<{ outcome: ValidationOutcome; message: string; human?: boolean }> = []
  for (const c of a.cancellations) {
    const al = c.allocation
    if (c.amountCents <= 0) findings.push({ outcome: 'inconsistent', message: 'Valor de anulação deve ser positivo.' })
    if (al.verificationStatus === 'rejected') findings.push({ outcome: 'inconsistent', message: `Dotação ${al.programmaticCode} foi rejeitada na conferência.` })
    if (al.verificationStatus === 'pending_review') {
      findings.push({ outcome: 'pending', human: true, message: `Dotação ${al.programmaticCode} aguarda conferência humana.` })
    }
    if (!al.isCurrent) findings.push({ outcome: 'inconsistent', message: `Dotação ${al.programmaticCode} pertence a versão substituída.` })
    if (!c.approved) {
      findings.push({ outcome: 'pending', human: true, message: `Anulação em ${al.programmaticCode} (${formatBRL(c.amountCents)}) aguarda aprovação explícita do gabinete.` })
    }
    if (!c.justification?.trim()) findings.push({ outcome: 'pending', message: `Registre a justificativa da anulação em ${al.programmaticCode}.` })
  }
  const outcome = worstOutcome(findings.map((f) => f.outcome))
  return {
    checkCode: 'BASE_CANCELLATION',
    title: 'Dados das anulações',
    severity: 'blocking',
    outcome,
    message: findings.length === 0 ? 'Anulações em dotações conferidas, justificadas e aprovadas.' : findings.map((f) => f.message).join(' '),
    requiresHumanDecision: findings.some((f) => f.human),
    evidence: a.cancellations.map((c) => allocationEvidence(c.allocation)),
  }
}

function checkCatalog(a: AmendmentFacts, ctx: ValidationContext): CheckResult {
  const allocations = [...a.destinations.map((d) => d.allocation), ...a.cancellations.map((c) => c.allocation)].filter(
    (x): x is NonNullable<typeof x> => Boolean(x),
  )
  const unknown: string[] = []
  const fn = new Set(ctx.catalog.functionCodes)
  const sf = new Set(ctx.catalog.subfunctionCodes)
  const mo = new Set(ctx.catalog.modalityCodes)
  const el = new Set(ctx.catalog.elementCodes)
  for (const x of allocations) {
    if (!fn.has(x.functionCode)) unknown.push(`função ${x.functionCode}`)
    if (!sf.has(x.subfunctionCode)) unknown.push(`subfunção ${x.subfunctionCode}`)
    if (!mo.has(x.modalityCode)) unknown.push(`modalidade ${x.modalityCode}`)
    if (!el.has(x.elementCode)) unknown.push(`elemento ${x.elementCode}`)
  }
  const unique = [...new Set(unknown)]
  return {
    checkCode: 'BASE_CATALOG',
    title: 'Tabelas normativas de classificação',
    severity: 'warning',
    outcome: unique.length === 0 ? 'validated' : 'not_verifiable',
    message: unique.length === 0
      ? 'Códigos de função, subfunção, modalidade e elemento constam das tabelas normativas carregadas.'
      : `Códigos ausentes do catálogo normativo carregado (${unique.join(', ')}). Confirme na norma vigente.`,
  }
}
