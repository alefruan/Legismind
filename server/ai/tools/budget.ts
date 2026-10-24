import { z } from 'zod'
import { validateAmendment } from '../../../shared/domain/amendments/engine.js'
import type { AmendmentFacts } from '../../../shared/domain/amendments/types.js'
import { centsToDecimal, formatBRL, toCents } from '../../../shared/domain/money.js'
import { ALLOCATION_VIEW_COLUMNS, type BudgetAllocationViewRow } from '../../../shared/types/db.js'
import type { AllocationCardItem } from '../../../shared/types/assistant.js'
import { findCancellationCandidates } from '../../amendments/candidates.js'
import { loadActiveRules, loadCatalog, todayInBrazil } from '../../amendments/service.js'
import { summarizeAllocation, toAllocationFacts } from '../../budget/mappers.js'
import { unwrap } from '../../supabase.js'
import { defineTool, reais, requireFiscalYear, ToolUserError } from './registry.js'

const codes2 = z.array(z.string().regex(/^\d{2}$/)).max(10)
const codes3 = z.array(z.string().regex(/^\d{3}$/)).max(10)

function card(row: { id: string; programmatic_code: string; action_name: string; expense_nature: string; source_code: string; authorized_amount: string; verification_status: AllocationCardItem['verification']; is_demo: boolean; source_document_title?: string | null; source_page?: number | null }): AllocationCardItem {
  return {
    id: row.id,
    code: row.programmatic_code,
    action: row.action_name,
    nature: row.expense_nature,
    source: row.source_code,
    amount: row.authorized_amount,
    verification: row.verification_status,
    isDemo: row.is_demo,
    document: row.source_document_title ?? null,
    page: row.source_page ?? null,
  }
}

export const searchBudgetAllocations = defineTool({
  name: 'search_budget_allocations',
  label: 'Consultando dotações orçamentárias',
  description:
    'Pesquisa dotações do exercício ativo nos dados estruturados da LOA/PLOA (consulta determinística com filtros e relevância textual). Combine termos de busca com códigos de função (2 dígitos), subfunção (3 dígitos), modalidade de aplicação (2 dígitos, ex.: 50 = instituições privadas sem fins lucrativos) e grupo de natureza (1 dígito). Retorna somente dados existentes — nunca há dotações fora deste resultado.',
  schema: z.object({
    query: z.string().max(200).optional().describe('Termos de busca, ex.: "esporte crianças organizações sociedade civil"'),
    function_codes: codes2.optional(),
    subfunction_codes: codes3.optional(),
    modality_codes: codes2.optional(),
    group_codes: z.array(z.string().regex(/^\d$/)).max(6).optional(),
    source_codes: z.array(z.string().max(20)).max(10).optional(),
    min_amount: z.number().nonnegative().optional().describe('Valor autorizado mínimo, em reais'),
    only_confirmed: z.boolean().optional().describe('Somente dotações conferidas por humano'),
    limit: z.number().int().min(1).max(25).optional(),
  }),
  async execute(ctx, input) {
    const fiscalYearId = requireFiscalYear(ctx)
    const rows = unwrap(
      await ctx.req.db.rpc('search_budget_allocations', {
        p_fiscal_year_id: fiscalYearId,
        p_query: input.query ?? null,
        p_function_codes: input.function_codes?.length ? input.function_codes : null,
        p_subfunction_codes: input.subfunction_codes?.length ? input.subfunction_codes : null,
        p_modality_codes: input.modality_codes?.length ? input.modality_codes : null,
        p_group_codes: input.group_codes?.length ? input.group_codes : null,
        p_source_codes: input.source_codes?.length ? input.source_codes : null,
        p_min_amount: input.min_amount ?? null,
        p_only_confirmed: input.only_confirmed ?? false,
        p_limit: input.limit ?? 12,
      }),
    ) as Array<BudgetAllocationViewRow & { relevance: number }>

    if (rows.length === 0) {
      return {
        content: {
          resultado: [],
          observacao: 'Nenhuma dotação encontrada com estes critérios no exercício ativo. Tente termos mais amplos ou remova filtros; se a base estiver vazia, informe que a LOA/PLOA precisa ser importada.',
        },
        summary: 'Nenhuma dotação encontrada',
        card: { kind: 'allocations', items: [], total: 0 },
      }
    }
    return {
      content: {
        exercicio: ctx.fiscalYear,
        total: rows.length,
        dotacoes: rows.map((r) => ({
          allocation_id: r.id,
          classificacao: r.programmatic_code,
          funcao: `${r.function_code} ${r.function_name ?? ''}`.trim(),
          subfuncao: `${r.subfunction_code} ${r.subfunction_name ?? ''}`.trim(),
          programa: `${r.program_code} ${r.program_name}`,
          acao: `${r.action_code} ${r.action_name}`,
          natureza: r.expense_nature,
          elemento: r.element_name,
          modalidade: r.modality_name,
          fonte: `${r.source_code} ${r.source_name}${r.source_is_earmarked ? ' (vinculada)' : ''}`,
          valor_autorizado: r.authorized_amount,
          situacao_conferencia: r.verification_status,
          origem: r.source_document_title ? `${r.source_document_title}${r.source_page ? `, p. ${r.source_page}` : ''}` : null,
          dados_ficticios: r.is_demo,
        })),
      },
      summary: `${rows.length} dotação(ões) encontrada(s)`,
      card: { kind: 'allocations', items: rows.map((r) => card(r)), total: rows.length },
    }
  },
})

