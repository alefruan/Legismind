import { z } from 'zod'
import { env } from '../env.js'
import { isPlatformAdmin, rateLimit, requireOrgRole, type RequestContext } from '../http/auth.js'
import { conflict, forbidden } from '../http/errors.js'
import { unwrap } from '../supabase.js'

export const inviteSchema = z.object({
  organizationId: z.string().uuid(),
  email: z.string().trim().toLowerCase().email('E-mail inválido.'),
  fullName: z.string().trim().max(160).optional(),
  role: z.enum(['org_admin', 'parliamentarian', 'advisor', 'reviewer']),
  officeId: z.string().uuid().nullish(),
  officeRole: z.enum(['titular', 'chief_of_staff', 'advisor']).nullish(),
})

/**
 * Convida um usuário: registra o convite (RLS: administrador da instituição ou
 * da plataforma) e envia o e-mail de ativação pelo Supabase Auth. Usuários já
 * cadastrados veem o convite ao entrar ("Selecionar instituição").
 */
export async function inviteUser(ctx: RequestContext, raw: unknown) {
  const input = inviteSchema.parse(raw)
  await rateLimit(ctx, `invite:${ctx.user.id}`, 30)
  const platform = await isPlatformAdmin(ctx)
  if (!platform) await requireOrgRole(ctx, input.organizationId, ['org_admin'])
  if (Boolean(input.officeId) !== Boolean(input.officeRole)) {
    throw conflict('Informe gabinete e função no gabinete em conjunto.')
  }

  const { data: invitation, error } = await ctx.db
    .from('invitations')
    .insert({
      organization_id: input.organizationId,
      email: input.email,
      role: input.role,
      office_id: input.officeId ?? null,
      office_role: input.officeRole ?? null,
      invited_by: ctx.user.id,
    })
    .select('id, expires_at')
    .single()
  if (error) {
    if (error.code === '23505') throw conflict('Já existe um convite pendente para este e-mail nesta instituição.')
    throw error
  }

  let emailSent = false
  let existingUser = false
  const { error: inviteError } = await ctx.admin.auth.admin.inviteUserByEmail(input.email, {
    redirectTo: `${env.appUrl}/convite`,
    data: { full_name: input.fullName ?? null, invitation_id: invitation.id },
  })
  if (!inviteError) emailSent = true
  else if (/already|registered|exists/i.test(inviteError.message)) existingUser = true
  else {
    console.error('[invite]', inviteError)
    await ctx.db.from('invitations').update({ status: 'revoked' }).eq('id', invitation.id)
    throw new Error('Falha ao enviar o convite por e-mail. Verifique a configuração de SMTP do Supabase.')
  }

  return {
    invitationId: invitation.id,
    expiresAt: invitation.expires_at,
    emailSent,
    existingUser,
    message: existingUser
      ? 'O usuário já possui conta: o convite aparecerá na próxima vez que ele entrar no LegisMind.'
      : 'Convite enviado por e-mail.',
  }
}

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(3).max(200),
  shortName: z.string().trim().max(60).optional(),
  kind: z.enum(['camara_municipal', 'assembleia_legislativa', 'camara_legislativa_df']),
  uf: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'UF inválida.'),
  municipality: z.string().trim().max(120).optional(),
  ibgeCode: z.string().regex(/^\d{7}$/).optional(),
  cnpj: z.string().transform((v) => v.replace(/\D/g, '')).pipe(z.string().regex(/^\d{14}$/, 'CNPJ deve ter 14 dígitos.')).optional(),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{3,60}$/, 'Identificador deve ter de 3 a 60 caracteres (letras minúsculas, números e hífens).'),
  planId: z.string().uuid().nullish(),
  parliamentariansCount: z.number().int().positive().max(1000).optional(),
  status: z.enum(['trial', 'active']).default('trial'),
  adminEmail: z.string().trim().toLowerCase().email().optional(),
  adminName: z.string().trim().max(160).optional(),
})

export async function createOrganization(ctx: RequestContext, raw: unknown) {
  const input = createOrganizationSchema.parse(raw)
  if (!(await isPlatformAdmin(ctx))) throw forbidden('Somente a administração da plataforma cadastra instituições.')
  if (input.kind === 'camara_municipal' && !input.municipality) throw conflict('Informe o município da Câmara Municipal.')

  const { data, error } = await ctx.db
    .from('organizations')
    .insert({
      name: input.name,
      short_name: input.shortName ?? null,
      kind: input.kind,
      uf: input.uf,
      municipality: input.municipality ?? null,
      ibge_code: input.ibgeCode ?? null,
      cnpj: input.cnpj ?? null,
      slug: input.slug,
      plan_id: input.planId ?? null,
      parliamentarians_count: input.parliamentariansCount ?? null,
      status: input.status,
      created_by: ctx.user.id,
    })
    .select('id, name, slug')
    .single()
  if (error) {
    if (error.code === '23505') throw conflict('Já existe uma instituição com este identificador.')
    throw error
  }

  let invitation = null
  if (input.adminEmail) {
    invitation = await inviteUser(ctx, {
      organizationId: data.id,
      email: input.adminEmail,
      fullName: input.adminName,
      role: 'org_admin',
    })
  }
  return { organization: data, invitation }
}

/** Remove um vínculo de usuário (o banco impede remover o último administrador). */
export async function setMembershipStatus(ctx: RequestContext, raw: unknown) {
  const input = z.object({ membershipId: z.string().uuid(), status: z.enum(['active', 'suspended']) }).parse(raw)
  const membership = unwrap(await ctx.db.from('memberships').select('id, organization_id, user_id').eq('id', input.membershipId).single()) as {
    id: string
    organization_id: string
    user_id: string
  }
  if (membership.user_id === ctx.user.id) throw forbidden('Você não pode alterar o seu próprio vínculo.')
  unwrap(await ctx.db.from('memberships').update({ status: input.status }).eq('id', input.membershipId).select('id').single())
  return { ok: true }
}
