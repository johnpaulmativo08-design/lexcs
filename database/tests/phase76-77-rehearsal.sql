-- Phase 76 + 77 rehearsal · tests both on the real database WITHOUT saving anything.
--
-- Run this whole file at once in the Supabase SQL editor. It applies phase 76 (past expiry corrections) and phase 77
-- (12% VAT), then: corrects one active batch's expiry to a past date as the admin; places a pretend pickup order as a
-- customer and checks VAT, total and downpayment; changes that order's total the way an accepted extra charge does and
-- checks VAT again; confirms it and starts the first payment as the customer. It ends with an error on purpose: that
-- cancels the whole transaction, so nothing is saved.
--
-- Expected last line: ERROR: REHEARSAL REPORT (nothing was saved) … followed by PASS/FAIL for each check.

-- ===== phase 76 =====
do $$
declare def text; pat text := 'if new_exp is not null and new_exp < today and new_exp is distinct from b\.expires_on then\s*raise exception ''That expiry date has already passed[^;]*;\s*end if;\s*'; n int;
begin
  def := pg_get_functiondef('public.correct_inventory_batch(jsonb)'::regprocedure);
  if position('That expiry date has already passed' in def) = 0 then raise notice 'Already removed; nothing to do.'; return; end if;
  select count(*) into n from regexp_matches(def, pat, 'g');
  if n <> 1 then raise exception 'correct_inventory_batch is not the expected version; review before applying phase 76.'; end if;
  execute regexp_replace(def, pat, '');
end $$;

-- ===== phase 77 =====
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


do $rehearsal$
declare
  admin_id uuid; customer_id uuid; b record; v public.product_variants; slot_id uuid; res jsonb; ord public.orders; pay public.order_payment_attempts;
  report text := ''; ok boolean; base numeric; old_vat_orders int; method text; today date := (now() at time zone 'Asia/Manila')::date; past date;
