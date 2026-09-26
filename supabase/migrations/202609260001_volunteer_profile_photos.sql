-- Fotografía privada del perfil/credencial. La ruta siempre pertenece al titular.
begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('volunteer-profile-photos', 'volunteer-profile-photos', false, 4194304,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = false, file_size_limit = 4194304,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

alter table public.volunteer_profiles
  add constraint volunteer_profiles_photo_path_owner_check
  check (photo_path is null or
    photo_path ~ ('^' || id::text || '/[0-9a-f-]{36}[.](jpg|png|webp)$'));

create policy volunteer_profile_photo_select on storage.objects
for select to authenticated using (
  bucket_id = 'volunteer-profile-photos'
  and name like auth.uid()::text || '/%'
  and exists (select 1 from public.volunteer_profiles p
              where p.id = auth.uid() and p.deleted_at is null)
);

create policy volunteer_profile_photo_insert on storage.objects
for insert to authenticated with check (
  bucket_id = 'volunteer-profile-photos'
  and name ~ ('^' || auth.uid()::text || '/[0-9a-f-]{36}[.](jpg|png|webp)$')
  and exists (select 1 from public.volunteer_profiles p
              where p.id = auth.uid() and p.deleted_at is null)
);

create policy volunteer_profile_photo_delete on storage.objects
for delete to authenticated using (
  bucket_id = 'volunteer-profile-photos'
  and name like auth.uid()::text || '/%'
);

-- Las políticas permisivas de otros módulos no pueden abrir este bucket.
create policy volunteer_profile_photo_read_guard on storage.objects
as restrictive for select to public using (
  bucket_id <> 'volunteer-profile-photos'
  or name like auth.uid()::text || '/%'
);
create policy volunteer_profile_photo_insert_guard on storage.objects
as restrictive for insert to public with check (
  bucket_id <> 'volunteer-profile-photos'
  or name ~ ('^' || auth.uid()::text || '/[0-9a-f-]{36}[.](jpg|png|webp)$')
);
create policy volunteer_profile_photo_delete_guard on storage.objects
as restrictive for delete to public using (
  bucket_id <> 'volunteer-profile-photos'
  or name like auth.uid()::text || '/%'
);
create policy volunteer_profile_photo_no_update on storage.objects
as restrictive for update to public using (bucket_id <> 'volunteer-profile-photos')
with check (bucket_id <> 'volunteer-profile-photos');

commit;
