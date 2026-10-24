import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { FiscalYearRow, MemberRole, MembershipRow, OfficeRow, OfficeRole, OrganizationRow, OrganizationSettingsRow } from '@shared/types/db'
import { supabase, unwrap } from '@/lib/supabase'
import { useAuth } from './auth'

export interface MembershipWithOrg extends MembershipRow {
  organization: OrganizationRow
}

export interface OfficeAssignment {
  office_role: OfficeRole
  office: OfficeRow
}

interface Selection {
  organizationId: string | null
  officeId: string | null
  fiscalYearId: string | null
}

interface WorkspaceContextValue {
  loading: boolean
  memberships: MembershipWithOrg[]
  isPlatformAdmin: boolean
  organization: OrganizationRow | null
  settings: OrganizationSettingsRow | null
  role: MemberRole | null
  offices: OfficeAssignment[]
  office: OfficeRow | null
  officeRole: OfficeRole | null
  fiscalYears: FiscalYearRow[]
  fiscalYear: FiscalYearRow | null
  isOrgAdmin: boolean
  isReviewer: boolean
  setOrganization: (id: string) => void
  setOffice: (id: string | null) => void
  setFiscalYear: (id: string) => void
  refresh: () => Promise<void>
}

const STORAGE_KEY = 'legismind.workspace'
const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

function readSelection(): Selection {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { organizationId: null, officeId: null, fiscalYearId: null, ...(JSON.parse(raw) as Partial<Selection>) }
  } catch {
    // armazenamento indisponível
  }
  return { organizationId: null, officeId: null, fiscalYearId: null }
}

function writeSelection(selection: Selection) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selection))
  } catch {
    // armazenamento indisponível
  }
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user, profile } = useAuth()
  const queryClient = useQueryClient()
  const [selection, setSelection] = useState<Selection>(readSelection)

  const base = useQuery({
    queryKey: ['workspace', user?.id],
    enabled: Boolean(user),
    staleTime: 60_000,
    queryFn: async () => {
      const [memberships, platform] = await Promise.all([
        supabase.from('memberships').select('*, organization:organizations(*)').eq('user_id', user!.id).eq('status', 'active'),
        supabase.rpc('is_platform_admin'),
      ])
      return {
        memberships: unwrap<MembershipWithOrg[]>(memberships).filter((m) => m.organization && ['trial', 'active'].includes(m.organization.status)),
        isPlatformAdmin: platform.data === true,
      }
    },
  })

  const memberships = base.data?.memberships ?? []
  const organizationId =
    memberships.find((m) => m.organization_id === selection.organizationId)?.organization_id ??
    memberships.find((m) => m.organization_id === profile?.last_organization_id)?.organization_id ??
    memberships[0]?.organization_id ??
    null

  const orgData = useQuery({
    queryKey: ['workspace-org', user?.id, organizationId],
    enabled: Boolean(user && organizationId),
    staleTime: 60_000,
    queryFn: async () => {
      const [offices, fiscalYears, settings] = await Promise.all([
        supabase.from('office_members').select('office_role, office:offices(*)').eq('user_id', user!.id).eq('organization_id', organizationId!),
        supabase.from('fiscal_years').select('*').eq('organization_id', organizationId!).order('year', { ascending: false }),
        supabase.from('organization_settings').select('*').eq('organization_id', organizationId!).maybeSingle(),
      ])
      return {
        offices: unwrap<OfficeAssignment[]>(offices).filter((o) => o.office),
        fiscalYears: unwrap<FiscalYearRow[]>(fiscalYears),
        settings: unwrap<OrganizationSettingsRow | null>(settings),
      }
    },
  })

  const offices = orgData.data?.offices ?? []
  const fiscalYears = orgData.data?.fiscalYears ?? []
  const officeAssignment =
    offices.find((o) => o.office.id === selection.officeId) ??
    offices.find((o) => o.office.id === profile?.last_office_id) ??
    offices[0] ??
    null
  const fiscalYear = fiscalYears.find((f) => f.id === selection.fiscalYearId) ?? fiscalYears.find((f) => f.is_active) ?? fiscalYears[0] ?? null
  const membership = memberships.find((m) => m.organization_id === organizationId) ?? null

  // Persiste a última instituição/gabinete no perfil (retomada em outro dispositivo).
  useEffect(() => {
    if (!user || !organizationId) return
    if (profile && profile.last_organization_id === organizationId && profile.last_office_id === (officeAssignment?.office.id ?? null)) return
    void supabase
      .from('profiles')
      .update({ last_organization_id: organizationId, last_office_id: officeAssignment?.office.id ?? null })
      .eq('id', user.id)
  }, [user, organizationId, officeAssignment?.office.id, profile])

  const update = useCallback((patch: Partial<Selection>) => {
    setSelection((current) => {
      const next = { ...current, ...patch }
      writeSelection(next)
      return next
    })
  }, [])

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      loading: base.isLoading || (Boolean(organizationId) && orgData.isLoading),
      memberships,
      isPlatformAdmin: base.data?.isPlatformAdmin ?? false,
      organization: membership?.organization ?? null,
      settings: orgData.data?.settings ?? null,
      role: membership?.role ?? null,
      offices,
      office: officeAssignment?.office ?? null,
      officeRole: officeAssignment?.office_role ?? null,
      fiscalYears,
      fiscalYear,
      isOrgAdmin: membership?.role === 'org_admin',
      isReviewer: membership?.role === 'reviewer',
      setOrganization: (id) => {
        update({ organizationId: id, officeId: null, fiscalYearId: null })
        void queryClient.invalidateQueries()
      },
      setOffice: (id) => update({ officeId: id }),
      setFiscalYear: (id) => update({ fiscalYearId: id }),
      refresh: async () => {
        await queryClient.invalidateQueries({ queryKey: ['workspace'] })
        await queryClient.invalidateQueries({ queryKey: ['workspace-org'] })
      },
    }),
    [base.isLoading, base.data, organizationId, orgData.isLoading, orgData.data, memberships, membership, offices, officeAssignment, fiscalYears, fiscalYear, update, queryClient],
  )

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error('useWorkspace deve ser usado dentro de WorkspaceProvider')
  return ctx
}

/** Atalho para páginas que exigem instituição selecionada. */
export function useRequiredWorkspace() {
  const ws = useWorkspace()
  if (!ws.organization) throw new Error('Nenhuma instituição selecionada')
  return { ...ws, organization: ws.organization }
}
