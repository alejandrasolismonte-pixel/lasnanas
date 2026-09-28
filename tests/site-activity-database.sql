-- Las Ñañas · smoke de seguridad y comportamiento en PostgreSQL/Supabase.
-- Ejecutar SOLO en un proyecto de prueba, como postgres, tras aplicar las migraciones.
-- Crea dos cuentas de fixture y datos de actividad dentro de esta transacción.
-- No crea solicitudes/pagos, no confirma correo ni envía mensajes. Termina en ROLLBACK.
-- Si aparece un error, ejecutar ROLLBACK antes de repetir.
begin;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_non_admin uuid := gen_random_uuid();
  v_role text;
  v_table text;
  v_function text;
begin
  perform set_config('lasnanas.test_admin_id', v_admin::text, true);
  perform set_config('lasnanas.test_non_admin_id', v_non_admin::text, true);
  perform set_config('lasnanas.test_visitor_id', gen_random_uuid()::text, true);
  perform set_config('lasnanas.test_visit_id', gen_random_uuid()::text, true);
  perform set_config('lasnanas.test_event_id', gen_random_uuid()::text, true);
  perform set_config('lasnanas.test_started_at', clock_timestamp()::text, true);

  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    foreach v_table in array array[
      'public.site_activity_visitors', 'public.site_activity_events',
      'public.site_health_checks', 'public.site_activity_daily_summaries'
    ] loop
      if has_table_privilege(v_role, v_table, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
        raise exception 'FAIL: permisos directos inesperados: % %', v_role, v_table;
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
      raise exception 'FAIL: anon puede ejecutar %', v_function;
    end if;
  end loop;
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in (
      'site_activity_visitors', 'site_activity_events', 'site_health_checks', 'site_activity_daily_summaries'
    ) and not (c.relrowsecurity and c.relforcerowsecurity)
  ) then raise exception 'FAIL: RLS no está forzada'; end if;

  -- UUID y correos únicos: no se altera ninguna cuenta existente.
  insert into auth.users(id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (v_admin, 'authenticated', 'authenticated', 'site-activity-admin-' || v_admin::text || '@example.invalid',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"first_name":"Prueba","last_name":"Actividad","country_code":"CL"}'::jsonb, now(), now()),
    (v_non_admin, 'authenticated', 'authenticated', 'site-activity-user-' || v_non_admin::text || '@example.invalid',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"first_name":"Prueba","last_name":"Actividad","country_code":"CL"}'::jsonb, now(), now());
  insert into public.staff_roles(user_id, role) values (v_admin, 'admin'::public.volunteer_role);
end;
$$;

select set_config('request.jwt.claims', '{"role":"anon"}', true);
select set_config('request.jwt.claim.role', 'anon', true);
select set_config('request.jwt.claim.sub', '', true);
set local role anon;
do $$
begin
  begin
    perform public.admin_get_site_activity(7);
    raise exception 'FAIL: anon pudo consultar actividad';
  exception when insufficient_privilege then null; end;
  begin
    perform public.generate_daily_site_activity_summary();
    raise exception 'FAIL: anon pudo generar resumen';
  exception when insufficient_privilege then null; end;
  begin
    perform count(*) from public.site_activity_events;
    raise exception 'FAIL: anon pudo leer eventos';
  exception when insufficient_privilege then null; end;
  raise notice 'OK: acceso anónimo denegado';
end;
$$;
reset role;

select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', current_setting('lasnanas.test_non_admin_id'))::text, true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', current_setting('lasnanas.test_non_admin_id'), true);
set local role authenticated;
do $$
begin
  if public.is_site_activity_admin() then raise exception 'FAIL: usuario sin rol aceptado como admin'; end if;
  begin
    perform public.admin_get_site_activity(7);
    raise exception 'FAIL: usuario sin rol pudo consultar actividad';
  exception when insufficient_privilege then null; end;
  begin
    perform public.admin_record_site_health(true, 100);
    raise exception 'FAIL: usuario sin rol pudo registrar salud';
  exception when insufficient_privilege then null; end;
  begin
    perform public.generate_daily_site_activity_summary();
    raise exception 'FAIL: usuario sin rol pudo generar resumen';
  exception when insufficient_privilege then null; end;
  begin
    perform public.record_site_activity_event(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'page_view', '/');
    raise exception 'FAIL: frontend pudo ejecutar el colector de servidor';
  exception when insufficient_privilege then null; end;
  begin
    perform public.site_activity_metrics(now() - interval '1 day', now(), 1);
    raise exception 'FAIL: frontend pudo ejecutar el motor interno';
  exception when insufficient_privilege then null; end;
  begin
    perform public.prepare_site_activity_daily_report();
    raise exception 'FAIL: frontend pudo preparar el reporte de servidor';
  exception when insufficient_privilege then null; end;
  raise notice 'OK: usuario autenticado sin admin denegado';
end;
$$;
reset role;

