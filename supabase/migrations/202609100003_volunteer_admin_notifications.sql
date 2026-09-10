-- Las Ñañas · cola privada e idempotente de correos de voluntariado.
-- Aplicar después de 202609100002_auth_frontend.sql. No contiene secretos ni realiza llamadas HTTP.
begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.volunteer_notification_queue (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.membership_applications(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  notification_type text not null check (notification_type in ('admin_registration', 'volunteer_welcome')),
  recipient_email text,
  first_name text not null check (char_length(first_name) between 2 and 60),
  last_name text not null check (char_length(last_name) between 2 and 60),
  volunteer_email text not null check (char_length(volunteer_email) between 3 and 254),
  plan_id text not null check (plan_id in ('keyuwün', 'kimün', 'pülli')),
  billing text not null check (billing in ('monthly', 'yearly')),
  currency text not null check (currency in ('CLP', 'USD')),
  application_status public.application_status not null,
  application_created_at timestamptz not null,
  delivery_status text not null default 'pending' check (delivery_status in ('pending', 'sent', 'failed')),
  attempts smallint not null default 0 check (attempts between 0 and 5),
  idempotency_key uuid not null default gen_random_uuid(),
  first_attempt_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  lock_token uuid,
  sent_at timestamptz,
  brevo_message_id text check (brevo_message_id is null or char_length(brevo_message_id) <= 255),
  last_error text check (last_error is null or char_length(last_error) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (application_id, notification_type),
  unique (idempotency_key),
  check ((notification_type = 'volunteer_welcome' and recipient_email = volunteer_email) or (notification_type = 'admin_registration' and recipient_email is null)),
  check ((delivery_status = 'sent' and sent_at is not null and brevo_message_id is not null) or delivery_status <> 'sent')
);

create index volunteer_notification_dispatch_idx
  on private.volunteer_notification_queue(delivery_status, next_attempt_at)
  where delivery_status in ('pending', 'failed');

alter table private.volunteer_notification_queue enable row level security;
alter table private.volunteer_notification_queue force row level security;
revoke all on private.volunteer_notification_queue from public, anon, authenticated;

-- Crea el snapshot mínimo del correo; nunca copia adjuntos, mensajes, notas ni datos de pagos.
create or replace function private.enqueue_application_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.volunteer_profiles%rowtype;
  v_email text;
  v_email_confirmed_at timestamptz;
  v_plan_id text;
begin
  select p.* into strict v_profile
  from public.volunteer_profiles p
  where p.id = new.owner_id and p.deleted_at is null;

  select u.email, u.email_confirmed_at into v_email, v_email_confirmed_at
  from auth.users u
  where u.id = new.owner_id;

  select pp.plan_id into strict v_plan_id
  from public.plan_prices pp
  where pp.id = new.plan_price_id;

  if v_email is null or char_length(v_email) > 254 then
    raise exception 'notification_email_unavailable';
  end if;

  insert into private.volunteer_notification_queue(
    application_id, owner_id, notification_type, recipient_email,
    first_name, last_name, volunteer_email, plan_id, billing, currency,
    application_status, application_created_at
  ) values (
    new.id, new.owner_id, 'admin_registration', null,
    v_profile.first_name, v_profile.last_name, lower(v_email), v_plan_id,
    new.billing, new.currency, new.status, new.created_at
  ) on conflict (application_id, notification_type) do nothing;

  if v_email_confirmed_at is not null then
    insert into private.volunteer_notification_queue(
      application_id, owner_id, notification_type, recipient_email,
      first_name, last_name, volunteer_email, plan_id, billing, currency,
      application_status, application_created_at
    ) values (
      new.id, new.owner_id, 'volunteer_welcome', lower(v_email),
      v_profile.first_name, v_profile.last_name, lower(v_email), v_plan_id,
      new.billing, new.currency, new.status, new.created_at
    ) on conflict (application_id, notification_type) do nothing;
  end if;

  return new;
end;
$$;
revoke all on function private.enqueue_application_notifications() from public, anon, authenticated;

create trigger enqueue_volunteer_application_notifications
after insert on public.membership_applications
for each row execute function private.enqueue_application_notifications();

-- Si la confirmación ocurre después de crear la inscripción, encola la bienvenida pendiente.
create or replace function private.enqueue_confirmed_volunteer_welcome()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.volunteer_notification_queue(
    application_id, owner_id, notification_type, recipient_email,
    first_name, last_name, volunteer_email, plan_id, billing, currency,
    application_status, application_created_at
  )
  select a.id, a.owner_id, 'volunteer_welcome', lower(new.email),
         p.first_name, p.last_name, lower(new.email), pp.plan_id,
         a.billing, a.currency, 'draft'::public.application_status, a.created_at
  from public.membership_applications a
  join public.volunteer_profiles p on p.id = a.owner_id and p.deleted_at is null
  join public.plan_prices pp on pp.id = a.plan_price_id
  where a.owner_id = new.id
    and a.deleted_at is null
    and new.email is not null
  on conflict (application_id, notification_type) do nothing;
  return new;
end;
$$;
revoke all on function private.enqueue_confirmed_volunteer_welcome() from public, anon, authenticated;

create trigger enqueue_welcome_after_email_confirmation
after update of email_confirmed_at on auth.users
for each row
when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
execute function private.enqueue_confirmed_volunteer_welcome();

-- Reclamo atómico con bloqueo temporal. Solo el servidor puede ejecutar esta función.
create or replace function public.claim_volunteer_notifications(p_worker uuid, p_limit integer default 10)
returns table (
  notification_id uuid,
  application_id uuid,
  notification_type text,
  recipient_email text,
  first_name text,
  last_name text,
  volunteer_email text,
  plan_id text,
  billing text,
  currency text,
  application_status public.application_status,
  application_created_at timestamptz,
  idempotency_key uuid,
  attempt_number smallint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_worker is null or p_limit not between 1 and 25 then
    raise exception 'invalid_notification_claim';
  end if;

  return query
  with candidates as (
    select q.id
    from private.volunteer_notification_queue q
    where q.delivery_status in ('pending', 'failed')
      and q.attempts < 5
      and q.next_attempt_at <= now()
      and (q.locked_at is null or q.locked_at < now() - interval '5 minutes')
      and (q.first_attempt_at is null or q.first_attempt_at > now() - interval '25 minutes')
      -- La bienvenida nunca se reclama si Auth no conserva el correo confirmado.
      and (
        q.notification_type = 'admin_registration'
        or exists (
          select 1 from auth.users u
          where u.id = q.owner_id
            and u.email_confirmed_at is not null
            and lower(u.email) = q.recipient_email
        )
      )
    order by q.next_attempt_at, q.created_at
    for update skip locked
    limit p_limit
  ), claimed as (
    update private.volunteer_notification_queue q
    set delivery_status = 'pending',
        attempts = q.attempts + 1,
        first_attempt_at = coalesce(q.first_attempt_at, now()),
        locked_at = now(),
        lock_token = p_worker,
        updated_at = now()
    from candidates c
    where q.id = c.id
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

create or replace function public.mark_volunteer_notification_sent(
  p_notification_id uuid,
  p_worker uuid,
  p_brevo_message_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_brevo_message_id is null or char_length(p_brevo_message_id) not between 1 and 255 then
    raise exception 'invalid_brevo_message_id';
  end if;
  update private.volunteer_notification_queue q
  set delivery_status = 'sent', sent_at = now(),
      brevo_message_id = p_brevo_message_id, last_error = null,
      locked_at = null, lock_token = null, updated_at = now()
  where q.id = p_notification_id
    and q.lock_token = p_worker
    and q.delivery_status = 'pending';
  if not found then raise exception 'notification_lock_lost'; end if;
end;
$$;
revoke all on function public.mark_volunteer_notification_sent(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.mark_volunteer_notification_sent(uuid, uuid, text) to service_role;

create or replace function public.mark_volunteer_notification_failed(
  p_notification_id uuid,
  p_worker uuid,
  p_error_code text,
  p_retryable boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.volunteer_notification_queue q
  set delivery_status = 'failed',
      last_error = left(regexp_replace(coalesce(p_error_code, 'delivery_failed'), '[^a-zA-Z0-9_.:-]', '_', 'g'), 500),
      next_attempt_at = case
        when p_retryable and q.attempts < 5 and q.first_attempt_at > now() - interval '25 minutes'
          then now() + make_interval(secs => least(300, 15 * (2 ^ greatest(q.attempts - 1, 0))::integer))
        else 'infinity'::timestamptz
      end,
      locked_at = null, lock_token = null, updated_at = now()
  where q.id = p_notification_id
    and q.lock_token = p_worker
    and q.delivery_status = 'pending';
  if not found then raise exception 'notification_lock_lost'; end if;
end;
$$;
revoke all on function public.mark_volunteer_notification_failed(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.mark_volunteer_notification_failed(uuid, uuid, text, boolean) to service_role;

commit;
