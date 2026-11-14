// Checkout "Payment method" row: shows the chosen method with its logo and a Change button that opens a sheet of the
// methods (the same #checkoutPaymentMethods buttons that call selectPayment, so the order flow is unchanged).
// window.LexcPayName(method) gives the short customer-facing names: GCash, MariBank, QRPh.
(function () {
  const NAMES = { gcash: 'GCash', maribank: 'MariBank', paymongo: 'QRPh' };
  const LOGOS = { gcash: 'payment/assets/gcash-logo.png', maribank: 'payment/assets/maribank-logo.png', paymongo: 'payment/assets/qrph-logo.png' };
  const NOTES = { gcash: 'Scan our GCash QR, then upload the receipt', maribank: 'Scan our MariBank QR, then upload the receipt', paymongo: 'Pay online with GCash, Maya or any bank app' };
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  window.LexcPayName = (m) => NAMES[m?.code || m] || m?.display_name || String(m || '');
  window.LexcPayLogo = (code, base = '') => LOGOS[code] ? base + LOGOS[code] : '';
  window.LexcPayNote = (code) => NOTES[code] || '';
  window.LexcPayButton = (m) => `<button type="button" class="co-option co-method" data-payment-code="${esc(m.code)}" aria-pressed="false">`
    + `<span class="co-method-logo${m.code === 'paymongo' ? ' is-wide' : ''}">${LOGOS[m.code] ? `<img src="${LOGOS[m.code]}" alt="" loading="lazy">` : esc(window.LexcPayName(m).slice(0, 1))}</span>`
    + `<span class="co-method-text"><b>${esc(window.LexcPayName(m))}</b><small>${esc(NOTES[m.code] || m.display_name || '')}</small></span><span class="co-method-tick" aria-hidden="true"></span></button>`;

  let sheet = null;
  const grid = () => document.getElementById('checkoutPaymentMethods');
  const home = () => document.getElementById('coPayHome');
  function paintRow() {
    const row = document.getElementById('coPayRow'); if (!row) return;
    const chosen = grid()?.querySelector('.co-option.selected'), code = chosen?.dataset.paymentCode;
    row.classList.toggle('is-on', Boolean(code));
    const plan = document.getElementById('coPlan'); if (plan && plan.hidden !== !code) { plan.hidden = !code; window.updateCheckoutDelivery?.(); }   // downpayment or full shows once a method is picked
    row.innerHTML = `<span class="co-tap-icon${code === 'paymongo' ? ' is-wide' : ''}" aria-hidden="true">${code && LOGOS[code] ? `<img src="${LOGOS[code]}" alt="">` : '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h3"/></svg>'}</span>
      <span class="co-tap-text"><small>Payment method</small><b>${code ? esc(NAMES[code] || chosen.querySelector('b')?.textContent || code) : 'Choose how you’ll pay'}</b>${code ? `<small>${esc(NOTES[code] || '')}</small>` : ''}</span>
      <span class="co-tap-action">${code ? 'Change' : 'Choose'} ›</span>`;
  }
  function close() { if (!sheet) return; const s = sheet; sheet = null; s.classList.remove('is-open'); setTimeout(() => { if (grid() && home()) home().append(grid()); s.remove(); }, 200); document.removeEventListener('keydown', key); paintRow(); }
  function key(ev) { if (ev.key === 'Escape') close(); }
  function open() {
    if (sheet || !grid()) return;
    sheet = document.createElement('div');
    sheet.className = 'vw-sheet co-pay-sheet'; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-label', 'Payment method');
    sheet.innerHTML = '<div class="vw-sheet-card"><header><h3>Payment method</h3><button type="button" class="vw-x" data-pay-close aria-label="Close">×</button></header><div data-pay-slot></div><p class="co-payment-hint">You pay only after LexC’s confirms your order. Payment is checked by the owner before it counts.</p></div>';
    document.body.append(sheet);
    sheet.querySelector('[data-pay-slot]').append(grid());
    requestAnimationFrame(() => sheet?.classList.add('is-open'));
    document.addEventListener('keydown', key);
    (grid().querySelector('.co-option.selected') || grid().querySelector('.co-option'))?.focus();
  }
  document.addEventListener('click', (ev) => {
    if (ev.target.closest('#coPayRow')) { ev.preventDefault(); open(); return; }
    if (sheet && (ev.target.closest('[data-pay-close]') || ev.target === sheet)) { close(); return; }
    if (sheet && ev.target.closest('#checkoutPaymentMethods [data-payment-code]')) setTimeout(close, 160);
  });
  // any way a method gets picked (tap, saved preference) updates the row
  const watch = () => { const g = grid(); if (!g) return setTimeout(watch, 300); new MutationObserver(paintRow).observe(g, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] }); paintRow(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch); else watch();
})();
