import { z } from 'zod'
import type { AmendmentModalityRow, FiscalYearRow, LegalRuleRow, OfficeRow, OrganizationRow } from '../../../shared/types/db.js'
import { unwrap } from '../../supabase.js'
import { defineTool } from './registry.js'

export const getWorkspaceContext = defineTool({
  name: 'get_workspace_context',
  label: 'Verificando instituição, exercício e regras',
  description:
    'Retorna a instituição, o exercício orçamentário ativo (fase, RCL de referência, prazo de emendas), o gabinete, as modalidades de emenda configuradas, as regras normativas ATIVAS e a situação da base de dados (dotações conferidas, documentos). Use no início de qualquer tarefa de emenda.',
  schema: z.object({}),
  async execute(ctx) {
    const db = ctx.req.db
    const [org, fy, office, modalities, rules, allocCounts, docs] = await Promise.all([
      db.from('organizations').select('id, name, kind, uf, municipality, is_demo, parliamentarians_count').eq('id', ctx.organizationId).single(),
      ctx.fiscalYearId ? db.from('fiscal_years').select('*').eq('id', ctx.fiscalYearId).maybeSingle() : Promise.resolve({ data: null, error: null }),
      ctx.officeId ? db.from('offices').select('id, name, parliamentarian_name, parliamentarian_title, party').eq('id', ctx.officeId).maybeSingle() : Promise.resolve({ data: null, error: null }),
      db.from('amendment_modalities').select('code, name, kind, text_subtype, type_label, requires_cancellation, is_impositive, counts_toward_individual_limit, legal_basis, is_active').eq('organization_id', ctx.organizationId).eq('is_active', true),
      db.from('legal_rules').select('code, version, name, rule_type, legal_basis, severity, applies_to_modalities').eq('organization_id', ctx.organizationId).eq('status', 'active'),
      ctx.fiscalYearId
        ? Promise.all(
            (['confirmed', 'pending_review'] as const).map((status) =>
              db.from('budget_allocations').select('id', { count: 'exact', head: true }).eq('fiscal_year_id', ctx.fiscalYearId!).eq('is_current', true).eq('verification_status', status),
            ),
          ).then(([confirmed, pending]) => ({ data: { confirmed: confirmed.count ?? 0, pending: pending.count ?? 0 }, error: confirmed.error ?? pending.error }))
        : Promise.resolve({ data: { confirmed: 0, pending: 0 }, error: null }),
      db.from('documents').select('doc_type, status').eq('organization_id', ctx.organizationId).eq('status', 'active'),
    ])
    const o = unwrap(org) as Pick<OrganizationRow, 'name' | 'kind' | 'uf' | 'municipality' | 'is_demo' | 'parliamentarians_count'>
    const f = unwrap(fy) as FiscalYearRow | null
    const of = unwrap(office) as Pick<OfficeRow, 'name' | 'parliamentarian_name' | 'parliamentarian_title' | 'party'> | null
    const mods = unwrap(modalities) as AmendmentModalityRow[]
    const rs = unwrap(rules) as LegalRuleRow[]
    const allocations = unwrap(allocCounts) as { confirmed: number; pending: number }
    const documents = unwrap(docs) as Array<{ doc_type: string }>

    const docCounts = documents.reduce<Record<string, number>>((acc, d) => ({ ...acc, [d.doc_type]: (acc[d.doc_type] ?? 0) + 1 }), {})
    const content = {
      instituicao: { nome: o.name, tipo: o.kind, uf: o.uf, municipio: o.municipality, numero_parlamentares: o.parliamentarians_count, demonstracao_dados_ficticios: o.is_demo },
      exercicio: f
        ? {
            ano: f.year,
            fase: f.phase,
            ativo: f.is_active,
            projeto_de_lei: f.bill_number,
            rcl_referencia: f.rcl_amount,
            fonte_rcl: f.rcl_reference,
            prazo_emendas: f.amendment_deadline,
          }
        : null,
      gabinete: of ? { nome: of.name, parlamentar: of.parliamentarian_name, cargo: of.parliamentarian_title, partido: of.party } : null,
      modalidades: mods.map((m) => ({
        codigo: m.code,
        nome: m.name,
        natureza: m.kind === 'text' ? `emenda ao texto (${m.text_subtype})` : 'orçamentária',
        tipo_no_formulario: m.type_label,
        exige_anulacao: m.requires_cancellation,
        impositiva: m.is_impositive,
        conta_no_limite_individual: m.counts_toward_individual_limit,
        base_legal: m.legal_basis,
      })),
      regras_ativas: rs.map((r) => ({ codigo: r.code, versao: r.version, nome: r.name, tipo: r.rule_type, base_legal: r.legal_basis, severidade: r.severity, modalidades: r.applies_to_modalities })),
      base_de_dados: {
        dotacoes_conferidas: allocations.confirmed,
        dotacoes_pendentes_conferencia: allocations.pending,
        documentos_vigentes_por_tipo: docCounts,
        busca_semantica_disponivel: ctx.embeddings !== null,
      },
      avisos: [
        ...(rs.length === 0 ? ['Nenhuma regra normativa ativa: emendas não poderão ser validadas tecnicamente.'] : []),
        ...(allocations.confirmed + allocations.pending === 0 ? ['Nenhuma dotação estruturada carregada para o exercício: importe a LOA/PLOA na Base Legislativa.'] : []),
        ...(o.is_demo ? ['Instituição de demonstração: todos os dados são fictícios.'] : []),
      ],
    }
    return {
      content,
      summary: `${o.name} · exercício ${f?.year ?? '—'} · ${rs.length} regra(s) ativa(s)`,
      card: { kind: 'context', organization: o.name, fiscalYear: f?.year ?? null, office: of?.name ?? null, rules: rs.length, isDemo: o.is_demo },
    }
  },
})
