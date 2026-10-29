# Pay online with PayMongo — setup (LexC's does these steps)

Customers can pay the downpayment, the full amount, the balance or their own amount with **GCash or QR Ph** on
PayMongo's secure page. PayMongo reports the payment to the site, the order shows **"Paid online · being
confirmed"**, and you still click **Confirm payment** in Admin → Orders, exactly like a QR receipt.

Amounts always come from the order in the database. When you change a price in Admin → Products, new orders (and
their downpayments, balances and online checkouts) use the new price; orders already placed keep their price.

Never paste a PayMongo key into the website, the repository or a chat. Keys only go into Supabase secrets (step 3).

## 1. PayMongo account
1. Sign up at paymongo.com and finish the business verification they ask for.
2. Stay in **Test mode** until a test payment works (step 6).

## 2. Deploy the two Edge Functions (Supabase CLI, from this project folder)
```
supabase login
supabase link --project-ref jruoqutpflfvkshtyyhs
supabase functions deploy paymongo-checkout
supabase functions deploy paymongo-webhook --no-verify-jwt
```
`--no-verify-jwt` is only for the webhook: PayMongo cannot sign in, so the function checks PayMongo's signature instead.

## 3. Secrets (Supabase dashboard → Edge Functions → Secrets)
| Name | Value |
|---|---|
| `PAYMONGO_SECRET_KEY` | PayMongo dashboard → Developers → API keys → **secret** key (`sk_test_…` first, later `sk_live_…`) |
| `PAYMONGO_RETURN_ORIGINS` | `https://johnpaulmativo08-design.github.io,http://127.0.0.1:8000,http://localhost:8000` (every address the site is opened at; add your own domain later). A missing one shows "Invalid return page." |
| `PAYMONGO_WEBHOOK_SECRET` | from step 4 (`whsk_…`) |

## 4. Webhook (PayMongo dashboard → Developers → Webhooks → Create)
- URL: `https://jruoqutpflfvkshtyyhs.supabase.co/functions/v1/paymongo-webhook`
- Event: `checkout_session.payment.paid`
- Copy its secret key into `PAYMONGO_WEBHOOK_SECRET` (step 3).

## 5. Switch the method on (Supabase SQL editor)
```sql
update public.payment_methods set active = true where code = 'paymongo';
```
(`active = false` hides it again at any time.)

## 6. Test, then go live
1. Place an order, confirm it in Admin, and on the payment page choose **Pay online (GCash / QR Ph)**.
2. Pay on PayMongo's test page. Back on the site, the order should show **"Payment received · waiting for LexC's to
   confirm"** within a few seconds, and Admin → Orders shows **Paid online (PayMongo)** with the PayMongo payment id.
3. Confirm it in Admin like any payment.
4. When it works, replace `PAYMONGO_SECRET_KEY` with the live key, create the same webhook in **Live mode**, and put
   its secret in `PAYMONGO_WEBHOOK_SECRET`.

PayMongo charges a fee per payment (taken from what they pay out to you); check their pricing page.
