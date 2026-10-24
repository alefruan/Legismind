import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import type { AmendmentDocument, BoxItem, DocBlock, DocRun, FieldRow } from '../../shared/domain/amendments/document.js'

const FONT = 'Times New Roman'
const PENDING_COLOR = 'B45309'

const border = { style: BorderStyle.SINGLE, size: 6, color: '000000' }
const borders = { top: border, bottom: border, left: border, right: border }
const margins = { top: 80, bottom: 80, left: 100, right: 100 }

function runs(items: DocRun[], size = 22, color?: string) {
  return items.map((r) => new TextRun({ text: r.text, bold: r.bold, italics: r.italic, size, font: FONT, color }))
}

function sectionTitle(text: string) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 280, after: 60 },
    children: [new TextRun({ text, bold: true, size: 22, font: FONT })],
  })
}

function fieldValue(row: FieldRow) {
  return new TextRun({ text: row.value, size: 22, font: FONT, color: row.pending ? PENDING_COLOR : undefined })
}

function fieldsBlock(block: Extract<DocBlock, { type: 'fields' }>): Array<Paragraph | Table> {
  const out: Array<Paragraph | Table> = []
  if (block.title) out.push(new Paragraph({ spacing: { before: 120, after: 40 }, children: [new TextRun({ text: block.title, italics: true, size: 20, font: FONT })] }))
  const rows =
    block.layout === 'inline'
      ? block.rows.map(
          (r) =>
            new TableRow({
              children: [
                new TableCell({
                  borders,
                  margins,
                  width: { size: 100, type: WidthType.PERCENTAGE },
                  children: [new Paragraph({ children: [new TextRun({ text: `${r.label}: `, bold: true, size: 22, font: FONT }), fieldValue(r)] })],
                }),
              ],
            }),
        )
      : block.rows.map(
          (r) =>
            new TableRow({
              children: [
                new TableCell({ borders, margins, width: { size: 42, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [new TextRun({ text: r.label, size: 22, font: FONT })] })] }),
                new TableCell({ borders, margins, width: { size: 58, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [fieldValue(r)] })] }),
              ],
            }),
        )
  out.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }))
  return out
}

function boxItems(items: BoxItem[]) {
  const children: Paragraph[] = []
  for (const item of items) {
    if (item.type === 'paragraph') {
      children.push(new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { after: 120, line: 320 }, children: runs(item.runs) }))
    } else {
      children.push(new Paragraph({ spacing: { before: 600 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: '________________________________________________', font: FONT })] }))
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 120 },
          children: [new TextRun({ text: item.inline ? `${item.name} - ${item.role}` : item.name, size: 22, font: FONT })],
        }),
      )
      if (!item.inline) children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: item.role, size: 20, font: FONT })] }))
    }
  }
  return children.length ? children : [new Paragraph({ children: [] })]
}

function boxBlock(block: Extract<DocBlock, { type: 'box' }>): Array<Paragraph | Table> {
  return [
    ...(block.title ? [sectionTitle(block.title)] : []),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [new TableRow({ children: [new TableCell({ borders, margins: { top: 100, bottom: 100, left: 120, right: 120 }, children: boxItems(block.items) })] })],
    }),
  ]
}

function choiceBlock(block: Extract<DocBlock, { type: 'choice' }>): Table {
  const checked = block.options.find((o) => o.checked)
  const left = [
    ...block.options.map((o) => new Paragraph({ children: [new TextRun({ text: `( ${o.key} ) ${o.label}`, bold: true, size: 22, font: FONT })] })),
    new Paragraph({ children: [] }),
    ...block.details.flatMap((d) => [
      new Paragraph({ spacing: { before: 120 }, children: [new TextRun({ text: `${d.label}: `, bold: true, size: 22, font: FONT }), fieldValue(d)] }),
    ]),
  ]
  const right = [
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Assinale A ou B', bold: true, size: 22, font: FONT })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `(  ${checked?.key ?? ' '}  )`, bold: true, size: 22, font: FONT })] }),
  ]
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          new TableCell({ borders, margins, width: { size: 80, type: WidthType.PERCENTAGE }, children: left }),
          new TableCell({ borders, margins, width: { size: 20, type: WidthType.PERCENTAGE }, children: right }),
        ],
      }),
    ],
  })
}

