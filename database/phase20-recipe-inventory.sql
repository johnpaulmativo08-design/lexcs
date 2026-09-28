-- Phase 20: recipe-driven inventory with automatic, idempotent order deductions.
--
-- Run once in the Supabase SQL editor AFTER phases 2–19. Safe to re-run: every object is
-- created with IF NOT EXISTS / OR REPLACE, and seed rows use deterministic keys.
--
-- Business rule implemented here (see RECIPE-INVENTORY.md):
--   payment verified (orders.payment_status in partially_paid/paid)
--   + order accepted  (orders.status in confirmed/preparing/ready/completed)
--   = materials are allocated ONCE, atomically, from the batch ledger (earliest expiry first).
-- Deduction runs in a database trigger, never in the browser. Existing stock, batches and
-- movement history are preserved; nothing here overwrites current quantities.

-- ---------------------------------------------------------------------------
-- 1. Measurement units (conversion only inside the same dimension)
-- ---------------------------------------------------------------------------
create table if not exists public.measurement_units (
  code text primary key,
  dimension text not null,
  to_base numeric(18,6) not null check (to_base > 0),
  label text not null
);
insert into public.measurement_units(code,dimension,to_base,label) values
  ('mg','mass',0.001,'milligram'),('g','mass',1,'gram'),('kg','mass',1000,'kilogram'),
  ('ml','volume',1,'milliliter'),('mL','volume',1,'milliliter'),('L','volume',1000,'liter'),('l','volume',1000,'liter'),
  ('pcs','count',1,'piece'),('dozen','count',12,'dozen'),
  ('cm','length',1,'centimeter'),('m','length',100,'meter'),('inch','length',2.54,'inch'),('yard','length',91.44,'yard'),
  -- Container units only convert to themselves (a pack is not a fixed number of pieces).
  ('pack','pack',1,'pack'),('box','box',1,'box'),('roll','roll',1,'roll')
on conflict (code) do nothing;
alter table public.measurement_units enable row level security;
revoke all on public.measurement_units from anon, authenticated;
grant select on public.measurement_units to authenticated;
drop policy if exists measurement_units_read on public.measurement_units;
create policy measurement_units_read on public.measurement_units for select to authenticated using ((select private.is_admin()));

-- ---------------------------------------------------------------------------
-- 2. Inventory item additions, aliases and item-specific conversions
-- ---------------------------------------------------------------------------
alter table public.inventory_items
  add column if not exists estimated_unit_cost numeric(14,4) check (estimated_unit_cost is null or estimated_unit_cost >= 0);

-- Intentional name mapping ("All-Purpose Flour", "AP Flour" → one item). Aliases are lower-case.
create table if not exists public.inventory_item_aliases (
  alias text primary key check (alias = lower(btrim(alias)) and length(alias) > 0),
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists inventory_item_aliases_item_idx on public.inventory_item_aliases(item_id);

-- Cross-dimension conversions (e.g. grams of butter → pieces of 225 g blocks) must be explicit
-- per item. factor = how many item units one `unit` equals. Unverified rows block activation.
create table if not exists public.inventory_unit_conversions (
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  unit text not null references public.measurement_units(code),
  factor numeric(18,8) not null check (factor > 0),
  is_verified boolean not null default false,
  note text not null default '',
  verified_by uuid references public.profiles(id), verified_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (item_id, unit)
);
drop trigger if exists inventory_unit_conversions_touch on public.inventory_unit_conversions;
create trigger inventory_unit_conversions_touch before update on public.inventory_unit_conversions
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Recipes (versioned; an active version is never edited in place)
-- ---------------------------------------------------------------------------
create table if not exists public.product_recipes (
  id uuid primary key default gen_random_uuid(),
  recipe_key uuid not null,                       -- shared by every version of one recipe
  version integer not null check (version > 0),
  product_id uuid references public.products(id), -- null = recipe not yet linked to a product
  name text not null check (length(btrim(name)) between 2 and 150),
  status text not null default 'draft' check (status in ('draft','active','archived')),
  batch_yield numeric(12,3) not null check (batch_yield > 0),
  yield_unit text not null default 'pcs',
  scaling_mode text not null default 'proportional' check (scaling_mode in ('proportional','whole_batch')),
  notes text not null default '',
  review_notes text not null default '',
  source text not null default 'admin',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  activated_at timestamptz, activated_by uuid references public.profiles(id),
  archived_at timestamptz,
  unique (recipe_key, version)
);
create unique index if not exists product_recipes_one_active_per_product on public.product_recipes(product_id) where status = 'active' and product_id is not null;
create index if not exists product_recipes_key_idx on public.product_recipes(recipe_key, version desc);

-- How many recipe units (pieces) one ordered quantity of a variant represents (12pcs box → 12).
create table if not exists public.recipe_variant_units (
  recipe_id uuid not null references public.product_recipes(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id),
  units numeric(12,3) not null check (units > 0),
  primary key (recipe_id, variant_id)
);

create table if not exists public.recipe_lines (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.product_recipes(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id),
  line_group text not null default 'ingredient' check (line_group in ('ingredient','flavor','topping','packaging')),
  quantity numeric(18,6) not null check (quantity > 0),
  unit text not null references public.measurement_units(code),
  -- per_batch: scales with ordered pieces / batch yield; per_unit: × ordered pieces;
  -- per_package: × ordered quantity of the variant (boxes, stickers, ribbons).
  basis text not null default 'per_batch' check (basis in ('per_batch','per_unit','per_package')),
  rounding text not null default 'exact' check (rounding in ('exact','whole')),
  condition jsonb not null default '{}'::jsonb check (jsonb_typeof(condition) = 'object'),
  item_quantity numeric(18,6),                     -- quantity converted to the item's stock unit
  item_unit text,
  needs_review boolean not null default false,
  review_note text not null default '',
  source_text text not null default '',
  sort_order integer not null default 0
);
-- Per-piece amounts (e.g. 0.000021 kg salt per donut) need 6 decimals.
alter table public.recipe_lines alter column quantity type numeric(18,6);
create index if not exists recipe_lines_recipe_idx on public.recipe_lines(recipe_id, sort_order);
create index if not exists recipe_lines_item_idx on public.recipe_lines(item_id);

-- ---------------------------------------------------------------------------
-- 4. Order allocations (one per order → idempotent) and the per-line explanation
-- ---------------------------------------------------------------------------
create table if not exists public.order_inventory_allocations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id),
  status text not null check (status in ('deducted','shortage','no_recipe','not_required','reversed','consumed','void')),
  trigger_event text not null default '',
  shortage jsonb not null default '[]'::jsonb,
  untracked jsonb not null default '[]'::jsonb,   -- order lines with no active recipe / manual review
  attempts integer not null default 0,
  last_attempt_at timestamptz,
  deducted_at timestamptz, deducted_by uuid references public.profiles(id),
  reversed_at timestamptz, reversed_by uuid references public.profiles(id), reversal_reason text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists order_inventory_allocations_status_idx on public.order_inventory_allocations(status, updated_at desc);
drop trigger if exists order_inventory_allocations_touch on public.order_inventory_allocations;
create trigger order_inventory_allocations_touch before update on public.order_inventory_allocations
  for each row execute function private.touch_updated_at();

