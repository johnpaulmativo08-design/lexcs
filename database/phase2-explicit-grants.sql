-- Supabase project defaults explicitly grant anon EXECUTE on new public functions.
-- Revoke those direct grants as well as PostgreSQL's PUBLIC grants.
revoke all on function public.create_order(jsonb),public.save_slot(jsonb),public.record_inventory(jsonb),public.set_order_status(uuid,text),public.submit_review(jsonb) from public,anon;
revoke all on public.inventory_stock from public,anon;
revoke all on sequence public.orders_order_number_seq from public,anon,authenticated;

