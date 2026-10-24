import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field, NativeSelect } from '@/components/common/form'
import { beneficiaryTypeLabels, transferInstrumentLabels } from '@shared/domain/labels'
import { isValidCnpj } from '@shared/domain/budget/codes'
import type { AmendmentModalityRow } from '@shared/types/db'

export const amendmentFormSchema = z
  .object({
    title: z.string().trim().min(5, 'Informe um título com ao menos 5 caracteres.').max(300),
    modality_id: z.string().uuid('Selecione a modalidade.'),
    object: z.string().trim().max(4000).optional(),
    purpose: z.string().trim().max(4000).optional(),
    policy_area: z.string().trim().max(200).optional(),
    beneficiary_type: z.enum(['none', 'osc', 'public_entity', 'own_administration', 'other']),
    beneficiary_name: z.string().trim().max(300).optional(),
    beneficiary_cnpj: z.string().trim().optional(),
    transfer_instrument: z.string().optional(),
    justification: z.string().trim().max(20000).optional(),
    legal_grounds: z.string().trim().max(20000).optional(),
    physical_goal: z.string().trim().max(2000).optional(),
    beneficiary_location: z.string().trim().max(1000).optional(),
    indication_date: z.string().optional(),
    text_target: z.string().trim().max(500).optional(),
    text_command: z.string().trim().max(2000).optional(),
    original_text: z.string().trim().max(20000).optional(),
    new_text: z.string().trim().max(20000).optional(),
  })
  .refine((v) => !v.beneficiary_cnpj || v.beneficiary_cnpj.replace(/\D/g, '').length === 14, {
    message: 'O CNPJ deve ter 14 dígitos.',
    path: ['beneficiary_cnpj'],
  })

export type AmendmentFormValues = z.infer<typeof amendmentFormSchema>

export function toAmendmentPatch(values: AmendmentFormValues) {
  const empty = (v?: string) => (v && v.trim() ? v.trim() : null)
  return {
    title: values.title.trim(),
    modality_id: values.modality_id,
    object: empty(values.object),
    purpose: empty(values.purpose),
    policy_area: empty(values.policy_area),
    beneficiary_type: values.beneficiary_type,
    beneficiary_name: empty(values.beneficiary_name),
    beneficiary_cnpj: values.beneficiary_cnpj ? values.beneficiary_cnpj.replace(/\D/g, '') || null : null,
    transfer_instrument: empty(values.transfer_instrument),
    justification: empty(values.justification),
    legal_grounds: empty(values.legal_grounds),
    physical_goal: empty(values.physical_goal),
    beneficiary_location: empty(values.beneficiary_location),
    indication_date: empty(values.indication_date),
    text_target: empty(values.text_target),
    text_command: empty(values.text_command),
    original_text: empty(values.original_text),
    new_text: empty(values.new_text),
  }
}

export function useAmendmentForm(defaults: Partial<AmendmentFormValues>) {
  const form = useForm<AmendmentFormValues>({
    resolver: zodResolver(amendmentFormSchema),
    defaultValues: { beneficiary_type: 'none', ...defaults },
  })
  const { reset } = form
  const serialized = JSON.stringify(defaults)
  useEffect(() => {
    reset({ beneficiary_type: 'none', ...(JSON.parse(serialized) as Partial<AmendmentFormValues>) })
  }, [serialized, reset])
  return form
}

