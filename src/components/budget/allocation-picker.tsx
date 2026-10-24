import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { DemoBadge, VerificationBadge } from '@/components/common/badges'
import { Field } from '@/components/common/form'
import { EmptyState } from '@/components/common/states'
import type { BudgetAllocationViewRow } from '@shared/types/db'
import { supabase, unwrap } from '@/lib/supabase'
import { money, parseMoneyInput } from '@/lib/format'
import { cn } from '@/lib/utils'

type SearchRow = Pick<
  BudgetAllocationViewRow,
  'id' | 'programmatic_code' | 'expense_nature' | 'source_code' | 'source_name' | 'action_name' | 'program_name' | 'authorized_amount' | 'available_amount' | 'verification_status' | 'is_demo' | 'function_code' | 'subfunction_code'
>

/**
 * Seleção de dotação existente (dados estruturados) com valor. Usado para
 * destinações e anulações — nunca permite digitar códigos livremente.
 */
export function AllocationPicker({
  open,
  onOpenChange,
  fiscalYearId,
  title,
  description,
  defaultQuery = '',
  defaultAmount,
  requireJustification = false,
  initialAllocationId,
  onConfirm,
}: {
  initialAllocationId?: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  fiscalYearId: string
  title: string
  description?: string
  defaultQuery?: string
  defaultAmount?: string
  requireJustification?: boolean
  onConfirm: (value: { allocation: SearchRow; amount: number; justification: string }) => Promise<void>
}) {
  const [query, setQuery] = useState(defaultQuery)
  const [submitted, setSubmitted] = useState(defaultQuery)
  const [selected, setSelected] = useState<SearchRow | null>(null)
  const [amount, setAmount] = useState(defaultAmount ?? '')
  const [justification, setJustification] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const results = useQuery({
    queryKey: ['allocation-picker', fiscalYearId, submitted],
    enabled: open,
    queryFn: async () =>
      unwrap<SearchRow[]>(
        await supabase.rpc('search_budget_allocations', { p_fiscal_year_id: fiscalYearId, p_query: submitted || null, p_limit: 30 }),
      ),
  })

  // Dotação pré-selecionada (ex.: "Usar em emenda" no Explorador Orçamentário)
  const initial = useQuery({
    queryKey: ['allocation-picker-initial', initialAllocationId],
    enabled: open && Boolean(initialAllocationId),
    queryFn: async () =>
      unwrap<SearchRow | null>(
        await supabase
          .from('budget_allocations_view')
          .select('id, programmatic_code, expense_nature, source_code, source_name, action_name, program_name, authorized_amount, available_amount, verification_status, is_demo, function_code, subfunction_code')
          .eq('id', initialAllocationId!)
          .eq('fiscal_year_id', fiscalYearId)
          .maybeSingle(),
      ),
  })
  useEffect(() => {
    if (initial.data) setSelected((current) => current ?? initial.data)
  }, [initial.data])
  const rows = [...(initial.data && !(results.data ?? []).some((r) => r.id === initial.data!.id) ? [initial.data] : []), ...(results.data ?? [])]

  const confirm = async () => {
    setError(null)
    if (!selected) return setError('Selecione uma dotação.')
    const cents = parseMoneyInput(amount)
    if (!cents || cents <= 0) return setError('Informe um valor válido (ex.: 150.000,00 ou 150 mil).')
    if (requireJustification && justification.trim().length < 10) return setError('Registre a justificativa da anulação (mínimo de 10 caracteres).')
    setSaving(true)
    try {
      await onConfirm({ allocation: selected, amount: cents / 100, justification: justification.trim() })
      onOpenChange(false)
      setSelected(null)
      setJustification('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível salvar.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90svh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            setSubmitted(query)
          }}
        >
          <div className="relative flex-1">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Busque por ação, programa, órgão ou código (ex.: esporte, 27.812, 3.3.50.41)" className="pl-9" />
          </div>
          <Button type="submit" variant="secondary">
            Buscar
          </Button>
        </form>
        <div className="min-h-0 flex-1 overflow-y-auto rounded-md border">
          {results.isLoading ? (
            <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" /> Consultando dotações…
            </div>
          ) : rows.length === 0 ? (
            <EmptyState className="m-3 border-0" title="Nenhuma dotação encontrada" description="Tente outros termos. Somente dotações existentes nos dados estruturados podem ser utilizadas." />
          ) : (
            <ul className="divide-y" role="listbox" aria-label="Dotações">
              {rows.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected?.id === row.id}
                    onClick={() => setSelected(row)}
                    className={cn('flex w-full flex-col gap-1 px-3 py-2.5 text-left hover:bg-accent sm:flex-row sm:items-center sm:gap-3', selected?.id === row.id && 'bg-brand-soft')}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap gap-x-2 font-mono text-xs">
                        <span>{row.programmatic_code}</span>
                        <span className="text-muted-foreground">{row.expense_nature}</span>
                        <span className="text-muted-foreground">Fonte {row.source_code}</span>
                      </div>
                      <p className="truncate text-[13px]">{row.action_name}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-[13px] font-medium tabular">{money(row.authorized_amount)}</span>
                      <VerificationBadge status={row.verification_status} />
                      {row.is_demo && <DemoBadge />}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
          <Field label="Valor (R$)" htmlFor="picker-amount" required>
            <Input id="picker-amount" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="150.000,00" inputMode="decimal" />
          </Field>
          {requireJustification && (
            <Field label="Justificativa da anulação" htmlFor="picker-just" required>
              <Input id="picker-just" value={justification} onChange={(e) => setJustification(e.target.value)} placeholder="Motivo técnico da anulação" />
            </Field>
          )}
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={confirm} disabled={saving || !selected}>
            {saving && <Loader2 className="animate-spin" />}
            Adicionar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
