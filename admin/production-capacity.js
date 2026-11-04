// Reservations → Daily production capacity (phase 96). One panel for the selected date:
//  * Daily Production Capacity — a slider (0–750 min) for the kitchen minutes the Admin will take that day. Its track
//    also shows the minutes already ACCEPTED (confirmed and later) — that part moves by itself as orders are
//    confirmed or cancelled — plus how much is still pending.
//  * Client Reservation Slots — how many customers can book the date (1–30).
//  * Workload Overview — accepted minutes ÷ the day's capacity.
//  * Incoming Reservation Preview — each pending order: where it would take the day, and whether it is a
//    "Heavy production workload" (over capacity). Customers never see any of this.
// Data: get_production_day / save_production_capacity (database/phase96-production-capacity.sql).
import { escapeHtml as e } from './components.js?v=3';
import { db } from './backend-ui.js?v=3';
import { ask } from '../shared/ask.js?v=1';

const MAX = 750, MAX_SLOTS = 30, STEP = 5;
const cache = new Map();
let flash = null;   // the last "Saved …" message, shown again after the page reloads its data
export const clearProductionCache = () => cache.clear();

export const hrs = (min) => {
  const m = Math.max(0, Math.round(Number(min) || 0)), h = Math.floor(m / 60), r = m % 60;
  if (!h) return `${r} min${r === 1 ? '' : 's'}`;
  return `${h} hr${h === 1 ? '' : 's'}${r ? ` ${r} min${r === 1 ? '' : 's'}` : ''}`;
};
const pct = (part, whole) => whole > 0 ? Math.round((part / whole) * 1000) / 10 : (part > 0 ? Infinity : 0);
const pctText = (p) => p === Infinity ? 'over' : `${p.toFixed(1).replace(/\.0$/, '')}%`;
const longDate = (d) => new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(d + 'T12:00:00Z'));
const svg = (path, cls = 'pc-ico') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
const ICON = {
  heart: '<path d="M12 20s-7-4.4-9-9a4.9 4.9 0 0 1 9-3.6A4.9 4.9 0 0 1 21 11c-2 4.6-9 9-9 9Z"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01"/>',
  bars: '<path d="M5 20v-6M10 20V9M15 20v-9M20 20V5"/>',
  people: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.4"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5M14.5 14.6c2.6-.4 4.9 1 5.5 4.4"/>',
  pie: '<path d="M12 3v9h9"/><path d="M20.5 15.5A9 9 0 1 1 8.5 3.7"/>',
  alert: '<path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 10v4M12 17h.01"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.6 2.6L16 9.6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
};

async function load(date, fresh) {
  if (!fresh && cache.has(date)) return cache.get(date);
  const data = await db.rpc('get_production_day', { target_date: date });
  cache.set(date, data);
  return data;
}

/**
 * @param {HTMLElement} host
 * @param {{date:string, onDate:(d:string)=>void, onSaved:()=>void}} o
 */
export async function mountProductionPanel(host, { date, onDate, onSaved }) {
  if (!host) return;
  if (!cache.has(date)) host.innerHTML = '<div class="pc-loading" role="status" aria-busy="true">Loading daily capacity…</div>';
  let d;
  try { d = await load(date); }
  catch (error) {
    console.warn('Production capacity:', error);
    host.innerHTML = `<div class="pc-setup" role="alert">${svg(ICON.info)}<div><strong>Daily production capacity is not set up yet.</strong><p>Run <code>database/phase96-production-capacity.sql</code> in Supabase → SQL Editor, then reload this page.</p><small>${e(error.message || '')}</small></div></div>`;
    return;
  }
  if (!host.isConnected) return;
  draw(host, d, { date, onDate, onSaved });
}

