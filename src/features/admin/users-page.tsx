import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, MailPlus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Pill } from '@/components/common/badges'
import { Field, NativeSelect } from '@/components/common/form'
import { ErrorState, LoadingRows } from '@/components/common/states'
import { memberRoleLabels, officeRoleLabels } from '@shared/domain/labels'
import type { InvitationRow, MemberRole, OfficeRole, OfficeRow } from '@shared/types/db'
import { apiFetch } from '@/lib/api'
import { supabase, unwrap } from '@/lib/supabase'
import { formatDate } from '@/lib/format'
import { useAuth } from '@/providers/auth'
import { useRequiredWorkspace } from '@/providers/workspace'

interface MemberRow {
  id: string
  user_id: string
  role: MemberRole
  status: 'active' | 'suspended'
  created_at: string
  profile?: { full_name: string | null; email: string; job_title: string | null }
  offices: string[]
}

export function useOffices(organizationId: string) {
  return useQuery({
    queryKey: ['offices', organizationId],
    queryFn: async () => unwrap<OfficeRow[]>(await supabase.from('offices').select('*').eq('organization_id', organizationId).order('name')),
  })
}

function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const ws = useRequiredWorkspace()
  const offices = useOffices(ws.organization.id)
  const queryClient = useQueryClient()
  const [form, setForm] = useState({ email: '', fullName: '', role: 'advisor' as MemberRole, officeId: '', officeRole: 'advisor' as OfficeRole })
  const invite = useMutation({
    mutationFn: () =>
      apiFetch<{ message: string }>('/admin/invitations', {
        method: 'POST',
        json: {
          organizationId: ws.organization.id,
          email: form.email,
          fullName: form.fullName || undefined,
          role: form.role,
          officeId: form.officeId || null,
          officeRole: form.officeId ? form.officeRole : null,
        },
      }),
    onSuccess: (data) => {
      toast.success(data.message)
      void queryClient.invalidateQueries({ queryKey: ['invitations'] })
      onOpenChange(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convidar usuário</DialogTitle>
          <DialogDescription>O convite é enviado por e-mail e expira em 7 dias. O acesso é concedido apenas a esta instituição.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="E-mail" htmlFor="inv-email" required>
            <Input id="inv-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Nome" htmlFor="inv-name">
            <Input id="inv-name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
          </Field>
          <Field label="Perfil de acesso" htmlFor="inv-role" required>
            <NativeSelect id="inv-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as MemberRole })}>
              {Object.entries(memberRoleLabels).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Gabinete" htmlFor="inv-office" hint="Parlamentares e assessores atuam em gabinetes.">
              <NativeSelect id="inv-office" value={form.officeId} onChange={(e) => setForm({ ...form, officeId: e.target.value })}>
                <option value="">Nenhum</option>
                {offices.data?.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {form.officeId && (
              <Field label="Função no gabinete" htmlFor="inv-office-role">
                <NativeSelect id="inv-office-role" value={form.officeRole} onChange={(e) => setForm({ ...form, officeRole: e.target.value as OfficeRole })}>
                  {Object.entries(officeRoleLabels).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => invite.mutate()} disabled={invite.isPending || !form.email.includes('@')}>
            {invite.isPending && <Loader2 className="animate-spin" />} Enviar convite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function UsersPage() {
  const ws = useRequiredWorkspace()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [inviteOpen, setInviteOpen] = useState(false)

  const members = useQuery({
    queryKey: ['members', ws.organization.id],
    queryFn: async () => {
      const [memberships, officeMembers, offices] = await Promise.all([
        supabase.from('memberships').select('id, user_id, role, status, created_at').eq('organization_id', ws.organization.id).order('created_at'),
        supabase.from('office_members').select('user_id, office_id').eq('organization_id', ws.organization.id),
        supabase.from('offices').select('id, name').eq('organization_id', ws.organization.id),
      ])
      const rows = unwrap<Omit<MemberRow, 'profile' | 'offices'>[]>(memberships)
      const ids = rows.map((r) => r.user_id)
      const profiles = ids.length ? unwrap<Array<{ id: string; full_name: string | null; email: string; job_title: string | null }>>(await supabase.from('profiles').select('id, full_name, email, job_title').in('id', ids)) : []
      const officeNames = new Map(unwrap<Array<{ id: string; name: string }>>(offices).map((o) => [o.id, o.name]))
      const om = unwrap<Array<{ user_id: string; office_id: string }>>(officeMembers)
      return rows.map<MemberRow>((r) => ({
        ...r,
        profile: profiles.find((p) => p.id === r.user_id),
        offices: om.filter((o) => o.user_id === r.user_id).map((o) => officeNames.get(o.office_id) ?? '—'),
      }))
    },
  })

  const invitations = useQuery({
    queryKey: ['invitations', ws.organization.id],
    queryFn: async () => unwrap<InvitationRow[]>(await supabase.from('invitations').select('*').eq('organization_id', ws.organization.id).eq('status', 'pending').order('created_at', { ascending: false })),
  })

  const updateMember = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, unknown> }) => unwrap(await supabase.from('memberships').update(patch).eq('id', id)),
    onSuccess: () => {
      toast.success('Vínculo atualizado.')
      void queryClient.invalidateQueries({ queryKey: ['members'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const revoke = useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from('invitations').update({ status: 'revoked' }).eq('id', id)),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['invitations'] }),
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button onClick={() => setInviteOpen(true)}>
          <MailPlus /> Convidar usuário
        </Button>
      </div>
      {members.error ? (
        <ErrorState error={members.error} onRetry={() => members.refetch()} />
      ) : members.isLoading ? (
        <LoadingRows />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>Usuário</TableHead>
                <TableHead>Perfil</TableHead>
                <TableHead className="hidden md:table-cell">Gabinetes</TableHead>
                <TableHead>Situação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.data!.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>
                    <span className="block font-medium">{m.profile?.full_name ?? m.profile?.email ?? 'Usuário'}</span>
                    <span className="block text-xs text-muted-foreground">
                      {m.profile?.email}
                      {m.profile?.job_title ? ` · ${m.profile.job_title}` : ''}
                    </span>
                  </TableCell>
                  <TableCell>
                    <NativeSelect
                      value={m.role}
                      disabled={m.user_id === user?.id || updateMember.isPending}
                      onChange={(e) => updateMember.mutate({ id: m.id, patch: { role: e.target.value } })}
                      className="h-8 w-56 text-xs"
                      aria-label="Perfil"
                    >
                      {Object.entries(memberRoleLabels).map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </NativeSelect>
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{m.offices.join(', ') || '—'}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Pill tone={m.status === 'active' ? 'success' : 'neutral'}>{m.status === 'active' ? 'Ativo' : 'Suspenso'}</Pill>
                      {m.user_id !== user?.id && (
                        <Button size="xs" variant="ghost" onClick={() => updateMember.mutate({ id: m.id, patch: { status: m.status === 'active' ? 'suspended' : 'active' } })}>
                          {m.status === 'active' ? 'Suspender' : 'Reativar'}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Convites pendentes</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {(invitations.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum convite pendente.</p>
          ) : (
            <ul className="divide-y">
              {invitations.data!.map((i) => (
                <li key={i.id} className="flex items-center gap-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{i.email}</span>
                  <span className="hidden text-xs text-muted-foreground sm:inline">{memberRoleLabels[i.role]}</span>
                  <span className="text-xs text-muted-foreground">expira {formatDate(i.expires_at)}</span>
                  <Button size="icon-xs" variant="ghost" onClick={() => revoke.mutate(i.id)} aria-label="Revogar convite">
                    <X />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      {inviteOpen && <InviteDialog open onOpenChange={setInviteOpen} />}
    </div>
  )
}
