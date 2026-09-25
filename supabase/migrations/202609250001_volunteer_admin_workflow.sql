-- Lista de solicitudes con estado de pago y membresia, y transiciones del panel admin.
-- La lista ampliada usa una RPC nueva; se conserva la funcion anterior para otros clientes.
begin;

create or replace function public.admin_list_membership_applications_v2()
returns table (
  application_id uuid,
  first_name text,
  last_name text,
  plan_id text,
  billing text,
  currency text,
  application_status public.application_status,
  application_created_at timestamptz,
  owner_id uuid,
  payment_status public.payment_status,
  membership_active boolean
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.staff_roles sr
    where sr.user_id = auth.uid()
      and sr.role = 'admin'::public.volunteer_role
      and sr.revoked_at is null
  ) then
    raise exception 'admin_access_required' using errcode = '42501';
  end if;

  return query
  select a.id, p.first_name, p.last_name, pp.plan_id, a.billing, a.currency,
         a.status, a.created_at, a.owner_id, pay.status,
         coalesce(m.active and m.starts_at <= now() and m.ends_at > now(), false)
  from public.membership_applications a
  join public.volunteer_profiles p on p.id = a.owner_id and p.deleted_at is null
  join public.plan_prices pp on pp.id = a.plan_price_id
  left join public.payments pay on pay.application_id = a.id
  left join public.memberships m on m.application_id = a.id
  where a.deleted_at is null
  order by a.created_at desc;
end;
$$;
revoke all on function public.admin_list_membership_applications_v2() from public, anon, authenticated;
grant execute on function public.admin_list_membership_applications_v2() to authenticated;

-- Detalle y lista usan la misma definicion de vigencia.
create or replace function public.admin_get_application_membership(p_application_id uuid)
returns table (payment_status public.payment_status, membership_active boolean, starts_at timestamptz, ends_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.staff_roles r
    where r.user_id = auth.uid() and r.role = 'admin'::public.volunteer_role and r.revoked_at is null
  ) then
    raise exception 'admin_access_required' using errcode = '42501';
  end if;
  return query
  select p.status, coalesce(m.active and m.starts_at <= now() and m.ends_at > now(), false), m.starts_at, m.ends_at
  from public.membership_applications a
  left join public.payments p on p.application_id = a.id
  left join public.memberships m on m.application_id = a.id and m.payment_id = p.id
  where a.id = p_application_id and a.deleted_at is null
  limit 1;
end;
$$;
revoke all on function public.admin_get_application_membership(uuid) from public, anon, authenticated;
grant execute on function public.admin_get_application_membership(uuid) to authenticated;

-- El admin puede iniciar revision, solicitar aclaracion o rechazar. La aprobacion
-- y la activacion de pago siguen en las RPC especificas existentes.
create or replace function public.admin_set_application_status(
  p_application_id uuid,
  p_status public.application_status,
  p_message text default null
)
returns table (application_status public.application_status, decided_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare
  v_application public.membership_applications%rowtype;
  v_message text := btrim(p_message);
  v_now timestamptz := now();
begin
  if auth.uid() is null or not exists (
    select 1 from public.staff_roles sr
    where sr.user_id = auth.uid()
      and sr.role = 'admin'::public.volunteer_role
      and sr.revoked_at is null
  ) then
    raise exception 'admin_access_required' using errcode = '42501';
  end if;
  if p_application_id is null then
    raise exception 'application_id_required' using errcode = '22023';
  end if;
  if p_status is null or p_status not in ('in_review', 'needs_clarification', 'rejected') then
    raise exception 'invalid_application_status' using errcode = '22023';
  end if;
  if p_message is not null and char_length(v_message) not between 1 and 3000 then
    raise exception 'invalid_application_message' using errcode = '22023';
  end if;
  if p_status = 'needs_clarification' and v_message is null then
    raise exception 'clarification_message_required' using errcode = '22023';
  end if;
  if p_status = 'rejected' and (v_message is null or char_length(v_message) < 5) then
    raise exception 'rejection_reason_required' using errcode = '22023';
  end if;

  select * into v_application
  from public.membership_applications a
  where a.id = p_application_id and a.deleted_at is null
  for update;
  if not found then
    raise exception 'application_not_found';
  end if;

  -- Un reintento no duplica mensajes ni eventos de auditoria.
  if v_application.status = p_status then
    return query select v_application.status, v_application.decided_at;
    return;
  end if;

  if not (
    (p_status = 'in_review' and v_application.status in ('submitted', 'needs_clarification', 'rejected'))
    or (p_status = 'needs_clarification' and v_application.status in ('submitted', 'in_review'))
    or (p_status = 'rejected' and v_application.status in ('submitted', 'in_review', 'needs_clarification', 'approved'))
  ) then
    raise exception 'application_status_transition_not_allowed' using errcode = '22023';
  end if;
  if v_application.status = 'approved' and p_status = 'rejected' and (
    exists (
      select 1 from public.payments pay
      where pay.application_id = p_application_id and pay.status = 'confirmed'
    )
    or exists (
      select 1 from public.memberships m
      where m.application_id = p_application_id and m.active
    )
  ) then
    raise exception 'approved_application_has_payment_or_membership' using errcode = '22023';
  end if;

  update public.membership_applications a
  set status = p_status,
      decided_at = case when p_status = 'rejected' then v_now else null end,
      updated_at = v_now
  where a.id = p_application_id
  returning a.status, a.decided_at
  into v_application.status, v_application.decided_at;

  if v_message is not null then
    insert into public.application_messages(application_id, author_id, body, visible_to_member)
    values (p_application_id, auth.uid(), v_message, true);
  end if;

  insert into public.volunteer_audit_events(actor_id, action, target_table, target_id)
  values (auth.uid(), 'application_status_changed', 'membership_applications', p_application_id::text);

  return query select v_application.status, v_application.decided_at;
end;
$$;
revoke all on function public.admin_set_application_status(uuid, public.application_status, text)
  from public, anon, authenticated;
grant execute on function public.admin_set_application_status(uuid, public.application_status, text)
  to authenticated;

-- El rol admin activo abre todas las secciones del panel. Coordinacion conserva
-- el requisito explicito agenda_access para leer agendas personales.
create or replace function public.can_read_agenda()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.staff_roles r
    where r.user_id = auth.uid() and r.revoked_at is null
      and (
        r.role = 'admin'::public.volunteer_role
        or (r.role = 'coordination'::public.volunteer_role and r.agenda_access)
      )
  )
$$;
revoke all on function public.can_read_agenda() from public, anon;
grant execute on function public.can_read_agenda() to authenticated, service_role;

commit;
