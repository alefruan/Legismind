-- =============================================================================
-- LegisMind — 0006: emendas parlamentares
-- Garantias implementadas no banco:
--  * destinações e anulações só referenciam dotações do MESMO exercício e instituição;
--  * qualquer alteração substantiva incrementa a revisão e torna a validação obsoleta;
--  * resultados de validação só são gravados pelo servidor (service role);
--  * "Validada tecnicamente"/"Aguardando assinatura" exigem validação aprovada na
--    revisão atual e revisão humana; "Protocolada" exige número e data informados.
-- =============================================================================

create table public.amendments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  office_id uuid not null,
  fiscal_year_id uuid not null,
  modality_id uuid not null,
  sequence_number integer,
  title text not null check (char_length(title) between 3 and 300),
  object text check (char_length(object) <= 4000),
  purpose text check (char_length(purpose) <= 4000),
  policy_area text check (char_length(policy_area) <= 200),
  beneficiary_type text not null default 'none'
    check (beneficiary_type in ('none', 'osc', 'public_entity', 'own_administration', 'other')),
  beneficiary_name text check (char_length(beneficiary_name) <= 300),
  beneficiary_cnpj text check (beneficiary_cnpj ~ '^[0-9]{14}$'),
  transfer_instrument text check (transfer_instrument in (
    'termo_fomento', 'termo_colaboracao', 'acordo_cooperacao', 'convenio',
    'transferencia_fundo_a_fundo', 'aplicacao_direta', 'outro')),
  total_amount numeric(18, 2) not null default 0 check (total_amount >= 0),
  justification text check (char_length(justification) <= 20000),
  legal_grounds text check (char_length(legal_grounds) <= 20000),
  body jsonb not null default '{}'::jsonb,
  template_id uuid,
  status public.amendment_status not null default 'draft',
  visibility text not null default 'office' check (visibility in ('office', 'organization')),
  revision integer not null default 1,
  last_validation_run_id uuid,
  validation_outcome public.validation_outcome,
  validated_revision integer,
  protocol_number text check (char_length(protocol_number) <= 60),
  protocol_date date,
  filed_by uuid references auth.users (id) on delete set null,
  source_conversation_id uuid,
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (id, organization_id, fiscal_year_id),
  unique (organization_id, fiscal_year_id, sequence_number),
  foreign key (office_id, organization_id) references public.offices (id, organization_id),
  foreign key (fiscal_year_id, organization_id) references public.fiscal_years (id, organization_id),
  foreign key (modality_id, organization_id) references public.amendment_modalities (id, organization_id),
  foreign key (template_id, organization_id) references public.document_templates (id, organization_id) on delete set null (template_id),
  check (status <> 'filed' or (protocol_number is not null and protocol_date is not null))
);
create index amendments_office_idx on public.amendments (office_id, status);
create index amendments_org_fy_idx on public.amendments (organization_id, fiscal_year_id, status);

