-- Las Ñañas · reportes de actividad por cada 100 visitas del día de Chile.
-- Aplicar después de 202609270004_private_site_activity.sql. Deshabilitado al crear.
-- Cola independiente: no cambia funciones, solicitudes, pagos ni correos existentes.
-- Sin destinatarios, secretos, cron ni llamadas HTTP en esta migración.
begin;

create table public.site_activity_email_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  activated_at timestamptz check (activated_at is null or isfinite(activated_at)),
  scan_date date check (scan_date is null or isfinite(scan_date)),
  check ((activated_at is null) = (scan_date is null)),
  check (not enabled or activated_at is not null),
  check (scan_date is null or scan_date >= (activated_at at time zone 'America/Santiago')::date)
);
insert into public.site_activity_email_settings(singleton) values (true);

create table public.site_activity_email_reports (
  id uuid primary key default gen_random_uuid(),
  report_date date not null check (isfinite(report_date)),
  report_type text not null default 'milestone' check (report_type in ('milestone', 'test')),
  milestone bigint not null,
  reached_at timestamptz not null check (isfinite(reached_at)),
  snapshot_at timestamptz not null default clock_timestamp() check (isfinite(snapshot_at)),
  metrics jsonb not null check (jsonb_typeof(metrics) = 'object'),
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'failed', 'uncertain')),
  attempts smallint not null default 0 check (attempts between 0 and 3),
  worker_id uuid,
  locked_until timestamptz check (locked_until is null or isfinite(locked_until)),
  first_attempt_at timestamptz check (first_attempt_at is null or isfinite(first_attempt_at)),
  next_attempt_at timestamptz not null default clock_timestamp(),
  delivery_uncertain boolean not null default false,
  last_error_code text check (last_error_code is null or last_error_code ~ '^[a-z][a-z0-9_]{0,79}$'),
  provider_message_id text check (provider_message_id is null or (
    char_length(provider_message_id) between 1 and 255 and provider_message_id !~ '[[:cntrl:]]'
  )),
  sent_at timestamptz check (sent_at is null or isfinite(sent_at)),
  unique (report_date, milestone),
  check ((report_type = 'milestone' and milestone > 0 and milestone % 100 = 0)
    or (report_type = 'test' and milestone = 0)),
  check ((reached_at at time zone 'America/Santiago')::date = report_date),
  check (snapshot_at >= reached_at),
  check ((attempts = 0 and first_attempt_at is null) or (attempts > 0 and first_attempt_at is not null)),
  check ((status = 'processing' and worker_id is not null and locked_until is not null)
    or (status <> 'processing' and worker_id is null and locked_until is null)),
  check ((status = 'sent' and sent_at is not null and provider_message_id is not null)
    or (status <> 'sent' and sent_at is null and provider_message_id is null))
);
create index site_activity_email_reports_dispatch on public.site_activity_email_reports(status, next_attempt_at, report_date, milestone)
  where status in ('pending', 'processing');

alter table public.site_activity_email_settings enable row level security;
alter table public.site_activity_email_settings force row level security;
alter table public.site_activity_email_reports enable row level security;
alter table public.site_activity_email_reports force row level security;
create policy site_activity_email_settings_admin_read on public.site_activity_email_settings
  for select to authenticated using (public.is_site_activity_admin());
create policy site_activity_email_reports_admin_read on public.site_activity_email_reports
  for select to authenticated using (public.is_site_activity_admin());
revoke all on public.site_activity_email_settings, public.site_activity_email_reports
  from public, anon, authenticated, service_role;

create or replace function public.configure_site_activity_email_reports(p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_settings public.site_activity_email_settings%rowtype;
  v_now timestamptz;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'site_activity_service_required' using errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'invalid_activity_email_setting' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('lasnanas:site-activity:email-reports', 0));
  select * into strict v_settings from public.site_activity_email_settings where singleton for update;
  v_now := clock_timestamp();
  -- Una reactivación empieza en su fecha local. Una llamada repetida no mueve el cursor.
  if p_enabled and not v_settings.enabled then
    update public.site_activity_email_settings
      set enabled = true, activated_at = v_now, scan_date = (v_now at time zone 'America/Santiago')::date
      where singleton returning * into v_settings;
  elsif not p_enabled then
    update public.site_activity_email_settings set enabled = false where singleton returning * into v_settings;
  end if;
  return jsonb_build_object('enabled', v_settings.enabled, 'activated_at', v_settings.activated_at, 'scan_date', v_settings.scan_date);
