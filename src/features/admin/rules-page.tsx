import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, CheckCircle2, CopyPlus, Loader2, Pencil, Play, ShieldAlert, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Pill } from '@/components/common/badges'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { Field, NativeSelect } from '@/components/common/form'
import { EmptyState, ErrorState, LoadingRows } from '@/components/common/states'
import { isRuleType, ruleParamSchemas, ruleTypeLabels } from '@shared/domain/amendments/rules'
import { ruleStatusLabels, sphereLabels } from '@shared/domain/labels'
import type { AmendmentModalityRow, LegalRuleRow, RuleTemplateRow } from '@shared/types/db'
import { supabase, unwrap } from '@/lib/supabase'
import { formatDateTime } from '@/lib/format'
import { useRequiredWorkspace } from '@/providers/workspace'

function validateParams(ruleType: string, text: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text || '{}')
  } catch {
    return { ok: false, error: 'JSON inválido.' }
  }
  if (!isRuleType(ruleType)) return { ok: false, error: 'Tipo de regra desconhecido.' }
  const result = ruleParamSchemas[ruleType].safeParse(parsed)
  if (!result.success) return { ok: false, error: result.error.issues.map((i) => `${i.path.join('.') || 'parâmetros'}: ${i.message}`).join('; ') }
  return { ok: true, value: parsed as Record<string, unknown> }
}