-- Destinações (programação de destino)
create table public.amendment_allocations (
  id uuid primary key default gen_random_uuid(),
  amendment_id uuid not null,
  organization_id uuid not null,
  fiscal_year_id uuid not null,
  allocation_id uuid,
  proposed_classification jsonb,
  requires_normative_authorization boolean not null default false,
  amount numeric(18, 2) not null check (amount > 0),
  notes text check (char_length(notes) <= 4000),
  origin text not null default 'user' check (origin in ('user', 'assistant', 'explorer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (amendment_id, organization_id, fiscal_year_id)
    references public.amendments (id, organization_id, fiscal_year_id) on delete cascade,
  foreign key (allocation_id, organization_id, fiscal_year_id)
    references public.budget_allocations (id, organization_id, fiscal_year_id),
  check ((allocation_id is not null) <> (proposed_classification is not null)),
  check (proposed_classification is null or requires_normative_authorization)
);
create index amendment_allocations_amendment_idx on public.amendment_allocations (amendment_id);
comment on column public.amendment_allocations.proposed_classification is 'Nova programação inexistente no orçamento. Sempre exige autorização normativa e nunca é tratada como dado oficial.';

-- Anulações compensatórias (sempre sobre dotações reais)
create table public.amendment_cancellations (
  id uuid primary key default gen_random_uuid(),
  amendment_id uuid not null,
  organization_id uuid not null,
  fiscal_year_id uuid not null,
  allocation_id uuid not null,
  amount numeric(18, 2) not null check (amount > 0),
  justification text check (char_length(justification) <= 4000),
  origin text not null default 'user' check (origin in ('user', 'assistant', 'explorer')),
  approved boolean not null default false,
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (amendment_id, allocation_id),
  foreign key (amendment_id, organization_id, fiscal_year_id)
    references public.amendments (id, organization_id, fiscal_year_id) on delete cascade,
  foreign key (allocation_id, organization_id, fiscal_year_id)
    references public.budget_allocations (id, organization_id, fiscal_year_id),
  check (not approved or (approved_by is not null and approved_at is not null))
);
create index amendment_cancellations_allocation_idx on public.amendment_cancellations (allocation_id);

-- Execuções de validação (gravadas apenas pelo servidor)
create table public.amendment_validation_runs (
  id uuid primary key default gen_random_uuid(),
  amendment_id uuid not null,
  organization_id uuid not null,
  amendment_revision integer not null,
  outcome public.validation_outcome not null,
  engine_version text not null,
  rules_snapshot jsonb not null,
  data_snapshot jsonb not null,
  summary jsonb not null,
  executed_by uuid references auth.users (id) on delete set null,
  executed_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (amendment_id, organization_id) references public.amendments (id, organization_id) on delete cascade
);
create index amendment_validation_runs_amendment_idx on public.amendment_validation_runs (amendment_id, executed_at desc);

create table public.amendment_validations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null,
  amendment_id uuid not null,
  organization_id uuid not null,
  check_code text not null,
  rule_id uuid references public.legal_rules (id) on delete set null,
  rule_version integer,
  outcome public.validation_outcome not null,
  severity text not null check (severity in ('blocking', 'warning', 'info')),
  title text not null,
  message text not null,
  legal_basis text,
  details jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  requires_human_decision boolean not null default false,
  position integer not null default 0,
  foreign key (run_id, organization_id) references public.amendment_validation_runs (id, organization_id) on delete cascade
);
create index amendment_validations_run_idx on public.amendment_validations (run_id, position);

alter table public.amendments
  add constraint amendments_last_run_fk foreign key (last_validation_run_id)
  references public.amendment_validation_runs (id) on delete set null;

create table public.amendment_versions (
  id uuid primary key default gen_random_uuid(),
  amendment_id uuid not null,
  organization_id uuid not null,
  version_number integer not null,
  amendment_revision integer not null,
  status public.amendment_status not null,
  snapshot jsonb not null,
  change_summary text check (char_length(change_summary) <= 1000),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (amendment_id, version_number),
  foreign key (amendment_id, organization_id) references public.amendments (id, organization_id) on delete cascade
);

create table public.amendment_comments (
  id uuid primary key default gen_random_uuid(),
  amendment_id uuid not null,
  organization_id uuid not null,
  author_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 5000),
  resolved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (amendment_id, organization_id) references public.amendments (id, organization_id) on delete cascade
);
create index amendment_comments_amendment_idx on public.amendment_comments (amendment_id, created_at);

create table public.amendment_reviews (
  id uuid primary key default gen_random_uuid(),
  amendment_id uuid not null,
  organization_id uuid not null,
  reviewer_id uuid not null references auth.users (id) on delete cascade,
  amendment_revision integer not null,
  validation_run_id uuid references public.amendment_validation_runs (id) on delete set null,
  decision text not null check (decision in ('approved', 'changes_requested')),
  notes text check (char_length(notes) <= 5000),
  created_at timestamptz not null default now(),
  foreign key (amendment_id, organization_id) references public.amendments (id, organization_id) on delete cascade
);

create table public.amendment_status_history (
  id bigint generated always as identity primary key,
  amendment_id uuid not null,
  organization_id uuid not null,
  from_status public.amendment_status,
  to_status public.amendment_status not null,
  changed_by uuid references auth.users (id) on delete set null,
  reason text check (char_length(reason) <= 2000),
  created_at timestamptz not null default now(),
  foreign key (amendment_id, organization_id) references public.amendments (id, organization_id) on delete cascade
);
create index amendment_status_history_idx on public.amendment_status_history (amendment_id, created_at);

-- -----------------------------------------------------------------------------
-- Funções de acesso
-- -----------------------------------------------------------------------------
create function public.can_read_amendment(p_amendment uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.amendments a
    where a.id = p_amendment
      and (
        public.is_office_member(a.office_id)
        or (a.visibility = 'organization' and public.is_org_member(a.organization_id))
        or (a.status <> 'draft' and public.has_org_role(a.organization_id, array['reviewer']::public.member_role[]))
      )
  )
