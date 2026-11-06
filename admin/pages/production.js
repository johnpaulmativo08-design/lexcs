// Admin → Production: the kitchen shift as a workspace. Orders are production tasks that move through stages
// (Take order → Start → Baking timer → Ready → Handed over) on a track of the day's bake window.
//   Left: the shift — workload ring, kitchen time (capacity) control, stage counts, on-time streak.
//   Middle: the shift board — day track with a live "now" marker, the order(s) baking with a running timer, up next.
//   Right: the order ticket — stage times, kitchen time, payment, the one next action.
// Nothing new is stored. Data: get_production_day / save_production_capacity (phase 96), get_bake_timeline and
// production_settings bake window (phase 97), orders + order_items, booking_entries (reserved times), and the status
// messages the database posts in each order's chat (when it was confirmed, started, ready, completed).
// Every action is set_order_status, the same as Orders, so payment, inventory and status rules stay in the database.
import { escapeHtml as e, icon } from '../components.js?v=4';
import { db } from '../backend-ui.js?v=3';
import { ask } from '../../shared/ask.js?v=2';
import { clearProductionCache } from '../production-capacity.js?v=3';

const DAY = 864e5, MAX = 750;
const manilaKey = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
const plus = (k, n) => new Date(Date.parse(k + 'T12:00:00Z') + n * DAY).toISOString().slice(0, 10);
const longDay = (k) => new Intl.DateTimeFormat('en-PH', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(k + 'T12:00:00Z'));
const clock = (min) => { if (min == null) return '—'; const m = ((Math.round(min) % 1440) + 1440) % 1440, h = Math.floor(m / 60); return `${h % 12 || 12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const at = (iso) => iso ? new Date(iso).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' }) : '';
const mins = (m) => { const n = Math.max(0, Math.round(Number(m) || 0)), h = Math.floor(n / 60); return h ? `${h} hr${n % 60 ? ` ${n % 60} min` : ''}` : `${n} min`; };
const manilaMinutes = (d = new Date()) => { const [h, m] = d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit' }).split(':').map(Number); return h * 60 + m; };
const mmss = (sec) => { const s = Math.max(0, Math.floor(sec)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return `${h ? h + ':' + String(m).padStart(2, '0') : m}:${String(s % 60).padStart(2, '0')}`; };
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const PAY = { unpaid: 'Not paid yet', verification_pending: 'Receipt to check', partially_paid: 'Downpayment paid', paid: 'Fully paid', refunded: 'Refunded', rejected: 'Receipt not accepted' };
const TONE = { pending: 'new', confirmed: 'start', preparing: 'bake', ready: 'ready', completed: 'done' };
const LEVEL = { ok: 'Within the safe limit', near: 'Getting full', heavy: 'Over capacity' };
const level = (used, cap) => cap <= 0 ? (used > 0 ? 'heavy' : 'ok') : used > cap ? 'heavy' : used >= cap * 0.8 ? 'near' : 'ok';
const skel = (n) => `<div class="ps-skel" role="status" aria-label="Loading">${'<span class="skel"></span>'.repeat(n)}</div>`;

export async function renderProduction(content, focus) {
  const today = manilaKey();
  let selected = today, picked = null, tick = 0, celebrate = null;
  const orders = new Map(), stamps = new Map();
  let state = { rows: [], day: null, held: [], window: { start: 240, end: 990 } };

  content.innerHTML = `<div class="ps" data-ps>
    <aside class="ps-col ps-left" data-left aria-busy="true">${skel(4)}</aside>
    <section class="ps-col ps-board" data-board aria-busy="true">${skel(3)}</section>
    <aside class="ps-col ps-ticket" data-ticket><div class="ps-empty">${icon('orders')}<p>Pick a task to open its ticket.</p></div></aside>
  </div>`;
  const $ = (s) => content.querySelector(s);

  // ---------------------------------------------------------------- data
  async function load(fresh) {
    if (fresh) { clearProductionCache(); orders.clear(); stamps.clear(); }
    const [rows, day, held, win] = await Promise.all([
      db.rpc('get_bake_timeline', { target_date: selected }).catch((error) => { console.warn('Bake timeline:', error); return []; }),
      db.rpc('get_production_day', { target_date: selected }).catch((error) => { console.warn('Production day:', error); return null; }),
      db.client.from('booking_entries').select('id,customer_name,scheduled_start,scheduled_end,status').eq('booking_date', selected).is('order_id', null).neq('status', 'cancelled').then((r) => r.data || [], () => []),
      db.client.from('production_settings').select('bake_start_minutes,bake_end_minutes').maybeSingle().then((r) => r.data, () => null),
    ]);
    const ids = (rows || []).map((r) => r.order_id);
    const need = ids.filter((id) => !orders.has(id));
    if (need.length) {
      const list = db.unwrap(await db.client.from('orders')
        .select('id,order_number,status,payment_status,fulfillment_method,receiving_start,notes,customer_name,created_at,order_items(name_snapshot,variant_label_snapshot,quantity)')
        .in('id', need)) || [];
      list.forEach((o) => orders.set(o.id, o));
    }
    await loadStamps(ids);
    state = { rows: rows || [], day, held: held || [], window: { start: Number(win?.bake_start_minutes ?? 240), end: Number(win?.bake_end_minutes ?? 990) } };
  }
  // when each order reached each stage: the status messages in its chat (same source as the customer's order history)
  async function loadStamps(ids) {
    const need = ids.filter((id) => !stamps.has(id));
    if (!need.length) return;
    need.forEach((id) => stamps.set(id, {}));
    try {
      const threads = db.unwrap(await db.client.from('chat_conversations').select('id,order_id').in('order_id', need)) || [];
      if (!threads.length) return;
      const byThread = new Map(threads.map((t) => [t.id, t.order_id]));
      const msgs = db.unwrap(await db.client.from('chat_messages').select('conversation_id,body,created_at')
        .in('conversation_id', threads.map((t) => t.id)).eq('sender_type', 'system').eq('message_type', 'status_update').order('created_at', { ascending: true }).limit(500)) || [];
      for (const m of msgs) {
        const body = String(m.body || '');
        const st = /confirmed your order/i.test(body) ? 'confirmed' : (/changed to ([a-z_ ]+?)[.!]/i.exec(body)?.[1] || '').trim().replace(/ /g, '_').toLowerCase();
        const slot = stamps.get(byThread.get(m.conversation_id));
        if (st && slot) slot[st] = m.created_at;
      }
    } catch (error) { console.warn('Stage times:', error); }
  }
  const what = (o) => (o?.order_items || []).map((i) => `${i.quantity > 1 ? i.quantity + '× ' : ''}${i.name_snapshot}${i.variant_label_snapshot ? ' · ' + i.variant_label_snapshot : ''}`).join(', ') || 'Order';
  const statusOf = (r) => orders.get(r.order_id)?.status || r.status;
  const onTime = (r) => { const t = stamps.get(r.order_id)?.ready; return !!t && r.deadline_minutes != null && manilaKey(new Date(t)) === selected && manilaMinutes(new Date(t)) <= r.deadline_minutes; };

  // ---------------------------------------------------------------- left: the shift
  function paintLeft() {
    const box = $('[data-left]'), d = state.day, rows = state.rows;
    const cap = Number(d?.workload_minutes) || 0, used = Number(d?.accepted_minutes) || 0, lv = level(used, cap);
    const p = cap > 0 ? Math.round((used / cap) * 100) : used > 0 ? 100 : 0;
    const count = (s) => rows.filter((r) => statusOf(r) === s).length;
    const done = count('ready') + count('completed'), streak = rows.filter(onTime).length;
    const hour = Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila', hour: 'numeric', hour12: false }));
    box.innerHTML = `
      <header class="ps-head"><div><small>${e(longDay(selected))} · shift ${e(clock(state.window.start))} – ${e(clock(state.window.end))}</small>
        <h2>${selected === today ? (hour < 12 ? 'Good morning, chef' : hour < 18 ? 'Good afternoon, chef' : 'Good evening, chef') : 'Shift plan'}</h2></div>
        <a class="ps-icon is-dark" href="#bookings" title="Reserve a time" aria-label="Reserve a time">${icon('plus')}</a></header>
      <div class="ps-meter is-${lv}">
        <div class="ps-ring" style="--p:${Math.min(100, p)}" role="img" aria-label="${p}% of the day’s kitchen time used"><span>${p}%<small>used</small></span></div>
        <dl><div><dd>${Math.round(used)}</dd><dt>min used</dt></div><div><dd>${Math.max(0, Math.round(cap - used))}</dd><dt>min left</dt></div></dl>
        <p class="ps-level">${LEVEL[lv]}</p>
      </div>
      ${d ? kitchenCard(d) : ''}
      <div class="ps-counts" role="list">
        <span role="listitem"><b>${count('confirmed')}</b>To start</span><span role="listitem"><b>${count('preparing')}</b>Baking</span><span role="listitem" class="is-done"><b>${done}</b>Done</span>
      </div>
      <p class="ps-streak">${icon('check')}<span><b>${streak} on time${selected === today ? ' today' : ''}</b><small>Ready before the deadline</small></span></p>`;
    box.removeAttribute('aria-busy');
    if (d) bindKitchen(box, d);
  }
  function kitchenCard(d) {
    const cap = Number(d.workload_minutes) || 0, used = Number(d.accepted_minutes) || 0, pend = Number(d.pending_minutes) || 0;
    const w = (n) => Math.min(100, Math.max(0, (n / MAX) * 100));
    return `<form class="ps-kitchen" data-kitchen>
      <div class="ps-row"><b>${icon('clock')} Kitchen time</b><output class="ps-tag is-dark" data-cap-out>${cap} min</output></div>
      <div class="ps-bar"><span class="is-used" style="width:${w(used)}%"></span><span class="is-pend" style="left:${w(used)}%;width:${w(pend)}%"></span>
        <input type="range" name="cap" min="0" max="${MAX}" step="5" value="${cap}" aria-label="Kitchen minutes for ${e(longDay(selected))}"></div>
      <div class="ps-legend"><span class="is-used">Used ${Math.round(used)}</span><span class="is-pend">Pending +${Math.round(pend)}</span><span>${MAX} max</span></div>
      <div class="ps-row ps-scope"><label><input type="radio" name="scope" value="day" checked> This date</label><label><input type="radio" name="scope" value="all"> All dates</label><button type="submit" class="ps-btn is-sm" disabled>Save</button></div>
      <div class="ps-row ps-clean"><label>Cleaning per order <input name="clean" type="number" min="0" max="120" step="1" inputmode="numeric" value="${Number(d.cleaning_minutes) || 0}"> min</label><button type="button" class="ps-btn is-sm is-ghost" data-clean-save>Save</button></div>
      <p class="ps-say" role="status">${d.workload_custom ? 'Set for this date.' : `Using the default (${Number(d.default_workload_minutes)} min).`}</p></form>`;
  }
  function bindKitchen(box, d) {
    const f = box.querySelector('[data-kitchen]'); if (!f) return;
    const out = f.querySelector('[data-cap-out]'), save = f.querySelector('button[type=submit]');
    const say = (t, bad) => { const p = f.querySelector('.ps-say'); p.textContent = t; p.classList.toggle('is-bad', !!bad); };
    const changed = () => { out.textContent = f.elements.cap.value + ' min'; save.disabled = Number(f.elements.cap.value) === Number(d.workload_minutes) && f.elements.scope.value === 'day'; };
    f.addEventListener('input', changed); f.addEventListener('change', changed);
    const after = async (msg) => { await refresh(true); const p = $('[data-kitchen] .ps-say'); if (p) { p.textContent = msg; p.classList.add('is-ok'); } };
    f.onsubmit = async (ev) => {
      ev.preventDefault();
      const minutes = Number(f.elements.cap.value), scope = f.elements.scope.value;
      if (scope === 'all' && !(await ask(`Every date from today will use ${minutes} min (${mins(minutes)}). Dates you set one by one are reset to this.`, { title: 'Use this for all dates?', confirm: 'Apply to all dates' }))) return;
      save.disabled = true; say('Saving…');
      try { await db.rpc('save_production_capacity', { payload: { booking_date: selected, scope, workload_minutes: minutes } }); await after(`Saved: ${minutes} min${scope === 'all' ? ' for all dates' : ' for this date'}.`); }
      catch (error) { say(error.message || 'Could not save.', true); save.disabled = false; }
    };
    f.querySelector('[data-clean-save]').onclick = async () => {
      const n = Number(f.elements.clean.value);
      if (!Number.isInteger(n) || n < 0 || n > 120) { say('Enter whole minutes from 0 to 120.', true); return; }
      say('Saving…');
      try { await db.rpc('save_production_capacity', { payload: { scope: 'all', cleaning_minutes: n } }); await after(`Saved: ${n} min cleaning for each new order.`); }
      catch (error) { say(error.message || 'Could not save.', true); }
    };
  }

  // ---------------------------------------------------------------- middle: the shift board
  function paintBoard() {
    const box = $('[data-board]'), rows = state.rows.slice().sort((a, b) => (a.bake_start_minutes ?? 0) - (b.bake_start_minutes ?? 0));
    const baking = rows.filter((r) => statusOf(r) === 'preparing');
    const next = rows.filter((r) => ['confirmed', 'pending'].includes(statusOf(r)));
    const finished = rows.filter((r) => ['ready', 'completed'].includes(statusOf(r)));
    const live = selected === today;
    box.innerHTML = `
      <header class="ps-boardhead">
        <div class="ps-daynav"><button type="button" class="ps-icon" data-step="-1" aria-label="Previous day">‹</button>
          <h2>Kitchen <em>shift</em></h2><button type="button" class="ps-icon" data-step="1" aria-label="Next day">›</button></div>
        <div class="ps-row"><span class="ps-date">${e(longDay(selected))}</span>
          ${live ? `<span class="ps-tag is-live"><span class="ps-dot" aria-hidden="true"></span><span data-now-clock>${e(clock(manilaMinutes()))}</span> · live</span>` : `<button type="button" class="ps-tag" data-today-btn>Back to today</button>`}</div>
      </header>
      ${track(rows)}
      ${baking.length ? `<div class="ps-active">${baking.map(activeCard).join('')}</div>`
        : `<div class="ps-idle">${icon('clock')}<p>${next.length ? 'Nothing in the oven. Start the next task when you’re ready.' : rows.length ? 'All tasks for this day are done.' : 'No tasks planned for this day.'}</p></div>`}
      ${next.length ? `<h3 class="ps-sub">Up next</h3><div class="ps-tickets">${next.map(ticketCard).join('')}</div>` : ''}
      ${finished.length ? `<h3 class="ps-sub">Done</h3><div class="ps-done">${finished.map(doneRow).join('')}</div>` : ''}
      ${state.day && Number(state.day.pending_minutes) > 0 ? projection(state.day) : ''}`;
    box.removeAttribute('aria-busy');
    box.querySelectorAll('[data-step]').forEach((b) => (b.onclick = () => go(plus(selected, Number(b.dataset.step)))));
    box.querySelectorAll('[data-today-btn]').forEach((b) => (b.onclick = () => go(today)));
    if (celebrate) { box.querySelector(`[data-done-id="${celebrate}"]`)?.classList.add('is-new'); celebrate = null; }
  }
  function track(rows) {
    const { start, end } = state.window, span = Math.max(60, end - start);
    const pos = (m) => Math.min(100, Math.max(0, ((m - start) / span) * 100));
    const hours = []; for (let h = Math.ceil(start / 120) * 120; h <= end; h += 120) hours.push(h);
    const now = selected === today ? manilaMinutes() : null;
    const toMin = (t) => { const [hh, mm] = String(t || '').split(':').map(Number); return Number.isFinite(hh) ? hh * 60 + (mm || 0) : null; };
    const held = state.held.map((h) => { const a = toMin(h.scheduled_start), b = toMin(h.scheduled_end) ?? (a == null ? null : a + 60); if (a == null) return '';
      return `<span class="ps-block is-held" style="left:${pos(a)}%;width:${Math.max(3, pos(b) - pos(a))}%" title="Reserved · ${e(h.customer_name)}">${e(h.customer_name)}</span>`; }).join('');
    return `<div class="ps-track" aria-label="Day plan from ${e(clock(start))} to ${e(clock(end))}">
      <div class="ps-hours" aria-hidden="true">${hours.map((h) => `<span style="left:${pos(h)}%">${e(clock(h).replace(':00', ''))}</span>`).join('')}</div>
      <div class="ps-lane">${held}${rows.map((r) => {
        const s = statusOf(r), left = pos(r.bake_start_minutes ?? start), width = Math.max(3, pos(r.bake_finish_minutes ?? start) - left);
        return `<button type="button" class="ps-block is-${TONE[s] || 'start'}${r.fits ? '' : ' is-bad'}${picked === r.order_id ? ' is-picked' : ''}" style="left:${left}%;width:${width}%" data-pick="${e(r.order_id)}" title="#${e(r.order_number)} · ${e(clock(r.bake_start_minutes))} – ${e(clock(r.bake_finish_minutes))}">#${e(r.order_number)}</button>`;
      }).join('')}
      ${now != null && now >= start && now <= end ? `<span class="ps-now" style="left:${pos(now)}%" data-now><i>now</i></span>` : ''}</div></div>`;
  }
  function elapsed(r) {
    const t = stamps.get(r.order_id)?.preparing;
    if (t) return (Date.now() - Date.parse(t)) / 1000;
    return selected === today && r.bake_start_minutes != null ? (manilaMinutes() - r.bake_start_minutes) * 60 + new Date().getSeconds() : 0;   // no start time recorded: from the planned start
  }
  const timerNote = (r, el) => Number(r.minutes) ? `${Math.min(Math.round(el / 60), 999)} of ${Math.round(r.minutes)} min · finish by ${clock(r.deadline_minutes)}` : `No prep time set · finish by ${clock(r.deadline_minutes)}`;
  function activeCard(r) {
    const o = orders.get(r.order_id), total = Math.max(1, Number(r.minutes) || 0) * 60, el = elapsed(r), p = Math.min(100, Math.max(0, (el / total) * 100)), over = el > total && Number(r.minutes) > 0;
    return `<article class="ps-oven${over ? ' is-over' : ''}${picked === r.order_id ? ' is-picked' : ''}" data-oven="${e(r.order_id)}">
      <div class="ps-row"><span class="ps-tag is-bake">${icon('clock')} Baking now</span><small>#${e(r.order_number)} · due ${e(at(r.delivery_at))}</small></div>
      <h3>${e(what(o))}</h3>
      <div class="ps-timer"><b data-timer>${mmss(el)}</b><div><div class="ps-progress"><span data-progress style="width:${p}%"></span></div><small data-timer-note>${e(timerNote(r, el))}</small></div></div>
      <div class="ps-row"><button type="button" class="ps-btn" data-act="ready" data-id="${e(r.order_id)}">Mark ready</button><button type="button" class="ps-btn is-ghost" data-pick="${e(r.order_id)}">Details</button></div>
    </article>`;
  }
  function ticketCard(r) {
    const o = orders.get(r.order_id), s = statusOf(r), paid = ['paid', 'partially_paid'].includes(o?.payment_status);
    const action = s === 'pending' ? `<button type="button" class="ps-chip is-take" data-act="take" data-id="${e(r.order_id)}">Take order</button>`
      : paid ? `<button type="button" class="ps-chip" data-act="start" data-id="${e(r.order_id)}">Start</button>` : `<span class="ps-chip is-wait" title="Start opens once a payment is marked received">Waiting for payment</span>`;
    return `<div class="ps-ticket-card is-${TONE[s]}${r.fits ? '' : ' is-bad'}${picked === r.order_id ? ' is-picked' : ''}" data-pick="${e(r.order_id)}">
      <small>#${e(r.order_number)} · ${s === 'pending' ? 'new order' : 'start ' + e(clock(r.bake_start_minutes))}</small>
      <b>${e(what(o))}</b><small>${e(mins(r.minutes))} · ${o?.fulfillment_method === 'lalamove' ? 'deliver' : 'pickup'} ${e(at(r.delivery_at))}</small>
      ${r.fits ? '' : '<small class="is-bad">Doesn’t fit the shift</small>'}${action}</div>`;
  }
  function doneRow(r) {
    const o = orders.get(r.order_id), s = statusOf(r), ok = onTime(r), t = stamps.get(r.order_id)?.ready;
    return `<button type="button" class="ps-done-row${picked === r.order_id ? ' is-picked' : ''}" data-pick="${e(r.order_id)}" data-done-id="${e(r.order_id)}">
      <span class="ps-check" aria-hidden="true">${icon('check')}</span><span class="ps-done-text"><b>#${e(r.order_number)} ${e(what(o))}</b><small>${s === 'completed' ? 'Handed over' : 'Ready'}${t ? ' · ' + e(at(t)) : ''}</small></span>
      ${ok ? '<span class="ps-tag is-ok">On time</span>' : ''}</button>`;
  }
  function projection(d) {
    const cap = Number(d.workload_minutes) || 0, total = (Number(d.accepted_minutes) || 0) + (Number(d.pending_minutes) || 0), lv = level(total, cap);
    return `<p class="ps-project is-${lv}">If you take every new order: ${Math.round(total)} of ${Math.round(cap)} min${lv === 'heavy' ? ` — ${Math.round(total - cap)} min over` : lv === 'near' ? ', nearly full' : ', still within capacity'}</p>`;
  }

  // ---------------------------------------------------------------- right: the order ticket
  function paintTicket() {
    const box = $('[data-ticket]'), r = state.rows.find((x) => x.order_id === picked), o = orders.get(picked);
    if (!r || !o) { box.innerHTML = `<div class="ps-empty">${icon('orders')}<p>Pick a task to open its ticket.</p></div>`; return; }
    const t = stamps.get(o.id) || {}, s = o.status, paid = ['paid', 'partially_paid'].includes(o.payment_status), cap = Number(state.day?.workload_minutes) || 0;
    const steps = [['Order taken', o.created_at, true], ['Confirmed', t.confirmed, s !== 'pending'], ['Baking', t.preparing, ['preparing', 'ready', 'completed'].includes(s)], ['Ready', t.ready, ['ready', 'completed'].includes(s)], ['Handed over', t.completed, s === 'completed']];
    const nowStep = s === 'preparing' ? 2 : -1;
    const action = s === 'pending' ? `<button type="button" class="ps-btn is-wide" data-act="take" data-id="${e(o.id)}">Take order</button>`
      : s === 'confirmed' ? (paid ? `<button type="button" class="ps-btn is-wide" data-act="start" data-id="${e(o.id)}">Start making</button>` : `<p class="ps-warn">Waiting for payment. Start opens once you mark a payment received in Orders.</p><a class="ps-btn is-wide is-ghost" href="#orders/detail/${e(o.id)}">Check payment</a>`)
      : s === 'preparing' ? `<button type="button" class="ps-btn is-wide" data-act="ready" data-id="${e(o.id)}">Mark ready</button>`
      : s === 'ready' ? `<button type="button" class="ps-btn is-wide" data-act="complete" data-id="${e(o.id)}">Mark handed over</button>` : '';
    box.innerHTML = `
      <header class="ps-row"><h2>Order ticket</h2><small>#${e(o.order_number)}</small></header>
      <div class="ps-stub is-${TONE[s]}"><small>${e(o.customer_name || r.customer_name || 'Customer')}</small><b>${e(what(o))}</b>
        <small>${o.fulfillment_method === 'lalamove' ? 'Deliver' : 'Pickup'} ${e(at(r.delivery_at))} · bake ${e(clock(r.bake_start_minutes))} – ${e(clock(r.bake_finish_minutes))}</small></div>
      ${r.fits ? '' : '<p class="ps-warn">This task would have to start before the shift opens. Move it, or start it the day before.</p>'}
      <ol class="ps-steps">${steps.map(([label, time, done], i) => `<li class="${i === nowStep ? 'is-now' : done ? 'is-done' : ''}"><span aria-hidden="true">${done && i !== nowStep ? icon('check') : ''}</span><b>${label}</b>${time && done ? `<small>${e(at(time))}</small>` : ''}</li>`).join('')}</ol>
      <dl class="ps-facts"><div><dt>Kitchen time</dt><dd>${e(mins(r.minutes))}${cap > 0 ? ` · ${Math.round((Number(r.minutes) / cap) * 100)}% of the day` : ''}</dd></div>
        <div><dt>Payment</dt><dd class="${paid ? 'is-ok' : ''}">${e(PAY[o.payment_status] || '—')}</dd></div>
        ${o.notes ? `<div><dt>Notes</dt><dd>${e(o.notes)}</dd></div>` : ''}</dl>
      ${Number(r.minutes) ? '' : '<p class="ps-hint">No prep time is set for this product. Set it in Products → the product → Prep time.</p>'}
      <p class="ps-say" role="alert"></p>
      ${action}
      <div class="ps-links"><a href="#orders/detail/${e(o.id)}">Open the order ${icon('arrow')}</a><a href="#bookings">Reservations ${icon('arrow')}</a></div>`;
  }

  // ---------------------------------------------------------------- actions (all through set_order_status)
  const ACT = {
    take: ['confirmed', ['The customer is told the order is confirmed and can pay.', { title: 'Take this order?', confirm: 'Take order' }], 'Order taken. The customer can pay now.'],
    start: ['preparing', ['Ingredients for this order are taken from Inventory now.', { title: 'Start making?', confirm: 'Start making' }], 'Baking started. The timer is running.'],
    ready: ['ready', null, 'Marked ready. Nice work.'],
    complete: ['completed', ['The order moves to Completed.', { title: 'Mark handed over?', confirm: 'Mark handed over' }], 'Handed over.'],
  };
  content.addEventListener('click', async (event) => {
    const b = event.target.closest('[data-act]');
    if (!b) {
      const pick = event.target.closest('[data-pick]'); if (!pick) return;
      picked = pick.dataset.pick;
      content.querySelectorAll('[data-pick],[data-oven]').forEach((x) => x.classList.toggle('is-picked', (x.dataset.oven || x.dataset.pick) === picked));
      paintTicket();
      if (matchMedia('(max-width: 1100px)').matches) $('[data-ticket]').scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
      return;
    }
    const [next, confirm, done] = ACT[b.dataset.act] || [];
    if (!next || (confirm && !(await ask(...confirm)))) return;
    b.disabled = true;
    try {
      await db.rpc('set_order_status', { order_id: b.dataset.id, next_status: next });
      picked = b.dataset.id; if (next === 'ready' || next === 'completed') celebrate = b.dataset.id;
      await refresh(true, false);
      toast(done);
    } catch (error) {
      b.disabled = false;
      const say = $('[data-ticket] .ps-say'); if (say && picked === b.dataset.id) say.textContent = error.message;
      toast(error.message || 'Could not update this task.', true);
    }
  });
  function toast(text, bad) {
    const t = Object.assign(document.createElement('div'), { className: 'ps-toast' + (bad ? ' is-bad' : ''), textContent: text });
    t.setAttribute('role', 'status');
    content.querySelector('[data-ps]')?.append(t);
    setTimeout(() => t.classList.add('is-out'), 2600); setTimeout(() => t.remove(), 3100);
  }

  // ---------------------------------------------------------------- refresh, day switching, the running clock
  async function refresh(fresh, busy = true) {
    if (busy) $('[data-board]')?.setAttribute('aria-busy', 'true');
    try { await load(fresh); paintLeft(); paintBoard(); paintTicket(); }
    catch (error) {
      console.warn('Production:', error);
      $('[data-board]').innerHTML = `<div class="ps-empty" role="alert"><p>The shift could not load.</p><button class="ps-btn" type="button" data-retry>Try again</button></div>`;
      $('[data-board] [data-retry]').onclick = () => refresh(true);
    }
  }
  function go(date) { selected = date; picked = null; refresh(false); }
  clearInterval(window.__lexcShiftTimer);
  window.__lexcShiftTimer = setInterval(() => {
    if (!content.isConnected || !content.querySelector('[data-ps]')) { clearInterval(window.__lexcShiftTimer); return; }
    tick++;
    content.querySelectorAll('[data-oven]').forEach((card) => {
      const r = state.rows.find((x) => x.order_id === card.dataset.oven); if (!r) return;
      const el = elapsed(r), total = Math.max(1, Number(r.minutes) || 0) * 60;
      card.querySelector('[data-timer]').textContent = mmss(el);
      card.querySelector('[data-progress]').style.width = Math.min(100, (el / total) * 100) + '%';
      card.classList.toggle('is-over', Number(r.minutes) > 0 && el > total);
      card.querySelector('[data-timer-note]').textContent = timerNote(r, el);
    });
    if (tick % 30 === 0 && selected === today) {
      const now = manilaMinutes(), { start, end } = state.window, marker = content.querySelector('[data-now]'), c = content.querySelector('[data-now-clock]');
      if (marker) marker.style.left = Math.min(100, Math.max(0, ((now - start) / Math.max(60, end - start)) * 100)) + '%';
      if (c) c.textContent = clock(now);
    }
  }, 1000);

  // opened from Orders or Reservations (#production/<order id>): jump to that order's day and open its ticket
  if (focus && /^[0-9a-f-]{36}$/i.test(focus)) {
    try {
      const [o] = db.unwrap(await db.client.from('orders').select('id,receiving_start').eq('id', focus)) || [];
      if (o?.receiving_start) { selected = manilaKey(new Date(o.receiving_start)); picked = focus; }
    } catch (error) { console.warn('Production focus:', error); }
  }
  await refresh(false);
}
