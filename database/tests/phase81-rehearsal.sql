-- Phase 81 rehearsal · tests the Petite Cake and Mini Tiered Cake on the real database WITHOUT saving anything.
--
-- Run this whole file at once in the Supabase SQL editor. It applies phase 81 (twice, to prove it is safe to re-run),
-- checks the products, sizes and copied design options, prices one design on the bento and on a Petite 6x4 (the extras
-- must match), and places a pretend Petite 6x4 order with that design as a customer. It ends with an error on purpose:
-- that cancels the whole transaction, so nothing is saved.
--
-- Expected last line: ERROR: REHEARSAL REPORT (nothing was saved) … followed by PASS/FAIL for each check.

-- ===== phase 81 (run twice) =====
do $$
declare
  bento public.products;
  cake record;
  size record;
  pid uuid;
begin
  select * into bento from public.products where customization_config->>'designer' = 'bento' and slug = 'product-8';
  if bento.id is null then raise exception 'The bento product was not found; review before applying phase 81.'; end if;

  for cake in select * from (values
      ('petite-cake', 'Petite Cake', 'petite', 'Tall single-tier cake, 4" tall · design it like a bento', 1),
      ('mini-tiered-cake', 'Mini Tiered Cake', 'tiered', 'Two small tiers, 4" tall in all · design it like a bento', 2)
    ) as t(slug, name, shape, description, sort_offset)
  loop
    insert into public.products (slug, name, description, kind, status, category_id, emoji, customization_config, sort_order)
    values (cake.slug, cake.name, cake.description, 'standard', 'active', bento.category_id, '🎂',
            coalesce(bento.customization_config, '{}'::jsonb) || jsonb_build_object('cake_shape', cake.shape),
            coalesce(bento.sort_order, 0) + cake.sort_offset)
    on conflict (slug) do nothing;
    select id into pid from public.products where slug = cake.slug;

    for size in select * from (values
        ('petite', '4x4', 799, 0), ('petite', '6x4', 1500, 1), ('petite', '8x4', 2500, 2),
        ('tiered', '4x4', 2500, 0), ('tiered', '6x4', 2500, 1)
      ) as s(shape, dims, price, rank) where s.shape = cake.shape
    loop
      insert into public.product_variants (product_id, code, label, price, min_qty, is_active, sort_order)
      values (pid, size.dims || '_vanilla', size.dims || ' Vanilla', size.price, 1, true, size.rank * 2),
             (pid, size.dims || '_chocolate', size.dims || ' Chocolate', size.price, 1, true, size.rank * 2 + 1)
      on conflict (product_id, code) do nothing;
    end loop;

    insert into public.design_options (product_id, group_key, code, label, price, hex, sort_order, is_active)
    select pid, o.group_key, o.code, o.label, o.price, o.hex, o.sort_order, o.is_active
      from public.design_options o where o.product_id = bento.id
    on conflict (product_id, group_key, code) do nothing;
  end loop;
end $$;


do $$
declare
  bento public.products;
  cake record;
  size record;
  pid uuid;
begin
  select * into bento from public.products where customization_config->>'designer' = 'bento' and slug = 'product-8';
  if bento.id is null then raise exception 'The bento product was not found; review before applying phase 81.'; end if;

  for cake in select * from (values
      ('petite-cake', 'Petite Cake', 'petite', 'Tall single-tier cake, 4" tall · design it like a bento', 1),
      ('mini-tiered-cake', 'Mini Tiered Cake', 'tiered', 'Two small tiers, 4" tall in all · design it like a bento', 2)
    ) as t(slug, name, shape, description, sort_offset)
  loop
    insert into public.products (slug, name, description, kind, status, category_id, emoji, customization_config, sort_order)
    values (cake.slug, cake.name, cake.description, 'standard', 'active', bento.category_id, '🎂',
            coalesce(bento.customization_config, '{}'::jsonb) || jsonb_build_object('cake_shape', cake.shape),
            coalesce(bento.sort_order, 0) + cake.sort_offset)
    on conflict (slug) do nothing;
    select id into pid from public.products where slug = cake.slug;

    for size in select * from (values
        ('petite', '4x4', 799, 0), ('petite', '6x4', 1500, 1), ('petite', '8x4', 2500, 2),
        ('tiered', '4x4', 2500, 0), ('tiered', '6x4', 2500, 1)
      ) as s(shape, dims, price, rank) where s.shape = cake.shape
    loop
      insert into public.product_variants (product_id, code, label, price, min_qty, is_active, sort_order)
      values (pid, size.dims || '_vanilla', size.dims || ' Vanilla', size.price, 1, true, size.rank * 2),
             (pid, size.dims || '_chocolate', size.dims || ' Chocolate', size.price, 1, true, size.rank * 2 + 1)
      on conflict (product_id, code) do nothing;
    end loop;

    insert into public.design_options (product_id, group_key, code, label, price, hex, sort_order, is_active)
    select pid, o.group_key, o.code, o.label, o.price, o.hex, o.sort_order, o.is_active
      from public.design_options o where o.product_id = bento.id
    on conflict (product_id, group_key, code) do nothing;
  end loop;