create table if not exists public.order_inventory_allocation_lines (
  id uuid primary key default gen_random_uuid(),
  allocation_id uuid not null references public.order_inventory_allocations(id) on delete cascade,
  order_item_id uuid references public.order_items(id),
  recipe_id uuid references public.product_recipes(id),
  recipe_version integer,
  recipe_line_id uuid references public.recipe_lines(id),
  item_id uuid not null references public.inventory_items(id),
  line_group text not null,
  basis text not null,
  required_quantity numeric(18,6) not null check (required_quantity >= 0),
  unit text not null,
  kind text not null default 'recipe' check (kind in ('recipe','extra')),
  note text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists order_inventory_allocation_lines_alloc_idx on public.order_inventory_allocation_lines(allocation_id);
create index if not exists order_inventory_allocation_lines_item_idx on public.order_inventory_allocation_lines(item_id);

-- ---------------------------------------------------------------------------
-- 5. Movement ledger: order links, item-level before/after, new movement types
-- ---------------------------------------------------------------------------
alter table public.inventory_movements
  add column if not exists item_id uuid references public.inventory_items(id),
  add column if not exists order_id uuid references public.orders(id),
  add column if not exists order_item_id uuid references public.order_items(id),
  add column if not exists allocation_id uuid references public.order_inventory_allocations(id),
  add column if not exists recipe_id uuid references public.product_recipes(id),
  add column if not exists stock_before numeric(14,3),
  add column if not exists stock_after numeric(14,3),
  add column if not exists actor_kind text not null default 'admin';
alter table public.inventory_movements drop constraint if exists inventory_movements_actor_kind_check;
alter table public.inventory_movements add constraint inventory_movements_actor_kind_check check (actor_kind in ('admin','system'));
alter table public.inventory_movements drop constraint if exists inventory_movements_reason_check;
alter table public.inventory_movements add constraint inventory_movements_reason_check
  check (reason in ('receipt','usage','waste','adjustment','expired','reversal'));
alter table public.inventory_movements drop constraint if exists inventory_movements_movement_type_check;
alter table public.inventory_movements add constraint inventory_movements_movement_type_check
  check (movement_type in ('initial_stock','restock','stock_usage','waste','remake','damaged','adjustment_positive','adjustment_negative','expired','order_deduction','order_reversal','order_extra'));

-- Backfill item_id for historical rows (before/after stay null: they were never recorded).
update public.inventory_movements m set item_id = b.item_id
from public.inventory_batches b where b.id = m.batch_id and m.item_id is null;

create index if not exists inventory_movements_item_created_idx on public.inventory_movements(item_id, created_at desc);
create index if not exists inventory_movements_order_idx on public.inventory_movements(order_id) where order_id is not null;
create index if not exists inventory_movements_type_created_idx on public.inventory_movements(movement_type, created_at desc);
-- A batch can be deducted and reversed at most once per allocation (duplicate protection).
create unique index if not exists inventory_movements_allocation_once
  on public.inventory_movements(allocation_id, batch_id, movement_type)
  where allocation_id is not null and movement_type in ('order_deduction','order_reversal');

-- Ledger rows are append-only: nobody (including the API) may edit or delete them.
create or replace function private.inventory_movements_immutable() returns trigger language plpgsql set search_path='' as $$
begin
  raise exception 'Inventory movements are permanent. Record a new adjustment or reversal instead.';
end $$;
revoke all on function private.inventory_movements_immutable() from public;
drop trigger if exists inventory_movements_no_update on public.inventory_movements;
create trigger inventory_movements_no_update before update or delete on public.inventory_movements
  for each row execute function private.inventory_movements_immutable();

-- Every movement (restock, usage, order, expiry…) records item stock before and after.
-- The per-item advisory lock serialises concurrent writers so the numbers stay exact.
create or replace function private.stamp_inventory_movement() returns trigger language plpgsql security definer set search_path='' as $$
declare on_hand numeric;
begin
  select item_id into new.item_id from public.inventory_batches where id = new.batch_id;
  perform pg_advisory_xact_lock(hashtextextended('lexc-inventory-item:' || new.item_id::text, 0));
  select coalesce(sum(m.quantity_delta), 0) into on_hand
    from public.inventory_movements m join public.inventory_batches b on b.id = m.batch_id
    where b.item_id = new.item_id;
  new.stock_before := on_hand;
  new.stock_after := on_hand + new.quantity_delta;
  return new;
end $$;
revoke all on function private.stamp_inventory_movement() from public;
drop trigger if exists inventory_movements_stamp on public.inventory_movements;
create trigger inventory_movements_stamp before insert on public.inventory_movements
  for each row execute function private.stamp_inventory_movement();

-- ---------------------------------------------------------------------------
-- 6. Row-level security: Admin read only; every write goes through the RPCs below
-- ---------------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['inventory_item_aliases','inventory_unit_conversions','product_recipes','recipe_variant_units','recipe_lines','order_inventory_allocations','order_inventory_allocation_lines'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format('drop policy if exists admin_read on public.%I', t);
    execute format('create policy admin_read on public.%I for select to authenticated using ((select private.is_admin()))', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Helpers
-- ---------------------------------------------------------------------------
create or replace function private.actor_profile() returns uuid language sql stable security definer set search_path='' as $$
  select coalesce(auth.uid(), (select p.id from public.profiles p join public.user_roles r on r.user_id = p.id where r.role = 'admin' order by p.created_at limit 1))
$$;
revoke all on function private.actor_profile() from public;

create or replace function private.require_admin() returns uuid language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'Admin access required.' using errcode = '42501'; end if;
  return auth.uid();
end $$;
revoke all on function private.require_admin() from public;

-- Convert a quantity into an item's stock unit. Returns null when no safe conversion exists.
-- Same dimension → arithmetic; different dimension → only via inventory_unit_conversions.
create or replace function private.convert_to_item_unit(qty numeric, from_unit text, target_item uuid, verified_only boolean default false)
returns numeric language plpgsql stable security definer set search_path='' as $$
declare item_unit text; f public.measurement_units; t public.measurement_units; c record;
begin
  select unit into item_unit from public.inventory_items where id = target_item;
  if item_unit is null or qty is null then return null; end if;
  if from_unit = item_unit then return qty; end if;
  select * into f from public.measurement_units where code = from_unit;
  select * into t from public.measurement_units where code = item_unit;
  if f.code is null then return null; end if;
  if t.code is not null and f.dimension = t.dimension then return qty * f.to_base / t.to_base; end if;
  -- Item-specific conversion defined for any unit of the same dimension as from_unit.
  select cv.factor, u.to_base into c from public.inventory_unit_conversions cv join public.measurement_units u on u.code = cv.unit
    where cv.item_id = target_item and u.dimension = f.dimension and (cv.is_verified or not verified_only)
    order by (cv.unit = from_unit) desc limit 1;
  if c.factor is null then return null; end if;
  return qty * f.to_base / c.to_base * c.factor;
end $$;
revoke all on function private.convert_to_item_unit(numeric,text,uuid,boolean) from public;

create or replace function private.conversion_state(from_unit text, target_item uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare item_unit text; f public.measurement_units; t public.measurement_units; ok boolean;
begin
  select unit into item_unit from public.inventory_items where id = target_item;
  if from_unit = item_unit then return 'direct'; end if;
  select * into f from public.measurement_units where code = from_unit;
  select * into t from public.measurement_units where code = item_unit;
  if f.code is not null and t.code is not null and f.dimension = t.dimension then return 'direct'; end if;
  select bool_or(cv.is_verified) into ok from public.inventory_unit_conversions cv join public.measurement_units u on u.code = cv.unit
    where cv.item_id = target_item and u.dimension = f.dimension;
  return case when ok then 'verified' when ok is not null then 'unverified' else 'missing' end;
end $$;
revoke all on function private.conversion_state(text,uuid) from public;

-- Usable stock: everything in non-archived batches that has not expired (Asia/Manila date).
create or replace function private.item_available(target_item uuid) returns numeric language sql stable security definer set search_path='' as $$
  select coalesce(sum(m.quantity_delta), 0) from public.inventory_movements m join public.inventory_batches b on b.id = m.batch_id
  where b.item_id = target_item and b.archived_at is null
    and (b.expires_on is null or b.expires_on >= (now() at time zone 'Asia/Manila')::date)
$$;
revoke all on function private.item_available(uuid) from public;

-- Deductions are rounded UP to 0.001 of the stock unit so stock is never under-counted.
create or replace function private.round_stock(qty numeric) returns numeric language sql immutable set search_path='' as $$
  select ceil(qty * 1000 - 0.0000001) / 1000
$$;
revoke all on function private.round_stock(numeric) from public;

-- Does a recipe line apply to this order line? condition = {"variant_codes":[..], "customization":{"key":[values]}}
create or replace function private.recipe_line_applies(cond jsonb, variant_code text, custom jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare k text; allowed jsonb;
begin
  if cond ? 'variant_codes' and not (cond->'variant_codes') ? variant_code then return false; end if;
  if cond ? 'customization' then
    for k, allowed in select key, value from jsonb_each(cond->'customization') loop
      if custom is null or not (allowed ? coalesce(custom->>k, '')) then return false; end if;
    end loop;
  end if;
  return true;
end $$;
revoke all on function private.recipe_line_applies(jsonb,text,jsonb) from public;

-- ---------------------------------------------------------------------------
-- 8. Requirement calculation (shared by preview and the real allocation)
-- ---------------------------------------------------------------------------
-- Returns {"lines":[per order line × recipe line], "totals":[per item], "untracked":[...], "test_only":bool}
create or replace function private.order_requirements(target_order uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  oi record; r public.product_recipes; units numeric; pieces numeric; factor numeric; l record; req numeric;
  lines jsonb := '[]'; untracked jsonb := '[]'; any_real boolean := false; totals jsonb;
begin
  for oi in
    select i.*, v.code as variant_code, p.kind as product_kind, p.is_test_product, p.name as product_name
    from public.order_items i join public.product_variants v on v.id = i.variant_id join public.products p on p.id = i.product_id
    where i.order_id = target_order order by i.line_number
  loop
    if oi.is_test_product then continue; end if;
    any_real := true;
    select * into r from public.product_recipes where product_id = oi.product_id and status = 'active';
    if r.id is null then
      untracked := untracked || jsonb_build_array(jsonb_build_object('order_item_id', oi.id, 'name', oi.name_snapshot, 'variant', oi.variant_label_snapshot, 'quantity', oi.quantity,
        'reason', case when oi.product_kind = 'package' then 'Package has no active recipe — record materials manually.' else 'No active recipe for this product.' end));
      continue;
    end if;
    select vu.units into units from public.recipe_variant_units vu where vu.recipe_id = r.id and vu.variant_id = oi.variant_id;
    if units is null then
      untracked := untracked || jsonb_build_array(jsonb_build_object('order_item_id', oi.id, 'name', oi.name_snapshot, 'variant', oi.variant_label_snapshot, 'quantity', oi.quantity,
        'reason', 'The active recipe does not define how many pieces this option contains.'));
      continue;
    end if;
    pieces := units * oi.quantity;
    factor := case when r.scaling_mode = 'whole_batch' then ceil(pieces / r.batch_yield) else pieces / r.batch_yield end;
    if oi.reference_image_path is not null then
      untracked := untracked || jsonb_build_array(jsonb_build_object('order_item_id', oi.id, 'name', oi.name_snapshot, 'variant', oi.variant_label_snapshot, 'quantity', oi.quantity,
        'reason', 'Custom decoration from a reference image — record any extra materials manually.', 'partial', true));
    end if;
    for l in select * from public.recipe_lines where recipe_id = r.id order by sort_order, id loop
      if not private.recipe_line_applies(l.condition, oi.variant_code, oi.customization) then continue; end if;
      if l.item_quantity is null then
        raise exception 'Recipe "%" v% has a line without a stock-unit conversion. Re-save the recipe.', r.name, r.version;
      end if;
      req := l.item_quantity * case l.basis when 'per_batch' then factor when 'per_unit' then pieces else oi.quantity end;
      if l.rounding = 'whole' then req := ceil(req - 0.0000001); end if;
      lines := lines || jsonb_build_array(jsonb_build_object(
        'order_item_id', oi.id, 'product_name', oi.name_snapshot, 'variant', oi.variant_label_snapshot, 'ordered', oi.quantity, 'pieces', pieces,
        'recipe_id', r.id, 'recipe_name', r.name, 'recipe_version', r.version, 'recipe_line_id', l.id,
        'item_id', l.item_id, 'line_group', l.line_group, 'basis', l.basis, 'required', req, 'unit', l.item_unit));
    end loop;
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('item_id', t.item_id, 'name', i.name, 'unit', i.unit, 'category', i.category, 'inventory_type', i.inventory_type,
      'required', private.round_stock(t.req), 'available', private.item_available(t.item_id)) order by i.inventory_type, i.name), '[]')
    into totals
    from (select (x->>'item_id')::uuid as item_id, sum((x->>'required')::numeric) as req from jsonb_array_elements(lines) x group by 1) t
    join public.inventory_items i on i.id = t.item_id
    where t.req > 0;
  return jsonb_build_object('lines', lines, 'totals', totals, 'untracked', untracked, 'test_only', not any_real);
end $$;
revoke all on function private.order_requirements(uuid) from public;

-- ---------------------------------------------------------------------------
-- 9. The atomic allocation. Called by the order trigger (and the Admin retry RPC).
-- ---------------------------------------------------------------------------
create or replace function private.allocate_order_inventory(target_order uuid, event text) returns public.order_inventory_allocations
language plpgsql security definer set search_path='' as $$
declare
  a public.order_inventory_allocations; reqs jsonb; t jsonb; need numeric; avail numeric; take numeric; remaining numeric;
  b record; shortages jsonb := '[]'; actor uuid := private.actor_profile(); item_ids uuid[]; ord public.orders;
begin
  select * into ord from public.orders where id = target_order;
  insert into public.order_inventory_allocations(order_id, status, trigger_event) values (target_order, 'no_recipe', event)
    on conflict (order_id) do nothing;
  select * into a from public.order_inventory_allocations where order_id = target_order for update;
  -- Idempotency: a finished allocation is never repeated (refreshes, retries, repeated payment reviews).
  if a.status in ('deducted','reversed','consumed','not_required','void') and a.attempts > 0 then return a; end if;

  perform private.expire_inventory_batches();
  reqs := private.order_requirements(target_order);
  if (reqs->>'test_only')::boolean then
    update public.order_inventory_allocations set status = 'not_required', trigger_event = event, attempts = attempts + 1, last_attempt_at = now(),
      untracked = '[]', shortage = '[]' where id = a.id returning * into a;
    return a;
  end if;
  if jsonb_array_length(reqs->'totals') = 0 then
    update public.order_inventory_allocations set status = 'no_recipe', trigger_event = event, attempts = attempts + 1, last_attempt_at = now(),
      untracked = reqs->'untracked', shortage = '[]' where id = a.id returning * into a;
    return a;
  end if;

  -- Lock every involved item in a fixed order: concurrent confirmations queue instead of overspending.
  select array_agg((v->>'item_id')::uuid order by (v->>'item_id')::uuid) into item_ids from jsonb_array_elements(reqs->'totals') v;
  perform 1 from public.inventory_items where id = any(item_ids) order by id for update;

  for t in select value from jsonb_array_elements(reqs->'totals') loop
    avail := private.item_available((t->>'item_id')::uuid);
    need := (t->>'required')::numeric;
    if avail < need then
      shortages := shortages || jsonb_build_array(jsonb_build_object('item_id', t->>'item_id', 'name', t->>'name', 'unit', t->>'unit',
        'required', need, 'available', greatest(avail, 0), 'shortage', need - greatest(avail, 0)));
    end if;
  end loop;
  if jsonb_array_length(shortages) > 0 then
    update public.order_inventory_allocations set status = 'shortage', trigger_event = event, attempts = attempts + 1, last_attempt_at = now(),
      shortage = shortages, untracked = reqs->'untracked' where id = a.id returning * into a;
    return a;
  end if;

  -- Deduct earliest-expiring batches first (FEFO), then oldest stock-in.
  for t in select value from jsonb_array_elements(reqs->'totals') loop
    remaining := (t->>'required')::numeric;
    for b in
      select bs.id, sum(m.quantity_delta) as qty
      from public.inventory_batches bs join public.inventory_movements m on m.batch_id = bs.id
      where bs.item_id = (t->>'item_id')::uuid and bs.archived_at is null
        and (bs.expires_on is null or bs.expires_on >= (now() at time zone 'Asia/Manila')::date)
      group by bs.id, bs.expires_on, bs.received_at
      having sum(m.quantity_delta) > 0
      order by bs.expires_on asc nulls last, bs.received_at asc, bs.id
    loop
      exit when remaining <= 0;
      perform 1 from public.inventory_batches where id = b.id for update;
      take := least(remaining, b.qty);
      insert into public.inventory_movements(batch_id, quantity_delta, reason, movement_type, note, reference, created_by, request_id,
        order_id, allocation_id, actor_kind)
      values (b.id, -take, 'usage', 'order_deduction', 'Automatic deduction · ' || event, 'Order #' || ord.order_number, actor,
        md5('lexc-alloc:' || a.id::text || ':' || b.id::text || ':deduct')::uuid, target_order, a.id, 'system');
      remaining := remaining - take;
    end loop;
    if remaining > 0 then raise exception 'Stock changed while allocating %. Please retry.', t->>'name'; end if;
  end loop;

  delete from public.order_inventory_allocation_lines where allocation_id = a.id and kind = 'recipe';
  insert into public.order_inventory_allocation_lines(allocation_id, order_item_id, recipe_id, recipe_version, recipe_line_id, item_id, line_group, basis, required_quantity, unit)
  select a.id, (x->>'order_item_id')::uuid, (x->>'recipe_id')::uuid, (x->>'recipe_version')::integer, (x->>'recipe_line_id')::uuid,
         (x->>'item_id')::uuid, x->>'line_group', x->>'basis', (x->>'required')::numeric, x->>'unit'
  from jsonb_array_elements(reqs->'lines') x where (x->>'required')::numeric > 0;

  update public.order_inventory_allocations set status = 'deducted', trigger_event = event, attempts = attempts + 1, last_attempt_at = now(),
    shortage = '[]', untracked = reqs->'untracked', deducted_at = now(), deducted_by = actor where id = a.id returning * into a;
  perform private.sync_inventory_alerts();
  return a;
end $$;
revoke all on function private.allocate_order_inventory(uuid,text) from public;

-- Put deducted materials back into the batches they came from (never deletes the original rows).
create or replace function private.reverse_order_inventory(target_order uuid, why text) returns public.order_inventory_allocations
language plpgsql security definer set search_path='' as $$
declare a public.order_inventory_allocations; m record; actor uuid := private.actor_profile(); skipped jsonb := '[]'; ord public.orders;
begin
  select * into ord from public.orders where id = target_order;
  select * into a from public.order_inventory_allocations where order_id = target_order for update;
  if a.id is null or a.status not in ('deducted','consumed') then return a; end if;
  for m in
    select mv.batch_id, sum(mv.quantity_delta) as delta, bool_or(bs.archived_at is not null) as archived, max(bs.batch_code) as batch_code
    from public.inventory_movements mv join public.inventory_batches bs on bs.id = mv.batch_id
    where mv.allocation_id = a.id and mv.movement_type in ('order_deduction','order_extra')
    group by mv.batch_id order by mv.batch_id
  loop
    if m.delta >= 0 then continue; end if;
    if m.archived then
      skipped := skipped || jsonb_build_array(m.batch_code); continue;
    end if;
    perform 1 from public.inventory_batches where id = m.batch_id for update;
    insert into public.inventory_movements(batch_id, quantity_delta, reason, movement_type, note, reference, created_by, request_id, order_id, allocation_id, actor_kind)
    values (m.batch_id, -m.delta, 'reversal', 'order_reversal', left(why, 500), 'Order #' || ord.order_number, actor,
      md5('lexc-alloc:' || a.id::text || ':' || m.batch_id::text || ':reverse')::uuid, target_order, a.id, case when auth.uid() is null then 'system' else 'admin' end);
  end loop;
  update public.order_inventory_allocations set status = 'reversed', reversed_at = now(), reversed_by = actor,
    reversal_reason = left(why || case when jsonb_array_length(skipped) > 0 then ' (not restored — archived/expired batches: ' || (select string_agg(value #>> '{}', ', ') from jsonb_array_elements(skipped)) || ')' else '' end, 1000)
    where id = a.id returning * into a;
  perform private.sync_inventory_alerts();
  return a;
end $$;
revoke all on function private.reverse_order_inventory(uuid,text) from public;

-- ---------------------------------------------------------------------------
-- 10. Trusted trigger on orders: the ONLY automatic entry point
-- ---------------------------------------------------------------------------
create or replace function private.order_inventory_eligible(o public.orders) returns boolean language sql immutable set search_path='' as $$
  select o.status in ('confirmed','preparing','ready','completed') and o.payment_status in ('partially_paid','paid')
$$;
revoke all on function private.order_inventory_eligible(public.orders) from public;

create or replace function private.order_inventory_sync() returns trigger language plpgsql security definer set search_path='' as $$
declare a public.order_inventory_allocations; event text;
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    select * into a from public.order_inventory_allocations where order_id = new.id for update;
    if a.id is null then return new; end if;
    if a.status = 'deducted' and old.status = 'confirmed' then
      perform private.reverse_order_inventory(new.id, 'Order cancelled before production started — materials returned automatically.');
    elsif a.status = 'deducted' then
      update public.order_inventory_allocations set status = 'consumed',
        reversal_reason = 'Order cancelled after production started (' || old.status || '). Materials are treated as used; an Admin may reverse with a reason.'
        where id = a.id;
    elsif a.status in ('shortage','no_recipe') then
      update public.order_inventory_allocations set status = 'void' where id = a.id;
    end if;
    return new;
  end if;

  if not private.order_inventory_eligible(new) then return new; end if;
  select * into a from public.order_inventory_allocations where order_id = new.id;
  if a.id is not null and a.status not in ('shortage','no_recipe') then return new; end if;
  -- no_recipe is retried only when the status moves (e.g. after a recipe was activated).
  if a.status = 'no_recipe' and new.status = old.status then return new; end if;

  event := case when not private.order_inventory_eligible(old) and old.payment_status is distinct from new.payment_status then 'Payment verified'
                when old.status is distinct from new.status then 'Order ' || new.status
                else 'Order update' end;
  a := private.allocate_order_inventory(new.id, event);
  -- An Admin status change is blocked (rolled back) when materials are short.
  -- A payment approval is never blocked: the payment is saved and the shortage is flagged.
  if a.status = 'shortage' and old.status is distinct from new.status then
    raise exception 'Insufficient materials for Order #%.', new.order_number
      using errcode = 'LX409', detail = a.shortage::text, hint = 'Restock the listed materials, then confirm the order again.';
  end if;
  return new;
end $$;
revoke all on function private.order_inventory_sync() from public;
drop trigger if exists orders_inventory_sync on public.orders;
create trigger orders_inventory_sync after update of status, payment_status, amount_paid on public.orders
  for each row execute function private.order_inventory_sync();

-- ---------------------------------------------------------------------------
-- 11. Admin RPCs — orders
-- ---------------------------------------------------------------------------
create or replace function public.order_inventory_detail(target_order uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.orders; a public.order_inventory_allocations; result jsonb;
begin
  perform private.require_admin();
  select * into o from public.orders where id = target_order;
  if o.id is null then raise exception 'Order not found.'; end if;
  select * into a from public.order_inventory_allocations where order_id = target_order;
  result := jsonb_build_object(
    'order_id', o.id, 'order_number', o.order_number, 'order_status', o.status, 'payment_status', o.payment_status,
    'eligible', private.order_inventory_eligible(o),
    'allocation', case when a.id is null then null else to_jsonb(a) || jsonb_build_object(
      'deducted_by_name', (select nullif(full_name,'') from public.profiles where id = a.deducted_by),
      'reversed_by_name', (select nullif(full_name,'') from public.profiles where id = a.reversed_by)) end,
    'lines', (select coalesce(jsonb_agg(jsonb_build_object('order_item_id', l.order_item_id, 'product_name', oi.name_snapshot, 'variant', oi.variant_label_snapshot,
        'ordered', oi.quantity, 'recipe_name', r.name, 'recipe_version', l.recipe_version, 'item_id', l.item_id, 'item_name', i.name,
        'line_group', l.line_group, 'basis', l.basis, 'required', l.required_quantity, 'unit', l.unit, 'kind', l.kind, 'note', l.note)
        order by oi.line_number, l.kind, l.line_group, i.name), '[]')
      from public.order_inventory_allocation_lines l join public.inventory_items i on i.id = l.item_id
      left join public.order_items oi on oi.id = l.order_item_id left join public.product_recipes r on r.id = l.recipe_id
      where l.allocation_id = a.id),
    'movements', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'created_at', m.created_at, 'movement_type', m.movement_type,
        'item_id', m.item_id, 'item_name', i.name, 'unit', i.unit, 'batch_code', b.batch_code, 'quantity_delta', m.quantity_delta,
        'stock_before', m.stock_before, 'stock_after', m.stock_after, 'note', m.note, 'actor_kind', m.actor_kind,
        'actor_name', coalesce(nullif(p.full_name,''), 'System')) order by m.created_at, i.name), '[]')
      from public.inventory_movements m join public.inventory_items i on i.id = m.item_id join public.inventory_batches b on b.id = m.batch_id
      left join public.profiles p on p.id = m.created_by where m.order_id = target_order),
    -- The browser preview is informational; the trigger recalculates and re-validates at confirmation.
    'preview', case when a.id is null or a.status in ('shortage','no_recipe') then private.order_requirements(target_order) else null end
  );
  return result;
end $$;
revoke all on function public.order_inventory_detail(uuid) from public, anon;
grant execute on function public.order_inventory_detail(uuid) to authenticated;

-- Retry after restocking (or after activating a recipe) for an accepted, paid order.
create or replace function public.allocate_order_inventory(target_order uuid) returns public.order_inventory_allocations
language plpgsql security definer set search_path='' as $$
declare o public.orders; a public.order_inventory_allocations;
begin
  perform private.require_admin();
  select * into o from public.orders where id = target_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if not private.order_inventory_eligible(o) then raise exception 'Materials are allocated only after payment is verified and the order is confirmed.'; end if;
  a := private.allocate_order_inventory(o.id, 'Admin retry');
  if a.status = 'shortage' then
    raise exception 'Insufficient materials for Order #%.', o.order_number using errcode = 'LX409', detail = a.shortage::text,
      hint = 'Restock the listed materials, then try again.';
  end if;
  return a;
end $$;
revoke all on function public.allocate_order_inventory(uuid) from public, anon;
grant execute on function public.allocate_order_inventory(uuid) to authenticated;

-- Authorized reversal for a cancelled order whose materials were marked as consumed.
create or replace function public.reverse_order_inventory(target_order uuid, reason text) returns public.order_inventory_allocations
language plpgsql security definer set search_path='' as $$
declare o public.orders; a public.order_inventory_allocations;
begin
  perform private.require_admin();
  if length(btrim(coalesce(reason, ''))) < 5 then raise exception 'Enter a reason for the reversal.'; end if;
  select * into o from public.orders where id = target_order for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.status <> 'cancelled' then raise exception 'Only cancelled orders can have materials reversed.'; end if;
  select * into a from public.order_inventory_allocations where order_id = target_order for update;
  if a.id is null or a.status not in ('deducted','consumed') then raise exception 'There are no deducted materials to reverse for this order.'; end if;
  return private.reverse_order_inventory(target_order, 'Admin reversal: ' || btrim(reason));
end $$;
revoke all on function public.reverse_order_inventory(uuid,text) from public, anon;
grant execute on function public.reverse_order_inventory(uuid,text) to authenticated;

-- Extra materials the Admin specifies for custom work (free-form decoration, remakes for the order).
create or replace function public.record_order_extra_material(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  u uuid := private.require_admin(); o public.orders; a public.order_inventory_allocations; item public.inventory_items;
  qty numeric; req uuid := nullif(payload->>'request_id','')::uuid; remaining numeric; take numeric; b record; n integer := 0; note text := btrim(coalesce(payload->>'note',''));
begin
  if req is null then raise exception 'Request ID is required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('lexc-extra:' || req::text, 0));
  if exists (select 1 from public.inventory_movements where request_id = md5(req::text || ':0')::uuid) then return jsonb_build_object('duplicate', true); end if;
  if length(note) < 3 then raise exception 'Describe why these materials were used.'; end if;
  select * into o from public.orders where id = (payload->>'order_id')::uuid for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  select * into a from public.order_inventory_allocations where order_id = o.id for update;
  if a.id is null or a.status not in ('deducted','no_recipe','not_required') or not private.order_inventory_eligible(o) then
    raise exception 'Extra materials can be recorded only for a confirmed, paid order whose materials are allocated.';
  end if;
  select * into item from public.inventory_items where id = (payload->>'item_id')::uuid and not is_archived for update;
  if item.id is null then raise exception 'Choose an active inventory item.'; end if;
  qty := private.convert_to_item_unit(nullif(payload->>'quantity','')::numeric, coalesce(nullif(payload->>'unit',''), item.unit), item.id, true);
  if qty is null or qty <= 0 then raise exception 'Enter a positive quantity in a unit that converts to %.', item.unit; end if;
  qty := private.round_stock(qty);
  perform private.expire_inventory_batches();
  if private.item_available(item.id) < qty then
    raise exception 'Insufficient materials: % needs % %, only % % available.', item.name, qty, item.unit, private.item_available(item.id), item.unit using errcode = 'LX409',
      detail = jsonb_build_array(jsonb_build_object('item_id', item.id, 'name', item.name, 'unit', item.unit, 'required', qty, 'available', private.item_available(item.id), 'shortage', qty - private.item_available(item.id)))::text;
  end if;
  remaining := qty;
  for b in
    select bs.id, sum(m.quantity_delta) as q from public.inventory_batches bs join public.inventory_movements m on m.batch_id = bs.id
    where bs.item_id = item.id and bs.archived_at is null and (bs.expires_on is null or bs.expires_on >= (now() at time zone 'Asia/Manila')::date)
    group by bs.id, bs.expires_on, bs.received_at having sum(m.quantity_delta) > 0 order by bs.expires_on asc nulls last, bs.received_at, bs.id
  loop
    exit when remaining <= 0;
    perform 1 from public.inventory_batches where id = b.id for update;
    take := least(remaining, b.q);
    insert into public.inventory_movements(batch_id, quantity_delta, reason, movement_type, note, reference, created_by, request_id, order_id, allocation_id, actor_kind)
    values (b.id, -take, 'usage', 'order_extra', left(note, 500), 'Order #' || o.order_number, u, md5(req::text || ':' || n)::uuid, o.id, a.id, 'admin');
    remaining := remaining - take; n := n + 1;
  end loop;
  insert into public.order_inventory_allocation_lines(allocation_id, item_id, line_group, basis, required_quantity, unit, kind, note)
    values (a.id, item.id, case when item.inventory_type = 'packaging' then 'packaging' else 'ingredient' end, 'manual', qty, item.unit, 'extra', left(note, 500));
  perform private.sync_inventory_alerts();
  return jsonb_build_object('item_id', item.id, 'quantity', qty, 'unit', item.unit);
end $$;
revoke all on function public.record_order_extra_material(jsonb) from public, anon;
grant execute on function public.record_order_extra_material(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 12. Admin RPCs — inventory overview, item detail, adjustments, history
-- ---------------------------------------------------------------------------
create or replace view public.inventory_item_stock with (security_invoker = true) as
select i.id, i.name, i.category, i.inventory_type, i.unit, i.min_stock, i.item_code, i.estimated_unit_cost, i.expiring_window_days, i.updated_at,
  coalesce(s.on_hand, 0) as on_hand,
  coalesce(s.usable, 0) as available,
  s.next_expiry,
  s.expiring_quantity,
  s.active_batches,
  s.last_movement_at,
  case when coalesce(s.usable, 0) <= 0 then 'Out of Stock'
       when coalesce(s.usable, 0) <= i.min_stock then 'Low Stock'
       when coalesce(s.expiring_quantity, 0) > 0 then 'Expiring Soon'
       else 'In Stock' end as status
from public.inventory_items i
left join lateral (
  select sum(bq.qty) as on_hand,
    sum(bq.qty) filter (where bq.archived_at is null and (bq.expires_on is null or bq.expires_on >= (now() at time zone 'Asia/Manila')::date)) as usable,
    min(bq.expires_on) filter (where bq.archived_at is null and bq.qty > 0 and bq.expires_on >= (now() at time zone 'Asia/Manila')::date) as next_expiry,
    sum(bq.qty) filter (where bq.archived_at is null and bq.qty > 0 and bq.expires_on >= (now() at time zone 'Asia/Manila')::date
      and bq.expires_on < (now() at time zone 'Asia/Manila')::date + i.expiring_window_days) as expiring_quantity,
    count(*) filter (where bq.archived_at is null and bq.qty > 0) as active_batches,
    max(bq.last_at) as last_movement_at
  from (select b.id, b.archived_at, b.expires_on, coalesce(sum(m.quantity_delta), 0) as qty, max(m.created_at) as last_at
        from public.inventory_batches b left join public.inventory_movements m on m.batch_id = b.id
        where b.item_id = i.id group by b.id) bq
) s on true
where not i.is_archived;
grant select on public.inventory_item_stock to authenticated;

create or replace function public.inventory_overview() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_admin();
  perform private.expire_inventory_batches();
  perform private.sync_inventory_alerts();
  return jsonb_build_object(
    'items', (select coalesce(jsonb_agg(to_jsonb(s) || jsonb_build_object(
        'recipe_count', (select count(distinct r.id) from public.recipe_lines l join public.product_recipes r on r.id = l.recipe_id where l.item_id = s.id and r.status = 'active'))
        order by s.name), '[]') from public.inventory_item_stock s),
    'units', (select coalesce(jsonb_agg(u.code order by u.dimension, u.to_base), '[]') from public.measurement_units u),
    'pending_allocations', (select count(*) from public.order_inventory_allocations where status = 'shortage'),
    'recent', (select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]') from (
      select jsonb_build_object('id', m.id, 'created_at', m.created_at, 'movement_type', m.movement_type, 'item_name', i.name, 'unit', i.unit,
        'quantity_delta', m.quantity_delta, 'order_number', o.order_number, 'order_id', m.order_id) as x
      from public.inventory_movements m join public.inventory_items i on i.id = m.item_id left join public.orders o on o.id = m.order_id
      order by m.created_at desc limit 8) r)
  );
end $$;
revoke all on function public.inventory_overview() from public, anon;
grant execute on function public.inventory_overview() to authenticated;

create or replace function public.inventory_item_detail(target_item uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_admin();
  if not exists (select 1 from public.inventory_items where id = target_item) then raise exception 'Inventory item not found.'; end if;
  return jsonb_build_object(
    'item', (select to_jsonb(s) from public.inventory_item_stock s where s.id = target_item),
    'aliases', (select coalesce(jsonb_agg(alias order by alias), '[]') from public.inventory_item_aliases where item_id = target_item),
    'conversions', (select coalesce(jsonb_agg(to_jsonb(c) order by c.unit), '[]') from public.inventory_unit_conversions c where c.item_id = target_item),
    'batches', (select coalesce(jsonb_agg(to_jsonb(b) order by b.expires_on nulls last, b.received_at), '[]') from public.inventory_batch_stock b where b.item_id = target_item and b.archived_at is null),
    'movements', (select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]') from (
      select jsonb_build_object('id', m.id, 'created_at', m.created_at, 'movement_type', m.movement_type, 'quantity_delta', m.quantity_delta,
        'stock_before', m.stock_before, 'stock_after', m.stock_after, 'batch_code', b.batch_code, 'note', m.note, 'reference', m.reference,
        'order_id', m.order_id, 'order_number', o.order_number, 'actor_name', coalesce(nullif(p.full_name,''), 'System'), 'actor_kind', m.actor_kind) as x
      from public.inventory_movements m join public.inventory_batches b on b.id = m.batch_id left join public.orders o on o.id = m.order_id
      left join public.profiles p on p.id = m.created_by
      where m.item_id = target_item order by m.created_at desc limit 25) r),
    'recipes', (select coalesce(jsonb_agg(distinct jsonb_build_object('id', r.id, 'name', r.name, 'version', r.version, 'status', r.status)), '[]')
      from public.recipe_lines l join public.product_recipes r on r.id = l.recipe_id where l.item_id = target_item and r.status in ('active','draft'))
  );
end $$;
revoke all on function public.inventory_item_detail(uuid) from public, anon;
grant execute on function public.inventory_item_detail(uuid) to authenticated;

-- Item-level manual adjustment with a mandatory reason. Decreases use FEFO across batches;
-- increases go to the latest active batch (or a new adjustment batch when none exists).
create or replace function public.adjust_inventory_item(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  u uuid := private.require_admin(); item public.inventory_items; qty numeric := nullif(payload->>'quantity','')::numeric;
  direction text := payload->>'direction'; kind text := coalesce(payload->>'kind', 'adjustment'); note text := btrim(coalesce(payload->>'note',''));
  req uuid := nullif(payload->>'request_id','')::uuid; remaining numeric; take numeric; b record; target_batch uuid; n integer := 0; mtype text; mreason text;
begin
  if req is null then raise exception 'Request ID is required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('lexc-adjust:' || req::text, 0));
  if exists (select 1 from public.inventory_movements where request_id = md5(req::text || ':0')::uuid) then return jsonb_build_object('duplicate', true); end if;
  if length(note) < 3 then raise exception 'A reason is required for every manual adjustment.'; end if;
  if direction not in ('increase','decrease') then raise exception 'Choose increase or decrease.'; end if;
  if kind not in ('adjustment','wastage','expiry') or (kind <> 'adjustment' and direction = 'increase') then raise exception 'Invalid adjustment type.'; end if;
  select * into item from public.inventory_items where id = (payload->>'item_id')::uuid and not is_archived for update;
  if item.id is null then raise exception 'Choose an active inventory item.'; end if;
  qty := private.convert_to_item_unit(qty, coalesce(nullif(payload->>'unit',''), item.unit), item.id, true);
  if qty is null or qty <= 0 then raise exception 'Enter a positive quantity.'; end if;
  qty := round(qty, 3);
  perform private.expire_inventory_batches();
  if direction = 'increase' then
    select bs.id into target_batch from public.inventory_batches bs where bs.item_id = item.id and bs.archived_at is null
      and (bs.expires_on is null or bs.expires_on >= (now() at time zone 'Asia/Manila')::date)
      order by bs.received_at desc limit 1 for update;
    if target_batch is null then
      insert into public.inventory_batches(item_id, batch_code, quantity_received, notes)
      values (item.id, coalesce(item.item_code, 'ADJ') || '-ADJ-' || to_char(now() at time zone 'Asia/Manila', 'YYMMDDHH24MISS'), 0, 'Created by manual adjustment')
      returning id into target_batch;
    end if;
    insert into public.inventory_movements(batch_id, quantity_delta, reason, movement_type, note, created_by, request_id, actor_kind)
    values (target_batch, qty, 'adjustment', 'adjustment_positive', left(note, 500), u, md5(req::text || ':0')::uuid, 'admin');
  else
    if private.item_available(item.id) < qty then raise exception 'Cannot remove % %: only % % is available.', qty, item.unit, private.item_available(item.id), item.unit; end if;
    mtype := case kind when 'wastage' then 'waste' when 'expiry' then 'expired' else 'adjustment_negative' end;
    mreason := case kind when 'wastage' then 'waste' when 'expiry' then 'expired' else 'adjustment' end;
    remaining := qty;
    for b in
      select bs.id, sum(m.quantity_delta) as q from public.inventory_batches bs join public.inventory_movements m on m.batch_id = bs.id
      where bs.item_id = item.id and bs.archived_at is null and (bs.expires_on is null or bs.expires_on >= (now() at time zone 'Asia/Manila')::date)
      group by bs.id, bs.expires_on, bs.received_at having sum(m.quantity_delta) > 0 order by bs.expires_on asc nulls last, bs.received_at, bs.id
    loop
      exit when remaining <= 0;
      perform 1 from public.inventory_batches where id = b.id for update;
      take := least(remaining, b.q);
      insert into public.inventory_movements(batch_id, quantity_delta, reason, movement_type, note, created_by, request_id, actor_kind)
      values (b.id, -take, mreason, mtype, left(note, 500), u, md5(req::text || ':' || n)::uuid, 'admin');
      remaining := remaining - take; n := n + 1;
    end loop;
  end if;
  perform private.sync_inventory_alerts();
  return jsonb_build_object('item_id', item.id, 'available', private.item_available(item.id));
end $$;
revoke all on function public.adjust_inventory_item(jsonb) from public, anon;
grant execute on function public.adjust_inventory_item(jsonb) to authenticated;

-- Filterable, paged ledger. kind: all | orders | restocks | adjustments | reversals | wastage | expiry
create or replace function public.inventory_history(filters jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  kind text := coalesce(nullif(filters->>'kind',''), 'all'); lim integer := least(greatest(coalesce((filters->>'limit')::integer, 50), 1), 500);
  off integer := greatest(coalesce((filters->>'offset')::integer, 0), 0); item uuid := nullif(filters->>'item_id','')::uuid;
  product uuid := nullif(filters->>'product_id','')::uuid; ordnum bigint := nullif(regexp_replace(coalesce(filters->>'order_number',''), '\D', '', 'g'),'')::bigint;
  dfrom date := nullif(filters->>'from','')::date; dto date := nullif(filters->>'to','')::date; asc_sort boolean := coalesce(filters->>'sort','') = 'oldest';
  types text[]; total bigint; result_rows jsonb;
begin
  perform private.require_admin();
  types := case kind
    when 'orders' then array['order_deduction','order_extra']
    when 'restocks' then array['restock','initial_stock']
    when 'adjustments' then array['adjustment_positive','adjustment_negative','stock_usage']
    when 'reversals' then array['order_reversal']
    when 'wastage' then array['waste','remake','damaged']
    when 'expiry' then array['expired']
    else null end;
  with base as (
    select m.*, i.name as item_name, i.unit, b.batch_code, o.order_number, coalesce(nullif(p.full_name,''), 'System') as actor_name
    from public.inventory_movements m join public.inventory_items i on i.id = m.item_id join public.inventory_batches b on b.id = m.batch_id
    left join public.orders o on o.id = m.order_id left join public.profiles p on p.id = m.created_by
    where (types is null or m.movement_type = any(types))
      and (item is null or m.item_id = item)
      and (ordnum is null or o.order_number = ordnum)
      and (product is null or exists (select 1 from public.order_items oi where oi.order_id = m.order_id and oi.product_id = product))
      and (dfrom is null or (m.created_at at time zone 'Asia/Manila')::date >= dfrom)
      and (dto is null or (m.created_at at time zone 'Asia/Manila')::date <= dto)
  )
  select (select count(*) from base),
    (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'created_at', x.created_at, 'movement_type', x.movement_type, 'item_id', x.item_id,
        'item_name', x.item_name, 'unit', x.unit, 'batch_code', x.batch_code, 'quantity_delta', x.quantity_delta, 'stock_before', x.stock_before,
        'stock_after', x.stock_after, 'order_id', x.order_id, 'order_number', x.order_number, 'note', x.note, 'reference', x.reference,
        'actor_name', x.actor_name, 'actor_kind', x.actor_kind,
        'recipe', (select r.name || ' v' || r.version from public.order_inventory_allocation_lines l join public.product_recipes r on r.id = l.recipe_id
                   where l.allocation_id = x.allocation_id and l.item_id = x.item_id limit 1))
        order by case when asc_sort then x.created_at end asc, case when not asc_sort then x.created_at end desc), '[]')
     from (select * from base order by case when asc_sort then created_at end asc, case when not asc_sort then created_at end desc limit lim offset off) x)
  into total, result_rows;
  return jsonb_build_object('total', total, 'rows', result_rows, 'limit', lim, 'offset', off);
end $$;
revoke all on function public.inventory_history(jsonb) from public, anon;
grant execute on function public.inventory_history(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 13. Admin RPCs — recipes and conversions
-- ---------------------------------------------------------------------------
create or replace function public.recipe_catalog() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'recipes', (select coalesce(jsonb_agg(to_jsonb(r) || jsonb_build_object(
        'product_name', p.name, 'product_slug', p.slug,
        'variant_units', (select coalesce(jsonb_agg(jsonb_build_object('variant_id', vu.variant_id, 'units', vu.units, 'code', v.code, 'label', v.label) order by v.sort_order), '[]')
                          from public.recipe_variant_units vu join public.product_variants v on v.id = vu.variant_id where vu.recipe_id = r.id),
        'lines', (select coalesce(jsonb_agg(to_jsonb(l) || jsonb_build_object('item_name', i.name, 'stock_unit', i.unit, 'conversion', private.conversion_state(l.unit, l.item_id)) order by l.sort_order, l.id), '[]')
                  from public.recipe_lines l join public.inventory_items i on i.id = l.item_id where l.recipe_id = r.id),
        'used_by_orders', (select count(distinct a.order_id) from public.order_inventory_allocation_lines al join public.order_inventory_allocations a on a.id = al.allocation_id where al.recipe_id = r.id))
      order by r.name, r.version desc), '[]')
      from public.product_recipes r left join public.products p on p.id = r.product_id),
    'products', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'slug', p.slug, 'kind', p.kind, 'status', p.status,
        'variants', (select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'code', v.code, 'label', v.label) order by v.sort_order), '[]') from public.product_variants v where v.product_id = p.id))
      order by p.sort_order, p.name), '[]') from public.products p where not p.is_test_product),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'unit', i.unit, 'category', i.category, 'inventory_type', i.inventory_type) order by i.name), '[]')
      from public.inventory_items i where not i.is_archived),
    'conversions', (select coalesce(jsonb_agg(to_jsonb(c) || jsonb_build_object('item_name', i.name, 'item_unit', i.unit) order by i.name, c.unit), '[]')
      from public.inventory_unit_conversions c join public.inventory_items i on i.id = c.item_id),
    'units', (select coalesce(jsonb_agg(jsonb_build_object('code', u.code, 'dimension', u.dimension) order by u.dimension, u.to_base), '[]') from public.measurement_units u where u.code not in ('ml','l'))
  );
