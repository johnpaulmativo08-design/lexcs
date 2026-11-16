-- Phase 115: audit log (who changed what, and when)
-- -----------------------------------------------------------------------------------------------------------------
-- What this does, in plain words:
--   * Adds public.audit_log: one row per change to the shop's important records, written by the database itself
--     (triggers), so it cannot be skipped from the browser. Each row says when, who (owner, cashier, customer or
--     the system), which record, and what changed (old -> new for each changed field, long values shortened).
--   * Covered: orders, payment attempts (receipt checks), products, variants, designer options, categories,
--     inventory items and batches, vouchers, payment methods, delivery pricing, booking date settings, production
--     settings, staff and roles, FAQs, announcements and website content.
--   * Only the owner can read it (Admin -> Activity log). Nobody can edit or delete rows: there are no insert,
--     update or delete grants, and only the trigger (SECURITY DEFINER) writes to it.
--   * Nothing existing changes: no table, function, policy or data is altered. Safe to run more than once.

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid,
  actor_role text not null check (actor_role in ('owner','cashier','customer','system')),
  action text not null check (action in ('insert','update','delete')),
  target_table text not null,
  target_id text,
  changes jsonb not null default '{}'::jsonb
);
create index if not exists audit_log_at_idx on public.audit_log (at desc);
create index if not exists audit_log_target_idx on public.audit_log (target_table, target_id);
create index if not exists audit_log_actor_idx on public.audit_log (actor_id, at desc);

alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;
drop policy if exists audit_log_owner_read on public.audit_log;
create policy audit_log_owner_read on public.audit_log for select to authenticated using ((select private.is_admin()));

-- one trigger function for every covered table: records the changed fields only (updated_at ignored)
create or replace function private.audit_row() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  old_row jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end;
  new_row jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end;
  row_ jsonb := coalesce(new_row, old_row);
  diff jsonb := '{}'::jsonb;
  k text;
  who uuid := auth.uid();
  role_ text;
  short_ constant int := 300;
begin
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(new_row) loop
      continue when k in ('updated_at');
      if (old_row -> k) is distinct from (new_row -> k) then
        diff := diff || jsonb_build_object(k, jsonb_build_array(left((old_row ->> k), short_), left((new_row ->> k), short_)));
      end if;
    end loop;
    if diff = '{}'::jsonb then return null; end if;   -- nothing that matters changed
  elsif tg_op = 'INSERT' then
    for k in select jsonb_object_keys(new_row) loop
      continue when k in ('created_at','updated_at') or (new_row -> k) = 'null'::jsonb;
      diff := diff || jsonb_build_object(k, jsonb_build_array(null, left((new_row ->> k), short_)));
    end loop;
  else
    for k in select jsonb_object_keys(old_row) loop
      continue when k in ('created_at','updated_at') or (old_row -> k) = 'null'::jsonb;
      diff := diff || jsonb_build_object(k, jsonb_build_array(left((old_row ->> k), short_), null));
    end loop;
  end if;
  role_ := case when who is null then 'system'
                when private.is_admin() then 'owner'
                when private.is_staff() then 'cashier'
                else 'customer' end;
  insert into public.audit_log (actor_id, actor_role, action, target_table, target_id, changes)
  values (who, role_, lower(tg_op), tg_table_name,
          coalesce(row_ ->> 'id', row_ ->> 'booking_date', row_ ->> 'user_id', row_ ->> 'code'), diff);
  return null;
end $$;
revoke all on function private.audit_row() from public;

-- attach to every covered table that exists
do $$
declare t text;
begin
  foreach t in array array['orders','order_payment_attempts','products','product_variants','design_options','categories',
    'inventory_items','inventory_batches','vouchers','payment_methods','delivery_pricing','booking_date_settings',
    'production_settings','staff_members','user_roles','site_faqs','site_announcements','site_content'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists zz_audit on public.%I', t);
      execute format('create trigger zz_audit after insert or update or delete on public.%I for each row execute function private.audit_row()', t);
    end if;
  end loop;
end $$;
