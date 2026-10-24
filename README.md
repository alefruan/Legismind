# LegisMind

**Inteligência legislativa e orçamentária para Câmaras Municipais, Assembleias Legislativas e gabinetes parlamentares.**

O LegisMind funciona como um chefe de gabinete digital: o parlamentar ou assessor descreve o que deseja em linguagem natural e a plataforma consulta o orçamento e a legislação da Casa, identifica a programação orçamentária adequada, analisa anulações compensatórias, aplica regras normativas configuráveis e produz a minuta da emenda para conferência, assinatura e protocolo.

> Princípio central: **classificações, códigos e valores vêm de dados estruturados e verificáveis — nunca do modelo de linguagem.** A IA interpreta, pesquisa e redige; as conclusões técnicas são de um motor determinístico, e as decisões finais são humanas.

---

## Sumário

1. [Stack](#stack)
2. [Estrutura do projeto](#estrutura-do-projeto)
3. [Início rápido (desenvolvimento)](#início-rápido-desenvolvimento)
4. [Configurar o Supabase](#configurar-o-supabase)
5. [Configurar o provedor de IA](#configurar-o-provedor-de-ia)
6. [Publicar na Vercel](#publicar-na-vercel)
7. [Variáveis de ambiente](#variáveis-de-ambiente)
8. [Comandos](#comandos)
9. [Testes](#testes)
10. [Roteiro de demonstração](#roteiro-de-demonstração-caso-de-uso-obrigatório)
11. [Critérios de aceitação](#critérios-de-aceitação)
12. [Situação das funcionalidades](#situação-das-funcionalidades)

Documentos complementares: [Arquitetura](docs/ARQUITETURA.md) · [Segurança e LGPD](docs/SEGURANCA.md) · [Status e próximos passos](docs/STATUS.md)

---

## Stack

| Camada | Tecnologias |
|---|---|
| Frontend | React 19, Vite 8, TypeScript, Tailwind CSS 4, shadcn/ui (Radix), Lucide, React Router 7, TanStack Query 5, React Hook Form + Zod 4, next-themes (modo claro/escuro), fonte Inter auto-hospedada |
| Backend | Função serverless única na Vercel (Node, assinatura Web `fetch`), Supabase (PostgreSQL 17, Auth, Storage, RLS, pgvector, pg_trgm, unaccent) |
| IA | Interface `LlmProvider` independente de fornecedor; implementação Anthropic (`@anthropic-ai/sdk`, modelo padrão `claude-opus-5-5`); embeddings Voyage AI ou OpenAI (opcionais); OCR configurável |
| Documentos | unpdf (PDF), mammoth (DOCX), ExcelJS (XLSX), PapaParse (CSV), docx (exportação DOCX), pdf-lib (exportação PDF e recortes para OCR) |
| Testes | Vitest; banco testado com **PGlite** (PostgreSQL em WebAssembly) + emulação do ambiente Supabase — migrations, RLS e funções executam de verdade, sem Docker |

## Estrutura do projeto

```
api/router.ts                  Função serverless (Vercel) → server/http/router.ts
server/
  http/                        roteador, autenticação (JWT Supabase), erros, SSE
  ai/                          provedores de LLM, embeddings, prompt, orquestrador e ferramentas
  amendments/                  validação, candidatas a anulação, montagem da minuta
  budget/                      busca orçamentária em linguagem natural, mapeadores
  documents/                   worker assíncrono, extração, OCR, importação orçamentária
  export/                      DOCX e PDF
  admin/                       convites e cadastro de instituições
shared/
  domain/                      regras de negócio puras (motor de validação, anulações, códigos, documento, parser, segurança)
  types/                       tipos do banco e do assistente
src/                           aplicação React (features/, components/, providers/, lib/)
supabase/
  migrations/                  9 migrations versionadas (schema, RLS, funções, storage, catálogos)
  seed.sql                     dados FICTÍCIOS de demonstração (desenvolvimento)
  config.toml                  configuração do Supabase CLI
tests/
  db/                          isolamento entre instituições, permissões, tramitação, caso de uso (PGlite)
  domain/                      motor de validação, anulações, valores, códigos, documento, parser, segurança
  server/                      pipeline real de extração/exportação, roteador, esquemas das ferramentas
demo/                          planilha FICTÍCIA de PLOA para testar a importação
scripts/                       bootstrap de usuários, empacotamento das migrations
docs/                          arquitetura, segurança/LGPD, status
```

## Início rápido (desenvolvimento)

Pré-requisitos: **Node.js 20.19+** (testado com 24) e um projeto Supabase (local via CLI ou hospedado).

```bash
npm install
cp .env.example .env        # preencha as variáveis (veja abaixo)
npm run dev                 # http://localhost:5173 — o Vite também atende /api/*
```

O servidor de desenvolvimento executa o mesmo roteador da função da Vercel (`server/http/router.ts`), carregando as variáveis do `.env` — não é necessário `vercel dev`.

Sem Supabase configurado, a tela de login exibe um aviso. Sem chave de IA, o assistente informa a indisponibilidade e oferece a interpretação determinística do pedido; o restante da plataforma (explorador, emendas, validação, exportação, Base Legislativa sem OCR/embeddings) funciona normalmente.

## Configurar o Supabase

### Opção A — Supabase CLI (local)

```bash
npx supabase start          # sobe Postgres, Auth, Storage e Studio (requer Docker)
npx supabase db reset       # aplica supabase/migrations e supabase/seed.sql (dados fictícios)
```

Use a URL e as chaves exibidas por `supabase start` no `.env`. E-mails de convite e recuperação ficam no Inbucket (`http://localhost:54324`).

### Opção B — Projeto hospedado (supabase.com)

1. Crie o projeto (região `sa-east-1` recomendada para dados de instituições brasileiras).
2. Aplique o schema — com o CLI vinculado (`npx supabase link` e `npx supabase db push`) **ou** sem CLI:
   ```bash
   npm run db:bundle         # gera supabase/dist/legismind-schema.sql
   ```
   e execute o arquivo no **SQL Editor**.
3. Opcional (somente ambientes de teste): execute `supabase/dist/legismind-demo-seed.sql` para criar as instituições **fictícias** de demonstração.
4. **Authentication → Providers → Email**: desative *Allow new users to sign up* (acesso apenas por convite).
5. **Authentication → URL Configuration**: *Site URL* = URL da aplicação; *Redirect URLs* = `https://SEU-DOMINIO/convite` e `https://SEU-DOMINIO/redefinir-senha`.
6. **Authentication → SMTP**: configure um SMTP próprio para envio confiável de convites.
7. Em **Database → Extensions**, confirme `vector`, `pg_trgm` e `unaccent` (as migrations já as criam no schema `extensions`).
8. Opcional: habilite **pg_cron** e **pg_net** para retenção e processamento periódico:
   ```sql
   select cron.schedule('legismind-retencao', '15 3 * * *', 'select public.apply_retention_policies()');
   select cron.schedule('legismind-worker', '* * * * *', $$
     select net.http_post(
       url := 'https://SEU-DOMINIO/api/jobs/tick',
       headers := jsonb_build_object('Authorization', 'Bearer SEU_CRON_SECRET', 'Content-Type', 'application/json'),
       body := '{}'::jsonb)
   $$);
   ```

### Primeiro acesso

Crie o superadministrador e/ou vincule usuários à instituição de demonstração:

```bash
# superadministrador da plataforma
node scripts/bootstrap-user.mjs --email voce@exemplo.gov.br --password 'SenhaForte#2026' --platform-admin

# administrador da instituição FICTÍCIA de demonstração
node scripts/bootstrap-user.mjs --email admin@exemplo.gov.br --password 'SenhaForte#2026' \
  --org demo-vila-esperanca --role org_admin

# assessor do gabinete fictício "João Exemplo" (para o caso de uso)
node scripts/bootstrap-user.mjs --email assessor@exemplo.gov.br --password 'SenhaForte#2026' \
  --org demo-vila-esperanca --role advisor --office de000000-0000-4000-8000-000000000201

# revisor jurídico/orçamentário
node scripts/bootstrap-user.mjs --email revisor@exemplo.gov.br --password 'SenhaForte#2026' \
  --org demo-vila-esperanca --role reviewer
```

Em produção, o superadministrador cadastra instituições em **Plataforma** e convida o primeiro administrador; este convida os demais usuários em **Administração → Usuários**.

## Configurar o provedor de IA

```
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=...          # console.anthropic.com — crie a chave DENTRO de um workspace
# ANTHROPIC_WORKSPACE_ID=wrkspc_...  # só para chaves não vinculadas a workspace
ANTHROPIC_MODEL=claude-opus-5-5
ANTHROPIC_EFFORT=high          # low | medium | high | xhigh | max
ANTHROPIC_REFUSAL_FALLBACK=default
```

* O assistente usa streaming, ferramentas próprias (executadas com as permissões do usuário), pensamento adaptativo e o **fallback de recusa no servidor** (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`) nos modelos compatíveis — desative com `ANTHROPIC_REFUSAL_FALLBACK=off`.
* Para outro fornecedor, implemente `LlmProvider` (`server/ai/types.ts`) e registre-o em `server/ai/providers/index.ts`.
* **Embeddings** (busca semântica): `EMBEDDINGS_PROVIDER=voyage` + `VOYAGE_API_KEY` (modelo `voyage-3.5`, 1024 dimensões) ou `openai` + `OPENAI_API_KEY` (`text-embedding-3-small` com `dimensions=1024`). Sem provedor, a busca é textual + filtros. Após configurar, use **Reconstruir índice** nos documentos já processados.
* **OCR** de documentos digitalizados: `OCR_PROVIDER=anthropic` (transcrição pelo Claude em lotes de 10 páginas) ou `http` (serviço próprio que recebe `application/pdf` e devolve `{"pages":[{"page":1,"text":"..."}]}`).
* Limites de consumo: por plano (`plans`), por instituição (Administração → Configurações) e por usuário (`RATE_LIMIT_*`).

## Publicar na Vercel

1. Importe o repositório na Vercel (framework detectado: **Vite**). Build `npm run build`, saída `dist` — já definidos em `vercel.json`.
2. Configure todas as variáveis de ambiente do `.env.example` em *Project Settings → Environment Variables* (`APP_URL` = domínio público).
3. `vercel.json`:
   * reescreve `/api/*` para a função única `api/router.ts` e todas as demais rotas para `index.html` (React Router) **sem interceptar** `/api`;
   * define `maxDuration: 300` para o assistente e o worker — em planos com limite menor, reduza o valor e `CRON_WORKER_TIME_BUDGET_MS`;
   * agenda `/api/jobs/cron` diariamente (limite do plano Hobby). Em planos que permitem, use `*/5 * * * *`, ou o `pg_cron` acima. Enquanto um administrador acompanha um documento, a própria interface aciona ciclos do worker;
   * aplica cabeçalhos de segurança (CSP, HSTS, `frame-ancestors 'none'`). Se usar domínio próprio no Supabase, inclua-o em `connect-src`.
4. Defina `CRON_SECRET` (a Vercel o envia no cabeçalho `Authorization` do cron).
5. No Supabase, atualize *Site URL* e *Redirect URLs* para o domínio de produção.

## Variáveis de ambiente

| Variável | Onde | Obrigatória | Descrição |
|---|---|---|---|
| `VITE_SUPABASE_URL` | front + servidor | sim | URL do projeto Supabase |
| `VITE_SUPABASE_ANON_KEY` | front + servidor | sim | chave anônima (pública, protegida por RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` | **somente servidor** | sim | service role (worker, validações, convites) |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | servidor | não | sobrescrevem as `VITE_` no servidor |
| `APP_URL` | servidor | sim (produção) | URL pública para links de convite |
| `CRON_SECRET` | servidor | recomendado | autoriza o agendador |
| `ANTHROPIC_API_KEY` | servidor | para IA | chave da API Anthropic |
| `ANTHROPIC_WORKSPACE_ID` | servidor | só para chaves sem workspace | enviado no cabeçalho `anthropic-workspace-id` |
| `ANTHROPIC_MODEL`, `ANTHROPIC_EFFORT`, `ANTHROPIC_REFUSAL_FALLBACK`, `ASSISTANT_MAX_TOOL_ROUNDS` | servidor | não | ajustes do assistente |
| `EMBEDDINGS_PROVIDER`, `VOYAGE_API_KEY`, `OPENAI_API_KEY`, `*_EMBEDDINGS_MODEL` | servidor | não | busca semântica |
| `OCR_PROVIDER`, `OCR_HTTP_ENDPOINT`, `OCR_HTTP_API_KEY` | servidor | não | OCR |
| `RATE_LIMIT_CHAT_PER_MINUTE`, `RATE_LIMIT_API_PER_MINUTE`, `WORKER_TIME_BUDGET_MS`, `CRON_WORKER_TIME_BUDGET_MS` | servidor | não | limites |

Nenhum segredo usa o prefixo `VITE_`. Nenhum valor secreto está versionado.

## Comandos

```bash
npm run dev          # desenvolvimento (frontend + /api)
npm run build        # typecheck (app, servidor, testes) + build de produção
npm run preview      # serve o build
npm run typecheck    # somente verificação de tipos
npm test             # todos os testes
npm run test:db      # banco: migrations, RLS, permissões, tramitação (PGlite)
npm run test:domain  # domínio e pipeline do servidor
npm run db:bundle    # gera supabase/dist/*.sql para o SQL Editor
```

## Modelos de documento (formulário de emenda)

A minuta segue o formato de formulário usual das Câmaras Municipais (ex.: modelos de emenda impositiva, de remanejamento e de emendas ao texto ao PLOA):

* **Cabeçalho institucional** em todas as páginas (Administração → Configurações: uma linha por linha, `**negrito**` permitido), seguido do nome do gabinete.
* **Emenda ao Projeto de Lei nº …** e ementa recuada — cadastre o número e a ementa do PLOA no **exercício**.
* Quadros: identificação da autoria (nº, tipo, autor/partido, data da indicação), **acréscimo à programação** e **cancelamento compensatório** (órgão, unidade, função/subfunção, programa/ação, natureza, fonte, valor), objeto e **meta física**, beneficiário **A (órgão público) / B (instituição privada sem fins lucrativos)** com razão social, CNPJ e localização, justificativa e declaração de conformidade com assinatura "Nome - Cargo".
* **Emendas ao texto** (aditiva, modificativa, supressiva): configure modalidades de natureza "emenda ao texto"; elas não aceitam dotações e usam o comando da emenda e o texto original/nova redação.
* Formatos preservados: fonte de recursos exatamente como publicada (ex.: `1.5.00`); natureza exibida como `4.4.50.42` ou `44.50.42` (configurável).
* Em **Administração → Modelos**, use "Carregar modelo pré-definido" para partir dos formulários e ajustar os textos à norma local; cada modalidade pode apontar para um modelo próprio.
* Para anular a reserva de contingência destinada às emendas, um administrador/revisor deve identificá-la no detalhe da dotação ("Reserva para emendas").

> Banco já criado antes desta versão? Execute no SQL Editor somente `supabase/migrations/20261024000010_amendment_forms_text_amendments.sql`.

## Testes

`npm test` executa **117 testes** sem dependências externas:

| Requisito | Onde |
|---|---|
| Isolamento entre instituições (leitura, escrita, RPCs, Storage, chaves compostas, anônimo, superadmin sem conteúdo) | `tests/db/tenant-isolation.test.ts` |
| Permissões de acesso por papel e gabinete, convites, regras imutáveis, último administrador | `tests/db/permissions-workflow.test.ts` |
| Cálculos de anulação e destino (equilíbrio, saldo oficial, compromissos de outras emendas, limite individual, saúde) | `tests/domain/engine.test.ts`, `tests/domain/cancellation.test.ts` |
| Regras de validação (despesas protegidas, fontes, OSC, PPA, prazo, parâmetros inválidos) | `tests/domain/engine.test.ts` |
| Documentos incompletos (pendências na minuta, campos obrigatórios) | `tests/domain/documents.test.ts`, `tests/domain/engine.test.ts` |
| Códigos inexistentes (catálogo normativo, dotação de outro exercício/instituição) | `tests/domain/engine.test.ts`, `tests/db/*` |
| Mudança de exercício orçamentário (FK composta, bloqueio de troca, engine) | `tests/db/permissions-workflow.test.ts`, `tests/domain/engine.test.ts` |
| Falhas no processamento de arquivos (assinatura binária, macros, zip bomb, PDF sem texto, linhas ambíguas) | `tests/domain/documents.test.ts`, `tests/server/pipeline.test.ts` |
| Tramitação completa até "Protocolada" com revisão humana | `tests/db/permissions-workflow.test.ts` |
| Caso de uso obrigatório nas consultas do banco | `tests/db/use-case.test.ts` |

## Roteiro de demonstração (caso de uso obrigatório)

Com o seed fictício aplicado e um assessor vinculado ao gabinete `de000000-…-0201`:

1. Entre no LegisMind — o banner amarelo indica **dados fictícios**.
2. No painel, em **"O que você deseja fazer hoje?"**, envie: *"Quero destinar R$ 150 mil para uma ONG realizar atividades esportivas para crianças e adolescentes."*
3. O assistente consulta instituição, exercício 2027 e regras; busca dotações (encontra `10.001.27.812.0005.2051 · 3.3.50.41` — apoio a projetos esportivos de OSC); verifica requisitos de OSC; pesquisa a LDO (art. 35, fictício); analisa anulações (sugere a **reserva para emendas individuais**, excluindo pessoal, dívida, reserva geral e fonte vinculada do SUS, e descontando os R$ 300 mil já indicados por outro gabinete); cria o rascunho e executa a validação.
4. O relatório aponta pendências reais: **CNPJ da OSC** e **aprovação explícita da anulação** (sem saldo oficial, a disponibilidade exige decisão humana). A parcela de saúde aparece como aviso.
5. Abra o editor: informe o CNPJ, aprove a anulação, valide novamente → **Validado** (o aviso de dados fictícios permanece).
6. Envie para análise; entre como revisor e valide tecnicamente; libere para assinatura; registre o protocolo manualmente.
7. Exporte DOCX/PDF na aba **Documento** (marca d'água "DEMONSTRAÇÃO — DADOS FICTÍCIOS").

Sem `ANTHROPIC_API_KEY`, execute os passos 5 a 7 criando a emenda manualmente (**Emendas → Nova emenda**) ou a partir do **Explorador Orçamentário** (*Usar como destino*).

Para testar o pipeline documental, envie `demo/ploa-2027-vila-esperanca-FICTICIO.csv` em **Base Legislativa → Enviar documento** (tipo *Projeto de LOA*, exercício 2027) e confira as dotações em **Conferência de dotações**.

## Critérios de aceitação

- [x] Autenticação real (Supabase Auth), recuperação de senha, convite com ativação, seleção de instituição e perfil inicial.
- [x] Multi-tenant com `organization_id`, RLS em todas as tabelas e chaves compostas contra referências cruzadas; testado.
- [x] Cinco perfis (superadmin, administrador, parlamentar, assessor, revisor) e permissões por gabinete.
- [x] Nenhuma classificação inventada: destinações e anulações só referenciam dotações existentes; nova programação é marcada como dependente de autorização normativa.
- [x] Validação por regras configuráveis e versionadas, com confirmação de incidência local; sem regras ativas não há "validado".
- [x] Estados de validação: validado, pendente de conferência, inconsistente, não verificável.
- [x] "Validada tecnicamente" e "Aguardando assinatura" exigem validação atual aprovada e revisão humana; protocolo apenas manual.
- [x] Cancelamento compensatório com despesas protegidas, compatibilidade de fontes, saldo e compromissos de outras emendas, justificativa e aprovação explícita.
- [x] Minuta no modelo oficial configurável, com pendências explícitas, exportação DOCX/PDF e prévia de impressão.
- [x] Base Legislativa com upload privado, hash, jobs persistidos em lotes, retentativas, OCR configurável, extração estruturada pendente de conferência, busca híbrida e versões.
- [x] Explorador orçamentário com filtros, busca em linguagem natural traduzida para filtros validados e uso direto em emendas.
- [x] Interface em português, modo claro/escuro, responsiva, sidebar recolhível, estados de carregamento/erro/vazio.
- [x] Dados de demonstração explicitamente fictícios.
- [ ] Integrações de protocolo/assinatura eletrônica (fora do escopo — exigem integração específica e autorização).

## Situação das funcionalidades

Veja [docs/STATUS.md](docs/STATUS.md) para o detalhamento do que está funcional, do que depende de credenciais/serviços externos e dos próximos passos.

---

Os dados de demonstração deste repositório (`supabase/seed.sql`, `demo/`) são **inteiramente fictícios** e não correspondem a orçamento ou legislação de nenhum ente.