export const getBudgetAllocation = defineTool({
  name: 'get_budget_allocation',
  label: 'Detalhando dotação',
  description:
    'Retorna a classificação orçamentária completa de uma dotação (órgão, unidade, função, subfunção, programa, ação, natureza, modalidade, elemento, fonte), valores, saldo oficial quando informado, origem documental e compromissos de outras emendas sobre ela.',
  schema: z.object({ allocation_id: z.string().uuid() }),
  async execute(ctx, input) {
    const row = unwrap(
      await ctx.req.db.from('budget_allocations_view').select(ALLOCATION_VIEW_COLUMNS).eq('id', input.allocation_id).maybeSingle(),
    ) as unknown as BudgetAllocationViewRow | null
    if (!row) throw new ToolUserError('Dotação não encontrada nos dados desta instituição.')
    const commitments = unwrap(
      await ctx.req.db.rpc('allocation_commitments', { p_allocation_ids: [row.id], p_exclude_amendment: null }),
    ) as Array<{ firm_amount: string; pending_amount: string; amendments_count: number }>
    const c = commitments[0]
    return {
      content: {
        ...summarizeAllocation(row),
        exercicio: row.fiscal_year,
        versao_vigente: row.is_current,
        compromissos_de_emendas: c
          ? { firmes: c.firm_amount, em_elaboracao: c.pending_amount, quantidade_emendas: c.amendments_count }
          : { firmes: '0.00', em_elaboracao: '0.00', quantidade_emendas: 0 },
      },
      summary: `${row.programmatic_code} · ${row.expense_nature} · ${formatBRL(toCents(row.authorized_amount))}`,
      card: { kind: 'allocations', items: [card(row)], total: 1 },
    }
  },
})

