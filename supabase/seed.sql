-- =============================================================================
-- LegisMind — SEED DE DESENVOLVIMENTO
-- ATENÇÃO: TODOS OS DADOS ABAIXO SÃO FICTÍCIOS E EXISTEM APENAS PARA
-- DEMONSTRAÇÃO E TESTES. Nenhum valor, código ou texto normativo deste arquivo
-- corresponde a orçamento ou legislação oficial de qualquer ente.
-- Não execute este arquivo em ambiente de produção.
-- Usuários não são criados aqui: use `node scripts/bootstrap-user.mjs`.
-- =============================================================================

-- Planos -----------------------------------------------------------------------
insert into public.plans (id, code, name, description, max_users, max_offices, max_storage_mb, max_documents, monthly_ai_requests, monthly_ai_tokens) values
  ('de000000-0000-4000-8000-0000000000a1', 'essencial', 'Essencial', 'Plano de entrada para Câmaras Municipais de pequeno porte.', 30, 15, 5120, 500, 3000, 30000000),
  ('de000000-0000-4000-8000-0000000000a2', 'institucional', 'Institucional', 'Plano para Câmaras de médio e grande porte e Assembleias.', 400, 120, 102400, 10000, 40000, 400000000)
on conflict (code) do nothing;

-- Instituição 1 (fictícia) --------------------------------------------------------
insert into public.organizations (id, name, short_name, kind, uf, municipality, slug, status, plan_id, is_demo, parliamentarians_count) values
  ('de000000-0000-4000-8000-000000000001',
   'Câmara Municipal de Vila Esperança (DEMONSTRAÇÃO — DADOS FICTÍCIOS)', 'CMVE (fictícia)',
   'camara_municipal', 'SP', 'Vila Esperança (município fictício)', 'demo-vila-esperanca', 'active',
   'de000000-0000-4000-8000-0000000000a2', true, 15);

update public.organization_settings
set institution_header = E'ESTADO DE SÃO PAULO\n**CÂMARA MUNICIPAL DE VILA ESPERANÇA (INSTITUIÇÃO FICTÍCIA DE DEMONSTRAÇÃO)**',
    institution_address = 'Endereço fictício — ambiente de demonstração',
    amendment_number_prefix = 'EMI',
    signature_city = 'Vila Esperança - SP',
    expense_nature_format = 'cg.mm.ee'
where organization_id = 'de000000-0000-4000-8000-000000000001';

insert into public.legislative_terms (id, organization_id, number, starts_on, ends_on) values
  ('de000000-0000-4000-8000-000000000101', 'de000000-0000-4000-8000-000000000001', 19, '2025-01-01', '2028-12-31');

insert into public.offices (id, organization_id, name, parliamentarian_name, parliamentarian_title, party, legislative_term_id) values
  ('de000000-0000-4000-8000-000000000201', 'de000000-0000-4000-8000-000000000001', 'Gabinete do Vereador João Exemplo (fictício)', 'João Exemplo', 'Vereador', 'PFX', 'de000000-0000-4000-8000-000000000101'),
  ('de000000-0000-4000-8000-000000000202', 'de000000-0000-4000-8000-000000000001', 'Gabinete da Vereadora Maria Modelo (fictícia)', 'Maria Modelo', 'Vereadora', 'PFY', 'de000000-0000-4000-8000-000000000101');

insert into public.fiscal_years (id, organization_id, year, phase, is_active, rcl_amount, rcl_reference, amendment_deadline, notes, bill_number, bill_summary) values
  ('de000000-0000-4000-8000-000000000301', 'de000000-0000-4000-8000-000000000001', 2027, 'ploa', true, 480000000.00,
   'Valor FICTÍCIO para demonstração (não corresponde a RREO real)', '2026-11-30', 'PLOA 2027 fictício — ambiente de demonstração',
   '000/2026 (FICTÍCIO)', 'Estima a receita e fixa a despesa do Município de Vila Esperança para o exercício financeiro de 2027. [EMENTA FICTÍCIA DE DEMONSTRAÇÃO]'),
  ('de000000-0000-4000-8000-000000000302', 'de000000-0000-4000-8000-000000000001', 2026, 'execution', false, 455000000.00,
   'Valor FICTÍCIO para demonstração', null, 'Exercício anterior fictício', null, null);

-- Modalidades de emenda -----------------------------------------------------------
insert into public.amendment_modalities (id, organization_id, code, name, description, requires_cancellation, is_impositive, counts_toward_individual_limit, legal_basis, kind, text_subtype, type_label) values
  ('de000000-0000-4000-8000-000000001601', 'de000000-0000-4000-8000-000000000001', 'individual_impositiva', 'Emenda individual impositiva',
   'Emenda individual de execução obrigatória ao projeto de lei orçamentária.', true, true, true, 'Lei Orgânica FICTÍCIA de Vila Esperança, art. 120', 'budget', null, 'Impositiva'),
  ('de000000-0000-4000-8000-000000001602', 'de000000-0000-4000-8000-000000000001', 'remanejamento', 'Emenda de remanejamento',
   'Emenda que remaneja dotações mediante anulação compensatória.', true, false, false, 'Lei Orgânica FICTÍCIA de Vila Esperança, art. 121', 'budget', null, 'Remanejamento'),
  ('de000000-0000-4000-8000-000000001603', 'de000000-0000-4000-8000-000000000001', 'texto_aditiva', 'Emenda ao texto — aditiva',
   'Acrescenta dispositivo ao texto do projeto de lei, sem alterar dotações.', false, false, false, 'Regimento Interno FICTÍCIO, art. 211', 'text', 'aditiva', 'Emenda ao texto'),
  ('de000000-0000-4000-8000-000000001604', 'de000000-0000-4000-8000-000000000001', 'texto_modificativa', 'Emenda ao texto — modificativa',
   'Altera a redação de dispositivo do projeto de lei, sem alterar dotações.', false, false, false, 'Regimento Interno FICTÍCIO, art. 211', 'text', 'modificativa', 'Emenda ao texto'),
  ('de000000-0000-4000-8000-000000001605', 'de000000-0000-4000-8000-000000000001', 'texto_supressiva', 'Emenda ao texto — supressiva',
   'Suprime dispositivo do projeto de lei, sem alterar dotações.', false, false, false, 'Regimento Interno FICTÍCIO, art. 211', 'text', 'supressiva', 'Emenda ao texto');

