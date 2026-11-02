-- Phase 90 rehearsal · fondant covering on every designer cake, WITHOUT saving anything.
-- Run the whole file in the Supabase SQL editor. It applies phase 90 twice, checks the result (and that no other
-- option changed), then ends with an error on purpose so nothing is saved.
-- Expected last line: ERROR: REHEARSAL REPORT (nothing was saved) … followed by INFO/PASS/FAIL lines.

create temporary table rehearsal_before on commit drop as
  select o.id, o.price, o.is_active, o.label from public.design_options o;

-- ===== phase 90 (run twice) =====
insert into public.design_options (product_id, group_key, code, label, price, hex, sort_order, is_active)
select p.id, 'accent', 'fondant', 'Fondant', 0, null, 0, false
  from public.products p where p.customization_config->>'designer' = 'bento'
on conflict (product_id, group_key, code) do nothing;
insert into public.design_options (product_id, group_key, code, label, price, hex, sort_order, is_active)
select p.id, 'accent', 'fondant', 'Fondant', 0, null, 0, false
  from public.products p where p.customization_config->>'designer' = 'bento'
on conflict (product_id, group_key, code) do nothing;

do $rehearsal$
declare report text := ''; r record; ok boolean;
begin
  for r in select p.name, o.price, o.is_active from public.design_options o join public.products p on p.id = o.product_id
            where o.group_key = 'accent' and o.code = 'fondant' order by p.name loop
    report := report || E'\nINFO  fondant · ' || r.name || ' · ₱' || r.price || case when r.is_active then ' (on)' else ' (off)' end;
  end loop;
  ok := not exists (select 1 from public.products p where p.customization_config->>'designer' = 'bento'
                     and (select count(*) from public.design_options o where o.product_id = p.id and o.group_key = 'accent' and o.code = 'fondant') <> 1);
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  every designer cake has exactly one fondant option';
  ok := not exists (select 1 from rehearsal_before b join public.design_options o on o.id = b.id
                     where o.price <> b.price or o.is_active <> b.is_active or o.label <> b.label);
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  no existing option changed';
  ok := not exists (select 1 from public.design_options o where o.group_key = 'accent' and o.code = 'fondant'
                     and o.id not in (select id from rehearsal_before) and (o.is_active or o.price <> 0));
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  new fondant options start hidden at ₱0';
  raise exception 'REHEARSAL REPORT (nothing was saved — this error undoes everything):%', report;
end $rehearsal$;
