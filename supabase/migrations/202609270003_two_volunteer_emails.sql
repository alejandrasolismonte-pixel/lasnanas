-- Dos correos para la voluntaria: confirmacion de Auth y bienvenida al activar.
-- Los avisos a coordinacion se conservan. Las filas ya enviadas quedan como historial.
begin;

-- La solicitud solo crea el aviso interno. La bienvenida se enviara con la activacion.
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
  ) on conflict (application_id, notification_type) do nothing;

  return new;
end;
$$;
revoke all on function private.enqueue_application_notifications()
  from public, anon, authenticated;

drop trigger if exists enqueue_welcome_after_email_confirmation on auth.users;
drop function if exists private.enqueue_confirmed_volunteer_welcome();

-- Se conserva el aviso de pago para coordinacion, pero solo la bienvenida
-- de activacion se dirige a la voluntaria.
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
  on conflict (application_id, notification_type) do nothing;
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
  on conflict (application_id, notification_type) do nothing;
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
grant execute on function public.ensure_activation_notifications(uuid)
  to service_role;

-- No reclamar avisos antiguos aunque una fila quedara pendiente antes de aplicar
-- esta migracion o alguien reprogramara su intento.
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
        'membership_activated', 'admin_payment_confirmed')
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
revoke all on function public.claim_volunteer_notifications(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.claim_volunteer_notifications(uuid, integer)
  to service_role;

create or replace function public.claim_volunteer_notifications_for_application(
  p_worker uuid, p_application_id uuid, p_limit integer default 10)
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
      and q.notification_type in ('membership_activated', 'admin_payment_confirmed')
      and q.delivery_status in ('pending', 'failed')
      and q.attempts < 5
      and q.next_attempt_at <= now()
      and (q.locked_at is null or q.locked_at < now() - interval '5 minutes')
      and (q.first_attempt_at is null or q.first_attempt_at > now() - interval '25 minutes')
      and (
        q.notification_type = 'admin_payment_confirmed'
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
revoke all on function public.claim_volunteer_notifications_for_application(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.claim_volunteer_notifications_for_application(uuid, uuid, integer)
  to service_role;

-- Conservar el historial enviado y desactivar los intentos previos al cambio.
update private.volunteer_notification_queue q
set delivery_status = 'failed', attempts = 5,
    next_attempt_at = 'infinity'::timestamptz,
    locked_at = null, lock_token = null,
    last_error = 'suppressed_two_email_policy', updated_at = now()
where q.notification_type in ('volunteer_welcome', 'payment_confirmed')
  and q.delivery_status <> 'sent';

commit;