select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', current_setting('lasnanas.test_admin_id'))::text, true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', current_setting('lasnanas.test_admin_id'), true);
set local role authenticated;
do $$
declare
  v_days integer;
  v_metrics jsonb;
  v_health jsonb;
  v_summary jsonb;
  v_at_23 jsonb;
  v_today date := (clock_timestamp() at time zone 'America/Santiago')::date;
begin
  if not public.is_site_activity_admin() then raise exception 'FAIL: admin activo denegado'; end if;
  v_health := public.admin_record_site_health(true, 87);
  foreach v_days in array array[1, 7, 30] loop
    v_metrics := public.admin_get_site_activity(v_days);
    if v_metrics->>'timezone' <> 'America/Santiago'
      or (v_metrics#>>'{period,days}')::integer <> v_days
      or (v_metrics->>'new_visitors')::bigint + (v_metrics->>'returning_visitors')::bigint <> (v_metrics->>'unique_visitors')::bigint then
      raise exception 'FAIL: contrato o reconciliación de visitantes inválida';
    end if;
  end loop;
  if v_metrics->'health' <> v_health then raise exception 'FAIL: salud no disponible en métricas'; end if;
  begin
    perform count(*) from public.site_activity_events;
    raise exception 'FAIL: incluso admin no debe leer filas directamente';
  exception when insufficient_privilege then null; end;
  begin
    perform public.admin_get_site_activity(8);
    raise exception 'FAIL: período inválido aceptado';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.generate_daily_site_activity_summary(v_today);
    raise exception 'FAIL: resumen del día abierto aceptado';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.generate_daily_site_activity_summary(v_today - 1, 22);
    raise exception 'FAIL: corte fuera de 23/24 aceptado';
  exception when invalid_parameter_value then null; end;
  if (clock_timestamp() at time zone 'America/Santiago')::time < time '23:00' then
    begin
      perform public.generate_daily_site_activity_summary(v_today, 23);
      raise exception 'FAIL: resumen de hoy a las 23 generado antes del corte';
    exception when invalid_parameter_value then null; end;
  else
    v_at_23 := public.generate_daily_site_activity_summary(v_today, 23);
    if (v_at_23#>>'{metrics,period,cutoff_hour}')::integer <> 23 then
      raise exception 'FAIL: reporte de hoy no conserva corte 23';
    end if;
  end if;
  v_summary := public.generate_daily_site_activity_summary(v_today - 1);
  if v_summary <> public.generate_daily_site_activity_summary(v_today - 1) then
    raise exception 'FAIL: reintento de resumen no es idempotente';
  end if;
  if v_summary <> public.generate_daily_site_activity_summary(v_today - 1, 23) then
    raise exception 'FAIL: un corte alternativo cambió el snapshot de la misma fecha';
  end if;
  if strpos(v_summary->>'message', 'Visitas registradas:') = 0 then
    raise exception 'FAIL: reporte no distingue visitas registradas de tráfico total';
  end if;
  if v_summary#>>'{metrics,tracking_started_at}' is null
    and strpos(v_summary->>'message', 'aún sin datos de captura') = 0 then
    raise exception 'FAIL: reporte sin captura afirma un tráfico cero sin aclarar cobertura';
  end if;
  begin
    perform public.prepare_site_activity_daily_report();
    raise exception 'FAIL: admin pudo ejecutar entrada exclusiva del servidor';
  exception when insufficient_privilege then null; end;
  perform set_config('lasnanas.test_summary', v_summary::text, true);
  raise notice 'OK: admin activo, métricas, salud y resumen fijo';
end;
$$;
reset role;

update public.staff_roles set revoked_at = clock_timestamp()
  where user_id = current_setting('lasnanas.test_admin_id')::uuid;
set local role authenticated;
do $$
begin
  if public.is_site_activity_admin() then raise exception 'FAIL: admin revocado aceptado'; end if;
  begin
    perform public.admin_get_site_activity(7);
    raise exception 'FAIL: admin revocado pudo consultar';
  exception when insufficient_privilege then null; end;
  begin
    perform public.admin_record_site_health(false);
    raise exception 'FAIL: admin revocado pudo escribir salud';
  exception when insufficient_privilege then null; end;
  begin
    perform public.generate_daily_site_activity_summary();
    raise exception 'FAIL: admin revocado pudo recuperar resumen existente';
  exception when insufficient_privilege then null; end;
  raise notice 'OK: revocación comprobada en cada RPC';
end;
$$;
reset role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claim.sub', '', true);
set local role service_role;
do $$
declare
  v_visitor uuid := current_setting('lasnanas.test_visitor_id')::uuid;
  v_visit uuid := current_setting('lasnanas.test_visit_id')::uuid;
  v_event uuid := current_setting('lasnanas.test_event_id')::uuid;
  v_start timestamptz := clock_timestamp();
  v_metrics jsonb;
  v_limited_visitor uuid := gen_random_uuid();
  v_limited_visit uuid := gen_random_uuid();
  v_limited_event uuid := gen_random_uuid();
  v_index integer;
  v_prepared jsonb;
  v_report_date date;
  v_today date := (clock_timestamp() at time zone 'America/Santiago')::date;
begin
  perform public.record_site_activity_event(v_event, v_visitor, v_visit, 'page_view', '/index.html');
  perform public.record_site_activity_event(v_event, v_visitor, v_visit, 'page_view', '/index.html');
  perform public.record_site_activity_event(gen_random_uuid(), v_visitor, v_visit, 'page_view', '/pages/voluntariado.html', 'CL', 50);
  perform public.record_site_activity_event(gen_random_uuid(), v_visitor, v_visit, 'page_view', '/', 'US', 100);
  perform public.record_site_activity_event(gen_random_uuid(), v_visitor, v_visit, 'registration_started', '/pages/voluntariado.html');
  v_metrics := public.site_activity_metrics(v_start, clock_timestamp(), 1);
  -- En un proyecto de pruebas sin tráfico concurrente hay una sesión y un país.
  if (v_metrics#>>'{visits,selected}')::bigint <> 1
    or (v_metrics->>'unique_visitors')::bigint <> 1
    or (v_metrics->>'registration_starts')::bigint <> 1
    or (v_metrics->>'volunteer_visits')::bigint <> 1
    or jsonb_array_length(v_metrics->'top_countries') <> 1
    or v_metrics#>>'{top_countries,0,country_code}' <> 'CL'
    or (v_metrics#>>'{top_countries,0,visits}')::bigint <> 1
    or (v_metrics#>>'{performance,avg_load_ms}')::numeric <> 75
    or (v_metrics#>>'{performance,samples}')::bigint <> 2 then
    raise exception 'FAIL: sesión duplicada, país no reconciliado o agregados incorrectos';
  end if;
  begin
    perform public.record_site_activity_event(gen_random_uuid(), v_visitor, v_visit, 'page_view', '/pages/coordinacion-voluntariado.html');
    raise exception 'FAIL: página privada admitida por colector';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.record_site_activity_event(gen_random_uuid(), v_visitor, v_visit, 'registration_started', '/');
    raise exception 'FAIL: registro iniciado fuera de Voluntariado admitido';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.record_site_activity_event(gen_random_uuid(), v_visitor, v_visit, 'page_view', '/', null, 'NaN'::numeric);
    raise exception 'FAIL: rendimiento no finito admitido';
  exception when invalid_parameter_value then null; end;

  for v_index in 1..90 loop
    perform public.record_site_activity_event(
      case when v_index = 1 then v_limited_event else gen_random_uuid() end,
      v_limited_visitor, v_limited_visit, 'page_view', '/'
    );
  end loop;
  -- Un reintento aceptado no consume cuota ni crea un evento adicional.
  perform public.record_site_activity_event(v_limited_event, v_limited_visitor, v_limited_visit, 'page_view', '/');
  begin
    perform public.record_site_activity_event(gen_random_uuid(), v_limited_visitor, v_limited_visit, 'page_view', '/');
    raise exception 'FAIL: evento 91 dentro del minuto admitido';
  exception when program_limit_exceeded then null; end;
  if public.generate_daily_site_activity_summary(v_today - 1) <> current_setting('lasnanas.test_summary')::jsonb then
    raise exception 'FAIL: servidor generó un segundo resumen para la misma fecha';
  end if;
  begin
    perform public.generate_daily_site_activity_summary(v_today);
    raise exception 'FAIL: servidor generó resumen del día abierto';
  exception when invalid_parameter_value then null; end;
  v_report_date := case when (clock_timestamp() at time zone 'America/Santiago')::time >= time '23:00'
    then v_today else v_today - 1 end;
  v_prepared := public.prepare_site_activity_daily_report();
  if (v_prepared->>'summary_date')::date <> v_report_date
    or v_prepared <> public.prepare_site_activity_daily_report() then
    raise exception 'FAIL: selección de fecha o reintento del reporte preparado incorrectos';
  end if;
  if v_report_date = v_today - 1 and v_prepared <> current_setting('lasnanas.test_summary')::jsonb then
    raise exception 'FAIL: entrada preparada reemplazó el snapshot existente de ayer';
  end if;
  raise notice 'OK: colector, países por sesión, idempotencia, cuota y resumen de servidor';
end;
$$;
reset role;

do $$
begin
  if (select count(*) from public.site_activity_events e
      where e.visitor_id = current_setting('lasnanas.test_visitor_id')::uuid) <> 4 then
    raise exception 'FAIL: event_id duplicado produjo filas extra';
  end if;
  if (select e.path from public.site_activity_events e
      where e.event_id = current_setting('lasnanas.test_event_id')::uuid) <> '/' then
    raise exception 'FAIL: index.html no fue canonizado';
  end if;
  raise notice 'OK: todas las comprobaciones superadas; se descartan los fixtures';
end;
$$;

rollback;
