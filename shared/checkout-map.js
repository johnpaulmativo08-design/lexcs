// Checkout map: where to pick up (Store Pick-up) and a pin the customer drops for Lalamove delivery.
// Free and keyless: Leaflet + OpenStreetMap tiles, Photon (OpenStreetMap data) for address search, the phone's GPS for "Use my location".
// Leaflet loads only when checkout opens. The pin travels with the order as a Google Maps link added to the address,
// so the owner can paste it straight into Lalamove (no database change).
(() => {
  // the kitchen: 66 Quezon St., Dau (pin from the owner's Google Maps link, 2026-11-04)
  const SHOP = { lat: 15.172157, lng: 120.586210, name: 'LexC’s Snacktime', area: '66 Quezon St., Dau, Mabalacat City, Pampanga' };
  // delivery is only offered inside this area (shared/delivery-area.js)
  const AREA = window.LexcDeliveryArea;
  const inArea = (lat, lng) => !AREA || AREA.contains(lat, lng);
  const OUTSIDE = `Sorry, we only deliver within ${AREA?.name || 'our area'} for now. Choose Store Pick-up, or pin an address in ${AREA?.name || 'our area'}.`;
  const LEAFLET = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/';
  // address search only looks inside the delivery area (min lon, min lat, max lon, max lat)
  const SEARCH_BOX = window.LexcDeliveryArea ? [window.LexcDeliveryArea.bounds[0][1], window.LexcDeliveryArea.bounds[0][0], window.LexcDeliveryArea.bounds[1][1], window.LexcDeliveryArea.bounds[1][0]].join(',') : '116.9,4.5,126.7,21.2';
  let areaLayer = null, loading = null, map = null, shopMarker = null, pinMarker = null, mode = '', pin = null, searchTimer = 0, searchSeq = 0, failed = false;
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const calm = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const fixed = n => Number(n).toFixed(6);
  const mapsLink = (lat, lng) => `https://maps.google.com/?q=${fixed(lat)},${fixed(lng)}`;
  const toast = (m, o) => window.showToast?.(m, o);


  function hint(href) { if (document.querySelector(`link[rel=preconnect][href="${href}"]`)) return; const l = document.createElement('link'); l.rel = 'preconnect'; l.href = href; l.crossOrigin = ''; document.head.appendChild(l); }
  function loadLeaflet() {
    if (window.L) return Promise.resolve();
    if (loading) return loading;
    hint('https://tile.openstreetmap.org'); hint('https://photon.komoot.io');
    loading = new Promise((resolve, reject) => {
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = LEAFLET + 'leaflet.min.css'; document.head.appendChild(css);
      const js = document.createElement('script'); js.src = LEAFLET + 'leaflet.min.js'; js.onload = resolve;
      js.onerror = () => { loading = null; reject(new Error('The map could not load.')); };
      document.head.appendChild(js);
    });
    return loading;
  }

  function skeleton() {
    const card = $('coMapCard'); if (!card || card.dataset.built) return;
    card.dataset.built = '1';
    card.innerHTML = `
      <div class="co-map-search" id="coMapSearchWrap" hidden>
        <div class="co-map-searchbox"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
          <input id="coMapSearch" type="search" placeholder="Search street, barangay or landmark" autocomplete="off" aria-label="Search for your delivery address" aria-controls="coMapResults"></div>
        <button type="button" class="co-map-locate" id="coMapLocate"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="7"/></svg><span>Use my location</span></button>
        <ul class="co-map-results" id="coMapResults" role="listbox" hidden></ul>
      </div>
      <div class="co-map" id="coMap" aria-label="Map"><span class="skel co-map-skel" aria-hidden="true"></span></div>
      <div class="co-map-info" id="coMapInfo" aria-live="polite"></div>`;
    $('coMapSearch').addEventListener('input', onSearchInput);
    $('coMapSearch').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('coMapResults').querySelector('button')?.click(); } if (e.key === 'Escape') hideResults(); });
    $('coMapLocate').addEventListener('click', locate);
    $('coMapResults').addEventListener('click', e => { const b = e.target.closest('button[data-lat]'); if (b) { setPin(+b.dataset.lat, +b.dataset.lng, { label: b.dataset.label, fly: true }); fillAddress(b.dataset.label); hideResults(); $('coMapSearch').value = b.dataset.label; } });
    $('coMapInfo').addEventListener('click', e => { if (e.target.closest('[data-clear-pin]')) clearPin(); if (e.target.closest('[data-fee-retry]')) requestQuote(0); });
  }

  function pinIcon(kind) { return L.divIcon({ className: 'co-map-marker', html: `<span class="co-map-dot ${kind}"><span></span></span>`, iconSize: [34, 42], iconAnchor: [17, 40] }); }

  async function build() {
    await loadLeaflet();
    if (map) return;
    $('coMap').innerHTML = '';
    const still = calm();
    map = L.map('coMap', { zoomControl: false, attributionControl: true, scrollWheelZoom: true, touchZoom: true, doubleClickZoom: true, wheelPxPerZoomLevel: 90, tap: true,
      fadeAnimation: !still, zoomAnimation: !still, markerZoomAnimation: !still }).setView([SHOP.lat, SHOP.lng], 15);
    L.control.zoom({ position: 'bottomright', zoomInTitle: 'Zoom in', zoomOutTitle: 'Zoom out' }).addTo(map);
    map.attributionControl.setPrefix(false);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, keepBuffer: 3, updateWhenZooming: false, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' }).addTo(map);
    if (AREA) {
      // the delivery area, outlined, and the map kept to it (with a little room around the edge)
      areaLayer = L.polygon(AREA.ring, { color: '#7a55b8', weight: 2, opacity: .7, fillColor: '#7a55b8', fillOpacity: .05, interactive: false });
      map.setMaxBounds(L.latLngBounds(AREA.bounds).pad(0.15)); map.options.maxBoundsViscosity = 0.9; map.setMinZoom(9);
    }
    shopMarker = L.marker([SHOP.lat, SHOP.lng], { icon: pinIcon('is-shop'), keyboard: false, title: SHOP.name }).addTo(map);
    map.on('click', e => { if (mode === 'Lalamove') setPin(e.latlng.lat, e.latlng.lng, { lookup: true }); });
    if (pendingPin) { const p = pendingPin; pendingPin = null; setPin(p.lat, p.lng, { label: p.label, fly: true }); }
  }
  // a saved address picked at checkout: put its pin on the map (now, or as soon as the map is ready)
  let pendingPin = null;
  function usePin(lat, lng, label = '') { if (!Number.isFinite(lat) || !Number.isFinite(lng)) return; if (map) setPin(lat, lng, { label, fly: true }); else pendingPin = { lat, lng, label }; }

  function infoPickup() {
    return `<div class="co-map-place"><span class="co-map-badge is-shop" aria-hidden="true"></span><div><strong>${esc(SHOP.name)} – ${esc(SHOP.area)}</strong><small>Ready on the date and time you pick below</small></div><em class="co-map-chip">No delivery fee</em></div>
      <a class="co-map-link" href="https://www.google.com/maps/dir/?api=1&destination=${fixed(SHOP.lat)},${fixed(SHOP.lng)}" target="_blank" rel="noopener">Get directions in Google Maps</a>`;
  }
  function infoDelivery() {
    if (!pin) return `<p class="co-map-hint">We deliver within ${esc(AREA?.name || 'our area')} (outlined on the map). Tap the map, search, or use your location to pin your exact spot.</p>`;
    return `<div class="co-map-place"><span class="co-map-badge is-pin" aria-hidden="true"></span><div><strong>Deliver to</strong><small>${pin.finding && !pin.label ? '<span class="co-map-finding">Finding the address…</span>' : esc(pin.label || 'Pinned on the map')} · drag the pin to adjust</small></div><button type="button" class="co-map-clear" data-clear-pin>Remove pin</button></div>
      ${feeBox()}`;
  }
  // ---- delivery fee: driving distance and the estimated fee, worked out on the server (supabase/functions/delivery-quote)
  const peso = n => '₱' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const kmOf = n => `${Number(n).toFixed(Number(n) < 10 ? 1 : 0)} km`;
  function feeBox() {
    const q = quote, row = (label, value, extra = '') => `<div class="co-fee-row${extra}"><span>${label}</span><strong>${value}</strong></div>`;
    const coverage = row('Coverage', `<span class="co-fee-ok">✓ Within ${esc(AREA?.name || 'our area')}</span>`);
    if (q.state === 'loading') return `<div class="co-fee" aria-busy="true">${coverage}${row('Driving distance', '<span class="skel skel-line co-fee-skel" aria-hidden="true"></span><span class="sr-only">Calculating…</span>')}${row('Estimated delivery fee', '<span class="skel skel-line co-fee-skel" aria-hidden="true"></span>', ' is-fee')}<p class="co-fee-note">Calculating the driving route and fee…</p></div>`;
    if (q.state === 'ok' && q.data.source === 'lalamove') return `<div class="co-fee">${coverage}${q.data.distance_km > 0 ? row('Distance', kmOf(q.data.distance_km)) : ''}${row('Lalamove delivery fee', peso(q.data.fee), ' is-fee')}<p class="co-fee-note">Lalamove’s current price for a ${esc(String(q.data.vehicle || 'motorcycle').toLowerCase())}. Paid to LexC’s with your first payment; LexC’s books the rider.</p></div>`;
    if (q.state === 'ok') return `<div class="co-fee">${coverage}${row('Driving distance', kmOf(q.data.distance_km))}${row('Estimated delivery fee', peso(q.data.fee), ' is-fee')}<p class="co-fee-note">Estimate from LexC’s ${esc(String(q.data.vehicle || '').toLowerCase() || 'delivery')} rates, not a Lalamove quotation. Paid to LexC’s with your first payment; LexC’s books the rider.</p></div>`;
    if (q.state === 'not_priced') return `<div class="co-fee">${coverage}${q.data?.distance_km != null ? row('Driving distance', kmOf(q.data.distance_km)) : ''}<p class="co-fee-note">The delivery fee is paid to the Lalamove rider.</p></div>`;
    const retry = '<button type="button" class="co-fee-retry" data-fee-retry>Try again</button>';
    const MSG = {
      failed: ['We couldn’t work out the driving route right now.', true], login: ['Log in again to see the delivery fee.', false],
      too_far: [`This spot is ${q.data?.distance_km != null ? kmOf(q.data.distance_km) + ' away, ' : ''}farther than we deliver. Choose Store Pick-up or a nearer spot.`, false],
      no_road: ['That pin is too far from a road. Move it onto your street or building.', false],
      busy: ['Too many fee checks in the last hour. Please wait a little, then try again.', true],
      no_service: ['Lalamove doesn’t deliver to this spot. Move the pin, or choose Store Pick-up.', false],
      lalamove_failed: ['We couldn’t get Lalamove’s price right now.', true],
      outside: [OUTSIDE, false],
    }[q.state] || ['The delivery fee isn’t available yet.', true];
    return `<div class="co-fee is-problem" role="alert">${q.state === 'outside' ? '' : coverage}<p class="co-fee-note">${esc(MSG[0])} ${MSG[1] ? retry : ''}</p><p class="co-fee-note">Store Pick-up is always available.</p></div>`;
  }
  let quote = { state: 'idle' }, quoteSeq = 0, quoteTimer = 0;
  const changed = () => { paint(); window.updateCheckoutDelivery?.(); window.LexcCheckoutChecks?.refresh?.(); };
  function requestQuote(delay = 350) {
    clearTimeout(quoteTimer);
    if (!pin) { quote = { state: 'idle' }; return changed(); }
    quote = { state: 'loading' }; changed();
    const seq = ++quoteSeq, at = { ...pin };
    return new Promise(resolve => { quoteTimer = setTimeout(async () => { await fetchQuote(seq, at); resolve(); }, delay); });
  }
  async function fetchQuote(seq, at) {
    let next;
    try {
      const cfg = window.LexcSupabaseConfig, session = (await window.LexcBackend?.client?.auth.getSession())?.data?.session;
      if (!cfg?.url || !session?.access_token) next = { state: 'login' };
      else {
        const res = await fetch(cfg.url.replace(/\/+$/, '') + '/functions/v1/delivery-quote', {
          method: 'POST', headers: { 'Content-Type': 'application/json', apikey: cfg.key, Authorization: 'Bearer ' + session.access_token },
          body: JSON.stringify({ lat: at.lat, lng: at.lng, label: at.label || '' }) });
        const data = await res.json().catch(() => null);
        const st = data?.status;
        next = st === 'ok' && Number.isFinite(Number(data.fee)) && data.quote_id ? { state: 'ok', data: { ...data, fee: Number(data.fee), distance_km: Number(data.distance_km) } }
          : ['outside', 'not_priced', 'too_far', 'no_road', 'busy', 'no_service', 'lalamove_failed'].includes(st) ? { state: st, data }
          : res.status === 401 ? { state: 'login' } : { state: 'failed', data };
      }
    } catch { next = { state: 'failed' }; }
    // the fee service failed: if delivery fees are not switched on (or not set up yet), delivery works as before
    if (next.state === 'failed') next = await (async () => {
      try {
        const ask = window.LexcBackend.client.from('delivery_pricing').select('enabled').eq('id', 1).maybeSingle();
        const { data, error } = await Promise.race([ask, new Promise(r => setTimeout(() => r({ error: 'timeout', data: { enabled: true } }), 5000))]);
        return error || !data?.enabled ? { state: 'not_priced' } : next;
      } catch { return next; }
    })();
    if (seq !== quoteSeq) return;            // the pin moved again meanwhile: a newer answer is coming
    quote = { ...next, at };
    changed();
  }
  function paint() { const info = $('coMapInfo'); if (info) info.innerHTML = mode === 'Lalamove' ? infoDelivery() : infoPickup(); }

  function setPin(lat, lng, { label = '', fly = false, lookup = false } = {}) {
    if (!inArea(lat, lng)) {
      // outside the delivery area: keep the old pin (a dragged pin goes back to it) and say why
      if (pinMarker && pin) pinMarker.setLatLng([pin.lat, pin.lng]);
      toast(OUTSIDE, { type: 'info' });
      if (map && areaLayer) map.fitBounds(areaLayer.getBounds(), { animate: !calm() });
      return;
    }
    const moved = !pin || pin.lat !== lat || pin.lng !== lng;
    pin = { lat, lng, label };
    if (moved) requestQuote();
    if (!pinMarker) {
      pinMarker = L.marker([lat, lng], { icon: pinIcon('is-pin'), draggable: true, title: 'Delivery pin' }).addTo(map);
      // the street name follows the pin while it is dragged (a lookup at most every 250 ms), then once more where it lands
      let dragAt = 0;
      pinMarker.on('dragstart', () => { if (pin) { pin.label = ''; pin.finding = true; paint(); } });
      pinMarker.on('drag', () => { const now = Date.now(); if (now - dragAt < 250) return; dragAt = now; const p = pinMarker.getLatLng(); if (inArea(p.lat, p.lng)) reverse(p.lat, p.lng, { live: true }); });
      pinMarker.on('dragend', () => { const p = pinMarker.getLatLng(); setPin(p.lat, p.lng, { lookup: true }); });
    } else pinMarker.setLatLng([lat, lng]);
    if (fly) frame();
    paint();
    if (lookup) { const hit = cache.get(key(lat, lng)); if (hit) { pin.label = hit; paint(); fillAddress(hit); } else { pin.finding = true; paint(); reverse(lat, lng); } }
  }
  // show the shop and the pin together, with room around both so neither sits on the edge
  function frame() {
    if (!map || !pin) return;
    map.fitBounds(L.latLngBounds([[SHOP.lat, SHOP.lng], [pin.lat, pin.lng]]), { paddingTopLeft: [40, 58], paddingBottomRight: [48, 22], maxZoom: 16, animate: !calm() });
  }
  function clearPin() { pin = null; if (pinMarker) { map.removeLayer(pinMarker); pinMarker = null; } quoteSeq++; quote = { state: 'idle' }; changed(); }

  function labelOf(p = {}) {
    const street = [p.housenumber, p.street].filter(Boolean).join(' ');
    return [p.name !== p.street ? p.name : '', street, p.district || p.locality, p.city || p.county, p.state].filter((v, i, a) => v && a.indexOf(v) === i).join(', ');
  }
  // street names for a pin: answers are kept (about 10 m apart counts as the same spot) and an older lookup is
  // cancelled when the pin moves again, so the newest spot always wins
  const cache = new Map(), key = (lat, lng) => lat.toFixed(4) + ',' + lng.toFixed(4);
  let reverseCtl = null, reverseSeq = 0;
  async function reverse(lat, lng, { live = false } = {}) {
    const k = key(lat, lng), seq = ++reverseSeq;
    const done = label => { if (seq !== reverseSeq || !pin) return; pin.finding = false; if (label) pin.label = label; paint(); if (label) fillAddress(label); };
    if (cache.has(k)) return done(cache.get(k));
    reverseCtl?.abort(); reverseCtl = new AbortController();
    try {
      const res = await fetch(`https://photon.komoot.io/reverse?lat=${fixed(lat)}&lon=${fixed(lng)}&limit=1&lang=en`, { signal: reverseCtl.signal });
      const label = labelOf((await res.json()).features?.[0]?.properties);
      if (label) { cache.set(k, label); if (cache.size > 200) cache.delete(cache.keys().next().value); }
      done(label);
    } catch (err) { if (err?.name !== 'AbortError' && !live) done(''); }   // the pin still works without a street name
  }
  // the Delivery address box follows the pin; house/unit details can be added after the pin is placed
  function fillAddress(label) {
    const box = $('coAddress');
    if (box && label && box.value !== label) { box.value = label; box.dispatchEvent(new Event('input', { bubbles: true })); box.closest('.co-icon-field')?.classList.remove('is-synced'); void box.offsetWidth; box.closest('.co-icon-field')?.classList.add('is-synced'); }
  }

  function hideResults() { const r = $('coMapResults'); if (r) { r.hidden = true; r.innerHTML = ''; } }
  function onSearchInput(e) {
    clearTimeout(searchTimer);
    const q = e.target.value.trim();
    if (q.length < 3) return hideResults();
    searchTimer = setTimeout(() => search(q), 350);
  }
  async function search(q) {
    const seq = ++searchSeq, list = $('coMapResults');
    list.hidden = false; list.innerHTML = '<li class="co-map-results-note">Searching…</li>';
    try {
      const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=5&lang=en&lat=${SHOP.lat}&lon=${SHOP.lng}&bbox=${SEARCH_BOX}`);
      const data = await res.json(); if (seq !== searchSeq) return;
      const rows = (data.features || []).map(f => ({ lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], label: labelOf(f.properties) })).filter(r => r.label && inArea(r.lat, r.lng));
      list.innerHTML = rows.length ? rows.map(r => `<li><button type="button" role="option" data-lat="${r.lat}" data-lng="${r.lng}" data-label="${esc(r.label)}">${esc(r.label)}</button></li>`).join('')
        : `<li class="co-map-results-note">No match in ${esc(AREA?.name || 'our delivery area')}. Try a nearby landmark, or tap the map.</li>`;
    } catch { if (seq === searchSeq) list.innerHTML = '<li class="co-map-results-note">Search is unavailable right now. Tap the map instead.</li>'; }
  }

  function locate() {
    if (!navigator.geolocation) return toast('This browser can’t share your location. Search or tap the map instead.', { type: 'info' });
    const btn = $('coMapLocate'); btn.disabled = true; btn.querySelector('span').textContent = 'Finding you…';
    navigator.geolocation.getCurrentPosition(p => {
      btn.disabled = false; btn.querySelector('span').textContent = 'Use my location';
      setPin(p.coords.latitude, p.coords.longitude, { fly: true, lookup: true });
    }, err => {
      btn.disabled = false; btn.querySelector('span').textContent = 'Use my location';
      toast(err.code === 1 ? 'Location is blocked. Allow it in your browser, or search instead.' : 'Couldn’t find your location. Search or tap the map instead.', { type: 'info' });
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  }

  async function show(nextMode) {
    const card = $('coMapCard'); if (!card) return;
    mode = nextMode;
    if (!mode) { card.hidden = true; return; }
    skeleton();
    card.hidden = false;
    $('coMapSearchWrap').hidden = mode !== 'Lalamove';
    card.classList.toggle('is-delivery', mode === 'Lalamove');
    if (map && areaLayer) { if (mode === 'Lalamove') areaLayer.addTo(map); else areaLayer.remove(); }
    if (failed) { paint(); return; }
    try { await build(); } catch {
      failed = true;
      $('coMap').innerHTML = '<p class="co-map-error">The map couldn’t load. You can still type your address below.</p>';
      paint(); return;
    }
    if (areaLayer) { if (mode === 'Lalamove') areaLayer.addTo(map); else areaLayer.remove(); }
    paint();
    map.invalidateSize();
    if (mode === 'Lalamove' && pin) frame();
    else if (mode === 'Lalamove' && areaLayer) map.fitBounds(areaLayer.getBounds(), { animate: false });   // the whole delivery area
    else if (mode === 'Lalamove') map.setView([SHOP.lat, SHOP.lng], 13, { animate: false });
    else map.setView([SHOP.lat, SHOP.lng], 16, { animate: false });
  }

  // the address saved with the order: what the customer typed, plus the map pin for Lalamove
  function addressWithPin(text) {
    if (mode !== 'Lalamove' || !pin) return text;
    return `${text}\nMap pin: ${mapsLink(pin.lat, pin.lng)}`;
  }

  // checked before the order is placed: delivery needs a pin inside the delivery area
  function problem() {
    if (mode !== 'Lalamove') return null;
    if (!pin) return `Pin your delivery spot on the map. We deliver within ${AREA?.name || 'our area'} only.`;
    if (!inArea(pin.lat, pin.lng)) return OUTSIDE;
    if (quote.state === 'loading') return 'Please wait — the delivery fee is still being calculated.';
    if (quote.state === 'ok' && Date.parse(quote.data.expires_at) - Date.now() < 60000) { requestQuote(0); return 'The delivery fee was refreshed. Please check it, then place your order.'; }
    if (quote.state === 'outside') return OUTSIDE;
    if (!['ok', 'not_priced'].includes(quote.state)) return 'The delivery fee isn’t ready. Tap “Try again” under the map, move the pin, or choose Store Pick-up.';
    return null;
  }
  // what checkout shows and sends: the fee only when the server priced it
  function fee() { return mode === 'Lalamove' && quote.state === 'ok' ? { amount: quote.data.fee, quote_id: quote.data.quote_id, distance_km: quote.data.distance_km, source: quote.data.source || 'rates' } : null; }
  function feeState() { return mode === 'Lalamove' ? quote.state : 'pickup'; }

  // start fetching the map library as soon as checkout opens, so the map is ready when a choice is tapped
  const preload = () => { loadLeaflet().catch(() => {}); };
  window.LexcCheckoutMap = { show, preload, addressWithPin, usePin, problem, fee, feeState, area: AREA, get pin() { return pin && { ...pin }; }, shop: SHOP };
})();
