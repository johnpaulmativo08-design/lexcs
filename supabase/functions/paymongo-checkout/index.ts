// Opens a PayMongo checkout (GCash, QR Ph) for one of the signed-in customer's payment attempts.
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

    const { paymentId, returnUrl } = await request.json().catch(() => ({}));
    if (typeof paymentId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/.test(paymentId)) return json({ error: 'Select a payment first.' }, 400);
    // the customer comes back to the page they paid from, but only on LexC's own site
    let back: URL;
    try { back = new URL(String(returnUrl)); } catch { return json({ error: 'Invalid return page.' }, 400); }
    if (!origins.includes(back.origin)) return json({ error: 'Invalid return page.' }, 400);

    const { data: details, error: detailsError } = await customer.rpc('paymongo_checkout_start', { target_payment: paymentId });
    if (detailsError || !details) return json({ error: detailsError?.message || 'Payment is unavailable.' }, 403);

    const amount = Math.round(Number(details.amount) * 100);
    if (!Number.isInteger(amount) || amount < 2000) return json({ error: 'Online payment needs at least ₱20.00.' }, 400);
    const page = (status: string) => { const u = new URL(back.origin + back.pathname); u.searchParams.set('order', details.order_id); u.searchParams.set('online', status); return u.toString(); };
    const kind = ({ downpayment: 'Downpayment', full: 'Full payment', balance: 'Remaining balance' } as Record<string, string>)[details.kind] || 'Payment';

    const response = await fetch('https://api.paymongo.com/v1/checkout_sessions', {
      method: 'POST',
      headers: { Authorization: 'Basic ' + btoa(secretKey + ':'), 'Content-Type': 'application/json', Accept: 'application/json' },
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

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error: attachError } = await admin.rpc('paymongo_attach_checkout', { target_payment: details.payment_id, checkout_id: checkoutId });
    if (attachError) return json({ error: 'Payment could not be prepared. Please try again.' }, 500);
    return json({ url: checkoutUrl });
  } catch (error) {
    console.error('paymongo-checkout', error);
    return json({ error: 'Could not start online payment.' }, 500);
  }
});
