-- Las Ñañas · aprobación, transferencia manual y documentación privada.
-- Aplicar después de 202609100004_admin_volunteer_read_panel.sql.
begin;

-- Se reutiliza documents: las columnas nuevas distinguen recursos generales,
-- entregas de una voluntaria y archivos administrativos dirigidos a ella.
alter table public.documents
  add column if not exists owner_id uuid references public.volunteer_profiles(id) on delete restrict,
  add column if not exists application_id uuid references public.membership_applications(id) on delete restrict,
  add column if not exists document_kind text not null default 'plan_resource'
    check (document_kind in ('plan_resource', 'volunteer_submission', 'admin_release')),
  add column if not exists original_name text check (original_name is null or char_length(original_name) between 1 and 180),
  add column if not exists mime_type text check (mime_type is null or mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  add column if not exists byte_size bigint check (byte_size is null or byte_size between 1 and 10485760),
  add column if not exists released_at timestamptz,
  add column if not exists deleted_at timestamptz;

-- PostgreSQL no ofrece ADD CONSTRAINT IF NOT EXISTS; este bloque hace repetible la operación.
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.documents'::regclass and conname = 'documents_scope_valid'
  ) then
    alter table public.documents add constraint documents_scope_valid check (
      (document_kind = 'plan_resource' and owner_id is null and application_id is null)
      or
      (document_kind in ('volunteer_submission', 'admin_release') and owner_id is not null and application_id is not null
        and original_name is not null and mime_type is not null and byte_size is not null)
    );
  end if;
end
$$;

create index if not exists documents_application_kind_idx
  on public.documents(application_id, document_kind, created_at)
  where deleted_at is null;