$$;

create function public.can_edit_amendment(p_amendment uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.amendments a
    where a.id = p_amendment
      and a.status in ('draft', 'needs_correction')
      and public.is_office_member(a.office_id)
  )
$$;

-- -----------------------------------------------------------------------------
-- Gatilhos
-- -----------------------------------------------------------------------------
create function public.amendments_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.amendment_modalities m
    where m.id = new.modality_id and m.organization_id = new.organization_id and m.is_active
  ) then
    raise exception 'Modalidade de emenda inativa ou inexistente.' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtext(new.organization_id::text || ':' || new.fiscal_year_id::text));
  select coalesce(max(sequence_number), 0) + 1 into new.sequence_number
  from public.amendments
  where organization_id = new.organization_id and fiscal_year_id = new.fiscal_year_id;

  new.status := 'draft';
  new.revision := 1;
  new.total_amount := 0;
  new.last_validation_run_id := null;
  new.validation_outcome := null;
  new.validated_revision := null;
  new.protocol_number := null;
  new.protocol_date := null;
  new.filed_by := null;
  new.created_by := coalesce(auth.uid(), new.created_by);
  new.updated_by := new.created_by;
  return new;
end;
$$;

create trigger amendments_before_insert
  before insert on public.amendments
  for each row execute function public.amendments_before_insert();

-- Protege colunas controladas pelo servidor e incrementa a revisão em alterações substantivas.
create function public.amendments_before_update()
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
      new.modality_id, new.template_id, new.fiscal_year_id)
     is distinct from
     (old.title, old.object, old.purpose, old.policy_area, old.beneficiary_type, old.beneficiary_name,
      old.beneficiary_cnpj, old.transfer_instrument, old.justification, old.legal_grounds, old.body,
      old.modality_id, old.template_id, old.fiscal_year_id) then
    new.revision := old.revision + 1;
  end if;

  if auth.uid() is not null then
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;

create trigger amendments_before_update
  before update on public.amendments
  for each row execute function public.amendments_before_update();

create trigger amendments_updated_at before update on public.amendments for each row execute function public.set_updated_at();
create trigger amendment_allocations_updated_at before update on public.amendment_allocations for each row execute function public.set_updated_at();
create trigger amendment_cancellations_updated_at before update on public.amendment_cancellations for each row execute function public.set_updated_at();
create trigger amendment_comments_updated_at before update on public.amendment_comments for each row execute function public.set_updated_at();
create trigger amendments_audit after insert or delete on public.amendments for each row execute function public.audit_row_change();

-- Alterações em destinações/anulações incrementam a revisão e recalculam o total.
create function public.amendment_children_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_amendment uuid := coalesce(new.amendment_id, old.amendment_id);
begin
  update public.amendments a
  set revision = a.revision + 1,
      total_amount = coalesce((select sum(x.amount) from public.amendment_allocations x where x.amendment_id = a.id), 0),
      updated_by = coalesce(auth.uid(), a.updated_by)
  where a.id = v_amendment;
  return null;
end;
$$;

create trigger amendment_allocations_changed
  after insert or update or delete on public.amendment_allocations
  for each row execute function public.amendment_children_changed();
create trigger amendment_cancellations_changed
  after insert or update or delete on public.amendment_cancellations
  for each row execute function public.amendment_children_changed();

-- Aprovação explícita da anulação: registra quem aprovou; mudanças de valor exigem nova aprovação.
create function public.amendment_cancellations_approval()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.approved then
      new.approved_by := auth.uid();
      new.approved_at := now();
      if new.approved_by is null then
        new.approved := false;
        new.approved_at := null;
      end if;
    else
      new.approved_by := null;
      new.approved_at := null;
    end if;
    return new;
  end if;

  if new.amount is distinct from old.amount or new.allocation_id is distinct from old.allocation_id then
    new.approved := false;
  end if;
  if new.approved and not old.approved then
    new.approved_by := auth.uid();
    new.approved_at := now();
    if new.approved_by is null then
      new.approved := false;
      new.approved_at := null;
    end if;
  elsif not new.approved then
    new.approved_by := null;
    new.approved_at := null;
  else
    new.approved_by := old.approved_by;
    new.approved_at := old.approved_at;
  end if;
  return new;
end;
$$;

