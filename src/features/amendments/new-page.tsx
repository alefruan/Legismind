import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { PageHeader } from '@/components/common/page-header'
import { ErrorState, LoadingRows } from '@/components/common/states'
import { PageContainer } from '@/components/layout/app-shell'
import type { AmendmentModalityRow } from '@shared/types/db'
import { supabase, unwrap } from '@/lib/supabase'
import { useRequiredWorkspace } from '@/providers/workspace'
import { AmendmentFields, toAmendmentPatch, useAmendmentForm } from './details-form'
import { amendmentKeys } from './hooks'

export function useModalities(organizationId: string) {
  return useQuery({
    queryKey: ['modalities', organizationId],
    queryFn: async () =>
      unwrap<AmendmentModalityRow[]>(await supabase.from('amendment_modalities').select('*').eq('organization_id', organizationId).eq('is_active', true).order('name')),
  })
}

export function NewAmendmentPage() {
  const ws = useRequiredWorkspace()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [params] = useSearchParams()
  const modalities = useModalities(ws.organization.id)
  const form = useAmendmentForm({ modality_id: modalities.data?.[0]?.id })

  if (!ws.office) return <Navigate to="/emendas" replace />

  const onSubmit = form.handleSubmit(async (values) => {
    if (!ws.fiscalYear) {
      toast.error('Nenhum exercício orçamentário disponível.')
      return
    }
    const { data, error } = await supabase
      .from('amendments')
      .insert({ ...toAmendmentPatch(values), organization_id: ws.organization.id, office_id: ws.office!.id, fiscal_year_id: ws.fiscalYear.id })
      .select('id')
      .single()
    if (error || !data) {
      toast.error(error?.message ?? 'Não foi possível criar a emenda.')
      return
    }
    void queryClient.invalidateQueries({ queryKey: amendmentKeys.all })
    toast.success('Rascunho criado.')
    const allocation = params.get('dotacao')
    navigate(`/emendas/${data.id}?aba=programacao${allocation ? `&adicionar=${allocation}` : ''}`)
  })

  return (
    <PageContainer className="max-w-3xl">
      <PageHeader
        eyebrow={`${ws.office.name} · Exercício ${ws.fiscalYear?.year ?? '—'}`}
        title="Nova emenda"
        description="Preencha os dados básicos. Em seguida, você indicará a programação de destino e as anulações a partir dos dados orçamentários oficiais."
      />
      {modalities.error ? (
        <ErrorState error={modalities.error} onRetry={() => modalities.refetch()} />
      ) : modalities.isLoading ? (
        <LoadingRows rows={4} />
      ) : (modalities.data ?? []).length === 0 ? (
        <ErrorState error={new Error('Nenhuma modalidade de emenda configurada. Solicite à administração da instituição.')} />
      ) : (
        <Card>
          <CardContent className="p-5 sm:p-6">
            <form onSubmit={onSubmit} className="space-y-6">
              <AmendmentFields form={form} modalities={modalities.data!} />
              <div className="flex justify-end gap-2">
                <Button asChild variant="outline">
                  <Link to="/emendas">Cancelar</Link>
                </Button>
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  {form.formState.isSubmitting && <Loader2 className="animate-spin" />}
                  Criar rascunho
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </PageContainer>
  )
}
