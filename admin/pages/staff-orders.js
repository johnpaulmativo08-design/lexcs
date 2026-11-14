// Cashier → Orders: one table of orders by the date they were placed (Order ID, Name, Ordered date, Payment status,
// Reference ID, Payment method, Status), quick date navigation (‹ day ›, Today, Yesterday, This week, This month,
// All, or any date), and a details panel with every item, totals and the remaining balance. From the panel a cashier
// can confirm a pending order, move it along (Start making → Ready → Complete) and check a payment (receipt,
// Mark received / Reject). The database decides what a cashier may do (phases 112–113); cancelling stays with the owner.
import { escapeHtml as e, icon, money } from '../components.js?v=5';
import { db } from '../backend-ui.js?v=3';
import { ask } from '../../shared/ask.js?v=1';

const TZ = 'Asia/Manila';
const dayKey = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
const addDays = (k, n) => new Date(Date.parse(k + 'T00:00:00+08:00') + n * 86400000);
const startOf = (k) => new Date(k + 'T00:00:00+08:00').toISOString();
const dateText = (v, opt = { month: 'short', day: 'numeric', year: 'numeric' }) => new Date(v).toLocaleDateString('en-PH', { timeZone: TZ, ...opt });
const timeText = (v) => new Date(v).toLocaleTimeString('en-PH', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
const words = (s) => String(s || '').replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase());
const PAY = { unpaid: ['Unpaid', 'neutral'], verification_pending: ['To check', 'warn'], partially_paid: ['Downpayment paid', 'info'], paid: ['Paid', 'ok'], rejected: ['Rejected', 'bad'], refunded: ['Refunded', 'neutral'], failed: ['Failed', 'bad'] };
const STATUS = { pending: ['Needs confirming', 'warn'], confirmed: ['Confirmed', 'info'], preparing: ['In the kitchen', 'info'], ready: ['Ready', 'ok'], completed: ['Completed', 'ok'], cancelled: ['Cancelled', 'neutral'] };
const pill = ([t, tone]) => `<span class="so-pill is-${tone}">${e(t)}</span>`;

