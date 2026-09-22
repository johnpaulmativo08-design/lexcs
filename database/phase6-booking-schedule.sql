-- Phase 6: operational daily booking schedule. This supplements (rather than replaces)
-- the existing hourly availability_slots used at customer checkout.
create table if not exists public.booking_date_settings (
  booking_date date primary key,
  capacity integer not null default 6 check (capacity between 1 and 100),
  is_closed boolean not null default false,
  closed_reason text,
  closed_by uuid references public.profiles(id),
  closed_at timestamptz,
  reopened_by uuid references public.profiles(id),
  reopened_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.booking_entries (
  id uuid primary key default gen_random_uuid(),
  order_id uuid unique references public.orders(id) on delete set null,
  customer_id uuid references public.profiles(id) on delete set null,
  customer_name text not null check (length(trim(customer_name)) between 1 and 150),
  customer_contact text,
  order_reference text not null,
  order_summary text not null default '',
  customization_summary text,
  booking_date date not null,
  scheduled_start time,
  scheduled_end time,
  fulfillment_method text not null check (fulfillment_method in ('pickup','lalamove')),
  status text not null default 'pending' check (status in ('pending','confirmed','preparing','ready','completed','cancelled')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid','partially_paid','paid','refunded')),
  order_total numeric(12,2) check (order_total is null or order_total >= 0),
  deposit_due numeric(12,2) check (deposit_due is null or deposit_due >= 0),
  amount_paid numeric(12,2) not null default 0 check (amount_paid >= 0),
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (scheduled_end is null or scheduled_start is null or scheduled_end > scheduled_start)
);
create index if not exists booking_entries_date_status_idx on public.booking_entries(booking_date,status,scheduled_start);
create index if not exists booking_entries_order_idx on public.booking_entries(order_id);

alter table public.booking_date_settings enable row level security;
alter table public.booking_entries enable row level security;
revoke all on public.booking_date_settings, public.booking_entries from anon, authenticated;
grant select on public.booking_date_settings, public.booking_entries to authenticated;
create policy booking_settings_admin_read on public.booking_date_settings for select to authenticated using ((select private.is_admin()));
create policy booking_entries_admin_read on public.booking_entries for select to authenticated using ((select private.is_admin()));

drop trigger if exists booking_settings_touch_updated_at on public.booking_date_settings;
create trigger booking_settings_touch_updated_at before update on public.booking_date_settings for each row execute function private.touch_updated_at();
drop trigger if exists booking_entries_touch_updated_at on public.booking_entries;
create trigger booking_entries_touch_updated_at before update on public.booking_entries for each row execute function private.touch_updated_at();

create or replace function private.assert_booking_date_available(target_date date, include_existing_orders boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare setting public.booking_date_settings; active_count integer; cap integer;
begin
  if target_date is null then raise exception 'A booking date is required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('lexc-booking-date:' || target_date::text, 0));
  insert into public.booking_date_settings(booking_date) values(target_date) on conflict(booking_date) do nothing;
  select * into setting from public.booking_date_settings where booking_date=target_date for update;
  if setting.is_closed then raise exception 'This date is closed for bookings.'; end if;
  select count(*) into active_count from public.booking_entries where booking_date=target_date and status <> 'cancelled';
  if include_existing_orders then
    select active_count + count(*) into active_count from public.orders o
    where (o.receiving_start at time zone 'Asia/Manila')::date=target_date and o.status <> 'cancelled'
      and not exists (select 1 from public.booking_entries b where b.order_id=o.id);
  end if;
  cap:=setting.capacity;
  if active_count >= cap then raise exception 'This booking date is fully booked (% active bookings).', cap; end if;
end $$;
revoke all on function private.assert_booking_date_available(date,boolean) from public;

create or replace function private.sync_order_booking() returns trigger language plpgsql security definer set search_path='' as $$
declare summary text;
begin
  select coalesce(string_agg(i.name_snapshot || case when i.quantity>1 then ' ×' || i.quantity else '' end, ', ' order by i.line_number),'Order') into summary from public.order_items i where i.order_id=new.id;
  insert into public.booking_entries(order_id,customer_id,customer_name,customer_contact,order_reference,order_summary,customization_summary,booking_date,scheduled_start,scheduled_end,fulfillment_method,status,payment_status,order_total,deposit_due,amount_paid,notes,created_by)
  values(new.id,new.customer_id,new.customer_name,new.contact_phone,'ORD-'||new.order_number,summary,null,(new.receiving_start at time zone 'Asia/Manila')::date,(new.receiving_start at time zone 'Asia/Manila')::time,(new.receiving_end at time zone 'Asia/Manila')::time,new.fulfillment_method,new.status,new.payment_status,new.total_amount,new.deposit_due,new.amount_paid,new.notes,new.customer_id)
  on conflict(order_id) do update set customer_name=excluded.customer_name,customer_contact=excluded.customer_contact,order_summary=excluded.order_summary,booking_date=excluded.booking_date,scheduled_start=excluded.scheduled_start,scheduled_end=excluded.scheduled_end,fulfillment_method=excluded.fulfillment_method,status=excluded.status,payment_status=excluded.payment_status,order_total=excluded.order_total,deposit_due=excluded.deposit_due,amount_paid=excluded.amount_paid,notes=excluded.notes;
  return new;
end $$;
revoke all on function private.sync_order_booking() from public;

create or replace function private.check_order_booking_capacity() returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform private.assert_booking_date_available((new.receiving_start at time zone 'Asia/Manila')::date, true);
  return new;
end $$;
revoke all on function private.check_order_booking_capacity() from public;
drop trigger if exists orders_booking_capacity on public.orders;
create trigger orders_booking_capacity before insert on public.orders for each row execute function private.check_order_booking_capacity();
drop trigger if exists orders_sync_booking on public.orders;
create trigger orders_sync_booking after insert or update of status,customer_name,contact_phone,receiving_start,receiving_end,fulfillment_method,payment_status,total_amount,deposit_due,amount_paid,notes on public.orders for each row execute function private.sync_order_booking();

create or replace function private.create_booking(payload jsonb) returns public.booking_entries language plpgsql security definer set search_path='' as $$
declare result public.booking_entries; target_date date:=nullif(payload->>'booking_date','')::date; assigned_order uuid:=nullif(payload->>'order_id','')::uuid;
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'Admin access required.' using errcode='42501'; end if;
  perform private.assert_booking_date_available(target_date, true);
  if assigned_order is not null and exists(select 1 from public.booking_entries where order_id=assigned_order) then raise exception 'This order is already scheduled.'; end if;
  insert into public.booking_entries(order_id,customer_id,customer_name,customer_contact,order_reference,order_summary,customization_summary,booking_date,scheduled_start,scheduled_end,fulfillment_method,status,payment_status,order_total,deposit_due,amount_paid,notes,created_by)
  values(assigned_order,nullif(payload->>'customer_id','')::uuid,trim(payload->>'customer_name'),nullif(trim(payload->>'customer_contact'),''),coalesce(nullif(trim(payload->>'order_reference'),''),'Manual booking'),coalesce(nullif(trim(payload->>'order_summary'),''),'Order details pending'),nullif(trim(payload->>'customization_summary'),''),target_date,nullif(payload->>'scheduled_start','')::time,nullif(payload->>'scheduled_end','')::time,coalesce(payload->>'fulfillment_method','pickup'),coalesce(payload->>'status','pending'),coalesce(payload->>'payment_status','unpaid'),nullif(payload->>'order_total','')::numeric,nullif(payload->>'deposit_due','')::numeric,coalesce(nullif(payload->>'amount_paid','')::numeric,0),nullif(trim(payload->>'notes'),''),auth.uid()) returning * into result;
  return result;
end $$;
revoke all on function private.create_booking(jsonb) from public;
grant execute on function private.create_booking(jsonb) to authenticated;
create or replace function public.create_booking(payload jsonb) returns public.booking_entries language sql security invoker set search_path='' as $$ select private.create_booking(payload) $$;
revoke all on function public.create_booking(jsonb) from public;
grant execute on function public.create_booking(jsonb) to authenticated;

create or replace function private.update_booking_status(target uuid,next_status text) returns public.booking_entries language plpgsql security definer set search_path='' as $$
declare result public.booking_entries;
begin
 if auth.uid() is null or not private.is_admin() then raise exception 'Admin access required.' using errcode='42501'; end if;
 select * into result from public.booking_entries where id=target for update;
 if not found then raise exception 'Booking not found.'; end if;
 if next_status not in ('pending','confirmed','preparing','ready','completed','cancelled') then raise exception 'Invalid booking status.'; end if;
 update public.booking_entries set status=next_status where id=target returning * into result;
 return result;
end $$;
revoke all on function private.update_booking_status(uuid,text) from public;
grant execute on function private.update_booking_status(uuid,text) to authenticated;
create or replace function public.update_booking_status(target uuid,next_status text) returns public.booking_entries language sql security invoker set search_path='' as $$ select private.update_booking_status(target,next_status) $$;
revoke all on function public.update_booking_status(uuid,text) from public;
grant execute on function public.update_booking_status(uuid,text) to authenticated;

create or replace function private.save_booking_date_setting(payload jsonb) returns public.booking_date_settings language plpgsql security definer set search_path='' as $$
declare result public.booking_date_settings; target_date date:=nullif(payload->>'booking_date','')::date; desired_closed boolean:=coalesce((payload->>'is_closed')::boolean,false); wanted_capacity integer:=coalesce((payload->>'capacity')::integer,6); active_count integer;
begin
 if auth.uid() is null or not private.is_admin() then raise exception 'Admin access required.' using errcode='42501'; end if;
 if target_date is null or wanted_capacity not between 1 and 100 then raise exception 'A valid date and capacity are required.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('lexc-booking-date:' || target_date::text, 0));
 insert into public.booking_date_settings(booking_date,capacity) values(target_date,wanted_capacity) on conflict(booking_date) do nothing;
 select count(*) into active_count from public.booking_entries where booking_date=target_date and status <> 'cancelled';
 if active_count>wanted_capacity then raise exception 'Capacity cannot be lower than current active bookings.'; end if;
 update public.booking_date_settings set capacity=wanted_capacity,is_closed=desired_closed,closed_reason=case when desired_closed then nullif(left(payload->>'closed_reason',500),'') else null end,closed_by=case when desired_closed then auth.uid() else closed_by end,closed_at=case when desired_closed then now() else closed_at end,reopened_by=case when not desired_closed then auth.uid() else reopened_by end,reopened_at=case when not desired_closed then now() else reopened_at end where booking_date=target_date returning * into result;
 return result;
end $$;
revoke all on function private.save_booking_date_setting(jsonb) from public;
grant execute on function private.save_booking_date_setting(jsonb) to authenticated;
create or replace function public.save_booking_date_setting(payload jsonb) returns public.booking_date_settings language sql security invoker set search_path='' as $$ select private.save_booking_date_setting(payload) $$;
revoke all on function public.save_booking_date_setting(jsonb) from public;
grant execute on function public.save_booking_date_setting(jsonb) to authenticated;

-- The Admin calendar is queried through this protected projection, not direct table access.
create or replace function private.booking_schedule(from_date date,to_date date)
returns table(id uuid,order_id uuid,customer_name text,customer_contact text,order_reference text,order_summary text,customization_summary text,booking_date date,scheduled_start time,scheduled_end time,fulfillment_method text,status text,payment_status text,order_total numeric,deposit_due numeric,amount_paid numeric,notes text,capacity integer,is_closed boolean,closed_reason text)
language sql stable security definer set search_path='' as $$
 select b.id,b.order_id,b.customer_name,b.customer_contact,b.order_reference,b.order_summary,b.customization_summary,b.booking_date,b.scheduled_start,b.scheduled_end,b.fulfillment_method,b.status,b.payment_status,b.order_total,b.deposit_due,b.amount_paid,b.notes,coalesce(s.capacity,6),coalesce(s.is_closed,false),s.closed_reason
 from public.booking_entries b left join public.booking_date_settings s on s.booking_date=b.booking_date
 where b.booking_date>=from_date and b.booking_date<=to_date order by b.booking_date,b.scheduled_start nulls last,b.created_at
$$;
revoke all on function private.booking_schedule(date,date) from public;
grant execute on function private.booking_schedule(date,date) to authenticated;
create or replace function public.get_booking_schedule(from_date date,to_date date)
returns table(id uuid,order_id uuid,customer_name text,customer_contact text,order_reference text,order_summary text,customization_summary text,booking_date date,scheduled_start time,scheduled_end time,fulfillment_method text,status text,payment_status text,order_total numeric,deposit_due numeric,amount_paid numeric,notes text,capacity integer,is_closed boolean,closed_reason text)
language plpgsql security invoker set search_path='' as $$ begin if auth.uid() is null or not private.is_admin() then raise exception 'Admin access required.' using errcode='42501'; end if; return query select * from private.booking_schedule(from_date,to_date); end $$;
revoke all on function public.get_booking_schedule(date,date) from public;
grant execute on function public.get_booking_schedule(date,date) to authenticated;

-- Idempotent normal demo records. They represent manual booking entries, never QA-only rows.
do $$
declare actor uuid;
begin
 select p.id into actor from public.profiles p join public.user_roles r on r.user_id=p.id where r.role='admin' order by p.created_at limit 1;
 if actor is null then raise exception 'An Admin profile is required before seeding bookings.'; end if;
 insert into public.booking_entries(customer_name,customer_contact,order_reference,order_summary,customization_summary,booking_date,scheduled_start,scheduled_end,fulfillment_method,status,payment_status,order_total,deposit_due,amount_paid,notes,created_by)
 select * from (values
  ('Mia Santos','0917 111 2048','ORD-1048','Bento Cake ×1',null::text,'2026-09-21'::date,'09:00'::time,'10:00'::time,'pickup','confirmed','partially_paid',2000::numeric,1200::numeric,1200::numeric,null::text,actor),
  ('Jane Dela Cruz','0917 123 4567','ORD-1052','Bento Cake ×1, Mini Donuts ×12','Pink icing, "Happy Birthday Mia"','2026-09-21','11:30','12:30','lalamove','confirmed','partially_paid',2000,1200,1200,null,actor),
  ('Mark Rivera','0917 555 1053','ORD-1053','Customized Cake ×1','Birthday message requested','2026-09-21','14:00','15:00','pickup','pending','unpaid',2500,1500,0,null,actor),
  ('Ella Cruz','0917 222 1054','ORD-1054','Cupcakes ×1 box',null,'2026-09-21','16:00','17:00','lalamove','confirmed','partially_paid',1800,1080,1080,null,actor),
  ('Daniel Co','0917 100 1055','ORD-1055','Mini Donuts ×1 box',null,'2026-09-22','09:00','10:00','lalamove','confirmed','paid',1200,720,1200,null,actor),
  ('Rhea Beltran','0917 100 1056','ORD-1056','Cupcakes ×1 box',null,'2026-09-22','10:00','11:00','pickup','confirmed','partially_paid',1500,900,900,null,actor),
  ('Leo Kim','0917 100 1057','ORD-1057','Cookies ×2 boxes',null,'2026-09-22','12:00','13:00','pickup','preparing','partially_paid',1600,960,960,null,actor),
  ('Nathan Sy','0917 100 1058','ORD-1058','Bento Cake ×1',null,'2026-09-22','14:00','15:00','pickup','confirmed','partially_paid',2000,1200,1200,null,actor),
  ('Isla Mendoza','0917 100 1059','ORD-1059','Cookies ×2 boxes',null,'2026-09-22','15:00','16:00','lalamove','confirmed','paid',1600,960,1600,null,actor),
  ('Kenji Ocampo','0917 100 1060','ORD-1060','Mini Donuts ×1 box',null,'2026-09-22','16:00','17:00','pickup','pending','unpaid',1200,720,0,null,actor),
  ('Grace Ng','0917 100 1061','ORD-1061','Bento Cake ×1',null,'2026-09-23','09:00','10:00','pickup','confirmed','partially_paid',2000,1200,1200,null,actor),
  ('Lara Villanueva','0917 100 1062','ORD-1062','Customized Cake ×1','Blue floral finish','2026-09-23','11:00','12:00','lalamove','confirmed','partially_paid',2600,1560,1560,null,actor),
  ('Carlos Tan','0917 100 1063','ORD-1063','Brownies ×2 boxes',null,'2026-09-23','14:00','15:00','pickup','pending','unpaid',1400,840,0,null,actor),
  ('Miguel Santos','0917 100 1064','ORD-1064','Cupcakes ×1 box',null,'2026-09-24','10:00','11:00','lalamove','confirmed','partially_paid',1500,900,900,null,actor),
  ('Tina Wu','0917 100 1065','ORD-1065','Brownies ×1 box',null,'2026-09-24','13:00','14:00','pickup','pending','unpaid',700,420,0,null,actor),
  ('Jason P','0917 100 1066','ORD-1066','Bento Cake ×1',null,'2026-09-25','09:00','10:00','lalamove','confirmed','partially_paid',2000,1200,1200,null,actor),
  ('Karen L','0917 100 1067','ORD-1067','Mini Donuts ×1 box',null,'2026-09-25','11:00','12:00','pickup','confirmed','paid',1200,720,1200,null,actor),
  ('Mark D','0917 100 1068','ORD-1068','Cookies ×1 box',null,'2026-09-25','13:00','14:00','lalamove','cancelled','unpaid',800,480,0,'Customer cancelled',actor),
  ('Ella V','0917 100 1069','ORD-1069','Cookies ×1 box',null,'2026-09-25','15:00','16:00','pickup','confirmed','partially_paid',800,480,480,null,actor),
  ('Rhea M','0917 100 1070','ORD-1070','Cupcakes ×2 boxes',null,'2026-09-25','16:00','17:00','lalamove','confirmed','partially_paid',3000,1800,1800,null,actor),
  ('Miguel Torres','0917 100 1071','ORD-1071','Bento Cake ×1',null,'2026-09-25','17:00','18:00','pickup','pending','unpaid',2000,1200,0,null,actor),
  ('Ana Reyes','0917 100 1072','ORD-1072','Mini Donuts ×1 box',null,'2026-09-26','10:00','11:00','pickup','confirmed','partially_paid',1200,720,720,null,actor)
 ) as seed(customer_name,customer_contact,order_reference,order_summary,customization_summary,booking_date,scheduled_start,scheduled_end,fulfillment_method,status,payment_status,order_total,deposit_due,amount_paid,notes,created_by)
 where not exists(select 1 from public.booking_entries b where b.order_reference=seed.order_reference);
end $$;
