-- Comprobante de pago y aviso de membresía: solo después de la confirmación real.
begin;

alter table private.volunteer_notification_queue
  drop constraint if exists volunteer_notification_queue_notification_type_check,
  drop constraint if exists volunteer_notification_queue_recipient_check,
  drop constraint if exists volunteer_notification_queue_check;

alter table private.volunteer_notification_queue
  add constraint volunteer_notification_queue_notification_type_check
    check (notification_type in (
      'admin_registration', 'volunteer_welcome', 'transfer_receipt_received',
      'payment_confirmed', 'membership_activated')),
  add constraint volunteer_notification_queue_recipient_check
    check (
      (notification_type in ('volunteer_welcome', 'payment_confirmed', 'membership_activated')
        and recipient_email = volunteer_email)
      or (notification_type in ('admin_registration', 'transfer_receipt_received')
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
  -- Un UPDATE idempotente de la misma membresía no genera nuevos correos.
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
  select new.application_id, new.owner_id, kind, v_email,
    v_profile.first_name, v_profile.last_name, v_email, v_plan_id,
    v_application.billing, v_application.currency,
    v_application.status, v_application.created_at
  from (values ('payment_confirmed'), ('membership_activated')) as notifications(kind)
  on conflict (application_id, notification_type) do nothing;
  return new;
exception when others then
  -- El correo es secundario: jamás revierte un pago bancario confirmado.
  raise warning 'payment_activation_notification_enqueue_failed';
  return new;
end;
$$;
revoke all on function private.enqueue_payment_activation_notifications()
  from public, anon, authenticated;

create trigger enqueue_payment_activation_notifications
after insert or update of active, payment_id on public.memberships
for each row execute function private.enqueue_payment_activation_notifications();

commit;
