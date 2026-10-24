/**
 * Classificações orçamentárias brasileiras.
 * Natureza da despesa (Portaria Interministerial STN/SOF nº 163/2001):
 *   c.g.mm.ee[.dd] — categoria econômica, grupo, modalidade de aplicação, elemento, desdobramento.
 * Classificação funcional-programática:
 *   órgão.unidade.função.subfunção.programa.ação
 */

export interface ExpenseNature {
  code: string
  category: string
  group: string
  modality: string
  element: string
  detail: string | null
}

const NATURE_DOTTED = /^([349])\.?([1-69])\.(\d{2})\.(\d{2})(?:\.(\d{2}))?$/
const NATURE_COMPACT = /^([349])([1-69])(\d{2})(\d{2})(\d{2})?$/

export function parseExpenseNature(input: string | null | undefined): ExpenseNature | null {
  if (!input) return null
  const cleaned = input.trim().replace(/\s+/g, '')
  const match = NATURE_DOTTED.exec(cleaned) ?? NATURE_COMPACT.exec(cleaned.replace(/\./g, ''))
  if (!match) return null
  const [, category, group, modality, element, detail] = match
  const nature: ExpenseNature = {
    category: category!,
    group: group!,
    modality: modality!,
    element: element!,
    detail: detail ?? null,
    code: '',
  }
  nature.code = formatExpenseNature(nature)
  return nature
}

export function formatExpenseNature(n: Pick<ExpenseNature, 'category' | 'group' | 'modality' | 'element' | 'detail'>): string {
  const base = `${n.category}.${n.group}.${n.modality}.${n.element}`
  return n.detail ? `${base}.${n.detail}` : base
}

/** Reserva de contingência: 9.9.99.99(.99) — Portaria Interministerial nº 163/2001, art. 8º. */
export function isContingencyReserve(nature: string | ExpenseNature): boolean {
  const parsed = typeof nature === 'string' ? parseExpenseNature(nature) : nature
  if (!parsed) return false
  return parsed.category === '9' || parsed.group === '9'
}

export type ActionKind = 'projeto' | 'atividade' | 'operacao_especial' | 'nao_informado'

/**
 * Convenção usual (MTO federal): primeiro dígito ímpar = projeto, par = atividade,
 * 0 = operação especial. Entes subnacionais podem adotar outra codificação, por isso
 * o resultado é apenas uma inferência — nunca substitui o dado oficial.
 */
export function inferActionKind(actionCode: string): ActionKind {
  const first = actionCode.trim()[0]
  if (!first || !/\d/.test(first)) return 'nao_informado'
  if (first === '0') return 'operacao_especial'
  if (first === '9') return 'nao_informado'
  return Number(first) % 2 === 1 ? 'projeto' : 'atividade'
}

export interface ProgrammaticParts {
  agencyCode?: string | null
  unitCode?: string | null
  functionCode: string
  subfunctionCode: string
  programCode: string
  actionCode: string
}

export function formatProgrammaticCode(parts: ProgrammaticParts): string {
  return [parts.agencyCode, parts.unitCode, parts.functionCode, parts.subfunctionCode, parts.programCode, parts.actionCode]
    .filter((p): p is string => Boolean(p))
    .join('.')
}

/** Funcional-programática "27.812.0005.2051" → partes. */
export function parseFunctionalProgrammatic(input: string): Omit<ProgrammaticParts, 'agencyCode' | 'unitCode'> | null {
  const match = /(?:^|\D)(\d{2})\.(\d{3})\.(\d{4})\.(\d{4,6})(?:\D|$)/.exec(input)
  if (!match) return null
  return { functionCode: match[1]!, subfunctionCode: match[2]!, programCode: match[3]!, actionCode: match[4]! }
}

/**
 * Códigos de fonte/destinação são preservados exatamente como publicados pelo ente
 * (ex.: "1.5.00", "1.500.0000", "15000000"): cada Tribunal de Contas adota uma
 * codificação, e reescrevê-la produziria um código que não consta do documento oficial.
 */
export function normalizeSourceCode(input: string): string {
  return input.trim().replace(/\s+/g, '')
}

export type NatureFormat = 'c.g.mm.ee' | 'cg.mm.ee'

/** "4.4.50.42" → "44.50.42" quando a Casa adota esse padrão nos formulários. */
export function formatNatureForDocument(code: string, format: NatureFormat = 'c.g.mm.ee'): string {
  const nature = parseExpenseNature(code)
  if (!nature) return code
  if (format === 'c.g.mm.ee') return nature.code
  const base = `${nature.category}${nature.group}.${nature.modality}.${nature.element}`
  return nature.detail ? `${base}.${nature.detail}` : base
}

export function isValidCnpj(input: string | null | undefined): boolean {
  if (!input) return false
  const cnpj = input.replace(/\D/g, '')
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false
  const calc = (base: string, weights: number[]) => {
    const sum = weights.reduce((acc, w, i) => acc + Number(base[i]) * w, 0)
    const rest = sum % 11
    return rest < 2 ? 0 : 11 - rest
  }
  const d1 = calc(cnpj, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  const d2 = calc(cnpj, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  return d1 === Number(cnpj[12]) && d2 === Number(cnpj[13])
}

export function formatCnpj(input: string | null | undefined): string {
  const d = (input ?? '').replace(/\D/g, '')
  if (d.length !== 14) return input ?? ''
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
}
