-- Phase 108 · Quantity limits per item, and fondant or frosting on cakes.
-- What this does, in plain words:
--   1. Each line of an order has a quantity limit, checked by the database when the order is placed:
--        Cake Pops (cake pop designer)                          24 to 500 pieces
--        customizable products (bento, cupcake, donut designers
--        and products of kind "customizable")                   1 to 15
--        everything else on the menu                            1 to 30
--      An order outside these limits is refused with a clear message; orders already placed are not touched.
--   2. Cakes made in the bento designer now say whether they are covered in fondant (smooth) or frosting
--      (buttercream). The customer picks it; it is free either way. private.bento_design keeps the choice as
--      "coat" on the saved design and in the order summary ("White fondant" / "White frosting").
--      Older designs without a choice count as fondant, as before.
-- Safe to run more than once.
begin;

-- 1. quantity limits
create or replace function private.order_item_qty_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare p public.products; lo integer := 1; hi integer := 30;
begin
  select * into p from public.products where id = new.product_id;
  if p.customization_config->>'designer' = 'cakepop' then lo := 24; hi := 500;
  elsif p.customization_config->>'designer' is not null or p.kind = 'customizable' then hi := 15;
  end if;
  if new.quantity < lo or new.quantity > hi then
    raise exception '%: please order between % and % (you have %).', coalesce(p.name, 'This item'), lo, hi, new.quantity using errcode = '22023';
  end if;
  return new;
end $$;
revoke all on function private.order_item_qty_limit() from public;
drop trigger if exists order_items_qty_limit on public.order_items;
create trigger order_items_qty_limit before insert on public.order_items for each row execute function private.order_item_qty_limit();

-- 2. fondant or frosting (patch the current bento_design in place; nothing else in it changes)
do $patch$
declare def text := pg_get_functiondef('private.bento_design(public.products, jsonb)'::regprocedure); n integer;
begin
  if position('coat text :=' in def) > 0 then raise notice 'bento_design already has the coat choice.'; return; end if;
  n := (length(def) - length(replace(def, 'color_code text := custom->>''frosting_color'';', ''))) / length('color_code text := custom->>''frosting_color'';');
  if n <> 1 then raise exception 'bento_design is not the expected version (frosting colour line found % times); nothing changed.', n; end if;
  def := replace(def, 'color_code text := custom->>''frosting_color'';',
    'color_code text := custom->>''frosting_color'';' || E'\n  coat text := case when custom->>''coat'' = ''frosting'' then ''frosting'' else ''fondant'' end;');
  n := (length(def) - length(replace(def, 'parts := parts || (opt.label || '' frosting'');', ''))) / length('parts := parts || (opt.label || '' frosting'');');
  if n <> 1 then raise exception 'bento_design summary line found % times; nothing changed.', n; end if;
  def := replace(def, 'parts := parts || (opt.label || '' frosting'');', 'parts := parts || (opt.label || '' '' || coat);');
  n := (length(def) - length(replace(def, '''frosting_color'', color_code, ''frosting_color_label'', frosting_label,', ''))) / length('''frosting_color'', color_code, ''frosting_color_label'', frosting_label,');
  if n <> 1 then raise exception 'bento_design saved-design line found % times; nothing changed.', n; end if;
  def := replace(def, '''frosting_color'', color_code, ''frosting_color_label'', frosting_label,', '''coat'', coat, ''frosting_color'', color_code, ''frosting_color_label'', frosting_label,');
  execute def;
end $patch$;

commit;
notify pgrst, 'reload schema';
