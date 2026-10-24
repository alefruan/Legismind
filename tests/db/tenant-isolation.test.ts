import { beforeAll, describe, expect, it } from 'vitest'
import { asAnon, asService, asUser, createDatabase, expectError, ids, rows, type Db } from './harness'
import { setupUsers, users } from './fixtures'

let db: Db

beforeAll(async () => {
  db = await createDatabase()
  await setupUsers(db)
  // objeto no Storage da instituição 1
  await db.exec(`insert into storage.objects (bucket_id, name) values ('documents', '${ids.org1}/doc/ver/arquivo.pdf')`)
})

describe('Isolamento entre instituições (RLS)', () => {
  it('membro da instituição 2 não enxerga dados da instituição 1', async () => {
    await asUser(db, users.memberOrg2, async () => {
      const orgs = await rows<{ id: string }>(db, 'select id from public.organizations')
      expect(orgs.map((o) => o.id)).toEqual([ids.org2])

      for (const table of ['budget_allocations', 'documents', 'document_chunks', 'legal_rules', 'fiscal_years', 'amendments', 'offices', 'document_templates']) {
        const result = await rows<{ count: number }>(db, `select count(*)::int as count from public.${table} where organization_id = $1`, [ids.org1])
        expect(result[0]!.count, table).toBe(0)
      }
    })
  })

  it('consultas por ID explícito de outra instituição retornam vazio', async () => {
    await asUser(db, users.adminOrg2, async () => {
      const allocation = await rows(db, 'select * from public.budget_allocations where id = $1', [ids.allocOscSport])
      expect(allocation).toHaveLength(0)
      const view = await rows(db, 'select * from public.budget_allocations_view where id = $1', [ids.allocOscSport])
      expect(view).toHaveLength(0)
      const amendment = await rows(db, 'select * from public.amendments where id = $1', [ids.amendmentOffice2])
      expect(amendment).toHaveLength(0)
    })
  })

  it('RPCs de busca respeitam o tenant do chamador', async () => {
    await asUser(db, users.memberOrg2, async () => {
      const budget = await rows(db, `select * from public.search_budget_allocations($1, 'esporte')`, [ids.fy2027])
      expect(budget).toHaveLength(0)
      const chunks = await rows(db, `select * from public.search_document_chunks('emendas organizações sociedade civil')`)
      expect(chunks).toHaveLength(0)
      const commitments = await rows(db, `select * from public.allocation_commitments(array[$1]::uuid[])`, [ids.allocReserveAmendments])
      expect(commitments).toHaveLength(0)
    })
    await asUser(db, users.advisorOffice1, async () => {
      const budget = await rows(db, `select * from public.search_budget_allocations($1, 'esporte')`, [ids.fy2027])
      expect(budget.length).toBeGreaterThan(0)
      const chunks = await rows(db, `select * from public.search_document_chunks('emendas organizações sociedade civil')`)
      expect(chunks.length).toBeGreaterThan(0)
    })
  })

  it('administrador de outra instituição não consegue gravar dados na instituição 1', async () => {
    await asUser(db, users.adminOrg2, async () => {
      await expectError(
        db.query(`insert into public.documents (organization_id, doc_type, title) values ($1, 'loa', 'Documento invasor')`, [ids.org1]),
        /row-level security/,
      )
      await expectError(
        db.query(`insert into public.legal_rules (organization_id, code, name, rule_type, legal_basis, sphere) values ($1, 'INVASAO', 'Regra invasora', 'amount_range', 'Nenhuma base', 'interna')`, [ids.org1]),
        /row-level security/,
      )
      const updated = await rows(db, `update public.fiscal_years set notes = 'alterado' where organization_id = $1 returning id`, [ids.org1])
      expect(updated).toHaveLength(0)
    })
  })

  it('chaves compostas impedem referenciar dotação de outra instituição', async () => {
    await asUser(db, users.memberOrg2, async () => {
      const created = await rows<{ id: string }>(
        db,
        `insert into public.amendments (organization_id, office_id, fiscal_year_id, modality_id, title)
         values ($1, $2, $3, $4, 'Emenda da instituição 2') returning id`,
        [ids.org2, ids.officeOrg2, ids.fyOrg2, ids.modalityOrg2],
      )
      await expectError(
        db.query(
          `insert into public.amendment_allocations (amendment_id, organization_id, fiscal_year_id, allocation_id, amount)
           values ($1, $2, $3, $4, 1000)`,
          [created[0]!.id, ids.org2, ids.fyOrg2, ids.allocOscSport],
        ),
        /foreign key/,
      )
    })
  })

  it('não é possível criar emenda em gabinete do qual o usuário não participa', async () => {
    await asUser(db, users.memberOrg2, async () => {
      await expectError(
        db.query(
          `insert into public.amendments (organization_id, office_id, fiscal_year_id, modality_id, title) values ($1, $2, $3, $4, 'Invasão')`,
          [ids.org1, ids.office1, ids.fy2027, ids.modalityImpositiva],
        ),
        /row-level security/,
      )
    })
  })

  it('Storage: arquivos só são acessíveis a membros da instituição dona da pasta', async () => {
    await asUser(db, users.advisorOffice1, async () => {
      const visible = await rows(db, `select name from storage.objects where bucket_id = 'documents'`)
      expect(visible).toHaveLength(1)
    })
    await asUser(db, users.memberOrg2, async () => {
      const visible = await rows(db, `select name from storage.objects where bucket_id = 'documents'`)
      expect(visible).toHaveLength(0)
    })
    await asUser(db, users.adminOrg2, async () => {
      await expectError(
        db.query(`insert into storage.objects (bucket_id, name) values ('documents', $1)`, [`${ids.org1}/x/y/invasor.pdf`]),
        /row-level security/,
      )
    })
  })

  it('perfis de usuários de outra instituição não são visíveis', async () => {
    await asUser(db, users.memberOrg2, async () => {
      const profiles = await rows<{ id: string }>(db, 'select id from public.profiles')
      const ids_ = profiles.map((p) => p.id)
      expect(ids_).toContain(users.memberOrg2.id)
      expect(ids_).toContain(users.adminOrg2.id)
      expect(ids_).not.toContain(users.adminOrg1.id)
    })
  })

  it('usuário sem vínculo não enxerga nenhuma instituição', async () => {
    await asUser(db, users.outsider, async () => {
      expect(await rows(db, 'select * from public.organizations')).toHaveLength(0)
      expect(await rows(db, 'select * from public.budget_allocations')).toHaveLength(0)
    })
  })

  it('visitante anônimo não tem privilégio algum sobre as tabelas', async () => {
    await asAnon(db, async () => {
      await expectError(db.query('select * from public.organizations'), /permission denied/)
      await expectError(db.query('select * from public.budget_allocations'), /permission denied/)
    })
  })

  it('superadministrador gerencia instituições sem acessar conteúdo dos gabinetes', async () => {
    await asUser(db, users.platformAdmin, async () => {
      const orgs = await rows(db, 'select id from public.organizations')
      expect(orgs.length).toBeGreaterThanOrEqual(2)
      expect(await rows(db, 'select * from public.amendments')).toHaveLength(0)
      expect(await rows(db, 'select * from public.ai_conversations')).toHaveLength(0)
      expect(await rows(db, 'select * from public.documents')).toHaveLength(0)
      const metrics = await rows<{ organization_id: string; amendments: number }>(db, 'select * from public.platform_metrics()')
      expect(metrics.find((m) => m.organization_id === ids.org1)?.amendments).toBe(1)
    })
    await asUser(db, users.adminOrg1, async () => {
      await expectError(db.query('select * from public.platform_metrics()'), /restrito/)
    })
  })

  it('service role ignora RLS (uso exclusivo do servidor)', async () => {
    await asService(db, async () => {
      const all = await rows(db, 'select id from public.organizations')
      expect(all.length).toBeGreaterThanOrEqual(2)
    })
  })
})

