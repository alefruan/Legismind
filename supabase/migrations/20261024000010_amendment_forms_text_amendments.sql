-- =============================================================================
-- LegisMind — 0010: formulários institucionais de emenda e emendas ao texto
-- * Modalidades passam a distinguir emendas orçamentárias e emendas ao texto
--   (aditiva, modificativa, supressiva) e podem ter modelo próprio.
-- * Campos do formulário: meta física, localização do beneficiário, data da
--   indicação, dispositivo/comando/texto original/nova redação.
-- * Exercício: número e ementa do Projeto de Lei Orçamentária.
-- * Gabinete: cargo do parlamentar (Vereador, Vereadora, Deputado Estadual…).
-- * Instituição: formato de exibição da natureza da despesa e cidade da assinatura.
-- =============================================================================

alter table public.amendment_modalities
  add column kind text not null default 'budget' check (kind in ('budget', 'text')),
  add column text_subtype text check (text_subtype in ('aditiva', 'modificativa', 'supressiva')),
  add column type_label text check (char_length(type_label) <= 60),
  add column template_id uuid,
  add constraint amendment_modalities_text_subtype_chk check ((kind = 'text') = (text_subtype is not null)),
  add constraint amendment_modalities_text_no_cancellation_chk check (kind = 'budget' or not requires_cancellation),
  add constraint amendment_modalities_template_fk foreign key (template_id, organization_id)
    references public.document_templates (id, organization_id) on delete set null (template_id);

comment on column public.amendment_modalities.type_label is 'Rótulo do "Tipo de emenda" no formulário (ex.: Impositiva, Remanejamento, Texto).';

alter table public.amendments
  add column physical_goal text check (char_length(physical_goal) <= 2000),
  add column beneficiary_location text check (char_length(beneficiary_location) <= 1000),
  add column indication_date date,
  add column text_target text check (char_length(text_target) <= 500),
  add column text_command text check (char_length(text_command) <= 2000),
  add column original_text text check (char_length(original_text) <= 20000),
  add column new_text text check (char_length(new_text) <= 20000);

comment on column public.amendments.physical_goal is 'Meta física esperada (ex.: 10 poltronas e 5 bombas de infusão).';
comment on column public.amendments.text_target is 'Emendas ao texto: dispositivo alcançado (ex.: inciso I do Art. 8º).';
comment on column public.amendments.text_command is 'Emendas ao texto: comando da emenda (ex.: Acrescenta o § 2º ao inciso I do Art. 8º do Projeto de Lei nº …).';

alter table public.fiscal_years
  add column bill_number text check (char_length(bill_number) <= 40),
  add column bill_summary text check (char_length(bill_summary) <= 1000);

comment on column public.fiscal_years.bill_number is 'Número do Projeto de Lei Orçamentária (ex.: 1458/2026).';

alter table public.offices
  add column parliamentarian_title text check (char_length(parliamentarian_title) <= 60);

alter table public.organization_settings
  add column expense_nature_format text not null default 'c.g.mm.ee' check (expense_nature_format in ('c.g.mm.ee', 'cg.mm.ee')),
  add column signature_city text check (char_length(signature_city) <= 120);

comment on column public.organization_settings.expense_nature_format is 'Exibição da natureza da despesa nos documentos: 4.4.50.42 (c.g.mm.ee) ou 44.50.42 (cg.mm.ee).';

-- Modelos de emenda ao texto (vinculados às modalidades aditiva/modificativa/supressiva)
alter table public.document_templates drop constraint document_templates_kind_check;
alter table public.document_templates
  add constraint document_templates_kind_check
  check (kind in ('emenda_orcamentaria', 'emenda_texto', 'requerimento', 'indicacao', 'mocao', 'oficio', 'projeto_lei'));

