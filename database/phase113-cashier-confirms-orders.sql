-- Phase 113 · Cashiers can confirm orders.
-- What this does, in plain words:
--   Phase 112 let a cashier move an order along (Start making → Ready → Completed) but not confirm or cancel it.
--   The owner now wants cashiers to confirm new orders too (Orders → View → Confirm order).
--   Cancelling an order stays with the owner only.
--   Only the cashier limit inside set_order_status changes; everything else in that function stays exactly as it
--   is on this database (it is re-created from its current definition, and stops if the limit is not found).
-- Run once in the Supabase SQL editor. Safe to run again.
begin;
do $$
declare def text;
begin
  def := pg_get_functiondef('private.set_order_status(uuid,text)'::regprocedure);
  if position('Only the owner can confirm or cancel orders' in def) = 0 and position('Only the owner can cancel orders' in def) = 0 then
    raise exception 'Phase 113 stopped: run phase 112 first (the cashier limit is missing).';
  end if;
  def := replace(def, 'next_status not in (''preparing'', ''ready'', ''completed'')', 'next_status not in (''confirmed'', ''preparing'', ''ready'', ''completed'')');
  def := replace(def, 'Only the owner can confirm or cancel orders.', 'Only the owner can cancel orders.');
  if position('''confirmed'', ''preparing'', ''ready'', ''completed''' in def) = 0 then raise exception 'Phase 113 stopped: could not widen the cashier limit.'; end if;
  execute def;
end $$;
commit;
