-- =============================================================================
-- LegisMind — 0001: extensões, tipos enumerados e utilitários
-- =============================================================================

create extension if not exists vector with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

-- -----------------------------------------------------------------------------
-- Tipos enumerados
-- -----------------------------------------------------------------------------
create type public.org_kind as enum ('camara_municipal', 'assembleia_legislativa', 'camara_legislativa_df');
create type public.org_status as enum ('trial', 'active', 'suspended', 'archived');
create type public.member_role as enum ('org_admin', 'parliamentarian', 'advisor', 'reviewer');
create type public.member_status as enum ('active', 'suspended');
create type public.office_role as enum ('titular', 'chief_of_staff', 'advisor');
create type public.fiscal_phase as enum ('ploa', 'loa', 'execution', 'closed');
create type public.verification_status as enum ('confirmed', 'pending_review', 'rejected');

create type public.document_type as enum (
  'loa', 'ploa', 'ldo', 'ppa', 'constituicao_federal', 'constituicao_estadual', 'lei_organica',
  'regimento_interno', 'lei_complementar', 'lei_ordinaria', 'resolucao', 'decreto', 'manual_tecnico',
  'modelo_emenda', 'anexo_orcamentario', 'outro'
);
create type public.document_status as enum ('active', 'obsolete', 'draft');
create type public.processing_status as enum ('pending_upload', 'queued', 'processing', 'needs_review', 'completed', 'failed');
create type public.job_status as enum ('queued', 'running', 'succeeded', 'failed', 'cancelled');
create type public.rule_status as enum ('draft', 'active', 'archived');

create type public.amendment_status as enum (
  'draft', 'in_review', 'needs_correction', 'technically_validated', 'awaiting_signature', 'filed', 'archived'
);
create type public.validation_outcome as enum ('validated', 'pending', 'inconsistent', 'not_verifiable');

-- -----------------------------------------------------------------------------
-- Busca textual em português, insensível a acentos
-- -----------------------------------------------------------------------------
create text search configuration public.pt_unaccent (copy = pg_catalog.portuguese);
alter text search configuration public.pt_unaccent
  alter mapping for hword, hword_part, word with extensions.unaccent, portuguese_stem;

create function public.immutable_unaccent(p_text text)
returns text
language sql
immutable
parallel safe
strict
set search_path = ''
as $$
  select extensions.unaccent('extensions.unaccent'::regdictionary, p_text)
$$;

-- Converte texto livre em tsquery com OR entre termos (maior recall para pesquisa orçamentária).
create function public.to_or_tsquery(p_text text)
returns tsquery
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when string_agg(w, ' | ') is null then null
    else to_tsquery('public.pt_unaccent'::regconfig, string_agg(w || ':*', ' | '))
  end
  from (
    select distinct w
    from unnest(regexp_split_to_array(lower(public.immutable_unaccent(coalesce(p_text, ''))), '[^a-z0-9]+')) as w
    where char_length(w) >= 3
      and w not in ('para', 'com', 'que', 'dos', 'das', 'uma', 'por', 'quero', 'mostre', 'sobre', 'como')
  ) terms
$$;

-- -----------------------------------------------------------------------------
-- Utilitários
-- -----------------------------------------------------------------------------
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Extrai o identificador da instituição do primeiro segmento do caminho no Storage.
create function public.storage_org_id(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then split_part(p_name, '/', 1)::uuid
  end
$$;
