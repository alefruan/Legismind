import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Building2, Check, Loader2, LogOut } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/common/form'
import { ErrorState, FullPageLoader } from '@/components/common/states'
import { memberRoleLabels, orgKindLabels } from '@shared/domain/labels'
import type { MemberRole } from '@shared/types/db'
import { supabase, unwrap } from '@/lib/supabase'
import { formatDate } from '@/lib/format'
import { useAuth } from '@/providers/auth'
import { useWorkspace } from '@/providers/workspace'
import { AuthLayout } from './auth-layout'
import { NewPasswordForm } from './password-pages'

interface PendingInvitation {
  id: string
  organization_id: string
  organization_name: string
  role: MemberRole
  office_id: string | null
  office_name: string | null
  expires_at: string
}

function usePendingInvitations(enabled: boolean) {
  return useQuery({
    queryKey: ['pending-invitations'],
    enabled,
    queryFn: async () => unwrap<PendingInvitation[]>(await supabase.rpc('my_pending_invitations')),
  })
}

function InvitationList({ onAccepted }: { onAccepted: (organizationId: string) => void }) {
  const invitations = usePendingInvitations(true)
  const accept = useMutation({
    mutationFn: async (id: string) => unwrap<string>(await supabase.rpc('accept_invitation', { p_invitation_id: id })),
    onSuccess: (organizationId) => {
      toast.success('Convite aceito.')
      onAccepted(organizationId)
    },
    onError: (error: Error) => toast.error(error.message),
  })
  if (invitations.isLoading) return <FullPageLoader label="Verificando convites…" />
  if (invitations.error) return <ErrorState error={invitations.error} onRetry={() => invitations.refetch()} />
  const items = invitations.data ?? []
  if (items.length === 0) return null
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Convites pendentes</p>
      {items.map((inv) => (
        <div key={inv.id} className="flex items-center gap-3 rounded-lg border p-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{inv.organization_name}</p>
            <p className="text-xs text-muted-foreground">
              {memberRoleLabels[inv.role]}
              {inv.office_name ? ` · ${inv.office_name}` : ''} · válido até {formatDate(inv.expires_at)}
            </p>
          </div>
          <Button size="sm" onClick={() => accept.mutate(inv.id)} disabled={accept.isPending}>
            {accept.isPending && accept.variables === inv.id ? <Loader2 className="animate-spin" /> : <Check />}
            Aceitar
          </Button>
        </div>
      ))}
    </div>
  )
}

/** Destino do link de convite do Supabase: define senha e aceita o convite. */
export function AcceptInvitePage() {
  const { session, loading, refreshProfile } = useAuth()
  const ws = useWorkspace()
  const navigate = useNavigate()
  const [step, setStep] = useState<'password' | 'accept'>('password')
  if (loading) return <FullPageLoader />
  if (!session) {
    return (
      <AuthLayout title="Convite inválido ou expirado" description="O link de convite pode ter expirado. Solicite um novo convite ao administrador da instituição.">
        <Button asChild variant="outline" className="w-full">
          <Link to="/login">Ir para o login</Link>
        </Button>
      </AuthLayout>
    )
  }
  return (
    <AuthLayout
      title={step === 'password' ? 'Ative seu acesso' : 'Confirme sua instituição'}
      description={step === 'password' ? `Defina uma senha para ${session.user.email}.` : 'Aceite o convite para acessar o ambiente da sua instituição.'}
    >
      {step === 'password' ? (
        <NewPasswordForm submitLabel="Definir senha e continuar" onDone={() => setStep('accept')} />
      ) : (
        <div className="space-y-6">
          <InvitationList
            onAccepted={async (organizationId) => {
              ws.setOrganization(organizationId)
              await ws.refresh()
              await refreshProfile()
              navigate('/configurar-perfil', { replace: true })
            }}
          />
          <Button variant="outline" className="w-full" onClick={() => navigate('/', { replace: true })}>
            Continuar
          </Button>
        </div>
      )}
    </AuthLayout>
  )
}

/** Seleção de instituição para usuários com múltiplos vínculos ou convites pendentes. */
export function SelectOrganizationPage() {
  const { signOut, refreshProfile } = useAuth()
  const ws = useWorkspace()
  const navigate = useNavigate()
  if (ws.loading) return <FullPageLoader />
  const choose = (id: string) => {
    ws.setOrganization(id)
    navigate('/', { replace: true })
  }
  return (
    <AuthLayout
      title="Selecione a instituição"
      description={ws.memberships.length ? 'Você possui acesso às instituições abaixo.' : 'Sua conta ainda não está vinculada a uma instituição.'}
      footer={
        <button type="button" onClick={() => void signOut()} className="inline-flex items-center gap-1.5 font-medium hover:text-foreground">
          <LogOut className="size-3.5" /> Sair
        </button>
      }
    >
      <div className="space-y-6">
        {ws.memberships.length > 0 && (
          <div className="space-y-2">
            {ws.memberships.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => choose(m.organization_id)}
                className="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:border-brand/40 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <span className="flex size-9 items-center justify-center rounded-md bg-muted">
                  <Building2 className="size-4 text-muted-foreground" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{m.organization.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {orgKindLabels[m.organization.kind]} · {m.organization.uf} · {memberRoleLabels[m.role]}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
        <InvitationList
          onAccepted={async (id) => {
            await ws.refresh()
            await refreshProfile()
            choose(id)
          }}
        />
        {ws.memberships.length === 0 && (
          <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">
            Peça ao administrador da sua Câmara ou Assembleia que envie um convite para o seu e-mail. Assim que o convite for enviado, ele aparecerá aqui.
          </p>
        )}
      </div>
    </AuthLayout>
  )
}

/** Configuração inicial do perfil (nome, cargo e telefone). */
export function OnboardingPage() {
  const { profile, user, refreshProfile } = useAuth()
  const navigate = useNavigate()
  const [fullName, setFullName] = useState(profile?.full_name ?? '')
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '')
  const [jobTitle, setJobTitle] = useState(profile?.job_title ?? '')
  const [phone, setPhone] = useState(profile?.phone ?? '')
  const [saving, setSaving] = useState(false)
  if (profile?.onboarded_at) return <Navigate to="/" replace />

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (fullName.trim().length < 3) {
      toast.error('Informe seu nome completo.')
      return
    }
    setSaving(true)
    const { error } = await supabase
      .from('profiles')
      .update({
        full_name: fullName.trim(),
        display_name: displayName.trim() || null,
        job_title: jobTitle.trim() || null,
        phone: phone.trim() || null,
        onboarded_at: new Date().toISOString(),
      })
      .eq('id', user!.id)
    setSaving(false)
    if (error) {
      toast.error(error.message)
      return
    }
    await refreshProfile()
    navigate('/', { replace: true })
  }

  return (
    <AuthLayout title="Configure seu perfil" description="Essas informações identificam você nos históricos e documentos da instituição.">
      <form onSubmit={save} className="space-y-4">
        <Field label="Nome completo" htmlFor="fullName" required>
          <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" autoFocus />
        </Field>
        <Field label="Como prefere ser chamado(a)" htmlFor="displayName">
          <Input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </Field>
        <Field label="Cargo ou função" htmlFor="jobTitle" hint="Ex.: Assessor parlamentar, Chefe de gabinete, Consultor legislativo">
          <Input id="jobTitle" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
        </Field>
        <Field label="Telefone" htmlFor="phone">
          <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" inputMode="tel" />
        </Field>
        <Button type="submit" className="w-full" disabled={saving}>
          {saving && <Loader2 className="animate-spin" />}
          Concluir
        </Button>
      </form>
    </AuthLayout>
  )
}
