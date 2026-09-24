-- Al reactivar, una ficha vuelve al estado que tenía antes del archivado.
begin;

alter table public.nanas
  add column status_before_archive text not null default 'in_process'
  check (status_before_archive in ('in_process', 'active'));

create or replace function public.nanas_set_metadata()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  if new.status = 'inactive' then
    if tg_op = 'UPDATE' and old.status <> 'inactive' then
      new.status_before_archive := old.status;
    end if;
    new.archived_at := coalesce(new.archived_at, now());
  else
    new.archived_at := null;
  end if;
  return new;
end;
$$;

commit;