function RuleDialog({ rule, modalities, onClose }: { rule: LegalRuleRow; modalities: AmendmentModalityRow[]; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    name: rule.name,
    description: rule.description ?? '',
    legal_basis: rule.legal_basis,
    sphere: rule.sphere,
    severity: rule.severity,
    params: JSON.stringify(rule.params, null, 2),
    applies: rule.applies_to_modalities ?? [],
    confirmed: rule.local_incidence_confirmed,
    note: rule.incidence_note ?? '',
  })
  const check = validateParams(rule.rule_type, form.params)
  const save = useMutation({
    mutationFn: async () => {
      if (!check.ok) throw new Error(check.error)
      if (form.legal_basis.trim().length < 5) throw new Error('Informe a base legal (dispositivo normativo local).')
      return unwrap(
        await supabase
          .from('legal_rules')
          .update({
            name: form.name.trim(),
            description: form.description.trim() || null,
            legal_basis: form.legal_basis.trim(),
            sphere: form.sphere,
            severity: form.severity,
            params: check.value,
            applies_to_modalities: form.applies.length ? form.applies : null,
            local_incidence_confirmed: form.confirmed,
            incidence_note: form.note.trim() || null,
          })
          .eq('id', rule.id),
      )
    },
    onSuccess: () => {
      toast.success('Regra salva.')
      void queryClient.invalidateQueries({ queryKey: ['legal-rules'] })
      onClose()
    },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {rule.code} · versão {rule.version}
          </DialogTitle>
          <DialogDescription>
            {ruleTypeLabels[rule.rule_type as keyof typeof ruleTypeLabels] ?? rule.rule_type}. Regras ativas são imutáveis: alterações exigem nova versão, preservando o histórico das validações.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="Nome" htmlFor="r-name">
            <Input id="r-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Descrição" htmlFor="r-desc">
            <Textarea id="r-desc" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <Field label="Base legal local" htmlFor="r-basis" required hint="Indique o dispositivo da Lei Orgânica, Constituição Estadual, LDO ou Regimento que fundamenta a regra.">
            <Input id="r-basis" value={form.legal_basis} onChange={(e) => setForm({ ...form, legal_basis: e.target.value })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Esfera" htmlFor="r-sphere">
              <NativeSelect id="r-sphere" value={form.sphere} onChange={(e) => setForm({ ...form, sphere: e.target.value as LegalRuleRow['sphere'] })}>
                {Object.entries(sphereLabels).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Severidade" htmlFor="r-sev">
              <NativeSelect id="r-sev" value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value as 'blocking' | 'warning' })}>
                <option value="blocking">Bloqueante</option>
                <option value="warning">Aviso (não bloqueia)</option>
              </NativeSelect>
            </Field>
          </div>
          <div>
            <p className="mb-1.5 text-[13px] font-medium">Modalidades</p>
            <div className="flex flex-wrap gap-3">
              {modalities.map((m) => (
                <label key={m.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={form.applies.includes(m.code)}
                    onCheckedChange={(v) => setForm({ ...form, applies: v ? [...form.applies, m.code] : form.applies.filter((c) => c !== m.code) })}
                  />
                  {m.name}
                </label>
              ))}
              <span className="text-xs text-muted-foreground">Nenhuma marcada = todas as modalidades.</span>
            </div>
          </div>
          <Field label="Parâmetros (JSON)" htmlFor="r-params" error={check.ok ? undefined : check.error}>
            <Textarea id="r-params" rows={6} className="font-mono text-xs" value={form.params} onChange={(e) => setForm({ ...form, params: e.target.value })} />
          </Field>
          <label className="flex items-start gap-2.5 rounded-md border border-warning/40 bg-warning-soft p-3 text-sm">
            <Checkbox checked={form.confirmed} onCheckedChange={(v) => setForm({ ...form, confirmed: v === true })} className="mt-0.5" />
            <span>
              <strong>Confirmo a incidência desta norma na instituição</strong>
              <span className="block text-xs text-muted-foreground">
                Regras federais não são aplicadas automaticamente. A confirmação é registrada com seu usuário e é requisito para ativar a regra.
              </span>
            </span>
          </label>
          {form.confirmed && (
            <Field label="Nota de incidência" htmlFor="r-note" hint="Ex.: reproduzido no art. 121 da Lei Orgânica.">
              <Input id="r-note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </Field>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !check.ok}>
            {save.isPending && <Loader2 className="animate-spin" />} Salvar rascunho
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function RulesPage() {
  const ws = useRequiredWorkspace()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<LegalRuleRow | null>(null)
  const data = useQuery({
    queryKey: ['legal-rules', ws.organization.id],
    queryFn: async () => {
      const [rules, templates, modalities] = await Promise.all([
        supabase.from('legal_rules').select('*').eq('organization_id', ws.organization.id).order('code').order('version', { ascending: false }),
        supabase.from('rule_templates').select('*').order('code'),
        supabase.from('amendment_modalities').select('*').eq('organization_id', ws.organization.id),
      ])
      return { rules: unwrap<LegalRuleRow[]>(rules), templates: unwrap<RuleTemplateRow[]>(templates), modalities: unwrap<AmendmentModalityRow[]>(modalities) }
    },
  })
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['legal-rules'] })
  const onError = (e: Error) => toast.error(e.message)

  const nextVersion = (code: string) => Math.max(0, ...(data.data?.rules.filter((r) => r.code === code).map((r) => r.version) ?? [0])) + 1

  const adopt = useMutation({
    mutationFn: async (t: RuleTemplateRow) =>
      unwrap(
        await supabase.from('legal_rules').insert({
          organization_id: ws.organization.id,
          code: t.code,
          version: nextVersion(t.code),
          name: t.name,
          description: t.description,
          rule_type: t.rule_type,
          params: t.default_params,
          legal_basis: t.legal_basis,
          sphere: t.sphere,
          severity: t.severity,
          template_code: t.code,
          status: 'draft',
        }),
      ),
    onSuccess: () => {
      toast.success('Modelo adotado como rascunho. Revise a base legal local e confirme a incidência.')
      invalidate()
    },
    onError,
  })
  const newVersion = useMutation({
    mutationFn: async (r: LegalRuleRow) =>
      unwrap(
        await supabase.from('legal_rules').insert({
          organization_id: r.organization_id,
          code: r.code,
          version: nextVersion(r.code),
          name: r.name,
          description: r.description,
          rule_type: r.rule_type,
          params: r.params,
          legal_basis: r.legal_basis,
          sphere: r.sphere,
          severity: r.severity,
          applies_to_modalities: r.applies_to_modalities,
          template_code: r.template_code,
          supersedes_id: r.id,
          status: 'draft',
        }),
      ),
    onSuccess: () => {
      toast.success('Nova versão criada como rascunho.')
      invalidate()
    },
    onError,
  })
  const activate = useMutation({ mutationFn: async (id: string) => unwrap(await supabase.rpc('activate_legal_rule', { p_rule_id: id })), onSuccess: () => { toast.success('Regra ativada.'); invalidate() }, onError })
  const archive = useMutation({ mutationFn: async (id: string) => unwrap(await supabase.rpc('archive_legal_rule', { p_rule_id: id })), onSuccess: invalidate, onError })
  const remove = useMutation({ mutationFn: async (id: string) => unwrap(await supabase.from('legal_rules').delete().eq('id', id)), onSuccess: invalidate, onError })

  const groups = useMemo(() => {
    const map = new Map<string, LegalRuleRow[]>()
    for (const r of data.data?.rules ?? []) map.set(r.code, [...(map.get(r.code) ?? []), r])
    return [...map.entries()]
  }, [data.data])

  if (data.error) return <ErrorState error={data.error} onRetry={() => data.refetch()} />
  if (data.isLoading) return <LoadingRows />
  const adoptedCodes = new Set(data.data!.rules.map((r) => r.code))
  const activeCount = data.data!.rules.filter((r) => r.status === 'active').length

  return (
    <Tabs defaultValue="regras">
      <TabsList className="mb-4">
        <TabsTrigger value="regras">Regras da instituição ({activeCount} ativas)</TabsTrigger>
        <TabsTrigger value="catalogo">Catálogo de modelos</TabsTrigger>
      </TabsList>
      <TabsContent value="regras" className="space-y-3">
        {activeCount === 0 && (
          <p className="flex items-center gap-2 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
            <ShieldAlert className="size-4" /> Sem regras ativas, nenhuma emenda pode ser validada tecnicamente.
          </p>
        )}
        {groups.length === 0 ? (
          <EmptyState title="Nenhuma regra configurada" description="Adote modelos do catálogo e ajuste-os à legislação local." />
        ) : (
          groups.map(([code, versions]) => {
            const current = versions.find((v) => v.status === 'active') ?? versions[0]!
            const drafts = versions.filter((v) => v.status === 'draft')
            return (
              <Card key={code}>
                <CardContent className="space-y-3 p-4">
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">{current.name}</span>
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {code} v{current.version}
                        </span>
                        <Pill tone={current.status === 'active' ? 'success' : current.status === 'draft' ? 'warning' : 'neutral'}>{ruleStatusLabels[current.status]}</Pill>
                        <Pill>{ruleTypeLabels[current.rule_type as keyof typeof ruleTypeLabels] ?? current.rule_type}</Pill>
                        {current.severity === 'warning' && <Pill>aviso</Pill>}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{current.legal_basis}</p>
                      {current.local_incidence_confirmed ? (
                        <p className="mt-1 flex items-center gap-1 text-xs text-success">
                          <CheckCircle2 className="size-3" /> Incidência local confirmada {current.confirmed_at ? `em ${formatDateTime(current.confirmed_at)}` : ''}
                          {current.incidence_note ? ` — ${current.incidence_note}` : ''}
                        </p>
                      ) : (
                        <p className="mt-1 text-xs text-warning">Incidência local não confirmada.</p>
                      )}
                    </div>
                    {current.status === 'active' && (
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" onClick={() => newVersion.mutate(current)} disabled={drafts.length > 0}>
                          <CopyPlus /> Nova versão
                        </Button>
                        <ConfirmDialog
                          trigger={
                            <Button size="sm" variant="ghost">
                              <Archive /> Arquivar
                            </Button>
                          }
                          title="Arquivar regra?"
                          description="A regra deixará de ser aplicada em novas validações. Validações anteriores mantêm a referência a esta versão."
                          onConfirm={() => archive.mutateAsync(current.id)}
                        />
                      </div>
                    )}
                  </div>
                  {drafts.map((d) => (
                    <div key={d.id} className="flex flex-wrap items-center gap-2 rounded-md border border-dashed p-3">
                      <span className="text-sm">
                        Rascunho v{d.version}
                        {!d.local_incidence_confirmed && <span className="ml-2 text-xs text-warning">incidência não confirmada</span>}
                      </span>
                      <div className="ml-auto flex gap-1">
                        <Button size="sm" variant="outline" onClick={() => setEditing(d)}>
                          <Pencil /> Editar
                        </Button>
                        <Button size="sm" onClick={() => activate.mutate(d.id)} disabled={!d.local_incidence_confirmed || activate.isPending}>
                          <Play /> Ativar
                        </Button>
                        <Button size="icon-sm" variant="ghost" onClick={() => remove.mutate(d.id)} aria-label="Excluir rascunho">
                          <Trash2 />
                        </Button>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )
          })
        )}
      </TabsContent>
      <TabsContent value="catalogo" className="grid gap-3 md:grid-cols-2">
        {data.data!.templates.map((t) => (
          <Card key={t.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{t.name}</CardTitle>
              <p className="font-mono text-[11px] text-muted-foreground">{t.code}</p>
            </CardHeader>
            <CardContent className="space-y-2 pt-0 text-sm">
              <p>{t.description}</p>
              <p className="text-xs text-muted-foreground">Base: {t.legal_basis}</p>
              <p className="rounded-md bg-muted p-2 text-xs">{t.applicability_note}</p>
              <Button size="sm" variant="outline" disabled={adoptedCodes.has(t.code) || adopt.isPending} onClick={() => adopt.mutate(t)}>
                {adoptedCodes.has(t.code) ? 'Já adotado' : 'Adotar como rascunho'}
              </Button>
            </CardContent>
          </Card>
        ))}
      </TabsContent>
      {editing && <RuleDialog rule={editing} modalities={data.data!.modalities} onClose={() => setEditing(null)} />}
    </Tabs>
  )
}
