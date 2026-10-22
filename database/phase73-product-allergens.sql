-- Phase 73 · Specifications and allergens on the product page, editable by the owner.
--
-- Why: the customer product page had an "Ingredients" tab that only said "not published yet", and its
-- Specifications rows were fixed in the code. The owner wants to edit both from Admin → Products → Edit product,
-- and wants each pastry's allergens listed for customers.
--
-- What it does:
--   1. Two new columns on public.products (the shop already reads every product column):
--        specifications — the owner's rows, [ { "label": "Ordering", "value": "Made to order…" }, … ].
--                         null = the shop shows its standard rows. Category and sizes are always added by the shop.
--        allergens      — { "auto": false, "list": ["Milk","Eggs"], "note": "…" } chosen by the owner, or
--                         { "auto": true, "list": [], "note": "…" } = list worked out from the recipe (step 2) plus
--                         the owner's note. null = worked out from the recipe, no note.
--   2. public.get_product_allergens(target_product) — read-only, open to everyone. Looks at the product's ACTIVE
--      recipe only, skips packaging lines, and matches each ingredient's inventory name against the common food
--      allergens (Milk, Eggs, Wheat / gluten, Soy, Peanuts, Tree nuts). Returns
--        { has_recipe, allergens: [ { name, from: [ingredient names], always } ] }
--      "always" is false when the ingredient is only used for some sizes or flavors. Quantities, costs and stock
--      are never returned; recipes stay admin-only to read.
--   3. public.save_product_details(target_product, specifications, allergens) — admin only; checks the shape and
--      length of both values and saves them. Nothing else on the product changes.
--
-- What it does NOT do: change orders, payments, inventory, recipes, save_product or any policy.
--
-- Name matching: a new inventory item named clearly (e.g. "Peanut Butter", "Cream Cheese", "Graham Crackers")
-- is picked up automatically. Chocolate counts as Milk and Soy, Oreo as Wheat and Soy, and oats as Wheat / gluten,
-- because bakery-grade versions usually contain or are processed with them.

-- 1. Columns ------------------------------------------------------------------------------------------------
alter table public.products add column if not exists specifications jsonb;
alter table public.products add column if not exists allergens jsonb;
alter table public.products drop constraint if exists products_specifications_shape;
alter table public.products add constraint products_specifications_shape
  check (specifications is null or (jsonb_typeof(specifications) = 'array' and jsonb_array_length(specifications) <= 12));
alter table public.products drop constraint if exists products_allergens_shape;
alter table public.products add constraint products_allergens_shape
  check (allergens is null or (jsonb_typeof(allergens) = 'object' and jsonb_typeof(allergens->'list') = 'array'));

