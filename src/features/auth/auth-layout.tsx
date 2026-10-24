import type { ReactNode } from 'react'
import { Logo } from '@/components/brand/logo'

const pillars = [
  { title: 'Dados oficiais estruturados', text: 'Dotações, classificações e valores consultados em tabelas verificáveis — nunca inventados.' },
  { title: 'Validação determinística', text: 'Regras configuráveis e versionadas pela própria Casa, com trilha de auditoria.' },
  { title: 'Revisão humana obrigatória', text: 'Nenhuma minuta é marcada como pronta sem conferência técnica e aprovação.' },
]

export function AuthLayout({ title, description, children, footer }: { title: string; description?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="grid min-h-svh lg:grid-cols-[1fr_1.05fr]">
      <div className="flex flex-col px-6 py-8 sm:px-10">
        <Logo />
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {description && <p className="mt-2 text-sm text-muted-foreground">{description}</p>}
            <div className="mt-8">{children}</div>
            {footer && <div className="mt-6 text-sm text-muted-foreground">{footer}</div>}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Tratamento de dados conforme a LGPD. O acesso é restrito a usuários autorizados pela instituição.
        </p>
      </div>
      <div className="relative hidden overflow-hidden bg-sidebar text-sidebar-foreground lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="bg-grid pointer-events-none absolute inset-0 opacity-60" aria-hidden />
        <div className="pointer-events-none absolute -top-40 -right-40 size-[28rem] rounded-full bg-[#2F5BD8]/25 blur-3xl" aria-hidden />
        <div className="relative">
          <p className="text-xs font-semibold tracking-[0.16em] text-sidebar-muted uppercase">Inteligência legislativa e orçamentária</p>
          <h2 className="mt-4 max-w-md text-3xl leading-tight font-semibold tracking-tight text-balance">
            Do pedido em linguagem natural à emenda pronta para conferência.
          </h2>
        </div>
        <ul className="relative space-y-6">
          {pillars.map((p, i) => (
            <li key={p.title} className="flex gap-4">
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-sidebar-border text-[11px] font-semibold text-sidebar-muted">
                {i + 1}
              </span>
              <div>
                <p className="text-sm font-medium">{p.title}</p>
                <p className="mt-1 text-sm text-sidebar-muted">{p.text}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