-- Regras adotadas (confirmação de incidência FICTÍCIA, apenas para demonstração) --
insert into public.legal_rules (id, organization_id, code, version, name, description, rule_type, params, legal_basis, sphere, severity, applies_to_modalities, status, local_incidence_confirmed, incidence_note, template_code) values
  ('de000000-0000-4000-8000-000000001701', 'de000000-0000-4000-8000-000000000001', 'ANULACAO_OBRIGATORIA', 1,
   'Indicação obrigatória de recursos por anulação', 'Emendas devem indicar recursos provenientes de anulação de despesa.',
   'cancellation_required', '{}', 'Lei Orgânica FICTÍCIA, art. 121, II (espelha CF/1988, art. 166, § 3º, II)', 'municipal', 'blocking', null, 'active', true,
   'Confirmação FICTÍCIA para o ambiente de demonstração.', 'ANULACAO_OBRIGATORIA'),
  ('de000000-0000-4000-8000-000000001702', 'de000000-0000-4000-8000-000000000001', 'EQUILIBRIO_ANULACAO', 1,
   'Equilíbrio entre acréscimos e anulações', 'Soma das anulações igual à soma das destinações.',
   'cancellation_balance', '{"tolerance_cents": 0}', 'Lei Orgânica FICTÍCIA, art. 121, II', 'municipal', 'blocking', null, 'active', true,
   'Confirmação FICTÍCIA para o ambiente de demonstração.', 'EQUILIBRIO_ANULACAO'),
  ('de000000-0000-4000-8000-000000001703', 'de000000-0000-4000-8000-000000000001', 'DESPESAS_PROTEGIDAS', 1,
   'Despesas que não podem ser anuladas', 'Pessoal e encargos, serviço da dívida e transferências constitucionais; reserva de contingência somente a específica para emendas.',
   'protected_expenses', '{"protected_groups": ["1", "2", "6"], "protected_elements": ["81"], "reserve_policy": "only_flagged"}',
   'Lei Orgânica FICTÍCIA, art. 121, II, "a" a "c"; LDO 2027 FICTÍCIA, art. 36', 'municipal', 'blocking', null, 'active', true,
   'Confirmação FICTÍCIA para o ambiente de demonstração.', 'DESPESAS_PROTEGIDAS'),
  ('de000000-0000-4000-8000-000000001704', 'de000000-0000-4000-8000-000000000001', 'COMPATIBILIDADE_FONTES', 1,
   'Compatibilidade de fontes de recursos', 'Anulação em fonte idêntica ou ambas não vinculadas.',
   'source_compatibility', '{"mode": "same_or_unearmarked"}', 'LC nº 101/2000 (LRF), art. 8º, parágrafo único', 'federal', 'blocking', null, 'active', true,
   'Confirmação FICTÍCIA para o ambiente de demonstração.', 'COMPATIBILIDADE_FONTES'),
  ('de000000-0000-4000-8000-000000001705', 'de000000-0000-4000-8000-000000000001', 'ANULACAO_LIMITE_DOTACAO', 1,
   'Anulação limitada ao valor disponível da dotação', 'Considera anulações já indicadas em outras emendas.',
   'cancellation_within_allocation', '{"consider_pending_commitments": true}', 'Lei Orgânica FICTÍCIA, art. 121, II', 'municipal', 'blocking', null, 'active', true,
   'Confirmação FICTÍCIA para o ambiente de demonstração.', 'ANULACAO_LIMITE_DOTACAO'),
  ('de000000-0000-4000-8000-000000001706', 'de000000-0000-4000-8000-000000000001', 'LIMITE_EMENDAS_INDIVIDUAIS', 1,
   'Limite das emendas individuais impositivas', '2% da RCL rateados igualmente entre 15 vereadores (parâmetros fictícios).',
   'individual_amendment_limit', '{"percent_of_rcl": 2.0, "split": "equal"}', 'Lei Orgânica FICTÍCIA, art. 120', 'municipal', 'blocking',
   array['individual_impositiva'], 'active', true, 'Confirmação FICTÍCIA para o ambiente de demonstração.', 'LIMITE_EMENDAS_INDIVIDUAIS'),
  ('de000000-0000-4000-8000-000000001707', 'de000000-0000-4000-8000-000000000001', 'SAUDE_METADE', 1,
   'Parcela mínima destinada à saúde', 'Metade das emendas individuais impositivas em ações e serviços públicos de saúde.',
   'health_share_minimum', '{"min_share_percent": 50, "health_function_code": "10"}', 'Lei Orgânica FICTÍCIA, art. 120', 'municipal', 'warning',
   array['individual_impositiva'], 'active', true, 'Confirmação FICTÍCIA para o ambiente de demonstração.', 'SAUDE_METADE'),
  ('de000000-0000-4000-8000-000000001708', 'de000000-0000-4000-8000-000000000001', 'REQUISITOS_OSC', 1,
   'Transferências a organizações da sociedade civil', 'Modalidade 50, elementos 41/42/43, CNPJ e autorização na LDO.',
   'osc_transfer_requirements', '{"required_modality": "50", "allowed_elements": ["41", "42", "43"], "require_cnpj": true, "ldo_authorization_reference": "LDO 2027 FICTÍCIA, art. 35"}',
   'Lei nº 13.019/2014 (arts. 29, 33 e 34); Lei nº 4.320/1964 (arts. 12, § 3º, I, 16 e 17); LDO 2027 FICTÍCIA, art. 35', 'municipal', 'blocking', null, 'active', true,
   'Confirmação FICTÍCIA para o ambiente de demonstração.', 'REQUISITOS_OSC'),
  ('de000000-0000-4000-8000-000000001709', 'de000000-0000-4000-8000-000000000001', 'COMPATIBILIDADE_PPA', 1,
   'Compatibilidade com o Plano Plurianual', 'Programa de destino deve constar do PPA.',
   'ppa_compatibility', '{}', 'Lei Orgânica FICTÍCIA, art. 121, I', 'municipal', 'blocking', null, 'active', true,
   'Confirmação FICTÍCIA para o ambiente de demonstração.', 'COMPATIBILIDADE_PPA'),
  ('de000000-0000-4000-8000-000000001710', 'de000000-0000-4000-8000-000000000001', 'RESTRICOES_DESTINACAO', 1,
   'Restrições de destinação', 'Vedada destinação a pessoal e dívida.',
   'destination_restrictions', '{"forbidden_groups": ["1", "2", "6"], "forbidden_elements": []}', 'LDO 2027 FICTÍCIA, art. 37', 'municipal', 'blocking', null, 'active', true,
   'Confirmação FICTÍCIA para o ambiente de demonstração.', 'RESTRICOES_DESTINACAO'),
  ('de000000-0000-4000-8000-000000001711', 'de000000-0000-4000-8000-000000000001', 'PRAZO_APRESENTACAO', 1,
   'Prazo de apresentação de emendas', 'Prazo do calendário do PLOA.',
   'submission_deadline', '{}', 'Regimento Interno FICTÍCIO, art. 210', 'interna', 'warning', null, 'active', true,
   'Confirmação FICTÍCIA para o ambiente de demonstração.', 'PRAZO_APRESENTACAO'),
  ('de000000-0000-4000-8000-000000001712', 'de000000-0000-4000-8000-000000000001', 'REQUISITOS_FORMULARIO', 1,
   'Campos obrigatórios do formulário de emenda', 'Descrição da despesa, meta física esperada, localização e justificativa (formulário oficial).',
   'required_fields', '{"fields": ["object", "physical_goal", "beneficiary_location", "justification"]}', 'Regimento Interno FICTÍCIO, art. 210', 'interna', 'blocking', null, 'active', true,
   'Confirmação FICTÍCIA para o ambiente de demonstração.', 'REQUISITOS_FORMULARIO');

