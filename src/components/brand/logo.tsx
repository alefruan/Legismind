import { cn } from '@/lib/utils'

/**
 * Símbolo LegisMind: frontão e colunas de uma casa legislativa, com a coluna
 * central substituída por um nó — o "pensamento" que conecta norma e orçamento.
 */
export function LogoMark({ className, inverted = false }: { className?: string; inverted?: boolean }) {
  const line = inverted ? 'var(--primary)' : '#E8EEFF'
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className={cn('size-8 shrink-0', className)}>
      <rect width="32" height="32" rx="8" fill={inverted ? '#E8EEFF' : '#16234A'} />
      <path d="M8 12.5 16 7.5l8 5" stroke={line} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10.5 15v8.5M21.5 15v8.5" stroke={line} strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="16" cy="15.6" r="2" fill="#5B8CFF" />
      <path d="M16 18.2v5.3" stroke="#5B8CFF" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8 25h16" stroke={line} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('text-[1.05rem] font-semibold tracking-[-0.02em]', className)}>
      Legis<span className="font-normal opacity-80">Mind</span>
    </span>
  )
}

export function Logo({ className, collapsed = false, inverted = false }: { className?: string; collapsed?: boolean; inverted?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark inverted={inverted} className="size-7" />
      {!collapsed && <Wordmark />}
    </span>
  )
}
