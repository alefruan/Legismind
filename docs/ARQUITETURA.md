# Arquitetura do LegisMind

## Visão geral

```
Navegador (React + Vite)
  │  supabase-js (chave anônima + JWT do usuário)  ──►  Supabase PostgREST ── RLS ──► PostgreSQL (+ pgvector, pg_trgm, unaccent)
  │                                                   Supabase Storage (bucket privado "documents")
  │  fetch /api/* (Bearer JWT)
  ▼
Função serverless única (Vercel, Node) ── api/router.ts → server/http/router.ts
  ├─ Assistente (SSE) ─► Provedor de LLM (interface LlmProvider; implementação Anthropic)
  │     └─ Ferramentas ── executadas com o JWT do usuário (RLS) ── motor determinístico (shared/)
  ├─ Validação de emendas ─► shared/domain/amendments/engine.ts ─► record_validation_run (service role)
  ├─ Exportação DOCX/PDF ─► shared/domain/amendments/document.ts ─► server/export/*
  ├─ Worker de documentos ─► processing_jobs (fila persistida, lotes, retentativas)
  └─ Administração (convites, instituições)
```

## Camadas

| Camada | Pasta | Responsabilidade |
|---|---|---|
| Domínio (isomórfico) | `shared/domain` | Regras de negócio puras e determinísticas: valores em centavos, códigos orçamentários, motor de validação, análise de anulações, máquina de estados, geração do documento, parser orçamentário, segmentação e segurança de arquivos. Sem I/O. |
| Tipos | `shared/types` | Linhas do banco e contratos do assistente (eventos SSE, cartões). |
| Servidor | `server/` | HTTP, autenticação, clientes Supabase, provedores de IA, ferramentas, worker, exportações. |
| Entrada serverless | `api/router.ts` | Uma única função (assinatura Web `fetch`). |
| Interface | `src/` | React Router (rotas com carregamento sob demanda), TanStack Query, React Hook Form + Zod, shadcn/ui. |
| Banco | `supabase/migrations` | Schema, RLS, funções, gatilhos, storage e catálogos normativos. |

## Multi-tenancy

* Toda tabela institucional possui `organization_id` e RLS habilitada.
* Tabelas filhas usam **chaves estrangeiras compostas** `(id, organization_id)` — e `(id, organization_id, fiscal_year_id)` para dotações referenciadas por emendas. Uma emenda da instituição A não pode referenciar dotação da instituição B, nem de outro exercício, por restrição do próprio banco.
* Funções auxiliares `is_org_member`, `has_org_role`, `is_office_member` (security definer, `search_path` vazio) evitam recursão de políticas.
* Gabinetes: emendas são visíveis ao gabinete autor; compartilháveis com a instituição (`visibility = organization`); revisores enxergam emendas em tramitação (não rascunhos).
* Superadministrador: gerencia instituições, planos e vínculos; não possui política de leitura sobre emendas, documentos ou conversas. Métricas via `platform_metrics()` retornam apenas contagens.
* O papel `anon` não tem privilégio algum sobre o schema `public`.

## Garantias do fluxo de emendas (no banco)

1. **Revisão**: qualquer alteração substantiva (campos, destinações, anulações) incrementa `amendments.revision`.
2. **Validação**: só o servidor grava execuções (`record_validation_run`, exclusivo do service role), vinculadas à revisão; revisões obsoletas são rejeitadas.
3. **Status**: alterado apenas por `transition_amendment_status()`; um gatilho bloqueia `UPDATE` direto de status e protege colunas de validação e protocolo.
4. **"Validada tecnicamente"** exige validação automática `validated` na revisão atual **e** ação de um revisor; **"Aguardando assinatura"** exige revisão humana aprovada (configurável); **"Protocolada"** exige número e data informados manualmente — nunca simulada.
5. **Anulações** nascem não aprovadas; aprovação registra usuário e data; mudança de valor desfaz a aprovação.
6. **Versões** (instantâneos completos com classificações) são gravadas em cada tramitação e sob demanda — rastreabilidade histórica das informações usadas.

## Motor determinístico de validação

`shared/domain/amendments/engine.ts` executa:

* **Verificações estruturais** (sempre): campos obrigatórios, exercício, dados de destino e de anulação (conferência humana, versão vigente, aprovação), catálogo normativo.
* **Regras configuráveis e versionadas** (`legal_rules`), por tipo: anulação obrigatória, equilíbrio, despesas protegidas, compatibilidade de fontes, anulação limitada ao disponível (descontando compromissos de outras emendas), limite individual sobre a RCL, parcela mínima de saúde, faixa de valor, requisitos de OSC (Lei nº 13.019/2014), compatibilidade com o PPA, restrições de destinação e prazo.
* Resultado por verificação: `validated`, `pending`, `inconsistent`, `not_verifiable`. O resultado geral considera apenas verificações bloqueantes (ordem: inconsistente > não verificável > pendente > validado). **Sem regras ativas, nunca há "validado".**
* Regras federais não são aplicadas automaticamente: o catálogo (`rule_templates`) precisa ser adotado, ter a base legal local informada e a incidência confirmada por um administrador antes da ativação.

## Assistente de IA

* `server/ai/types.ts` define `LlmProvider`/`LlmSession` independentes de fornecedor; `providers/anthropic.ts` implementa com o SDK oficial (streaming, ferramentas com `eager_input_streaming`, pensamento adaptativo, fallback de recusa no servidor), saídas estruturadas (`messages.parse`) e transcrição de PDF (OCR).
* O orquestrador (`server/ai/assistant.ts`) mantém o laço de ferramentas, valida cada entrada com Zod, transmite eventos SSE e persiste mensagens e consumo.
* Ferramentas executam **com o JWT do usuário** — o RLS limita o que a IA pode ler ou gravar. Nenhuma ferramenta aprova anulações, altera status ou protocola.
* Trechos documentais são entregues ao modelo como **dados** (`<documento>`), com delimitadores neutralizados e alerta quando há padrões de *prompt injection* detectados na indexação.
* Sem credenciais, o assistente responde de forma transparente e oferece a interpretação determinística do pedido.

## Processamento documental

1. Upload direto ao bucket privado (caminho `org/documento/versão/arquivo`, política de Storage exige versão registrada e papel de administrador); hash SHA-256 calculado no navegador.
2. `enqueue_document_processing()` cria o job.
3. O worker (`server/documents/worker.ts`) processa em etapas persistidas: verificação (hash, assinatura binária, ZIP/macros/zip bomb) → extração (PDF/DOCX/XLSX/CSV) → OCR configurável para páginas sem texto → segmentação por artigos com página/seção → detecção de *prompt injection* → parser orçamentário → embeddings em lotes → finalização.
4. Ciclos curtos são acionados pela interface enquanto há processamento, pelo Vercel Cron e/ou pelo `pg_cron`. Falhas usam backoff exponencial até `max_attempts`.
5. Dotações extraídas entram como `pending_review`; a confirmação é humana (fila de conferência).

## Busca

* Orçamento: filtros estruturados + FTS em português sem acentos + similaridade trigram (`search_budget_allocations`).
* Documentos: híbrida FTS + vetorial com *Reciprocal Rank Fusion* (`search_document_chunks`), somente na versão vigente de documentos ativos.
* A busca vetorial complementa — nunca substitui — as consultas determinísticas às tabelas orçamentárias.
