import { Link, useParams, useSearchParams } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Eye, Loader2, Lock, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AmendmentStatusBadge, DemoBadge, OutcomeBadge } from '@/components/common/badges'
import { EmptyState, ErrorState } from '@/components/common/states'
import { PageContainer } from '@/components/layout/app-shell'
import { EDITABLE_STATUSES, type Actor } from '@shared/domain/amendments/status'
import { supabase } from '@/lib/supabase'
import { amendmentNumber, money } from '@/lib/format'
import { useRequiredWorkspace } from '@/providers/workspace'
import { AmendmentFields, toAmendmentPatch, useAmendmentForm } from '../details-form'
import { amendmentKeys, isValidationCurrent, useAmendment, type AmendmentDetail } from '../hooks'
import { useModalities } from '../new-page'
import { CommentsTab } from './comments-tab'
import { DocumentTab } from './document-tab'
import { HistoryTab } from './history-tab'
import { ProgrammingTab } from './programming-tab'
import { TransitionBar } from './transition-bar'
import { ValidationTab } from './validation-tab'

function DetailsTab({ amendment, canEdit }: { amendment: AmendmentDetail; canEdit: boolean }) {
  const queryClient = useQueryClient()
  const modalities = useModalities(amendment.organization_id)
  const form = useAmendmentForm({
    title: amendment.title,
    modality_id: amendment.modality_id,
    object: amendment.object ?? '',
    purpose: amendment.purpose ?? '',
    policy_area: amendment.policy_area ?? '',
    beneficiary_type: amendment.beneficiary_type,
    beneficiary_name: amendment.beneficiary_name ?? '',
    beneficiary_cnpj: amendment.beneficiary_cnpj ?? '',
    transfer_instrument: amendment.transfer_instrument ?? '',
    justification: amendment.justification ?? '',
    legal_grounds: amendment.legal_grounds ?? '',
    physical_goal: amendment.physical_goal ?? '',
    beneficiary_location: amendment.beneficiary_location ?? '',
    indication_date: amendment.indication_date ?? '',
    text_target: amendment.text_target ?? '',
    text_command: amendment.text_command ?? '',
    original_text: amendment.original_text ?? '',
    new_text: amendment.new_text ?? '',
  })
  const onSubmit = form.handleSubmit(async (values) => {
    const { error, data } = await supabase.from('amendments').update(toAmendmentPatch(values)).eq('id', amendment.id).select('id')
    if (error || !data?.length) {
      toast.error(error?.message ?? 'A emenda não pode ser editada no status atual.')
      return
    }
    toast.success('Alterações salvas. Execute a validação novamente.')
    void queryClient.invalidateQueries({ queryKey: amendmentKeys.detail(amendment.id) })
  })
  return (
    <Card>
      <CardContent className="p-5 sm:p-6">
        <form onSubmit={onSubmit} className="space-y-6">
          {!canEdit && (
            <p className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              <Lock className="size-4" /> Edição bloqueada: a emenda está em tramitação ou você não integra o gabinete autor.
            </p>
          )}
          <AmendmentFields form={form} modalities={modalities.data ?? [amendment.modality]} disabled={!canEdit} />
          {canEdit && (
            <div className="flex justify-end">
              <Button type="submit" disabled={form.formState.isSubmitting || !form.formState.isDirty}>
                {form.formState.isSubmitting && <Loader2 className="animate-spin" />}
                Salvar alterações
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  )
}

const tabs = ['dados', 'programacao', 'validacao', 'documento', 'historico', 'comentarios'] as const

export function AmendmentEditorPage() {
  const { id = '' } = useParams()
  const ws = useRequiredWorkspace()
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const amendment = useAmendment(id)
  const tab = (tabs as readonly string[]).includes(params.get('aba') ?? '') ? (params.get('aba') as (typeof tabs)[number]) : 'dados'

  const visibility = useMutation({
    mutationFn: async (shared: boolean) => {
      const { error } = await supabase.from('amendments').update({ visibility: shared ? 'organization' : 'office' }).eq('id', id)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: amendmentKeys.detail(id) }),
    onError: (e: Error) => toast.error(e.message),
  })

  if (amendment.error) return <PageContainer><ErrorState error={amendment.error} onRetry={() => amendment.refetch()} /></PageContainer>
  if (amendment.isLoading) {
    return (
      <PageContainer wide>
        <Skeleton className="mb-4 h-16" />
        <Skeleton className="h-96" />
      </PageContainer>
    )
  }
  const a = amendment.data
  if (!a) {
    return (
      <PageContainer>
        <EmptyState title="Emenda não encontrada" description="A emenda não existe ou você não tem permissão para acessá-la." action={<Button asChild variant="outline"><Link to="/emendas">Voltar</Link></Button>} />
      </PageContainer>
    )
  }

  const isOfficeMember = ws.offices.some((o) => o.office.id === a.office_id)
  const actors: Actor[] = [...(isOfficeMember ? (['office'] as const) : []), ...(ws.isReviewer ? (['reviewer'] as const) : []), ...(ws.isOrgAdmin ? (['admin'] as const) : [])]
  const canEdit = isOfficeMember && EDITABLE_STATUSES.includes(a.status)
  const canValidate = isOfficeMember || (ws.isReviewer && a.status !== 'draft')
  const current = isValidationCurrent(a)

  return (
    <PageContainer wide>
      <div className="mb-6 space-y-4">
        <Link to="/emendas" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Emendas
        </Link>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground">{amendmentNumber(ws.settings?.amendment_number_prefix, a.fiscal_year.year, a.sequence_number)}</span>
              <AmendmentStatusBadge status={a.status} />
              <OutcomeBadge outcome={a.validation_outcome} stale={a.validation_outcome !== null && !current} />
              {ws.organization.is_demo && <DemoBadge />}
            </div>
            <h1 className="mt-2 text-xl font-semibold tracking-tight text-balance sm:text-2xl">{a.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {a.modality.name} · {a.office.name} · Exercício {a.fiscal_year.year} · <strong className="text-foreground tabular">{money(a.total_amount)}</strong> · revisão {a.revision}
            </p>
          </div>
          <div className="flex flex-col items-start gap-3 lg:items-end">
            <TransitionBar amendment={a} actors={actors} />
            {isOfficeMember && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                {a.visibility === 'organization' ? <Users className="size-3.5" /> : <Eye className="size-3.5" />}
                Compartilhar com a instituição
                <Switch checked={a.visibility === 'organization'} disabled={!canEdit || visibility.isPending} onCheckedChange={(v) => visibility.mutate(v)} />
              </label>
            )}
          </div>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setParams((p) => { p.set('aba', v); return p }, { replace: true })}>
        <TabsList className="mb-6 w-full justify-start overflow-x-auto">
          <TabsTrigger value="dados">Dados</TabsTrigger>
          {/* Emendas ao texto não movimentam dotações (a aba volta se houver linhas a remover) */}
          {(a.modality.kind !== 'text' || Number(a.total_amount) > 0) && <TabsTrigger value="programacao">Programação</TabsTrigger>}
          <TabsTrigger value="validacao">Validação</TabsTrigger>
          <TabsTrigger value="documento">Documento</TabsTrigger>
          <TabsTrigger value="historico">Histórico</TabsTrigger>
          <TabsTrigger value="comentarios">Comentários</TabsTrigger>
        </TabsList>
        <TabsContent value="dados">
          <DetailsTab amendment={a} canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="programacao">
          <ProgrammingTab amendment={a} canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="validacao">
          <ValidationTab amendment={a} canValidate={canValidate} />
        </TabsContent>
        <TabsContent value="documento">
          <DocumentTab amendment={a} />
        </TabsContent>
        <TabsContent value="historico">
          <HistoryTab amendment={a} canSaveVersion={isOfficeMember} />
        </TabsContent>
        <TabsContent value="comentarios">
          <CommentsTab amendment={a} />
        </TabsContent>
      </Tabs>
    </PageContainer>
  )
}
