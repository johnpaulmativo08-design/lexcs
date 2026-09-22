# Admin and customer authentication update

## 1. Admin login

Open http://127.0.0.1:8000/admin/login.html while the local server runs.

- Email: `admin@lexcsnacktime.local`
- Password: `Admin123!`
- Identity: LexC Administrator / Administrator
- Credentials and guard: `admin/auth.js`.
- Session: `sessionStorage.admin_logged_in`, separate from customer state.
- Correct login opens `admin/#dashboard`; wrong credentials stay on login with an accessible error.
- The entry page, hash changes and browser page restoration check the guard. Logout removes the flag and replaces the URL with login.
- This is a browser-only development gate; files remain publicly accessible and the flag can be edited by the browser user.

## 2. Customer authentication

Home, shop, details, packages and cart stay public. The existing `navigate('checkout')` now sends guests to the existing login interface and remembers the checkout intent. Switching between login and registration retains that intent. Successful login or registration resumes checkout; a normal login returns Home.

Existing accounts remain in `localStorage.lexc_users`, with the same development password format. Login accepts email or the existing name-based login. Registration checks required fields, email format, duplicate email, password length and confirmation, then signs in immediately. Invalid credentials leave the interface and cart intact.

`sessionStorage.customer_logged_in` and `sessionStorage.lexc_customer_user` hold the customer session. The old persistent `lexc_current_user` key is no longer accepted as a session. Remember email/name saves only the identifier in `lexc_login_hint`, not a password or persistent login. Logout clears customer session state without affecting Admin.

Cart objects, quantities, custom fields, prices and totals are not replaced during authentication. The pre-existing cart is still in memory: a full customer page reload still loses it. No cart persistence architecture was introduced.

## 3. Customer design findings

Sources: customer inline CSS plus rendered computed styles at 1440×1000. Machine-readable evidence: `admin/verification/customer-design.json` (rules and computed styles) and `customer-expanded.json` (active Home, shop, login and gallery measurements). Dimensions below are CSS values unless marked measured. Hidden-screen measurements of zero in the first audit are not design dimensions.

### Typography

The customer requests DM Sans 300/400/500/600, Playfair Display 400/700 and italic 400, Cormorant Garamond 300 and italic 300/500, and Nunito 300/400/600/700/800. Some rules request 700 for DM Sans despite the original import not listing that weight. Generic sans-serif/serif and monospace fallbacks also exist, with monospace used by customizer status chips. Admin uses DM Sans for operational text and Playfair Display for headings; it requests its used weights explicitly.

The automated browser did not load the remote font faces (`document.fonts` was empty). Computed font-family values describe the requested stack; screenshots used fallback glyphs. Exact downloaded-font rendering is unverified. No customer font request was changed.

| Actual text role | Family | Size | Weight | Line height | Letter spacing |
| --- | --- | --- | --- | --- | --- |
| Body | DM Sans | 16px | 400 | normal | normal |
| Navigation | DM Sans | 13.12px | 500 | normal | .06em / .7872px; uppercase |
| Home hero heading | Playfair Display | 35.2px | 700 | 1.2 / 42.24px | normal |
| Hero tagline | DM Sans | 15.2px | 400 | 1.7 / 25.84px | normal |
| Home baked heading | Playfair Display | 28.8px | 700 | normal | normal |
| Section heading | Playfair Display | clamp(28.8px,3.5vw,41.6px) | 700 | 1.2 | normal |
| Page heading | Playfair Display | clamp(35.2px,5vw,56px) | 700 | normal | normal |
| Product name | Playfair Display | 16.32px | 700 | normal | normal |
| Product description | DM Sans | 11.68px | 400 | 1.5 / 17.52px | normal |
| Product price | DM Sans | 14.4px | 700 | normal | normal |
| Hero shop button | Nunito | 13.6px | 800 | normal | .05em / .68px; uppercase |
| Primary button | DM Sans | 13.12px | 600 | normal | .06em; uppercase |
| Login heading | Playfair Display | 32px | 700 | normal | normal |
| Form label | DM Sans | 11.52px | 700 | normal | .09em; uppercase |
| Input | DM Sans | 14.72px | 400 | normal | normal |
| Login button | DM Sans | 14.4px | 700 | normal | .04em |
| Section label | DM Sans | 11.2px | 700 | normal | .18em; uppercase |
| Product badge | DM Sans | 9.28px | 700 | normal | .08em; uppercase |
| Invoice table heading | DM Sans | 11.52px | 700 | normal | .1em; uppercase |

