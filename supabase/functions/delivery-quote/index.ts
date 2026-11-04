// Delivery fee quote for the signed-in customer's map pin (phase 94).
//   1. checks the pin is inside Pampanga (province outline in ./area.ts — the same one the checkout map draws);
//   2. gets the DRIVING distance from the shop to the pin from OSRM (OpenStreetMap routing; no key needed);
//   3. asks the database to price it with the owner's rates (public.issue_delivery_quote, service role only), which
//      saves the quote. Checkout then sends only the quote id; the order copies the fee from the saved quote.
// The fee is an ESTIMATE from LexC's own rates — Lalamove itself is not asked.
// Optional secret (Supabase → Edge Functions → Secrets): OSRM_URL to use another OSRM server than the public demo
// (https://router.project-osrm.org, which is free but has no uptime guarantee and asks for light use only).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { inPampanga, SHOP, townOf } from './area.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization,apikey,x-client-info,content-type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
};
const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (request.method !== 'POST') return json({ status: 'error', error: 'Method not allowed.' }, 405);
  try {
    const authorization = request.headers.get('Authorization') || '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!token) return json({ status: 'error', error: 'Log in to get a delivery fee.' }, 401);

    const url = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !anonKey || !serviceKey) return json({ status: 'error', error: 'Delivery fees are not set up yet.' }, 503);
    const customer = createClient(url, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: auth, error: authError } = await customer.auth.getUser(token);
    if (authError || !auth.user) return json({ status: 'error', error: 'Your session has expired. Log in again.' }, 401);

    const body = await request.json().catch(() => ({}));
    const lat = Number(body.lat), lng = Number(body.lng);
    const label = typeof body.label === 'string' ? body.label.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return json({ status: 'error', error: 'Pin your delivery spot on the map.' }, 400);
    }
    // coverage is decided by the province outline, never by the address text
    if (!inPampanga(lat, lng)) return json({ status: 'outside' });
    const town = townOf(lat, lng);

    // driving distance, shop → pin
    const osrm = (Deno.env.get('OSRM_URL') || 'https://router.project-osrm.org').replace(/\/+$/, '');
    let route: { distance: number; duration: number } | null = null, snapped = 0;
    try {
      const res = await fetch(`${osrm}/route/v1/driving/${SHOP.lng},${SHOP.lat};${lng},${lat}?overview=false&alternatives=false&steps=false`,
        { headers: { 'User-Agent': 'LexCs-Snacktime-delivery-quote/1.0 (+https://lexcsnacktime.shop)' }, signal: AbortSignal.timeout(9000) });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.code === 'Ok' && data.routes?.[0]) {
        route = data.routes[0];
        snapped = Number(data.waypoints?.[1]?.distance || 0);   // metres from the pin to the nearest road
      } else console.warn('OSRM answered', res.status, data?.code, data?.message);
    } catch (error) { console.warn('OSRM unreachable:', error); }
    if (!route) return json({ status: 'route_failed' }, 502);
    if (snapped > 1500) return json({ status: 'no_road' });

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: quote, error } = await admin.rpc('issue_delivery_quote', {
      customer: auth.user.id, lat, lng, town, address_label: label || null,
      distance_km: Math.round(route.distance / 10) / 100, duration_min: Math.round(route.duration / 6) / 10,
    });
    if (error || !quote) { console.error('issue_delivery_quote failed:', error); return json({ status: 'error', error: 'The delivery fee could not be worked out. Try again.' }, 500); }
    return json({ ...quote, town, distance_km: quote.distance_km ?? Math.round(route.distance / 10) / 100 });
  } catch (error) {
    console.error('delivery-quote failed:', error);
    return json({ status: 'error', error: 'The delivery fee could not be worked out. Try again.' }, 500);
  }
});
