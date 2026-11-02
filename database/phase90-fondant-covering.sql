-- Phase 90 · Fondant covering on every designer cake (bento, Petite, Mini Tiered — every tier).
--
-- Why: customers can choose a smooth fondant covering instead of buttercream. The owner sets the extra price and
-- turns it on in Admin → Designs (Decorations), so it starts hidden at ₱0.
--
-- What it does: adds one design option per designer cake — group 'accent', code 'fondant', label 'Fondant',
-- ₱0, turned off. Fondant is checked and priced on the server exactly like any other decoration
-- (private.bento_design / private.bento_tier_design already validate and add every active 'accent' option), so no
-- function changes. The cake designer shows it as its own "Covering" choice (Buttercream / Fondant).
--
-- What it does NOT do: change any price, any other option, existing orders, or turn fondant on.
--
-- How to apply: rehearse with database/tests/phase90-rehearsal.sql (rolls itself back), then run this whole file
-- once in the Supabase SQL editor. Safe to run twice (an existing fondant option is left exactly as it is).

insert into public.design_options (product_id, group_key, code, label, price, hex, sort_order, is_active)
select p.id, 'accent', 'fondant', 'Fondant', 0, null, 0, false
  from public.products p where p.customization_config->>'designer' = 'bento'
on conflict (product_id, group_key, code) do nothing;

notify pgrst, 'reload schema';
