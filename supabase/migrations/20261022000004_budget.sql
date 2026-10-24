-- =============================================================================
-- LegisMind — 0004: estrutura orçamentária
-- Classificações, códigos e valores ficam em tabelas estruturadas. A busca
-- vetorial apenas complementa — nunca substitui consultas determinísticas.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tabelas normativas nacionais (catálogo da plataforma)
-- -----------------------------------------------------------------------------
create table public.catalog_functions (
  code char(2) primary key check (code ~ '^[0-9]{2}$'),
  name text not null,
  legal_basis text not null
);

create table public.catalog_subfunctions (
  code char(3) primary key check (code ~ '^[0-9]{3}$'),
  name text not null,
  typical_function_code char(2) references public.catalog_functions (code),
  legal_basis text not null
);

create table public.catalog_expense_categories (
  code char(1) primary key check (code ~ '^[0-9]$'),
  name text not null,
  legal_basis text not null
);

create table public.catalog_expense_groups (
  code char(1) primary key check (code ~ '^[0-9]$'),
  name text not null,
  legal_basis text not null
);

create table public.catalog_application_modalities (
  code char(2) primary key check (code ~ '^[0-9]{2}$'),
  name text not null,
  legal_basis text not null
);

create table public.catalog_expense_elements (
  code char(2) primary key check (code ~ '^[0-9]{2}$'),
  name text not null,
  legal_basis text not null
);

-- -----------------------------------------------------------------------------
-- Estrutura orçamentária por instituição e exercício
-- -----------------------------------------------------------------------------
create table public.budget_agencies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  fiscal_year_id uuid not null,
  code text not null check (code ~ '^[0-9][0-9.]{0,19}$'),
  name text not null,
  verification_status public.verification_status not null default 'pending_review',
  source_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (fiscal_year_id, code),
  unique (id, fiscal_year_id),
  foreign key (fiscal_year_id, organization_id) references public.fiscal_years (id, organization_id) on delete cascade,
  foreign key (source_version_id, organization_id) references public.document_versions (id, organization_id) on delete set null (source_version_id)
);

create table public.budget_units (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  fiscal_year_id uuid not null,
  agency_id uuid not null,
  code text not null check (code ~ '^[0-9][0-9.]{0,19}$'),
  name text not null,
  verification_status public.verification_status not null default 'pending_review',
  source_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, code),
  unique (id, fiscal_year_id),
  foreign key (agency_id, fiscal_year_id) references public.budget_agencies (id, fiscal_year_id) on delete cascade,
  foreign key (fiscal_year_id, organization_id) references public.fiscal_years (id, organization_id) on delete cascade,
  foreign key (source_version_id, organization_id) references public.document_versions (id, organization_id) on delete set null (source_version_id)
);

create table public.budget_programs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  fiscal_year_id uuid not null,
  code text not null check (code ~ '^[0-9]{1,6}$'),
  name text not null,
  objective text,
  ppa_reference text,
  verification_status public.verification_status not null default 'pending_review',
  source_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (fiscal_year_id, code),
  unique (id, fiscal_year_id),
  foreign key (fiscal_year_id, organization_id) references public.fiscal_years (id, organization_id) on delete cascade,
  foreign key (source_version_id, organization_id) references public.document_versions (id, organization_id) on delete set null (source_version_id)
);
comment on column public.budget_programs.ppa_reference is 'Referência ao programa no PPA vigente (quando conferida). Nulo = compatibilidade com o PPA não verificada.';

create table public.budget_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  fiscal_year_id uuid not null,
  program_id uuid not null,
  code text not null check (code ~ '^[0-9]{1,6}$'),
  name text not null,
  action_kind text not null default 'nao_informado'
    check (action_kind in ('projeto', 'atividade', 'operacao_especial', 'nao_informado')),
  description text,
  product text,
  verification_status public.verification_status not null default 'pending_review',
  source_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (program_id, code),
  unique (id, fiscal_year_id),
  unique (id, program_id),
  foreign key (program_id, fiscal_year_id) references public.budget_programs (id, fiscal_year_id) on delete cascade,
  foreign key (fiscal_year_id, organization_id) references public.fiscal_years (id, organization_id) on delete cascade,
  foreign key (source_version_id, organization_id) references public.document_versions (id, organization_id) on delete set null (source_version_id)
);

