-- Las Ñañas · pruebas de los reportes por hitos en PostgreSQL/Supabase.
-- SOLO en un proyecto de PRUEBA, como postgres, después de las migraciones.
-- Exige actividad/cola vacías y configuración inicial deshabilitada; no borra datos.
-- Inserta fixtures y simula el reloj de la cola. No usa Brevo, secretos ni destinatarios.
-- Todo termina en ROLLBACK. Si un assert falla, ejecutar ROLLBACK antes de repetir.
begin;

do $$
declare v_role text; v_table text; v_function text;
begin
  if exists (select 1 from public.site_activity_events)
    or exists (select 1 from public.site_activity_email_reports)
    or exists (select 1 from public.site_activity_daily_summaries where summary_date = (clock_timestamp() at time zone 'America/Santiago')::date)
    or not exists (select 1 from public.site_activity_email_settings where singleton and not enabled and activated_at is null and scan_date is null) then
    raise exception 'FAIL: usar un proyecto de prueba limpio; no se modifica actividad existente';
  end if;
  foreach v_table in array array['public.site_activity_email_settings', 'public.site_activity_email_reports'] loop
    foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
      if has_table_privilege(v_role, v_table, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
        raise exception 'FAIL: permiso directo inesperado % %', v_role, v_table;
      end if;
    end loop;
    if not exists (select 1 from pg_catalog.pg_class c where c.oid = v_table::regclass and c.relrowsecurity and c.relforcerowsecurity)
      or exists (select 1 from pg_catalog.pg_class c
        cross join lateral pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
        where c.oid = v_table::regclass and a.grantee = 0) then
      raise exception 'FAIL: RLS o ACL PUBLIC incorrecto %', v_table;
    end if;
    if (select count(*) from pg_catalog.pg_policy p where p.polrelid = v_table::regclass) <> 1
      or not exists (select 1 from pg_catalog.pg_policy p
        where p.polrelid = v_table::regclass and p.polcmd = 'r'
          and p.polname = split_part(v_table, '.', 2) || '_admin_read'
          and p.polroles = array[(select oid from pg_catalog.pg_roles where rolname = 'authenticated')]::oid[]
          and regexp_replace(pg_catalog.pg_get_expr(p.polqual, p.polrelid), '[[:space:]]', '', 'g') in (
            'is_site_activity_admin()', 'public.is_site_activity_admin()', '(is_site_activity_admin())', '(public.is_site_activity_admin())'
          )) then
      raise exception 'FAIL: segunda barrera admin incorrecta %', v_table;
    end if;
  end loop;
  foreach v_function in array array[
    'public.configure_site_activity_email_reports(boolean)',
    'public.prepare_site_activity_email_reports(integer)',
    'public.prepare_site_activity_email_test()',
    'public.claim_site_activity_email_reports(uuid,integer)',
    'public.mark_site_activity_email_report_sent(uuid,uuid,text)',
    'public.mark_site_activity_email_report_failed(uuid,uuid,text,boolean,boolean)'
  ] loop
    if has_function_privilege('anon', v_function, 'EXECUTE')
      or has_function_privilege('authenticated', v_function, 'EXECUTE')
      or not has_function_privilege('service_role', v_function, 'EXECUTE')
      or not exists (select 1 from pg_catalog.pg_proc p where p.oid = v_function::regprocedure and p.prosecdef
        and exists (select 1 from unnest(p.proconfig) s(setting) where s.setting in ('search_path=', 'search_path=""')))
      or exists (select 1 from pg_catalog.pg_proc p
        cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
        where p.oid = v_function::regprocedure and a.grantee = 0) then
      raise exception 'FAIL: RPC abierta o sin SECURITY DEFINER/search_path vacío %', v_function;
    end if;
  end loop;
  perform set_config('lasnanas.email_test_today', (clock_timestamp() at time zone 'America/Santiago')::date::text, true);
  perform set_config('lasnanas.email_test_visitor', gen_random_uuid()::text, true);
  perform set_config('lasnanas.email_test_worker_a', gen_random_uuid()::text, true);
  perform set_config('lasnanas.email_test_worker_b', gen_random_uuid()::text, true);
  perform set_config('lasnanas.email_test_anchor', greatest(
    (clock_timestamp() at time zone 'America/Santiago')::date::timestamp at time zone 'America/Santiago',
    clock_timestamp() - interval '1 minute'
  )::text, true);
end;
$$;

-- Probar también la comprobación interna aun cuando postgres tiene EXECUTE.
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '', true);
do $$
declare v_sql text;
begin
  foreach v_sql in array array[
    'select public.configure_site_activity_email_reports(false)',
    'select public.prepare_site_activity_email_reports(1)',
    'select public.prepare_site_activity_email_test()',
    'select public.claim_site_activity_email_reports(''00000000-0000-0000-0000-000000000001'',1)',
    'select public.mark_site_activity_email_report_sent(''00000000-0000-0000-0000-000000000001'',''00000000-0000-0000-0000-000000000001'',''fixture'')',
    'select public.mark_site_activity_email_report_failed(''00000000-0000-0000-0000-000000000001'',''00000000-0000-0000-0000-000000000001'',''fixture_error'',false,false)'
  ] loop
    begin execute v_sql; raise exception 'FAIL: guard service_role omitido: %', v_sql;
    exception when insufficient_privilege then null; end;
  end loop;
  raise notice 'OK: guard JWT service_role en las cinco RPC';
