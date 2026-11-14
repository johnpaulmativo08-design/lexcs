// Reservation first: customers pick the date and receiving time BEFORE the cart and checkout.
// The home page's first button and a strip at the top of the cart open the same calendar as checkout (open dates and
// the free hourly slots from the database). The choice is kept for this visit (sessionStorage) and fills checkout's
// date and time; checkout still lets them change it, and the database re-checks the slot when the order is placed.
(function () {
  const KEY = 'lexc_reservation';
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const get = () => { try { return JSON.parse(sessionStorage.getItem(KEY)) || null; } catch { return null; } };
  const save = (v) => { try { v ? sessionStorage.setItem(KEY, JSON.stringify(v)) : sessionStorage.removeItem(KEY); } catch { /* private mode: the choice still fills checkout now */ } paint(); };
  const dayText = (d) => (typeof bookingDateLabel === 'function' ? bookingDateLabel(d) : d);
  const CAL = '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>';
  let then = null;

  // the calendar's Confirm: remember the choice everywhere, then continue (e.g. on to checkout)
  const baseConfirm = window.confirmDateTime;
  window.confirmDateTime = function () {
    if (!selectedSlotId || !dtSelectedDate) return;
    const choice = { date: dtSelectedDate, slotId: selectedSlotId, label: dtSelectedSlot };
    baseConfirm();
    save(choice);
    const next = then; then = null; next?.();
  };
  const baseClose = window.closeDateTimeModal;
  // closing the calendar without confirming drops the pending "then" (Confirm reads it before this timer runs)
  window.closeDateTimeModal = function (e) { baseClose(e); if (!document.getElementById('dtModalOverlay').classList.contains('open')) setTimeout(() => { then = null; }, 0); };
  function pick(next) { then = next || null; openDateTimeModal(); }

  // fill checkout's date and time from the choice (only when checkout has none yet)
  function apply() {
    const r = get(), date = document.getElementById('coDate'); if (!r || !date || date.value) return;
    date.value = r.date; date.dataset.slotId = r.slotId; document.getElementById('coTime').value = r.label;
    document.getElementById('coDateLabel').textContent = dayText(r.date); document.getElementById('coTimeLabel').textContent = r.label;
    try { updateCheckoutDelivery(); } catch { /* totals refresh on the next change */ }
  }

  // the cart's Order summary: the receiving date & time sits above the subtotal; without one, checkout asks for it first
  function paint() {
    const box = document.getElementById('cartReservation'); if (!box) return;
    const r = get(), btn = document.getElementById('cartCheckoutBtn');
    box.innerHTML = r
      ? `<span class="rsv-ic">${CAL}</span><span class="rsv-txt"><small>Receiving</small><b>${esc(dayText(r.date))} · ${esc(r.label)}</b></span><button type="button" data-rsv-pick class="rsv-change">Change</button>`
      : `<span class="rsv-ic">${CAL}</span><span class="rsv-txt"><small>Receiving</small><b>Pick a date &amp; time</b></span>`;
    box.classList.toggle('is-empty', !r);
    if (btn) btn.textContent = r ? 'Proceed to checkout →' : 'Choose date & time →';
  }
  document.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-rsv-pick]')) { ev.preventDefault(); pick(); }
  });

  // Checkout from the cart: no reservation yet → the calendar opens first, then checkout
  const baseCheckout = window.goToCheckout;
  window.goToCheckout = function () {
    if (cart.length && cartSelectedItems().length && !get() && !document.getElementById('coDate')?.value) { closeCart(); pick(() => baseCheckout()); showToast('Pick your date and time first.'); return; }
    return baseCheckout();
  };
  const baseNavigate = window.navigate;
  window.navigate = function (page, anchor) { const out = baseNavigate(page, anchor); if (page === 'checkout') apply(); return out; };

  window.LexcReservation = { get, pick, apply, paint, clear: () => save(null) };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', paint); else paint();
})();
