-- Diagnóstico de solo lectura. Ejecutar en SQL Editor después de la migración.
-- No consulta eventos, identificadores de visitantes ni información de voluntarias.
begin transaction read only;

-- Las cuatro filas deben tener rls_enabled=true y rls_forced=true.
select n.nspname as schema_name, c.relname as table_name,
  c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced,
  pg_get_userbyid(c.relowner) as owner
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in (
  'site_activity_visitors', 'site_activity_events',
  'site_health_checks', 'site_activity_daily_summaries'
)
order by c.relname;

-- Todos los permisos directos deben ser false, también para service_role:
-- sus operaciones se realizan únicamente mediante las RPC SECURITY DEFINER.
with tables(table_name) as (values
  ('public.site_activity_visitors'), ('public.site_activity_events'),
  ('public.site_health_checks'), ('public.site_activity_daily_summaries')
), roles(role_name) as (values ('anon'), ('authenticated'), ('service_role'))
select r.role_name, t.table_name,
  has_table_privilege(r.role_name, t.table_name, 'SELECT') as can_select,
  has_table_privilege(r.role_name, t.table_name, 'INSERT') as can_insert,
  has_table_privilege(r.role_name, t.table_name, 'UPDATE') as can_update,
  has_table_privilege(r.role_name, t.table_name, 'DELETE') as can_delete,
  has_table_privilege(r.role_name, t.table_name, 'TRUNCATE,REFERENCES,TRIGGER') as can_other
from tables t cross join roles r order by t.table_name, r.role_name;

-- Cada combinación debe mostrar matches_expected=true.
with functions(signature, allow_authenticated, allow_service) as (values
  ('public.is_site_activity_admin()', true, false),
  ('public.record_site_activity_event(uuid,uuid,uuid,text,text,text,numeric)', false, true),
  ('public.admin_record_site_health(boolean,numeric)', true, false),
  ('public.site_activity_metrics(timestamptz,timestamptz,integer)', false, true),
  ('public.admin_get_site_activity(integer)', true, false),
  ('public.generate_daily_site_activity_summary(date,integer)', true, true),
  ('public.prepare_site_activity_daily_report()', false, true)
), roles(role_name) as (values ('anon'), ('authenticated'), ('service_role'))
select r.role_name, f.signature,
  has_function_privilege(r.role_name, f.signature, 'EXECUTE') as can_execute,
  has_function_privilege(r.role_name, f.signature, 'EXECUTE') = case r.role_name
    when 'authenticated' then f.allow_authenticated when 'service_role' then f.allow_service else false
  end as matches_expected
from functions f cross join roles r order by f.signature, r.role_name;

-- Todas las funciones deben ser SECURITY DEFINER con search_path vacío.
select p.proname as function_name, pg_get_function_identity_arguments(p.oid) as arguments,
  p.prosecdef as security_definer, p.proconfig as settings,
  pg_get_userbyid(p.proowner) as owner
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in (
  'is_site_activity_admin', 'record_site_activity_event', 'admin_record_site_health',
  'site_activity_metrics', 'admin_get_site_activity', 'generate_daily_site_activity_summary',
  'prepare_site_activity_daily_report'
)
order by p.proname;

-- Deben existir solo políticas SELECT para authenticated con comprobación admin.
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies where schemaname = 'public' and tablename in (
  'site_activity_visitors', 'site_activity_events',
  'site_health_checks', 'site_activity_daily_summaries'
)
order by tablename, policyname;

commit;
