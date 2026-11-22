-- =============================================================================
-- LegisMind — configuração inicial: Câmara Municipal de Paulo Afonso (BA), PLOA 2027
--
-- Baseado nos modelos de emenda (impositiva, remanejamento, texto aditiva e
-- modificativa) do PLOA 2026 enviados como referência.
--
-- O QUE ESTE SCRIPT FAZ
--   1. Cabeçalho, local de assinatura e formato da natureza (44.50.42).
--   2. Exercício 2027 (PLOA) ativo, com a ementa do projeto.
--   3. Tipos de emenda: impositiva, remanejamento e emendas ao texto.
--   4. Modelos de documento no formato de formulário.
--   5. Regras de validação a partir dos modelos da plataforma.
--   6. Dotações de EXEMPLO para testar o fluxo completo (ver aviso abaixo).
--
-- ATENÇÃO — DOTAÇÕES DE EXEMPLO
--   Os códigos orçamentários abaixo NÃO são do PLOA de Paulo Afonso: saúde e
--   reserva reproduzem o modelo de referência; esporte usa códigos locais
--   fictícios. Por isso entram marcadas como DEMONSTRAÇÃO (is_demo) e "pendente
--   de conferência". A minuta sai com marca d'água "DADOS FICTÍCIOS" e não serve
--   para protocolo. Para uso oficial, importe o PLOA real na Base Legislativa e
--   apague as dotações de exemplo (bloco no fim deste arquivo).
--
-- Pré-requisito: migração 20261024000010 aplicada.
-- Execute no SQL Editor do Supabase. Pode ser executado mais de uma vez.
-- =============================================================================

do $$
declare
  v_org uuid;
  v_fy uuid;
  v_tpl_budget uuid;
  v_tpl_aditiva uuid;
  v_tpl_modificativa uuid;
  v_tpl_supressiva uuid;
  -- estrutura orçamentária de exemplo
  v_src uuid;
  v_ag_saude uuid; v_un_saude uuid; v_pg_saude uuid; v_ac_saude uuid;
  v_ag_esporte uuid; v_un_esporte uuid; v_pg_esporte uuid; v_ac_esporte uuid;
  v_ag_reserva uuid; v_un_reserva uuid; v_pg_reserva uuid; v_ac_reserva uuid;
  v_ref constant text := 'EXEMPLO para teste — substituir pelo PLOA 2027 de Paulo Afonso';
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'amendment_modalities' and column_name = 'kind') then
    raise exception 'Aplique antes a migração 20261024000010_amendment_forms_text_amendments.sql.';
  end if;

  select id into v_org from public.organizations where name ilike '%Paulo Afonso%' order by created_at limit 1;
  if v_org is null then
    raise exception 'Instituição "Paulo Afonso" não encontrada em public.organizations.';
  end if;

  -- 1. Configurações da instituição ------------------------------------------
  update public.organization_settings
     set institution_header = E'ESTADO DA BAHIA\n**CÂMARA MUNICIPAL DE PAULO AFONSO**',
         signature_city = 'Paulo Afonso - BA',
         expense_nature_format = 'cg.mm.ee'
   where organization_id = v_org;

  -- 2. Exercício 2027 -----------------------------------------------------------
  update public.fiscal_years set is_active = false where organization_id = v_org and year <> 2027 and is_active;
  insert into public.fiscal_years (organization_id, year, phase, is_active, bill_number, bill_summary, notes)
  values (v_org, 2027, 'ploa', true,
          null, -- preencha o nº do Projeto de Lei (Administração → Exercícios)
          'Estima a Receita e Fixa a Despesa do Município de Paulo Afonso - BA, para o Exercício Financeiro 2027.',
          'Criado pelo script de configuração inicial. Informar nº do PLOA, RCL de referência e prazo de emendas.')
  on conflict (organization_id, year) do update
     set is_active = true,
         phase = excluded.phase,
         bill_summary = coalesce(public.fiscal_years.bill_summary, excluded.bill_summary);
  select id into v_fy from public.fiscal_years where organization_id = v_org and year = 2027;

  -- 3. Modelos de documento ------------------------------------------------------
  update public.document_templates set is_default = false
   where organization_id = v_org and kind = 'emenda_orcamentaria' and is_default and name <> 'Formulário de emenda orçamentária (impositiva / remanejamento)';

  insert into public.document_templates (organization_id, kind, name, description, body, status, is_default)
  select v_org, 'emenda_orcamentaria', 'Formulário de emenda orçamentária (impositiva / remanejamento)',
         'Autoria, acréscimo, cancelamento compensatório, objeto e meta física, beneficiário A/B, justificativa e declaração.',
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
$tpl$, 'active', true
  where not exists (select 1 from public.document_templates where organization_id = v_org and name = 'Formulário de emenda orçamentária (impositiva / remanejamento)');

  insert into public.document_templates (organization_id, kind, name, description, body, status, is_default)
  select v_org, 'emenda_texto', 'Formulário de emenda ao texto — aditiva', 'Comando da emenda e texto a ser acrescido.',
         $tpl${{cabecalho}}

