-- =============================================================================
-- LegisMind — 0002: multi-tenancy (instituições, gabinetes, perfis e papéis)
-- Toda informação institucional carrega organization_id. Tabelas filhas usam
-- chaves estrangeiras compostas (id, organization_id) para impedir, no próprio
-- banco, referências cruzadas entre instituições.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Planos comerciais
-- -----------------------------------------------------------------------------
create table public.plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9_-]{2,40}$'),
  name text not null,
  description text,
  max_users integer check (max_users > 0),
  max_offices integer check (max_offices > 0),
  max_storage_mb integer check (max_storage_mb > 0),
  max_documents integer check (max_documents > 0),
  monthly_ai_requests integer check (monthly_ai_requests >= 0),
  monthly_ai_tokens bigint check (monthly_ai_tokens >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Instituições (Câmaras Municipais, Assembleias Legislativas, CLDF)
-- -----------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 3 and 200),
  short_name text check (char_length(short_name) <= 60),
  kind public.org_kind not null,
  uf char(2) not null check (uf ~ '^[A-Z]{2}$'),
  municipality text,
  ibge_code text check (ibge_code ~ '^[0-9]{7}$'),
  cnpj text check (cnpj ~ '^[0-9]{14}$'),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,60}$'),
  status public.org_status not null default 'trial',
  plan_id uuid references public.plans (id) on delete set null,
  is_demo boolean not null default false,
  parliamentarians_count integer check (parliamentarians_count > 0),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_municipality_required check (kind <> 'camara_municipal' or municipality is not null)
);
comment on column public.organizations.is_demo is 'Instituição de demonstração com dados FICTÍCIOS. Nunca usar como fonte oficial.';

create table public.organization_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  institution_header text,
  institution_address text,
  amendment_number_prefix text not null default 'EM' check (amendment_number_prefix ~ '^[A-Z]{1,6}$'),
  require_reviewer_approval boolean not null default true,
  ai_enabled boolean not null default true,
  ai_monthly_request_limit integer check (ai_monthly_request_limit >= 0),
  ai_message_retention_days integer not null default 365 check (ai_message_retention_days between 30 and 3650),
  audit_retention_days integer not null default 1825 check (audit_retention_days between 365 and 3650),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  granted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Perfis e vínculos
-- -----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text check (char_length(full_name) <= 160),
  display_name text check (char_length(display_name) <= 80),
  job_title text check (char_length(job_title) <= 120),
  phone text check (char_length(phone) <= 30),
  last_organization_id uuid references public.organizations (id) on delete set null,
  last_office_id uuid,
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null,
  status public.member_status not null default 'active',
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index memberships_user_idx on public.memberships (user_id);

create table public.legislative_terms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  number integer not null check (number > 0),
  starts_on date not null,
  ends_on date not null,
  created_at timestamptz not null default now(),
  check (ends_on > starts_on),
  unique (organization_id, number),
  unique (id, organization_id)
);

create table public.offices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 3 and 160),
  parliamentarian_name text not null check (char_length(parliamentarian_name) between 3 and 160),
  parliamentarian_user_id uuid references auth.users (id) on delete set null,
  party text check (char_length(party) <= 30),
  legislative_term_id uuid,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (legislative_term_id, organization_id)
    references public.legislative_terms (id, organization_id) on delete set null (legislative_term_id)
);
create index offices_org_idx on public.offices (organization_id);

create table public.office_members (
  office_id uuid not null,
  organization_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  office_role public.office_role not null default 'advisor',
  created_at timestamptz not null default now(),
  primary key (office_id, user_id),
  foreign key (office_id, organization_id) references public.offices (id, organization_id) on delete cascade,
  -- só pode integrar um gabinete quem é membro da instituição
  foreign key (organization_id, user_id) references public.memberships (organization_id, user_id) on delete cascade
);
create index office_members_user_idx on public.office_members (user_id);

alter table public.profiles
  add constraint profiles_last_office_fk foreign key (last_office_id) references public.offices (id) on delete set null;

-- -----------------------------------------------------------------------------
-- Exercícios financeiros
-- -----------------------------------------------------------------------------
create table public.fiscal_years (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  year integer not null check (year between 2000 and 2100),
  phase public.fiscal_phase not null default 'ploa',
  is_active boolean not null default false,
  rcl_amount numeric(18, 2) check (rcl_amount >= 0),
  rcl_reference text,
  amendment_deadline date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, year),
  unique (id, organization_id),
  check (rcl_amount is null or rcl_reference is not null)
);
create unique index fiscal_years_one_active_idx on public.fiscal_years (organization_id) where is_active;
comment on column public.fiscal_years.rcl_amount is 'Receita Corrente Líquida de referência para limites de emendas. Deve indicar a fonte em rcl_reference.';

