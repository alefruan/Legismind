import { z } from 'zod'
import { centsToDecimal, formatBRL, toCents } from '../../../shared/domain/money.js'
import { amendmentStatusLabels } from '../../../shared/domain/amendments/status.js'
import type { AmendmentModalityRow, AmendmentRow } from '../../../shared/types/db.js'
import { buildAmendmentDocument } from '../../amendments/document.js'
import { loadAmendmentFacts, readAmendmentAsUser, runAmendmentValidation } from '../../amendments/service.js'
import { unwrap } from '../../supabase.js'
import { defineTool, reais, requireFiscalYear, requireOffice, ToolUserError, type ToolContext } from './registry.js'

const destinationSchema = z.object({
  allocation_id: z.string().uuid().describe('Dotação existente (resultado de search_budget_allocations)'),
  amount: reais,
  notes: z.string().max(500).optional(),
})

const cancellationSchema = z.object({
  allocation_id: z.string().uuid(),
  amount: reais,
  justification: z.string().min(10).max(1000).describe('Justificativa técnica da anulação'),
})

const amendmentFields = {
  title: z.string().min(5).max(300),
  object: z.string().min(10).max(4000).describe('Objeto da emenda (descrição da despesa, sem objeto genérico; em emendas ao texto, resumo da alteração)'),
  purpose: z.string().max(4000).optional(),
  physical_goal: z.string().max(2000).optional().describe('Meta física esperada (ex.: "10 poltronas e 5 bombas de infusão") — somente se informada pelo usuário'),
  beneficiary_location: z.string().max(1000).optional().describe('Localização geográfica exata / endereço do beneficiário ou da execução — somente se informada'),
  indication_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Data da indicação (AAAA-MM-DD), se informada'),
  text_target: z.string().max(500).optional().describe('Emendas ao texto: dispositivo alcançado (ex.: inciso I do art. 8º)'),
  text_command: z.string().max(2000).optional().describe('Emendas ao texto: comando (ex.: "Acrescenta o § 2º ao inciso I do art. 8º do Projeto de Lei nº …")'),
  original_text: z.string().max(20000).optional().describe('Emendas modificativas/supressivas: texto original do dispositivo, transcrito do projeto'),
  new_text: z.string().max(20000).optional().describe('Emendas aditivas/modificativas: texto a ser acrescido ou nova redação'),
  justification: z.string().max(20000).optional().describe('Justificativa (pode ser redigida pela IA e será editável)'),
  legal_grounds: z.string().max(20000).optional().describe('Fundamentação — cite somente normas localizadas nas ferramentas'),
  policy_area: z.string().max(200).optional(),
  beneficiary_type: z.enum(['none', 'osc', 'public_entity', 'own_administration', 'other']),
  beneficiary_name: z.string().max(300).optional(),
  beneficiary_cnpj: z.string().max(20).optional().describe('Somente se informado pelo usuário'),
  transfer_instrument: z
    .enum(['termo_fomento', 'termo_colaboracao', 'acordo_cooperacao', 'convenio', 'transferencia_fundo_a_fundo', 'aplicacao_direta', 'outro'])
    .optional(),
}

function normalizeCnpj(value: string | undefined | null): string | null {
  const digits = (value ?? '').replace(/\D/g, '')
  return digits.length === 14 ? digits : null
}

async function insertChildren(
  ctx: ToolContext,
  amendment: Pick<AmendmentRow, 'id' | 'organization_id' | 'fiscal_year_id'>,
  destinations: Array<z.infer<typeof destinationSchema>> | undefined,
  cancellations: Array<z.infer<typeof cancellationSchema>> | undefined,
) {
  if (destinations?.length) {
    const { error } = await ctx.req.db.from('amendment_allocations').insert(
      destinations.map((d) => ({
        amendment_id: amendment.id,
        organization_id: amendment.organization_id,
        fiscal_year_id: amendment.fiscal_year_id,
        allocation_id: d.allocation_id,
        amount: centsToDecimal(toCents(d.amount)),
        notes: d.notes ?? null,
        origin: 'assistant',
      })),
    )
    if (error) throw new ToolUserError(`Não foi possível registrar a destinação: ${describeDbError(error)}`)
  }
  if (cancellations?.length) {
    const { error } = await ctx.req.db.from('amendment_cancellations').insert(
      cancellations.map((c) => ({
        amendment_id: amendment.id,
        organization_id: amendment.organization_id,
        fiscal_year_id: amendment.fiscal_year_id,
        allocation_id: c.allocation_id,
        amount: centsToDecimal(toCents(c.amount)),
        justification: c.justification,
        origin: 'assistant',
        approved: false,
      })),
    )
    if (error) throw new ToolUserError(`Não foi possível registrar a anulação: ${describeDbError(error)}`)
  }
}

