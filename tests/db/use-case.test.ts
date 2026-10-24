import { beforeAll, describe, expect, it } from 'vitest'
import { asService, asUser, createDatabase, ids, rows, type Db } from './harness'
import { setupUsers, users } from './fixtures'

let db: Db

beforeAll(async () => {
  db = await createDatabase()
  await setupUsers(db)
})

describe('Caso de uso: R$ 150 mil para ONG de esportes para crianças e adolescentes (dados fictícios)', () => {
  it('a busca orçamentária encontra a ação de apoio a OSC esportiva com modalidade 50', async () => {
    await asUser(db, users.advisorOffice1, async () => {
      const result = await rows<{ id: string; programmatic_code: string; expense_nature: string; is_demo: boolean }>(
        db,
        `select * from public.search_budget_allocations($1, $2, array['27','08'], null, array['50'])`,
        [ids.fy2027, 'esporte crianças adolescentes organizações sociedade civil'],
      )
      expect(result[0]!.id).toBe(ids.allocOscSport)
      expect(result[0]!.expense_nature).toBe('3.3.50.41')
      expect(result.every((r) => r.is_demo)).toBe(true)
      expect(result[0]!.programmatic_code).toBe('10.001.27.812.0005.2051')
      expect(result.map((r) => r.programmatic_code)).toContain('08.002.08.243.0009.2090')
    })
  })

  it('a busca na Base Legislativa recupera o artigo da LDO sobre organizações da sociedade civil', async () => {
    await asUser(db, users.advisorOffice1, async () => {
      const hits = await rows<{ document_id: string; section_path: string; content: string }>(
        db,
        `select * from public.search_document_chunks('transferência organizações sociedade civil emendas parlamentares')`,
      )
      expect(hits[0]!.document_id).toBe(ids.documentLdo)
      expect(hits[0]!.section_path).toMatch(/Art\. 35/)
    })
  })

  it('a reserva para emendas mantém compromisso de outra emenda e totais do gabinete são apurados', async () => {
    await asService(db, async () => {
      const commitments = await rows<{ pending_amount: string }>(db, 'select * from public.allocation_commitments(array[$1]::uuid[])', [ids.allocReserveAmendments])
      expect(Number(commitments[0]!.pending_amount)).toBe(300000)
      const totals = await rows<{ function_code: string; total: string }>(db, 'select * from public.office_amendment_totals($1, $2)', [ids.office2, ids.fy2027])
      expect(totals).toEqual([expect.objectContaining({ function_code: '27' })])
      expect(Number(totals[0]!.total)).toBe(300000)
    })
  })

  it('o painel resume a situação do gabinete e da base', async () => {
    await asUser(db, users.advisorOffice2, async () => {
      const [summary] = await rows<{ dashboard_summary: Record<string, number> }>(db, 'select public.dashboard_summary($1, $2, $3)', [ids.org1, ids.office2, ids.fy2027])
      expect(summary!.dashboard_summary.amendments_total).toBe(1)
      expect(summary!.dashboard_summary.allocations_pending_review).toBe(2)
      expect(summary!.dashboard_summary.active_rules).toBe(12) // inclui REQUISITOS_FORMULARIO
    })
  })

  it('o snapshot completo da emenda preserva classificações para rastreabilidade', async () => {
    await asService(db, async () => {
      const [row] = await rows<{ snapshot: { destinations: Array<{ allocation: { programmatic_code: string } }>; cancellations: Array<{ allocation: { extra_identifiers: Record<string, unknown> } }> } }>(
        db,
        'select public.amendment_snapshot_json($1) as snapshot',
        [ids.amendmentOffice2],
      )
      expect(row!.snapshot.destinations[0]!.allocation.programmatic_code).toBe('10.001.27.812.0005.1052')
      expect(row!.snapshot.cancellations[0]!.allocation.extra_identifiers).toEqual({ reserva_emendas: true })
    })
  })
})
