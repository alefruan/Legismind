import { describe, expect, it } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { Document, Packer, Paragraph } from 'docx'
import ExcelJS from 'exceljs'
import { extractCsv, extractDocx, extractPdf, extractXlsx } from '../../server/documents/extract'
import { parseBudgetRows, parseBudgetText } from '../../shared/domain/documents/budget-parser'
import { chunkPages } from '../../shared/domain/documents/chunking'
import { DEFAULT_AMENDMENT_TEMPLATE, renderAmendmentDocument } from '../../shared/domain/amendments/document'
import { SIMPLE_TEMPLATE } from '../../shared/domain/amendments/templates'
import { renderPdf, toWinAnsi } from '../../server/export/pdf'
import { renderDocx } from '../../server/export/docx'
import { handleApiRequest, resolvePath } from '../../server/http/router'
import { assistantTools } from '../../server/ai/tools/index'
import { toToolSpec } from '../../server/ai/tools/registry'

async function makePdf(lines: string[][]) {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  for (const pageLines of lines) {
    const page = pdf.addPage([595, 842])
    pageLines.forEach((line, i) => page.drawText(toWinAnsi(line), { x: 40, y: 800 - i * 16, size: 9, font }))
  }
  return pdf.save()
}

describe('Extração documental (bibliotecas reais do worker)', () => {
  it('PDF com texto: extrai por página e identifica dotações', async () => {
    const bytes = await makePdf([
      ['PROJETO DE LEI ORÇAMENTÁRIA 2027 — ANEXO (FICTÍCIO)'],
      [
        'ÓRGÃO: 10 - SECRETARIA MUNICIPAL DE ESPORTES E LAZER',
        'UNIDADE: 10.001 - SECRETARIA MUNICIPAL DE ESPORTES E LAZER',
        '27.812.0005.2051 Apoio a Projetos Esportivos de OSC 3.3.50.41 1.500.0000 400.000,00',
        '27.812.0005.2050 Atividades Esportivas Comunitarias 3.3.90.39 1.500.0000 850.000,00',
      ],
    ])
    const extraction = await extractPdf(bytes)
    expect(extraction.pageCount).toBe(2)
    expect(extraction.pages[1]!.text).toContain('27.812.0005.2051')
    const parsed = parseBudgetText(extraction.pages)
    expect(parsed.allocations).toHaveLength(2)
    expect(parsed.allocations[0]).toMatchObject({ unitCode: '10.001', expenseNature: '3.3.50.41', amountCents: 40_000_000, page: 2 })
  })

  it('PDF sem camada de texto é sinalizado para OCR', async () => {
    const pdf = await PDFDocument.create()
    pdf.addPage([595, 842])
    const extraction = await extractPdf(await pdf.save())
    expect(extraction.lowTextPages).toEqual([1])
  })

  it('DOCX: texto normativo segmentado por artigos', async () => {
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph('CAPÍTULO VI'),
            new Paragraph('DAS TRANSFERÊNCIAS'),
            new Paragraph('Art. 35. A transferência de recursos a organizações da sociedade civil observará a Lei Federal nº 13.019, de 2014.'),
            new Paragraph('Art. 36. A Reserva de Contingência para emendas individuais somente poderá ser anulada para atender às emendas.'),
          ],
        },
      ],
    })
    const bytes = new Uint8Array(await Packer.toBuffer(doc))
    const extraction = await extractDocx(bytes)
    const chunks = chunkPages(extraction.pages, { targetChars: 200, maxChars: 400, minChars: 50 })
    expect(chunks.some((c) => c.sectionPath?.includes('Art. 36'))).toBe(true)
  })

  it('XLSX com linhas de título antes do cabeçalho', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('PLOA')
    sheet.addRow(['PLOA 2027 — PLANILHA FICTÍCIA'])
    sheet.addRow([])
    sheet.addRow(['Órgão', 'Unidade', 'Funcional Programática', 'Nome da Ação', 'Natureza', 'Fonte', 'Valor'])
    sheet.addRow(['10', '10.001', '27.812.0005.2051', 'Apoio a OSC', '3.3.50.41', '1500', 400000])
    sheet.addRow(['', '', '', 'TOTAL', '', '', 400000])
    const bytes = new Uint8Array(await workbook.xlsx.writeBuffer())
    const extraction = await extractXlsx(bytes)
    expect(extraction.headerLine).toBe(3)
    const parsed = parseBudgetRows(extraction.rows!)
    expect(parsed.allocations).toHaveLength(1)
    expect(parsed.allocations[0]).toMatchObject({ functionCode: '27', actionCode: '2051', sourceCode: '1500', amountCents: 40_000_000 })
  })

  it('arquivo de demonstração (demo/) é importável integralmente', async () => {
    const { readFileSync } = await import('node:fs')
    const bytes = new Uint8Array(readFileSync(new URL('../../demo/ploa-2027-vila-esperanca-FICTICIO.csv', import.meta.url)))
    const parsed = parseBudgetRows(extractCsv(bytes).rows!)
    expect(parsed.allocations).toHaveLength(8)
    expect(parsed.issues.map((i) => i.code)).toEqual(['skipped_total_row'])
    expect(parsed.allocations.every((a) => a.warnings.length === 0)).toBe(true)
  })

  it('CSV em Latin-1 com ponto e vírgula', () => {
    const csv = 'Órgão;Unidade;Função;Subfunção;Programa;Ação;Natureza;Fonte;Valor\n12;12.001;15;452;0020;2200;3.3.90.39;1.500.0000;3.500.000,00\n'
    const bytes = new Uint8Array([...csv].map((c) => c.charCodeAt(0)))
    const extraction = extractCsv(bytes)
    expect(extraction.warnings.join()).toMatch(/Latin-1/)
    const parsed = parseBudgetRows(extraction.rows!)
    expect(parsed.allocations[0]).toMatchObject({ unitCode: '12.001', amountCents: 350_000_000 })
  })
})

