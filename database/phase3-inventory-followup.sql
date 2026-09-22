-- Inventory UI snapshot: include item setup choices and human-readable movement context.
create or replace function private.expire_inventory_batches() returns integer language plpgsql security definer set search_path='' as $$
declare r record; qty numeric; total integer:=0; ph_today date:=(now() at time zone 'Asia/Manila')::date; actor uuid:=coalesce(auth.uid(),(select id from public.profiles order by created_at limit 1)); begin
 for r in select b.id,b.item_id,b.batch_code,b.expires_on from public.inventory_batches b where b.archived_at is null and b.expires_on<ph_today for update loop
  select coalesce(sum(quantity_delta),0) into qty from public.inventory_movements where batch_id=r.id;
  if qty>0 then
   insert into public.inventory_movements(batch_id,quantity_delta,reason,movement_type,note,created_by,request_id) values(r.id,-qty,'expired','expired','Expiry date reached',actor,gen_random_uuid());
   update public.inventory_batches set archived_at=now(),archive_reason='Expired' where id=r.id; total:=total+1;
  else update public.inventory_batches set archived_at=now(),archive_reason='Depleted before expiry' where id=r.id; end if;
 end loop;
 return total;
end $$;

create or replace function public.inventory_snapshot() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.is_admin() then raise exception 'Admin access required.' using errcode='42501'; end if;
 perform private.expire_inventory_batches(); perform private.sync_inventory_alerts();
 return jsonb_build_object(
  'items',(select coalesce(jsonb_agg(to_jsonb(i) order by i.name),'[]'::jsonb) from public.inventory_items i where not i.is_archived),
  'batches',(select coalesce(jsonb_agg(to_jsonb(b) order by b.received_at desc),'[]'::jsonb) from public.inventory_batch_stock b),
  'movements',(select coalesce(jsonb_agg(to_jsonb(mv) order by mv.created_at desc),'[]'::jsonb) from (
    select m.*,b.batch_code,i.name as item_name,i.unit,coalesce(nullif(p.full_name,''),'System') as actor_name
    from public.inventory_movements m join public.inventory_batches b on b.id=m.batch_id join public.inventory_items i on i.id=b.item_id
    left join public.profiles p on p.id=m.created_by
  ) mv),
  'notifications',(select coalesce(jsonb_agg(to_jsonb(n) order by n.created_at desc),'[]'::jsonb) from public.inventory_notifications n)
 );
end $$;
