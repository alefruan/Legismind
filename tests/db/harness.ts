import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite-pgvector'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { unaccent } from '@electric-sql/pglite/contrib/unaccent'

const root = path.resolve(import.meta.dirname, '..', '..')
const migrationsDir = path.join(root, 'supabase', 'migrations')

export interface TestUser {
  id: string
  email: string
}

export const ids = {
  org1: 'de000000-0000-4000-8000-000000000001',
  org2: 'de000000-0000-4000-8000-000000000002',
  office1: 'de000000-0000-4000-8000-000000000201',
  office2: 'de000000-0000-4000-8000-000000000202',
  officeOrg2: 'de000000-0000-4000-8000-000000003201',
  fy2027: 'de000000-0000-4000-8000-000000000301',
  fy2026: 'de000000-0000-4000-8000-000000000302',
  fyOrg2: 'de000000-0000-4000-8000-000000003301',
  modalityImpositiva: 'de000000-0000-4000-8000-000000001601',
  modalityOrg2: 'de000000-0000-4000-8000-000000003601',
  allocOscSport: 'de000000-0000-4000-8000-000000001501',
  allocPersonnel: 'de000000-0000-4000-8000-000000001509',
  allocReserveAmendments: 'de000000-0000-4000-8000-000000001518',
  alloc2026: 'de000000-0000-4000-8000-000000002501',
  amendmentOffice2: 'de000000-0000-4000-8000-000000002901',
  documentLdo: 'de000000-0000-4000-8000-000000001902',
} as const

export async function createDatabase(options: { seed?: boolean } = {}) {
  const db = new PGlite({ extensions: { vector, pg_trgm, unaccent } })
  await db.exec(readFileSync(path.join(import.meta.dirname, 'supabase-shim.sql'), 'utf8'))

  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
  for (const file of files) {
    try {
      await db.exec(readFileSync(path.join(migrationsDir, file), 'utf8'))
    } catch (error) {
      throw new Error(`Falha ao aplicar ${file}: ${(error as Error).message}`)
    }
  }
  if (options.seed !== false) {
    try {
      await db.exec(readFileSync(path.join(root, 'supabase', 'seed.sql'), 'utf8'))
    } catch (error) {
      throw new Error(`Falha ao aplicar seed.sql: ${(error as Error).message}`)
    }
  }
  return db
}

export type Db = Awaited<ReturnType<typeof createDatabase>>

export async function createUser(db: Db, user: TestUser, fullName = 'Usuário de Teste') {
  await db.query(
    `insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, jsonb_build_object('full_name', $3::text))`,
    [user.id, user.email, fullName],
  )
}

async function setClaims(db: Db, role: string, claims: Record<string, unknown>) {
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(claims)])
  await db.exec(`set role ${role}`)
}

async function resetClaims(db: Db) {
  await db.exec(`reset role`)
  await db.query(`select set_config('request.jwt.claims', '', false)`)
}

/** Executa como usuário autenticado (RLS ativa). */
export async function asUser<T>(db: Db, user: TestUser, fn: () => Promise<T>): Promise<T> {
  await setClaims(db, 'authenticated', { sub: user.id, email: user.email, role: 'authenticated' })
  try {
    return await fn()
  } finally {
    await resetClaims(db)
  }
}

/** Executa como service role (servidor). */
export async function asService<T>(db: Db, fn: () => Promise<T>): Promise<T> {
  await setClaims(db, 'service_role', { role: 'service_role' })
  try {
    return await fn()
  } finally {
    await resetClaims(db)
  }
}

/** Executa como visitante anônimo. */
export async function asAnon<T>(db: Db, fn: () => Promise<T>): Promise<T> {
  await setClaims(db, 'anon', { role: 'anon' })
  try {
    return await fn()
  } finally {
    await resetClaims(db)
  }
}

export async function rows<T = Record<string, unknown>>(db: Db, sql: string, params: unknown[] = []) {
  const result = await db.query<T>(sql, params)
  return result.rows
}

export async function expectError(promise: Promise<unknown>, pattern?: RegExp) {
  try {
    await promise
  } catch (error) {
    const message = (error as Error).message
    if (pattern && !pattern.test(message)) {
      throw new Error(`Erro inesperado: ${message}`)
    }
    return message
  }
  throw new Error('Era esperado um erro, mas a operação foi concluída.')
}
