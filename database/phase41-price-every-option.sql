-- Phase 41: every designer option can carry an extra price, set by Admin in Designer options.
-- Until now the server ignored the price of colors, message fonts, flavors and the cake pop shape (they were always
-- free). All of those are still ₱0, so nothing changes for customers until Admin sets a price.
-- How it is charged (once per cake or box, like every other extra):
--   * a color: once for each distinct color used (frosting, drip, ribbon, lettering, glaze, sprinkle or letter color)
--   * a flavor: once for each chosen flavor ("Mixed flavors" keeps its own price)
--   * a message font: when the bento has a message;  * the cake pop shape: round or donut pops
-- The design functions are unchanged: the extra is added on top of their result in private.option_surcharge, which
-- the quote functions (designer prices) and private.product_design (checkout) now both use.
begin;

create or replace function private.option_surcharge(p_product public.products, result jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  d jsonb := result->'clean'; designer text := result->'clean'->>'designer';
  picks jsonb := '[]';   -- [group_key, code, label suffix]
  extra numeric(12,2) := coalesce((result->>'extra')::numeric, 0); priced jsonb := coalesce(result->'clean'->'extras', '[]'); r record;
begin
  if d is null then return result; end if;
  if designer = 'bento' then
    picks := (select coalesce(jsonb_agg(distinct jsonb_build_array('color', c, ' color')), '[]') from unnest(array[d->>'frosting_color', d->>'drip_color', d->>'bow_color', d->>'lettering_color']) c where c is not null);
    if d->>'message' is not null and d->>'font' is not null then picks := picks || jsonb_build_array(jsonb_build_array('font', d->>'font', ' font')); end if;
  elsif designer = 'cupcake' then
    picks := jsonb_build_array(jsonb_build_array('flavor', d->>'flavor', ' flavor'))
      || (select coalesce(jsonb_agg(distinct jsonb_build_array('color', c, ' color')), '[]') from (
            select jsonb_array_elements_text(coalesce(d->'a'->'colors', '[]')) c
            union select jsonb_array_elements_text(case when jsonb_typeof(d->'b'->'colors') = 'array' then d->'b'->'colors' else '[]' end)) x);
  elsif designer in ('donut', 'cakepop') then
    picks := (select coalesce(jsonb_agg(distinct jsonb_build_array('flavor', c, ' flavor')), '[]') from jsonb_array_elements_text(coalesce(d->'flavors', '[]')) c)
      || (select coalesce(jsonb_agg(distinct jsonb_build_array('color', c, ' color')), '[]') from (
            select jsonb_array_elements_text(coalesce(d->'glazes', '[]')) c
            union select jsonb_array_elements_text(coalesce(d->'sprinkle_colors', '[]'))
            union select d->>'message_color' where d->>'message_color' is not null) x);
    if designer = 'cakepop' then picks := picks || jsonb_build_array(jsonb_build_array('style', d->>'style', '')); end if;
  else return result; end if;

  for r in
    select o.label || (p->>2) as label, o.price from jsonb_array_elements(picks) p
    join public.design_options o on o.product_id = p_product.id and o.group_key = p->>0 and o.code = p->>1
    where o.price > 0 order by o.group_key, o.sort_order
  loop
    extra := extra + r.price; priced := priced || jsonb_build_object('label', r.label, 'price', r.price);
  end loop;
  return jsonb_build_object('clean', d || jsonb_build_object('extras', priced, 'extras_per_item', extra), 'extra', extra);
end $$;
revoke all on function private.option_surcharge(public.products, jsonb) from public;
grant execute on function private.option_surcharge(public.products, jsonb) to anon, authenticated;

-- Checkout prices designs through the dispatcher.
create or replace function private.product_design(p_product public.products, custom jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  r := case p_product.customization_config->>'designer'
    when 'bento' then private.bento_design(p_product, custom)
    when 'cupcake' then private.cupcake_design(p_product, custom)
    when 'donut' then private.donut_design(p_product, custom)
    when 'cakepop' then private.cakepop_design(p_product, custom)
    else null end;
  return case when r is null then null else private.option_surcharge(p_product, r) end;
end $$;

-- The designers' live price quotes (same functions, the result now goes through option_surcharge).
do $$
declare f text; def text; call text;
begin
  foreach f in array array['bento', 'cupcake', 'donut', 'cakepop'] loop
    def := pg_get_functiondef(('public.quote_' || f || '_design(uuid,jsonb)')::regprocedure);
    call := 'return private.' || f || '_design(p, p_design);';
    if position('option_surcharge' in def) > 0 then continue; end if;
    if position(call in def) = 0 then raise exception 'Phase 41: public.quote_%_design is not the expected version; nothing was changed.', f; end if;
    execute replace(def, call, 'return private.option_surcharge(p, private.' || f || '_design(p, p_design));');
  end loop;
end $$;

commit;
