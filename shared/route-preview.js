// Delivery route preview (phase 99): before a Lalamove rider is booked, a delivery order shows the SHORTEST road route
// from the shop to the customer's pin. Routes come from OpenStreetMap routing (OSRM), which only follows mapped roads;
// of the routes it offers, the one with the fewest km is drawn (a motorcycle takes the shortest way). The time shown is
// rough (a car at normal speed). Each route is remembered in this browser so the free routing server is asked once.
// Any element <div data-route data-lat data-lng data-time="1"> is filled when it appears on the page.
(() => {
  const SHOP = { lat: 15.172157, lng: 120.58621 };   // 66 Quezon St., Dau (same as shared/checkout-map.js)
  const OSRM = 'https://router.project-osrm.org';
  const LEAFLET = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/';
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let leaflet = null;
  function loadLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (leaflet) return leaflet;
    leaflet = new Promise((resolve, reject) => {
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = LEAFLET + 'leaflet.min.css'; document.head.append(css);
      const js = document.createElement('script'); js.src = LEAFLET + 'leaflet.min.js'; js.onload = () => resolve(window.L); js.onerror = () => { leaflet = null; reject(new Error('map')); };
      document.head.append(js);
    });
    return leaflet;
  }
  const keyOf = (to) => `lexc_route_${to.lat.toFixed(5)}_${to.lng.toFixed(5)}`;
  async function route(to) {
    try { const saved = JSON.parse(localStorage.getItem(keyOf(to)) || 'null'); if (saved?.coords?.length) return saved; } catch {}
    const res = await fetch(`${OSRM}/route/v1/driving/${SHOP.lng},${SHOP.lat};${to.lng},${to.lat}?alternatives=3&overview=full&geometries=geojson&steps=false`, { signal: AbortSignal.timeout(10000) });
    const data = await res.json();
    if (!res.ok || data.code !== 'Ok' || !data.routes?.length) throw new Error('route');
    const best = data.routes.reduce((a, b) => (b.distance < a.distance ? b : a));   // shortest distance, not fastest
    const out = { km: Math.round(best.distance / 100) / 10, min: Math.max(1, Math.round(best.duration / 60)), coords: best.geometry.coordinates.map(([x, y]) => [y, x]) };
    try { localStorage.setItem(keyOf(to), JSON.stringify(out)); } catch {}
    return out;
  }
  let settings = null;   // Admin → Delivery rates: show the route to customers, show the rough time (phase 99)
  const settingsOf = () => settings || (settings = Promise.resolve(window.LexcBackend?.client?.from('delivery_pricing').select('route_preview,route_show_time').eq('id', 1).maybeSingle())
    .then((r) => r?.data || {}).catch(() => ({})));
  async function mount(el) {
    el.dataset.ready = '1';
    const set = /\/admin\//.test(location.pathname) ? {} : await settingsOf();
    if (set.route_preview === false) {   // switched off: the plain drop-off map, as before
      const lat = Number(el.dataset.lat), lng = Number(el.dataset.lng), d = 0.004;
      el.querySelector('.lx-route-map').innerHTML = `<iframe title="Delivery location on the map" loading="lazy" referrerpolicy="no-referrer" src="https://www.openstreetmap.org/export/embed.html?bbox=${[lng - d, lat - d, lng + d, lat + d].map((n) => n.toFixed(6)).join('%2C')}&amp;layer=mapnik&amp;marker=${lat.toFixed(6)}%2C${lng.toFixed(6)}"></iframe>`;
      el.querySelector('[data-route-label]').textContent = 'Your drop-off';
      return;
    }
    if (set.route_show_time === false) el.dataset.time = '0';
    const to = { lat: Number(el.dataset.lat), lng: Number(el.dataset.lng) };
    if (!Number.isFinite(to.lat) || !Number.isFinite(to.lng)) return;
    const box = el.querySelector('.lx-route-map'), label = el.querySelector('[data-route-label]');
    try {
      const [L, r] = await Promise.all([loadLeaflet(), route(to).catch(() => null)]);
      const map = L.map(box, { zoomControl: true, attributionControl: true, scrollWheelZoom: false, });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map);
      const pin = (cls, text) => L.divIcon({ className: '', html: `<span class="lx-route-pin ${cls}">${text}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] });
      L.marker([SHOP.lat, SHOP.lng], { icon: pin('is-shop', '★'), title: 'LexC’s kitchen' }).addTo(map);
      L.marker([to.lat, to.lng], { icon: pin('is-drop', '●'), title: 'Drop-off' }).addTo(map);
      if (r) {
        L.polyline(r.coords, { color: '#c9628f', weight: 10, opacity: 0.25 }).addTo(map);
        const line = L.polyline(r.coords, { color: '#6f4fa8', weight: 4.5, opacity: 1 }).addTo(map);
        map.fitBounds(line.getBounds(), { padding: [28, 28] });
        if (label) label.textContent = `${r.km} km${el.dataset.time === '1' ? ` · about ${r.min} min` : ''} · shortest road route`;
      } else {
        map.fitBounds([[SHOP.lat, SHOP.lng], [to.lat, to.lng]], { padding: [40, 40] });
        if (label) label.textContent = 'The road route isn’t available right now. The pins show the shop and your drop-off.';
      }
      setTimeout(() => map.invalidateSize(), 250);
    } catch {
      box.innerHTML = `<p class="lx-route-off">The map couldn’t load. <a href="https://maps.google.com/?q=${to.lat},${to.lng}" target="_blank" rel="noopener">Open the drop-off in Google Maps ↗</a></p>`;
    }
  }
  const scan = (root = document) => root.querySelectorAll?.('[data-route]:not([data-ready])').forEach(mount);
  new MutationObserver((list) => list.forEach((m) => m.addedNodes.forEach((n) => n.nodeType === 1 && (n.matches?.('[data-route]:not([data-ready])') ? mount(n) : scan(n))))).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', () => scan());
  // markup for a route card; fee: the delivery fee shown with the "Draft" note
  window.LexcRoute = {
    card: ({ lat, lng, showTime = true, fee = '' }) => `<figure class="lx-route" data-route data-lat="${esc(lat)}" data-lng="${esc(lng)}" data-time="${showTime ? 1 : 0}">
      <div class="lx-route-map" role="img" aria-label="Map of the road route from LexC’s kitchen to the drop-off"></div>
      <figcaption><span class="lx-route-label" data-route-label>Finding the shortest road route…</span>
        ${fee ? `<span class="lx-route-fee">Delivery fee ${esc(fee)} <em>Draft</em></span>` : ''}
        <small class="lx-route-note">Draft: the real delivery price shows after LexC’s books a Lalamove rider.</small></figcaption></figure>`,
  };
})();