The old `.hero-h1`, `.hero-sub` and `.footer-desc` rules have no matching elements in the rendered Home. They were not used as the active hero/footer reference. Recurring body copy uses 1.5–1.85 line height; many controls use `normal`, not an explicit numeric line height. Navigation removes underlines, authentication links underline on hover, and selected navigation uses an animated underline.

### Colors, fills and effects

| Token / purpose | HEX | RGB |
| --- | --- | --- |
| Plum / primary | #5c3d6e | 92,61,110 |
| Lavender / borders | #c3b2d7 | 195,178,215 |
| Lilac / soft backgrounds | #e8dff5 | 232,223,245 |
| Cream / page and input | #fdf8f2 | 253,248,242 |
| Blush / decorative | #f5d9e8 | 245,217,232 |
| Gold / accent | #c9a85c | 201,168,92 |
| Dark / button hover | #1e1218 | 30,18,24 |
| Text | #3a2840 | 58,40,64 |
| Mid / secondary | #7a5d8a | 122,93,138 |
| Surface | #ffffff | 255,255,255 |
| Customer error text / fill / border | #c0392b / #fde8e8 / #f5b8b8 | 192,57,43 / 253,232,232 / 245,184,184 |
| Customer success text / fill / border | #2e7d32 / #e8f5e9 / #a5d6a7 | 46,125,50 / 232,245,233 / 165,214,167 |

Regular borders: 1px solid rgba(195,178,215,.35), sometimes .2/.25/.4. Auth inputs: 1.5px solid rgba(195,178,215,.55). Primary outline: 1.5px solid plum. Header fill: rgba(253,248,242,.97), backdrop blur 14px. Hero card: rgba(143,118,168,.88), blur 8px, heading white; tagline opacity .88 and small line .65. Gallery uses a dark treatment, including rgba white text and a plum blur of 80px at .18 opacity.

