-- One recoverable draft cart per signed-in customer. Prices and availability
-- are still revalidated by the trusted checkout RPC, never trusted from JSON.
create table if not exists public.customer_carts (
  customer_id uuid primary key references auth.users(id) on delete cascade,
  items jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  constraint customer_carts_items_check check (
    jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 100
  )
);

alter table public.customer_carts enable row level security;
revoke all on table public.customer_carts from anon, authenticated;
grant select, insert, update on table public.customer_carts to authenticated;

create policy customer_carts_read on public.customer_carts
  for select to authenticated
  using (customer_id = (select auth.uid()));
create policy customer_carts_insert on public.customer_carts
  for insert to authenticated
  with check (customer_id = (select auth.uid()));
create policy customer_carts_update on public.customer_carts
  for update to authenticated
  using (customer_id = (select auth.uid()))
  with check (customer_id = (select auth.uid()));
