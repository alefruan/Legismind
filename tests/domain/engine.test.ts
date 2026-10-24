import { describe, expect, it } from 'vitest'
import { validateAmendment } from '../../shared/domain/amendments/engine'
import { allocation, allocations, cancellation, context, demoRules, sportsOscAmendment } from './fixtures'

function check(report: ReturnType<typeof validateAmendment>, code: string) {
  const found = report.checks.find((c) => c.checkCode === code)
  if (!found) throw new Error(`Verificação ${code} não encontrada`)
  return found
}

describe('Motor de validação — caso de uso: R$ 150 mil para OSC esportiva', () => {
  it('valida a emenda completa, com anulação aprovada e dados conferidos', () => {
    const report = validateAmendment(sportsOscAmendment(), demoRules, context())
    expect(report.outcome).toBe('validated')
    expect(check(report, 'EQUILIBRIO_ANULACAO').outcome).toBe('validated')
    expect(check(report, 'DESPESAS_PROTEGIDAS').outcome).toBe('validated')
    expect(check(report, 'REQUISITOS_OSC').outcome).toBe('validated')
    // saúde é apurada no conjunto: aviso não bloqueante
    expect(check(report, 'SAUDE_METADE').outcome).toBe('pending')
    expect(check(report, 'SAUDE_METADE').severity).toBe('warning')
    const limit = check(report, 'LIMITE_EMENDAS_INDIVIDUAIS')
    expect(limit.outcome).toBe('validated')
    expect(limit.details).toMatchObject({ quotaCents: 64_000_000, usedCents: 15_000_000 })
  })

  it('sem aprovação explícita da anulação, a disponibilidade exige decisão humana', () => {
    const amendment = sportsOscAmendment({
      cancellations: [cancellation(allocations.amendmentReserve, 15_000_000, { approved: false, approvedBy: null, approvedAt: null })],
    })
    const report = validateAmendment(amendment, demoRules, context())
    expect(report.outcome).toBe('pending')
    expect(check(report, 'BASE_CANCELLATION').requiresHumanDecision).toBe(true)
    const within = check(report, 'ANULACAO_LIMITE_DOTACAO')
    expect(within.outcome).toBe('pending')
    expect(within.message).toMatch(/Sem saldo oficial/)
  })

  it('pendência de CNPJ impede a validação', () => {
    const report = validateAmendment(sportsOscAmendment({ beneficiaryCnpj: null }), demoRules, context())
    expect(report.outcome).toBe('pending')
    expect(check(report, 'REQUISITOS_OSC').message).toMatch(/CNPJ/)
  })

  it('CNPJ com dígitos inválidos é inconsistente', () => {
    const report = validateAmendment(sportsOscAmendment({ beneficiaryCnpj: '11222333000199' }), demoRules, context())
    expect(report.outcome).toBe('inconsistent')
  })

  it('elemento de despesa não admitido para OSC é inconsistente', () => {
    const amendment = sportsOscAmendment({
      destinations: [{ id: 'd', amountCents: 15_000_000, allocation: allocations.sportServices, proposedClassification: null }],
    })
    const report = validateAmendment(amendment, demoRules, context())
    expect(check(report, 'REQUISITOS_OSC').outcome).toBe('inconsistent')
    expect(report.outcome).toBe('inconsistent')
  })
})