create table public.budget_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  fiscal_year_id uuid not null,
  code text not null check (code ~ '^[0-9][0-9.]{0,19}$'),
  name text not null,
  is_earmarked boolean,
  earmark_description text,
  verification_status public.verification_status not null default 'pending_review',
  source_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (fiscal_year_id, code),
  unique (id, fiscal_year_id),
  foreign key (fiscal_year_id, organization_id) references public.fiscal_years (id, organization_id) on delete cascade,
  foreign key (source_version_id, organization_id) references public.document_versions (id, organization_id) on delete set null (source_version_id)
);
comment on column public.budget_sources.is_earmarked is 'Fonte vinculada? Nulo = não informado (compatibilidade de fontes fica não verificável).';

create table public.budget_allocations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  fiscal_year_id uuid not null,
  agency_id uuid not null,
  unit_id uuid not null,
  function_code char(2) not null check (function_code ~ '^[0-9]{2}$'),
  subfunction_code char(3) not null check (subfunction_code ~ '^[0-9]{3}$'),
  program_id uuid not null,
  action_id uuid not null,
  expense_nature text not null check (expense_nature ~ '^[349]\.[1-69]\.[0-9]{2}\.[0-9]{2}(\.[0-9]{2})?$'),
  category_code char(1) generated always as (substr(expense_nature, 1, 1)) stored,
  group_code char(1) generated always as (substr(expense_nature, 3, 1)) stored,
  modality_code char(2) generated always as (substr(expense_nature, 5, 2)) stored,
  element_code char(2) generated always as (substr(expense_nature, 8, 2)) stored,
  source_id uuid not null,
  allocation_code text check (char_length(allocation_code) <= 40),
  description text,
  authorized_amount numeric(18, 2) not null check (authorized_amount >= 0),
  available_amount numeric(18, 2) check (available_amount >= 0),
  available_as_of date,
  available_source text,
  extra_identifiers jsonb not null default '{}'::jsonb,
  source_version_id uuid,
  source_page integer check (source_page > 0),
  source_reference text,
  raw_text text,
  extraction_confidence numeric(4, 3) check (extraction_confidence between 0 and 1),
  verification_status public.verification_status not null default 'pending_review',
  verified_by uuid references auth.users (id) on delete set null,
  verified_at timestamptz,
  is_current boolean not null default true,
  is_demo boolean not null default false,
  search_text text not null default '',
  search_tsv tsvector generated always as (to_tsvector('public.pt_unaccent'::regconfig, search_text)) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (id, organization_id, fiscal_year_id),
  check (available_amount is null or available_as_of is not null),
  check (available_amount is null or available_amount <= authorized_amount),
  foreign key (fiscal_year_id, organization_id) references public.fiscal_years (id, organization_id) on delete cascade,
  foreign key (agency_id, fiscal_year_id) references public.budget_agencies (id, fiscal_year_id),
  foreign key (unit_id, fiscal_year_id) references public.budget_units (id, fiscal_year_id),
  foreign key (program_id, fiscal_year_id) references public.budget_programs (id, fiscal_year_id),
  foreign key (action_id, program_id) references public.budget_actions (id, program_id),
  foreign key (source_id, fiscal_year_id) references public.budget_sources (id, fiscal_year_id),
  foreign key (source_version_id, organization_id) references public.document_versions (id, organization_id) on delete set null (source_version_id)
);
create index budget_allocations_fy_idx on public.budget_allocations (fiscal_year_id, is_current);
create index budget_allocations_func_idx on public.budget_allocations (fiscal_year_id, function_code, subfunction_code);
create index budget_allocations_action_idx on public.budget_allocations (action_id);
create index budget_allocations_tsv_idx on public.budget_allocations using gin (search_tsv);
create index budget_allocations_trgm_idx on public.budget_allocations using gin (search_text extensions.gin_trgm_ops);
comment on column public.budget_allocations.available_amount is 'Saldo disponível informado por fonte oficial (ex.: relatório de execução). Nulo = desconhecido.';

