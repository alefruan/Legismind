import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { Pill } from '@/components/common/badges'
import { Field, NativeSelect } from '@/components/common/form'
import { EmptyState, ErrorState, LoadingRows } from '@/components/common/states'
import { DocumentSheet } from '@/components/document/document-preview'
import { DEFAULT_AMENDMENT_TEMPLATE, renderAmendmentDocument } from '@shared/domain/amendments/document'
import { TEMPLATE_PRESETS } from '@shared/domain/amendments/templates'
import type { TextSubtype } from '@shared/domain/amendments/types'
import type { AmendmentModalityRow, AuditLogRow, DocumentTemplateRow, OrganizationSettingsRow } from '@shared/types/db'
import { supabase, unwrap } from '@/lib/supabase'
import { formatDateTime } from '@/lib/format'
import { useRequiredWorkspace } from '@/providers/workspace'

// -----------------------------------------------------------------------------
// Modalidades
// -----------------------------------------------------------------------------
export function ModalitiesPage() {
  const ws = useRequiredWorkspace()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<Partial<AmendmentModalityRow> | null>(null)
  const list = useQuery({
    queryKey: ['modalities-admin', ws.organization.id],
    queryFn: async () => unwrap<AmendmentModalityRow[]>(await supabase.from('amendment_modalities').select('*').eq('organization_id', ws.organization.id).order('name')),
  })
  const templates = useQuery({
    queryKey: ['templates', ws.organization.id],
    queryFn: async () => unwrap<DocumentTemplateRow[]>(await supabase.from('document_templates').select('*').eq('organization_id', ws.organization.id).order('updated_at', { ascending: false })),
  })
  const save = useMutation({
    mutationFn: async (m: Partial<AmendmentModalityRow>) => {
      const kind = m.kind ?? 'budget'
      const payload = {
        code: m.code,
        name: m.name,
        description: m.description || null,
        kind,
        text_subtype: kind === 'text' ? (m.text_subtype ?? 'aditiva') : null,
        type_label: m.type_label?.trim() || null,
        template_id: m.template_id || null,
        requires_cancellation: kind === 'text' ? false : (m.requires_cancellation ?? true),
        is_impositive: m.is_impositive ?? false,
        counts_toward_individual_limit: m.counts_toward_individual_limit ?? false,
        legal_basis: m.legal_basis || null,
        is_active: m.is_active ?? true,
      }
      if (m.id) return unwrap(await supabase.from('amendment_modalities').update(payload).eq('id', m.id))
      return unwrap(await supabase.from('amendment_modalities').insert({ ...payload, organization_id: ws.organization.id }))
    },
    onSuccess: () => {
      toast.success('Modalidade salva.')
      setEditing(null)
      void queryClient.invalidateQueries({ queryKey: ['modalities-admin'] })
      void queryClient.invalidateQueries({ queryKey: ['modalities'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
  if (list.error) return <ErrorState error={list.error} />
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setEditing({ kind: 'budget', requires_cancellation: true, is_active: true })}>
          <Plus /> Nova modalidade
        </Button>
      </div>
      {list.isLoading ? (
        <LoadingRows />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {list.data!.map((m) => (
            <Card key={m.id}>
              <CardContent className="space-y-2 p-4">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">{m.name}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">{m.code}</span>
                  {!m.is_active && <Pill>Inativa</Pill>}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Pill>{m.kind === 'text' ? `Emenda ao texto — ${subtypeNames[m.text_subtype ?? 'aditiva']}` : 'Orçamentária'}</Pill>
                  {m.type_label && <Pill>Tipo no formulário: {m.type_label}</Pill>}
                  {m.requires_cancellation && <Pill tone="info">Exige anulação</Pill>}
                  {m.is_impositive && <Pill tone="info">Impositiva</Pill>}
                  {m.counts_toward_individual_limit && <Pill tone="info">Conta no limite individual</Pill>}
                </div>
                {m.legal_basis && <p className="text-xs text-muted-foreground">Base: {m.legal_basis}</p>}
                <Button size="sm" variant="outline" onClick={() => setEditing(m)}>
                  Editar
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {editing && (
        <Dialog open onOpenChange={(v) => !v && setEditing(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing.id ? 'Editar modalidade' : 'Nova modalidade'}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Nome" htmlFor="m-name" required>
                  <Input id="m-name" value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                </Field>
                <Field label="Código" htmlFor="m-code" required hint="Minúsculas e _">
                  <Input id="m-code" value={editing.code ?? ''} disabled={Boolean(editing.id)} onChange={(e) => setEditing({ ...editing, code: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Natureza da emenda" htmlFor="m-kind">
                  <NativeSelect
                    id="m-kind"
                    value={editing.kind ?? 'budget'}
                    onChange={(e) => {
                      const kind = e.target.value as AmendmentModalityRow['kind']
                      setEditing({
                        ...editing,
                        kind,
                        text_subtype: kind === 'text' ? (editing.text_subtype ?? 'aditiva') : null,
                        requires_cancellation: kind === 'text' ? false : editing.requires_cancellation,
                        counts_toward_individual_limit: kind === 'text' ? false : editing.counts_toward_individual_limit,
                        template_id: null,
                      })
                    }}
                  >
                    <option value="budget">Orçamentária (acréscimo e cancelamento)</option>
                    <option value="text">Emenda ao texto do projeto</option>
                  </NativeSelect>
                </Field>
                {editing.kind === 'text' ? (
                  <Field label="Subtipo" htmlFor="m-subtype">
                    <NativeSelect id="m-subtype" value={editing.text_subtype ?? 'aditiva'} onChange={(e) => setEditing({ ...editing, text_subtype: e.target.value as AmendmentModalityRow['text_subtype'] })}>
                      <option value="aditiva">Aditiva</option>
                      <option value="modificativa">Modificativa</option>
                      <option value="supressiva">Supressiva</option>
                    </NativeSelect>
                  </Field>
                ) : (
                  <Field label="Tipo no formulário" htmlFor="m-type" hint="Ex.: Impositiva, Remanejamento">
                    <Input id="m-type" maxLength={60} value={editing.type_label ?? ''} onChange={(e) => setEditing({ ...editing, type_label: e.target.value })} />
                  </Field>
                )}
              </div>
              {editing.kind === 'text' && (
                <Field label="Tipo no formulário" htmlFor="m-type-t" hint="Ex.: Emenda ao texto">
                  <Input id="m-type-t" maxLength={60} value={editing.type_label ?? ''} onChange={(e) => setEditing({ ...editing, type_label: e.target.value })} />
                </Field>
              )}
              <Field label="Modelo do documento" htmlFor="m-template" hint="Sem modelo próprio, usa o modelo padrão da instituição (orçamentárias) ou o formulário do LegisMind para o subtipo.">
                <NativeSelect id="m-template" value={editing.template_id ?? ''} onChange={(e) => setEditing({ ...editing, template_id: e.target.value || null })}>
                  <option value="">Padrão</option>
                  {(templates.data ?? [])
                    .filter((t) => t.status !== 'archived' && t.kind === (editing.kind === 'text' ? 'emenda_texto' : 'emenda_orcamentaria'))
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {`${t.name} (v${t.version}${t.status === 'draft' ? ', rascunho' : ''})`}
                      </option>
                    ))}
                </NativeSelect>
              </Field>
              <Field label="Base legal" htmlFor="m-basis">
                <Input id="m-basis" value={editing.legal_basis ?? ''} onChange={(e) => setEditing({ ...editing, legal_basis: e.target.value })} />
              </Field>
              <Field label="Descrição" htmlFor="m-desc">
                <Textarea id="m-desc" rows={2} value={editing.description ?? ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
              </Field>
              {(
                [
                  ['requires_cancellation', 'Exige anulação compensatória'],
                  ['is_impositive', 'Emenda impositiva'],
                  ['counts_toward_individual_limit', 'Conta no limite das emendas individuais'],
                  ['is_active', 'Ativa'],
                ] as const
              )
                .filter(([key]) => editing.kind !== 'text' || key === 'is_active')
                .map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={Boolean(editing[key])} onCheckedChange={(v) => setEditing({ ...editing, [key]: v === true })} />
                  {label}
                </label>
              ))}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditing(null)}>
                Cancelar
              </Button>
              <Button onClick={() => save.mutate(editing)} disabled={save.isPending || !editing.name || !editing.code || editing.code.length < 2}>
                {save.isPending && <Loader2 className="animate-spin" />} Salvar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

// -----------------------------------------------------------------------------
// Modelos oficiais de documentos
// -----------------------------------------------------------------------------
const subtypeNames: Record<string, string> = { aditiva: 'aditiva', modificativa: 'modificativa', supressiva: 'supressiva' }

const placeholderGroups: Array<[string, string[]]> = [
  ['Quadros', ['cabecalho', 'autoria', 'acrescimo|Rótulo do valor', 'cancelamento|Rótulo do valor', 'objeto_tabela', 'beneficiario_quadro', 'assinatura_linha', 'assinatura', 'tabela_destinacao', 'tabela_anulacao']],
  [
    'Campos',
    [
      'instituicao',
      'projeto_lei',
      'ementa_projeto',
      'numero_emenda',
      'numero',
      'exercicio',
      'tipo_emenda',
      'subtipo_emenda',
      'subtipo_maiusculo',
      'modalidade',
      'parlamentar',
      'cargo',
      'partido',
      'autor_partido',
      'gabinete',
      'objeto',
      'finalidade',
      'meta_fisica',
      'localizacao',
      'beneficiario',
      'justificativa',
      'fundamentacao',
      'valor_total',
      'data_indicacao',
      'data_extenso',
      'cidade',
      'local_data',
      'dispositivo',
      'comando_texto',
      'texto_original',
      'texto_novo',
    ],
  ],
]

const templateKinds: Record<string, string> = { emenda_orcamentaria: 'Emenda orçamentária', emenda_texto: 'Emenda ao texto' }

export function TemplatesPage() {
  const ws = useRequiredWorkspace()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<Partial<DocumentTemplateRow> | null>(null)
  const [previewSubtype, setPreviewSubtype] = useState<TextSubtype>('aditiva')
  const list = useQuery({
    queryKey: ['templates', ws.organization.id],
    queryFn: async () => unwrap<DocumentTemplateRow[]>(await supabase.from('document_templates').select('*').eq('organization_id', ws.organization.id).order('updated_at', { ascending: false })),
  })
  const preview = useMemo(() => {
    if (!editing?.body) return null
    const isText = editing.kind === 'emenda_texto'
    const today = new Date().toISOString().slice(0, 10)
    return renderAmendmentDocument(editing.body, {
      institutionHeader: ws.settings?.institution_header ?? ws.organization.name.toUpperCase(),
      number: 'EM-0000/0001',
      protocolNumber: null,
      fiscalYear: ws.fiscalYear?.year ?? new Date().getFullYear() + 1,
      billNumber: ws.fiscalYear?.bill_number || '0000/0000',
      billSummary: ws.fiscalYear?.bill_summary || 'Ementa do Projeto de Lei Orçamentária (cadastre no exercício).',
      modalityName: 'Modalidade de exemplo',
      modalityKind: isText ? 'text' : 'budget',
      typeLabel: isText ? 'Emenda ao texto' : 'Impositiva',
      textSubtype: isText ? previewSubtype : null,
      isImpositive: !isText,
      parliamentarianName: 'Nome Parlamentar',
      parliamentarianTitle: 'Vereador(a)',
      party: 'PARTIDO',
      officeName: 'Gabinete de exemplo',
      object: 'Descrição de exemplo da despesa.',
      purpose: 'Finalidade de exemplo.',
      justification: 'Justificativa de exemplo.',
      legalGrounds: 'Fundamentação de exemplo.',
      physicalGoal: 'Meta física de exemplo.',
      beneficiaryLocation: 'Endereço de exemplo.',
      beneficiaryType: 'own_administration',
      beneficiaryName: null,
      beneficiaryCnpj: null,
      textTarget: 'art. 0º',
      textCommand: 'Comando de exemplo da emenda ao texto.',
      originalText: 'Texto original de exemplo.',
      newText: 'Nova redação de exemplo.',
      destinations: isText
        ? []
        : [
            {
              programmaticCode: '00.000.00.000.0000.0000',
              agencyCode: '00',
              agencyName: 'Órgão de exemplo',
              unitCode: '00.000',
              unitName: 'Unidade de exemplo',
              functionCode: '00',
              subfunctionCode: '000',
              programCode: '0000',
              actionCode: '0000',
              actionName: 'Ação de exemplo',
              expenseNature: '3.3.90.39',
              sourceCode: '1.5.00',
              amountCents: 10_000_000,
            },
          ],
      cancellations: isText
        ? []
        : [
            {
              programmaticCode: '00.000.00.000.0000.0001',
              agencyCode: '00',
              agencyName: 'Órgão de exemplo',
              unitCode: '00.000',
              unitName: 'Unidade de exemplo',
              functionCode: '00',
              subfunctionCode: '000',
              programCode: '0000',
              actionCode: '0001',
              actionName: 'Ação anulada de exemplo',
              expenseNature: '3.3.90.30',
              sourceCode: '1.5.00',
              amountCents: 10_000_000,
            },
          ],
      requiresCancellation: !isText,
      city: ws.settings?.signature_city || ws.organization.municipality,
      date: today,
      indicationDate: today,
      natureFormat: ws.settings?.expense_nature_format ?? 'c.g.mm.ee',
      validationOutcome: 'validated',
      validationCurrent: true,
      status: 'draft',
      isDemo: false,
    })
  }, [editing?.body, editing?.kind, previewSubtype, ws])
  const save = useMutation({
    mutationFn: async (t: Partial<DocumentTemplateRow>) => {
      const payload = { kind: t.kind ?? 'emenda_orcamentaria', name: t.name, description: t.description || null, body: t.body, status: t.status ?? 'draft', is_default: t.is_default ?? false }
      if (payload.is_default) {
        await supabase.from('document_templates').update({ is_default: false }).eq('organization_id', ws.organization.id).eq('kind', payload.kind).neq('id', t.id ?? '00000000-0000-0000-0000-000000000000')
      }
      if (t.id) return unwrap(await supabase.from('document_templates').update({ ...payload, version: (t.version ?? 1) + 1 }).eq('id', t.id))
      return unwrap(await supabase.from('document_templates').insert({ ...payload, organization_id: ws.organization.id }))
    },
    onSuccess: () => {
      toast.success('Modelo salvo.')
      setEditing(null)
      void queryClient.invalidateQueries({ queryKey: ['templates'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const loadPreset = (id: string) => {
    const preset = TEMPLATE_PRESETS.find((p) => p.id === id)
    if (!preset || !editing) return
    if (editing.body && editing.body !== preset.body && !window.confirm('Substituir o corpo atual pelo modelo pré-definido?')) return
    if (preset.textSubtype) setPreviewSubtype(preset.textSubtype)
    setEditing({
      ...editing,
      kind: preset.kind === 'text' ? 'emenda_texto' : 'emenda_orcamentaria',
      name: editing.name || preset.name,
      description: editing.description || preset.description,
      body: preset.body,
    })
  }

  if (list.error) return <ErrorState error={list.error} />
  const unknown = preview?.pendingItems.filter((p) => p.startsWith('campo desconhecido')) ?? []
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setEditing({ name: 'Formulário de emenda orçamentária', body: DEFAULT_AMENDMENT_TEMPLATE, status: 'draft', kind: 'emenda_orcamentaria' })}>
          <Plus /> Novo modelo
        </Button>
      </div>
      {list.isLoading ? (
        <LoadingRows />
      ) : (list.data ?? []).length === 0 ? (
        <EmptyState title="Nenhum modelo" description="Sem modelo próprio, as minutas usam os formulários padrão do LegisMind (orçamentária e emendas ao texto)." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {list.data!.map((t) => (
            <Card key={t.id}>
              <CardContent className="space-y-2 p-4">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">{t.name}</span>
                  <Pill tone={t.status === 'active' ? 'success' : 'neutral'}>{t.status === 'active' ? 'Ativo' : t.status === 'draft' ? 'Rascunho' : 'Arquivado'}</Pill>
                  <Pill>{templateKinds[t.kind] ?? t.kind}</Pill>
                  {t.is_default && <Pill tone="info">Padrão</Pill>}
                  <span className="text-xs text-muted-foreground">v{t.version}</span>
                </div>
                {t.description && <p className="text-sm text-muted-foreground">{t.description}</p>}
                <Button size="sm" variant="outline" onClick={() => setEditing(t)}>
                  Editar
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {editing && (
        <Dialog open onOpenChange={(v) => !v && setEditing(null)}>
          <DialogContent className="max-h-[94svh] overflow-y-auto sm:max-w-6xl">
            <DialogHeader>
              <DialogTitle>{editing.id ? 'Editar modelo' : 'Novo modelo'}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-3">
                <Field label="Carregar modelo pré-definido" htmlFor="t-preset" hint="Formulários baseados nos modelos usuais de Câmaras Municipais; ajuste os textos à norma local.">
                  <NativeSelect id="t-preset" value="" onChange={(e) => loadPreset(e.target.value)}>
                    <option value="">Selecione…</option>
                    {TEMPLATE_PRESETS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label="Nome" htmlFor="t-name" required>
                  <Input id="t-name" value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                </Field>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Tipo" htmlFor="t-kind">
                    <NativeSelect id="t-kind" value={editing.kind ?? 'emenda_orcamentaria'} onChange={(e) => setEditing({ ...editing, kind: e.target.value })}>
                      {Object.entries(templateKinds).map(([k, label]) => (
                        <option key={k} value={k}>
                          {label}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field label="Situação" htmlFor="t-status">
                    <NativeSelect id="t-status" value={editing.status ?? 'draft'} onChange={(e) => setEditing({ ...editing, status: e.target.value as DocumentTemplateRow['status'] })}>
                      <option value="draft">Rascunho</option>
                      <option value="active">Ativo</option>
                      <option value="archived">Arquivado</option>
                    </NativeSelect>
                  </Field>
                  <label className="flex items-end gap-2 pb-2 text-sm">
                    <Checkbox checked={editing.is_default ?? false} onCheckedChange={(v) => setEditing({ ...editing, is_default: v === true })} /> Modelo padrão
                  </label>
                </div>
                <Field label="Corpo do modelo" htmlFor="t-body" hint="# ou ## título centralizado · ### título à esquerda · **negrito** · _itálico_ · :::quadro TÍTULO … ::: caixa · :::recuo … ::: ementa recuada">
                  <Textarea id="t-body" rows={22} className="font-mono text-xs" value={editing.body ?? ''} onChange={(e) => setEditing({ ...editing, body: e.target.value })} />
                </Field>
                <details className="rounded-md border p-3 text-xs">
                  <summary className="cursor-pointer font-medium">Marcadores disponíveis</summary>
                  {placeholderGroups.map(([group, items]) => (
                    <div key={group} className="mt-2">
                      <p className="mb-1 font-medium text-muted-foreground">{group} {group === 'Quadros' && '(sozinhos na linha)'}</p>
                      <p className="flex flex-wrap gap-1 font-mono">
                        {items.map((p) => (
                          <code key={p} className="rounded bg-muted px-1">{`{{${p}}}`}</code>
                        ))}
                      </p>
                    </div>
                  ))}
                </details>
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-[13px] font-medium">Prévia com dados de exemplo</p>
                  {editing.kind === 'emenda_texto' && (
                    <NativeSelect aria-label="Subtipo da prévia" className="h-8 w-40" value={previewSubtype} onChange={(e) => setPreviewSubtype(e.target.value as TextSubtype)}>
                      <option value="aditiva">Aditiva</option>
                      <option value="modificativa">Modificativa</option>
                      <option value="supressiva">Supressiva</option>
                    </NativeSelect>
                  )}
                </div>
                {unknown.length > 0 && <p className="mb-2 rounded bg-amber-50 p-2 text-xs text-amber-800">{unknown.join('; ')}</p>}
                <div className="max-h-[72svh] overflow-y-auto rounded-md border bg-neutral-100 p-3 dark:bg-neutral-900">
                  {preview && <DocumentSheet document={preview} hideNotices className="px-6 py-8 sm:px-8" />}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditing(null)}>
                Cancelar
              </Button>
              <Button onClick={() => save.mutate(editing)} disabled={save.isPending || !editing.name || (editing.body?.length ?? 0) < 20}>
                {save.isPending && <Loader2 className="animate-spin" />} Salvar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

// -----------------------------------------------------------------------------
// Configurações da instituição
// -----------------------------------------------------------------------------
export function SettingsPage() {
  const ws = useRequiredWorkspace()
  const queryClient = useQueryClient()
  const settings = useQuery({
    queryKey: ['org-settings', ws.organization.id],
    queryFn: async () => unwrap<OrganizationSettingsRow>(await supabase.from('organization_settings').select('*').eq('organization_id', ws.organization.id).single()),
  })
  const [draft, setDraft] = useState<Partial<OrganizationSettingsRow>>({})
  const value = { ...settings.data, ...draft } as OrganizationSettingsRow
  const save = useMutation({
    mutationFn: async () =>
      unwrap(
        await supabase
          .from('organization_settings')
          .update({
            institution_header: value.institution_header,
            signature_city: value.signature_city?.trim() || null,
            expense_nature_format: value.expense_nature_format,
            institution_address: value.institution_address,
            amendment_number_prefix: value.amendment_number_prefix,
            require_reviewer_approval: value.require_reviewer_approval,
            ai_enabled: value.ai_enabled,
            ai_monthly_request_limit: value.ai_monthly_request_limit,
            ai_message_retention_days: value.ai_message_retention_days,
            audit_retention_days: value.audit_retention_days,
          })
          .eq('organization_id', ws.organization.id),
      ),
    onSuccess: () => {
      toast.success('Configurações salvas.')
      setDraft({})
      void queryClient.invalidateQueries({ queryKey: ['org-settings'] })
      void ws.refresh()
    },
    onError: (e: Error) => toast.error(e.message),
  })
  if (settings.error) return <ErrorState error={settings.error} />
  if (settings.isLoading) return <LoadingRows />
  return (
    <Card className="max-w-3xl">
      <CardContent className="grid gap-4 p-5">
        <Field
          label="Cabeçalho oficial dos documentos"
          htmlFor="s-header"
          hint="Uma linha por linha do cabeçalho (ex.: ESTADO DA PARAÍBA / CÂMARA MUNICIPAL DE …). Repetido no topo de todas as páginas, seguido do nome do gabinete. Use **texto** para negrito."
        >
          <Textarea id="s-header" rows={3} value={value.institution_header ?? ''} onChange={(e) => setDraft({ ...draft, institution_header: e.target.value })} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Local da assinatura" htmlFor="s-city" hint={`Vazio = "${ws.organization.municipality ?? 'Município'} - ${ws.organization.uf ?? 'UF'}"`}>
            <Input id="s-city" maxLength={120} value={value.signature_city ?? ''} onChange={(e) => setDraft({ ...draft, signature_city: e.target.value })} />
          </Field>
          <Field label="Natureza da despesa nos documentos" htmlFor="s-nature">
            <NativeSelect id="s-nature" value={value.expense_nature_format ?? 'c.g.mm.ee'} onChange={(e) => setDraft({ ...draft, expense_nature_format: e.target.value as OrganizationSettingsRow['expense_nature_format'] })}>
              <option value="c.g.mm.ee">4.4.50.42 (categoria.grupo.modalidade.elemento)</option>
              <option value="cg.mm.ee">44.50.42 (padrão de formulários municipais)</option>
            </NativeSelect>
          </Field>
        </div>
        <Field label="Endereço" htmlFor="s-address">
          <Input id="s-address" value={value.institution_address ?? ''} onChange={(e) => setDraft({ ...draft, institution_address: e.target.value })} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Prefixo da numeração de emendas" htmlFor="s-prefix" hint="Ex.: EM, EMI (somente letras maiúsculas)">
            <Input id="s-prefix" value={value.amendment_number_prefix ?? ''} maxLength={6} onChange={(e) => setDraft({ ...draft, amendment_number_prefix: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') })} />
          </Field>
          <Field label="Limite mensal de requisições de IA" htmlFor="s-ai-limit" hint="Vazio = limite do plano">
            <Input
              id="s-ai-limit"
              inputMode="numeric"
              value={value.ai_monthly_request_limit ?? ''}
              onChange={(e) => setDraft({ ...draft, ai_monthly_request_limit: e.target.value ? Number(e.target.value.replace(/\D/g, '')) : null })}
            />
          </Field>
          <Field label="Retenção de conversas de IA (dias)" htmlFor="s-ret-ai">
            <Input id="s-ret-ai" inputMode="numeric" value={value.ai_message_retention_days ?? 365} onChange={(e) => setDraft({ ...draft, ai_message_retention_days: Number(e.target.value.replace(/\D/g, '')) || 30 })} />
          </Field>
          <Field label="Retenção de auditoria (dias)" htmlFor="s-ret-audit">
            <Input id="s-ret-audit" inputMode="numeric" value={value.audit_retention_days ?? 1825} onChange={(e) => setDraft({ ...draft, audit_retention_days: Number(e.target.value.replace(/\D/g, '')) || 365 })} />
          </Field>
        </div>
        <label className="flex items-center justify-between gap-4 rounded-md border p-3 text-sm">
          <span>
            <strong>Revisão humana obrigatória</strong>
            <span className="block text-xs text-muted-foreground">Exige aprovação de revisor antes de liberar para assinatura.</span>
          </span>
          <Switch checked={value.require_reviewer_approval ?? true} onCheckedChange={(v) => setDraft({ ...draft, require_reviewer_approval: v })} />
        </label>
        <label className="flex items-center justify-between gap-4 rounded-md border p-3 text-sm">
          <span>
            <strong>Recursos de IA habilitados</strong>
            <span className="block text-xs text-muted-foreground">Desativar bloqueia o assistente e a busca em linguagem natural (validações continuam).</span>
          </span>
          <Switch checked={value.ai_enabled ?? true} onCheckedChange={(v) => setDraft({ ...draft, ai_enabled: v })} />
        </label>
        <div className="flex justify-end">
          <Button onClick={() => save.mutate()} disabled={save.isPending || Object.keys(draft).length === 0}>
            {save.isPending && <Loader2 className="animate-spin" />} Salvar
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// -----------------------------------------------------------------------------
// Consumo de IA
// -----------------------------------------------------------------------------
export function UsagePage() {
  const ws = useRequiredWorkspace()
  const usage = useQuery({
    queryKey: ['ai-usage', ws.organization.id],
    queryFn: async () => {
      const since = new Date()
      since.setMonth(since.getMonth() - 5, 1)
      const [quota, rows] = await Promise.all([
        supabase.rpc('ai_quota_status', { p_org: ws.organization.id }),
        supabase.from('ai_usage').select('feature, model, input_tokens, output_tokens, request_count, created_at').eq('organization_id', ws.organization.id).gte('created_at', since.toISOString()).limit(5000),
      ])
      return {
        quota: (quota.data as Array<{ requests_used: number; tokens_used: number; request_limit: number | null; token_limit: number | null; ai_enabled: boolean }> | null)?.[0] ?? null,
        rows: unwrap<Array<{ feature: string; model: string; input_tokens: number; output_tokens: number; request_count: number; created_at: string }>>(rows),
      }
    },
  })
  if (usage.error) return <ErrorState error={usage.error} />
  if (usage.isLoading) return <LoadingRows />
  const months = new Map<string, { requests: number; tokens: number }>()
  const features = new Map<string, { requests: number; tokens: number }>()
  for (const r of usage.data!.rows) {
    const key = r.created_at.slice(0, 7)
    const m = months.get(key) ?? { requests: 0, tokens: 0 }
    m.requests += r.request_count
    m.tokens += r.input_tokens + r.output_tokens
    months.set(key, m)
    const f = features.get(r.feature) ?? { requests: 0, tokens: 0 }
    f.requests += r.request_count
    f.tokens += r.input_tokens + r.output_tokens
    features.set(r.feature, f)
  }
  const q = usage.data!.quota
  const featureLabels: Record<string, string> = { assistant: 'Assistente', budget_nl_query: 'Busca em linguagem natural', ocr: 'OCR', embeddings: 'Embeddings', intent: 'Interpretação', document_drafting: 'Redação' }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Mês corrente</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 pt-0 text-sm">
          <p>
            Requisições: <strong className="tabular">{q?.requests_used ?? 0}</strong>
            {q?.request_limit ? ` de ${q.request_limit}` : ' (sem limite configurado)'}
          </p>
          <p>
            Tokens: <strong className="tabular">{(q?.tokens_used ?? 0).toLocaleString('pt-BR')}</strong>
            {q?.token_limit ? ` de ${Number(q.token_limit).toLocaleString('pt-BR')}` : ''}
          </p>
          <p className="text-muted-foreground">IA {q?.ai_enabled === false ? 'desativada' : 'habilitada'} para a instituição.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Por funcionalidade (6 meses)</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <ul className="space-y-1 text-sm">
            {[...features.entries()].map(([k, v]) => (
              <li key={k} className="flex justify-between">
                <span>{featureLabels[k] ?? k}</span>
                <span className="tabular text-muted-foreground">
                  {v.requests} req · {v.tokens.toLocaleString('pt-BR')} tokens
                </span>
              </li>
            ))}
            {features.size === 0 && <li className="text-muted-foreground">Sem consumo registrado.</li>}
          </ul>
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Histórico mensal</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mês</TableHead>
                <TableHead className="text-right">Requisições</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...months.entries()]
                .sort((a, b) => b[0].localeCompare(a[0]))
                .map(([m, v]) => (
                  <TableRow key={m}>
                    <TableCell>{m.split('-').reverse().join('/')}</TableCell>
                    <TableCell className="text-right tabular">{v.requests}</TableCell>
                    <TableCell className="text-right tabular">{v.tokens.toLocaleString('pt-BR')}</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

// -----------------------------------------------------------------------------
// Auditoria
// -----------------------------------------------------------------------------
export function AuditPage() {
  const ws = useRequiredWorkspace()
  const [entity, setEntity] = useState('')
  const logs = useQuery({
    queryKey: ['audit', ws.organization.id, entity],
    queryFn: async () => {
      let q = supabase.from('audit_logs').select('*').eq('organization_id', ws.organization.id).order('created_at', { ascending: false }).limit(200)
      if (entity) q = q.eq('entity_type', entity)
      const rows = unwrap<AuditLogRow[]>(await q)
      const actors = [...new Set(rows.map((r) => r.actor_id).filter((x): x is string => Boolean(x)))]
      const profiles = actors.length ? unwrap<Array<{ id: string; full_name: string | null; email: string }>>(await supabase.from('profiles').select('id, full_name, email').in('id', actors)) : []
      return rows.map((r) => ({ ...r, actor: profiles.find((p) => p.id === r.actor_id)?.full_name ?? profiles.find((p) => p.id === r.actor_id)?.email ?? (r.actor_id ? 'Usuário' : 'Sistema') }))
    },
  })
  const entities = ['amendments', 'memberships', 'offices', 'office_members', 'fiscal_years', 'legal_rules', 'documents', 'document_versions', 'document_templates', 'amendment_modalities', 'organization_settings', 'invitations', 'budget_allocations']
  return (
    <div className="space-y-4">
      <NativeSelect value={entity} onChange={(e) => setEntity(e.target.value)} className="w-64" aria-label="Entidade">
        <option value="">Todas as entidades</option>
        {entities.map((e) => (
          <option key={e} value={e}>
            {e}
          </option>
        ))}
      </NativeSelect>
      {logs.error ? (
        <ErrorState error={logs.error} />
      ) : logs.isLoading ? (
        <LoadingRows />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>Data</TableHead>
                <TableHead>Usuário</TableHead>
                <TableHead>Ação</TableHead>
                <TableHead>Entidade</TableHead>
                <TableHead className="hidden md:table-cell">Detalhes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.data!.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="text-xs whitespace-nowrap">{formatDateTime(l.created_at)}</TableCell>
                  <TableCell className="text-sm">{l.actor}</TableCell>
                  <TableCell className="font-mono text-xs">{l.action}</TableCell>
                  <TableCell className="font-mono text-xs">{l.entity_type}</TableCell>
                  <TableCell className="hidden max-w-md truncate font-mono text-[11px] text-muted-foreground md:table-cell">
                    {l.summary ?? (Object.keys(l.metadata).length ? JSON.stringify(l.metadata) : '—')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
