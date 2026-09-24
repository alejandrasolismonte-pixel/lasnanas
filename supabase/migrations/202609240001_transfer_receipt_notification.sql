-- Las Ñañas · aviso administrativo cuando un comprobante de transferencia
-- termina de subirse y queda marcado como recibido.
--
-- IMPORTANTE:
-- Este mecanismo solo informa que el comprobante fue recibido.
-- NO confirma que el dinero haya ingresado a la cuenta bancaria.
-- NO modifica pagos, membresías ni el estado de la suscripción.

begin;

-- ============================================================
-- 1. AMPLIAR LOS TIPOS DE NOTIFICACIÓN PERMITIDOS
-- ============================================================

-- La cola existente solo admite inscripción y bienvenida.
-- Sustituimos exactamente los dos CHECK que restringen el tipo y destinatario.
alter table private.volunteer_notification_queue
  drop constraint volunteer_notification_queue_notification_type_check,
  drop constraint volunteer_notification_queue_check;

alter table private.volunteer_notification_queue
  add constraint
    volunteer_notification_queue_notification_type_check
  check (
    notification_type in (
      'admin_registration',
      'volunteer_welcome',
      'transfer_receipt_received'
    )
  );

alter table private.volunteer_notification_queue
  add constraint
    volunteer_notification_queue_recipient_check
  check (
    (
      notification_type = 'volunteer_welcome'
      and recipient_email = volunteer_email
    )
    or
    (
      notification_type in (
        'admin_registration',
        'transfer_receipt_received'
      )
      and recipient_email is null
    )
  );

-- ============================================================
-- 2. ENCOLAR AVISO CUANDO EL COMPROBANTE QUEDA RECIBIDO
-- ============================================================

-- Se ejecuta únicamente cuando received_at pasa de NULL
-- a una fecha/hora real.
--
-- La notificación es secundaria:
-- cualquier problema con la cola o los datos del correo
-- NO debe impedir que el comprobante quede registrado.

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
    on conflict (
      application_id,
      notification_type
    )
    do nothing;

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

revoke all
on function
  private.enqueue_transfer_receipt_notification()
from public, anon, authenticated;

-- ============================================================
-- 3. TRIGGER
-- ============================================================

drop trigger if exists
  enqueue_transfer_receipt_notification
on public.transfer_receipts;

create trigger
  enqueue_transfer_receipt_notification
after update of received_at
on public.transfer_receipts
for each row
when (
  old.received_at is null
  and new.received_at is not null
)
execute function
  private.enqueue_transfer_receipt_notification();

-- ============================================================
-- 4. ACTUALIZAR EL TRABAJADOR DE LA COLA
-- ============================================================

-- Ahora hay dos notificaciones destinadas a administración:
--
-- admin_registration
-- transfer_receipt_received
--
-- Solo la bienvenida necesita comprobar además que
-- el correo de la voluntaria esté confirmado.

create or replace function
  public.claim_volunteer_notifications(
    p_worker uuid,
    p_limit integer default 10
  )
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

  if p_worker is null
     or p_limit not between 1 and 25
  then
    raise exception
      'invalid_notification_claim';
  end if;

  return query

  with candidates as (

    select q.id

    from private.volunteer_notification_queue q

    where q.delivery_status
      in ('pending', 'failed')

      and q.attempts < 5

      and q.next_attempt_at <= now()

      and (
        q.locked_at is null
        or q.locked_at <
          now() - interval '5 minutes'
      )

      and (
        q.first_attempt_at is null
        or q.first_attempt_at >
          now() - interval '25 minutes'
      )

      and (

        -- Avisos dirigidos a administración.
        q.notification_type in (
          'admin_registration',
          'transfer_receipt_received'
        )

        or

        -- La bienvenida solo puede enviarse si
        -- Auth mantiene el correo confirmado.
        exists (
          select 1
          from auth.users u
          where u.id = q.owner_id
            and u.email_confirmed_at
              is not null
            and lower(u.email)
              = q.recipient_email
        )

      )

    order by
      q.next_attempt_at,
      q.created_at

    for update skip locked

    limit p_limit

  ),

  claimed as (

    update
      private.volunteer_notification_queue q

    set
      delivery_status = 'pending',
      attempts = q.attempts + 1,
      first_attempt_at =
        coalesce(
          q.first_attempt_at,
          now()
        ),
      locked_at = now(),
      lock_token = p_worker,
      updated_at = now()

    from candidates c

    where q.id = c.id

    returning q.*

  )

  select
    c.id,
    c.application_id,
    c.notification_type,
    c.recipient_email,
    c.first_name,
    c.last_name,
    c.volunteer_email,
    c.plan_id,
    c.billing,
    c.currency,
    c.application_status,
    c.application_created_at,
    c.idempotency_key,
    c.attempts

  from claimed c;

end;
$$;

revoke all
on function
  public.claim_volunteer_notifications(
    uuid,
    integer
  )
from public, anon, authenticated;

grant execute
on function
  public.claim_volunteer_notifications(
    uuid,
    integer
  )
to service_role;

commit;
