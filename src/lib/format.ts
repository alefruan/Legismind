import { formatBRL, parseBRLExpression, toCents } from '@shared/domain/money'

export { formatBRL, toCents }

/** Valor digitado ("150.000,00", "150000", "150000.50", "150 mil") → centavos. */
export function parseMoneyInput(raw: string): number | null {
  const text = raw.trim().replace(/^R\$\s*/i, '')
  if (!text) return null
  if (/^\d+\.\d{1,2}$/.test(text)) return Math.round(Number(text) * 100)
  if (/^\d+(,\d{1,2})?$/.test(text)) return Math.round(Number(text.replace(',', '.')) * 100)
  return parseBRLExpression(`R$ ${text}`)
}

/** Centavos → texto editável "150.000,00". */
export function centsToInput(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Valor decimal vindo do banco ("150000.00") → "R$ 150.000,00". */
export function money(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return '—'
  return formatBRL(toCents(value))
}

const dateFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' })
const dateTimeFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
const longDateFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long' })

export function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const date = value.length === 10 ? new Date(`${value}T12:00:00`) : new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : dateFmt.format(date)
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : dateTimeFmt.format(date)
}

export function formatLongDate(date = new Date()) {
  return longDateFmt.format(date)
}

const relative = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' })

export function timeAgo(value: string | null | undefined) {
  if (!value) return '—'
  const diff = (new Date(value).getTime() - Date.now()) / 1000
  const abs = Math.abs(diff)
  if (abs < 60) return 'agora'
  if (abs < 3600) return relative.format(Math.round(diff / 60), 'minute')
  if (abs < 86400) return relative.format(Math.round(diff / 3600), 'hour')
  if (abs < 86400 * 30) return relative.format(Math.round(diff / 86400), 'day')
  return formatDate(value)
}

export function formatBytes(bytes: number | null | undefined) {
  if (!bytes) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: unit === 0 ? 0 : 1 })} ${units[unit]}`
}

export function initials(name: string | null | undefined) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1]![0] : '')).toUpperCase()
}

export function amendmentNumber(prefix: string | null | undefined, year: number | null | undefined, sequence: number | null | undefined) {
  if (!sequence || !year) return 'S/N'
  return `${prefix ?? 'EM'}-${year}/${String(sequence).padStart(4, '0')}`
}