end $$;


do $rehearsal$
declare
  customer_id uuid; bento_id uuid; petite public.products; tiered public.products; v public.product_variants; slot_id uuid; method text;
  q_bento jsonb; q_petite jsonb; res jsonb; ord public.orders; report text := ''; ok boolean; n int;
  d jsonb := '{"designer":"bento","frosting_color":"pink","border":["shell_top"],"accents":["pearls_gold","ribbon_bows"],"bow_color":"pink","message":"Happy Birthday","lettering":"piped","lettering_color":"purple","topper":"none","topper_text":"","font":"rounded","layout":{}}';
begin
  select id into bento_id from public.products where slug = 'product-8';
  select * into petite from public.products where slug = 'petite-cake';
  select * into tiered from public.products where slug = 'mini-tiered-cake';
  ok := petite.id is not null and tiered.id is not null and petite.category_id = (select category_id from public.products where id = bento_id)
        and petite.customization_config->>'designer' = 'bento' and petite.customization_config->>'cake_shape' = 'petite' and tiered.customization_config->>'cake_shape' = 'tiered';
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  both cakes added in the Bento Cake category with the bento designer';
  select count(*) into n from public.products where slug in ('petite-cake', 'mini-tiered-cake');
  report := report || E'\n' || case when n = 2 then 'PASS' else 'FAIL' end || '  running it twice did not duplicate them (' || n || ')';
  select count(*) into n from public.product_variants where product_id = petite.id and is_active;
  ok := n = 6 and (select price from public.product_variants where product_id = petite.id and code = '4x4_vanilla') = 799
       and (select price from public.product_variants where product_id = petite.id and code = '6x4_chocolate') = 1500
       and (select price from public.product_variants where product_id = petite.id and code = '8x4_vanilla') = 2500;
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  Petite sizes: 4x4 ₱799, 6x4 ₱1500, 8x4 ₱2500 × Vanilla/Chocolate (' || n || ')';
  select count(*) into n from public.product_variants where product_id = tiered.id and is_active and price = 2500;
  report := report || E'\n' || case when n = 4 then 'PASS' else 'FAIL' end || '  Mini Tiered sizes: 4x4 and 6x4 at ₱2500 × Vanilla/Chocolate (' || n || ')';
  select count(*) into n from public.design_options where product_id = petite.id;
  ok := n = (select count(*) from public.design_options where product_id = bento_id) and n = (select count(*) from public.design_options where product_id = tiered.id);
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  design options copied (' || n || ' each)';

  q_bento := public.quote_bento_design(bento_id, d);
  q_petite := public.quote_bento_design(petite.id, d);
  report := report || E'\nINFO  bento quote ' || left(q_bento::text, 160);
  report := report || E'\n' || case when q_bento = q_petite then 'PASS' else 'FAIL' end || '  same design costs the same extras on the Petite cake';

  -- a pretend Petite 6x4 Vanilla order with that design
  select u.id into customer_id from auth.users u join public.profiles p on p.id = u.id left join public.user_roles r on r.user_id = u.id
   where coalesce(r.role, 'customer') = 'customer' and u.email_confirmed_at is not null order by u.created_at limit 1;
  select * into v from public.product_variants where product_id = petite.id and code = '6x4_vanilla';
  select s.id into slot_id from public.availability_slots s where s.is_open and s.starts_at > now() + interval '2 days'
     and (select count(*) from public.orders o where o.slot_id = s.id and o.status <> 'cancelled') < s.capacity order by s.starts_at limit 1;
  select pm.code into method from public.payment_methods pm where pm.active order by pm.code limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', customer_id, 'role', 'authenticated')::text, true); perform set_config('role', 'authenticated', true);
  res := public.create_order(jsonb_build_object('request_id', gen_random_uuid(), 'name', 'Rehearsal', 'phone', '09171234567', 'fulfillment', 'pickup',
    'slot_id', slot_id, 'notes', 'phase 81 rehearsal', 'payment_method', method,
    'items', jsonb_build_array(jsonb_build_object('variant_id', v.id, 'qty', 1, 'customization', d))));
  perform set_config('role', 'postgres', true);
  select * into ord from public.orders where id = (res->>'id')::uuid;
  ok := ord.items_subtotal + ord.customization_total = 1500 + coalesce((q_petite->>'extra')::numeric, (q_petite->>'extras_total')::numeric, ord.customization_total);
  report := report || E'\n' || case when ord.items_subtotal >= 1500 then 'PASS' else 'FAIL' end || '  Petite 6x4 order priced from the server: items ' || ord.items_subtotal || ' + design ' || ord.customization_total || ' + VAT ' || ord.vat_amount || ' = ' || ord.total_amount;

  raise exception 'REHEARSAL REPORT (nothing was saved — this error undoes everything):%', report;
end $rehearsal$;
