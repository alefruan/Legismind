import { centsToWords, formatBRL, type Cents } from '../money.js'
import { formatCnpj, formatNatureForDocument, type NatureFormat } from '../budget/codes.js'
import type { TextSubtype, ValidationOutcome } from './types.js'
import { BUDGET_FORM_TEMPLATE } from './templates.js'

/** Modelo intermediário de documento, renderizado em HTML (prévia), DOCX e PDF. */
export type DocRun = { text: string; bold?: boolean; italic?: boolean }

export interface FieldRow {
  label: string
  value: string
  pending?: boolean
}

export type BoxItem =
  | { type: 'paragraph'; runs: DocRun[] }
  | { type: 'signature'; name: string; role: string; inline?: boolean }

export type DocBlock =
  /** Cabeçalho institucional — repetido no topo de cada página no DOCX/PDF. */
  | { type: 'pageHeader'; lines: DocRun[][] }
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; runs: DocRun[]; align?: 'left' | 'center' | 'justify'; indent?: boolean }
  | { type: 'table'; columns: string[]; rows: string[][]; widths: number[]; footer?: string[] }
  /** Quadro rótulo/valor: "columns" = duas colunas; "inline" = "Rótulo: valor" em linha única. */
  | { type: 'fields'; title?: string; layout: 'columns' | 'inline'; rows: FieldRow[] }
  /** Caixa com título (justificativa, declaração, texto da emenda). */
  | { type: 'box'; title?: string; items: BoxItem[] }
  /** Escolha do tipo de beneficiário/executor (A/B) com detalhes. */
  | { type: 'choice'; options: Array<{ key: string; label: string; checked: boolean }>; details: FieldRow[] }
  | { type: 'signature'; name: string; role: string; inline?: boolean }
  | { type: 'notice'; text: string }

export interface AmendmentDocument {
  title: string
  blocks: DocBlock[]
  watermark: string | null
  pendingItems: string[]
  isDemo: boolean
}

export interface DocumentAllocationLine {
  programmaticCode: string
  agencyCode?: string | null
  agencyName?: string | null
  unitCode?: string | null
  unitName?: string | null
  functionCode?: string | null
  subfunctionCode?: string | null
  programCode?: string | null
  actionCode?: string | null
  actionName: string
  expenseNature: string
  sourceCode: string
  amountCents: Cents
  note?: string | null
}

export interface AmendmentDocumentData {
  /** Linhas do cabeçalho institucional, separadas por quebra de linha (aceita **negrito**). */
  institutionHeader: string
  number: string | null
  protocolNumber?: string | null
  fiscalYear: number
  billNumber?: string | null
  billSummary?: string | null
  modalityName: string
  modalityKind?: 'budget' | 'text'
  typeLabel?: string | null
  textSubtype?: TextSubtype | null
  isImpositive?: boolean
  parliamentarianName: string
  parliamentarianTitle?: string | null
  party?: string | null
  officeName: string
  object: string | null
  purpose: string | null
  justification: string | null
  legalGrounds: string | null
  physicalGoal?: string | null
  beneficiaryLocation?: string | null
  beneficiaryType: string
  beneficiaryName: string | null
  beneficiaryCnpj: string | null
  textTarget?: string | null
  textCommand?: string | null
  originalText?: string | null
  newText?: string | null
  destinations: DocumentAllocationLine[]
  cancellations: DocumentAllocationLine[]
  requiresCancellation: boolean
  /** Local da assinatura (ex.: "João Pessoa - PB"). */
  city: string | null
  /** Data de geração (AAAA-MM-DD). */
  date: string
  indicationDate?: string | null
  natureFormat?: NatureFormat
  validationOutcome: ValidationOutcome | null
  validationCurrent: boolean
  status: string
  isDemo: boolean
}

const PENDING = (label: string) => `[PENDENTE: ${label}]`
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

function formatLongDate(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return `${d} de ${MONTHS[(m ?? 1) - 1]} de ${y}`
}

