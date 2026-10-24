import { inferActionKind, normalizeSourceCode, parseExpenseNature, type ActionKind } from '../budget/codes.js'
import type { Cents } from '../money.js'

/**
 * Conversão de anexos orçamentários em registros estruturados.
 * Toda dotação extraída nasce "pendente de conferência": a confirmação é sempre humana.
 */

export interface ParsedAllocation {
  ref: string
  page: number | null
  agencyCode: string
  agencyName: string | null
  unitCode: string
  unitName: string | null
  functionCode: string
  subfunctionCode: string
  programCode: string
  programName: string | null
  actionCode: string
  actionName: string | null
  actionKind: ActionKind
  expenseNature: string
  sourceCode: string
  sourceName: string | null
  amountCents: Cents
  description: string | null
  allocationCode: string | null
  confidence: number
  raw: string
  warnings: string[]
}

export interface ParseIssue {
  severity: 'info' | 'warning' | 'error'
  code: string
  message: string
  page?: number | null
  excerpt?: string
}

export interface ParseResult {
  allocations: ParsedAllocation[]
  issues: ParseIssue[]
  stats: { rows: number; parsed: number; rejected: number }
}

/** "400.000,00" | "400000.00" | 400000 → centavos. Retorna null se ambíguo. */
export function parseAmount(value: unknown): Cents | null {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 100) : null
  if (typeof value !== 'string') return null
  const text = value.trim().replace(/^R\$\s*/i, '').replace(/\s/g, '')
  if (!text) return null
  if (/^-?\d{1,3}(\.\d{3})*(,\d{1,2})?$/.test(text) || /^-?\d+,\d{1,2}$/.test(text)) {
    return Math.round(Number(text.replace(/\./g, '').replace(',', '.')) * 100)
  }
  if (/^-?\d+(\.\d{1,2})?$/.test(text)) return Math.round(Number(text) * 100)
  if (/^-?\d{1,3}(,\d{3})*(\.\d{1,2})?$/.test(text)) return Math.round(Number(text.replace(/,/g, '')) * 100)
  return null
}

/** "Nome da Ação" → "nomeacao": remove acentos, preposições e pontuação. */
function normKey(key: string) {
  return key
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\b(de|do|da|dos|das)\b/g, ' ')
    .replace(/[^a-z0-9]/g, '')
}

const headerAliases: Record<string, string[]> = {
  agencyCode: ['orgao', 'codorgao', 'codigoorgao', 'cdorgao'],
  agencyName: ['nomeorgao', 'descricaoorgao', 'orgaonome', 'dsorgao', 'orgaodescricao'],
  unitCode: ['unidade', 'unidadeorcamentaria', 'codunidade', 'uo', 'coduo', 'codigounidade'],
  unitName: ['nomeunidade', 'descricaounidade', 'dsunidade', 'unidadedescricao', 'nomeunidadeorcamentaria'],
  functionCode: ['funcao', 'codfuncao', 'codigofuncao'],
  subfunctionCode: ['subfuncao', 'codsubfuncao', 'codigosubfuncao'],
  programCode: ['programa', 'codprograma', 'codigoprograma'],
  programName: ['nomeprograma', 'descricaoprograma', 'dsprograma', 'programadescricao'],
  actionCode: ['acao', 'codacao', 'projetoatividade', 'projativ', 'codigoacao'],
  actionName: ['nomeacao', 'descricaoacao', 'dsacao', 'acaodescricao', 'tituloacao', 'nomeprojetoatividade'],
  expenseNature: ['natureza', 'naturezadespesa', 'nd', 'codnatureza', 'elementodespesa', 'codigonatureza'],
  sourceCode: ['fonte', 'fonterecurso', 'fonterecursos', 'codfonte', 'codigofonte', 'destinacao', 'fontedestinacao', 'destinacaorecursos'],
  sourceName: ['nomefonte', 'descricaofonte', 'fontedescricao'],
  amount: ['valor', 'valorautorizado', 'dotacao', 'dotacaoinicial', 'valorproposto', 'total', 'valororcado', 'vlr', 'valorr'],
  description: ['descricao', 'historico', 'especificacao', 'detalhamento'],
  allocationCode: ['ficha', 'reduzido', 'codigoreduzido', 'dotacaoreduzida', 'coddotacao'],
  programmatic: ['funcionalprogramatica', 'programatica', 'classificacaofuncionalprogramatica', 'programatrabalho', 'classificacao'],
}

