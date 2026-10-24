import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Loader2, Plus, Trash2, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Pill } from '@/components/common/badges'
import { Field, NativeSelect } from '@/components/common/form'
import { EmptyState, ErrorState, LoadingRows } from '@/components/common/states'
import { fiscalPhaseLabels, officeRoleLabels } from '@shared/domain/labels'
import type { FiscalPhase, FiscalYearRow, OfficeRole, OfficeRow } from '@shared/types/db'
import { centsToDecimal } from '@shared/domain/money'
import { supabase, unwrap } from '@/lib/supabase'
import { formatDate, money, parseMoneyInput } from '@/lib/format'
import { useRequiredWorkspace } from '@/providers/workspace'
import { useOffices } from './users-page'

function OfficeDialog({ office, onClose }: { office: OfficeRow | null; onClose: () => void }) {
  const ws = useRequiredWorkspace()
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    name: office?.name ?? '',
    parliamentarian_name: office?.parliamentarian_name ?? '',
    parliamentarian_title: office?.parliamentarian_title ?? '',
    party: office?.party ?? '',
    status: office?.status ?? 'active',
  })
  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name.trim(),
        parliamentarian_name: form.parliamentarian_name.trim(),
        parliamentarian_title: form.parliamentarian_title.trim() || null,
        party: form.party.trim() || null,
        status: form.status,
      }
      if (office) return unwrap(await supabase.from('offices').update(payload).eq('id', office.id))
      return unwrap(await supabase.from('offices').insert({ ...payload, organization_id: ws.organization.id }))
    },
    onSuccess: () => {
      toast.success('Gabinete salvo.')
      void queryClient.invalidateQueries({ queryKey: ['offices'] })
      void ws.refresh()
      onClose()
    },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{office ? 'Editar gabinete' : 'Novo gabinete'}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="Nome do gabinete" htmlFor="o-name" required>
            <Input id="o-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Gabinete do Vereador …" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
            <Field label="Nome parlamentar" htmlFor="o-parl" required hint="Utilizado na assinatura das minutas.">
              <Input id="o-parl" value={form.parliamentarian_name} onChange={(e) => setForm({ ...form, parliamentarian_name: e.target.value })} />
            </Field>
            <Field label="Cargo" htmlFor="o-title" hint="Ex.: Vereador, Vereadora">
              <Input id="o-title" maxLength={60} value={form.parliamentarian_title} onChange={(e) => setForm({ ...form, parliamentarian_title: e.target.value })} />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Partido" htmlFor="o-party">
              <Input id="o-party" value={form.party} onChange={(e) => setForm({ ...form, party: e.target.value })} />
            </Field>
            <Field label="Situação" htmlFor="o-status">
              <NativeSelect id="o-status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as 'active' | 'inactive' })}>
                <option value="active">Ativo</option>
                <option value="inactive">Inativo</option>
              </NativeSelect>
            </Field>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || form.name.trim().length < 3 || form.parliamentarian_name.trim().length < 3}>
            {save.isPending && <Loader2 className="animate-spin" />} Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function OfficeMembers({ office }: { office: OfficeRow }) {
  const queryClient = useQueryClient()
  const [userId, setUserId] = useState('')
  const [role, setRole] = useState<OfficeRole>('advisor')
  const data = useQuery({
    queryKey: ['office-members', office.id],
    queryFn: async () => {
      const [members, memberships] = await Promise.all([
        supabase.from('office_members').select('user_id, office_role').eq('office_id', office.id),
        supabase.from('memberships').select('user_id, role').eq('organization_id', office.organization_id).eq('status', 'active'),
      ])
      const m = unwrap<Array<{ user_id: string; office_role: OfficeRole }>>(members)
      const all = unwrap<Array<{ user_id: string }>>(memberships)
      const profiles = all.length ? unwrap<Array<{ id: string; full_name: string | null; email: string }>>(await supabase.from('profiles').select('id, full_name, email').in('id', all.map((a) => a.user_id))) : []
      const name = (id: string) => {
        const p = profiles.find((x) => x.id === id)
        return p?.full_name ?? p?.email ?? id.slice(0, 8)
      }
      return { members: m.map((x) => ({ ...x, name: name(x.user_id) })), candidates: all.filter((a) => !m.some((x) => x.user_id === a.user_id)).map((a) => ({ id: a.user_id, name: name(a.user_id) })) }
    },
  })
  const add = useMutation({
    mutationFn: async () => unwrap(await supabase.from('office_members').insert({ office_id: office.id, organization_id: office.organization_id, user_id: userId, office_role: role })),
    onSuccess: () => {
      setUserId('')
      void queryClient.invalidateQueries({ queryKey: ['office-members', office.id] })
      void queryClient.invalidateQueries({ queryKey: ['members'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const remove = useMutation({
    mutationFn: async (uid: string) => unwrap(await supabase.from('office_members').delete().eq('office_id', office.id).eq('user_id', uid)),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['office-members', office.id] }),
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <div className="space-y-2">
      <ul className="space-y-1">
        {data.data?.members.map((m) => (
          <li key={m.user_id} className="flex items-center gap-2 text-sm">
            <span className="flex-1 truncate">{m.name}</span>
            <span className="text-xs text-muted-foreground">{officeRoleLabels[m.office_role]}</span>
            <Button size="icon-xs" variant="ghost" onClick={() => remove.mutate(m.user_id)} aria-label="Remover do gabinete">
              <Trash2 />
            </Button>
          </li>
        ))}
        {data.data?.members.length === 0 && <li className="text-xs text-muted-foreground">Sem integrantes.</li>}
      </ul>
      {(data.data?.candidates.length ?? 0) > 0 && (
        <div className="flex gap-2">
          <NativeSelect value={userId} onChange={(e) => setUserId(e.target.value)} className="h-8 text-xs" aria-label="Usuário">
            <option value="">Adicionar integrante…</option>
            {data.data!.candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect value={role} onChange={(e) => setRole(e.target.value as OfficeRole)} className="h-8 w-36 text-xs" aria-label="Função">
            {Object.entries(officeRoleLabels).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </NativeSelect>
          <Button size="icon-sm" variant="outline" disabled={!userId || add.isPending} onClick={() => add.mutate()} aria-label="Adicionar">
            <UserPlus />
          </Button>
        </div>
      )}
    </div>
  )
}

export function OfficesPage() {
  const ws = useRequiredWorkspace()
  const offices = useOffices(ws.organization.id)
  const [editing, setEditing] = useState<OfficeRow | null | 'new'>(null)
  if (offices.error) return <ErrorState error={offices.error} onRetry={() => offices.refetch()} />
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setEditing('new')}>
          <Plus /> Novo gabinete
        </Button>
      </div>
      {offices.isLoading ? (
        <LoadingRows />
      ) : (offices.data ?? []).length === 0 ? (
        <EmptyState title="Nenhum gabinete" description="Cadastre os gabinetes parlamentares para que assessores elaborem emendas." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {offices.data!.map((o) => (
            <Card key={o.id}>
              <CardHeader className="flex-row items-start justify-between gap-2 pb-2">
                <div>
                  <CardTitle className="text-sm">{o.name}</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    {o.parliamentarian_name}
                    {o.party ? ` · ${o.party}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {o.status === 'inactive' && <Pill>Inativo</Pill>}
                  <Button size="xs" variant="ghost" onClick={() => setEditing(o)}>
                    Editar
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <OfficeMembers office={o} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {editing && <OfficeDialog office={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function FiscalYearDialog({ year, onClose }: { year: FiscalYearRow | null; onClose: () => void }) {
  const ws = useRequiredWorkspace()
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    year: String(year?.year ?? new Date().getFullYear() + 1),
    phase: year?.phase ?? ('ploa' as FiscalPhase),
    rcl: year?.rcl_amount ? Number(year.rcl_amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '',
    rcl_reference: year?.rcl_reference ?? '',
    amendment_deadline: year?.amendment_deadline ?? '',
    bill_number: year?.bill_number ?? '',
    bill_summary: year?.bill_summary ?? '',
    notes: year?.notes ?? '',
  })
  const save = useMutation({
    mutationFn: async () => {
      const rcl = form.rcl ? parseMoneyInput(form.rcl) : null
      if (form.rcl && !rcl) throw new Error('RCL inválida.')
      if (rcl && !form.rcl_reference.trim()) throw new Error('Informe a fonte da RCL (ex.: RREO do 6º bimestre).')
      const payload = {
        year: Number(form.year),
        phase: form.phase,
        rcl_amount: rcl ? centsToDecimal(rcl) : null,
        rcl_reference: form.rcl_reference.trim() || null,
        amendment_deadline: form.amendment_deadline || null,
        bill_number: form.bill_number.trim() || null,
        bill_summary: form.bill_summary.trim() || null,
        notes: form.notes.trim() || null,
      }
      if (year) return unwrap(await supabase.from('fiscal_years').update(payload).eq('id', year.id))
      return unwrap(await supabase.from('fiscal_years').insert({ ...payload, organization_id: ws.organization.id }))
    },
    onSuccess: () => {
      toast.success('Exercício salvo.')
      void queryClient.invalidateQueries({ queryKey: ['fiscal-years'] })
      void ws.refresh()
      onClose()
    },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{year ? `Exercício ${year.year}` : 'Novo exercício'}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Ano" htmlFor="fy-year" required>
            <Input id="fy-year" inputMode="numeric" value={form.year} disabled={Boolean(year)} onChange={(e) => setForm({ ...form, year: e.target.value.replace(/\D/g, '').slice(0, 4) })} />
          </Field>
          <Field label="Fase" htmlFor="fy-phase">
            <NativeSelect id="fy-phase" value={form.phase} onChange={(e) => setForm({ ...form, phase: e.target.value as FiscalPhase })}>
              {Object.entries(fiscalPhaseLabels).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="RCL de referência (R$)" htmlFor="fy-rcl" hint="Base do limite de emendas individuais.">
            <Input id="fy-rcl" value={form.rcl} onChange={(e) => setForm({ ...form, rcl: e.target.value })} />
          </Field>
          <Field label="Fonte da RCL" htmlFor="fy-rcl-ref">
            <Input id="fy-rcl-ref" value={form.rcl_reference} onChange={(e) => setForm({ ...form, rcl_reference: e.target.value })} placeholder="RREO, 6º bimestre de 2025" />
          </Field>
          <Field label="Prazo de emendas" htmlFor="fy-deadline">
            <Input id="fy-deadline" type="date" value={form.amendment_deadline} onChange={(e) => setForm({ ...form, amendment_deadline: e.target.value })} />
          </Field>
          <Field label="Nº do Projeto de Lei Orçamentária" htmlFor="fy-bill" hint="Aparece no título das emendas.">
            <Input id="fy-bill" maxLength={40} value={form.bill_number} onChange={(e) => setForm({ ...form, bill_number: e.target.value })} placeholder="Ex.: 1458/2026" />
          </Field>
          <Field label="Ementa do Projeto de Lei" htmlFor="fy-bill-summary" className="sm:col-span-2">
            <Textarea
              id="fy-bill-summary"
              rows={2}
              maxLength={1000}
              value={form.bill_summary}
              onChange={(e) => setForm({ ...form, bill_summary: e.target.value })}
              placeholder="Estima a receita e fixa a despesa do Município para o exercício financeiro de …"
            />
          </Field>
          <Field label="Observações" htmlFor="fy-notes" className="sm:col-span-2">
            <Textarea id="fy-notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || form.year.length !== 4}>
            {save.isPending && <Loader2 className="animate-spin" />} Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function FiscalYearsPage() {
  const ws = useRequiredWorkspace()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<FiscalYearRow | null | 'new'>(null)
  const years = useQuery({
    queryKey: ['fiscal-years', ws.organization.id],
    queryFn: async () => unwrap<FiscalYearRow[]>(await supabase.from('fiscal_years').select('*').eq('organization_id', ws.organization.id).order('year', { ascending: false })),
  })
  const activate = useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.rpc('activate_fiscal_year', { p_fiscal_year_id: id })),
    onSuccess: () => {
      toast.success('Exercício ativado.')
      void queryClient.invalidateQueries({ queryKey: ['fiscal-years'] })
      void ws.refresh()
    },
    onError: (e: Error) => toast.error(e.message),
  })
  if (years.error) return <ErrorState error={years.error} onRetry={() => years.refetch()} />
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setEditing('new')}>
          <Plus /> Novo exercício
        </Button>
      </div>
      {years.isLoading ? (
        <LoadingRows />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {years.data!.map((y) => (
            <Card key={y.id} className={y.is_active ? 'border-brand/40' : undefined}>
              <CardContent className="space-y-2 p-4">
                <div className="flex items-center gap-2">
                  <span className="text-lg font-semibold">{y.year}</span>
                  <Pill tone="info">{fiscalPhaseLabels[y.phase]}</Pill>
                  {y.is_active && <Pill tone="success" icon={CheckCircle2}>Ativo</Pill>}
                </div>
                <p className="text-sm text-muted-foreground">
                  RCL: {y.rcl_amount ? money(y.rcl_amount) : 'não informada'}
                  {y.rcl_reference ? ` (${y.rcl_reference})` : ''}
                </p>
                <p className="text-sm text-muted-foreground">Prazo de emendas: {formatDate(y.amendment_deadline)}</p>
                <div className="flex gap-2 pt-1">
                  <Button size="sm" variant="outline" onClick={() => setEditing(y)}>
                    Editar
                  </Button>
                  {!y.is_active && (
                    <Button size="sm" onClick={() => activate.mutate(y.id)} disabled={activate.isPending}>
                      Ativar
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {editing && <FiscalYearDialog year={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
