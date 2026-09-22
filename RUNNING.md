# LexC's Snacktime - Supabase setup guide

This package contains the customer storefront, ADMIN interface, Supabase browser
integration, database migration SQL files, local assets, and pinned JavaScript
dependencies needed to run the project on another computer.

## What is included

- Customer app: `index.html`, `index.css`, `index.js`
- ADMIN app: `admin/`
- Shared Supabase/customer data layer: `shared/`
- Supabase SQL reference files: `database/`
- Verification/configuration scripts: `scripts/`
- Pinned dependency definitions: `package.json`, `package-lock.json`
- Public environment template: `.env.example`

The app uses the existing hosted Supabase project. The database, Auth users,
Storage objects, RLS policies, and uploaded files remain in Supabase, not inside
this ZIP.

## Required environment variables

Create a `.env` file in the project root with:

```env
SUPABASE_URL=https://jruoqutpflfvkshtyyhs.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_3qqu1GngzT5ID-ekPCZXYA_Usq7QD4S
```

These are public browser values. Do not put a Supabase secret key or service-role
key in `.env`, `shared/supabase-config.js`, or any frontend file.

## First run on another computer

1. Extract the ZIP.
2. Install Node.js 22 or newer if Node is not installed.
3. Install Python 3 if Python is not installed.
4. Open a terminal in the extracted project folder.
5. Create the `.env` file shown above.
6. Install the pinned dependencies:

```powershell
npm install
```

7. Generate the public browser configuration and local Supabase browser bundle:

```powershell
npm run configure
```

8. Start the local static server:

```powershell
py -m http.server 8000 --bind 127.0.0.1
```

If the Windows `py` launcher is unavailable, use:

```powershell
python -m http.server 8000 --bind 127.0.0.1
```

Open:

- Customer site: `http://127.0.0.1:8000/`
- ADMIN login: `http://127.0.0.1:8000/admin/login.html`
- ADMIN dashboard after login: `http://127.0.0.1:8000/admin/`

Use the existing Supabase ADMIN account credentials you created earlier. They are
not included in this package.

## Supabase dashboard settings to keep in sync

For local development, Supabase Auth should allow the exact local URL you use:

- `http://127.0.0.1:8000/`

If you run on another port or deploy to a live domain, add that exact URL in the
Supabase Auth redirect URL settings. Keep using one consistent host, because
`127.0.0.1` and `localhost` are treated as different origins by browser storage
and Supabase redirects.

## Verification

After configuring the project, run:

```powershell
npm run check:static
npm run check:backend
```

`check:backend` reads the Supabase public configuration and performs permission
checks using the publishable key. It requires internet access.

## Important notes

- This package does not include secret keys, service-role keys, or passwords.
- Browser sessions and guest carts are not included; sign in again on the new
  computer.
- Do not rerun the SQL files against the existing Supabase project unless you
  intentionally want to change the hosted database.
- Payments and PayMongo QR generation are still not implemented in this package.
- Email confirmation and password reset flows depend on the Supabase Auth URL
  configuration for the host/port you are using.