end;
$$;

select set_config('request.jwt.claims', '{"role":"anon"}', true);
select set_config('request.jwt.claim.role', 'anon', true);
set local role anon;
do $$
declare v_sql text;
begin
  foreach v_sql in array array[
    'select public.configure_site_activity_email_reports(false)',
    'select public.prepare_site_activity_email_reports(1)',
    'select public.prepare_site_activity_email_test()',
    'select public.claim_site_activity_email_reports(''00000000-0000-0000-0000-000000000001'',1)',
    'select public.mark_site_activity_email_report_sent(''00000000-0000-0000-0000-000000000001'',''00000000-0000-0000-0000-000000000001'',''fixture'')',
    'select public.mark_site_activity_email_report_failed(''00000000-0000-0000-0000-000000000001'',''00000000-0000-0000-0000-000000000001'',''fixture_error'',false,false)',
    'select count(*) from public.site_activity_email_settings',
    'select count(*) from public.site_activity_email_reports'
  ] loop
    begin execute v_sql; raise exception 'FAIL: anon accedió: %', v_sql;
    exception when insufficient_privilege then null; end;
  end loop;
end;
$$;
reset role;

select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
do $$
declare v_sql text;
begin
  foreach v_sql in array array[
    'select public.configure_site_activity_email_reports(false)',
    'select public.prepare_site_activity_email_reports(1)',
    'select public.prepare_site_activity_email_test()',
    'select public.claim_site_activity_email_reports(''00000000-0000-0000-0000-000000000001'',1)',
    'select public.mark_site_activity_email_report_sent(''00000000-0000-0000-0000-000000000001'',''00000000-0000-0000-0000-000000000001'',''fixture'')',
    'select public.mark_site_activity_email_report_failed(''00000000-0000-0000-0000-000000000001'',''00000000-0000-0000-0000-000000000001'',''fixture_error'',false,false)',
    'select count(*) from public.site_activity_email_settings',
    'select count(*) from public.site_activity_email_reports'
  ] loop
    begin execute v_sql; raise exception 'FAIL: authenticated accedió: %', v_sql;
    exception when insufficient_privilege then null; end;
  end loop;
  raise notice 'OK: frontend sin acceso directo a configuración, cola ni RPC';
end;
$$;
reset role;

create temporary table site_activity_test_visits (ordinal integer primary key, visit_id uuid not null default gen_random_uuid()) on commit drop;
insert into site_activity_test_visits(ordinal) select generate_series(1, 250);
-- Un resumen diario preexistente no debe reutilizarse ni modificarse por los hitos.
insert into public.site_activity_daily_summaries(summary_date, metrics, message)
  values (current_setting('lasnanas.email_test_today')::date, '{"sentinel":true}', 'Resumen diario fijo de prueba');
