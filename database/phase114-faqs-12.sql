-- Phase 114: up to 12 FAQs on the website (was 10)
-- -----------------------------------------------------------------------------------------------------------------
-- What this does, in plain words:
--   * The FAQ page can now show up to 12 questions at once. Only the limit changes (10 -> 12); the script check
--     and the "updated at" stamp stay exactly as phase 104 set them.
--   * Nothing else changes: no table, policy or data is touched.
-- Safe to run more than once.

create or replace function private.faq_limit() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.is_active and (select count(*) from public.site_faqs where is_active and id <> new.id) >= 12 then
    raise exception 'Only 12 FAQs can be active. Turn one off first.' using errcode = '22023';
  end if;
  if new.question ~* '<\s*script|javascript:' or new.answer ~* '<\s*script|javascript:' then raise exception 'Scripts aren''t allowed in FAQs.' using errcode = '22023'; end if;
  new.updated_at := now();
  return new;
end $$;
