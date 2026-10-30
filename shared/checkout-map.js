// Checkout map: where to pick up (Store Pick-up) and a pin the customer drops for Lalamove delivery.
// Free and keyless: Leaflet + OpenStreetMap tiles, Photon (OpenStreetMap data) for address search, the phone's GPS for "Use my location".
// Leaflet loads only when checkout opens. The pin travels with the order as a Google Maps link added to the address,
// so the owner can paste it straight into Lalamove (no database change).
(() => {
  const SHOP = { lat: 14.481412, lng: 120.908203, name: 'LexC’s Snacktime', area: 'San Roque, Cavite City' };   // Plus Code FWJ5+H78
  const LEAFLET = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/';
  const PH_BOX = '116.9,4.5,126.7,21.2';   // keep address search inside the Philippines
  let loading = null, map = null, shopMarker = null, pinMarker = null, mode = '', pin = null, searchTimer = 0, searchSeq = 0, failed = false;
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const calm = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const fixed = n => Number(n).toFixed(6);
  const mapsLink = (lat, lng) => `https://maps.google.com/?q=${fixed(lat)},${fixed(lng)}`;
  const toast = (m, o) => window.showToast?.(m, o);

  function km(a, b) {   // straight-line distance; roads are a bit longer
    const r = d => d * Math.PI / 180, dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(h));
  }
  const kmText = d => d < 1 ? `${Math.round(d * 1000)} m` : `${d.toFixed(d < 10 ? 1 : 0)} km`;

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
    $('coMapInfo').addEventListener('click', e => { if (e.target.closest('[data-clear-pin]')) clearPin(); });
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
    shopMarker = L.marker([SHOP.lat, SHOP.lng], { icon: pinIcon('is-shop'), keyboard: false, title: SHOP.name }).addTo(map);
    map.on('click', e => { if (mode === 'Lalamove') setPin(e.latlng.lat, e.latlng.lng, { lookup: true }); });
  }

  function infoPickup() {
    return `<div class="co-map-place"><span class="co-map-badge is-shop" aria-hidden="true"></span><div><strong>${esc(SHOP.name)} – ${esc(SHOP.area)}</strong><small>Ready on the date and time you pick below</small></div><em class="co-map-chip">No delivery fee</em></div>
      <a class="co-map-link" href="https://www.google.com/maps/dir/?api=1&destination=${fixed(SHOP.lat)},${fixed(SHOP.lng)}" target="_blank" rel="noopener">Get directions in Google Maps</a>`;
  }
  function infoDelivery() {
    if (!pin) return `<p class="co-map-hint">Tap the map, search, or use your location to pin your exact spot. Lalamove riders find you faster with a pin.</p>`;
    return `<div class="co-map-place"><span class="co-map-badge is-pin" aria-hidden="true"></span><div><strong>Deliver to · ~${kmText(km(SHOP, pin))} from LexC’s</strong><small>${esc(pin.label || 'Pinned on the map')} · drag the pin to adjust</small></div><button type="button" class="co-map-clear" data-clear-pin>Remove pin</button></div>
      <p class="co-map-hint">The delivery fee is paid to the Lalamove rider.</p>`;
  }
  function paint() { const info = $('coMapInfo'); if (info) info.innerHTML = mode === 'Lalamove' ? infoDelivery() : infoPickup(); }

  function setPin(lat, lng, { label = '', fly = false, lookup = false } = {}) {
    pin = { lat, lng, label };
    if (!pinMarker) {
      pinMarker = L.marker([lat, lng], { icon: pinIcon('is-pin'), draggable: true, title: 'Delivery pin' }).addTo(map);
      pinMarker.on('dragend', () => { const p = pinMarker.getLatLng(); setPin(p.lat, p.lng, { lookup: true }); });
    } else pinMarker.setLatLng([lat, lng]);
    if (fly) frame();
    paint();
    if (lookup) reverse(lat, lng);
  }
  // show the shop and the pin together, with room around both so neither sits on the edge
  function frame() {
    if (!map || !pin) return;
    map.fitBounds(L.latLngBounds([[SHOP.lat, SHOP.lng], [pin.lat, pin.lng]]), { paddingTopLeft: [40, 58], paddingBottomRight: [48, 22], maxZoom: 16, animate: !calm() });
  }
  function clearPin() { pin = null; if (pinMarker) { map.removeLayer(pinMarker); pinMarker = null; } paint(); }

  function labelOf(p = {}) {
    const street = [p.housenumber, p.street].filter(Boolean).join(' ');
    return [p.name !== p.street ? p.name : '', street, p.district || p.locality, p.city || p.county, p.state].filter((v, i, a) => v && a.indexOf(v) === i).join(', ');
  }
  async function reverse(lat, lng) {
    const seq = ++searchSeq;
    try {
      const res = await fetch(`https://photon.komoot.io/reverse?lat=${fixed(lat)}&lon=${fixed(lng)}&limit=1&lang=en`);
      const data = await res.json(); if (seq !== searchSeq || !pin) return;
      const label = labelOf(data.features?.[0]?.properties);
      if (!label) return;
      pin.label = label; paint(); fillAddress(label);
    } catch { /* the pin still works without a street name */ }
  }
  function fillAddress(label) {   // only an empty address; the customer adds house/unit details
    const box = $('coAddress');
    if (box && label && !box.value.trim()) { box.value = label; box.dispatchEvent(new Event('input', { bubbles: true })); }
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
      const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=5&lang=en&lat=${SHOP.lat}&lon=${SHOP.lng}&bbox=${PH_BOX}`);
      const data = await res.json(); if (seq !== searchSeq) return;
      const rows = (data.features || []).map(f => ({ lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], label: labelOf(f.properties) })).filter(r => r.label);
      list.innerHTML = rows.length ? rows.map(r => `<li><button type="button" role="option" data-lat="${r.lat}" data-lng="${r.lng}" data-label="${esc(r.label)}">${esc(r.label)}</button></li>`).join('')
        : '<li class="co-map-results-note">No match. Try a nearby landmark, or tap the map.</li>';
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
    if (failed) { paint(); return; }
    try { await build(); } catch {
      failed = true;
      $('coMap').innerHTML = '<p class="co-map-error">The map couldn’t load. You can still type your address below.</p>';
      paint(); return;
    }
    paint();
    map.invalidateSize();
    if (mode === 'Lalamove' && pin) frame();
    else if (mode === 'Lalamove') map.setView([SHOP.lat, SHOP.lng], 13, { animate: false });
    else map.setView([SHOP.lat, SHOP.lng], 16, { animate: false });
  }

  // the address saved with the order: what the customer typed, plus the map pin for Lalamove
  function addressWithPin(text) {
    if (mode !== 'Lalamove' || !pin) return text;
    return `${text}\nMap pin: ${mapsLink(pin.lat, pin.lng)}`;
  }

  // start fetching the map library as soon as checkout opens, so the map is ready when a choice is tapped
  const preload = () => { loadLeaflet().catch(() => {}); };
  window.LexcCheckoutMap = { show, preload, addressWithPin, get pin() { return pin && { ...pin }; }, shop: SHOP };
})();
