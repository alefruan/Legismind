-- =============================================================================
-- LegisMind — 0007: assistente de IA, consumo, limites, métricas e retenção
-- =============================================================================

create table public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  office_id uuid,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  fiscal_year_id uuid,
  amendment_id uuid,
  title text not null default 'Nova conversa' check (char_length(title) between 1 and 200),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (office_id, organization_id) references public.offices (id, organization_id) on delete set null (office_id),
  foreign key (fiscal_year_id, organization_id) references public.fiscal_years (id, organization_id) on delete set null (fiscal_year_id),
  foreign key (amendment_id, organization_id) references public.amendments (id, organization_id) on delete set null (amendment_id)
);
create index ai_conversations_user_idx on public.ai_conversations (user_id, updated_at desc);

alter table public.amendments
  add constraint amendments_conversation_fk foreign key (source_conversation_id)
  references public.ai_conversations (id) on delete set null;

create table public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  organization_id uuid not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null default '',
  blocks jsonb not null default '[]'::jsonb,
  provider text,
  model text,
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz not null default now(),
  foreign key (conversation_id, organization_id) references public.ai_conversations (id, organization_id) on delete cascade
);
create index ai_messages_conversation_idx on public.ai_messages (conversation_id, created_at);
comment on column public.ai_messages.blocks is 'Blocos estruturados: chamadas de ferramentas, resultados resumidos, citações e cartões de ação.';

create table public.ai_usage (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  conversation_id uuid references public.ai_conversations (id) on delete set null,
  feature text not null check (feature in ('assistant', 'budget_nl_query', 'intent', 'ocr', 'embeddings', 'document_drafting')),
  provider text not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  request_count integer not null default 1,
  created_at timestamptz not null default now()
);
create index ai_usage_org_created_idx on public.ai_usage (organization_id, created_at desc);

-- Limitação de requisições (janela deslizante simples, gravada pelo servidor)
create table public.api_rate_limits (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, window_start)
);

