import { extractText, getDocumentProxy } from 'unpdf'
import mammoth from 'mammoth'
import ExcelJS from 'exceljs'
import Papa from 'papaparse'
import { detectColumnMapping } from '../../shared/domain/documents/budget-parser.js'
import type { PageText } from '../../shared/domain/documents/chunking.js'

export interface ExtractionResult {
  kind: 'pdf' | 'docx' | 'table'
  pages: PageText[]
  /** Linhas tabulares (CSV/XLSX), já com cabeçalho detectado. */
  rows?: Array<Record<string, unknown>>
  headerLine?: number
  pageCount: number
  /** Páginas com pouco texto (provavelmente digitalizadas). */
  lowTextPages: number[]
  warnings: string[]
}

const MIN_CHARS_PER_PAGE = 40

export async function extractPdf(bytes: Uint8Array): Promise<ExtractionResult> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes))
  const { totalPages, text } = await extractText(pdf, { mergePages: false })
  const pages = text.map((t, i) => ({ page: i + 1, text: t ?? '' }))
  const lowTextPages = pages.filter((p) => p.text.replace(/\s/g, '').length < MIN_CHARS_PER_PAGE).map((p) => p.page)
  return { kind: 'pdf', pages, pageCount: totalPages, lowTextPages, warnings: [] }
}

/** DOCX não possui paginação fixa: o texto é dividido em seções virtuais de ~4.000 caracteres. */
export async function extractDocx(bytes: Uint8Array): Promise<ExtractionResult> {
  const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) })
  const text = result.value.replace(/\r\n/g, '\n')
  const paragraphs = text.split(/\n{2,}/)
  const pages: PageText[] = []
  let current = ''
  for (const paragraph of paragraphs) {
    if (current.length + paragraph.length > 4000 && current) {
      pages.push({ page: pages.length + 1, text: current })
      current = ''
    }
    current += (current ? '\n\n' : '') + paragraph
  }
  if (current.trim()) pages.push({ page: pages.length + 1, text: current })
  return {
    kind: 'docx',
    pages,
    pageCount: pages.length,
    lowTextPages: [],
    warnings: result.messages.filter((m) => m.type === 'warning').map((m) => m.message).slice(0, 10),
  }
}

/** Encontra a linha de cabeçalho: a primeira com ao menos 3 colunas reconhecidas. */
function findHeader(matrix: unknown[][]): number {
  for (let i = 0; i < Math.min(matrix.length, 30); i++) {
    const headers = matrix[i]!.map((c) => String(c ?? '').trim()).filter(Boolean)
    if (Object.keys(detectColumnMapping(headers)).length >= 3) return i
  }
  return 0
}

/** `lineNumbers` mapeia o índice da matriz para a linha real do arquivo (planilhas omitem linhas vazias). */
function matrixToRows(matrix: unknown[][], lineNumbers?: number[]) {
  const headerIndex = findHeader(matrix)
  const headers = (matrix[headerIndex] ?? []).map((h, i) => String(h ?? '').trim() || `coluna_${i + 1}`)
  const rows: Array<Record<string, unknown>> = []
  for (const line of matrix.slice(headerIndex + 1)) {
    if (!line || line.every((c) => c === null || c === undefined || String(c).trim() === '')) continue
    const row: Record<string, unknown> = {}
    headers.forEach((h, i) => (row[h] = line[i] ?? ''))
    rows.push(row)
  }
  return { rows, headerLine: lineNumbers?.[headerIndex] ?? headerIndex + 1 }
}

function tableAsPages(rows: Array<Record<string, unknown>>): PageText[] {
  // Representação textual para busca: blocos de 40 linhas
  const pages: PageText[] = []
  for (let i = 0; i < rows.length; i += 40) {
    const text = rows
      .slice(i, i + 40)
      .map((r) => Object.values(r).map((v) => String(v ?? '').trim()).filter(Boolean).join(' | '))
      .join('\n')
    pages.push({ page: pages.length + 1, text })
  }
  return pages
}

export async function extractXlsx(bytes: Uint8Array): Promise<ExtractionResult> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer)
  const warnings: string[] = []
  const sheet = workbook.worksheets.find((ws) => ws.actualRowCount > 1) ?? workbook.worksheets[0]
  if (!sheet) return { kind: 'table', pages: [], rows: [], pageCount: 0, lowTextPages: [], warnings: ['Planilha sem abas com dados.'] }
  if (workbook.worksheets.length > 1) warnings.push(`Processada a aba "${sheet.name}"; demais abas ignoradas.`)
  const matrix: unknown[][] = []
  const lineNumbers: number[] = []
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    lineNumbers.push(rowNumber)
    const values = (row.values as unknown[]).slice(1).map((v) => {
      if (v && typeof v === 'object') {
        // fórmulas: usa o valor calculado armazenado; nunca avalia fórmulas
        if ('result' in v) return (v as { result: unknown }).result
        if ('richText' in v) return (v as { richText: Array<{ text: string }> }).richText.map((t) => t.text).join('')
        if ('text' in v) return (v as { text: string }).text
      }
      return v
    })
    matrix.push(values)
  })
  const { rows, headerLine } = matrixToRows(matrix, lineNumbers)
  return { kind: 'table', pages: tableAsPages(rows), rows, headerLine, pageCount: 1, lowTextPages: [], warnings }
}

export function extractCsv(bytes: Uint8Array): ExtractionResult {
  let text = new TextDecoder('utf-8').decode(bytes)
  const warnings: string[] = []
  if (text.includes('�')) {
    text = new TextDecoder('latin1').decode(bytes)
    warnings.push('Arquivo interpretado como ISO-8859-1 (Latin-1).')
  }
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: true, delimiter: '' })
  if (parsed.errors.length) warnings.push(...parsed.errors.slice(0, 5).map((e) => `Linha ${e.row ?? '?'}: ${e.message}`))
  const { rows, headerLine } = matrixToRows(parsed.data)
  return { kind: 'table', pages: tableAsPages(rows), rows, headerLine, pageCount: 1, lowTextPages: [], warnings }
}

export async function extractDocument(mime: string, bytes: Uint8Array): Promise<ExtractionResult> {
  switch (mime) {
    case 'application/pdf':
      return extractPdf(bytes)
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return extractDocx(bytes)
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      return extractXlsx(bytes)
    case 'text/csv':
      return extractCsv(bytes)
    default:
      throw new Error(`Tipo de arquivo não suportado: ${mime}`)
  }
}
