-- Las Ñañas · diagnóstico de sólo lectura después de la migración de correo.
-- Ejecutar como postgres en SQL Editor. No activa configuración ni tareas.
-- No lee métricas, reportes, destinatarios, secretos de Vault ni datos personales.
begin transaction read only;

-- Deben existir dos tablas, ambas con RLS y FORCE RLS activos.
with expected_tables(table_name) as (values
  ('site_activity_email_settings'), ('site_activity_email_reports')
)
select e.table_name, c.oid is not null as table_exists,
  c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced,
  pg_catalog.pg_get_userbyid(c.relowner) as owner
from expected_tables e
left join pg_catalog.pg_namespace n on n.nspname = 'public'
left join pg_catalog.pg_class c on c.relnamespace = n.oid
  and c.relname = e.table_name and c.relkind in ('r', 'p')
order by e.table_name;

-- Los seis resultados deben tener todos los permisos en false.
-- Se comprueban permisos efectivos, incluidos los heredados por otros roles.
with expected_tables(table_name) as (values
  ('site_activity_email_settings'), ('site_activity_email_reports')
), expected_roles(role_name) as (values
  ('anon'), ('authenticated'), ('service_role')
), tables as (
  select e.table_name, c.oid
  from expected_tables e
  left join pg_catalog.pg_namespace n on n.nspname = 'public'
  left join pg_catalog.pg_class c on c.relnamespace = n.oid
    and c.relname = e.table_name and c.relkind in ('r', 'p')
), roles as (
  select e.role_name, r.oid
  from expected_roles e left join pg_catalog.pg_roles r on r.rolname = e.role_name
)
select t.table_name, r.role_name,
  t.oid is not null and r.oid is not null as objects_exist,
  pg_catalog.has_table_privilege(r.oid, t.oid, 'SELECT') as can_select,
  pg_catalog.has_table_privilege(r.oid, t.oid, 'INSERT') as can_insert,
  pg_catalog.has_table_privilege(r.oid, t.oid, 'UPDATE') as can_update,
  pg_catalog.has_table_privilege(r.oid, t.oid, 'DELETE') as can_delete,
  pg_catalog.has_table_privilege(r.oid, t.oid, 'TRUNCATE,REFERENCES,TRIGGER') as can_other
from tables t cross join roles r
order by t.table_name, r.role_name;

-- PUBLIC no es un rol de pg_roles: se detecta como grantee=0 en el ACL.
-- Ambas columnas de recuento deben ser cero para cada tabla.
select c.relname as table_name,
  count(*) filter (where a.grantee = 0) as public_acl_grants,
  count(*) filter (where a.grantee in (
    select r.oid from pg_catalog.pg_roles r
    where r.rolname in ('anon', 'authenticated', 'service_role')
  )) as protected_role_acl_grants
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
left join lateral pg_catalog.aclexplode(
  coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
) a on true
where n.nspname = 'public' and c.relname in (
  'site_activity_email_settings', 'site_activity_email_reports'
) and c.relkind in ('r', 'p')
group by c.relname order by c.relname;

-- Las dieciocho combinaciones deben dar matches_expected=true.
-- Las seis RPC sólo pueden ser ejecutadas por service_role.
with expected_functions(signature) as (values
  ('public.configure_site_activity_email_reports(boolean)'),
  ('public.prepare_site_activity_email_reports(integer)'),
  ('public.prepare_site_activity_email_test()'),
  ('public.claim_site_activity_email_reports(uuid,integer)'),
  ('public.mark_site_activity_email_report_sent(uuid,uuid,text)'),
  ('public.mark_site_activity_email_report_failed(uuid,uuid,text,boolean,boolean)')
), expected_roles(role_name) as (values
  ('anon'), ('authenticated'), ('service_role')
), functions as (
  select e.signature, pg_catalog.to_regprocedure(e.signature) as oid
  from expected_functions e
), roles as (
  select e.role_name, r.oid
  from expected_roles e left join pg_catalog.pg_roles r on r.rolname = e.role_name
)
select f.signature, r.role_name,
  f.oid is not null and r.oid is not null as objects_exist,
  pg_catalog.has_function_privilege(r.oid, f.oid, 'EXECUTE') as can_execute,
  coalesce(pg_catalog.has_function_privilege(r.oid, f.oid, 'EXECUTE') =
    (r.role_name = 'service_role'), false) as matches_expected
from functions f cross join roles r
order by f.signature, r.role_name;