end $$;
revoke all on function public.recipe_catalog() from public, anon;
grant execute on function public.recipe_catalog() to authenticated;

-- Internal writer shared by the Admin RPC and the spreadsheet seed. Always creates a NEW version.
create or replace function private.write_recipe_version(payload jsonb, actor uuid) returns public.product_recipes
language plpgsql security definer set search_path='' as $$
declare r public.product_recipes; key uuid := coalesce(nullif(payload->>'recipe_key','')::uuid, gen_random_uuid()); next_version integer;
  l jsonb; v jsonb; problems text[] := '{}'; idx integer := 0; itm public.inventory_items; conv numeric; note_base text;
begin
  if length(btrim(coalesce(payload->>'name',''))) < 2 then raise exception 'Recipe name is required.'; end if;
  if coalesce(nullif(payload->>'batch_yield','')::numeric, 0) <= 0 then raise exception 'Batch yield must be greater than zero.'; end if;
  if jsonb_typeof(payload->'lines') is distinct from 'array' or jsonb_array_length(payload->'lines') = 0 then raise exception 'Add at least one material line.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('lexc-recipe:' || key::text, 0));
  select coalesce(max(version), 0) + 1 into next_version from public.product_recipes where recipe_key = key;
  insert into public.product_recipes(recipe_key, version, product_id, name, status, batch_yield, yield_unit, scaling_mode, notes, review_notes, source, created_by)
  values (key, next_version, nullif(payload->>'product_id','')::uuid, btrim(payload->>'name'), 'draft', (payload->>'batch_yield')::numeric,
    coalesce(nullif(payload->>'yield_unit',''), 'pcs'), coalesce(nullif(payload->>'scaling_mode',''), 'proportional'),
    left(coalesce(payload->>'notes',''), 3000), left(coalesce(payload->>'review_notes',''), 3000), coalesce(nullif(payload->>'source',''), 'admin'), actor)
  returning * into r;
  for v in select value from jsonb_array_elements(coalesce(payload->'variant_units', '[]')) loop
    if coalesce(nullif(v->>'units','')::numeric, 0) <= 0 then continue; end if;
    if r.product_id is null or not exists (select 1 from public.product_variants where id = (v->>'variant_id')::uuid and product_id = r.product_id) then
      raise exception 'Variant does not belong to the linked product.';
    end if;
    insert into public.recipe_variant_units(recipe_id, variant_id, units) values (r.id, (v->>'variant_id')::uuid, (v->>'units')::numeric);
  end loop;
  for l in select value from jsonb_array_elements(payload->'lines') loop
    idx := idx + 1;
    select * into itm from public.inventory_items where id = nullif(l->>'item_id','')::uuid;
    if itm.id is null then problems := problems || ('Line ' || idx || ': choose an inventory item.'); continue; end if;
    if coalesce(nullif(l->>'quantity','')::numeric, 0) <= 0 then problems := problems || ('Line ' || idx || ' (' || itm.name || '): quantity must be greater than zero.'); continue; end if;
    if not exists (select 1 from public.measurement_units where code = l->>'unit') then problems := problems || ('Line ' || idx || ' (' || itm.name || '): unknown unit.'); continue; end if;
    conv := private.convert_to_item_unit((l->>'quantity')::numeric, l->>'unit', itm.id, false);
    -- The generated conversion hint is recalculated on every save, never accumulated.
    note_base := btrim(regexp_replace(coalesce(l->>'review_note',''), '( · )?No conversion from \S+ to \S+ yet\.', '', 'g'));
    insert into public.recipe_lines(recipe_id, item_id, line_group, quantity, unit, basis, rounding, condition, item_quantity, item_unit, needs_review, review_note, source_text, sort_order)
    values (r.id, itm.id, coalesce(nullif(l->>'line_group',''), 'ingredient'), (l->>'quantity')::numeric, l->>'unit', coalesce(nullif(l->>'basis',''), 'per_batch'),
      coalesce(nullif(l->>'rounding',''), 'exact'), coalesce(l->'condition', '{}'::jsonb), conv, itm.unit,
      coalesce((l->>'needs_review')::boolean, false) or conv is null,
      left(note_base || case when conv is null then case when note_base = '' then '' else ' · ' end || 'No conversion from ' || (l->>'unit') || ' to ' || itm.unit || ' yet.' else '' end, 1000),
      left(coalesce(l->>'source_text',''), 500), idx);
  end loop;
  if array_length(problems, 1) > 0 then raise exception '%', array_to_string(problems, E'\n'); end if;
  return r;
