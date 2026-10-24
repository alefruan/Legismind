import { useState } from 'react'
import { Link } from 'react-router'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/common/form'
import { PageHeader } from '@/components/common/page-header'
import { EmptyState } from '@/components/common/states'
import { PageContainer } from '@/components/layout/app-shell'
import { NewPasswordForm } from '@/features/auth/password-pages'
import { memberRoleLabels, officeRoleLabels } from '@shared/domain/labels'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/providers/auth'
import { useWorkspace } from '@/providers/workspace'

export function ProfilePage() {
  const { profile, user, refreshProfile } = useAuth()
  const ws = useWorkspace()
  const [form, setForm] = useState({ full_name: profile?.full_name ?? '', display_name: profile?.display_name ?? '', job_title: profile?.job_title ?? '', phone: profile?.phone ?? '' })
  const [saving, setSaving] = useState(false)
  const save = async () => {
    setSaving(true)
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: form.full_name.trim() || null, display_name: form.display_name.trim() || null, job_title: form.job_title.trim() || null, phone: form.phone.trim() || null })
      .eq('id', user!.id)
    setSaving(false)
    if (error) toast.error(error.message)
    else {
      toast.success('Perfil atualizado.')
      await refreshProfile()
    }
  }
  return (
    <PageContainer className="max-w-3xl">
      <PageHeader title="Meu perfil" description={user?.email ?? undefined} />
      <div className="space-y-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Dados pessoais</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 pt-0 sm:grid-cols-2">
            <Field label="Nome completo" htmlFor="p-name">
              <Input id="p-name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            </Field>
            <Field label="Nome de exibição" htmlFor="p-display">
              <Input id="p-display" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
            </Field>
            <Field label="Cargo" htmlFor="p-job">
              <Input id="p-job" value={form.job_title} onChange={(e) => setForm({ ...form, job_title: e.target.value })} />
            </Field>
            <Field label="Telefone" htmlFor="p-phone">
              <Input id="p-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
            <div className="flex justify-end sm:col-span-2">
              <Button onClick={save} disabled={saving}>
                {saving && <Loader2 className="animate-spin" />} Salvar
              </Button>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Vínculos</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-sm">
            <ul className="space-y-1">
              {ws.memberships.map((m) => (
                <li key={m.id}>
                  {m.organization.name} — {memberRoleLabels[m.role]}
                </li>
              ))}
              {ws.offices.map((o) => (
                <li key={o.office.id} className="text-muted-foreground">
                  {o.office.name} — {officeRoleLabels[o.office_role]}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Alterar senha</CardTitle>
          </CardHeader>
          <CardContent className="max-w-sm pt-0">
            <NewPasswordForm submitLabel="Alterar senha" onDone={() => undefined} />
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-20">
      <EmptyState
        title="Página não encontrada"
        description="O endereço acessado não existe ou foi movido."
        action={
          <Button asChild>
            <Link to="/">Voltar ao início</Link>
          </Button>
        }
      />
    </div>
  )
}
