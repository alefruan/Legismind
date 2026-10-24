import type { AmendmentDocument, BoxItem, DocBlock, DocRun, FieldRow } from '@shared/domain/amendments/document'
import { cn } from '@/lib/utils'

const cell = 'border border-neutral-500 px-2 py-1 align-top'

function Runs({ runs }: { runs: DocRun[] }) {
  return (
    <>
      {runs.map((r, i) => (
        <span
          key={i}
          className={cn(r.bold && 'font-bold', r.italic && 'italic', r.text.includes('[PENDENTE') && 'rounded bg-amber-100 px-0.5 text-amber-800')}
        >
          {r.text}
        </span>
      ))}
    </>
  )
}

function Value({ row }: { row: FieldRow }) {
  return <span className={cn(row.pending && 'rounded bg-amber-100 px-0.5 text-amber-800')}>{row.value}</span>
}

function SectionTitle({ children }: { children: string }) {
  return <h3 className="pt-2 text-center text-[13px] font-bold uppercase">{children}</h3>
}

function Signature({ name, role, inline }: { name: string; role: string; inline?: boolean }) {
  return (
    <div className="pt-10 text-center text-[13px]">
      <div className="mx-auto w-72 border-t border-neutral-600 pt-1">{inline ? `${name} - ${role}` : <span className="font-semibold">{name}</span>}</div>
      {!inline && <div className="text-xs">{role}</div>}
    </div>
  )
}

function BoxContent({ items }: { items: BoxItem[] }) {
  return (
    <div className="space-y-2 border border-neutral-500 px-3 py-2 text-[13px] leading-relaxed">
      {items.map((item, i) =>
        item.type === 'paragraph' ? (
          <p key={i} className="text-justify">
            <Runs runs={item.runs} />
          </p>
        ) : (
          <Signature key={i} name={item.name} role={item.role} inline={item.inline} />
        ),
      )}
      {items.length === 0 && <p>&nbsp;</p>}
    </div>
  )
}

export function DocumentBlock({ block }: { block: DocBlock }) {
  switch (block.type) {
    case 'pageHeader':
      return (
        <header className="space-y-0.5 pb-2 text-center text-[13px]">
          {block.lines.map((line, i) => (
            <p key={i}>
              <Runs runs={line} />
            </p>
          ))}
        </header>
      )
    case 'heading':
      return block.level === 3 ? <h4 className="mt-4 text-[13px] font-bold">{block.text}</h4> : <SectionTitle>{block.text}</SectionTitle>
    case 'paragraph':
      return (
        <p className={cn('text-[13px] leading-relaxed', block.indent ? 'ml-[45%] text-left' : block.align === 'center' ? 'text-center' : 'text-justify')}>
          <Runs runs={block.runs} />
        </p>
      )
    case 'fields':
      return (
        <div>
          {block.title && <p className="mb-0.5 text-xs italic">{block.title}</p>}
          <table className="w-full border-collapse text-[12.5px]">
            <tbody>
              {block.rows.map((row, i) =>
                block.layout === 'inline' ? (
                  <tr key={i}>
                    <td className={cell}>
                      <strong>{row.label}:</strong> <Value row={row} />
                    </td>
                  </tr>
                ) : (
                  <tr key={i}>
                    <td className={cn(cell, 'w-[42%]')}>{row.label}</td>
                    <td className={cell}>
                      <Value row={row} />
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )
    case 'box':
      return (
        <div className="space-y-1">
          {block.title && <SectionTitle>{block.title}</SectionTitle>}
          <BoxContent items={block.items} />
        </div>
      )
    case 'choice': {
      const checked = block.options.find((o) => o.checked)
      return (
        <table className="w-full border-collapse text-[12.5px]">
          <tbody>
            {block.options.map((o, i) => (
              <tr key={o.key}>
                <td className={cn(cell, 'font-bold')}>
                  ( {o.key} ) {o.label}
                </td>
                <td className={cn(cell, 'w-[20%] text-center font-bold')}>{i === 0 ? 'Assinale A ou B' : `(  ${checked?.key ?? ' '}  )`}</td>
              </tr>
            ))}
            {block.details.map((d, i) => (
              <tr key={`d${i}`}>
                <td className={cell}>
                  <strong>{d.label}:</strong> <Value row={d} />
                </td>
                <td className={cell} />
              </tr>
            ))}
          </tbody>
        </table>
      )
    }
    case 'table':
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[11.5px]">
            <thead>
              <tr>
                {block.columns.map((c, i) => (
                  <th key={i} className={cn(cell, 'bg-neutral-100 text-left font-semibold', i === block.columns.length - 1 && 'text-right')}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((value, i) => (
                    <td key={i} className={cn(cell, i === row.length - 1 && 'text-right tabular')}>
                      {value}
                    </td>
                  ))}
                </tr>
              ))}
              {block.footer && (
                <tr>
                  {block.footer.map((value, i) => (
                    <td key={i} className={cn(cell, 'bg-neutral-100 font-semibold', i === block.footer!.length - 1 && 'text-right tabular')}>
                      {value}
                    </td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )
    case 'signature':
      return <Signature name={block.name} role={block.role} inline={block.inline} />
    case 'notice':
      return <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-[11.5px] font-semibold text-amber-800 print:hidden">{block.text}</p>
  }
}

/** Folha A4 com a minuta renderizada (mesma estrutura de blocos usada nos exportadores DOCX/PDF). */
export function DocumentSheet({ document, hideNotices, className, id }: { document: AmendmentDocument; hideNotices?: boolean; className?: string; id?: string }) {
  return (
    <article
      id={id}
      className={cn('relative mx-auto max-w-[210mm] space-y-3 bg-white px-6 py-10 text-neutral-900 shadow-sm sm:px-14', className)}
      style={{ fontFamily: '"Times New Roman", Georgia, serif' }}
    >
      {document.watermark && (
        <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
          <span className="-rotate-45 text-5xl font-bold whitespace-nowrap text-red-600/10 select-none">{document.watermark}</span>
        </div>
      )}
      {document.blocks
        .filter((b) => !hideNotices || b.type !== 'notice')
        .map((block, i) => (
          <DocumentBlock key={i} block={block} />
        ))}
    </article>
  )
}
