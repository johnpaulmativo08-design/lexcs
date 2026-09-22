-- Real opening inventory supplied by the baker. This seed is idempotent and never runs in the browser.
alter table public.inventory_batches
  add column if not exists stock_in_date date;

update public.inventory_batches
set stock_in_date = (received_at at time zone 'Asia/Manila')::date
where stock_in_date is null;

alter table public.inventory_batches
  alter column stock_in_date set default ((now() at time zone 'Asia/Manila')::date),
  alter column stock_in_date set not null;

create or replace function private.set_inventory_stock_in_date() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.stock_in_date is null then
    new.stock_in_date := (new.received_at at time zone 'Asia/Manila')::date;
  end if;
  return new;
end $$;

drop trigger if exists inventory_batches_stock_in_date on public.inventory_batches;
create trigger inventory_batches_stock_in_date
before insert or update of received_at,stock_in_date on public.inventory_batches
for each row execute function private.set_inventory_stock_in_date();

alter table public.inventory_movements drop constraint if exists inventory_movements_movement_type_check;
alter table public.inventory_movements add constraint inventory_movements_movement_type_check
check(movement_type in ('initial_stock','restock','stock_usage','waste','remake','damaged','adjustment_positive','adjustment_negative','expired'));

create or replace view public.inventory_batch_stock with (security_invoker=true) as
select b.id as batch_id,b.batch_code,b.item_id,i.name,i.category,i.inventory_type,i.unit,i.min_stock,i.expiring_window_days,
 b.quantity_received,b.received_at,b.expires_on,b.purchase_price,b.notes,b.archived_at,b.archive_reason,
 coalesce(sum(m.quantity_delta),0) as remaining_quantity,
 case when b.archived_at is not null then coalesce(b.archive_reason,'Archived')
      when coalesce(sum(m.quantity_delta),0)<=0 then 'Out of Stock'
      when coalesce(sum(m.quantity_delta),0)<=i.min_stock then 'Low Stock'
      when b.expires_on is not null and b.expires_on >= (now() at time zone 'Asia/Manila')::date and b.expires_on < ((now() at time zone 'Asia/Manila')::date+i.expiring_window_days) then 'Expiring Soon'
      else 'In Stock' end as status,
 b.stock_in_date
from public.inventory_batches b join public.inventory_items i on i.id=b.item_id
left join public.inventory_movements m on m.batch_id=b.id
group by b.id,i.id;

