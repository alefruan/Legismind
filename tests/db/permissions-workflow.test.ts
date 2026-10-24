import { beforeAll, describe, expect, it } from 'vitest'
import { asService, asUser, createDatabase, expectError, ids, rows, type Db } from './harness'
import { createDraftAmendment, recordValidation, setupUsers, users } from './fixtures'

let db: Db

beforeAll(async () => {
  db = await createDatabase()
  await setupUsers(db)
})

async function getAmendment(id: string) {
  const [row] = await rows<{
    status: string
    revision: number
    validated_revision: number | null
    validation_outcome: string | null
    total_amount: string
    protocol_number: string | null
  }>(db, 'select status, revision, validated_revision, validation_outcome, total_amount, protocol_number from public.amendments where id = $1', [id])
  return row!
}

describe('Permissões por papel', () => {
  it('assessor não pode cadastrar documentos nem regras (somente administração)', async () => {
    await asUser(db, users.advisorOffice1, async () => {
      await expectError(db.query(`insert into public.documents (organization_id, doc_type, title) values ($1, 'ldo', 'LDO')`, [ids.org1]), /row-level security/)
      await expectError(
        db.query(`insert into public.legal_rules (organization_id, code, name, rule_type, legal_basis, sphere) values ($1, 'X_RULE', 'Regra', 'amount_range', 'Base local', 'interna')`, [ids.org1]),
        /row-level security/,
      )
    })
  })

  it('administrador cadastra documento, mas não consegue marcar processamento como concluído', async () => {
    await asUser(db, users.adminOrg1, async () => {
      const [doc] = await rows<{ id: string }>(db, `insert into public.documents (organization_id, doc_type, title) values ($1, 'ldo', 'LDO teste') returning id`, [ids.org1])
      const [version] = await rows<{ id: string; processing_status: string; version_number: number }>(
        db,
        `insert into public.document_versions (organization_id, document_id, version_number, storage_path, file_name, mime_type, size_bytes, processing_status)
         values ($1, $2, 0, $3, 'ldo.pdf', 'application/pdf', 1000, 'completed') returning id, processing_status, version_number`,
        [ids.org1, doc!.id, `${ids.org1}/${doc!.id}/v1/ldo.pdf`],
      )
      expect(version!.processing_status).toBe('pending_upload')
      expect(version!.version_number).toBe(1)
      await expectError(db.query(`update public.document_versions set processing_status = 'completed' where id = $1`, [version!.id]), /permission denied/)
      await expectError(db.query(`select public.enqueue_document_processing($1)`, [version!.id]), /não foi enviado/)
    })
  })

  it('caminho de Storage fora da pasta da instituição é rejeitado', async () => {
    await asUser(db, users.adminOrg1, async () => {
      const [doc] = await rows<{ id: string }>(db, `insert into public.documents (organization_id, doc_type, title) values ($1, 'loa', 'LOA teste') returning id`, [ids.org1])
      await expectError(
        db.query(
          `insert into public.document_versions (organization_id, document_id, storage_path, file_name, mime_type, size_bytes)
           values ($1, $2, $3, 'loa.pdf', 'application/pdf', 1000)`,
          [ids.org1, doc!.id, `${ids.org2}/${doc!.id}/v1/loa.pdf`],
        ),
        /check constraint/,
      )
      await expectError(
        db.query(
          `insert into public.document_versions (organization_id, document_id, storage_path, file_name, mime_type, size_bytes)
           values ($1, $2, $3, 'loa.exe', 'application/x-msdownload', 1000)`,
          [ids.org1, doc!.id, `${ids.org1}/${doc!.id}/v1/loa.exe`],
        ),
        /check constraint/,
      )
    })
  })

  it('funções exclusivas do servidor não são executáveis por usuários', async () => {
    await asUser(db, users.adminOrg1, async () => {
      await expectError(db.query(`select * from public.claim_processing_job('x')`), /permission denied/)
      await expectError(db.query(`select public.check_rate_limit('x', 60, 10)`), /permission denied/)
      await expectError(db.query(`select public.apply_retention_policies()`), /permission denied/)
    })
  })

  it('a instituição não pode ficar sem administrador', async () => {
    await expectError(
      db.query(`delete from public.memberships where organization_id = $1 and user_id = $2`, [ids.org2, users.adminOrg2.id]),
      /administrador/,
    )
  })

  it('regra só é ativada após confirmação de incidência local e fica imutável', async () => {
    await asUser(db, users.adminOrg1, async () => {
      const [rule] = await rows<{ id: string }>(
        db,
        `insert into public.legal_rules (organization_id, code, name, rule_type, params, legal_basis, sphere)
         values ($1, 'VALOR_TESTE', 'Valor mínimo', 'amount_range', '{"min_amount": 10000}', 'Resolução local nº 1', 'interna') returning id`,
        [ids.org1],
      )
      await expectError(db.query('select public.activate_legal_rule($1)', [rule!.id]), /incidência/)
      await db.query(`update public.legal_rules set local_incidence_confirmed = true where id = $1`, [rule!.id])
      const [confirmed] = await rows<{ confirmed_by: string }>(db, 'select confirmed_by from public.legal_rules where id = $1', [rule!.id])
      expect(confirmed!.confirmed_by).toBe(users.adminOrg1.id)
      await db.query('select public.activate_legal_rule($1)', [rule!.id])
      await expectError(db.query(`update public.legal_rules set params = '{"min_amount": 1}' where id = $1`, [rule!.id]), /nova versão/)
      await expectError(db.query(`update public.legal_rules set status = 'draft' where id = $1`, [rule!.id]), /permission denied/)
    })
  })
})

