-- Phase 83 rehearsal · copies the bento recipe to the Petite / Mini Tiered / Mini 3-Tiered cakes WITHOUT saving anything.
--
-- Run this whole file at once in the Supabase SQL editor. It applies phase 83 twice (the second run must change
-- nothing), then checks each cake: one active recipe, every line copied, every size counted as one cake, and the
-- chocolate-only line used for the Chocolate sizes only. It ends with an error on purpose so nothing is saved.
--
-- Expected last line: ERROR: REHEARSAL REPORT (nothing was saved) … followed by PASS/FAIL for each check.

-- ===== phase 83 (run twice) =====
do $$
declare
  src public.product_recipes; target public.products; new_id uuid; v record; flavour text; codes jsonb; l record; cond jsonb;
begin
  select r.* into src from public.product_recipes r join public.products p on p.id = r.product_id
   where p.slug = 'product-8' and r.status = 'active';
  if src.id is null then raise exception 'The bento has no active recipe; review before applying phase 83.'; end if;

  for target in select * from public.products where slug in ('petite-cake', 'mini-tiered-cake', 'mini-3-tiered-cake') order by slug loop
    if exists (select 1 from public.product_recipes where product_id = target.id) then
      raise notice '% already has a recipe; left as is.', target.name; continue;
    end if;

    insert into public.product_recipes (recipe_key, version, product_id, name, status, batch_yield, yield_unit, scaling_mode, notes, review_notes, source, activated_at)
    values (gen_random_uuid(), 1, target.id, target.name || ' (same as bento)', 'active', src.batch_yield, src.yield_unit, src.scaling_mode,
            src.notes, src.review_notes, 'phase83: copied from ' || src.name, now())
    returning id into new_id;

    -- every size is one cake
    insert into public.recipe_variant_units (recipe_id, variant_id, units)
    select new_id, pv.id, 1 from public.product_variants pv where pv.product_id = target.id;

    for l in select * from public.recipe_lines where recipe_id = src.id order by sort_order, id loop
      cond := l.condition;
      if cond ? 'variant_codes' then
        -- bento flavour (by its variant label, e.g. "Chocolate") -> the same flavour in every size of this cake
        select coalesce(jsonb_agg(distinct pv.code), '[]') into codes
          from jsonb_array_elements_text(cond->'variant_codes') bc
          join public.product_variants bv on bv.product_id = src.product_id and bv.code = bc
          join public.product_variants pv on pv.product_id = target.id and pv.code like '%\_' || split_part(lower(btrim(bv.label)), ' ', 1);   -- "Chocolate Moist" -> *_chocolate
        if jsonb_array_length(codes) = 0 then
          raise exception 'Could not match a bento flavour line (%) to the % sizes; review before applying phase 83.', cond, target.name;
        end if;
        cond := jsonb_set(cond, '{variant_codes}', codes);
      end if;
      insert into public.recipe_lines (recipe_id, item_id, line_group, quantity, unit, basis, rounding, condition, item_quantity, item_unit,
                                       needs_review, review_note, source_text, sort_order)
      values (new_id, l.item_id, l.line_group, l.quantity, l.unit, l.basis, l.rounding, cond, l.item_quantity, l.item_unit,
              l.needs_review, l.review_note, l.source_text, l.sort_order);
    end loop;
  end loop;
end $$;

do $$
declare
  src public.product_recipes; target public.products; new_id uuid; v record; flavour text; codes jsonb; l record; cond jsonb;
