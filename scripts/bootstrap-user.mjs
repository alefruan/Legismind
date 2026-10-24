#!/usr/bin/env node
/**
 * Cria (ou reutiliza) um usuário e concede vínculos — útil para o primeiro acesso
 * e para o ambiente de demonstração. Usa a service role: execute apenas em
 * máquina confiável.
 *
 * Exemplos:
 *   node scripts/bootstrap-user.mjs --email admin@exemplo.gov.br --password 'Senha#Forte2026' --platform-admin
 *   node scripts/bootstrap-user.mjs --email assessor@exemplo.gov.br --password 'Senha#Forte2026' \
 *        --org demo-vila-esperanca --role advisor --office de000000-0000-4000-8000-000000000201
 *
 * Papéis: org_admin | parliamentarian | advisor | reviewer
 * Funções no gabinete (--office-role): titular | chief_of_staff | advisor
 */
import { readFileSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

function loadDotEnv() {
  if (!existsSync('.env')) return
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
  }
}

function args() {
  const out = {}
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '')
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) out[key] = true
    else {
      out[key] = next
      i++
    }
  }
  return out
}

loadDotEnv()
const opts = args()
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error('Defina SUPABASE_URL (ou VITE_SUPABASE_URL) e SUPABASE_SERVICE_ROLE_KEY no .env.')
  process.exit(1)
}
if (!opts.email) {
  console.error('Informe --email.')
  process.exit(1)
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
const email = String(opts.email).toLowerCase()

async function findUser() {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    const user = data.users.find((u) => u.email?.toLowerCase() === email)
    if (user) return user
    if (data.users.length < 200) return null
  }
  return null
}

let user = await findUser()
if (!user) {
  if (!opts.password || String(opts.password).length < 10) {
    console.error('Usuário inexistente: informe --password com ao menos 10 caracteres.')
    process.exit(1)
  }
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: String(opts.password),
    email_confirm: true,
    user_metadata: { full_name: opts.name ? String(opts.name) : null },
  })
  if (error) throw error
  user = data.user
  console.log(`Usuário criado: ${email}`)
} else {
  console.log(`Usuário existente: ${email}`)
}

if (opts['platform-admin']) {
  const { error } = await admin.from('platform_admins').upsert({ user_id: user.id })
  if (error) throw error
  console.log('Concedido: superadministrador da plataforma.')
}

if (opts.org) {
  const orgRef = String(opts.org)
  const column = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orgRef) ? 'id' : 'slug'
  const { data: org, error } = await admin.from('organizations').select('id, name').eq(column, orgRef).maybeSingle()
  if (error || !org) {
    console.error(`Instituição não encontrada: ${opts.org}`)
    process.exit(1)
  }
  const role = String(opts.role ?? 'advisor')
  const { error: mError } = await admin.from('memberships').upsert({ organization_id: org.id, user_id: user.id, role, status: 'active' }, { onConflict: 'organization_id,user_id' })
  if (mError) throw mError
  console.log(`Vínculo: ${org.name} — ${role}`)
  if (opts.office) {
    const { error: oError } = await admin
      .from('office_members')
      .upsert({ office_id: String(opts.office), organization_id: org.id, user_id: user.id, office_role: String(opts['office-role'] ?? 'advisor') }, { onConflict: 'office_id,user_id' })
    if (oError) throw oError
    console.log(`Gabinete: ${opts.office}`)
  }
  await admin
    .from('profiles')
    .update({ last_organization_id: org.id, ...(opts['skip-onboarding'] ? { onboarded_at: new Date().toISOString() } : {}) })
    .eq('id', user.id)
}

console.log('Concluído.')
