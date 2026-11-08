// Admin → Settings: the customer Settings choices that make sense for the owner (text size, motion), plus the
// website tools (Edit website opens the real site with in-place editing; FAQs). Saved on this device.
import { escapeHtml as e, icon } from '../components.js?v=3';
import { db } from '../backend-ui.js?v=3';

// Payment methods customers can choose (phase 110: public.set_payment_method_active, admin only).
const PAY_NAMES = { gcash: ['GCash', 'Scan-to-pay QR, receipt upload'], maribank: ['MariBank', 'InstaPay QR, receipt upload'], paymongo: ['QRPh', 'Pay online, confirmed automatically'] };
let payMethods = null, payBusy = '', payMsg = '';

const SIZES = [['sm', 'Small', 0.92], ['md', 'Default', 1], ['lg', 'Large', 1.1], ['xl', 'Extra large', 1.2]];
const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const save = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private window: this visit only */ } };

// applied on every Admin page load (app.js calls this first)
const phoneDark = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
phoneDark?.addEventListener?.('change', () => applyAdminSettings());
export function applyAdminSettings() {
  const theme = read('lexc_admin_theme') || 'light', dark = theme === 'dark' || (theme === 'auto' && !!phoneDark?.matches);
  document.documentElement.dataset.adminTheme = dark ? 'dark' : 'light';
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  const size = SIZES.find(([k]) => k === read('lexc_admin_text')) || SIZES[1];
  document.documentElement.style.zoom = size[2] === 1 ? '' : String(size[2]);
  document.documentElement.dataset.motion = read('lexc_admin_motion') === 'reduce' ? 'reduce' : 'full';
}

export function renderSettings(content) {
  const draw = () => {
    const size = read('lexc_admin_text') || 'md', reduce = read('lexc_admin_motion') === 'reduce';
    content.innerHTML = `<header class="vx-hero st-hero"><div class="vx-hero-text"><span class="vx-eyebrow">${icon('profile')} Your admin</span><h1>Settings</h1><p>Your website tools and how Admin looks on this device.</p></div></header>
      <div class="st-grid">
        <section class="st-card st-card--site"><h2>${icon('edit')} Website</h2>
          <p>Open your shop with editing on: click any text or photo to change it, then Save draft or Publish.</p>
          <div class="st-actions"><a class="button primary" href="../?cms=live">${icon('edit')} Edit website</a><a class="button" href="#website/faqs">${icon('info')} FAQs</a></div>
          <small>FAQs also open from the editing bar on the site.</small></section>
        <section class="st-card"><h2>${icon('eye')} Day or night</h2>
          <div class="st-sizes st-themes" role="radiogroup" aria-label="Day or night">${[['light', 'Day', '☀'], ['dark', 'Night', '☾'], ['auto', 'Auto', '◐']].map(([k, l, g]) => `<button type="button" role="radio" aria-checked="${(read('lexc_admin_theme') || 'light') === k}" data-theme="${k}"><span aria-hidden="true">${g}</span><small>${l}</small></button>`).join('')}</div>
          <p class="st-preview">Auto follows your phone or computer’s light or dark mode.</p></section>
        <section class="st-card"><h2>${icon('eye')} Text size</h2>
          <div class="st-sizes" role="radiogroup" aria-label="Text size">${SIZES.map(([k, l], n) => `<button type="button" role="radio" aria-checked="${k === size}" data-size="${k}"><span style="font-size:${13 + n * 3}px" aria-hidden="true">A</span><small>${e(l)}</small></button>`).join('')}</div>
          <p class="st-preview">Order #1042 · Bento Cake – Chocolate Moist · ₱426.00</p></section>
        <section class="st-card"><h2>${icon('refresh')} Motion</h2>
          <button type="button" class="st-switch" role="switch" aria-checked="${reduce}" data-motion><span><b>Reduce motion</b><small>Turns off animations and sliding effects.</small></span><i aria-hidden="true"></i></button></section>
        <section class="st-card st-card--pay"><h2>${icon('revenue')} Payment methods</h2>
          ${payMethods === null ? '<p class="st-preview">Loading…</p>' : payMethods.length ? payMethods.map((m) => { const [n, note] = PAY_NAMES[m.code] || [m.display_name, '']; return `<button type="button" class="st-switch" role="switch" aria-checked="${m.active}" data-pay-code="${e(m.code)}" ${payBusy ? 'disabled' : ''}><span><b>${e(n)}</b><small>${m.active ? 'Shown to customers' : 'Hidden from customers'}${note ? ' · ' + e(note) : ''}</small></span><i aria-hidden="true"></i></button>`; }).join('') : '<p class="st-preview">Payment methods could not be loaded.</p>'}
          <p class="st-preview" role="status">${e(payMsg || 'Hidden methods disappear from checkout and the payment page. At least one stays on.')}</p></section>
        <section class="st-card"><h2>${icon('alert')} Notifications</h2>
          <p>New orders, payment proofs, reviews and voucher uses are emailed to your Gmail. The sidebar shows a count on each module with something new.</p></section>
      </div><p class="st-note">Day or night, text size and motion are saved on this device.</p>`;
    content.querySelectorAll('[data-theme]').forEach((b) => (b.onclick = () => { save('lexc_admin_theme', b.dataset.theme); applyAdminSettings(); draw(); }));
    content.querySelectorAll('[data-size]').forEach((b) => (b.onclick = () => { save('lexc_admin_text', b.dataset.size); applyAdminSettings(); draw(); }));
    content.querySelectorAll('[data-pay-code]').forEach((b) => (b.onclick = async () => {
      const m = payMethods.find((x) => x.code === b.dataset.payCode); if (!m || payBusy) return;
      payBusy = m.code; payMsg = ''; draw();
      try { await db.rpc('set_payment_method_active', { method_code: m.code, turn_on: !m.active }); m.active = !m.active; payMsg = `${(PAY_NAMES[m.code] || [m.display_name])[0]} is now ${m.active ? 'shown' : 'hidden'}.`; }
      catch (error) { payMsg = /set_payment_method_active/.test(error?.message || '') ? 'This switch needs database phase 110 first.' : (error?.message || 'Could not change it. Try again.'); }
      payBusy = ''; draw();
    }));
    content.querySelector('[data-motion]').onclick = () => { save('lexc_admin_motion', read('lexc_admin_motion') === 'reduce' ? 'full' : 'reduce'); applyAdminSettings(); draw(); };
  };
  draw();
  db.client.from('payment_methods').select('code,display_name,active').order('created_at').then(db.unwrap)
    .then((rows) => { payMethods = (rows || []).filter((m) => PAY_NAMES[m.code]); })   // only the methods in use (not the old Maya one).catch(() => { payMethods = []; }).finally(() => { if (content.isConnected) draw(); });
}
