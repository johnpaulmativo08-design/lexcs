-- Phase 65: 3oz Cupcakes no longer offer fondant letters (the "Fondant letters" step is hidden in the cupcake designer).
-- Mini Cupcakes keep them. Turned off, not deleted, so older orders keep their details and Admin can turn it back on
-- in Designer Options. Applied live 2026-10-16. Safe to re-run.
begin;
update public.design_options o set is_active = false
from public.products p
where p.id = o.product_id and p.slug = 'product-6' and o.group_key = 'message' and o.code = 'letters';
commit;
