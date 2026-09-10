-- Las Ñañas · esquema inicial de voluntariado.
-- Ejecutar primero en un proyecto Supabase de prueba; no contiene secretos ni datos reales.
begin;

create extension if not exists pgcrypto;
create extension if not exists btree_gist;
create type public.volunteer_role as enum ('coordination', 'admin');
create type public.application_status as enum ('draft', 'submitted', 'in_review', 'needs_clarification', 'approved', 'rejected', 'withdrawn');
create type public.payment_status as enum ('pending', 'confirmed', 'rejected', 'cancelled', 'refunded');
create type public.agenda_status as enum ('planned', 'confirmed', 'completed', 'cancelled');
create type public.agenda_type as enum ('arrival', 'departure', 'meeting', 'extra', 'workshop', 'other');

-- El perfil personal no contiene roles ni atributos administrativos.
create table public.volunteer_profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  first_name text not null check (char_length(first_name) between 2 and 60),
  last_name text not null check (char_length(last_name) between 2 and 60),
  country_code text not null check (country_code ~ '^[A-Z]{2,5}$'),
  display_name text check (display_name is null or char_length(display_name) between 2 and 80),
  photo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Los roles viven en una tabla separada sin permisos de escritura para el navegador.
create table public.staff_roles (
  user_id uuid primary key references auth.users(id) on delete restrict,
  role public.volunteer_role not null,
  agenda_access boolean not null default false,
  granted_by uuid references auth.users(id) on delete restrict,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table public.plans (
  id text primary key check (id in ('keyuwün', 'kimün', 'pülli')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Cada solicitud apunta a una versión de precio: los importes históricos no cambian.
create table public.plan_prices (
  id uuid primary key default gen_random_uuid(),
  plan_id text not null references public.plans(id) on delete restrict,
  monthly_clp integer not null check (monthly_clp > 0),
  yearly_clp integer not null check (yearly_clp > 0),
  monthly_usd integer not null check (monthly_usd > 0),
  yearly_usd integer not null check (yearly_usd > 0),
  valid_from timestamptz not null,
  valid_until timestamptz,
  created_at timestamptz not null default now(),
  check (valid_until is null or valid_until > valid_from),
  unique (plan_id, valid_from),
  exclude using gist (plan_id with =, tstzrange(valid_from, valid_until, '[)') with &&)
);

insert into public.plans(id) values ('keyuwün'), ('kimün'), ('pülli');
insert into public.plan_prices(plan_id, monthly_clp, yearly_clp, monthly_usd, yearly_usd, valid_from) values
  ('keyuwün', 10000, 96000, 10, 96, '2026-09-10T00:00:00Z'),
  ('kimün', 15000, 144000, 15, 144, '2026-09-10T00:00:00Z'),
  ('pülli', 25000, 240000, 25, 240, '2026-09-10T00:00:00Z');

create table public.membership_applications (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.volunteer_profiles(id) on delete restrict,
  plan_price_id uuid not null references public.plan_prices(id) on delete restrict,
  billing text not null check (billing in ('monthly', 'yearly')),
  currency text not null check (currency in ('CLP', 'USD')),
  quoted_amount integer not null check (quoted_amount > 0),
  status public.application_status not null default 'draft',
  respect_accepted boolean not null default false,
  coordination_accepted boolean not null default false,
  submitted_at timestamptz,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check ((status = 'draft' and submitted_at is null) or status <> 'draft')
);

create table public.application_messages (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.membership_applications(id) on delete restrict,
  author_id uuid not null references auth.users(id) on delete restrict,
  body text not null check (char_length(body) between 1 and 3000),
  visible_to_member boolean not null default true,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.admin_notes (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.membership_applications(id) on delete restrict,
  author_id uuid not null references auth.users(id) on delete restrict,
  body text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.clarification_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.application_messages(id) on delete restrict,
  owner_id uuid not null references public.volunteer_profiles(id) on delete restrict,
  storage_path text not null unique,
  original_name text not null check (char_length(original_name) between 1 and 180),
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  byte_size bigint not null check (byte_size between 1 and 5242880),
  scan_status text not null default 'pending' check (scan_status in ('pending', 'clean', 'rejected')),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (storage_path like owner_id::text || '/%')
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null unique references public.membership_applications(id) on delete restrict,
  owner_id uuid not null references public.volunteer_profiles(id) on delete restrict,
  method text not null check (method in ('gateway', 'transfer')),
  amount integer not null check (amount > 0),
  currency text not null check (currency in ('CLP', 'USD')),
  status public.payment_status not null default 'pending',
  provider_reference text unique,
  proof_path text,
  confirmed_by uuid references auth.users(id) on delete restrict,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'confirmed' and confirmed_at is not null and confirmed_by is not null) or status <> 'confirmed'),
  check (proof_path is null or proof_path like owner_id::text || '/%')
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.volunteer_profiles(id) on delete restrict,
  application_id uuid not null unique references public.membership_applications(id) on delete restrict,
  payment_id uuid not null unique references public.payments(id) on delete restrict,
  plan_price_id uuid not null references public.plan_prices(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  deactivated_at timestamptz,
  check (ends_at > starts_at),
  check ((active and deactivated_at is null) or not active)
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 160),
  storage_path text not null unique,
  plan_id text not null references public.plans(id) on delete restrict,
  active boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  retired_at timestamptz
);

-- Llegadas, salidas, reuniones, notas y ubicaciones quedan siempre dentro de esta tabla privada.
create table public.agenda_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.volunteer_profiles(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  official boolean not null default false,
  type public.agenda_type not null,
  title text not null check (char_length(title) between 1 and 100),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null check (char_length(timezone) between 1 and 64),
  general_place text check (general_place is null or char_length(general_place) <= 140),
  private_notes text check (private_notes is null or char_length(private_notes) <= 1000),
  status public.agenda_status not null default 'planned',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (ends_at > starts_at),
  check ((official and created_by <> owner_id) or (not official and created_by = owner_id))
);

-- Auditoría estructurada: no admite texto libre, contraseñas, tokens ni contenido sensible.
create table public.volunteer_audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('application_status_changed', 'payment_confirmed', 'payment_rejected', 'membership_activated', 'membership_deactivated', 'staff_role_changed', 'document_changed')),
  target_table text not null check (target_table in ('membership_applications', 'payments', 'memberships', 'staff_roles', 'documents')),
  target_id text not null check (char_length(target_id) between 1 and 80),
  occurred_at timestamptz not null default now()
);

