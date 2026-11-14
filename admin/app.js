import { renderSettings, applyAdminSettings } from './pages/settings.js?v=5';
applyAdminSettings();
import { refreshNavBadges, startNavBadges } from './nav-badges.js?v=1';
import { renderProduction } from './pages/production.js?v=13';
import { renderDashboard } from './pages/dashboard.js?v=21';
import { renderProducts } from './pages/products.js?v=16';
import { openInventoryNotifications, refreshInventoryNotificationBadge, renderInventory } from './pages/inventory.js?v=39';
import { renderReports } from './pages/reports.js?v=23';
import { renderOrders } from './pages/orders.js?v=58';
import { renderBookings } from './pages/bookings.js?v=22';
import { renderDesignOptions } from './pages/design-options.js?v=16';
import { renderProfile } from './pages/profile.js?v=16';
import { renderWebsite } from './pages/website.js?v=3';
import { renderContent } from './pages/content.js?v=1';
import { renderStaff } from './pages/staff.js?v=1';
import { renderStaffOrders } from './pages/staff-orders.js?v=2';
import { renderVouchers } from './pages/vouchers.js?v=3';
import { mountChat } from '../shared/chat.js?v=42';
import { mountChatWidget } from '../shared/chat-widget.js?v=44';
import { renderUpdates } from './pages/updates.js?v=2';
import { icon } from './components.js?v=5';
import { ask } from '../shared/ask.js?v=1';

const groups = [
  ['', [['dashboard', 'Dashboard']]],
  ['Management', [['chat', 'Chat & Orders'], ['inventory', 'Inventory'], ['products', 'Products'], ['designs', 'Designer options', null, 'products'], ['orders', 'Orders'], ['vouchers', 'Vouchers'], ['bookings', 'Reservations']]],
  // Content (CMS): homepage, FAQs, banners, posts & reviews in one menu (pages/content.js)
  ['Website', [['content', 'Content (CMS)', null, 'edit']]],
  ['Analytics', [['reports', 'Reports']]],
  // Edit website and FAQs live in Settings (and on the Profile card)
  ['Account', [['staff', 'Staff', null, 'profile'], ['profile', 'Profile']]],   // Settings opens from the Profile card
];
const titles = { settings: 'Settings', production: 'Production', dashboard: 'Dashboard', chat: 'Chat & Orders', inventory: 'Inventory', products: 'Products', designs: 'Designer options', orders: 'Orders', bookings: 'Reservation Schedule', vouchers: 'Vouchers', website: 'Content (CMS)', content: 'Content (CMS)', staff: 'Staff', reports: 'Reports', updates: 'Updates & reviews', profile: 'Profile' };
const navigation = document.querySelector('#navigation');
const STAFF_PAGES = ['dashboard', 'orders', 'bookings', 'production', 'inventory', 'profile'];   // 'staff' (Staff page) is owner-only
// owner-only controls a cashier never sees (the database also refuses them)
const OWNER_ONLY = ['[data-status="confirmed"]', '[data-status="cancelled"]', '[data-waive]', '#delivery-quote', '[data-extra-form]', '[data-propose-extra]',
  '[data-act="settings"]', '[data-action="archive-item"]', '[data-edit-batch]', 'a[href="#inventory/conversions"]', '[data-correct-batch]',
  '[data-close]', '[data-limit]', '[data-reserve]', '[data-capacity]', 'a[href="#settings"]', 'a[href^="../?cms"]', 'a[href="#profile/transfer"]', 'a[href^="#website"]', 'a[href="#content"]'].join(',');
function trimForStaff(root) {
  if (!root) return;
  root.querySelectorAll(OWNER_ONLY).forEach((el) => el.remove());
  // money on the dashboard: today's received amount and remaining balances
  root.querySelectorAll('.dash-stat').forEach((el) => { if (/Received today/i.test(el.querySelector('span')?.textContent || '')) el.remove(); });
  root.querySelectorAll('section, .panel').forEach((el) => { const h = el.querySelector(':scope > header h2, :scope > h2'); if (h && /Remaining balances|Money received|Sales/i.test(h.textContent)) el.remove(); });
}
navigation.innerHTML = groups.map(([heading, items]) => `${heading ? `<div class="nav-heading">${heading}</div>` : ''}${items.map(([key, label, href, iconKey]) => `<a class="nav-item" href="${href || `#${key}`}" data-page="${key}">${icon(iconKey || key, 'nav-icon')}<span>${label}</span></a>`).join('')}`).join('');

