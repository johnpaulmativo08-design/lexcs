// Cancel an order (phase 109): the customer picks a reason; the window says the daily rule before every
// cancellation — up to 3 a day; a 4th pauses new orders for 8 hours — and warns strongly when this one is the 4th.
// The database counts and pauses (public.cancel_my_order_with_reason); this window only explains it.
// window.LexcCancelOrder({ id, number, paid }) → resolves true when the order was cancelled.
(function () {
  const REASONS = ['Changed my mind', 'Wrong date or time', 'Wrong item, size or design', 'Found a better price or option', 'The total is higher than expected', 'Can’t pay on time', 'Ordered by mistake (duplicate)', 'Other'];
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const peso = (n) => '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const when = (t) => new Date(t).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const db = () => window.LexcBackend;
  const user = () => (typeof currentUser !== 'undefined' && currentUser) || null;

  async function countToday() {
    try {
      const start = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }) + 'T00:00:00+08:00').toISOString();
      const { count, error } = await db().client.from('order_cancellations').select('id', { count: 'exact', head: true }).eq('customer_id', user()?.id).gte('created_at', start);
      if (error) throw error; return count || 0;
    } catch { return null; }   // phase 109 not there yet: the rule text still shows
  }

  function ask({ number, paid }, done) {
    return new Promise((resolve) => {
      const d = document.createElement('dialog');
      d.className = 'cx-dialog'; d.setAttribute('aria-labelledby', 'cxTitle');
      const fourth = done !== null && done >= 3, left = done === null ? null : Math.max(0, 3 - done);
      d.innerHTML = `<form method="dialog" class="cx-card">
        <h2 id="cxTitle">Cancel order #${esc(number)}?</h2>
        <p class="cx-sub">This frees its reservation date.${paid > 0 ? ` LexC’s will refund the ${peso(paid)} you already paid.` : ''} The order stays in your history.</p>
        <label class="cx-label" for="cxReason">Why are you cancelling?</label>
        <select id="cxReason" required><option value="">Choose a reason…</option>${REASONS.map((r) => `<option>${esc(r)}</option>`).join('')}</select>
        <textarea id="cxOther" maxlength="250" rows="2" placeholder="Tell us a little more" hidden></textarea>
        <div class="cx-rule${fourth ? ' is-danger' : ''}" role="${fourth ? 'alert' : 'note'}">
          ${fourth
            ? `<strong>⚠ This would be your ${done + 1}th cancellation today.</strong><p>We strongly discourage repeated cancellations — they block dates other customers could book. <b>If you continue, you won’t be able to place new orders for 8 hours.</b></p>`
            : `<strong>You can cancel up to 3 orders a day.</strong><p>${left === null ? '' : `${left} cancellation${left === 1 ? '' : 's'} left today. `}A 4th cancellation in one day pauses new orders for <b>8 hours</b>, and repeated misuse may restrict your account.</p>`}
        </div>
        <p class="cx-error" role="alert"></p>
        <div class="cx-actions"><button type="button" class="cx-keep" value="keep">Keep my order</button><button type="submit" class="cx-go${fourth ? ' is-danger' : ''}" value="go">${fourth ? 'Cancel anyway' : 'Cancel order'}</button></div>
      </form>`;
      document.body.append(d);
      const reason = d.querySelector('#cxReason'), other = d.querySelector('#cxOther'), err = d.querySelector('.cx-error');
      reason.onchange = () => { other.hidden = reason.value !== 'Other'; if (!other.hidden) other.focus(); err.textContent = ''; };
      d.querySelector('.cx-keep').onclick = () => d.close('keep');
      d.querySelector('form').onsubmit = (ev) => {
        const why = reason.value === 'Other' ? ('Other: ' + other.value.trim()).replace(/:\s*$/, '') : reason.value;
        if (!reason.value) { ev.preventDefault(); err.textContent = 'Please choose a reason.'; reason.focus(); return; }
        if (reason.value === 'Other' && other.value.trim().length < 3) { ev.preventDefault(); err.textContent = 'Please tell us the reason.'; other.focus(); return; }
        d.dataset.why = why;
      };
      d.addEventListener('close', () => { const why = d.returnValue === 'go' ? d.dataset.why : null; d.remove(); resolve(why || null); });
      d.addEventListener('click', (ev) => { if (ev.target === d) d.close('keep'); });
      d.showModal(); reason.focus();
    });
  }

  window.LexcCancelOrder = async function cancelOrder(order) {
    const done = await countToday();
    const why = await ask(order, done); if (!why) return false;
    try {
      let res;
      try { res = await db().rpc('cancel_my_order_with_reason', { order_id: order.id, reason: why }); }
      catch (error) { if (/cancel_my_order_with_reason|schema cache|function/i.test(error.message || '')) { await db().rpc('cancel_my_order', { order_id: order.id }); res = {}; } else throw error; }
      const n = Number(res?.cancellations_today) || 0;
      if (res?.paused_until) window.showToast?.(`Order cancelled. Because this is cancellation ${n} today, new orders are paused until ${when(res.paused_until)}.`);
      else window.showToast?.(order.paid > 0 ? 'Order cancelled. LexC’s will refund what you paid; watch your chat.' : `Order cancelled.${n ? ` ${Math.max(0, 3 - n)} cancellation${3 - n === 1 ? '' : 's'} left today.` : ''}`);
      return true;
    } catch (error) { window.showToast?.(error.message || 'The order could not be cancelled. Please try again.'); return false; }
  };
})();