create index applications_owner_status_idx on public.membership_applications(owner_id, status) where deleted_at is null;
create index messages_application_created_idx on public.application_messages(application_id, created_at) where deleted_at is null;
create index attachments_message_idx on public.clarification_attachments(message_id) where deleted_at is null;
create index payments_owner_status_idx on public.payments(owner_id, status);
create index memberships_owner_active_idx on public.memberships(owner_id, active, ends_at);
create index documents_plan_active_idx on public.documents(plan_id, active);
create index agenda_owner_start_idx on public.agenda_entries(owner_id, starts_at) where deleted_at is null;
create index audit_target_idx on public.volunteer_audit_events(target_table, target_id, occurred_at);

-- Impide que el navegador altere el importe cotizado o use una versión fuera de vigencia.
create or replace function public.validate_application_quote()
returns trigger language plpgsql set search_path = ''
as $$
declare v_price public.plan_prices%rowtype; v_expected integer;
begin
  select * into v_price from public.plan_prices where id=new.plan_price_id;
  if not found or v_price.valid_from>new.created_at or (v_price.valid_until is not null and v_price.valid_until<=new.created_at) then raise exception 'invalid_plan_price'; end if;
  v_expected := case
    when new.billing='monthly' and new.currency='CLP' then v_price.monthly_clp
    when new.billing='yearly' and new.currency='CLP' then v_price.yearly_clp
    when new.billing='monthly' and new.currency='USD' then v_price.monthly_usd
    when new.billing='yearly' and new.currency='USD' then v_price.yearly_usd
  end;
  if new.quoted_amount<>v_expected then raise exception 'invalid_quoted_amount'; end if;
  return new;
