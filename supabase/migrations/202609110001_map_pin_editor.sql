-- Las Ñañas · posiciones editables del mapa territorial.
-- La lectura es pública; solo una sesión con rol admin activo puede guardar cambios.
begin;

create table if not exists public.map_pin_positions (
  pin_id text primary key check (pin_id ~ '^[a-z0-9-]{3,60}$'),
  sort_order smallint not null unique check (sort_order between 1 and 100),
  x numeric(5,2) not null check (x between 0 and 100),
  y numeric(5,2) not null check (y between 0 and 100),
  mobile_x numeric(5,2) not null check (mobile_x between 0 and 100),
  mobile_y numeric(5,2) not null check (mobile_y between 0 and 100),
  default_x numeric(5,2) not null check (default_x between 0 and 100),
  default_y numeric(5,2) not null check (default_y between 0 and 100),
  default_mobile_x numeric(5,2) not null check (default_mobile_x between 0 and 100),
  default_mobile_y numeric(5,2) not null check (default_mobile_y between 0 and 100),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.map_pin_positions
  (pin_id, sort_order, x, y, mobile_x, mobile_y, default_x, default_y, default_mobile_x, default_mobile_y)
values
  ('nanas-temuco',             1, 79.50, 54.00, 82.00, 50.00, 79.50, 54.00, 82.00, 50.00),
  ('nanas-renaico',            2, 76.00, 27.00, 76.00, 27.00, 76.00, 27.00, 76.00, 27.00),
  ('nanas-sector-estero',      3, 33.00, 58.00, 33.00, 58.00, 33.00, 58.00, 33.00, 58.00),
  ('nanas-sector-fogon',       4, 57.00, 76.00, 57.00, 76.00, 57.00, 76.00, 57.00, 76.00),
  ('nanas-padre-las-casas',    5, 80.00, 60.00, 20.00, 30.00, 80.00, 60.00, 20.00, 30.00),
  ('nanas-villarrica',         6, 70.00, 20.00, 70.00, 83.00, 70.00, 20.00, 70.00, 83.00),
  ('nanas-lago-budi',          7, 90.00, 64.00, 90.00, 64.00, 90.00, 64.00, 90.00, 64.00),
  ('experiencia-rukas',        8, 62.50, 28.50, 62.50, 28.50, 62.50, 28.50, 62.50, 28.50),
  ('experiencia-flora-fauna',  9, 32.00, 15.00, 32.00, 15.00, 32.00, 15.00, 32.00, 15.00),
  ('experiencia-observatorio',10, 40.00, 30.00, 50.00, 20.00, 40.00, 30.00, 50.00, 20.00),
  ('experiencia-faros',       11, 40.00, 70.00, 40.00, 70.00, 40.00, 70.00, 40.00, 70.00)
on conflict (pin_id) do nothing;

alter table public.map_pin_positions enable row level security;
alter table public.map_pin_positions force row level security;
revoke all on table public.map_pin_positions from public, anon, authenticated;

-- Los visitantes reciben únicamente las coordenadas necesarias para dibujar el mapa.
create or replace function public.get_map_pin_positions()
returns table (pin_id text, x numeric, y numeric, mobile_x numeric, mobile_y numeric)
language sql stable security definer set search_path = ''
as $$
  select p.pin_id, p.x, p.y, p.mobile_x, p.mobile_y
  from public.map_pin_positions p
  order by p.sort_order
$$;
revoke all on function public.get_map_pin_positions() from public;
grant execute on function public.get_map_pin_positions() to anon, authenticated;

-- Esta variante comprueba el rol y entrega además los valores de restauración.
create or replace function public.admin_get_map_pin_positions()
returns table (
  pin_id text,
  x numeric,
  y numeric,
  mobile_x numeric,
  mobile_y numeric,
  default_x numeric,
  default_y numeric,
  default_mobile_x numeric,
  default_mobile_y numeric
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.staff_roles r
    where r.user_id = auth.uid()
      and r.role = 'admin'::public.volunteer_role
      and r.revoked_at is null
  ) then
    raise exception 'admin_access_required' using errcode = '42501';
  end if;

  return query
  select p.pin_id, p.x, p.y, p.mobile_x, p.mobile_y,
         p.default_x, p.default_y, p.default_mobile_x, p.default_mobile_y
  from public.map_pin_positions p
  order by p.sort_order;
end;
$$;
revoke all on function public.admin_get_map_pin_positions() from public, anon, authenticated;
grant execute on function public.admin_get_map_pin_positions() to authenticated;

-- Recibe el estado visual completo. Cada número se valida antes de actualizar.
create or replace function public.admin_save_map_pin_positions(p_positions jsonb)
returns table (pin_id text, x numeric, y numeric, mobile_x numeric, mobile_y numeric)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_item jsonb;
  v_pin_id text;
  v_x numeric;
  v_y numeric;
  v_mobile_x numeric;
  v_mobile_y numeric;
  v_count integer;
begin
  if auth.uid() is null or not exists (
    select 1 from public.staff_roles r
    where r.user_id = auth.uid()
      and r.role = 'admin'::public.volunteer_role
      and r.revoked_at is null
  ) then
    raise exception 'admin_access_required' using errcode = '42501';
  end if;

  if p_positions is null or jsonb_typeof(p_positions) <> 'array' then
    raise exception 'positions_array_required' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_positions);
  if v_count < 1 or v_count > 50 then
    raise exception 'invalid_positions_count' using errcode = '22023';
  end if;
  if (select count(distinct item->>'pin_id') from jsonb_array_elements(p_positions) item) <> v_count then
    raise exception 'duplicate_pin_id' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_positions)
  loop
    if jsonb_typeof(v_item) <> 'object'
      or jsonb_typeof(v_item->'x') <> 'number'
      or jsonb_typeof(v_item->'y') <> 'number'
      or jsonb_typeof(v_item->'mobile_x') <> 'number'
      or jsonb_typeof(v_item->'mobile_y') <> 'number' then
      raise exception 'invalid_pin_position' using errcode = '22023';
    end if;

    v_pin_id := v_item->>'pin_id';
    v_x := (v_item->>'x')::numeric;
    v_y := (v_item->>'y')::numeric;
    v_mobile_x := (v_item->>'mobile_x')::numeric;
    v_mobile_y := (v_item->>'mobile_y')::numeric;

    if v_pin_id is null or v_x not between 0 and 100 or v_y not between 0 and 100
      or v_mobile_x not between 0 and 100 or v_mobile_y not between 0 and 100 then
      raise exception 'pin_position_out_of_range' using errcode = '22023';
    end if;

    update public.map_pin_positions p
    set x = round(v_x, 2),
        y = round(v_y, 2),
        mobile_x = round(v_mobile_x, 2),
        mobile_y = round(v_mobile_y, 2),
        updated_by = auth.uid(),
        updated_at = now()
    where p.pin_id = v_pin_id;

    if not found then
      raise exception 'unknown_pin_id' using errcode = '22023';
    end if;
  end loop;

  return query
  select p.pin_id, p.x, p.y, p.mobile_x, p.mobile_y
  from public.map_pin_positions p
  order by p.sort_order;
end;
$$;
revoke all on function public.admin_save_map_pin_positions(jsonb) from public, anon, authenticated;
grant execute on function public.admin_save_map_pin_positions(jsonb) to authenticated;

commit;