-- Deben aparecer exactamente seis funciones: todas SECURITY DEFINER,
-- empty_search_path=true, expected_signature=true y public_execute_grants=0.
with expected_functions(signature) as (values
  ('public.configure_site_activity_email_reports(boolean)'),
  ('public.prepare_site_activity_email_reports(integer)'),
  ('public.prepare_site_activity_email_test()'),
  ('public.claim_site_activity_email_reports(uuid,integer)'),
  ('public.mark_site_activity_email_report_sent(uuid,uuid,text)'),
  ('public.mark_site_activity_email_report_failed(uuid,uuid,text,boolean,boolean)')
)
select p.proname as function_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) as arguments,
  p.prosecdef as security_definer,
  exists (select 1 from unnest(p.proconfig) as s(setting)
    where s.setting in ('search_path=', 'search_path=""')) as empty_search_path,
  p.oid in (select pg_catalog.to_regprocedure(e.signature)
    from expected_functions e) as expected_signature,
  (select count(*) from pg_catalog.aclexplode(
    coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
  ) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') as public_execute_grants,
  pg_catalog.pg_get_userbyid(p.proowner) as owner
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in (
  'configure_site_activity_email_reports', 'prepare_site_activity_email_reports',
  'prepare_site_activity_email_test',
  'claim_site_activity_email_reports', 'mark_site_activity_email_report_sent',
  'mark_site_activity_email_report_failed'
)
order by p.proname, arguments;

-- Deben aparecer sólo las dos políticas SELECT de admin previstas.
-- Se comprueba la expresión sin mostrar su texto ni consultar las tablas.
select c.relname as table_name, p.polname as policy_name,
  p.polname = c.relname || '_admin_read'
    and p.polcmd = 'r' and p.polpermissive
    and p.polroles = array[(select r.oid from pg_catalog.pg_roles r
      where r.rolname = 'authenticated')]::oid[]
    and p.polwithcheck is null
    and regexp_replace(pg_catalog.pg_get_expr(p.polqual, p.polrelid), '[[:space:]]', '', 'g') in (
      'is_site_activity_admin()', 'public.is_site_activity_admin()',
      '(is_site_activity_admin())', '(public.is_site_activity_admin())'
    ) as matches_admin_select
from pg_catalog.pg_policy p
join pg_catalog.pg_class c on c.oid = p.polrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in (
  'site_activity_email_settings', 'site_activity_email_reports'
)
order by c.relname, p.polname;

-- Sólo presencia de extensiones/esquema; nunca los valores guardados en Vault.
with expected_extensions(extension_name) as (values
  ('pg_cron'), ('pg_net'), ('supabase_vault')
)
select e.extension_name, x.oid is not null as installed, x.extversion as version
from expected_extensions e
left join pg_catalog.pg_extension x on x.extname = e.extension_name
order by e.extension_name;

select pg_catalog.to_regnamespace('vault') is not null as vault_schema_exists,
  pg_catalog.to_regclass('cron.job') is not null as cron_catalog_exists;

-- Job propuesto en docs/reportes-actividad-correo.md. Cero filas es esperable
-- antes de autorizar la programación. No se devuelve cron.job.command,
-- cabeceras, URL del proyecto, valores de Vault ni resultados HTTP.
-- La rama CASE permite ejecutarlo aunque pg_cron todavía no esté instalado.
with job_metadata as (
  select case when pg_catalog.to_regclass('cron.job') is not null then
    pg_catalog.query_to_xml($metadata$
      select jobid, jobname, schedule, active,
        position('/functions/v1/send-site-activity-reports' in command) > 0 as calls_worker,
        position('vault.' in command) > 0
          and position('site_activity_report_project_url' in command) > 0
          and position('site_activity_report_webhook_secret' in command) > 0 as references_vault,
        position('x-notification-secret' in command) > 0 as uses_private_header
      from cron.job
      where jobname = 'site-activity-email-every-5-minutes'
    $metadata$, true, false, '')
  else '<table/>'::xml end as payload
)
select j.job_id, j.job_name, j.schedule, j.active,
  j.calls_worker, j.references_vault, j.uses_private_header,
  j.schedule = '*/5 * * * *' as expected_schedule
from job_metadata m cross join lateral xmltable(
  '/table/row' passing m.payload columns
    job_id bigint path 'jobid',
    job_name text path 'jobname',
    schedule text path 'schedule',
    active boolean path 'active',
    calls_worker boolean path 'calls_worker',
    references_vault boolean path 'references_vault',
    uses_private_header boolean path 'uses_private_header'
) as j;

commit;
