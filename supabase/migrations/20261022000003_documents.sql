-- =============================================================================
-- LegisMind — 0003: Base Legislativa (documentos, versões, trechos e jobs)
-- =============================================================================

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  fiscal_year_id uuid,
  doc_type public.document_type not null,
  title text not null check (char_length(title) between 3 and 300),
  legal_reference text check (char_length(legal_reference) <= 300),
  sphere text not null default 'municipal' check (sphere in ('federal', 'estadual', 'municipal')),
  description text check (char_length(description) <= 4000),
  publication_date date,
  effective_from date,
  effective_to date,
  source_url text check (source_url ~* '^https?://'),
  status public.document_status not null default 'active',
  current_version_id uuid,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (fiscal_year_id, organization_id) references public.fiscal_years (id, organization_id),
  check (effective_to is null or effective_from is null or effective_to >= effective_from)
);
create index documents_org_type_idx on public.documents (organization_id, doc_type, status);

create table public.document_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  document_id uuid not null,
  version_number integer not null check (version_number > 0),
  storage_path text not null,
  file_name text not null check (char_length(file_name) between 1 and 255),
  mime_type text not null check (mime_type in (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv'
  )),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 104857600),
  sha256 text check (sha256 ~ '^[a-f0-9]{64}$'),
  processing_status public.processing_status not null default 'pending_upload',
  page_count integer check (page_count >= 0),
  ocr_used boolean not null default false,
  stats jsonb not null default '{}'::jsonb,
  error_message text,
  change_notes text check (char_length(change_notes) <= 2000),
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (document_id, version_number),
  unique (id, organization_id),
  unique (id, document_id),
  foreign key (document_id, organization_id) references public.documents (id, organization_id) on delete cascade,
  -- o arquivo precisa estar dentro da pasta da instituição no Storage
  check (storage_path like organization_id::text || '/%' and storage_path !~ '\.\.')
);

-- Texto extraído por página (base para segmentação, OCR e conferência humana)
create table public.document_pages (
  version_id uuid not null,
  organization_id uuid not null,
  page integer not null check (page > 0),
  text text not null default '',
  char_count integer generated always as (char_length(text)) stored,
  ocr boolean not null default false,
  primary key (version_id, page),
  foreign key (version_id, organization_id) references public.document_versions (id, organization_id) on delete cascade
);

alter table public.documents
  add constraint documents_current_version_fk
  foreign key (current_version_id, id) references public.document_versions (id, document_id)
  on delete set null (current_version_id);

create table public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  document_id uuid not null,
  version_id uuid not null,
  chunk_index integer not null check (chunk_index >= 0),
  page_start integer check (page_start > 0),
  page_end integer check (page_end > 0),
  section_path text,
  content text not null check (char_length(content) > 0),
  content_tsv tsvector generated always as (
    to_tsvector('public.pt_unaccent'::regconfig, coalesce(section_path, '') || ' ' || content)
  ) stored,
  embedding extensions.vector(1024),
  embedding_model text,
  token_estimate integer,
  flags text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (version_id, chunk_index),
  foreign key (version_id, organization_id) references public.document_versions (id, organization_id) on delete cascade,
  foreign key (document_id, organization_id) references public.documents (id, organization_id) on delete cascade
);
create index document_chunks_tsv_idx on public.document_chunks using gin (content_tsv);
create index document_chunks_embedding_idx on public.document_chunks using hnsw (embedding extensions.vector_cosine_ops);
create index document_chunks_doc_idx on public.document_chunks (organization_id, document_id);
comment on column public.document_chunks.flags is 'Marcadores de segurança/qualidade, ex.: possible_prompt_injection, low_text_density.';

create table public.processing_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  document_version_id uuid not null,
  job_type text not null default 'ingest_document' check (job_type in ('ingest_document', 'reindex_document', 'embed_chunks')),
  status public.job_status not null default 'queued',
  stage text not null default 'queued',
  progress numeric(5, 2) not null default 0 check (progress between 0 and 100),
  attempts integer not null default 0,
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  state jsonb not null default '{}'::jsonb,
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  foreign key (document_version_id, organization_id) references public.document_versions (id, organization_id) on delete cascade
);
create index processing_jobs_queue_idx on public.processing_jobs (run_after) where status in ('queued', 'running');
create index processing_jobs_version_idx on public.processing_jobs (document_version_id);