-- 2. Allergens worked out from the recipe ------------------------------------------------------------------
create or replace function private.product_allergens(target_product uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with recipe as (
    select r.id from public.product_recipes r
    where r.product_id = target_product and r.status = 'active'
    limit 1
  ), lines as (
    select i.name, lower(i.name) as n, coalesce(lower(i.category), '') as c, (l.condition = '{}'::jsonb) as always
    from public.recipe_lines l join public.inventory_items i on i.id = l.item_id
    where l.recipe_id = (select id from recipe) and l.line_group <> 'packaging'
  ), found as (
    select a.name as allergen, a.sort, lines.name as item, lines.always
    from lines cross join lateral (values
      (1, 'Milk',           lines.n ~ '(milk|butter|cheese|cream|creamer|yogurt|yoghurt|whey|chocolate|choco|icing|frosting|ganache|caramel)' and lines.n !~ 'peanut butter'),
      (2, 'Eggs',           lines.n ~ '(\megg|mayonnaise|meringue)'),
      (3, 'Wheat / gluten', lines.n ~ '(flour|wheat|oreo|biscuit|graham|wafer|cookie|bread|crumb|oat)'),
      (4, 'Soy',            lines.n ~ '(soy|lecithin|chocolate|choco|oreo)'),
      (5, 'Peanuts',        lines.n ~ 'peanut'),
      (6, 'Tree nuts',      lines.n ~ '(cashew|walnut|almond|pecan|pistachio|hazelnut|macadamia|nutella|praline)' or (lines.c = 'nuts' and lines.n !~ 'peanut'))
    ) as a(sort, name, hit)
    where a.hit
  )
  select jsonb_build_object(
    'has_recipe', exists (select 1 from recipe),
    'allergens', coalesce((
      select jsonb_agg(jsonb_build_object('name', allergen, 'from', items, 'always', always) order by sort)
      from (select allergen, sort, array_agg(distinct item order by item) as items, bool_or(always) as always
            from found group by allergen, sort) g
    ), '[]'::jsonb))
$$;
revoke all on function private.product_allergens(uuid) from public;
grant execute on function private.product_allergens(uuid) to anon, authenticated;

create or replace function public.get_product_allergens(target_product uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$ select private.product_allergens(target_product) $$;
revoke all on function public.get_product_allergens(uuid) from public;
grant execute on function public.get_product_allergens(uuid) to anon, authenticated;

-- 3. Owner saves specifications and allergens -------------------------------------------------------------
create or replace function private.save_product_details(target_product uuid, specs jsonb, allergen_info jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare row_item jsonb; clean_specs jsonb := '[]'::jsonb; clean_list jsonb := '[]'::jsonb; a text; note text; is_auto boolean;
begin
  perform private.require_admin();
  if not exists (select 1 from public.products where id = target_product) then raise exception 'Product not found.'; end if;

  if specs is not null then
    if jsonb_typeof(specs) <> 'array' then raise exception 'Specifications must be a list.'; end if;
    for row_item in select value from jsonb_array_elements(specs) loop
      if btrim(coalesce(row_item->>'label', '')) = '' or btrim(coalesce(row_item->>'value', '')) = '' then continue; end if;
      if length(row_item->>'label') > 60 or length(row_item->>'value') > 300 then raise exception 'A specification is too long (label up to 60, text up to 300 characters).'; end if;
      clean_specs := clean_specs || jsonb_build_array(jsonb_build_object('label', btrim(row_item->>'label'), 'value', btrim(row_item->>'value')));
    end loop;
    if jsonb_array_length(clean_specs) > 12 then raise exception 'Up to 12 specification rows.'; end if;
  end if;

  if allergen_info is not null then
    if jsonb_typeof(allergen_info) <> 'object' or jsonb_typeof(coalesce(allergen_info->'list', '[]'::jsonb)) <> 'array' then raise exception 'Allergens must be a list.'; end if;
    for a in select distinct btrim(value) from jsonb_array_elements_text(coalesce(allergen_info->'list', '[]'::jsonb)) loop
      if a = '' then continue; end if;
      if length(a) > 40 then raise exception 'An allergen name is too long.'; end if;
      clean_list := clean_list || to_jsonb(a);
    end loop;
    if jsonb_array_length(clean_list) > 20 then raise exception 'Up to 20 allergens.'; end if;
    note := btrim(coalesce(allergen_info->>'note', ''));
    is_auto := coalesce((allergen_info->>'auto')::boolean, false);
    if is_auto then clean_list := '[]'::jsonb; end if;
    if length(note) > 300 then raise exception 'The allergen note is too long (up to 300 characters).'; end if;
  end if;

  update public.products set
    specifications = case when specs is null then null else clean_specs end,
    allergens = case when allergen_info is null then null else jsonb_build_object('auto', is_auto, 'list', clean_list, 'note', note) end
  where id = target_product;
end $$;
revoke all on function private.save_product_details(uuid, jsonb, jsonb) from public;
grant execute on function private.save_product_details(uuid, jsonb, jsonb) to authenticated;

create or replace function public.save_product_details(target_product uuid, specs jsonb, allergen_info jsonb) returns void
language sql security invoker set search_path = '' as $$ select private.save_product_details(target_product, specs, allergen_info) $$;
revoke all on function public.save_product_details(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.save_product_details(uuid, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';
