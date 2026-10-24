import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage, type RGB } from 'pdf-lib'
import type { AmendmentDocument, DocBlock, DocRun, FieldRow } from '../../shared/domain/amendments/document.js'

const A4 = { width: 595.28, height: 841.89 }
const MARGIN = { top: 56, bottom: 60, left: 64, right: 52 }
const CONTENT_WIDTH = A4.width - MARGIN.left - MARGIN.right
const BLACK = rgb(0, 0, 0)
const TEXT = rgb(0.07, 0.09, 0.15)
const PENDING = rgb(0.7, 0.33, 0.04)

// Fontes padrão do PDF usam WinAnsi: substitui caracteres não codificáveis.
const CP1252_EXTRAS = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'
const replacements: Record<string, string> = { '→': '->', '←': '<-', '≥': '>=', '≤': '<=', '✓': 'v', ' ': ' ', ' ': ' ' }

export function toWinAnsi(text: string): string {
  let out = ''
  for (const ch of text) {
    const code = ch.codePointAt(0)!
    if (code === 0x09 || (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || CP1252_EXTRAS.includes(ch)) out += ch
    else if (replacements[ch]) out += replacements[ch]
    else if (code === 0x0a) out += ' '
    else out += '?'
  }
  return out
}

interface Fonts {
  regular: PDFFont
  bold: PDFFont
  italic: PDFFont
  boldItalic: PDFFont
}

interface Word {
  text: string
  bold: boolean
  italic: boolean
}

type Align = 'left' | 'center' | 'justify' | 'right'

class Layout {
  page!: PDFPage
  y = 0
  pages: PDFPage[] = []
  header: DocRun[][] = []

  constructor(
    private readonly pdf: PDFDocument,
    private readonly fonts: Fonts,
  ) {}

  font(w: { bold?: boolean; italic?: boolean }) {
    if (w.bold && w.italic) return this.fonts.boldItalic
    if (w.bold) return this.fonts.bold
    if (w.italic) return this.fonts.italic
    return this.fonts.regular
  }

  addPage() {
    this.page = this.pdf.addPage([A4.width, A4.height])
    this.pages.push(this.page)
    this.y = A4.height - MARGIN.top
    // Cabeçalho institucional em todas as páginas
    for (const line of this.header) this.textLine(line, 10.5, 'center', CONTENT_WIDTH, MARGIN.left)
    if (this.header.length) this.y -= 14
  }

  ensure(height: number) {
    if (!this.page) this.addPage()
    if (this.y - height < MARGIN.bottom) {
      this.addPage()
      return true
    }
    return false
  }

  wrap(runs: DocRun[], size: number, width: number): Word[][] {
    const words: Word[] = []
    for (const run of runs) {
      for (const part of toWinAnsi(run.text).split(/(\s+)/)) if (part) words.push({ text: part, bold: Boolean(run.bold), italic: Boolean(run.italic) })
    }
    const lines: Word[][] = []
    let current: Word[] = []
    let currentWidth = 0
    for (const word of words) {
      const space = /^\s+$/.test(word.text)
      const w = this.font(word).widthOfTextAtSize(word.text, size)
      if (space && current.length === 0) continue
      if (currentWidth + w > width && current.length > 0) {
        while (current.length && /^\s+$/.test(current[current.length - 1]!.text)) current.pop()
        lines.push(current)
        current = space ? [] : [word]
        currentWidth = space ? 0 : w
      } else {
        current.push(word)
        currentWidth += w
      }
    }
    if (current.length) lines.push(current)
    return lines.length ? lines : [[]]
  }

  lineWidth(line: Word[], size: number) {
    return line.reduce((s, w) => s + this.font(w).widthOfTextAtSize(w.text, size), 0)
  }

  drawWords(line: Word[], x: number, y: number, size: number, width: number, align: Align, color: RGB = TEXT) {
    let cursor = x
    const lw = this.lineWidth(line, size)
    if (align === 'center') cursor += (width - lw) / 2
    if (align === 'right') cursor += width - lw
    for (const word of line) {
      const font = this.font(word)
      this.page.drawText(word.text, { x: cursor, y, size, font, color })
      cursor += font.widthOfTextAtSize(word.text, size)
    }
  }

  textLine(runs: DocRun[], size: number, align: Align, width: number, x: number, color?: RGB) {
    for (const line of this.wrap(runs, size, width)) {
      this.drawWords(line, x, this.y - size, size, width, align, color)
      this.y -= size * 1.35
    }
  }

  text(runs: DocRun[], opts: { size: number; align?: Align; gap?: number; indent?: number; color?: RGB }) {
    const indent = opts.indent ?? 0
    const lineHeight = opts.size * 1.4
    for (const line of this.wrap(runs, opts.size, CONTENT_WIDTH - indent)) {
      this.ensure(lineHeight)
      this.drawWords(line, MARGIN.left + indent, this.y - opts.size, opts.size, CONTENT_WIDTH - indent, opts.align ?? 'left', opts.color)
      this.y -= lineHeight
    }
    this.y -= opts.gap ?? 6
  }

  /** Linha de tabela com células de texto quebrado; repete na página seguinte se não couber. */
  row(cells: Array<{ runs: DocRun[]; align?: Align; color?: RGB; fill?: RGB }>, widths: number[], size: number) {
    const padding = 4
    const lineHeight = size * 1.35
    const wrapped = cells.map((c, i) => this.wrap(c.runs, size, widths[i]! - padding * 2))
    const height = Math.max(...wrapped.map((l) => l.length)) * lineHeight + padding * 2
    this.ensure(height)
    let x = MARGIN.left
    wrapped.forEach((lines, i) => {
      this.page.drawRectangle({ x, y: this.y - height, width: widths[i]!, height, borderColor: BLACK, borderWidth: 0.6, color: cells[i]!.fill })
      let ty = this.y - padding - size
      for (const line of lines) {
        this.drawWords(line, x + padding, ty, size, widths[i]! - padding * 2, cells[i]!.align ?? 'left', cells[i]!.color)
        ty -= lineHeight
      }
      x += widths[i]!
    })
    this.y -= height
  }

  sectionTitle(text: string) {
    this.ensure(48)
    this.y -= 8
    this.text([{ text, bold: true }], { size: 11, align: 'center', gap: 2 })
  }

  fields(block: Extract<DocBlock, { type: 'fields' }>) {
    if (block.title) this.text([{ text: block.title, italic: true }], { size: 9.5, gap: 2 })
    const valueRun = (r: FieldRow): DocRun[] => [{ text: r.value }]
    for (const r of block.rows) {
      if (block.layout === 'inline') {
        this.row([{ runs: [{ text: `${r.label}: `, bold: true }, ...valueRun(r)], color: r.pending ? PENDING : TEXT }], [CONTENT_WIDTH], 10.5)
      } else {
        this.row(
          [
            { runs: [{ text: r.label }] },
            { runs: valueRun(r), color: r.pending ? PENDING : TEXT },
          ],
          [CONTENT_WIDTH * 0.42, CONTENT_WIDTH * 0.58],
          10.5,
        )
      }
    }
    this.y -= 6
  }

  /** Caixa com bordas que acompanha quebras de página. */
  box(block: Extract<DocBlock, { type: 'box' }>) {
    if (block.title) this.sectionTitle(block.title)
    const size = 10.5
    const lineHeight = size * 1.45
    const padding = 6
    const inner = CONTENT_WIDTH - padding * 2
    type BoxLine = { words: Word[]; align: Align; gapAfter: number }
    const lines: BoxLine[] = []
    for (const item of block.items) {
      if (item.type === 'paragraph') {
        const wrapped = this.wrap(item.runs, size, inner)
        wrapped.forEach((words, i) => lines.push({ words, align: 'justify', gapAfter: i === wrapped.length - 1 ? 6 : 0 }))
      } else {
        lines.push({ words: [], align: 'left', gapAfter: 26 })
        lines.push({ words: [{ text: '________________________________________________', bold: false, italic: false }], align: 'center', gapAfter: 0 })
        const label = item.inline ? `${item.name} - ${item.role}` : item.name
        lines.push({ words: this.wrap([{ text: label }], size, inner)[0]!, align: 'center', gapAfter: item.inline ? 4 : 0 })
        if (!item.inline) lines.push({ words: this.wrap([{ text: item.role }], size, inner)[0]!, align: 'center', gapAfter: 4 })
      }
    }
    if (lines.length === 0) lines.push({ words: [], align: 'left', gapAfter: 0 })

    this.ensure(lineHeight + padding * 2)
    let segmentTop = this.y
    const closeSegment = () => {
      const bottom = this.y - padding
      this.page.drawRectangle({ x: MARGIN.left, y: bottom, width: CONTENT_WIDTH, height: segmentTop - bottom, borderColor: BLACK, borderWidth: 0.6 })
      this.y = bottom
    }
    this.y -= padding
    for (const line of lines) {
      const needed = lineHeight + line.gapAfter
      if (this.y - needed < MARGIN.bottom + padding) {
        closeSegment()
        this.addPage()
        segmentTop = this.y
        this.y -= padding
      }
      if (line.words.length) this.drawWords(line.words, MARGIN.left + padding, this.y - size, size, inner, line.align === 'justify' ? 'left' : line.align)
      this.y -= lineHeight + line.gapAfter
    }
    closeSegment()
    this.y -= 8
  }

  choice(block: Extract<DocBlock, { type: 'choice' }>) {
    const checked = block.options.find((o) => o.checked)
    const leftRuns: DocRun[] = []
    for (const o of block.options) leftRuns.push({ text: `( ${o.key} ) ${o.label}`, bold: true }, { text: '\n' })
    const widths = [CONTENT_WIDTH * 0.8, CONTENT_WIDTH * 0.2]
    for (const o of block.options) {
      this.row(
        [
          { runs: [{ text: `( ${o.key} ) ${o.label}`, bold: true }] },
          { runs: [{ text: o === block.options[0] ? 'Assinale A ou B' : `(  ${checked?.key ?? ' '}  )`, bold: true }], align: 'center' },
        ],
        widths,
        10.5,
      )
    }
    for (const d of block.details) {
      this.row(
        [
          { runs: [{ text: `${d.label}: `, bold: true }, { text: d.value }], color: d.pending ? PENDING : TEXT },
          { runs: [{ text: '' }] },
        ],
        widths,
        10.5,
      )
    }
    this.y -= 8
  }

  table(block: Extract<DocBlock, { type: 'table' }>) {
    const total = block.widths.reduce((s, w) => s + w, 0)
    const widths = block.widths.map((w) => (w / total) * CONTENT_WIDTH)
    const last = block.columns.length - 1
    const header = () =>
      this.row(block.columns.map((c, i) => ({ runs: [{ text: c, bold: true }], fill: rgb(0.9, 0.91, 0.93), align: i === last ? 'right' : 'left' })), widths, 8.5)
    header()
    for (const r of block.rows) {
      if (this.y - 30 < MARGIN.bottom) {
        this.addPage()
        header()
      }
      this.row(r.map((c, i) => ({ runs: [{ text: c }], align: i === last ? 'right' : 'left' })), widths, 8.5)
    }
    if (block.footer) this.row(block.footer.map((c, i) => ({ runs: [{ text: c, bold: true }], fill: rgb(0.9, 0.91, 0.93), align: i === last ? 'right' : 'left' })), widths, 8.5)
    this.y -= 10
  }
}

export async function renderPdf(doc: AmendmentDocument, meta: { generatedAt: string }): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(toWinAnsi(doc.title))
  pdf.setCreator('LegisMind')
  pdf.setProducer('LegisMind')
  const fonts: Fonts = {
    regular: await pdf.embedFont(StandardFonts.TimesRoman),
    bold: await pdf.embedFont(StandardFonts.TimesRomanBold),
    italic: await pdf.embedFont(StandardFonts.TimesRomanItalic),
    boldItalic: await pdf.embedFont(StandardFonts.TimesRomanBoldItalic),
  }
  const layout = new Layout(pdf, fonts)
  const header = doc.blocks.find((b): b is Extract<DocBlock, { type: 'pageHeader' }> => b.type === 'pageHeader')
  if (header) layout.header = header.lines
  layout.addPage()

  for (const block of doc.blocks) {
    switch (block.type) {
      case 'pageHeader':
        break
      case 'heading':
        if (block.level === 3) {
          layout.ensure(36)
          layout.text([{ text: block.text, bold: true }], { size: 11, gap: 4 })
        } else layout.sectionTitle(block.text)
        break
      case 'paragraph':
        layout.text(block.runs, { size: 11, align: block.align === 'center' ? 'center' : 'left', indent: block.indent ? CONTENT_WIDTH * 0.45 : 0, gap: 8 })
        break
      case 'fields':
        layout.fields(block)
        break
      case 'box':
        layout.box(block)
        break
      case 'choice':
        layout.choice(block)
        break
      case 'table':
        layout.table(block)
        break
      case 'signature':
        layout.ensure(80)
        layout.y -= 40
        layout.text([{ text: '________________________________________________' }], { size: 11, align: 'center', gap: 0 })
        layout.text([{ text: block.inline ? `${block.name} - ${block.role}` : block.name }], { size: 11, align: 'center', gap: 0 })
        if (!block.inline) layout.text([{ text: block.role }], { size: 10, align: 'center' })
        break
      case 'notice':
        layout.text([{ text: block.text, bold: true }], { size: 9, color: rgb(0.57, 0.25, 0.05) })
        break
    }
  }

  const total = layout.pages.length
  layout.pages.forEach((page, index) => {
    if (doc.watermark) {
      const text = toWinAnsi(doc.watermark)
      const size = 34
      const width = fonts.bold.widthOfTextAtSize(text, size)
      page.drawText(text, {
        x: A4.width / 2 - (width * Math.cos(Math.PI / 4)) / 2,
        y: A4.height / 2 - (width * Math.sin(Math.PI / 4)) / 2,
        size,
        font: fonts.bold,
        color: rgb(0.85, 0.2, 0.2),
        opacity: 0.12,
        rotate: degrees(45),
      })
    }
    const footer = toWinAnsi(`Gerado pelo LegisMind em ${meta.generatedAt} — página ${index + 1} de ${total}`)
    const fw = fonts.regular.widthOfTextAtSize(footer, 7.5)
    page.drawText(footer, { x: (A4.width - fw) / 2, y: 30, size: 7.5, font: fonts.regular, color: rgb(0.42, 0.45, 0.5) })
  })

  return pdf.save()
}