describe('Cálculos de anulação e destino', () => {
  it('anulação insuficiente é inconsistente com a diferença calculada', () => {
    const amendment = sportsOscAmendment({ cancellations: [cancellation(allocations.amendmentReserve, 10_000_000)] })
    const report = validateAmendment(amendment, demoRules, context())
    const balance = check(report, 'EQUILIBRIO_ANULACAO')
    expect(balance.outcome).toBe('inconsistent')
    expect(balance.details).toMatchObject({ differenceCents: -5_000_000 })
  })

  it('anulação sobre pessoal e encargos é vedada', () => {
    const amendment = sportsOscAmendment({ cancellations: [cancellation(allocations.personnel, 15_000_000)] })
    const report = validateAmendment(amendment, demoRules, context())
    expect(check(report, 'DESPESAS_PROTEGIDAS').outcome).toBe('inconsistent')
    expect(report.outcome).toBe('inconsistent')
  })

  it('reserva de contingência geral é protegida; apenas a reserva para emendas é aceita', () => {
    const report = validateAmendment(
      sportsOscAmendment({ cancellations: [cancellation(allocations.generalReserve, 15_000_000)] }),
      demoRules,
      context(),
    )
    expect(check(report, 'DESPESAS_PROTEGIDAS').message).toMatch(/reserva específica/)
  })

  it('fonte vinculada (SUS) não pode custear destinação em fonte livre', () => {
    const report = validateAmendment(
      sportsOscAmendment({ cancellations: [cancellation(allocations.susEarmarked, 15_000_000)] }),
      demoRules,
      context(),
    )
    expect(check(report, 'COMPATIBILIDADE_FONTES').outcome).toBe('inconsistent')
  })

  it('anulação acima do saldo oficial é inconsistente; dentro do saldo é validada sem estimativa', () => {
    const over = validateAmendment(
      sportsOscAmendment({ cancellations: [cancellation(allocations.publicity, 25_000_000)], destinations: [{ id: 'd', amountCents: 25_000_000, allocation: allocations.oscSport, proposedClassification: null }] }),
      demoRules,
      context(),
    )
    expect(check(over, 'ANULACAO_LIMITE_DOTACAO').outcome).toBe('inconsistent')

    const within = validateAmendment(
      sportsOscAmendment({ cancellations: [cancellation(allocations.publicity, 15_000_000, { approved: true })] }),
      demoRules,
      context(),
    )
    const result = check(within, 'ANULACAO_LIMITE_DOTACAO')
    expect(result.outcome).toBe('validated')
    expect(result.message).toMatch(/saldo disponível informado/)
  })

  it('compromissos de outras emendas reduzem o disponível', () => {
    const tight = allocation({ ...allocations.amendmentReserve, id: 'a-tight', authorizedCents: 40_000_000 })
    const report = validateAmendment(
      sportsOscAmendment({
        cancellations: [cancellation(tight, 15_000_000, { commitments: { firmCents: 30_000_000, pendingCents: 0, amendmentsCount: 2 } })],
      }),
      demoRules,
      context(),
    )
    expect(check(report, 'ANULACAO_LIMITE_DOTACAO').outcome).toBe('inconsistent')
  })

  it('limite individual excedido considerando outras emendas do gabinete', () => {
    const report = validateAmendment(
      sportsOscAmendment(),
      demoRules,
      context({ officeTotals: [{ functionCode: '27', totalCents: 55_000_000 }] }),
    )
    const limit = check(report, 'LIMITE_EMENDAS_INDIVIDUAIS')
    expect(limit.outcome).toBe('inconsistent')
    // 550 mil (outras emendas) + 150 mil (esta) − cota de 640 mil = 60 mil
    expect(limit.message).toMatch(/excedido em R\$\s?60\.000,00/)
  })

  it('parcela de saúde atendida pelo conjunto de emendas', () => {
    const report = validateAmendment(
      sportsOscAmendment(),
      demoRules,
      context({ officeTotals: [{ functionCode: '10', totalCents: 20_000_000 }] }),
    )
    expect(check(report, 'SAUDE_METADE').outcome).toBe('validated')
  })
})