function describeDbError(error: { code?: string; message?: string }) {
  if (error.code === '23503') return 'a dotação informada não existe neste exercício/instituição.'
  if (error.code === '42501') return 'sem permissão para editar esta emenda (verifique o status e o gabinete).'
  if (error.code === '23505') return 'a mesma dotação foi indicada mais de uma vez.'
  return error.message ?? 'erro no banco de dados.'
}

async function amendmentCard(ctx: ToolContext, id: string, created: boolean) {
  const row = await readAmendmentAsUser(ctx.req, id)
  return {
    kind: 'amendment' as const,
    amendmentId: row.id,
    title: row.title,
    status: row.status,
    totalCents: toCents(row.total_amount),
    created,
  }
}

export const createAmendmentDraft = defineTool({
  name: 'create_amendment_draft',
  label: 'Criando rascunho da emenda',
  description:
    'Cria um RASCUNHO de emenda no gabinete ativo. Emendas orçamentárias: destinações em dotações existentes e anulações compensatórias (que nascem NÃO aprovadas, pois exigem decisão humana); use somente allocation_id retornados pelas ferramentas de orçamento. Emendas ao texto (modalidade de natureza "emenda ao texto"): NÃO informe destinações nem anulações; preencha text_command e o texto original/novo conforme o subtipo. Pendências (como CNPJ ou meta física ausentes) ficam registradas e aparecem na validação.',
  schema: z.object({
    ...amendmentFields,
    modality_code: z.string().max(40).describe('Código da modalidade (get_workspace_context)'),
    destinations: z.array(destinationSchema).max(10).optional().describe('Obrigatório (ao menos 1) em emendas orçamentárias; omitir em emendas ao texto'),
    cancellations: z.array(cancellationSchema).max(10).optional(),
  }),
  async execute(ctx, input) {
    const officeId = requireOffice(ctx)
    const fiscalYearId = requireFiscalYear(ctx)
    const modality = unwrap(
      await ctx.req.db.from('amendment_modalities').select('*').eq('organization_id', ctx.organizationId).eq('code', input.modality_code).eq('is_active', true).maybeSingle(),
    ) as AmendmentModalityRow | null
    if (!modality) throw new ToolUserError(`Modalidade "${input.modality_code}" não está configurada ou ativa.`)
    const isText = modality.kind === 'text'
    if (isText && (input.destinations?.length || input.cancellations?.length)) {
      throw new ToolUserError('Emendas ao texto não movimentam dotações: remova destinações e anulações ou escolha uma modalidade orçamentária.')
    }
    if (!isText && !input.destinations?.length) throw new ToolUserError('Informe ao menos uma destinação para a emenda orçamentária.')

    const cnpj = normalizeCnpj(input.beneficiary_cnpj)
    const { data, error } = await ctx.req.db
      .from('amendments')
      .insert({
        organization_id: ctx.organizationId,
        office_id: officeId,
        fiscal_year_id: fiscalYearId,
        modality_id: modality.id,
        title: input.title,
        object: input.object,
        purpose: input.purpose ?? null,
        justification: input.justification ?? null,
        legal_grounds: input.legal_grounds ?? null,
        policy_area: input.policy_area ?? null,
        beneficiary_type: input.beneficiary_type,
        beneficiary_name: input.beneficiary_name ?? null,
        beneficiary_cnpj: cnpj,
        transfer_instrument: input.transfer_instrument ?? null,
        physical_goal: input.physical_goal ?? null,
        beneficiary_location: input.beneficiary_location ?? null,
        indication_date: input.indication_date ?? null,
        text_target: input.text_target ?? null,
        text_command: input.text_command ?? null,
        original_text: input.original_text ?? null,
        new_text: input.new_text ?? null,
        source_conversation_id: ctx.conversationId,
      })
      .select('id, organization_id, fiscal_year_id, sequence_number')
      .single()
    if (error || !data) throw new ToolUserError(`Não foi possível criar a emenda: ${describeDbError(error ?? {})}`)

    try {
      await insertChildren(ctx, data as AmendmentRow, input.destinations, input.cancellations)
    } catch (childError) {
      await ctx.req.db.from('amendments').delete().eq('id', data.id)
      throw childError
    }
    ctx.createdAmendments.push(data.id)
    const card = await amendmentCard(ctx, data.id, true)
    return {
      content: {
        amendment_id: data.id,
        numero_interno: data.sequence_number,
        status: 'Rascunho',
        valor_total: centsToDecimal(card.totalCents),
        link_editor: `/emendas/${data.id}`,
        observacoes: [
          ...(input.beneficiary_cnpj && !cnpj ? ['CNPJ informado em formato inválido: não foi gravado.'] : []),
          ...(input.cancellations?.length ? ['As anulações foram registradas como NÃO aprovadas: o gabinete precisa aprová-las explicitamente no editor.'] : []),
          'Execute validate_amendment para obter o relatório técnico.',
        ],
      },
      summary: `Rascunho criado: ${input.title} (${formatBRL(card.totalCents)})`,
      card,
    }
  },
})

