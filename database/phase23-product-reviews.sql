-- Phase 23: public, read-only product ratings for the storefront product cards and detail view.
-- Reviews are written per ORDER; a review counts toward every product in that order.
-- Only Admin-approved (visibility = 'visible') reviews are exposed, never customer or order ids.
-- No tables change. Safe to re-run.

create or replace function private.product_review_summary()
returns table(product_id uuid, review_count bigint, average_rating numeric)
language sql stable security definer set search_path = '' as $$
  select x.product_id, count(*), round(avg(x.rating)::numeric, 1)
  from (select distinct oi.product_id, r.id, r.rating
        from public.reviews r join public.order_items oi on oi.order_id = r.order_id
        where r.visibility = 'visible') x
  group by x.product_id
$$;
revoke all on function private.product_review_summary() from public;
grant execute on function private.product_review_summary() to anon, authenticated;

create or replace function public.get_product_review_summary()
returns table(product_id uuid, review_count bigint, average_rating numeric)
language sql stable security invoker set search_path = '' as $$ select * from private.product_review_summary() $$;
revoke all on function public.get_product_review_summary() from public;
grant execute on function public.get_product_review_summary() to anon, authenticated;

create or replace function private.product_reviews(target_product uuid, max_rows integer)
returns table(id uuid, rating integer, review_text text, public_display_name text, image_path text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select r.id, r.rating, r.review_text, r.public_display_name, r.image_path, r.created_at
  from public.reviews r
  where r.visibility = 'visible'
    and exists (select 1 from public.order_items oi where oi.order_id = r.order_id and oi.product_id = target_product)
  order by r.created_at desc
  limit least(greatest(coalesce(max_rows, 20), 1), 50)
$$;
revoke all on function private.product_reviews(uuid, integer) from public;
grant execute on function private.product_reviews(uuid, integer) to anon, authenticated;

create or replace function public.get_product_reviews(target_product uuid, max_rows integer default 20)
returns table(id uuid, rating integer, review_text text, public_display_name text, image_path text, created_at timestamptz)
language sql stable security invoker set search_path = '' as $$ select * from private.product_reviews(target_product, max_rows) $$;
revoke all on function public.get_product_reviews(uuid, integer) from public;
grant execute on function public.get_product_reviews(uuid, integer) to anon, authenticated;