describe('Convites', () => {
  it('somente o e-mail convidado aceita; convite expirado é recusado', async () => {
    const [invite] = await rows<{ id: string }>(
      db,
      `insert into public.invitations (organization_id, email, role, office_id, office_role) values ($1, $2, 'advisor', $3, 'advisor') returning id`,
      [ids.org1, users.invitee.email, ids.office1],
    )
    await asUser(db, users.outsider, async () => {
      expect(await rows(db, 'select * from public.my_pending_invitations()')).toHaveLength(0)
      await expectError(db.query('select public.accept_invitation($1)', [invite!.id]), /não encontrado/)
    })
    await asUser(db, users.invitee, async () => {
      expect(await rows(db, 'select * from public.my_pending_invitations()')).toHaveLength(1)
      await db.query('select public.accept_invitation($1)', [invite!.id])
      expect(await rows(db, 'select * from public.organizations where id = $1', [ids.org1])).toHaveLength(1)
      const [office] = await rows<{ ok: boolean }>(db, 'select public.is_office_member($1) as ok', [ids.office1])
      expect(office!.ok).toBe(true)
      await expectError(db.query('select public.accept_invitation($1)', [invite!.id]), /não está mais disponível/)
    })

    const [expired] = await rows<{ id: string }>(
      db,
      `insert into public.invitations (organization_id, email, role, expires_at) values ($1, $2, 'reviewer', now() - interval '1 day') returning id`,
      [ids.org2, users.outsider.email],
    )
    await asUser(db, users.outsider, async () => {
      await expectError(db.query('select public.accept_invitation($1)', [expired!.id]), /expirou/)
    })
  })
})