create table public.processing_job_events (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.processing_jobs (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  level text not null check (level in ('info', 'warning', 'error')),
  message text not null,
  details jsonb,
  created_at timestamptz not null default now()
);
create index processing_job_events_job_idx on public.processing_job_events (job_id, created_at);

create table public.extraction_issues (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  version_id uuid not null,
  severity text not null check (severity in ('info', 'warning', 'error')),
  code text not null,
  message text not null,
  page integer,
  excerpt text,
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  resolution_note text,
  resolved_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (version_id, organization_id) references public.document_versions (id, organization_id) on delete cascade
);
create index extraction_issues_version_idx on public.extraction_issues (version_id, status);

create trigger documents_updated_at before update on public.documents for each row execute function public.set_updated_at();
create trigger document_versions_updated_at before update on public.document_versions for each row execute function public.set_updated_at();
create trigger processing_jobs_updated_at before update on public.processing_jobs for each row execute function public.set_updated_at();
create trigger documents_audit after insert or update or delete on public.documents for each row execute function public.audit_row_change();
create trigger document_versions_audit after insert or delete on public.document_versions for each row execute function public.audit_row_change();

-- Numeração de versões e registro do responsável pelo envio.
create function public.document_versions_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext(new.document_id::text));
  if new.version_number is null or new.version_number <= 0 then
    select coalesce(max(version_number), 0) + 1 into new.version_number
    from public.document_versions where document_id = new.document_id;
  end if;
  new.uploaded_by := coalesce(auth.uid(), new.uploaded_by);
  if coalesce(auth.role(), '') <> 'service_role' then
    new.processing_status := 'pending_upload';
    new.stats := '{}'::jsonb;
    new.page_count := null;
    new.ocr_used := false;
    new.error_message := null;
    new.processed_at := null;
  end if;
  return new;
end;
$$;

create trigger document_versions_numbering
  before insert on public.document_versions
  for each row execute function public.document_versions_before_insert();

-- Responsável e data da conferência são sempre definidos pelo servidor.
create function public.extraction_issue_resolution()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'open' then
      new.resolved_by := null;
      new.resolved_at := null;
    else
      new.resolved_by := auth.uid();
      new.resolved_at := now();
    end if;
  else
    new.resolved_by := old.resolved_by;
    new.resolved_at := old.resolved_at;
  end if;
  return new;
end;
$$;

create trigger extraction_issues_resolution
  before update on public.extraction_issues
  for each row execute function public.extraction_issue_resolution();

-- -----------------------------------------------------------------------------
-- RPCs
-- -----------------------------------------------------------------------------

-- Enfileira o processamento de uma versão já enviada ao Storage.
create function public.enqueue_document_processing(p_version_id uuid, p_job_type text default 'ingest_document')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.document_versions%rowtype;
  v_job uuid;
begin
  select * into v_version from public.document_versions where id = p_version_id;
  if not found then
    raise exception 'Versão de documento não encontrada.' using errcode = 'P0002';
  end if;
  if not public.has_org_role(v_version.organization_id, array['org_admin']::public.member_role[]) then
    raise exception 'Apenas administradores da instituição podem processar documentos.' using errcode = '42501';
  end if;
  if p_job_type not in ('ingest_document', 'reindex_document') then
    raise exception 'Tipo de processamento inválido.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.processing_jobs
    where document_version_id = p_version_id and status in ('queued', 'running')
  ) then
    raise exception 'Já existe um processamento em andamento para esta versão.' using errcode = 'P0001';
  end if;
  if p_job_type = 'ingest_document' and not exists (
    select 1 from storage.objects o where o.bucket_id = 'documents' and o.name = v_version.storage_path
  ) then
    raise exception 'Arquivo ainda não foi enviado ao armazenamento.' using errcode = 'P0001';
  end if;

  insert into public.processing_jobs (organization_id, document_version_id, job_type, created_by)
  values (v_version.organization_id, p_version_id, p_job_type, auth.uid())
  returning id into v_job;

  update public.document_versions
  set processing_status = 'queued', error_message = null
  where id = p_version_id;

  perform public.write_audit_log(v_version.organization_id, 'enqueue_processing', 'document_versions', p_version_id::text,
    'Processamento enfileirado', jsonb_build_object('job_id', v_job, 'job_type', p_job_type));
  return v_job;