Actual gradients include the hero image overlay (black .28→.1, downward), package cards (145deg: #f8eef6→#f0e0f5, #e8e0f8→#ddd0f5, #f8f4e0→#f5edbb), shop image placeholders (135deg lilac→blush), and page hero (135deg lilac at 0%→cream at 60%). The active Home hero is a photograph with overlay, not the unused old `.hero-right` gradient.

Shadows: product `0 4px 20px rgba(92,61,110,.07)`; hover `0 14px 40px rgba(92,61,110,.17)`; checkout summary `0 4px 24px rgba(92,61,110,.1)`; package `0 4px 30px rgba(92,61,110,.1)`; primary button `0 4px 20px rgba(92,61,110,.3)`; hero card `0 12px 50px rgba(0,0,0,.28)`; date dialog `0 20px 60px rgba(92,61,110,.22)`; focus ring `0 0 0 3px rgba(92,61,110,.12)`. No universal inner-shadow or text-shadow token exists.

The customer has several similar muted colors (#7a5d8a, #7a6488, #9880a8, #6a5478). Admin keeps plum dominant and uses a darker muted #705c7c for small operational text, rather than reproducing the low-contrast product description shade. Warning is an Admin semantic adaptation (#805313 on #fff3e0), not a claimed customer token. Brand gold is not used as small white-on-gold operational text.

### Dimensions, spacing and behavior

- Header: fixed, 70px high, horizontal padding 5vw (72px at 1440), navigation gap 32px; rendered logo about 46×46px. No Admin-style navigation sidebar exists on Customer Home, but Shop does have a 240px filter column, sticky at 90px.
- Containers: sections commonly use 7vw padding; shop grid is `240px 1fr`, gap 48px, padding 50px 7vw 80px; product grid auto-fills minimum 200px columns with 22.4px gaps. Checkout max-width 1080px; invoice 760px; FAQ 700px; auth card 400px. There is no single universal max-width.
- Hero card: max-width 440px, padding 50px 52px, radius 20px; measured 440×323.55px using fallback fonts. Mobile padding 36px 24px, margin 0 16px; heading becomes 26.4px.
- Cards: product radius 20px, image 1:1, body padding 14px 16px 18px. Packages radius 24px and padding 28px 24px. Gallery images use radius 16px, masonry columns `4 200px` and gap 12px; images scale/crop according to existing image rules. Card heights depend on content.
- Buttons: primary 14px 32px padding and 100px radius; outline 13px 28px; hero shop 12px 36px, measured 117.03×43px with fallback fonts. Auth button full-width, padding 14px, radius 12px. Add icon 30×30px with circular radius. Hover darkens primary and translates it -2px.
- Inputs: auth full-width, 13px 16px padding, radius 12px. Select 8px 14px, radius 10px. Focus uses plum border and .12 plum ring. Placeholders inherit the input stack with browser-default placeholder presentation unless explicitly overridden.
- Tables DO exist: invoice table headers pad 10px 14px, rows 9px 14px, with .2 lavender dividers and #fdfaff alternating rows. No fixed row height: content plus padding determines it. Admin uses 14px body text and 16px 20px cell padding for readability.
- Repeated spacing includes 4, 6, 8, 10, 12, 14, 16, 20, 22, 24, 28, 32px plus rem/vw sizes; it is not a strict 8px system.
- Breakpoints include 900px, 760px, 600px and the date dialog's 560px breakpoint. At 900px Shop drops the filter/content split; auth and checkout stack at 760px; Home/footer/package rules adapt at 900/600px. The customer 3D customizer has its own responsive rules.
- Icons are a mixture of raster images, emoji and text symbols; product photos remain mapped by the existing catalog. No replacement product photos were invented.

## 4. Admin improvements

The active Admin is the root `admin/` folder, using ES modules, hash routes and common rendering helpers. The nested `MARK-project/` directory and ZIP are older snapshots, not the source running at `/admin/`. No backend, database, framework migration or dependencies were introduced.

| Area | Change and relation to Customer |
| --- | --- |
| Shell | 232px light sidebar, 70px cream header, plum/lilac active state, compact navigation and actual development-account identity. Shared Customer color variables replace the old separate palette. |
| Dashboard | Proportioned metric cards, softer panels, readable calendar, consistent headings and correct left/right calendar arrows. Existing calendar behavior preserved. Unavailable metrics remain dashes. |
| Inventory / Restock | Shared search/control/table presentation, readable cells and empty states. Terminology Healthy / Low / Out of Stock. No stock is incorrectly called Archived. Existing routes preserved. |
| Products / Packages | Preserved 25 records, photographs, variant prices and three packages. Customer-like square images, rounded cards, serif names, category captions and stronger prices. Existing search/filter retained. Added keyboard-accessible View details dialog. |
| Orders | Consistent column structure and Current Orders / Order History views. Status vocabulary is Pending, Confirmed, Preparing, Ready, Completed, Cancelled. Empty views remain empty; no synthetic order history. |
| Reports / Transactions / Revenue | Shared metric, panel and table styling; existing report routes and browser print action retained. No fake data, charts or export implementation. |
| Gallery | Clear review heading and Visible/Hidden terminology. Explicitly separates curated customer photos from unavailable submitted reviews. |
| Profile / Password | Customer-style labels/inputs/cards and accurate account identity. Saving/changing the fixed development account remains unavailable and explained. |
| Shared interactions | Native dialog with accessible title, Escape, focus restoration and backdrop dismissal. Mobile navigation has focus containment and offscreen controls are inert; collapsed desktop links retain accessible names. |

Desktop widths 1440/1366/1280/1024 take priority. Sidebar becomes a drawer at 800px; cards and dashboard sections wrap; profile stacks; wide tables scroll in their own container. No arbitrary mobile redesign.

## 5. Files

Created: `shared/brand.css`; `admin/auth.js`; `admin/login.html`; `admin/login.js`; `admin/auth-verify.cjs`; `admin/customer-verify.cjs`; `admin/design-audit.cjs`; `admin/regression-verify.cjs`; this report; generated `admin/verification/` JSON and screenshots.

Modified: `index.html`; `admin/index.html`; `admin/app.js`; `admin/admin.css`; `admin/components.js`; `admin/pages/products.js`; `admin/pages/inventory.js`; `admin/pages/orders.js`; `admin/pages/gallery.js`; `admin/pages/profile.js`; `admin/verify.cjs`; `RUNNING.md`.

No files removed. Removed two missing customer script references, not script files. Existing assets, legacy files, catalog data, ZIP and nested export were preserved.

## 6. Verification

PASS: Admin direct-route guards across all tested modules and subroutes; wrong credentials stay on login; correct credentials open Dashboard; refresh retains access; logout clears access; reentry requires login. Admin login does not grant Customer checkout access, and Customer login does not grant Admin access.

PASS: public Home/shop/cart, 25 products, checkout redirect, failed login, successful registration and email login resume checkout; full cart objects, quantity and price survive auth; logged-in checkout bypasses auth; keyboard submission.

PASS: existing Admin route navigation, search, category filtering, variant pricing, three packages, calendar controls, product details dialog, Escape, mobile navigation, and no document overflow across all Admin pages at 1440/1366/1280/1024/768/390px.

PASS: no JavaScript page errors in the tested flows or Admin HTTP error responses. Customer computed styles unchanged after shared-token extraction. Before/after Home and shop screenshots are byte-for-byte identical (matching SHA256 hashes); Home also compared visually. Desktop and mobile Admin screenshots inspected.

UNVERIFIED: actual remote Google Font loading (font set empty in test browser), all 3D customization assets, and integrations that do not exist. PASS of UI tests is not a claim of production security, backend integration or pixel-perfect rendering.

Commands: `node admin/verify.cjs <playwright-package> admin/verification`, `node admin/auth-verify.cjs <playwright-package>`, `node admin/customer-verify.cjs <playwright-package>`, `node admin/regression-verify.cjs <playwright-package>`. The design audit captures its baseline before changes; don't rerun it before a regression comparison unless intentionally refreshing that baseline.

## 7. Temporary auth warning

Admin and Customer authentication are frontend-only development authentication. Credentials/account passwords can be inspected or changed in browser storage/source. These controls must be replaced with real server-validated authentication and authorization when backend/database development begins.

## 8. Remaining issues

- Product Add/Edit/Archive/Restore, inventory changes, order persistence/status updates, payments/QR, reports, submitted reviews and profile/password saving still have no data service. These were not silently implemented with a second fake database. Related controls remain disabled; product Archive stays inside Products.
- No record pagination or data filtering for empty backend-dependent tables; no dummy records were invented to demonstrate it.
- Known product-photo mismatches/repeated/placeholder images are preserved pending correct source assets.
- Customer cart remains in-memory and password reset remains the existing informational message.
- Remote fonts require connectivity; verified layout used fallbacks. The 3D customizer depends on external libraries and previously missing model files.
- Older ZIP/nested export are stale relative to the live files; regenerate when another export is requested.

## 9. Suggested commit

`feat: add temporary auth and align admin UI with storefront branding`
