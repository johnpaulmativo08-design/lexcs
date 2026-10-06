-- Acceptance test for phase48-review-when-paid.sql. Safe on the live database: everything is ROLLED BACK.
-- The results arrive as an error message on purpose: the error undoes the transaction.
begin;
create temp table r(n serial, result text);
create temp table t(k text primary key, v text);
grant all on r, t to authenticated; grant usage on sequence r_n_seq to authenticated;
insert into t select 'paid', id::text from public.orders where payment_status = 'paid' and status not in ('completed','cancelled') order by created_at desc limit 1;
insert into t select 'paid_customer', customer_id::text from public.orders where id = (select v::uuid from t where k = 'paid');
insert into t select 'unpaid', id::text from public.orders where payment_status <> 'paid' and status not in ('completed','cancelled')
  and customer_id = (select v::uuid from t where k = 'paid_customer') order by created_at desc limit 1;
create or replace function pg_temp.ok(pass boolean, label text) returns void language sql as $$
  insert into r(result) values ((case when coalesce(pass, false) then 'PASS: ' else 'FAIL: ' end) || label) $$;
create or replace function pg_temp.review(target text) returns text language plpgsql as $$
begin
  perform public.submit_review(jsonb_build_object('order_id', (select v from t where k = target), 'display_name', 'Test', 'rating', 5, 'text', 'Test review'));
  return 'ok';
exception when others then return 'ERR ' || sqlerrm;
end $$;
grant execute on all functions in schema pg_temp to authenticated;

select set_config('request.jwt.claim.sub', (select v from t where k = 'paid_customer'), true),
       set_config('request.jwt.claims', json_build_object('sub', (select v from t where k = 'paid_customer'), 'role', 'authenticated')::text, true);
set local role authenticated;
select pg_temp.ok(pg_temp.review('paid') = 'ok', 'a fully paid order (not yet completed) can be reviewed');
select pg_temp.ok((select v from t where k = 'unpaid') is null or pg_temp.review('unpaid') like 'ERR%once it is fully paid%', 'an order that is not fully paid cannot be reviewed yet');
reset role;
select pg_temp.ok((select visibility from public.reviews where order_id = (select v::uuid from t where k = 'paid')) = 'hidden', 'the new review waits for LexC''s approval');

do $$ begin
  raise exception E'PHASE 48 TESTS (all changes rolled back): % failed\n%', (select count(*) from r where result like 'FAIL%'),
    (select string_agg(result, E'\n' order by n) from r);
end $$;
