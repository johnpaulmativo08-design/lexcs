-- Phase 91 · "Frosting top / bottom" names and a custom-words topper on every designer cake.
--
-- Why: the owner calls the piped shells "Frosting top" and "Frosting bottom", and customers can now write their own
-- words on the topper (up to 14 letters).
--
-- What it does:
--   1. Renames the shell border options: "Shell border — top" → "Frosting top", "Shell border — bottom" →
--      "Frosting bottom" (labels only; codes and prices stay the same, so existing orders and designs still work).
--   2. Adds a "Custom topper" option (code 'custom', ₱3 like the other toppers, offered) to every designer cake.
--      The owner can change its price or hide it in Admin → Designs.
--   3. private.bento_design (quote_bento_design and create_order) accepts the custom topper: 1–14 characters of
--      letters, numbers, spaces and ! & ' . - ; anything else is refused. In-place patch with an exact-match guard.
--
-- What it does NOT do: change any price, the number topper, or existing orders.
--
-- How to apply: rehearse with database/tests/phase91-rehearsal.sql (rolls itself back), then run this whole file
-- once in the Supabase SQL editor. Safe to run twice.

-- 1. names
update public.design_options set label = 'Frosting top', updated_at = now()
 where group_key = 'border' and code = 'shell_top' and label <> 'Frosting top';
update public.design_options set label = 'Frosting bottom', updated_at = now()
 where group_key = 'border' and code = 'shell_bottom' and label <> 'Frosting bottom';

-- 2. the custom topper option
insert into public.design_options (product_id, group_key, code, label, price, hex, sort_order, is_active)
select p.id, 'topper', 'custom', 'Custom topper', 3, null, 5, true
  from public.products p where p.customization_config->>'designer' = 'bento'
on conflict (product_id, group_key, code) do nothing;

-- 3. the server accepts the custom words
do $$
declare def text;
  a1 text := '  else topper_text := null; end if;';
  b1 text := '  elsif topper = ''custom'' then                                                   -- phase 91: own words, up to 14
    if topper_text is null or char_length(topper_text) > 14 or topper_text !~ ''^[A-Za-z0-9 !&''''.-]+$'' then
      raise exception ''Write up to 14 letters for the custom topper.'' using errcode = ''22023''; end if;
  else topper_text := null; end if;';
  n int;
begin
  def := pg_get_functiondef('private.bento_design(public.products,jsonb)'::regprocedure);
  if position('phase 91: own words' in def) > 0 then raise notice 'bento_design already accepts the custom topper.'; return; end if;
  n := (length(def) - length(replace(def, a1, ''))) / length(a1);
  if n <> 1 then raise exception 'private.bento_design is not the expected version; review before applying phase 91.'; end if;
  execute replace(def, a1, b1);
end $$;

notify pgrst, 'reload schema';
