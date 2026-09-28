-- Avisos por documento: reutiliza documents, application_messages y la cola privada.
-- No cambia permisos de lectura, membresías, pagos ni los dos correos de inscripción.
begin;

alter table private.volunteer_notification_queue
  add column document_id uuid references public.documents(id) on delete restrict,
  drop constraint volunteer_notification_queue_application_id_notification_type_key,
  drop constraint volunteer_notification_queue_notification_type_check,
  drop constraint volunteer_notification_queue_recipient_check;

alter table private.volunteer_notification_queue
  add constraint volunteer_notification_queue_notification_type_check
    check (notification_type in (
      'admin_registration', 'volunteer_welcome', 'transfer_receipt_received',
      'payment_confirmed', 'membership_activated', 'admin_payment_confirmed',
      'document_available')),
  add constraint volunteer_notification_queue_recipient_check
    check (
      (notification_type in (
        'volunteer_welcome', 'payment_confirmed', 'membership_activated', 'document_available')
        and recipient_email is not null and recipient_email = volunteer_email)
      or (notification_type in (
        'admin_registration', 'transfer_receipt_received', 'admin_payment_confirmed')
        and recipient_email is null)
    ),
  add constraint volunteer_notification_queue_document_scope_check
    check ((notification_type = 'document_available') = (document_id is not null));

create unique index volunteer_notification_application_type_unique
  on private.volunteer_notification_queue(application_id, notification_type)
  where document_id is null;
create unique index volunteer_notification_document_unique
  on private.volunteer_notification_queue(document_id)
  where document_id is not null;

-- Mismo criterio de almacenamiento que finalize_transfer_receipt_upload.
create function private.admin_document_is_uploaded(p_document_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.documents d
    join storage.objects o
      on o.bucket_id = 'volunteer-documents' and o.name = d.storage_path
    where d.id = p_document_id and d.document_kind = 'admin_release'
      and d.deleted_at is null
      and o.metadata->>'mimetype' = d.mime_type
      and o.metadata->>'size' = d.byte_size::text
  );
$$;
revoke all on function private.admin_document_is_uploaded(uuid)
  from public, anon, authenticated;

-- La activación ya intenta liberar documentos. Una reserva sin archivo queda
-- pendiente y nunca interrumpe la confirmación del pago ni genera un aviso falso.
create function private.guard_admin_document_release()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if not private.admin_document_is_uploaded(new.id) then return null; end if;
  return new;
end;
$$;
revoke all on function private.guard_admin_document_release()
  from public, anon, authenticated;
create trigger guard_admin_document_release
before update of released_at on public.documents
for each row when (new.document_kind = 'admin_release' and new.released_at is not null)
execute function private.guard_admin_document_release();

create function private.enqueue_admin_document_notification()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_notification_id uuid;
begin
  if new.deleted_at is not null or not private.admin_document_is_uploaded(new.id)
     or not exists (
       select 1 from public.memberships m
       where m.application_id = new.application_id and m.owner_id = new.owner_id
         and m.active and m.ends_at > now()
     ) then return new; end if;

  -- El correo puede esperar a la verificación; el mensaje aparece desde ahora.
  insert into private.volunteer_notification_queue (
    application_id, owner_id, document_id, notification_type, recipient_email,
    first_name, last_name, volunteer_email, plan_id, billing, currency,
    application_status, application_created_at
  )
  select a.id, a.owner_id, new.id, 'document_available', lower(u.email),
    p.first_name, p.last_name, lower(u.email), pp.plan_id, a.billing, a.currency,
    a.status, a.created_at
  from public.membership_applications a
  join public.volunteer_profiles p on p.id = a.owner_id and p.deleted_at is null
  join auth.users u on u.id = a.owner_id and u.email is not null
  join public.plan_prices pp on pp.id = a.plan_price_id
  where a.id = new.application_id and a.owner_id = new.owner_id and a.deleted_at is null
  on conflict (document_id) where document_id is not null do nothing
  returning id into v_notification_id;

  -- La fila única por documento hace que mensaje y correo se creen una sola vez.
  if v_notification_id is not null then
    insert into public.application_messages(application_id, author_id, body, visible_to_member)
    values (new.application_id, new.created_by,
      'Coordinación dejó disponible el documento «' || coalesce(new.original_name, new.title) ||
      '». Puedes abrirlo en Mis documentos.', true);
  end if;
  return new;