create trigger budget_agencies_updated_at before update on public.budget_agencies for each row execute function public.set_updated_at();
create trigger budget_units_updated_at before update on public.budget_units for each row execute function public.set_updated_at();
create trigger budget_programs_updated_at before update on public.budget_programs for each row execute function public.set_updated_at();
create trigger budget_actions_updated_at before update on public.budget_actions for each row execute function public.set_updated_at();
create trigger budget_sources_updated_at before update on public.budget_sources for each row execute function public.set_updated_at();
create trigger budget_allocations_updated_at before update on public.budget_allocations for each row execute function public.set_updated_at();

-- Mantém o texto de busca coerente com a estrutura e registra o conferente.
create function public.budget_allocations_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select concat_ws(' ',
           ag.code, ag.name, un.code, un.name,
           new.function_code, fn.name, new.subfunction_code, sf.name,
           pr.code, pr.name, pr.objective, ac.code, ac.name, ac.description,
           new.expense_nature, el.name, mo.name, so.code, so.name, new.description, new.allocation_code)
    into new.search_text
  from public.budget_agencies ag
  join public.budget_units un on un.id = new.unit_id
  join public.budget_programs pr on pr.id = new.program_id
  join public.budget_actions ac on ac.id = new.action_id
  join public.budget_sources so on so.id = new.source_id
  left join public.catalog_functions fn on fn.code = new.function_code
  left join public.catalog_subfunctions sf on sf.code = new.subfunction_code
  left join public.catalog_expense_elements el on el.code = substr(new.expense_nature, 8, 2)
  left join public.catalog_application_modalities mo on mo.code = substr(new.expense_nature, 5, 2)
  where ag.id = new.agency_id;

  new.search_text := coalesce(new.search_text, '');

  if tg_op = 'INSERT' or new.verification_status is distinct from old.verification_status then
    if new.verification_status = 'confirmed' and coalesce(auth.role(), '') <> 'service_role' then
      new.verified_by := auth.uid();
      new.verified_at := now();
    elsif new.verification_status <> 'confirmed' then
      new.verified_by := null;
      new.verified_at := null;
    end if;
  end if;
  return new;
end;
$$;

create trigger budget_allocations_search
  before insert or update on public.budget_allocations
  for each row execute function public.budget_allocations_before_write();

create trigger budget_allocations_audit
  after update of authorized_amount, available_amount, verification_status, expense_nature, source_id
  on public.budget_allocations for each row execute function public.audit_row_change();

-- -----------------------------------------------------------------------------
-- Visão consolidada para o Explorador Orçamentário (respeita RLS do chamador)
-- -----------------------------------------------------------------------------
create view public.budget_allocations_view
with (security_invoker = true)
as
select
  a.id,
  a.organization_id,
  a.fiscal_year_id,
  fy.year as fiscal_year,
  ag.id as agency_id,
  ag.code as agency_code,
  ag.name as agency_name,
  un.id as unit_id,
  un.code as unit_code,
  un.name as unit_name,
  a.function_code,
  fn.name as function_name,
  a.subfunction_code,
  sf.name as subfunction_name,
  pr.id as program_id,
  pr.code as program_code,
  pr.name as program_name,
  pr.ppa_reference,
  ac.id as action_id,
  ac.code as action_code,
  ac.name as action_name,
  ac.action_kind,
  a.expense_nature,
  a.category_code,
  a.group_code,
  a.modality_code,
  mo.name as modality_name,
  a.element_code,
  el.name as element_name,
  so.id as source_id,
  so.code as source_code,
  so.name as source_name,
  so.is_earmarked as source_is_earmarked,
  a.allocation_code,
  a.description,
  a.authorized_amount,
  a.available_amount,
  a.available_as_of,
  a.available_source,
  a.extra_identifiers,
  a.source_version_id,
  dv.document_id as source_document_id,
  d.title as source_document_title,
  a.source_page,
  a.source_reference,
  a.extraction_confidence,
  a.verification_status,
  a.verified_at,
  a.is_current,
  a.is_demo,
  a.search_text,
  a.search_tsv,
  -- unidade codificada como "10.001" já contém o órgão: evita "10.10.001…"
  concat_ws('.',
    case when un.code like ag.code || '.%' then un.code else concat_ws('.', ag.code, un.code) end,
    a.function_code, a.subfunction_code, pr.code, ac.code) as programmatic_code