export const findCancellationCandidatesTool = defineTool({
  name: 'find_cancellation_candidates',
  label: 'Analisando anulações compensatórias',
  description:
    'Identifica dotações elegíveis para anulação compensatória no exercício ativo aplicando as regras configuradas (despesas protegidas, compatibilidade de fontes, valor disponível descontando outras emendas). Retorna a composição sugerida, os motivos de exclusão e alertas. A sugestão sempre exige aprovação humana.',
  schema: z.object({
    amount: reais,
    destination_allocation_ids: z.array(z.string().uuid()).max(10).optional().describe('Dotações de destino (para checar fontes e excluí-las)'),
    destination_source_code: z.string().max(20).optional().describe('Fonte do destino, quando for nova programação'),
    amendment_id: z.string().uuid().optional().describe('Emenda em edição, para não contar suas próprias anulações como compromisso'),
  }),
  async execute(ctx, input) {
    const fiscalYearId = requireFiscalYear(ctx)
    const report = await findCancellationCandidates(ctx.req.db, ctx.req.admin, {
      organizationId: ctx.organizationId,
      fiscalYearId,
      amountCents: toCents(input.amount),
      destinationAllocationIds: input.destination_allocation_ids ?? [],
      destinationSourceCode: input.destination_source_code ?? null,
      excludeAmendmentId: input.amendment_id ?? null,
      limit: 6,
    })
    const a = report.analysis
    return {
      content: {
        valor_solicitado: centsToDecimal(a.requestedCents),
        valor_coberto_pela_sugestao: centsToDecimal(a.coveredCents),
        composicao_sugerida: a.suggestion.map((s) => ({
          allocation_id: s.allocationId,
          classificacao: s.programmaticCode,
          natureza: s.expenseNature,
          fonte: s.sourceCode,
          valor: centsToDecimal(s.amountCents),
          base_disponibilidade: s.availabilityBasis === 'official_balance' ? 'saldo oficial informado' : 'estimada a partir do valor autorizado (exige confirmação humana)',
        })),
        candidatas_elegiveis: report.eligible.map((e) => ({
          allocation_id: e.allocationId,
          classificacao: e.programmaticCode,
          acao: e.actionName,
          natureza: e.expenseNature,
          fonte: e.sourceCode,
          valor_autorizado: centsToDecimal(e.authorizedCents),
          maximo_anulavel: centsToDecimal(e.maxCents),
          situacao_conferencia: e.verificationStatus,
          alertas: e.warnings,
          origem: e.sourceDocument ? `${e.sourceDocument}${e.page ? `, p. ${e.page}` : ''}` : null,
          dados_ficticios: e.isDemo,
        })),
        exclusoes: report.exclusionSummary,
        dotacoes_analisadas: report.totalCandidates,
        regras_aplicadas: a.rulesApplied,
        observacoes: a.notes,
      },
      summary: a.suggestion.length
        ? `Sugestão cobre ${formatBRL(a.coveredCents)} de ${formatBRL(a.requestedCents)}`
        : 'Nenhuma dotação elegível',
      card: {
        kind: 'candidates',
        requested: a.requestedCents,
        covered: a.coveredCents,
        suggestion: a.suggestion.map((s) => ({ allocationId: s.allocationId, code: s.programmaticCode, nature: s.expenseNature, source: s.sourceCode, amountCents: s.amountCents, basis: s.availabilityBasis })),
        eligible: report.eligible.length,
        exclusions: report.exclusionSummary.map((x) => ({ reason: x.reason, count: x.count })),
      },
    }
  },
})