create trigger amendment_cancellations_approval
  before insert or update on public.amendment_cancellations
  for each row execute function public.amendment_cancellations_approval();

-- -----------------------------------------------------------------------------
-- Instantâneo completo (rastreabilidade histórica das informações utilizadas)
-- -----------------------------------------------------------------------------
create function public.amendment_snapshot_json(p_amendment uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'amendment', to_jsonb(a) - 'body' || jsonb_build_object('body', a.body),
    'modality', to_jsonb(m),
    'destinations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'amount', x.amount, 'allocation_id', x.allocation_id,
        'proposed_classification', x.proposed_classification,
        'requires_normative_authorization', x.requires_normative_authorization,
        'notes', x.notes,
        'allocation', (select to_jsonb(v) - 'search_tsv' - 'search_text' from public.budget_allocations_view v where v.id = x.allocation_id)
      ) order by x.created_at)
      from public.amendment_allocations x where x.amendment_id = a.id), '[]'::jsonb),
    'cancellations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'amount', c.amount, 'allocation_id', c.allocation_id, 'justification', c.justification,
        'approved', c.approved, 'approved_by', c.approved_by, 'approved_at', c.approved_at,
        'allocation', (select to_jsonb(v) - 'search_tsv' - 'search_text' from public.budget_allocations_view v where v.id = c.allocation_id)
      ) order by c.created_at)
      from public.amendment_cancellations c where c.amendment_id = a.id), '[]'::jsonb)
  )
  from public.amendments a
  join public.amendment_modalities m on m.id = a.modality_id
  where a.id = p_amendment
$$;

