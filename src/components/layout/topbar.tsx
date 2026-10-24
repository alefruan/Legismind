import { Link } from 'react-router'
import { useTheme } from 'next-themes'
import { Check, LogOut, Menu, Monitor, Moon, Sun, UserRound } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { fiscalPhaseLabels, memberRoleLabels } from '@shared/domain/labels'
import { useAuth } from '@/providers/auth'
import { useWorkspace } from '@/providers/workspace'
import { initials } from '@/lib/format'

function ThemeMenu() {
  const { theme, setTheme } = useTheme()
  const options = [
    { value: 'light', label: 'Claro', icon: Sun },
    { value: 'dark', label: 'Escuro', icon: Moon },
    { value: 'system', label: 'Sistema', icon: Monitor },
  ]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Alterar tema">
          <Sun className="dark:hidden" />
          <Moon className="hidden dark:block" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {options.map((o) => (
          <DropdownMenuItem key={o.value} onSelect={() => setTheme(o.value)}>
            <o.icon /> {o.label}
            {theme === o.value && <Check className="ml-auto" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function UserMenu() {
  const { profile, user, signOut } = useAuth()
  const ws = useWorkspace()
  const name = profile?.display_name || profile?.full_name || user?.email || 'Usuário'
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" aria-label="Menu do usuário">
          <Avatar className="size-8">
            <AvatarFallback className="bg-primary text-[11px] font-semibold text-primary-foreground">{initials(name)}</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="font-normal">
          <div className="truncate text-sm font-medium">{name}</div>
          <div className="truncate text-xs text-muted-foreground">{user?.email}</div>
          {ws.role && <div className="mt-1 text-xs text-muted-foreground">{memberRoleLabels[ws.role]}</div>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/perfil">
            <UserRound /> Meu perfil
          </Link>
        </DropdownMenuItem>
        {ws.memberships.length > 1 && (
          <DropdownMenuItem asChild>
            <Link to="/selecionar-instituicao">Trocar instituição</Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut /> Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function Topbar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const ws = useWorkspace()
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/70 lg:px-6">
      <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={onOpenMenu} aria-label="Abrir menu">
        <Menu />
      </Button>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        {ws.offices.length > 0 && (
          <Select value={ws.office?.id ?? ''} onValueChange={(v) => ws.setOffice(v)}>
            <SelectTrigger size="sm" className="h-8 max-w-[15rem] min-w-0 border-transparent bg-transparent shadow-none hover:bg-accent" aria-label="Gabinete">
              <SelectValue placeholder="Gabinete" />
            </SelectTrigger>
            <SelectContent>
              {ws.offices.map((o) => (
                <SelectItem key={o.office.id} value={o.office.id}>
                  {o.office.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {ws.fiscalYears.length > 0 && (
          <Select value={ws.fiscalYear?.id ?? ''} onValueChange={(v) => ws.setFiscalYear(v)}>
            <SelectTrigger size="sm" className="h-8 w-auto border-transparent bg-transparent shadow-none hover:bg-accent" aria-label="Exercício orçamentário">
              <SelectValue placeholder="Exercício" />
            </SelectTrigger>
            <SelectContent>
              {ws.fiscalYears.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  Exercício {f.year} · {fiscalPhaseLabels[f.phase]}
                  {f.is_active ? ' · ativo' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="flex items-center gap-1">
        <ThemeMenu />
        <UserMenu />
      </div>
    </header>
  )
}