create trigger ai_conversations_updated_at before update on public.ai_conversations for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Funções de servidor
-- -----------------------------------------------------------------------------
create function public.check_rate_limit(p_key text, p_window_seconds integer, p_max integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_count integer;
begin
  insert into public.api_rate_limits (key, window_start, count)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set count = public.api_rate_limits.count + 1
  returning count into v_count;
  delete from public.api_rate_limits where window_start < now() - interval '1 day';
  return v_count <= p_max;
end;
$$;

-- Consumo de IA no mês corrente e limite aplicável (configuração da instituição > plano).
create function public.ai_quota_status(p_org uuid)
returns table (requests_used bigint, tokens_used bigint, request_limit integer, token_limit bigint, ai_enabled boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((select sum(u.request_count) from public.ai_usage u
              where u.organization_id = p_org and u.created_at >= date_trunc('month', now())), 0)::bigint,
    coalesce((select sum(u.input_tokens + u.output_tokens) from public.ai_usage u
              where u.organization_id = p_org and u.created_at >= date_trunc('month', now())), 0)::bigint,
    coalesce(s.ai_monthly_request_limit, p.monthly_ai_requests),
    p.monthly_ai_tokens,
    coalesce(s.ai_enabled, true)
  from public.organizations o
  left join public.organization_settings s on s.organization_id = o.id
  left join public.plans p on p.id = o.plan_id
  where o.id = p_org
    and (coalesce(auth.role(), '') = 'service_role'
         or public.has_org_role(p_org, array['org_admin']::public.member_role[])
         or public.is_platform_admin())
$$;

-- Métricas operacionais da plataforma: somente contagens, sem conteúdo dos gabinetes.
create function public.platform_metrics()
returns table (
  organization_id uuid,
  organization_name text,
  kind public.org_kind,
  uf char(2),
  status public.org_status,
  plan_name text,
  is_demo boolean,
  members bigint,
  offices bigint,
  documents bigint,
  storage_bytes bigint,
  amendments bigint,
  ai_requests_month bigint,
  ai_tokens_month bigint,
  failed_jobs_7d bigint,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Acesso restrito à administração da plataforma.' using errcode = '42501';
  end if;
  return query
  select o.id, o.name, o.kind, o.uf, o.status, p.name, o.is_demo,
    (select count(*) from public.memberships m where m.organization_id = o.id and m.status = 'active'),
    (select count(*) from public.offices f where f.organization_id = o.id),
    (select count(*) from public.documents d where d.organization_id = o.id),
    (select coalesce(sum(v.size_bytes), 0)::bigint from public.document_versions v where v.organization_id = o.id),
    (select count(*) from public.amendments a where a.organization_id = o.id),
    (select coalesce(sum(u.request_count), 0)::bigint from public.ai_usage u where u.organization_id = o.id and u.created_at >= date_trunc('month', now())),
    (select coalesce(sum(u.input_tokens + u.output_tokens), 0)::bigint from public.ai_usage u where u.organization_id = o.id and u.created_at >= date_trunc('month', now())),
    (select count(*) from public.processing_jobs j where j.organization_id = o.id and j.status = 'failed' and j.updated_at >= now() - interval '7 days'),
    o.created_at
  from public.organizations o
  left join public.plans p on p.id = o.plan_id
  order by o.name;
end;
$$;

-- Indicadores do painel do usuário (respeitam o gabinete e a instituição).
create function public.dashboard_summary(p_org uuid, p_office uuid default null, p_fiscal_year uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not public.is_org_member(p_org) then
    raise exception 'Sem acesso a esta instituição.' using errcode = '42501';
  end if;
  if p_office is not null and not public.is_office_member(p_office) then
    p_office := null;
  end if;

  select jsonb_build_object(
    'amendments_total', count(*) filter (where true),
    'amendments_draft', count(*) filter (where a.status in ('draft', 'needs_correction')),
    'amendments_in_review', count(*) filter (where a.status = 'in_review'),
    'amendments_ready', count(*) filter (where a.status in ('technically_validated', 'awaiting_signature')),
    'amendments_filed', count(*) filter (where a.status = 'filed'),
    'amendments_stale_validation', count(*) filter (where a.status in ('draft', 'needs_correction') and a.validated_revision is distinct from a.revision),
    'amount_total', coalesce(sum(a.total_amount) filter (where a.status <> 'archived'), 0)
  ) into v_result
  from public.amendments a
  where a.organization_id = p_org
    and (p_fiscal_year is null or a.fiscal_year_id = p_fiscal_year)
    and p_office is not null
    and a.office_id = p_office;

  v_result := v_result || jsonb_build_object(
    'reviews_pending', case when public.has_org_role(p_org, array['reviewer']::public.member_role[]) then
        (select count(*) from public.amendments a where a.organization_id = p_org and a.status = 'in_review'
           and (p_fiscal_year is null or a.fiscal_year_id = p_fiscal_year))
      else null end,
    'documents_processed', (select count(*) from public.document_versions v where v.organization_id = p_org and v.processing_status = 'completed'),
    'documents_processing', (select count(*) from public.document_versions v where v.organization_id = p_org and v.processing_status in ('queued', 'processing')),
    'documents_needing_review', (select count(*) from public.document_versions v where v.organization_id = p_org and v.processing_status = 'needs_review'),
    'allocations_pending_review', (select count(*) from public.budget_allocations b where b.organization_id = p_org and b.verification_status = 'pending_review' and b.is_current
           and (p_fiscal_year is null or b.fiscal_year_id = p_fiscal_year)),
    'allocations_total', (select count(*) from public.budget_allocations b where b.organization_id = p_org and b.is_current
           and (p_fiscal_year is null or b.fiscal_year_id = p_fiscal_year)),
    'active_rules', (select count(*) from public.legal_rules r where r.organization_id = p_org and r.status = 'active')
  );
  return v_result;
end;
$$;

-- Retenção (agendar via pg_cron: select cron.schedule('legismind-retention', '15 3 * * *', 'select public.apply_retention_policies()'))
create function public.apply_retention_policies()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_messages integer;
  v_audit integer;
  v_events integer;
  v_limits integer;
begin
  delete from public.ai_messages m
  using public.organization_settings s
  where s.organization_id = m.organization_id
    and m.created_at < now() - make_interval(days => s.ai_message_retention_days);
  get diagnostics v_messages = row_count;

  delete from public.audit_logs l
  using public.organization_settings s
  where s.organization_id = l.organization_id
    and l.created_at < now() - make_interval(days => s.audit_retention_days);
  get diagnostics v_audit = row_count;

  delete from public.processing_job_events where created_at < now() - interval '180 days';
  get diagnostics v_events = row_count;

  delete from public.api_rate_limits where window_start < now() - interval '1 day';
  get diagnostics v_limits = row_count;

  return jsonb_build_object('ai_messages', v_messages, 'audit_logs', v_audit, 'job_events', v_events, 'rate_limits', v_limits);
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;
alter table public.ai_usage enable row level security;
alter table public.api_rate_limits enable row level security;

create policy ai_conversations_select on public.ai_conversations for select to authenticated
  using (user_id = (select auth.uid()) and public.is_org_member(organization_id));
create policy ai_conversations_insert on public.ai_conversations for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_org_member(organization_id)
    and (office_id is null or public.is_office_member(office_id))
  );
create policy ai_conversations_update on public.ai_conversations for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and public.is_org_member(organization_id));
create policy ai_conversations_delete on public.ai_conversations for delete to authenticated
  using (user_id = (select auth.uid()));

create policy ai_messages_select on public.ai_messages for select to authenticated
  using (exists (
    select 1 from public.ai_conversations c
    where c.id = conversation_id and c.user_id = (select auth.uid())
  ));

create policy ai_usage_select on public.ai_usage for select to authenticated
  using (public.has_org_role(organization_id, array['org_admin']::public.member_role[]) or (select public.is_platform_admin()));

revoke insert, update, delete on public.ai_messages from anon, authenticated;
revoke insert, update, delete on public.ai_usage from anon, authenticated;
revoke all on public.api_rate_limits from anon, authenticated;
revoke update on public.ai_conversations from anon, authenticated;
grant update (title, archived_at, amendment_id) on public.ai_conversations to authenticated;

revoke execute on function public.check_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;
revoke execute on function public.apply_retention_policies() from public, anon, authenticated;
grant execute on function public.apply_retention_policies() to service_role;
