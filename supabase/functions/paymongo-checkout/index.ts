// Starts a PayMongo payment for one of the signed-in customer's payment attempts:
//   mode 'qrph'     → returns a QR Ph image (data URL) to show on LexC's own payment page (expires in 30 min);
//   mode 'gcash'    → returns GCash's authorization link (opens the GCash app on phones), then back to the page;
//   mode 'checkout' → PayMongo's hosted checkout page (the original flow, kept as a fallback).
// The amount always comes from the database (public.paymongo_checkout_start), never from the browser.
// Secrets (Supabase → Edge Functions → Secrets): PAYMONGO_SECRET_KEY (sk_test_… or sk_live_…),
// PAYMONGO_RETURN_ORIGINS (comma-separated site origins allowed as return pages, e.g.
// https://johnpaulmativo08-design.github.io,http://127.0.0.1:8000).
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization,apikey,x-client-info,content-type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
};
const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  try {
    const authorization = request.headers.get('Authorization') || '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!token) return json({ error: 'Sign in to pay.' }, 401);

    const url = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const secretKey = Deno.env.get('PAYMONGO_SECRET_KEY');
    const origins = (Deno.env.get('PAYMONGO_RETURN_ORIGINS') || '').split(',').map((o) => o.trim()).filter(Boolean);
    if (!url || !anonKey || !serviceKey || !secretKey || !origins.length) return json({ error: 'Online payment is not set up yet.' }, 503);

    const customer = createClient(url, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: auth, error: authError } = await customer.auth.getUser(token);
    if (authError || !auth.user) return json({ error: 'Your session has expired.' }, 401);

    const { paymentId, returnUrl, mode = 'checkout' } = await request.json().catch(() => ({}));
    if (!['checkout', 'qrph', 'gcash'].includes(mode)) return json({ error: 'Choose how to pay.' }, 400);
    if (typeof paymentId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/.test(paymentId)) return json({ error: 'Select a payment first.' }, 400);
    // the customer comes back to the page they paid from, but only on LexC's own site
    let back: URL;
    try { back = new URL(String(returnUrl)); } catch { return json({ error: 'Invalid return page.' }, 400); }
    if (!origins.includes(back.origin)) return json({ error: 'Invalid return page.' }, 400);

    const { data: details, error: detailsError } = await customer.rpc('paymongo_checkout_start', { target_payment: paymentId });
    if (detailsError || !details) return json({ error: detailsError?.message || 'Payment is unavailable.' }, 403);

    const amount = Math.round(Number(details.amount) * 100);
    const least = mode === 'checkout' ? 2000 : 100;   // PayMongo's minimums: ₱20 for its checkout page, ₱1 for QR Ph / GCash
    if (!Number.isInteger(amount) || amount < least) return json({ error: `Online payment needs at least ₱${(least / 100).toFixed(2)}.` }, 400);
    const page = (status: string) => { const u = new URL(back.origin + back.pathname); u.searchParams.set('order', details.order_id); u.searchParams.set('online', status); return u.toString(); };
    const kind = ({ downpayment: 'Downpayment', full: 'Full payment', balance: 'Remaining balance' } as Record<string, string>)[details.kind] || 'Payment';

    const headers = { Authorization: 'Basic ' + btoa(secretKey + ':'), 'Content-Type': 'application/json', Accept: 'application/json' };
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const failed = (step: string, res: Response, body: any) => {
      console.error('PayMongo ' + step + ' failed', res.status, JSON.stringify(body?.errors || body).slice(0, 500));
      return json({ error: 'PayMongo could not start the payment. Please try again.' }, 502);
    };

    // QR Ph on LexC's own page, or straight to GCash: a payment intent with one payment method attached.
    if (mode !== 'checkout') {
      const post = async (path: string, attributes: Record<string, unknown>) => {
        const res = await fetch('https://api.paymongo.com/v1/' + path, { method: 'POST', headers, body: JSON.stringify({ data: { attributes } }) });
        return { res, body: await res.json().catch(() => null) };
      };
      const intent = await post('payment_intents', {
        amount, currency: 'PHP', payment_method_allowed: [mode],
        description: `${kind} for LexC's Snacktime order #${details.order_number}`,
        metadata: { payment_id: details.payment_id, order_id: details.order_id },
      });
      const intentId = intent.body?.data?.id;
      if (!intent.res.ok || typeof intentId !== 'string') return failed('payment intent', intent.res, intent.body);
      const method = await post('payment_methods', mode === 'qrph' ? { type: 'qrph', expiry_seconds: 1800 } : { type: 'gcash' });
      const methodId = method.body?.data?.id;
      if (!method.res.ok || typeof methodId !== 'string') return failed('payment method', method.res, method.body);
      const attach = await post(`payment_intents/${intentId}/attach`, mode === 'gcash'
        ? { payment_method: methodId, return_url: page('paid') } : { payment_method: methodId });
      const next = attach.body?.data?.attributes?.next_action;
      if (!attach.res.ok || !next) return failed('attach', attach.res, attach.body);

      const { error: saveError } = await admin.rpc('paymongo_attach_checkout', { target_payment: details.payment_id, checkout_id: intentId });
      if (saveError) return json({ error: 'Payment could not be prepared. Please try again.' }, 500);
      if (mode === 'gcash') {
        if (typeof next.redirect?.url !== 'string') return failed('gcash link', attach.res, attach.body);
        return json({ url: next.redirect.url });
      }
      const image = next.code?.image_url;
      if (typeof image !== 'string' || !image) return failed('qr image', attach.res, attach.body);
      return json({ qr: image.startsWith('data:') || image.startsWith('http') ? image : 'data:image/png;base64,' + image,
        expiresAt: new Date(Date.now() + 1800 * 1000).toISOString(), amount: details.amount });
    }

    const response = await fetch('https://api.paymongo.com/v1/checkout_sessions', {
      method: 'POST',
      headers,
      body: JSON.stringify({ data: { attributes: {
        line_items: [{ amount, currency: 'PHP', name: `LexC's Snacktime · Order #${details.order_number}`, description: kind, quantity: 1 }],
        payment_method_types: ['gcash', 'qrph'],
        description: `${kind} for order #${details.order_number}`,
        reference_number: details.payment_id,
        send_email_receipt: false, show_description: true, show_line_items: true,
        success_url: page('paid'), cancel_url: page('cancelled'),
        metadata: { payment_id: details.payment_id, order_id: details.order_id },
      } } }),
    });
    const session = await response.json().catch(() => null);
    const checkoutId = session?.data?.id, checkoutUrl = session?.data?.attributes?.checkout_url;
    if (!response.ok || typeof checkoutId !== 'string' || typeof checkoutUrl !== 'string') {
      console.error('PayMongo checkout failed', response.status, JSON.stringify(session?.errors || session).slice(0, 500));
      return json({ error: 'PayMongo could not open the payment page. Please try again.' }, 502);
    }

    const { error: attachError } = await admin.rpc('paymongo_attach_checkout', { target_payment: details.payment_id, checkout_id: checkoutId });
    if (attachError) return json({ error: 'Payment could not be prepared. Please try again.' }, 500);
    return json({ url: checkoutUrl });
  } catch (error) {
    console.error('paymongo-checkout', error);
    return json({ error: 'Could not start online payment.' }, 500);
  }
});