insert into public.site_activity_visitors(visitor_id, first_seen_at, last_seen_at)
  values (current_setting('lasnanas.email_test_visitor')::uuid,
    (current_setting('lasnanas.email_test_today')::date - 10)::timestamp at time zone 'America/Santiago', clock_timestamp());
-- Los mismos visit_id en días distintos cuentan una vez dentro de cada día.
insert into public.site_activity_events(event_id, visitor_id, visit_id, event_type, path, country_code, load_ms, occurred_at)
  select gen_random_uuid(), current_setting('lasnanas.email_test_visitor')::uuid, v.visit_id, 'page_view', '/', 'CL', 100,
    (current_setting('lasnanas.email_test_today')::date - d.days_ago)::timestamp at time zone 'America/Santiago'
      + interval '12 hours' + v.ordinal * interval '1 microsecond'
  from site_activity_test_visits v cross join (values (1), (10)) d(days_ago) where v.ordinal <= 100;
insert into public.site_activity_events(event_id, visitor_id, visit_id, event_type, path, country_code, load_ms, occurred_at)
  select gen_random_uuid(), current_setting('lasnanas.email_test_visitor')::uuid, v.visit_id, 'page_view', '/', 'CL', 100,
    current_setting('lasnanas.email_test_anchor')::timestamptz + v.ordinal * interval '1 microsecond'
  from site_activity_test_visits v where v.ordinal <= 99;
insert into public.site_activity_events(event_id, visitor_id, visit_id, event_type, path, occurred_at)
  select gen_random_uuid(), current_setting('lasnanas.email_test_visitor')::uuid, v.visit_id, 'page_view', '/pages/voluntariado.html',
    current_setting('lasnanas.email_test_anchor')::timestamptz + (v.ordinal + 1000) * interval '1 microsecond'
  from site_activity_test_visits v where v.ordinal <= 99;
insert into public.site_activity_events(event_id, visitor_id, visit_id, event_type, path, occurred_at)
  values (gen_random_uuid(), current_setting('lasnanas.email_test_visitor')::uuid, gen_random_uuid(), 'registration_started', '/pages/voluntariado.html',
    current_setting('lasnanas.email_test_anchor')::timestamptz + interval '50 microseconds');

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
do $$
declare v_settings jsonb; v_sql text;
begin
  if public.prepare_site_activity_email_reports() <> 0
    or exists (select 1 from public.claim_site_activity_email_reports(current_setting('lasnanas.email_test_worker_a')::uuid)) then
    raise exception 'FAIL: configuración inicial deshabilitada genera o reclama';
  end if;
  v_settings := public.configure_site_activity_email_reports(true);
  if not (v_settings->>'enabled')::boolean
    or (v_settings->>'scan_date')::date <> current_setting('lasnanas.email_test_today')::date
    or (v_settings->>'activated_at')::timestamptz is null
    or public.configure_site_activity_email_reports(true) <> v_settings then
    raise exception 'FAIL: activación Chile o configuración idempotente incorrecta';
  end if;
  if public.prepare_site_activity_email_reports() <> 0 then
    raise exception 'FAIL: 198 páginas/99 visitas o registro_started activaron hito100';
  end if;
  foreach v_sql in array array[
    'select public.configure_site_activity_email_reports(null)',
    'select public.prepare_site_activity_email_reports(0)',
    'select public.prepare_site_activity_email_reports(21)',
    'select public.claim_site_activity_email_reports(''00000000-0000-0000-0000-000000000001'',6)',
    'select public.claim_site_activity_email_reports(null,1)',
    'select public.mark_site_activity_email_report_failed(''00000000-0000-0000-0000-000000000001'',''00000000-0000-0000-0000-000000000001'',''raw@email.invalid'',true,true)',
    'select public.mark_site_activity_email_report_sent(''00000000-0000-0000-0000-000000000001'',''00000000-0000-0000-0000-000000000001'',E''unsafe\nvalue'')'
  ] loop
    begin execute v_sql; raise exception 'FAIL: parámetro inválido aceptado: %', v_sql;
    exception when invalid_parameter_value then null; end;
  end loop;