end;
$$;

-- Define a versão vigente de um documento.
create function public.set_current_document_version(p_version_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.document_versions%rowtype;
begin
  select * into v_version from public.document_versions where id = p_version_id;
  if not found then
    raise exception 'Versão não encontrada.' using errcode = 'P0002';
  end if;
  if not public.has_org_role(v_version.organization_id, array['org_admin']::public.member_role[]) then
    raise exception 'Apenas administradores da instituição podem alterar a versão vigente.' using errcode = '42501';
  end if;
  update public.documents set current_version_id = p_version_id where id = v_version.document_id;
end;
$$;

-- Reserva o próximo job da fila (uso exclusivo do worker com service role).
create function public.claim_processing_job(
  p_worker text,
  p_lock_timeout interval default interval '10 minutes',
  p_organization_id uuid default null
)
returns setof public.processing_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  update public.processing_jobs j
  set status = 'running',
      locked_at = now(),
      locked_by = p_worker,
      started_at = coalesce(j.started_at, now()),
      -- lock expirado conta como falha (evita laços infinitos de travamento)
      attempts = case when j.status = 'running' then j.attempts + 1 else j.attempts end
  where j.id = (
    select q.id
    from public.processing_jobs q
    where ((q.status = 'queued' and q.run_after <= now())
        or (q.status = 'running' and q.locked_at < now() - p_lock_timeout))
      and (p_organization_id is null or q.organization_id = p_organization_id)
    order by q.run_after
    for update skip locked
    limit 1
  )
  returning j.*;
end;
$$;

-- Busca híbrida em trechos documentais (textual + semântica, combinadas por RRF).
-- security invoker: as políticas RLS do chamador continuam valendo.
create function public.search_document_chunks(
  p_query text,
  p_query_embedding extensions.vector(1024) default null,
  p_doc_types public.document_type[] default null,
  p_fiscal_year_id uuid default null,
  p_limit integer default 8,
  p_include_obsolete boolean default false
)
returns table (
  chunk_id uuid,
  document_id uuid,
  version_id uuid,
  document_title text,
  doc_type public.document_type,
  legal_reference text,
  page_start integer,
  page_end integer,
  section_path text,
  content text,
  flags text[],
  text_rank real,
  vector_distance double precision,
  score double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
  with params as (
    select public.to_or_tsquery(p_query) as q, least(greatest(coalesce(p_limit, 8), 1), 30) as lim
  ),
  base as (
    select c.*, d.title, d.doc_type, d.legal_reference
    from public.document_chunks c
    join public.documents d on d.id = c.document_id and d.current_version_id = c.version_id
    where (p_include_obsolete or d.status = 'active')
      and (p_doc_types is null or d.doc_type = any (p_doc_types))
      and (p_fiscal_year_id is null or d.fiscal_year_id is null or d.fiscal_year_id = p_fiscal_year_id)
  ),
  text_hits as (
    select b.id, ts_rank_cd(b.content_tsv, p.q) as rank,
           row_number() over (order by ts_rank_cd(b.content_tsv, p.q) desc) as rn
    from base b, params p
    where p.q is not null and b.content_tsv @@ p.q
    order by rank desc
    limit 50
  ),
  vector_hits as (
    select b.id, (b.embedding operator(extensions.<=>) p_query_embedding) as dist,
           row_number() over (order by b.embedding operator(extensions.<=>) p_query_embedding) as rn
    from base b
    where p_query_embedding is not null and b.embedding is not null
    order by dist
    limit 50
  ),
  fused as (
    select coalesce(t.id, v.id) as id,
           t.rank as text_rank,
           v.dist as vector_distance,
           coalesce(1.0 / (60 + t.rn), 0) + coalesce(1.0 / (60 + v.rn), 0) as score
    from text_hits t
    full outer join vector_hits v on v.id = t.id
  )
  select b.id, b.document_id, b.version_id, b.title, b.doc_type, b.legal_reference,
         b.page_start, b.page_end, b.section_path, b.content, b.flags,
         f.text_rank, f.vector_distance, f.score
  from fused f
  join base b on b.id = f.id
  order by f.score desc
  limit (select lim from params)
$$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.documents enable row level security;
alter table public.document_versions enable row level security;
alter table public.document_chunks enable row level security;
alter table public.document_pages enable row level security;
alter table public.processing_jobs enable row level security;
alter table public.processing_job_events enable row level security;
alter table public.extraction_issues enable row level security;

create policy documents_select on public.documents for select to authenticated
  using (public.is_org_member(organization_id));
create policy documents_insert on public.documents for insert to authenticated
  with check (public.has_org_role(organization_id, array['org_admin']::public.member_role[]));
create policy documents_update on public.documents for update to authenticated
  using (public.has_org_role(organization_id, array['org_admin']::public.member_role[]))
  with check (public.has_org_role(organization_id, array['org_admin']::public.member_role[]));
create policy documents_delete on public.documents for delete to authenticated
  using (public.has_org_role(organization_id, array['org_admin']::public.member_role[]));

create policy document_versions_select on public.document_versions for select to authenticated
  using (public.is_org_member(organization_id));
create policy document_versions_insert on public.document_versions for insert to authenticated
  with check (public.has_org_role(organization_id, array['org_admin']::public.member_role[]));
create policy document_versions_update on public.document_versions for update to authenticated
  using (public.has_org_role(organization_id, array['org_admin']::public.member_role[]))
  with check (public.has_org_role(organization_id, array['org_admin']::public.member_role[]));

create policy document_chunks_select on public.document_chunks for select to authenticated
  using (public.is_org_member(organization_id));

create policy document_pages_select on public.document_pages for select to authenticated
  using (public.is_org_member(organization_id));

create policy processing_jobs_select on public.processing_jobs for select to authenticated
  using (public.is_org_member(organization_id));

create policy processing_job_events_select on public.processing_job_events for select to authenticated
  using (public.has_org_role(organization_id, array['org_admin']::public.member_role[]));

create policy extraction_issues_select on public.extraction_issues for select to authenticated
  using (public.is_org_member(organization_id));
create policy extraction_issues_update on public.extraction_issues for update to authenticated
  using (public.has_org_role(organization_id, array['org_admin', 'reviewer']::public.member_role[]))
  with check (public.has_org_role(organization_id, array['org_admin', 'reviewer']::public.member_role[]));

-- Privilégios por coluna: status de processamento só é alterado pelo worker.
revoke update on public.document_versions from anon, authenticated;
grant update (change_notes) on public.document_versions to authenticated;
revoke insert, update, delete on public.document_chunks from anon, authenticated;
revoke insert, update, delete on public.document_pages from anon, authenticated;
revoke insert, update, delete on public.processing_jobs from anon, authenticated;
revoke insert, update, delete on public.processing_job_events from anon, authenticated;
revoke insert, delete, update on public.extraction_issues from anon, authenticated;
grant update (status, resolution_note) on public.extraction_issues to authenticated;
-- a versão vigente só muda por set_current_document_version() ou pelo worker
revoke update on public.documents from anon, authenticated;
grant update (fiscal_year_id, doc_type, title, legal_reference, sphere, description, publication_date,
  effective_from, effective_to, source_url, status) on public.documents to authenticated;

revoke execute on function public.claim_processing_job(text, interval, uuid) from public, anon, authenticated;
grant execute on function public.claim_processing_job(text, interval, uuid) to service_role;
