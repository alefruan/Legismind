/**
 * Valores monetários são manipulados em centavos inteiros para evitar erros de
 * ponto flutuante em cálculos orçamentários.
 */
export type Cents = number

export function toCents(value: number | string | null | undefined): Cents {
  if (value === null || value === undefined || value === '') return 0
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    throw new Error(`Valor monetário inválido: ${String(value)}`)
  }
  return Math.round(numeric * 100)
}

export function toCentsOrNull(value: number | string | null | undefined): Cents | null {
  if (value === null || value === undefined || value === '') return null
  return toCents(value)
}

/** Representação decimal para gravação em colunas numeric(18,2). */
export function centsToDecimal(cents: Cents): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(Math.trunc(cents))
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

export function formatBRL(cents: Cents | null | undefined): string {
  if (cents === null || cents === undefined) return '—'
  return brl.format(cents / 100)
}

/** "R$ 150.000,00" → compacto: "R$ 150 mil" (somente para exibição resumida). */
export function formatBRLCompact(cents: Cents): string {
  const reais = cents / 100
  const abs = Math.abs(reais)
  if (abs >= 1_000_000_000) return `R$ ${trimDecimal(reais / 1_000_000_000)} bi`
  if (abs >= 1_000_000) return `R$ ${trimDecimal(reais / 1_000_000)} mi`
  if (abs >= 1_000) return `R$ ${trimDecimal(reais / 1_000)} mil`
  return formatBRL(cents)
}

function trimDecimal(value: number) {
  return value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })
}

const multipliers: Record<string, number> = {
  mil: 1_000,
  k: 1_000,
  milhao: 1_000_000,
  milhoes: 1_000_000,
  mi: 1_000_000,
  bilhao: 1_000_000_000,
  bilhoes: 1_000_000_000,
  bi: 1_000_000_000,
}

function stripAccents(text: string) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/**
 * Interpreta expressões monetárias em português: "R$ 150 mil", "150.000,00",
 * "1,5 milhão", "R$ 2 milhões e 300 mil". Retorna null quando não há valor claro.
 */
export function parseBRLExpression(input: string): Cents | null {
  const text = stripAccents(input.toLowerCase())
  const pattern = /(r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?)\s*(milhoes|milhao|mil|mi|bilhoes|bilhao|bi|k)?\b(\s*(?:de\s+)?reais)?/g
  let total = 0
  let found = false
  let lastEnd = -1
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    const [whole, currency, raw, unit, reais] = match
    const isMonetary = Boolean(currency || unit || reais || /,\d{2}$/.test(raw!) || /^\d{1,3}(\.\d{3})+/.test(raw!))
    if (!isMonetary) continue // números soltos (ex.: o ano "2027") não são valores
    if (found) {
      // apenas fragmentos encadeados por "e" ("2 milhões e 300 mil") compõem o mesmo valor
      const between = text.slice(lastEnd, match.index)
      if (!/^\s*e\s*$/.test(between)) break
    }
    const value = raw!.includes(',') || /^\d{1,3}(\.\d{3})+/.test(raw!)
      ? Number(raw!.replace(/\./g, '').replace(',', '.'))
      : Number(raw)
    if (!Number.isFinite(value)) continue
    total += value * (unit ? multipliers[unit]! : 1)
    found = true
    lastEnd = match.index + whole.length
  }
  return found ? Math.round(total * 100) : null
}

// -----------------------------------------------------------------------------
// Valor por extenso (documentos oficiais)
// -----------------------------------------------------------------------------
const units = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove']
const teens = ['dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove']
const tens = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa']
const hundreds = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos']

function below1000(n: number): string {
  if (n === 0) return ''
  if (n === 100) return 'cem'
  const parts: string[] = []
  const h = Math.floor(n / 100)
  const rest = n % 100
  if (h) parts.push(hundreds[h]!)
  if (rest >= 10 && rest < 20) {
    parts.push(teens[rest - 10]!)
  } else {
    const t = Math.floor(rest / 10)
    const u = rest % 10
    if (t) parts.push(tens[t]!)
    if (u) parts.push(units[u]!)
  }
  return parts.join(' e ')
}

const scales: Array<[number, string, string]> = [
  [1_000_000_000_000, 'trilhão', 'trilhões'],
  [1_000_000_000, 'bilhão', 'bilhões'],
  [1_000_000, 'milhão', 'milhões'],
  [1_000, 'mil', 'mil'],
]

function integerToWords(n: number): string {
  if (n === 0) return 'zero'
  const groups: Array<{ value: number; text: string }> = []
  let remaining = n
  for (const [size, singular, plural] of scales) {
    const count = Math.floor(remaining / size)
    if (count > 0) {
      const label = count === 1 ? singular : plural
      groups.push({ value: count * size, text: size === 1_000 && count === 1 ? 'mil' : `${below1000(count)} ${label}` })
      remaining %= size
    }
  }
  if (remaining > 0) groups.push({ value: remaining, text: below1000(remaining) })

  let out = ''
  groups.forEach((group, index) => {
    if (index === 0) {
      out = group.text
      return
    }
    // "e" antes do último grupo quando < 100 ou centena exata
    const isLast = index === groups.length - 1
    const useE = isLast && (group.value < 100 || group.value % 100 === 0)
    out += useE ? ` e ${group.text}` : `, ${group.text}`
  })
  return out
}

/** 15000000 → "cento e cinquenta mil reais" */
export function centsToWords(cents: Cents): string {
  const abs = Math.abs(Math.round(cents))
  const reais = Math.floor(abs / 100)
  const centavos = abs % 100
  const parts: string[] = []
  if (reais > 0) {
    const words = integerToWords(reais)
    const millionsExact = reais >= 1_000_000 && reais % 1_000_000 === 0
    parts.push(`${words}${millionsExact ? ' de' : ''} ${reais === 1 ? 'real' : 'reais'}`)
  }
  if (centavos > 0) {
    parts.push(`${integerToWords(centavos)} ${centavos === 1 ? 'centavo' : 'centavos'}`)
  }
  if (parts.length === 0) return 'zero real'
  return parts.join(' e ')
}