end $$;
revoke all on function private.write_recipe_version(jsonb,uuid) from public;

create or replace function private.activate_recipe(target_recipe uuid, actor uuid) returns public.product_recipes
language plpgsql security definer set search_path='' as $$
declare r public.product_recipes; problems text[]; rl record;
begin
  select * into r from public.product_recipes where id = target_recipe for update;
  if r.id is null then raise exception 'Recipe not found.'; end if;
  if r.status = 'active' then return r; end if;
  if r.product_id is null then raise exception 'Link the recipe to a product before activating it.'; end if;
  if not exists (select 1 from public.recipe_variant_units where recipe_id = r.id) then raise exception 'Set how many pieces each product option contains before activating.'; end if;
  select array_agg(i.name || ': ' || coalesce(nullif(l.review_note,''), 'marked for review') order by l.sort_order) into problems
    from public.recipe_lines l join public.inventory_items i on i.id = l.item_id where l.recipe_id = r.id and l.needs_review;
  if problems is not null then raise exception 'Resolve flagged lines before activation: %', array_to_string(problems, '; '); end if;
  select array_agg(i.name || ' (' || l.unit || ' → ' || i.unit || ')') into problems
    from public.recipe_lines l join public.inventory_items i on i.id = l.item_id
    where l.recipe_id = r.id and private.conversion_state(l.unit, l.item_id) not in ('direct','verified');
  if problems is not null then raise exception 'Verify these unit conversions first: %', array_to_string(problems, '; '); end if;
  -- Freeze the stock-unit quantities for this version (history never changes afterwards).
  for rl in select * from public.recipe_lines where recipe_id = r.id loop
    update public.recipe_lines set item_quantity = private.convert_to_item_unit(rl.quantity, rl.unit, rl.item_id, true),
      item_unit = (select unit from public.inventory_items where id = rl.item_id) where id = rl.id;
  end loop;
  update public.product_recipes set status = 'archived', archived_at = now()
    where id <> r.id and ((status = 'active' and (product_id = r.product_id or recipe_key = r.recipe_key))
      or (status = 'draft' and recipe_key = r.recipe_key and version < r.version));
  update public.product_recipes set status = 'active', activated_at = now(), activated_by = actor, archived_at = null where id = r.id returning * into r;
  return r;
