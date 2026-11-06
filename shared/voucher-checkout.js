// Voucher code at checkout (phase 103). The customer types a code and taps Apply; public.preview_voucher checks it
// against the selected cart items and returns the discount (nothing is reserved). The code is sent with the order;
// public.create_order checks it again and applies it in the same step, so the browser never decides the discount.
// window.LexcVoucher = { code(), discount() } — read by updateCheckoutDelivery (totals) and submitCheckout (payload).
(function () {
  let applied = null;   // { code, discount, description }
  const money = (n) => '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const items = () => (typeof cartSelectedItems === 'function' ? cartSelectedItems() : []).filter((c) => c.variant_id || c.variantId)
    .map((c) => ({ variant_id: c.variant_id || c.variantId, qty: c.qty }));
  function box() { return document.getElementById('coVoucher'); }
  function paint(message, tone) {
    const el = box(); if (!el) return;
    el.innerHTML = applied
      ? `<div class="co-voucher-on"><span class="co-voucher-tag">${applied.code}</span><span><b>−${money(applied.discount)}</b>${applied.description ? `<small>${applied.description.replace(/[&<>"']/g, '')}</small>` : ''}</span><button type="button" class="co-voucher-remove" data-voucher-remove>Remove</button></div>`
      : `<label class="co-voucher-label" for="coVoucherCode">Voucher code</label><div class="co-voucher-row"><input id="coVoucherCode" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="30" placeholder="SWEET10"><button type="button" class="co-voucher-apply" data-voucher-apply>Apply</button></div>`;
    const note = document.createElement('p');
    note.className = 'co-voucher-msg' + (tone ? ' is-' + tone : ''); note.setAttribute('role', 'status'); note.textContent = message || '';
    el.append(note);
    const row = document.getElementById('checkoutDiscountRow');
    if (row) { row.hidden = !applied; row.querySelector('[data-discount]').textContent = applied ? '−' + money(applied.discount) : ''; row.querySelector('[data-discount-code]').textContent = applied ? applied.code : ''; }
    window.updateCheckoutDelivery?.();
  }
  async function apply() {
    const input = document.getElementById('coVoucherCode'), code = (input?.value || '').trim().toUpperCase();
    if (!code) { paint('Type a voucher code first.', 'bad'); document.getElementById('coVoucherCode')?.focus(); return; }
    if (!items().length) { paint('Select at least one cart item first.', 'bad'); return; }
    const button = box().querySelector('[data-voucher-apply]'); if (button) { button.disabled = true; button.textContent = 'Checking…'; }
    try {
      const res = await window.LexcBackend.rpc('preview_voucher', { voucher_code: code, items: items() });
      applied = { code: res.code, discount: Number(res.discount), description: res.description || '' };
      paint(`Voucher applied. You save ${money(applied.discount)}.`, 'ok');
    } catch (error) {
      applied = null;
      paint(/preview_voucher|schema cache/i.test(error.message || '') ? 'Vouchers aren’t available yet.' : error.message || 'That voucher couldn’t be applied.', 'bad');
      const again = document.getElementById('coVoucherCode'); if (again) { again.value = code; again.focus(); }
    }
  }
  document.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-voucher-apply]')) { ev.preventDefault(); apply(); }
    if (ev.target.closest('[data-voucher-remove]')) { ev.preventDefault(); applied = null; paint('Voucher removed.'); }
  });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target.id === 'coVoucherCode') { ev.preventDefault(); apply(); } });
  // the cart changed: the discount is checked again so the shown total stays right
  let last = '';
  setInterval(() => {
    if (!applied || !document.getElementById('page-checkout')?.classList.contains('active')) return;
    const now = JSON.stringify(items()); if (now === last) return; last = now;
    const keep = applied.code; applied = null;
    const input = () => document.getElementById('coVoucherCode');
    paint(); if (input()) { input().value = keep; apply(); }
  }, 1500);
  window.LexcVoucher = { code: () => applied?.code || null, discount: () => applied?.discount || 0, reset: () => { applied = null; paint(); } };
  document.addEventListener('DOMContentLoaded', () => paint());
  if (document.readyState !== 'loading') paint();
})();
