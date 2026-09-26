-- El precio anual pasa a ser exactamente seis mensualidades (50 % de 12 meses).
-- Se conserva cada versión histórica para solicitudes y pagos ya comprometidos.
begin;

-- Una solicitud antigua sin pago puede escoger la versión vigente al actualizarse.
-- La inserción sigue validándose contra su fecha de creación.
create or replace function public.validate_application_quote()
returns trigger language plpgsql set search_path = ''
as $$
declare
  v_price public.plan_prices%rowtype;
  v_expected integer;
  v_quote_at timestamptz;
begin
  v_quote_at := case when tg_op = 'INSERT' then new.created_at else now() end;
  select * into v_price from public.plan_prices where id = new.plan_price_id;
  if not found or v_price.valid_from > v_quote_at or
     (v_price.valid_until is not null and v_price.valid_until <= v_quote_at) then
    raise exception 'invalid_plan_price';
  end if;
  v_expected := case
    when new.billing = 'monthly' and new.currency = 'CLP' then v_price.monthly_clp
    when new.billing = 'yearly' and new.currency = 'CLP' then v_price.yearly_clp
    when new.billing = 'monthly' and new.currency = 'USD' then v_price.monthly_usd
    when new.billing = 'yearly' and new.currency = 'USD' then v_price.yearly_usd
  end;
  if new.quoted_amount <> v_expected then
    raise exception 'invalid_quoted_amount';
  end if;
  return new;
end $$;
revoke all on function public.validate_application_quote() from public, anon, authenticated;

do $$
declare
  v_changed_at timestamptz := transaction_timestamp();
  v_active_count integer;
begin
  select count(*) into v_active_count from public.plan_prices
  where plan_id in ('keyuwün', 'kimün', 'pülli') and valid_until is null;
  if v_active_count <> 3 then
    raise exception 'unexpected_active_plan_prices';
  end if;
  if not exists (
    select 1 from public.plan_prices
    where plan_id in ('keyuwün', 'kimün', 'pülli') and valid_until is null
      and (yearly_clp <> monthly_clp * 6 or yearly_usd <> monthly_usd * 6)
  ) then
    return;
  end if;

  -- Cerrar las versiones anteriores y abrir las nuevas en el mismo instante.
  update public.plan_prices
  set valid_until = v_changed_at
  where plan_id in ('keyuwün', 'kimün', 'pülli') and valid_until is null;

  insert into public.plan_prices
    (plan_id, monthly_clp, yearly_clp, monthly_usd, yearly_usd, valid_from)
  select plan_id, monthly_clp, monthly_clp * 6,
         monthly_usd, monthly_usd * 6, v_changed_at
  from public.plan_prices
  where plan_id in ('keyuwün', 'kimün', 'pülli')
    and valid_until = v_changed_at;

  -- Aplicar el precio menor a solicitudes anuales aún sin pago ni comprobante.
  -- Una transferencia ya informada conserva su cotización para revisión humana.
  update public.membership_applications a
  set plan_price_id = fresh.id,
      quoted_amount = case a.currency
        when 'CLP' then fresh.yearly_clp
        when 'USD' then fresh.yearly_usd
      end,
      updated_at = v_changed_at
  from public.plan_prices previous
  join public.plan_prices fresh
    on fresh.plan_id = previous.plan_id and fresh.valid_from = v_changed_at
  where a.plan_price_id = previous.id
    and a.billing = 'yearly'
    and a.status in ('draft', 'submitted', 'in_review', 'needs_clarification', 'approved')
    and a.deleted_at is null
    and not exists (select 1 from public.payments p where p.application_id = a.id)
    and not exists (select 1 from public.transfer_receipts r where r.application_id = a.id);
end $$;

commit;
