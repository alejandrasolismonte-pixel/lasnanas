-- Panel independiente de Ñañas. Los pines siguen en public.map_pin_positions.
begin;

-- staff_roles tiene una sola fila por persona: un usuario con este rol no puede
-- ser simultáneamente admin ni coordination del voluntariado.
alter table public.staff_roles
  add constraint staff_nanas_manager_no_agenda
  check (role <> 'nanas_manager'::public.volunteer_role or not agenda_access);

create or replace function public.can_read_agenda()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.staff_roles r
    where r.user_id = auth.uid()
      and r.revoked_at is null
      and r.agenda_access
      and r.role in ('coordination'::public.volunteer_role, 'admin'::public.volunteer_role)
  )
$$;
revoke all on function public.can_read_agenda() from public, anon;
grant execute on function public.can_read_agenda() to authenticated, service_role;

create or replace function public.is_nanas_manager()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.staff_roles r
    where r.user_id = auth.uid()
      and r.role = 'nanas_manager'::public.volunteer_role
      and r.revoked_at is null
  )
$$;
revoke all on function public.is_nanas_manager() from public, anon, authenticated;
grant execute on function public.is_nanas_manager() to authenticated;

-- Una cuenta con solicitudes previas no puede convertirse en cuenta exclusiva
-- de Ñañas; así tampoco hereda las operaciones de servicio de una voluntaria.
create function public.nanas_guard_staff_role()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.role = 'nanas_manager'::public.volunteer_role and new.revoked_at is null
    and exists (
      select 1 from public.membership_applications a
      where a.owner_id = new.user_id
    ) then
    raise exception 'nanas_manager_requires_dedicated_account' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.nanas_guard_staff_role() from public, anon, authenticated;
create trigger nanas_guard_staff_role
before insert or update of role, revoked_at on public.staff_roles
for each row execute function public.nanas_guard_staff_role();

-- Las políticas de propietaria del voluntariado no se aplican a la cuenta
-- dedicada de Ñañas. La política restrictiva se suma a las existentes.
do $$
declare v_table text;
begin
  foreach v_table in array array[
    'volunteer_profiles', 'plans', 'plan_prices', 'membership_applications',
    'application_messages', 'admin_notes', 'clarification_attachments',
    'payments', 'memberships', 'documents', 'agenda_entries',
    'volunteer_audit_events', 'transfer_receipts'
  ] loop
    execute format(
      'create policy nanas_manager_volunteer_denied on public.%I as restrictive for all to authenticated using (not public.is_nanas_manager()) with check (not public.is_nanas_manager())',
      v_table
    );
  end loop;
end;
$$;

create policy nanas_manager_volunteer_storage_denied on storage.objects
  as restrictive for all to authenticated
  using (
    bucket_id not in ('volunteer-attachments', 'volunteer-documents', 'transfer-receipts')
    or not public.is_nanas_manager()
  )
  with check (
    bucket_id not in ('volunteer-attachments', 'volunteer-documents', 'transfer-receipts')
    or not public.is_nanas_manager()
  );

create table public.nanas (
  id uuid primary key default gen_random_uuid(),
  first_name text not null check (char_length(btrim(first_name)) between 2 and 80),
  last_name text not null check (char_length(btrim(last_name)) between 2 and 100),
  rut text not null check (char_length(btrim(rut)) between 7 and 16),
  rut_normalized text generated always as (upper(regexp_replace(rut, '[^0-9Kk]', '', 'g'))) stored unique,
  status text not null default 'in_process' check (status in ('in_process', 'active', 'inactive')),
  exact_address text not null check (char_length(btrim(exact_address)) between 2 and 240),
  territory text not null check (char_length(btrim(territory)) between 2 and 120),
  commune text not null check (char_length(btrim(commune)) between 2 and 120),
  categories text[] not null default '{}'
    check (categories <@ array[
      'espiritualidad_cosmovision', 'turismo_rural', 'agricultura_agroecologia',
      'artesania', 'gastronomia_alimentos', 'oficios_saberes', 'otro'
    ]::text[]),
  agriculture_items text[] not null default '{}'
    check (agriculture_items <@ array[
      'hortalizas', 'huevos_aves', 'semillas', 'frutales', 'cultivos_varios', 'otro'
    ]::text[]),
  nana_bio text not null default '' check (char_length(nana_bio) <= 3000),
  territory_bio text not null default '' check (char_length(territory_bio) <= 3000),
  activities text not null default '' check (char_length(activities) <= 3000),
  experience_offerings text[] not null default '{}'
    check (experience_offerings <@ array[
      'paseos_recorridos', 'comidas', 'ensenanza_oficio', 'experiencia_cultural',
      'aprendizaje_agroecologico', 'otra'
    ]::text[]),
  food_inclusion text not null default 'not_included'
    check (food_inclusion in ('included', 'partial', 'not_included')),
  food_types text[] not null default '{}'
    check (food_types <@ array['general', 'vegetariana', 'vegana', 'otra']::text[]),
  food_notes text not null default '' check (char_length(food_notes) <= 2000),
  lodging_inclusion text not null default 'not_included'
    check (lodging_inclusion in ('included', 'subject_to_availability', 'not_included')),
  lodging_description text not null default '' check (char_length(lodging_description) <= 2000),
  admin_notes text not null default '' check (char_length(admin_notes) <= 5000),
  archived_at timestamptz,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  updated_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (rut_normalized ~ '^[0-9]{6,8}[0-9K]$'),
  check (cardinality(agriculture_items) = 0 or categories @> array['agricultura_agroecologia']::text[]),
  check (status <> 'active' or cardinality(categories) > 0),
  check ((status = 'inactive') = (archived_at is not null))
);

