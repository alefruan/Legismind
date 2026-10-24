-- =============================================================================
-- LegisMind — 0005: regras legislativas versionadas, modalidades e modelos
-- A validação de emendas é feita por regras determinísticas configuráveis.
-- Regras federais não são aplicadas automaticamente: cada instituição adota um
-- modelo, confirma a incidência local e só então a regra pode ser ativada.
-- =============================================================================

-- Tipos de avaliador implementados no motor determinístico (shared/domain/amendments/rules.ts)
create function public.valid_rule_type(p_type text)
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
    'submission_deadline'
  )
$$;

-- Catálogo de modelos de regra mantido pela plataforma (não é aplicado diretamente).
create table public.rule_templates (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9_]{3,64}$'),
  name text not null,
  description text not null,
  rule_type text not null check (public.valid_rule_type(rule_type)),
  default_params jsonb not null default '{}'::jsonb,
  legal_basis text not null,
  sphere text not null check (sphere in ('federal', 'estadual', 'municipal', 'interna')),
  severity text not null default 'blocking' check (severity in ('blocking', 'warning')),
  applicability_note text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.legal_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  code text not null check (code ~ '^[A-Z0-9_]{3,64}$'),
  version integer not null default 1 check (version > 0),
  name text not null check (char_length(name) between 3 and 200),
  description text,
  rule_type text not null check (public.valid_rule_type(rule_type)),
  params jsonb not null default '{}'::jsonb,
  legal_basis text not null check (char_length(legal_basis) >= 5),
  source_document_id uuid,
  sphere text not null check (sphere in ('federal', 'estadual', 'municipal', 'interna')),
  severity text not null default 'blocking' check (severity in ('blocking', 'warning')),
  applies_to_modalities text[],
  status public.rule_status not null default 'draft',
  local_incidence_confirmed boolean not null default false,
  incidence_note text,
  confirmed_by uuid references auth.users (id) on delete set null,
  confirmed_at timestamptz,
  effective_from date,
  effective_to date,
  template_code text references public.rule_templates (code) on delete set null,
  supersedes_id uuid references public.legal_rules (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code, version),
  unique (id, organization_id),
  foreign key (source_document_id, organization_id) references public.documents (id, organization_id) on delete set null (source_document_id),
  check (status <> 'active' or local_incidence_confirmed),
  check (effective_to is null or effective_from is null or effective_to >= effective_from)
);
create unique index legal_rules_one_active_idx on public.legal_rules (organization_id, code) where status = 'active';

-- Regras ativas/arquivadas são imutáveis (o histórico de validações depende delas).
create function public.legal_rules_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status in ('active', 'archived') and (
       new.params is distinct from old.params
    or new.rule_type is distinct from old.rule_type
    or new.legal_basis is distinct from old.legal_basis
    or new.code is distinct from old.code
    or new.version is distinct from old.version
    or new.severity is distinct from old.severity
    or new.applies_to_modalities is distinct from old.applies_to_modalities
  ) then
    raise exception 'Regras ativas ou arquivadas não podem ser editadas. Crie uma nova versão.' using errcode = 'P0001';
  end if;
  if old.status = 'archived' and new.status <> 'archived' then
    raise exception 'Versões arquivadas não podem ser reativadas. Crie uma nova versão.' using errcode = 'P0001';
  end if;
  if new.local_incidence_confirmed and not coalesce(old.local_incidence_confirmed, false) then
    new.confirmed_by := auth.uid();
    new.confirmed_at := now();
  elsif not new.local_incidence_confirmed then
    new.confirmed_by := null;
    new.confirmed_at := null;
  else
    new.confirmed_by := old.confirmed_by;
    new.confirmed_at := old.confirmed_at;
  end if;
  return new;
end;
$$;

create trigger legal_rules_guard before update on public.legal_rules for each row execute function public.legal_rules_guard();
create trigger legal_rules_updated_at before update on public.legal_rules for each row execute function public.set_updated_at();
create trigger legal_rules_audit after insert or update or delete on public.legal_rules for each row execute function public.audit_row_change();
create trigger rule_templates_updated_at before update on public.rule_templates for each row execute function public.set_updated_at();

create function public.legal_rules_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_by := coalesce(auth.uid(), new.created_by);
  if new.local_incidence_confirmed then
    new.confirmed_by := coalesce(auth.uid(), new.confirmed_by);
    new.confirmed_at := now();
  end if;
  return new;
end;
$$;

create trigger legal_rules_before_insert before insert on public.legal_rules for each row execute function public.legal_rules_before_insert();

