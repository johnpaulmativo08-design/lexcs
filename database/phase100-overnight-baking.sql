-- Phase 100 · Overnight baking: the shift may start the evening before.
--
-- Why: for a big order picked up in the morning, the owner starts baking the night before (for example 11 PM until
-- 4 AM). Phase 97 packs each day's bakes backwards from their deadlines; a bake that has to start before midnight
-- already comes out as a negative minute (−60 = 11:00 PM the day before), but the shift could only start at 0 or
-- later, so those bakes were flagged "doesn't fit".
--
-- What it does: lets production_settings.bake_start_minutes go below 0 (down to −720 = 12:00 PM the day before) and
-- moves the shift start to −360 = 6:00 PM the evening before. The shift end (4:30 PM) and the 1-hour lead stay.
-- Admin → Production draws the day from 12:00 AM to 11:59 PM, so a bake for tomorrow morning that starts tonight
-- shows on tonight's track, and continues on tomorrow's.
--
-- What it does NOT do: change orders, payments, capacity or prep times. Warnings only, nothing is blocked (as
-- phase 97). To go back to a 4:00 AM start: update public.production_settings set bake_start_minutes = 240;
-- Needs phase 97. Safe to re-run.
begin;

alter table public.production_settings drop constraint if exists production_settings_bake_start_minutes_check;
alter table public.production_settings add constraint production_settings_bake_start_minutes_check
  check (bake_start_minutes between -720 and 1439);
update public.production_settings set bake_start_minutes = -360, updated_at = now() where id and bake_start_minutes = 240;

commit;
notify pgrst, 'reload schema';
