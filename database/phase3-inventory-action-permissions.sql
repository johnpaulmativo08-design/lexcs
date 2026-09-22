-- The public RPC is the narrow, authenticated gateway to the private atomic inventory operation.
create or replace function public.inventory_action(payload jsonb) returns jsonb
language sql security definer set search_path='' as $$
  select private.inventory_action(payload)
$$;
revoke all on function public.inventory_action(jsonb) from public;
grant execute on function public.inventory_action(jsonb) to authenticated;
