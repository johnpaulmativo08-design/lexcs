-- Phase 89 rehearsal · cake pops from 1 piece and letters on every cupcake size, WITHOUT saving anything.
-- Run the whole file in the Supabase SQL editor. It shows the current values, applies phase 89 twice, checks the result
-- (and that prices did not move), then ends with an error on purpose so nothing is saved.
-- Expected last line: ERROR: REHEARSAL REPORT (nothing was saved) … followed by INFO/PASS/FAIL lines.

create temporary table rehearsal_before on commit drop as
  select 'variant' as kind, p.name, v.code, v.price, v.min_qty::text as extra, v.is_active from public.product_variants v join public.products p on p.id = v.product_id
   where p.customization_config->>'designer' = 'cakepop' and v.code = 'piece'
  union all
  select 'option', p.name, o.code, o.price, o.label, o.is_active from public.design_options o join public.products p on p.id = o.product_id
   where p.customization_config->>'designer' = 'cupcake' and o.group_key = 'message';

-- ===== phase 89 (run twice) =====
update public.product_variants set min_qty = 1
 where code = 'piece' and min_qty <> 1
   and product_id in (select id from public.products where customization_config->>'designer' = 'cakepop');
insert into public.design_options (product_id, group_key, code, label, price, hex, sort_order, is_active)
select p.id, 'message', 'letters', 'Fondant letters', 0, null, 2, true
  from public.products p where p.customization_config->>'designer' = 'cupcake'
on conflict (product_id, group_key, code) do update set is_active = true;
-- second run
update public.product_variants set min_qty = 1
 where code = 'piece' and min_qty <> 1
   and product_id in (select id from public.products where customization_config->>'designer' = 'cakepop');
insert into public.design_options (product_id, group_key, code, label, price, hex, sort_order, is_active)
select p.id, 'message', 'letters', 'Fondant letters', 0, null, 2, true
  from public.products p where p.customization_config->>'designer' = 'cupcake'
on conflict (product_id, group_key, code) do update set is_active = true;

do $rehearsal$
declare report text := ''; r record; ok boolean;
begin
  for r in select * from rehearsal_before order by kind, name, code loop
    report := report || E'\nINFO  before: ' || r.kind || ' · ' || r.name || ' · ' || r.code || ' · ₱' || r.price || ' · ' || coalesce(r.extra, '') || case when r.is_active then '' else ' (off)' end;
  end loop;
  ok := not exists (select 1 from public.product_variants v join public.products p on p.id = v.product_id
                     where p.customization_config->>'designer' = 'cakepop' and v.code = 'piece' and v.min_qty <> 1);
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  cake pops: minimum 1 piece';
  ok := not exists (select 1 from public.products p where p.customization_config->>'designer' = 'cupcake'
                     and not exists (select 1 from public.design_options o where o.product_id = p.id and o.group_key = 'message' and o.code = 'letters' and o.is_active));
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  every cupcake size offers fondant letters';
  ok := not exists (select 1 from rehearsal_before b join public.products p on p.name = b.name
                     left join public.product_variants v on v.product_id = p.id and b.kind = 'variant' and v.code = b.code
                     left join public.design_options o on o.product_id = p.id and b.kind = 'option' and o.group_key = 'message' and o.code = b.code
                     where coalesce(v.price, o.price) <> b.price);
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  no price changed';
  raise exception 'REHEARSAL REPORT (nothing was saved — this error undoes everything):%', report;
end $rehearsal$;
