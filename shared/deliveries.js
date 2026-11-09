// Account → Deliveries: the customer's saved delivery addresses (public.customer_addresses, phase 109 — each customer
// sees only their own, up to 10). "Add address" opens a map: tap or drag the pin (or Use my location), the street is
// filled from the pin, the customer adds house details, then Save keeps it on their account. Checkout lists the same
// addresses (shared/address-book.js). Map: Leaflet + OpenStreetMap, street names from Photon — free and keyless.
(function () {
  const LEAFLET = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/';
  const SHOP = { lat: 15.172157, lng: 120.586210 };
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const db = () => window.LexcBackend;
  const PIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12Z"/><circle cx="12" cy="10" r="2.6"/></svg>';
  let sheet = null, list = [], map = null, marker = null, pin = null, seq = 0;

  function loadLeaflet() {
    if (window.L) return Promise.resolve();
    return new Promise((resolve, reject) => {
      if (!document.querySelector(`link[href="${LEAFLET}leaflet.min.css"]`)) { const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = LEAFLET + 'leaflet.min.css'; document.head.append(css); }
      const js = document.createElement('script'); js.src = LEAFLET + 'leaflet.min.js'; js.onload = resolve; js.onerror = reject; document.head.append(js);
    });
  }
  async function load() {
    list = db().unwrap(await db().client.from('customer_addresses').select('*').order('is_default', { ascending: false }).order('updated_at', { ascending: false }));
    return list;
  }
  function close() { if (!sheet) return; const s = sheet; sheet = null; map?.remove(); map = null; marker = null; s.classList.remove('is-open'); setTimeout(() => s.remove(), 220); document.removeEventListener('keydown', onKey); }
  function onKey(ev) { if (ev.key === 'Escape') close(); }
  function frame(title, body) {
    if (!sheet) {
      sheet = document.createElement('div'); sheet.className = 'vw-sheet dl-sheet'; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true');
      document.body.append(sheet); requestAnimationFrame(() => sheet?.classList.add('is-open')); document.addEventListener('keydown', onKey);
      sheet.addEventListener('click', onClick);
    }
    map?.remove(); map = null; marker = null;
    sheet.setAttribute('aria-label', title);
    sheet.innerHTML = `<div class="vw-sheet-card dl-card"><header><h3>${esc(title)}</h3><button type="button" class="vw-x" data-dl-close aria-label="Close">×</button></header>${body}</div>`;
  }

  // the list
  async function open() {
    if (!window.currentUser) { window.openAuthModal?.('login'); return; }
    frame('Deliveries', `<div class="dl-list">${'<span class="vw-skel skel" aria-hidden="true"></span>'.repeat(2)}</div>`);
    try { await load(); } catch (e) { list = []; }
    showList();
  }
  function showList(msg = '') {
    frame('Deliveries', `<p class="dl-note">Saved delivery addresses. Pick one at checkout when you choose Lalamove delivery.</p>
      <div class="dl-list">${list.length ? list.map((a) => `<div class="dl-row"><span class="dl-pin">${PIN}</span><span class="dl-text"><b>${esc(a.recipient)}</b> <small>${esc(a.phone)}</small><span>${esc(a.address)}</span>${a.is_default ? '<em>Default</em>' : ''}</span>
        <span class="dl-acts">${a.is_default ? '' : `<button type="button" data-dl-default="${a.id}">Make default</button>`}<button type="button" data-dl-del="${a.id}">Remove</button></span></div>`).join('')
        : '<p class="vw-empty">No saved addresses yet.</p>'}</div>
      <p class="vw-msg" role="status">${esc(msg)}</p>
      ${list.length < 10 ? '<button type="button" class="vw-claim dl-add" data-dl-add>+ Add address</button>' : '<p class="dl-note">You can keep up to 10 addresses.</p>'}`);
  }

  // the map form
  async function showAdd() {
    const p = window.currentProfile || {};
    pin = null;
    frame('Add address', `<div class="dl-map" id="dlMap" aria-label="Map: tap to drop your pin"><span class="dl-map-wait">Loading map…</span></div>
      <div class="dl-map-tools"><button type="button" data-dl-gps>Use my location</button><small data-dl-pinmsg>Tap the map where we should deliver.</small></div>
      <form class="dl-form" data-dl-form>
        <label>Full name<input name="recipient" required maxlength="120" value="${esc(p.full_name || window.currentUser?.user_metadata?.full_name || '')}"></label>
        <label>Contact number<input name="phone" required inputmode="numeric" maxlength="11" pattern="09[0-9]{9}" placeholder="0917 123 4567" value="${esc(String(p.phone || '').replace(/\D/g, '').slice(0, 11))}"></label>
        <label>Address<textarea name="address" required rows="2" maxlength="500" placeholder="House no., street, barangay — filled from your pin"></textarea></label>
        <label class="dl-check"><input type="checkbox" name="is_default" ${list.length ? '' : 'checked'}> Use as my default address</label>
        <p class="vw-msg" role="alert"></p>
        <div class="dl-btns"><button type="button" class="dl-back" data-dl-back>Back</button><button type="submit" class="vw-claim">Save address</button></div>
      </form>`);
    try { await loadLeaflet(); } catch { sheet?.querySelector('.dl-map-wait')?.replaceChildren('The map could not load. You can still type your address.'); return; }
    const el = sheet?.querySelector('#dlMap'); if (!el) return;
    el.innerHTML = '';
    map = L.map(el, { zoomControl: true, attributionControl: true }).setView([SHOP.lat, SHOP.lng], 15);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' }).addTo(map);
    map.on('click', (e) => place(e.latlng.lat, e.latlng.lng));
    setTimeout(() => map?.invalidateSize(), 260);
  }
  function place(lat, lng) {
    const area = window.LexcDeliveryArea, say = sheet?.querySelector('[data-dl-pinmsg]');
    if (area && !area.contains(lat, lng)) { if (say) say.textContent = `We only deliver within ${area.name || 'our area'} for now.`; return; }
    pin = { lat, lng };
    if (!marker) { marker = L.marker([lat, lng], { draggable: true }).addTo(map); marker.on('dragend', () => { const p = marker.getLatLng(); place(p.lat, p.lng); }); }
    else marker.setLatLng([lat, lng]);
    if (say) say.textContent = 'Pinned. Drag the pin to adjust.';
    reverse(lat, lng);
  }
  async function reverse(lat, lng) {
    const n = ++seq;
    try {
      const res = await fetch(`https://photon.komoot.io/reverse?lat=${lat.toFixed(6)}&lon=${lng.toFixed(6)}&limit=1&lang=en`);
      const p = (await res.json()).features?.[0]?.properties; if (n !== seq || !p || !sheet) return;
      const label = [[p.housenumber, p.street || p.name].filter(Boolean).join(' '), p.district || p.locality, p.city || p.county, p.state].filter(Boolean).join(', ');
      const box = sheet.querySelector('[name="address"]'); if (box && label && !box.dataset.typed) box.value = label;
    } catch { /* the pin still saves without a street name */ }
  }
  function gps() {
    const say = sheet?.querySelector('[data-dl-pinmsg]');
    if (!navigator.geolocation) { if (say) say.textContent = 'Location is not available on this device.'; return; }
    if (say) say.textContent = 'Finding you…';
    navigator.geolocation.getCurrentPosition((p) => { map?.setView([p.coords.latitude, p.coords.longitude], 17); place(p.coords.latitude, p.coords.longitude); },
      () => { if (say) say.textContent = 'Location was not shared. Tap the map instead.'; }, { enableHighAccuracy: true, timeout: 10000 });
  }
  async function save(form) {
    const f = form.elements, msg = form.querySelector('.vw-msg'), btn = form.querySelector('[type="submit"]');
    const phone = f.phone.value.replace(/\D/g, '');
    if (!/^09\d{9}$/.test(phone)) { msg.textContent = 'Contact number: 11 digits starting with 09.'; return; }
    if (!pin) { msg.textContent = 'Drop a pin on the map first.'; return; }
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const row = { recipient: f.recipient.value.trim(), phone, address: f.address.value.trim(), lat: pin.lat, lng: pin.lng, is_default: f.is_default.checked };
      db().unwrap(await db().client.from('customer_addresses').insert(row).select().single());
      await load(); window.LexcAddressBook?.reload?.();
      showList('Address saved.');
    } catch (e) { msg.textContent = e.message || 'The address could not be saved.'; btn.disabled = false; btn.textContent = 'Save address'; }
  }
  async function onClick(ev) {
    if (ev.target === sheet || ev.target.closest('[data-dl-close]')) return close();
    if (ev.target.closest('[data-dl-add]')) return showAdd();
    if (ev.target.closest('[data-dl-back]')) return showList();
    if (ev.target.closest('[data-dl-gps]')) return gps();
    const del = ev.target.closest('[data-dl-del]'), def = ev.target.closest('[data-dl-default]');
    if (del || def) {
      (del || def).disabled = true;
      const q = del ? db().client.from('customer_addresses').delete().eq('id', del.dataset.dlDel) : db().client.from('customer_addresses').update({ is_default: true }).eq('id', def.dataset.dlDefault);
      const { error } = await q;
      try { await load(); } catch {}
      window.LexcAddressBook?.reload?.();
      showList(error ? 'That could not be changed. Try again.' : del ? 'Address removed.' : 'Default address changed.');
    }
  }
  document.addEventListener('submit', (ev) => { if (!ev.target.matches?.('[data-dl-form]')) return; ev.preventDefault(); save(ev.target); });
  document.addEventListener('input', (ev) => { if (ev.target.matches?.('.dl-form [name="address"]')) ev.target.dataset.typed = '1'; });
  window.LexcDeliveries = { open };
})();