-- -----------------------------------------------------------------------------
-- Revisão: os novos campos também são alterações substantivas
-- -----------------------------------------------------------------------------
create or replace function public.amendments_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.status is distinct from old.status then
      raise exception 'O status da emenda só pode ser alterado pelo fluxo de tramitação.' using errcode = '42501';
    end if;
    if new.fiscal_year_id is distinct from old.fiscal_year_id
       and (exists (select 1 from public.amendment_allocations x where x.amendment_id = old.id)
            or exists (select 1 from public.amendment_cancellations x where x.amendment_id = old.id)) then
      raise exception 'Remova destinações e anulações antes de alterar o exercício da emenda.' using errcode = 'P0001';
    end if;
    new.organization_id := old.organization_id;
    new.office_id := old.office_id;
    new.sequence_number := old.sequence_number;
    new.revision := old.revision;
    new.total_amount := old.total_amount;
    new.last_validation_run_id := old.last_validation_run_id;
    new.validation_outcome := old.validation_outcome;
    new.validated_revision := old.validated_revision;
    new.protocol_number := old.protocol_number;
    new.protocol_date := old.protocol_date;
    new.filed_by := old.filed_by;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;

  if (new.title, new.object, new.purpose, new.policy_area, new.beneficiary_type, new.beneficiary_name,
      new.beneficiary_cnpj, new.transfer_instrument, new.justification, new.legal_grounds, new.body,
      new.modality_id, new.template_id, new.fiscal_year_id,
      new.physical_goal, new.beneficiary_location, new.indication_date,
      new.text_target, new.text_command, new.original_text, new.new_text)
     is distinct from
     (old.title, old.object, old.purpose, old.policy_area, old.beneficiary_type, old.beneficiary_name,
      old.beneficiary_cnpj, old.transfer_instrument, old.justification, old.legal_grounds, old.body,
      old.modality_id, old.template_id, old.fiscal_year_id,
      old.physical_goal, old.beneficiary_location, old.indication_date,
      old.text_target, old.text_command, old.original_text, old.new_text) then
    new.revision := old.revision + 1;
  end if;

  if auth.uid() is not null then
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;

-- Emendas ao texto não têm programação orçamentária.
create function public.amendment_lines_require_budget_kind()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.amendments a
    join public.amendment_modalities m on m.id = a.modality_id
    where a.id = new.amendment_id and m.kind = 'text'
  ) then
    raise exception 'Emendas ao texto não possuem destinações nem anulações orçamentárias.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger amendment_allocations_budget_kind
  before insert on public.amendment_allocations
  for each row execute function public.amendment_lines_require_budget_kind();
create trigger amendment_cancellations_budget_kind
  before insert on public.amendment_cancellations
  for each row execute function public.amendment_lines_require_budget_kind();

-- -----------------------------------------------------------------------------
-- Nova regra configurável: campos obrigatórios do formulário da Casa
-- -----------------------------------------------------------------------------
create or replace function public.valid_rule_type(p_type text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_type in (
    'cancellation_required',
    'cancellation_balance',
    'protected_expenses',
    'source_compatibility',
    'cancellation_within_allocation',
    'individual_amendment_limit',
    'health_share_minimum',
    'amount_range',
    'osc_transfer_requirements',
    'ppa_compatibility',
    'destination_restrictions',
    'submission_deadline',
    'required_fields'
  )
$$;

insert into public.rule_templates (code, name, description, rule_type, default_params, legal_basis, sphere, severity, applicability_note) values
  ('REQUISITOS_FORMULARIO',
   'Campos obrigatórios do formulário de emenda',
   'Exige o preenchimento dos campos previstos no formulário oficial da Casa (ex.: descrição da despesa, meta física, localização e justificativa).',
   'required_fields', '{"fields": ["object", "physical_goal", "beneficiary_location", "justification"]}'::jsonb,
   'Norma interna que institui o formulário de emendas (Resolução, Ato da Mesa ou Regimento) — indicar dispositivo', 'interna', 'blocking',
   'Ajuste a lista de campos ao formulário adotado pela instituição.')
on conflict (code) do nothing;

grant execute on function public.valid_rule_type(text) to authenticated, service_role;
revoke execute on function public.amendment_lines_require_budget_kind() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Auditoria: a identificação da reserva para emendas (extra_identifiers.reserva_emendas)
-- muda o resultado da validação de anulações e precisa ficar registrada.
-- -----------------------------------------------------------------------------
drop trigger budget_allocations_audit on public.budget_allocations;
create trigger budget_allocations_audit
  after update of authorized_amount, available_amount, verification_status, expense_nature, source_id, extra_identifiers
  on public.budget_allocations for each row execute function public.audit_row_change();
