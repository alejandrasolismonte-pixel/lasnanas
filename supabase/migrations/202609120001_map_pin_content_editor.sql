-- Las Ñañas · contenido, alta y retiro reversible de pines territoriales.
-- Se aplica después de 202609110001_map_pin_editor.sql.
begin;

alter table public.map_pin_positions add column if not exists category text;
alter table public.map_pin_positions add column if not exists title text;
alter table public.map_pin_positions add column if not exists description text;
alter table public.map_pin_positions add column if not exists symbol text;
alter table public.map_pin_positions add column if not exists is_active boolean;
alter table public.map_pin_positions add column if not exists is_builtin boolean;
alter table public.map_pin_positions add column if not exists created_at timestamptz;

update public.map_pin_positions
set
  category = case when pin_id like 'nanas-%' then 'nanas' else 'experiences' end,
  title = case pin_id
    when 'nanas-temuco' then 'Las Ñañas · Temuco'
    when 'nanas-renaico' then 'Las Ñañas · Renaico'
    when 'nanas-sector-estero' then 'Las Ñañas · Sector Estero'
    when 'nanas-sector-fogon' then 'Las Ñañas · Sector Fogón'
    when 'nanas-padre-las-casas' then 'Las Ñañas · Padre Las Casas'
    when 'nanas-villarrica' then 'Las Ñañas · Villarrica'
    when 'nanas-lago-budi' then 'Las Ñañas · Lago Budi'
    when 'experiencia-rukas' then 'Rukas'
    when 'experiencia-flora-fauna' then 'Flora y fauna'
    when 'experiencia-observatorio' then 'Observatorio intercultural'
    when 'experiencia-faros' then 'Faros agroecológicos'
    else coalesce(title, 'Punto territorial')
  end,
  description = case pin_id
    when 'nanas-temuco' then 'Conexiones, redes y actividades en Temuco.'
    when 'nanas-renaico' then 'Nodo territorial referencial en Renaico.'
    when 'nanas-sector-estero' then 'Nodo territorial referencial junto al estero y las huertas.'
    when 'nanas-sector-fogon' then 'Nodo territorial referencial junto a las plantas medicinales y el fogón.'
    when 'nanas-padre-las-casas' then 'Nodo territorial referencial en Padre Las Casas.'
    when 'nanas-villarrica' then 'Encuentros territoriales en Villarrica.'
    when 'nanas-lago-budi' then 'Nodo territorial referencial junto al Lago Budi.'
    when 'experiencia-rukas' then 'Espacios de encuentro, abrigo y transmisión de saberes.'
    when 'experiencia-flora-fauna' then 'Observación y cuidado de especies nativas.'
    when 'experiencia-observatorio' then 'Mirar el territorio desde saberes diversos.'
    when 'experiencia-faros' then 'Espacios de aprendizaje, experimentación y producción.'
    else coalesce(description, 'Punto vinculado con el territorio.')
  end,
  symbol = case pin_id
    when 'experiencia-rukas' then '⌂'
    when 'experiencia-flora-fauna' then '❋'
    when 'experiencia-observatorio' then '◉'
    when 'experiencia-faros' then '♧'
    else '✦'
  end,
  is_active = coalesce(is_active, true),
  is_builtin = coalesce(is_builtin, true),
  created_at = coalesce(created_at, now())
where title is null or description is null or category is null or symbol is null
   or is_active is null or is_builtin is null or created_at is null;

alter table public.map_pin_positions alter column category set not null;
alter table public.map_pin_positions alter column title set not null;
alter table public.map_pin_positions alter column description set not null;
alter table public.map_pin_positions alter column symbol set not null;
alter table public.map_pin_positions alter column is_active set default true;
alter table public.map_pin_positions alter column is_active set not null;
alter table public.map_pin_positions alter column is_builtin set default false;
alter table public.map_pin_positions alter column is_builtin set not null;
alter table public.map_pin_positions alter column created_at set default now();
alter table public.map_pin_positions alter column created_at set not null;