let toastTimer;
document.querySelector('button.logout').addEventListener('click', async () => { if (await ask('You will need to log in again to manage orders and the shop.', { title: 'Log out?', confirm: 'Log out', cancel: 'Stay logged in' })) window.LexcAdminAuth.logout(); });
export function notify(message) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 5000);
}
function closeNavigation() {
  const sidebar = document.querySelector('.sidebar');
  const mobile = matchMedia('(max-width: 800px)').matches;
  if (mobile && sidebar.contains(document.activeElement)) document.querySelector('.mobile-menu').focus();
  sidebar.inert = mobile;
  document.body.classList.remove('nav-open');
  document.querySelector('.scrim').hidden = true;
  document.querySelector('.mobile-menu').setAttribute('aria-expanded', 'false');
}
document.querySelector('.mobile-menu').addEventListener('click', () => {
  document.querySelector('.sidebar').inert = false;
  document.body.classList.add('nav-open');
  document.querySelector('.scrim').hidden = false;
  document.querySelector('.mobile-menu').setAttribute('aria-expanded', 'true');
  navigation.querySelector('a').focus();
});
document.querySelector('.scrim').addEventListener('click', closeNavigation);
document.querySelector('.menu-toggle').addEventListener('click', event => {
  const collapsed = document.body.classList.toggle('collapsed');
  event.currentTarget.setAttribute('aria-expanded', String(!collapsed));
  event.currentTarget.setAttribute('aria-label', collapsed ? 'Expand navigation' : 'Collapse navigation');
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeNavigation(); });
document.addEventListener('keydown', event => {
  if (event.key !== 'Tab' || !document.body.classList.contains('nav-open')) return;
  const items = [...document.querySelectorAll('.sidebar a, .sidebar button')].filter(el => el.getClientRects().length);
  const first = items[0], last = items.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});
// Drop-down menus built on <details> (row actions, sort, date filter): one open at a time, close on an outside
// click or Escape, and a row menu opens upward when the table has no room for it below.
const POPOVERS = '.inventory-action-menu, .inventory-sort-menu, .stock-date-filter';
document.addEventListener('toggle', event => {
  const menu = event.target;
  if (!(menu instanceof HTMLDetailsElement) || !menu.matches(POPOVERS) || !menu.open) return;
  document.querySelectorAll(POPOVERS).forEach(other => { if (other !== menu && other.open) other.open = false; });
  if (menu.matches('.inventory-action-menu')) {
    menu.classList.remove('is-up');
    const panel = menu.querySelector(':scope > div'), box = menu.closest('.table-wrap') || document.documentElement;
    const room = Math.min(box.getBoundingClientRect().bottom, innerHeight) - menu.getBoundingClientRect().bottom;
    if (panel && room < panel.offsetHeight + 12 && menu.getBoundingClientRect().top - box.getBoundingClientRect().top > panel.offsetHeight + 12) menu.classList.add('is-up');
  }
}, true);
document.addEventListener('click', event => {
  document.querySelectorAll(POPOVERS).forEach(menu => { if (menu.open && !menu.contains(event.target)) menu.open = false; });
  // choosing a row action closes its menu (the action itself has already run by now)
  const action = event.target.closest('.inventory-action-menu > div button');
  if (action) action.closest('details').open = false;
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  const open = [...document.querySelectorAll(POPOVERS)].find(menu => menu.open);
  if (open) { open.open = false; open.querySelector('summary')?.focus(); }
});
navigation.querySelectorAll('a').forEach(link => link.setAttribute('aria-label', link.textContent));
matchMedia('(max-width: 800px)').addEventListener('change', () => { document.body.classList.remove('collapsed'); closeNavigation(); });
const notificationsButton = document.querySelector('#notifications');
const revealNotifications = event => {
  if (!document.querySelector('#inventory-notification-popover')) openInventoryNotifications(event.currentTarget);
};
notificationsButton.addEventListener('mouseenter', revealNotifications);
notificationsButton.addEventListener('focus', revealNotifications);
notificationsButton.addEventListener('click', revealNotifications);