end $$;
revoke all on function private.activate_recipe(uuid,uuid) from public;

create or replace function public.save_recipe(payload jsonb) returns public.product_recipes
language plpgsql security definer set search_path='' as $$
declare u uuid := private.require_admin(); r public.product_recipes;
begin
  r := private.write_recipe_version(payload, u);
  if coalesce((payload->>'activate')::boolean, false) then r := private.activate_recipe(r.id, u); end if;
  return r;
end $$;
revoke all on function public.save_recipe(jsonb) from public, anon;
grant execute on function public.save_recipe(jsonb) to authenticated;

create or replace function public.set_recipe_status(target_recipe uuid, next_status text) returns public.product_recipes
language plpgsql security definer set search_path='' as $$
declare u uuid := private.require_admin(); r public.product_recipes;
begin
  if next_status = 'active' then return private.activate_recipe(target_recipe, u); end if;
  if next_status <> 'archived' then raise exception 'Choose active or archived.'; end if;
  update public.product_recipes set status = 'archived', archived_at = now() where id = target_recipe returning * into r;
  if r.id is null then raise exception 'Recipe not found.'; end if;
  return r;
end $$;
revoke all on function public.set_recipe_status(uuid,text) from public, anon;
grant execute on function public.set_recipe_status(uuid,text) to authenticated;

-- Preview requirements for N ordered units of a recipe option without touching stock.
create or replace function public.preview_recipe(target_recipe uuid, pieces numeric) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.product_recipes; factor numeric;
begin
  perform private.require_admin();
  select * into r from public.product_recipes where id = target_recipe;
  if r.id is null or coalesce(pieces, 0) <= 0 then raise exception 'Choose a recipe and a positive quantity.'; end if;
  factor := case when r.scaling_mode = 'whole_batch' then ceil(pieces / r.batch_yield) else pieces / r.batch_yield end;
  return (select coalesce(jsonb_agg(jsonb_build_object('item_id', l.item_id, 'item_name', i.name, 'line_group', l.line_group, 'basis', l.basis,
      'required', case when q is null then null else private.round_stock(case when l.rounding = 'whole' then ceil(q - 0.0000001) else q end) end,
      'unit', i.unit, 'available', private.item_available(l.item_id), 'condition', l.condition) order by l.sort_order), '[]')
    from public.recipe_lines l join public.inventory_items i on i.id = l.item_id
    cross join lateral (select private.convert_to_item_unit(l.quantity, l.unit, l.item_id, false) *
      case l.basis when 'per_batch' then factor when 'per_unit' then pieces else 1 end as q) calc
    where l.recipe_id = r.id);
end $$;
revoke all on function public.preview_recipe(uuid,numeric) from public, anon;
grant execute on function public.preview_recipe(uuid,numeric) to authenticated;

create or replace function public.save_unit_conversion(payload jsonb) returns public.inventory_unit_conversions
language plpgsql security definer set search_path='' as $$
declare u uuid := private.require_admin(); c public.inventory_unit_conversions; f numeric := nullif(payload->>'factor','')::numeric; item_unit text;
begin
  select unit into item_unit from public.inventory_items where id = (payload->>'item_id')::uuid;
  if item_unit is null then raise exception 'Inventory item not found.'; end if;
  if f is null or f <= 0 then raise exception 'Enter how many % one % equals.', item_unit, payload->>'unit'; end if;
  if not exists (select 1 from public.measurement_units where code = payload->>'unit') then raise exception 'Unknown unit.'; end if;
  insert into public.inventory_unit_conversions(item_id, unit, factor, is_verified, note, verified_by, verified_at)
  values ((payload->>'item_id')::uuid, payload->>'unit', f, coalesce((payload->>'verified')::boolean, false), left(coalesce(payload->>'note',''), 500),
    case when coalesce((payload->>'verified')::boolean, false) then u end, case when coalesce((payload->>'verified')::boolean, false) then now() end)
  on conflict (item_id, unit) do update set factor = excluded.factor, is_verified = excluded.is_verified, note = excluded.note,
    verified_by = excluded.verified_by, verified_at = excluded.verified_at
  returning * into c;
  -- Draft lines that were waiting for this conversion become calculable (still require review).
  update public.recipe_lines l set item_quantity = private.convert_to_item_unit(l.quantity, l.unit, l.item_id, false)
    from public.product_recipes r where r.id = l.recipe_id and r.status = 'draft' and l.item_id = c.item_id;
  return c;
end $$;
revoke all on function public.save_unit_conversion(jsonb) from public, anon;
grant execute on function public.save_unit_conversion(jsonb) to authenticated;

-- Admin-editable item settings (threshold, cost, category). Stock itself only changes via the ledger.
create or replace function public.save_inventory_item_settings(payload jsonb) returns public.inventory_items
language plpgsql security definer set search_path='' as $$
declare i public.inventory_items;
begin
  perform private.require_admin();
  if coalesce(nullif(payload->>'min_stock','')::numeric, 0) < 0 then raise exception 'Minimum stock cannot be negative.'; end if;
  update public.inventory_items set
    min_stock = coalesce(nullif(payload->>'min_stock','')::numeric, min_stock),
    estimated_unit_cost = case when payload ? 'estimated_unit_cost' then nullif(payload->>'estimated_unit_cost','')::numeric else estimated_unit_cost end,
    category = coalesce(nullif(btrim(payload->>'category'),''), category)
  where id = (payload->>'item_id')::uuid returning * into i;
  if i.id is null then raise exception 'Inventory item not found.'; end if;
  perform private.sync_inventory_alerts();
  return i;
