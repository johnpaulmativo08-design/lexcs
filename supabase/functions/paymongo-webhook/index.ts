// Receives PayMongo webhook events "checkout_session.payment.paid" and "payment.paid": after checking PayMongo's
// signature it records the payment on the attempt as "verification pending" (public.paymongo_record_payment).
// LexC's still confirms the payment in Admin; nothing here marks an order paid.
// Deploy without JWT verification (PayMongo cannot send a Supabase login): supabase functions deploy paymongo-webhook --no-verify-jwt
// Secret (Supabase → Edge Functions → Secrets): PAYMONGO_WEBHOOK_SECRET (whsk_…, shown when the webhook is created).
import { createClient } from 'npm:@supabase/supabase-js@2';

const ok = (body: Record<string, unknown> = { received: true }, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
function sameText(a: string, b: string) {   // constant-time compare
  if (a.length !== b.length) return false;
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return ok({ error: 'Method not allowed.' }, 405);
  const secret = Deno.env.get('PAYMONGO_WEBHOOK_SECRET'), url = Deno.env.get('SUPABASE_URL'), serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!secret || !url || !serviceKey) return ok({ error: 'Not configured.' }, 503);

  // Paymongo-Signature: t=<timestamp>,te=<test signature>,li=<live signature>; signed text = "<t>.<raw body>"
  const raw = await request.text();
  const parts = Object.fromEntries((request.headers.get('Paymongo-Signature') || '').split(',').map((p) => p.split('=').map((s) => s.trim())));
  let event: any;
  try { event = JSON.parse(raw); } catch { return ok({ error: 'Bad payload.' }, 400); }
  const live = event?.data?.attributes?.livemode === true, given = live ? parts.li : parts.te;
  if (!parts.t || !given) return ok({ error: 'Missing signature.' }, 401);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${parts.t}.${raw}`)));
  if (!sameText(expected, given)) return ok({ error: 'Bad signature.' }, 401);

  // Two shapes, one result: "checkout_session.payment.paid" (PayMongo's checkout page, found by cs_…) and
  // "payment.paid" (QR Ph / GCash shown by LexC's page, found by the payment intent pi_…).
  const type = event?.data?.attributes?.type;
  let ref: string | undefined, payment: any, cs: any = {};
  if (type === 'checkout_session.payment.paid') {
    const checkout = event.data.attributes.data; payment = checkout?.attributes?.payments?.[0]; cs = checkout?.attributes || {}; ref = checkout?.id;
  } else if (type === 'payment.paid') {
    payment = event.data.attributes.data; ref = payment?.attributes?.payment_intent_id;
  } else return ok({ ignored: type || 'unknown' });
  const pay = payment?.attributes || {};
  if (typeof ref !== 'string' || typeof payment?.id !== 'string' || pay.status !== 'paid') return ok({ ignored: 'not paid' });
  // the payment's own amount / method / time, or the checkout's when PayMongo leaves them off the payment
  const amount = Number(pay.amount ?? (cs.line_items || []).reduce((sum: number, l: any) => sum + Number(l.amount) * Number(l.quantity || 1), 0));
  const paidAt = Number(pay.paid_at ?? cs.paid_at);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.rpc('paymongo_record_payment', {
    checkout_id: ref, payment_id: payment.id, amount_centavos: Number.isFinite(amount) && amount > 0 ? Math.round(amount) : null,
    method: String(pay.source?.type || pay.payment_method_type || cs.payment_method_used || 'paymongo'),
    paid_at: Number.isFinite(paidAt) && paidAt > 0 ? new Date(paidAt * 1000).toISOString() : null,
  });
  if (error) { console.error('paymongo_record_payment', error.message); return ok({ error: 'Could not record payment.' }, 500); }   // PayMongo retries
  return ok({ result: data });
});
