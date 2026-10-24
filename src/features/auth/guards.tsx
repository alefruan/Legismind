import { Navigate, Outlet, useLocation } from 'react-router'
import { ShieldAlert } from 'lucide-react'
import { FullPageLoader } from '@/components/common/states'
import { EmptyState } from '@/components/common/states'
import { useAuth } from '@/providers/auth'
import { useWorkspace } from '@/providers/workspace'

/** Exige sessão autenticada. */
export function RequireAuth() {
  const { session, loading, recovery } = useAuth()
  const location = useLocation()
  if (loading) return <FullPageLoader />
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  if (recovery && location.pathname !== '/redefinir-senha') return <Navigate to="/redefinir-senha" replace />
  return <Outlet />
}

/** Exige perfil configurado e instituição selecionada. */
export function RequireWorkspace() {
  const { profile, loading } = useAuth()
  const ws = useWorkspace()
  if (loading || ws.loading) return <FullPageLoader label="Preparando seu ambiente…" />
  if (!ws.organization) {
    if (ws.isPlatformAdmin) return <Navigate to="/plataforma" replace />
    return <Navigate to="/selecionar-instituicao" replace />
  }
  if (profile && !profile.onboarded_at) return <Navigate to="/configurar-perfil" replace />
  return <Outlet />
}

export function Forbidden({ message = 'Você não tem permissão para acessar esta área.' }: { message?: string }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <EmptyState icon={ShieldAlert} title="Acesso restrito" description={message} />
    </div>
  )
}

export function RequireOrgAdmin() {
  const ws = useWorkspace()
  if (!ws.isOrgAdmin) return <Forbidden message="Somente administradores da instituição acessam esta área." />
  return <Outlet />
}

export function RequirePlatformAdmin() {
  const ws = useWorkspace()
  if (ws.loading) return <FullPageLoader />
  if (!ws.isPlatformAdmin) return <Forbidden message="Somente a administração da plataforma LegisMind acessa esta área." />
  return <Outlet />
}
