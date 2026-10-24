import { createUser, ids, type Db, type TestUser } from './harness'

export const users = {
  adminOrg1: { id: '10000000-0000-4000-8000-000000000001', email: 'admin@vila-esperanca.test' },
  advisorOffice1: { id: '10000000-0000-4000-8000-000000000002', email: 'assessor1@vila-esperanca.test' },
  advisorOffice2: { id: '10000000-0000-4000-8000-000000000003', email: 'assessor2@vila-esperanca.test' },
  reviewerOrg1: { id: '10000000-0000-4000-8000-000000000004', email: 'revisor@vila-esperanca.test' },
  adminOrg2: { id: '10000000-0000-4000-8000-000000000005', email: 'admin@assembleia-exemplo.test' },
  memberOrg2: { id: '10000000-0000-4000-8000-000000000006', email: 'assessor@assembleia-exemplo.test' },
  platformAdmin: { id: '10000000-0000-4000-8000-000000000007', email: 'plataforma@legismind.test' },
  outsider: { id: '10000000-0000-4000-8000-000000000008', email: 'externo@exemplo.test' },
  invitee: { id: '10000000-0000-4000-8000-000000000009', email: 'convidado@vila-esperanca.test' },
} satisfies Record<string, TestUser>

/** Cria usuários e vínculos. Executa como superusuário (equivalente a migrations/service). */
export async function setupUsers(db: Db) {
  for (const user of Object.values(users)) {
    await createUser(db, user)
  }
  await db.exec(`
    insert into public.memberships (organization_id, user_id, role) values
      ('${ids.org1}', '${users.adminOrg1.id}', 'org_admin'),
      ('${ids.org1}', '${users.advisorOffice1.id}', 'advisor'),
      ('${ids.org1}', '${users.advisorOffice2.id}', 'advisor'),
      ('${ids.org1}', '${users.reviewerOrg1.id}', 'reviewer'),
      ('${ids.org2}', '${users.adminOrg2.id}', 'org_admin'),
      ('${ids.org2}', '${users.memberOrg2.id}', 'advisor');
    insert into public.office_members (office_id, organization_id, user_id, office_role) values
      ('${ids.office1}', '${ids.org1}', '${users.advisorOffice1.id}', 'advisor'),
      ('${ids.office2}', '${ids.org1}', '${users.advisorOffice2.id}', 'advisor'),
      ('${ids.officeOrg2}', '${ids.org2}', '${users.memberOrg2.id}', 'advisor');
    insert into public.platform_admins (user_id) values ('${users.platformAdmin.id}');
  `)
}

export async function createDraftAmendment(db: Db, title = 'Emenda de teste') {
  const result = await db.query<{ id: string }>(
    `insert into public.amendments (organization_id, office_id, fiscal_year_id, modality_id, title, beneficiary_type)
     values ($1, $2, $3, $4, $5, 'osc') returning id`,
    [ids.org1, ids.office1, ids.fy2027, ids.modalityImpositiva, title],
  )
  return result.rows[0]!.id
}

/** Registra uma execução de validação como o servidor faria. */
export async function recordValidation(db: Db, amendmentId: string, outcome: 'validated' | 'pending' | 'inconsistent' | 'not_verifiable') {
  const revision = await db.query<{ revision: number }>(`select revision from public.amendments where id = $1`, [amendmentId])
  await db.query(
    `select public.record_validation_run($1, $2, $3::public.validation_outcome, 'test', '[]'::jsonb, '{}'::jsonb, '{}'::jsonb,
       jsonb_build_array(jsonb_build_object('check_code', 'TEST', 'outcome', $3::text, 'severity', 'blocking', 'title', 'Teste', 'message', 'ok')), null)`,
    [amendmentId, revision.rows[0]!.revision, outcome],
  )
}
