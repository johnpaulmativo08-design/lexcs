# Supabase Phase 2 — implementation and verification
Updated: 2026-09-14. Project: `jruoqutpflfvkshtyyhs`.

**Core backend and frontend cutover implemented. Email onboarding/recovery verification is blocked on dashboard sign-in and a real email address. This is not a production-readiness certification.**

## Architecture and migrations
Existing static Customer/Admin pages now connect directly to Supabase Auth, Postgres and Storage. No separate application backend server, payment processor, QR, or service-role key was added. Port 8000 is the static preview.

| Hosted version | Migration | Local operation record |
| --- | --- | --- |
| 20260913195208 | lexc_schema_auth_and_rls | database/phase2-foundation.sql |
| 20260913195436 | lexc_atomic_operations_and_storage | database/phase2-operations.sql |
| 20260913195709 | lexc_existing_catalog_seed | database/phase2-catalog-seed.sql |
| 20260913200429 | lexc_explicit_rpc_grants | database/phase2-explicit-grants.sql |
| 20260913202136 | lexc_atomic_product_management | database/phase2-product-management.sql |

These files document already-applied hosted operations, not CLI timestamp migration files. Do not rerun blindly.

## Tables and relationships
- profiles: one per Auth user, FK to auth.users.
- user_roles: protected role per profile; new users receive customer, never a role from editable metadata.
- categories → products → product_variants: live prices, packages and customization configuration.
- inventory_items → inventory_batches → inventory_movements: append-only stock ledger; security-invoker inventory_stock view.
- availability_slots → orders: nonoverlapping receiving windows, capacity and locked reservation checks.
- profiles → orders → order_items: private ownership and historical item/price/customization/reference snapshots.
- reviews: unique completed-order review; composite order/customer FK.
- gallery_entries: curated visible/hidden gallery.

All 13 public tables have RLS. Required indexes, foreign keys, uniqueness/check constraints, timestamps and profile-creation triggers are deployed.

## Auth and authorization
- One Supabase Auth client/session for both interfaces; getUser plus protected role lookup.
- Development Admin exists: `admin@lexcsnacktime.local`, role admin. Requested password verified, not stored in frontend source. Replace the weak development credential before production.
- Two confirmed .local development customers were created through the official Auth dashboard for isolation testing.
- Guest cart persists locally. Checkout remembers intent and resumes after sign-in.
- Real signup/recovery handlers are implemented, but email delivery, confirmation, recovery and redirect allowlisting are not verified. The Supabase dashboard session expired before the final configuration check.
- Frontend Admin guards are supplementary; Postgres and Storage enforce permissions.

## RLS and operations
Public visitors can browse active catalog/visible gallery, safe slot availability and approved review projection without private user/order IDs.
Customers can access permitted own profile fields, own role/orders/items. They cannot assign roles, directly insert/update orders or change payment fields.
Admins manage catalog, inventory, scheduling, orders and gallery/review visibility.

RPCs: create_order, get_availability, save_slot, set_order_status, record_inventory, submit_review, get_public_reviews, save_product.
Public wrappers use security-invoker. Private privileged helpers have empty search paths and explicit auth/permission checks; guest execute grants are removed where required.
Checkout uses server prices, snapshots, idempotency and row locks. Orders remain unpaid; unknown delivery fees/totals remain unquoted. Stock cannot go negative. Review submission requires the owner's completed order and resets visibility to hidden.

## Storage
| Bucket | Access |
| --- | --- |
| catalog-media | Public read; Admin upload to controlled product/gallery paths |
| customer-references | Private owner upload/read, Admin read |
| review-images | Private by default; owner/Admin and explicit approved-review access |
| avatars | Private owner/Admin |

JPEG/PNG/WebP, 5 MB, immutable UUID filenames. No broad overwrite/delete permissions.
All 25 standard-product images uploaded and linked. Original gallery URLs preserved, including pre-existing image/label mismatches.

## Files and reuse
Created:
- shared/supabase-config.js, shared/supabase-client.js, shared/customer-backend.js, shared/vendor/supabase.js.
- admin/backend-ui.js, admin/dashboard-data.js.
- Five SQL records above.
- package.json, package-lock.json, .gitignore, .env.example.
- scripts/configure-supabase.cjs, check-supabase.cjs, check-static.cjs, verify-integration.cjs, upload-catalog-images.cjs, read-legacy-catalog.cjs.

