import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env } from './env.js'

const clientOptions = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
}

let adminClient: SupabaseClient | null = null

/**
 * Cliente com service role: ignora RLS. Usado somente para operações de
 * servidor (worker, gravação de validações, auditoria) após verificação explícita
 * de permissão. Nunca é exposto ao navegador.
 */
export function getAdminClient(): SupabaseClient {
  if (!adminClient) {
    adminClient = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, clientOptions)
  }
  return adminClient
}

/** Cliente que age como o usuário autenticado: todas as consultas passam pelo RLS. */
export function createUserClient(accessToken: string): SupabaseClient {
  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    ...clientOptions,
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  })
}

/** Lança o erro do PostgREST quando presente e retorna os dados. */
export function unwrap<T>(result: { data: T; error: unknown }): T {
  if (result.error) throw result.error
  return result.data
}

/**
 * Lê todas as linhas de uma consulta paginando por intervalos — o PostgREST
 * limita cada resposta (max_rows, 1.000 por padrão). A consulta deve ter ordenação estável.
 */
export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  options: { pageSize?: number; max?: number } = {},
): Promise<T[]> {
  const size = options.pageSize ?? 1000
  const max = options.max ?? 200_000
  const rows: T[] = []
  for (let from = 0; from < max; from += size) {
    const result = await page(from, from + size - 1)
    if (result.error) throw result.error
    const data = result.data ?? []
    rows.push(...data)
    if (data.length < size) break
  }
  return rows
}
