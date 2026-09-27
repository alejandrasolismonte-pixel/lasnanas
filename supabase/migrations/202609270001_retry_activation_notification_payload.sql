-- Reintenta fallos de validación anteriores a Brevo tras actualizar el worker.
-- Conserva el UUID de idempotencia y exige una membresía activa.
begin;

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
    application_status, application_created_at)
  select v_application.id, v_application.owner_id, kind,
    case when kind = 'admin_payment_confirmed' then null else v_email end,
    v_profile.first_name, v_profile.last_name, v_email, v_plan_id,
    v_application.billing, v_application.currency,
    v_application.status, v_application.created_at
  from (values ('payment_confirmed'), ('membership_activated'),
               ('admin_payment_confirmed')) as notifications(kind)
  on conflict (application_id, notification_type) do nothing;
  get diagnostics v_inserted = row_count;

  -- Solo los errores de validación anteriores a Brevo se pueden recuperar
  -- de forma segura. Se conserva el UUID de idempotencia original.
  update private.volunteer_notification_queue q
  set delivery_status = 'pending', attempts = 0, first_attempt_at = null,
      next_attempt_at = now(), locked_at = null, lock_token = null,
      last_error = null, updated_at = now()
  where q.application_id = v_application.id
    and q.owner_id = v_application.owner_id
    and q.notification_type in ('payment_confirmed', 'membership_activated', 'admin_payment_confirmed')
    and q.delivery_status = 'failed'
    and q.last_error in ('confirmed_payment_unavailable', 'active_membership_unavailable', 'invalid_notification_payload')
    and q.brevo_message_id is null;
  get diagnostics v_requeued = row_count;
  return v_inserted + v_requeued;
end;
$$;

revoke all on function public.ensure_activation_notifications(uuid)
  from public, anon, authenticated;
grant execute on function public.ensure_activation_notifications(uuid)
  to service_role;

commit;
