-- Phase 99 · Delivery route preview settings.
--
-- Why: before a Lalamove rider is booked, a delivery order shows the shortest road route from the shop to the
-- customer's pin (drawn in the browser from OpenStreetMap routing; roads only). The owner can switch the preview off
-- for customers, and choose whether the rough travel time is shown.
--
-- What it adds: two settings on public.delivery_pricing (already readable by everyone, phase 94), and one admin-only
-- function to save them. Nothing else changes: no order, payment, fee or rate is touched. Safe to re-run.
begin;

alter table public.delivery_pricing add column if not exists route_preview boolean not null default true;
alter table public.delivery_pricing add column if not exists route_show_time boolean not null default true;

create or replace function private.save_route_preview(show_route boolean, show_time boolean)
returns public.delivery_pricing language plpgsql security definer set search_path = '' as $$
declare r public.delivery_pricing;
begin
  perform private.require_admin();
  update public.delivery_pricing set route_preview = coalesce(show_route, true), route_show_time = coalesce(show_time, true),
    updated_at = now(), updated_by = (select auth.uid())
  where id = 1 returning * into r;
  return r;
end $$;
revoke all on function private.save_route_preview(boolean, boolean) from public;
grant execute on function private.save_route_preview(boolean, boolean) to authenticated;
create or replace function public.save_route_preview(show_route boolean, show_time boolean) returns public.delivery_pricing
language sql security invoker set search_path = '' as $$ select private.save_route_preview(show_route, show_time) $$;
revoke all on function public.save_route_preview(boolean, boolean) from public;
grant execute on function public.save_route_preview(boolean, boolean) to authenticated;

commit;
notify pgrst, 'reload schema';
