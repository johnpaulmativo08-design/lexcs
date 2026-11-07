-- Phase 104 checks: drafts stay private, publishing shows them, links and scripts are refused, FAQs stop at 10.
do $rehearsal$
declare report text := ''; ok boolean; j jsonb; n int;
  admin_id uuid := (select ur.user_id from public.user_roles ur where ur.role = 'admin' order by ur.created_at limit 1);
  as_admin text := json_build_object('sub', (select ur.user_id from public.user_roles ur where ur.role = 'admin' order by ur.created_at limit 1), 'role', 'authenticated')::text;
begin
  perform set_config('request.jwt.claim.sub', admin_id::text, true); perform set_config('request.jwt.claim.sub', admin_id::text, true); perform set_config('request.jwt.claims', as_admin, true); perform set_config('role', 'authenticated', true);
  perform public.save_site_draft('home', 'rehearsal', '{"fields":{"title":"Rehearsal heading","button_link":"?page=shop"}}');
  perform set_config('role', 'anon', true); perform set_config('request.jwt.claims', '{"role":"anon"}', true); perform set_config('request.jwt.claim.sub', '', true);
  j := public.get_site_content();
  ok := not (j ? 'home/rehearsal');
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  a saved draft is not visible to visitors';
  begin perform public.save_site_draft('home', 'rehearsal', '{}'); report := report || E'\nFAIL  a visitor saved a draft';
  exception when others then report := report || E'\nPASS  visitors cannot save drafts'; end;

  perform set_config('request.jwt.claim.sub', admin_id::text, true); perform set_config('request.jwt.claims', as_admin, true); perform set_config('role', 'authenticated', true);
  n := public.publish_site_page('home');
  perform set_config('role', 'anon', true); perform set_config('request.jwt.claims', '{"role":"anon"}', true); perform set_config('request.jwt.claim.sub', '', true);
  j := public.get_site_content();
  ok := j->'home/rehearsal'->'fields'->>'title' = 'Rehearsal heading';
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  after Publish, visitors see it';

  perform set_config('request.jwt.claim.sub', admin_id::text, true); perform set_config('request.jwt.claims', as_admin, true); perform set_config('role', 'authenticated', true);
  begin perform public.save_site_draft('home', 'rehearsal', '{"fields":{"button_link":"javascript:alert(1)"}}'); report := report || E'\nFAIL  a javascript: link was saved';
  exception when others then report := report || E'\nPASS  javascript: links refused (' || sqlerrm || ')'; end;
  begin perform public.save_site_draft('home', 'rehearsal', '{"fields":{"title":"<script>alert(1)</script>"}}'); report := report || E'\nFAIL  a script was saved';
  exception when others then report := report || E'\nPASS  scripts refused (' || sqlerrm || ')'; end;

  -- FAQs: fill up to 10 active, the 11th is refused
  insert into public.site_faqs(question, answer, sort_order, is_active)
    select 'Rehearsal question ' || g || '?', 'Rehearsal answer.', 100 + g, true from generate_series(1, greatest(0, 10 - (select count(*) from public.site_faqs where is_active))) g;
  begin insert into public.site_faqs(question, answer, is_active) values ('One too many?', 'No.', true); report := report || E'\nFAIL  an 11th active FAQ was saved';
  exception when others then report := report || E'\nPASS  11th active FAQ refused (' || sqlerrm || ')'; end;
  insert into public.site_faqs(question, answer, is_active) values ('Hidden extra?', 'Kept hidden.', false);
  report := report || E'\nPASS  an inactive FAQ can still be added';
  perform set_config('role', 'anon', true); perform set_config('request.jwt.claims', '{"role":"anon"}', true); perform set_config('request.jwt.claim.sub', '', true);
  ok := not exists (select 1 from public.site_faqs where not is_active);
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  visitors only see active FAQs';
  -- announcements: a draft and a future one are hidden from visitors
  perform set_config('request.jwt.claim.sub', admin_id::text, true); perform set_config('request.jwt.claims', as_admin, true); perform set_config('role', 'authenticated', true);
  insert into public.site_announcements(title, status) values ('Rehearsal draft', 'draft');
  insert into public.site_announcements(title, status, starts_at) values ('Rehearsal later', 'published', now() + interval '2 days');
  insert into public.site_announcements(title, status) values ('Rehearsal now', 'published');
  perform set_config('role', 'anon', true); perform set_config('request.jwt.claims', '{"role":"anon"}', true); perform set_config('request.jwt.claim.sub', '', true);
  select count(*) into n from public.site_announcements where title like 'Rehearsal %';
  report := report || E'\n' || case when n = 1 then 'PASS' else 'FAIL' end || format('  visitors see only the live announcement (%s of 3)', n);
  perform set_config('role', 'postgres', true);
  ok := exists (select 1 from storage.buckets where id = 'site-media' and public);
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  image bucket site-media ready';
  raise exception 'REHEARSAL REPORT (nothing was saved — this error undoes everything):%', report;
end $rehearsal$;