-- El bucket existente continúa privado y queda limitado a los tres formatos aprobados.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('volunteer-documents', 'volunteer-documents', false, 10485760,
       array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.admin_approve_membership_application(p_application_id uuid)
returns table (application_status public.application_status, decided_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare
  v_application public.membership_applications%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.staff_roles r
    where r.user_id = auth.uid() and r.role = 'admin' and r.revoked_at is null
  ) then
    raise exception 'admin_access_required' using errcode = '42501';
  end if;

  select * into v_application
  from public.membership_applications
  where id = p_application_id and deleted_at is null
  for update;
  if not found then raise exception 'application_not_found'; end if;

  -- Reintentar una aprobación ya realizada no repite ni el cambio ni la auditoría.
  if v_application.status = 'approved' then
    return query select v_application.status, v_application.decided_at;
    return;
  end if;
  if v_application.status not in ('submitted', 'in_review') then
    raise exception 'application_not_approvable';
  end if;

  update public.membership_applications as a
  set status = 'approved', decided_at = now(), updated_at = now()
  where a.id = v_application.id
  returning a.status, a.decided_at
  into v_application.status, v_application.decided_at;

  insert into public.volunteer_audit_events(actor_id, action, target_table, target_id)
  values (auth.uid(), 'application_status_changed', 'membership_applications', v_application.id::text);
  return query select v_application.status, v_application.decided_at;
end;
$$;
revoke all on function public.admin_approve_membership_application(uuid) from public, anon, authenticated;
grant execute on function public.admin_approve_membership_application(uuid) to authenticated;

create or replace function public.admin_confirm_transfer(
  p_application_id uuid,
  p_transfer_reference text
)
returns table (
  payment_id uuid,
  membership_id uuid,
  payment_status public.payment_status,
  membership_active boolean,
  starts_at timestamptz,
  ends_at timestamptz
)
language plpgsql security definer set search_path = ''
as $$
declare
  v_application public.membership_applications%rowtype;
  v_payment public.payments%rowtype;
  v_membership public.memberships%rowtype;
  v_reference text := btrim(p_transfer_reference);
  v_now timestamptz := now();
  v_ends_at timestamptz;
begin
  if auth.uid() is null or not exists (
    select 1 from public.staff_roles r
    where r.user_id = auth.uid() and r.role = 'admin' and r.revoked_at is null
  ) then
    raise exception 'admin_access_required' using errcode = '42501';
  end if;
  if v_reference is null or char_length(v_reference) not between 3 and 120
     or v_reference !~ '^[[:alnum:]][[:alnum:] ._:/-]*$' then
    raise exception 'invalid_transfer_reference' using errcode = '22023';
  end if;

  -- El bloqueo hace que dos confirmaciones concurrentes se serialicen.
  select * into v_application
  from public.membership_applications
  where id = p_application_id and deleted_at is null
  for update;
  if not found then raise exception 'application_not_found'; end if;
  if v_application.status <> 'approved' then raise exception 'application_not_approved'; end if;

  select * into v_payment from public.payments
  where application_id = v_application.id
  for update;

  if found and v_payment.status = 'confirmed' then
    select * into v_membership from public.memberships
    where application_id = v_application.id and payment_id = v_payment.id
    for update;
    if not found or not v_membership.active or v_membership.ends_at <= now() then
      raise exception 'confirmed_payment_without_active_membership';
    end if;
    return query select v_payment.id, v_membership.id, v_payment.status,
      v_membership.active, v_membership.starts_at, v_membership.ends_at;
    return;
  end if;
  if found and (v_payment.method <> 'transfer' or v_payment.status <> 'pending') then
    raise exception 'payment_not_confirmable';
  end if;

  if not found then
    insert into public.payments(application_id, owner_id, method, amount, currency,
      status, provider_reference, confirmed_by, confirmed_at)
    values (v_application.id, v_application.owner_id, 'transfer',
      v_application.quoted_amount, v_application.currency, 'confirmed',
      v_reference, auth.uid(), v_now)
    returning * into v_payment;
  else
    update public.payments
    set amount = v_application.quoted_amount,
        currency = v_application.currency,
        status = 'confirmed', provider_reference = v_reference,
        confirmed_by = auth.uid(), confirmed_at = v_now, updated_at = v_now
    where id = v_payment.id
    returning * into v_payment;
  end if;

  v_ends_at := case v_application.billing
    when 'monthly' then v_now + interval '1 month'
    when 'yearly' then v_now + interval '1 year'
    else null
  end;
  if v_ends_at is null then raise exception 'invalid_application_billing'; end if;

  insert into public.memberships(owner_id, application_id, payment_id, plan_price_id,
    starts_at, ends_at, active, deactivated_at)
  values (v_application.owner_id, v_application.id, v_payment.id,
    v_application.plan_price_id, v_now, v_ends_at, true, null)
  on conflict (application_id) do update
    set payment_id = excluded.payment_id,
        plan_price_id = excluded.plan_price_id,
        starts_at = excluded.starts_at,
        ends_at = excluded.ends_at,
        active = true,
        deactivated_at = null
  returning * into v_membership;

  insert into public.volunteer_audit_events(actor_id, action, target_table, target_id)
  values
    (auth.uid(), 'payment_confirmed', 'payments', v_payment.id::text),
    (auth.uid(), 'membership_activated', 'memberships', v_membership.id::text);

  -- Los archivos administrativos ya cargados se liberan solo al existir la membresía activa.
  with released as (
    update public.documents d
    set released_at = coalesce(d.released_at, v_now)
    where d.application_id = v_application.id
      and d.owner_id = v_application.owner_id
      and d.document_kind = 'admin_release'
      and d.deleted_at is null
      and d.released_at is null
    returning d.id
  )
  insert into public.volunteer_audit_events(actor_id, action, target_table, target_id)
  select auth.uid(), 'document_changed', 'documents', released.id::text from released;

  return query select v_payment.id, v_membership.id, v_payment.status,
    v_membership.active, v_membership.starts_at, v_membership.ends_at;
end;
$$;
revoke all on function public.admin_confirm_transfer(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_confirm_transfer(uuid, text) to authenticated;

create or replace function public.admin_get_application_membership(p_application_id uuid)
returns table (payment_status public.payment_status, membership_active boolean, starts_at timestamptz, ends_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not exists(select 1 from public.staff_roles r where r.user_id=auth.uid() and r.role='admin' and r.revoked_at is null) then raise exception 'admin_access_required' using errcode='42501'; end if;
  return query
  select p.status, m.active and m.ends_at>now(), m.starts_at, m.ends_at
  from public.membership_applications a
  left join public.payments p on p.application_id=a.id
  left join public.memberships m on m.application_id=a.id and m.payment_id=p.id
  where a.id=p_application_id and a.deleted_at is null
  limit 1;
end;
$$;
revoke all on function public.admin_get_application_membership(uuid) from public, anon, authenticated;
grant execute on function public.admin_get_application_membership(uuid) to authenticated;

-- Reserva la ruta aleatoria antes de subir. El navegador nunca decide owner_id ni plan.
create or replace function public.reserve_volunteer_document_upload(
  p_application_id uuid, p_original_name text, p_mime_type text, p_byte_size bigint
)
returns table (document_id uuid, storage_path text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_application public.membership_applications%rowtype;
  v_id uuid := gen_random_uuid();
  v_name text;
  v_extension text;
  v_path text;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  select * into v_application from public.membership_applications
  where id = p_application_id and owner_id = auth.uid() and deleted_at is null
    and status in ('draft', 'submitted', 'in_review', 'needs_clarification')
  for update;
  if not found then raise exception 'application_upload_not_allowed'; end if;
  if p_mime_type not in ('application/pdf','image/jpeg','image/png')
     or p_byte_size not between 1 and 10485760 then
    raise exception 'invalid_document_file' using errcode = '22023';
  end if;
  v_name := left(regexp_replace(coalesce(p_original_name, ''), '[^[:alnum:] ._()-]', '_', 'g'), 180);
  if char_length(btrim(v_name)) < 1 then raise exception 'invalid_original_name'; end if;
  v_extension := case p_mime_type when 'application/pdf' then 'pdf' when 'image/jpeg' then 'jpg' else 'png' end;
  v_path := auth.uid()::text || '/' || v_application.id::text || '/' || v_id::text || '.' || v_extension;
  insert into public.documents(id, title, storage_path, plan_id, active, created_by,
    owner_id, application_id, document_kind, original_name, mime_type, byte_size)
  select v_id, v_name, v_path, pp.plan_id, true, auth.uid(), v_application.owner_id,
         v_application.id, 'volunteer_submission', v_name, p_mime_type, p_byte_size
  from public.plan_prices pp where pp.id = v_application.plan_price_id;
  insert into public.volunteer_audit_events(actor_id, action, target_table, target_id)
  values (auth.uid(), 'document_changed', 'documents', v_id::text);
  return query select v_id, v_path;
end;
$$;
revoke all on function public.reserve_volunteer_document_upload(uuid,text,text,bigint) from public, anon, authenticated;
grant execute on function public.reserve_volunteer_document_upload(uuid,text,text,bigint) to authenticated;

create or replace function public.admin_reserve_document_upload(
  p_application_id uuid, p_original_name text, p_mime_type text, p_byte_size bigint
)
returns table (document_id uuid, storage_path text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_application public.membership_applications%rowtype;
  v_id uuid := gen_random_uuid();
  v_name text;
  v_extension text;
  v_path text;
begin
  if auth.uid() is null or not exists (select 1 from public.staff_roles r where r.user_id=auth.uid() and r.role='admin' and r.revoked_at is null) then
    raise exception 'admin_access_required' using errcode = '42501';
  end if;
  select * into v_application from public.membership_applications where id=p_application_id and deleted_at is null for update;
  if not found then raise exception 'application_not_found'; end if;
  if p_mime_type not in ('application/pdf','image/jpeg','image/png') or p_byte_size not between 1 and 10485760 then raise exception 'invalid_document_file'; end if;
  v_name := left(regexp_replace(coalesce(p_original_name, ''), '[^[:alnum:] ._()-]', '_', 'g'), 180);
  if char_length(btrim(v_name)) < 1 then raise exception 'invalid_original_name'; end if;
  v_extension := case p_mime_type when 'application/pdf' then 'pdf' when 'image/jpeg' then 'jpg' else 'png' end;
  v_path := v_application.owner_id::text || '/' || v_application.id::text || '/' || v_id::text || '.' || v_extension;
  insert into public.documents(id,title,storage_path,plan_id,active,created_by,owner_id,application_id,document_kind,original_name,mime_type,byte_size)
  select v_id,v_name,v_path,pp.plan_id,true,auth.uid(),v_application.owner_id,v_application.id,'admin_release',v_name,p_mime_type,p_byte_size
  from public.plan_prices pp where pp.id=v_application.plan_price_id;
  insert into public.volunteer_audit_events(actor_id,action,target_table,target_id) values(auth.uid(),'document_changed','documents',v_id::text);
  return query select v_id,v_path;
end;
$$;
revoke all on function public.admin_reserve_document_upload(uuid,text,text,bigint) from public, anon, authenticated;
grant execute on function public.admin_reserve_document_upload(uuid,text,text,bigint) to authenticated;

create or replace function public.admin_release_volunteer_document(p_document_id uuid)
returns timestamptz language plpgsql security definer set search_path = ''
as $$
declare v_released_at timestamptz;
begin
  if auth.uid() is null or not exists (select 1 from public.staff_roles r where r.user_id=auth.uid() and r.role='admin' and r.revoked_at is null) then raise exception 'admin_access_required' using errcode='42501'; end if;
  update public.documents d set released_at=coalesce(d.released_at,now())
  where d.id=p_document_id and d.document_kind='admin_release' and d.deleted_at is null
    and exists(select 1 from public.memberships m where m.application_id=d.application_id and m.owner_id=d.owner_id and m.active and m.ends_at>now())
  returning d.released_at into v_released_at;
  if not found then raise exception 'active_membership_required'; end if;
  insert into public.volunteer_audit_events(actor_id,action,target_table,target_id) values(auth.uid(),'document_changed','documents',p_document_id::text);
  return v_released_at;
end;
$$;
revoke all on function public.admin_release_volunteer_document(uuid) from public, anon, authenticated;
grant execute on function public.admin_release_volunteer_document(uuid) to authenticated;

create or replace function public.list_my_volunteer_documents()
returns table(document_id uuid, document_kind text, original_name text, mime_type text, byte_size bigint, released_at timestamptz, created_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select d.id,d.document_kind,d.original_name,d.mime_type,d.byte_size,d.released_at,d.created_at
  from public.documents d
  where auth.uid() is not null and d.owner_id=auth.uid() and d.deleted_at is null
    and (d.document_kind='volunteer_submission' or (d.document_kind='admin_release' and d.released_at is not null and exists(select 1 from public.memberships m where m.application_id=d.application_id and m.owner_id=auth.uid() and m.active and m.ends_at>now())))
  order by d.created_at desc
$$;
revoke all on function public.list_my_volunteer_documents() from public, anon, authenticated;
grant execute on function public.list_my_volunteer_documents() to authenticated;

create or replace function public.admin_list_application_documents(p_application_id uuid)
returns table(document_id uuid, document_kind text, original_name text, mime_type text, byte_size bigint, released_at timestamptz, created_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not exists(select 1 from public.staff_roles r where r.user_id=auth.uid() and r.role='admin' and r.revoked_at is null) then raise exception 'admin_access_required' using errcode='42501'; end if;
  return query select d.id,d.document_kind,d.original_name,d.mime_type,d.byte_size,d.released_at,d.created_at from public.documents d where d.application_id=p_application_id and d.deleted_at is null order by d.created_at desc;
end;
$$;
revoke all on function public.admin_list_application_documents(uuid) from public, anon, authenticated;
grant execute on function public.admin_list_application_documents(uuid) to authenticated;

-- Devuelve una ruta solo tras autorizarla; el frontend genera después una URL firmada de 60 segundos.
create or replace function public.authorize_volunteer_document_download(p_document_id uuid)
returns text language plpgsql security definer set search_path = ''
as $$
declare v_path text;
begin
  select d.storage_path into v_path from public.documents d
  where d.id=p_document_id and d.deleted_at is null and (
    exists(select 1 from public.staff_roles r where r.user_id=auth.uid() and r.role='admin' and r.revoked_at is null)
    or (d.owner_id=auth.uid() and d.document_kind='volunteer_submission')
    or (d.owner_id=auth.uid() and d.document_kind='admin_release' and d.released_at is not null and exists(select 1 from public.memberships m where m.application_id=d.application_id and m.owner_id=auth.uid() and m.active and m.ends_at>now()))
  );
  if not found then raise exception 'document_download_forbidden' using errcode='42501'; end if;
  insert into public.volunteer_audit_events(actor_id,action,target_table,target_id) values(auth.uid(),'document_changed','documents',p_document_id::text);
  return v_path;
end;
$$;
revoke all on function public.authorize_volunteer_document_download(uuid) from public, anon, authenticated;
grant execute on function public.authorize_volunteer_document_download(uuid) to authenticated;

-- Cada política anterior se sustituye inmediatamente por una equivalente o más restrictiva.
-- Las excepciones duplicate_object permiten una segunda ejecución sin volver a crearla.
drop policy if exists applications_staff_update on public.membership_applications;
do $$ begin
  create policy applications_staff_update_via_rpc_005 on public.membership_applications
    for update to authenticated using (false) with check (false);
exception when duplicate_object then null; end $$;

drop policy if exists documents_member_read on public.documents;
do $$ begin
  create policy documents_member_read_005 on public.documents for select to authenticated using (
    deleted_at is null and (
      (document_kind='plan_resource' and active and exists(
        select 1 from public.memberships m join public.plan_prices pp on pp.id=m.plan_price_id
        where m.owner_id=auth.uid() and m.active and m.ends_at>now() and pp.plan_id=documents.plan_id
      ))
      or (owner_id=auth.uid() and document_kind='volunteer_submission')
      or (owner_id=auth.uid() and document_kind='admin_release' and released_at is not null and exists(
        select 1 from public.memberships m where m.application_id=documents.application_id
          and m.owner_id=auth.uid() and m.active and m.ends_at>now()
      ))
    )
  );
exception when duplicate_object then null; end $$;

drop policy if exists documents_staff_all on public.documents;
do $$ begin
  create policy documents_staff_read_005 on public.documents for select to authenticated
    using (public.is_coordination());
exception when duplicate_object then null; end $$;

drop policy if exists documents_staff_storage_all on storage.objects;
do $$ begin
  create policy documents_staff_storage_read_005 on storage.objects for select to authenticated using (
    bucket_id='volunteer-documents' and public.is_coordination()
    and exists(select 1 from public.documents d where d.storage_path=name and d.deleted_at is null)
  );
exception when duplicate_object then null; end $$;

drop policy if exists documents_member_storage_read on storage.objects;
do $$ begin
  create policy documents_member_storage_read_005 on storage.objects for select to authenticated using (
    bucket_id='volunteer-documents' and exists(
      select 1 from public.documents d where d.storage_path=name and d.deleted_at is null and (
        (d.document_kind='plan_resource' and d.active and exists(
          select 1 from public.memberships m join public.plan_prices pp on pp.id=m.plan_price_id
          where m.owner_id=auth.uid() and m.active and m.ends_at>now() and pp.plan_id=d.plan_id
        ))
        or (d.owner_id=auth.uid() and d.document_kind='volunteer_submission')
        or (d.owner_id=auth.uid() and d.document_kind='admin_release' and d.released_at is not null and exists(
          select 1 from public.memberships m where m.application_id=d.application_id
            and m.owner_id=auth.uid() and m.active and m.ends_at>now()
        ))
      )
    )
  );
exception when duplicate_object then null; end $$;

-- Las nuevas escrituras solo aceptan rutas previamente reservadas por las RPC.
do $$ begin
  create policy volunteer_documents_insert_005 on storage.objects for insert to authenticated with check (
    bucket_id='volunteer-documents' and exists(select 1 from public.documents d
      where d.storage_path=name and d.owner_id=auth.uid() and d.created_by=auth.uid()
        and d.document_kind='volunteer_submission' and d.deleted_at is null)
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy admin_documents_insert_005 on storage.objects for insert to authenticated with check (
    bucket_id='volunteer-documents' and exists(select 1 from public.documents d
      join public.staff_roles r on r.user_id=auth.uid() and r.role='admin' and r.revoked_at is null
      where d.storage_path=name and d.created_by=auth.uid() and d.document_kind='admin_release' and d.deleted_at is null)
  );
exception when duplicate_object then null; end $$;

-- Los adjuntos históricos conservan lectura para coordination y admin, nunca para terceros.
drop policy if exists attachments_staff_read on public.clarification_attachments;
do $$ begin
  create policy attachments_staff_read_005 on public.clarification_attachments for select to authenticated
    using (public.is_coordination());
exception when duplicate_object then null; end $$;

drop policy if exists attachment_staff_storage_read on storage.objects;
do $$ begin
  create policy attachment_staff_storage_read_005 on storage.objects for select to authenticated using (
    bucket_id='volunteer-attachments' and public.is_coordination()
    and exists(select 1 from public.clarification_attachments a
      where a.storage_path=name and a.scan_status='clean' and a.deleted_at is null)
  );
exception when duplicate_object then null; end $$;

commit;
