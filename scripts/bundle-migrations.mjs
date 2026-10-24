#!/usr/bin/env node
/**
 * Gera arquivos SQL únicos para aplicar no SQL Editor do Supabase quando o
 * Supabase CLI não estiver disponível:
 *   supabase/dist/legismind-schema.sql     (todas as migrations, em ordem)
 *   supabase/dist/legismind-demo-seed.sql  (dados FICTÍCIOS de demonstração)
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const migrationsDir = path.join(root, 'supabase', 'migrations')
const outDir = path.join(root, 'supabase', 'dist')
mkdirSync(outDir, { recursive: true })

const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
const schema = files
  .map((f) => `-- >>> ${f}\n${readFileSync(path.join(migrationsDir, f), 'utf8').trim()}\n`)
  .join('\n')
writeFileSync(path.join(outDir, 'legismind-schema.sql'), `-- LegisMind — schema completo (gerado por scripts/bundle-migrations.mjs)\nbegin;\n\n${schema}\ncommit;\n`)
writeFileSync(path.join(outDir, 'legismind-demo-seed.sql'), readFileSync(path.join(root, 'supabase', 'seed.sql'), 'utf8'))
console.log(`Gerados em ${path.relative(root, outDir)}: legismind-schema.sql (${files.length} migrations) e legismind-demo-seed.sql`)
