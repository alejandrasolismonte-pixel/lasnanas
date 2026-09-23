-- Ejecutar en lasnanas-voluntariado-dev (xnntqjaztwcqljgivkds).
-- Solo metadatos: no aplica la migración ni consulta datos personales.
-- Las filas ausentes indican componentes pendientes; no prueban aislamiento.
begin transaction read only;

select id, public, file_size_limit, allowed_mime_types
from storage.buckets where id = 'transfer-receipts';

select rolname, rolcanlogin, rolinherit, rolsuper, rolcreatedb,
       rolcreaterole, rolreplication, rolbypassrls
from pg_roles where rolname = 'transfer_receipt_executor';

-- Incluye membresías indirectas que permitirían asumir el rol ejecutor.
with recursive members as (
  select m.member, array[m.roleid, m.member] as path
  from pg_auth_members m join pg_roles r on r.oid = m.roleid
  where r.rolname = 'transfer_receipt_executor'
  union all
  select m.member, members.path || m.member
  from pg_auth_members m join members on m.roleid = members.member
  where not m.member = any(members.path)
)
select distinct r.rolname as executor_member
from members join pg_roles r on r.oid = members.member;

select c.relname, c.relrowsecurity, c.relforcerowsecurity
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'transfer_receipts';

select p.proname, pg_get_userbyid(p.proowner) as function_owner,
       p.prosecdef, p.proconfig,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in
  ('reserve_transfer_receipt_upload', 'finalize_transfer_receipt_upload');

-- Ver todas las políticas: otras políticas permisivas también cuentan.
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where (schemaname = 'storage' and tablename = 'objects')
   or (schemaname = 'public' and tablename in
       ('transfer_receipts', 'membership_applications', 'payments', 'staff_roles'))
order by schemaname, tablename, policyname;

select grantee, table_schema, table_name, privilege_type
from information_schema.table_privileges
where grantee = 'transfer_receipt_executor'
order by table_schema, table_name, privilege_type;

-- UPDATE se concede por columna; table_privileges no lo muestra.
select grantee, table_schema, table_name, column_name, privilege_type
from information_schema.column_privileges
where grantee = 'transfer_receipt_executor' and privilege_type = 'UPDATE'
order by table_schema, table_name, column_name;

rollback;