exception when others then
  -- Nunca deshacer una activación por un fallo secundario de notificaciones.
  -- La liberación manual verifica el resultado y permite reintentar el mismo archivo.
  raise warning 'admin_document_notification_enqueue_failed';
  return new;
end;
$$;
revoke all on function private.enqueue_admin_document_notification()
  from public, anon, authenticated;
create trigger enqueue_admin_document_notification
after update of released_at on public.documents
for each row when (new.document_kind = 'admin_release' and new.released_at is not null)
execute function private.enqueue_admin_document_notification();

create or replace function public.admin_release_volunteer_document(p_document_id uuid)
returns timestamptz language plpgsql security definer set search_path = ''
as $$
declare
  v_document public.documents%rowtype;
  v_released_at timestamptz;
begin
  if auth.uid() is null or not exists (
    select 1 from public.staff_roles r
    where r.user_id = auth.uid() and r.role = 'admin' and r.revoked_at is null
  ) then raise exception 'admin_access_required' using errcode = '42501'; end if;

  select * into v_document from public.documents d
  where d.id = p_document_id and d.document_kind = 'admin_release' and d.deleted_at is null
  for update;
  if not found then raise exception 'document_not_found'; end if;
  if not private.admin_document_is_uploaded(p_document_id) then
    raise exception 'document_upload_incomplete';
  end if;
  if not exists (
    select 1 from public.memberships m
    where m.application_id = v_document.application_id and m.owner_id = v_document.owner_id
      and m.active and m.ends_at > now()
  ) then raise exception 'active_membership_required'; end if;

  -- Repetir esta RPC repara un aviso faltante sin duplicar archivo, mensaje ni correo.
  update public.documents d set released_at = coalesce(d.released_at, now())
  where d.id = p_document_id returning d.released_at into v_released_at;
  if not exists (
    select 1 from private.volunteer_notification_queue q
    where q.document_id = p_document_id and q.application_id = v_document.application_id
      and q.owner_id = v_document.owner_id and q.notification_type = 'document_available'
  ) then raise exception 'document_notification_unavailable'; end if;

  insert into public.volunteer_audit_events(actor_id, action, target_table, target_id)
  values (auth.uid(), 'document_changed', 'documents', p_document_id::text);
  return v_released_at;
end;
$$;
revoke all on function public.admin_release_volunteer_document(uuid)
  from public, anon, authenticated;
grant execute on function public.admin_release_volunteer_document(uuid) to authenticated;

-- El worker vuelve a comprobar archivo real, propietaria, correo y permisos actuales.
-- No necesita grants directos sobre documents, storage.objects ni la cola.
create function public.authorize_volunteer_document_notification(p_notification_id uuid, p_worker uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from private.volunteer_notification_queue q
    join public.documents d
      on d.id = q.document_id and d.application_id = q.application_id and d.owner_id = q.owner_id
    join public.membership_applications a
      on a.id = q.application_id and a.owner_id = q.owner_id and a.deleted_at is null
    join auth.users u
      on u.id = q.owner_id and u.email_confirmed_at is not null and lower(u.email) = q.recipient_email
    where q.id = p_notification_id and q.notification_type = 'document_available'
      and q.lock_token = p_worker and q.delivery_status = 'pending'
      and d.document_kind = 'admin_release' and d.deleted_at is null and d.released_at is not null
      and private.admin_document_is_uploaded(d.id)
      and exists (
        select 1 from public.memberships m
        where m.application_id = d.application_id and m.owner_id = d.owner_id
          and m.active and m.ends_at > now()
      )
  );