describe('Bases incompletas e dados não verificáveis', () => {
  it('sem RCL cadastrada, o limite é não verificável e bloqueia a validação', () => {
    const ctx = context()
    const report = validateAmendment(sportsOscAmendment(), demoRules, { ...ctx, fiscalYear: { ...ctx.fiscalYear, rclCents: null } })
    expect(check(report, 'LIMITE_EMENDAS_INDIVIDUAIS').outcome).toBe('not_verifiable')
    expect(report.outcome).toBe('not_verifiable')
  })

  it('sem regras ativas, a emenda nunca é considerada validada', () => {
    const report = validateAmendment(sportsOscAmendment(), [], context())
    expect(report.outcome).toBe('not_verifiable')
    expect(check(report, 'BASE_RULESET').outcome).toBe('not_verifiable')
  })

  it('dotação pendente de conferência humana impede a validação', () => {
    const pendingAlloc = allocation({ ...allocations.oscSport, id: 'a-pending', verificationStatus: 'pending_review' })
    const report = validateAmendment(
      sportsOscAmendment({ destinations: [{ id: 'd', amountCents: 15_000_000, allocation: pendingAlloc, proposedClassification: null }] }),
      demoRules,
      context(),
    )
    expect(check(report, 'BASE_DESTINATION').outcome).toBe('pending')
    expect(report.outcome).toBe('pending')
  })

  it('nova programação inexistente exige autorização normativa e não é validada', () => {
    const report = validateAmendment(
      sportsOscAmendment({
        beneficiaryType: 'own_administration',
        destinations: [{ id: 'd', amountCents: 15_000_000, allocation: null, proposedClassification: { description: 'Nova ação de esporte paralímpico', sourceCode: '1.500.0000' } }],
      }),
      demoRules,
      context(),
    )
    expect(check(report, 'BASE_DESTINATION').requiresHumanDecision).toBe(true)
    expect(report.outcome).not.toBe('validated')
  })

  it('programa sem conferência com o PPA é não verificável', () => {
    const noPpa = allocation({ ...allocations.oscSport, id: 'a-noppa', ppaReference: null })
    const report = validateAmendment(
      sportsOscAmendment({ destinations: [{ id: 'd', amountCents: 15_000_000, allocation: noPpa, proposedClassification: null }] }),
      demoRules,
      context(),
    )
    expect(check(report, 'COMPATIBILIDADE_PPA').outcome).toBe('not_verifiable')
  })

  it('códigos ausentes do catálogo normativo geram aviso, sem bloquear', () => {
    const unknownCode = allocation({ ...allocations.oscSport, id: 'a-unk', subfunctionCode: '777' })
    const report = validateAmendment(
      sportsOscAmendment({ destinations: [{ id: 'd', amountCents: 15_000_000, allocation: unknownCode, proposedClassification: null }] }),
      demoRules,
      context(),
    )
    const catalog = check(report, 'BASE_CATALOG')
    expect(catalog.outcome).toBe('not_verifiable')
    expect(catalog.severity).toBe('warning')
    expect(catalog.message).toMatch(/subfunção 777/)
  })

  it('parâmetros inválidos de regra resultam em não verificável', () => {
    const broken = [...demoRules.filter((r) => r.code !== 'LIMITE_EMENDAS_INDIVIDUAIS'), { ...demoRules[5]!, params: { percent_of_rcl: 'dois' } }]
    const report = validateAmendment(sportsOscAmendment(), broken, context())
    expect(check(report, 'LIMITE_EMENDAS_INDIVIDUAIS').outcome).toBe('not_verifiable')
    expect(check(report, 'LIMITE_EMENDAS_INDIVIDUAIS').message).toMatch(/Parâmetros da regra inválidos/)
  })

  it('campos obrigatórios ausentes ficam pendentes', () => {
    const report = validateAmendment(sportsOscAmendment({ justification: '', object: null }), demoRules, context())
    const required = check(report, 'BASE_REQUIRED_FIELDS')
    expect(required.outcome).toBe('pending')
    expect(required.details).toMatchObject({ missing: ['objeto', 'justificativa'] })
  })

  it('dados de demonstração são sinalizados sem alterar o resultado técnico', () => {
    const report = validateAmendment(sportsOscAmendment(), demoRules, context({ organization: { id: 'org-1', isDemo: true, parliamentariansCount: 15 } }))
    expect(check(report, 'BASE_DEMO_DATA').severity).toBe('info')
    expect(report.outcome).toBe('validated')
  })
})