from public.budget_allocations a
join public.fiscal_years fy on fy.id = a.fiscal_year_id
join public.budget_agencies ag on ag.id = a.agency_id
join public.budget_units un on un.id = a.unit_id
join public.budget_programs pr on pr.id = a.program_id
join public.budget_actions ac on ac.id = a.action_id
join public.budget_sources so on so.id = a.source_id
left join public.catalog_functions fn on fn.code = a.function_code
left join public.catalog_subfunctions sf on sf.code = a.subfunction_code
left join public.catalog_application_modalities mo on mo.code = a.modality_code
left join public.catalog_expense_elements el on el.code = a.element_code
left join public.document_versions dv on dv.id = a.source_version_id
left join public.documents d on d.id = dv.document_id;

-- Busca orçamentária com filtros estruturados + relevância textual.
create function public.search_budget_allocations(
  p_fiscal_year_id uuid,
  p_query text default null,
  p_function_codes text[] default null,
  p_subfunction_codes text[] default null,
  p_modality_codes text[] default null,
  p_group_codes text[] default null,
  p_source_codes text[] default null,
  p_min_amount numeric default null,
  p_only_confirmed boolean default false,
  p_limit integer default 20
)
returns table (
  id uuid,
  programmatic_code text,
  expense_nature text,
  source_code text,
  source_name text,
  source_is_earmarked boolean,
  agency_name text,
  unit_name text,
  function_code text,
  function_name text,
  subfunction_code text,
  subfunction_name text,
  program_code text,
  program_name text,
  action_code text,
  action_name text,
  element_name text,
  modality_name text,
  description text,
  authorized_amount numeric,
  available_amount numeric,
  verification_status public.verification_status,
  source_document_title text,
  source_page integer,
  is_demo boolean,
  relevance real
)
language sql
stable
security invoker
set search_path = ''
as $$
  with q as (select public.to_or_tsquery(p_query) as tsq, nullif(trim(coalesce(p_query, '')), '') as raw)
  select v.id, v.programmatic_code, v.expense_nature, v.source_code, v.source_name, v.source_is_earmarked,
         v.agency_name, v.unit_name, v.function_code::text, v.function_name, v.subfunction_code::text, v.subfunction_name,
         v.program_code, v.program_name, v.action_code, v.action_name, v.element_name, v.modality_name,
         v.description, v.authorized_amount, v.available_amount, v.verification_status,
         v.source_document_title, v.source_page, v.is_demo,
         (case when q.tsq is null then 0 else ts_rank_cd(v.search_tsv, q.tsq) end
           + case when q.raw is null then 0
                  else extensions.word_similarity(public.immutable_unaccent(lower(q.raw)), public.immutable_unaccent(lower(v.search_text))) end
         )::real as relevance
  from public.budget_allocations_view v, q
  where v.fiscal_year_id = p_fiscal_year_id
    and v.is_current
    and (p_function_codes is null or v.function_code = any (p_function_codes))
    and (p_subfunction_codes is null or v.subfunction_code = any (p_subfunction_codes))
    and (p_modality_codes is null or v.modality_code = any (p_modality_codes))
    and (p_group_codes is null or v.group_code = any (p_group_codes))
    and (p_source_codes is null or v.source_code = any (p_source_codes))
    and (p_min_amount is null or v.authorized_amount >= p_min_amount)
    and (not p_only_confirmed or v.verification_status = 'confirmed')
    and (q.tsq is null or v.search_tsv @@ q.tsq
         or extensions.word_similarity(public.immutable_unaccent(lower(q.raw)), public.immutable_unaccent(lower(v.search_text))) > 0.35)
  order by relevance desc, v.authorized_amount desc
  limit least(greatest(coalesce(p_limit, 20), 1), 100)