describe('Isolamento entre gabinetes da mesma instituição', () => {
  it('gabinete 1 não enxerga rascunhos do gabinete 2', async () => {
    await asUser(db, users.advisorOffice1, async () => {
      expect(await rows(db, 'select id from public.amendments where id = $1', [ids.amendmentOffice2])).toHaveLength(0)
      expect(await rows(db, 'select id from public.amendment_cancellations where amendment_id = $1', [ids.amendmentOffice2])).toHaveLength(0)
    })
    await asUser(db, users.advisorOffice2, async () => {
      expect(await rows(db, 'select id from public.amendments where id = $1', [ids.amendmentOffice2])).toHaveLength(1)
    })
  })

  it('revisor não enxerga rascunhos, apenas emendas em tramitação', async () => {
    await asUser(db, users.reviewerOrg1, async () => {
      expect(await rows(db, 'select id from public.amendments')).toHaveLength(0)
    })
  })

  it('compromissos agregados de outras emendas ficam visíveis sem expor o conteúdo', async () => {
    await asUser(db, users.advisorOffice1, async () => {
      const commitments = await rows<{ pending_amount: string; amendments_count: number }>(
        db,
        'select * from public.allocation_commitments(array[$1]::uuid[])',
        [ids.allocReserveAmendments],
      )
      expect(Number(commitments[0]!.pending_amount)).toBe(300000)
      expect(commitments[0]!.amendments_count).toBe(1)
    })
  })
})