-- -----------------------------------------------------------------------------
-- Convites
-- -----------------------------------------------------------------------------
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role public.member_role not null,
  office_id uuid,
  office_role public.office_role,
  invited_by uuid references auth.users (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (office_id, organization_id) references public.offices (id, organization_id) on delete cascade,
  check ((office_id is null) = (office_role is null))
);
create unique index invitations_pending_idx on public.invitations (organization_id, email) where status = 'pending';

-- -----------------------------------------------------------------------------
-- Auditoria (somente inserção por gatilhos e funções confiáveis)
-- -----------------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations (id) on delete cascade,
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text,
  summary text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_org_created_idx on public.audit_logs (organization_id, created_at desc);

create function public.write_audit_log(
  p_organization_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_summary text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, summary, metadata)
  values (p_organization_id, auth.uid(), p_action, p_entity_type, p_entity_id, p_summary, coalesce(p_metadata, '{}'::jsonb));
end;
$$;

-- Gatilho genérico: registra a operação e os nomes das colunas alteradas (sem valores, por privacidade).
create function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_old jsonb;
  v_changed text[];
  v_org uuid;
  v_id text;
begin
  if tg_op = 'DELETE' then
    v_row := to_jsonb(old);
  else
    v_row := to_jsonb(new);
  end if;

  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    select array_agg(key order by key) into v_changed
    from jsonb_each(v_row) as n(key, value)
    where n.value is distinct from v_old -> n.key
      and n.key not in ('updated_at');
    if v_changed is null then
      return new;
    end if;
  end if;

  v_org := case
    when tg_table_name = 'organizations' then (v_row ->> 'id')::uuid
    else nullif(v_row ->> 'organization_id', '')::uuid
  end;
  v_id := coalesce(v_row ->> 'id', v_row ->> 'user_id', v_row ->> 'organization_id');

  -- Em exclusões em cascata a instituição já não existe: registra sem vínculo.
  if v_org is not null and not exists (select 1 from public.organizations o where o.id = v_org) then
    v_org := null;
  end if;

  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    v_org,
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    v_id,
    case when v_changed is not null then jsonb_build_object('changed', to_jsonb(v_changed)) else '{}'::jsonb end
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Funções auxiliares de autorização (security definer evita recursão de RLS)
-- -----------------------------------------------------------------------------
create function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.platform_admins pa where pa.user_id = (select auth.uid()))
$$;

create function public.is_org_member(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.organizations o on o.id = m.organization_id
    where m.organization_id = p_org
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and o.status in ('trial', 'active')
  )
$$;

create function public.has_org_role(p_org uuid, p_roles public.member_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.organizations o on o.id = m.organization_id
    where m.organization_id = p_org
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.role = any (p_roles)
      and o.status in ('trial', 'active')
  )
$$;

create function public.is_office_member(p_office uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.office_members om
    join public.memberships m on m.organization_id = om.organization_id and m.user_id = om.user_id
    join public.organizations o on o.id = om.organization_id
    where om.office_id = p_office
      and om.user_id = (select auth.uid())
      and m.status = 'active'
      and o.status in ('trial', 'active')
  )
$$;

create function public.shares_organization_with(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships mine
    join public.memberships theirs on theirs.organization_id = mine.organization_id
    where mine.user_id = (select auth.uid())
      and mine.status = 'active'
      and theirs.user_id = p_user
  )
$$;

-- -----------------------------------------------------------------------------
-- Gatilhos de domínio
-- -----------------------------------------------------------------------------
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    lower(coalesce(new.email, '')),
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.handle_new_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.organization_settings (organization_id, institution_header)
  values (new.id, upper(new.name))
  on conflict (organization_id) do nothing;
  return new;
end;
$$;

create trigger organizations_create_settings
  after insert on public.organizations
  for each row execute function public.handle_new_organization();

-- Impede que a instituição fique sem administrador ativo.
create function public.ensure_org_keeps_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'org_admin' and old.status = 'active'
     and (tg_op = 'DELETE' or new.role <> 'org_admin' or new.status <> 'active')
     and exists (select 1 from public.organizations o where o.id = old.organization_id)
     and not exists (
       select 1 from public.memberships m
       where m.organization_id = old.organization_id
         and m.id <> old.id
         and m.role = 'org_admin'
         and m.status = 'active'
     ) then
    raise exception 'A instituição precisa manter ao menos um administrador ativo.'
      using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger memberships_keep_admin
  before update or delete on public.memberships
  for each row execute function public.ensure_org_keeps_admin();

-- Usuários não podem alterar o próprio e-mail no perfil (fonte: auth.users).
create function public.protect_profile_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    new.email := old.email;
    new.id := old.id;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

