// Delivery fee quote for the signed-in customer's map pin (phase 94).
//   1. checks the pin is inside Pampanga (province outline in ./area.ts — the same one the checkout map draws);
//   2. gets the DRIVING distance from the shop to the pin from OSRM (OpenStreetMap routing; no key needed);
//   3. asks the database to price it with the owner's rates (public.issue_delivery_quote, service role only), which
//      saves the quote. Checkout then sends only the quote id; the order copies the fee from the saved quote.
// The fee is an ESTIMATE from LexC's own rates, unless Admin → Delivery rates says the fee comes from Lalamove
// (phase 98): then Lalamove is asked for a real quotation (./lalamove.ts) and public.issue_lalamove_quote saves it.
// Optional secret (Supabase → Edge Functions → Secrets): OSRM_URL to use another OSRM server than the public demo
// (https://router.project-osrm.org, which is free but has no uptime guarantee and asks for light use only).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { inPampanga, SHOP, townOf } from './area.ts';
import { lalamoveQuotation } from './lalamove.ts';

const SHOP_ADDRESS = "LexC's Snacktime, 66 Quezon St., Dau, Mabalacat City, Pampanga";

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
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    // phase 98: the fee comes from a Lalamove quotation
    const { data: rates } = await admin.from('delivery_pricing').select('enabled, fee_source, lalamove_service').eq('id', 1).maybeSingle();
    // Admin → Delivery rates "Try a Lalamove price": asks Lalamove, saves nothing, works while fees are off
    if (body.test === true) {
      const { data: role } = await admin.from('user_roles').select('role').eq('user_id', auth.user.id).maybeSingle();
      if (role?.role !== 'admin') return json({ status: 'error', error: 'Admin access required.' }, 403);
      const service = typeof body.service === 'string' && /^[A-Z0-9_]{2,40}$/.test(body.service) ? body.service : rates?.lalamove_service || 'MOTORCYCLE';
      const q = await lalamoveQuotation({ from: { ...SHOP, address: SHOP_ADDRESS }, to: { lat, lng, address: label || `${town || 'Pampanga'} (${lat.toFixed(6)}, ${lng.toFixed(6)})` }, serviceType: service });
      return json(q.ok ? { status: 'ok', test: true, fee: q.fee, distance_km: q.distance_km, service, sandbox: (Deno.env.get('LALAMOVE_API_KEY') || '').startsWith('pk_test_'), price_breakdown: q.price_breakdown }
        : { status: q.reason, test: true, detail: q.detail || null });
    }
    if (rates?.fee_source === 'lalamove') {
      if (!rates.enabled) return json({ status: 'not_priced' });
      const q = await lalamoveQuotation({
        from: { ...SHOP, address: SHOP_ADDRESS },
        to: { lat, lng, address: label || `${town ? town + ', ' : ''}Pampanga (${lat.toFixed(6)}, ${lng.toFixed(6)})` },
        serviceType: rates.lalamove_service || 'MOTORCYCLE',
      });
      if (!q.ok) {
        if (q.reason === 'not_connected') console.error('Lalamove keys missing: set LALAMOVE_API_KEY and LALAMOVE_API_SECRET.');
        return json({ status: q.reason === 'no_service' ? 'no_service' : 'lalamove_failed' }, q.reason === 'no_service' ? 200 : 502);
      }
      const { data: quote, error } = await admin.rpc('issue_lalamove_quote', {
        customer: auth.user.id, lat, lng, town, address_label: label || null,
        distance_km: Number.isFinite(q.distance_km) ? q.distance_km : 0, duration_min: null, fee: q.fee,
        lalamove: { quotation_id: q.quotation_id, expires_at: q.expires_at, price_breakdown: q.price_breakdown },
      });
      if (error || !quote) { console.error('issue_lalamove_quote failed:', error); return json({ status: 'error', error: 'The delivery fee could not be worked out. Try again.' }, 500); }
      return json({ ...quote, town });
    }

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