$$;
revoke all on function public.authorize_volunteer_document_notification(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.authorize_volunteer_document_notification(uuid, uuid) to service_role;

create function public.admin_get_document_notification_status(p_document_id uuid)
returns table(delivery_status text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.staff_roles r
    where r.user_id = auth.uid() and r.role = 'admin' and r.revoked_at is null
  ) then raise exception 'admin_access_required' using errcode = '42501'; end if;
  return query
  select q.delivery_status from private.volunteer_notification_queue q
  where q.document_id = p_document_id and q.notification_type = 'document_available';
end;
$$;
revoke all on function public.admin_get_document_notification_status(uuid)
  from public, anon, authenticated;
grant execute on function public.admin_get_document_notification_status(uuid) to authenticated;

-- Sección de compatibilidad con las últimas versiones de la cola:
-- únicamente se ajusta el destino ON CONFLICT al índice parcial existente.


create or replace function private.enqueue_application_notifications()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_profile public.volunteer_profiles%rowtype;
  v_email text;
  v_plan_id text;
begin
  select p.* into strict v_profile
  from public.volunteer_profiles p
  where p.id = new.owner_id and p.deleted_at is null;

  select u.email into v_email
  from auth.users u
  where u.id = new.owner_id;

  select pp.plan_id into strict v_plan_id
  from public.plan_prices pp
  where pp.id = new.plan_price_id;

  if v_email is null or char_length(v_email) > 254 then
    raise exception 'notification_email_unavailable';
  end if;

  insert into private.volunteer_notification_queue (
    application_id, owner_id, notification_type, recipient_email,
    first_name, last_name, volunteer_email, plan_id, billing, currency,
    application_status, application_created_at
  ) values (
    new.id, new.owner_id, 'admin_registration', null,
    v_profile.first_name, v_profile.last_name, lower(v_email), v_plan_id,
    new.billing, new.currency, new.status, new.created_at
  ) on conflict (application_id, notification_type) where document_id is null do nothing;

  return new;
end;
$$;
revoke all on function private.enqueue_application_notifications()
  from public, anon, authenticated;


create or replace function private.enqueue_payment_activation_notifications()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_application public.membership_applications%rowtype;
  v_payment public.payments%rowtype;
  v_profile public.volunteer_profiles%rowtype;
  v_email text;
  v_plan_id text;
begin
  if not new.active or new.starts_at > now() or new.ends_at <= now() then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if old.active and old.payment_id = new.payment_id then return new; end if;
  end if;

  select * into v_application from public.membership_applications
    where id = new.application_id and owner_id = new.owner_id
      and status = 'approved' and deleted_at is null;
  select * into v_payment from public.payments
    where id = new.payment_id and application_id = new.application_id
      and owner_id = new.owner_id and status = 'confirmed'
      and confirmed_at is not null and confirmed_by is not null;
  select * into v_profile from public.volunteer_profiles
    where id = new.owner_id and deleted_at is null;
  select lower(email) into v_email from auth.users
    where id = new.owner_id and email_confirmed_at is not null;
  select plan_id into v_plan_id from public.plan_prices
    where id = new.plan_price_id and id = v_application.plan_price_id;

  if v_application.id is null or v_payment.id is null or v_profile.id is null
     or v_email is null or v_plan_id is null then return new; end if;

  insert into private.volunteer_notification_queue (
    application_id, owner_id, notification_type, recipient_email,
    first_name, last_name, volunteer_email, plan_id, billing, currency,
    application_status, application_created_at
  )
  select new.application_id, new.owner_id, kind,
    case when kind = 'admin_payment_confirmed' then null else v_email end,
    v_profile.first_name, v_profile.last_name, v_email, v_plan_id,
    v_application.billing, v_application.currency,
    v_application.status, v_application.created_at
  from (values ('membership_activated'), ('admin_payment_confirmed'))
    as notifications(kind)
  on conflict (application_id, notification_type) where document_id is null do nothing;
  return new;
exception when others then
  raise warning 'payment_activation_notification_enqueue_failed';
  return new;
end;
$$;
revoke all on function private.enqueue_payment_activation_notifications()
  from public, anon, authenticated;


create or replace function public.ensure_activation_notifications(p_application_id uuid)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_application public.membership_applications%rowtype;
  v_payment public.payments%rowtype;
  v_membership public.memberships%rowtype;
  v_profile public.volunteer_profiles%rowtype;
  v_email text;
  v_plan_id text;
  v_inserted integer;
  v_requeued integer;
begin
  select * into v_application from public.membership_applications
    where id = p_application_id and status = 'approved' and deleted_at is null;
  if v_application.id is null then return 0; end if;
  select * into v_payment from public.payments
    where application_id = v_application.id and owner_id = v_application.owner_id
      and status = 'confirmed' and confirmed_at is not null and confirmed_by is not null;
  select * into v_membership from public.memberships
    where application_id = v_application.id and owner_id = v_application.owner_id
      and payment_id = v_payment.id and active
      and starts_at <= now() and ends_at > now();
  select * into v_profile from public.volunteer_profiles
    where id = v_application.owner_id and deleted_at is null;
  select lower(email) into v_email from auth.users
    where id = v_application.owner_id and email_confirmed_at is not null;
  select pp.plan_id into v_plan_id from public.plan_prices pp
    where pp.id = v_application.plan_price_id and pp.id = v_membership.plan_price_id;
  if v_payment.id is null or v_membership.id is null or v_profile.id is null
     or v_email is null or v_plan_id is null then return 0; end if;

  insert into private.volunteer_notification_queue (
    application_id, owner_id, notification_type, recipient_email,
    first_name, last_name, volunteer_email, plan_id, billing, currency,
    application_status, application_created_at
  )
  select v_application.id, v_application.owner_id, kind,
    case when kind = 'admin_payment_confirmed' then null else v_email end,
    v_profile.first_name, v_profile.last_name, v_email, v_plan_id,
    v_application.billing, v_application.currency,
    v_application.status, v_application.created_at
  from (values ('membership_activated'), ('admin_payment_confirmed'))
    as notifications(kind)
  on conflict (application_id, notification_type) where document_id is null do nothing;
  get diagnostics v_inserted = row_count;

  -- Reintentar solo fallos de validacion anteriores a Brevo, con el mismo UUID.
  update private.volunteer_notification_queue q
  set delivery_status = 'pending', attempts = 0, first_attempt_at = null,
      next_attempt_at = now(), locked_at = null, lock_token = null,
      last_error = null, updated_at = now()
  where q.application_id = v_application.id
    and q.owner_id = v_application.owner_id
    and q.notification_type in ('membership_activated', 'admin_payment_confirmed')
    and q.delivery_status = 'failed'
    and q.last_error in ('confirmed_payment_unavailable',
                         'active_membership_unavailable',
                         'invalid_notification_payload')
    and q.brevo_message_id is null;
  get diagnostics v_requeued = row_count;
  return v_inserted + v_requeued;
end;
$$;
revoke all on function public.ensure_activation_notifications(uuid)
  from public, anon, authenticated;
grant execute on function public.ensure_activation_notifications(uuid) to service_role;


create or replace function
  private.enqueue_transfer_receipt_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_first_name text;
  v_last_name text;
  v_email text;
  v_plan_id text;
  v_billing text;
  v_currency text;
  v_status public.application_status;
  v_application_created_at timestamptz;
begin

  begin

    select
      p.first_name,
      p.last_name,
      lower(u.email),
      pp.plan_id,
      a.billing,
      a.currency,
      a.status,
      a.created_at
    into
      v_first_name,
      v_last_name,
      v_email,
      v_plan_id,
      v_billing,
      v_currency,
      v_status,
      v_application_created_at
    from public.membership_applications a
    join public.volunteer_profiles p
      on p.id = a.owner_id
      and p.deleted_at is null
    join public.plan_prices pp
      on pp.id = a.plan_price_id
    join auth.users u
      on u.id = a.owner_id
    where a.id = new.application_id
      and a.owner_id = new.owner_id
      and a.deleted_at is null;

    -- Si falta algún dato indispensable para el correo,
    -- el comprobante sigue considerándose recibido.
    if v_email is null
       or v_first_name is null
       or v_last_name is null
       or v_plan_id is null
       or v_billing is null
       or v_currency is null
       or v_status is null
       or v_application_created_at is null
    then
      return new;
    end if;

    insert into private.volunteer_notification_queue(
      application_id,
      owner_id,
      notification_type,
      recipient_email,
      first_name,
      last_name,
      volunteer_email,
      plan_id,
      billing,
      currency,
      application_status,
      application_created_at
    )
    values (
      new.application_id,
      new.owner_id,
      'transfer_receipt_received',
      null,
      v_first_name,
      v_last_name,
      v_email,
      v_plan_id,
      v_billing,
      v_currency,
      v_status,
      v_application_created_at
    )
    on conflict (application_id, notification_type) where document_id is null do nothing;

  exception
    when others then

      -- El correo nunca debe bloquear el registro del comprobante.
      -- El mensaje es deliberadamente genérico para no exponer
      -- información personal ni secretos en los registros.
      raise warning
        'transfer_receipt_notification_enqueue_failed';

  end;

  return new;

end;
$$;
revoke all on function private.enqueue_transfer_receipt_notification()
  from public, anon, authenticated;

-- Los webhooks y reintentos existentes también procesan los avisos de documentos.
create or replace function public.claim_volunteer_notifications(
  p_worker uuid, p_limit integer default 10)
returns table (
  notification_id uuid, application_id uuid, notification_type text,
  recipient_email text, first_name text, last_name text,
  volunteer_email text, plan_id text, billing text, currency text,
  application_status public.application_status, application_created_at timestamptz,
  idempotency_key uuid, attempt_number smallint
)
language plpgsql security definer set search_path = ''
as $$
begin
  if p_worker is null or p_limit not between 1 and 25 then
    raise exception 'invalid_notification_claim';
  end if;

  return query
  with candidates as (
    select q.id
    from private.volunteer_notification_queue q
    where q.notification_type in (
        'admin_registration', 'transfer_receipt_received',
        'membership_activated', 'admin_payment_confirmed', 'document_available')
      and q.delivery_status in ('pending', 'failed')
      and q.attempts < 5
      and q.next_attempt_at <= now()
      and (q.locked_at is null or q.locked_at < now() - interval '5 minutes')
      and (q.first_attempt_at is null or q.first_attempt_at > now() - interval '25 minutes')
      and (
        q.notification_type in (
          'admin_registration', 'transfer_receipt_received', 'admin_payment_confirmed')
        or exists (
          select 1 from auth.users u
          where u.id = q.owner_id and u.email_confirmed_at is not null
            and lower(u.email) = q.recipient_email
        )
      )
    order by q.next_attempt_at, q.created_at
    for update skip locked
    limit p_limit
  ), claimed as (
    update private.volunteer_notification_queue q
    set delivery_status = 'pending', attempts = q.attempts + 1,
        first_attempt_at = coalesce(q.first_attempt_at, now()),
        locked_at = now(), lock_token = p_worker, updated_at = now()
    from candidates c where q.id = c.id
    returning q.*
  )
  select c.id, c.application_id, c.notification_type, c.recipient_email,
         c.first_name, c.last_name, c.volunteer_email, c.plan_id,
         c.billing, c.currency, c.application_status,
         c.application_created_at, c.idempotency_key, c.attempts
  from claimed c;
end;
$$;
revoke all on function public.claim_volunteer_notifications(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_volunteer_notifications(uuid, integer) to service_role;

-- El envío manual reclama el documento indicado; al activar se reclaman los
-- documentos pendientes de la solicitud sin modificar la RPC de bienvenida.
create function public.claim_volunteer_document_notifications(
  p_worker uuid, p_application_id uuid, p_document_id uuid default null,
  p_limit integer default 10)
returns table (
  notification_id uuid, application_id uuid, notification_type text,
  recipient_email text, first_name text, last_name text,
  volunteer_email text, plan_id text, billing text, currency text,
  application_status public.application_status, application_created_at timestamptz,
  idempotency_key uuid, attempt_number smallint
)
language plpgsql security definer set search_path = ''
as $$
begin
  if p_worker is null or p_application_id is null or p_limit not between 1 and 25 then
    raise exception 'invalid_notification_claim';
  end if;

  return query
  with candidates as (
    select q.id
    from private.volunteer_notification_queue q
    where q.application_id = p_application_id
      and (p_document_id is null or q.document_id = p_document_id)
      and q.notification_type = 'document_available'
      and q.delivery_status in ('pending', 'failed')
      and q.attempts < 5
      and q.next_attempt_at <= now()
      and (q.locked_at is null or q.locked_at < now() - interval '5 minutes')
      and (q.first_attempt_at is null or q.first_attempt_at > now() - interval '25 minutes')
      and (
        q.notification_type in (
          'admin_registration', 'transfer_receipt_received', 'admin_payment_confirmed')
        or exists (
          select 1 from auth.users u
          where u.id = q.owner_id and u.email_confirmed_at is not null
            and lower(u.email) = q.recipient_email
        )
      )
    order by q.next_attempt_at, q.created_at
    for update skip locked
    limit p_limit
  ), claimed as (
    update private.volunteer_notification_queue q
    set delivery_status = 'pending', attempts = q.attempts + 1,
        first_attempt_at = coalesce(q.first_attempt_at, now()),
        locked_at = now(), lock_token = p_worker, updated_at = now()
    from candidates c where q.id = c.id
    returning q.*
  )
  select c.id, c.application_id, c.notification_type, c.recipient_email,
         c.first_name, c.last_name, c.volunteer_email, c.plan_id,
         c.billing, c.currency, c.application_status,
         c.application_created_at, c.idempotency_key, c.attempts
  from claimed c;
end;
$$;
revoke all on function public.claim_volunteer_document_notifications(uuid, uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_volunteer_document_notifications(uuid, uuid, uuid, integer) to service_role;

commit;