describe('Exportação da minuta', () => {
  const data: Parameters<typeof renderAmendmentDocument>[1] = {
    institutionHeader: 'CÂMARA MUNICIPAL DE TESTE (FICTÍCIA)',
    number: 'EMI-2027/0001',
    fiscalYear: 2027,
    modalityName: 'Emenda individual impositiva',
    parliamentarianName: 'João Exemplo',
    officeName: 'Gabinete do Vereador João Exemplo',
    object: 'Apoio a projeto esportivo de OSC — crianças e adolescentes.',
    purpose: null,
    justification: 'Promoção do esporte comunitário → inclusão social.',
    legalGrounds: 'Lei nº 13.019/2014, art. 29.',
    beneficiaryType: 'osc',
    beneficiaryName: 'Associação Esportiva Exemplo',
    beneficiaryCnpj: '11222333000181',
    destinations: [{ programmaticCode: '10.001.27.812.0005.2051', actionName: 'Apoio a Projetos Esportivos de OSC', expenseNature: '3.3.50.41', sourceCode: '1.500.0000', amountCents: 15_000_000 }],
    cancellations: [{ programmaticCode: '99.999.99.999.9999.9998', actionName: 'Reserva para Emendas', expenseNature: '9.9.99.99.99', sourceCode: '1.500.0000', amountCents: 15_000_000 }],
    requiresCancellation: true,
    city: 'Vila Esperança',
    date: '2026-10-22',
    validationOutcome: 'pending',
    validationCurrent: true,
    status: 'draft',
    isDemo: true,
  }
  const doc = renderAmendmentDocument(DEFAULT_AMENDMENT_TEMPLATE, data)

  it('gera PDF do formulário com cabeçalho em todas as páginas, quadros e marca d’água', async () => {
    const bytes = await renderPdf(doc, { generatedAt: '22/10/2026 10:00' })
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
    const pages = (await extractPdf(bytes)).pages
    expect(pages.length).toBeGreaterThanOrEqual(2)
    for (const page of pages) expect(page.text).toContain('CÂMARA MUNICIPAL DE TESTE (FICTÍCIA)')
    const text = pages.map((p) => p.text).join(' ')
    expect(text).toContain('10.001.27.812.0005.2051')
    expect(text).toContain('Valor Destinado (R$)')
    expect(text).toContain('150.000,00')
    expect(text).toContain('Instituição Privada sem Fins Lucrativos')
    expect(text).toContain('Declaro, para os devidos fins de direito')
    expect(text).toContain('->') // seta substituída por caractere WinAnsi
  })

  it('modelo simplificado em PDF mantém o valor por extenso', async () => {
    const simple = renderAmendmentDocument(SIMPLE_TEMPLATE, data)
    const text = (await extractPdf(await renderPdf(simple, { generatedAt: '22/10/2026 10:00' }))).pages.map((p) => p.text).join(' ')
    expect(text).toContain('cento e cinquenta mil reais')
  })

  it('gera DOCX válido', async () => {
    const bytes = await renderDocx(doc, { generatedAt: '22/10/2026 10:00' })
    expect(bytes[0]).toBe(0x50)
    expect(bytes[1]).toBe(0x4b)
    const roundTrip = await extractDocx(bytes)
    expect(roundTrip.pages.map((p) => p.text).join(' ')).toContain('Associação Esportiva Exemplo')
  })
})

describe('Roteador da API e ferramentas', () => {
  it('resolve caminhos reescritos pela Vercel e diretos', () => {
    expect(resolvePath(new URL('http://x/api/router?__route=assistant/chat'))).toBe('/assistant/chat')
    expect(resolvePath(new URL('http://x/api/amendments/1/validate'))).toBe('/amendments/1/validate')
  })

  it('responde 404, 405 e health sem expor segredos', async () => {
    const missing = await handleApiRequest(new Request('http://x/api/nao-existe'))
    expect(missing.status).toBe(404)
    const wrongMethod = await handleApiRequest(new Request('http://x/api/assistant/chat'))
    expect(wrongMethod.status).toBe(405)
    const health = await handleApiRequest(new Request('http://x/api/router?__route=health'))
    expect(health.status).toBe(200)
    const body = await health.text()
    expect(body).not.toMatch(/sk-ant|service_role/i)
  })

  it('exige autenticação nas rotas protegidas', async () => {
    const response = await handleApiRequest(new Request('http://x/api/budget/query', { method: 'POST', body: '{}' }))
    expect([401, 503]).toContain(response.status)
  })

  it('todas as ferramentas geram JSON Schema de objeto válido', () => {
    const names = new Set<string>()
    for (const tool of assistantTools) {
      const spec = toToolSpec(tool)
      expect(spec.inputSchema.type).toBe('object')
      expect(spec.description.length).toBeGreaterThan(40)
      expect(names.has(spec.name)).toBe(false)
      names.add(spec.name)
    }
    const create = toToolSpec(assistantTools.find((t) => t.name === 'create_amendment_draft')!)
    expect((create.inputSchema.required as string[])).toEqual(expect.arrayContaining(['title', 'object', 'modality_code']))
    // destinações são opcionais no schema (emendas ao texto) e exigidas na execução para modalidades orçamentárias
    expect(create.inputSchema.required as string[]).not.toContain('destinations')
    expect(Object.keys(create.inputSchema.properties as object)).toEqual(expect.arrayContaining(['physical_goal', 'beneficiary_location', 'text_command', 'new_text']))
  })
})