end $$;
revoke all on function public.validate_application_quote() from public, anon, authenticated;
create trigger application_quote_guard before insert or update of plan_price_id,billing,currency,quoted_amount on public.membership_applications for each row execute function public.validate_application_quote();

-- Helpers SECURITY DEFINER sin SQL dinámico, con search_path vacío y ejecución restringida.
create or replace function public.is_coordination()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists(select 1 from public.staff_roles r where r.user_id = auth.uid() and r.revoked_at is null and r.role in ('coordination','admin')) $$;
revoke all on function public.is_coordination() from public, anon;
grant execute on function public.is_coordination() to authenticated, service_role;

create or replace function public.can_read_agenda()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists(select 1 from public.staff_roles r where r.user_id = auth.uid() and r.revoked_at is null and r.agenda_access) $$;
revoke all on function public.can_read_agenda() from public, anon;
grant execute on function public.can_read_agenda() to authenticated, service_role;

create or replace function public.handle_new_volunteer_user()
returns trigger language plpgsql security definer set search_path = ''
as $$ begin
  insert into public.volunteer_profiles(id, first_name, last_name, country_code)
  values (new.id, coalesce(nullif(new.raw_user_meta_data->>'first_name',''),'Pendiente'), coalesce(nullif(new.raw_user_meta_data->>'last_name',''),'Pendiente'), coalesce(nullif(new.raw_user_meta_data->>'country_code',''),'XX'));
  return new;
end $$;
revoke all on function public.handle_new_volunteer_user() from public, anon, authenticated;
create trigger auth_user_profile after insert on auth.users for each row execute function public.handle_new_volunteer_user();

