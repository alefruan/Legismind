import { NavLink, Outlet } from 'react-router'
import { PageHeader } from '@/components/common/page-header'
import { PageContainer } from '@/components/layout/app-shell'
import { useRequiredWorkspace } from '@/providers/workspace'
import { cn } from '@/lib/utils'

const sections = [
  { to: 'usuarios', label: 'Usuários' },
  { to: 'gabinetes', label: 'Gabinetes' },
  { to: 'exercicios', label: 'Exercícios' },
  { to: 'regras', label: 'Regras' },
  { to: 'modalidades', label: 'Modalidades' },
  { to: 'modelos', label: 'Modelos' },
  { to: 'configuracoes', label: 'Configurações' },
  { to: 'uso', label: 'Consumo de IA' },
  { to: 'auditoria', label: 'Auditoria' },
]

export function AdminLayout() {
  const ws = useRequiredWorkspace()
  return (
    <PageContainer wide>
      <PageHeader eyebrow="Administração" title={ws.organization.name} description="Gestão de usuários, gabinetes, exercícios, regras normativas e modelos oficiais da instituição." />
      <nav className="-mx-1 mb-6 flex gap-1 overflow-x-auto border-b pb-px" aria-label="Seções da administração">
        {sections.map((s) => (
          <NavLink
            key={s.to}
            to={s.to}
            className={({ isActive }) =>
              cn(
                'shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                isActive ? 'border-brand text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
              )
            }
          >
            {s.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </PageContainer>
  )
}