$$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.catalog_functions enable row level security;
alter table public.catalog_subfunctions enable row level security;
alter table public.catalog_expense_categories enable row level security;
alter table public.catalog_expense_groups enable row level security;
alter table public.catalog_application_modalities enable row level security;
alter table public.catalog_expense_elements enable row level security;
alter table public.budget_agencies enable row level security;
alter table public.budget_units enable row level security;
alter table public.budget_programs enable row level security;
alter table public.budget_actions enable row level security;
alter table public.budget_sources enable row level security;
alter table public.budget_allocations enable row level security;

create policy catalog_functions_select on public.catalog_functions for select to authenticated using (true);
create policy catalog_subfunctions_select on public.catalog_subfunctions for select to authenticated using (true);
create policy catalog_expense_categories_select on public.catalog_expense_categories for select to authenticated using (true);
create policy catalog_expense_groups_select on public.catalog_expense_groups for select to authenticated using (true);
create policy catalog_application_modalities_select on public.catalog_application_modalities for select to authenticated using (true);
create policy catalog_expense_elements_select on public.catalog_expense_elements for select to authenticated using (true);

create policy catalog_functions_write on public.catalog_functions for all to authenticated
  using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));
create policy catalog_subfunctions_write on public.catalog_subfunctions for all to authenticated
  using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));
create policy catalog_expense_elements_write on public.catalog_expense_elements for all to authenticated
  using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));
create policy catalog_application_modalities_write on public.catalog_application_modalities for all to authenticated
  using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));

-- Estrutura: leitura por membros; correção manual por administradores e revisores
create policy budget_agencies_select on public.budget_agencies for select to authenticated using (public.is_org_member(organization_id));
create policy budget_units_select on public.budget_units for select to authenticated using (public.is_org_member(organization_id));
create policy budget_programs_select on public.budget_programs for select to authenticated using (public.is_org_member(organization_id));
create policy budget_actions_select on public.budget_actions for select to authenticated using (public.is_org_member(organization_id));
create policy budget_sources_select on public.budget_sources for select to authenticated using (public.is_org_member(organization_id));
create policy budget_allocations_select on public.budget_allocations for select to authenticated using (public.is_org_member(organization_id));

create policy budget_agencies_write on public.budget_agencies for all to authenticated
  using (public.has_org_role(organization_id, array['org_admin']::public.member_role[]))
  with check (public.has_org_role(organization_id, array['org_admin']::public.member_role[]));
create policy budget_units_write on public.budget_units for all to authenticated
  using (public.has_org_role(organization_id, array['org_admin']::public.member_role[]))
  with check (public.has_org_role(organization_id, array['org_admin']::public.member_role[]));
create policy budget_programs_write on public.budget_programs for all to authenticated
  using (public.has_org_role(organization_id, array['org_admin']::public.member_role[]))
  with check (public.has_org_role(organization_id, array['org_admin']::public.member_role[]));
create policy budget_actions_write on public.budget_actions for all to authenticated
  using (public.has_org_role(organization_id, array['org_admin']::public.member_role[]))
  with check (public.has_org_role(organization_id, array['org_admin']::public.member_role[]));
create policy budget_sources_write on public.budget_sources for all to authenticated
  using (public.has_org_role(organization_id, array['org_admin', 'reviewer']::public.member_role[]))
  with check (public.has_org_role(organization_id, array['org_admin', 'reviewer']::public.member_role[]));
create policy budget_allocations_insert on public.budget_allocations for insert to authenticated
  with check (public.has_org_role(organization_id, array['org_admin']::public.member_role[]));
create policy budget_allocations_update on public.budget_allocations for update to authenticated
  using (public.has_org_role(organization_id, array['org_admin', 'reviewer']::public.member_role[]))
  with check (public.has_org_role(organization_id, array['org_admin', 'reviewer']::public.member_role[]));

-- Dados de demonstração não podem ser marcados como reais pelo cliente
revoke update on public.budget_allocations from anon, authenticated;
grant update (agency_id, unit_id, function_code, subfunction_code, program_id, action_id, expense_nature, source_id,
  allocation_code, description, authorized_amount, available_amount, available_as_of, available_source,
  extra_identifiers, source_page, source_reference, verification_status, is_current)
  on public.budget_allocations to authenticated;
