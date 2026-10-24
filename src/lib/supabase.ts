import { createClient } from '@supabase/supabase-js'
import { isSupabaseConfigured, publicEnv } from './env'

/**
 * Cliente do navegador: usa apenas a chave anônima. Todo acesso a dados passa
 * pelas políticas RLS do banco, conforme o usuário autenticado.
 */
export const supabase = createClient(
  publicEnv.supabaseUrl ?? 'http://localhost:54321',
  publicEnv.supabaseAnonKey ?? 'public-anon-key-not-configured',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // Fluxo implícito: links de convite emitidos pelo servidor (admin.inviteUserByEmail)
      // retornam tokens no fragmento da URL, que o fluxo PKCE não aceita.
      detectSessionInUrl: true,
      flowType: 'implicit',
      storageKey: 'legismind.auth',
    },
  },
)

export { isSupabaseConfigured }

/** Lança erros do PostgREST e retorna os dados tipados. */
export function unwrap<T>(result: { data: unknown; error: { message: string; code?: string } | null }): T {
  if (result.error) throw new DbError(result.error.message, result.error.code)
  return result.data as T
}

export class DbError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(translateDbError(message, code))
  }
}

function translateDbError(message: string, code?: string) {
  if (code === '42501' || /row-level security|permission denied/i.test(message)) return 'Você não tem permissão para esta operação.'
  if (code === '23505') return 'Já existe um registro com estes dados.'
  if (code === '23503') return 'Referência inválida: o registro relacionado não existe ou pertence a outra instituição/exercício.'
  if (code === '23514') return 'Os dados informados violam uma regra de integridade.'
  if (code === 'PGRST116') return 'Registro não encontrado.'
  return message
}
