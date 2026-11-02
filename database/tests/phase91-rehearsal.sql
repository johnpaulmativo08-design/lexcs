-- Phase 91 rehearsal · Frosting top/bottom names and the custom topper, WITHOUT saving anything.
-- Run the whole file in the Supabase SQL editor. It applies phase 91 twice, prices a design with a custom topper,
-- checks bad words are refused, then ends with an error on purpose so nothing is saved.
-- Expected last line: ERROR: REHEARSAL REPORT (nothing was saved) … followed by INFO/PASS/FAIL lines.

create temporary table rehearsal_before on commit drop as
  select o.id, o.price, o.is_active from public.design_options o;

-- ===== phase 91 (run twice) =====
update public.design_options set label = 'Frosting top', updated_at = now() where group_key = 'border' and code = 'shell_top' and label <> 'Frosting top';
update public.design_options set label = 'Frosting bottom', updated_at = now() where group_key = 'border' and code = 'shell_bottom' and label <> 'Frosting bottom';
insert into public.design_options (product_id, group_key, code, label, price, hex, sort_order, is_active)
select p.id, 'topper', 'custom', 'Custom topper', 3, null, 5, true from public.products p where p.customization_config->>'designer' = 'bento'
on conflict (product_id, group_key, code) do nothing;
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
  if position('phase 91: own words' in def) > 0 then raise notice 'already patched'; return; end if;
  n := (length(def) - length(replace(def, a1, ''))) / length(a1);
  if n <> 1 then raise exception 'private.bento_design is not the expected version; review before applying phase 91.'; end if;
  execute replace(def, a1, b1);
end $$;
-- second run of the data part
update public.design_options set label = 'Frosting top', updated_at = now() where group_key = 'border' and code = 'shell_top' and label <> 'Frosting top';
insert into public.design_options (product_id, group_key, code, label, price, hex, sort_order, is_active)
select p.id, 'topper', 'custom', 'Custom topper', 3, null, 5, true from public.products p where p.customization_config->>'designer' = 'bento'
on conflict (product_id, group_key, code) do nothing;

do $rehearsal$
declare report text := ''; ok boolean; p public.products; v uuid; res jsonb; base jsonb; err text;
begin
  ok := not exists (select 1 from public.design_options where group_key = 'border' and code in ('shell_top', 'shell_bottom') and label not in ('Frosting top', 'Frosting bottom'));
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  shells are named Frosting top / Frosting bottom';
  ok := not exists (select 1 from public.products x where x.customization_config->>'designer' = 'bento'
                     and not exists (select 1 from public.design_options o where o.product_id = x.id and o.group_key = 'topper' and o.code = 'custom' and o.is_active));
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  every designer cake offers the custom topper';
  ok := not exists (select 1 from rehearsal_before b join public.design_options o on o.id = b.id where o.price <> b.price or o.is_active <> b.is_active);
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  no existing price or on/off changed';

  select * into p from public.products where customization_config->>'designer' = 'bento' and status = 'active' order by name limit 1;
  select id into v from public.product_variants where product_id = p.id and is_active order by price limit 1;
  base := jsonb_build_object('designer', 'bento', 'variant_id', v, 'frosting_color', (select code from public.design_options where product_id = p.id and group_key = 'color' and is_active order by sort_order limit 1),
                             'border', '[]'::jsonb, 'accents', '[]'::jsonb, 'message', '', 'lettering', 'piped', 'font', 'rounded', 'topper', 'custom', 'topper_text', 'Happy 18th');
  begin res := private.bento_design(p, base);
    report := report || E'\nPASS  custom topper accepted: ' || coalesce(res->>'summary', res::text);
  exception when others then report := report || E'\nFAIL  custom topper refused: ' || sqlerrm; end;
  begin res := private.bento_design(p, base || jsonb_build_object('topper_text', 'Fifteen letters!'));
    report := report || E'\nFAIL  15 characters were accepted';
  exception when others then report := report || E'\nPASS  15 characters refused: ' || sqlerrm; end;
  begin res := private.bento_design(p, base || jsonb_build_object('topper_text', '<b>hi</b>'));
    report := report || E'\nFAIL  odd characters were accepted';
  exception when others then report := report || E'\nPASS  odd characters refused'; end;
  begin res := private.bento_design(p, base || jsonb_build_object('topper', 'number', 'topper_text', '18'));
    report := report || E'\nPASS  number topper still works';
  exception when others then report := report || E'\nFAIL  number topper broke: ' || sqlerrm; end;
  raise exception 'REHEARSAL REPORT (nothing was saved — this error undoes everything):%', report;
end $rehearsal$;
