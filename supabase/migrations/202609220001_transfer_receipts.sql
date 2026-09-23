-- Comprobantes privados de transferencia. Migración preparada, NO ejecutada.
-- Requiere las migraciones anteriores de voluntariado (001 a 005).
-- No modifica admin_confirm_transfer, payments ni la interfaz.
-- Flujo futuro: reservar -> Storage upload con upsert:false -> finalizar -> consultar.
-- Una reserva NO demuestra que el archivo se haya subido ni confirma un pago.
begin;

-- La versión anterior era SECURITY DEFINER del creador y carecía de una política
-- INSERT: con FORCE RLS solo funcionaba si ese creador era superusuario/BYPASSRLS.
-- Alternativa explícita: ambas RPC pertenecen a un rol sin login ni bypass, con
-- privilegios mínimos y políticas propias. No conceder este rol al autenticador
-- de la API, anon, authenticated ni service_role.
-- La instalación requiere CREATEROLE y poder transferir la propiedad de funciones;
-- si no están disponibles, la migración debe fallar, no desactivar FORCE RLS.
create role transfer_receipt_executor nologin noinherit nosuperuser
  nocreatedb nocreaterole noreplication nobypassrls;
grant transfer_receipt_executor to current_user;
grant usage on schema public, auth, storage to transfer_receipt_executor;
grant execute on function auth.uid() to transfer_receipt_executor;

-- La FK compuesta impide vincular una solicitud con otra propietaria.
alter table public.membership_applications
  add constraint membership_applications_id_owner_receipts_key unique (id, owner_id);

create table public.transfer_receipts (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null unique,
  owner_id uuid not null references public.volunteer_profiles(id) on delete restrict,
  original_name text not null check (char_length(btrim(original_name)) between 1 and 180),
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  byte_size bigint not null check (byte_size between 1 and 5242880),
  storage_path text not null unique,
  received_at timestamptz,
  storage_object_id uuid,
  status text generated always as (
    case when received_at is null then 'reserved' else 'received' end
  ) stored,
  constraint transfer_receipts_received_pair check (
    (received_at is null) = (storage_object_id is null)
  ),
  created_at timestamptz not null default now(),
  constraint transfer_receipts_application_owner_fk
    foreign key (application_id, owner_id)
    references public.membership_applications(id, owner_id) on delete restrict,
  constraint transfer_receipts_exact_path check (
    storage_path = owner_id::text || '/' || application_id::text || '/' || id::text ||
      case mime_type when 'application/pdf' then '.pdf'
                     when 'image/jpeg' then '.jpg' else '.png' end
  )
);
create index transfer_receipts_owner_idx on public.transfer_receipts(owner_id);

alter table public.transfer_receipts enable row level security;
alter table public.transfer_receipts force row level security;
revoke all on public.transfer_receipts from public, anon, authenticated;
grant select on public.transfer_receipts to authenticated;

-- No se usa is_coordination(): ese helper también admite coordinación no admin.
create policy transfer_receipts_owner_read on public.transfer_receipts
  for select to authenticated, transfer_receipt_executor using (owner_id = auth.uid());
create policy transfer_receipts_admin_read on public.transfer_receipts
  for select to authenticated using (
    received_at is not null and exists (select 1 from public.staff_roles r
      where r.user_id = auth.uid() and r.role = 'admin' and r.revoked_at is null)
  );
-- Sin INSERT/UPDATE/DELETE directos sobre los metadatos, incluso para admin.

grant select, insert on public.transfer_receipts to transfer_receipt_executor;
grant update(received_at, storage_object_id) on public.transfer_receipts to transfer_receipt_executor;
create policy transfer_receipts_executor_insert on public.transfer_receipts
  for insert to transfer_receipt_executor with check (
    owner_id = auth.uid() and received_at is null and storage_object_id is null
    and exists (select 1 from public.membership_applications a
      where a.id = application_id and a.owner_id = auth.uid()
        and a.status = 'approved' and a.deleted_at is null)
  );
create policy transfer_receipts_executor_finalize on public.transfer_receipts
  for update to transfer_receipt_executor
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and received_at is not null and storage_object_id is not null);

