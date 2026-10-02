# Recipe-based inventory — LexC's Snacktime

Materials are deducted automatically, once, when an order is **both** payment-verified and accepted.
Every change is a permanent ledger row linked to its order, recipe version, batch and Admin.

## 1. Go live (one-time)

1. Open the Supabase dashboard → **SQL Editor** for the LexC project.
2. Paste and run `database/phase20-recipe-inventory.sql` (after phases 2–19, which are already live).
   The script is safe to re-run. It never changes existing stock, batches or movements.
3. Reload the Admin (`/admin/`). Inventory now has **Materials · History · Recipes · Batches**.
4. In **Inventory → Recipes**, work through the "Needs review" list (section 4). **No order deducts
   anything until a recipe is active.**

## 2. When stock is deducted

| Situation | What happens |
|---|---|
| Customer uploads a payment screenshot | Nothing. `verification_pending` never deducts. |
| Admin verifies the payment, order still **pending** | Nothing yet. |
| Admin clicks **Confirm order** on a payment-verified order | Materials are deducted in the same database transaction. |
| Order already confirmed, Admin then verifies the payment | Materials are deducted during the payment approval. |
| Stock is short when the Admin **confirms** | Confirmation is blocked and nothing is deducted. The order dialog shows *Insufficient materials* with Required / Available / Shortage and Review / Restock / Return buttons. |
| Stock is short when a payment is **approved** | The payment is still saved (it's real money). The order shows *Insufficient materials* with **Retry allocation**, and production (Mark preparing) is blocked until it succeeds. |
| Page refresh, repeated clicks, repeated payment reviews | Nothing is deducted twice. There is one allocation per order (unique key), plus a unique ledger key per batch. |
| Two Admins confirm orders at the same time | Material rows are locked in a fixed order. The second confirmation waits, re-checks stock and is refused if it would go negative. |
| Order cancelled while **confirmed** (production not started) | Materials return to the same batches as new *Reversal* rows. The originals are kept. |
| Order cancelled while **preparing/ready** | Materials are treated as used (*Consumed*). An Admin can return them with a mandatory reason. |
| Product has no active recipe, or is a package | The line is listed under *Needs manual material review*. The rest of the order is still deducted. Use **Record extra materials** on the order. |
| Custom order with a reference image | Recipe materials are deducted, and the line is flagged so decoration extras get recorded manually. |

This all runs in the `orders_inventory_sync` database trigger, never in the browser. The order dialog's
"Confirming this order will allocate…" preview is only informational: the server recalculates at confirmation.

## 3. How quantities are calculated

- Each recipe has a **batch yield** (e.g. Caramel Bar = 16 pcs). **Pieces per option** says how many pieces one
  ordered option contains (e.g. the 12pcs box = 12).
- Line scaling:
  - **Per batch** — quantity × pieces ÷ yield. Example: flour 120 g × 12 ÷ 16 = 90 g.
  - **Per piece** — for liners, sticks, icing per cupcake.
  - **Per ordered box/option** — for boxes, stickers, ribbons. Lines can be limited to specific options, e.g. the 12-pc box only for "12pcs".
- **Whole units** rounding per line, and a recipe-level **Whole batches only** mode, exist for eggs and batch-only products.
- Identical materials across all products in an order are added together, then deducted once, earliest-expiring batch first.
- Precision: calculations keep full precision. The deduction is rounded **up** to 0.001 of the stock unit (1 g for a kg item), so stock is never under-counted.
- Units convert automatically only within the same type (g↔kg, mL↔L, cm↔yard). Anything else needs an explicit, **verified**
  per-material conversion (Recipes → Unit conversions). Example: butter stocked in pieces, 1 g = 1/225 pc.
- Editing a recipe creates a **new version**. Orders already deducted keep their own recorded lines.

## 4. What was imported from the costing spreadsheets

14 recipes were created as **drafts**. Materials were matched to existing items by name. Aliases such as
"All-Purpose Flour", "AP Flour" and "Canola Oil" map to the existing items. 28 missing materials (chocolate chips,
boxes, liners, stickers…) were created with **zero stock**. Spreadsheet purchase quantities were used only for the
estimated unit cost, never as stock.

| Recipe | Linked product | Yield | Main items to review |
|---|---|---|---|
| Chocolate Cupcake — Mini (3/4 oz) | Mini Cupcakes | 36 | oil/vinegar/milk measured in g but stocked in mL; 25/36-pc boxes assumed from the donut sheet; no 48-pc box |
| Chocolate Cupcake — 3 oz | 3oz Cupcake | 14 | same unit issues |
| Cupcake Bouquet | Cupcake Bouquet | 14 | bouquet wrapping has no per-bouquet quantities |
| Custom Cupcake (chocolate base) | Custom Cupcake | 14 | no vanilla cupcake sheet; pieces per order set to 1 |
| Yema Cake — Bento | Yema Cake – Bento Size | 6 | sauce share (60 g of ~1,000 g) is an estimate |
| Chocolate Chip Cookies — Regular / Bite-Sized / Palm | Chunky Cookies (3 products) | 21 / 66 / 8 | 30-pc box and palm-size boxes not in the sheet |
| Caramel Bar | Caramel Bar | 16 | butter g → pieces conversion |
| Premium Mini Donuts (3 recipes) | Mini Donuts products | 24 | sheet costs **every** flavor and topping per donut; confirm the real mix |
| Oatmeal Cookies, Cake Pop | *not linked* | 21 / 46 | no matching product in the catalog |

Conversions imported as **unverified**: butter (225 g block), vanilla (1 L ≈ 800 g) and oil (2 L ≈ 1,800 g).
None were invented for milk or vinegar. Set them in the recipe editor, or change those lines to mL.

**Review workflow:** open a recipe, then fix or confirm each flagged line and tick *Reviewed*. Click a conversion pill
to verify it, check **Preview material requirements**, then **Save & activate**. Activation is refused while any
flag, unverified conversion, missing product link or missing pieces-per-option remains.

## 5. Admin screens

- **Materials** — summary (total / low / out / expiring), search and filters, and a table (cards on phones).
  The detail drawer shows current stock, minimum, expiry, batches, recent activity, order deductions and recipes,
  plus **Add stock**, **Adjust stock** (reason required: correction, wastage or expiry write-off) and **Settings**
  (minimum stock, cost).
- **History** — full ledger with Orders / Restocks / Adjustments / Reversals / Wastage / Expiry filters, plus material,
  product, order # and date range. It shows before → change → after, links to orders, and has **Export CSV**.
- **Recipes** — review queue, versioned editor, requirement preview and unit conversions.
- **Batches** — the previous batch screen (Ingredients / Packaging / Archive & expired), unchanged.
- **Orders → View** — new **Inventory consumption** section: status, deduction date, movement reference, recipe
  version, trigger, per-product breakdown, full ledger rows, extra materials, retry and reversal.

## 6. Database objects (phase 20)

Tables: `measurement_units`, `inventory_item_aliases`, `inventory_unit_conversions`, `product_recipes`,
`recipe_variant_units`, `recipe_lines`, `order_inventory_allocations`, `order_inventory_allocation_lines`.
`inventory_movements` gains `item_id, order_id, order_item_id, allocation_id, recipe_id, stock_before, stock_after,
actor_kind`, plus the types `order_deduction`, `order_extra` and `order_reversal`. Ledger rows can no longer be
updated or deleted.

Admin-only RPCs: `inventory_overview`, `inventory_item_detail`, `inventory_history`, `adjust_inventory_item`,
`save_inventory_item_settings`, `recipe_catalog`, `save_recipe`, `set_recipe_status`, `preview_recipe`,
`save_unit_conversion`, `order_inventory_detail`, `allocate_order_inventory`, `reverse_order_inventory`,
`record_order_extra_material`. All of them check `private.is_admin()`. The new tables are readable only by Admins,
and customers have no write path.

## 7. Testing locally (never against Supabase)

`database/tests/` contains a Supabase stand-in and the acceptance suite (46 checks covering spec tests 1–3 and
5–10, plus security). To run them, build a **disposable** PostgreSQL database:

1. Run `local-supabase-stub.sql`.
2. Run phases 2–19. Insert Admin `…0a` and customer `…0c` into `auth.users` before phase 4, then promote `…0a` to Admin.
3. Run phase 20.
4. Run `phase20-acceptance.sql`.

Test 4 (concurrent confirmations) was run with two simultaneous sessions. Result: one order was deducted, and the
other was refused with a shortage, without going negative.