create index nanas_status_created_idx on public.nanas(status, created_at desc);

create function public.nanas_set_metadata()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  if new.status = 'inactive' then
    new.archived_at := coalesce(new.archived_at, now());
  else
    new.archived_at := null;
  end if;
  return new;
end;
$$;
revoke all on function public.nanas_set_metadata() from public, anon, authenticated;
create trigger nanas_metadata_guard
before insert or update on public.nanas
for each row execute function public.nanas_set_metadata();

alter table public.nanas enable row level security;
alter table public.nanas force row level security;
revoke all on public.nanas from public, anon, authenticated;
create policy nanas_manager_read on public.nanas
  for select to authenticated using (public.is_nanas_manager());
create policy nanas_manager_insert on public.nanas
  for insert to authenticated with check (public.is_nanas_manager() and created_by = auth.uid());
create policy nanas_manager_update on public.nanas
  for update to authenticated
  using (public.is_nanas_manager())
  with check (public.is_nanas_manager() and created_by is not null);

-- RUT, dirección y notas internas solo se consultan mediante la RLS de la tabla.
-- No se concede DELETE ni UPDATE de identidad, auditoría o fecha de archivado.
grant select on public.nanas to authenticated;
grant insert (
  first_name, last_name, rut, status, exact_address, territory, commune,
  categories, agriculture_items, nana_bio, territory_bio, activities,
  experience_offerings, food_inclusion, food_types, food_notes,
  lodging_inclusion, lodging_description, admin_notes
) on public.nanas to authenticated;
grant update (
  first_name, last_name, rut, status, exact_address, territory, commune,
  categories, agriculture_items, nana_bio, territory_bio, activities,
  experience_offerings, food_inclusion, food_types, food_notes,
  lodging_inclusion, lodging_description, admin_notes
) on public.nanas to authenticated;

-- Se reutilizan las cinco RPC y la misma tabla de pines. Solo se amplía su
-- comprobación de rol; firmas, validaciones, SECURITY DEFINER y GRANT no cambian.
do $$
declare
  v_function regprocedure;
  v_definition text;
  v_old_guard text := 'r.role = ''admin''::public.volunteer_role';
  v_new_guard text := 'r.role in (''admin''::public.volunteer_role, ''nanas_manager''::public.volunteer_role)';
begin
  foreach v_function in array array[
    'public.admin_get_map_pin_positions()'::regprocedure,
    'public.admin_create_map_pin(text,text,text,numeric,numeric,numeric,numeric)'::regprocedure,
    'public.admin_update_map_pin(text,text,text,text)'::regprocedure,
    'public.admin_set_map_pin_active(text,boolean)'::regprocedure,
    'public.admin_save_map_pin_positions(jsonb)'::regprocedure
  ] loop
    v_definition := pg_get_functiondef(v_function);
    if strpos(v_definition, v_old_guard) = 0 then
      raise exception 'Unexpected map pin guard in %', v_function;
    end if;
    execute replace(v_definition, v_old_guard, v_new_guard);
  end loop;
end;
$$;

commit;