-- Modelo oficial (fictício): formulário com quadros -------------------------------
insert into public.document_templates (id, organization_id, kind, name, description, body, status, is_default) values
  ('de000000-0000-4000-8000-000000001801', 'de000000-0000-4000-8000-000000000001', 'emenda_orcamentaria',
   'Formulário de emenda ao PLOA (fictício)', 'Autoria, acréscimo, cancelamento compensatório, objeto e meta física, beneficiário A/B, justificativa e declaração de conformidade.',
$tpl${{cabecalho}}

EMENDA AO PROJETO DE LEI Nº {{projeto_lei}}.

:::recuo
{{ementa_projeto}}
:::

## IDENTIFICAÇÃO DA AUTORIA
{{autoria}}

## ACRÉSCIMO À PROGRAMAÇÃO
{{acrescimo|Valor Destinado (R$)}}

## CANCELAMENTO COMPENSATÓRIO
{{cancelamento}}

## IDENTIFICAÇÃO E QUALIFICAÇÃO DO OBJETO
{{objeto_tabela}}

## IDENTIFICAÇÃO DO BENEFICIÁRIO / EXECUTOR
{{beneficiario_quadro}}

:::quadro JUSTIFICATIVA E INTERESSE PÚBLICO
{{justificativa}}
:::

:::quadro DECLARAÇÃO DE CONFORMIDADE E ASSINATURA
Declaro, para os devidos fins de direito e sob as penas da lei, que a presente indicação orçamentária: i) respeita as prioridades estabelecidas no Plano Plurianual (PPA) e na Lei de Diretrizes Orçamentárias (LDO); ii) cumpre as diretrizes de transparência e rastreabilidade, não contendo objeto genérico; e iii) em caso de destinação para obras, tenho ciência da prioridade legal para conclusão de obras inacabadas no município.
{{cidade}}, {{data_extenso}}.
{{assinatura_linha}}
:::
$tpl$, 'active', true);

