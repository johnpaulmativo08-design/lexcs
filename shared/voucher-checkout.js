// Vouchers for customers (phases 103 + 105).
//  · Checkout: a "Select a voucher · N available" row opens a sheet of ticket cards (public.available_vouchers, which
//    says if each one fits the cart and what it saves) plus a box for typing any code. Picking one runs
//    public.preview_voucher; the code goes with the order and public.create_order checks and applies it again, so the
//    browser never decides the discount.
//  · Pop-up: a signed-in customer sees new vouchers the owner chose to show, once; "Claim now" keeps them on this
//    device so they sit at the top of the checkout list. (Claiming reserves nothing; the usual limits still apply.)
// window.LexcVoucher = { code(), discount(), reset() } — read by updateCheckoutDelivery (totals) and submitCheckout.
(function () {
  let applied = null;   // { code, discount, description }
  let wallet = null, walletFor = '', loading = null;
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const short = (n) => '₱' + Number(n || 0).toLocaleString('en-PH', { maximumFractionDigits: 2 });
  const day = (iso) => new Date(iso).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric' });
  const user = () => (typeof currentUser !== 'undefined' && currentUser) || window.currentUser || null;
  const items = () => (typeof cartSelectedItems === 'function' ? cartSelectedItems() : []).filter((c) => c.variant_id || c.variantId)
    .map((c) => ({ variant_id: c.variant_id || c.variantId, qty: c.qty }));
  const store = (k, v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || '[]'); localStorage.setItem(k, JSON.stringify(v)); } catch { return []; } };
  const claimedKey = () => 'lexc-vouchers-claimed:' + (user()?.id || ''), seenKey = () => 'lexc-vouchers-seen:' + (user()?.id || '');
  const offer = (v) => v.type === 'percent' ? `${Number(v.value)}% off` : `${short(v.value)} off`;
  const terms = (v) => [Number(v.min_purchase) > 0 ? `Min. ${short(v.min_purchase)}` : '', v.type === 'percent' && v.max_discount ? `up to ${short(v.max_discount)}` : '',
    v.ends_at ? `until ${day(v.ends_at)}` : ''].filter(Boolean).join(' · ') || 'No minimum';
  const ticket = (v, extra = '') => `<span class="vw-stub" aria-hidden="true">${v.type === 'percent' ? '%' : '₱'}</span><span class="vw-text"><b>${esc(offer(v))}</b><small>${esc(v.description || terms(v))}</small>${v.description ? `<small class="vw-terms">${esc(terms(v))}</small>` : ''}</span>${extra}`;

  async function loadWallet(withItems) {
    if (!user() || !window.LexcBackend) return [];
    const key = (user().id || '') + JSON.stringify(withItems ? items() : []);
    if (wallet && walletFor === key) return wallet;
    if (loading?.key === key) return loading.p;
    const p = window.LexcBackend.rpc('available_vouchers', { items: withItems ? items() : [] })
      .then((list) => { wallet = Array.isArray(list) ? list : []; walletFor = key; return wallet; })
      .catch((error) => { console.warn('Vouchers:', error); return []; })
      .finally(() => { loading = null; });
    loading = { key, p };
    return p;
  }

  // ---- checkout row ------------------------------------------------------------------------------------------
  function box() { return document.getElementById('coVoucher'); }
  function paint(message, tone) {
    const el = box(); if (!el) return;
    const fits = (wallet || []).filter((v) => v.fits).length;
    el.innerHTML = `<button type="button" class="co-tap co-tap--voucher${applied ? ' is-on' : ''}" data-voucher-open aria-haspopup="dialog">
      <span class="co-tap-icon co-tap-icon--voucher" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4Z"/><path d="m9 15 6-6"/></svg><small>Voucher</small></span>
      <span class="co-tap-text">${applied ? `<b>${esc(applied.code)} · −${money(applied.discount)}</b><small>${esc(applied.description || 'Voucher applied')}</small>` : `<b>Select a voucher</b><small>${wallet ? (fits ? `${fits} available for this order` : 'Have a code? Type it here') : 'See vouchers for this order'}</small>`}</span>
      <span class="co-tap-action">${applied ? 'Change' : 'Select'}</span></button>`;
    const note = document.createElement('p');
    note.className = 'co-voucher-msg' + (tone ? ' is-' + tone : ''); note.setAttribute('role', 'status'); note.textContent = message || '';
    el.append(note);
    const row = document.getElementById('checkoutDiscountRow');
    if (row) { row.hidden = !applied; row.querySelector('[data-discount]').textContent = applied ? '−' + money(applied.discount) : ''; row.querySelector('[data-discount-code]').textContent = applied ? applied.code : ''; }
    window.updateCheckoutDelivery?.();
  }
  async function apply(code, button) {
    code = String(code || '').trim().toUpperCase();
    if (!code) { sheetSay('Type a voucher code first.'); return false; }
    if (!items().length) { sheetSay('Select at least one cart item first.'); return false; }
    const label = button?.textContent; if (button) { button.disabled = true; button.textContent = 'Checking…'; }
    try {
      const res = await window.LexcBackend.rpc('preview_voucher', { voucher_code: code, items: items() });
      applied = { code: res.code, discount: Number(res.discount), description: res.description || '' };
      closeSheet(); paint(`Voucher applied. You save ${money(applied.discount)}.`, 'ok');
      return true;
    } catch (error) {
      sheetSay(/preview_voucher|schema cache/i.test(error.message || '') ? 'Vouchers aren’t available yet.' : error.message || 'That voucher couldn’t be applied.');
      if (button) { button.disabled = false; button.textContent = label; }
      return false;
    }
  }

  // ---- the voucher sheet -------------------------------------------------------------------------------------
  let sheet = null;
  function sheetSay(t) { const p = sheet?.querySelector('.vw-msg'); if (p) p.textContent = t || ''; }
  function closeSheet() { if (!sheet) return; const s = sheet; sheet = null; s.classList.remove('is-open'); setTimeout(() => s.remove(), 220); document.removeEventListener('keydown', onKey); }
  function onKey(ev) { if (ev.key === 'Escape') closeSheet(); }
  async function openSheet() {
    if (!user()) { window.openAuthModal?.('login'); return; }
    closeSheet();
    sheet = document.createElement('div');
    sheet.className = 'vw-sheet'; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-label', 'Vouchers');
    sheet.innerHTML = `<div class="vw-sheet-card"><header><h3>Vouchers</h3><button type="button" class="vw-x" data-vw-close aria-label="Close">×</button></header>
      <div class="vw-list" data-vw-list>${'<span class="vw-skel skel" aria-hidden="true"></span>'.repeat(2)}</div>
      <form class="vw-code" data-vw-form><label for="vwCode">Have a code?</label><div><input id="vwCode" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="30" placeholder="SWEET10"><button type="submit">Apply</button></div></form>
      <p class="vw-msg" role="alert"></p>${applied ? '<button type="button" class="vw-remove" data-voucher-remove>Remove voucher</button>' : ''}</div>`;
    document.body.append(sheet);
    requestAnimationFrame(() => sheet?.classList.add('is-open'));
    document.addEventListener('keydown', onKey);
    const list = await loadWallet(true); if (!sheet) return;
    const claimed = new Set(store(claimedKey()));
    const sorted = [...list].sort((a, b) => (b.fits - a.fits) || (claimed.has(b.code) - claimed.has(a.code)) || (Number(b.discount || 0) - Number(a.discount || 0)));
    sheet.querySelector('[data-vw-list]').innerHTML = sorted.length ? sorted.map((v) => `<button type="button" class="vw-ticket${v.fits ? '' : ' is-off'}${applied?.code === v.code ? ' is-on' : ''}" data-vw-pick="${esc(v.code)}" ${v.fits ? '' : 'aria-disabled="true"'}>
        ${ticket(v, `<span class="vw-pick">${applied?.code === v.code ? 'Applied' : v.fits ? `Save ${money(v.discount)}` : 'Not for this cart'}</span>`)}${v.fits ? '' : `<small class="vw-why">${esc(v.reason || '')}</small>`}${claimed.has(v.code) ? '<em class="vw-claimed">Claimed</em>' : ''}</button>`).join('')
      : '<p class="vw-empty">No vouchers for you right now. Have a code? Type it below.</p>';
    paint();
  }
  document.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-voucher-open]')) { ev.preventDefault(); openSheet(); return; }
    if (ev.target.closest('[data-vw-close]') || ev.target === sheet) { closeSheet(); return; }
    if (ev.target.closest('[data-voucher-remove]')) { ev.preventDefault(); applied = null; closeSheet(); paint('Voucher removed.'); return; }
    const pick = ev.target.closest('[data-vw-pick]');
    if (pick) { ev.preventDefault(); if (pick.getAttribute('aria-disabled') === 'true') { sheetSay(pick.querySelector('.vw-why')?.textContent || 'This voucher doesn’t fit this cart.'); return; } apply(pick.dataset.vwPick, pick.querySelector('.vw-pick')); }
  });
  document.addEventListener('submit', (ev) => { if (!ev.target.matches('[data-vw-form]')) return; ev.preventDefault(); apply(ev.target.querySelector('input').value, ev.target.querySelector('button')); });

  // the cart changed: the discount is checked again so the shown total stays right
  let last = '';
  setInterval(async () => {
    if (!document.getElementById('page-checkout')?.classList.contains('active')) return;
    const now = JSON.stringify(items()); if (now === last) return; last = now;
    await loadWallet(true);
    if (applied) {
      const keep = applied.code;
      try { const res = await window.LexcBackend.rpc('preview_voucher', { voucher_code: keep, items: items() }); applied = { code: res.code, discount: Number(res.discount), description: res.description || '' }; paint(); }
      catch (error) { applied = null; paint(`${keep} was removed: ${error.message || 'it no longer fits this cart.'}`, 'bad'); }
    } else paint();
  }, 1500);

  // ---- the "vouchers for you" pop-up ------------------------------------------------------------------------
  async function popup() {
    if (!user() || document.querySelector('.vw-pop') || /cms=/.test(location.search)) return;
    const page = document.querySelector('.page.active')?.id || '';
    if (page && !/home|shop/.test(page)) return;
    const list = (await loadWallet(false)).slice(0, 3); if (!list.length) return;
    const seen = new Set(store(seenKey())), fresh = list.filter((v) => !seen.has(v.code));
    if (!fresh.length) return;
    const best = fresh.reduce((a, v) => (v.type === 'percent' ? Number(v.value) : 0) > (a.type === 'percent' ? Number(a.value) : 0) ? v : a, fresh[0]);
    const pop = document.createElement('div');
    pop.className = 'vw-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-modal', 'true'); pop.setAttribute('aria-labelledby', 'vwPopTitle');
    pop.innerHTML = `<div class="vw-pop-wrap"><div class="vw-pop-burst" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>
      <div class="vw-pop-card"><span class="vw-pop-gift" aria-hidden="true"><svg viewBox="0 0 64 64"><rect x="10" y="26" width="44" height="30" rx="5" fill="#f5b7cf"/><rect x="6" y="18" width="52" height="12" rx="4" fill="#c9a7ef"/><rect x="29" y="18" width="6" height="38" fill="#fff" opacity=".85"/><path d="M32 18c-6-10-17-8-14-1 2 4 9 3 14 1Zm0 0c6-10 17-8 14-1-2 4-9 3-14 1Z" fill="#a37ae0"/></svg></span>
        <h2 id="vwPopTitle">Sweet deals for you</h2><p>${fresh.length === 1 ? 'A voucher' : `${fresh.length} vouchers`} for your next order${best.type === 'percent' ? ` — up to ${Number(best.value)}% off` : ''}.</p>
        <div class="vw-pop-list">${fresh.map((v) => `<div class="vw-ticket vw-ticket--pop">${ticket(v)}</div>`).join('')}</div>
        <button type="button" class="vw-claim" data-vw-claim>Claim now</button></div>
      <button type="button" class="vw-pop-x" data-vw-pop-close aria-label="Close">×</button></div>`;
    document.body.append(pop);
    requestAnimationFrame(() => pop.classList.add('is-open'));
    const done = (claim) => {
      store(seenKey(), [...new Set([...seen, ...fresh.map((v) => v.code)])].slice(-100));
      if (claim) { store(claimedKey(), [...new Set([...store(claimedKey()), ...fresh.map((v) => v.code)])].slice(-100)); (window.showToast || (() => {}))('Vouchers saved. Pick one at checkout.'); }
      pop.classList.remove('is-open'); setTimeout(() => pop.remove(), 240); document.removeEventListener('keydown', key);
    };
    const key = (ev) => { if (ev.key === 'Escape') done(false); };
    document.addEventListener('keydown', key);
    pop.querySelector('[data-vw-claim]').onclick = () => done(true);
    pop.querySelector('[data-vw-pop-close]').onclick = () => done(false);
    pop.addEventListener('click', (ev) => { if (ev.target === pop) done(false); });
    pop.querySelector('[data-vw-claim]').focus();
  }
  // once per signed-in account per page load (also right after logging in)
  let shownFor = '';
  setInterval(() => { const id = user()?.id || ''; if (id && id !== shownFor) { shownFor = id; wallet = null; setTimeout(popup, 1200); } else if (!id) shownFor = ''; }, 2000);

  // Account → Vouchers: every voucher the customer can use, to look at (they are applied at checkout)
  async function browse() {
    if (!user()) { window.openAuthModal?.('login'); return; }
    closeSheet();
    sheet = document.createElement('div');
    sheet.className = 'vw-sheet'; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-label', 'My vouchers');
    sheet.innerHTML = `<div class="vw-sheet-card"><header><h3>My vouchers</h3><button type="button" class="vw-x" data-vw-close aria-label="Close">×</button></header>
      <div class="vw-list" data-vw-list>${'<span class="vw-skel skel" aria-hidden="true"></span>'.repeat(2)}</div>
      <p class="vw-msg">Pick a voucher at checkout, under Voucher.</p><button type="button" class="vw-claim" data-vw-shop>Shop now</button></div>`;
    document.body.append(sheet);
    requestAnimationFrame(() => sheet?.classList.add('is-open'));
    document.addEventListener('keydown', onKey);
    sheet.querySelector('[data-vw-shop]').onclick = () => { closeSheet(); window.navigate?.('shop'); };
    wallet = null; const list = await loadWallet(false); if (!sheet) return;
    sheet.querySelector('[data-vw-list]').innerHTML = list.length ? list.map((v) => `<div class="vw-ticket vw-ticket--pop">${ticket(v, `<span class="vw-pick">${esc(v.code)}</span>`)}</div>`).join('')
      : '<p class="vw-empty">No vouchers for you right now. New deals show up here.</p>';
  }
  window.LexcVoucher = { browse, code: () => applied?.code || null, discount: () => applied?.discount || 0, reset: () => { applied = null; wallet = null; paint(); }, popup };
  document.addEventListener('DOMContentLoaded', () => paint());
  if (document.readyState !== 'loading') paint();
})();