EMENDA AO PROJETO DE LEI Nº {{projeto_lei}}.

:::recuo
{{ementa_projeto}}
:::

## IDENTIFICAÇÃO DA AUTORIA
{{autoria}}

:::quadro EMENDA ADITIVA
{{comando_texto}}
**Texto a ser acrescido:**
{{texto_novo}}
:::

:::quadro DECLARAÇÃO DE CONFORMIDADE E ASSINATURA
Declaro, para os devidos fins de direito e sob as penas da lei, que a presente emenda ao texto do PLOA: i) não exclui matéria obrigatória; ii) não inclui matéria vedada; iii) não altera o valor total da despesa fixada; e iv) não altera o valor da previsão da receita.
{{cidade}}, {{data_extenso}}.
{{assinatura_linha}}
:::
$tpl$, 'active', false
  where not exists (select 1 from public.document_templates where organization_id = v_org and name = 'Formulário de emenda ao texto — aditiva');

  insert into public.document_templates (organization_id, kind, name, description, body, status, is_default)
  select v_org, 'emenda_texto', 'Formulário de emenda ao texto — modificativa', 'Texto original e nova redação.',
         $tpl${{cabecalho}}

EMENDA AO PROJETO DE LEI Nº {{projeto_lei}}.

:::recuo
{{ementa_projeto}}
:::

## IDENTIFICAÇÃO DA AUTORIA
{{autoria}}

:::quadro EMENDA MODIFICATIVA
{{comando_texto}}
**Texto a ser modificado (original):**
{{texto_original}}
**Texto modificado (nova redação):**
{{texto_novo}}
:::

:::quadro DECLARAÇÃO DE CONFORMIDADE E ASSINATURA
Declaro, para os devidos fins de direito e sob as penas da lei, que a presente emenda ao texto do PLOA: i) não exclui matéria obrigatória; ii) não inclui matéria vedada; iii) não altera o valor total da despesa fixada; e iv) não altera o valor da previsão da receita.
{{cidade}}, {{data_extenso}}.
{{assinatura_linha}}
:::
$tpl$, 'active', false
  where not exists (select 1 from public.document_templates where organization_id = v_org and name = 'Formulário de emenda ao texto — modificativa');

  insert into public.document_templates (organization_id, kind, name, description, body, status, is_default)
  select v_org, 'emenda_texto', 'Formulário de emenda ao texto — supressiva', 'Texto a ser suprimido.',
         $tpl${{cabecalho}}

EMENDA AO PROJETO DE LEI Nº {{projeto_lei}}.

:::recuo
{{ementa_projeto}}
:::

## IDENTIFICAÇÃO DA AUTORIA
{{autoria}}

:::quadro EMENDA SUPRESSIVA
{{comando_texto}}
**Texto a ser suprimido:**
{{texto_original}}
:::

