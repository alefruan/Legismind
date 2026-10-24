# Segurança e LGPD

## Controles implementados

| Tema | Implementação |
|---|---|
| Isolamento entre instituições | RLS em todas as tabelas expostas; funções de autorização `security definer` com `search_path` vazio; chaves estrangeiras compostas impedem referências cruzadas entre instituições e exercícios; testes automatizados com papéis reais (`authenticated`, `anon`, `service_role`). |
| Papel anônimo | Sem privilégios em tabelas, sequências e funções do schema `public` (inclusive objetos futuros). |
| Segredos | Somente a URL do Supabase e a chave anônima chegam ao navegador. Service role, chaves de IA, embeddings e OCR existem apenas nas funções de servidor. |
| Autorização no servidor | Cada rota valida o JWT (`auth.getUser`), verifica vínculo/papel e usa o cliente **com o JWT do usuário** para ler dados (RLS aplicada). A service role é usada só depois da verificação, para operações confiáveis (gravação de validações, worker, auditoria, compromissos agregados). |
| Integridade do fluxo | Status, validação, protocolo, numeração e revisão são protegidos por gatilhos; validações só são gravadas pelo servidor e vinculadas à revisão. Colunas sensíveis têm privilégios de atualização por coluna. |
| Uploads | Bucket privado; política de Storage exige papel de administrador e versão previamente registrada no caminho da instituição; tamanho máximo 100 MB e tipos restritos (PDF, DOCX, XLSX, CSV) no bucket e no banco; hash SHA-256 conferido no worker; verificação de assinatura binária; inspeção de ZIP (macros `vbaProject.bin`, binários embutidos, taxa de compressão anômala); arquivos reprovados são removidos; originais são imutáveis para usuários; download por URL assinada de curta duração. |
| Fórmulas e macros | Planilhas são lidas pelos valores armazenados — fórmulas nunca são avaliadas. DOCX com macros é rejeitado. |
| Prompt injection | Detecção de padrões na indexação (marcação do trecho e registro de inconsistência); trechos entregues ao modelo como dados delimitados, com delimitadores neutralizados; prompt do sistema instrui a nunca seguir instruções de documentos; ferramentas executam com as permissões do usuário e nenhuma delas aprova anulações, altera tramitação ou protocola. Entradas de ferramentas são revalidadas com Zod. |
| Limites | Limitação de requisições por usuário (tabela `api_rate_limits`), cotas mensais de IA por plano/instituição, limite de rodadas de ferramentas, tamanho máximo de mensagens e corpos JSON. |
| Auditoria | Gatilhos registram criação/alteração/exclusão (somente nomes de colunas alteradas, sem valores) em vínculos, gabinetes, exercícios, regras, modelos, documentos, configurações e emendas; tramitações, enfileiramentos e exportações também são registrados. Tabela sem escrita direta por usuários. |
| Cabeçalhos HTTP | CSP restritiva, HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`; respostas de API com `Cache-Control: no-store`. |
| Senhas e sessões | Supabase Auth (e-mail e senha; tokens de convite/recuperação de uso único); senha mínima de 10 caracteres com letras e números; cadastro público desabilitado (somente convite); resposta neutra na recuperação de senha (evita enumeração de contas). |

## LGPD

* **Minimização**: perfis guardam apenas nome, cargo e telefone opcionais; auditoria não registra valores alterados.
* **Finalidade e acesso**: dados de gabinetes são acessíveis apenas ao gabinete, a revisores (após envio) e, quando compartilhados, à instituição. A administração da plataforma vê apenas métricas agregadas.
* **Retenção**: `apply_retention_policies()` remove mensagens de IA e registros de auditoria conforme prazos configuráveis por instituição (padrões: 365 dias e 5 anos) e eventos de processamento após 180 dias. Agende com `pg_cron` (README).
* **Operadores**: ao habilitar provedores de IA, embeddings ou OCR, o conteúdo enviado (pedidos, trechos de documentos públicos, PDFs para OCR) é tratado pelo fornecedor. Avalie os termos de tratamento de dados, a região de processamento e a política de retenção do fornecedor antes de habilitar em produção; documentos sigilosos não devem ser enviados à Base Legislativa.
* **Direitos do titular**: exclusão de usuário no Supabase Auth remove perfil e vínculos em cascata; conversas podem ser excluídas pelo próprio usuário.

## Dependências com alertas conhecidos

`npm audit` aponta alertas moderados em dependências transitivas: `uuid` (via ExcelJS — só afeta chamadas que recebem `buf`, não utilizadas) e `sprintf-js`/`argparse` (via mammoth — usados apenas pela CLI do mammoth). Reavaliar a cada atualização.

## Recomendações para produção

* Projeto Supabase em região brasileira, backups diários (PITR), MFA para administradores.
* SMTP próprio com SPF/DKIM.
* Rotacionar `SUPABASE_SERVICE_ROLE_KEY`, chaves de IA e `CRON_SECRET` periodicamente.
* Monitorar `processing_jobs` com falha e o consumo em Administração → Consumo de IA.
* Revisar a CSP caso utilize domínio próprio para o Supabase.
