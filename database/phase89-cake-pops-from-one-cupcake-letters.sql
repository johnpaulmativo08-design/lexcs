-- Phase 89 · Cake pops from 1 piece, and fondant letters on both cupcake sizes.
--
-- Why: customers can now order any number of cake pops from 1 to 300 (the designer caps at 300), and the cupcake
-- designer has its own "4 · Message" step where letters can go on mini and 3oz cupcakes alike.
--
-- What it does:
--   1. The cake pop "Per piece" option's minimum goes from 12 to 1 (price unchanged).
--   2. Every cupcake product has the "Fondant letters" message option switched on (added if missing, free — the same
--      as mini cupcakes today). The letters themselves are still checked by private.letter_pieces (1–5 per cupcake).
--
-- What it does NOT do: change any price, other options, existing orders, payments or inventory.
--
-- How to apply: rehearse with database/tests/phase89-rehearsal.sql (rolls itself back), then run this whole file
-- once in the Supabase SQL editor. Safe to re-run.

update public.product_variants set min_qty = 1
 where code = 'piece' and min_qty <> 1
   and product_id in (select id from public.products where customization_config->>'designer' = 'cakepop');

insert into public.design_options (product_id, group_key, code, label, price, hex, sort_order, is_active)
select p.id, 'message', 'letters', 'Fondant letters', 0, null, 2, true
  from public.products p where p.customization_config->>'designer' = 'cupcake'
on conflict (product_id, group_key, code) do update set is_active = true;