-- SELECT FOR UPDATE exige privilegio UPDATE y una política UPDATE aplicable.
-- Se concede una sola columna para tomar el bloqueo; WITH CHECK false impide
-- modificar la solicitud. Las RPC no ejecutan ningún UPDATE sobre ella.
grant select, update(id) on public.membership_applications to transfer_receipt_executor;
create policy applications_receipt_executor_read on public.membership_applications
  for select to transfer_receipt_executor using (
    owner_id = auth.uid() and status = 'approved' and deleted_at is null
  );
create policy applications_receipt_executor_lock on public.membership_applications
  for update to transfer_receipt_executor using (
    owner_id = auth.uid() and status = 'approved' and deleted_at is null
  ) with check (false);
grant select on public.payments to transfer_receipt_executor;
create policy payments_receipt_executor_read on public.payments
  for select to transfer_receipt_executor using (owner_id = auth.uid());

-- El ejecutor ve solo objetos del bucket nuevo vinculados a la sesión llamante.
-- No tiene INSERT/UPDATE/DELETE en storage.objects.
grant select on storage.objects to transfer_receipt_executor;
create policy transfer_receipts_executor_object_read on storage.objects
  for select to transfer_receipt_executor using (
    bucket_id = 'transfer-receipts' and exists (
      select 1 from public.transfer_receipts t
      where t.storage_path = name and t.owner_id = auth.uid()
    )
  );

-- Se crea un bucket nuevo; una colisión de nombre aborta en vez de reutilizar
-- silenciosamente un bucket con contenido o configuración desconocidos.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('transfer-receipts', 'transfer-receipts', false, 5242880,
        array['application/pdf', 'image/jpeg', 'image/png']);

create function public.reserve_transfer_receipt_upload(
  p_application_id uuid, p_original_name text, p_mime_type text, p_byte_size bigint
)
returns table (receipt_id uuid, storage_path text)
language plpgsql security definer set search_path = '' set row_security = on
as $$
declare
  v_application public.membership_applications%rowtype;
  v_receipt public.transfer_receipts%rowtype;
  v_id uuid := gen_random_uuid();
  v_name text;
  v_path text;
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  -- Mismo orden de bloqueo que admin_confirm_transfer: primero la solicitud.
  select a.* into v_application from public.membership_applications a
  where a.id = p_application_id and a.owner_id = auth.uid()
    and a.deleted_at is null and a.status = 'approved'
  for update;
  if not found then
    raise exception 'receipt_upload_not_allowed' using errcode = '42501';
  end if;
  if exists (select 1 from public.payments p where p.application_id = v_application.id
      and (p.method <> 'transfer' or p.status <> 'pending')) then
    raise exception 'receipt_upload_not_allowed' using errcode = '42501';
  end if;
  if p_mime_type is null or p_mime_type not in ('application/pdf', 'image/jpeg', 'image/png')
     or p_byte_size is null or p_byte_size not between 1 and 5242880
     or p_original_name is null or char_length(btrim(p_original_name)) not between 1 and 180 then
    raise exception 'invalid_receipt_file' using errcode = '22023';
  end if;
  v_name := regexp_replace(btrim(p_original_name), '[^[:alnum:] ._()-]', '_', 'g');
  -- Una reserva por solicitud. Reintentar la misma reserva devuelve su ruta;
  -- cambiar o reemplazar un comprobante requiere un flujo posterior explícito.
  select t.* into v_receipt from public.transfer_receipts t
  where t.application_id = v_application.id;
  if found then
    if v_receipt.original_name <> v_name or v_receipt.mime_type <> p_mime_type
       or v_receipt.byte_size <> p_byte_size then
      raise exception 'receipt_already_reserved' using errcode = '23505';
    end if;
    return query select v_receipt.id, v_receipt.storage_path;
    return;
  end if;
  v_path := v_application.owner_id::text || '/' || v_application.id::text || '/' || v_id::text ||
    case p_mime_type when 'application/pdf' then '.pdf'
                     when 'image/jpeg' then '.jpg' else '.png' end;
  insert into public.transfer_receipts(id, application_id, owner_id,
    original_name, mime_type, byte_size, storage_path)
  values (v_id, v_application.id, v_application.owner_id, v_name, p_mime_type, p_byte_size, v_path);
  return query select v_id, v_path;