describe('Emendas: revisão, validação e tramitação', () => {
  it('status não pode ser alterado diretamente e campos de validação são protegidos', async () => {
    await asUser(db, users.advisorOffice1, async () => {
      const id = await createDraftAmendment(db)
      await expectError(db.query(`update public.amendments set status = 'filed' where id = $1`, [id]), /fluxo de tramitação/)
      await db.query(`update public.amendments set validation_outcome = 'validated', validated_revision = 1, total_amount = 999 where id = $1`, [id])
      const row = await getAmendment(id)
      expect(row.validation_outcome).toBeNull()
      expect(row.validated_revision).toBeNull()
      expect(Number(row.total_amount)).toBe(0)
      await expectError(
        db.query(`insert into public.amendment_validation_runs (amendment_id, organization_id, amendment_revision, outcome, engine_version, rules_snapshot, data_snapshot, summary)
                  values ($1, $2, 1, 'validated', 'fake', '[]', '{}', '{}')`, [id, ids.org1]),
        /permission denied/,
      )
      await expectError(db.query(`select public.record_validation_run($1, 1, 'validated', 'x', '[]', '{}', '{}', '[]', null)`, [id]), /permission denied/)
    })
  })

  it('destinações e anulações atualizam total e revisão; anulação exige aprovação explícita', async () => {
    await asUser(db, users.advisorOffice1, async () => {
      const id = await createDraftAmendment(db, 'Esporte para crianças')
      const before = await getAmendment(id)
      await db.query(
        `insert into public.amendment_allocations (amendment_id, organization_id, fiscal_year_id, allocation_id, amount) values ($1, $2, $3, $4, 150000)`,
        [id, ids.org1, ids.fy2027, ids.allocOscSport],
      )
      const [cancellation] = await rows<{ id: string; approved: boolean }>(
        db,
        `insert into public.amendment_cancellations (amendment_id, organization_id, fiscal_year_id, allocation_id, amount, approved)
         values ($1, $2, $3, $4, 150000, false) returning id, approved`,
        [id, ids.org1, ids.fy2027, ids.allocReserveAmendments],
      )
      const after = await getAmendment(id)
      expect(Number(after.total_amount)).toBe(150000)
      expect(after.revision).toBe(before.revision + 2)

      const [approved] = await rows<{ approved_by: string; approved: boolean }>(
        db,
        `update public.amendment_cancellations set approved = true where id = $1 returning approved_by, approved`,
        [cancellation!.id],
      )
      expect(approved!.approved).toBe(true)
      expect(approved!.approved_by).toBe(users.advisorOffice1.id)

      const [changed] = await rows<{ approved: boolean; approved_by: string | null }>(
        db,
        `update public.amendment_cancellations set amount = 140000 where id = $1 returning approved, approved_by`,
        [cancellation!.id],
      )
      expect(changed!.approved).toBe(false)
      expect(changed!.approved_by).toBeNull()
    })
  })

  it('dotação de outro exercício não pode ser usada e o exercício não muda com destinações', async () => {
    await asUser(db, users.advisorOffice1, async () => {
      const id = await createDraftAmendment(db, 'Troca de exercício')
      await expectError(
        db.query(
          `insert into public.amendment_allocations (amendment_id, organization_id, fiscal_year_id, allocation_id, amount) values ($1, $2, $3, $4, 1000)`,
          [id, ids.org1, ids.fy2027, ids.alloc2026],
        ),
        /foreign key/,
      )
      await db.query(
        `insert into public.amendment_allocations (amendment_id, organization_id, fiscal_year_id, allocation_id, amount) values ($1, $2, $3, $4, 1000)`,
        [id, ids.org1, ids.fy2027, ids.allocOscSport],
      )
      await expectError(db.query(`update public.amendments set fiscal_year_id = $2 where id = $1`, [id, ids.fy2026]), /exercício/)
    })
  })

  it('envio para análise exige validação da revisão atual; validação técnica exige resultado aprovado', async () => {
    let id = ''
    await asUser(db, users.advisorOffice1, async () => {
      id = await createDraftAmendment(db, 'Fluxo completo')
      await db.query(
        `insert into public.amendment_allocations (amendment_id, organization_id, fiscal_year_id, allocation_id, amount) values ($1, $2, $3, $4, 100000)`,
        [id, ids.org1, ids.fy2027, ids.allocOscSport],
      )
      await expectError(db.query(`select public.transition_amendment_status($1, 'in_review')`, [id]), /validação técnica/)
    })

    await asService(db, () => recordValidation(db, id, 'pending'))

    // alteração posterior torna a validação obsoleta
    await asUser(db, users.advisorOffice1, async () => {
      await db.query(`update public.amendments set justification = 'Nova justificativa' where id = $1`, [id])
      const row = await getAmendment(id)
      expect(row.validated_revision).not.toBe(row.revision)
      await expectError(db.query(`select public.transition_amendment_status($1, 'in_review')`, [id]), /validação técnica/)
    })

    await asService(db, () => recordValidation(db, id, 'pending'))
    await asUser(db, users.advisorOffice1, async () => {
      await db.query(`select public.transition_amendment_status($1, 'in_review')`, [id])
      // em análise, o gabinete não edita
      const updated = await rows(db, `update public.amendments set title = 'x' where id = $1 returning id`, [id])
      expect(updated).toHaveLength(0)
      await expectError(db.query(`select public.transition_amendment_status($1, 'technically_validated')`, [id]), /revisores/)
    })

    await asUser(db, users.reviewerOrg1, async () => {
      expect(await rows(db, 'select id from public.amendments where id = $1', [id])).toHaveLength(1)
      await expectError(db.query(`select public.transition_amendment_status($1, 'technically_validated')`, [id]), /integralmente aprovada/)
      await db.query(`select public.transition_amendment_status($1, 'needs_correction', 'Informar CNPJ da OSC')`, [id])
    })

    await asUser(db, users.advisorOffice1, async () => {
      await db.query(`update public.amendments set beneficiary_cnpj = '00000000000191' where id = $1`, [id])
    })
    await asService(db, () => recordValidation(db, id, 'validated'))
    await asUser(db, users.advisorOffice1, async () => {
      await db.query(`select public.transition_amendment_status($1, 'in_review')`, [id])
    })
    await asUser(db, users.reviewerOrg1, async () => {
      await db.query(`select public.transition_amendment_status($1, 'technically_validated', 'Conferido')`, [id])
    })
    await asUser(db, users.advisorOffice1, async () => {
      await db.query(`select public.transition_amendment_status($1, 'awaiting_signature')`, [id])
      await expectError(db.query(`select public.transition_amendment_status($1, 'filed')`, [id]), /número e a data/)
      await db.query(`select public.transition_amendment_status($1, 'filed', null, 'PROT-2026/0042', current_date)`, [id])
      const row = await getAmendment(id)
      expect(row.status).toBe('filed')
      expect(row.protocol_number).toBe('PROT-2026/0042')
      const history = await rows(db, 'select * from public.amendment_status_history where amendment_id = $1', [id])
      // rascunho→análise→correção→análise→validada→aguardando assinatura→protocolada
      expect(history.length).toBe(6)
      const versions = await rows(db, 'select * from public.amendment_versions where amendment_id = $1', [id])
      expect(versions.length).toBeGreaterThanOrEqual(4)
      await expectError(db.query(`select public.transition_amendment_status($1, 'draft')`, [id]), /arquivadas/)
    })
  })

  it('validação gravada com revisão desatualizada é rejeitada', async () => {
    let id = ''
    await asUser(db, users.advisorOffice1, async () => {
      id = await createDraftAmendment(db, 'Concorrência')
    })
    await asService(db, async () => {
      await expectError(
        db.query(`select public.record_validation_run($1, 999, 'validated', 'x', '[]', '{}', '{}', '[]', null)`, [id]),
        /alterada durante a validação/,
      )
    })
  })
})

