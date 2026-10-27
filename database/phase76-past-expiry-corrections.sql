-- Phase 76 · Allow correcting a batch's expiry to a date that has already passed.
--
-- Why: the owner sometimes finds that a batch actually expired earlier than recorded (or enters an old delivery late).
-- Phase 49's correct_inventory_batch refused any expiry date before today ("That expiry date has already passed…"),
-- so the record could not be made true.
--
-- What it does: removes only that one check from public.correct_inventory_batch. Everything else stays: admin only,
-- a reason is required, the expiry still cannot be before the stock-in date, the stock-in date cannot be in the future,
-- and every correction is written to the batch notes. A batch whose expiry is in the past simply counts as expired
-- (it is skipped by order deductions and shows under Expired), exactly like any other expired batch.
--
-- The live function is patched in place (its text may differ from database/phase49-*.sql); the patch refuses to run
-- unless it finds that check exactly once. Running it again does nothing.
--
-- How to apply: run this whole file once in the Supabase SQL editor.

do $$
declare def text; pat text := 'if new_exp is not null and new_exp < today and new_exp is distinct from b\.expires_on then\s*raise exception ''That expiry date has already passed[^;]*;\s*end if;\s*'; n int;
begin
  def := pg_get_functiondef('public.correct_inventory_batch(jsonb)'::regprocedure);
  if position('That expiry date has already passed' in def) = 0 then raise notice 'Already removed; nothing to do.'; return; end if;
  select count(*) into n from regexp_matches(def, pat, 'g');
  if n <> 1 then raise exception 'correct_inventory_batch is not the expected version; review before applying phase 76.'; end if;
  execute regexp_replace(def, pat, '');
end $$;
