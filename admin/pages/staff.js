// Admin → Staff (owner only): the cashier accounts. Add one by the email of an account that already signed up on
// the shop, switch a cashier off (they lose access at once, the account stays) or remove them (back to a normal
// customer account). The database does the checks (phase 112: add_staff, set_staff_active, remove_staff).
import { escapeHtml as e, icon } from '../components.js?v=5';
import { db } from '../backend-ui.js?v=3';
import { ask } from '../../shared/ask.js?v=1';

const when = (v) => new Date(v).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' });

export async function renderStaff(content) {
  content.innerHTML = `<header class="vx-hero st-hero"><div class="vx-hero-text"><span class="vx-eyebrow">${icon('profile')} Team</span><h1>Staff</h1><p>Cashiers can handle orders, payments, reservations and stock. Only you can confirm or cancel orders, change prices and settings, or see sales.</p></div></header>
    <section class="panel staff-panel">
      <form class="staff-add" data-add>
        <label><span>Add a cashier by email</span><input type="email" name="email" required placeholder="cashier@example.com" autocomplete="off"></label>
        <button class="button primary" type="submit">${icon('plus')} Add cashier</button>
      </form>
      <p class="staff-hint">The cashier signs up on the shop first, with their own password. Then add their email here.</p>
      <p class="staff-msg" role="status"></p>
      <div class="staff-list" data-list><span class="skel skel-line"></span><span class="skel skel-line"></span></div>
    </section>`;
  const list = content.querySelector('[data-list]'), msg = content.querySelector('.staff-msg');
  const say = (t, bad) => { msg.textContent = t; msg.classList.toggle('is-bad', !!bad); };
  const load = async () => {
    let rows;
    try { rows = await db.rpc('list_staff', {}); }
    catch (err) { list.innerHTML = `<p class="staff-empty" role="alert">Staff could not load. ${e(err.message || '')}</p>`; return; }
    list.innerHTML = rows.length ? rows.map((s) => `<article class="staff-row${s.active ? '' : ' is-off'}">
        <span class="staff-avatar" aria-hidden="true">${e((s.full_name || s.email || '?').slice(0, 2).toUpperCase())}</span>
        <div class="staff-who"><b>${e(s.full_name || 'Cashier')}</b><small>${e(s.email)} · added ${e(when(s.added_at))}</small></div>
        <span class="staff-state">${s.active ? 'Active' : 'Switched off'}</span>
        <div class="staff-acts"><button class="button" type="button" data-toggle="${e(s.user_id)}" data-on="${s.active ? '0' : '1'}">${s.active ? 'Switch off' : 'Switch on'}</button>
          <button class="button staff-remove" type="button" data-remove="${e(s.user_id)}" data-name="${e(s.full_name || s.email)}">Remove</button></div>
      </article>`).join('') : '<p class="staff-empty">No cashiers yet. Add one above.</p>';
  };
  content.querySelector('[data-add]').onsubmit = async (ev) => {
    ev.preventDefault();
    const form = ev.currentTarget, btn = form.querySelector('button');
    btn.disabled = true; say('Adding…');
    try { await db.rpc('add_staff', { staff_email: form.email.value.trim() }); form.reset(); say('Cashier added. They see the cashier dashboard the next time they open Admin.'); await load(); }
    catch (err) { say(err.message || 'That cashier could not be added.', true); }
    finally { btn.disabled = false; }
  };
  list.onclick = async (ev) => {
    const t = ev.target.closest('[data-toggle]'), rm = ev.target.closest('[data-remove]');
    if (t) {
      t.disabled = true;
      try { await db.rpc('set_staff_active', { staff_user: t.dataset.toggle, turn_on: t.dataset.on === '1' }); say(t.dataset.on === '1' ? 'Cashier switched on.' : 'Cashier switched off. They can no longer open Admin.'); await load(); }
      catch (err) { say(err.message, true); t.disabled = false; }
    }
    if (rm) {
      if (!(await ask(`${rm.dataset.name} goes back to a normal customer account. Their past actions stay in the records.`, { title: 'Remove this cashier?', confirm: 'Remove', tone: 'danger' }))) return;
      rm.disabled = true;
      try { await db.rpc('remove_staff', { staff_user: rm.dataset.remove }); say('Cashier removed.'); await load(); }
      catch (err) { say(err.message, true); rm.disabled = false; }
    }
  };
  await load();
}
