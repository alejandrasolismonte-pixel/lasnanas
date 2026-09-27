-- Estado de lectura por solicitud para mensajes visibles entre voluntaria y administración.
begin;

alter table public.application_messages
  add column member_read_at timestamptz,
  add column admin_read_at timestamptz;

create or replace function public.mark_application_messages_read(p_application_id uuid)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_owner_id uuid;
  v_updated integer;
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  select owner_id into v_owner_id
  from public.membership_applications
  where id = p_application_id and deleted_at is null;
  if v_owner_id is null then
    raise exception 'application_not_found' using errcode = '42501';
  end if;

  if v_owner_id = auth.uid() then
    update public.application_messages
    set member_read_at = now()
    where application_id = p_application_id
      and author_id <> v_owner_id
      and visible_to_member
      and deleted_at is null
      and member_read_at is null;
  elsif exists (
    select 1 from public.staff_roles
    where user_id = auth.uid()
      and role = 'admin'::public.volunteer_role
      and revoked_at is null
  ) then
    update public.application_messages
    set admin_read_at = now()
    where application_id = p_application_id
      and author_id = v_owner_id
      and deleted_at is null
      and admin_read_at is null;
  else
    raise exception 'message_access_required' using errcode = '42501';
  end if;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

revoke all on function public.mark_application_messages_read(uuid)
  from public, anon, authenticated;
grant execute on function public.mark_application_messages_read(uuid)
  to authenticated;

-- El correo administrativo de pago confirmado enlaza directamente el expediente.
alter table private.volunteer_notification_queue
  drop constraint volunteer_notification_queue_notification_type_check,
  drop constraint volunteer_notification_queue_recipient_check;

alter table private.volunteer_notification_queue
  add constraint volunteer_notification_queue_notification_type_check
    check (notification_type in (
      'admin_registration', 'volunteer_welcome', 'transfer_receipt_received',
      'payment_confirmed', 'membership_activated', 'admin_payment_confirmed')),
  add constraint volunteer_notification_queue_recipient_check
    check (
      (notification_type in ('volunteer_welcome', 'payment_confirmed', 'membership_activated')
        and recipient_email = volunteer_email)
      or (notification_type in ('admin_registration', 'transfer_receipt_received', 'admin_payment_confirmed')
        and recipient_email is null)
    );

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
    where id = new.application_id and owner_id = new.owner_id and deleted_at is null;
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
    application_status, application_created_at)
  select new.application_id, new.owner_id, kind,
    case when kind = 'admin_payment_confirmed' then null else v_email end,
    v_profile.first_name, v_profile.last_name, v_email, v_plan_id,
    v_application.billing, v_application.currency,
    v_application.status, v_application.created_at
  from (values ('payment_confirmed'), ('membership_activated'),
               ('admin_payment_confirmed')) as notifications(kind)
  on conflict (application_id, notification_type) do nothing;
  return new;
exception when others then
  raise warning 'payment_activation_notification_enqueue_failed';
  return new;
end;
$$;
revoke all on function private.enqueue_payment_activation_notifications()
  from public, anon, authenticated;

-- El trabajador puede reclamar el nuevo aviso administrativo sin correo destinatario en la fila.
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
    where q.delivery_status in ('pending', 'failed')
      and q.attempts < 5
      and q.next_attempt_at <= now()
      and (q.locked_at is null or q.locked_at < now() - interval '5 minutes')
      and (q.first_attempt_at is null or q.first_attempt_at > now() - interval '25 minutes')
      and (
        q.notification_type in ('admin_registration', 'transfer_receipt_received', 'admin_payment_confirmed')
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

commit;