export function AmendmentFields({
  form,
  modalities,
  disabled,
}: {
  form: ReturnType<typeof useAmendmentForm>
  modalities: AmendmentModalityRow[]
  disabled?: boolean
}) {
  const { register, formState, watch } = form
  const errors = formState.errors
  const beneficiaryType = watch('beneficiary_type')
  const cnpj = watch('beneficiary_cnpj')
  const modality = modalities.find((m) => m.id === watch('modality_id'))
  const isText = modality?.kind === 'text'
  const subtype = modality?.text_subtype
  return (
    <fieldset disabled={disabled} className="grid gap-4 disabled:opacity-80">
      <Field label="Título" htmlFor="title" error={errors.title?.message} required>
        <Input id="title" {...register('title')} placeholder="Ex.: Apoio a projeto esportivo para crianças e adolescentes" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Modalidade" htmlFor="modality_id" error={errors.modality_id?.message} required>
          <NativeSelect id="modality_id" {...register('modality_id')}>
            <option value="">Selecione…</option>
            {modalities.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Área da política pública" htmlFor="policy_area">
          <Input id="policy_area" {...register('policy_area')} placeholder="Ex.: Desporto e lazer" />
        </Field>
      </div>
      {isText ? (
        <div className="grid gap-4 rounded-md border bg-muted/30 p-3">
          <p className="text-[13px] font-medium">Emenda ao texto — {subtype === 'modificativa' ? 'modificativa' : subtype === 'supressiva' ? 'supressiva' : 'aditiva'}</p>
          <div className="grid gap-4 sm:grid-cols-[14rem_1fr]">
            <Field label="Dispositivo alcançado" htmlFor="text_target" hint="Ex.: inciso I do art. 8º">
              <Input id="text_target" {...register('text_target')} />
            </Field>
            <Field label="Comando da emenda" htmlFor="text_command" hint="Ex.: Acrescenta o § 2º ao inciso I do art. 8º do Projeto de Lei nº …">
              <Textarea id="text_command" rows={2} {...register('text_command')} />
            </Field>
          </div>
          {(subtype === 'modificativa' || subtype === 'supressiva') && (
            <Field label={subtype === 'supressiva' ? 'Texto a ser suprimido' : 'Texto a ser modificado (original)'} htmlFor="original_text">
              <Textarea id="original_text" rows={4} {...register('original_text')} />
            </Field>
          )}
          {subtype !== 'supressiva' && (
            <Field label={subtype === 'modificativa' ? 'Texto modificado (nova redação)' : 'Texto a ser acrescido'} htmlFor="new_text">
              <Textarea id="new_text" rows={4} {...register('new_text')} />
            </Field>
          )}
        </div>
      ) : (
        <>
          <Field label="Objeto (descrição da despesa)" htmlFor="object" hint="O que será realizado com os recursos, sem objeto genérico.">
            <Textarea id="object" rows={3} {...register('object')} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Meta física esperada" htmlFor="physical_goal" hint="Ex.: 10 poltronas e 5 bombas de infusão">
              <Textarea id="physical_goal" rows={2} {...register('physical_goal')} />
            </Field>
            <Field label="Finalidade" htmlFor="purpose">
              <Textarea id="purpose" rows={2} {...register('purpose')} />
            </Field>
          </div>
        </>
      )}
      <Field label="Data da indicação" htmlFor="indication_date" hint="Vazio = data de geração da minuta." className="sm:max-w-56">
        <Input id="indication_date" type="date" {...register('indication_date')} />
      </Field>
      <div className={isText ? 'hidden' : 'grid gap-4 sm:grid-cols-2'}>
        <Field label="Beneficiário" htmlFor="beneficiary_type">
          <NativeSelect id="beneficiary_type" {...register('beneficiary_type')}>
            {Object.entries(beneficiaryTypeLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Instrumento de transferência" htmlFor="transfer_instrument">
          <NativeSelect id="transfer_instrument" {...register('transfer_instrument')}>
            <option value="">Não informado</option>
            {Object.entries(transferInstrumentLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      {!isText && beneficiaryType !== 'none' && beneficiaryType !== 'own_administration' && (
        <div className="grid gap-4 sm:grid-cols-[1fr_14rem]">
          <Field label="Nome do beneficiário" htmlFor="beneficiary_name">
            <Input id="beneficiary_name" {...register('beneficiary_name')} />
          </Field>
          <Field
            label="CNPJ"
            htmlFor="beneficiary_cnpj"
            error={errors.beneficiary_cnpj?.message}
            hint={cnpj && cnpj.replace(/\D/g, '').length === 14 && !isValidCnpj(cnpj) ? 'Atenção: dígitos verificadores inválidos.' : undefined}
          >
            <Input id="beneficiary_cnpj" {...register('beneficiary_cnpj')} inputMode="numeric" placeholder="00.000.000/0000-00" />
          </Field>
        </div>
      )}
      {!isText && beneficiaryType !== 'none' && (
        <Field label="Localização geográfica exata / endereço" htmlFor="beneficiary_location">
          <Input id="beneficiary_location" {...register('beneficiary_location')} />
        </Field>
      )}
      <Field label={isText ? 'Justificativa' : 'Justificativa e interesse público'} htmlFor="justification">
        <Textarea id="justification" rows={6} {...register('justification')} />
      </Field>
      <Field label="Fundamentação" htmlFor="legal_grounds" hint="Cite somente normas verificadas na Base Legislativa.">
        <Textarea id="legal_grounds" rows={4} {...register('legal_grounds')} />
      </Field>
    </fieldset>
  )
}
