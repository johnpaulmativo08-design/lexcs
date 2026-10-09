// Shared building blocks for the recipe-driven inventory screens and the order consumption panel.
import { escapeHtml as e } from './components.js?v=3';

export const requestId = () => window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
export const attr = (value) => e(String(value ?? ''));

export function toast(message) {
  const node = document.querySelector('#toast');
  if (!node) return;
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { node.hidden = true; }, 5000);
}

const number = (value, digits = 2) => Number(value || 0).toLocaleString('en-PH', { maximumFractionDigits: digits });

// Stock is stored in each item's own unit; show readable magnitudes (0.13 kg → 130 g, 2500 g → 2.5 kg).
export function qty(value, unit = '', { signed = false } = {}) {
  let amount = Number(value || 0);
  let shown = unit;
  if (unit === 'kg' && Math.abs(amount) < 1 && amount !== 0) { amount *= 1000; shown = 'g'; }
  else if (unit === 'g' && Math.abs(amount) >= 1000) { amount /= 1000; shown = 'kg'; }
  else if ((unit === 'L' || unit === 'l') && Math.abs(amount) < 1 && amount !== 0) { amount *= 1000; shown = 'mL'; }
  else if ((unit === 'mL' || unit === 'ml') && Math.abs(amount) >= 1000) { amount /= 1000; shown = 'L'; }
  const digits = Math.abs(amount) < 10 ? 3 : 2;
  const text = `${number(Math.abs(amount), digits)}${shown ? (shown === 'pcs' ? ' pcs' : ` ${shown}`) : ''}`;
  if (!signed) return (amount < 0 ? '−' : '') + text;
  return (amount > 0 ? '+' : amount < 0 ? '−' : '') + text;
}

export const dateTime = (value) => value
  ? new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' }).format(new Date(value))
  : '—';
export const dateOnly = (value) => value
  ? new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' }).format(new Date(String(value).length === 10 ? `${value}T12:00:00+08:00` : value))
  : '—';

const MOVEMENTS = {
  order_deduction: ['Order deduction', 'order', 'orders'],
  order_extra: ['Order extra', 'order', 'orders'],
  order_reversal: ['Reversal', 'success', 'reversals'],
  restock: ['Restock', 'success', 'restocks'],
  initial_stock: ['Opening stock', 'success', 'restocks'],
  adjustment_positive: ['Adjustment', 'info', 'adjustments'],
  adjustment_negative: ['Adjustment', 'info', 'adjustments'],
  stock_usage: ['Manual usage', 'info', 'adjustments'],
  waste: ['Wastage', 'warning', 'wastage'],
  remake: ['Wastage · remake', 'warning', 'wastage'],
  damaged: ['Wastage · damaged', 'warning', 'wastage'],
  expired: ['Expiry', 'neutral', 'expiry']
};
export const movementLabel = (type) => (MOVEMENTS[type] || [String(type || 'Movement').replaceAll('_', ' ')])[0];
export const movementTone = (type) => (MOVEMENTS[type] || [0, 'neutral'])[1];
export const movementBadge = (type) => `<span class="stock-type stock-type--${movementTone(type)}">${e(movementLabel(type))}</span>`;
export const delta = (value, unit) => `<span class="stock-delta ${Number(value) >= 0 ? 'stock-delta--in' : 'stock-delta--out'}">${qty(value, unit, { signed: true })}</span>`;

const STATUS_TONES = { 'In Stock': 'success', 'Running Low': 'warning', 'Low Stock': 'warning', 'Out of Stock': 'danger', 'Expiring Soon': 'info' };
export function stockStatus(status) {
  const tone = STATUS_TONES[status] || 'neutral';
  const label = status === 'In Stock' ? 'Available' : status;
  return `<span class="status-chip status-chip--${tone}">${icon(tone === 'success' ? 'check' : tone === 'danger' ? 'ban' : tone === 'info' ? 'clock' : 'alert')} ${e(label)}</span>`;
}

export function icon(name) {
  const paths = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/>',
    ban: '<circle cx="12" cy="12" r="9"/><path d="m6 6 12 12"/>',
    alert: '<path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 9v4M12 17h.01"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/>',
    box: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4.5 7.5 7.5 4 7.5-4M12 11.5V21"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    edit: '<path d="m4 16-.8 4 4-.8L18 8l-3-3L4 16Z"/><path d="m13.5 6.5 3 3"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    back: '<path d="M15 6l-6 6 6 6"/>',
    arrow: '<path d="M5 12h14M14 7l5 5-5 5"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
    recipe: '<path d="M6 3h9l3 3v15H6V3Z"/><path d="M9 9h6M9 13h6M9 17h4"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5"/><path d="M5 20h14"/>',
    refresh: '<path d="M20 6v5h-5"/><path d="M4 18v-5h5"/><path d="M6.1 9a7 7 0 0 1 11.7-2.6L20 11M4 13l2.2 4.6A7 7 0 0 0 18 15"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
    eye: '<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/>',
    flag: '<path d="M5 21V4h11l-2 4 2 4H5"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13"/>'
  };
  return `<svg class="stock-icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.box}</svg>`;
}

export function sectionTabs(active) {
  const tabs = [['materials', '#inventory', 'Materials'], ['movements', '#inventory/movements', 'History'], ['recipes', '#inventory/recipes', 'Conversions'], ['batches', '#inventory/batches', 'Batches']];
  return `<nav class="inventory-tabs stock-tabs" aria-label="Inventory sections">${tabs.map(([key, href, label]) => `<a href="${href}" class="${key === active ? 'is-active' : ''}" ${key === active ? 'aria-current="page"' : ''}>${label}</a>`).join('')}</nav>`;
}

