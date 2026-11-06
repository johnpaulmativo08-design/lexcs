-- Phase 101 · Planned bake starts (Admin → Production, drag a task onto the day track).
--
-- Why: the automatic bake plan (phase 97) works backwards from each deadline. The owner wants to choose the start
-- herself, for example to bake a big Nov 8 morning order from 10:00 PM on Nov 7. Admin → Production lets her drag an
-- order onto the track (or tap the order, then tap a time); the start she picks is saved here.
--
-- What it adds: public.order_bake_plans (one planned start per order), readable by the Admin only, and
-- public.set_bake_plan(order, start) to save or clear it (Admin only). The bake length stays the order's prep minutes
-- (phase 96). Orders without a plan keep the automatic plan. Overlapping bakes are allowed (more than one thing can
-- bake at a time). A planned bake that would finish after the deadline is only shown as late; nothing is blocked.
--
-- What it does NOT do: change an order's status, payment, inventory, capacity or prep times. "Start making" still
-- starts the real bake. Safe to re-run.
begin;

create table if not exists public.order_bake_plans (
  order_id uuid primary key references public.orders(id) on delete cascade,
  planned_start timestamptz not null,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
alter table public.order_bake_plans enable row level security;
revoke all on public.order_bake_plans from anon, authenticated;
grant select on public.order_bake_plans to authenticated;
drop policy if exists order_bake_plans_admin_read on public.order_bake_plans;
create policy order_bake_plans_admin_read on public.order_bake_plans for select to authenticated using ((select private.is_admin()));

create or replace function private.set_bake_plan(target_order uuid, planned timestamptz)
returns public.order_bake_plans language plpgsql security definer set search_path = '' as $$
declare r public.order_bake_plans; o public.orders;
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'Admin access required.' using errcode = '42501'; end if;
  select * into o from public.orders where id = target_order;
  if o.id is null then raise exception 'Order not found.' using errcode = '22023'; end if;
  if planned is null then
    delete from public.order_bake_plans where order_id = target_order returning * into r;
    return r;
  end if;
  if o.status in ('completed', 'cancelled') then raise exception 'This order is already finished.' using errcode = '22023'; end if;
  -- a plan stays near the order's own day: up to 3 days before its receiving time, and not after it
  if o.receiving_start is not null and (planned < o.receiving_start - interval '3 days' or planned > o.receiving_start) then
    raise exception 'Plan the bake within 3 days before the pickup or delivery time.' using errcode = '22023';
  end if;
  insert into public.order_bake_plans(order_id, planned_start, updated_by, updated_at)
    values (target_order, date_trunc('minute', planned), (select auth.uid()), now())
  on conflict (order_id) do update set planned_start = excluded.planned_start, updated_by = excluded.updated_by, updated_at = now()
  returning * into r;
  return r;
end $$;
revoke all on function private.set_bake_plan(uuid, timestamptz) from public;
grant execute on function private.set_bake_plan(uuid, timestamptz) to authenticated;
create or replace function public.set_bake_plan(target_order uuid, planned timestamptz) returns public.order_bake_plans
language sql security invoker set search_path = '' as $$ select private.set_bake_plan(target_order, planned) $$;
revoke all on function public.set_bake_plan(uuid, timestamptz) from public, anon;
grant execute on function public.set_bake_plan(uuid, timestamptz) to authenticated;

commit;
notify pgrst, 'reload schema';