function draw(host, d, ctx) {
  const cap = Number(d.workload_minutes), used = Number(d.accepted_minutes), pending = Number(d.pending_minutes);
  const slots = Number(d.slots), booked = Number(d.active_bookings), free = Math.max(0, slots - booked);
  const projected = used + pending, usedPct = pct(used, cap);
  const level = cap === 0 && used === 0 ? 'ok' : usedPct > 100 ? 'heavy' : usedPct >= 80 ? 'near' : 'ok';
  const pendingOrders = (d.orders || []).filter((o) => !o.accepted);
  const zeroMinute = (d.orders || []).some((o) => Number(o.minutes) === 0);

  host.innerHTML = `
  <header class="pc-head">
    <div><h2>Good day, Admin! ${svg(ICON.heart, 'pc-ico pc-heart')}</h2><p>Manage your daily workload and reservation settings.</p></div>
    <label class="pc-date">${svg(ICON.calendar)}<span class="pc-sr">Date</span><input type="date" value="${e(d.booking_date)}" data-pc-date aria-label="Choose a date"><b>${e(longDate(d.booking_date))}</b></label>
  </header>
  ${d.is_closed ? `<p class="pc-closed">${svg(ICON.info)} This date is closed for new reservations.</p>` : ''}

  <section class="pc-card pc-capacity" aria-labelledby="pc-cap-title">
    <div class="pc-cap-value">
      <h3 id="pc-cap-title">${svg(ICON.bars, 'pc-ico pc-ico--tile')} Daily Production Capacity</h3>
      <strong data-pc-cap-big>${cap} min</strong>
      <small data-pc-cap-hrs>≈ ${hrs(cap)}</small>
    </div>
    <div class="pc-slider">
      <div class="pc-range-wrap"><div class="pc-bubble" data-pc-bubble aria-hidden="true">${cap} min</div>
      <input type="range" min="0" max="${MAX}" step="${STEP}" value="${cap}" data-pc-range aria-label="Daily production capacity in minutes" aria-valuetext="${cap} minutes, ${hrs(cap)}"></div>
      <div class="pc-scale"><span>0 min</span><span>${MAX} min (${hrs(MAX)})</span></div>
      <ul class="pc-legend">
        <li><i class="is-used"></i>Accepted <b>${used} min</b></li>
        <li><i class="is-pending"></i>Pending <b>+${pending} min</b>${d.pending_count ? ` <small>(${d.pending_count} order${d.pending_count === 1 ? '' : 's'})</small>` : ''}</li>
        <li><i class="is-free"></i>Your capacity <b data-pc-cap-legend>${cap} min</b></li>
      </ul>
    </div>
    <form class="pc-apply" data-pc-cap-form>
      <span class="pc-apply__label">${svg(ICON.check, 'pc-ico pc-ico--ok')} Apply to:</span>
      <select name="scope" aria-label="Apply the capacity to"><option value="day">This Date Only</option><option value="all">All Dates</option></select>
      <button class="button primary" type="submit" data-pc-cap-save disabled>Save capacity</button>
      <small class="pc-note">${d.workload_custom ? 'Set for this date.' : `Using the default (${d.default_workload_minutes} min).`}</small>
    </form>
    <form class="pc-clean" data-pc-clean-form>
      <label>Cleaning / setup per order <input name="clean" type="number" min="0" max="120" step="1" inputmode="numeric" value="${Number(d.cleaning_minutes)}"> min</label>
      <button class="button" type="submit">Save</button>
      <small>Added once to every new order. Orders already placed keep their minutes.</small>
    </form>
  </section>

  <div class="pc-row">
    <section class="pc-card pc-slots" aria-labelledby="pc-slots-title">
      <h3 id="pc-slots-title">${svg(ICON.people, 'pc-ico pc-ico--tile')} Client Reservation Slots</h3>
      <p class="pc-sub">Set the maximum number of client slots for this date.</p>
      <form class="pc-slots__form" data-pc-slots-form>
        <div class="pc-stepper">
          <button type="button" data-pc-step="-1" aria-label="Fewer slots">−</button>
          <input name="slots" type="number" min="${Math.max(1, booked)}" max="${MAX_SLOTS}" value="${slots}" inputmode="numeric" aria-label="Client slots">
          <button type="button" data-pc-step="1" aria-label="More slots">+</button>
          <span>/ ${MAX_SLOTS} slots max</span>
        </div>
        <fieldset class="pc-scope"><legend>Apply to:</legend>
          <label><input type="radio" name="scope" value="day" checked> This Date Only</label>
          <label><input type="radio" name="scope" value="all"> All Dates</label>
        </fieldset>
        <button class="button primary" type="submit" data-pc-slots-save disabled>Save slots</button>
      </form>
      <div class="pc-tiles">
        <div><b>${booked}</b><span>Used Slots</span></div>
        <div class="is-free"><b>${free}</b><span>Available Slots</span></div>
      </div>
    </section>

    <section class="pc-card pc-overview" aria-labelledby="pc-over-title">
      <h3 id="pc-over-title">${svg(ICON.pie, 'pc-ico pc-ico--tile')} Workload Overview</h3>
      <p class="pc-sub">Your current production workload.</p>
      <div class="pc-over">
        <div class="pc-ring is-${level}" style="--p:${Math.min(100, usedPct === Infinity ? 100 : usedPct)}" role="img" aria-label="${pctText(usedPct)} of today's capacity used">
          <div><strong>${usedPct === Infinity ? 'Over' : pctText(usedPct)}</strong><span>Used</span></div>
        </div>
        <dl>
          <div><dt><i class="is-used"></i>Used Workload</dt><dd>${used} min</dd></div>
          <div><dt><i class="is-free"></i>Remaining</dt><dd>${Math.max(0, cap - used)} min</dd></div>
          ${used > cap ? `<div class="is-heavy"><dt><i class="is-heavy"></i>Over capacity</dt><dd>${used - cap} min</dd></div>` : ''}
        </dl>
      </div>
      <p class="pc-msg is-${level}">${svg(level === 'heavy' ? ICON.alert : ICON.info)}${level === 'heavy' ? `Heavy production workload — ${used - cap} min over your capacity.` : level === 'near' ? 'Close to your limit for this date.' : 'Your workload is within the safe limit.'}</p>
    </section>
  </div>

  <section class="pc-card pc-preview ${pendingOrders.some((o) => o.heavy) || projected > cap ? 'is-heavy' : ''}" aria-labelledby="pc-prev-title">
    <div class="pc-preview__main">
      <h3 id="pc-prev-title">${svg(ICON.alert, 'pc-ico pc-ico--warn')} Incoming Reservation Preview</h3>
      ${pendingOrders.length ? `<ul class="pc-pending">${pendingOrders.map((o) => `
        <li class="${o.heavy ? 'is-heavy' : ''}">
          <span><b>#${e(o.order_number)}</b> ${e(o.customer_name || 'Customer')}</span>
          <span>+${Number(o.minutes)} min → <b>${Number(o.projected_minutes)} min</b> (${pctText(pct(o.projected_minutes, cap))})</span>
          <em>${o.heavy ? 'Heavy production workload' : 'Within capacity'}</em>
        </li>`).join('')}</ul>
        <p class="pc-sub">Each line: the workload if you accept only that order.</p>`
      : '<p class="pc-sub">No pending orders for this date.</p>'}
      ${zeroMinute ? '<p class="pc-hint">Some orders count 0 min — add prep times in Products → edit a product → Sizes &amp; prices.</p>' : ''}
    </div>
    <div class="pc-preview__total"><span>Projected Total</span><strong>${projected} min</strong><small>if you accept all pending</small></div>
    <div class="pc-verdict is-${projected > cap ? 'heavy' : 'ok'}">
      ${svg(projected > cap ? ICON.alert : ICON.check)}
      <div><strong>${projected > cap ? 'Heavy Production Workload' : 'Within Capacity'}</strong>
      <span>${projected > cap ? `${projected - cap} min over your capacity.` : `${cap - projected} min will remain after ${pendingOrders.length ? 'these orders' : 'today’s accepted orders'}.`}</span></div>
    </div>
  </section>
  <p class="pc-status" role="status" data-pc-status></p>`;

  bind(host, d, ctx);
}

