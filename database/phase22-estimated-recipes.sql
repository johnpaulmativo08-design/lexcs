-- Phase 22: ESTIMATED recipes for the 14 products that had no costing sheet.
-- Standard home-bakery amounts (not LexC measurements), activated so every product deducts.
-- Names end in "(estimated)"; correct them in Admin → Inventory → Recipes after weighing a real batch.
-- Fresh bananas and carrots are not stocked, so they are not deducted.
-- Safe to re-run: a product that already has a recipe with the same key is skipped.
do $$
declare
  actor uuid := private.actor_profile();
  spec jsonb := $j$[
   {"slug":"product-9","name":"Classic Banana Muffin (estimated)","yield":12,"units":{"option-1":6,"option-2":12},"lines":[
     ["All Purpose Flour",250,"g"],["White Sugar",100,"g"],["Brown Sugar",50,"g"],["Egg",2,"pcs"],["Butter",115,"g"],["Full Cream Milk",60,"mL"],
     ["Baking Soda",5,"g"],["Salt",2,"g"],["Vanilla Extract",5,"mL"]],"pack":"muffin"},
   {"slug":"product-10","name":"Choco Banana Muffin (estimated)","yield":12,"units":{"option-1":6,"option-2":12},"lines":[
     ["All Purpose Flour",230,"g"],["White Sugar",100,"g"],["Brown Sugar",50,"g"],["Cocoa",30,"g"],["Egg",2,"pcs"],["Butter",115,"g"],["Full Cream Milk",60,"mL"],
     ["Baking Soda",5,"g"],["Salt",2,"g"],["Vanilla Extract",5,"mL"],["Chocolate Chips",100,"g","topping"]],"pack":"muffin"},
   {"slug":"product-11","name":"Carrot Muffin (estimated)","yield":12,"units":{"option-1":6,"option-2":12},"lines":[
     ["All Purpose Flour",200,"g"],["Brown Sugar",150,"g"],["Oil",120,"mL"],["Egg",2,"pcs"],["Baking Soda",5,"g"],["Baking Powder",5,"g"],["Salt",2,"g"],
     ["Cinnamon",5,"g"],["Vanilla Extract",5,"mL"],["Cream Cheese",0.5,"pcs","topping"],["Powdered Sugar",120,"g","topping"],["Butter",30,"g","topping"]],"pack":"muffin"},
   {"slug":"product-12","name":"Assorted Muffin Box (estimated)","yield":12,"units":{"option-1":6,"option-2":12},"lines":[
     ["All Purpose Flour",227,"g"],["White Sugar",67,"g"],["Brown Sugar",83,"g"],["Egg",2,"pcs"],["Butter",87,"g"],["Oil",40,"mL"],["Full Cream Milk",40,"mL"],
     ["Cocoa",10,"g"],["Baking Soda",5,"g"],["Salt",2,"g"],["Vanilla Extract",5,"mL"],["Chocolate Chips",33,"g","topping"],["Cream Cheese",0.17,"pcs","topping"],["Powdered Sugar",40,"g","topping"]],"pack":"muffin"},
   {"slug":"product-13","name":"Carrot Loaf – Loaded (estimated)","yield":1,"units":{"option-1":1},"lines":[
     ["All Purpose Flour",200,"g"],["Brown Sugar",150,"g"],["Oil",120,"mL"],["Egg",2,"pcs"],["Baking Soda",5,"g"],["Baking Powder",3,"g"],["Cinnamon",5,"g"],["Salt",2,"g"],
     ["Walnut",40,"g","topping"],["Cream Cheese",0.5,"pcs","topping"],["Powdered Sugar",100,"g","topping"],["Butter",30,"g","topping"]],"pack":"sticker"},
   {"slug":"product-17","name":"Banana Loaf – Mini (estimated)","yield":4,"units":{"option-1":1,"option-2":1},"lines":[
     ["All Purpose Flour",250,"g"],["White Sugar",100,"g"],["Brown Sugar",50,"g"],["Egg",2,"pcs"],["Butter",115,"g"],["Full Cream Milk",60,"mL"],["Baking Soda",5,"g"],["Salt",2,"g"],["Vanilla Extract",5,"mL"],
     ["Cocoa",30,"g","ingredient","option-2"],["Chocolate Chips",60,"g","topping","option-2"]],"pack":"sticker"},
   {"slug":"product-18","name":"Banana Loaf – Classic (estimated)","yield":1,"units":{"option-1":1,"option-2":1},"lines":[
     ["All Purpose Flour",250,"g"],["White Sugar",100,"g"],["Brown Sugar",50,"g"],["Egg",2,"pcs"],["Butter",115,"g"],["Full Cream Milk",60,"mL"],["Baking Soda",5,"g"],["Salt",2,"g"],["Vanilla Extract",5,"mL"],
     ["Cocoa",30,"g","ingredient","option-2"],["Chocolate Chips",60,"g","topping","option-2"]],"pack":"sticker"},
   {"slug":"product-19","name":"Brownies – Bite-Sized (estimated)","yield":40,"units":{"option-1":20},"lines":[
     ["All Purpose Flour",100,"g"],["Cocoa",60,"g"],["White Sugar",250,"g"],["Butter",170,"g"],["Egg",3,"pcs"],["Vanilla Extract",5,"mL"],["Salt",2,"g"],["Dark Chocolate",100,"g"]],"pack":"tub"},
   {"slug":"product-20","name":"Brownies – Regular (estimated)","yield":20,"units":{"option-1":15,"option-2":30},"lines":[
     ["All Purpose Flour",100,"g"],["Cocoa",60,"g"],["White Sugar",250,"g"],["Butter",170,"g"],["Egg",3,"pcs"],["Vanilla Extract",5,"mL"],["Salt",2,"g"],["Dark Chocolate",100,"g"]],"pack":"sticker"},
   {"slug":"product-21","name":"Brownies Tower (estimated)","yield":20,"units":{"option-1":24},"lines":[
     ["All Purpose Flour",100,"g"],["Cocoa",60,"g"],["White Sugar",250,"g"],["Butter",170,"g"],["Egg",3,"pcs"],["Vanilla Extract",5,"mL"],["Salt",2,"g"],["Dark Chocolate",100,"g"]],"pack":"sticker"},
   {"slug":"product-22","name":"Crinkles – Bite-Sized (estimated)","yield":48,"units":{"option-1":20},"lines":[
     ["All Purpose Flour",240,"g"],["Cocoa",60,"g"],["White Sugar",200,"g"],["Oil",60,"mL"],["Egg",3,"pcs"],["Baking Powder",8,"g"],["Salt",2,"g"],["Vanilla Extract",5,"mL"],["Powdered Sugar",80,"g","topping"]],"pack":"tub"},
   {"slug":"product-23","name":"Crinkles – Regular (estimated)","yield":24,"units":{"option-1":15,"option-2":30},"lines":[
     ["All Purpose Flour",240,"g"],["Cocoa",60,"g"],["White Sugar",200,"g"],["Oil",60,"mL"],["Egg",3,"pcs"],["Baking Powder",8,"g"],["Salt",2,"g"],["Vanilla Extract",5,"mL"],["Powdered Sugar",80,"g","topping"]],"pack":"sticker"},
   {"slug":"product-24","name":"Lava Crinkles (estimated)","yield":24,"units":{"option-1":6,"option-2":12},"lines":[
     ["All Purpose Flour",240,"g"],["Cocoa",60,"g"],["White Sugar",200,"g"],["Oil",60,"mL"],["Egg",3,"pcs"],["Baking Powder",8,"g"],["Salt",2,"g"],["Vanilla Extract",5,"mL"],["Powdered Sugar",80,"g","topping"],
     ["Dark Chocolate",5,"g","topping","","per_unit"]],"pack":"cookiebox"},
   {"slug":"product-8","name":"Bento Cake – Chocolate Moist (estimated)","yield":2,"units":{"option-1":1,"option-2":1},"lines":[
     ["All Purpose Flour",120,"g"],["White Sugar",150,"g"],["Cocoa",40,"g"],["Baking Soda",4,"g"],["Baking Powder",3,"g"],["Salt",1,"g"],["Egg",1,"pcs"],["Oil",60,"mL"],["Full Cream Milk",120,"mL"],["Vanilla Extract",3,"mL"],
     ["Icing",150,"g","topping","","per_unit"],["Dark Chocolate",50,"g","topping","option-2","per_unit"],["Square Box 10x10x6.5cm",1,"pcs","packaging","","per_unit"]],"pack":"sticker"}
  ]$j$::jsonb;
  rec jsonb; ln jsonb; pid uuid; key uuid; lines jsonb; vunits jsonb; r public.product_recipes; missing text[] := '{}';
  src constant text := 'Estimated standard recipe — replace with your real measurement';
