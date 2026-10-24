import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Clock, FileSearch, Loader2, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { OutcomeBadge, OutcomeIcon, Pill } from '@/components/common/badges'
import { EmptyState, ErrorState } from '@/components/common/states'
import { validationOutcomeLabels } from '@shared/domain/amendments/status'
import type { ValidationOutcome } from '@shared/domain/amendments/types'
import type { ValidationItemRow } from '@shared/types/db'
import { apiFetch } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { amendmentKeys, isValidationCurrent, useValidation, type AmendmentDetail } from '../hooks'

const groups: ValidationOutcome[] = ['inconsistent', 'not_verifiable', 'pending', 'validated']

function CheckItem({ item }: { item: ValidationItemRow }) {
  const evidence = Array.isArray(item.evidence) ? (item.evidence as Array<{ label?: string; value?: string; documentTitle?: string | null; page?: number | null }>) : []
  return (
    <li className="flex gap-3 p-3">
      <OutcomeIcon outcome={item.outcome} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="text-sm font-medium">{item.title}</p>
          {item.severity === 'warning' && <Pill>aviso</Pill>}
          {item.severity === 'info' && <Pill>informativo</Pill>}
          {item.requires_human_decision && <Pill tone="warning">decisão humana</Pill>}
          {item.rule_version && (
            <span className="font-mono text-[10px] text-muted-foreground">
              {item.check_code} v{item.rule_version}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">{item.message}</p>
        {item.legal_basis && <p className="mt-1 text-xs text-muted-foreground">Base: {item.legal_basis}</p>}
        {evidence.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
            {evidence.map((e, i) => (
              <li key={i} className="flex flex-wrap gap-x-1.5">
                <span>• {e.label}</span>
                {e.value && <span className="font-medium text-foreground tabular">{e.value}</span>}
                {e.documentTitle && (
                  <span>
                    ({e.documentTitle}
                    {e.page ? `, p. ${e.page}` : ''})
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  )
}

export function ValidationTab({ amendment, canValidate }: { amendment: AmendmentDetail; canValidate: boolean }) {
  const queryClient = useQueryClient()
  const validation = useValidation(amendment.id)
  const run = useMutation({
    mutationFn: () => apiFetch<{ runId: string }>(`/amendments/${amendment.id}/validate`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('Validação executada.')
      void queryClient.invalidateQueries({ queryKey: amendmentKeys.validation(amendment.id) })
      void queryClient.invalidateQueries({ queryKey: amendmentKeys.detail(amendment.id) })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const current = isValidationCurrent(amendment)
  const latest = validation.data?.latest

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <ShieldCheck className="size-8 shrink-0 text-brand" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">Validação técnica automática</p>
              <OutcomeBadge outcome={amendment.validation_outcome} stale={amendment.validation_outcome !== null && !current} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Regras determinísticas configuradas e versionadas pela instituição. O resultado fica vinculado à revisão {amendment.revision} da emenda e é registrado para
              auditoria. A revisão humana continua obrigatória.
            </p>
            {latest && (
              <p className="mt-1 text-xs text-muted-foreground">
                Última execução: {formatDateTime(latest.executed_at)} · revisão {latest.amendment_revision} · {latest.engine_version}
              </p>
            )}
          </div>
          {canValidate && (
            <Button onClick={() => run.mutate()} disabled={run.isPending}>
              {run.isPending ? <Loader2 className="animate-spin" /> : <FileSearch />}
              {current ? 'Validar novamente' : 'Executar validação'}
            </Button>
          )}
        </CardContent>
      </Card>

      {!current && amendment.validation_outcome && (
        <p className="flex items-center gap-2 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
          <Clock className="size-4" /> A emenda foi alterada depois da última validação. O relatório abaixo refere-se à revisão {amendment.validated_revision}.
        </p>
      )}

      {validation.error ? (
        <ErrorState error={validation.error} onRetry={() => validation.refetch()} />
      ) : validation.isLoading ? (
        <Skeleton className="h-64" />
      ) : !latest ? (
        <EmptyState icon={ShieldCheck} title="Nenhuma validação executada" description="Execute a validação para obter o relatório de conformidade da emenda." />
      ) : (
        <div className="space-y-4">
          {groups.map((outcome) => {
            const items = validation.data!.items.filter((i) => i.outcome === outcome)
            if (items.length === 0) return null
            return (
              <Card key={outcome} className={cn(outcome === 'validated' && 'opacity-95')}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <OutcomeIcon outcome={outcome} /> {validationOutcomeLabels[outcome]} ({items.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <ul className="divide-y rounded-md border">
                    {items.map((item) => (
                      <CheckItem key={item.id} item={item} />
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )
          })}
          {validation.data!.runs.length > 1 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Execuções anteriores</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <ul className="divide-y text-sm">
                  {validation.data!.runs.slice(1).map((r) => (
                    <li key={r.id} className="flex items-center gap-3 py-2">
                      <OutcomeBadge outcome={r.outcome} />
                      <span className="text-muted-foreground">revisão {r.amendment_revision}</span>
                      <span className="ml-auto text-xs text-muted-foreground">{formatDateTime(r.executed_at)}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