end $$;
revoke all on function public.save_inventory_item_settings(jsonb) from public, anon;
grant execute on function public.save_inventory_item_settings(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 14. Spreadsheet import (reference data → DRAFT recipes flagged for Admin review)
-- ---------------------------------------------------------------------------
-- Items are matched through aliases first so existing stock is reused; missing items are
-- created with ZERO stock (no batch). Spreadsheet purchase quantities are only used for the
-- estimated unit cost — never as stock.
do $$
declare
  actor uuid := private.actor_profile();
  seed_items jsonb := $j$[
    {"key":"flour","name":"All Purpose Flour","aliases":["all purpose flour","all-purpose flour","ap flour","flour"],"category":"Dry Ingredients","type":"ingredient","unit":"kg","cost":72},
    {"key":"white_sugar","name":"White Sugar","aliases":["white sugar","granulated sugar"],"category":"Dry Ingredients","type":"ingredient","unit":"g","cost":0.085},
    {"key":"brown_sugar","name":"Brown Sugar","aliases":["brown sugar"],"category":"Dry Ingredients","type":"ingredient","unit":"g","cost":0.08},
    {"key":"baking_powder","name":"Baking Powder","aliases":["baking powder"],"category":"Dry Ingredients","type":"ingredient","unit":"g","cost":0.23},
    {"key":"baking_soda","name":"Baking Soda","aliases":["baking soda","solvay baking soda"],"category":"Dry Ingredients","type":"ingredient","unit":"kg","cost":102},
    {"key":"salt","name":"Salt","aliases":["salt"],"category":"Dry Ingredients","type":"ingredient","unit":"kg","cost":41},
    {"key":"cocoa","name":"Cocoa","aliases":["cocoa","cocoa powder"],"category":"Dry Ingredients","type":"ingredient","unit":"g","cost":0.78},
    {"key":"egg","name":"Egg","aliases":["egg","eggs"],"category":"Perishable Ingredients","type":"ingredient","unit":"pcs","cost":9.33},
    {"key":"oil","name":"Oil","aliases":["oil","canola oil","vegetable oil"],"category":"Liquid Ingredients","type":"ingredient","unit":"mL","cost":0.1365},
    {"key":"vanilla","name":"Vanilla Extract","aliases":["vanilla extract","vanilla"],"category":"Liquid Ingredients","type":"ingredient","unit":"mL","cost":0.108},
    {"key":"milk","name":"Full Cream Milk","aliases":["full cream milk","milk","fresh milk"],"category":"Liquid Ingredients","type":"ingredient","unit":"mL","cost":0.1098},
    {"key":"vinegar","name":"Vinegar","aliases":["vinegar"],"category":"Liquid Ingredients","type":"ingredient","unit":"mL","cost":0.04035},
    {"key":"butter","name":"Butter","aliases":["butter"],"category":"Dairy","type":"ingredient","unit":"pcs","cost":150},
    {"key":"condensed_milk","name":"Condensed Milk","aliases":["condensed milk","sweetened condensed milk"],"category":"Dairy","type":"ingredient","unit":"g","cost":0.1051},
    {"key":"condensed_creamer","name":"Condensed Creamer","aliases":["condensed creamer"],"category":"Dairy","type":"ingredient","unit":"g","cost":0.1},
    {"key":"powdered_milk","name":"Powdered Milk","aliases":["powdered milk","milk powder"],"category":"Dairy","type":"ingredient","unit":"g","cost":0.35},
    {"key":"cheese","name":"Cheese","aliases":["cheese","grated cheese"],"category":"Dairy","type":"ingredient","unit":"g","cost":0.4848},
    {"key":"choc_chips","name":"Chocolate Chips","aliases":["chocolate chips","chocolate chip","choco chips"],"category":"Chocolate","type":"ingredient","unit":"g","cost":0.358},
    {"key":"choc_bar","name":"Chocolate Compound","aliases":["chocolate compound","baking bar (chocolate)","chocolate baking bar"],"category":"Chocolate","type":"ingredient","unit":"g","cost":0.32},
    {"key":"white_choc","name":"White Chocolate","aliases":["white chocolate","baking bar (white chocolate)"],"category":"Chocolate","type":"ingredient","unit":"g","cost":0.33},
    {"key":"matcha","name":"Matcha","aliases":["matcha","baking bar (matcha)"],"category":"Flavoring","type":"ingredient","unit":"g","cost":0.338},
    {"key":"strawberry","name":"Strawberry","aliases":["strawberry","baking bar (strawberry)"],"category":"Flavoring","type":"ingredient","unit":"g","cost":0.298},
    {"key":"ube","name":"Ube","aliases":["ube","baking bar (ube)"],"category":"Flavoring","type":"ingredient","unit":"g","cost":0.298},
    {"key":"cashew","name":"Cashew","aliases":["cashew","cashew nuts","diced cashew nuts"],"category":"Nuts","type":"ingredient","unit":"g","cost":0.4289},
    {"key":"walnut","name":"Walnut","aliases":["walnut","walnuts"],"category":"Nuts","type":"ingredient","unit":"g","cost":0.72},
    {"key":"almond","name":"Almond","aliases":["almond","crushed almond","almonds"],"category":"Nuts","type":"ingredient","unit":"g","cost":0.69},
    {"key":"oats","name":"Rolled Oats","aliases":["rolled oats","wg rolled oatmeal","oatmeal","oats"],"category":"Dry Ingredients","type":"ingredient","unit":"g","cost":0.24},
    {"key":"cinnamon","name":"Cinnamon","aliases":["cinnamon","ground cinnamon"],"category":"Dry Ingredients","type":"ingredient","unit":"g","cost":0.45},
    {"key":"icing","name":"Icing","aliases":["icing","frosting"],"category":"Decorating","type":"ingredient","unit":"g","cost":0.279},
    {"key":"fondant","name":"Fondant","aliases":["fondant"],"category":"Decorating","type":"ingredient","unit":"g","cost":0.285},
    {"key":"sprinkles","name":"Sprinkle","aliases":["sprinkle","sprinkles","colored sprinkles"],"category":"Decorating","type":"ingredient","unit":"g","cost":0.22},
    {"key":"marshmallow","name":"Marshmallow","aliases":["marshmallow","marshmallows","mini marshmallows"],"category":"Decorating","type":"ingredient","unit":"g","cost":0.2059},
    {"key":"oreo","name":"Crushed Oreo","aliases":["crushed oreo","crushed oreos"],"category":"Decorating","type":"ingredient","unit":"g","cost":0.4},
    {"key":"dragees","name":"Dragees","aliases":["dragees","pearls","sugar pearls"],"category":"Decorating","type":"ingredient","unit":"g","cost":1.38},
    {"key":"food_color","name":"Food Color","aliases":["food color","food colour","food coloring"],"category":"Decorating","type":"ingredient","unit":"mL","cost":3.1667},
    {"key":"box_6_small","name":"Box 6pcs 5x6.75x1.5\"","aliases":["box 6pcs 5x6.75x1.5\""],"category":"Boxes","type":"packaging","unit":"pcs","cost":9},
    {"key":"box_12","name":"Box 12pcs 6x9x1.5\"","aliases":["box 12pcs 6x9x1.5\"","box for minis 6x9x1.5\""],"category":"Boxes","type":"packaging","unit":"pcs","cost":11},
    {"key":"box_25","name":"Box 25pcs 10x10x2\"","aliases":["box 25pcs 10x10x2\""],"category":"Boxes","type":"packaging","unit":"pcs","cost":19},
    {"key":"box_36","name":"Box 36pcs 12x12x2\"","aliases":["box 36pcs 12x12x2\""],"category":"Boxes","type":"packaging","unit":"pcs","cost":25},
    {"key":"box_6_cookie","name":"Box 6pcs 4x4x2\"","aliases":["box 6pcs 4x4x2\""],"category":"Boxes","type":"packaging","unit":"pcs","cost":7.8},
    {"key":"box_3oz_6","name":"Cupcake Box 6x3oz 9x6x2\"","aliases":["box of 6~3oz 9x6x2\"","cupcake box 6x3oz 9x6x2\""],"category":"Boxes","type":"packaging","unit":"pcs","cost":12},
    {"key":"box_3oz_12","name":"Cupcake Box 12x3oz 12x9x3\"","aliases":["box of 12~3oz 12x9x3\"","cupcake box 12x3oz 12x9x3\""],"category":"Boxes","type":"packaging","unit":"pcs","cost":20},
    {"key":"box_yema","name":"Square Box 10x10x6.5cm","aliases":["square box 10x10x6.5cm","square 10x10x6.5cm"],"category":"Boxes","type":"packaging","unit":"pcs","cost":4.98},
    {"key":"tub_500","name":"Plastic Container 500ml","aliases":["plastic container 500ml"],"category":"Containers","type":"packaging","unit":"pcs","cost":6.2},
    {"key":"sticker_wide","name":"TY Sticker (Wide)","aliases":["ty sticker (wide)","ty sticker roll","ty sticker roll (malapad)","ty sticker"],"category":"Labels","type":"packaging","unit":"pcs","cost":0.2917},
    {"key":"sticker_circle","name":"TY Sticker (Circle)","aliases":["ty sticker (circle)","ty sticker roll (circle)"],"category":"Labels","type":"packaging","unit":"pcs","cost":0.0378},
    {"key":"liner_3oz","name":"Cupcake Liner 3oz","aliases":["cupcake liner 3oz","3oz cupcake liner"],"category":"Liners","type":"packaging","unit":"pcs","cost":0.21},
    {"key":"liner_mini","name":"Cupcake Liner 3/4oz","aliases":["cupcake liner 3/4oz","3/4 oz cupcake liner"],"category":"Liners","type":"packaging","unit":"pcs","cost":0.136},
    {"key":"liner_2oz","name":"Cupcake Liner 2oz","aliases":["cupcake liner 2oz","cupcake liner"],"category":"Liners","type":"packaging","unit":"pcs","cost":0.192},
    {"key":"snowbear","name":"Plastic Snowbear Tiny","aliases":["plastic snowbear tiny","plastic tiny","plastic ~ tiny"],"category":"Bags","type":"packaging","unit":"pcs","cost":0.38},
    {"key":"stick_10","name":"Stick 10cm","aliases":["stick 10cm"],"category":"Cake Pop Supplies","type":"packaging","unit":"pcs","cost":0.5},
    {"key":"pouch_small","name":"Small Pouch 3x4","aliases":["small pouch 3x4","small pouch (3x4)"],"category":"Bags","type":"packaging","unit":"pcs","cost":0.36},
    {"key":"metallic_wire","name":"Metallic Wire","aliases":["metallic wire"],"category":"Cake Pop Supplies","type":"packaging","unit":"pcs","cost":0.05}
  ]$j$::jsonb;
  seed_conversions jsonb := $j$[
    {"item":"butter","unit":"g","factor":0.0044444444,"note":"Costing sheets price butter per 225 g block (1 pc = 225 g). Verify your block size."},
    {"item":"vanilla","unit":"g","factor":1.25,"note":"Costing sheet: \"1 Liter/800g\" → 1 g ≈ 1.25 mL. Verify."},
    {"item":"oil","unit":"g","factor":1.1111111111,"note":"Costing sheet: \"2 Liter/1800g\" → 1 g ≈ 1.11 mL. Verify."}
  ]$j$::jsonb;
  -- Shared line sets (quantities exactly as written in the costing sheets; units in grams unless stated).
  choc_cupcake_base jsonb := $j$[
    {"item":"flour","qty":130,"unit":"g","src":"All Purpose Flour · NEED 130"},
    {"item":"cocoa","qty":40,"unit":"g","src":"Cocoa Powder · NEED 40"},
    {"item":"baking_powder","qty":3,"unit":"g","src":"Baking Powder · NEED 3"},
    {"item":"baking_soda","qty":4,"unit":"g","src":"Baking Soda · NEED 4"},
    {"item":"salt","qty":2.5,"unit":"g","src":"Salt · NEED 2.5"},
    {"item":"white_sugar","qty":100,"unit":"g","src":"White Sugar · NEED 100"},
    {"item":"brown_sugar","qty":80,"unit":"g","src":"Brown Sugar · NEED 80"},
    {"item":"oil","qty":60,"unit":"g","src":"Canola Oil · 60g (1/4 cup)","review":"Cup measure converted to grams in the sheet (approximate)."},
    {"item":"vinegar","qty":5,"unit":"g","src":"Vinegar · 5g (1/2 tbsp)","review":"Recorded in grams but stocked in mL — set a vinegar g→mL conversion or change the line to mL."},
    {"item":"egg","qty":1,"unit":"pcs","src":"Egg · NEED 1"},
    {"item":"milk","qty":120,"unit":"g","src":"Milk · 120g (1/2 cup)","review":"Recorded in grams but stocked in mL — set a milk g→mL conversion or change the line to mL."}
  ]$j$::jsonb;
  cookie_dough jsonb := $j$[
    {"item":"butter","qty":135,"unit":"g","src":"Butter · NEED 135"},
    {"item":"brown_sugar","qty":90,"unit":"g","src":"Brown Sugar · NEED 90"},
    {"item":"white_sugar","qty":70,"unit":"g","src":"White Sugar · NEED 70"},
    {"item":"egg","qty":1,"unit":"pcs","src":"Egg · NEED 1"},
    {"item":"vanilla","qty":5,"unit":"g","src":"Vanilla Extract · 5g (1 tsp)"},
    {"item":"flour","qty":250,"unit":"g","src":"All Purpose Flour · NEED 250"},
    {"item":"baking_soda","qty":4.6,"unit":"g","src":"Baking Soda · 4.6g (1 tsp)"},
    {"item":"choc_chips","qty":50,"unit":"g","group":"topping","src":"Chocolate Chips · NEED 50"}
  ]$j$::jsonb;
  donut_base jsonb := $j$[
    {"item":"flour","qty":120,"unit":"g","src":"All Purpose Flour · 120 g"},
    {"item":"white_sugar","qty":80,"unit":"g","src":"White Sugar · 80 g"},
    {"item":"baking_powder","qty":8,"unit":"g","src":"Baking Powder · 8 (2 tsp)"},
    {"item":"salt","qty":0.5,"unit":"g","src":"Salt · 0.5"},
    {"item":"egg","qty":2,"unit":"pcs","src":"Egg · 2"},
    {"item":"oil","qty":56,"unit":"g","src":"Canola Oil · 56 (1/4 cup)"},
    {"item":"vanilla","qty":4,"unit":"g","src":"Vanilla Extract · 4 (1 tsp)"},
    {"item":"vinegar","qty":5,"unit":"g","src":"Vinegar · 5 (1 tsp)","review":"Recorded in grams but stocked in mL — set a vinegar g→mL conversion or change the line to mL."},
    {"item":"choc_bar","qty":5,"unit":"g","group":"flavor","basis":"per_unit","src":"Baking Bar (Chocolate) · 5 g","review":"Sheet costs every flavor per donut and maps 'Baking Bar (Chocolate)' to Chocolate Compound — confirm the real per-donut flavor mix."},
    {"item":"matcha","qty":5,"unit":"g","group":"flavor","basis":"per_unit","src":"Baking Bar (Matcha) · 5 g","review":"Sheet costs every flavor per donut — confirm the real per-donut flavor mix."},
    {"item":"white_choc","qty":5,"unit":"g","group":"flavor","basis":"per_unit","src":"Baking Bar (White Chocolate) · 5 g","review":"Sheet costs every flavor per donut — confirm the real per-donut flavor mix."},
    {"item":"strawberry","qty":5,"unit":"g","group":"flavor","basis":"per_unit","src":"Baking Bar (Strawberry) · 5 g","review":"Sheet costs every flavor per donut — confirm the real per-donut flavor mix."},
    {"item":"ube","qty":5,"unit":"g","group":"flavor","basis":"per_unit","src":"Baking Bar (Ube) · 5 g","review":"Sheet costs every flavor per donut — confirm the real per-donut flavor mix."},
    {"item":"marshmallow","qty":9,"unit":"g","group":"topping","basis":"per_unit","src":"Mini Marshmallows · 9 g","review":"Sheet costs every topping per donut — confirm the real per-donut topping mix."},
    {"item":"oreo","qty":3,"unit":"g","group":"topping","basis":"per_unit","src":"Crushed Oreos · 3 g","review":"Sheet costs every topping per donut — confirm the real per-donut topping mix."},
    {"item":"almond","qty":3,"unit":"g","group":"topping","basis":"per_unit","src":"Crushed Almond · 3 g","review":"Sheet costs every topping per donut — confirm the real per-donut topping mix."},
    {"item":"sprinkles","qty":4,"unit":"g","group":"topping","basis":"per_unit","src":"Colored Sprinkles · 4 g","review":"Sheet costs every topping per donut — confirm the real per-donut topping mix."},
    {"item":"fondant","qty":1,"unit":"g","group":"topping","basis":"per_unit","src":"Fondant · 1 g"}
  ]$j$::jsonb;
  vanilla_cake jsonb := $j$[
    {"item":"butter","qty":170,"unit":"g","src":"Butter · NEED 170"},
    {"item":"egg","qty":3,"unit":"pcs","src":"Egg · NEED 3"},
    {"item":"milk","qty":320,"unit":"g","src":"Milk · 320g","review":"Recorded in grams but stocked in mL — set a milk g→mL conversion or change the line to mL."},
    {"item":"vinegar","qty":5,"unit":"g","src":"Vinegar · 5g","review":"Recorded in grams but stocked in mL — set a vinegar g→mL conversion or change the line to mL."},
    {"item":"vanilla","qty":5,"unit":"g","src":"Vanilla Extract · 5g (1 tsp)"},
    {"item":"white_sugar","qty":160,"unit":"g","src":"White Sugar · NEED 160"},
    {"item":"flour","qty":240,"unit":"g","src":"All Purpose Flour · NEED 240"},
    {"item":"baking_soda","qty":4.6,"unit":"g","src":"Baking Soda · 4.6g"},
    {"item":"baking_powder","qty":5.5,"unit":"g","src":"Baking Powder · 5.5g"}
  ]$j$::jsonb;
  recipes jsonb;
  rec jsonb; ln jsonb; it jsonb; item_ref uuid; items_map jsonb := '{}'; lines jsonb; vunits jsonb; r public.product_recipes; pid uuid; key uuid; cv jsonb;
begin
  if actor is null then raise notice 'No Admin profile yet — recipe seed skipped. Re-run after creating the Admin.'; return; end if;

  -- 1. Resolve (or create) inventory items through aliases.
  for it in select value from jsonb_array_elements(seed_items) loop
    select a.item_id into item_ref from public.inventory_item_aliases a where a.alias = any(array(select lower(jsonb_array_elements_text(it->'aliases')))) limit 1;
    if item_ref is null then
      select i.id into item_ref from public.inventory_items i
        where lower(i.name) = any(array(select lower(jsonb_array_elements_text(it->'aliases')))) and not i.is_archived
        order by (lower(i.name) = lower(it->>'name')) desc, i.created_at limit 1;
    end if;
    if item_ref is null then
      insert into public.inventory_items(name, category, inventory_type, unit, min_stock, estimated_unit_cost)
      values (it->>'name', it->>'category', it->>'type', it->>'unit', 0, (it->>'cost')::numeric)
      on conflict (lower(name), unit) do update set updated_at = now()
      returning id into item_ref;
    else
      update public.inventory_items set estimated_unit_cost = coalesce(estimated_unit_cost,
        case when unit = it->>'unit' then (it->>'cost')::numeric end) where id = item_ref;
    end if;
    insert into public.inventory_item_aliases(alias, item_id)
      select lower(a), item_ref from jsonb_array_elements_text(it->'aliases') a on conflict (alias) do nothing;
    items_map := items_map || jsonb_build_object(it->>'key', item_ref);
    item_ref := null;
  end loop;

  -- Restocking derives batch codes from item_code; give every item a unique, readable code
  -- (letters/digits only) so similar names such as "TY Sticker (Wide)/(Circle)" never collide.
  declare ic record; prefix text; candidate text; seq integer; begin
    for ic in select id, name from public.inventory_items where item_code is null order by created_at, name loop
      prefix := nullif(left(upper(regexp_replace(coalesce(private.inventory_code(regexp_replace(ic.name, '[^A-Za-z0-9 ]', ' ', 'g')), ''), '[^A-Za-z0-9]', '', 'g')), 6), '');
      prefix := coalesce(prefix, 'INV'); candidate := prefix; seq := 2;
      while exists (select 1 from public.inventory_items where item_code = candidate) loop candidate := prefix || seq::text; seq := seq + 1; end loop;
      update public.inventory_items set item_code = candidate where id = ic.id;
    end loop;
  end;

  for cv in select value from jsonb_array_elements(seed_conversions) loop
    insert into public.inventory_unit_conversions(item_id, unit, factor, is_verified, note)
    select (items_map->>(cv->>'item'))::uuid, cv->>'unit', (cv->>'factor')::numeric, false, cv->>'note'
    where (select unit from public.inventory_items where id = (items_map->>(cv->>'item'))::uuid) not in ('g','kg','mg')
    on conflict (item_id, unit) do nothing;
  end loop;

  recipes := jsonb_build_array(
    jsonb_build_object('key','mini-cupcakes','product','product-5','name','Chocolate Cupcake — Mini (3/4 oz)','yield',36,
      'notes','Cupcake costing sheet · "Mini Cupcake 3/4oz · est. 36pcs". Hot water (1 cup) is not stocked.',
      'review','Yield is an estimate. Dragees/Fondant "10" in the sheet has no quantity/unit and was not imported. 48-pc option has no box size in the sheet.',
      'variants', jsonb_build_object('option-1',12,'option-2',25,'option-3',36,'option-4',48),
      'lines', choc_cupcake_base || $j$[
        {"item":"icing","qty":5,"unit":"g","group":"topping","basis":"per_unit","src":"Icing · Minis 5 g"},
        {"item":"liner_mini","qty":1,"unit":"pcs","group":"packaging","basis":"per_unit","src":"3/4 oz cupcake liner"},
        {"item":"box_12","qty":1,"unit":"pcs","group":"packaging","basis":"per_package","cond":{"variant_codes":["option-1"]},"src":"Box ~ for minis 6x9x1.5\""},
        {"item":"box_25","qty":1,"unit":"pcs","group":"packaging","basis":"per_package","cond":{"variant_codes":["option-2"]},"src":"Box 25pcs 10x10x2 (donut sheet size)","review":"Box for 25 minis assumed from the donut sheet — confirm."},
        {"item":"box_36","qty":1,"unit":"pcs","group":"packaging","basis":"per_package","cond":{"variant_codes":["option-3"]},"src":"Box 36pcs 12x12x2 (donut sheet size)","review":"Box for 36 minis assumed from the donut sheet — confirm."},
        {"item":"sticker_wide","qty":1,"unit":"pcs","group":"packaging","basis":"per_package","src":"TY Sticker Roll (malapad) · 1 per box"}
      ]$j$::jsonb),
    jsonb_build_object('key','3oz-cupcake','product','product-6','name','Chocolate Cupcake — 3 oz','yield',14,
      'notes','Cupcake costing sheet · "Cupcake 3oz · 14pcs". Hot water (1 cup) is not stocked.',
      'review','Dragees/Fondant "10" in the sheet has no quantity/unit and was not imported.',
      'variants', jsonb_build_object('option-1',6,'option-2',12,'option-3',24),
      'lines', choc_cupcake_base || $j$[
        {"item":"icing","qty":20,"unit":"g","group":"topping","basis":"per_unit","src":"Icing · 20 g"},
        {"item":"liner_3oz","qty":1,"unit":"pcs","group":"packaging","basis":"per_unit","src":"3oz Cupcake Liner"},
        {"item":"box_3oz_6","qty":1,"unit":"pcs","group":"packaging","basis":"per_package","cond":{"variant_codes":["option-1"]},"src":"box of 6~3oz 9x6x2\""},
        {"item":"box_3oz_12","qty":1,"unit":"pcs","group":"packaging","basis":"per_package","cond":{"variant_codes":["option-2"]},"src":"box of 12~3oz 12x9x3\""},
        {"item":"box_3oz_12","qty":2,"unit":"pcs","group":"packaging","basis":"per_package","cond":{"variant_codes":["option-3"]},"src":"24 pcs = 2 × box of 12~3oz"},
        {"item":"sticker_wide","qty":1,"unit":"pcs","group":"packaging","basis":"per_package","src":"TY Sticker Roll (malapad) · 1 per box"}
      ]$j$::jsonb),
    jsonb_build_object('key','cupcake-bouquet','product','product-7','name','Cupcake Bouquet','yield',14,
      'notes','Uses the 3 oz chocolate cupcake batch.',
      'review','Bouquet wrapping (flower wrap, flower paper, cups, box, tape, ribbon) is listed in the sheet without per-bouquet quantities — add packaging lines before activating.',
      'variants', jsonb_build_object('option-1',4,'option-2',7),
      'lines', choc_cupcake_base || $j$[
        {"item":"icing","qty":20,"unit":"g","group":"topping","basis":"per_unit","src":"Icing · 20 g"},
        {"item":"liner_3oz","qty":1,"unit":"pcs","group":"packaging","basis":"per_unit","src":"3oz Cupcake Liner"}
      ]$j$::jsonb),
    jsonb_build_object('key','custom-cupcake','product','custom-cupcake','name','Custom Cupcake (chocolate base)','yield',14,
      'notes','Chocolate base follows the 3 oz cupcake sheet. Topping amounts reuse the donut/cake-pop sheets.',
      'review','No vanilla cupcake sheet was provided — vanilla-base orders will show as "manual review". Confirm how many cupcakes one order of each frosting option contains (set to 1).',
      'variants', jsonb_build_object('rose',1,'smooth',1,'swirl',1),
      'lines', (select jsonb_agg(x || jsonb_build_object('cond', jsonb_build_object('customization', jsonb_build_object('base', jsonb_build_array('chocolate'))))) from jsonb_array_elements(choc_cupcake_base) x) || $j$[
        {"item":"icing","qty":20,"unit":"g","group":"topping","basis":"per_unit","src":"Icing · 20 g"},
        {"item":"sprinkles","qty":4,"unit":"g","group":"topping","basis":"per_unit","cond":{"customization":{"topping":["sprinkles"]}},"src":"Colored Sprinkles · 4 g (donut sheet)","review":"Amount borrowed from the donut sheet — confirm for cupcakes."},
        {"item":"marshmallow","qty":9,"unit":"g","group":"topping","basis":"per_unit","cond":{"customization":{"topping":["minimallows"]}},"src":"Mini Marshmallows · 9 g (donut sheet)","review":"Amount borrowed from the donut sheet — confirm for cupcakes."},
        {"item":"dragees","qty":3,"unit":"g","group":"topping","basis":"per_unit","cond":{"customization":{"topping":["pearls"]}},"src":"Dragees · 3 g (cake pop sheet)","review":"Pearls mapped to Dragees — confirm."},
        {"item":"liner_3oz","qty":1,"unit":"pcs","group":"packaging","basis":"per_unit","src":"3oz Cupcake Liner"}
      ]$j$::jsonb),
    jsonb_build_object('key','yema-cake','product','product-4','name','Yema Cake — Bento (vanilla moist cake + yema sauce)','yield',6,
      'notes','Vanilla Moist Cake sheet: "160g · 6" cakes per batch. Yema sauce: ~1,000 g batch, 4 tbsp ≈ 60 g per cake (sauce lines are 6% of the sauce batch per cake). Cheese 5 g per cake.',
      'review','Sauce yield is marked "estimated" in the sheet.',
      'variants', jsonb_build_object('option-1',2,'option-2',4),
      'lines', vanilla_cake || $j$[
        {"item":"egg","qty":0.3,"unit":"pcs","group":"topping","basis":"per_unit","src":"Yema Sauce · Egg 5 × 60/1000","review":"Estimated sauce share per cake (60 g of ~1,000 g)."},
        {"item":"milk","qty":22.2,"unit":"mL","group":"topping","basis":"per_unit","src":"Yema Sauce · Milk 370 × 60/1000","review":"Estimated sauce share per cake (60 g of ~1,000 g)."},
        {"item":"condensed_creamer","qty":46.8,"unit":"g","group":"topping","basis":"per_unit","src":"Yema Sauce · Condensed Creamer 780 × 60/1000","review":"Estimated sauce share per cake (60 g of ~1,000 g)."},
        {"item":"butter","qty":3.42,"unit":"g","group":"topping","basis":"per_unit","src":"Yema Sauce · Butter 57 × 60/1000","review":"Estimated sauce share per cake (60 g of ~1,000 g)."},
        {"item":"vanilla","qty":0.3,"unit":"g","group":"topping","basis":"per_unit","src":"Yema Sauce · Vanilla 5 × 60/1000"},
        {"item":"cheese","qty":5,"unit":"g","group":"topping","basis":"per_unit","src":"Cheese · NEED 5"},
        {"item":"box_yema","qty":1,"unit":"pcs","group":"packaging","basis":"per_unit","src":"Square 10x10x6.5cm · 1 per cake"},
        {"item":"snowbear","qty":1,"unit":"pcs","group":"packaging","basis":"per_unit","src":"Plastic Snowbear Tiny · 1"},
        {"item":"sticker_wide","qty":1,"unit":"pcs","group":"packaging","basis":"per_unit","src":"TY Sticker Roll (malapad)"}
      ]$j$::jsonb),
    jsonb_build_object('key','chunky-regular','product','product-15','name','Chocolate Chip Cookies — Regular (30 g)','yield',21,
      'notes','Chocolate Chip Cookies sheet: 630 g dough → 21 pcs at 30 g.',
      'review','30-pc option has no box in the sheet. Sandwich bags, ribbon and snowbear bags are listed without a per-order rule and were not imported.',
      'variants', jsonb_build_object('option-1',6,'option-2',12,'option-3',30),
      'lines', cookie_dough || $j$[
        {"item":"box_6_cookie","qty":1,"unit":"pcs","group":"packaging","basis":"per_package","cond":{"variant_codes":["option-1"]},"src":"Box ~ 6pcs 4x4x2\""},
        {"item":"box_12","qty":1,"unit":"pcs","group":"packaging","basis":"per_package","cond":{"variant_codes":["option-2"]},"src":"Box ~ 12pcs 6x9x1.5\""},
        {"item":"sticker_circle","qty":1,"unit":"pcs","group":"packaging","basis":"per_package","src":"TY Sticker Roll (circle)"}
      ]$j$::jsonb),
    jsonb_build_object('key','chunky-bite','product','product-14','name','Chocolate Chip Cookies — Bite-Sized (10 g)','yield',66,
      'notes','Chocolate Chip Cookies sheet: 630 g dough → 66 pcs at 10 g.','review','',
      'variants', jsonb_build_object('option-1',20),
      'lines', cookie_dough || $j$[
        {"item":"tub_500","qty":1,"unit":"pcs","group":"packaging","basis":"per_package","src":"Plastic Container 500ml · 1 tub"},
        {"item":"sticker_circle","qty":1,"unit":"pcs","group":"packaging","basis":"per_package","src":"TY Sticker Roll (circle)"}
      ]$j$::jsonb),
    jsonb_build_object('key','chunky-palm','product','product-16','name','Chocolate Chip Cookies — Palm Size (65 g)','yield',8,
      'notes','Chocolate Chip Cookies sheet: 630 g dough → 8 pcs at 65 g.',
      'review','Box sizes for palm-size cookies are not stated in the sheet — boxes below are assumptions.',
      'variants', jsonb_build_object('option-1',6,'option-2',12),
      'lines', cookie_dough || $j$[
        {"item":"box_6_cookie","qty":1,"unit":"pcs","group":"packaging","basis":"per_package","cond":{"variant_codes":["option-1"]},"src":"Box ~ 6pcs 4x4x2\"","review":"Confirm the box used for 6 palm-size cookies."},
        {"item":"box_12","qty":1,"unit":"pcs","group":"packaging","basis":"per_package","cond":{"variant_codes":["option-2"]},"src":"Box ~ 12pcs 6x9x1.5\"","review":"Confirm the box used for 12 palm-size cookies."},
        {"item":"sticker_circle","qty":1,"unit":"pcs","group":"packaging","basis":"per_package","src":"TY Sticker Roll (circle)"}
      ]$j$::jsonb),
    jsonb_build_object('key','oatmeal-cookies','product',null,'name','Oatmeal Cookies (30 g)','yield',21,
      'notes','Oatmeal Cookies sheet: 630 g dough → 21 pcs at 30 g.',
      'review','No Oatmeal Cookie product exists in the catalog yet — link a product before activating.',
      'variants', '{}'::jsonb,
      'lines', $j$[
        {"item":"butter","qty":120,"unit":"g","src":"Butter · NEED 120"},
        {"item":"brown_sugar","qty":80,"unit":"g","src":"Brown Sugar · NEED 80"},
        {"item":"white_sugar","qty":80,"unit":"g","src":"White Sugar · NEED 80"},
        {"item":"egg","qty":1,"unit":"pcs","src":"Egg · NEED 1"},
        {"item":"vanilla","qty":5,"unit":"g","src":"Vanilla Extract · 5g (1 tsp)"},
        {"item":"flour","qty":180,"unit":"g","src":"All Purpose Flour · NEED 180"},
        {"item":"baking_soda","qty":4.6,"unit":"g","src":"Solvay Baking Soda · 4.6g (1 tsp)"},
        {"item":"oats","qty":150,"unit":"g","src":"WG Rolled Oatmeal · NEED 150"},
        {"item":"cinnamon","qty":1.5,"unit":"g","src":"Cinnamon · 1.5 (1/2 tsp)"},
        {"item":"choc_chips","qty":50,"unit":"g","group":"topping","src":"Chocolate Chips (Beryls) · 50"},
        {"item":"walnut","qty":30,"unit":"g","group":"topping","src":"Walnuts · 30"}
      ]$j$::jsonb),
    jsonb_build_object('key','caramel-bar','product','product-25','name','Caramel Bar','yield',16,
      'notes','Caramel Bar sheet: Regular Size · 16 pcs per batch.','review','"Plastic ~ Tiny 0.2 per bar" has no clear rule and was not imported.',
      'variants', jsonb_build_object('option-1',6,'option-2',12),
      'lines', $j$[
        {"item":"butter","qty":180,"unit":"g","src":"Butter · NEED 180"},
        {"item":"brown_sugar","qty":190,"unit":"g","src":"Brown Sugar · NEED 190"},
        {"item":"condensed_milk","qty":140,"unit":"g","src":"Condensed Milk · NEED 140"},
        {"item":"vanilla","qty":5,"unit":"g","src":"Vanilla Extract · 5g (1 tsp)"},
        {"item":"egg","qty":2,"unit":"pcs","src":"Egg · NEED 2"},
        {"item":"powdered_milk","qty":60,"unit":"g","src":"Powdered Milk · NEED 60"},
        {"item":"flour","qty":120,"unit":"g","src":"All Purpose Flour · NEED 120"},
        {"item":"cashew","qty":30,"unit":"g","group":"topping","src":"Diced Cashew Nuts · NEED 30"},
        {"item":"liner_2oz","qty":1,"unit":"pcs","group":"packaging","basis":"per_unit","src":"Cupcake Liner 2oz · 1 per bar"},
        {"item":"box_6_small","qty":1,"unit":"pcs","group":"packaging","basis":"per_package","cond":{"variant_codes":["option-1"]},"src":"Box ~ 6pcs 5 x 6.75 x 1.5"},
        {"item":"box_12","qty":1,"unit":"pcs","group":"packaging","basis":"per_package","cond":{"variant_codes":["option-2"]},"src":"Box ~ 12pcs 6 x 9 x 1.5\""},
        {"item":"sticker_wide","qty":1,"unit":"pcs","group":"packaging","basis":"per_package","src":"TY Sticker Roll · 1 per box"}
      ]$j$::jsonb),
    jsonb_build_object('key','cake-pop','product',null,'name','Cake Pop (20 g)','yield',46,
      'notes','Cake Pop sheet: "20g ~ 46pcs". Used inside the Mini Bliss / Sweet Spread / Golden Table packages.',
      'review','No standalone Cake Pop product exists — link a product (or use for package recipes). Food color is 0.25 of a 30 mL bottle unit; confirm.',
      'variants', '{}'::jsonb,
      'lines', $j$[
        {"item":"butter","qty":170,"unit":"g","src":"Butter · NEED 170"},
        {"item":"egg","qty":3,"unit":"pcs","src":"Egg · NEED 3"},
        {"item":"milk","qty":320,"unit":"g","src":"Milk · 320g","review":"Recorded in grams but stocked in mL — set a milk g→mL conversion or change the line to mL."},
        {"item":"vinegar","qty":5,"unit":"g","src":"Vinegar · 5g","review":"Recorded in grams but stocked in mL — set a vinegar g→mL conversion or change the line to mL."},
        {"item":"vanilla","qty":5,"unit":"g","src":"Vanilla Extract · 5g (1tsp)"},
        {"item":"white_sugar","qty":180,"unit":"g","src":"White Sugar · NEED 180"},
        {"item":"flour","qty":240,"unit":"g","src":"All Purpose Flour · NEED 240"},
        {"item":"baking_powder","qty":5.5,"unit":"g","src":"Baking Powder · 5.5g"},
        {"item":"white_choc","qty":6,"unit":"g","group":"topping","basis":"per_unit","src":"White Chocolate · 6 g"},
        {"item":"food_color","qty":0.25,"unit":"mL","group":"topping","basis":"per_unit","src":"Food Color · 0.25","review":"Unit of 0.25 is unclear in the sheet (grams column, 30 mL bottle)."},
        {"item":"dragees","qty":3,"unit":"g","group":"topping","basis":"per_unit","src":"Dragees · 3 g"},
        {"item":"fondant","qty":4,"unit":"g","group":"topping","basis":"per_unit","src":"Fondant · 4 g"},
        {"item":"stick_10","qty":1,"unit":"pcs","group":"packaging","basis":"per_unit","src":"stick 10cm · 1"},
        {"item":"pouch_small","qty":1,"unit":"pcs","group":"packaging","basis":"per_unit","src":"small pouch (3x4) · 1"},
        {"item":"metallic_wire","qty":1,"unit":"pcs","group":"packaging","basis":"per_unit","src":"metallic wire · 1"}
      ]$j$::jsonb),
    jsonb_build_object('key','donut-premium','product','product-1','name','Premium Mini Donuts — Premium Box','yield',24,
      'notes','Premium Mini Donuts sheet: base batch → 24 pcs. Water (1/4 cup) is not stocked.',
      'review','Flavor/topping lines follow the costing sheet, which charges every flavor and topping to each donut.',
      'variants', jsonb_build_object('option-1',12),
      'lines', donut_base || $j$[
        {"item":"box_12","qty":1,"unit":"pcs","group":"packaging","basis":"per_package","src":"Box 12pcs 6x9x1.5\""},
        {"item":"sticker_wide","qty":1,"unit":"pcs","group":"packaging","basis":"per_package","src":"TY Sticker Roll · 1 per box"}
      ]$j$::jsonb),
    jsonb_build_object('key','donut-party','product','product-2','name','Premium Mini Donuts — Party Box','yield',24,
      'notes','Premium Mini Donuts sheet: base batch → 24 pcs.',
      'review','48-pc option has no box in the sheet. Flavor/topping lines charge every flavor and topping to each donut.',
      'variants', jsonb_build_object('option-1',25,'option-2',36,'option-3',48),
      'lines', donut_base || $j$[
        {"item":"box_25","qty":1,"unit":"pcs","group":"packaging","basis":"per_package","cond":{"variant_codes":["option-1"]},"src":"Box 25pcs 10x10x2"},
        {"item":"box_36","qty":1,"unit":"pcs","group":"packaging","basis":"per_package","cond":{"variant_codes":["option-2"]},"src":"Box 36pcs 12x12x2"},
        {"item":"sticker_wide","qty":1,"unit":"pcs","group":"packaging","basis":"per_package","src":"TY Sticker Roll · 1 per box"}
      ]$j$::jsonb),
    jsonb_build_object('key','donut-themed','product','product-3','name','Premium Mini Donuts — Themed Party Box','yield',24,
      'notes','Premium Mini Donuts sheet: base batch → 24 pcs. Themed fondant details vary per order — record extras on the order.',
      'review','48-pc option has no box in the sheet. Flavor/topping lines charge every flavor and topping to each donut.',
      'variants', jsonb_build_object('option-1',36,'option-2',48),
      'lines', donut_base || $j$[
        {"item":"box_36","qty":1,"unit":"pcs","group":"packaging","basis":"per_package","cond":{"variant_codes":["option-1"]},"src":"Box 36pcs 12x12x2"},
        {"item":"sticker_wide","qty":1,"unit":"pcs","group":"packaging","basis":"per_package","src":"TY Sticker Roll · 1 per box"}
      ]$j$::jsonb)
  );

  for rec in select value from jsonb_array_elements(recipes) loop
    key := md5('lexc-recipe-seed:' || (rec->>'key'))::uuid;
    if exists (select 1 from public.product_recipes where recipe_key = key) then continue; end if; -- never overwrite Admin edits
    pid := (select id from public.products where slug = rec->>'product');
    vunits := (select coalesce(jsonb_agg(jsonb_build_object('variant_id', v.id, 'units', (rec->'variants'->>v.code)::numeric)), '[]')
               from public.product_variants v where v.product_id = pid and rec->'variants' ? v.code);
    lines := (select jsonb_agg(jsonb_build_object(
        'item_id', items_map->>(l->>'item'), 'quantity', l->'qty', 'unit', l->>'unit',
        'line_group', coalesce(l->>'group', 'ingredient'), 'basis', coalesce(l->>'basis', 'per_batch'),
        'condition', coalesce(l->'cond', '{}'::jsonb), 'needs_review', (l ? 'review'), 'review_note', coalesce(l->>'review', ''),
        'source_text', l->>'src') order by o)
      from jsonb_array_elements(rec->'lines') with ordinality as t(l, o));
    r := private.write_recipe_version(jsonb_build_object('recipe_key', key, 'product_id', pid, 'name', rec->>'name', 'batch_yield', rec->'yield',
      'notes', rec->>'notes', 'review_notes', rec->>'review', 'source', 'Costing spreadsheet import', 'variant_units', vunits, 'lines', lines), actor);
  end loop;
end $$;
