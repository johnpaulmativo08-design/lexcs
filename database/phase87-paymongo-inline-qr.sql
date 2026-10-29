-- Phase 87 · PayMongo QR Ph shown on LexC's own payment page (and a direct GCash button).
--
-- Why: instead of sending customers to PayMongo's checkout page, the payment page now shows the QR Ph code itself
-- (scan it with GCash, Maya or any bank app) or opens GCash directly. Both use a PayMongo "payment intent" (pi_…)
-- instead of a "checkout session" (cs_…).
--
-- What it does: private.paymongo_attach_checkout now also accepts a payment intent id (pi_…), so the attempt
-- remembers which intent its QR / GCash payment belongs to. A new QR (after the 30-minute one expires) replaces it.
-- paymongo_record_payment already looks the attempt up by that id, so the webhook's "payment.paid" event lands on the
-- right attempt exactly as before: "verification pending", and LexC's still confirms it.
--
-- What it does NOT do: change amounts, statuses or who may call what (still service role only).
--
-- How to apply: run this whole file once in the Supabase SQL editor (rehearsal: database/tests/phase87-rehearsal.sql).
-- Safe to run twice.

create or replace function private.paymongo_attach_checkout(target_payment uuid, checkout_id text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(checkout_id, '') !~ '^(cs|pi)_[A-Za-z0-9]+$' then raise exception 'Invalid checkout id.'; end if;
  update public.order_payment_attempts set provider = 'paymongo', provider_checkout_id = checkout_id
   where id = target_payment and status = 'awaiting_payment';
  if not found then raise exception 'Payment attempt is not awaiting payment.'; end if;
end $$;
revoke all on function private.paymongo_attach_checkout(uuid, text) from public;
grant execute on function private.paymongo_attach_checkout(uuid, text) to service_role;
