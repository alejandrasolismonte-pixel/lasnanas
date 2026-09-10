-- Las Ñañas · transición atómica para respuestas de aclaración desde el frontend.
-- Ejecutar en el proyecto de pruebas después de 202609100001_voluntariado.sql.
begin;

create or replace function public.respond_to_membership_clarification(p_application_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_message_id uuid;
begin
  if p_body is null or char_length(btrim(p_body)) not between 1 and 3000 then
    raise exception 'invalid_clarification_body';
  end if;

  if not exists (
    select 1
    from public.membership_applications a
    where a.id = p_application_id
      and a.owner_id = auth.uid()
      and a.status = 'needs_clarification'
      and a.deleted_at is null
  ) then
    raise exception 'clarification_not_allowed';
  end if;

  insert into public.application_messages(application_id, author_id, body, visible_to_member)
  values (p_application_id, auth.uid(), btrim(p_body), true)
  returning id into v_message_id;

  update public.membership_applications
  set status = 'in_review', updated_at = now()
  where id = p_application_id and owner_id = auth.uid();

  return v_message_id;
end;
$$;

revoke all on function public.respond_to_membership_clarification(uuid, text) from public, anon;
grant execute on function public.respond_to_membership_clarification(uuid, text) to authenticated;

commit;
