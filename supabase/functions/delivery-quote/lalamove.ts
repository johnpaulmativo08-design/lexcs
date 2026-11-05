// Lalamove API v3 quotation (phase 98): the price of one rider from the shop to the customer's pin.
// A quotation is free and books nothing; LexC's still books the rider in the Lalamove app.
// Keys live only in Supabase → Edge Functions → Secrets: LALAMOVE_API_KEY and LALAMOVE_API_SECRET.
// Production keys (pk_prod_…) go to rest.lalamove.com, sandbox keys (pk_test_…) to rest.sandbox.lalamove.com;
// the optional secret LALAMOVE_ENV ("production" or "sandbox") overrides that.
// Requests are signed as Lalamove documents: HMAC-SHA256 over "<time>\r\n<METHOD>\r\n<path>\r\n\r\n<body>".

export type LalamoveQuote =
  | { ok: true; fee: number; currency: string; distance_km: number; quotation_id: string; expires_at: string | null; price_breakdown: Record<string, unknown> }
  | { ok: false; reason: 'not_connected' | 'no_service' | 'failed'; detail?: string };

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function sign(secret: string, raw: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)));
}

export async function lalamoveQuotation(opts: {
  from: { lat: number; lng: number; address: string };
  to: { lat: number; lng: number; address: string };
  serviceType: string;
}): Promise<LalamoveQuote> {
  const apiKey = Deno.env.get('LALAMOVE_API_KEY') || '', secret = Deno.env.get('LALAMOVE_API_SECRET') || '';
  if (!apiKey || !secret) return { ok: false, reason: 'not_connected' };
  const env = (Deno.env.get('LALAMOVE_ENV') || (apiKey.startsWith('pk_test_') ? 'sandbox' : 'production')).toLowerCase();
  const host = env === 'sandbox' ? 'https://rest.sandbox.lalamove.com' : 'https://rest.lalamove.com';
  const path = '/v3/quotations';
  const stop = (p: { lat: number; lng: number; address: string }) => ({ coordinates: { lat: p.lat.toFixed(6), lng: p.lng.toFixed(6) }, address: p.address.slice(0, 300) });
  const body = JSON.stringify({ data: { serviceType: opts.serviceType, language: 'en_PH', stops: [stop(opts.from), stop(opts.to)], isRouteOptimized: false } });
  const time = Date.now().toString();
  const signature = await sign(secret, `${time}\r\nPOST\r\n${path}\r\n\r\n${body}`);
  let res: Response, data: any;
  try {
    res = await fetch(host + path, {
      method: 'POST', body, signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/json', Authorization: `hmac ${apiKey}:${time}:${signature}`, Market: 'PH', 'Request-ID': crypto.randomUUID() },
    });
    data = await res.json().catch(() => null);
  } catch (error) {
    console.warn('Lalamove unreachable:', error);
    return { ok: false, reason: 'failed', detail: 'unreachable' };
  }
  if (!res.ok || !data?.data) {
    // never log the keys; Lalamove's error ids are safe to log (e.g. ERR_OUT_OF_SERVICE_AREA, ERR_INVALID_SERVICE_TYPE)
    const ids = (Array.isArray(data?.errors) ? data.errors : []).map((e: any) => String(e?.id || e?.message || '')).join(',');
    console.warn('Lalamove quotation refused', res.status, ids || JSON.stringify(data)?.slice(0, 300));
    if (/OUT_OF_SERVICE_AREA|INVALID_SERVICE_AREA|SERVICE_AREA/i.test(ids)) return { ok: false, reason: 'no_service', detail: ids };
    return { ok: false, reason: 'failed', detail: `${res.status} ${ids}`.trim() };
  }
  const q = data.data, price = q.priceBreakdown || {};
  const fee = Number(price.total);
  if (!Number.isFinite(fee) || fee < 0) { console.warn('Lalamove quotation without a total', JSON.stringify(price).slice(0, 300)); return { ok: false, reason: 'failed', detail: 'no total' }; }
  if (price.currency && price.currency !== 'PHP') { console.warn('Lalamove quotation not in PHP:', price.currency); return { ok: false, reason: 'failed', detail: 'currency' }; }
  const metres = Number(q.distance?.value);
  const distance_km = Number.isFinite(metres) ? Math.round((q.distance?.unit === 'km' ? metres * 1000 : metres) / 10) / 100 : NaN;
  return { ok: true, fee, currency: price.currency || 'PHP', distance_km, quotation_id: String(q.quotationId || ''), expires_at: q.expiresAt || null, price_breakdown: price };
}
