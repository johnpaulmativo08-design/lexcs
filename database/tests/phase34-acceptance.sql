-- LOCAL ONLY: acceptance tests for phase34-bento-layout.sql. Run on a DISPOSABLE database built from
-- tests/local-supabase-stub.sql + phases 2-34. Everything is rolled back.
\set ON_ERROR_STOP 1
begin;
create or replace function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'FAILED: %', label; end if; raise notice 'PASS: %', label; end $$;
create or replace function pg_temp.q(d jsonb) returns jsonb language sql as $$
  select public.quote_bento_design((select id from public.products where slug = 'product-8'), d) $$;
grant execute on all functions in schema pg_temp to anon, authenticated;
set role anon;

-- A design with every movable decoration, moved
select pg_temp.check((pg_temp.q('{"designer":"bento","frosting_color":"pink","accents":["piped_flowers","ribbon_bows"],"bow_color":"red",
  "message":"Hi","lettering":"piped","lettering_color":"white","topper":"congrats",
  "layout":{"flowers":[[0.1,0.2],null,[0.5,-0.5]],"bows":[0.5,null,7.0],"topper":[0.2,-0.4],"message":[0.1,0.1]}}')->'clean'->'layout')
  = '{"flowers":[[0.1,0.2],null,[0.5,-0.5]],"bows":[0.5,null,0.717],"topper":[0.2,-0.4],"message":[0.1,0.1]}'::jsonb, 'positions kept; bow angle wrapped to 0..2π');
select pg_temp.check((pg_temp.q('{"designer":"bento","frosting_color":"pink","accents":["piped_flowers"],"layout":{"flowers":[[3,4]]}}')->'clean'->'layout'->'flowers'->0)
  = '[0.492, 0.656]'::jsonb, 'flower off the cake is pulled back to the edge (radius 0.82)');
select pg_temp.check((pg_temp.q('{"designer":"bento","frosting_color":"pink","topper":"congrats","layout":{"topper":[0,-2]}}')->'clean'->'layout'->'topper')
  = '[0, -0.7]'::jsonb, 'topper kept on top (radius 0.7)');
select pg_temp.check((pg_temp.q('{"designer":"bento","frosting_color":"pink","message":"Hi","lettering_color":"white","layout":{"message":[1,0]}}')->'clean'->'layout'->'message')
  = '[0.45, 0]'::jsonb, 'message kept in the middle area (radius 0.45)');
select pg_temp.check((pg_temp.q('{"designer":"bento","frosting_color":"pink","layout":{"flowers":[[0.1,0.1]],"bows":[1],"topper":[0,0],"message":[0,0]}}')->'clean') ? 'layout' = false,
  'positions for decorations that were not chosen are dropped');
select pg_temp.check((pg_temp.q('{"designer":"bento","frosting_color":"pink","accents":["piped_flowers"],"layout":{"flowers":["x",[1],{"a":1},[1e9,0]],"evil":"<script>"}}')->'clean') ? 'layout' = false,
  'junk positions and unknown keys are ignored, not stored');
select pg_temp.check((pg_temp.q('{"designer":"bento","frosting_color":"pink","accents":["piped_flowers"],"layout":"nope"}')->'clean') ? 'layout' = false, 'a non-object layout is ignored');
select pg_temp.check((pg_temp.q('{"designer":"bento","frosting_color":"pink","accents":["piped_flowers"],"layout":{"flowers":[[0.1,0.2]]}}')->'clean'->>'summary') like '%Custom placement', 'summary says Custom placement');
select pg_temp.check((pg_temp.q('{"designer":"bento","frosting_color":"pink","accents":["piped_flowers"]}')->'clean'->>'summary') not like '%Custom placement%', 'no placement note when nothing moved');
select pg_temp.check((pg_temp.q('{"designer":"bento","frosting_color":"pink","accents":["piped_flowers"],"layout":{"flowers":[[0.1,0.2]]}}')->>'extra')::numeric
  = (pg_temp.q('{"designer":"bento","frosting_color":"pink","accents":["piped_flowers"]}')->>'extra')::numeric, 'arranging is free');
select pg_temp.check(jsonb_array_length(pg_temp.q('{"designer":"bento","frosting_color":"pink","accents":["piped_flowers"],"layout":{"flowers":[[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0]]}}')->'clean'->'layout'->'flowers') = 7,
  'at most 7 flower positions');
reset role;
rollback;