create trigger profiles_protect_columns
  before update on public.profiles
  for each row execute function public.protect_profile_columns();

create trigger plans_updated_at before update on public.plans for each row execute function public.set_updated_at();
create trigger organizations_updated_at before update on public.organizations for each row execute function public.set_updated_at();
create trigger organization_settings_updated_at before update on public.organization_settings for each row execute function public.set_updated_at();
create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger memberships_updated_at before update on public.memberships for each row execute function public.set_updated_at();
create trigger offices_updated_at before update on public.offices for each row execute function public.set_updated_at();
create trigger fiscal_years_updated_at before update on public.fiscal_years for each row execute function public.set_updated_at();

create trigger organizations_audit after insert or update or delete on public.organizations for each row execute function public.audit_row_change();
create trigger organization_settings_audit after update on public.organization_settings for each row execute function public.audit_row_change();
create trigger memberships_audit after insert or update or delete on public.memberships for each row execute function public.audit_row_change();
create trigger offices_audit after insert or update or delete on public.offices for each row execute function public.audit_row_change();
create trigger office_members_audit after insert or update or delete on public.office_members for each row execute function public.audit_row_change();
create trigger fiscal_years_audit after insert or update or delete on public.fiscal_years for each row execute function public.audit_row_change();
create trigger invitations_audit after insert or update on public.invitations for each row execute function public.audit_row_change();
create trigger platform_admins_audit after insert or delete on public.platform_admins for each row execute function public.audit_row_change();

-- -----------------------------------------------------------------------------
-- RPCs de tenancy
-- -----------------------------------------------------------------------------

-- Ativa um exercício financeiro (desativa os demais da instituição de forma atômica).
create function public.activate_fiscal_year(p_fiscal_year_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.fiscal_years where id = p_fiscal_year_id;
  if v_org is null then
    raise exception 'Exercício não encontrado.' using errcode = 'P0002';
  end if;
  if not public.has_org_role(v_org, array['org_admin']::public.member_role[]) then
    raise exception 'Apenas administradores da instituição podem ativar exercícios.' using errcode = '42501';
  end if;
  update public.fiscal_years set is_active = false where organization_id = v_org and is_active and id <> p_fiscal_year_id;
  update public.fiscal_years set is_active = true where id = p_fiscal_year_id;
end;
$$;

-- Convites pendentes do usuário autenticado (pelo e-mail verificado no token).
create function public.my_pending_invitations()
returns table (
  id uuid,
  organization_id uuid,
  organization_name text,
  role public.member_role,
  office_id uuid,
  office_name text,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.organization_id, o.name, i.role, i.office_id, f.name, i.expires_at
  from public.invitations i
  join public.organizations o on o.id = i.organization_id
  left join public.offices f on f.id = i.office_id
  where i.status = 'pending'
    and i.expires_at > now()
    and i.email = lower(coalesce(auth.jwt() ->> 'email', ''))
    and o.status in ('trial', 'active')
$$;

create function public.accept_invitation(p_invitation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invitations%rowtype;
  v_uid uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if v_uid is null then
    raise exception 'Sessão inválida.' using errcode = '42501';
  end if;

  select * into v_inv from public.invitations where id = p_invitation_id for update;
  if not found or v_inv.email <> v_email then
    raise exception 'Convite não encontrado para este usuário.' using errcode = 'P0002';
  end if;
  if v_inv.status <> 'pending' then
    raise exception 'Este convite não está mais disponível.' using errcode = 'P0001';
  end if;
  if v_inv.expires_at <= now() then
    raise exception 'Este convite expirou. Solicite um novo convite ao administrador.' using errcode = 'P0001';
  end if;

  insert into public.memberships (organization_id, user_id, role, invited_by)
  values (v_inv.organization_id, v_uid, v_inv.role, v_inv.invited_by)
  on conflict (organization_id, user_id) do update set status = 'active';

  if v_inv.office_id is not null then
    insert into public.office_members (office_id, organization_id, user_id, office_role)
    values (v_inv.office_id, v_inv.organization_id, v_uid, v_inv.office_role)
    on conflict (office_id, user_id) do update set office_role = excluded.office_role;
  end if;

  update public.invitations
  set status = 'accepted', accepted_at = now(), accepted_by = v_uid
  where id = v_inv.id;

  update public.profiles
  set last_organization_id = v_inv.organization_id,
      last_office_id = coalesce(v_inv.office_id, last_office_id)
  where id = v_uid;

  return v_inv.organization_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.plans enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_settings enable row level security;
alter table public.platform_admins enable row level security;
alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.legislative_terms enable row level security;
alter table public.offices enable row level security;
alter table public.office_members enable row level security;
alter table public.fiscal_years enable row level security;
alter table public.invitations enable row level security;
alter table public.audit_logs enable row level security;

-- plans: catálogo visível a usuários autenticados; gestão pela plataforma
create policy plans_select on public.plans for select to authenticated using (true);
create policy plans_write on public.plans for all to authenticated
  using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));

-- organizations
create policy organizations_select on public.organizations for select to authenticated
  using (public.is_org_member(id) or (select public.is_platform_admin()));
create policy organizations_insert on public.organizations for insert to authenticated
  with check ((select public.is_platform_admin()));
create policy organizations_update on public.organizations for update to authenticated
  using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));
