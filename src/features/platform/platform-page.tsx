import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DemoBadge, Pill } from '@/components/common/badges'
import { Field, NativeSelect } from '@/components/common/form'
import { PageHeader } from '@/components/common/page-header'
import { EmptyState, ErrorState, LoadingRows } from '@/components/common/states'
import { PageContainer } from '@/components/layout/app-shell'
import { orgKindLabels, orgStatusLabels } from '@shared/domain/labels'
import type { OrgKind, OrgStatus } from '@shared/types/db'
import { apiFetch } from '@/lib/api'
import { supabase, unwrap } from '@/lib/supabase'
import { formatBytes, formatDate } from '@/lib/format'

interface Metric {
  organization_id: string
  organization_name: string
  kind: OrgKind
  uf: string
  status: OrgStatus
  plan_name: string | null
  is_demo: boolean
  members: number
  offices: number
  documents: number
  storage_bytes: number
  amendments: number
  ai_requests_month: number
  ai_tokens_month: number
  failed_jobs_7d: number
  created_at: string
}

interface Plan {
  id: string
  code: string
  name: string
  description: string | null
  max_users: number | null
  max_offices: number | null
  max_storage_mb: number | null
  monthly_ai_requests: number | null
  monthly_ai_tokens: number | null
  is_active: boolean
}

const ufs = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ')

