-- LOCAL ONLY: acceptance tests for phase42-review-feed.sql (customer ...0c, admin ...0a). Rolled back.
\set ON_ERROR_STOP 1
begin;
create or replace function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'FAILED: %', label; end if; raise notice 'PASS: %', label; end $$;
create or replace function pg_temp.who(sub text) returns void language sql as $$ select set_config('request.jwt.claim.sub', coalesce(sub, ''), false) $$;
create or replace function pg_temp.fails(sql text) returns text language plpgsql as $$
begin execute sql; return null; exception when others then return sqlstate; end $$;
grant execute on all functions in schema pg_temp to anon, authenticated;
create temp table want as select count(*) filter (where visibility = 'visible') v, count(*) a from public.reviews;
grant select on want to anon, authenticated;

set role anon; select pg_temp.who(null);
select pg_temp.check((select count(*) from public.get_review_feed()) = (select v from want), 'guests see approved reviews only');
select pg_temp.check(not exists (select 1 from public.get_review_feed() where visibility <> 'visible'), 'no hidden review leaks');
select pg_temp.check(pg_temp.fails('select * from public.get_review_feed(true)') = '42501', 'guests cannot ask for hidden reviews');
select pg_temp.check(coalesce((select bool_and(jsonb_typeof(items) = 'array') from public.get_review_feed()), true), 'each review lists what was ordered');
select pg_temp.check(coalesce((select bool_and(not (items::text ~ 'order_id|customer_id')) from public.get_review_feed()), true), 'no order or customer ids');
reset role;

set role authenticated; select pg_temp.who('00000000-0000-0000-0000-00000000000c');
select pg_temp.check(pg_temp.fails('select * from public.get_review_feed(true)') = '42501', 'customers cannot ask for hidden reviews');
reset role;

set role authenticated; select pg_temp.who('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) from public.get_review_feed(true)) = (select a from want), 'Admin sees every review to moderate');
reset role;
rollback;