begin
  select r.* into src from public.product_recipes r join public.products p on p.id = r.product_id
   where p.slug = 'product-8' and r.status = 'active';
  if src.id is null then raise exception 'The bento has no active recipe; review before applying phase 83.'; end if;

  for target in select * from public.products where slug in ('petite-cake', 'mini-tiered-cake', 'mini-3-tiered-cake') order by slug loop
    if exists (select 1 from public.product_recipes where product_id = target.id) then
      raise notice '% already has a recipe; left as is.', target.name; continue;
    end if;

    insert into public.product_recipes (recipe_key, version, product_id, name, status, batch_yield, yield_unit, scaling_mode, notes, review_notes, source, activated_at)
    values (gen_random_uuid(), 1, target.id, target.name || ' (same as bento)', 'active', src.batch_yield, src.yield_unit, src.scaling_mode,
            src.notes, src.review_notes, 'phase83: copied from ' || src.name, now())
    returning id into new_id;

    -- every size is one cake
    insert into public.recipe_variant_units (recipe_id, variant_id, units)
    select new_id, pv.id, 1 from public.product_variants pv where pv.product_id = target.id;

    for l in select * from public.recipe_lines where recipe_id = src.id order by sort_order, id loop
      cond := l.condition;
      if cond ? 'variant_codes' then
        -- bento flavour (by its variant label, e.g. "Chocolate") -> the same flavour in every size of this cake
        select coalesce(jsonb_agg(distinct pv.code), '[]') into codes
          from jsonb_array_elements_text(cond->'variant_codes') bc
          join public.product_variants bv on bv.product_id = src.product_id and bv.code = bc
          join public.product_variants pv on pv.product_id = target.id and pv.code like '%\_' || split_part(lower(btrim(bv.label)), ' ', 1);   -- "Chocolate Moist" -> *_chocolate
        if jsonb_array_length(codes) = 0 then
          raise exception 'Could not match a bento flavour line (%) to the % sizes; review before applying phase 83.', cond, target.name;
        end if;
        cond := jsonb_set(cond, '{variant_codes}', codes);
      end if;
      insert into public.recipe_lines (recipe_id, item_id, line_group, quantity, unit, basis, rounding, condition, item_quantity, item_unit,
                                       needs_review, review_note, source_text, sort_order)
      values (new_id, l.item_id, l.line_group, l.quantity, l.unit, l.basis, l.rounding, cond, l.item_quantity, l.item_unit,
              l.needs_review, l.review_note, l.source_text, l.sort_order);
    end loop;
  end loop;
end $$;

do $rehearsal$
declare
  src public.product_recipes; t record; r public.product_recipes; report text := ''; ok boolean; n_src int; info text;
begin
  select r2.* into src from public.product_recipes r2 join public.products p on p.id = r2.product_id where p.slug = 'product-8' and r2.status = 'active';
  n_src := (select count(*) from public.recipe_lines where recipe_id = src.id);
  report := report || E'\nINFO  bento flavours: ' || (select string_agg(code || '=' || label, ', ') from public.product_variants where product_id = src.product_id);
  for t in select * from public.products where slug in ('petite-cake', 'mini-tiered-cake', 'mini-3-tiered-cake') order by slug loop
    select * into r from public.product_recipes where product_id = t.id and status = 'active';
    ok := r.id is not null and (select count(*) from public.product_recipes where product_id = t.id) = 1
      and (select count(*) from public.recipe_lines where recipe_id = r.id) = n_src
      and (select count(*) from public.recipe_variant_units where recipe_id = r.id and units = 1) = (select count(*) from public.product_variants where product_id = t.id)
      and (select sum(quantity) from public.recipe_lines where recipe_id = r.id) = (select sum(quantity) from public.recipe_lines where recipe_id = src.id);
    report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  ' || t.name || ': one active recipe, ' || n_src || ' lines, every size = 1 cake';
    -- flavour-only lines: each must apply to the matching flavour sizes and not the others
    select string_agg(i.name || ' -> ' || (l.condition->'variant_codes')::text, '; ') into info
      from public.recipe_lines l join public.inventory_items i on i.id = l.item_id where l.recipe_id = r.id and l.condition ? 'variant_codes';
    ok := not exists (select 1 from public.recipe_lines l, jsonb_array_elements_text(l.condition->'variant_codes') c
                      where l.recipe_id = r.id and l.condition ? 'variant_codes' and c not like '%chocolate')
      and exists (select 1 from public.recipe_lines l where l.recipe_id = r.id and l.condition ? 'variant_codes')
      and (select count(*) from public.product_variants pv where pv.product_id = t.id and pv.code like '%chocolate'
             and not exists (select 1 from public.recipe_lines l where l.recipe_id = r.id and (l.condition->'variant_codes') ? pv.code)) = 0;
    report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  ' || t.name || ' flavour lines: ' || coalesce(info, 'none');
  end loop;
  raise exception 'REHEARSAL REPORT (nothing was saved — this error undoes everything):%', report;
end $rehearsal$;