export function detectColumnMapping(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {}
  const normalized = headers.map((h) => ({ original: h, key: normKey(h) }))
  for (const [field, aliases] of Object.entries(headerAliases)) {
    const hit = normalized.find((h) => aliases.includes(h.key))
    if (hit) mapping[field] = hit.original
  }
  return mapping
}

const PROGRAMMATIC_FULL = /(?:(\d{2})\.(\d{2,3})\.)?(\d{2})\.(\d{3})\.(\d{4})\.(\d{4,6})(?!\d)/

function splitProgrammatic(value: string) {
  const m = PROGRAMMATIC_FULL.exec(value)
  if (!m) return null
  return { agencyCode: m[1] ?? null, unitSuffix: m[2] ?? null, functionCode: m[3]!, subfunctionCode: m[4]!, programCode: m[5]!, actionCode: m[6]! }
}

function clean(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const s = String(value).trim()
  return s ? s : null
}

function pad(value: string | null, size: number) {
  if (!value) return null
  const digits = value.replace(/\D/g, '')
  if (!digits || digits.length > size) return digits || null
  return digits.padStart(size, '0')
}

/** Planilhas e CSV com cabeçalho (uma dotação por linha). */
export function parseBudgetRows(rows: Array<Record<string, unknown>>, options: { mapping?: Record<string, string>; startLine?: number } = {}): ParseResult {
  const issues: ParseIssue[] = []
  const allocations: ParsedAllocation[] = []
  if (rows.length === 0) return { allocations, issues: [{ severity: 'error', code: 'empty_table', message: 'Tabela sem linhas.' }], stats: { rows: 0, parsed: 0, rejected: 0 } }

  const mapping = options.mapping ?? detectColumnMapping(Object.keys(rows[0]!))
  const required = ['expenseNature', 'sourceCode', 'amount']
  const missingColumns = required.filter((f) => !mapping[f])
  const hasProgrammatic = Boolean(mapping.programmatic) || ['functionCode', 'subfunctionCode', 'programCode', 'actionCode'].every((f) => mapping[f])
  if (missingColumns.length > 0 || !hasProgrammatic) {
    issues.push({
      severity: 'error',
      code: 'missing_columns',
      message: `Colunas obrigatórias não identificadas: ${[...missingColumns, ...(hasProgrammatic ? [] : ['classificação funcional-programática'])].join(', ')}. Ajuste o cabeçalho ou informe o mapeamento.`,
    })
    return { allocations, issues, stats: { rows: rows.length, parsed: 0, rejected: rows.length } }
  }

  const get = (row: Record<string, unknown>, field: string) => (mapping[field] ? row[mapping[field]!] : undefined)
  let rejected = 0

  rows.forEach((row, i) => {
    const line = (options.startLine ?? 2) + i
    const ref = `linha ${line}`
    const raw = JSON.stringify(row).slice(0, 500)
    const warnings: string[] = []

    const prog = clean(get(row, 'programmatic'))
    const split = prog ? splitProgrammatic(prog) : null
    const functionCode = pad(clean(get(row, 'functionCode')), 2) ?? split?.functionCode ?? null
    const subfunctionCode = pad(clean(get(row, 'subfunctionCode')), 3) ?? split?.subfunctionCode ?? null
    const programCode = pad(clean(get(row, 'programCode')), 4) ?? split?.programCode ?? null
    const actionCode = pad(clean(get(row, 'actionCode')), 4) ?? split?.actionCode ?? null
    const agencyCode = clean(get(row, 'agencyCode')) ?? split?.agencyCode ?? null
    let unitCode = clean(get(row, 'unitCode'))
    if (!unitCode && split?.agencyCode && split.unitSuffix) unitCode = `${split.agencyCode}.${split.unitSuffix}`
    const nature = parseExpenseNature(clean(get(row, 'expenseNature')) ?? '')
    const sourceRaw = clean(get(row, 'sourceCode'))
    const amount = parseAmount(get(row, 'amount'))

    const problems: string[] = []
    if (!functionCode || !/^\d{2}$/.test(functionCode)) problems.push('função')
    if (!subfunctionCode || !/^\d{3}$/.test(subfunctionCode)) problems.push('subfunção')
    if (!programCode) problems.push('programa')
    if (!actionCode) problems.push('ação')
    if (!nature) problems.push('natureza da despesa')
    if (!sourceRaw) problems.push('fonte')
    if (amount === null || amount < 0) problems.push('valor')
    if (!agencyCode) problems.push('órgão')
    if (!unitCode) problems.push('unidade orçamentária')

    if (problems.length > 0) {
      // linhas de totalização/subtítulo são comuns em anexos: registradas como informação
      const looksLikeTotal = /total|subtotal|soma/i.test(raw)
      issues.push({
        severity: looksLikeTotal ? 'info' : 'warning',
        code: looksLikeTotal ? 'skipped_total_row' : 'unparsed_row',
        message: looksLikeTotal ? `${ref}: linha de totalização ignorada.` : `${ref}: campos ausentes ou inválidos (${problems.join(', ')}).`,
        excerpt: raw,
      })
      rejected++
      return
    }

    const agencyName = clean(get(row, 'agencyName'))
    const unitName = clean(get(row, 'unitName'))
    const programName = clean(get(row, 'programName'))
    const actionName = clean(get(row, 'actionName'))
    if (!agencyName) warnings.push('nome do órgão ausente')
    if (!unitName) warnings.push('nome da unidade ausente')
    if (!programName) warnings.push('nome do programa ausente')
    if (!actionName) warnings.push('nome da ação ausente')

    allocations.push({
      ref,
      page: null,
      agencyCode: agencyCode!,
      agencyName,
      unitCode: unitCode!,
      unitName,
      functionCode: functionCode!,
      subfunctionCode: subfunctionCode!,
      programCode: programCode!,
      programName,
      actionCode: actionCode!,
      actionName,
      actionKind: inferActionKind(actionCode!),
      expenseNature: nature!.code,
      sourceCode: normalizeSourceCode(sourceRaw!),
      sourceName: clean(get(row, 'sourceName')),
      amountCents: amount!,
      description: clean(get(row, 'description')),
      allocationCode: clean(get(row, 'allocationCode')),
      confidence: Math.max(0.5, 1 - warnings.length * 0.05),
      raw,
      warnings,
    })
  })

  return { allocations, issues, stats: { rows: rows.length, parsed: allocations.length, rejected } }
}