export const updateAmendmentDraft = defineTool({
  name: 'update_amendment_draft',
  label: 'Ajustando a emenda',
  description:
    'Altera um rascunho (ou emenda pendente de correção) do gabinete: campos textuais, beneficiário e, se informadas, SUBSTITUI integralmente as destinações e/ou anulações. Toda alteração invalida a validação anterior.',
  schema: z.object({
    amendment_id: z.string().uuid(),
    fields: z.object(amendmentFields).partial().optional(),
    replace_destinations: z.array(destinationSchema).min(1).max(10).optional(),
    replace_cancellations: z.array(cancellationSchema).max(10).optional(),
  }),
  async execute(ctx, input) {
    const row = await readAmendmentAsUser(ctx.req, input.amendment_id)
    if (!['draft', 'needs_correction'].includes(row.status)) {
      throw new ToolUserError(`A emenda está "${amendmentStatusLabels[row.status]}" e não pode ser editada.`)
    }
    if (input.fields && Object.keys(input.fields).length) {
      const patch: Record<string, unknown> = { ...input.fields }
      if ('beneficiary_cnpj' in patch) patch.beneficiary_cnpj = normalizeCnpj(input.fields.beneficiary_cnpj)
      const { data, error } = await ctx.req.db.from('amendments').update(patch).eq('id', row.id).select('id')
      if (error || !data?.length) throw new ToolUserError(`Não foi possível atualizar: ${describeDbError(error ?? {})}`)
    }
    if (input.replace_destinations) {
      const { error } = await ctx.req.db.from('amendment_allocations').delete().eq('amendment_id', row.id)
      if (error) throw new ToolUserError(`Não foi possível substituir destinações: ${describeDbError(error)}`)
      await insertChildren(ctx, row, input.replace_destinations, undefined)
    }
    if (input.replace_cancellations) {
      const { error } = await ctx.req.db.from('amendment_cancellations').delete().eq('amendment_id', row.id)
      if (error) throw new ToolUserError(`Não foi possível substituir anulações: ${describeDbError(error)}`)
      await insertChildren(ctx, row, undefined, input.replace_cancellations)
    }
    const card = await amendmentCard(ctx, row.id, false)
    return {
      content: { amendment_id: row.id, valor_total: centsToDecimal(card.totalCents), observacao: 'Emenda atualizada. A validação anterior ficou desatualizada; execute validate_amendment novamente.' },
      summary: `Emenda atualizada (${formatBRL(card.totalCents)})`,
      card,
    }
  },
})

export const getAmendment = defineTool({
  name: 'get_amendment',
  label: 'Consultando a emenda',
  description: 'Retorna os dados atuais de uma emenda acessível ao usuário: campos, destinações, anulações (com situação de aprovação), status e situação da última validação.',
  schema: z.object({ amendment_id: z.string().uuid() }),
  async execute(ctx, input) {
    const row = await readAmendmentAsUser(ctx.req, input.amendment_id)
    const loaded = await loadAmendmentFacts(ctx.req.admin, row)
    const validationCurrent = row.last_validation_run_id !== null && row.validated_revision === row.revision
    return {
      content: {
        amendment_id: row.id,
        titulo: row.title,
        status: amendmentStatusLabels[row.status],
        modalidade: loaded.modality.name,
        objeto: row.object,
        justificativa: row.justification,
        fundamentacao: row.legal_grounds,
        beneficiario: { tipo: row.beneficiary_type, nome: row.beneficiary_name, cnpj: row.beneficiary_cnpj },
        valor_total: row.total_amount,
        destinacoes: loaded.facts.destinations.map((d) => ({
          id: d.id,
          allocation_id: d.allocation?.id ?? null,
          classificacao: d.allocation?.programmaticCode ?? 'nova programação',
          natureza: d.allocation?.expenseNature ?? null,
          fonte: d.allocation?.sourceCode ?? null,
          valor: centsToDecimal(d.amountCents),
        })),
        anulacoes: loaded.facts.cancellations.map((c) => ({
          id: c.id,
          allocation_id: c.allocation.id,
          classificacao: c.allocation.programmaticCode,
          natureza: c.allocation.expenseNature,
          valor: centsToDecimal(c.amountCents),
          aprovada: c.approved,
          justificativa: c.justification,
        })),
        validacao: row.validation_outcome
          ? { resultado: row.validation_outcome, atual: validationCurrent }
          : { resultado: null, atual: false, observacao: 'Nunca validada' },
      },
      summary: `${row.title} · ${amendmentStatusLabels[row.status]}`,
      card: await amendmentCard(ctx, row.id, false),
    }
  },
})