function tableBlock(block: Extract<DocBlock, { type: 'table' }>) {
  const cell = (text: string, opts: { bold?: boolean; header?: boolean; width: number; right?: boolean }) =>
    new TableCell({
      width: { size: opts.width, type: WidthType.PERCENTAGE },
      borders,
      shading: opts.header ? { type: ShadingType.CLEAR, color: 'auto', fill: 'E5E7EB' } : undefined,
      margins,
      children: [new Paragraph({ alignment: opts.right ? AlignmentType.RIGHT : AlignmentType.LEFT, children: [new TextRun({ text, bold: opts.bold, size: 18, font: FONT })] })],
    })
  const last = block.columns.length - 1
  const rows = [
    new TableRow({ tableHeader: true, children: block.columns.map((c, i) => cell(c, { bold: true, header: true, width: block.widths[i] ?? 20, right: i === last })) }),
    ...block.rows.map((r) => new TableRow({ children: r.map((c, i) => cell(c, { width: block.widths[i] ?? 20, right: i === last })) })),
  ]
  if (block.footer) rows.push(new TableRow({ children: block.footer.map((c, i) => cell(c, { bold: true, header: true, width: block.widths[i] ?? 20, right: i === last })) }))
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows })
}

export async function renderDocx(doc: AmendmentDocument, meta: { generatedAt: string }): Promise<Uint8Array> {
  const children: Array<Paragraph | Table> = []
  const headerLines: Paragraph[] = []

  for (const block of doc.blocks) {
    switch (block.type) {
      case 'pageHeader':
        for (const line of block.lines) headerLines.push(new Paragraph({ alignment: AlignmentType.CENTER, children: runs(line, 22) }))
        break
      case 'heading':
        children.push(
          block.level === 3
            ? new Paragraph({ spacing: { before: 240, after: 80 }, children: [new TextRun({ text: block.text, bold: true, size: 22, font: FONT })] })
            : sectionTitle(block.text),
        )
        break
      case 'paragraph':
        children.push(
          new Paragraph({
            alignment: block.align === 'center' ? AlignmentType.CENTER : block.indent ? AlignmentType.LEFT : AlignmentType.JUSTIFIED,
            indent: block.indent ? { left: 4200 } : undefined,
            spacing: { before: block.indent ? 200 : 0, after: 160, line: 300 },
            children: runs(block.runs),
          }),
        )
        break
      case 'fields':
        children.push(...fieldsBlock(block))
        break
      case 'box':
        children.push(...boxBlock(block))
        break
      case 'choice':
        children.push(choiceBlock(block))
        break
      case 'table':
        children.push(tableBlock(block))
        children.push(new Paragraph({ spacing: { after: 120 }, children: [] }))
        break
      case 'signature':
        children.push(...boxItems([{ type: 'signature', name: block.name, role: block.role, inline: block.inline }]))
        break
      case 'notice':
        children.push(
          new Paragraph({
            spacing: { after: 120 },
            shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'FEF3C7' },
            children: [new TextRun({ text: block.text, bold: true, size: 18, font: FONT, color: '92400E' })],
          }),
        )
        break
    }
  }

  if (doc.watermark) {
    headerLines.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: doc.watermark, bold: true, color: 'B91C1C', size: 16, font: FONT })] }))
  }

  const document = new Document({
    creator: 'LegisMind',
    title: doc.title,
    description: 'Minuta gerada pelo LegisMind para conferência, assinatura e protocolo.',
    sections: [
      {
        properties: { page: { margin: { top: 1134, bottom: 1134, left: 1418, right: 1134 } } },
        headers: headerLines.length ? { default: new Header({ children: headerLines }) } : undefined,
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: `Gerado pelo LegisMind em ${meta.generatedAt} — página `, size: 16, color: '6B7280', font: FONT }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '6B7280', font: FONT }),
                  new TextRun({ text: ' de ', size: 16, color: '6B7280', font: FONT }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: '6B7280', font: FONT }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  })
  return new Uint8Array(await Packer.toBuffer(document))
}