function CreateOrganizationDialog({ plans, onClose }: { plans: Plan[]; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({ name: '', shortName: '', kind: 'camara_municipal' as OrgKind, uf: 'SP', municipality: '', slug: '', planId: plans[0]?.id ?? '', parliamentariansCount: '', adminEmail: '', adminName: '' })
  const create = useMutation({
    mutationFn: () =>
      apiFetch<{ invitation: { message: string } | null }>('/platform/organizations', {
        method: 'POST',
        json: {
          name: form.name,
          shortName: form.shortName || undefined,
          kind: form.kind,
          uf: form.uf,
          municipality: form.municipality || undefined,
          slug: form.slug,
          planId: form.planId || null,
          parliamentariansCount: form.parliamentariansCount ? Number(form.parliamentariansCount) : undefined,
          adminEmail: form.adminEmail || undefined,
          adminName: form.adminName || undefined,
        },
      }),
    onSuccess: (data) => {
      toast.success(`Instituição cadastrada.${data.invitation ? ` ${data.invitation.message}` : ''}`)
      void queryClient.invalidateQueries({ queryKey: ['platform-metrics'] })
      onClose()
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const slugify = (v: string) => v.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nova instituição</DialogTitle>
          <DialogDescription>Cria um ambiente lógico isolado (tenant). O primeiro administrador recebe convite por e-mail.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome oficial" htmlFor="o-name" required className="sm:col-span-2">
            <Input id="o-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value, slug: form.slug || slugify(e.target.value) })} placeholder="Câmara Municipal de …" />
          </Field>
          <Field label="Tipo" htmlFor="o-kind">
            <NativeSelect id="o-kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as OrgKind })}>
              {Object.entries(orgKindLabels).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="UF" htmlFor="o-uf">
            <NativeSelect id="o-uf" value={form.uf} onChange={(e) => setForm({ ...form, uf: e.target.value })}>
              {ufs.map((u) => (
                <option key={u}>{u}</option>
              ))}
            </NativeSelect>
          </Field>
          {form.kind === 'camara_municipal' && (
            <Field label="Município" htmlFor="o-mun" required>
              <Input id="o-mun" value={form.municipality} onChange={(e) => setForm({ ...form, municipality: e.target.value })} />
            </Field>
          )}
          <Field label="Sigla" htmlFor="o-short">
            <Input id="o-short" value={form.shortName} onChange={(e) => setForm({ ...form, shortName: e.target.value })} />
          </Field>
          <Field label="Identificador (slug)" htmlFor="o-slug" required>
            <Input id="o-slug" value={form.slug} onChange={(e) => setForm({ ...form, slug: slugify(e.target.value) })} />
          </Field>
          <Field label="Plano" htmlFor="o-plan">
            <NativeSelect id="o-plan" value={form.planId} onChange={(e) => setForm({ ...form, planId: e.target.value })}>
              <option value="">Sem plano</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Número de parlamentares" htmlFor="o-parl" hint="Usado no rateio do limite de emendas individuais.">
            <Input id="o-parl" inputMode="numeric" value={form.parliamentariansCount} onChange={(e) => setForm({ ...form, parliamentariansCount: e.target.value.replace(/\D/g, '') })} />
          </Field>
          <Field label="E-mail do administrador" htmlFor="o-admin">
            <Input id="o-admin" type="email" value={form.adminEmail} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} />
          </Field>
          <Field label="Nome do administrador" htmlFor="o-admin-name">
            <Input id="o-admin-name" value={form.adminName} onChange={(e) => setForm({ ...form, adminName: e.target.value })} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending || form.name.length < 3 || form.slug.length < 3}>
            {create.isPending && <Loader2 className="animate-spin" />} Cadastrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function PlatformPage() {
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)
  const metrics = useQuery({ queryKey: ['platform-metrics'], queryFn: async () => unwrap<Metric[]>(await supabase.rpc('platform_metrics')) })
  const plans = useQuery({ queryKey: ['plans'], queryFn: async () => unwrap<Plan[]>(await supabase.from('plans').select('*').order('name')) })
  const updateOrg = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, unknown> }) => unwrap(await supabase.from('organizations').update(patch).eq('id', id)),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['platform-metrics'] }),
    onError: (e: Error) => toast.error(e.message),
  })
  const updatePlan = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, unknown> }) => unwrap(await supabase.from('plans').update(patch).eq('id', id)),
    onSuccess: () => {
      toast.success('Plano atualizado.')
      void queryClient.invalidateQueries({ queryKey: ['plans'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const totals = (metrics.data ?? []).reduce(
    (acc, m) => ({ orgs: acc.orgs + 1, members: acc.members + m.members, amendments: acc.amendments + m.amendments, ai: acc.ai + m.ai_requests_month, failed: acc.failed + m.failed_jobs_7d }),
    { orgs: 0, members: 0, amendments: 0, ai: 0, failed: 0 },
  )

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow="Administração da plataforma"
        title="Instituições e planos"
        description="Métricas operacionais agregadas. O conteúdo das emendas, documentos e conversas dos gabinetes não é acessível a esta área."
        actions={
          <Button onClick={() => setCreating(true)} disabled={!plans.data}>
            <Plus /> Nova instituição
          </Button>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          ['Instituições', totals.orgs],
          ['Usuários ativos', totals.members],
          ['Emendas', totals.amendments],
          ['Requisições de IA (mês)', totals.ai],
          ['Jobs com falha (7 dias)', totals.failed],
        ].map(([label, value]) => (
          <Card key={label as string}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-1 text-2xl font-semibold tabular">{value as number}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Tabs defaultValue="instituicoes">
        <TabsList className="mb-4">
          <TabsTrigger value="instituicoes">Instituições</TabsTrigger>
          <TabsTrigger value="planos">Planos</TabsTrigger>
        </TabsList>
        <TabsContent value="instituicoes">
          {metrics.error ? (
            <ErrorState error={metrics.error} onRetry={() => metrics.refetch()} />
          ) : metrics.isLoading ? (
            <LoadingRows />
          ) : (metrics.data ?? []).length === 0 ? (
            <EmptyState icon={Building2} title="Nenhuma instituição" action={<Button onClick={() => setCreating(true)}>Cadastrar</Button>} />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead>Instituição</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead>Plano</TableHead>
                    <TableHead className="text-right">Usuários</TableHead>
                    <TableHead className="text-right">Gabinetes</TableHead>
                    <TableHead className="text-right">Documentos</TableHead>
                    <TableHead className="text-right">Emendas</TableHead>
                    <TableHead className="text-right">IA (mês)</TableHead>
                    <TableHead className="text-right">Falhas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {metrics.data!.map((m) => (
                    <TableRow key={m.organization_id}>
                      <TableCell>
                        <span className="flex items-center gap-1.5 font-medium">
                          {m.organization_name} {m.is_demo && <DemoBadge />}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {orgKindLabels[m.kind]} · {m.uf} · desde {formatDate(m.created_at)} · {formatBytes(m.storage_bytes)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <NativeSelect value={m.status} onChange={(e) => updateOrg.mutate({ id: m.organization_id, patch: { status: e.target.value } })} className="h-8 w-32 text-xs" aria-label="Situação">
                          {Object.entries(orgStatusLabels).map(([v, l]) => (
                            <option key={v} value={v}>
                              {l}
                            </option>
                          ))}
                        </NativeSelect>
                      </TableCell>
                      <TableCell>
                        <NativeSelect
                          value={plans.data?.find((p) => p.name === m.plan_name)?.id ?? ''}
                          onChange={(e) => updateOrg.mutate({ id: m.organization_id, patch: { plan_id: e.target.value || null } })}
                          className="h-8 w-36 text-xs"
                          aria-label="Plano"
                        >
                          <option value="">Sem plano</option>
                          {plans.data?.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </NativeSelect>
                      </TableCell>
                      <TableCell className="text-right tabular">{m.members}</TableCell>
                      <TableCell className="text-right tabular">{m.offices}</TableCell>
                      <TableCell className="text-right tabular">{m.documents}</TableCell>
                      <TableCell className="text-right tabular">{m.amendments}</TableCell>
                      <TableCell className="text-right tabular">{m.ai_requests_month}</TableCell>
                      <TableCell className="text-right tabular">{m.failed_jobs_7d > 0 ? <Pill tone="danger">{m.failed_jobs_7d}</Pill> : 0}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
        <TabsContent value="planos" className="grid gap-3 md:grid-cols-2">
          {(plans.data ?? []).map((p) => (
            <Card key={p.id}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  {p.name} <span className="font-mono text-[11px] font-normal text-muted-foreground">{p.code}</span>
                </CardTitle>
                {p.description && <p className="text-xs text-muted-foreground">{p.description}</p>}
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3 pt-0">
                {(
                  [
                    ['max_users', 'Usuários'],
                    ['max_offices', 'Gabinetes'],
                    ['max_storage_mb', 'Armazenamento (MB)'],
                    ['monthly_ai_requests', 'Requisições de IA/mês'],
                    ['monthly_ai_tokens', 'Tokens de IA/mês'],
                  ] as const
                ).map(([key, label]) => (
                  <Field key={key} label={label} htmlFor={`${p.id}-${key}`}>
                    <Input
                      id={`${p.id}-${key}`}
                      inputMode="numeric"
                      defaultValue={p[key] ?? ''}
                      onBlur={(e) => {
                        const value = e.target.value ? Number(e.target.value.replace(/\D/g, '')) : null
                        if (value !== p[key]) updatePlan.mutate({ id: p.id, patch: { [key]: value } })
                      }}
                    />
                  </Field>
                ))}
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
      {creating && plans.data && <CreateOrganizationDialog plans={plans.data} onClose={() => setCreating(false)} />}
    </PageContainer>
  )
}