end;
$$;
revoke all on function public.reserve_transfer_receipt_upload(uuid,text,text,bigint)
  from public, anon, authenticated;
grant execute on function public.reserve_transfer_receipt_upload(uuid,text,text,bigint)
  to authenticated;

-- Solo la propietaria finaliza. Ni la ruta, ni el bucket, ni received_at se reciben
-- del cliente. La existencia se consulta en Storage bajo RLS del ejecutor.
create function public.finalize_transfer_receipt_upload(p_receipt_id uuid)
returns table (receipt_id uuid, received_at timestamptz)
language plpgsql security definer set search_path = '' set row_security = on
as $$
declare
  v_receipt public.transfer_receipts%rowtype;
  v_object_id uuid;
  v_metadata jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  select t.* into v_receipt from public.transfer_receipts t
  where t.id = p_receipt_id and t.owner_id = auth.uid()
  for update;
  if not found then
    raise exception 'receipt_finalize_not_allowed' using errcode = '42501';
  end if;
  select o.id, o.metadata into v_object_id, v_metadata from storage.objects o
  where o.bucket_id = 'transfer-receipts' and o.name = v_receipt.storage_path;
  if not found then
    raise exception 'receipt_object_not_found' using errcode = '22023';
  end if;
  -- Comprobar los metadatos persistidos por Storage, no datos de la llamada.
  -- Un metadato ausente o distinto no permite declarar recibido el comprobante.
  if v_metadata->>'mimetype' is distinct from v_receipt.mime_type
     or v_metadata->>'size' is distinct from v_receipt.byte_size::text then
    raise exception 'receipt_object_metadata_mismatch' using errcode = '22023';
  end if;
  if v_receipt.received_at is not null then
    if v_receipt.storage_object_id is distinct from v_object_id then
      raise exception 'receipt_object_changed' using errcode = '22023';
    end if;
    return query select v_receipt.id, v_receipt.received_at;
    return;
  end if;
  update public.transfer_receipts t
  set received_at = now(), storage_object_id = v_object_id
  where t.id = v_receipt.id and t.owner_id = auth.uid() and t.received_at is null
  returning t.* into v_receipt;
  if not found then
    raise exception 'receipt_finalize_not_allowed' using errcode = '42501';
  end if;
  return query select v_receipt.id, v_receipt.received_at;
end;
$$;
revoke all on function public.finalize_transfer_receipt_upload(uuid) from public, anon, authenticated;
grant execute on function public.finalize_transfer_receipt_upload(uuid) to authenticated;

-- CREATE de esquema y membresía son temporales, solo para transferir propiedad.
grant create on schema public to transfer_receipt_executor;
alter function public.reserve_transfer_receipt_upload(uuid,text,text,bigint) owner to transfer_receipt_executor;
alter function public.finalize_transfer_receipt_upload(uuid) owner to transfer_receipt_executor;
revoke create on schema public from transfer_receipt_executor;
revoke transfer_receipt_executor from current_user;

-- Lectura de objetos: la RLS de transfer_receipts filtra por propietaria/admin.
-- Ni conocer la ruta ni tener el rol coordination concede acceso.
create policy transfer_receipts_storage_read on storage.objects
  for select to authenticated using (
    bucket_id = 'transfer-receipts' and exists (
      select 1 from public.transfer_receipts t where t.storage_path = name
    )
  );

-- Solo la propietaria carga en la ruta exacta reservada; admin no carga por ella.
create policy transfer_receipts_storage_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'transfer-receipts' and exists (
      select 1 from public.transfer_receipts t
      join public.membership_applications a on a.id = t.application_id and a.owner_id = t.owner_id
      where t.storage_path = name and t.owner_id = auth.uid()
        and t.received_at is null
        and a.status = 'approved' and a.deleted_at is null
        and not exists (select 1 from public.payments p where p.application_id = a.id
          and (p.method <> 'transfer' or p.status <> 'pending'))
    )
  );

