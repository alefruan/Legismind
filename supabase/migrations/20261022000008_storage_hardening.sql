-- =============================================================================
-- LegisMind — 0008: Storage privado e endurecimento de privilégios
-- =============================================================================

-- Buckets privados: originais da Base Legislativa e exportações geradas.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('documents', 'documents', false, 104857600, array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv'
  ]),
  ('exports', 'exports', false, 20971520, array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Caminho obrigatório: <organization_id>/<document_id>/<version_id>/<arquivo>
create policy legismind_documents_select on storage.objects for select to authenticated
  using (bucket_id = 'documents' and public.is_org_member(public.storage_org_id(name)));

create policy legismind_documents_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documents'
    and public.has_org_role(public.storage_org_id(name), array['org_admin']::public.member_role[])
    and exists (
      select 1 from public.document_versions v
      where v.storage_path = name
        and v.processing_status = 'pending_upload'
    )
  );

-- Originais são imutáveis para usuários: sem update/delete (somente service role).
-- Exportações: geradas e lidas pelo servidor, entregues por URL assinada.

-- -----------------------------------------------------------------------------
-- Endurecimento: o papel anônimo não acessa nenhum dado do LegisMind
-- -----------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon;
revoke execute on all functions in schema public from public;

alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon;
alter default privileges in schema public revoke execute on functions from public;

-- Funções expostas a usuários autenticados (todas validam permissões internamente)
grant execute on function public.is_platform_admin() to authenticated, service_role;
grant execute on function public.is_org_member(uuid) to authenticated, service_role;
grant execute on function public.has_org_role(uuid, public.member_role[]) to authenticated, service_role;
grant execute on function public.is_office_member(uuid) to authenticated, service_role;
grant execute on function public.shares_organization_with(uuid) to authenticated, service_role;
grant execute on function public.can_read_amendment(uuid) to authenticated, service_role;
grant execute on function public.can_edit_amendment(uuid) to authenticated, service_role;
grant execute on function public.storage_org_id(text) to authenticated, service_role;
grant execute on function public.immutable_unaccent(text) to authenticated, service_role;
grant execute on function public.to_or_tsquery(text) to authenticated, service_role;
grant execute on function public.activate_fiscal_year(uuid) to authenticated;
grant execute on function public.my_pending_invitations() to authenticated;
grant execute on function public.accept_invitation(uuid) to authenticated;
grant execute on function public.enqueue_document_processing(uuid, text) to authenticated, service_role;
grant execute on function public.set_current_document_version(uuid) to authenticated;
grant execute on function public.search_document_chunks(text, extensions.vector, public.document_type[], uuid, integer, boolean) to authenticated, service_role;
grant execute on function public.search_budget_allocations(uuid, text, text[], text[], text[], text[], text[], numeric, boolean, integer) to authenticated, service_role;
grant execute on function public.activate_legal_rule(uuid) to authenticated;
grant execute on function public.archive_legal_rule(uuid) to authenticated;
grant execute on function public.save_amendment_version(uuid, text) to authenticated;
grant execute on function public.allocation_commitments(uuid[], uuid) to authenticated, service_role;
grant execute on function public.office_amendment_totals(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.transition_amendment_status(uuid, public.amendment_status, text, text, date) to authenticated;
grant execute on function public.ai_quota_status(uuid) to authenticated, service_role;
grant execute on function public.platform_metrics() to authenticated;
grant execute on function public.dashboard_summary(uuid, uuid, uuid) to authenticated;
grant execute on function public.valid_rule_type(text) to authenticated, service_role;

-- Funções exclusivas do servidor
grant execute on function public.claim_processing_job(text, interval, uuid) to service_role;
grant execute on function public.record_validation_run(uuid, integer, public.validation_outcome, text, jsonb, jsonb, jsonb, jsonb, uuid) to service_role;
grant execute on function public.amendment_snapshot_json(uuid) to service_role;
grant execute on function public.write_audit_log(uuid, text, text, text, text, jsonb) to service_role;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;
grant execute on function public.apply_retention_policies() to service_role;
grant execute on function public.insert_amendment_version(uuid, text) to service_role;
