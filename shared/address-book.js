// Saved addresses at checkout (phase 109, public.customer_addresses — each customer sees only their own).
// A card at the top of the contact details shows the chosen address (name, phone, address); tapping it opens the
// list to pick another or add a new one. Picking one fills Full name, Contact number, Address and the map pin.
// After a delivery order is placed, its address is saved (or the matching saved one is updated) for next time.
(function () {
  let list = null, chosen = null, loadedFor = '';
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const user = () => (typeof currentUser !== 'undefined' && currentUser) || null;
  const $ = (id) => document.getElementById(id);
  const norm = (t) => String(t || '').toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9 ]/g, '').trim();
  const PIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12Z"/><circle cx="12" cy="10" r="2.6"/></svg>';

  async function load(force) {
    const u = user(); if (!u || !window.LexcBackend) return [];
    if (list && loadedFor === u.id && !force) return list;
    try {
      const { data, error } = await window.LexcBackend.client.from('customer_addresses').select('*').order('is_default', { ascending: false }).order('updated_at', { ascending: false });
      if (error) throw error;
      list = data || []; loadedFor = u.id;
      // the account details (Profile → Account details) are offered too, unless a saved address already matches
      let p = window.currentProfile;
      if (!p || p.id !== u.id) { const r = await window.LexcBackend.client.from('profiles').select('id,full_name,phone,address').eq('id', u.id).maybeSingle(); p = r.data; if (p) window.currentProfile = p; }
      const phone = String(p?.phone || '').replace(/\D/g, '');
      if (p?.full_name && phone && p.address && !list.some((a) => norm(a.address) === norm(p.address)))
        list.push({ id: 'profile', recipient: p.full_name, phone, address: p.address, lat: null, lng: null, fromProfile: true });
    } catch (error) { console.info('Saved addresses not available yet:', error?.message || error); list = []; }
    return list;
  }
  function fill(a) {
    chosen = a;
    if (!a) { paint(); return; }
    $('coName').value = a.recipient; $('coContact').value = a.phone;
    if ($('coAddress')) $('coAddress').value = a.address;
    if (a.lat != null && a.lng != null) window.LexcCheckoutMap?.usePin(Number(a.lat), Number(a.lng), a.label || '');
    paint();
    window.LexcCheckoutChecks?.refresh?.();
  }
  function card() {
    let el = $('coSavedAddress');
    if (!el) {
      const slot = $('coSavedSlot'), anchor = $('coName')?.closest('.co-field-group,.co-step'); if (!slot && !anchor) return null;
      el = document.createElement('button'); el.type = 'button'; el.id = 'coSavedAddress'; el.className = 'co-addr-card'; el.setAttribute('aria-haspopup', 'dialog');
      el.addEventListener('click', openSheet);
      if (slot) slot.append(el); else anchor.before(el);   // under Delivery address: “Use saved address”
    }
    return el;
  }
  function paint() {
    const el = card(); if (!el) return;
    el.hidden = !list || !list.length;
    if (el.hidden) return;
    const a = chosen;
    el.innerHTML = a
      ? `<span class="co-addr-pin">${PIN}</span><span class="co-addr-text"><b>${esc(a.recipient)}</b> <small>${esc(a.phone)}</small><span>${esc(a.address)}</span></span><span class="co-addr-go" aria-hidden="true">›</span>`
      : `<span class="co-addr-pin">${PIN}</span><span class="co-addr-text"><b>Use saved address</b><span>${list.length} saved · tap to choose</span></span><span class="co-addr-go" aria-hidden="true">⌄</span>`;
    el.setAttribute('aria-label', a ? `Address: ${a.recipient}, ${a.address}. Change` : 'Choose a saved address');
  }
  let sheet = null;
  function closeSheet() { if (!sheet) return; const s = sheet; sheet = null; s.classList.remove('is-open'); setTimeout(() => s.remove(), 200); }
  async function openSheet() {
    await load();
    sheet = document.createElement('div');
    sheet.className = 'vw-sheet'; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-label', 'Choose an address');
    sheet.innerHTML = `<div class="vw-sheet-card co-addr-sheet"><header><h3>Address selection</h3><button type="button" class="vw-x" data-addr-close aria-label="Close">×</button></header>
      <div class="co-addr-list" role="radiogroup">${list.map((a) => `<div class="co-addr-row"><button type="button" role="radio" class="co-addr-opt" data-addr="${a.id}" aria-checked="${chosen?.id === a.id}">
        <i aria-hidden="true"></i><span><b>${esc(a.recipient)}</b> <small>${esc(a.phone)}</small><span>${esc(a.address)}</span>${a.is_default ? '<em>Default</em>' : ''}${a.fromProfile ? '<em>Account details</em>' : ''}</span></button>
        ${a.fromProfile ? '' : `<button type="button" class="co-addr-del" data-addr-del="${a.id}" aria-label="Remove this address">Remove</button>`}</div>`).join('')}</div>
      <button type="button" class="co-addr-new" data-addr-new>+ Use a new address</button></div>`;
    document.body.append(sheet);
    requestAnimationFrame(() => sheet?.classList.add('is-open'));
    sheet.addEventListener('click', async (ev) => {
      if (ev.target === sheet || ev.target.closest('[data-addr-close]')) return closeSheet();
      const pick = ev.target.closest('[data-addr]');
      if (pick) { fill(list.find((a) => a.id === pick.dataset.addr)); return closeSheet(); }
      if (ev.target.closest('[data-addr-new]')) { chosen = null; ['coName', 'coContact', 'coAddress'].forEach((id) => { if ($(id)) $(id).value = ''; }); paint(); closeSheet(); $('coName')?.focus(); return; }
      const del = ev.target.closest('[data-addr-del]');
      if (del) {
        del.disabled = true;
        const { error } = await window.LexcBackend.client.from('customer_addresses').delete().eq('id', del.dataset.addrDel);
        if (error) { del.disabled = false; return window.showToast?.('That address could not be removed.'); }
        if (chosen?.id === del.dataset.addrDel) chosen = null;
        await load(true); closeSheet(); paint(); if (list.length) openSheet();
      }
    });
  }
  // checkout opened: show the card and pre-fill the default address when the form is still empty
  // contact number boxes: digits only, at most 11 (09XXXXXXXXX)
  document.addEventListener('input', (ev) => {
    const el = ev.target; if (!el.matches?.('#coContact, input[type="tel"], input[name="phone"]')) return;
    const v = el.value.replace(/\D/g, '').slice(0, 11); if (v !== el.value) el.value = v;
  });
  async function prepare() {
    window.LexcInspiration?.register('checkout', () => refs, (paths) => { refs = paths; drawRefs(); }, () => {});   // inspiration.js loads after this file
    drawRefs();
    const l = await load(true);
    if (l.length && !chosen && !$('coName')?.value && !$('coAddress')?.value) fill(l[0]);
    else {
      // no saved addresses: still prefill from the account details
      const p = window.currentProfile;
      if (p && !l.length) { if ($('coName') && !$('coName').value && p.full_name) $('coName').value = p.full_name; if ($('coContact') && !$('coContact').value && p.phone) $('coContact').value = String(p.phone).replace(/\D/g, '').slice(0, 11); window.LexcCheckoutChecks?.refresh?.(); }
      paint();
    }
  }
  // after an order is placed with delivery: remember this address
  async function remember() {
    const u = user(); if (!u || !window.LexcBackend) return;
    const recipient = $('coName')?.value.trim(), phone = $('coContact')?.value.trim(), address = $('coAddress')?.value.trim();
    if (!recipient || !phone || !address || address.length < 5) return;
    const pin = window.LexcCheckoutMap?.pin || null;
    try {
      await load();
      const same = list.find((a) => norm(a.address) === norm(address));
      const row = { recipient, phone, address, lat: pin?.lat ?? same?.lat ?? null, lng: pin?.lng ?? same?.lng ?? null, is_default: true };
      const q = same ? window.LexcBackend.client.from('customer_addresses').update(row).eq('id', same.id) : window.LexcBackend.client.from('customer_addresses').insert(row);
      const { error } = await q; if (error) throw error;
      await load(true);
    } catch (error) { console.info('Address not saved:', error?.message || error); }
  }
  
  // "Have a reference photo?" under Special notes (shared/inspiration.js, owner 'checkout'); attached after the order is placed
  let refs = [];
  const drawRefs = () => { const box = $('coRefPhotos'); if (box && window.LexcInspiration) box.innerHTML = window.LexcInspiration.html('checkout', refs, { title: 'Have a reference photo?', note: 'Add a picture of the look you want. LexC’s sees it with your order.' }); };
  window.LexcCheckoutRefs = { take: () => { const out = refs; refs = []; drawRefs(); return out; } };
  // Profile → Explore → Addresses: save address slots, pick the default (it fills in at checkout), remove old ones
  function manageHtml(adding) {
    const p = window.currentProfile || {}, saved = (list || []).filter((a) => !a.fromProfile && a.customer_id === user()?.id);
    const rows = saved.map((a) => `<div class="co-addr-row"><button type="button" role="radio" class="co-addr-opt" data-addr-use="${a.id}" aria-checked="${!!a.is_default}">
      <i aria-hidden="true"></i><span><b>${esc(a.label ? a.label + ' · ' : '')}${esc(a.recipient)}</b> <small>${esc(a.phone)}</small><span>${esc(a.address)}</span>${a.is_default ? '<em>Default · used at checkout</em>' : ''}</span></button>
      <button type="button" class="co-addr-del" data-addr-del="${a.id}" aria-label="Remove this address">Remove</button></div>`).join('');
    const form = `<form class="co-addr-form" data-addr-form><input class="co-input" name="label" maxlength="40" placeholder="Label (e.g. Home, Work)">
      <input class="co-input" name="recipient" required maxlength="120" placeholder="Full name *" value="${esc(p.full_name || '')}">
      <input class="co-input" name="phone" type="tel" inputmode="numeric" required maxlength="11" placeholder="Contact number *" value="${esc(String(p.phone || '').replace(/\D/g, '').slice(0, 11))}">
      <textarea class="co-input co-textarea" name="address" required minlength="5" maxlength="500" rows="2" placeholder="House no., street, barangay, city *"></textarea>
      <div class="co-addr-form-actions"><button type="button" class="co-addr-cancel" data-addr-cancel>Cancel</button><button type="submit" class="btn-primary">Save address</button></div></form>`;
    return `<div class="vw-sheet-card co-addr-sheet"><header><h3>My addresses</h3><button type="button" class="vw-x" data-addr-close aria-label="Close">×</button></header>
      ${saved.length ? `<p class="co-addr-hint">Tap an address to make it your default. It fills in when you check out.</p><div class="co-addr-list" role="radiogroup" aria-label="Saved addresses">${rows}</div>` : '<p class="co-addr-hint">No saved addresses yet. Add one to fill it in at checkout.</p>'}
      ${adding || !saved.length ? form : '<button type="button" class="co-addr-new" data-addr-add>+ Add address</button>'}</div>`;
  }
  async function manage() {
    if (!user()) return window.navigate?.('login');
    await load(true);
    const s = document.createElement('div'); sheet = s;
    s.className = 'vw-sheet'; s.setAttribute('role', 'dialog'); s.setAttribute('aria-modal', 'true'); s.setAttribute('aria-label', 'My addresses');
    let adding = false; const draw = () => { s.innerHTML = manageHtml(adding); };
    draw(); document.body.append(s); requestAnimationFrame(() => s.classList.add('is-open'));
    const db = () => window.LexcBackend.client.from('customer_addresses');
    s.addEventListener('click', async (ev) => {
      if (ev.target === s || ev.target.closest('[data-addr-close]')) return closeSheet();
      if (ev.target.closest('[data-addr-add]')) { adding = true; draw(); s.querySelector('[name="label"]')?.focus(); return; }
      if (ev.target.closest('[data-addr-cancel]')) { adding = false; draw(); return; }
      const use = ev.target.closest('[data-addr-use]');
      if (use) {
        if (use.getAttribute('aria-checked') === 'true') return;
        const { error } = await db().update({ is_default: true }).eq('id', use.dataset.addrUse);
        if (error) return window.showToast?.('That address could not be set as default.');
        chosen = null; await load(true); draw(); return window.showToast?.('Default address updated. It fills in at checkout.');
      }
      const del = ev.target.closest('[data-addr-del]');
      if (del) {
        if (!confirm('Remove this address?')) return;
        del.disabled = true;
        const { error } = await db().delete().eq('id', del.dataset.addrDel);
        if (error) { del.disabled = false; return window.showToast?.('That address could not be removed.'); }
        if (chosen?.id === del.dataset.addrDel) chosen = null;
        await load(true); draw();
      }
    });
    s.addEventListener('submit', async (ev) => {
      ev.preventDefault(); const f = ev.target, v = (n) => f.elements[n].value.trim(), btn = f.querySelector('[type=submit]');
      if (!/^09\d{9}$/.test(v('phone'))) return window.showToast?.('Enter an 11-digit mobile number (09XXXXXXXXX).');
      btn.disabled = true; btn.textContent = 'Saving…';
      const first = !(list || []).some((a) => !a.fromProfile && a.customer_id === user()?.id);
      const { error } = await db().insert({ label: v('label') || null, recipient: v('recipient'), phone: v('phone'), address: v('address'), is_default: first });
      if (error) { btn.disabled = false; btn.textContent = 'Save address'; return window.showToast?.('That address could not be saved.'); }
      adding = false; await load(true); draw(); window.showToast?.('Address saved.');
    });
  }
  window.LexcAddressBook = { prepare, remember, manage, reload: () => load(true).then(paint) };
})();