async function renderRoute() {
  if (!await window.LexcAdminAuth.guard()) return;
  // Cashier (staff): a smaller menu and only these pages. The database refuses owner actions anyway; this keeps
  // the screens honest. Owner-only buttons inside these pages are removed by trimForStaff below.
  if (window.LexcAdminAuth.level === 'staff') {
    if (!navigation.dataset.staff) {
      navigation.dataset.staff = '1';
      navigation.querySelectorAll('a.nav-item').forEach((a) => { if (!STAFF_PAGES.includes(a.dataset.page)) a.remove(); });
      navigation.querySelectorAll('.nav-heading').forEach((h) => { const next = h.nextElementSibling; if (!next || next.classList.contains('nav-heading')) h.remove(); });
      document.querySelector('.identity-role')?.replaceChildren('Cashier');
      const who = window.LexcAdminAuth.account?.name; if (who) document.querySelector('.identity-name')?.replaceChildren(who);
      new MutationObserver(() => trimForStaff(document.querySelector('#content'))).observe(document.querySelector('#content'), { childList: true, subtree: true });
    }
    const want = (location.hash.slice(1) || 'dashboard').split('/')[0];
    if (!STAFF_PAGES.includes(want)) { location.hash = '#dashboard'; return; }
  }
  if (window.LexcAdminAuth.level !== 'staff') mountChatWidget({admin:true});   // no chat for cashiers
  document.querySelector('#admin-dialog')?.close();
  const route = location.hash.slice(1) || 'dashboard';
  if (route === 'gallery' || route === 'fresh-posts') { location.hash = '#updates'; return; }   // older links: posts and reviews live in Updates
  const page = route.split('/')[0];
  const current = Object.hasOwn(titles, page) ? page : 'dashboard';
  document.body.classList.toggle('inventory-view', current === 'inventory');
  document.querySelector('#page-title').textContent = "LexC's Snacktime";
  document.title = `${titles[current]} — LexC's Snacktime`;
  navigation.querySelectorAll('a').forEach(link => {
    const active = link.dataset.page === current || (link.dataset.page === 'content' && ['website', 'updates'].includes(current)) || link.dataset.page === route || (current === 'settings' && link.dataset.page === 'profile') || (current === 'production' && link.dataset.page === 'bookings') || (route === 'website' && link.dataset.page === 'website/home');
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
  closeNavigation();
  const main = document.querySelector('#content');
  const content = document.createElement('div');
  content.dataset.adminPage = current;
  main.replaceChildren(content);
  const subpage = route.split('/')[1];
  // Production lives inside Reservations, under the orders calendar; #production/<order> still opens it there
  if (current === 'bookings' || current === 'production') {
    const calendar = document.createElement('div'), kitchen = document.createElement('section');
    kitchen.className = 'booking-production'; kitchen.id = 'production'; kitchen.setAttribute('aria-label', 'Production');
    content.append(calendar, kitchen);
    await Promise.all([renderBookings(calendar), renderProduction(kitchen, current === 'production' ? subpage : undefined)]);
    // the calendar redraws itself; keep Production right under it (inside its layout, beside the side panel)
    const dock = () => { const layout = calendar.querySelector('.booking-reference-layout'); if (layout && kitchen.parentNode !== layout) (layout.querySelector('.booking-calendar') || layout.firstChild).after(kitchen); else if (!layout && kitchen.parentNode !== content) content.append(kitchen); window.LexcPaintChefHero?.(); };
    new MutationObserver(dock).observe(calendar, { childList: true }); dock();
    if (current === 'production') kitchen.scrollIntoView({ block: 'start' });
  }
  else if (current === 'dashboard') await renderDashboard(content);
  else if (current === 'chat') { content.classList.add('chat-page'); await mountChat(content,{admin:true}); }
  else if (current === 'products') await renderProducts(content, subpage);
  else if (current === 'inventory') await renderInventory(content, subpage);
  else if (current === 'reports') await renderReports(content, subpage);
  else if (current === 'orders') await (window.LexcAdminAuth.level === 'staff' ? renderStaffOrders(content) : renderOrders(content));
  else if (current === 'vouchers') await renderVouchers(content);
  else if (current === 'website') await renderWebsite(content, subpage);
  else if (current === 'content') renderContent(content);
  else if (current === 'staff') await renderStaff(content);
  else if (current === 'designs') await renderDesignOptions(content);
  else if (current === 'updates') renderUpdates(content);
  else if (current === 'profile') await renderProfile(content, subpage);
  else if (current === 'settings') renderSettings(content);
  // a tab strip that scrolls sideways on phones shows its current tab (e.g. Inventory → Conversions)
  content.querySelectorAll('.stock-tabs').forEach(nav => { const strip = nav.closest('.stock-tabrow') || nav, on = nav.querySelector('.is-active'); if (on && strip.scrollWidth > strip.clientWidth) strip.scrollLeft = on.getBoundingClientRect().left - strip.getBoundingClientRect().left + strip.scrollLeft - (strip.clientWidth - on.offsetWidth) / 2; });
  refreshNavBadges(current);   // sidebar counts (nav-badges.js); opening a module clears its "new since" count
  await refreshInventoryNotificationBadge();
}
window.addEventListener('hashchange', renderRoute);
renderRoute();
startNavBadges(() => { const page = (location.hash.slice(1) || 'dashboard').split('/')[0]; return page === 'production' ? 'bookings' : page; });