-- Defensas RESTRICTIVE: otras políticas permisivas de storage.objects no pueden
-- ampliar estos permisos. Para los demás buckets no añaden restricciones.
create policy transfer_receipts_storage_read_guard on storage.objects
  as restrictive for select to authenticated using (
    bucket_id <> 'transfer-receipts' or exists (
      select 1 from public.transfer_receipts t where t.storage_path = name
    )
  );
create policy transfer_receipts_storage_insert_guard on storage.objects
  as restrictive for insert to authenticated with check (
    bucket_id <> 'transfer-receipts' or exists (
      select 1 from public.transfer_receipts t
      join public.membership_applications a on a.id = t.application_id and a.owner_id = t.owner_id
      where t.storage_path = name and t.owner_id = auth.uid()
        and t.received_at is null
        and a.status = 'approved' and a.deleted_at is null
        and not exists (select 1 from public.payments p where p.application_id = a.id
          and (p.method <> 'transfer' or p.status <> 'pending'))
    )
  );
-- Bloquea UPDATE del objeto viejo y del nuevo: tampoco permite mover archivos
-- hacia este bucket o fuera de él. Impide upsert/sobrescritura desde el cliente.
create policy transfer_receipts_storage_no_update on storage.objects
  as restrictive for update to authenticated
  using (bucket_id <> 'transfer-receipts')
  with check (bucket_id <> 'transfer-receipts');
create policy transfer_receipts_storage_no_delete on storage.objects
  as restrictive for delete to authenticated using (bucket_id <> 'transfer-receipts');
create policy transfer_receipts_storage_no_anon on storage.objects
  as restrictive for all to anon
  using (bucket_id <> 'transfer-receipts')
  with check (bucket_id <> 'transfer-receipts');

-- Límites de alcance:
-- * MIME y tamaño se restringen en el bucket (5 MiB = 5242880 bytes).
--   La declaración de reserva no certifica bytes subidos ni firma binaria;
--   finalizar verifica objeto y metadatos, NO firma binaria ni malware.
-- * Revisar significa consultar/descargar como admin vigente, no aprobar pagos.
-- * Una URL firmada ya emitida funciona hasta expirar: usar duración corta;
--   para comprobar el rol en cada descarga, usar descarga autenticada.
-- * RLS restringe anon/authenticated, no superusuarios ni service_role/BYPASSRLS.
-- * Pendiente probar en entorno aislado: anónimo, A/B, admin, admin revocado,
--   coordination, ruta sin reserva, upsert, borrado y límites de carga.
-- Plan de prueba de la alternativa NOBYPASSRLS (NO ejecutado):
-- 1. Tras aplicar en un entorno aislado, comprobar en pg_roles que el ejecutor
--    tiene rolcanlogin=false, rolsuper=false, rolbypassrls=false; en pg_proc que
--    ambas RPC le pertenecen; en pg_class que transfer_receipts conserva FORCE.
--    pg_auth_members no debe permitir asumirlo desde los roles de la API.
-- 2. Con JWT de A y solicitud aprobada propia, reservar debe crear status=reserved,
--    received_at=NULL y storage_object_id=NULL pese a FORCE RLS.
-- 3. A finaliza sin subir: receipt_object_not_found, reserva intacta. Repetir con
--    archivo en otro bucket/ruta: mismo resultado. B no puede finalizar el de A.
-- 4. Subir con A a la ruta reservada. MIME/tamaño distintos de la reserva deben
--    producir receipt_object_metadata_mismatch; no marcar como received.
-- 5. Con objeto y metadatos correctos, finalizar devuelve received_at; repetir
--    (también concurrentemente) conserva el mismo timestamp y storage_object_id.
-- 6. Admin vigente ve solo recibidos; coordination/admin revocado no ven los de A.
--    INSERT/UPDATE directo de metadatos como authenticated debe seguir denegado.
-- 7. Verificar que las RPC NO cambian pagos/membresías y que los bloqueos de
--    sobrescritura/borrado siguen vigentes. No usar service_role para estas pruebas.
commit;
