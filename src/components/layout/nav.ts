import { Briefcase, Building2, FileSignature, Home, Library, MessagesSquare, PenLine, Scale, Settings2, Wallet } from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  end?: boolean
  requires?: 'org_admin' | 'platform_admin'
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

export const navGroups: NavGroup[] = [
  {
    label: 'Trabalho',
    items: [
      { to: '/', label: 'Início', icon: Home, end: true },
      { to: '/assistente', label: 'Assistente', icon: MessagesSquare },
      { to: '/emendas', label: 'Emendas', icon: FileSignature },
      { to: '/orcamento', label: 'Explorador Orçamentário', icon: Wallet },
      { to: '/base', label: 'Base Legislativa', icon: Library },
    ],
  },
  {
    label: 'Módulos',
    items: [
      { to: '/redator', label: 'Redator Legislativo', icon: PenLine },
      { to: '/consultor', label: 'Consultor Jurídico', icon: Scale },
      { to: '/gabinete', label: 'Gestão de Gabinete', icon: Briefcase },
    ],
  },
  {
    label: 'Gestão',
    items: [
      { to: '/admin', label: 'Administração', icon: Settings2, requires: 'org_admin' },
      { to: '/plataforma', label: 'Plataforma', icon: Building2, requires: 'platform_admin' },
    ],
  },
]
