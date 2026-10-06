-- Phase 48: a customer can review an order once it is fully paid (before, only after it was marked completed).
-- Cancelled orders still cannot be reviewed. Everything else in submit_review is unchanged (from phase 2):
-- reviews start hidden until LexC's approves them. Safe to re-run.
begin;
create or replace function private.submit_review(payload jsonb) returns public.reviews language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); r public.reviews; path text:=nullif(payload->>'image_path',''); begin
 if u is null then raise exception 'Sign in required.' using errcode='42501'; end if;
 if not exists(select 1 from public.orders where id=(payload->>'order_id')::uuid and customer_id=u
   and status<>'cancelled' and (status='completed' or payment_status='paid')) then
   raise exception 'You can review an order once it is fully paid.' using errcode='22023'; end if;
 if length(trim(coalesce(payload->>'display_name','')))=0 or length(coalesce(payload->>'text',''))>3000 then raise exception 'Enter a display name and a review of at most 3000 characters.'; end if;
 if path is not null and (split_part(path,'/',1)<>u::text or not exists(select 1 from storage.objects where bucket_id='review-images' and name=path)) then raise exception 'Invalid review image.'; end if;
 insert into public.reviews(order_id,customer_id,rating,review_text,public_display_name,image_path)
 values((payload->>'order_id')::uuid,u,(payload->>'rating')::integer,coalesce(payload->>'text',''),left(trim(payload->>'display_name'),100),path)
 on conflict(order_id) do update set rating=excluded.rating,review_text=excluded.review_text,public_display_name=excluded.public_display_name,image_path=excluded.image_path,visibility='hidden'
 returning * into r;
 return r;
end $$;
revoke all on function private.submit_review(jsonb) from public;
grant execute on function private.submit_review(jsonb) to authenticated;
commit;
