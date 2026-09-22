-- LexC Phase 2 foundation. Applied to the hosted project with Supabase MCP.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, anon;
create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 full_name text not null default '', phone text, avatar_path text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.user_roles (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 role text not null default 'customer' check(role in ('customer','admin')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create function private.is_admin() returns boolean language sql stable security invoker set search_path=''
as $$ select exists(select 1 from public.user_roles where user_id=(select auth.uid()) and role='admin') $$;
revoke all on function private.is_admin() from public;
grant execute on function private.is_admin() to anon, authenticated;
create function private.touch_updated_at() returns trigger language plpgsql set search_path=''
as $$ begin new.updated_at=now(); return new; end $$;
revoke all on function private.touch_updated_at() from public;
create function private.handle_new_user() returns trigger language plpgsql security definer set search_path=''
as $$ begin
 insert into public.profiles(id,full_name) values(new.id,left(coalesce(new.raw_user_meta_data->>'full_name',''),150));
 insert into public.user_roles(user_id,role) values(new.id,'customer');
 return new;
end $$;
revoke all on function private.handle_new_user() from public;
create trigger lexc_new_user after insert on auth.users for each row execute function private.handle_new_user();
-- Backfill pre-existing Auth users without trusting user-editable metadata for roles.
insert into public.profiles(id,full_name) select id,left(coalesce(raw_user_meta_data->>'full_name',''),150) from auth.users on conflict do nothing;
insert into public.user_roles(user_id) select id from public.profiles on conflict do nothing;
create table public.categories (
 id uuid primary key default gen_random_uuid(), slug text not null unique, name text not null,
 sort_order integer not null default 0, is_active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.products (
 id uuid primary key default gen_random_uuid(), legacy_id integer unique,
 category_id uuid references public.categories(id), slug text not null unique,
 name text not null, description text not null default '',
 kind text not null default 'standard' check(kind in ('standard','package','customizable')),
 status text not null default 'active' check(status in ('active','archived')),
 image_path text, image_alt text not null default '', emoji text, badge_label text,
 package_contents jsonb, customization_config jsonb, sort_order integer not null default 0,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index products_category_idx on public.products(category_id);
create table public.product_variants (
 id uuid primary key default gen_random_uuid(), product_id uuid not null references public.products(id),
 code text not null, label text not null, price numeric(12,2) not null check(price>=0),
 min_qty integer not null default 1 check(min_qty>0), is_active boolean not null default true,
 sort_order integer not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(product_id,code), unique(id,product_id)
);
create table public.inventory_items (
 id uuid primary key default gen_random_uuid(), name text not null, category text not null default '',
 unit text not null, min_stock numeric(14,3) not null default 0 check(min_stock>=0),
 is_archived boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index inventory_name_unit_idx on public.inventory_items(lower(name),unit);
create table public.inventory_batches (
 id uuid primary key default gen_random_uuid(), item_id uuid not null references public.inventory_items(id),
 batch_code text not null unique, received_at timestamptz not null default now(), expires_on date, notes text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index inventory_batches_item_idx on public.inventory_batches(item_id);
create table public.inventory_movements (
 id uuid primary key default gen_random_uuid(), batch_id uuid not null references public.inventory_batches(id),
 quantity_delta numeric(14,3) not null check(quantity_delta<>0),
 reason text not null check(reason in ('receipt','usage','waste','adjustment')),
 note text, created_by uuid not null references public.profiles(id), request_id uuid not null unique,
 created_at timestamptz not null default now()
);
create index inventory_movements_batch_idx on public.inventory_movements(batch_id);
create index inventory_movements_creator_idx on public.inventory_movements(created_by);
create table public.availability_slots (
 id uuid primary key default gen_random_uuid(), starts_at timestamptz not null, ends_at timestamptz not null,
 capacity integer not null check(capacity>0), is_open boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(ends_at>starts_at), unique(starts_at,ends_at),
 exclude using gist (tstzrange(starts_at,ends_at,'[)') with &&)
);
create table public.orders (
 id uuid primary key default gen_random_uuid(), order_number bigint generated always as identity unique,
 customer_id uuid not null references public.profiles(id), client_request_id uuid not null,
 status text not null default 'pending' check(status in ('pending','confirmed','preparing','ready','completed','cancelled')),
 customer_name text not null, contact_phone text not null,
 fulfillment_method text not null check(fulfillment_method in ('pickup','lalamove')),
 address text, notes text, slot_id uuid not null references public.availability_slots(id),
 receiving_start timestamptz not null, receiving_end timestamptz not null,
 currency text not null default 'PHP' check(currency='PHP'),
 items_subtotal numeric(12,2) not null check(items_subtotal>=0),
 customization_total numeric(12,2) not null default 0 check(customization_total>=0),
 delivery_fee numeric(12,2) check(delivery_fee>=0),
 delivery_fee_status text not null check(delivery_fee_status in ('not_applicable','unquoted','quoted')),
 total_amount numeric(12,2) check(total_amount>=0),
 deposit_rate numeric(4,3) not null default .6 check(deposit_rate between 0 and 1),
 deposit_due numeric(12,2) check(deposit_due>=0),
 requested_payment_method text check(requested_payment_method in ('GCash','PayMaya','COD')),
 payment_status text not null default 'unpaid' check(payment_status in ('unpaid','partially_paid','paid','refunded')),
 amount_paid numeric(12,2) not null default 0 check(amount_paid>=0), paid_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(customer_id,client_request_id), unique(id,customer_id),
 check(fulfillment_method<>'lalamove' or length(trim(address))>0),
 check((delivery_fee_status='unquoted' and delivery_fee is null and total_amount is null and deposit_due is null)
 or (delivery_fee_status<>'unquoted' and delivery_fee is not null and total_amount=items_subtotal+customization_total+delivery_fee and deposit_due=round(total_amount*deposit_rate)))
);
create index orders_customer_created_idx on public.orders(customer_id,created_at desc);
create index orders_status_created_idx on public.orders(status,created_at desc);
create index orders_slot_status_idx on public.orders(slot_id,status);
create index orders_payment_created_idx on public.orders(payment_status,created_at desc);
create table public.order_items (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id),
 line_number integer not null check(line_number>0),
 product_id uuid not null references public.products(id), variant_id uuid not null,
 name_snapshot text not null, variant_label_snapshot text not null, package_contents_snapshot jsonb,
 quantity integer not null check(quantity>0), unit_price numeric(12,2) not null check(unit_price>=0),
 customization_unit_charge numeric(12,2) not null default 0 check(customization_unit_charge>=0),
 line_total numeric(12,2) not null check(line_total>=0),
 customization jsonb, reference_image_path text, created_at timestamptz not null default now(),
 unique(order_id,line_number), foreign key(variant_id,product_id) references public.product_variants(id,product_id),
 check(line_total=quantity*(unit_price+customization_unit_charge))
);
create index order_items_product_idx on public.order_items(product_id);
create index order_items_variant_idx on public.order_items(variant_id,product_id);
create table public.gallery_entries (
 id uuid primary key default gen_random_uuid(), image_path text not null, label text not null,
 description text not null default '', category text not null,
 display_size text not null default 'normal' check(display_size in ('normal','tall')),
 visibility text not null default 'hidden' check(visibility in ('hidden','visible')),
 sort_order integer not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.reviews (
 id uuid primary key default gen_random_uuid(), order_id uuid not null unique,
 customer_id uuid not null references public.profiles(id), rating integer not null check(rating between 1 and 5),
 review_text text not null default '', public_display_name text not null, image_path text,
 visibility text not null default 'hidden' check(visibility in ('hidden','visible')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(order_id,customer_id) references public.orders(id,customer_id)
);
create index reviews_customer_idx on public.reviews(customer_id);
create index reviews_order_customer_idx on public.reviews(order_id,customer_id);
do $$ declare t text; begin
 foreach t in array array['profiles','user_roles','categories','products','product_variants','inventory_items','inventory_batches','inventory_movements','availability_slots','orders','order_items','gallery_entries','reviews'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on table public.%I from anon, authenticated',t);
 if t not in ('inventory_movements','order_items') then
 execute format('create trigger touch_updated_at before update on public.%I for each row execute function private.touch_updated_at()',t);
 end if;
 end loop;
end $$;
grant select on public.user_roles to anon, authenticated;
create policy own_role on public.user_roles for select to anon,authenticated using(user_id=(select auth.uid()));
grant select on public.profiles to authenticated;
grant update(full_name,phone,avatar_path) on public.profiles to authenticated;
create policy profile_read on public.profiles for select to authenticated using(id=(select auth.uid()) or (select private.is_admin()));
create policy profile_update on public.profiles for update to authenticated using(id=(select auth.uid())) with check(id=(select auth.uid()));
grant select on public.categories,public.products,public.product_variants,public.gallery_entries to anon,authenticated;
grant insert,update on public.categories,public.products,public.product_variants,public.gallery_entries to authenticated;
create policy categories_read on public.categories for select to anon,authenticated using(is_active or (select private.is_admin()));
create policy products_read on public.products for select to anon,authenticated using((status='active' and (category_id is null or exists(select 1 from public.categories c where c.id=category_id and c.is_active))) or (select private.is_admin()));
create policy variants_read on public.product_variants for select to anon,authenticated using((is_active and exists(select 1 from public.products p where p.id=product_id and p.status='active')) or (select private.is_admin()));
create policy gallery_read on public.gallery_entries for select to anon,authenticated using(visibility='visible' or (select private.is_admin()));
do $$ declare t text; begin
 foreach t in array array['categories','products','product_variants','gallery_entries'] loop
 execute format('create policy admin_insert on public.%I for insert to authenticated with check((select private.is_admin()))',t);
 execute format('create policy admin_update on public.%I for update to authenticated using((select private.is_admin())) with check((select private.is_admin()))',t);
 end loop;
end $$;
grant select on public.inventory_items,public.inventory_batches,public.inventory_movements,public.availability_slots to authenticated;
grant insert,update on public.inventory_items to authenticated;
do $$ declare t text; begin
 foreach t in array array['inventory_items','inventory_batches','inventory_movements','availability_slots'] loop
 execute format('create policy admin_read on public.%I for select to authenticated using((select private.is_admin()))',t);
 end loop;
end $$;
create policy inventory_insert on public.inventory_items for insert to authenticated with check((select private.is_admin()));
create policy inventory_update on public.inventory_items for update to authenticated using((select private.is_admin())) with check((select private.is_admin()));
grant select on public.orders,public.order_items,public.reviews to authenticated;
create policy orders_read on public.orders for select to authenticated using(customer_id=(select auth.uid()) or (select private.is_admin()));
create policy items_read on public.order_items for select to authenticated using(exists(select 1 from public.orders o where o.id=order_id and (o.customer_id=(select auth.uid()) or (select private.is_admin()))));
create policy reviews_read on public.reviews for select to authenticated using(customer_id=(select auth.uid()) or (select private.is_admin()));
grant update(visibility) on public.reviews to authenticated;
create policy reviews_moderate on public.reviews for update to authenticated using((select private.is_admin())) with check((select private.is_admin()));
-- Only the public projection exposes approved reviews, never customer/order identifiers.
create function private.public_reviews() returns table(id uuid,rating integer,review_text text,public_display_name text,image_path text,created_at timestamptz)
language sql stable security definer set search_path='' as $$
 select id,rating,review_text,public_display_name,image_path,created_at from public.reviews where visibility='visible' order by created_at desc limit 100
$$;
revoke all on function private.public_reviews() from public;
grant execute on function private.public_reviews() to anon,authenticated;
create function public.get_public_reviews() returns table(id uuid,rating integer,review_text text,public_display_name text,image_path text,created_at timestamptz)
language sql stable security invoker set search_path='' as $$ select * from private.public_reviews() $$;
revoke all on function public.get_public_reviews() from public;
grant execute on function public.get_public_reviews() to anon,authenticated;