function bind(host, d, { date, onDate, onSaved }) {
  const status = host.querySelector('[data-pc-status]');
  const say = (text, tone = '') => { status.textContent = text; status.className = 'pc-status' + (tone ? ' is-' + tone : ''); flash = tone === 'ok' ? { text, tone } : null; };
  if (flash) { const f = flash; say(f.text, f.tone); flash = null; }
  const range = host.querySelector('[data-pc-range]'), bubble = host.querySelector('[data-pc-bubble]');
  const used = Number(d.accepted_minutes), pending = Number(d.pending_minutes), saved = Number(d.workload_minutes);
  // track, left to right: accepted (dark) · over capacity (red) · pending (striped) · rest of capacity (light) · beyond (grey)
  const paint = () => {
    const cap = Number(range.value), p = (n) => `${Math.min(100, Math.max(0, (n / MAX) * 100))}%`;
    const a = Math.min(used, cap), over = Math.max(used, cap), pend = Math.min(MAX, Math.max(used, 0) + pending);
    const stops = [`var(--pc-used) 0 ${p(a)}`];
    if (used > cap) stops.push(`var(--pc-heavy) ${p(cap)} ${p(used)}`);
    if (pending > 0) stops.push(`var(--pc-pending) ${p(used)} ${p(pend)}`);
    if (Math.max(pend, used) < cap) stops.push(`var(--pc-free) ${p(Math.max(pend, used))} ${p(cap)}`);
    stops.push(`var(--pc-track) ${p(Math.max(over, pend))} 100%`);
    range.style.background = `linear-gradient(to right, ${stops.join(', ')})`;
    range.classList.toggle('is-over', used > cap);
    bubble.textContent = `${cap} min`;
    bubble.style.left = `calc(${(cap / MAX) * 100}% + ${(0.5 - cap / MAX) * 26}px)`;
    host.querySelector('[data-pc-cap-big]').textContent = `${cap} min`;
    host.querySelector('[data-pc-cap-hrs]').textContent = `≈ ${hrs(cap)}`;
    host.querySelector('[data-pc-cap-legend]').textContent = `${cap} min`;
    range.setAttribute('aria-valuetext', `${cap} minutes, ${hrs(cap)}`);
    host.querySelector('[data-pc-cap-save]').disabled = cap === saved && host.querySelector('[data-pc-cap-form]').elements.scope.value === 'day';
  };
  range.addEventListener('input', paint);
  host.querySelector('[data-pc-cap-form]').elements.scope.addEventListener('change', paint);
  paint();

  host.querySelector('[data-pc-date]').addEventListener('change', (ev) => { if (ev.target.value) onDate(ev.target.value); });

  host.querySelector('[data-pc-cap-form]').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const scope = ev.currentTarget.elements.scope.value, minutes = Number(range.value), button = host.querySelector('[data-pc-cap-save]');
    if (scope === 'all' && !(await ask(`Every date from today will use ${minutes} min (${hrs(minutes)}). Dates you set one by one are reset to this.`, { title: 'Use this capacity for all dates?', confirm: 'Apply to all dates' }))) return;
    button.disabled = true; say('Saving…');
    try {
      await db.rpc('save_production_capacity', { payload: { booking_date: date, scope, workload_minutes: minutes } });
      clearProductionCache(); say(scope === 'all' ? `Saved: ${minutes} min for all dates.` : `Saved: ${minutes} min for ${longDate(date)}.`, 'ok'); onSaved();
    } catch (error) { say(error.message || 'Could not save.', 'bad'); button.disabled = false; }
  });

  host.querySelector('[data-pc-clean-form]').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const n = Number(ev.currentTarget.elements.clean.value);
    if (!Number.isInteger(n) || n < 0 || n > 120) { say('Cleaning time must be a whole number from 0 to 120 minutes.', 'bad'); return; }
    say('Saving…');
    try { await db.rpc('save_production_capacity', { payload: { scope: 'all', cleaning_minutes: n } }); clearProductionCache(); say(`Saved: ${n} min cleaning/setup for each new order.`, 'ok'); onSaved(); }
    catch (error) { say(error.message || 'Could not save.', 'bad'); }
  });

  const slotsForm = host.querySelector('[data-pc-slots-form]'), n = slotsForm.elements.slots, slotsSave = host.querySelector('[data-pc-slots-save]');
  const slotsChanged = () => { slotsSave.disabled = Number(n.value) === Number(d.slots) && slotsForm.elements.scope.value === 'day'; };
  slotsForm.querySelectorAll('[data-pc-step]').forEach((b) => b.addEventListener('click', () => {
    n.value = Math.min(MAX_SLOTS, Math.max(Number(n.min) || 1, (Number(n.value) || 0) + Number(b.dataset.pcStep))); slotsChanged();
  }));
  slotsForm.addEventListener('input', slotsChanged); slotsForm.addEventListener('change', slotsChanged);
  slotsForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const value = Number(n.value), scope = slotsForm.elements.scope.value;
    if (!Number.isInteger(value) || value < 1 || value > MAX_SLOTS) { say(`Enter a whole number from 1 to ${MAX_SLOTS}.`, 'bad'); return; }
    if (scope === 'day' && value < Number(d.active_bookings)) { say(`This date already has ${d.active_bookings} reservations.`, 'bad'); return; }
    if (scope === 'all' && !(await ask(`Every date from today will allow ${value} client slot${value === 1 ? '' : 's'}. A date that already has more reservations keeps its limit.`, { title: 'Use this for all dates?', confirm: 'Apply to all dates' }))) return;
    slotsSave.disabled = true; say('Saving…');
    try {
      const result = await db.rpc('save_production_capacity', { payload: { booking_date: date, scope, slots: value } });
      const skipped = result?.skipped || [];
      clearProductionCache();
      say(skipped.length ? `Saved ${value} slots. Kept ${skipped.map(longDate).join(', ')} as is — already more reservations than that.` : `Saved: ${value} client slots${scope === 'all' ? ' for all dates' : ''}.`, 'ok');
      onSaved();
    } catch (error) { say(error.message || 'Could not save.', 'bad'); slotsSave.disabled = false; }
  });
}