do $$ begin
  alter table public.map_pin_positions add constraint map_pin_category_valid check (category in ('nanas', 'experiences'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.map_pin_positions add constraint map_pin_title_length check (char_length(btrim(title)) between 2 and 80);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.map_pin_positions add constraint map_pin_description_length check (char_length(btrim(description)) between 2 and 280);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.map_pin_positions add constraint map_pin_symbol_length check (char_length(symbol) between 1 and 4);
exception when duplicate_object then null; end $$;

-- Cambia la respuesta pública: solo entrega pines visibles y todo el contenido necesario.
drop function if exists public.get_map_pin_positions();
create function public.get_map_pin_positions()
returns table (
  pin_id text, category text, title text, description text, symbol text,
  x numeric, y numeric, mobile_x numeric, mobile_y numeric
)
language sql stable security definer set search_path = ''
as $$
  select p.pin_id, p.category, p.title, p.description, p.symbol,
         p.x, p.y, p.mobile_x, p.mobile_y
  from public.map_pin_positions p
  where p.is_active
  order by p.sort_order
$$;
revoke all on function public.get_map_pin_positions() from public;
grant execute on function public.get_map_pin_positions() to anon, authenticated;

-- La administración recibe también los retirados y las posiciones originales.
drop function if exists public.admin_get_map_pin_positions();
create function public.admin_get_map_pin_positions()
returns table (
  pin_id text, category text, title text, description text, symbol text, is_active boolean, is_builtin boolean,
  x numeric, y numeric, mobile_x numeric, mobile_y numeric,
  default_x numeric, default_y numeric, default_mobile_x numeric, default_mobile_y numeric
)
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
  select p.pin_id, p.category, p.title, p.description, p.symbol, p.is_active, p.is_builtin,
         p.x, p.y, p.mobile_x, p.mobile_y,
         p.default_x, p.default_y, p.default_mobile_x, p.default_mobile_y
  from public.map_pin_positions p
  order by p.sort_order;
end;
$$;
revoke all on function public.admin_get_map_pin_positions() from public, anon, authenticated;
grant execute on function public.admin_get_map_pin_positions() to authenticated;

create or replace function public.admin_create_map_pin(
  p_category text, p_title text, p_description text,
  p_x numeric, p_y numeric, p_mobile_x numeric, p_mobile_y numeric
)
returns table (
  pin_id text, category text, title text, description text, symbol text, is_active boolean, is_builtin boolean,
  x numeric, y numeric, mobile_x numeric, mobile_y numeric,
  default_x numeric, default_y numeric, default_mobile_x numeric, default_mobile_y numeric
)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_id text := 'pin-' || replace(gen_random_uuid()::text, '-', '');
  v_order smallint;
begin
  if auth.uid() is null or not exists (
    select 1 from public.staff_roles r
    where r.user_id = auth.uid() and r.role = 'admin'::public.volunteer_role and r.revoked_at is null
  ) then raise exception 'admin_access_required' using errcode = '42501'; end if;
  if p_category not in ('nanas', 'experiences') then raise exception 'invalid_pin_category' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 2 and 80 then raise exception 'invalid_pin_title' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_description, ''))) not between 2 and 280 then raise exception 'invalid_pin_description' using errcode = '22023'; end if;
  if p_x not between 0 and 100 or p_y not between 0 and 100
    or p_mobile_x not between 0 and 100 or p_mobile_y not between 0 and 100 then
    raise exception 'pin_position_out_of_range' using errcode = '22023';
  end if;

  lock table public.map_pin_positions in share row exclusive mode;
  select (coalesce(max(p.sort_order), 0) + 1)::smallint into v_order from public.map_pin_positions p;
  if v_order > 100 then raise exception 'map_pin_limit_reached' using errcode = '22023'; end if;

  insert into public.map_pin_positions (
    pin_id, sort_order, category, title, description, symbol, is_active, is_builtin,
    x, y, mobile_x, mobile_y, default_x, default_y, default_mobile_x, default_mobile_y, updated_by
  ) values (
    v_id, v_order, p_category, btrim(p_title), btrim(p_description),
    case when p_category = 'nanas' then '✦' else '❋' end, true, false,
    round(p_x, 2), round(p_y, 2), round(p_mobile_x, 2), round(p_mobile_y, 2),
    round(p_x, 2), round(p_y, 2), round(p_mobile_x, 2), round(p_mobile_y, 2), auth.uid()
  );

  return query select p.pin_id, p.category, p.title, p.description, p.symbol, p.is_active, p.is_builtin,
    p.x, p.y, p.mobile_x, p.mobile_y, p.default_x, p.default_y, p.default_mobile_x, p.default_mobile_y
    from public.map_pin_positions p where p.pin_id = v_id;
end;
$$;
revoke all on function public.admin_create_map_pin(text,text,text,numeric,numeric,numeric,numeric) from public, anon, authenticated;
grant execute on function public.admin_create_map_pin(text,text,text,numeric,numeric,numeric,numeric) to authenticated;

create or replace function public.admin_update_map_pin(
  p_pin_id text, p_category text, p_title text, p_description text
)
returns table (pin_id text, category text, title text, description text, symbol text, is_active boolean)
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.staff_roles r
    where r.user_id = auth.uid() and r.role = 'admin'::public.volunteer_role and r.revoked_at is null
  ) then raise exception 'admin_access_required' using errcode = '42501'; end if;
  if p_category not in ('nanas', 'experiences') then raise exception 'invalid_pin_category' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 2 and 80 then raise exception 'invalid_pin_title' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_description, ''))) not between 2 and 280 then raise exception 'invalid_pin_description' using errcode = '22023'; end if;

  update public.map_pin_positions p
  set category = p_category, title = btrim(p_title), description = btrim(p_description),
      symbol = case when p_category = 'nanas' then '✦' else '❋' end,
      updated_by = auth.uid(), updated_at = now()
  where p.pin_id = p_pin_id;
  if not found then raise exception 'unknown_pin_id' using errcode = '22023'; end if;

  return query select p.pin_id, p.category, p.title, p.description, p.symbol, p.is_active
    from public.map_pin_positions p where p.pin_id = p_pin_id;
end;
$$;
revoke all on function public.admin_update_map_pin(text,text,text,text) from public, anon, authenticated;
grant execute on function public.admin_update_map_pin(text,text,text,text) to authenticated;

create or replace function public.admin_set_map_pin_active(p_pin_id text, p_active boolean)
returns table (pin_id text, category text, title text, description text, symbol text, is_active boolean)
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.staff_roles r
    where r.user_id = auth.uid() and r.role = 'admin'::public.volunteer_role and r.revoked_at is null
  ) then raise exception 'admin_access_required' using errcode = '42501'; end if;
  if p_active is null then raise exception 'active_state_required' using errcode = '22023'; end if;

  update public.map_pin_positions p
  set is_active = p_active, updated_by = auth.uid(), updated_at = now()
  where p.pin_id = p_pin_id;
  if not found then raise exception 'unknown_pin_id' using errcode = '22023'; end if;

  return query select p.pin_id, p.category, p.title, p.description, p.symbol, p.is_active
    from public.map_pin_positions p where p.pin_id = p_pin_id;
end;
$$;
revoke all on function public.admin_set_map_pin_active(text,boolean) from public, anon, authenticated;
grant execute on function public.admin_set_map_pin_active(text,boolean) to authenticated;

commit;