export const validateAmendmentTool = defineTool({
  name: 'validate_amendment',
  label: 'Executando validação técnica',
  description:
    'Executa a validação determinística da emenda com as regras ativas da instituição e grava o resultado auditável. Resultados por verificação: validated, pending, inconsistent, not_verifiable. Relate fielmente o resultado; não reinterprete regras.',
  schema: z.object({ amendment_id: z.string().uuid() }),
  async execute(ctx, input) {
    const result = await runAmendmentValidation(ctx.req, input.amendment_id)
    const r = result.report
    return {
      content: {
        resultado_geral: r.outcome,
        revisao_validada: result.revision,
        resumo: r.summary,
        verificacoes: r.checks.map((c) => ({
          codigo: c.checkCode,
          titulo: c.title,
          resultado: c.outcome,
          severidade: c.severity,
          mensagem: c.message,
          base_legal: c.legalBasis ?? null,
          exige_decisao_humana: c.requiresHumanDecision ?? false,
        })),
        observacao: 'Somente o resultado geral "validated" permite enviar à revisão para validação técnica humana.',
      },
      summary: `Validação: ${r.summary.validated} ok · ${r.summary.blockingIssues} pendência(s) bloqueante(s)`,
      card: {
        kind: 'validation',
        amendmentId: input.amendment_id,
        outcome: r.outcome,
        counts: { validated: r.summary.validated, pending: r.summary.pending, inconsistent: r.summary.inconsistent, notVerifiable: r.summary.notVerifiable },
        checks: r.checks.map((c) => ({ code: c.checkCode, title: c.title, outcome: c.outcome, severity: c.severity, message: c.message, human: c.requiresHumanDecision ?? false })),
      },
    }
  },
})

export const generateAmendmentDocument = defineTool({
  name: 'generate_amendment_document',
  label: 'Gerando a minuta',
  description:
    'Gera a minuta da emenda no modelo oficial da instituição e retorna as pendências do documento. A minuta pode ser revisada, editada e exportada em DOCX/PDF no editor.',
  schema: z.object({ amendment_id: z.string().uuid() }),
  async execute(ctx, input) {
    const built = await buildAmendmentDocument(ctx.req, input.amendment_id)
    const text = built.document.blocks
      .map((b) => {
        if (b.type === 'heading') return b.text
        if (b.type === 'paragraph') return b.runs.map((r) => r.text).join('')
        if (b.type === 'table') return b.rows.map((row) => row.join(' | ')).join('\n')
        if (b.type === 'signature') return `${b.name} — ${b.role}`
        if (b.type === 'pageHeader') return b.lines.map((l) => l.map((r) => r.text).join('')).join('\n')
        if (b.type === 'fields') return [b.title, ...b.rows.map((r) => `${r.label}: ${r.value}`)].filter(Boolean).join('\n')
        if (b.type === 'box')
          return [b.title, ...b.items.map((i) => (i.type === 'paragraph' ? i.runs.map((r) => r.text).join('') : `${i.name} — ${i.role}`))]
            .filter(Boolean)
            .join('\n')
        if (b.type === 'choice')
          return [...b.options.map((o) => `(${o.checked ? 'X' : ' '}) ${o.label}`), ...b.details.map((d) => `${d.label}: ${d.value}`)].join('\n')
        return `[AVISO] ${b.text}`
      })
      .join('\n')
    return {
      content: {
        amendment_id: input.amendment_id,
        pendencias_do_documento: built.document.pendingItems,
        marca_dagua: built.document.watermark,
        previa: text.slice(0, 2500),
        link_editor: `/emendas/${input.amendment_id}?aba=documento`,
      },
      summary: built.document.pendingItems.length ? `Minuta com ${built.document.pendingItems.length} pendência(s)` : 'Minuta gerada sem pendências',
      card: { kind: 'document', amendmentId: input.amendment_id, pending: built.document.pendingItems, watermark: built.document.watermark },
    }
  },
})
