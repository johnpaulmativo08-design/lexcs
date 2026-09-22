create function private.save_product(payload jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare target uuid:=(payload->>'id')::uuid; v jsonb; existing public.products; variant_ids uuid[]:='{}'; vid uuid;
begin
 if auth.uid() is null or not private.is_admin() then raise exception 'Admin access required.' using errcode='42501'; end if;
 if target is null or length(trim(coalesce(payload->>'name','')))=0 then raise exception 'Product name and ID required.'; end if;
 if jsonb_typeof(payload->'variants') is distinct from 'array' or jsonb_array_length(payload->'variants') not between 1 and 50 then raise exception 'Provide 1 to 50 variants.'; end if;
 select * into existing from public.products where id=target for update;
 if found then
  if payload->>'kind' is distinct from existing.kind then raise exception 'Existing product type cannot change.'; end if;
  update public.products set name=trim(payload->>'name'),description=coalesce(payload->>'description',''),category_id=(payload->>'category_id')::uuid,image_path=payload->>'image_path',package_contents=payload->'package_contents' where id=target;
 else
  insert into public.products(id,slug,name,description,category_id,kind,image_path,package_contents)
  values(target,payload->>'slug',trim(payload->>'name'),coalesce(payload->>'description',''),(payload->>'category_id')::uuid,payload->>'kind',payload->>'image_path',payload->'package_contents');
 end if;
 for v in select value from jsonb_array_elements(payload->'variants') loop
  vid:=coalesce((v->>'id')::uuid,gen_random_uuid());
  if exists(select 1 from public.product_variants where id=vid and product_id<>target) then raise exception 'Variant belongs to another product.'; end if;
  insert into public.product_variants(id,product_id,code,label,price,sort_order,is_active)
  values(vid,target,v->>'code',v->>'label',(v->>'price')::numeric,(v->>'sort_order')::integer,true)
  on conflict(id) do update set label=excluded.label,price=excluded.price,sort_order=excluded.sort_order,is_active=true;
  variant_ids:=array_append(variant_ids,vid);
 end loop;
 if existing.kind='customizable' and (select count(*) from public.product_variants where product_id=target and id=any(variant_ids) and code in ('swirl','rose','smooth'))<>3 then raise exception 'All three frosting options are required.'; end if;
 update public.product_variants set is_active=false where product_id=target and not(id=any(variant_ids));
 return target;
end $$;
revoke all on function private.save_product(jsonb) from public,anon;
grant execute on function private.save_product(jsonb) to authenticated;
create function public.save_product(payload jsonb) returns uuid language sql security invoker set search_path='' as $$ select private.save_product(payload) $$;
revoke all on function public.save_product(jsonb) from public,anon;
grant execute on function public.save_product(jsonb) to authenticated;