Modified during cutover:
- index.html: Auth, cart, checkout/invoice, receiving state, escaping, recovery form, real published reviews and click/keyboard account menu.
- admin/auth.js, login.js, login.html, index.html, app.js, components.js.
- admin/pages/dashboard.js, products.js, inventory.js, orders.js, gallery.js, profile.js, reports.js.
- admin/auth-verify.cjs and admin/verify.cjs: removed hardcoded password; these older tests are not the current Supabase test suite.

Preserved/reused existing layout/CSS/assets, sidebar, table/dialog styles, catalog image fallback, customer 3D controls and business flow. No Figma redesign.
Removed active temporary credential/user-store auth, local invoice-only checkout, fake availability constants, duplicate obsolete cart/customizer handlers and sample testimonials.
Historical exports remain untouched and must not be deployed as the secure version.

## PASS / blocked results
| Test | Result |
| --- | --- |
| Syntax | PASS: 29 JS/CJS files and 3 nonempty inline scripts including module syntax; npm run check:static |
| Public API regression | PASS: all 12 checks via npm run check:backend after cleanup |
| Public catalog | PASS: 8 categories, 29 products, 55 variants, 14 gallery entries, 25 standard images |
| Auth/roles | PASS: real Admin and two real customers; customer denied by Admin UI |
| Email signup/confirmation/recovery | BLOCKED: dashboard sign-in and real email required; .local rejection is not signup success |
| Guest cart/checkout intent | PASS browser: persists through sign-in/logout/reload; returns to checkout |
| Saved checkout | PASS browser: live slot, saved order #2, unpaid invoice, cart cleared only after save |
| Order privacy | PASS two real customers: other customer's orders/items unavailable |
| Privilege escalation | PASS: editable metadata does not elevate; role writes rejected |
| Price integrity | PASS: supplied zero price ignored; server variant price used |
| Slot concurrency | PASS: two customers competing for one slot, exactly one accepted |
| Idempotency/customization | PASS rolled-back authenticated SQL test: same request same order, valid snapshots/reference preserved, invalid frosting rejected, delivery total null |
| Products | PASS API atomic product/variant creation/archive and customer write denial; UI navigation checked |
| Inventory | PASS API receipt and negative stock denial; page rendered |
| Orders | PASS Admin status transitions, customer status-write denial; pages rendered |
| Private uploads | PASS API owner upload/read, guest/other/cross-folder denial; not full browser file-picker coverage |
| Reviews/gallery | PASS API ownership/moderation/public projection; pages rendered; public empty state checked |
| Scheduling | PASS browser slot creation and API capacity checks |
| Profile/reports | Pages rendered and real data connected; password-change submission not tested |
| Responsive smoke test | Admin desktop and 375px content width checked; mobile menu reaches Products. Customer home/account menu checked at 624px content width |
| Runtime | Earlier startup error fixed; no new errors observed in final inspected pages, not every interaction |
| RLS | PASS 13 enabled, zero public tables without RLS |
| Security advisor | No database/RLS findings; one Auth warning: leaked-password protection disabled |
| Dependency audit | Zero vulnerabilities at installation; Supabase JS pinned to 2.116.0 |

The integration script writes labelled development fixtures and requires environment credentials. It does not automatically clean fixtures. Do not run it against production or save credentials under the static server root.

## Cleanup and limitations
Removed exact verified test IDs: two orders/items, review, one product/variant, stock ledger/batch/item, and two slots. Permanent test-record deletion; no business-data reset and no identity-sequence reset.
Remaining catalog: 29 products. Orders, inventory items and slots: zero after cleanup. Owner must configure real stock and receiving windows.
Two development customer Auth accounts and one tiny private reference-image test object remain; delete permissions were not broadened for cleanup.

Remaining:
1. Sign back into Supabase dashboard; check site URL/local redirects and leaked-password protection availability.
2. Use a real email and open its confirmation link to test registration/recovery. Never share an email password.
3. Owner should change development Admin password before production.
4. Broader browser coverage of every CRUD form, upload picker, password change and smallest mobile viewport is not complete.
5. Revenue remains zero because payments are not implemented. Existing chart/period placeholders do not provide complete analytics.
6. Existing gallery image/label mismatches, static home promotional text/prices and social links were not redesigned.
7. Review photos are stored/moderated but home review cards display text only. No pixel-perfect claim.

## Local run and suggested commit
Customer: http://127.0.0.1:8000/
Admin: http://127.0.0.1:8000/admin/ (redirects to login when not authenticated).

npm ci --ignore-scripts installs the pinned client.
npm run configure reads SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY from environment and creates public config/vendor bundle.
Never place Admin passwords, service-role keys or other secrets in served files.

Suggested commit: `feat: connect customer and admin flows to Supabase Auth, data and RLS`.
This folder is not currently a Git repository. No commit created.