-- La propietaria envía su borrador mediante esta transición controlada.
create or replace function public.submit_membership_application(p_application_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  update public.membership_applications
  set status='submitted', submitted_at=now(), updated_at=now()
  where id=p_application_id and owner_id=auth.uid() and status='draft' and deleted_at is null and respect_accepted and coordination_accepted;
  if not found then raise exception 'application_not_submittable'; end if;
end $$;
revoke all on function public.submit_membership_application(uuid) from public, anon;
grant execute on function public.submit_membership_application(uuid) to authenticated;

-- Solo el servidor con service_role confirma pagos; nunca el navegador, ni siquiera coordinación.
create or replace function public.confirm_volunteer_payment(p_payment_id uuid, p_actor_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_payment public.payments%rowtype; v_application public.membership_applications%rowtype;
begin
  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found or v_payment.status <> 'pending' then raise exception 'payment_not_pending'; end if;
  select * into v_application from public.membership_applications where id = v_payment.application_id for update;
  if not found or v_application.status <> 'approved' or v_application.owner_id <> v_payment.owner_id or v_application.quoted_amount <> v_payment.amount or v_application.currency <> v_payment.currency then raise exception 'payment_validation_failed'; end if;
  update public.payments set status='confirmed', confirmed_by=p_actor_id, confirmed_at=now(), updated_at=now() where id=p_payment_id;
  insert into public.volunteer_audit_events(actor_id,action,target_table,target_id) values(p_actor_id,'payment_confirmed','payments',p_payment_id::text);
end $$;
revoke all on function public.confirm_volunteer_payment(uuid, uuid) from public, anon, authenticated;
grant execute on function public.confirm_volunteer_payment(uuid, uuid) to service_role;

create or replace function public.activate_volunteer_membership(p_payment_id uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_actor_id uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_payment public.payments%rowtype; v_application public.membership_applications%rowtype; v_membership_id uuid;
begin
  if p_ends_at <= p_starts_at then raise exception 'invalid_membership_period'; end if;
  select * into v_payment from public.payments where id=p_payment_id and status='confirmed' for update;
  if not found then raise exception 'payment_not_confirmed'; end if;
  select * into v_application from public.membership_applications where id=v_payment.application_id and status='approved' for update;
  if not found or v_application.owner_id <> v_payment.owner_id then raise exception 'application_not_approved'; end if;
  insert into public.memberships(owner_id,application_id,payment_id,plan_price_id,starts_at,ends_at)
  values(v_payment.owner_id,v_application.id,v_payment.id,v_application.plan_price_id,p_starts_at,p_ends_at)
  on conflict(payment_id) do update set starts_at=excluded.starts_at, ends_at=excluded.ends_at
  returning id into v_membership_id;
  insert into public.volunteer_audit_events(actor_id,action,target_table,target_id) values(p_actor_id,'membership_activated','memberships',v_membership_id::text);
  return v_membership_id;
end $$;
revoke all on function public.activate_volunteer_membership(uuid,timestamptz,timestamptz,uuid) from public, anon, authenticated;
grant execute on function public.activate_volunteer_membership(uuid,timestamptz,timestamptz,uuid) to service_role;

alter table public.volunteer_profiles enable row level security; alter table public.volunteer_profiles force row level security;
alter table public.staff_roles enable row level security; alter table public.staff_roles force row level security;
alter table public.plans enable row level security; alter table public.plans force row level security;
alter table public.plan_prices enable row level security; alter table public.plan_prices force row level security;
alter table public.membership_applications enable row level security; alter table public.membership_applications force row level security;
alter table public.application_messages enable row level security; alter table public.application_messages force row level security;
alter table public.admin_notes enable row level security; alter table public.admin_notes force row level security;
alter table public.clarification_attachments enable row level security; alter table public.clarification_attachments force row level security;
alter table public.payments enable row level security; alter table public.payments force row level security;
alter table public.memberships enable row level security; alter table public.memberships force row level security;
alter table public.documents enable row level security; alter table public.documents force row level security;
alter table public.agenda_entries enable row level security; alter table public.agenda_entries force row level security;
alter table public.volunteer_audit_events enable row level security; alter table public.volunteer_audit_events force row level security;

create policy profiles_owner_read on public.volunteer_profiles for select to authenticated using(id=auth.uid() and deleted_at is null);
create policy profiles_staff_read on public.volunteer_profiles for select to authenticated using(public.is_coordination());
create policy profiles_owner_update on public.volunteer_profiles for update to authenticated using(id=auth.uid() and deleted_at is null) with check(id=auth.uid() and deleted_at is null);
create policy staff_role_self_read on public.staff_roles for select to authenticated using(user_id=auth.uid() and revoked_at is null);
create policy plans_read on public.plans for select to authenticated using(active);
create policy price_history_read on public.plan_prices for select to authenticated using(valid_from<=now());

create policy applications_owner_read on public.membership_applications for select to authenticated using(owner_id=auth.uid() and deleted_at is null);
create policy applications_owner_insert on public.membership_applications for insert to authenticated with check(owner_id=auth.uid() and status='draft' and deleted_at is null);
create policy applications_owner_update_draft on public.membership_applications for update to authenticated using(owner_id=auth.uid() and status='draft' and deleted_at is null) with check(owner_id=auth.uid() and status='draft' and deleted_at is null);
create policy applications_staff_read on public.membership_applications for select to authenticated using(public.is_coordination());
create policy applications_staff_update on public.membership_applications for update to authenticated using(public.is_coordination()) with check(public.is_coordination());

create policy messages_owner_read on public.application_messages for select to authenticated using(visible_to_member and deleted_at is null and exists(select 1 from public.membership_applications a where a.id=application_id and a.owner_id=auth.uid()));
create policy messages_owner_insert on public.application_messages for insert to authenticated with check(author_id=auth.uid() and visible_to_member and exists(select 1 from public.membership_applications a where a.id=application_id and a.owner_id=auth.uid() and a.status='needs_clarification'));
create policy messages_staff_all on public.application_messages for all to authenticated using(public.is_coordination()) with check(public.is_coordination());
create policy notes_staff_only on public.admin_notes for all to authenticated using(public.is_coordination()) with check(public.is_coordination());

create policy attachments_owner_read on public.clarification_attachments for select to authenticated using(owner_id=auth.uid() and deleted_at is null);
create policy attachments_staff_read on public.clarification_attachments for select to authenticated using(public.is_coordination());

-- No existen políticas INSERT/UPDATE/DELETE de navegador para pagos, membresías ni auditoría.
create policy payments_owner_read on public.payments for select to authenticated using(owner_id=auth.uid());
create policy payments_staff_read on public.payments for select to authenticated using(public.is_coordination());
create policy memberships_owner_read on public.memberships for select to authenticated using(owner_id=auth.uid());
create policy memberships_staff_read on public.memberships for select to authenticated using(public.is_coordination());
create policy audit_admin_read on public.volunteer_audit_events for select to authenticated using(exists(select 1 from public.staff_roles r where r.user_id=auth.uid() and r.role='admin' and r.revoked_at is null));

create policy documents_member_read on public.documents for select to authenticated using(active and exists(select 1 from public.memberships m join public.plan_prices pp on pp.id=m.plan_price_id where m.owner_id=auth.uid() and m.active and m.ends_at>now() and pp.plan_id=documents.plan_id));
create policy documents_staff_all on public.documents for all to authenticated using(public.is_coordination()) with check(public.is_coordination());
create policy agenda_owner_read on public.agenda_entries for select to authenticated using(owner_id=auth.uid() and deleted_at is null);
create policy agenda_owner_insert on public.agenda_entries for insert to authenticated with check(owner_id=auth.uid() and created_by=auth.uid() and not official and deleted_at is null);
create policy agenda_owner_update on public.agenda_entries for update to authenticated using(owner_id=auth.uid() and created_by=auth.uid() and not official and deleted_at is null) with check(owner_id=auth.uid() and created_by=auth.uid() and not official and deleted_at is null);
create policy agenda_owner_delete on public.agenda_entries for delete to authenticated using(owner_id=auth.uid() and created_by=auth.uid() and not official);
create policy agenda_staff_read on public.agenda_entries for select to authenticated using(public.can_read_agenda());
create policy agenda_staff_write_official on public.agenda_entries for all to authenticated using(public.is_coordination() and official) with check(public.is_coordination() and official and created_by=auth.uid());

-- Privilegios SQL reducidos; RLS añade el filtro por fila.
revoke all on all tables in schema public from anon, authenticated;
grant select, update(first_name,last_name,country_code,display_name,photo_path,updated_at) on public.volunteer_profiles to authenticated;
grant select on public.staff_roles, public.plans, public.plan_prices to authenticated;
grant select, insert, update(plan_price_id,billing,currency,quoted_amount,respect_accepted,coordination_accepted,updated_at,status,decided_at) on public.membership_applications to authenticated;
grant select, insert, update, delete on public.application_messages, public.admin_notes to authenticated;
grant select on public.clarification_attachments to authenticated;
grant select on public.payments, public.memberships, public.volunteer_audit_events to authenticated;
grant select, insert, update, delete on public.documents, public.agenda_entries to authenticated;

-- Buckets privados; las rutas de adjuntos comienzan por el UUID de la propietaria.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
  ('volunteer-attachments','volunteer-attachments',false,5242880,array['application/pdf','image/jpeg','image/png','image/webp']),
  ('volunteer-documents','volunteer-documents',false,10485760,array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create policy attachment_owner_storage_read on storage.objects for select to authenticated using(bucket_id='volunteer-attachments' and (storage.foldername(name))[1]=auth.uid()::text);
create policy attachment_staff_storage_read on storage.objects for select to authenticated using(bucket_id='volunteer-attachments' and public.is_coordination() and exists(select 1 from public.clarification_attachments a where a.storage_path=name and a.scan_status='clean' and a.deleted_at is null));
create policy documents_staff_storage_all on storage.objects for all to authenticated using(bucket_id='volunteer-documents' and public.is_coordination()) with check(bucket_id='volunteer-documents' and public.is_coordination());
create policy documents_member_storage_read on storage.objects for select to authenticated using(bucket_id='volunteer-documents' and exists(select 1 from public.documents d join public.memberships m on m.owner_id=auth.uid() and m.active and m.ends_at>now() join public.plan_prices pp on pp.id=m.plan_price_id where d.storage_path=name and d.active and d.plan_id=pp.plan_id));

-- Retención: borrado lógico en datos personales; pagos, membresías y auditoría usan RESTRICT.
-- El borrado físico se realizará solo mediante una tarea de servidor documentada tras cumplir el plazo legal aprobado.
commit;
