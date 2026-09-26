import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization,apikey,x-client-info,content-type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
};
const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

function imageExtension(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpg';
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value)) return 'png';
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF'
    && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP') return 'webp';
  return null;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  try {
    const authorization = request.headers.get('Authorization') || '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!token) return json({ error: 'Sign in to upload proof.' }, 401);

    const url = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !anonKey || !serviceKey) return json({ error: 'Payment upload is not configured.' }, 503);

    const customer = createClient(url, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: auth, error: authError } = await customer.auth.getUser(token);
    if (authError || !auth.user) return json({ error: 'Your session has expired.' }, 401);

    const form = await request.formData();
    const paymentId = form.get('paymentId');
    const file = form.get('file');
    if (typeof paymentId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/.test(paymentId)
      || !(file instanceof File)) return json({ error: 'Select a payment attempt and image.' }, 400);
    if (file.size < 1 || file.size > 5242880) return json({ error: 'The proof must be 5 MB or smaller.' }, 400);

    const { data: payment, error: paymentError } = await customer
      .from('order_payment_attempts').select('id,order_id,status,customer_id')
      .eq('id', paymentId).single();
    if (paymentError || !payment || payment.customer_id !== auth.user.id
      || payment.status !== 'awaiting_payment') return json({ error: 'Payment attempt is unavailable.' }, 403);

    const bytes = new Uint8Array(await file.arrayBuffer());
    const extension = imageExtension(bytes);
    const mime = extension === 'jpg' ? 'image/jpeg' : extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : null;
    if (!mime || file.type !== mime) return json({ error: 'Only genuine JPG, PNG, or WEBP images are accepted.' }, 400);

    const path = `${auth.user.id}/${payment.order_id}/${payment.id}/${crypto.randomUUID()}.${extension}`;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error: uploadError } = await admin.storage.from('payment-proofs')
      .upload(path, bytes, { contentType: mime, upsert: false });
    if (uploadError) return json({ error: 'Proof upload failed. Please try again.' }, 500);
    return json({ path });
  } catch {
    return json({ error: 'Could not process payment proof.' }, 500);
  }
});
