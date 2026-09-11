-- Las Ñañas · lectura administrativa mínima para el panel de voluntariado.
-- Debe aplicarse separadamente y no modifica las migraciones anteriores.
begin;

-- La lista entrega solo lo necesario; el correo queda reservado al detalle individual.
create or replace function public.admin_list_membership_applications()
returns table (application_id uuid, first_name text, last_name text, plan_id text, billing text, currency text, application_status public.application_status, application_created_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.staff_roles sr
    where sr.user_id = auth.uid() and sr.role = 'admin'::public.volunteer_role and sr.revoked_at is null
  ) then
    raise exception 'admin_access_required' using errcode = '42501';
  end if;
  return query
  select a.id, p.first_name, p.last_name, pp.plan_id, a.billing, a.currency, a.status, a.created_at
  from public.membership_applications a
  join public.volunteer_profiles p on p.id = a.owner_id and p.deleted_at is null
  join public.plan_prices pp on pp.id = a.plan_price_id
  where a.deleted_at is null
  order by a.created_at desc;
end;
$$;
revoke all on function public.admin_list_membership_applications() from public, anon, authenticated;
grant execute on function public.admin_list_membership_applications() to authenticated;

-- El correo de Auth solo se expone después de verificar un rol admin activo.
create or replace function public.admin_get_membership_application(p_application_id uuid)
returns table (application_id uuid, owner_id uuid, first_name text, last_name text, email text, plan_id text, billing text, currency text, quoted_amount integer, application_status public.application_status, application_created_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_application_id is null then
    raise exception 'application_id_required' using errcode = '22023';
  end if;
  if auth.uid() is null or not exists (
    select 1 from public.staff_roles sr
    where sr.user_id = auth.uid() and sr.role = 'admin'::public.volunteer_role and sr.revoked_at is null
  ) then
    raise exception 'admin_access_required' using errcode = '42501';
  end if;
  return query
  select a.id, a.owner_id, p.first_name, p.last_name, lower(u.email), pp.plan_id,
         a.billing, a.currency, a.quoted_amount, a.status, a.created_at
  from public.membership_applications a
  join public.volunteer_profiles p on p.id = a.owner_id and p.deleted_at is null
  join public.plan_prices pp on pp.id = a.plan_price_id
  join auth.users u on u.id = a.owner_id
  where a.id = p_application_id and a.deleted_at is null
  limit 1;
end;
$$;
revoke all on function public.admin_get_membership_application(uuid) from public, anon, authenticated;
grant execute on function public.admin_get_membership_application(uuid) to authenticated;

commit;