describe('Mudança de exercício orçamentário', () => {
  it('dotação de outro exercício torna a emenda inconsistente', () => {
    const old = allocation({ ...allocations.oscSport, id: 'a-2026', fiscalYearId: 'fy-2026', fiscalYear: 2026 })
    const report = validateAmendment(
      sportsOscAmendment({ destinations: [{ id: 'd', amountCents: 15_000_000, allocation: old, proposedClassification: null }] }),
      demoRules,
      context(),
    )
    const fy = check(report, 'BASE_FISCAL_YEAR')
    expect(fy.outcome).toBe('inconsistent')
    expect(fy.message).toMatch(/2026/)
  })

  it('exercício encerrado é inconsistente', () => {
    const ctx = context()
    const report = validateAmendment(sportsOscAmendment(), demoRules, { ...ctx, fiscalYear: { ...ctx.fiscalYear, phase: 'closed' } })
    expect(check(report, 'BASE_FISCAL_YEAR').outcome).toBe('inconsistent')
  })

  it('prazo encerrado é sinalizado conforme a severidade da regra', () => {
    const report = validateAmendment(sportsOscAmendment(), demoRules, context({ today: '2026-12-01' }))
    const deadline = check(report, 'PRAZO_APRESENTACAO')
    expect(deadline.outcome).toBe('inconsistent')
    expect(deadline.severity).toBe('warning')
  })
})

describe('Formulário e emendas ao texto', () => {
  const requiredFields = {
    id: 'rule-req',
    code: 'REQUISITOS_FORMULARIO',
    version: 1,
    name: 'Campos obrigatórios do formulário',
    ruleType: 'required_fields',
    params: { fields: ['object', 'physical_goal', 'beneficiary_location', 'justification'] },
    legalBasis: 'Modelo oficial de emenda (fictício)',
    severity: 'blocking' as const,
    appliesToModalities: null,
  }

  it('campos do formulário ausentes deixam a emenda pendente', () => {
    const report = validateAmendment(sportsOscAmendment(), [...demoRules, requiredFields], context())
    expect(check(report, 'REQUISITOS_FORMULARIO').outcome).toBe('pending')
    expect(check(report, 'REQUISITOS_FORMULARIO').message).toMatch(/Meta física esperada/i)
    expect(report.outcome).toBe('pending')

    const complete = validateAmendment(
      sportsOscAmendment({ physicalGoal: 'Atender 200 crianças', beneficiaryLocation: 'Rua Exemplo, 100' }),
      [...demoRules, requiredFields],
      context(),
    )
    expect(check(complete, 'REQUISITOS_FORMULARIO').outcome).toBe('validated')
  })

  it('emenda ao texto não exige programação e rejeita destinações', () => {
    const textModality = { id: 'mod-t', code: 'texto_aditiva', name: 'Emenda aditiva ao texto', requiresCancellation: false, kind: 'text' as const, textSubtype: 'aditiva' as const, isImpositive: false, countsTowardIndividualLimit: false }
    const base = sportsOscAmendment({
      modality: textModality,
      destinations: [],
      cancellations: [],
      textCommand: 'Acrescente-se ao art. 5º o seguinte parágrafo único:',
      newText: 'Parágrafo único. Texto acrescido.',
    })
    const report = validateAmendment(base, demoRules, context())
    expect(check(report, 'BASE_TEXT_FIELDS').outcome).toBe('validated')
    expect(check(report, 'BASE_TEXT_NO_BUDGET').outcome).toBe('validated')
    // regras orçamentárias não se aplicam a emendas ao texto
    expect(report.checks.some((c) => c.checkCode === 'EQUILIBRIO_ANULACAO')).toBe(false)
    expect(check(report, 'PRAZO_APRESENTACAO').outcome).toBe('validated')

    const withBudget = validateAmendment({ ...base, destinations: sportsOscAmendment().destinations }, demoRules, context())
    expect(check(withBudget, 'BASE_TEXT_NO_BUDGET').outcome).toBe('inconsistent')

    const missing = validateAmendment({ ...base, newText: null }, demoRules, context())
    expect(check(missing, 'BASE_TEXT_FIELDS').message).toMatch(/texto a ser acrescido/)
  })
})
