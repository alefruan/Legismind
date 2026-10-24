import { useQuery } from '@tanstack/react-query'
import {
  ALLOCATION_VIEW_COLUMNS,
  type AmendmentAllocationRow,
  type AmendmentCancellationRow,
  type AmendmentModalityRow,
  type AmendmentRow,
  type BudgetAllocationViewRow,
  type FiscalYearRow,
  type OfficeRow,
  type ValidationItemRow,
  type ValidationRunRow,
} from '@shared/types/db'
import type { AmendmentStatus } from '@shared/domain/amendments/status'
import { supabase, unwrap } from '@/lib/supabase'

export interface AmendmentDetail extends AmendmentRow {
  office: Pick<OfficeRow, 'id' | 'name' | 'parliamentarian_name'>
  modality: AmendmentModalityRow
  fiscal_year: FiscalYearRow
}

export const amendmentKeys = {
  all: ['amendments'] as const,
  list: (orgId: string, filters: Record<string, unknown>) => ['amendments', 'list', orgId, filters] as const,
  detail: (id: string) => ['amendments', 'detail', id] as const,
  lines: (id: string) => ['amendments', 'lines', id] as const,
  validation: (id: string) => ['amendments', 'validation', id] as const,
  history: (id: string) => ['amendments', 'history', id] as const,
  comments: (id: string) => ['amendments', 'comments', id] as const,
}

export function useAmendment(id: string) {
  return useQuery({
    queryKey: amendmentKeys.detail(id),
    queryFn: async () =>
      unwrap<AmendmentDetail | null>(
        await supabase
          .from('amendments')
          .select('*, office:offices(id, name, parliamentarian_name), modality:amendment_modalities(*), fiscal_year:fiscal_years(*)')
          .eq('id', id)
          .maybeSingle(),
      ),
  })
}

export interface AmendmentLines {
  destinations: Array<AmendmentAllocationRow & { allocation: BudgetAllocationViewRow | null }>
  cancellations: Array<AmendmentCancellationRow & { allocation: BudgetAllocationViewRow | null }>
}

export function useAmendmentLines(id: string) {
  return useQuery({
    queryKey: amendmentKeys.lines(id),
    queryFn: async (): Promise<AmendmentLines> => {
      const [dest, canc] = await Promise.all([
        supabase.from('amendment_allocations').select('*').eq('amendment_id', id).order('created_at'),
        supabase.from('amendment_cancellations').select('*').eq('amendment_id', id).order('created_at'),
      ])
      const destinations = unwrap<AmendmentAllocationRow[]>(dest)
      const cancellations = unwrap<AmendmentCancellationRow[]>(canc)
      const ids = [...destinations.map((d) => d.allocation_id), ...cancellations.map((c) => c.allocation_id)].filter((x): x is string => Boolean(x))
      const allocations = ids.length
        ? unwrap<BudgetAllocationViewRow[]>(await supabase.from('budget_allocations_view').select(ALLOCATION_VIEW_COLUMNS).in('id', [...new Set(ids)]))
        : []
      const byId = new Map(allocations.map((a) => [a.id, a]))
      return {
        destinations: destinations.map((d) => ({ ...d, allocation: d.allocation_id ? byId.get(d.allocation_id) ?? null : null })),
        cancellations: cancellations.map((c) => ({ ...c, allocation: byId.get(c.allocation_id) ?? null })),
      }
    },
  })
}

export function useValidation(id: string) {
  return useQuery({
    queryKey: amendmentKeys.validation(id),
    queryFn: async () => {
      const runs = unwrap<ValidationRunRow[]>(
        await supabase.from('amendment_validation_runs').select('id, amendment_id, organization_id, amendment_revision, outcome, engine_version, summary, executed_by, executed_at').eq('amendment_id', id).order('executed_at', { ascending: false }).limit(20),
      )
      const latest = runs[0]
      const items = latest
        ? unwrap<ValidationItemRow[]>(await supabase.from('amendment_validations').select('*').eq('run_id', latest.id).order('position'))
        : []
      return { runs, latest: latest ?? null, items }
    },
  })
}

export interface AmendmentListItem {
  id: string
  title: string
  sequence_number: number | null
  status: AmendmentStatus
  total_amount: string
  revision: number
  validated_revision: number | null
  validation_outcome: AmendmentRow['validation_outcome']
  visibility: 'office' | 'organization'
  updated_at: string
  office_id: string
  office: { name: string } | null
  modality: { name: string } | null
  fiscal_year: { year: number } | null
}

export function isValidationCurrent(a: Pick<AmendmentRow, 'last_validation_run_id' | 'validated_revision' | 'revision'>) {
  return a.last_validation_run_id !== null && a.validated_revision === a.revision
}