begin
  select ur.user_id into admin_id from public.user_roles ur where ur.role = 'admin' limit 1;
  select u.id into customer_id from auth.users u join public.profiles p on p.id = u.id left join public.user_roles r on r.user_id = u.id
   where coalesce(r.role, 'customer') = 'customer' and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until < now())
   order by u.created_at limit 1;
  select count(*) into old_vat_orders from public.orders where vat_amount <> 0 or vat_rate <> 0;
  report := report || E'\n' || case when old_vat_orders = 0 then 'PASS' else 'FAIL' end || '  existing orders untouched (VAT 0 on all ' || (select count(*) from public.orders) || ')';

  -- phase 76: a past expiry is accepted now
  select bt.id, bt.stock_in_date into b from public.inventory_batches bt
   where bt.archived_at is null and bt.stock_in_date < today - 1 order by bt.stock_in_date desc limit 1;
  if b.id is null then report := report || E'\nSKIP  past expiry (no batch with an older stock-in date)';
  else
    past := greatest(b.stock_in_date, today - 1);
    perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true); perform set_config('role', 'authenticated', true);
    begin
      perform public.correct_inventory_batch(jsonb_build_object('batch_id', b.id, 'expires_on', past, 'reason', 'phase 76 rehearsal', 'request_id', gen_random_uuid()));
      report := report || E'\nPASS  expiry corrected to a past date (' || past || ')';
    exception when others then report := report || E'\nFAIL  past expiry refused: ' || sqlerrm; end;
    begin
      perform public.correct_inventory_batch(jsonb_build_object('batch_id', b.id, 'expires_on', b.stock_in_date - 1, 'reason', 'phase 76 rehearsal', 'request_id', gen_random_uuid()));
      report := report || E'\nFAIL  expiry before stock-in was allowed';
    exception when others then report := report || E'\nPASS  expiry before stock-in still refused'; end;
    perform set_config('role', 'postgres', true);
  end if;

  -- phase 77: a new order gets 12% VAT, all of it in the downpayment
  select pv.* into v from public.product_variants pv join public.products pr on pr.id = pv.product_id
   left join public.categories c on c.id = pr.category_id
   where pv.is_active and pv.min_qty <= 1 and pr.status = 'active' and pr.kind = 'standard' and (pr.category_id is null or c.is_active)
   order by pv.price desc limit 1;
  select s.id into slot_id from public.availability_slots s
   where s.is_open and s.starts_at > now() + interval '2 days'
     and (select count(*) from public.orders o where o.slot_id = s.id and o.status <> 'cancelled') < s.capacity
     and not exists (select 1 from public.booking_date_settings d where d.booking_date = (s.starts_at at time zone 'Asia/Manila')::date and (d.is_closed or (select count(*) from public.booking_entries e where e.booking_date = d.booking_date and e.status not in ('cancelled','completed')) >= d.capacity))
     and (select count(*) from public.booking_entries e where e.booking_date = (s.starts_at at time zone 'Asia/Manila')::date and e.status not in ('cancelled','completed')) < 6
   order by s.starts_at limit 1;
  select pm.code into method from public.payment_methods pm where pm.active order by pm.code limit 1;
  if slot_id is null or v.id is null then raise exception 'REHEARSAL could not place a pretend order.%', report; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', customer_id, 'role', 'authenticated')::text, true); perform set_config('role', 'authenticated', true);
  res := public.create_order(jsonb_build_object('request_id', gen_random_uuid(), 'name', 'Rehearsal', 'phone', '09171234567', 'fulfillment', 'pickup',
    'slot_id', slot_id, 'notes', 'phase 77 rehearsal', 'payment_method', method, 'items', jsonb_build_array(jsonb_build_object('variant_id', v.id, 'qty', 1))));
  perform set_config('role', 'postgres', true);
  select * into ord from public.orders where id = (res->>'id')::uuid;
  base := ord.items_subtotal + ord.customization_total + ord.rush_fee;
  ok := ord.vat_rate = 0.12 and ord.vat_amount = round(base * 0.12, 2) and ord.total_amount = base + round(base * 0.12, 2)
        and ord.deposit_due = round(base * ord.deposit_rate, 2) + round(base * 0.12, 2);
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  new order: amount ' || base || ', VAT ' || ord.vat_amount || ', total ' || ord.total_amount || ', downpayment ' || ord.deposit_due;

  -- total recomputed later (as an accepted extra charge does): VAT follows the new amount
  update public.orders set customization_total = customization_total + 50, extra_charge = extra_charge + 50, total_amount = base + 50 where id = ord.id returning * into ord;
  ok := ord.vat_amount = round((base + 50) * 0.12, 2) and ord.total_amount = base + 50 + round((base + 50) * 0.12, 2)
        and ord.deposit_due = round((base + 50) * ord.deposit_rate, 2) + round((base + 50) * 0.12, 2);
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  total recomputed (+50): VAT ' || ord.vat_amount || ', total ' || ord.total_amount || ', downpayment ' || ord.deposit_due;

  -- an unrelated change leaves the money alone
  update public.orders set notes = 'phase 77 rehearsal (edited)' where id = ord.id returning * into ord;
  ok := ord.total_amount = base + 50 + round((base + 50) * 0.12, 2);
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  other edits keep the same total';

  -- first payment = downpayment including all the VAT
  update public.orders set status = 'confirmed' where id = ord.id returning * into ord;
  perform set_config('role', 'authenticated', true);
  begin
    pay := public.start_order_payment(ord.id, method, 'downpayment');
    perform set_config('role', 'postgres', true);
    ok := pay.amount = ord.deposit_due and pay.payment_kind = 'downpayment';
    report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  first payment asks for ' || pay.amount || ' (' || pay.payment_kind || '); balance after it ' || (ord.total_amount - pay.amount);
  exception when others then perform set_config('role', 'postgres', true); report := report || E'\nFAIL  start payment raised: ' || sqlerrm; end;

  ok := position('to_char(o.total_amount,' in pg_get_functiondef('private.respond_order_extra(uuid,boolean)'::regprocedure)) > 0;
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  extra-charge chat message shows the total with VAT';

  raise exception 'REHEARSAL REPORT (nothing was saved — this error undoes everything):%', report;
end $rehearsal$;
