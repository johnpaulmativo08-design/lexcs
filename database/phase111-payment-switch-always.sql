-- Phase 111 · Payment method switches always work.
-- What this does, in plain words:
--   Phase 110 refused to hide a payment method while a customer had a payment "awaiting payment" with it, so
--   GCash and MariBank could not be switched off. Now the switch always works (at least one method still stays on).
--   A customer who had started paying with a method that is now hidden simply sees the method choice again on the
--   payment page and picks one that is shown. Nothing else about payments changes.
-- Safe to run more than once.
begin;
create or replace function private.set_payment_method_active(method_code text, turn_on boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m public.payment_methods;
begin
  if not (select private.is_admin()) then raise exception 'Only the admin can change payment methods.' using errcode = '42501'; end if;
  select * into m from public.payment_methods where code = method_code for update;
  if m.id is null then raise exception 'Unknown payment method.' using errcode = '22023'; end if;
  if not turn_on and (select count(*) from public.payment_methods where active and id <> m.id) = 0 then
    raise exception 'Keep at least one payment method on.' using errcode = '22023';
  end if;
  update public.payment_methods set active = turn_on, updated_at = now() where id = m.id;
  return jsonb_build_object('code', m.code, 'active', turn_on);
end $$;
revoke all on function private.set_payment_method_active(text, boolean) from public, anon, authenticated;
grant execute on function private.set_payment_method_active(text, boolean) to authenticated;
commit;