-- Ativa uma versão de regra e arquiva a versão anterior do mesmo código.
create function public.activate_legal_rule(p_rule_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule public.legal_rules%rowtype;
begin
  select * into v_rule from public.legal_rules where id = p_rule_id for update;
  if not found then
    raise exception 'Regra não encontrada.' using errcode = 'P0002';
  end if;
  if not public.has_org_role(v_rule.organization_id, array['org_admin']::public.member_role[]) then
    raise exception 'Apenas administradores da instituição podem ativar regras.' using errcode = '42501';
  end if;
  if not v_rule.local_incidence_confirmed then
    raise exception 'Confirme a incidência da norma na instituição antes de ativar a regra.' using errcode = 'P0001';
  end if;
  update public.legal_rules set status = 'archived'
  where organization_id = v_rule.organization_id and code = v_rule.code and status = 'active' and id <> p_rule_id;
  update public.legal_rules set status = 'active' where id = p_rule_id;
end;
$$;

create function public.archive_legal_rule(p_rule_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.legal_rules where id = p_rule_id;
  if v_org is null then
    raise exception 'Regra não encontrada.' using errcode = 'P0002';
  end if;
  if not public.has_org_role(v_org, array['org_admin']::public.member_role[]) then
    raise exception 'Apenas administradores da instituição podem arquivar regras.' using errcode = '42501';
  end if;
  update public.legal_rules set status = 'archived' where id = p_rule_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Modalidades de emenda configuráveis por instituição
-- -----------------------------------------------------------------------------
create table public.amendment_modalities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  code text not null check (code ~ '^[a-z0-9_]{2,40}$'),
  name text not null,
  description text,
  requires_cancellation boolean not null default true,
  is_impositive boolean not null default false,
  counts_toward_individual_limit boolean not null default false,
  legal_basis text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code),
  unique (id, organization_id)
);
create trigger amendment_modalities_updated_at before update on public.amendment_modalities for each row execute function public.set_updated_at();
create trigger amendment_modalities_audit after insert or update or delete on public.amendment_modalities for each row execute function public.audit_row_change();

-- -----------------------------------------------------------------------------
-- Modelos oficiais de documentos
-- -----------------------------------------------------------------------------
create table public.document_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null check (kind in ('emenda_orcamentaria', 'requerimento', 'indicacao', 'mocao', 'oficio', 'projeto_lei')),
  name text not null check (char_length(name) between 3 and 160),
  description text,
  body text not null check (char_length(body) between 20 and 100000),
  version integer not null default 1 check (version > 0),
  status public.rule_status not null default 'draft',
  is_default boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create unique index document_templates_default_idx on public.document_templates (organization_id, kind) where is_default and status = 'active';
create trigger document_templates_updated_at before update on public.document_templates for each row execute function public.set_updated_at();
create trigger document_templates_audit after insert or update or delete on public.document_templates for each row execute function public.audit_row_change();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.rule_templates enable row level security;
alter table public.legal_rules enable row level security;
alter table public.amendment_modalities enable row level security;
alter table public.document_templates enable row level security;

create policy rule_templates_select on public.rule_templates for select to authenticated using (true);
create policy rule_templates_write on public.rule_templates for all to authenticated
  using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));

create policy legal_rules_select on public.legal_rules for select to authenticated
  using (public.is_org_member(organization_id));
create policy legal_rules_insert on public.legal_rules for insert to authenticated
  with check (public.has_org_role(organization_id, array['org_admin']::public.member_role[]) and status = 'draft');
create policy legal_rules_update on public.legal_rules for update to authenticated
  using (public.has_org_role(organization_id, array['org_admin']::public.member_role[]))
  with check (public.has_org_role(organization_id, array['org_admin']::public.member_role[]));
create policy legal_rules_delete on public.legal_rules for delete to authenticated
  using (public.has_org_role(organization_id, array['org_admin']::public.member_role[]) and status = 'draft');

create policy amendment_modalities_select on public.amendment_modalities for select to authenticated
  using (public.is_org_member(organization_id));
create policy amendment_modalities_write on public.amendment_modalities for all to authenticated
  using (public.has_org_role(organization_id, array['org_admin']::public.member_role[]))
  with check (public.has_org_role(organization_id, array['org_admin']::public.member_role[]));

create policy document_templates_select on public.document_templates for select to authenticated
  using (public.is_org_member(organization_id));
create policy document_templates_write on public.document_templates for all to authenticated
  using (public.has_org_role(organization_id, array['org_admin']::public.member_role[]))
  with check (public.has_org_role(organization_id, array['org_admin']::public.member_role[]));

-- status ativo só via activate_legal_rule()
revoke update on public.legal_rules from anon, authenticated;
grant update (name, description, params, legal_basis, source_document_id, sphere, severity, applies_to_modalities,
  local_incidence_confirmed, incidence_note, effective_from, effective_to) on public.legal_rules to authenticated;
