// Admin → Staff (owner only): the cashier accounts. Add one by the email of an account that already signed up on
// the shop, switch a cashier off (they lose access at once, the account stays) or remove them (back to a normal
// customer account). The database does the checks (phase 112: add_staff, set_staff_active, remove_staff).
import { escapeHtml as e, icon } from '../components.js?v=5';
import { db } from '../backend-ui.js?v=3';
import { ask } from '../../shared/ask.js?v=1';

// phase 116: what each cashier may do (database-enforced); cancel_orders is off unless turned on
const PERMS = [['confirm_orders', 'Confirm orders', 'Accept new orders', true], ['move_orders', 'Move orders along', 'Start making → Ready → Complete', true],
  ['check_payments', 'Check payments', 'Open receipts, mark received or reject', true], ['record_stock', 'Record stock', 'Add stock and batches in Inventory', true],
  ['see_reservations', 'See reservations', 'Open the Reservations page', true], ['cancel_orders', 'Cancel orders', 'Cancel an order with a reason', false]];
const when = (v) => new Date(v).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' });

export async function renderStaff(content) {
  content.innerHTML = `<header class="vx-hero st-hero"><div class="vx-hero-text"><span class="vx-eyebrow">${icon('profile')} Team</span><h1>Staff</h1><p>Choose what each cashier can do. Only you can change prices, products, settings and staff, or see sales and the Activity log.</p></div></header>
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
    let perms = new Map(), permsReady = true;
    try { rows = await db.rpc('list_staff', {}); }
    catch (err) { list.innerHTML = `<p class="staff-empty" role="alert">Staff could not load. ${e(err.message || '')}</p>`; return; }
    try { (await db.rpc('list_staff_permissions', {}) || []).forEach((p) => perms.set(p.user_id, p.permissions || {})); } catch { permsReady = false; }
    const sw = (s) => { const p = perms.get(s.user_id) || {}; return `<details class="staff-perms" id="perms-${e(s.user_id)}"><summary hidden>What they can do</summary>${permsReady
      ? `<div class="staff-perm-grid">${PERMS.map(([k, label, note, def]) => { const on = p[k] ?? def; return `<label class="staff-perm"><input type="checkbox" role="switch" data-perm="${k}" data-user="${e(s.user_id)}" ${on ? 'checked' : ''}><span><b>${label}</b><small>${note}</small></span></label>`; }).join('')}</div><div class="staff-perm-foot"><span class="staff-perm-note" data-note="${e(s.user_id)}"></span><button type="button" class="button" data-perm-undo="${e(s.user_id)}" disabled>Undo</button><button type="button" class="button primary" data-perm-save="${e(s.user_id)}" disabled>Save changes</button></div>`
      : '<p class="staff-hint">Permission switches need database/phase116-staff-permissions.sql.</p>'}</details>`; };
    list.innerHTML = rows.length ? rows.map((s) => `<article class="staff-row${s.active ? '' : ' is-off'}">
        <span class="staff-avatar" aria-hidden="true">${e((s.full_name || s.email || '?').slice(0, 2).toUpperCase())}</span>
        <div class="staff-who"><b>${e(s.full_name || 'Cashier')}</b><small>${e(s.email)} · added ${e(when(s.added_at))}</small></div>
        <button type="button" class="staff-perm-btn" data-perms-for="${e(s.user_id)}" aria-expanded="false" aria-controls="perms-${e(s.user_id)}" aria-label="What ${e(s.full_name || 'this cashier')} can do" title="What they can do"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg></button><span class="staff-state">${s.active ? 'Active' : 'Switched off'}</span>
        <div class="staff-acts"><button class="button" type="button" data-toggle="${e(s.user_id)}" data-on="${s.active ? '0' : '1'}">${s.active ? 'Switch off' : 'Switch on'}</button>
          <button class="button staff-remove" type="button" data-remove="${e(s.user_id)}" data-name="${e(s.full_name || s.email)}">Remove</button></div>
        ${sw(s)}</article>`).join('') : '<p class="staff-empty">No cashiers yet. Add one above.</p>';
  };
  content.querySelector('[data-add]').onsubmit = async (ev) => {
    ev.preventDefault();
    const form = ev.currentTarget, btn = form.querySelector('button');
    btn.disabled = true; say('Adding…');
    try { await db.rpc('add_staff', { staff_email: form.email.value.trim() }); form.reset(); say('Cashier added. They see the cashier dashboard the next time they open Admin.'); await load(); }
    catch (err) { say(err.message || 'That cashier could not be added.', true); }
    finally { btn.disabled = false; }
  };
  // switches change nothing until Save; Undo puts them back
  const boxes = (id) => [...list.querySelectorAll(`[data-perm][data-user="${id}"]`)];
  const dirty = (id) => boxes(id).filter((b) => b.checked !== b.defaultChecked);
  const mark = (id) => { const n = dirty(id).length, note = list.querySelector(`[data-note="${id}"]`);
    list.querySelector(`[data-perm-save="${id}"]`).disabled = !n; list.querySelector(`[data-perm-undo="${id}"]`).disabled = !n;
    if (note) note.textContent = n ? `${n} unsaved change${n === 1 ? '' : 's'}` : ''; };
  list.onchange = (ev) => { const box = ev.target.closest('[data-perm]'); if (box) mark(box.dataset.user); };
  list.onclick = async (ev) => {
    const sv = ev.target.closest('[data-perm-save]'), un = ev.target.closest('[data-perm-undo]');
    if (un) { boxes(un.dataset.permUndo).forEach((b) => { b.checked = b.defaultChecked; }); mark(un.dataset.permUndo); return; }
    if (sv) {
      const id = sv.dataset.permSave, changes = Object.fromEntries(dirty(id).map((b) => [b.dataset.perm, b.checked]));
      sv.disabled = true; sv.textContent = 'Saving…';
      try { await db.rpc('set_staff_permissions', { staff_user: id, perms: changes }); boxes(id).forEach((b) => { b.defaultChecked = b.checked; }); say('Saved. The cashier sees the change the next time they open Admin.'); }
      catch (err) { say(err.message || 'Those changes could not be saved.', true); }
      finally { sv.textContent = 'Save changes'; mark(id); }
      return;
    }
    const pb = ev.target.closest('[data-perms-for]');
    if (pb) { const d = document.getElementById('perms-' + pb.dataset.permsFor); if (d) { d.open = !d.open; pb.setAttribute('aria-expanded', String(d.open)); pb.classList.toggle('is-on', d.open); } return; }
    const t = ev.target.closest('[data-toggle]'), rm = ev.target.closest('[data-remove]');
    if (t) {
      t.disabled = true;
      try { await db.rpc('set_staff_active', { staff_user: t.dataset.toggle, turn_on: t.dataset.on === '1' }); say(t.dataset.on === '1' ? 'Cashier switched on.' : 'Cashier switched off. They can no longer open the cashier dashboard.'); await load(); }
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