export function pageHead(title, subtitle, actions = '') {
  return `<header class="inventory-head stock-head"><div><h1>${e(title)}</h1><p>${e(subtitle)}</p></div>${actions ? `<div class="stock-head__actions">${actions}</div>` : ''}</header>`;
}

// Skeletons mirror the final layout so nothing jumps when data arrives.
const sk = (cls = '') => `<span class="skel skel-line ${cls}" aria-hidden="true"></span>`;
export const skeletonSummary = (count = 4) => `<div class="stock-summary" role="status" aria-label="Loading summary" aria-busy="true">${Array.from({ length: count }, () => `<div class="stock-tile stock-tile--skeleton">${sk('skel-line--short')}<span class="skel skel-value" aria-hidden="true"></span></div>`).join('')}</div>`;
export const skeletonRows = (columns, rows = 7) => `<div class="panel stock-table-panel" role="status" aria-label="Loading records" aria-busy="true"><table class="data-table stock-table"><thead><tr>${columns.map((c) => `<th scope="col">${e(c)}</th>`).join('')}</tr></thead><tbody aria-hidden="true">${Array.from({ length: rows }, () => `<tr>${columns.map((_, i) => `<td>${i === columns.length - 2 ? '<span class="skel skel-badge"></span>' : sk(i % 2 ? 'skel-line--short' : '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div><div class="stock-cards stock-cards--skeleton" aria-hidden="true">${Array.from({ length: 4 }, () => `<article class="stock-card">${sk()}${sk('skel-line--short')}<span class="skel skel-badge"></span></article>`).join('')}</div>`;
export const skeletonPanel = (lines = 5) => `<div class="stock-skeleton-panel" role="status" aria-label="Loading" aria-busy="true">${Array.from({ length: lines }, (_, i) => sk(i % 3 === 0 ? 'skel-line--long' : i % 3 === 1 ? '' : 'skel-line--short')).join('')}</div>`;

export function errorState(message, retryLabel = 'Try again') {
  return `<section class="panel stock-state stock-state--error" role="alert">${icon('alert')}<h2>${e(message)}</h2><p>Check your connection and try again. No stock has been changed.</p><button class="button button--primary" type="button" data-retry>${icon('refresh')} ${e(retryLabel)}</button></section>`;
}
export function emptyState(title, detail = '', action = '') {
  return `<div class="stock-state stock-state--empty">${icon('box')}<h3>${e(title)}</h3>${detail ? `<p>${e(detail)}</p>` : ''}${action}</div>`;
}

// Actionable shortage message (used by Orders and the retry flow).
export function shortagePanel(shortages, { orderNumber = '', compact = false } = {}) {
  const rows = (shortages || []).map((s) => `<tr><th scope="row">${e(s.name)}</th><td>${qty(s.required, s.unit)}</td><td>${qty(s.available, s.unit)}</td><td><strong class="stock-shortage-amount">${qty(s.shortage, s.unit)}</strong></td></tr>`).join('');
  return `<section class="stock-shortage" role="alert">
    <header>${icon('alert')}<div><strong>Insufficient materials${orderNumber ? ` · Order #${e(orderNumber)}` : ''}</strong><p>Nothing was deducted. Restock the items below, then confirm again.</p></div></header>
    <div class="table-scroll"><table class="stock-shortage__table"><thead><tr><th scope="col">Material</th><th scope="col">Required</th><th scope="col">Available</th><th scope="col">Shortage</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${compact ? '' : `<div class="stock-shortage__actions"><a class="button" href="#inventory" data-shortage-review>${icon('eye')} Review inventory</a><button class="button" type="button" data-shortage-restock="${attr((shortages || [])[0]?.item_id || '')}">${icon('plus')} Restock</button><button class="button button--quiet" type="button" data-shortage-return>${icon('back')} Return to order</button></div>`}
  </section>`;
}

export function parseShortage(error) {
  if (!error || error.code !== 'LX409') return null;
  try { const list = JSON.parse(error.details || '[]'); return Array.isArray(list) ? list : null; } catch { return null; }
}

// Right-side drawer (full screen on phones). Uses <dialog> for focus trapping and Escape.
export function openDrawer(title, body, { wide = false, onClose } = {}) {
  document.querySelector('#stock-drawer')?.remove();
  const opener = document.activeElement;
  const dialog = document.createElement('dialog');
  dialog.id = 'stock-drawer';
  dialog.className = `stock-drawer${wide ? ' stock-drawer--wide' : ''}`;
  dialog.setAttribute('aria-labelledby', 'stock-drawer-title');
  dialog.innerHTML = `<div class="stock-drawer__panel"><header class="stock-drawer__head"><button class="stock-icon-button stock-drawer__back" type="button" data-drawer-close aria-label="Back">${icon('back')}</button><h2 id="stock-drawer-title">${e(title)}</h2><button class="stock-icon-button" type="button" data-drawer-close aria-label="Close">${icon('close')}</button></header><div class="stock-drawer__body">${body}</div></div>`;
  document.body.append(dialog);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog || event.target.closest('[data-drawer-close]')) dialog.close();
  });
  dialog.addEventListener('close', () => { dialog.remove(); onClose?.(); if (opener?.isConnected) opener.focus(); });
  dialog.showModal();
  return dialog;
}

export function csv(rows) {
  return rows.map((row) => row.map((cell) => {
    const text = String(cell ?? '');
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }).join(',')).join('\r\n');
}
export function download(filename, text, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type }));
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
