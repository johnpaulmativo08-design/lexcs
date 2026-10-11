-- Phase 56: customer profile page. Customers can keep a delivery address on their profile (name, phone and photo
-- were already editable by the owner). Safe to re-run.
begin;
alter table public.profiles add column if not exists address text;
alter table public.profiles drop constraint if exists profiles_address_length;
alter table public.profiles add constraint profiles_address_length check (address is null or char_length(address) <= 300);
grant update(address) on public.profiles to authenticated;
commit;
