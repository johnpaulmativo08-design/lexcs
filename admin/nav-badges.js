// Sidebar counts: how many new things wait in each module. A module with nothing new shows no number.
//  · Chat & Orders  – unread customer messages
//  · Orders         – orders to confirm + payment proofs to check (they clear when handled)
//  · Inventory      – unread stock alerts
//  · Reservations   – orders placed since you last opened Reservations
//  · Vouchers       – vouchers used since you last opened Vouchers
//  · Updates & reviews – reviews posted since you last opened it
// "Since you last opened" is remembered on this device. Only counts are read; nothing is changed.
import { db } from './backend-ui.js?v=3';

const SEEN = 'lexc-admin-seen:';
const seenAt = (key) => { try { return localStorage.getItem(SEEN + key) || new Date(Date.now() - 864e5).toISOString(); } catch { return new Date(Date.now() - 864e5).toISOString(); } };
const count = async (query) => { const { count: n, error } = await query; if (error) throw error; return n || 0; };
const safe = (p) => p.catch((error) => { console.warn('Sidebar count:', error?.message || error); return 0; });

const SOURCES = {
  chat: () => count(db.client.from('chat_messages').select('id', { count: 'exact', head: true }).is('read_at', null).eq('sender_type', 'customer')),
  orders: async () => (await count(db.client.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'pending')))
    + (await count(db.client.from('order_payment_attempts').select('id', { count: 'exact', head: true }).eq('status', 'verification_pending'))),
  inventory: async () => ((await db.rpc('inventory_snapshot', {}))?.notifications || []).filter((n) => !n.is_read).length,
  bookings: () => count(db.client.from('orders').select('id', { count: 'exact', head: true }).gt('created_at', seenAt('bookings'))),
  vouchers: () => count(db.client.from('voucher_redemptions').select('id', { count: 'exact', head: true }).gt('created_at', seenAt('vouchers'))),
  updates: () => count(db.client.from('reviews').select('id', { count: 'exact', head: true }).gt('created_at', seenAt('updates'))),
};
const SINCE_SEEN = ['bookings', 'vouchers', 'updates'];

function paint(key, n) {
  const link = document.querySelector(`#sidebar .nav-item[data-page="${key}"], .nav-item[data-page="${key}"]`);
  if (!link) return;
  let badge = link.querySelector('.nav-count');
  if (!n) { badge?.remove(); return; }
  if (!badge) { badge = document.createElement('b'); badge.className = 'nav-count'; link.append(badge); }
  badge.textContent = n > 99 ? '99+' : String(n);
  badge.setAttribute('aria-label', `${n} new`);
}

let busy = false, lastInventory = 0;
export async function refreshNavBadges(current) {
  // opening a "since you last opened" module marks it seen
  if (SINCE_SEEN.includes(current)) { try { localStorage.setItem(SEEN + current, new Date().toISOString()); } catch { /* private window */ } paint(current, 0); }
  if (busy) return; busy = true;
  try {
    const keys = Object.keys(SOURCES).filter((k) => !(SINCE_SEEN.includes(k) && k === current))
      .filter((k) => k !== 'inventory' || Date.now() - lastInventory > 120000);   // the stock snapshot is heavier: every 2 min
    if (keys.includes('inventory')) lastInventory = Date.now();
    const values = await Promise.all(keys.map((k) => safe(SOURCES[k]())));
    keys.forEach((k, i) => paint(k, values[i]));
  } finally { busy = false; }
}
let timer = null;
export function startNavBadges(getCurrent) {
  clearInterval(timer);
  timer = setInterval(() => { if (document.visibilityState === 'visible') refreshNavBadges(getCurrent()); }, 60000);
}
