-- El worker de correos valida el rol de coordinación y el pago confirmado
-- con la clave interna de Supabase. BYPASSRLS no sustituye los grants SQL.
begin;

grant select on table
  public.staff_roles,
  public.membership_applications,
  public.payments,
  public.memberships
to service_role;

commit;