do $$
declare actor uuid;
begin
  select p.id into actor
  from public.profiles p join public.user_roles r on r.user_id=p.id
  where r.role='admin' order by p.created_at limit 1;
  if actor is null then raise exception 'An Admin profile is required before importing inventory.'; end if;

  with seed(batch_code,item_name,category,quantity,unit,expires_on,stock_in_date) as (values
    ('APF-001','All Purpose Flour','Dry Ingredients',9::numeric,'kg','2026-09-09'::date,'2025-12-09'::date),
    ('CCA-001','Cocoa','Dry Ingredients',2002,'g','2027-12-09','2025-12-09'),
    ('WRS-001','White Sugar','Dry Ingredients',2001,'g','2027-12-09','2025-12-09'),
    ('BRS-001','Brown Sugar','Dry Ingredients',2000,'g','2027-12-09','2025-12-09'),
    ('PDS-001','Powdered Sugar','Dry Ingredients',1000.5,'g','2027-12-09','2025-12-09'),
    ('BDP-001','Baking Powder','Dry Ingredients',1000,'g','2027-06-09','2025-12-09'),
    ('BDS-001','Baking Soda','Dry Ingredients',1.5,'kg','2027-12-09','2025-12-09'),
    ('SLT-001','Salt','Dry Ingredients',0.5,'kg','2028-12-09','2025-12-09'),
    ('EGG-001','Egg','Perishable Ingredients',19,'pcs','2026-01-06','2025-12-09'),
    ('OIL-001','Oil','Liquid Ingredients',2200,'mL','2026-12-09','2025-12-09'),
    ('VNE-001','Vanilla Extract','Liquid Ingredients',300,'mL','2028-12-09','2025-12-09'),
    ('FCM-001','Full Cream Milk','Liquid Ingredients',500,'mL','2026-06-09','2025-12-09'),
    ('BTR-001','Butter','Dairy',5,'pcs','2026-03-09','2025-12-09'),
    ('GLU-001','Glucose','Other Ingredients',600,'g','2027-12-09','2025-12-09'),
    ('DCH-001','Dark Chocolate','Chocolate',2200,'g','2026-12-09','2025-12-09'),
    ('CCM-001','Chocolate Compound','Chocolate',300,'g','2026-12-09','2025-12-09'),
    ('WCH-001','White Chocolate','Chocolate',200,'g','2026-09-09','2025-12-09'),
    ('MTC-001','Matcha','Flavoring',200,'g','2026-06-09','2025-12-09'),
    ('STR-001','Strawberry','Flavoring',200,'g','2026-06-09','2025-12-09'),
    ('UBE-001','Ube','Flavoring',200,'g','2026-06-09','2025-12-09'),
    ('CSW-001','Cashew','Nuts',800,'g','2026-06-09','2025-12-09'),
    ('WLN-001','Walnut','Nuts',1000,'g','2026-06-09','2025-12-09'),
    ('ICG-001','Icing','Decorating',3300,'g','2026-09-09','2025-12-09'),
    ('FDT-001','Fondant','Decorating',1300,'g','2026-12-09','2025-12-09'),
    ('ALM-001','Almond','Nuts',1500,'g','2026-09-09','2025-12-09'),
    ('SPR-001','Sprinkle','Decorating',150,'g','2027-12-09','2025-12-09'),
    ('MSH-001','Marshmallow','Decorating',500,'g','2026-06-09','2025-12-09'),
    ('COR-001','Crushed Oreo','Decorating',500,'g','2026-06-09','2025-12-09'),
    ('CRM-001','Cream Cheese','Dairy',3,'pcs','2026-01-09','2025-12-09')
  )
  insert into public.inventory_items(name,category,inventory_type,unit,min_stock,item_code)
  select item_name,category,'ingredient',unit,0,split_part(batch_code,'-',1) from seed
  on conflict (lower(name),unit) do nothing;

  with seed(batch_code,item_name,quantity,unit,expires_on,stock_in_date) as (values
    ('APF-001','All Purpose Flour',9::numeric,'kg','2026-09-09'::date,'2025-12-09'::date),('CCA-001','Cocoa',2002,'g','2027-12-09','2025-12-09'),('WRS-001','White Sugar',2001,'g','2027-12-09','2025-12-09'),('BRS-001','Brown Sugar',2000,'g','2027-12-09','2025-12-09'),('PDS-001','Powdered Sugar',1000.5,'g','2027-12-09','2025-12-09'),('BDP-001','Baking Powder',1000,'g','2027-06-09','2025-12-09'),('BDS-001','Baking Soda',1.5,'kg','2027-12-09','2025-12-09'),('SLT-001','Salt',0.5,'kg','2028-12-09','2025-12-09'),('EGG-001','Egg',19,'pcs','2026-01-06','2025-12-09'),('OIL-001','Oil',2200,'mL','2026-12-09','2025-12-09'),('VNE-001','Vanilla Extract',300,'mL','2028-12-09','2025-12-09'),('FCM-001','Full Cream Milk',500,'mL','2026-06-09','2025-12-09'),('BTR-001','Butter',5,'pcs','2026-03-09','2025-12-09'),('GLU-001','Glucose',600,'g','2027-12-09','2025-12-09'),('DCH-001','Dark Chocolate',2200,'g','2026-12-09','2025-12-09'),('CCM-001','Chocolate Compound',300,'g','2026-12-09','2025-12-09'),('WCH-001','White Chocolate',200,'g','2026-09-09','2025-12-09'),('MTC-001','Matcha',200,'g','2026-06-09','2025-12-09'),('STR-001','Strawberry',200,'g','2026-06-09','2025-12-09'),('UBE-001','Ube',200,'g','2026-06-09','2025-12-09'),('CSW-001','Cashew',800,'g','2026-06-09','2025-12-09'),('WLN-001','Walnut',1000,'g','2026-06-09','2025-12-09'),('ICG-001','Icing',3300,'g','2026-09-09','2025-12-09'),('FDT-001','Fondant',1300,'g','2026-12-09','2025-12-09'),('ALM-001','Almond',1500,'g','2026-09-09','2025-12-09'),('SPR-001','Sprinkle',150,'g','2027-12-09','2025-12-09'),('MSH-001','Marshmallow',500,'g','2026-06-09','2025-12-09'),('COR-001','Crushed Oreo',500,'g','2026-06-09','2025-12-09'),('CRM-001','Cream Cheese',3,'pcs','2026-01-09','2025-12-09')
  )
  insert into public.inventory_batches(item_id,batch_code,quantity_received,received_at,stock_in_date,expires_on,notes)
  select i.id,s.batch_code,s.quantity,(s.stock_in_date::text||' 12:00:00+08')::timestamptz,s.stock_in_date,s.expires_on,'Imported from baker''s existing inventory'
  from seed s join public.inventory_items i on lower(i.name)=lower(s.item_name) and i.unit=s.unit
  on conflict(batch_code) do nothing;

  with seed(batch_code,quantity,unit) as (values
    ('APF-001',9::numeric,'kg'),('CCA-001',2002,'g'),('WRS-001',2001,'g'),('BRS-001',2000,'g'),('PDS-001',1000.5,'g'),('BDP-001',1000,'g'),('BDS-001',1.5,'kg'),('SLT-001',0.5,'kg'),('EGG-001',19,'pcs'),('OIL-001',2200,'mL'),('VNE-001',300,'mL'),('FCM-001',500,'mL'),('BTR-001',5,'pcs'),('GLU-001',600,'g'),('DCH-001',2200,'g'),('CCM-001',300,'g'),('WCH-001',200,'g'),('MTC-001',200,'g'),('STR-001',200,'g'),('UBE-001',200,'g'),('CSW-001',800,'g'),('WLN-001',1000,'g'),('ICG-001',3300,'g'),('FDT-001',1300,'g'),('ALM-001',1500,'g'),('SPR-001',150,'g'),('MSH-001',500,'g'),('COR-001',500,'g'),('CRM-001',3,'pcs')
  )
  insert into public.inventory_movements(batch_id,quantity_delta,reason,movement_type,note,reference,created_by,request_id,created_at)
  select b.id,s.quantity,'receipt','initial_stock','Imported from baker''s existing inventory','Opening balance',actor,md5('lexc-baker-import:'||s.batch_code)::uuid,b.received_at
  from seed s join public.inventory_batches b on b.batch_code=s.batch_code
  where b.notes='Imported from baker''s existing inventory'
  on conflict(request_id) do nothing;

  perform private.expire_inventory_batches();
  perform private.sync_inventory_alerts();
end $$;
