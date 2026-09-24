-- Supabase no concede USAGE de auth al rol ejecutor personalizado.
-- Usa la misma expresión de auth.uid() sin acceder al esquema administrado.
-- Conserva propietarios NOBYPASSRLS, FORCE RLS, firmas y permisos de las RPC.
begin;

-- El instalador ya administra este rol, pero no hereda sus permisos.
-- Habilitar la herencia solo dentro de esta transacción para reemplazar sus RPC.
grant transfer_receipt_executor to current_user with inherit true;

create or replace function public.transfer_receipt_actor_id()
returns uuid language sql stable security invoker set search_path = ''
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
revoke all on function public.transfer_receipt_actor_id() from public, anon;
grant execute on function public.transfer_receipt_actor_id() to authenticated, transfer_receipt_executor;

-- Reemplazo acotado de identidad: no altera el resto de las funciones instaladas.
do $$
declare
  v_function regprocedure;
  v_definition text;
  v_policy record;
  v_sql text;
  v_count integer := 0;
begin
  foreach v_function in array array[
    'public.reserve_transfer_receipt_upload(uuid,text,text,bigint)'::regprocedure,
    'public.finalize_transfer_receipt_upload(uuid)'::regprocedure
  ] loop
    v_definition := pg_get_functiondef(v_function);
    execute replace(v_definition, 'auth.uid()', 'public.transfer_receipt_actor_id()');
  end loop;

  for v_policy in select * from pg_policies
    where schemaname in ('public','storage') and policyname in (
      'transfer_receipts_owner_read', 'transfer_receipts_executor_insert',
      'transfer_receipts_executor_finalize', 'applications_receipt_executor_read',
      'applications_receipt_executor_lock', 'payments_receipt_executor_read',
      'transfer_receipts_executor_object_read'
    )
  loop
    v_count := v_count + 1;
    v_sql := format('alter policy %I on %I.%I', v_policy.policyname, v_policy.schemaname, v_policy.tablename);
    if v_policy.qual is not null then
      v_sql := v_sql || ' using (' || replace(v_policy.qual, 'auth.uid()', 'public.transfer_receipt_actor_id()') || ')';
    end if;
    if v_policy.with_check is not null then
      v_sql := v_sql || ' with check (' || replace(v_policy.with_check, 'auth.uid()', 'public.transfer_receipt_actor_id()') || ')';
    end if;
    execute v_sql;
  end loop;
  if v_count <> 7 then raise exception 'Expected seven receipt executor policies, found %', v_count; end if;
end;
$$;
grant transfer_receipt_executor to current_user with inherit false;
grant transfer_receipt_executor to current_user with set false;
commit;