end;
$$;
reset role;

insert into public.site_activity_events(event_id, visitor_id, visit_id, event_type, path, occurred_at)
  select gen_random_uuid(), current_setting('lasnanas.email_test_visitor')::uuid, v.visit_id, 'page_view', '/',
    current_setting('lasnanas.email_test_anchor')::timestamptz + v.ordinal * interval '1 microsecond'
  from site_activity_test_visits v where v.ordinal = 100;
set local role service_role;
do $$ begin
  if public.prepare_site_activity_email_reports(1) <> 1 or public.prepare_site_activity_email_reports() <> 0 then
    raise exception 'FAIL: hito100 no se crea exactamente una vez';
  end if;
end; $$;
reset role;
do $$
declare v_report public.site_activity_email_reports%rowtype;
begin
  select * into strict v_report from public.site_activity_email_reports;
  if v_report.report_date <> current_setting('lasnanas.email_test_today')::date or v_report.milestone <> 100
    or (v_report.metrics#>>'{visits,selected}')::bigint <> 100
    or (v_report.metrics->>'unique_visitors')::bigint <> 1
    or (v_report.metrics#>>'{period,starts_at}')::timestamptz <>
      current_setting('lasnanas.email_test_today')::date::timestamp at time zone 'America/Santiago'
    or (v_report.metrics#>>'{period,ends_at}')::timestamptz <> v_report.reached_at + interval '1 microsecond' then
    raise exception 'FAIL: snapshot intradía, sesiones distintas o exclusión histórica incorrectos';
  end if;
  perform set_config('lasnanas.email_test_report100', v_report.id::text, true);
  perform set_config('lasnanas.email_test_metrics100', v_report.metrics::text, true);
end;
$$;
insert into public.site_activity_events(event_id, visitor_id, visit_id, event_type, path, occurred_at)
  select gen_random_uuid(), current_setting('lasnanas.email_test_visitor')::uuid, v.visit_id, 'page_view', '/',
    current_setting('lasnanas.email_test_anchor')::timestamptz + v.ordinal * interval '1 microsecond'
  from site_activity_test_visits v where v.ordinal between 101 and 250;
set local role service_role;
do $$ begin
  if public.prepare_site_activity_email_reports(1) <> 1 or public.prepare_site_activity_email_reports() <> 0 then
    raise exception 'FAIL: hito200 o reintento idempotente incorrectos';
  end if;
end; $$;
reset role;
do $$ begin
  if (select metrics from public.site_activity_email_reports where milestone = 100) <> current_setting('lasnanas.email_test_metrics100')::jsonb
    or (select (metrics#>>'{visits,selected}')::bigint from public.site_activity_email_reports where milestone = 200) <> 200
    or (select count(*) from public.site_activity_email_reports) <> 2 then
    raise exception 'FAIL: snapshot100 cambiado, hito200 incorrecto o reportes antes de activación';
  end if;
  perform set_config('lasnanas.email_test_report200', (select id::text from public.site_activity_email_reports where milestone = 200), true);
  raise notice 'OK: 100/200 visitas, múltiples páginas, snapshots separados e idempotencia';
end; $$;

-- Simular una instalación activada hace nueve días para probar cursor/atraso.
update public.site_activity_email_settings set
  activated_at = (current_setting('lasnanas.email_test_today')::date - 9)::timestamp at time zone 'America/Santiago',
  scan_date = current_setting('lasnanas.email_test_today')::date - 9;
insert into public.site_activity_events(event_id, visitor_id, visit_id, event_type, path, occurred_at)
  select gen_random_uuid(), current_setting('lasnanas.email_test_visitor')::uuid, v.visit_id, 'page_view', '/',
    (current_setting('lasnanas.email_test_today')::date - 9)::timestamp at time zone 'America/Santiago'
      + interval '12 hours' + v.ordinal * interval '1 microsecond'
  from site_activity_test_visits v where v.ordinal <= 200;
set local role service_role;
do $$ begin
  if public.prepare_site_activity_email_reports(1) <> 1 then raise exception 'FAIL: primer hito atrasado ausente'; end if;
end; $$;
reset role;
do $$ begin
  if (select scan_date from public.site_activity_email_settings) <> current_setting('lasnanas.email_test_today')::date - 9 then
    raise exception 'FAIL: cursor pasó un día que todavía tenía hito200 pendiente';
  end if;
end; $$;
set local role service_role;
do $$ begin
  if public.prepare_site_activity_email_reports(20) <> 1 then raise exception 'FAIL: segundo hito atrasado ausente'; end if;
end; $$;
reset role;
do $$ begin
  if (select scan_date from public.site_activity_email_settings) <> current_setting('lasnanas.email_test_today')::date - 2 then
    raise exception 'FAIL: escaneo excedió/no completó siete fechas por llamada';
  end if;
end; $$;
set local role service_role;
do $$ begin
  if public.prepare_site_activity_email_reports(20) <> 1 or public.prepare_site_activity_email_reports() <> 0 then
    raise exception 'FAIL: reinicio por fecha o recuperación del cursor incorrectos';
  end if;
  perform public.configure_site_activity_email_reports(false);
  if public.prepare_site_activity_email_reports() <> 0
    or exists (select 1 from public.claim_site_activity_email_reports(current_setting('lasnanas.email_test_worker_a')::uuid)) then
    raise exception 'FAIL: disabled prepara/reclama trabajo';
  end if;
  if (public.configure_site_activity_email_reports(true)->>'scan_date')::date <> current_setting('lasnanas.email_test_today')::date then
    raise exception 'FAIL: reactivación no comienza en la fecha actual de Chile';
  end if;
end; $$;
reset role;
do $$ begin
  if (select count(*) from public.site_activity_email_reports where report_date = current_setting('lasnanas.email_test_today')::date - 1 and milestone = 100) <> 1
    or exists (select 1 from public.site_activity_email_reports where report_date = current_setting('lasnanas.email_test_today')::date - 10)
    or (select count(*) from public.site_activity_email_reports) <> 5 then
    raise exception 'FAIL: sesiones compartidas entre días, históricos o unicidad por fecha incorrectos';
  end if;
  raise notice 'OK: medianoche Chile, cursor siete días, límite y reactivación sin retroenvíos';
end; $$;

set local role service_role;
do $$
declare v_report public.site_activity_email_reports%rowtype; v_count integer := 0;
  v_a uuid := current_setting('lasnanas.email_test_worker_a')::uuid;
  v_b uuid := current_setting('lasnanas.email_test_worker_b')::uuid;
begin
  for v_report in select * from public.claim_site_activity_email_reports(v_a, 5) loop
    v_count := v_count + 1;
    if v_report.report_date <> current_setting('lasnanas.email_test_today')::date or v_report.attempts <> 1
      or v_report.status <> 'processing' or v_report.worker_id <> v_a
      or v_report.locked_until - v_report.first_attempt_at <> interval '4 minutes' then
      raise exception 'FAIL: claim, lease o filtro de activación incorrectos';
    end if;
    if v_report.milestone = 200 then perform set_config('lasnanas.email_test_first_attempt200', v_report.first_attempt_at::text, true); end if;
  end loop;
  if v_count <> 2 or exists (select 1 from public.claim_site_activity_email_reports(v_b)) then
    raise exception 'FAIL: trabajo reclamado simultáneamente o reportes históricos enviados';
  end if;
  if public.mark_site_activity_email_report_sent(current_setting('lasnanas.email_test_report100')::uuid, v_b, 'fixture-provider-id')
    or public.mark_site_activity_email_report_failed(current_setting('lasnanas.email_test_report200')::uuid, v_b, 'brevo_429', true, false) then
    raise exception 'FAIL: un worker ajeno confirmó/falló el trabajo';
  end if;
  perform public.configure_site_activity_email_reports(false);
  if not public.mark_site_activity_email_report_sent(current_setting('lasnanas.email_test_report100')::uuid, v_a, 'fixture-provider-id')
    or public.mark_site_activity_email_report_sent(current_setting('lasnanas.email_test_report100')::uuid, v_a, 'fixture-provider-id')
    or not public.mark_site_activity_email_report_failed(current_setting('lasnanas.email_test_report200')::uuid, v_a, 'brevo_429', true, false)
    or exists (select 1 from public.claim_site_activity_email_reports(v_b)) then
    raise exception 'FAIL: acks del intento en curso o pausa del envío incorrectos';
  end if;
  perform public.configure_site_activity_email_reports(true);
end;
$$;
reset role;
do $$ begin
  if not exists (select 1 from public.site_activity_email_reports where id = current_setting('lasnanas.email_test_report200')::uuid
    and status = 'pending' and attempts = 1 and next_attempt_at > clock_timestamp() and next_attempt_at <= clock_timestamp() + interval '1 minute') then
    raise exception 'FAIL: reintento no queda pendiente con espera de un minuto';
  end if;
end; $$;
update public.site_activity_email_reports set next_attempt_at = clock_timestamp() - interval '1 second'
  where id = current_setting('lasnanas.email_test_report200')::uuid;
set local role service_role;
do $$
declare v_report public.site_activity_email_reports%rowtype;
begin
  select * into strict v_report from public.claim_site_activity_email_reports(current_setting('lasnanas.email_test_worker_b')::uuid, 1);
  if v_report.id <> current_setting('lasnanas.email_test_report200')::uuid or v_report.attempts <> 2
    or v_report.first_attempt_at <> current_setting('lasnanas.email_test_first_attempt200')::timestamptz then
    raise exception 'FAIL: reintento cambió UUID/first_attempt_at o contador';
  end if;
  if not public.mark_site_activity_email_report_failed(v_report.id, v_report.worker_id, 'network_timeout', true, true) then
    raise exception 'FAIL: no se guardó resultado ambiguo';
  end if;
end; $$;
reset role;
update public.site_activity_email_reports set next_attempt_at = clock_timestamp() - interval '1 second'
  where id = current_setting('lasnanas.email_test_report200')::uuid;
set local role service_role;
do $$
declare v_report public.site_activity_email_reports%rowtype;
begin
  select * into strict v_report from public.claim_site_activity_email_reports(current_setting('lasnanas.email_test_worker_a')::uuid, 1);
  if v_report.id <> current_setting('lasnanas.email_test_report200')::uuid or v_report.attempts <> 3 or not v_report.delivery_uncertain then
    raise exception 'FAIL: tercero cambió UUID o perdió ambigüedad';
  end if;
  if not public.mark_site_activity_email_report_failed(v_report.id, v_report.worker_id, 'brevo_503', true, false)
    or exists (select 1 from public.claim_site_activity_email_reports(current_setting('lasnanas.email_test_worker_b')::uuid)) then
    raise exception 'FAIL: se permitió cuarto intento';
  end if;
end; $$;
reset role;

-- Fixtures de estados de cola; no son eventos de captura ni generan envíos externos.
insert into public.site_activity_email_reports(report_date, milestone, reached_at, metrics)
  values (current_setting('lasnanas.email_test_today')::date, 300, current_setting('lasnanas.email_test_anchor')::timestamptz, '{"fixture":true}');
set local role service_role;
do $$
declare v_report public.site_activity_email_reports%rowtype;
begin
  select * into strict v_report from public.claim_site_activity_email_reports(current_setting('lasnanas.email_test_worker_a')::uuid, 1);
  if v_report.milestone <> 300 or not public.mark_site_activity_email_report_failed(v_report.id, v_report.worker_id, 'brevo_400', false, false) then
    raise exception 'FAIL: error permanente no reconocido';
  end if;
end; $$;
reset role;
insert into public.site_activity_email_reports(report_date, milestone, reached_at, metrics, status, attempts, first_attempt_at, worker_id, locked_until)
  values (current_setting('lasnanas.email_test_today')::date, 400, current_setting('lasnanas.email_test_anchor')::timestamptz, '{"fixture":true}',
    'processing', 2, clock_timestamp() - interval '13 minutes', current_setting('lasnanas.email_test_worker_a')::uuid, clock_timestamp() - interval '1 second');
set local role service_role;
do $$
declare v_report public.site_activity_email_reports%rowtype;
begin
  select * into strict v_report from public.claim_site_activity_email_reports(current_setting('lasnanas.email_test_worker_b')::uuid, 1);
  if v_report.milestone <> 400 or v_report.attempts <> 3 or not v_report.delivery_uncertain
    or v_report.last_error_code <> 'lease_expired'
    or not public.mark_site_activity_email_report_failed(v_report.id, v_report.worker_id, 'brevo_503', true, false) then
    raise exception 'FAIL: lease vencido o ambigüedad al agotar intentos incorrectos';
  end if;
end; $$;
reset role;
insert into public.site_activity_email_reports(
  report_date, milestone, reached_at, metrics, status, attempts, first_attempt_at, worker_id, locked_until, delivery_uncertain, next_attempt_at
)
  select current_setting('lasnanas.email_test_today')::date, f.milestone, current_setting('lasnanas.email_test_anchor')::timestamptz,
    '{"fixture":true}'::jsonb, f.status, f.attempts, f.first_attempt_at, f.worker_id, f.locked_until, f.ambiguous, f.next_attempt_at
  from (values
    (500, 'pending', 1, clock_timestamp() - interval '14 minutes', null::uuid, null::timestamptz, false, clock_timestamp()),
    (600, 'pending', 1, clock_timestamp() - interval '14 minutes', null::uuid, null::timestamptz, true, clock_timestamp()),
    (700, 'processing', 1, clock_timestamp() - interval '15 minutes', current_setting('lasnanas.email_test_worker_a')::uuid, clock_timestamp() - interval '1 minute', false, clock_timestamp()),
    (800, 'processing', 1, clock_timestamp() - interval '15 minutes', current_setting('lasnanas.email_test_worker_a')::uuid, clock_timestamp() + interval '1 minute', false, clock_timestamp()),
    (900, 'processing', 1, clock_timestamp() - interval '1 minute', current_setting('lasnanas.email_test_worker_a')::uuid, clock_timestamp() - interval '1 second', false, clock_timestamp()),
    (1000, 'pending', 0, null::timestamptz, null::uuid, null::timestamptz, false, 'infinity'::timestamptz),
    (1100, 'pending', 3, clock_timestamp() - interval '1 minute', null::uuid, null::timestamptz, false, clock_timestamp())
  ) f(milestone, status, attempts, first_attempt_at, worker_id, locked_until, ambiguous, next_attempt_at);
set local role service_role;
do $$
declare v_report public.site_activity_email_reports%rowtype;
begin
  select * into strict v_report from public.claim_site_activity_email_reports(current_setting('lasnanas.email_test_worker_b')::uuid, 5);
  if v_report.milestone <> 900 or v_report.attempts <> 2 or not v_report.delivery_uncertain
    or public.mark_site_activity_email_report_sent(v_report.id, current_setting('lasnanas.email_test_worker_a')::uuid, 'fixture-late-id')
    or not public.mark_site_activity_email_report_sent(v_report.id, v_report.worker_id, 'brevo-idempotent') then
    raise exception 'FAIL: recuperación de lease, propietario o ack idempotente incorrectos';
  end if;
end; $$;
reset role;
do $$
declare v_report_id uuid;
begin
  select id into strict v_report_id from public.site_activity_email_reports where milestone = 800 and report_date = current_setting('lasnanas.email_test_today')::date;
  perform set_config('lasnanas.email_test_late_ack', v_report_id::text, true);
  if exists (select 1 from public.site_activity_email_reports r join (values
      (200, 'uncertain'), (300, 'failed'), (400, 'uncertain'), (500, 'failed'),
      (600, 'uncertain'), (700, 'uncertain'), (800, 'processing'), (900, 'sent'), (1000, 'pending'), (1100, 'failed')
    ) e(milestone, status) on r.milestone = e.milestone
    where r.report_date = current_setting('lasnanas.email_test_today')::date and r.status <> e.status) then
    raise exception 'FAIL: agotamiento, ventana14min, ambigüedad o espera incorrectos';
  end if;
end; $$;
set local role service_role;
do $$ begin
  if not public.mark_site_activity_email_report_sent(current_setting('lasnanas.email_test_late_ack')::uuid,
      current_setting('lasnanas.email_test_worker_a')::uuid, 'fixture-existing-delivery')
    or exists (select 1 from public.claim_site_activity_email_reports(current_setting('lasnanas.email_test_worker_b')::uuid)) then
    raise exception 'FAIL: ack tardío de propietario o cierre sin más dispatch incorrectos';
  end if;
end; $$;
reset role;

-- Un ack de propietario aún sin reemplazar se acepta aunque venza su lease.
insert into public.site_activity_email_reports(report_date, milestone, reached_at, metrics, status, attempts, first_attempt_at, worker_id, locked_until)
  values (current_setting('lasnanas.email_test_today')::date, 1200, current_setting('lasnanas.email_test_anchor')::timestamptz, '{"fixture":true}',
    'processing', 1, clock_timestamp() - interval '1 minute', current_setting('lasnanas.email_test_worker_a')::uuid, clock_timestamp() - interval '1 second');
do $$ begin
  perform set_config('lasnanas.email_test_expired_ack', (select id::text from public.site_activity_email_reports where milestone = 1200), true);
end; $$;
set local role service_role;
do $$ begin
  if not public.mark_site_activity_email_report_sent(current_setting('lasnanas.email_test_expired_ack')::uuid,
    current_setting('lasnanas.email_test_worker_a')::uuid, 'fixture-late-owner-ack') then
    raise exception 'FAIL: ack tardío descartado antes de reemplazar propietario';
  end if;
end; $$;
reset role;

do $$ begin
  if (clock_timestamp() at time zone 'America/Santiago')::date <> current_setting('lasnanas.email_test_today')::date then
    raise exception 'FAIL: las pruebas cruzaron medianoche; repetir en otra hora';
  end if;
  if exists (select 1 from public.site_activity_email_reports where attempts > 3)
    or not exists (select 1 from public.site_activity_email_reports where milestone = 200 and status = 'uncertain' and delivery_uncertain and attempts = 3)
    or not exists (select 1 from public.site_activity_email_reports where milestone = 900 and status = 'sent' and provider_message_id = 'brevo-idempotent') then
    raise exception 'FAIL: invariantes finales de entrega incorrectas';
  end if;
  if not exists (select 1 from public.site_activity_daily_summaries
    where summary_date = current_setting('lasnanas.email_test_today')::date
      and metrics = '{"sentinel":true}'::jsonb and message = 'Resumen diario fijo de prueba') then
    raise exception 'FAIL: los reportes por hitos alteraron el resumen diario';
  end if;
  raise notice 'OK: permisos, hitos, snapshots, Chile, cursor, pausa, propietario, retries, TTL y uncertainty; ROLLBACK';
end; $$;

-- La prueba usa el conteo real de estos fixtures: 250 visitas, sin eventos nuevos.
set local role service_role;
do $$
declare v_id uuid; v_report public.site_activity_email_reports%rowtype;
begin
  v_id := public.prepare_site_activity_email_test();
  if public.prepare_site_activity_email_test() <> v_id then
    raise exception 'FAIL: prueba repetida generó un segundo correo';
  end if;
  select * into strict v_report from public.claim_site_activity_email_reports(current_setting('lasnanas.email_test_worker_a')::uuid, 1);
  if v_report.id <> v_id or v_report.report_type <> 'test' or v_report.milestone <> 0
    or (v_report.metrics#>>'{visits,today}')::bigint <> 250
    or not public.mark_site_activity_email_report_sent(v_id, v_report.worker_id, 'fixture-test-provider-id') then
    raise exception 'FAIL: prueba manual alteró hitos o no contiene métricas reales';
  end if;
end; $$;
reset role;
do $$ begin
  if (select count(*) from public.site_activity_events where event_type = 'page_view'
    and occurred_at >= current_setting('lasnanas.email_test_today')::date::timestamp at time zone 'America/Santiago') <> 349 then
    raise exception 'FAIL: la prueba manual insertó visitas';
  end if;
end; $$;
rollback;
