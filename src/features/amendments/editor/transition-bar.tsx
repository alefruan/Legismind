import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2, MoreHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Field } from '@/components/common/form'
import { availableTransitions, type Actor, type AmendmentStatus, type TransitionSpec } from '@shared/domain/amendments/status'
import { supabase } from '@/lib/supabase'
import { amendmentKeys, isValidationCurrent, type AmendmentDetail } from '../hooks'

export function TransitionBar({ amendment, actors }: { amendment: AmendmentDetail; actors: Actor[] }) {
  const queryClient = useQueryClient()
  const [dialog, setDialog] = useState<(TransitionSpec & { blockedReason: string | null }) | null>(null)
  const [reason, setReason] = useState('')
  const [protocolNumber, setProtocolNumber] = useState('')
  const [protocolDate, setProtocolDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [busy, setBusy] = useState(false)

  const options = availableTransitions({
    status: amendment.status,
    actors,
    validationCurrent: isValidationCurrent(amendment),
    validationOutcome: amendment.validation_outcome,
    hasProtocol: Boolean(amendment.protocol_number),
  })
  if (options.length === 0) return null

  const run = async (to: AmendmentStatus) => {
    setBusy(true)
    const { error } = await supabase.rpc('transition_amendment_status', {
      p_amendment: amendment.id,
      p_to: to,
      p_reason: reason.trim() || null,
      p_protocol_number: to === 'filed' ? protocolNumber.trim() : null,
      p_protocol_date: to === 'filed' ? protocolDate : null,
    })
    setBusy(false)
    if (error) {
      toast.error(error.message)
      return
    }
    toast.success('Tramitação registrada.')
    setDialog(null)
    setReason('')
    void queryClient.invalidateQueries({ queryKey: amendmentKeys.all })
  }

  const primary = options.filter((o) => o.tone !== 'secondary')
  const secondary = options.filter((o) => o.tone === 'secondary')

  const trigger = (option: (typeof options)[number]) => {
    if (option.requiresReason || option.requiresProtocol || option.to === 'technically_validated' || option.to === 'archived') setDialog(option)
    else void run(option.to)
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {primary.map((option) => {
          const button = (
            <Button key={option.to} size="sm" disabled={busy || Boolean(option.blockedReason)} onClick={() => trigger(option)}>
              {busy && <Loader2 className="animate-spin" />}
              {option.label}
            </Button>
          )
          return option.blockedReason ? (
            <Tooltip key={option.to}>
              <TooltipTrigger asChild>
                <span tabIndex={0}>{button}</span>
              </TooltipTrigger>
              <TooltipContent className="max-w-64">{option.blockedReason}</TooltipContent>
            </Tooltip>
          ) : (
            button
          )
        })}
        {secondary.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-sm" variant="outline" aria-label="Mais ações de tramitação">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {secondary.map((option) => (
                <DropdownMenuItem key={option.to} disabled={Boolean(option.blockedReason)} onSelect={() => trigger(option)}>
                  {option.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <Dialog open={Boolean(dialog)} onOpenChange={(open) => !open && !busy && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog?.label}</DialogTitle>
            <DialogDescription>
              {dialog?.to === 'filed' && 'Registre o número e a data do protocolo oficial realizado no sistema da Casa. O LegisMind não protocola documentos.'}
              {dialog?.to === 'technically_validated' && 'Ao validar, você atesta a conferência técnica humana desta revisão da emenda, além da validação automática aprovada.'}
              {dialog?.to === 'needs_correction' && 'Descreva as correções necessárias. O gabinete poderá editar a emenda novamente.'}
              {dialog?.to === 'archived' && 'A emenda deixará de contar nos limites e compromissos de anulação.'}
            </DialogDescription>
          </DialogHeader>
          {dialog?.requiresProtocol && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Número do protocolo" htmlFor="protocol-number" required>
                <Input id="protocol-number" value={protocolNumber} onChange={(e) => setProtocolNumber(e.target.value)} />
              </Field>
              <Field label="Data do protocolo" htmlFor="protocol-date" required>
                <Input id="protocol-date" type="date" value={protocolDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setProtocolDate(e.target.value)} />
              </Field>
            </div>
          )}
          {(dialog?.requiresReason || dialog?.to === 'technically_validated' || dialog?.to === 'archived') && (
            <Field label={dialog?.requiresReason ? 'Motivo' : 'Observações (opcional)'} htmlFor="transition-reason" required={dialog?.requiresReason}>
              <Textarea id="transition-reason" rows={4} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)} disabled={busy}>
              Cancelar
            </Button>
            <Button
              onClick={() => dialog && void run(dialog.to)}
              disabled={busy || (dialog?.requiresReason && reason.trim().length < 5) || (dialog?.requiresProtocol && !protocolNumber.trim())}
            >
              {busy && <Loader2 className="animate-spin" />}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