begin
  if actor is null then raise exception 'No Admin profile found.'; end if;
  for rec in select value from jsonb_array_elements(spec) loop
    pid := (select id from public.products where slug = rec->>'slug');
    if pid is null then missing := missing || (rec->>'slug'); continue; end if;
    key := md5('lexc-estimated-recipe:' || (rec->>'slug'))::uuid;
    if exists (select 1 from public.product_recipes where recipe_key = key) then continue; end if;
    vunits := (select jsonb_agg(jsonb_build_object('variant_id', v.id, 'units', (rec->'units'->>v.code)::numeric))
               from public.product_variants v where v.product_id = pid and rec->'units' ? v.code);
    lines := '[]'::jsonb;
    for ln in select value from jsonb_array_elements(rec->'lines') loop
      if (select id from public.inventory_items where lower(name) = lower(ln->>0) and not is_archived) is null then
        missing := missing || (ln->>0); continue;
      end if;
      lines := lines || jsonb_build_array(jsonb_build_object(
        'item_id', (select id from public.inventory_items where lower(name) = lower(ln->>0) and not is_archived),
        'quantity', (ln->>1)::numeric, 'unit', ln->>2,
        'line_group', coalesce(nullif(ln->>3, ''), case when ln->>0 like '%Box%' then 'packaging' else 'ingredient' end),
        'basis', coalesce(nullif(ln->>5, ''), 'per_batch'),
        'condition', case when coalesce(ln->>4, '') <> '' then jsonb_build_object('variant_codes', jsonb_build_array(ln->>4)) else '{}'::jsonb end,
        'source_text', src));
    end loop;
    -- Packaging rules (per ordered box/option).
    lines := lines || case rec->>'pack'
      when 'muffin' then jsonb_build_array(
        jsonb_build_object('item_id', (select id from public.inventory_items where name = 'Cupcake Liner 3oz'), 'quantity', 1, 'unit', 'pcs', 'line_group', 'packaging', 'basis', 'per_unit', 'source_text', src),
        jsonb_build_object('item_id', (select id from public.inventory_items where name = 'Cupcake Box 6x3oz 9x6x2"'), 'quantity', 1, 'unit', 'pcs', 'line_group', 'packaging', 'basis', 'per_package', 'condition', jsonb_build_object('variant_codes', jsonb_build_array('option-1')), 'source_text', src),
        jsonb_build_object('item_id', (select id from public.inventory_items where name = 'Cupcake Box 12x3oz 12x9x3"'), 'quantity', 1, 'unit', 'pcs', 'line_group', 'packaging', 'basis', 'per_package', 'condition', jsonb_build_object('variant_codes', jsonb_build_array('option-2')), 'source_text', src))
      when 'tub' then jsonb_build_array(
        jsonb_build_object('item_id', (select id from public.inventory_items where name = 'Plastic Container 500ml'), 'quantity', 1, 'unit', 'pcs', 'line_group', 'packaging', 'basis', 'per_package', 'source_text', src))
      when 'cookiebox' then jsonb_build_array(
        jsonb_build_object('item_id', (select id from public.inventory_items where name = 'Box 6pcs 4x4x2"'), 'quantity', 1, 'unit', 'pcs', 'line_group', 'packaging', 'basis', 'per_package', 'condition', jsonb_build_object('variant_codes', jsonb_build_array('option-1')), 'source_text', src),
        jsonb_build_object('item_id', (select id from public.inventory_items where name = 'Box 12pcs 6x9x1.5"'), 'quantity', 1, 'unit', 'pcs', 'line_group', 'packaging', 'basis', 'per_package', 'condition', jsonb_build_object('variant_codes', jsonb_build_array('option-2')), 'source_text', src))
      else '[]'::jsonb end
      || jsonb_build_array(jsonb_build_object('item_id', (select id from public.inventory_items where name = 'TY Sticker (Wide)'), 'quantity', 1, 'unit', 'pcs', 'line_group', 'packaging', 'basis', 'per_package', 'source_text', src));
    r := private.write_recipe_version(jsonb_build_object(
      'recipe_key', key, 'product_id', pid, 'name', rec->>'name', 'batch_yield', (rec->>'yield')::numeric,
      'notes', 'Estimated from typical home-bakery recipes (no LexC costing sheet). Fresh bananas/carrots are not stocked, so they are not deducted.',
      'review_notes', 'Estimated — please review. Weigh one real batch and update the amounts and yield.',
      'source', 'Estimated standard recipe', 'variant_units', vunits, 'lines', lines), actor);
    perform private.activate_recipe(r.id, actor);
  end loop;
  if array_length(missing, 1) > 0 then raise exception 'Missing products/materials: %', array_to_string(missing, ', '); end if;
end $$;
