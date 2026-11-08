-- Phase 105 · Voucher wallet: vouchers customers can see and pick at checkout.
-- What this does, in plain words:
--   1. Adds vouchers.show_to_customers (default off). Only vouchers the owner switches on are ever listed; any
--      other code still works when typed, exactly as in phase 103.
--   2. public.set_voucher_shown(target, shown): admin-only switch for that flag.
--   3. public.available_vouchers(items): for the signed-in customer, the shown vouchers that are active, in date,
--      not used up and not already used by them. With cart items it also says whether each one fits the cart and
--      the discount it would give, using the same checks as preview_voucher. Nothing is reserved or saved.
-- The discount on an order is still worked out only by create_order (phase 103). Safe to run more than once.
begin;

alter table public.vouchers add column if not exists show_to_customers boolean not null default false;

create or replace function private.set_voucher_shown(target uuid, shown boolean) returns public.vouchers
language plpgsql security definer set search_path = '' as $$
declare v public.vouchers;
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'Admin access required.' using errcode = '42501'; end if;
  update public.vouchers set show_to_customers = coalesce(shown, false), updated_at = now() where id = target returning * into v;
  if v.id is null then raise exception 'Voucher not found.' using errcode = '22023'; end if;
  return v;
end $$;
revoke all on function private.set_voucher_shown(uuid, boolean) from public;
grant execute on function private.set_voucher_shown(uuid, boolean) to authenticated;
create or replace function public.set_voucher_shown(target uuid, shown boolean) returns public.vouchers
language sql security invoker set search_path = '' as $$ select private.set_voucher_shown(target, shown) $$;
revoke all on function public.set_voucher_shown(uuid, boolean) from public, anon;
grant execute on function public.set_voucher_shown(uuid, boolean) to authenticated;

create or replace function public.available_vouchers(items jsonb default '[]'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v public.vouchers; result jsonb := '[]'::jsonb; preview jsonb; reason text; used integer; mine integer;
begin
  if auth.uid() is null then return '[]'::jsonb; end if;
  for v in select * from public.vouchers where show_to_customers and is_active
             and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now())
           order by ends_at nulls last, created_at desc limit 30 loop
    select count(*) into used from public.voucher_redemptions r join public.orders o on o.id = r.order_id where r.voucher_id = v.id and o.status <> 'cancelled';
    continue when v.usage_limit is not null and used >= v.usage_limit;
    select count(*) into mine from public.voucher_redemptions r join public.orders o on o.id = r.order_id
     where r.voucher_id = v.id and r.customer_id = auth.uid() and o.status <> 'cancelled';
    continue when mine >= v.per_customer_limit;
    preview := null; reason := null;
    if jsonb_typeof(items) = 'array' and jsonb_array_length(items) > 0 then
      begin preview := public.preview_voucher(v.code, items);
      exception when others then reason := sqlerrm; end;
    end if;
    result := result || jsonb_build_object('code', v.code, 'description', v.description, 'type', v.discount_type, 'value', v.discount_value,
      'min_purchase', v.min_purchase, 'max_discount', v.max_discount, 'ends_at', v.ends_at, 'applies_to', v.applies_to,
      'fits', preview is not null, 'discount', preview->'discount', 'reason', reason);
  end loop;
  return result;
end $$;
revoke all on function public.available_vouchers(jsonb) from public, anon;
grant execute on function public.available_vouchers(jsonb) to authenticated;

commit;
notify pgrst, 'reload schema';
