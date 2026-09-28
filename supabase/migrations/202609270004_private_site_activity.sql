-- Las Ñañas · actividad y salud privadas. No cambia los flujos de voluntariado.
-- Aplicar primero en un proyecto de prueba, después de las migraciones existentes.
-- No programa tareas ni integra WhatsApp, geolocalización o servicios externos.
begin;

create table public.site_activity_visitors (
  visitor_id uuid primary key,
  first_seen_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz not null default clock_timestamp(),
  check (last_seen_at >= first_seen_at)
);

create table public.site_activity_events (
  event_id uuid primary key,
  visitor_id uuid not null references public.site_activity_visitors(visitor_id) on delete restrict,
  visit_id uuid not null,
  event_type text not null check (event_type in ('page_view', 'registration_started')),
  path text not null check (path in (
    '/', '/desarrollo.html', '/pages/voluntariado.html',
    '/pages/servicios.html', '/pages/productos.html', '/pages/nanas.html'
  )),
  country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  load_ms numeric check (load_ms is null or load_ms between 0 and 120000),
  occurred_at timestamptz not null default clock_timestamp(),
  check (event_type <> 'registration_started' or path = '/pages/voluntariado.html')
);
create index site_activity_events_period on public.site_activity_events(occurred_at);
create index site_activity_events_visitor_period on public.site_activity_events(visitor_id, occurred_at);
create index site_activity_events_page_visits on public.site_activity_events(occurred_at, visit_id)
  where event_type = 'page_view';

create table public.site_health_checks (
  id uuid primary key default gen_random_uuid(),
  checked_at timestamptz not null default clock_timestamp(),
  online boolean not null,
  latency_ms numeric check (latency_ms is null or latency_ms between 0 and 120000)
);
create index site_health_checks_latest on public.site_health_checks(checked_at desc);

create table public.site_activity_daily_summaries (
  summary_date date primary key,
  generated_at timestamptz not null default clock_timestamp(),
  metrics jsonb not null check (jsonb_typeof(metrics) = 'object'),
  message text not null check (char_length(message) between 1 and 10000)
);

create or replace function public.is_site_activity_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.staff_roles sr
    where sr.user_id = auth.uid()
      and sr.role = 'admin'::public.volunteer_role
      and sr.revoked_at is null
  )
$$;
revoke all on function public.is_site_activity_admin() from public, anon, authenticated, service_role;
grant execute on function public.is_site_activity_admin() to authenticated;

alter table public.site_activity_visitors enable row level security;
alter table public.site_activity_visitors force row level security;
alter table public.site_activity_events enable row level security;
alter table public.site_activity_events force row level security;
alter table public.site_health_checks enable row level security;
alter table public.site_health_checks force row level security;
alter table public.site_activity_daily_summaries enable row level security;
alter table public.site_activity_daily_summaries force row level security;

-- Segunda barrera: aun si se concediera SELECT accidentalmente, solo leería admin.
create policy site_activity_visitors_admin_read on public.site_activity_visitors
  for select to authenticated using (public.is_site_activity_admin());
create policy site_activity_events_admin_read on public.site_activity_events
  for select to authenticated using (public.is_site_activity_admin());
create policy site_health_checks_admin_read on public.site_health_checks
  for select to authenticated using (public.is_site_activity_admin());
create policy site_activity_daily_summaries_admin_read on public.site_activity_daily_summaries
  for select to authenticated using (public.is_site_activity_admin());

-- Ni siquiera el navegador administrador consulta filas: recibe agregados por RPC.
-- Las funciones SECURITY DEFINER acceden como su propietario (postgres en Supabase).
revoke all on public.site_activity_visitors, public.site_activity_events,
  public.site_health_checks, public.site_activity_daily_summaries
  from public, anon, authenticated, service_role;

