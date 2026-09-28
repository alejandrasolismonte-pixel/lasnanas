-- Las Ñañas · diagnóstico de activación, SOLO LECTURA y una única fila final.
-- Ejecutar como postgres en SQL Editor después de aplicar la migración.
-- ready=true requiere todos los controles correctos y al menos un admin activo.
-- Sólo consulta catálogos y el número agregado de roles admin: no lee eventos,
-- visitantes, perfiles, solicitudes, correos ni identificadores de personas.
with expected_tables(table_name) as (values
  ('site_activity_visitors'), ('site_activity_events'),
  ('site_health_checks'), ('site_activity_daily_summaries')
), expected_roles(role_name) as (values
  ('anon'), ('authenticated'), ('service_role')
), roles as (
  select e.role_name, r.oid from expected_roles e
  left join pg_catalog.pg_roles r on r.rolname = e.role_name
), tables as (
  select e.table_name, c.oid, c.relowner, c.relacl,
    c.relrowsecurity, c.relforcerowsecurity
  from expected_tables e
  left join pg_catalog.pg_namespace n on n.nspname = 'public'
  left join pg_catalog.pg_class c on c.relnamespace = n.oid
    and c.relname = e.table_name and c.relkind in ('r', 'p')
), table_privileges as (
  -- Comprobar permisos efectivos también detecta permisos heredados.
  select t.table_name, r.role_name,
    case when t.oid is not null and r.oid is not null then
      pg_catalog.has_table_privilege(r.oid, t.oid,
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      else null end as has_privilege
  from tables t cross join roles r
), table_acl_grants as (
  -- PUBLIC es el grantee=0 del ACL, no un rol llamado "public".
  -- Revisar cualquier tipo de privilegio directo, incluidos tipos futuros.
  select t.table_name, a.grantee, a.privilege_type
  from tables t
  cross join lateral pg_catalog.aclexplode(
    coalesce(t.relacl, pg_catalog.acldefault('r', t.relowner))
  ) a
  where t.oid is not null and (
    a.grantee = 0 or a.grantee in (select r.oid from roles r where r.oid is not null)
  )
), expected_functions(signature, allow_authenticated, allow_service) as (values
  ('public.is_site_activity_admin()', true, false),
  ('public.record_site_activity_event(uuid,uuid,uuid,text,text,text,numeric)', false, true),
  ('public.admin_record_site_health(boolean,numeric)', true, false),
  ('public.site_activity_metrics(timestamptz,timestamptz,integer)', false, true),
  ('public.admin_get_site_activity(integer)', true, false),
  ('public.generate_daily_site_activity_summary(date,integer)', true, true),
  ('public.prepare_site_activity_daily_report()', false, true)
), functions as (
  select e.*, p.oid, p.prosecdef, p.proconfig
  from expected_functions e
  left join pg_catalog.pg_proc p on p.oid = pg_catalog.to_regprocedure(e.signature)
), scoped_functions as (
  -- Un overload antiguo con permisos distintos también impide ready=true.
  select p.oid from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
  where p.proname in (
    select split_part(split_part(e.signature, '.', 2), '(', 1) from expected_functions e
  )
), rpc_privileges as (
  select f.signature, r.role_name,
    case r.role_name when 'authenticated' then f.allow_authenticated
      when 'service_role' then f.allow_service else false end as expected_execute,
    case when f.oid is not null and r.oid is not null then
      pg_catalog.has_function_privilege(r.oid, f.oid, 'EXECUTE')
      else null end as actual_execute
  from functions f cross join roles r
), policies as (
  select t.table_name, p.polname,
    p.polcmd = 'r'
      and p.polpermissive
      and p.polroles = array[(select r.oid from roles r where r.role_name = 'authenticated')]::oid[]
      and p.polwithcheck is null
      and p.polname = t.table_name || '_admin_read'
      and regexp_replace(pg_catalog.pg_get_expr(p.polqual, p.polrelid), '[[:space:]]', '', 'g') in (
        'is_site_activity_admin()', 'public.is_site_activity_admin()',
        '(is_site_activity_admin())', '(public.is_site_activity_admin())'
      ) as matches_admin_select
  from tables t join pg_catalog.pg_policy p on p.polrelid = t.oid
), checks as (
  select
    (select count(*) from roles r where r.oid is not null) as roles_found,
    (select count(*) from tables t where t.oid is not null) as tables_found,
    (select count(*) from tables t where t.relrowsecurity and t.relforcerowsecurity) as tables_with_forced_rls,
    (select count(*) from table_privileges p where p.has_privilege = false) as table_permission_checks_passed,
    (select count(*) from table_privileges p where p.has_privilege = true) as effective_table_privilege_combinations,
    (select count(*) from table_acl_grants) as direct_table_acl_grants,
    (select count(*) from table_acl_grants a where a.grantee = 0) as public_table_acl_grants,
    (select count(*) from functions f where f.oid is not null) as rpc_signatures_found,
    (select count(*) from scoped_functions) as functions_found,
    (select count(*) from functions f where f.prosecdef) as functions_security_definer,
    (select count(*) from functions f where exists (
      select 1 from unnest(f.proconfig) as s(setting)
      where s.setting in ('search_path=', 'search_path=""')
    )) as functions_empty_search_path,
    (select count(*) from rpc_privileges p where p.actual_execute = p.expected_execute) as rpc_permission_checks_passed,
    (select count(*) from rpc_privileges p where p.actual_execute is distinct from p.expected_execute) as rpc_permission_mismatches,
    (select count(*) from policies) as policies_found,
    (select count(*) from policies p where p.matches_admin_select) as policies_admin_select,
    (select count(*) from public.staff_roles sr
      where sr.role = 'admin'::public.volunteer_role and sr.revoked_at is null) as active_admins
)
select
  roles_found = 3
    and tables_found = 4 and tables_with_forced_rls = 4
    and table_permission_checks_passed = 12
    and effective_table_privilege_combinations = 0
    and direct_table_acl_grants = 0 and public_table_acl_grants = 0
    and rpc_signatures_found = 7 and functions_found = 7
    and functions_security_definer = 7 and functions_empty_search_path = 7
    and rpc_permission_checks_passed = 21 and rpc_permission_mismatches = 0
    and policies_found = 4 and policies_admin_select = 4
    and active_admins > 0 as ready,
  roles_found, 3 as expected_roles,
  tables_found, 4 as expected_tables, tables_with_forced_rls,
  table_permission_checks_passed, 12 as expected_table_permission_checks,
  effective_table_privilege_combinations, direct_table_acl_grants, public_table_acl_grants,
  rpc_signatures_found, functions_found, 7 as expected_functions,
  functions_security_definer, functions_empty_search_path,
  rpc_permission_checks_passed, 21 as expected_rpc_permission_checks, rpc_permission_mismatches,
  policies_found, 4 as expected_policies, policies_admin_select,
  active_admins
from checks;
