# Status da implementação

Atualizado em 24/10/2026.

## Funcional e testado localmente

| Área | Situação | Verificação |
|---|---|---|
| Migrations SQL (10), RLS, funções, gatilhos, storage, catálogos normativos, seed fictício | Completo | Aplicadas em PGlite; 36 testes de banco |
| Motor determinístico de validação (12 tipos de regra + verificações estruturais) | Completo | 25 testes |
| Análise de candidatas a anulação | Completo | 4 testes |
| Geração da minuta no formato de formulário (cabeçalho em todas as páginas, quadros de autoria/acréscimo/cancelamento/objeto, beneficiário A/B, declaração e assinatura), modelos pré-definidos (orçamentária e emendas ao texto aditiva/modificativa/supressiva), exportação DOCX e PDF | Completo | Testes com extração do arquivo gerado + conferência visual do PDF |
| Emendas ao texto (sem dotações) e regra "campos obrigatórios do formulário" | Completo | Testes do motor e do banco |
| Extração PDF/DOCX/XLSX/CSV, parser orçamentário, segmentação, segurança de arquivos | Completo | Testes com arquivos gerados em memória |
| API (roteador, autenticação, erros, SSE) e servidor de desenvolvimento | Completo | Testes do roteador + teste de fumaça do `vite dev` |
| Interface completa (autenticação, painel, assistente, emendas, explorador, Base Legislativa, conferência, administração, plataforma, módulos) | Implementada | Typecheck estrito + build de produção |

## Depende de credenciais ou serviços externos

| Funcionalidade | Requisito |
|---|---|
| Login, dados e Storage | Projeto Supabase com as migrations aplicadas |
| Assistente com IA, busca em linguagem natural por IA | `ANTHROPIC_API_KEY` (sem ela: modo determinístico transparente) |
| Busca semântica | `EMBEDDINGS_PROVIDER` + chave Voyage ou OpenAI (sem ela: busca textual) |
| OCR de PDFs digitalizados | `OCR_PROVIDER=anthropic` (usa a chave da Anthropic) ou serviço HTTP |
| E-mails de convite e recuperação | SMTP configurado no Supabase |
| Processamento periódico sem interface aberta | Vercel Cron (`CRON_SECRET`) e/ou `pg_cron` + `pg_net` |

## Não verificado neste ambiente

* Execução contra um Supabase real (PostgREST/Storage/Auth) e chamadas reais à API da Anthropic — não havia credenciais nem Docker disponíveis. As migrations foram validadas em PostgreSQL 17 (PGlite) com emulação dos papéis e funções do Supabase; a integração HTTP com o Supabase segue a API pública do `supabase-js`.
* Implantação na Vercel (o roteamento por reescrita e a assinatura Web das funções seguem a documentação da plataforma; validar `maxDuration` conforme o plano).
* Revisão visual em navegador (a interface foi verificada por tipos e build).

## Limitações conhecidas

* O parser de anexos orçamentários em PDF é heurístico (linhas com classificação completa); layouts muito distintos produzem inconsistências para conferência — planilhas (XLSX/CSV) são o formato recomendado para importação.
* O catálogo de subfunções é um subconjunto da Portaria MOG nº 42/1999; códigos ausentes geram aviso "não verificável" (não bloqueante) até que o catálogo seja completado.
* Regras de limite individual e parcela de saúde usam parâmetros por instituição; não há cálculo automático da RCL a partir de relatórios fiscais.
* Exportação PDF usa fontes padrão (WinAnsi); caracteres fora desse conjunto são substituídos.

## Próximos passos sugeridos

1. Testes ponta a ponta (Playwright) contra um projeto Supabase de homologação.
2. Redator Legislativo: modelos de projetos de lei, requerimentos, indicações, moções e ofícios; emendas ao texto.
3. Consultor Jurídico: análise de competência e iniciativa com regras configuráveis.
4. Gestão de Gabinete: demandas e tarefas por assessor.
5. Importação de saldos de execução (relatórios do sistema contábil) para `available_amount`.
6. Geração de tipos com `supabase gen types` e tipagem completa do cliente.
7. Integração com sistemas de protocolo/assinatura (SAPL, SEI, ICP-Brasil) mediante autorização específica.