describe('Formulários e emendas ao texto (migração 0010)', () => {
  const modalityTextAditiva = 'de000000-0000-4000-8000-000000001603'

  it('emenda ao texto não aceita destinações nem anulações', async () => {
    await asUser(db, users.advisorOffice1, async () => {
      const [row] = await rows<{ id: string }>(
        db,
        `insert into public.amendments (organization_id, office_id, fiscal_year_id, modality_id, title, beneficiary_type, text_command, new_text)
         values ($1, $2, $3, $4, 'Emenda aditiva de teste', 'none', 'Acrescente-se ao art. 5º:', 'Parágrafo único. Texto.') returning id`,
        [ids.org1, ids.office1, ids.fy2027, modalityTextAditiva],
      )
      await expectError(
        db.query(
          `insert into public.amendment_allocations (amendment_id, organization_id, fiscal_year_id, allocation_id, amount, origin) values ($1, $2, $3, $4, 1000, 'user')`,
          [row!.id, ids.org1, ids.fy2027, ids.allocOscSport],
        ),
        /Emendas ao texto não possuem destinações/,
      )
    })
  })

  it('modalidade ao texto exige subtipo e não pode exigir anulação', async () => {
    await asUser(db, users.adminOrg1, async () => {
      await expectError(
        db.query(`insert into public.amendment_modalities (organization_id, code, name, kind, requires_cancellation) values ($1, 'texto_x', 'Texto X', 'text', false)`, [ids.org1]),
        /text_subtype_chk/,
      )
      await expectError(
        db.query(`insert into public.amendment_modalities (organization_id, code, name, kind, text_subtype, requires_cancellation) values ($1, 'texto_y', 'Texto Y', 'text', 'aditiva', true)`, [ids.org1]),
        /text_no_cancellation_chk/,
      )
    })
  })

  it('novos campos do formulário geram nova revisão', async () => {
    await asUser(db, users.advisorOffice1, async () => {
      const id = await createDraftAmendment(db, 'Revisão por meta física')
      const before = await getAmendment(id)
      await db.query(`update public.amendments set physical_goal = '10 poltronas' where id = $1`, [id])
      expect((await getAmendment(id)).revision).toBe(before.revision + 1)
    })
  })

  it('revisor identifica a reserva para emendas e a alteração é auditada', async () => {
    await asUser(db, users.reviewerOrg1, async () => {
      await db.query(`update public.budget_allocations set extra_identifiers = '{"reserva_emendas": false}' where id = $1`, [ids.allocReserveAmendments])
    })
    await asUser(db, users.advisorOffice1, async () => {
      // assessor não altera dotações
      const result = await db.query(`update public.budget_allocations set extra_identifiers = '{}' where id = $1`, [ids.allocReserveAmendments])
      expect(result.affectedRows ?? 0).toBe(0)
    })
    const audit = await rows(db, `select * from public.audit_logs where entity_type = 'budget_allocations' and entity_id = $1`, [ids.allocReserveAmendments])
    expect(audit.length).toBeGreaterThanOrEqual(1)
    await asUser(db, users.reviewerOrg1, async () => {
      await db.query(`update public.budget_allocations set extra_identifiers = '{"reserva_emendas": true}' where id = $1`, [ids.allocReserveAmendments])
    })
  })
})
