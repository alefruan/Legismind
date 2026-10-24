/**
 * Segmentação de textos normativos em trechos com referência a páginas e seções.
 * Preserva limites de artigos sempre que possível para que cada trecho seja
 * citável de forma autônoma ("Art. 35 da LDO, p. 12").
 */

export interface PageText {
  page: number
  text: string
}

export interface TextChunk {
  index: number
  pageStart: number
  pageEnd: number
  sectionPath: string | null
  content: string
}

export interface ChunkOptions {
  targetChars?: number
  maxChars?: number
  minChars?: number
}

const STRUCTURE = [
  { level: 0, regex: /^(T[IÍ]TULO\s+[IVXLCDM\d]+.*)$/i },
  { level: 1, regex: /^(CAP[IÍ]TULO\s+[IVXLCDM\d]+.*)$/i },
  { level: 2, regex: /^(SE[CÇ][AÃ]O\s+[IVXLCDM\d]+.*)$/i },
  { level: 3, regex: /^(SUBSE[CÇ][AÃ]O\s+[IVXLCDM\d]+.*)$/i },
]
const ARTICLE = /^(Art\.?\s*\d+[º°o]?(?:-[A-Z])?)[\s.–-]/i

export function normalizeExtractedText(text: string): string {
  return text
    .replace(/\u0000/g, '')
    .replace(/[­]/g, '')
    .replace(/(\w)-\n(\w)/g, '$1$2')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function chunkPages(pages: PageText[], options: ChunkOptions = {}): TextChunk[] {
  const target = options.targetChars ?? 1400
  const max = options.maxChars ?? 2200
  const min = options.minChars ?? 300

  const chunks: TextChunk[] = []
  const path: string[] = []
  let article: string | null = null
  let buffer: string[] = []
  let bufferLength = 0
  let pageStart = pages[0]?.page ?? 1
  let pageEnd = pageStart
  let bufferSection: string | null = null

  const sectionLabel = () => {
    const parts = path.filter(Boolean)
    if (article) parts.push(article)
    return parts.length ? parts.join(' > ') : null
  }

  const flush = () => {
    const content = buffer.join('\n').trim()
    if (content) {
      chunks.push({ index: chunks.length, pageStart, pageEnd, sectionPath: bufferSection, content })
    }
    buffer = []
    bufferLength = 0
  }

  const push = (line: string, page: number) => {
    if (buffer.length === 0) {
      pageStart = page
      bufferSection = sectionLabel()
    }
    buffer.push(line)
    bufferLength += line.length + 1
    pageEnd = page
  }

  for (const { page, text } of pages) {
    const lines = normalizeExtractedText(text).split('\n')
    for (const raw of lines) {
      const line = raw.trim()
      if (!line) continue

      const structural = STRUCTURE.find((s) => s.regex.test(line))
      if (structural) {
        if (bufferLength >= min) flush()
        path.length = structural.level
        path[structural.level] = line.slice(0, 80)
        article = null
        push(line, page)
        continue
      }

      const art = ARTICLE.exec(line)
      if (art) {
        if (bufferLength >= min) flush()
        article = art[1]!.replace(/\s+/g, ' ')
      }

      if (bufferLength + line.length > max && bufferLength > 0) flush()

      if (line.length > max) {
        // parágrafo excessivamente longo (tabelas achatadas): divide por tamanho
        for (let i = 0; i < line.length; i += target) {
          push(line.slice(i, i + target), page)
          flush()
        }
        continue
      }

      push(line, page)
      if (bufferLength >= target && !art) flush()
    }
  }
  flush()
  return chunks
}

/** Estimativa conservadora de tokens (~4 caracteres por token em português). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}
