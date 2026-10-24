import { NavLink } from 'react-router'
import { Check, ChevronsUpDown, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { Logo } from '@/components/brand/logo'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { orgKindLabels } from '@shared/domain/labels'
import { useWorkspace } from '@/providers/workspace'
import { cn } from '@/lib/utils'
import { navGroups, type NavItem } from './nav'

function OrganizationSwitcher({ collapsed }: { collapsed: boolean }) {
  const ws = useWorkspace()
  if (!ws.organization) return null
  const label = ws.organization.short_name ?? ws.organization.name
  const trigger = (
    <button
      type="button"
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md border border-sidebar-border bg-sidebar-accent/40 text-left transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none',
        collapsed ? 'justify-center p-1.5' : 'px-2.5 py-2',
      )}
      aria-label="Trocar instituição"
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded bg-sidebar-foreground/10 text-[11px] font-semibold text-sidebar-foreground">
        {ws.organization.uf}
      </span>
      {!collapsed && (
        <>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-sidebar-foreground">{label}</span>
            <span className="block truncate text-[11px] text-sidebar-muted">{orgKindLabels[ws.organization.kind]}</span>
          </span>
          {ws.memberships.length > 1 && <ChevronsUpDown className="size-3.5 text-sidebar-muted" />}
        </>
      )}
    </button>
  )
  if (ws.memberships.length <= 1) return trigger
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>Instituições</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {ws.memberships.map((m) => (
          <DropdownMenuItem key={m.organization_id} onSelect={() => ws.setOrganization(m.organization_id)}>
            <span className="min-w-0 flex-1 truncate">{m.organization.name}</span>
            {m.organization_id === ws.organization?.id && <Check className="size-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function NavEntry({ item, collapsed, onNavigate }: { item: NavItem; collapsed: boolean; onNavigate?: () => void }) {
  const link = (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'group flex h-9 items-center gap-3 rounded-md px-2.5 text-[13px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none',
          collapsed && 'justify-center px-0',
          isActive ? 'bg-sidebar-accent text-sidebar-foreground' : 'text-sidebar-muted hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
        )
      }
    >
      {({ isActive }) => (
        <>
          <item.icon className={cn('size-4 shrink-0', isActive ? 'text-[#7EA2FF]' : '')} />
          {!collapsed && <span className="truncate">{item.label}</span>}
        </>
      )}
    </NavLink>
  )
  if (!collapsed) return link
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  )
}

export function SidebarContent({ collapsed = false, onNavigate, onToggle }: { collapsed?: boolean; onNavigate?: () => void; onToggle?: () => void }) {
  const ws = useWorkspace()
  const visible = (item: NavItem) =>
    !item.requires || (item.requires === 'org_admin' && ws.isOrgAdmin) || (item.requires === 'platform_admin' && ws.isPlatformAdmin)

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className={cn('flex h-14 items-center border-b border-sidebar-border', collapsed ? 'justify-center px-2' : 'justify-between px-4')}>
        <Logo collapsed={collapsed} className="text-sidebar-foreground" />
        {onToggle && !collapsed && (
          <button type="button" onClick={onToggle} className="rounded p-1 text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground" aria-label="Recolher menu">
            <PanelLeftClose className="size-4" />
          </button>
        )}
      </div>
      <div className={cn('pt-3', collapsed ? 'px-2' : 'px-3')}>
        <OrganizationSwitcher collapsed={collapsed} />
      </div>
      <nav className={cn('flex-1 space-y-5 overflow-y-auto py-4 scrollbar-thin', collapsed ? 'px-2' : 'px-3')} aria-label="Navegação principal">
        {navGroups.map((group) => {
          const items = group.items.filter(visible)
          if (items.length === 0) return null
          return (
            <div key={group.label} className="space-y-0.5">
              {!collapsed && <div className="px-2.5 pb-1 text-[10.5px] font-semibold tracking-[0.08em] text-sidebar-muted/80 uppercase">{group.label}</div>}
              {items.map((item) => (
                <NavEntry key={item.to} item={item} collapsed={collapsed} onNavigate={onNavigate} />
              ))}
            </div>
          )
        })}
      </nav>
      {onToggle && collapsed && (
        <div className="border-t border-sidebar-border p-2">
          <button type="button" onClick={onToggle} className="flex h-9 w-full items-center justify-center rounded-md text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground" aria-label="Expandir menu">
            <PanelLeftOpen className="size-4" />
          </button>
        </div>
      )}
      {!collapsed && (
        <div className="border-t border-sidebar-border px-4 py-3 text-[11px] leading-snug text-sidebar-muted">
          Minutas geradas exigem conferência humana antes de assinatura e protocolo.
        </div>
      )}
    </div>
  )
}
