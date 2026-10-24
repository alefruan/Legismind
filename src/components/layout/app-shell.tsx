import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router'
import { FlaskConical } from 'lucide-react'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { useWorkspace } from '@/providers/workspace'
import { cn } from '@/lib/utils'
import { SidebarContent } from './sidebar'
import { Topbar } from './topbar'

const COLLAPSE_KEY = 'legismind.sidebar-collapsed'

function DemoBanner() {
  const ws = useWorkspace()
  if (!ws.organization?.is_demo) return null
  return (
    <div className="flex items-center justify-center gap-2 border-b border-warning/30 bg-warning-soft px-4 py-1.5 text-center text-xs font-medium text-warning">
      <FlaskConical className="size-3.5 shrink-0" />
      Ambiente de demonstração — todos os dados desta instituição são fictícios e não têm valor oficial.
    </div>
  )
}

export function AppShell() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1'
    } catch {
      return false
    }
  })
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()

  useEffect(() => setMobileOpen(false), [location.pathname])

  const toggle = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1')
      } catch {
        // ignora armazenamento indisponível
      }
      return !c
    })

  return (
    <div className="flex min-h-svh">
      <aside className={cn('sticky top-0 hidden h-svh shrink-0 border-r border-sidebar-border transition-[width] duration-200 lg:block', collapsed ? 'w-16' : 'w-64')}>
        <SidebarContent collapsed={collapsed} onToggle={toggle} />
      </aside>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 border-sidebar-border p-0">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <SidebarContent onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>
      <div className="flex min-w-0 flex-1 flex-col">
        <DemoBanner />
        <Topbar onOpenMenu={() => setMobileOpen(true)} />
        <main className="flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

/** Contêiner padrão de conteúdo das páginas. */
export function PageContainer({ children, className, wide = false }: { children: React.ReactNode; className?: string; wide?: boolean }) {
  return <div className={cn('mx-auto w-full px-4 py-6 sm:px-6 lg:px-8 lg:py-8', wide ? 'max-w-[1600px]' : 'max-w-6xl', className)}>{children}</div>
}
