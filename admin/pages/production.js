// Admin → Production: the kitchen shift as a workspace. Orders are production tasks that move through stages
// (Take order → Start → Baking timer → Ready → Handed over) on a 24-hour track of the day.
//   Left: the shift — workload ring, kitchen time (capacity) control, stage counts, on-time streak.
//   Middle: the shift board — day track (12:00 AM – 11:59 PM) with a live "now" marker, the order(s) baking with a
//     running timer, and what is done.
//   Right: a mini month calendar, the order ticket, and Plan ahead (tomorrow's tasks to start, to bake from tonight).
//   This day's own tasks to start stay in the middle, under the track (Up next).
// Planning (phase 101): drag a task onto the track — or tap it, "Place on the track", then tap a time — to choose
// when its bake starts; the bar is as long as the order's prep minutes. A plan for tomorrow's order made tonight shows
// on both days. Orders without a plan keep the automatic plan (phase 97). Overlaps are fine; late bakes are flagged.
// Data: get_production_day / save_production_capacity (phase 96), get_bake_timeline + production_settings (phase 97),
// order_bake_plans / set_bake_plan (phase 101), orders + order_items, booking_entries (reserved times), and the
// status messages in each order's chat (when it was confirmed, started, ready, completed).
// Every stage button is set_order_status, the same as Orders, so payment, inventory and status rules stay in the database.
import { escapeHtml as e, icon } from '../components.js?v=4';
import { db } from '../backend-ui.js?v=3';
import { ask } from '../../shared/ask.js?v=2';
import { clearProductionCache } from '../production-capacity.js?v=3';

