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
      const anchor = $('coName')?.closest('.co-field-group'); if (!anchor) return null;
      el = document.createElement('button'); el.type = 'button'; el.id = 'coSavedAddress'; el.className = 'co-addr-card'; el.setAttribute('aria-haspopup', 'dialog');
      el.addEventListener('click', openSheet);
      anchor.before(el);
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
      : `<span class="co-addr-pin">${PIN}</span><span class="co-addr-text"><b>Use a saved address</b><span>${list.length} saved · tap to choose</span></span><span class="co-addr-go" aria-hidden="true">›</span>`;
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
        <i aria-hidden="true"></i><span><b>${esc(a.recipient)}</b> <small>${esc(a.phone)}</small><span>${esc(a.address)}</span>${a.is_default ? '<em>Default</em>' : ''}</span></button>
        <button type="button" class="co-addr-del" data-addr-del="${a.id}" aria-label="Remove this address">Remove</button></div>`).join('')}</div>
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
  async function prepare() {
    const l = await load(true);
    if (l.length && !chosen && !$('coName')?.value && !$('coAddress')?.value) fill(l[0]); else paint();
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
  
  window.LexcAddressBook = { prepare, remember, reload: () => load(true).then(paint) };
})();
