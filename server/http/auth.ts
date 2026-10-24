import type { SupabaseClient, User } from '@supabase/supabase-js'
import { createUserClient, getAdminClient } from '../supabase.js'
import { forbidden, tooManyRequests, unauthorized } from './errors.js'
import { env } from '../env.js'

export interface RequestContext {
  user: User
  token: string
  /** Cliente com o JWT do usuário: RLS aplicada. */
  db: SupabaseClient
  /** Cliente service role: somente após verificação explícita de permissão. */
  admin: SupabaseClient
}

export async function requireUser(request: Request): Promise<RequestContext> {
  const header = request.headers.get('authorization') ?? ''
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''
  if (!token) throw unauthorized()
  const admin = getAdminClient()
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) throw unauthorized()
  return { user: data.user, token, db: createUserClient(token), admin }
}

export async function rateLimit(ctx: Pick<RequestContext, 'admin'>, key: string, perMinute: number) {
  const { data, error } = await ctx.admin.rpc('check_rate_limit', { p_key: key, p_window_seconds: 60, p_max: perMinute })
  if (error) {
    console.error('[rate-limit]', error)
    return
  }
  if (data === false) throw tooManyRequests()
}

export async function requireOrgMember(ctx: RequestContext, organizationId: string) {
  const { data, error } = await ctx.db.rpc('is_org_member', { p_org: organizationId })
  if (error || data !== true) throw forbidden('Você não pertence a esta instituição.')
}

export async function requireOrgRole(ctx: RequestContext, organizationId: string, roles: string[]) {
  const { data, error } = await ctx.db.rpc('has_org_role', { p_org: organizationId, p_roles: roles })
  if (error || data !== true) throw forbidden()
}

export async function requireOfficeMember(ctx: RequestContext, officeId: string) {
  const { data, error } = await ctx.db.rpc('is_office_member', { p_office: officeId })
  if (error || data !== true) throw forbidden('Você não integra este gabinete.')
}

export async function isPlatformAdmin(ctx: RequestContext): Promise<boolean> {
  const { data } = await ctx.db.rpc('is_platform_admin')
  return data === true
}

/** Autorização do agendador (Vercel Cron / pg_cron) via segredo compartilhado. */
export function isCronRequest(request: Request): boolean {
  const secret = env.cronSecret
  if (!secret) return false
  const header = request.headers.get('authorization') ?? ''
  return header === `Bearer ${secret}`
}