:::quadro DECLARAÇÃO DE CONFORMIDADE E ASSINATURA
Declaro, para os devidos fins de direito e sob as penas da lei, que a presente emenda ao texto do PLOA: i) não exclui matéria obrigatória; ii) não inclui matéria vedada; iii) não altera o valor total da despesa fixada; e iv) não altera o valor da previsão da receita.
{{cidade}}, {{data_extenso}}.
{{assinatura_linha}}
:::
$tpl$, 'active', false
  where not exists (select 1 from public.document_templates where organization_id = v_org and name = 'Formulário de emenda ao texto — supressiva');

  select id into v_tpl_budget from public.document_templates where organization_id = v_org and name = 'Formulário de emenda orçamentária (impositiva / remanejamento)';
  select id into v_tpl_aditiva from public.document_templates where organization_id = v_org and name = 'Formulário de emenda ao texto — aditiva';
  select id into v_tpl_modificativa from public.document_templates where organization_id = v_org and name = 'Formulário de emenda ao texto — modificativa';
  select id into v_tpl_supressiva from public.document_templates where organization_id = v_org and name = 'Formulário de emenda ao texto — supressiva';

  -- 4. Tipos de emenda (modalidades) -------------------------------------------
  insert into public.amendment_modalities
    (organization_id, code, name, description, kind, text_subtype, type_label, template_id, requires_cancellation, is_impositive, counts_toward_individual_limit, legal_basis, is_active)
  values
    (v_org, 'individual_impositiva', 'Emenda individual impositiva', 'Emenda individual de execução obrigatória, custeada pela reserva para emendas parlamentares (cota-parte).',
     'budget', null, 'Impositiva', v_tpl_budget, true, true, true, 'Lei Orgânica do Município — indicar dispositivo', true),
    (v_org, 'remanejamento', 'Emenda de remanejamento', 'Remaneja dotações mediante cancelamento compensatório.',
     'budget', null, 'Remanejamento', v_tpl_budget, true, false, false, 'Lei Orgânica do Município — indicar dispositivo', true),
    (v_org, 'texto_aditiva', 'Emenda ao texto — aditiva', 'Acrescenta dispositivo ao texto do projeto, sem alterar dotações.',
     'text', 'aditiva', 'Texto', v_tpl_aditiva, false, false, false, 'Regimento Interno — indicar dispositivo', true),
    (v_org, 'texto_modificativa', 'Emenda ao texto — modificativa', 'Altera a redação de dispositivo do projeto, sem alterar dotações.',
     'text', 'modificativa', 'Texto', v_tpl_modificativa, false, false, false, 'Regimento Interno — indicar dispositivo', true),
    (v_org, 'texto_supressiva', 'Emenda ao texto — supressiva', 'Suprime dispositivo do projeto, sem alterar dotações.',
     'text', 'supressiva', 'Texto', v_tpl_supressiva, false, false, false, 'Regimento Interno — indicar dispositivo', true)
  on conflict (organization_id, code) do update
     set name = excluded.name, description = excluded.description, kind = excluded.kind, text_subtype = excluded.text_subtype,
         type_label = excluded.type_label, template_id = excluded.template_id, requires_cancellation = excluded.requires_cancellation,
         is_impositive = excluded.is_impositive, counts_toward_individual_limit = excluded.counts_toward_individual_limit, is_active = true;

  -- 5. Regras de validação (modelos da plataforma) -----------------------------
  -- Ativadas para permitir a validação. CONFIRA a base legal local e os parâmetros
  -- em Administração → Regras e publique nova versão se algo divergir.
  insert into public.legal_rules
    (organization_id, code, version, name, description, rule_type, params, legal_basis, sphere, severity,
     applies_to_modalities, status, local_incidence_confirmed, incidence_note, template_code)
  select v_org, rt.code, 1, rt.name, rt.description, rt.rule_type,
         case rt.code
           when 'REQUISITOS_OSC' then rt.default_params || '{"ldo_authorization_reference": "LDO 2027 de Paulo Afonso — indicar artigo"}'::jsonb
           else rt.default_params
         end,
         rt.legal_basis, rt.sphere, rt.severity,
         case when rt.code in ('LIMITE_EMENDAS_INDIVIDUAIS', 'SAUDE_METADE') then array['individual_impositiva'] end,
         'active', true,
         'Ativada pelo script de configuração inicial — conferir com a Lei Orgânica, a LDO e o Regimento de Paulo Afonso.',
         rt.code
    from public.rule_templates rt
   where rt.code in ('ANULACAO_OBRIGATORIA', 'EQUILIBRIO_ANULACAO', 'DESPESAS_PROTEGIDAS', 'COMPATIBILIDADE_FONTES',
                     'ANULACAO_LIMITE_DOTACAO', 'LIMITE_EMENDAS_INDIVIDUAIS', 'SAUDE_METADE', 'REQUISITOS_OSC',
                     'RESTRICOES_DESTINACAO', 'PRAZO_APRESENTACAO', 'REQUISITOS_FORMULARIO')
     and not exists (select 1 from public.legal_rules lr where lr.organization_id = v_org and lr.code = rt.code);

  -- 6. Dotações de EXEMPLO -------------------------------------------------------
  if exists (select 1 from public.budget_allocations where organization_id = v_org and fiscal_year_id = v_fy and is_demo) then
    raise notice 'Dotações de exemplo já existem — etapa 6 ignorada.';
    return;
  end if;

  insert into public.budget_sources (organization_id, fiscal_year_id, code, name, is_earmarked)
  values (v_org, v_fy, '1.5.00', 'Recursos não Vinculados de Impostos (EXEMPLO)', false)
  on conflict (fiscal_year_id, code) do nothing;
  select id into v_src from public.budget_sources where fiscal_year_id = v_fy and code = '1.5.00';

  -- Saúde (conforme modelo de referência)
  insert into public.budget_agencies (organization_id, fiscal_year_id, code, name) values (v_org, v_fy, '13000', 'Secretaria Municipal de Saúde (EXEMPLO)') returning id into v_ag_saude;
  insert into public.budget_units (organization_id, fiscal_year_id, agency_id, code, name) values (v_org, v_fy, v_ag_saude, '13301', 'Fundo Municipal de Saúde (EXEMPLO)') returning id into v_un_saude;
  insert into public.budget_programs (organization_id, fiscal_year_id, code, name) values (v_org, v_fy, '5005', 'Atenção à Saúde (EXEMPLO)') returning id into v_pg_saude;
  insert into public.budget_actions (organization_id, fiscal_year_id, program_id, code, name, action_kind)
    values (v_org, v_fy, v_pg_saude, '462871', 'Aquisição de Equipamentos para a Rede de Saúde (EXEMPLO)', 'projeto') returning id into v_ac_saude;

  -- Esporte (códigos locais FICTÍCIOS; função/subfunção e natureza seguem a classificação nacional)
  insert into public.budget_agencies (organization_id, fiscal_year_id, code, name) values (v_org, v_fy, '21000', 'Secretaria Municipal de Esporte e Lazer (EXEMPLO)') returning id into v_ag_esporte;
  insert into public.budget_units (organization_id, fiscal_year_id, agency_id, code, name) values (v_org, v_fy, v_ag_esporte, '21101', 'Secretaria Municipal de Esporte e Lazer (EXEMPLO)') returning id into v_un_esporte;
  insert into public.budget_programs (organization_id, fiscal_year_id, code, name) values (v_org, v_fy, '5010', 'Esporte e Lazer para Todos (EXEMPLO)') returning id into v_pg_esporte;
  insert into public.budget_actions (organization_id, fiscal_year_id, program_id, code, name, action_kind)
    values (v_org, v_fy, v_pg_esporte, '262010', 'Apoio a Entidades Esportivas sem Fins Lucrativos (EXEMPLO)', 'atividade') returning id into v_ac_esporte;

  -- Reserva de contingência para emendas (conforme modelo de referência)
  insert into public.budget_agencies (organization_id, fiscal_year_id, code, name) values (v_org, v_fy, '20.000', 'Reserva de contingência para emendas parlamentares (EXEMPLO)') returning id into v_ag_reserva;
  insert into public.budget_units (organization_id, fiscal_year_id, agency_id, code, name) values (v_org, v_fy, v_ag_reserva, '20.101', 'Reserva de contingência para emendas parlamentares (EXEMPLO)') returning id into v_un_reserva;
  insert into public.budget_programs (organization_id, fiscal_year_id, code, name) values (v_org, v_fy, '9999', 'Reserva de Contingência (EXEMPLO)') returning id into v_pg_reserva;
  insert into public.budget_actions (organization_id, fiscal_year_id, program_id, code, name, action_kind)
    values (v_org, v_fy, v_pg_reserva, '209998', 'Reserva para Emendas Parlamentares Individuais (EXEMPLO)', 'operacao_especial') returning id into v_ac_reserva;

  insert into public.budget_allocations
    (organization_id, fiscal_year_id, agency_id, unit_id, function_code, subfunction_code, program_id, action_id,
     expense_nature, source_id, description, authorized_amount, extra_identifiers, source_reference, is_demo)
  values
    (v_org, v_fy, v_ag_saude, v_un_saude, '10', '302', v_pg_saude, v_ac_saude,
     '4.4.50.42', v_src, 'Auxílios a entidades privadas sem fins lucrativos — saúde (EXEMPLO)', 1000000.00, '{}', v_ref, true),
    (v_org, v_fy, v_ag_esporte, v_un_esporte, '27', '812', v_pg_esporte, v_ac_esporte,
     '3.3.50.43', v_src, 'Subvenções sociais a entidades esportivas — manutenção (EXEMPLO)', 1000000.00, '{}', v_ref, true),
    (v_org, v_fy, v_ag_esporte, v_un_esporte, '27', '812', v_pg_esporte, v_ac_esporte,
     '4.4.50.42', v_src, 'Auxílios a entidades esportivas — equipamentos e obras (EXEMPLO)', 500000.00, '{}', v_ref, true),
    (v_org, v_fy, v_ag_reserva, v_un_reserva, '99', '999', v_pg_reserva, v_ac_reserva,
     '9.9.99.99', v_src, 'Reserva para atendimento de emendas parlamentares individuais (EXEMPLO)', 10000000.00,
     '{"reserva_emendas": true}', v_ref, true);

  raise notice 'Configuração concluída para a organização %.', v_org;
end
$$;

-- -----------------------------------------------------------------------------
-- Para remover as dotações de EXEMPLO (antes de importar o PLOA real):
-- -----------------------------------------------------------------------------
-- delete from public.budget_allocations a using public.organizations o
--  where a.organization_id = o.id and o.name ilike '%Paulo Afonso%' and a.is_demo
--    and not exists (select 1 from public.amendment_allocations x where x.allocation_id = a.id)
--    and not exists (select 1 from public.amendment_cancellations x where x.allocation_id = a.id);