// -----------------------------------------------------------------------------
// Texto extraído de PDF (heurístico — sempre exige conferência)
// -----------------------------------------------------------------------------
const AGENCY_LINE = /^(?:[ÓO]RG[ÃA]O|ORGAO)\s*[:\-–]?\s*(\d{2})\s*[-–:]\s*(.+)$/i
const UNIT_LINE = /^(?:UNIDADE(?:\s+OR[ÇC]AMENT[ÁA]RIA)?|U\.?O\.?)\s*[:\-–]?\s*(\d{2}\.?\d{2,3})\s*[-–:]\s*(.+)$/i
// natureza: "3.3.50.41", "44.50.42" (categoria+grupo juntos) ou reserva "9.9.99.99"
const NATURE_IN_LINE = /\b([34]\.?[1-6]\.\d{2}\.\d{2}(?:\.\d{2})?|9\.9\.99\.99(?:\.99)?)\b/
// fonte: "1.500.0000", "1.500", "1.5.00" ou "15000000"
const SOURCE_IN_LINE = /\b(\d\.\d{1,3}(?:\.\d{2,4})?|\d{8})\b/g
const AMOUNT_IN_LINE = /(\d{1,3}(?:\.\d{3})*,\d{2})(?!\d)/g

export function parseBudgetText(pages: Array<{ page: number; text: string }>): ParseResult {
  const allocations: ParsedAllocation[] = []
  const issues: ParseIssue[] = []
  let agency: { code: string; name: string } | null = null
  let unit: { code: string; name: string } | null = null
  let candidates = 0
  let rejected = 0

  for (const { page, text } of pages) {
    for (const rawLine of text.split('\n')) {
      const line = rawLine.replace(/\s+/g, ' ').trim()
      if (!line) continue
      const agencyMatch = AGENCY_LINE.exec(line)
      if (agencyMatch) {
        agency = { code: agencyMatch[1]!, name: agencyMatch[2]!.trim() }
        continue
      }
      const unitMatch = UNIT_LINE.exec(line)
      if (unitMatch) {
        const code = unitMatch[1]!.includes('.') ? unitMatch[1]! : `${unitMatch[1]!.slice(0, 2)}.${unitMatch[1]!.slice(2)}`
        unit = { code, name: unitMatch[2]!.trim() }
        continue
      }

      const prog = splitProgrammatic(line)
      const natureMatch = NATURE_IN_LINE.exec(line)
      if (!prog || !natureMatch) continue
      candidates++

      const afterNature = line.slice(natureMatch.index + natureMatch[0].length)
      const sources = [...afterNature.matchAll(SOURCE_IN_LINE)].map((m) => m[1]!)
      const amounts = [...line.matchAll(AMOUNT_IN_LINE)].map((m) => m[1]!)
      const amount = amounts.length ? parseAmount(amounts[amounts.length - 1]!) : null
      const warnings: string[] = []

      const agencyCode = prog.agencyCode ?? agency?.code ?? null
      const unitCode = prog.agencyCode && prog.unitSuffix ? `${prog.agencyCode}.${prog.unitSuffix}` : unit?.code ?? null
      if (!agencyCode || !unitCode || !sources[0] || amount === null) {
        rejected++
        issues.push({
          severity: 'warning',
          code: 'ambiguous_line',
          message: `Linha com classificação ${prog.functionCode}.${prog.subfunctionCode}.${prog.programCode}.${prog.actionCode} sem ${[
            !agencyCode && 'órgão',
            !unitCode && 'unidade',
            !sources[0] && 'fonte',
            amount === null && 'valor',
          ].filter(Boolean).join(', ')} identificáveis.`,
          page,
          excerpt: line.slice(0, 300),
        })
        continue
      }
      if (amounts.length > 1) warnings.push('mais de um valor na linha; adotado o último')
      if (!prog.agencyCode && agency) warnings.push('órgão/unidade inferidos do cabeçalho da página')

      const between = line
        .slice(line.indexOf(prog.actionCode) + prog.actionCode.length, natureMatch.index)
        .replace(/[-–|]/g, ' ')
        .trim()
      const actionName = between.length >= 4 ? between : null
      if (!actionName) warnings.push('nome da ação não identificado')

      allocations.push({
        ref: `p. ${page}`,
        page,
        agencyCode,
        agencyName: agency?.name ?? null,
        unitCode,
        unitName: unit?.name ?? null,
        functionCode: prog.functionCode,
        subfunctionCode: prog.subfunctionCode,
        programCode: prog.programCode,
        programName: null,
        actionCode: prog.actionCode,
        actionName,
        actionKind: inferActionKind(prog.actionCode),
        expenseNature: parseExpenseNature(natureMatch[1]!)!.code,
        sourceCode: normalizeSourceCode(sources[0]),
        sourceName: null,
        amountCents: amount,
        description: null,
        allocationCode: null,
        confidence: Math.min(0.85, 0.6 + (prog.agencyCode ? 0.1 : 0.05) + (actionName ? 0.1 : 0) - (amounts.length > 1 ? 0.1 : 0)),
        raw: line.slice(0, 500),
        warnings,
      })
    }
  }

  if (candidates === 0) {
    issues.push({ severity: 'info', code: 'no_budget_lines', message: 'Nenhuma linha com classificação orçamentária completa foi identificada no texto.' })
  }
  return { allocations, issues, stats: { rows: candidates, parsed: allocations.length, rejected } }
}