export async function renderStaffOrders(content) {
  const today = dayKey(new Date());
  const state = { mode: 'all', day: today, q: '', status: '' };   // every order first; This day = today
  content.innerHTML = `<header class="so-head"><div><h1>Orders</h1><p>Every order, newest first, or one day at a time. Open one to see every detail and the remaining balance.</p></div></header>
    <section class="so-dates" aria-label="Choose dates">
      <div class="so-day"><button type="button" class="so-arrow" data-step="-1" aria-label="Previous day">‹</button>
        <label class="so-pick"><span data-label></span><input type="date" data-date aria-label="Pick a date"></label>
        <button type="button" class="so-arrow" data-step="1" aria-label="Next day">›</button></div>
      <div class="so-chips" role="group" aria-label="Quick dates">${[['all', 'View all orders'], ['today', 'This day'], ['yesterday', 'Yesterday'], ['week', 'This week'], ['month', 'This month']].map(([k, l]) => `<button type="button" data-quick="${k}">${l}</button>`).join('')}</div>
    </section>
    <div class="so-tools"><label class="so-search">${icon('search')}<input type="search" data-q placeholder="Search name, order # or reference" autocomplete="off"></label>
      <select data-status aria-label="Order status"><option value="">All statuses</option>${Object.entries(STATUS).map(([k, [l]]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
    <div class="so-table-wrap panel" data-table></div>`;
  const table = content.querySelector('[data-table]'), label = content.querySelector('[data-label]'), picker = content.querySelector('[data-date]');
  let rows = [], payments = new Map(), methods = new Map(), seq = 0;

  const range = () => {
    if (state.mode === 'all') return [null, null, 'All dates'];
    if (state.mode === 'week') { const d = new Date(today + 'T12:00:00+08:00').getUTCDay(), s = dayKey(addDays(today, -((d + 6) % 7))); return [startOf(s), startOf(dayKey(addDays(today, 1))), 'This week'] ; }
    if (state.mode === 'month') return [startOf(today.slice(0, 8) + '01'), startOf(dayKey(addDays(today, 1))), 'This month'];
    const k = state.day; return [startOf(k), startOf(dayKey(addDays(k, 1))), k === today ? 'Today · ' + dateText(k + 'T12:00:00+08:00', { weekday: 'long', month: 'long', day: 'numeric' }) : dateText(k + 'T12:00:00+08:00', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })];
  };
  const paintDates = () => {
    const [, , text] = range(); label.textContent = text; picker.value = state.mode === 'day' ? state.day : '';
    content.querySelectorAll('[data-step]').forEach((b) => { b.disabled = state.mode !== 'day'; });
    const quick = state.mode === 'day' ? (state.day === today ? 'today' : state.day === dayKey(addDays(today, -1)) ? 'yesterday' : '') : state.mode;
    content.querySelectorAll('[data-quick]').forEach((b) => b.classList.toggle('is-on', b.dataset.quick === quick));
  };
  const latestPay = (id) => (payments.get(id) || [])[0];
  const draw = () => {
    const q = state.q.toLowerCase();
    const list = rows.filter((o) => (!state.status || o.status === state.status) && (!q || `${o.order_number} ${o.customer_name || ''} ${(payments.get(o.id) || []).map((p) => p.transaction_reference || '').join(' ')}`.toLowerCase().includes(q)));
    table.innerHTML = list.length ? `<table class="so-table"><thead><tr><th>Order ID</th><th>Name</th><th>Ordered date</th><th>Payment status</th><th>Reference ID</th><th>Payment method</th><th>Status</th><th class="num">Balance</th><th><span class="sr-only">Open</span></th></tr></thead><tbody>
      ${list.map((o) => { const p = latestPay(o.id), bal = o.total_amount === null ? null : Math.max(0, Number(o.total_amount) - Number(o.amount_paid || 0));
        return `<tr data-open="${e(o.id)}" tabindex="0"><td><b>#${e(o.order_number)}</b></td><td>${e(o.customer_name || 'Customer')}</td><td>${e(dateText(o.created_at))}<small>${e(timeText(o.created_at))}</small></td>
        <td>${pill(o.status === 'pending' && o.payment_status === 'unpaid' ? ['After confirm', 'neutral'] : PAY[o.payment_status] || [words(o.payment_status), 'neutral'])}</td><td class="so-ref">${e(p?.transaction_reference || '—')}</td><td>${e(p ? methods.get(p.payment_method_id) || 'Manual QR' : '—')}</td>
        <td>${pill(STATUS[o.status] || [words(o.status), 'neutral'])}</td><td class="num">${bal === null ? 'Quote pending' : money(bal)}</td><td><button type="button" class="so-view" data-open="${e(o.id)}">View</button></td></tr>`; }).join('')}</tbody></table>`
      : `<div class="so-empty">${icon('search')}<b>No orders for ${e(range()[2].replace(/^Today · /, 'today'))}</b><span>Try another day, or tap View all orders.</span></div>`;
  };
  const load = async () => {
    const n = ++seq; paintDates();
    table.innerHTML = '<div class="so-skel">' + '<span class="skel skel-line"></span>'.repeat(5) + '</div>';
    const [from, to] = range();
    try {
      let query = db.client.from('orders').select('id,order_number,customer_name,contact_phone,created_at,status,payment_status,total_amount,amount_paid,deposit_due,receiving_start,receiving_end,fulfillment_method,notes,order_items(name_snapshot,variant_label_snapshot,quantity,line_total)').order('created_at', { ascending: false }).limit(300);
      if (from) query = query.gte('created_at', from).lt('created_at', to);
      const { data, error } = await query; if (error) throw error;
      const ids = data.map((o) => o.id);
      const [pays, meth] = await Promise.all([
        ids.length ? db.client.from('order_payment_attempts').select('id,order_id,amount,status,transaction_reference,payment_method_id,proof_storage_path,submitted_at,created_at').in('order_id', ids).order('created_at', { ascending: false }) : { data: [] },
        methods.size ? { data: null } : db.client.from('payment_methods').select('id,display_name')]);
      if (n !== seq) return;
      rows = data; payments = new Map();
      (pays.data || []).forEach((p) => { if (!payments.has(p.order_id)) payments.set(p.order_id, []); payments.get(p.order_id).push(p); });
      (meth.data || []).forEach((m) => methods.set(m.id, m.display_name));
      draw();
    } catch (err) { console.warn('Cashier orders failed:', err); table.innerHTML = `<div class="so-empty" role="alert"><b>Orders could not load</b><span>${e(err.message || '')}</span><button type="button" class="so-view" data-retry>Try again</button></div>`; }
  };

  // ---- details panel
  const open = (id) => {
    const o = rows.find((x) => x.id === id); if (!o) return;
    const pays = payments.get(id) || [], bal = o.total_amount === null ? null : Math.max(0, Number(o.total_amount) - Number(o.amount_paid || 0));
    const paidOk = ['paid', 'partially_paid'].includes(o.payment_status);
    const next = o.status === 'pending' ? ['confirmed', 'Confirm order'] : o.status === 'confirmed' && paidOk ? ['preparing', 'Start making'] : o.status === 'preparing' ? ['ready', 'Mark ready'] : o.status === 'ready' ? ['completed', 'Complete (handed over)'] : null;
    const dlg = document.createElement('dialog'); dlg.className = 'so-dialog';
    dlg.innerHTML = `<header><div><small>Order #${e(o.order_number)}</small><h2>${e(o.customer_name || 'Customer')}</h2></div><button type="button" class="so-x" data-close aria-label="Close">×</button></header>
      <div class="so-body">
        <div class="so-pills">${pill(STATUS[o.status] || [words(o.status), 'neutral'])}${pill(PAY[o.payment_status] || [words(o.payment_status), 'neutral'])}</div>
        <dl class="so-facts"><div><dt>Ordered</dt><dd>${e(dateText(o.created_at))} · ${e(timeText(o.created_at))}</dd></div>
          <div><dt>${o.fulfillment_method === 'lalamove' ? 'Delivery' : 'Pickup'}</dt><dd>${o.receiving_start ? e(dateText(o.receiving_start, { weekday: 'short', month: 'short', day: 'numeric' })) + ' · ' + e(timeText(o.receiving_start)) : 'Not set'}</dd></div>
          ${o.contact_phone ? `<div><dt>Contact</dt><dd>${e(o.contact_phone)}</dd></div>` : ''}${o.notes ? `<div class="is-wide"><dt>Notes</dt><dd>${e(o.notes)}</dd></div>` : ''}</dl>
        <table class="so-items"><thead><tr><th>Item</th><th>Qty</th><th class="num">Amount</th></tr></thead><tbody>${(o.order_items || []).map((i) => `<tr><td>${e(i.name_snapshot)}${i.variant_label_snapshot ? `<small>${e(i.variant_label_snapshot)}</small>` : ''}</td><td>${e(i.quantity)}</td><td class="num">${money(i.line_total)}</td></tr>`).join('')}</tbody></table>
        <div class="so-money"><p><span>Order total</span><b>${o.total_amount === null ? 'Quote pending' : money(o.total_amount)}</b></p><p><span>Downpayment (60%)</span><b>${o.deposit_due === null ? '—' : money(o.deposit_due)}</b></p>
          <p><span>Verified paid</span><b>${money(o.amount_paid || 0)}</b></p><p class="is-due"><span>Remaining balance</span><b>${bal === null ? 'Quote pending' : money(bal)}</b></p></div>
        <h3>Payments</h3>${pays.length ? pays.map((p) => `<div class="so-pay"><div><b>${money(p.amount)}</b> · ${e(methods.get(p.payment_method_id) || 'Manual QR')}<small>Ref ${e(p.transaction_reference || '—')} · ${e(dateText(p.submitted_at || p.created_at))}</small></div>${pill(PAY[p.status] || [words(p.status), 'neutral'])}
          <div class="so-pay-acts">${p.proof_storage_path ? `<button type="button" class="so-view" data-proof="${e(p.id)}">View receipt</button>` : ''}${p.status === 'verification_pending' ? `<button type="button" class="so-main" data-review="${e(p.id)}" data-decision="paid">Mark received</button><button type="button" class="so-view" data-review="${e(p.id)}" data-decision="rejected">Reject</button>` : ''}</div><div class="so-proof" data-proof-box="${e(p.id)}"></div></div>`).join('') : '<p class="so-muted">No payment yet.</p>'}
        <p class="so-msg" role="status"></p>
      </div>
      <footer>${next ? `<button type="button" class="so-main" data-next="${next[0]}">${next[1]}</button>` : ''}${o.status === 'confirmed' && !paidOk ? '<span class="so-muted">Start making unlocks after a payment is verified.</span>' : ''}<button type="button" class="so-view" data-close>Close</button></footer>`;
    document.body.append(dlg); dlg.showModal();
    const msg = dlg.querySelector('.so-msg'), done = async (t) => { msg.textContent = t; await load(); dlg.close(); };
    dlg.addEventListener('close', () => dlg.remove());
    dlg.addEventListener('click', async (ev) => {
      if (ev.target === dlg || ev.target.closest('[data-close]')) return dlg.close();
      const nx = ev.target.closest('[data-next]'), rv = ev.target.closest('[data-review]'), pf = ev.target.closest('[data-proof]');
      try {
        if (nx) { nx.disabled = true; await db.rpc('set_order_status', { order_id: o.id, next_status: nx.dataset.next }); await done('Order updated.'); }
        if (rv) {
          const p = pays.find((x) => x.id === rv.dataset.review), ok = rv.dataset.decision === 'paid';
          if (!(await ask(ok ? `Mark ${money(p.amount)} as received? Only do this after you see it in the bank or GCash account.` : 'Reject this payment? The customer will be asked to pay again.', { title: ok ? 'Payment received?' : 'Reject payment?', confirm: ok ? 'Mark received' : 'Reject', tone: ok ? undefined : 'danger' }))) return;
          rv.disabled = true; await db.rpc('review_order_payment', { target_payment: p.id, decision: rv.dataset.decision, review_reason: ok ? 'Amount checked and received (' + money(p.amount) + '), confirmed by the cashier.' : 'Payment could not be matched; checked by the cashier.' });
          await done(ok ? 'Payment marked received.' : 'Payment rejected.');
        }
        if (pf) {
          const p = pays.find((x) => x.id === pf.dataset.proof), box = dlg.querySelector(`[data-proof-box="${p.id}"]`);
          pf.disabled = true; box.innerHTML = '<span class="skel skel-image"></span>';
          const url = await db.privateImage('payment-proofs', p.proof_storage_path);
          box.innerHTML = `<img src="${e(url)}" alt="Payment receipt"><a href="${e(url)}" target="_blank" rel="noopener">Open full image</a>`;
        }
      } catch (err) { msg.textContent = err.message || 'That could not be done.'; if (nx) nx.disabled = false; if (rv) rv.disabled = false; if (pf) pf.disabled = false; }
    });
  };

  content.addEventListener('click', (ev) => {
    const st = ev.target.closest('[data-step]'), qk = ev.target.closest('[data-quick]'), op = ev.target.closest('[data-open]');
    if (st) { state.mode = 'day'; state.day = dayKey(addDays(state.day, Number(st.dataset.step))); load(); }
    else if (qk) { const k = qk.dataset.quick; if (k === 'today' || k === 'yesterday') { state.mode = 'day'; state.day = k === 'today' ? today : dayKey(addDays(today, -1)); } else state.mode = k; load(); }
    else if (ev.target.closest('[data-retry]')) load();
    else if (op) open(op.dataset.open);
  });
  content.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target.matches('tr[data-open]')) open(ev.target.dataset.open); });
  picker.addEventListener('change', () => { if (picker.value) { state.mode = 'day'; state.day = picker.value; load(); } });
  content.querySelector('[data-q]').addEventListener('input', (ev) => { state.q = ev.target.value.trim(); draw(); });
  content.querySelector('[data-status]').addEventListener('change', (ev) => { state.status = ev.target.value; draw(); });
  await load();
}
