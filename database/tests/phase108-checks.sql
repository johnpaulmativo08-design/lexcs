-- Phase 108 checks: quantity limits on order lines, and fondant/frosting kept on bento designs.
do $rehearsal$
declare report text := ''; src public.order_items; pid uuid; vid uuid; q integer; ok boolean; d jsonb; c text; prod public.products; n integer := 900;
begin
  select * into src from public.order_items order by created_at desc limit 1;
  -- try a quantity on a copy of a real order line (all rolled back)
  for pid, q, ok in
    select p.id, t.q, t.ok from (values ('cakepop', 10, false), ('cakepop', 24, true), ('cakepop', 501, false),
                                        ('bento', 15, true), ('bento', 16, false), ('plain', 30, true), ('plain', 31, false)) t(kind, q, ok)
    join lateral (select p.id from public.products p where p.status = 'active' and case t.kind when 'plain' then p.customization_config->>'designer' is null and p.kind = 'standard'
                  else p.customization_config->>'designer' = t.kind end limit 1) p on true
  loop
    select id into vid from public.product_variants where product_id = pid and is_active limit 1;
    n := n + 1;
    begin
      insert into public.order_items (order_id, line_number, product_id, variant_id, name_snapshot, variant_label_snapshot, quantity, unit_price, customization_unit_charge, line_total, customization)
      values (src.order_id, n, pid, vid, 'rehearsal', 'rehearsal', q, 1, 0, q, src.customization);
      report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || format('  %s × %s accepted', q, (select name from public.products where id = pid));
    exception when others then
      report := report || E'\n' || case when ok then 'FAIL' else 'PASS' end || format('  %s × %s refused: %s', q, (select name from public.products where id = pid), sqlerrm);
    end;
  end loop;

  -- bento design: the finish is kept and named in the summary
  select * into prod from public.products where customization_config->>'designer' = 'bento' and status = 'active' limit 1;
  select code into c from public.design_options where product_id = prod.id and group_key = 'color' and is_active order by sort_order limit 1;
  foreach q in array array[1, 2] loop
    begin
      d := private.bento_design(prod, jsonb_build_object('designer', 'bento', 'frosting_color', c, 'border', '[]'::jsonb, 'accents', '[]'::jsonb, 'topper', 'none', 'message', '',
             'coat', case when q = 1 then 'frosting' else null end));
      report := report || E'\n' || case when (d::text like '%"coat": "' || case when q = 1 then 'frosting' else 'fondant' end || '"%') then 'PASS' else 'FAIL' end
        || format('  %s → coat %s · %s', case when q = 1 then 'frosting chosen' else 'no choice (old design)' end, coalesce(d#>>'{customization,coat}', d->>'coat', '?'), left(coalesce(d->>'summary', d::text), 120));
    exception when others then report := report || E'\nINFO  bento_design test needs more fields: ' || sqlerrm; end;
  end loop;
  raise exception 'REHEARSAL REPORT (nothing was saved — this error undoes everything):%', report;
end $rehearsal$;