export const checkAllocationForDestination = defineTool({
  name: 'check_allocation_for_destination',
  label: 'Verificando a programação de destino',
  description:
    'Verifica, pelas regras determinísticas da instituição, se uma dotação pode receber a destinação pretendida: requisitos de transferência a OSC (modalidade e elemento), restrições de destinação, compatibilidade com o PPA, limite individual e situação de conferência.',
  schema: z.object({
    allocation_id: z.string().uuid(),
    amount: reais,
    beneficiary_type: z.enum(['none', 'osc', 'public_entity', 'own_administration', 'other']),
    modality_code: z.string().max(40).optional().describe('Código da modalidade de emenda (ver get_workspace_context)'),
  }),
  async execute(ctx, input) {
    const fiscalYearId = requireFiscalYear(ctx)
    const row = unwrap(
      await ctx.req.db.from('budget_allocations_view').select(ALLOCATION_VIEW_COLUMNS).eq('id', input.allocation_id).maybeSingle(),
    ) as unknown as BudgetAllocationViewRow | null
    if (!row) throw new ToolUserError('Dotação não encontrada nos dados desta instituição.')

    const modalities = unwrap(
      await ctx.req.db.from('amendment_modalities').select('*').eq('organization_id', ctx.organizationId).eq('is_active', true),
    ) as Array<{ id: string; code: string; name: string; requires_cancellation: boolean; is_impositive: boolean; counts_toward_individual_limit: boolean }>
    const modality = modalities.find((m) => m.code === input.modality_code) ?? modalities[0]
    if (!modality) throw new ToolUserError('Nenhuma modalidade de emenda configurada na instituição.')

    const [fyRes, orgRes, totalsRes, catalog, rules] = await Promise.all([
      ctx.req.db.from('fiscal_years').select('*').eq('id', fiscalYearId).single(),
      ctx.req.db.from('organizations').select('is_demo, parliamentarians_count').eq('id', ctx.organizationId).single(),
      ctx.officeId
        ? ctx.req.db.rpc('office_amendment_totals', { p_office: ctx.officeId, p_fiscal_year: fiscalYearId, p_exclude_amendment: null })
        : Promise.resolve({ data: [], error: null }),
      loadCatalog(ctx.req.admin),
      loadActiveRules(ctx.req.admin, ctx.organizationId, todayInBrazil()),
    ])
    const fy = unwrap(fyRes) as { id: string; year: number; phase: 'ploa'; is_active: boolean; rcl_amount: string | null; rcl_reference: string | null; amendment_deadline: string | null }
    const org = unwrap(orgRes) as { is_demo: boolean; parliamentarians_count: number | null }
    const totals = unwrap(totalsRes) as Array<{ function_code: string; total: string }>

    const relevantTypes = new Set(['osc_transfer_requirements', 'destination_restrictions', 'ppa_compatibility', 'individual_amendment_limit'])
    const facts: AmendmentFacts = {
      id: 'simulacao',
      organizationId: ctx.organizationId,
      officeId: ctx.officeId ?? 'sem-gabinete',
      fiscalYearId,
      revision: 0,
      title: 'Simulação de destinação',
      object: 'simulação',
      purpose: null,
      justification: 'simulação',
      legalGrounds: null,
      beneficiaryType: input.beneficiary_type,
      beneficiaryName: input.beneficiary_type === 'osc' ? 'Entidade a definir' : null,
      beneficiaryCnpj: null,
      transferInstrument: null,
      modality: {
        id: modality.id,
        code: modality.code,
        name: modality.name,
        requiresCancellation: false,
        kind: 'budget',
        textSubtype: null,
        isImpositive: modality.is_impositive,
        countsTowardIndividualLimit: modality.counts_toward_individual_limit,
      },
      destinations: [{ id: 'd', amountCents: toCents(input.amount), allocation: toAllocationFacts(row), proposedClassification: null }],
      cancellations: [],
    }
    const report = validateAmendment(
      facts,
      rules.filter((r) => relevantTypes.has(r.ruleType)),
      {
        today: todayInBrazil(),
        organization: { id: ctx.organizationId, isDemo: org.is_demo, parliamentariansCount: org.parliamentarians_count },
        fiscalYear: {
          id: fy.id,
          year: fy.year,
          phase: fy.phase,
          isActive: fy.is_active,
          rclCents: fy.rcl_amount ? toCents(fy.rcl_amount) : null,
          rclReference: fy.rcl_reference,
          amendmentDeadline: fy.amendment_deadline,
        },
        officeTotals: totals.map((t) => ({ functionCode: t.function_code, totalCents: toCents(t.total) })),
        catalog,
      },
    )
    const checks = report.checks.filter((c) => c.checkCode !== 'BASE_REQUIRED_FIELDS' && c.checkCode !== 'BASE_CANCELLATION' && c.checkCode !== 'BASE_RULESET')
    return {
      content: {
        dotacao: summarizeAllocation(row),
        verificacoes: checks.map((c) => ({ codigo: c.checkCode, titulo: c.title, resultado: c.outcome, severidade: c.severity, mensagem: c.message, base_legal: c.legalBasis ?? null })),
        observacao: 'Simulação somente da programação de destino. Requisitos da entidade (nome/CNPJ) e anulações são avaliados na validação completa da emenda.',
      },
      summary: `${row.programmatic_code}: ${checks.filter((c) => c.outcome !== 'validated').length} ponto(s) de atenção`,
      card: { kind: 'checks', checks: checks.map((c) => ({ code: c.checkCode, title: c.title, outcome: c.outcome, message: c.message })) },
    }
  },
})
