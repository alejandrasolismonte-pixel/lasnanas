-- Verifica RPC bajo authenticated y FORCE RLS, sin cambios persistentes.
-- No sube bytes a Storage ni confirma un abono. Ejecutar completo.
begin;
set local statement_timeout = '15s';
do $$
declare
  v_owner uuid;
  v_app uuid := gen_random_uuid();
  v_first record;
  v_retry record;
  v_count integer;
begin
  select p.id into v_owner from public.volunteer_profiles p
  where p.deleted_at is null and not exists (
    select 1 from public.staff_roles r where r.user_id=p.id and r.revoked_at is null
  ) limit 1;
  if v_owner is null then raise exception 'No non-staff profile available for rollback check'; end if;
  insert into public.membership_applications
    (id,owner_id,plan_price_id,billing,currency,quoted_amount,status)
  select v_app,v_owner,pp.id,'monthly','CLP',pp.monthly_clp,'approved'
  from public.plan_prices pp where pp.valid_from<=now() and pp.valid_until is null limit 1;
  if not found then raise exception 'No current price available'; end if;

  perform set_config('request.jwt.claim.sub',v_owner::text,true);
  perform set_config('role','authenticated',true);
  select * into v_first from public.reserve_transfer_receipt_upload(v_app,'rollback-check.pdf','application/pdf',128);
  select * into v_retry from public.reserve_transfer_receipt_upload(v_app,'rollback-check.pdf','application/pdf',128);
  if v_first.receipt_id is null or v_first.receipt_id is distinct from v_retry.receipt_id
     or v_first.storage_path is distinct from v_retry.storage_path then
    raise exception 'Reservation retry failed';
  end if;
  begin
    perform public.finalize_transfer_receipt_upload(v_first.receipt_id);
    raise exception 'Missing object was accepted';
  exception when sqlstate '22023' then
    if sqlerrm <> 'receipt_object_not_found' then raise; end if;
  end;
  select count(*) into v_count from public.payments where application_id=v_app;
  if v_count<>0 then raise exception 'Reservation created a payment'; end if;
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  select count(*) into v_count from public.transfer_receipts where id=v_first.receipt_id;
  if v_count<>0 then raise exception 'Foreign receipt visible'; end if;
  begin
    perform public.finalize_transfer_receipt_upload(v_first.receipt_id);
    raise exception 'Foreign finalization accepted';
  exception when insufficient_privilege then null;
  end;
  perform set_config('role','postgres',true);
end;
$$;
rollback;
select 'PASS: reservation, retry, missing object, foreign isolation; all changes rolled back' as result;
