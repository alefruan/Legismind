import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router'

/**
 * Renderizador de Markdown restrito para respostas do assistente.
 * Gera elementos React (sem HTML bruto), evitando injeção de conteúdo.
 * Suporta: títulos, parágrafos, listas, negrito, itálico, código, tabelas e links internos.
 */
export function Markdown({ text }: { text: string }) {
  const blocks = parseBlocks(text)
  return <div className="prose-legis">{blocks.map((b, i) => renderBlock(b, i))}</div>
}

type Block =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'ul' | 'ol'; items: string[] }
  | { type: 'table'; header: string[]; rows: string[][] }

function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: Block[] = []
  let paragraph: string[] = []
  const flush = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', text: paragraph.join(' ') })
    paragraph = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trimEnd()
    if (!line.trim()) {
      flush()
      continue
    }
    const heading = /^#{1,4}\s+(.*)$/.exec(line)
    if (heading) {
      flush()
      blocks.push({ type: 'heading', text: heading[1]! })
      continue
    }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1]!)) {
      flush()
      const split = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
      const header = split(line)
      const rows: string[][] = []
      i += 2
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]!)) rows.push(split(lines[i++]!))
      i--
      blocks.push({ type: 'table', header, rows })
      continue
    }
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line)
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (bullet || ordered) {
      flush()
      const type = bullet ? 'ul' : 'ol'
      const last = blocks[blocks.length - 1]
      const item = (bullet ?? ordered)![1]!
      if (last && last.type === type) last.items.push(item)
      else blocks.push({ type, items: [item] })
      continue
    }
    paragraph.push(line.trim())
  }
  flush()
  return blocks
}

function renderBlock(block: Block, key: number): ReactNode {
  switch (block.type) {
    case 'heading':
      return <h3 key={key}>{inline(block.text)}</h3>
    case 'paragraph':
      return <p key={key}>{inline(block.text)}</p>
    case 'ul':
      return (
        <ul key={key}>
          {block.items.map((item, i) => (
            <li key={i}>{inline(item)}</li>
          ))}
        </ul>
      )
    case 'ol':
      return (
        <ol key={key}>
          {block.items.map((item, i) => (
            <li key={i}>{inline(item)}</li>
          ))}
        </ol>
      )
    case 'table':
      return (
        <div key={key} className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                {block.header.map((h, i) => (
                  <th key={i}>{inline(h)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c}>{inline(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
  }
}

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|_[^_]+_|\*[^*]+\*)/g

function inline(text: string): ReactNode {
  const parts = text.split(INLINE)
  return parts.map((part, i) => {
    if (!part) return null
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>
    if (part.startsWith('`') && part.endsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>
    if ((part.startsWith('_') && part.endsWith('_')) || (part.startsWith('*') && part.endsWith('*'))) return <em key={i}>{part.slice(1, -1)}</em>
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part)
    if (link) {
      const href = link[2]!
      // somente links internos são clicáveis; externos são exibidos como texto
      if (href.startsWith('/')) {
        return (
          <Link key={i} to={href} className="font-medium text-brand underline-offset-2 hover:underline">
            {link[1]}
          </Link>
        )
      }
      return <span key={i}>{link[1]} ({href})</span>
    }
    return <Fragment key={i}>{part}</Fragment>
  })
}
