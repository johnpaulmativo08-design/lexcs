-- Phase 40: remove the ₱1 QR payment test (phase 9) and its "Product A" test product (phase 10).
-- Real order payments are unchanged; only the duplicate-reference check stops looking at the test table.
begin;

-- 1. Order payments: drop the payment_tests lookup from the duplicate-reference check (edited in place).
do $$
declare def text; fixed text;
  clause constant text := E'\n    or exists(select 1 from public.payment_tests t where lower(btrim(t.payment_reference))=lower(normalized))';
begin
  def := pg_get_functiondef('private.submit_order_payment(uuid,text,text)'::regprocedure);
  if position('payment_tests' in def) = 0 then return; end if;   -- already removed
  fixed := replace(def, clause, '');
  if position('payment_tests' in fixed) > 0 then
    raise exception 'Phase 40: private.submit_order_payment is not the expected version; nothing was changed.';
  end if;
  execute fixed;
end $$;

-- 2. The test-only checkout rule (test product alone, pickup, 100% payment).
drop trigger if exists order_items_payment_test on public.order_items;
drop function if exists private.enforce_payment_test_item();

-- 3. The ₱1 test page's functions and table.
drop function if exists public.start_payment_test(uuid);
drop function if exists private.start_payment_test(uuid);
drop function if exists public.submit_payment_test(uuid, text);
drop function if exists private.submit_payment_test(uuid, text);
drop function if exists public.review_payment_test(uuid, text, text);
drop function if exists private.review_payment_test(uuid, text, text);
drop table if exists public.payment_tests;

-- 4. "Product A — Payment System Test" and its category. If an old order still lists it, the product is kept
--    archived (hidden from the shop) so that order's history stays intact; otherwise it is deleted.
do $$
declare pid uuid := (select id from public.products where slug = 'product-a-payment-system-test');
begin
  if pid is null then null;
  elsif exists (select 1 from public.order_items where product_id = pid) then
    update public.products set status = 'archived' where id = pid;
  else
    delete from public.inventory_variant_recipes where variant_id in (select id from public.product_variants where product_id = pid);
    delete from public.recipe_variant_units where variant_id in (select id from public.product_variants where product_id = pid);
    delete from public.product_recipes where product_id = pid;
    update public.store_posts set product_id = null where product_id = pid;
    delete from public.product_variants where product_id = pid;
    delete from public.products where id = pid;
  end if;
  delete from public.categories c where c.slug = 'payment-test'
    and not exists (select 1 from public.products p where p.category_id = c.id);
end $$;

do $$ begin
  if to_regclass('public.payment_tests') is not null
     or exists (select 1 from pg_proc where proname in ('start_payment_test', 'submit_payment_test', 'review_payment_test', 'enforce_payment_test_item'))
     or exists (select 1 from public.products where slug = 'product-a-payment-system-test' and status = 'active') then
    raise exception 'Phase 40: the payment test was not fully removed.';
  end if;
end $$;

commit;