create function public.insert_amendment_version(p_amendment uuid, p_summary text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.amendments%rowtype;
  v_id uuid;
begin
  select * into v_a from public.amendments where id = p_amendment;
  insert into public.amendment_versions (amendment_id, organization_id, version_number, amendment_revision, status, snapshot, change_summary, created_by)
  values (
    v_a.id, v_a.organization_id,
    coalesce((select max(version_number) from public.amendment_versions where amendment_id = v_a.id), 0) + 1,
    v_a.revision, v_a.status, public.amendment_snapshot_json(v_a.id), p_summary, auth.uid()
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- Versão manual solicitada pelo gabinete ("salvar versão").
create function public.save_amendment_version(p_amendment uuid, p_summary text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.amendments a where a.id = p_amendment and public.is_office_member(a.office_id)) then
    raise exception 'Sem permissão para versionar esta emenda.' using errcode = '42501';
  end if;
  return public.insert_amendment_version(p_amendment, coalesce(p_summary, 'Versão salva manualmente'));
end;
$$;

-- -----------------------------------------------------------------------------
-- Compromissos de outras emendas sobre as mesmas dotações (apenas agregados)
-- -----------------------------------------------------------------------------
create function public.allocation_commitments(p_allocation_ids uuid[], p_exclude_amendment uuid default null)
returns table (
  allocation_id uuid,
  firm_amount numeric,
  pending_amount numeric,
  amendments_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.allocation_id,
         coalesce(sum(c.amount) filter (where a.status in ('technically_validated', 'awaiting_signature', 'filed')), 0),
         coalesce(sum(c.amount) filter (where a.status in ('draft', 'in_review', 'needs_correction')), 0),
         count(distinct a.id)::integer
  from public.amendment_cancellations c
  join public.amendments a on a.id = c.amendment_id
  where c.allocation_id = any (p_allocation_ids)
    and a.status <> 'archived'
    and (p_exclude_amendment is null or a.id <> p_exclude_amendment)
    and (coalesce(auth.role(), '') = 'service_role' or public.is_org_member(c.organization_id))
  group by c.allocation_id
$$;

-- Totais de emendas individuais do gabinete no exercício, por função de governo.
create function public.office_amendment_totals(p_office uuid, p_fiscal_year uuid, p_exclude_amendment uuid default null)
returns table (function_code text, total numeric, amendments_count integer)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(v.function_code::text, (x.proposed_classification ->> 'function_code')) as function_code,
         sum(x.amount),
         count(distinct a.id)::integer
  from public.amendments a
  join public.amendment_modalities m on m.id = a.modality_id and m.counts_toward_individual_limit
  join public.amendment_allocations x on x.amendment_id = a.id
  left join public.budget_allocations v on v.id = x.allocation_id
  where a.office_id = p_office
    and a.fiscal_year_id = p_fiscal_year
    and a.status <> 'archived'
    and (p_exclude_amendment is null or a.id <> p_exclude_amendment)
    and (coalesce(auth.role(), '') = 'service_role' or public.is_office_member(p_office))
  group by 1
$$;

-- -----------------------------------------------------------------------------
-- Registro de validação (somente servidor) — atômico e vinculado à revisão
-- -----------------------------------------------------------------------------
create function public.record_validation_run(
  p_amendment uuid,
  p_revision integer,
  p_outcome public.validation_outcome,
  p_engine_version text,
  p_rules_snapshot jsonb,
  p_data_snapshot jsonb,
  p_summary jsonb,
  p_results jsonb,
  p_executed_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.amendments%rowtype;
  v_run uuid;
  v_item jsonb;
  v_pos integer := 0;
begin
  select * into v_a from public.amendments where id = p_amendment for update;
  if not found then
    raise exception 'Emenda não encontrada.' using errcode = 'P0002';
  end if;
  if v_a.revision <> p_revision then
    raise exception 'A emenda foi alterada durante a validação. Execute novamente.' using errcode = '40001';
  end if;

  insert into public.amendment_validation_runs (amendment_id, organization_id, amendment_revision, outcome, engine_version,
    rules_snapshot, data_snapshot, summary, executed_by)
  values (v_a.id, v_a.organization_id, p_revision, p_outcome, p_engine_version, p_rules_snapshot, p_data_snapshot, p_summary, p_executed_by)
  returning id into v_run;

  for v_item in select * from jsonb_array_elements(coalesce(p_results, '[]'::jsonb))
  loop
    insert into public.amendment_validations (run_id, amendment_id, organization_id, check_code, rule_id, rule_version,
      outcome, severity, title, message, legal_basis, details, evidence, requires_human_decision, position)
    values (
      v_run, v_a.id, v_a.organization_id,
      v_item ->> 'check_code',
      nullif(v_item ->> 'rule_id', '')::uuid,
      nullif(v_item ->> 'rule_version', '')::integer,
      (v_item ->> 'outcome')::public.validation_outcome,
      v_item ->> 'severity',
      v_item ->> 'title',
      v_item ->> 'message',
      v_item ->> 'legal_basis',
      coalesce(v_item -> 'details', '{}'::jsonb),
      coalesce(v_item -> 'evidence', '[]'::jsonb),
      coalesce((v_item ->> 'requires_human_decision')::boolean, false),
      v_pos
    );
    v_pos := v_pos + 1;
  end loop;

  update public.amendments
  set last_validation_run_id = v_run, validation_outcome = p_outcome, validated_revision = p_revision
  where id = v_a.id;

  return v_run;
end;
$$;

-- -----------------------------------------------------------------------------
-- Tramitação (máquina de estados)
-- -----------------------------------------------------------------------------
create function public.transition_amendment_status(
  p_amendment uuid,
  p_to public.amendment_status,
  p_reason text default null,
  p_protocol_number text default null,
  p_protocol_date date default null
)
returns public.amendment_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.amendments%rowtype;
  v_from public.amendment_status;
  v_is_office boolean;
  v_is_reviewer boolean;
  v_is_admin boolean;
  v_require_review boolean;
  v_validation_current boolean;
begin
  select * into v_a from public.amendments where id = p_amendment for update;
  if not found then
    raise exception 'Emenda não encontrada.' using errcode = 'P0002';
  end if;
  v_from := v_a.status;
  v_is_office := public.is_office_member(v_a.office_id);
  v_is_reviewer := public.has_org_role(v_a.organization_id, array['reviewer']::public.member_role[]);
  v_is_admin := public.has_org_role(v_a.organization_id, array['org_admin']::public.member_role[]);
  v_validation_current := v_a.last_validation_run_id is not null and v_a.validated_revision = v_a.revision;
  select coalesce(s.require_reviewer_approval, true) into v_require_review
  from public.organization_settings s where s.organization_id = v_a.organization_id;
  v_require_review := coalesce(v_require_review, true);

  if v_from = p_to then
    return v_from;
  end if;

  if p_to = 'in_review' then
    if v_from not in ('draft', 'needs_correction') or not v_is_office then
      raise exception 'Somente o gabinete pode enviar a emenda para análise a partir de rascunho ou correção.' using errcode = '42501';
    end if;
    if not v_validation_current then
      raise exception 'Execute a validação técnica da versão atual antes de enviar para análise.' using errcode = 'P0001';
    end if;

  elsif p_to = 'needs_correction' then
    if v_from not in ('in_review', 'technically_validated', 'awaiting_signature') then
      raise exception 'Transição inválida.' using errcode = 'P0001';
    end if;
    if not (v_is_reviewer or v_is_office) then
      raise exception 'Sem permissão para solicitar correções.' using errcode = '42501';
    end if;
    if v_is_reviewer and v_from = 'in_review' then
      insert into public.amendment_reviews (amendment_id, organization_id, reviewer_id, amendment_revision, validation_run_id, decision, notes)
      values (v_a.id, v_a.organization_id, auth.uid(), v_a.revision, v_a.last_validation_run_id, 'changes_requested', p_reason);
    end if;

  elsif p_to = 'technically_validated' then
    if v_from <> 'in_review' then
      raise exception 'A emenda precisa estar em análise.' using errcode = 'P0001';
    end if;
    if not v_is_reviewer then
      raise exception 'Somente revisores jurídico/orçamentários podem validar tecnicamente.' using errcode = '42501';
    end if;
    if not v_validation_current or v_a.validation_outcome <> 'validated' then
      raise exception 'A validação automática da versão atual precisa estar integralmente aprovada.' using errcode = 'P0001';
    end if;
    insert into public.amendment_reviews (amendment_id, organization_id, reviewer_id, amendment_revision, validation_run_id, decision, notes)
    values (v_a.id, v_a.organization_id, auth.uid(), v_a.revision, v_a.last_validation_run_id, 'approved', p_reason);

  elsif p_to = 'awaiting_signature' then
    if v_from <> 'technically_validated' then
      raise exception 'A emenda precisa estar validada tecnicamente.' using errcode = 'P0001';
    end if;
    if not (v_is_office or v_is_reviewer) then
      raise exception 'Sem permissão.' using errcode = '42501';
    end if;
    if not v_validation_current or v_a.validation_outcome <> 'validated' then
      raise exception 'A validação automática deixou de corresponder à versão atual.' using errcode = 'P0001';
    end if;
    if v_require_review and not exists (
      select 1 from public.amendment_reviews r
      where r.amendment_id = v_a.id and r.decision = 'approved' and r.amendment_revision = v_a.revision
    ) then
      raise exception 'Revisão humana aprovada é obrigatória para esta instituição.' using errcode = 'P0001';
    end if;

  elsif p_to = 'filed' then
    if v_from <> 'awaiting_signature' then
      raise exception 'Somente emendas aguardando assinatura podem ser registradas como protocoladas.' using errcode = 'P0001';
    end if;
    if not (v_is_office or v_is_admin) then
      raise exception 'Sem permissão para registrar protocolo.' using errcode = '42501';
    end if;
    if coalesce(trim(p_protocol_number), '') = '' or p_protocol_date is null then
      raise exception 'Informe o número e a data do protocolo oficial.' using errcode = 'P0001';
    end if;
    if p_protocol_date > current_date then
      raise exception 'A data de protocolo não pode estar no futuro.' using errcode = 'P0001';
    end if;

  elsif p_to = 'archived' then
    if not (v_is_office or v_is_admin) then
      raise exception 'Sem permissão para arquivar.' using errcode = '42501';
    end if;

  elsif p_to = 'draft' then
    if v_from <> 'archived' or v_a.protocol_number is not null or not v_is_office then
      raise exception 'Somente emendas arquivadas e não protocoladas podem ser reabertas pelo gabinete.' using errcode = 'P0001';
    end if;

  else
    raise exception 'Transição inválida.' using errcode = 'P0001';
  end if;

  update public.amendments
  set status = p_to,
      protocol_number = case when p_to = 'filed' then trim(p_protocol_number) else protocol_number end,
      protocol_date = case when p_to = 'filed' then p_protocol_date else protocol_date end,
      filed_by = case when p_to = 'filed' then auth.uid() else filed_by end
  where id = v_a.id;

  insert into public.amendment_status_history (amendment_id, organization_id, from_status, to_status, changed_by, reason)
  values (v_a.id, v_a.organization_id, v_from, p_to, auth.uid(), p_reason);

  if p_to in ('in_review', 'technically_validated', 'awaiting_signature', 'filed') then
    perform public.insert_amendment_version(v_a.id, 'Tramitação: ' || v_from::text || ' → ' || p_to::text);
  end if;

  perform public.write_audit_log(v_a.organization_id, 'status_transition', 'amendments', v_a.id::text,
    null, jsonb_build_object('from', v_from, 'to', p_to));
  return p_to;
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.amendments enable row level security;
alter table public.amendment_allocations enable row level security;
alter table public.amendment_cancellations enable row level security;
alter table public.amendment_validation_runs enable row level security;
alter table public.amendment_validations enable row level security;
alter table public.amendment_versions enable row level security;
alter table public.amendment_comments enable row level security;
alter table public.amendment_reviews enable row level security;
alter table public.amendment_status_history enable row level security;

create policy amendments_select on public.amendments for select to authenticated
  using (
    public.is_office_member(office_id)
    or (visibility = 'organization' and public.is_org_member(organization_id))
    or (status <> 'draft' and public.has_org_role(organization_id, array['reviewer']::public.member_role[]))
  );
create policy amendments_insert on public.amendments for insert to authenticated
  with check (public.is_office_member(office_id));
create policy amendments_update on public.amendments for update to authenticated
  using (public.is_office_member(office_id) and status in ('draft', 'needs_correction'))
  with check (public.is_office_member(office_id) and status in ('draft', 'needs_correction'));
create policy amendments_delete on public.amendments for delete to authenticated
  using (public.is_office_member(office_id) and status = 'draft');

create policy amendment_allocations_select on public.amendment_allocations for select to authenticated
  using (public.can_read_amendment(amendment_id));
create policy amendment_allocations_write on public.amendment_allocations for all to authenticated
  using (public.can_edit_amendment(amendment_id)) with check (public.can_edit_amendment(amendment_id));

create policy amendment_cancellations_select on public.amendment_cancellations for select to authenticated
  using (public.can_read_amendment(amendment_id));
create policy amendment_cancellations_write on public.amendment_cancellations for all to authenticated
  using (public.can_edit_amendment(amendment_id)) with check (public.can_edit_amendment(amendment_id));

create policy amendment_validation_runs_select on public.amendment_validation_runs for select to authenticated
  using (public.can_read_amendment(amendment_id));
create policy amendment_validations_select on public.amendment_validations for select to authenticated
  using (public.can_read_amendment(amendment_id));
create policy amendment_versions_select on public.amendment_versions for select to authenticated
  using (public.can_read_amendment(amendment_id));
create policy amendment_reviews_select on public.amendment_reviews for select to authenticated
  using (public.can_read_amendment(amendment_id));
create policy amendment_status_history_select on public.amendment_status_history for select to authenticated
  using (public.can_read_amendment(amendment_id));

create policy amendment_comments_select on public.amendment_comments for select to authenticated
  using (public.can_read_amendment(amendment_id));
create policy amendment_comments_insert on public.amendment_comments for insert to authenticated
  with check (public.can_read_amendment(amendment_id) and author_id = (select auth.uid()));
create policy amendment_comments_update on public.amendment_comments for update to authenticated
  using (author_id = (select auth.uid()) or public.can_edit_amendment(amendment_id))
  with check (public.can_read_amendment(amendment_id));
create policy amendment_comments_delete on public.amendment_comments for delete to authenticated
  using (author_id = (select auth.uid()));

-- Privilégios: tabelas derivadas só são escritas por funções confiáveis
revoke insert, update, delete on public.amendment_validation_runs from anon, authenticated;
revoke insert, update, delete on public.amendment_validations from anon, authenticated;
revoke insert, update, delete on public.amendment_versions from anon, authenticated;
revoke insert, update, delete on public.amendment_reviews from anon, authenticated;
revoke insert, update, delete on public.amendment_status_history from anon, authenticated;
revoke update on public.amendment_cancellations from anon, authenticated;
grant update (amount, justification, approved) on public.amendment_cancellations to authenticated;
revoke update on public.amendment_comments from anon, authenticated;
grant update (body, resolved) on public.amendment_comments to authenticated;

revoke execute on function public.record_validation_run(uuid, integer, public.validation_outcome, text, jsonb, jsonb, jsonb, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.record_validation_run(uuid, integer, public.validation_outcome, text, jsonb, jsonb, jsonb, jsonb, uuid) to service_role;
revoke execute on function public.insert_amendment_version(uuid, text) from public, anon, authenticated;
revoke execute on function public.amendment_snapshot_json(uuid) from public, anon, authenticated;
grant execute on function public.amendment_snapshot_json(uuid) to service_role;
