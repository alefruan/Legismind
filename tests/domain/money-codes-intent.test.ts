import { describe, expect, it } from 'vitest'
import { centsToDecimal, centsToWords, formatBRL, parseBRLExpression, toCents } from '../../shared/domain/money'
import { formatCnpj, inferActionKind, isContingencyReserve, formatNatureForDocument, isValidCnpj, normalizeSourceCode, parseExpenseNature, parseFunctionalProgrammatic } from '../../shared/domain/budget/codes'
import { extractIntentHeuristics } from '../../shared/domain/amendments/intent'
import { availableTransitions } from '../../shared/domain/amendments/status'

const nbsp = (s: string) => s.replace(/ /g, ' ')

describe('Valores monetários', () => {
  it.each([
    ['Quero destinar R$ 150 mil para uma ONG', 15_000_000],
    ['R$ 150.000,00', 15_000_000],
    ['1,5 milhão para saúde', 150_000_000],
    ['2 milhões e 300 mil', 230_000_000],
    ['R$ 100 mil para esporte e R$ 50 mil para cultura', 10_000_000],
    ['150000 reais', 15_000_000],
  ])('interpreta "%s"', (text, expected) => {
    expect(parseBRLExpression(text)).toBe(expected)
  })

  it('não confunde anos com valores', () => {
    expect(parseBRLExpression('orçamento de 2027')).toBeNull()
  })

  it('converte e formata sem erro de ponto flutuante', () => {
    expect(toCents('0.29')).toBe(29)
    expect(toCents('9600000.00')).toBe(960_000_000)
    expect(centsToDecimal(15_000_050)).toBe('150000.50')
    expect(nbsp(formatBRL(15_000_000))).toBe('R$ 150.000,00')
  })

  it.each([
    [15_000_000, 'cento e cinquenta mil reais'],
    [100, 'um real'],
    [100_000_000, 'um milhão de reais'],
    [110_000, 'mil e cem reais'],
    [123_456_789, 'um milhão, duzentos e trinta e quatro mil, quinhentos e sessenta e sete reais e oitenta e nove centavos'],
  ])('escreve %i por extenso', (cents, words) => {
    expect(centsToWords(cents)).toBe(words)
  })
})

describe('Códigos orçamentários', () => {
  it('interpreta natureza da despesa em formatos usuais', () => {
    expect(parseExpenseNature('3.3.50.41')?.modality).toBe('50')
    expect(parseExpenseNature('33504300')?.code).toBe('3.3.50.43.00')
    expect(parseExpenseNature('339039')?.code).toBe('3.3.90.39')
    expect(parseExpenseNature('7.3.90.39')).toBeNull()
    expect(parseExpenseNature('abc')).toBeNull()
  })

  it('identifica reserva de contingência e tipo de ação', () => {
    expect(isContingencyReserve('9.9.99.99.99')).toBe(true)
    expect(isContingencyReserve('3.3.90.39')).toBe(false)
    expect(inferActionKind('1052')).toBe('projeto')
    expect(inferActionKind('2051')).toBe('atividade')
    expect(inferActionKind('0001')).toBe('operacao_especial')
  })

  it('normaliza fontes e funcional-programática', () => {
    // Fontes são preservadas no formato publicado pela instituição ("1.5.00", "1.500.0000", "1500")
    expect(normalizeSourceCode(' 1.5.00 ')).toBe('1.5.00')
    expect(normalizeSourceCode('1.500. 0000')).toBe('1.500.0000')
    expect(normalizeSourceCode('1500')).toBe('1500')
    expect(formatNatureForDocument('4.4.50.42', 'cg.mm.ee')).toBe('44.50.42')
    expect(formatNatureForDocument('44.50.42', 'c.g.mm.ee')).toBe('4.4.50.42')
    expect(formatNatureForDocument('3.3.90.39.01', 'cg.mm.ee')).toBe('33.90.39.01')
    expect(parseFunctionalProgrammatic('04.122.5001.20151')).toMatchObject({ functionCode: '04', subfunctionCode: '122', actionCode: '20151' })
    expect(parseFunctionalProgrammatic('10.001.27.812.0005.2051')).toEqual({ functionCode: '27', subfunctionCode: '812', programCode: '0005', actionCode: '2051' })
  })

  it('valida CNPJ pelos dígitos verificadores', () => {
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true)
    expect(isValidCnpj('11222333000182')).toBe(false)
    expect(isValidCnpj('00000000000000')).toBe(false)
    expect(formatCnpj('11222333000181')).toBe('11.222.333/0001-81')
  })
})

describe('Interpretação heurística do pedido', () => {
  it('extrai o caso de uso principal sem LLM', () => {
    const intent = extractIntentHeuristics('Quero destinar R$ 150 mil para uma ONG realizar atividades esportivas para crianças e adolescentes.', { fiscalYear: 2027 })
    expect(intent.intent).toBe('create_amendment')
    expect(intent.amountCents).toBe(15_000_000)
    expect(intent.beneficiaryType).toBe('osc')
    expect(intent.functionCodeHints).toEqual(expect.arrayContaining(['27', '08']))
    expect(intent.subfunctionCodeHints).toEqual(expect.arrayContaining(['812', '243']))
    expect(intent.fiscalYear).toBe(2027)
    expect(intent.missingInformation).toContain('nome e CNPJ da organização beneficiária')
  })

  it('aponta valor ausente', () => {
    const intent = extractIntentHeuristics('Quero criar uma emenda para a saúde')
    expect(intent.amountCents).toBeNull()
    expect(intent.missingInformation).toContain('valor da emenda')
  })
})

describe('Transições de status (espelho do banco)', () => {
  it('bloqueia envio sem validação atual e expõe somente ações do papel', () => {
    const draft = availableTransitions({ status: 'draft', actors: ['office'], validationCurrent: false, validationOutcome: null })
    expect(draft.find((t) => t.to === 'in_review')?.blockedReason).toMatch(/validação técnica/)
    const reviewer = availableTransitions({ status: 'in_review', actors: ['reviewer'], validationCurrent: true, validationOutcome: 'pending' })
    expect(reviewer.find((t) => t.to === 'technically_validated')?.blockedReason).toMatch(/obrigatórias/)
    const office = availableTransitions({ status: 'in_review', actors: ['office'], validationCurrent: true, validationOutcome: 'validated' })
    expect(office.some((t) => t.to === 'technically_validated')).toBe(false)
  })
})