end;
$$;

create or replace function public.prepare_site_activity_email_reports(p_limit integer default 20)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  v_settings public.site_activity_email_settings%rowtype;
  v_now timestamptz;
  v_today date;
  v_day date;
  v_start timestamptz;
  v_end timestamptz;
  v_snapshot_end timestamptz;
  v_metrics jsonb;
  v_milestone record;
  v_created integer := 0;
  v_days_scanned integer := 0;
  v_has_more boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'site_activity_service_required' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 20 then
    raise exception 'invalid_activity_email_prepare_limit' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('lasnanas:site-activity:email-reports', 0));
  select * into strict v_settings from public.site_activity_email_settings where singleton for update;
  if not v_settings.enabled then return 0; end if;
  v_now := clock_timestamp();
  v_today := (v_now at time zone 'America/Santiago')::date;
  v_day := greatest(v_settings.scan_date, (v_settings.activated_at at time zone 'America/Santiago')::date);

  while v_day <= v_today and v_days_scanned < 7 loop
    v_days_scanned := v_days_scanned + 1;
    v_start := v_day::timestamp at time zone 'America/Santiago';
    v_end := (v_day + 1)::timestamp at time zone 'America/Santiago';
    v_has_more := false;
    -- Una visita se cuenta una vez por día, aunque vea varias páginas. Su primer
    -- evento fija el momento del hito; los empates se ordenan por UUID de evento.
    for v_milestone in
      with first_visits as (
        select distinct on (e.visit_id) e.visit_id, e.occurred_at, e.event_id
        from public.site_activity_events e
        where e.event_type = 'page_view' and e.occurred_at >= v_start
          and e.occurred_at < v_end and e.occurred_at <= v_now
        order by e.visit_id, e.occurred_at, e.event_id
      ), numbered_visits as (
        select f.occurred_at, row_number() over (order by f.occurred_at, f.event_id, f.visit_id) as milestone
        from first_visits f
      )
      select n.milestone, n.occurred_at
      from numbered_visits n
      where n.milestone % 100 = 0 and not exists (
        select 1 from public.site_activity_email_reports r
        where r.report_date = v_day and r.milestone = n.milestone
      )
      order by n.milestone limit (p_limit - v_created + 1)
    loop
      -- Leer un hito adicional permite conservar el cursor si queda trabajo.
      if v_created >= p_limit then v_has_more := true; exit; end if;
      v_snapshot_end := least(v_milestone.occurred_at + interval '1 microsecond', v_end);
      v_metrics := public.site_activity_metrics(v_start, v_snapshot_end, 1);
      insert into public.site_activity_email_reports(report_date, milestone, reached_at, snapshot_at, metrics)
        values (v_day, v_milestone.milestone, v_milestone.occurred_at, clock_timestamp(), v_metrics);
      v_created := v_created + 1;
    end loop;
    if v_has_more or v_day = v_today then exit; end if;
    v_day := v_day + 1;
    if v_created >= p_limit then exit; end if;
  end loop;
  -- El día abierto permanece en el cursor para recoger nuevos hitos posteriores.
  update public.site_activity_email_settings set scan_date = v_day where singleton;
  return v_created;
end;
$$;

-- Una prueba manual por fecha, con métricas reales. Sólo backend autorizado.
-- No crea eventos, no mueve el cursor y no rebaja el umbral de los reportes.
create or replace function public.prepare_site_activity_email_test()
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_settings public.site_activity_email_settings%rowtype;
  v_now timestamptz;
  v_day date;
  v_start timestamptz;
  v_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'site_activity_service_required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('lasnanas:site-activity:email-reports', 0));
  select * into strict v_settings from public.site_activity_email_settings where singleton for update;
  if not v_settings.enabled then
    raise exception 'activity_email_reports_disabled' using errcode = '55000';
  end if;
  v_now := clock_timestamp();
  v_day := (v_now at time zone 'America/Santiago')::date;
  v_start := v_day::timestamp at time zone 'America/Santiago';
  if v_now <= v_start then v_now := v_start + interval '1 microsecond'; end if;
  select r.id into v_id from public.site_activity_email_reports r
    where r.report_date = v_day and r.milestone = 0;
  if found then return v_id; end if;
  insert into public.site_activity_email_reports(report_date, report_type, milestone, reached_at, snapshot_at, metrics)
    values (v_day, 'test', 0, v_now, v_now, public.site_activity_metrics(v_start, v_now, 1))
    returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.claim_site_activity_email_reports(p_worker uuid, p_limit integer default 5)
