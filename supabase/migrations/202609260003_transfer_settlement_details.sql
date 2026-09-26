-- Conserva el importe cotizado y registra por separado el abono bancario real.
begin;

alter table public.payments
  add column settled_amount numeric(14,2),
  add column settled_currency text,
  add column source_currency text,
  add column transfer_route text,
  add constraint payments_settlement_details_check check (
    (settled_amount is null and settled_currency is null and
      source_currency is null and transfer_route is null)
    or (settled_amount is not null and settled_amount > 0 and
      settled_currency is not null and settled_currency in ('CLP','USD','EUR') and
      source_currency is not null and source_currency in ('CLP','USD','EUR') and
      transfer_route is not null and transfer_route in ('domestic','international'))
  );

create function public.admin_confirm_transfer_v2(
  p_application_id uuid,
  p_transfer_reference text,
  p_settled_amount numeric,
  p_settled_currency text,
  p_source_currency text,
  p_transfer_route text
)
returns table (
  payment_id uuid, membership_id uuid, payment_status public.payment_status,
  membership_active boolean, starts_at timestamptz, ends_at timestamptz
)
language plpgsql security definer set search_path = ''
as $$
declare
  v_confirmation record;
  v_payment public.payments%rowtype;
begin
  if p_settled_amount is null or p_settled_amount <= 0 or
     p_settled_amount > 999999999999.99 or
     p_settled_amount <> round(p_settled_amount, 2) or
     p_settled_currency is null or p_settled_currency not in ('CLP','USD','EUR') or
     p_source_currency is null or p_source_currency not in ('CLP','USD','EUR') or
     p_transfer_route is null or p_transfer_route not in ('domestic','international') then
    raise exception 'invalid_settlement_details' using errcode = '22023';
  end if;

  -- La RPC original mantiene los bloqueos, el control de rol y la activación.
  select * into v_confirmation from public.admin_confirm_transfer(
    p_application_id, p_transfer_reference);
  if not found or v_confirmation.payment_status <> 'confirmed' or
     not v_confirmation.membership_active then
    raise exception 'payment_confirmation_unavailable';
  end if;

  select * into v_payment from public.payments
    where id = v_confirmation.payment_id for update;
  if not found or v_payment.method <> 'transfer' or
     v_payment.status <> 'confirmed' or
     v_payment.application_id <> p_application_id then
    raise exception 'payment_not_confirmable';
  end if;
  if v_payment.settled_amount is not null and (
     v_payment.settled_amount <> p_settled_amount or
     v_payment.settled_currency <> p_settled_currency or
     v_payment.source_currency <> p_source_currency or
     v_payment.transfer_route <> p_transfer_route) then
    raise exception 'settlement_already_recorded';
  end if;

  update public.payments set
    settled_amount = p_settled_amount,
    settled_currency = p_settled_currency,
    source_currency = p_source_currency,
    transfer_route = p_transfer_route,
    updated_at = now()
  where id = v_confirmation.payment_id;

  return query select v_confirmation.payment_id, v_confirmation.membership_id,
    v_confirmation.payment_status, v_confirmation.membership_active,
    v_confirmation.starts_at, v_confirmation.ends_at;
end;
$$;
revoke all on function public.admin_confirm_transfer_v2(uuid,text,numeric,text,text,text)
  from public, anon, authenticated;
grant execute on function public.admin_confirm_transfer_v2(uuid,text,numeric,text,text,text)
  to authenticated;
-- Toda confirmación nueva debe registrar el abono realmente observado.
revoke execute on function public.admin_confirm_transfer(uuid,text) from authenticated;

commit;
