-- Phase 77 · 12% VAT, added on top of the order and paid in full with the first payment.
--
-- Why: the owner charges VAT. Prices stay as shown in the shop; 12% VAT of the order amount is added, and all of it
-- is collected with the customer's first payment (the downpayment, or the full payment). The remaining balance is
-- VAT-free.
--
-- What it does:
--   1. Two new columns on public.orders: vat_rate (0.12 for new orders; 0 for every order placed before this, so their
--      amounts never change) and vat_amount (pesos).
--   2. A last "before save" step on orders (trigger orders_vat; named so it runs after the delivery-fee, payment-prep
--      and rush-fee steps). Whenever the order total is set — when the order is placed, or when it is recomputed
--      later (for example after the customer accepts an extra charge) — it treats that total as the amount before VAT
--      and sets:
--          vat_amount  = round(amount × vat_rate, 2)
--          total       = amount + vat_amount
--          downpayment = round(amount × deposit_rate, 2) + vat_amount      ← the whole VAT is in the first payment
--      The payment functions already charge the downpayment first, then total − paid, so nothing else changes there.
--   3. The orders table's built-in check "orders_amounts_match" (total = items + designs + delivery + rush fee;
--      downpayment = 60% of the total) now counts VAT: total = those + VAT; downpayment = 60% of those + all the VAT.
--      Older orders have VAT 0, so they pass exactly as before.
--   4. The chat line "The customer accepted the new price — new total ₱…" now shows the total with VAT.
--
-- What it does NOT do: change prices, discounts, the 60% rate, the rush fee, payment verification, inventory, or any
-- existing order.
--
-- How to apply: rehearse with database/tests/phase76-77-rehearsal.sql (rolls itself back), then run this whole file
-- once in the Supabase SQL editor.

alter table public.orders add column if not exists vat_rate numeric(5,4) not null default 0;
alter table public.orders add column if not exists vat_amount numeric(12,2) not null default 0;
alter table public.orders alter column vat_rate set default 0.12;
alter table public.orders drop constraint if exists orders_vat_shape;
alter table public.orders add constraint orders_vat_shape check (vat_rate >= 0 and vat_rate < 1 and vat_amount >= 0);
-- the built-in "amounts add up" check now counts VAT: total = parts + VAT; downpayment = 60% of the parts + all the VAT
alter table public.orders drop constraint if exists orders_amounts_match;
alter table public.orders add constraint orders_amounts_match check (
  (delivery_fee_status = 'unquoted' and delivery_fee is null and total_amount is null and deposit_due is null)
  or (delivery_fee_status <> 'unquoted' and delivery_fee is not null
      and total_amount = items_subtotal + customization_total + delivery_fee + rush_fee + vat_amount
      and deposit_due = round((total_amount - vat_amount) * deposit_rate, 2) + vat_amount));

create or replace function private.order_vat() returns trigger
language plpgsql set search_path = '' as $$
declare amount numeric(12,2);
begin
  if tg_op = 'UPDATE' and new.total_amount is not distinct from old.total_amount then return new; end if;
  if new.total_amount is null then new.vat_amount := 0; return new; end if;
  amount := new.total_amount;                       -- the order amount before VAT, as just worked out
  new.vat_amount := round(amount * new.vat_rate, 2);
  new.total_amount := amount + new.vat_amount;
  new.deposit_due := round(amount * new.deposit_rate, 2) + new.vat_amount;
  return new;
end $$;
revoke all on function private.order_vat() from public;
drop trigger if exists orders_vat on public.orders;
create trigger orders_vat before insert or update of total_amount on public.orders
  for each row execute function private.order_vat();

do $$
declare def text; a text := 'to_char(total, ''FM999,999,990.00'')';
begin
  def := pg_get_functiondef('private.respond_order_extra(uuid,boolean)'::regprocedure);
  if position('to_char(o.total_amount,' in def) > 0 then return; end if;
  if (length(def) - length(replace(def, a, ''))) / length(a) <> 1 then
    raise exception 'private.respond_order_extra is not the expected version; review before applying phase 77.';
  end if;
  execute replace(def, a, 'to_char(o.total_amount, ''FM999,999,990.00'')');
end $$;

notify pgrst, 'reload schema';
