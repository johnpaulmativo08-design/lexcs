-- Phase 42: reviews for the Updates page's Reviews tab, with what was ordered, so a review card can name the
-- products (size, quantity, custom design) and link to them. Customers get approved reviews only; Admin can
-- ask for hidden ones too (to moderate). Never exposes customer or order ids. No tables change; safe to re-run.

create or replace function private.review_feed(include_hidden boolean)
returns table(id uuid, rating integer, review_text text, public_display_name text, image_path text,
              visibility text, created_at timestamptz, items jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  if include_hidden and not private.is_admin() then
    raise exception 'Only the store owner can see hidden reviews.' using errcode = '42501';
  end if;
  return query
  select r.id, r.rating, r.review_text, r.public_display_name, r.image_path, r.visibility, r.created_at,
    coalesce((select jsonb_agg(jsonb_build_object(
        'product_id', oi.product_id, 'name', oi.name_snapshot, 'size', oi.variant_label_snapshot,
        'quantity', oi.quantity, 'designer', oi.customization->>'designer') order by oi.line_number)
      from public.order_items oi where oi.order_id = r.order_id), '[]'::jsonb)
  from public.reviews r
  where include_hidden or r.visibility = 'visible'
  order by r.created_at desc
  limit 100;
end $$;
revoke all on function private.review_feed(boolean) from public;
grant execute on function private.review_feed(boolean) to anon, authenticated;

create or replace function public.get_review_feed(include_hidden boolean default false)
returns table(id uuid, rating integer, review_text text, public_display_name text, image_path text,
              visibility text, created_at timestamptz, items jsonb)
language sql stable security invoker set search_path = '' as $$ select * from private.review_feed(include_hidden) $$;
revoke all on function public.get_review_feed(boolean) from public;
grant execute on function public.get_review_feed(boolean) to anon, authenticated;