function formatSlashedDate(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d} / ${m} / ${y}`
}

/** Valor sem o símbolo da moeda (o rótulo do formulário já indica "R$"). */
function formatAmount(cents: Cents) {
  return (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const subtypeLabels: Record<TextSubtype, string> = { aditiva: 'Aditiva', modificativa: 'Modificativa', supressiva: 'Supressiva' }

function allocationTable(lines: DocumentAllocationLine[], kind: 'destino' | 'anulação', format: NatureFormat): DocBlock {
  const total = lines.reduce((s, l) => s + l.amountCents, 0)
  return {
    type: 'table',
    columns: ['Classificação funcional-programática', 'Ação', 'Natureza', 'Fonte', `Valor (${kind === 'destino' ? 'acréscimo' : 'anulação'})`],
    widths: [30, 30, 13, 12, 15],
    rows: lines.map((l) => [l.programmaticCode, l.actionName + (l.note ? ` — ${l.note}` : ''), formatNatureForDocument(l.expenseNature, format), l.sourceCode, formatBRL(l.amountCents)]),
    footer: ['Total', '', '', '', formatBRL(total)],
  }
}

/** Converte "**negrito**" e "_itálico_" em trechos formatados. */
export function parseRuns(text: string): DocRun[] {
  const runs: DocRun[] = []
  const regex = /\*\*(.+?)\*\*|(?<![\w])_(.+?)_(?![\w])/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index) })
    if (m[1] !== undefined) runs.push({ text: m[1], bold: true })
    else runs.push({ text: m[2]!, italic: true })
    last = m.index + m[0].length
  }
  if (last < text.length) runs.push({ text: text.slice(last) })
  return runs.length ? runs : [{ text: '' }]
}

/**
 * Renderiza a minuta a partir do modelo oficial configurado pela instituição.
 * Campos ausentes viram marcadores [PENDENTE] e são listados — a minuta nunca
 * omite silenciosamente uma informação obrigatória.
 *
 * Sintaxe do modelo:
 *   # / ## título centralizado · ### título à esquerda · **negrito** · _itálico_
 *   {{campo}} substituição em linha · linhas com {{bloco}} isolado geram quadros
 *   :::quadro TÍTULO … ::: caixa com título · :::recuo … ::: parágrafo recuado (ementa)
 */
export function renderAmendmentDocument(template: string, data: AmendmentDocumentData): AmendmentDocument {
  const pending: string[] = []
  const format: NatureFormat = data.natureFormat ?? 'c.g.mm.ee'
  const need = (value: string | null | undefined, label: string) => {
    if (value && value.trim()) return value.trim()
    pending.push(label)
    return PENDING(label)
  }

  const indicationIso = data.indicationDate ?? data.date
  const totalCents = data.destinations.reduce((s, d) => s + d.amountCents, 0)
  const typeLabel = data.typeLabel?.trim() || data.modalityName
  const signatureRole = data.parliamentarianTitle?.trim() || null

  const legacyBeneficiary = () => {
    if (data.beneficiaryType === 'osc') {
      const name = need(data.beneficiaryName, 'razão social da OSC')
      const cnpj = data.beneficiaryCnpj ? formatCnpj(data.beneficiaryCnpj) : need(null, 'CNPJ da OSC')
      return `${name}, inscrita no CNPJ sob o nº ${cnpj}, organização da sociedade civil (Lei nº 13.019/2014).`
    }
    if (data.beneficiaryType === 'public_entity') return need(data.beneficiaryName, 'entidade pública beneficiária')
    if (data.beneficiaryType === 'own_administration') return 'Execução direta pela Administração.'
    return data.beneficiaryName?.trim() || 'Não se aplica.'
  }

  // Campos avaliados sob demanda: só geram pendência se o modelo os utilizar.
  const scalar: Record<string, () => string> = {
    instituicao: () => data.institutionHeader.split(/\r?\n/).map((l) => l.replace(/\*\*|_/g, '').trim()).filter(Boolean).join(' — '),
    numero: () => data.number ?? 'S/N (numeração no protocolo)',
    numero_emenda: () => data.protocolNumber?.trim() || `______ / ${indicationIso.slice(0, 4)}`,
    exercicio: () => String(data.fiscalYear),
    projeto_lei: () => need(data.billNumber, 'número do Projeto de Lei Orçamentária (cadastro do exercício)'),
    ementa_projeto: () => need(data.billSummary, 'ementa do Projeto de Lei Orçamentária (cadastro do exercício)'),
    modalidade: () => data.modalityName,
    tipo_emenda: () => typeLabel,
    subtipo_emenda: () => (data.textSubtype ? subtypeLabels[data.textSubtype] : need(null, 'subtipo da emenda ao texto')),
    subtipo_maiusculo: () => (data.textSubtype ? subtypeLabels[data.textSubtype].toUpperCase() : 'AO TEXTO'),
    parlamentar: () => data.parliamentarianName,
    cargo: () => signatureRole ?? need(null, 'cargo do parlamentar (cadastro do gabinete)'),
    partido: () => need(data.party, 'partido (cadastro do gabinete)'),
    autor_partido: () => `${data.parliamentarianName} / ${need(data.party, 'partido (cadastro do gabinete)')}`,
    gabinete: () => data.officeName,
    objeto: () => need(data.object, 'objeto'),
    finalidade: () => data.purpose?.trim() || '',
    meta_fisica: () => need(data.physicalGoal, 'meta física esperada'),
    localizacao: () => need(data.beneficiaryLocation, 'localização geográfica / endereço'),
    beneficiario: legacyBeneficiary,
    justificativa: () => need(data.justification, 'justificativa'),
    fundamentacao: () => need(data.legalGrounds, 'fundamentação'),
    valor_total: () => (totalCents > 0 ? `${formatBRL(totalCents)} (${centsToWords(totalCents)})` : need(null, 'valor')),
    data_indicacao: () => formatSlashedDate(indicationIso),
    data_extenso: () => formatLongDate(data.date),
    cidade: () => need(data.city, 'local da assinatura (configurações da instituição)'),
    local_data: () => `${data.city ? `${data.city}, ` : ''}${formatLongDate(data.date)}.`,
    dispositivo: () => need(data.textTarget, 'dispositivo alcançado'),
    comando_texto: () => need(data.textCommand, 'comando da emenda'),
    texto_original: () => need(data.originalText, 'texto original'),
    texto_novo: () => need(data.newText, data.textSubtype === 'aditiva' ? 'texto a ser acrescido' : 'nova redação'),
  }

  const substitute = (line: string) =>
    line.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, key: string) => {
      const fn = scalar[key]
      if (fn) return fn()
      pending.push(`campo desconhecido no modelo: ${key}`)
      return PENDING(key)
    })

  // --- Blocos estruturados -------------------------------------------------------
  const allocationFields = (line: DocumentAllocationLine | null, valueLabel: string, missingLabel: string): FieldRow[] => {
    if (!line) {
      pending.push(missingLabel)
      const p = PENDING(missingLabel)
      return ['Órgão', 'Unidade Orçamentária', 'Função / Subfunção', 'Programa / Ação', 'Natureza da Despesa', 'Fonte de Recursos', valueLabel].map((label) => ({ label, value: p, pending: true }))
    }
    const pair = (a?: string | null, b?: string | null) => (a || b ? `${a ?? '—'} / ${b ?? '—'}` : '—')
    const named = (code?: string | null, name?: string | null) => [code, name].filter(Boolean).join(' – ') || '—'
    if (!line.agencyCode && line.programmaticCode === 'NOVA PROGRAMAÇÃO') {
      return [
        { label: 'Programação', value: `${line.actionName} — depende de autorização normativa`, pending: true },
        { label: 'Natureza da Despesa', value: formatNatureForDocument(line.expenseNature, format) },
        { label: 'Fonte de Recursos', value: line.sourceCode },
        { label: valueLabel, value: formatAmount(line.amountCents) },
      ]
    }
    // Sem a classificação desdobrada (ex.: dados antigos), usa a funcional-programática completa.
    if (!line.agencyCode && !line.functionCode && !line.programCode) {
      return [
        { label: 'Funcional Programática', value: named(line.programmaticCode, line.actionName) },
        { label: 'Natureza da Despesa', value: formatNatureForDocument(line.expenseNature, format) },
        { label: 'Fonte de Recursos', value: line.sourceCode },
        { label: valueLabel, value: formatAmount(line.amountCents) },
      ]
    }
    return [
      { label: 'Órgão', value: named(line.agencyCode, line.agencyName) },
      { label: 'Unidade Orçamentária', value: named(line.unitCode, line.unitName) },
      { label: 'Função / Subfunção', value: pair(line.functionCode, line.subfunctionCode) },
      { label: 'Programa / Ação', value: [pair(line.programCode, line.actionCode), line.actionName].filter((v) => v && v !== '—').join(' – ') || '—' },
      { label: 'Natureza da Despesa', value: formatNatureForDocument(line.expenseNature, format) },
      { label: 'Fonte de Recursos', value: line.sourceCode },
      { label: valueLabel, value: formatAmount(line.amountCents) },
    ]
  }

  const allocationBlocks = (lines: DocumentAllocationLine[], valueLabel: string, kind: 'destino' | 'anulação'): DocBlock[] => {
    if (lines.length === 0) {
      if (kind === 'anulação' && !data.requiresCancellation) {
        return [{ type: 'paragraph', runs: [{ text: 'Não se aplica a esta modalidade.' }] }]
      }
      return [{ type: 'fields', layout: 'columns', rows: allocationFields(null, valueLabel, kind === 'destino' ? 'programação de destino' : 'anulação compensatória') }]
    }
    return lines.map((line, i) => ({
      type: 'fields' as const,
      layout: 'columns' as const,
      title: lines.length > 1 ? `${kind === 'destino' ? 'Destinação' : 'Anulação'} ${i + 1} de ${lines.length}` : undefined,
      rows: allocationFields(line, valueLabel, ''),
    }))
  }

  const headerBlock = (): DocBlock => {
    const raw = data.institutionHeader.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    const hasMarkup = raw.some((l) => /\*\*|_/.test(l))
    const lines: DocRun[][] = raw.map((l, i) => (hasMarkup ? parseRuns(l) : [{ text: l, bold: i > 0 }]))
    lines.push([{ text: data.officeName, italic: true, bold: true }])
    return { type: 'pageHeader', lines }
  }

  const blockPlaceholders: Record<string, (arg: string | undefined) => DocBlock[]> = {
    cabecalho: () => [headerBlock()],
    tabela_destinacao: () => {
      if (data.destinations.length === 0) {
        pending.push('programação de destino')
        return [{ type: 'paragraph', runs: [{ text: PENDING('programação de destino') }] }]
      }
      return [allocationTable(data.destinations, 'destino', format)]
    },
    tabela_anulacao: () => {
      if (data.cancellations.length === 0) {
        if (data.requiresCancellation) pending.push('anulação compensatória')
        return [{ type: 'paragraph', runs: [{ text: data.requiresCancellation ? PENDING('anulação compensatória') : 'Não se aplica a esta modalidade.' }] }]
      }
      return [allocationTable(data.cancellations, 'anulação', format)]
    },
    acrescimo: (label) => allocationBlocks(data.destinations, label ?? 'Valor Destinado (R$)', 'destino'),
    cancelamento: (label) =>
      allocationBlocks(data.cancellations, label ?? (data.isImpositive ? 'Valor (R$) da cota-parte do parlamentar' : 'Valor Anulado (R$)'), 'anulação'),
    autoria: () => [
      {
        type: 'fields',
        layout: 'inline',
        rows: [
          { label: 'Emenda nº', value: scalar.numero_emenda!() },
          { label: 'Tipo de emenda', value: typeLabel },
          ...(data.modalityKind === 'text' ? [{ label: 'Subtipo de emenda', value: scalar.subtipo_emenda!() }] : []),
          { label: 'Autor / Partido', value: scalar.autor_partido!() },
          { label: 'Data da indicação', value: scalar.data_indicacao!() },
        ],
      },
    ],
    objeto_tabela: () => [
      {
        type: 'fields',
        layout: 'columns',
        rows: [
          { label: 'Descrição da despesa', value: scalar.objeto!(), pending: !data.object?.trim() },
          { label: 'Meta física esperada', value: scalar.meta_fisica!(), pending: !data.physicalGoal?.trim() },
        ],
      },
    ],
    beneficiario_quadro: () => {
      const isPublic = data.beneficiaryType === 'public_entity' || data.beneficiaryType === 'own_administration'
      const isPrivate = data.beneficiaryType === 'osc'
      if (!isPublic && !isPrivate) pending.push('tipo de beneficiário/executor (A ou B)')
      const details: FieldRow[] = []
      if (isPrivate) {
        details.push({ label: 'Razão Social', value: need(data.beneficiaryName, 'razão social da instituição'), pending: !data.beneficiaryName?.trim() })
        details.push({
          label: 'CNPJ',
          value: data.beneficiaryCnpj ? formatCnpj(data.beneficiaryCnpj) : need(null, 'CNPJ da instituição'),
          pending: !data.beneficiaryCnpj,
        })
      } else if (isPublic && data.beneficiaryName?.trim()) {
        details.push({ label: 'Órgão / Entidade', value: data.beneficiaryName.trim() })
      }
      details.push({ label: 'Localização geográfica exata/Endereço', value: scalar.localizacao!(), pending: !data.beneficiaryLocation?.trim() })
      return [
        {
          type: 'choice',
          options: [
            { key: 'A', label: 'Órgão Público', checked: isPublic },
            { key: 'B', label: 'Instituição Privada sem Fins Lucrativos', checked: isPrivate },
          ],
          details,
        },
      ]
    },
    assinatura: () => [{ type: 'signature', name: data.parliamentarianName, role: signatureRole ?? 'Autor(a) da emenda' }],
    assinatura_linha: () => [{ type: 'signature', name: data.parliamentarianName, role: scalar.cargo!(), inline: true }],
  }

  // --- Interpretação do modelo ---------------------------------------------------
  const blocks: DocBlock[] = []
  const lines = template.replace(/\r\n/g, '\n').split('\n')
  let paragraph: string[] = []
  let container: { kind: 'box'; title?: string; items: BoxItem[] } | { kind: 'indent'; text: string[] } | null = null

  const flush = () => {
    if (paragraph.length === 0) return
    const text = paragraph.join(' ').trim()
    if (text) blocks.push({ type: 'paragraph', runs: parseRuns(text), align: 'justify' })
    paragraph = []
  }

  const blockPattern = /^\{\{\s*([a-z_]+)\s*(?:\|([^}]*))?\}\}$/

  for (const rawLine of lines) {
    const line = rawLine.trim()

    // Fechamento de contêiner
    if (container && line === ':::') {
      if (container.kind === 'box') blocks.push({ type: 'box', title: container.title, items: container.items })
      else {
        const text = container.text.join(' ').trim()
        if (text) blocks.push({ type: 'paragraph', runs: parseRuns(text), align: 'left', indent: true })
      }
      container = null
      continue
    }

    if (container?.kind === 'box') {
      if (!line) continue
      const block = blockPattern.exec(line)
      if (block && (block[1] === 'assinatura' || block[1] === 'assinatura_linha')) {
        const [signature] = blockPlaceholders[block[1]]!(undefined)
        if (signature?.type === 'signature') container.items.push({ type: 'signature', name: signature.name, role: signature.role, inline: signature.inline })
        continue
      }
      for (const part of substitute(line).split(/\n+/)) {
        if (part.trim()) container.items.push({ type: 'paragraph', runs: parseRuns(part.trim()) })
      }
      continue
    }

    if (container?.kind === 'indent') {
      if (line) container.text.push(substitute(line))
      continue
    }

    // Abertura de contêiner
    const open = /^:::(quadro|recuo)\s*(.*)$/.exec(line)
    if (open) {
      flush()
      container = open[1] === 'quadro' ? { kind: 'box', title: open[2] ? substitute(open[2].trim()) : undefined, items: [] } : { kind: 'indent', text: [] }
      continue
    }

    if (!line) {
      flush()
      continue
    }

    const block = blockPattern.exec(line)
    if (block && blockPlaceholders[block[1]!]) {
      flush()
      blocks.push(...blockPlaceholders[block[1]!]!(block[2]?.trim() || undefined))
      continue
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line)
    if (heading) {
      flush()
      blocks.push({ type: 'heading', level: heading[1]!.length as 1 | 2 | 3, text: substitute(heading[2]!) })
      continue
    }
    paragraph.push(substitute(line))
  }
  flush()
  if (container) {
    // contêiner não fechado no modelo: fecha ao final para não perder conteúdo
    if (container.kind === 'box') blocks.push({ type: 'box', title: container.title, items: container.items })
    else blocks.push({ type: 'paragraph', runs: parseRuns(container.text.join(' ')), indent: true })
  }

  const notices: string[] = []
  if (data.isDemo) notices.push('DOCUMENTO DE DEMONSTRAÇÃO — DADOS FICTÍCIOS, SEM VALOR OFICIAL.')
  if (!data.validationCurrent || data.validationOutcome !== 'validated') {
    notices.push('MINUTA NÃO VALIDADA TECNICAMENTE — sujeita a conferência antes de assinatura e protocolo.')
  }
  const uniquePending = [...new Set(pending.filter(Boolean))]
  if (uniquePending.length > 0) notices.push(`Pendências: ${uniquePending.join('; ')}.`)

  const watermark = data.isDemo
    ? 'DEMONSTRAÇÃO — DADOS FICTÍCIOS'
    : !data.validationCurrent || data.validationOutcome !== 'validated'
      ? 'MINUTA — NÃO VALIDADA'
      : null

  // Avisos após o cabeçalho institucional (o cabeçalho sempre inicia o documento).
  const headerIndex = blocks.findIndex((b) => b.type === 'pageHeader')
  const noticeBlocks = notices.map((text): DocBlock => ({ type: 'notice', text }))
  const ordered = headerIndex === 0 ? [blocks[0]!, ...noticeBlocks, ...blocks.slice(1)] : [...noticeBlocks, ...blocks]

  return {
    title: `Emenda ${data.protocolNumber ?? data.number ?? 'S/N'} — PLOA ${data.fiscalYear}`,
    blocks: ordered,
    watermark,
    pendingItems: uniquePending,
    isDemo: data.isDemo,
  }
}

/** Modelo padrão: formulário de emenda orçamentária com quadros. */
export const DEFAULT_AMENDMENT_TEMPLATE = BUDGET_FORM_TEMPLATE
