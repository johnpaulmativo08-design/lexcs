-- LOCAL ONLY: acceptance tests for phase35-bento-drip-fonts.sql. Run on a DISPOSABLE database built from
-- tests/local-supabase-stub.sql + phases 2-35. Everything is rolled back.
\set ON_ERROR_STOP 1
begin;
create or replace function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'FAILED: %', label; end if; raise notice 'PASS: %', label; end $$;
create or replace function pg_temp.q(d jsonb) returns jsonb language sql as $$
  select public.quote_bento_design((select id from public.products where slug = 'product-8'), d) $$;
create or replace function pg_temp.fails(d jsonb) returns text language plpgsql as $$
begin perform pg_temp.q(d); return null; exception when others then return sqlstate || ' ' || sqlerrm; end $$;
grant execute on all functions in schema pg_temp to anon, authenticated;
set role anon;

select pg_temp.check((select count(*) from public.design_options where group_key = 'font') = 16, '16 fonts offered');
select pg_temp.check((select bool_and(price = 0) from public.design_options where group_key = 'font'), 'fonts are free');

-- drip colour
select pg_temp.check(pg_temp.q('{"designer":"bento","frosting_color":"pink","accents":["drip"],"drip_color":"chocolate"}')->'clean'->>'drip_color' = 'chocolate', 'drip colour kept');
select pg_temp.check(pg_temp.q('{"designer":"bento","frosting_color":"pink","accents":["drip"],"drip_color":"chocolate"}')->'clean'->>'summary' like '%Frosting drip (Chocolate brown)%', 'summary names the drip colour');
select pg_temp.check(pg_temp.q('{"designer":"bento","frosting_color":"pink","accents":["drip"]}')->'clean'->>'drip_color' is null, 'no drip colour = matching drip, as before');
select pg_temp.check(pg_temp.q('{"designer":"bento","frosting_color":"pink","drip_color":"chocolate"}')->'clean'->>'drip_color' is null, 'drip colour dropped when there is no drip');
select pg_temp.check(pg_temp.fails('{"designer":"bento","frosting_color":"pink","accents":["drip"],"drip_color":"neon"}') like '22023%drip color%', 'unknown drip colour rejected');
select pg_temp.check((pg_temp.q('{"designer":"bento","frosting_color":"pink","accents":["drip"],"drip_color":"chocolate"}')->>'extra')::numeric
  = (pg_temp.q('{"designer":"bento","frosting_color":"pink","accents":["drip"]}')->>'extra')::numeric, 'drip colour is free');

-- fonts
select pg_temp.check(pg_temp.q('{"designer":"bento","frosting_color":"pink","message":"Hi","lettering_color":"white","font":"blackletter"}')->'clean'->>'font' = 'blackletter', 'font kept');
select pg_temp.check(pg_temp.q('{"designer":"bento","frosting_color":"pink","message":"Hi","lettering_color":"white","font":"great_vibes"}')->'clean'->>'summary' like '%“Hi” (Piped letters, Great Vibes)%', 'summary names the font');
select pg_temp.check(pg_temp.q('{"designer":"bento","frosting_color":"pink","message":"Hi","lettering_color":"white"}')->'clean'->>'font' = 'rounded', 'default font is Rounded (the original lettering)');
select pg_temp.check(pg_temp.q('{"designer":"bento","frosting_color":"pink","font":"gothic"}')->'clean'->>'font' is null, 'font dropped when there is no message');
select pg_temp.check(pg_temp.fails('{"designer":"bento","frosting_color":"pink","message":"Hi","lettering_color":"white","font":"comic_sans"}') like '22023%font%', 'unknown font rejected');
select pg_temp.check((pg_temp.q('{"designer":"bento","frosting_color":"pink","message":"Hi","lettering_color":"white","font":"cinzel"}')->>'extra')::numeric
  = (pg_temp.q('{"designer":"bento","frosting_color":"pink","message":"Hi","lettering_color":"white"}')->>'extra')::numeric, 'fonts do not change the price');
reset role;
-- Admin switches a font off: customers can no longer order it
update public.design_options set is_active = false where group_key = 'font' and code = 'lobster';
set role anon;
select pg_temp.check(pg_temp.fails('{"designer":"bento","frosting_color":"pink","message":"Hi","lettering_color":"white","font":"lobster"}') like '22023%font%', 'a font Admin switched off cannot be ordered');
reset role;
rollback;
