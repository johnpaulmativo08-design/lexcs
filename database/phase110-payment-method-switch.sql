-- Phase 110 · Turn payment methods on or off from Admin → Settings.
-- What this does, in plain words:
--   The owner can hide or show GCash, MariBank and QRPh at checkout and on the payment page with one switch
--   (public.payment_methods.active, which customers already filter on). Only the admin can do this.
--   Safety checks:
--     - at least one payment method always stays on;
--     - a method cannot be turned off while a customer is in the middle of paying with it
--       (a payment "awaiting payment"): the owner is told how many and can try again later.
--   Nothing else about payments changes: amounts, proofs and owner verification work exactly as before.
-- Safe to run more than once.
begin;

create or replace function private.set_payment_method_active(method_code text, turn_on boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m public.payment_methods; open_count integer;
begin
  if not (select private.is_admin()) then raise exception 'Only the admin can change payment methods.' using errcode = '42501'; end if;
  select * into m from public.payment_methods where code = method_code for update;
  if m.id is null then raise exception 'Unknown payment method.' using errcode = '22023'; end if;
  if not turn_on then
    if (select count(*) from public.payment_methods where active and id <> m.id) = 0 then
      raise exception 'Keep at least one payment method on.' using errcode = '22023';
    end if;
    select count(*) into open_count from public.order_payment_attempts where payment_method_id = m.id and status = 'awaiting_payment';
    if open_count > 0 then
      raise exception '% customer(s) are paying with % right now. Try again after they finish.', open_count, m.display_name using errcode = '22023';
    end if;
  end if;
  update public.payment_methods set active = turn_on, updated_at = now() where id = m.id;
  return jsonb_build_object('code', m.code, 'active', turn_on);
end $$;
revoke all on function private.set_payment_method_active(text, boolean) from public, anon, authenticated;
grant execute on function private.set_payment_method_active(text, boolean) to authenticated;

create or replace function public.set_payment_method_active(method_code text, turn_on boolean) returns jsonb
language sql security invoker set search_path = '' as $$ select private.set_payment_method_active(method_code, turn_on) $$;
revoke all on function public.set_payment_method_active(text, boolean) from public, anon;
grant execute on function public.set_payment_method_active(text, boolean) to authenticated;

commit;