const DAY = 864e5, MIN = 6e4, MAX = 750, SNAP = 10;
const manilaKey = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
const dayStart = (k) => Date.parse(k + 'T00:00:00+08:00');   // Manila has no daylight saving
const plus = (k, n) => new Date(Date.parse(k + 'T12:00:00Z') + n * DAY).toISOString().slice(0, 10);
const longDay = (k) => new Intl.DateTimeFormat('en-PH', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(k + 'T12:00:00Z'));
const shortDay = (k) => new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(k + 'T12:00:00Z'));
const clock = (min) => { if (min == null) return '—'; const m = ((Math.round(min) % 1440) + 1440) % 1440, h = Math.floor(m / 60); return `${h % 12 || 12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const at = (ms) => ms == null ? '' : new Date(ms).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' });
const atDay = (ms, k) => ms == null ? '' : `${at(ms)}${manilaKey(new Date(ms)) === k ? '' : ' ' + shortDay(manilaKey(new Date(ms)))}`;
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
  let selected = today, picked = null, placing = null, tick = 0, celebrate = null, calMonth = today.slice(0, 7), plansReady = true;
  const orders = new Map(), stamps = new Map(), plans = new Map();
  let state = { tasks: [], day: null, held: [], window: { start: 240, end: 990 } };

  content.innerHTML = `<div class="ps" data-ps>
    <aside class="ps-col ps-left" data-left aria-busy="true">${skel(4)}</aside>
    <section class="ps-col ps-board" data-board aria-busy="true">${skel(3)}</section>
    <aside class="ps-right"><section class="ps-col ps-cal" data-cal aria-label="Calendar"></section>
      <section class="ps-col ps-ticket" data-ticket><div class="ps-empty">${icon('orders')}<p>Pick a task to open its ticket.</p></div></section>
      <section class="ps-col ps-next" data-next aria-label="Up next"></section></aside>
  </div>`;
  const $ = (s) => content.querySelector(s);

  // ---------------------------------------------------------------- data
  // A task = one order's bake on the clock: { r (bake timeline row), day (its delivery date), start, finish, deadline (ms) }
  async function load(fresh) {
    if (fresh) { clearProductionCache(); orders.clear(); stamps.clear(); plans.clear(); }
    const next = plus(selected, 1);
    const [rows, tomorrow, day, held, win] = await Promise.all([
      db.rpc('get_bake_timeline', { target_date: selected }).catch((error) => { console.warn('Bake timeline:', error); return []; }),
      db.rpc('get_bake_timeline', { target_date: next }).catch(() => []),
      db.rpc('get_production_day', { target_date: selected }).catch((error) => { console.warn('Production day:', error); return null; }),
      db.client.from('booking_entries').select('id,customer_name,scheduled_start,scheduled_end,status').eq('booking_date', selected).is('order_id', null).neq('status', 'cancelled').then((r) => r.data || [], () => []),
      db.client.from('production_settings').select('bake_start_minutes,bake_end_minutes').maybeSingle().then((r) => r.data, () => null),
    ]);
    const all = (rows || []).map((r) => [r, selected]).concat((tomorrow || []).map((r) => [r, next]));
    const ids = all.map(([r]) => r.order_id);
    const need = ids.filter((id) => !orders.has(id));
    if (need.length) {
      const list = db.unwrap(await db.client.from('orders')
        .select('id,order_number,status,payment_status,fulfillment_method,receiving_start,notes,customer_name,created_at,order_items(name_snapshot,variant_label_snapshot,quantity)')
        .in('id', need)) || [];
      list.forEach((o) => orders.set(o.id, o));
    }
    await Promise.all([loadStamps(ids), loadPlans(ids)]);
    const tasks = all.map(([r, d]) => {
      const p = plans.get(r.order_id), base = dayStart(d), len = Math.max(0, Number(r.minutes) || 0) * MIN;
      const start = p ? Date.parse(p) : base + Number(r.bake_start_minutes ?? 0) * MIN;
      const deadline = base + Number(r.deadline_minutes ?? 1440) * MIN;
      return { r, day: d, start, finish: start + len, deadline, planned: !!p };
    });
    state = { tasks, day, held: held || [], window: { start: Number(win?.bake_start_minutes ?? 240), end: Number(win?.bake_end_minutes ?? 990) } };
  }
  async function loadPlans(ids) {
    const need = ids.filter((id) => !plans.has(id));
    if (!need.length) return;
    try {
      const list = db.unwrap(await db.client.from('order_bake_plans').select('order_id,planned_start').in('order_id', need)) || [];
      list.forEach((p) => plans.set(p.order_id, p.planned_start));
      plansReady = true;
    } catch (error) { plansReady = false; console.warn('Bake plans (run database/phase101-bake-plans.sql):', error); }
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
  const statusOf = (t) => orders.get(t.r.order_id)?.status || t.r.status;
  const late = (t) => t.planned ? t.finish > t.deadline : !t.r.fits;
  const onDay = (t, k = selected) => t.finish > dayStart(k) && t.start < dayStart(k) + DAY;   // the bake touches this day
  const ofDay = (t) => t.day === selected;                                                   // the order is due this day
  const taskOf = (id) => state.tasks.find((t) => t.r.order_id === id);
  const onTime = (t) => { const r = stamps.get(t.r.order_id)?.ready; return !!r && Date.parse(r) <= t.deadline; };

  // ---------------------------------------------------------------- left: the shift
  function paintLeft() {
    const box = $('[data-left]'), d = state.day, mine = state.tasks.filter(ofDay);
    const cap = Number(d?.workload_minutes) || 0, used = Number(d?.accepted_minutes) || 0, lv = level(used, cap);
    const p = cap > 0 ? Math.round((used / cap) * 100) : used > 0 ? 100 : 0;
    const count = (s) => mine.filter((t) => statusOf(t) === s).length;
    const done = count('ready') + count('completed'), streak = mine.filter(onTime).length;
    const hour = Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila', hour: 'numeric', hour12: false }));
    box.innerHTML = `
      <header class="ps-head"><div><small>${e(longDay(selected))} · shift ${e(clock(state.window.start))}${state.window.start < 0 ? ' the evening before' : ''} – ${e(clock(state.window.end))}</small>
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
    const box = $('[data-board]'), touching = state.tasks.filter((t) => onDay(t)).sort((a, b) => a.start - b.start);
    const baking = touching.filter((t) => statusOf(t) === 'preparing');
    const finished = state.tasks.filter((t) => ofDay(t) && ['ready', 'completed'].includes(statusOf(t)));
    const toStart = state.tasks.some((t) => ['confirmed', 'pending'].includes(statusOf(t)));
    const upNext = state.tasks.filter((t) => ofDay(t) && ['confirmed', 'pending'].includes(statusOf(t))).sort((a, b) => a.start - b.start);
    const live = selected === today;
    box.innerHTML = `
      <header class="ps-boardhead">
        <div class="ps-daynav"><button type="button" class="ps-icon" data-step="-1" aria-label="Previous day">‹</button>
          <h2>Kitchen <em>shift</em></h2><button type="button" class="ps-icon" data-step="1" aria-label="Next day">›</button></div>
        <div class="ps-row"><span class="ps-date">${e(longDay(selected))}</span>
          ${live ? `<span class="ps-tag is-live"><span class="ps-dot" aria-hidden="true"></span><span data-now-clock>${e(clock(manilaMinutes()))}</span> · live</span>` : `<button type="button" class="ps-tag" data-today-btn>Back to today</button>`}</div>
      </header>
      ${track(touching)}
      <p class="ps-hint-line" data-drop-hint>${placing ? `Tap a time on the track to start #${e(orders.get(placing)?.order_number || '')}. <button type="button" class="ps-linkbtn" data-cancel-place>Cancel</button>` : plansReady ? 'Drag a task from Up next onto the track to plan when its bake starts.' : 'To plan bakes on the track, run database/phase101-bake-plans.sql in the Supabase SQL editor.'}</p>
      ${baking.length ? `<div class="ps-active">${baking.map(activeCard).join('')}</div>`
        : `<div class="ps-idle">${icon('clock')}<p>${toStart ? 'Nothing in the oven. Start the next task when you’re ready.' : state.tasks.some(ofDay) ? 'All tasks for this day are done.' : 'No tasks planned for this day.'}</p></div>`}
      ${upNext.length ? `<div class="ps-row ps-subrow"><h3 class="ps-sub">Up next</h3><small>${upNext.length} to start${plansReady ? ' · drag onto the track' : ''}</small></div><div class="ps-tickets">${upNext.map(ticketCard).join('')}</div>` : ''}
      ${finished.length ? `<h3 class="ps-sub">Done</h3><div class="ps-done">${finished.map(doneRow).join('')}</div>` : ''}
      ${state.day && Number(state.day.pending_minutes) > 0 ? projection(state.day) : ''}`;
    box.removeAttribute('aria-busy');
    box.querySelectorAll('[data-step]').forEach((b) => (b.onclick = () => go(plus(selected, Number(b.dataset.step)))));
    box.querySelectorAll('[data-today-btn]').forEach((b) => (b.onclick = () => go(today)));
    box.querySelector('[data-cancel-place]')?.addEventListener('click', () => { placing = null; paintBoard(); });
    bindLane(box.querySelector('[data-lane]'));
    if (celebrate) { box.querySelector(`[data-done-id="${celebrate}"]`)?.classList.add('is-new'); celebrate = null; }
  }
  function track(list) {
    const d0 = dayStart(selected), pos = (ms) => Math.min(100, Math.max(0, ((ms - d0) / DAY) * 100));
    const hours = [0, 180, 360, 540, 720, 900, 1080, 1260];
    const now = selected === today ? Date.now() : null;
    const toMin = (t) => { const [hh, mm] = String(t || '').split(':').map(Number); return Number.isFinite(hh) ? hh * 60 + (mm || 0) : null; };
    const held = state.held.map((h) => { const a = toMin(h.scheduled_start), b = toMin(h.scheduled_end) ?? (a == null ? null : a + 60); if (a == null) return '';
      return `<span class="ps-block is-held" style="left:${pos(d0 + a * MIN)}%;width:${Math.max(2, pos(d0 + b * MIN) - pos(d0 + a * MIN))}%" title="Reserved · ${e(h.customer_name)}">${e(h.customer_name)}</span>`; }).join('');
    const blocks = list.map((t) => {
      const s = statusOf(t), left = pos(t.start), width = Math.max(2, pos(t.finish) - left), cin = t.start < d0, cout = t.finish > d0 + DAY;
      const label = `${cin ? '← ' : ''}#${t.r.order_number}${cout ? ' →' : ''}`;
      const title = `#${t.r.order_number} · ${atDay(t.start, selected)} – ${atDay(t.finish, selected)}${t.planned ? ' · planned' : ''}${t.day !== selected ? ` · for ${shortDay(t.day)}` : ''}${late(t) ? ' · finishes after its deadline' : ''}`;
      const movable = plansReady && !['ready', 'completed'].includes(s);
      return `<button type="button" class="ps-block is-${TONE[s] || 'start'}${cin ? ' is-carry-in' : ''}${cout ? ' is-carry-out' : ''}${t.planned ? ' is-planned' : ''}${late(t) ? ' is-bad' : ''}${picked === t.r.order_id ? ' is-picked' : ''}" style="left:${left}%;width:${width}%" data-pick="${e(t.r.order_id)}"${movable ? ` draggable="true" data-drag="${e(t.r.order_id)}"` : ''} title="${e(title)}">${e(label)}</button>`;
    }).join('');
    return `<div class="ps-track${placing ? ' is-placing' : ''}" aria-label="Day plan from 12:00 AM to 11:59 PM">
      <div class="ps-hours" aria-hidden="true">${hours.map((h) => `<span style="left:${(h / 1440) * 100}%">${e(clock(h).replace(':00', ''))}</span>`).join('')}<span style="left:100%">11:59 PM</span></div>
      <div class="ps-lane" data-lane>${held}${blocks}
      ${now != null ? `<span class="ps-now" style="left:${pos(now)}%" data-now><i>now</i></span>` : ''}
      <span class="ps-ghost" data-ghost hidden></span></div></div>`;
  }
  function elapsed(t) {
    const s = stamps.get(t.r.order_id)?.preparing;
    return ((s ? Date.parse(s) : null) != null ? Date.now() - Date.parse(s) : Date.now() - t.start) / 1000;
  }
  const timerNote = (t, el) => `${Number(t.r.minutes) ? `${Math.min(Math.round(el / 60), 9999)} of ${Math.round(t.r.minutes)} min` : 'No prep time set'} · finish by ${atDay(t.deadline, selected)}`;
  function activeCard(t) {
    const o = orders.get(t.r.order_id), total = Math.max(1, Number(t.r.minutes) || 0) * 60, el = elapsed(t), p = Math.min(100, Math.max(0, (el / total) * 100)), over = el > total && Number(t.r.minutes) > 0;
    return `<article class="ps-oven${over ? ' is-over' : ''}${picked === t.r.order_id ? ' is-picked' : ''}" data-oven="${e(t.r.order_id)}">
      <div class="ps-row"><span class="ps-tag is-bake">${icon('clock')} Baking now</span><small>#${e(t.r.order_number)} · due ${e(atDay(Date.parse(t.r.delivery_at), selected))}</small></div>
      <h3>${e(what(o))}</h3>
      <div class="ps-timer"><b data-timer>${mmss(el)}</b><div><div class="ps-progress"><span data-progress style="width:${p}%"></span></div><small data-timer-note>${e(timerNote(t, el))}</small></div></div>
      <div class="ps-row"><button type="button" class="ps-btn" data-act="ready" data-id="${e(t.r.order_id)}">Mark ready</button><button type="button" class="ps-btn is-ghost" data-pick="${e(t.r.order_id)}">Details</button></div>
    </article>`;
  }
  function doneRow(t) {
    const o = orders.get(t.r.order_id), s = statusOf(t), r = stamps.get(t.r.order_id)?.ready;
    return `<button type="button" class="ps-done-row${picked === t.r.order_id ? ' is-picked' : ''}" data-pick="${e(t.r.order_id)}" data-done-id="${e(t.r.order_id)}">
      <span class="ps-check" aria-hidden="true">${icon('check')}</span><span class="ps-done-text"><b>#${e(t.r.order_number)} ${e(what(o))}</b><small>${s === 'completed' ? 'Handed over' : 'Ready'}${r ? ' · ' + e(at(Date.parse(r))) : ''}</small></span>
      ${onTime(t) ? '<span class="ps-tag is-ok">On time</span>' : ''}</button>`;
  }
  function projection(d) {
    const cap = Number(d.workload_minutes) || 0, total = (Number(d.accepted_minutes) || 0) + (Number(d.pending_minutes) || 0), lv = level(total, cap);
    return `<p class="ps-project is-${lv}">If you take every new order: ${Math.round(total)} of ${Math.round(cap)} min${lv === 'heavy' ? ` — ${Math.round(total - cap)} min over` : lv === 'near' ? ', nearly full' : ', still within capacity'}</p>`;
  }

  // ---------------------------------------------------------------- planning: drag onto the track, or tap then tap
  const minuteAt = (lane, clientX) => { const b = lane.getBoundingClientRect(); return Math.round((Math.min(1, Math.max(0, (clientX - b.left) / b.width)) * 1440) / SNAP) * SNAP; };
  function preview(lane, id, minute) {
    const t = taskOf(id), ghost = lane.querySelector('[data-ghost]'), hint = $('[data-drop-hint]');
    if (!t) return;
    const start = dayStart(selected) + minute * MIN, finish = start + Math.max(0, Number(t.r.minutes) || 0) * MIN, isLate = finish > t.deadline;
    ghost.hidden = false; ghost.style.left = (minute / 1440) * 100 + '%'; ghost.style.width = Math.max(1.5, Math.min(100 - (minute / 1440) * 100, (Number(t.r.minutes) / 1440) * 100)) + '%';
    ghost.classList.toggle('is-bad', isLate);
    hint.innerHTML = `<b>#${e(t.r.order_number)}</b> · start ${e(atDay(start, selected))} · done ${e(atDay(finish, selected))} · ${t.r.fulfillment_method === 'lalamove' || orders.get(id)?.fulfillment_method === 'lalamove' ? 'deliver' : 'pickup'} ${e(atDay(Date.parse(t.r.delivery_at), selected))} ${isLate ? `<span class="is-bad">· finishes ${mins((finish - t.deadline) / MIN)} after its deadline</span>` : '<span class="is-ok">· in time</span>'}`;
  }
  async function plan(id, minute) {
    const t = taskOf(id); if (!t) return;
    const start = new Date(dayStart(selected) + minute * MIN).toISOString();
    try {
      await db.rpc('set_bake_plan', { target_order: id, planned: start });
      plans.set(id, start); placing = null; picked = id;
      await refresh(false, false);
      toast(`#${t.r.order_number} planned: starts ${atDay(Date.parse(start), selected)}.`);
    } catch (error) { toast(/set_bake_plan|schema cache/i.test(error.message || '') ? 'Run database/phase101-bake-plans.sql first.' : error.message || 'Could not plan this bake.', true); paintBoard(); }
  }
  function bindLane(lane) {
    if (!lane) return;
    lane.addEventListener('dragover', (ev) => { const id = content.dataset.dragging; if (!id) return; ev.preventDefault(); ev.dataTransfer.dropEffect = 'move'; preview(lane, id, minuteAt(lane, ev.clientX)); });
    lane.addEventListener('dragleave', (ev) => { if (!lane.contains(ev.relatedTarget)) lane.querySelector('[data-ghost]').hidden = true; });
    lane.addEventListener('drop', (ev) => { const id = content.dataset.dragging; if (!id) return; ev.preventDefault(); lane.querySelector('[data-ghost]').hidden = true; plan(id, minuteAt(lane, ev.clientX)); });
    lane.addEventListener('mousemove', (ev) => { if (placing && !ev.target.closest('[data-pick]')) preview(lane, placing, minuteAt(lane, ev.clientX)); });
    lane.addEventListener('click', (ev) => { if (!placing) return; ev.stopPropagation(); plan(placing, minuteAt(lane, ev.clientX)); }, true);
  }
  content.addEventListener('dragstart', (ev) => {
    const el = ev.target.closest?.('[data-drag]'); if (!el) return;
    content.dataset.dragging = el.dataset.drag; ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', el.dataset.drag);
    el.classList.add('is-dragging'); content.querySelector('.ps-track')?.classList.add('is-target');
  });
  content.addEventListener('dragend', (ev) => {
    delete content.dataset.dragging; ev.target.closest?.('[data-drag]')?.classList.remove('is-dragging');
    content.querySelector('.ps-track')?.classList.remove('is-target'); const g = content.querySelector('[data-ghost]'); if (g) g.hidden = true;
  });

  // ---------------------------------------------------------------- right: mini calendar, ticket, up next
  const busyDays = new Map();   // 'YYYY-MM' -> Map(day -> count of orders)
  async function paintCal() {
    const box = $('[data-cal]'), [y, m] = calMonth.split('-').map(Number), first = new Date(Date.UTC(y, m - 1, 1)), days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    if (!busyDays.has(calMonth)) {
      busyDays.set(calMonth, new Map());
      try {
        const from = `${calMonth}-01T00:00:00+08:00`, to = `${plus(`${calMonth}-${String(days).padStart(2, '0')}`, 1)}T00:00:00+08:00`;
        const list = db.unwrap(await db.client.from('orders').select('receiving_start').gte('receiving_start', from).lt('receiving_start', to).neq('status', 'cancelled')) || [];
        const map = busyDays.get(calMonth); list.forEach((o) => { const k = manilaKey(new Date(o.receiving_start)); map.set(k, (map.get(k) || 0) + 1); });
      } catch (error) { console.warn('Calendar:', error); }
    }
    const busy = busyDays.get(calMonth), lead = (first.getUTCDay() + 6) % 7;
    const title = new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(first);
    const cells = Array.from({ length: lead }, () => '<span></span>').concat(Array.from({ length: days }, (_, i) => {
      const k = `${calMonth}-${String(i + 1).padStart(2, '0')}`, n = busy.get(k) || 0;
      return `<button type="button" data-cal-day="${k}" class="${k === selected ? 'is-on' : ''}${k === today ? ' is-today' : ''}" aria-pressed="${k === selected}" aria-label="${e(longDay(k))}${n ? ` · ${n} order${n === 1 ? '' : 's'}` : ''}">${i + 1}${n ? `<i class="${n >= 4 ? 'is-many' : ''}"></i>` : ''}</button>`;
    }));
    box.innerHTML = `<div class="ps-row"><button type="button" class="ps-icon is-sm" data-cal-step="-1" aria-label="Previous month">‹</button><b>${e(title)}</b><button type="button" class="ps-icon is-sm" data-cal-step="1" aria-label="Next month">›</button></div>
      <div class="ps-cal-grid" aria-hidden="true">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => `<small>${d}</small>`).join('')}</div>
      <div class="ps-cal-grid">${cells.join('')}</div>`;
    box.querySelectorAll('[data-cal-step]').forEach((b) => (b.onclick = () => { const d = new Date(Date.UTC(y, m - 1 + Number(b.dataset.calStep), 1)); calMonth = d.toISOString().slice(0, 7); paintCal(); }));
    box.querySelectorAll('[data-cal-day]').forEach((b) => (b.onclick = () => go(b.dataset.calDay)));
  }
  function paintNext() {
    // tomorrow's tasks to start: bake them tonight by dragging onto this day's track
    const next = plus(selected, 1), list = state.tasks.filter((t) => t.day === next && ['confirmed', 'pending'].includes(statusOf(t))).sort((a, b) => a.start - b.start);
    box.hidden = !list.length;
    box.innerHTML = `<div class="ps-row"><h3>Plan ahead · ${e(shortDay(next))}</h3><small>${list.length} to start</small></div>
      <p class="ps-hint">${plansReady ? `Drag onto ${e(shortDay(selected))}’s track to bake it the night before.` : 'Planning turns on once database/phase101-bake-plans.sql is run.'}</p>
      <div class="ps-tickets">${list.map(ticketCard).join('')}</div>`;
  }
  function ticketCard(t) {
    const o = orders.get(t.r.order_id), s = statusOf(t), paid = ['paid', 'partially_paid'].includes(o?.payment_status);
    const action = s === 'pending' ? `<button type="button" class="ps-chip is-take" data-act="take" data-id="${e(t.r.order_id)}">Take order</button>`
      : paid ? `<button type="button" class="ps-chip" data-act="start" data-id="${e(t.r.order_id)}">Start</button>` : `<span class="ps-chip is-wait" title="Start opens once a payment is marked received">Waiting for payment</span>`;
    return `<div class="ps-ticket-card is-${TONE[s]}${late(t) ? ' is-bad' : ''}${picked === t.r.order_id ? ' is-picked' : ''}${placing === t.r.order_id ? ' is-placing' : ''}" data-pick="${e(t.r.order_id)}"${plansReady ? ` draggable="true" data-drag="${e(t.r.order_id)}"` : ''}>
      <small><span class="ps-grip" aria-hidden="true">⋮⋮</span> #${e(t.r.order_number)} · ${e(shortDay(t.day))}${t.day !== selected ? ' (tomorrow)' : ''} · ${e(mins(t.r.minutes))}</small>
      <b>${e(what(o))}</b><small>${t.planned ? 'Planned' : s === 'pending' ? 'New order · auto plan' : 'Auto plan'} ${e(atDay(t.start, selected))} · ${o?.fulfillment_method === 'lalamove' ? 'deliver' : 'pickup'} ${e(atDay(Date.parse(t.r.delivery_at), selected))}</small>
      ${late(t) ? '<small class="is-bad">Finishes after its deadline</small>' : ''}${action}</div>`;
  }
  function paintTicket() {
    const box = $('[data-ticket]'), t = taskOf(picked), o = orders.get(picked);
    if (!t || !o) { box.innerHTML = `<div class="ps-empty">${icon('orders')}<p>Pick a task to open its ticket.</p></div>`; return; }
    const st = stamps.get(o.id) || {}, s = o.status, paid = ['paid', 'partially_paid'].includes(o.payment_status), cap = Number(state.day?.workload_minutes) || 0;
    const steps = [['Order taken', o.created_at, true], ['Confirmed', st.confirmed, s !== 'pending'], ['Baking', st.preparing, ['preparing', 'ready', 'completed'].includes(s)], ['Ready', st.ready, ['ready', 'completed'].includes(s)], ['Handed over', st.completed, s === 'completed']];
    const nowStep = s === 'preparing' ? 2 : -1, canPlan = plansReady && !['ready', 'completed', 'preparing'].includes(s);
    const action = s === 'pending' ? `<button type="button" class="ps-btn is-wide" data-act="take" data-id="${e(o.id)}">Take order</button>`
      : s === 'confirmed' ? (paid ? `<button type="button" class="ps-btn is-wide" data-act="start" data-id="${e(o.id)}">Start making</button>` : `<p class="ps-warn">Waiting for payment. Start opens once you mark a payment received in Orders.</p><a class="ps-btn is-wide is-ghost" href="#orders/detail/${e(o.id)}">Check payment</a>`)
      : s === 'preparing' ? `<button type="button" class="ps-btn is-wide" data-act="ready" data-id="${e(o.id)}">Mark ready</button>`
      : s === 'ready' ? `<button type="button" class="ps-btn is-wide" data-act="complete" data-id="${e(o.id)}">Mark handed over</button>` : '';
    box.innerHTML = `
      <header class="ps-row"><h2>Order ticket</h2><small>#${e(o.order_number)} · for ${e(shortDay(t.day))}</small></header>
      <div class="ps-stub is-${TONE[s]}"><small>${e(o.customer_name || t.r.customer_name || 'Customer')}</small><b>${e(what(o))}</b>
        <small>${o.fulfillment_method === 'lalamove' ? 'Deliver' : 'Pickup'} ${e(atDay(Date.parse(t.r.delivery_at), selected))} · bake ${e(atDay(t.start, selected))} – ${e(atDay(t.finish, selected))}</small>
        <small>${t.planned ? '<b class="ps-planned">Planned by you</b>' : 'Auto plan'}${canPlan ? ` · <button type="button" class="ps-linkbtn" data-place="${e(o.id)}">${placing === o.id ? 'Tap a time on the track…' : 'Place on the track'}</button>` : ''}${t.planned && canPlan ? ` · <button type="button" class="ps-linkbtn" data-clear-plan="${e(o.id)}">Clear plan</button>` : ''}</small></div>
      ${late(t) ? `<p class="ps-warn">${t.planned ? `This bake finishes ${e(mins((t.finish - t.deadline) / MIN))} after its finish-by time (${e(atDay(t.deadline, selected))}). Move it earlier.` : 'This task would have to start before the shift opens. Place it on the track yourself, or start it earlier.'}</p>` : ''}
      <ol class="ps-steps">${steps.map(([label, time, done], i) => `<li class="${i === nowStep ? 'is-now' : done ? 'is-done' : ''}"><span aria-hidden="true">${done && i !== nowStep ? icon('check') : ''}</span><b>${label}</b>${time && done ? `<small>${e(at(Date.parse(time)))}</small>` : ''}</li>`).join('')}</ol>
      <dl class="ps-facts"><div><dt>Kitchen time</dt><dd>${e(mins(t.r.minutes))}${cap > 0 && ofDay(t) ? ` · ${Math.round((Number(t.r.minutes) / cap) * 100)}% of the day` : ''}</dd></div>
        <div><dt>Payment</dt><dd class="${paid ? 'is-ok' : ''}">${e(PAY[o.payment_status] || '—')}</dd></div>
        ${o.notes ? `<div><dt>Notes</dt><dd>${e(o.notes)}</dd></div>` : ''}</dl>
      ${Number(t.r.minutes) ? '' : '<p class="ps-hint">No prep time is set for this product. Set it in Products → the product → Prep time.</p>'}
      <p class="ps-say" role="alert"></p>
      ${action}
      <div class="ps-links"><a href="#orders/detail/${e(o.id)}">Open the order ${icon('arrow')}</a><a href="#bookings">Reservations ${icon('arrow')}</a></div>`;
  }

  // ---------------------------------------------------------------- actions (stages through set_order_status)
  const ACT = {
    take: ['confirmed', ['The customer is told the order is confirmed and can pay.', { title: 'Take this order?', confirm: 'Take order' }], 'Order taken. The customer can pay now.'],
    start: ['preparing', ['Ingredients for this order are taken from Inventory now.', { title: 'Start making?', confirm: 'Start making' }], 'Baking started. The timer is running.'],
    ready: ['ready', null, 'Marked ready. Nice work.'],
    complete: ['completed', ['The order moves to Completed.', { title: 'Mark handed over?', confirm: 'Mark handed over' }], 'Handed over.'],
  };
  content.addEventListener('click', async (event) => {
    const place = event.target.closest('[data-place]');
    if (place) { placing = placing === place.dataset.place ? null : place.dataset.place; paintBoard(); paintTicket(); paintNext(); $('.ps-track')?.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center' }); return; }
    const clear = event.target.closest('[data-clear-plan]');
    if (clear) {
      try { await db.rpc('set_bake_plan', { target_order: clear.dataset.clearPlan, planned: null }); plans.delete(clear.dataset.clearPlan); await refresh(false, false); toast('Back on the automatic plan.'); }
      catch (error) { toast(error.message || 'Could not clear the plan.', true); }
      return;
    }
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
  content.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && placing) { placing = null; paintBoard(); paintTicket(); paintNext(); } });
  function toast(text, bad) {
    const t = Object.assign(document.createElement('div'), { className: 'ps-toast' + (bad ? ' is-bad' : ''), textContent: text });
    t.setAttribute('role', 'status');
    content.querySelector('[data-ps]')?.append(t);
    setTimeout(() => t.classList.add('is-out'), 2600); setTimeout(() => t.remove(), 3100);
  }

  // ---------------------------------------------------------------- refresh, day switching, the running clock
  async function refresh(fresh, busy = true) {
    if (busy) $('[data-board]')?.setAttribute('aria-busy', 'true');
    try { await load(fresh); if (fresh) busyDays.clear(); paintLeft(); paintBoard(); paintTicket(); paintNext(); paintCal(); }
    catch (error) {
      console.warn('Production:', error);
      $('[data-board]').innerHTML = `<div class="ps-empty" role="alert"><p>The shift could not load.</p><button class="ps-btn" type="button" data-retry>Try again</button></div>`;
      $('[data-board] [data-retry]').onclick = () => refresh(true);
    }
  }
  function go(date) { selected = date; calMonth = date.slice(0, 7); picked = placing ? placing : null; refresh(false); }
  clearInterval(window.__lexcShiftTimer);
  window.__lexcShiftTimer = setInterval(() => {
    if (!content.isConnected || !content.querySelector('[data-ps]')) { clearInterval(window.__lexcShiftTimer); return; }
    tick++;
    content.querySelectorAll('[data-oven]').forEach((card) => {
      const t = taskOf(card.dataset.oven); if (!t) return;
      const el = elapsed(t), total = Math.max(1, Number(t.r.minutes) || 0) * 60;
      card.querySelector('[data-timer]').textContent = mmss(el);
      card.querySelector('[data-progress]').style.width = Math.min(100, (el / total) * 100) + '%';
      card.classList.toggle('is-over', Number(t.r.minutes) > 0 && el > total);
      card.querySelector('[data-timer-note]').textContent = timerNote(t, el);
    });
    if (tick % 30 === 0 && selected === today) {
      const marker = content.querySelector('[data-now]'), c = content.querySelector('[data-now-clock]');
      if (marker) marker.style.left = ((Date.now() - dayStart(today)) / DAY) * 100 + '%';
      if (c) c.textContent = clock(manilaMinutes());
    }
  }, 1000);

  // opened from Orders or Reservations (#production/<order id>): jump to that order's day and open its ticket
  if (focus && /^[0-9a-f-]{36}$/i.test(focus)) {
    try {
      const [o] = db.unwrap(await db.client.from('orders').select('id,receiving_start').eq('id', focus)) || [];
      if (o?.receiving_start) { selected = manilaKey(new Date(o.receiving_start)); calMonth = selected.slice(0, 7); picked = focus; }
    } catch (error) { console.warn('Production focus:', error); }
  }
  await refresh(false);
}