returns setof public.site_activity_email_reports language plpgsql security definer set search_path = ''
as $$
declare
  v_settings public.site_activity_email_settings%rowtype;
  v_now timestamptz;
  v_activation_date date;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'site_activity_service_required' using errcode = '42501';
  end if;
  if p_worker is null or p_limit is null or p_limit not between 1 and 5 then
    raise exception 'invalid_activity_email_claim' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('lasnanas:site-activity:email-reports', 0));
  select * into strict v_settings from public.site_activity_email_settings where singleton for update;
  if not v_settings.enabled then return; end if;
  v_now := clock_timestamp();
  v_activation_date := (v_settings.activated_at at time zone 'America/Santiago')::date;

  -- Un lease perdido puede haber alcanzado al proveedor. Fuera de la ventana
  -- de idempotencia no se vuelve a enviar: queda uncertain para revisión.
  update public.site_activity_email_reports r set
    status = case when r.delivery_uncertain or r.status = 'processing' then 'uncertain' else 'failed' end,
    delivery_uncertain = r.delivery_uncertain or r.status = 'processing',
    last_error_code = case when r.report_date < v_activation_date then 'activation_window_closed'
      when r.attempts >= 3 then 'attempts_exhausted' else 'retry_window_expired' end,
    worker_id = null, locked_until = null, next_attempt_at = 'infinity'::timestamptz
  where (r.status = 'pending' or (r.status = 'processing' and r.locked_until <= v_now))
    and (r.report_date < v_activation_date or r.attempts >= 3
      or (r.first_attempt_at is not null and v_now >= r.first_attempt_at + interval '14 minutes'));

  return query
    with candidates as (
      select r.id from public.site_activity_email_reports r
      where r.report_date >= v_activation_date
        and r.report_date <= (v_now at time zone 'America/Santiago')::date
        and r.attempts < 3
        and (r.first_attempt_at is null or v_now < r.first_attempt_at + interval '14 minutes')
        and ((r.status = 'pending' and r.next_attempt_at <= v_now)
          or (r.status = 'processing' and r.locked_until <= v_now))
      order by r.report_date, r.milestone
      for update skip locked limit p_limit
    ), claimed as (
      update public.site_activity_email_reports r set
        status = 'processing', attempts = r.attempts + 1,
        first_attempt_at = coalesce(r.first_attempt_at, v_now),
        worker_id = p_worker, locked_until = v_now + interval '4 minutes',
        delivery_uncertain = r.delivery_uncertain or r.status = 'processing',
        last_error_code = case when r.status = 'processing' then 'lease_expired' else r.last_error_code end
      from candidates c where r.id = c.id returning r.*
    ) select c.* from claimed c order by c.report_date, c.milestone;
end;
$$;

create or replace function public.mark_site_activity_email_report_sent(
  p_report_id uuid, p_worker uuid, p_provider_message_id text
)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_provider_message_id text := btrim(p_provider_message_id);
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'site_activity_service_required' using errcode = '42501';
  end if;
  if p_report_id is null or p_worker is null or v_provider_message_id is null
    or char_length(v_provider_message_id) not between 1 and 255 or v_provider_message_id ~ '[[:cntrl:]]' then
    raise exception 'invalid_activity_email_sent_ack' using errcode = '22023';
  end if;
  -- Aceptar un resultado tardío mientras conserve propietario resuelve el intento
  -- real; nunca habilita otro dispatch. Un nuevo claim cambia el propietario.
  update public.site_activity_email_reports r set status = 'sent',
    sent_at = clock_timestamp(), provider_message_id = v_provider_message_id,
    worker_id = null, locked_until = null, next_attempt_at = 'infinity'::timestamptz,
    last_error_code = null
  where r.id = p_report_id and r.status = 'processing' and r.worker_id = p_worker;
  return found;
