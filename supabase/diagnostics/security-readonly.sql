-- Inspección de metadatos. Ejecutar en el proyecto de pruebas identificado.
-- No consulta personas, archivos ni secretos. No certifica aislamiento por sí sola.
begin transaction read only;

select n.nspname as schema_name, c.relname as table_name,
       c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public', 'storage') and c.relkind = 'r'
order by 1, 2;

select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies where schemaname in ('public', 'storage')
order by schemaname, tablename, policyname;

select id, public, file_size_limit, allowed_mime_types
from storage.buckets
where id in ('volunteer-documents', 'volunteer-attachments', 'transfer-receipts');

select grantee, table_schema, table_name, privilege_type
from information_schema.table_privileges
where table_schema in ('public', 'storage') and grantee in ('anon', 'authenticated', 'PUBLIC', 'transfer_receipt_executor')
order by table_schema, table_name, grantee, privilege_type;

select p.proname, pg_get_function_identity_arguments(p.oid) as arguments,
       p.prosecdef as security_definer, p.proconfig as function_settings,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute
       
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f'
order by p.proname;

rollback;