create or replace function public.record_site_activity_event(
  p_event_id uuid,
  p_visitor_id uuid,
  p_visit_id uuid,
  p_event_type text,
  p_path text,
  p_country_code text default null,
  p_load_ms numeric default null
)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  v_path text;
  v_country_code text := nullif(upper(btrim(p_country_code)), '');
  v_now timestamptz;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'site_activity_service_required' using errcode = '42501';
  end if;
  if p_event_id is null or p_visitor_id is null or p_visit_id is null
    or p_event_type is null or p_event_type not in ('page_view', 'registration_started')
    or p_path is null or p_path not in (
      '/', '/index.html', '/desarrollo.html', '/pages/voluntariado.html',
      '/pages/servicios.html', '/pages/productos.html', '/pages/nanas.html'
    )
    or (p_event_type = 'registration_started' and p_path <> '/pages/voluntariado.html')
    or (v_country_code is not null and v_country_code !~ '^[A-Z]{2}$')
    or (p_load_ms is not null and not (p_load_ms between 0 and 120000)) then
    raise exception 'invalid_site_activity_event' using errcode = '22023';
  end if;
  v_path := case when p_path = '/index.html' then '/' else p_path end;

  -- El lock del evento hace idempotentes también los reintentos concurrentes.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('lasnanas:site-activity:event:' || p_event_id::text, 0)
  );
  if exists (select 1 from public.site_activity_events e where e.event_id = p_event_id) then
    return true;
  end if;
  -- Serializar por visitante evita que varias pestañas eludan el límite.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('lasnanas:site-activity:visitor:' || p_visitor_id::text, 0)
  );
  v_now := clock_timestamp();
  if (select count(*) from public.site_activity_events e
      where e.visitor_id = p_visitor_id and e.occurred_at >= v_now - interval '1 minute') >= 90 then
    raise exception 'site_activity_rate_limit' using errcode = '54000';
  end if;

  insert into public.site_activity_visitors(visitor_id, first_seen_at, last_seen_at)
    values (p_visitor_id, v_now, v_now) on conflict (visitor_id) do nothing;
  insert into public.site_activity_events(
    event_id, visitor_id, visit_id, event_type, path, country_code, load_ms, occurred_at
  ) values (p_event_id, p_visitor_id, p_visit_id, p_event_type, v_path, v_country_code, p_load_ms, v_now);
  update public.site_activity_visitors set last_seen_at = greatest(last_seen_at, v_now)
    where visitor_id = p_visitor_id;
  return true;
end;
$$;
revoke all on function public.record_site_activity_event(uuid,uuid,uuid,text,text,text,numeric)
  from public, anon, authenticated, service_role;
grant execute on function public.record_site_activity_event(uuid,uuid,uuid,text,text,text,numeric)
  to service_role;

