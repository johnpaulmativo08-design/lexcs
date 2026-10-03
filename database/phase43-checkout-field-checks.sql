-- Phase 43: checkout field checks, enforced by the database for every NEW order (existing orders are not touched).
-- The storefront shows the same rules live under each field; these make sure they cannot be bypassed.
--   * name: at least 2 letters (up to 150 characters)
--   * contact number: a Philippine mobile number, 11 digits starting with 09 (+63 9… is accepted and converted);
--     stored in one tidy format, e.g. "0917 123 4567"
--   * delivery address: at least 10 characters when the order is delivered (not picked up)
--   * notes: up to 1000 characters
-- Errors use code 22023 with a plain message the storefront shows as-is. Safe to re-run.

create or replace function private.check_order_fields() returns trigger
language plpgsql set search_path = '' as $$
declare digits text;
begin
  new.customer_name := btrim(regexp_replace(coalesce(new.customer_name, ''), '\s+', ' ', 'g'));
  if char_length(new.customer_name) > 150 or char_length(regexp_replace(new.customer_name, '[^[:alpha:]]', '', 'g')) < 2 then
    raise exception 'Enter your full name (at least 2 letters).' using errcode = '22023';
  end if;
  digits := regexp_replace(coalesce(new.contact_phone, ''), '[^0-9]', '', 'g');
  if digits ~ '^639[0-9]{9}$' then digits := '0' || substr(digits, 3); end if;
  if digits !~ '^09[0-9]{9}$' then
    raise exception 'Enter a Philippine mobile number: 11 digits starting with 09, like 0917 123 4567.' using errcode = '22023';
  end if;
  new.contact_phone := substr(digits, 1, 4) || ' ' || substr(digits, 5, 3) || ' ' || substr(digits, 8, 4);
  if new.fulfillment_method is distinct from 'pickup' and char_length(btrim(coalesce(new.address, ''))) < 10 then
    raise exception 'Enter the full delivery address: house/unit, street, barangay and city.' using errcode = '22023';
  end if;
  if char_length(coalesce(new.notes, '')) > 1000 then
    raise exception 'Keep the special notes under 1,000 characters.' using errcode = '22023';
  end if;
  return new;
end $$;
revoke all on function private.check_order_fields() from public;

drop trigger if exists orders_check_fields on public.orders;
create trigger orders_check_fields before insert on public.orders
  for each row execute function private.check_order_fields();