-- Estrutura orçamentária — PLOA 2027 FICTÍCIO ---------------------------------------
insert into public.budget_sources (id, organization_id, fiscal_year_id, code, name, is_earmarked, earmark_description, verification_status) values
  ('de000000-0000-4000-8000-000000001401', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', '1.500.0000', 'Recursos não Vinculados de Impostos', false, null, 'confirmed'),
  ('de000000-0000-4000-8000-000000001402', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', '1.501.0000', 'Outros Recursos não Vinculados', false, null, 'confirmed'),
  ('de000000-0000-4000-8000-000000001403', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', '1.600.0000', 'Transferências Fundo a Fundo do SUS (vinculada)', true, 'Ações e serviços públicos de saúde', 'confirmed');

insert into public.budget_agencies (id, organization_id, fiscal_year_id, code, name, verification_status) values
  ('de000000-0000-4000-8000-000000001002', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', '02', 'Gabinete do Prefeito', 'confirmed'),
  ('de000000-0000-4000-8000-000000001005', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', '05', 'Secretaria Municipal de Educação', 'confirmed'),
  ('de000000-0000-4000-8000-000000001006', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', '06', 'Secretaria Municipal de Saúde', 'confirmed'),
  ('de000000-0000-4000-8000-000000001008', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', '08', 'Secretaria Municipal de Assistência Social', 'confirmed'),
  ('de000000-0000-4000-8000-000000001010', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', '10', 'Secretaria Municipal de Esportes e Lazer', 'confirmed'),
  ('de000000-0000-4000-8000-000000001011', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', '11', 'Secretaria Municipal de Cultura', 'confirmed'),
  ('de000000-0000-4000-8000-000000001012', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', '12', 'Secretaria Municipal de Obras e Serviços Urbanos', 'confirmed'),
  ('de000000-0000-4000-8000-000000001098', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', '98', 'Encargos Gerais do Município', 'confirmed'),
  ('de000000-0000-4000-8000-000000001099', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', '99', 'Reserva de Contingência', 'confirmed');

insert into public.budget_units (id, organization_id, fiscal_year_id, agency_id, code, name, verification_status) values
  ('de000000-0000-4000-8000-000000001102', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', 'de000000-0000-4000-8000-000000001002', '02.001', 'Gabinete do Prefeito', 'confirmed'),
  ('de000000-0000-4000-8000-000000001105', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', 'de000000-0000-4000-8000-000000001005', '05.001', 'Secretaria Municipal de Educação', 'confirmed'),
  ('de000000-0000-4000-8000-000000001106', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', 'de000000-0000-4000-8000-000000001006', '06.001', 'Fundo Municipal de Saúde', 'confirmed'),
  ('de000000-0000-4000-8000-000000001108', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', 'de000000-0000-4000-8000-000000001008', '08.001', 'Secretaria Municipal de Assistência Social', 'confirmed'),
  ('de000000-0000-4000-8000-000000001109', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', 'de000000-0000-4000-8000-000000001008', '08.002', 'Fundo Municipal dos Direitos da Criança e do Adolescente', 'confirmed'),
  ('de000000-0000-4000-8000-000000001110', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', 'de000000-0000-4000-8000-000000001010', '10.001', 'Secretaria Municipal de Esportes e Lazer', 'confirmed'),
  ('de000000-0000-4000-8000-000000001111', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', 'de000000-0000-4000-8000-000000001011', '11.001', 'Secretaria Municipal de Cultura', 'confirmed'),
  ('de000000-0000-4000-8000-000000001112', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', 'de000000-0000-4000-8000-000000001012', '12.001', 'Secretaria Municipal de Obras e Serviços Urbanos', 'confirmed'),
  ('de000000-0000-4000-8000-000000001198', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', 'de000000-0000-4000-8000-000000001098', '98.001', 'Encargos Gerais do Município', 'confirmed'),
  ('de000000-0000-4000-8000-000000001199', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', 'de000000-0000-4000-8000-000000001099', '99.999', 'Reserva de Contingência', 'confirmed');

insert into public.budget_programs (id, organization_id, fiscal_year_id, code, name, objective, ppa_reference, verification_status) values
  ('de000000-0000-4000-8000-000000001205', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', '0005', 'Esporte para Todos', 'Ampliar o acesso da população, especialmente crianças e adolescentes, a atividades esportivas comunitárias.', 'PPA 2026–2029 FICTÍCIO — Programa 0005', 'confirmed'),
  ('de000000-0000-4000-8000-000000001206', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', '0006', 'Lazer e Qualidade de Vida', 'Promover atividades de lazer nos bairros.', 'PPA 2026–2029 FICTÍCIO — Programa 0006', 'confirmed'),
  ('de000000-0000-4000-8000-000000001208', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', '0008', 'Proteção Social Básica', 'Prevenir situações de vulnerabilidade social.', 'PPA 2026–2029 FICTÍCIO — Programa 0008', 'confirmed'),
  ('de000000-0000-4000-8000-000000001209', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', '0009', 'Garantia de Direitos da Criança e do Adolescente', 'Fortalecer a rede de proteção à criança e ao adolescente.', 'PPA 2026–2029 FICTÍCIO — Programa 0009', 'confirmed'),
  ('de000000-0000-4000-8000-000000001212', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', '0012', 'Atenção Primária à Saúde', 'Ampliar a resolutividade da atenção básica.', 'PPA 2026–2029 FICTÍCIO — Programa 0012', 'confirmed'),
  ('de000000-0000-4000-8000-000000001215', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', '0015', 'Educação Básica de Qualidade', 'Melhorar os indicadores do ensino fundamental.', 'PPA 2026–2029 FICTÍCIO — Programa 0015', 'confirmed'),
  ('de000000-0000-4000-8000-000000001220', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', '0020', 'Cidade Bem Cuidada', 'Conservar vias e espaços públicos.', 'PPA 2026–2029 FICTÍCIO — Programa 0020', 'confirmed'),
  ('de000000-0000-4000-8000-000000001230', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', '0030', 'Gestão Administrativa', 'Manter os serviços administrativos do Executivo.', 'PPA 2026–2029 FICTÍCIO — Programa 0030', 'confirmed'),
  ('de000000-0000-4000-8000-000000001240', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', '0040', 'Cultura Viva', 'Fomentar a produção cultural comunitária.', null, 'pending_review'),
  ('de000000-0000-4000-8000-000000001290', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', '0090', 'Operações Especiais', null, 'PPA 2026–2029 FICTÍCIO — Operações Especiais', 'confirmed'),
  ('de000000-0000-4000-8000-000000001299', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', '9999', 'Reserva de Contingência', null, 'PPA 2026–2029 FICTÍCIO — Reserva de Contingência', 'confirmed');

insert into public.budget_actions (id, organization_id, fiscal_year_id, program_id, code, name, action_kind, description, verification_status) values
  ('de000000-0000-4000-8000-000000001350', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', 'de000000-0000-4000-8000-000000001205', '2050', 'Manutenção das Atividades Esportivas Comunitárias', 'atividade', 'Escolinhas esportivas, torneios e apoio a ligas comunitárias.', 'confirmed'),
  ('de000000-0000-4000-8000-000000001351', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', 'de000000-0000-4000-8000-000000001205', '2051', 'Apoio a Projetos Esportivos de Organizações da Sociedade Civil', 'atividade', 'Parcerias com OSC para projetos esportivos voltados a crianças e adolescentes.', 'confirmed'),
  ('de000000-0000-4000-8000-000000001352', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', 'de000000-0000-4000-8000-000000001205', '1052', 'Construção e Reforma de Espaços Esportivos', 'projeto', 'Quadras, campos e centros esportivos.', 'confirmed'),
  ('de000000-0000-4000-8000-000000001360', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', 'de000000-0000-4000-8000-000000001206', '2060', 'Programação de Lazer nos Bairros', 'atividade', 'Ruas de lazer e atividades recreativas.', 'pending_review'),
  ('de000000-0000-4000-8000-000000001380', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', 'de000000-0000-4000-8000-000000001208', '2080', 'Serviços de Convivência e Fortalecimento de Vínculos', 'atividade', 'SCFV para crianças, adolescentes e idosos.', 'confirmed'),
  ('de000000-0000-4000-8000-000000001390', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', 'de000000-0000-4000-8000-000000001209', '2090', 'Apoio a Entidades de Atendimento à Criança e ao Adolescente', 'atividade', 'Parcerias com entidades registradas no Conselho Municipal dos Direitos da Criança e do Adolescente.', 'confirmed'),
  ('de000000-0000-4000-8000-000000001320', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', 'de000000-0000-4000-8000-000000001212', '2120', 'Manutenção das Unidades Básicas de Saúde', 'atividade', null, 'confirmed'),
  ('de000000-0000-4000-8000-000000001322', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', 'de000000-0000-4000-8000-000000001212', '2122', 'Apoio a Entidades Filantrópicas de Saúde', 'atividade', null, 'confirmed'),
  ('de000000-0000-4000-8000-000000001315', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', 'de000000-0000-4000-8000-000000001215', '2150', 'Manutenção do Ensino Fundamental', 'atividade', null, 'confirmed'),
  ('de000000-0000-4000-8000-000000001330', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', 'de000000-0000-4000-8000-000000001220', '2200', 'Manutenção de Vias e Logradouros Públicos', 'atividade', null, 'confirmed'),
  ('de000000-0000-4000-8000-000000001340', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', 'de000000-0000-4000-8000-000000001230', '2300', 'Publicidade Institucional', 'atividade', null, 'confirmed'),
  ('de000000-0000-4000-8000-000000001341', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', 'de000000-0000-4000-8000-000000001230', '2301', 'Manutenção da Administração Geral', 'atividade', null, 'confirmed'),
  ('de000000-0000-4000-8000-000000001345', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', 'de000000-0000-4000-8000-000000001240', '2400', 'Eventos Culturais Comunitários', 'atividade', null, 'pending_review'),
  ('de000000-0000-4000-8000-000000001301', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', 'de000000-0000-4000-8000-000000001290', '0001', 'Serviço da Dívida Fundada Interna', 'operacao_especial', null, 'confirmed'),
  ('de000000-0000-4000-8000-000000001399', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', 'de000000-0000-4000-8000-000000001299', '9999', 'Reserva de Contingência', 'operacao_especial', null, 'confirmed'),
  ('de000000-0000-4000-8000-000000001398', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', 'de000000-0000-4000-8000-000000001299', '9998', 'Reserva para Emendas Individuais Impositivas', 'operacao_especial', 'Reserva específica para atendimento das emendas individuais (LDO 2027 fictícia, art. 36).', 'confirmed');

insert into public.budget_allocations (id, organization_id, fiscal_year_id, agency_id, unit_id, function_code, subfunction_code, program_id, action_id,
  expense_nature, source_id, allocation_code, description, authorized_amount, extra_identifiers, source_reference, source_page, verification_status, extraction_confidence, is_demo) values
  ('de000000-0000-4000-8000-000000001501', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', 'de000000-0000-4000-8000-000000001010', 'de000000-0000-4000-8000-000000001110', '27', '812', 'de000000-0000-4000-8000-000000001205', 'de000000-0000-4000-8000-000000001351',
   '3.3.50.41', 'de000000-0000-4000-8000-000000001401', 'F-0101', 'Contribuições a organizações da sociedade civil para projetos esportivos comunitários', 400000.00, '{}', 'PLOA 2027 FICTÍCIO — Anexo de programa de trabalho', 112, 'confirmed', 1, true),
  ('de000000-0000-4000-8000-000000001502', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', 'de000000-0000-4000-8000-000000001010', 'de000000-0000-4000-8000-000000001110', '27', '812', 'de000000-0000-4000-8000-000000001205', 'de000000-0000-4000-8000-000000001350',
   '3.3.90.39', 'de000000-0000-4000-8000-000000001401', 'F-0102', 'Serviços de terceiros para atividades esportivas', 850000.00, '{}', 'PLOA 2027 FICTÍCIO — Anexo de programa de trabalho', 112, 'confirmed', 1, true),
  ('de000000-0000-4000-8000-000000001503', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', 'de000000-0000-4000-8000-000000001010', 'de000000-0000-4000-8000-000000001110', '27', '812', 'de000000-0000-4000-8000-000000001205', 'de000000-0000-4000-8000-000000001350',
   '3.3.90.30', 'de000000-0000-4000-8000-000000001401', 'F-0103', 'Material esportivo de consumo', 120000.00, '{}', 'PLOA 2027 FICTÍCIO — Anexo de programa de trabalho', 112, 'confirmed', 1, true),
  ('de000000-0000-4000-8000-000000001504', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', 'de000000-0000-4000-8000-000000001010', 'de000000-0000-4000-8000-000000001110', '27', '812', 'de000000-0000-4000-8000-000000001205', 'de000000-0000-4000-8000-000000001352',
   '4.4.90.51', 'de000000-0000-4000-8000-000000001401', 'F-0104', 'Obras em espaços esportivos', 1200000.00, '{}', 'PLOA 2027 FICTÍCIO — Anexo de programa de trabalho', 113, 'confirmed', 1, true),
  ('de000000-0000-4000-8000-000000001505', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', 'de000000-0000-4000-8000-000000001010', 'de000000-0000-4000-8000-000000001110', '27', '813', 'de000000-0000-4000-8000-000000001206', 'de000000-0000-4000-8000-000000001360',
   '3.3.90.39', 'de000000-0000-4000-8000-000000001401', 'F-0105', 'Ruas de lazer', 300000.00, '{}', 'PLOA 2027 FICTÍCIO — Anexo de programa de trabalho', 113, 'pending_review', 0.74, true),
  ('de000000-0000-4000-8000-000000001506', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', 'de000000-0000-4000-8000-000000001008', 'de000000-0000-4000-8000-000000001109', '08', '243', 'de000000-0000-4000-8000-000000001209', 'de000000-0000-4000-8000-000000001390',
   '3.3.50.43', 'de000000-0000-4000-8000-000000001401', 'F-0201', 'Subvenções sociais a entidades de atendimento à criança e ao adolescente', 250000.00, '{}', 'PLOA 2027 FICTÍCIO — Anexo de programa de trabalho', 87, 'confirmed', 1, true),
  ('de000000-0000-4000-8000-000000001507', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', 'de000000-0000-4000-8000-000000001008', 'de000000-0000-4000-8000-000000001108', '08', '244', 'de000000-0000-4000-8000-000000001208', 'de000000-0000-4000-8000-000000001380',
   '3.3.90.39', 'de000000-0000-4000-8000-000000001402', 'F-0202', 'Execução do SCFV', 600000.00, '{}', 'PLOA 2027 FICTÍCIO — Anexo de programa de trabalho', 86, 'confirmed', 1, true),
  ('de000000-0000-4000-8000-000000001508', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', 'de000000-0000-4000-8000-000000001006', 'de000000-0000-4000-8000-000000001106', '10', '301', 'de000000-0000-4000-8000-000000001212', 'de000000-0000-4000-8000-000000001320',
   '3.3.90.30', 'de000000-0000-4000-8000-000000001401', 'F-0301', 'Material de consumo das UBS', 2400000.00, '{}', 'PLOA 2027 FICTÍCIO — Anexo de programa de trabalho', 64, 'confirmed', 1, true),
  ('de000000-0000-4000-8000-000000001509', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', 'de000000-0000-4000-8000-000000001006', 'de000000-0000-4000-8000-000000001106', '10', '301', 'de000000-0000-4000-8000-000000001212', 'de000000-0000-4000-8000-000000001320',
   '3.1.90.11', 'de000000-0000-4000-8000-000000001401', 'F-0302', 'Vencimentos do pessoal da atenção básica', 9800000.00, '{}', 'PLOA 2027 FICTÍCIO — Anexo de programa de trabalho', 64, 'confirmed', 1, true),
  ('de000000-0000-4000-8000-000000001510', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', 'de000000-0000-4000-8000-000000001006', 'de000000-0000-4000-8000-000000001106', '10', '301', 'de000000-0000-4000-8000-000000001212', 'de000000-0000-4000-8000-000000001322',
   '3.3.50.43', 'de000000-0000-4000-8000-000000001403', 'F-0303', 'Subvenções a entidades filantrópicas de saúde', 500000.00, '{}', 'PLOA 2027 FICTÍCIO — Anexo de programa de trabalho', 65, 'confirmed', 1, true),
  ('de000000-0000-4000-8000-000000001511', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', 'de000000-0000-4000-8000-000000001012', 'de000000-0000-4000-8000-000000001112', '15', '452', 'de000000-0000-4000-8000-000000001220', 'de000000-0000-4000-8000-000000001330',
   '3.3.90.39', 'de000000-0000-4000-8000-000000001401', 'F-0401', 'Conservação de vias e logradouros', 3500000.00, '{}', 'PLOA 2027 FICTÍCIO — Anexo de programa de trabalho', 140, 'confirmed', 1, true),
  ('de000000-0000-4000-8000-000000001512', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', 'de000000-0000-4000-8000-000000001002', 'de000000-0000-4000-8000-000000001102', '04', '131', 'de000000-0000-4000-8000-000000001230', 'de000000-0000-4000-8000-000000001340',
   '3.3.90.39', 'de000000-0000-4000-8000-000000001401', 'F-0501', 'Serviços de publicidade institucional', 900000.00, '{}', 'PLOA 2027 FICTÍCIO — Anexo de programa de trabalho', 22, 'confirmed', 1, true),
  ('de000000-0000-4000-8000-000000001513', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', 'de000000-0000-4000-8000-000000001002', 'de000000-0000-4000-8000-000000001102', '04', '122', 'de000000-0000-4000-8000-000000001230', 'de000000-0000-4000-8000-000000001341',
   '3.1.90.11', 'de000000-0000-4000-8000-000000001401', 'F-0502', 'Vencimentos do pessoal administrativo', 5200000.00, '{}', 'PLOA 2027 FICTÍCIO — Anexo de programa de trabalho', 22, 'confirmed', 1, true),
  ('de000000-0000-4000-8000-000000001514', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', 'de000000-0000-4000-8000-000000001002', 'de000000-0000-4000-8000-000000001102', '04', '122', 'de000000-0000-4000-8000-000000001230', 'de000000-0000-4000-8000-000000001341',
   '3.3.90.30', 'de000000-0000-4000-8000-000000001401', 'F-0503', 'Material de consumo administrativo', 450000.00, '{}', 'PLOA 2027 FICTÍCIO — Anexo de programa de trabalho', 23, 'confirmed', 1, true),
  ('de000000-0000-4000-8000-000000001515', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', 'de000000-0000-4000-8000-000000001098', 'de000000-0000-4000-8000-000000001198', '28', '843', 'de000000-0000-4000-8000-000000001290', 'de000000-0000-4000-8000-000000001301',
   '3.2.90.21', 'de000000-0000-4000-8000-000000001401', 'F-0901', 'Juros da dívida contratual', 700000.00, '{}', 'PLOA 2027 FICTÍCIO — Anexo de programa de trabalho', 150, 'confirmed', 1, true),
  ('de000000-0000-4000-8000-000000001516', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', 'de000000-0000-4000-8000-000000001098', 'de000000-0000-4000-8000-000000001198', '28', '843', 'de000000-0000-4000-8000-000000001290', 'de000000-0000-4000-8000-000000001301',
   '4.6.90.71', 'de000000-0000-4000-8000-000000001401', 'F-0902', 'Amortização da dívida contratual', 1100000.00, '{}', 'PLOA 2027 FICTÍCIO — Anexo de programa de trabalho', 150, 'confirmed', 1, true),
  ('de000000-0000-4000-8000-000000001517', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', 'de000000-0000-4000-8000-000000001099', 'de000000-0000-4000-8000-000000001199', '99', '999', 'de000000-0000-4000-8000-000000001299', 'de000000-0000-4000-8000-000000001399',
   '9.9.99.99.99', 'de000000-0000-4000-8000-000000001401', 'F-9901', 'Reserva de contingência geral', 2000000.00, '{}', 'PLOA 2027 FICTÍCIO — Anexo de programa de trabalho', 160, 'confirmed', 1, true),
  ('de000000-0000-4000-8000-000000001518', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', 'de000000-0000-4000-8000-000000001099', 'de000000-0000-4000-8000-000000001199', '99', '999', 'de000000-0000-4000-8000-000000001299', 'de000000-0000-4000-8000-000000001398',
   '9.9.99.99.99', 'de000000-0000-4000-8000-000000001401', 'F-9902', 'Reserva para atendimento de emendas individuais impositivas', 9600000.00, '{"reserva_emendas": true}', 'PLOA 2027 FICTÍCIO — Anexo de programa de trabalho', 160, 'confirmed', 1, true),
  ('de000000-0000-4000-8000-000000001519', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', 'de000000-0000-4000-8000-000000001005', 'de000000-0000-4000-8000-000000001105', '12', '361', 'de000000-0000-4000-8000-000000001215', 'de000000-0000-4000-8000-000000001315',
   '3.3.90.39', 'de000000-0000-4000-8000-000000001401', 'F-0601', 'Serviços para manutenção do ensino fundamental', 1800000.00, '{}', 'PLOA 2027 FICTÍCIO — Anexo de programa de trabalho', 45, 'confirmed', 1, true),
  ('de000000-0000-4000-8000-000000001520', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', 'de000000-0000-4000-8000-000000001011', 'de000000-0000-4000-8000-000000001111', '13', '392', 'de000000-0000-4000-8000-000000001240', 'de000000-0000-4000-8000-000000001345',
   '3.3.90.39', 'de000000-0000-4000-8000-000000001401', 'F-0701', 'Eventos culturais nos bairros', 380000.00, '{}', 'PLOA 2027 FICTÍCIO — Anexo de programa de trabalho', 98, 'pending_review', 0.62, true);

-- Exercício 2026 (fictício, inativo) — usado para demonstrar a troca de exercício
insert into public.budget_sources (id, organization_id, fiscal_year_id, code, name, is_earmarked, verification_status) values
  ('de000000-0000-4000-8000-000000002401', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000302', '1.500.0000', 'Recursos não Vinculados de Impostos', false, 'confirmed');
insert into public.budget_agencies (id, organization_id, fiscal_year_id, code, name, verification_status) values
  ('de000000-0000-4000-8000-000000002010', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000302', '10', 'Secretaria Municipal de Esportes e Lazer', 'confirmed');
insert into public.budget_units (id, organization_id, fiscal_year_id, agency_id, code, name, verification_status) values
  ('de000000-0000-4000-8000-000000002110', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000302', 'de000000-0000-4000-8000-000000002010', '10.001', 'Secretaria Municipal de Esportes e Lazer', 'confirmed');
insert into public.budget_programs (id, organization_id, fiscal_year_id, code, name, ppa_reference, verification_status) values
  ('de000000-0000-4000-8000-000000002205', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000302', '0005', 'Esporte para Todos', 'PPA 2026–2029 FICTÍCIO — Programa 0005', 'confirmed');
insert into public.budget_actions (id, organization_id, fiscal_year_id, program_id, code, name, action_kind, verification_status) values
  ('de000000-0000-4000-8000-000000002351', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000302', 'de000000-0000-4000-8000-000000002205', '2051', 'Apoio a Projetos Esportivos de Organizações da Sociedade Civil', 'atividade', 'confirmed');
insert into public.budget_allocations (id, organization_id, fiscal_year_id, agency_id, unit_id, function_code, subfunction_code, program_id, action_id,
  expense_nature, source_id, description, authorized_amount, available_amount, available_as_of, available_source, source_reference, verification_status, extraction_confidence, is_demo) values
  ('de000000-0000-4000-8000-000000002501', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000302', 'de000000-0000-4000-8000-000000002010', 'de000000-0000-4000-8000-000000002110', '27', '812', 'de000000-0000-4000-8000-000000002205', 'de000000-0000-4000-8000-000000002351',
   '3.3.50.41', 'de000000-0000-4000-8000-000000002401', 'Contribuições a OSC para projetos esportivos (2026)', 350000.00, 120000.00, '2026-09-30', 'Relatório de execução FICTÍCIO de 30/09/2026', 'LOA 2026 FICTÍCIA', 'confirmed', 1, true);

-- Base Legislativa: excertos FICTÍCIOS indexados (sem arquivo original) -------------
insert into public.documents (id, organization_id, fiscal_year_id, doc_type, title, legal_reference, sphere, description, publication_date, status) values
  ('de000000-0000-4000-8000-000000001901', 'de000000-0000-4000-8000-000000000001', null, 'lei_organica',
   'Lei Orgânica do Município de Vila Esperança (excerto FICTÍCIO)', 'Lei Orgânica FICTÍCIA de Vila Esperança', 'municipal',
   'Registro de demonstração sem arquivo original. Texto fictício.', '1990-04-05', 'active'),
  ('de000000-0000-4000-8000-000000001902', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', 'ldo',
   'Lei de Diretrizes Orçamentárias 2027 (excerto FICTÍCIO)', 'LDO 2027 FICTÍCIA de Vila Esperança', 'municipal',
   'Registro de demonstração sem arquivo original. Texto fictício.', '2026-07-15', 'active'),
  ('de000000-0000-4000-8000-000000001903', 'de000000-0000-4000-8000-000000000001', null, 'regimento_interno',
   'Regimento Interno da Câmara Municipal (excerto FICTÍCIO)', 'Resolução FICTÍCIA nº 1/2010', 'municipal',
   'Registro de demonstração sem arquivo original. Texto fictício.', '2010-02-01', 'active');

insert into public.document_versions (id, organization_id, document_id, version_number, storage_path, file_name, mime_type, size_bytes, processing_status, page_count, stats, change_notes, processed_at) values
  ('de000000-0000-4000-8000-000000001951', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000001901', 1,
   'de000000-0000-4000-8000-000000000001/de000000-0000-4000-8000-000000001901/de000000-0000-4000-8000-000000001951/lei-organica-ficticia.docx',
   'lei-organica-ficticia.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 1024, 'completed', 2, '{"seed": true, "chunks": 2}', 'Seed de demonstração', now()),
  ('de000000-0000-4000-8000-000000001952', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000001902', 1,
   'de000000-0000-4000-8000-000000000001/de000000-0000-4000-8000-000000001902/de000000-0000-4000-8000-000000001952/ldo-2027-ficticia.docx',
   'ldo-2027-ficticia.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 1024, 'completed', 2, '{"seed": true, "chunks": 3}', 'Seed de demonstração', now()),
  ('de000000-0000-4000-8000-000000001953', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000001903', 1,
   'de000000-0000-4000-8000-000000000001/de000000-0000-4000-8000-000000001903/de000000-0000-4000-8000-000000001953/regimento-ficticio.docx',
   'regimento-ficticio.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 1024, 'completed', 1, '{"seed": true, "chunks": 1}', 'Seed de demonstração', now());

update public.documents set current_version_id = 'de000000-0000-4000-8000-000000001951' where id = 'de000000-0000-4000-8000-000000001901';
update public.documents set current_version_id = 'de000000-0000-4000-8000-000000001952' where id = 'de000000-0000-4000-8000-000000001902';
update public.documents set current_version_id = 'de000000-0000-4000-8000-000000001953' where id = 'de000000-0000-4000-8000-000000001903';

insert into public.document_chunks (organization_id, document_id, version_id, chunk_index, page_start, page_end, section_path, content) values
  ('de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000001901', 'de000000-0000-4000-8000-000000001951', 0, 1, 1,
   'Título IV > Capítulo II > Art. 120 [TEXTO FICTÍCIO]',
   'Art. 120. As emendas individuais ao projeto de lei orçamentária anual serão aprovadas no limite de 2% (dois por cento) da receita corrente líquida prevista no projeto encaminhado pelo Poder Executivo, rateado igualmente entre os vereadores, sendo que a metade deste percentual será destinada a ações e serviços públicos de saúde. Parágrafo único. É obrigatória a execução orçamentária e financeira das programações oriundas de emendas individuais aprovadas, salvo impedimento de ordem técnica. [TEXTO FICTÍCIO DE DEMONSTRAÇÃO]'),
  ('de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000001901', 'de000000-0000-4000-8000-000000001951', 1, 2, 2,
   'Título IV > Capítulo II > Art. 121 [TEXTO FICTÍCIO]',
   'Art. 121. As emendas ao projeto de lei do orçamento anual somente podem ser aprovadas caso: I – sejam compatíveis com o plano plurianual e com a lei de diretrizes orçamentárias; II – indiquem os recursos necessários, admitidos apenas os provenientes de anulação de despesa, excluídas as que incidam sobre: a) dotações para pessoal e seus encargos; b) serviço da dívida; c) transferências tributárias constitucionais. [TEXTO FICTÍCIO DE DEMONSTRAÇÃO]'),
  ('de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000001902', 'de000000-0000-4000-8000-000000001952', 0, 1, 1,
   'Capítulo VI > Seção II > Art. 35 [TEXTO FICTÍCIO]',
   'Art. 35. A transferência de recursos a organizações da sociedade civil, inclusive as decorrentes de emendas parlamentares, observará a Lei Federal nº 13.019, de 31 de julho de 2014, e dependerá de: I – execução de atividades de natureza continuada nas áreas de assistência social, saúde, educação, cultura ou esporte; II – regularidade da entidade beneficiária; III – classificação na modalidade de aplicação 50 – Transferências a Instituições Privadas sem Fins Lucrativos. [TEXTO FICTÍCIO DE DEMONSTRAÇÃO]'),
  ('de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000001902', 'de000000-0000-4000-8000-000000001952', 1, 1, 2,
   'Capítulo VI > Seção II > Art. 36 [TEXTO FICTÍCIO]',
   'Art. 36. A Reserva de Contingência destinada ao atendimento de emendas individuais impositivas será identificada em ação orçamentária específica e somente poderá ser anulada para atender às emendas de que trata o art. 120 da Lei Orgânica. Parágrafo único. As demais dotações da Reserva de Contingência não poderão ser indicadas como fonte de anulação. [TEXTO FICTÍCIO DE DEMONSTRAÇÃO]'),
  ('de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000001902', 'de000000-0000-4000-8000-000000001952', 2, 2, 2,
   'Capítulo VI > Seção II > Art. 37 [TEXTO FICTÍCIO]',
   'Art. 37. É vedada a destinação de recursos de emendas parlamentares a despesas com pessoal e encargos sociais e ao serviço da dívida. [TEXTO FICTÍCIO DE DEMONSTRAÇÃO]'),
  ('de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000001903', 'de000000-0000-4000-8000-000000001953', 0, 1, 1,
   'Título VII > Capítulo III > Art. 210 [TEXTO FICTÍCIO]',
   'Art. 210. As emendas ao projeto de lei orçamentária anual serão apresentadas à Comissão de Finanças e Orçamento no prazo fixado em calendário aprovado pela Mesa, acompanhadas de justificativa e da indicação precisa das programações de acréscimo e de anulação. [TEXTO FICTÍCIO DE DEMONSTRAÇÃO]');

-- Emenda pré-existente do gabinete 2 (fictícia): consome parte da reserva para emendas
insert into public.amendments (id, organization_id, office_id, fiscal_year_id, modality_id, title, object, purpose, policy_area, justification, beneficiary_type, transfer_instrument, physical_goal, beneficiary_location) values
  ('de000000-0000-4000-8000-000000002901', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000202', 'de000000-0000-4000-8000-000000000301',
   'de000000-0000-4000-8000-000000001601', 'Reforma de quadra poliesportiva no bairro Jardim Fictício',
   'Reforma de quadra poliesportiva comunitária.', 'Ampliar o acesso a espaços esportivos.', 'Desporto e Lazer',
   'Emenda FICTÍCIA de demonstração.', 'own_administration', 'aplicacao_direta',
   '1 quadra poliesportiva reformada (meta FICTÍCIA)', 'Rua Fictícia, s/n — Jardim Fictício, Vila Esperança (endereço FICTÍCIO)');
insert into public.amendment_allocations (amendment_id, organization_id, fiscal_year_id, allocation_id, amount, origin) values
  ('de000000-0000-4000-8000-000000002901', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', 'de000000-0000-4000-8000-000000001504', 300000.00, 'user');
insert into public.amendment_cancellations (amendment_id, organization_id, fiscal_year_id, allocation_id, amount, justification, origin) values
  ('de000000-0000-4000-8000-000000002901', 'de000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000301', 'de000000-0000-4000-8000-000000001518', 300000.00, 'Utilização da reserva específica para emendas individuais.', 'user');

-- Instituição 2 (fictícia) — demonstra isolamento entre tenants -------------------
insert into public.organizations (id, name, short_name, kind, uf, slug, status, plan_id, is_demo, parliamentarians_count) values
  ('de000000-0000-4000-8000-000000000002', 'Assembleia Legislativa do Estado Exemplo (DEMONSTRAÇÃO — DADOS FICTÍCIOS)', 'ALEX (fictícia)',
   'assembleia_legislativa', 'GO', 'demo-assembleia-exemplo', 'trial', 'de000000-0000-4000-8000-0000000000a1', true, 41);
insert into public.offices (id, organization_id, name, parliamentarian_name, parliamentarian_title, party) values
  ('de000000-0000-4000-8000-000000003201', 'de000000-0000-4000-8000-000000000002', 'Gabinete da Deputada Ana Teste (fictícia)', 'Ana Teste', 'Deputada Estadual', 'PFZ');
insert into public.fiscal_years (id, organization_id, year, phase, is_active, notes) values
  ('de000000-0000-4000-8000-000000003301', 'de000000-0000-4000-8000-000000000002', 2027, 'ploa', true, 'Exercício fictício');
insert into public.amendment_modalities (id, organization_id, code, name, requires_cancellation, is_impositive, counts_toward_individual_limit) values
  ('de000000-0000-4000-8000-000000003601', 'de000000-0000-4000-8000-000000000002', 'individual_impositiva', 'Emenda individual impositiva', true, true, true);
