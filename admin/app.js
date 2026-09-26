import { renderDashboard } from './pages/dashboard.js?v=7';
import { renderProducts } from './pages/products.js?v=3';
import { openInventoryNotifications, refreshInventoryNotificationBadge, renderInventory } from './pages/inventory.js?v=14';
import { renderReports } from './pages/reports.js?v=4';
import { renderOrders } from './pages/orders.js?v=7';
import { renderBookings } from './pages/bookings.js?v=9';
import { renderGallery } from './pages/gallery.js?v=2';
import { renderProfile } from './pages/profile.js?v=2';
import { mountChat } from '../shared/chat.js?v=5';
import { icon } from './components.js?v=3';

const groups = [
  ['', [['dashboard', 'Dashboard']]],
  ['Management', [['chat', 'Chat & Orders'], ['inventory', 'Inventory'], ['products', 'Products'], ['orders', 'Orders'], ['bookings', 'Bookings']]],
  ['Analytics', [['reports', 'Reports'], ['gallery', 'Gallery']]],
  ['Account', [['profile', 'Profile']]],
];
const titles = { dashboard: 'Dashboard', chat: 'Chat & Orders', inventory: 'Inventory', products: 'Products', orders: 'Orders', bookings: 'Booking Schedule', reports: 'Reports', gallery: 'Gallery', profile: 'Profile' };
const navigation = document.querySelector('#navigation');
navigation.innerHTML = groups.map(([heading, items]) => `${heading ? `<div class="nav-heading">${heading}</div>` : ''}${items.map(([key, label]) => `<a class="nav-item" href="#${key}" data-page="${key}">${icon(key, 'nav-icon')}<span>${label}</span></a>`).join('')}`).join('');

let toastTimer;
document.querySelector('.logout').addEventListener('click', () => window.LexcAdminAuth.logout());
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
  document.querySelector('#admin-dialog')?.close();
  const route = location.hash.slice(1) || 'dashboard';
  const page = route.split('/')[0];
  const current = Object.hasOwn(titles, page) ? page : 'dashboard';
  document.body.classList.toggle('inventory-view', current === 'inventory');
  document.querySelector('#page-title').textContent = "LexC's Snacktime";
  document.title = `${titles[current]} — LexC's Snacktime`;
  navigation.querySelectorAll('a').forEach(link => {
    const active = link.dataset.page === current;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
  closeNavigation();
  const main = document.querySelector('#content');
  const content = document.createElement('div');
  content.dataset.adminPage = current;
  main.replaceChildren(content);
  const subpage = route.split('/')[1];
  if (current === 'dashboard') await renderDashboard(content);
  else if (current === 'chat') { content.classList.add('chat-page'); await mountChat(content,{admin:true}); }
  else if (current === 'products') await renderProducts(content, subpage);
  else if (current === 'inventory') await renderInventory(content, subpage);
  else if (current === 'reports') await renderReports(content, subpage);
  else if (current === 'orders') await renderOrders(content);
  else if (current === 'bookings') await renderBookings(content);
  else if (current === 'gallery') await renderGallery(content);
  else if (current === 'profile') await renderProfile(content, subpage);
  await refreshInventoryNotificationBadge();
}
window.addEventListener('hashchange', renderRoute);
renderRoute();