create policy organizations_delete on public.organizations for delete to authenticated
  using ((select public.is_platform_admin()));

-- organization_settings
create policy organization_settings_select on public.organization_settings for select to authenticated
  using (public.is_org_member(organization_id) or (select public.is_platform_admin()));
create policy organization_settings_update on public.organization_settings for update to authenticated
  using (public.has_org_role(organization_id, array['org_admin']::public.member_role[]))
  with check (public.has_org_role(organization_id, array['org_admin']::public.member_role[]));

-- platform_admins: leitura do próprio registro; concessão apenas via service role
create policy platform_admins_select on public.platform_admins for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_platform_admin()));

-- profiles
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.shares_organization_with(id) or (select public.is_platform_admin()));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- memberships
create policy memberships_select on public.memberships for select to authenticated
  using (user_id = (select auth.uid()) or public.is_org_member(organization_id) or (select public.is_platform_admin()));
create policy memberships_insert on public.memberships for insert to authenticated
  with check (public.has_org_role(organization_id, array['org_admin']::public.member_role[]) or (select public.is_platform_admin()));
create policy memberships_update on public.memberships for update to authenticated
  using (public.has_org_role(organization_id, array['org_admin']::public.member_role[]) or (select public.is_platform_admin()))
  with check (public.has_org_role(organization_id, array['org_admin']::public.member_role[]) or (select public.is_platform_admin()));
create policy memberships_delete on public.memberships for delete to authenticated
  using (public.has_org_role(organization_id, array['org_admin']::public.member_role[]) or (select public.is_platform_admin()));

-- legislative_terms
create policy legislative_terms_select on public.legislative_terms for select to authenticated
  using (public.is_org_member(organization_id));
create policy legislative_terms_write on public.legislative_terms for all to authenticated
  using (public.has_org_role(organization_id, array['org_admin']::public.member_role[]))
  with check (public.has_org_role(organization_id, array['org_admin']::public.member_role[]));

-- offices
create policy offices_select on public.offices for select to authenticated
  using (public.is_org_member(organization_id) or (select public.is_platform_admin()));
create policy offices_write on public.offices for all to authenticated
  using (public.has_org_role(organization_id, array['org_admin']::public.member_role[]))
  with check (public.has_org_role(organization_id, array['org_admin']::public.member_role[]));

-- office_members
create policy office_members_select on public.office_members for select to authenticated
  using (public.is_org_member(organization_id));
create policy office_members_write on public.office_members for all to authenticated
  using (public.has_org_role(organization_id, array['org_admin']::public.member_role[]))
  with check (public.has_org_role(organization_id, array['org_admin']::public.member_role[]));

-- fiscal_years
create policy fiscal_years_select on public.fiscal_years for select to authenticated
  using (public.is_org_member(organization_id));
create policy fiscal_years_write on public.fiscal_years for all to authenticated
  using (public.has_org_role(organization_id, array['org_admin']::public.member_role[]))
  with check (public.has_org_role(organization_id, array['org_admin']::public.member_role[]));

-- invitations
create policy invitations_select on public.invitations for select to authenticated
  using (public.has_org_role(organization_id, array['org_admin']::public.member_role[]) or (select public.is_platform_admin()));
create policy invitations_write on public.invitations for all to authenticated
  using (public.has_org_role(organization_id, array['org_admin']::public.member_role[]) or (select public.is_platform_admin()))
  with check (public.has_org_role(organization_id, array['org_admin']::public.member_role[]) or (select public.is_platform_admin()));

-- audit_logs: leitura por administradores; sem escrita direta
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (
    (organization_id is not null and public.has_org_role(organization_id, array['org_admin']::public.member_role[]))
    or ((select public.is_platform_admin()) and entity_type in ('organizations', 'memberships', 'platform_admins', 'plans', 'invitations'))
  );

-- Privilégios: escrita em auditoria apenas por funções confiáveis
revoke insert, update, delete on public.audit_logs from anon, authenticated;
revoke insert, update, delete on public.platform_admins from anon, authenticated;
revoke execute on function public.write_audit_log(uuid, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.write_audit_log(uuid, text, text, text, text, jsonb) to service_role;