create or replace function public.admin_record_site_health(
  p_online boolean,
  p_latency_ms numeric default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_checked_at timestamptz;
begin
  if not public.is_site_activity_admin() then
    raise exception 'admin_access_required' using errcode = '42501';
  end if;
  if p_online is null or (p_latency_ms is not null and not (p_latency_ms between 0 and 120000)) then
    raise exception 'invalid_site_health_check' using errcode = '22023';
  end if;
  v_checked_at := clock_timestamp();
  insert into public.site_health_checks(checked_at, online, latency_ms)
    values (v_checked_at, p_online, p_latency_ms);
  return jsonb_build_object('checked_at', v_checked_at, 'online', p_online, 'latency_ms', p_latency_ms);
end;
$$;
revoke all on function public.admin_record_site_health(boolean,numeric)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_record_site_health(boolean,numeric) to authenticated;

-- Motor compartido: no existe EXECUTE directo para el frontend.
-- Los wrappers admin invocan este motor con una identidad admin ya comprobada.
create or replace function public.site_activity_metrics(
  p_start timestamptz,
  p_end timestamptz,
  p_days integer
)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_day date;
  v_today_start timestamptz;
  v_seven_start timestamptz;
  v_thirty_start timestamptz;
  v_result jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_site_activity_admin() then
    raise exception 'admin_access_required' using errcode = '42501';
  end if;
  if p_start is null or p_end is null or p_start >= p_end
    or not isfinite(p_start) or not isfinite(p_end)
    or p_days is null or p_days not in (1, 7, 30) then
    raise exception 'invalid_site_activity_period' using errcode = '22023';
  end if;
  -- El extremo final es exclusivo. En un resumen cerrado, hoy es su fecha.
  v_day := ((p_end - interval '1 microsecond') at time zone 'America/Santiago')::date;
  v_today_start := v_day::timestamp at time zone 'America/Santiago';
  v_seven_start := (v_day - 6)::timestamp at time zone 'America/Santiago';
  v_thirty_start := (v_day - 29)::timestamp at time zone 'America/Santiago';

  with window_events as materialized (
    select e.* from public.site_activity_events e
    where e.occurred_at >= least(v_thirty_start, p_start) and e.occurred_at < p_end
  ), selected_pages as materialized (
    select e.* from window_events e
    where e.event_type = 'page_view' and e.occurred_at >= p_start
  ), selected_visitors as (
    select v.visitor_id, v.first_seen_at
    from public.site_activity_visitors v
    join (select distinct e.visitor_id from selected_pages e) s on s.visitor_id = v.visitor_id
  ), visit_countries as (
    -- Una sesión puede tener páginas sin país o cambiar de red. Elegir una sola
    -- ubicación conocida evita contabilizar esa visita en varios países.
    select distinct on (e.visit_id) e.visit_id, e.country_code
    from selected_pages e
    order by e.visit_id, (e.country_code is null), e.occurred_at, e.event_id
  ), countries as (
    select c.country_code, count(*) as visits
    from visit_countries c group by c.country_code
    order by visits desc, c.country_code nulls last limit 5
  ), pages as (
    select e.path, count(*) as views
    from selected_pages e group by e.path
    order by views desc, e.path limit 5
  )
  select jsonb_build_object(
    'updated_at', clock_timestamp(),
    'timezone', 'America/Santiago',
    'period', jsonb_build_object('days', p_days, 'starts_at', p_start, 'ends_at', p_end),
    'visits', (
      select jsonb_build_object(
        'today', count(distinct e.visit_id) filter (where e.occurred_at >= v_today_start),
        'last7', count(distinct e.visit_id) filter (where e.occurred_at >= v_seven_start),
        'last30', count(distinct e.visit_id) filter (where e.occurred_at >= v_thirty_start),
        'selected', count(distinct e.visit_id) filter (where e.occurred_at >= p_start)
      ) from window_events e where e.event_type = 'page_view'
    ),
    'unique_visitors', (select count(*) from selected_visitors),
    'new_visitors', (select count(*) from selected_visitors v where v.first_seen_at >= p_start),
    'returning_visitors', (select count(*) from selected_visitors v where v.first_seen_at < p_start),
    'volunteer_visits', (select count(distinct e.visit_id) from selected_pages e where e.path = '/pages/voluntariado.html'),
    'registration_starts', (
      select count(distinct e.visitor_id) from window_events e
      where e.event_type = 'registration_started' and e.occurred_at >= p_start
    ),
    -- submitted_at conserva el envío aunque la solicitud se apruebe o retire.
    'applications_submitted', (
      select count(*) from public.membership_applications a
      where a.submitted_at >= p_start and a.submitted_at < p_end
    ),
    'top_countries', coalesce((
      select jsonb_agg(jsonb_build_object('country_code', c.country_code, 'visits', c.visits)
        order by c.visits desc, c.country_code nulls last) from countries c
    ), '[]'::jsonb),
    'top_pages', coalesce((
      select jsonb_agg(jsonb_build_object('path', p.path, 'views', p.views)
        order by p.views desc, p.path) from pages p
    ), '[]'::jsonb),
    'performance', (
      select jsonb_build_object('avg_load_ms', round(avg(e.load_ms), 0), 'samples', count(e.load_ms))
      from selected_pages e
    ),
    'health', (
      select jsonb_build_object('checked_at', h.checked_at, 'online', h.online, 'latency_ms', h.latency_ms)
      from public.site_health_checks h where h.checked_at <= p_end
      order by h.checked_at desc, h.id desc limit 1
    ),
    'tracking_started_at', (
      select min(v.first_seen_at) from public.site_activity_visitors v where v.first_seen_at < p_end
    )
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.site_activity_metrics(timestamptz,timestamptz,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.site_activity_metrics(timestamptz,timestamptz,integer) to service_role;

create or replace function public.admin_get_site_activity(p_days integer default 7)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_today date := (v_now at time zone 'America/Santiago')::date;
  v_start timestamptz;
begin
  if not public.is_site_activity_admin() then
    raise exception 'admin_access_required' using errcode = '42501';
  end if;
  if p_days is null or p_days not in (1, 7, 30) then
    raise exception 'invalid_site_activity_period' using errcode = '22023';
  end if;
  v_start := (v_today - (p_days - 1))::timestamp at time zone 'America/Santiago';
  return public.site_activity_metrics(v_start, v_now, p_days);
end;
$$;
revoke all on function public.admin_get_site_activity(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_get_site_activity(integer) to authenticated;

-- Sin parámetros mantiene el resumen de ayer completo para el panel existente.
-- cutoff_hour=23 permite cerrar el día a las 23:00 de Chile, una vez llegado el corte.
-- La primera generación prevalece: pedir otro corte de una fecha ya resumida
-- devuelve su snapshot existente, sin regenerar ni producir un segundo reporte.
create or replace function public.generate_daily_site_activity_summary(
  p_date date default ((now() at time zone 'America/Santiago')::date - 1),
  p_cutoff_hour integer default 24
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_summary public.site_activity_daily_summaries%rowtype;
  v_start timestamptz;
  v_end timestamptz;
  v_metrics jsonb;
  v_generated_at timestamptz;
  v_message text;
  v_countries text;
  v_pages text;
  v_health text;
  v_performance text;
  v_tracking_started timestamptz;
  v_coverage text;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_site_activity_admin() then
    raise exception 'admin_access_required' using errcode = '42501';
  end if;
  if p_cutoff_hour is null or p_cutoff_hour not in (23, 24) then
    raise exception 'invalid_summary_cutoff' using errcode = '22023';
  end if;
  if p_date is null or not isfinite(p_date) then
    raise exception 'closed_summary_date_required' using errcode = '22023';
  end if;
  v_start := p_date::timestamp at time zone 'America/Santiago';
  v_end := case when p_cutoff_hour = 24
    then (p_date + 1)::timestamp at time zone 'America/Santiago'
    else (p_date::timestamp + interval '23 hours') at time zone 'America/Santiago'
  end;
  if v_end > clock_timestamp() then
    raise exception 'closed_summary_date_required' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('lasnanas:site-activity:summary:' || to_char(p_date, 'YYYY-MM-DD'), 0)
  );
  select * into v_summary from public.site_activity_daily_summaries s where s.summary_date = p_date;
  if found then
    return jsonb_build_object('summary_date', v_summary.summary_date,
      'generated_at', v_summary.generated_at, 'metrics', v_summary.metrics, 'message', v_summary.message);
  end if;

  v_metrics := public.site_activity_metrics(v_start, v_end, 1);
  v_metrics := jsonb_set(v_metrics, '{period,cutoff_hour}', to_jsonb(p_cutoff_hour));
  v_generated_at := clock_timestamp();

  select string_agg(coalesce(c.item->>'country_code', 'Sin determinar') || ': ' || (c.item->>'visits'), ', ' order by c.position)
    into v_countries from jsonb_array_elements(v_metrics->'top_countries') with ordinality as c(item, position);
  select string_agg((p.item->>'path') || ': ' || (p.item->>'views'), ', ' order by p.position)
    into v_pages from jsonb_array_elements(v_metrics->'top_pages') with ordinality as p(item, position);
  if v_metrics->'health' = 'null'::jsonb then
    v_health := 'Sin comprobación disponible';
  else
    v_health := case when (v_metrics#>>'{health,online}')::boolean then 'Online' else 'Offline' end
      || ' (comprobación puntual: '
      || to_char((v_metrics#>>'{health,checked_at}')::timestamptz at time zone 'America/Santiago', 'DD-MM-YYYY HH24:MI')
      || ' hora de Chile'
      || case when v_metrics#>>'{health,latency_ms}' is not null then '; ' || (v_metrics#>>'{health,latency_ms}') || ' ms' else '' end
      || ')';
  end if;
  v_performance := case when (v_metrics#>>'{performance,samples}')::bigint > 0
    then (v_metrics#>>'{performance,avg_load_ms}') || ' ms de carga media (' || (v_metrics#>>'{performance,samples}') || ' muestras)'
    else 'Sin muestras de carga' end;
  v_tracking_started := (v_metrics->>'tracking_started_at')::timestamptz;
  if v_tracking_started is null then
    v_coverage := 'Visitas: aún sin datos de captura; no se puede confirmar el tráfico total.';
  elsif v_tracking_started > v_start then
    v_coverage := 'Captura de visitas disponible desde '
      || to_char(v_tracking_started at time zone 'America/Santiago', 'DD-MM-YYYY HH24:MI')
      || ' hora de Chile; cobertura parcial del período.';
  end if;
  v_message := 'Resumen diario · Las Ñañas' || E'\n'
    || 'Fecha: ' || to_char(p_date, 'DD-MM-YYYY') || ' (00:00–' || p_cutoff_hour::text || ':00, hora de Chile)' || E'\n'
    || 'Visitas registradas: ' || (v_metrics#>>'{visits,today}') || ' hoy · ' || (v_metrics#>>'{visits,last7}') || ' en 7 días · ' || (v_metrics#>>'{visits,last30}') || ' en 30 días' || E'\n'
    || case when v_coverage is not null then v_coverage || E'\n' else '' end
    || 'Visitantes únicos: ' || (v_metrics->>'unique_visitors') || ' · nuevos: ' || (v_metrics->>'new_visitors') || ' · recurrentes: ' || (v_metrics->>'returning_visitors') || E'\n'
    || 'Países principales: ' || coalesce(v_countries, 'Sin visitas registradas') || E'\n'
    || 'Páginas más visitadas: ' || coalesce(v_pages, 'Sin visitas registradas') || E'\n'
    || 'Visitas a Voluntariado: ' || (v_metrics->>'volunteer_visits') || E'\n'
    || 'Registros iniciados: ' || (v_metrics->>'registration_starts') || E'\n'
    || 'Solicitudes enviadas: ' || (v_metrics->>'applications_submitted') || E'\n'
    || 'Sitio: ' || v_health || E'\n'
    || 'Rendimiento: ' || v_performance || E'\n'
    || 'Última actualización: ' || to_char(v_generated_at at time zone 'America/Santiago', 'DD-MM-YYYY HH24:MI') || ' hora de Chile';

  -- Una fecha produce una fila fija. Los reintentos recuperan exactamente esa fila.
  insert into public.site_activity_daily_summaries(summary_date, generated_at, metrics, message)
    values (p_date, v_generated_at, v_metrics, v_message)
    returning * into v_summary;
  return jsonb_build_object('summary_date', v_summary.summary_date,
    'generated_at', v_summary.generated_at, 'metrics', v_summary.metrics, 'message', v_summary.message);
end;
$$;
revoke all on function public.generate_daily_site_activity_summary(date,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.generate_daily_site_activity_summary(date,integer) to authenticated, service_role;

-- Entrada preparada para una futura entrega diaria. No ejecuta envío ni cron.
-- Después de las 23:00 pide hoy hasta las 23:00; antes pide ayer hasta las 23:00,
-- para recuperar el mismo reporte cuando se reintente después de medianoche.
create or replace function public.prepare_site_activity_daily_report()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_local timestamp := v_now at time zone 'America/Santiago';
  v_date date := v_local::date;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'site_activity_service_required' using errcode = '42501';
  end if;
  if v_local::time < time '23:00' then v_date := v_date - 1; end if;
  return public.generate_daily_site_activity_summary(v_date, 23);
end;
$$;
revoke all on function public.prepare_site_activity_daily_report()
  from public, anon, authenticated, service_role;
grant execute on function public.prepare_site_activity_daily_report() to service_role;

-- La migración falla si algún permiso heredado abre las tablas o una RPC privada.
do $$
declare
  v_role text;
  v_table text;
  v_function text;
begin
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    foreach v_table in array array[
      'public.site_activity_visitors', 'public.site_activity_events',
      'public.site_health_checks', 'public.site_activity_daily_summaries'
    ] loop
      if has_table_privilege(v_role, v_table, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
        raise exception 'unexpected_site_activity_table_grant: % %', v_role, v_table;
      end if;
    end loop;
  end loop;
  foreach v_function in array array[
    'public.is_site_activity_admin()',
    'public.record_site_activity_event(uuid,uuid,uuid,text,text,text,numeric)',
    'public.admin_record_site_health(boolean,numeric)',
    'public.site_activity_metrics(timestamptz,timestamptz,integer)',
    'public.admin_get_site_activity(integer)',
    'public.generate_daily_site_activity_summary(date,integer)',
    'public.prepare_site_activity_daily_report()'
  ] loop
    if has_function_privilege('anon', v_function, 'EXECUTE') then
      raise exception 'unexpected_anon_site_activity_function_grant: %', v_function;
    end if;
  end loop;
  if has_function_privilege('authenticated', 'public.record_site_activity_event(uuid,uuid,uuid,text,text,text,numeric)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.site_activity_metrics(timestamptz,timestamptz,integer)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.prepare_site_activity_daily_report()', 'EXECUTE') then
    raise exception 'unexpected_authenticated_site_activity_service_function_grant';
  end if;
end;
$$;

commit;