end;
$$;

create or replace function public.mark_site_activity_email_report_failed(
  p_report_id uuid, p_worker uuid, p_error_code text, p_retryable boolean, p_ambiguous boolean
)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  v_report public.site_activity_email_reports%rowtype;
  v_now timestamptz;
  v_uncertain boolean;
  v_retry boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'site_activity_service_required' using errcode = '42501';
  end if;
  if p_report_id is null or p_worker is null or p_retryable is null or p_ambiguous is null
    or p_error_code is null or p_error_code !~ '^[a-z][a-z0-9_]{0,79}$' then
    raise exception 'invalid_activity_email_failed_ack' using errcode = '22023';
  end if;
  select * into v_report from public.site_activity_email_reports r
    where r.id = p_report_id and r.status = 'processing' and r.worker_id = p_worker for update;
  if not found then return false; end if;
  v_now := clock_timestamp();
  v_uncertain := v_report.delivery_uncertain or p_ambiguous;
  v_retry := p_retryable and v_report.attempts < 3
    and v_now + interval '1 minute' < v_report.first_attempt_at + interval '14 minutes';
  update public.site_activity_email_reports r set
    status = case when v_retry then 'pending' when v_uncertain then 'uncertain' else 'failed' end,
    delivery_uncertain = v_uncertain, last_error_code = p_error_code,
    next_attempt_at = case when v_retry then v_now + interval '1 minute' else 'infinity'::timestamptz end,
    worker_id = null, locked_until = null
  where r.id = v_report.id;
  return true;
end;
$$;

revoke all on function public.configure_site_activity_email_reports(boolean),
  public.prepare_site_activity_email_reports(integer),
  public.prepare_site_activity_email_test(),
  public.claim_site_activity_email_reports(uuid,integer),
  public.mark_site_activity_email_report_sent(uuid,uuid,text),
  public.mark_site_activity_email_report_failed(uuid,uuid,text,boolean,boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.configure_site_activity_email_reports(boolean),
  public.prepare_site_activity_email_reports(integer),
  public.prepare_site_activity_email_test(),
  public.claim_site_activity_email_reports(uuid,integer),
  public.mark_site_activity_email_report_sent(uuid,uuid,text),
  public.mark_site_activity_email_report_failed(uuid,uuid,text,boolean,boolean)
  to service_role;

-- Fallar transaccionalmente ante grants heredados, RLS o RPC abiertas.
do $$
declare
  v_role text;
  v_table text;
  v_function text;
  v_function_oid oid;
begin
  foreach v_table in array array['public.site_activity_email_settings', 'public.site_activity_email_reports'] loop
    foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
      if has_table_privilege(v_role, v_table, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
        raise exception 'unexpected_activity_email_table_grant: % %', v_role, v_table;
      end if;
    end loop;
    if exists (select 1 from pg_catalog.pg_class c
      cross join lateral pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
      where c.oid = v_table::regclass and a.grantee = 0) then
      raise exception 'unexpected_public_activity_email_table_grant: %', v_table;
    end if;
    if not exists (select 1 from pg_catalog.pg_class c
      where c.oid = v_table::regclass and c.relrowsecurity and c.relforcerowsecurity) then
      raise exception 'activity_email_forced_rls_required: %', v_table;
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
    v_function_oid := v_function::regprocedure;
    if has_function_privilege('anon', v_function_oid, 'EXECUTE')
      or has_function_privilege('authenticated', v_function_oid, 'EXECUTE')
      or not has_function_privilege('service_role', v_function_oid, 'EXECUTE') then
      raise exception 'unexpected_activity_email_function_grant: %', v_function;
    end if;
    if not exists (select 1 from pg_catalog.pg_proc p where p.oid = v_function_oid and p.prosecdef
      and exists (select 1 from unnest(p.proconfig) s(setting) where s.setting in ('search_path=', 'search_path=""')))
      or exists (select 1 from pg_catalog.pg_proc p
        cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
        where p.oid = v_function_oid and a.grantee = 0) then
      raise exception 'activity_email_private_definer_required: %', v_function;
    end if;
  end loop;
end;
$$;

commit;
