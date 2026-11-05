# Automatic delivery fee — setup (LexC's does these steps)

At checkout, when a customer pins a Lalamove delivery spot, the site shows:
- whether the spot is inside Pampanga;
- the **driving** distance from the shop (66 Quezon St., Dau);
- the **estimated delivery fee**, worked out from **your own rates**.

The fee is added to the order total and collected with the customer's first payment. You then
book and pay the Lalamove rider yourself.

The fee is an **estimate, not a Lalamove quotation**. Lalamove is not connected to the site. Compare it with what the
Lalamove app charges, and adjust your rates when they drift.

Until you switch rates on (step 4), nothing changes for customers: delivery shows "Paid to the rider", as now.

## 1. Database (Supabase SQL editor)
1. Run all of `database/tests/phase94-rehearsal.sql`. It uses example rates, places pretend orders, and undoes
   everything. The last line must be `ERROR: REHEARSAL REPORT …` with every line `PASS`.
2. Run all of `database/phase94-delivery-fee-quotes.sql` once. It is safe to run again.

## 2. Deploy the Edge Function (Supabase CLI, from this project folder)
```
supabase login
supabase link --project-ref jruoqutpflfvkshtyyhs
supabase functions deploy delivery-quote
```
No secrets are needed. The function gets the driving distance from the public OSRM server
(`https://router.project-osrm.org`). That server is free and needs no key, but it is a demo service with no uptime
guarantee and asks for light use only. If it is down, checkout says the route couldn't be worked out and offers
"Try again". Store Pick-up still works. To use another OSRM server later, add the secret `OSRM_URL` with its address.

## 3. Check it
On the shop, log in, go to checkout, choose Lalamove and pin a spot in Angeles. The box under the map should show
"✓ Within Pampanga", the driving distance, and "Paid to the rider" (rates are still off).

## 4. Enter your rates (Admin → Delivery rates)
Enter rates you have checked in the Lalamove app, for the vehicle you book:
- vehicle;
- base fee, and the distance it includes;
- fee per extra km, and whether a part of a km counts as a whole km;
- minimum fee and rounding;
- the farthest delivery distance;
- optional surcharges for particular towns.

Use **Try the saved rates** to check a few distances. Then tick **Charge delivery fees at checkout** and save.

## How it is protected
- The browser never sets the fee. The Edge Function checks the pin against Pampanga's province border, asks OSRM
  for the driving route, and the database prices it and saves a quote. Customers can read their quotes but not change
  them.
- Checkout sends only the quote's id. The database copies the fee, distance and pin from the saved quote. A quote
  must belong to the customer, be under 2 hours old, and be unused.
- While rates are on, a delivery order without a valid quote is refused.
- Each order keeps the rate that was used (`delivery_pricing`), so changing rates later never changes old orders.
  Admin → Orders shows the fee, the distance and how it was worked out.

## Real Lalamove prices (phase 98)

Instead of your own rates, checkout can ask **Lalamove itself** for the price of a rider from the shop to the
customer's pin. A quotation is free and books nothing; you still book and pay the rider in the Lalamove app. The
price can change by the time you book (traffic, time of day), so compare it in Admin → Orders.

1. **Database:** run all of `database/phase98-lalamove-quotations.sql` once in the Supabase SQL editor (after phase 94).
2. **Keys:** in Supabase → Edge Functions → **Secrets**, add
   - `LALAMOVE_API_KEY` — your API key from the Lalamove Partner Portal (`pk_prod_…` for live, `pk_test_…` for sandbox);
   - `LALAMOVE_API_SECRET` — its secret (`sk_prod_…` / `sk_test_…`).
   Never put these in the site files, in chat, or in GitHub. Production keys use `rest.lalamove.com`, sandbox keys
   `rest.sandbox.lalamove.com`; the optional secret `LALAMOVE_ENV` (`production` / `sandbox`) overrides that.
3. **Deploy** the function again (`supabase functions deploy delivery-quote`), so it has the Lalamove code.
4. **Admin → Delivery rates:** set *Delivery fee* to **Lalamove quotation**, pick the vehicle, tick
   **Charge delivery fees at checkout**, and save. The farthest-delivery limit still applies.
5. **Check:** at checkout choose Lalamove and pin a spot in Angeles. The box should show **Lalamove delivery fee**.
   If it says "We couldn't get Lalamove's price", open Supabase → Edge Functions → delivery-quote → Logs: Lalamove's
   error id is there (for example `ERR_UNAUTHORIZED` = wrong keys, `ERR_OUT_OF_SERVICE_AREA` = no riders there,
   `ERR_INVALID_SERVICE_TYPE` = that vehicle isn't offered there).

To go back to your own rates, set *Delivery fee* to **My own rates** and save.
