export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export const money = value => new Intl.NumberFormat('en-PH', {style:'currency', currency:'PHP', minimumFractionDigits:2, maximumFractionDigits:2}).format(value);
export const notice = message => `<p class="notice">${escapeHtml(message)}</p>`;
export const empty = message => `<div class="empty">${escapeHtml(message)}</div>`;
export function icon(name, className = '') {
  const paths = {
    dashboard: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    inventory: '<path d="M4 7h16v14H4V7ZM3 3h18v4H3V3Z"/><path d="M9 12h6"/>',
    products: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4.5 7.5 7.5 4 7.5-4M12 11.5V21"/>',
    orders: '<path d="M6 3h12v18H6z"/><path d="M9 7h6M9 11h6M9 15h4"/>',
    bookings: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/><path d="M8 14h3M13 14h3"/>',
    delivery: '<path d="M3 7h11v10H3z"/><path d="M14 10h4l3 3v4h-7z"/><circle cx="7" cy="19" r="1.5"/><circle cx="18" cy="19" r="1.5"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    reports: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    gallery: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m4 17 5-5 4 4 2-2 5 4"/>',
    profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    logout: '<path d="M10 17l5-5-5-5M15 12H3"/><path d="M14 3h7v18h-7"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    refresh: '<path d="M20 6v5h-5"/><path d="M4 18v-5h5"/><path d="M6.1 9a7 7 0 0 1 11.7-2.6L20 11M4 13l2.2 4.6A7 7 0 0 0 18 15"/>',
    revenue: '<circle cx="12" cy="12" r="9"/><path d="M15 8.5c-.7-.6-1.7-1-3-1-1.7 0-3 .9-3 2s1.1 1.8 3 2.1 3 1 3 2.2-1.3 2.2-3 2.2c-1.3 0-2.4-.4-3.2-1.2M12 5v14"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/>',
    alert: '<path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 9v4M12 17h.01"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
    eye: '<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/>',
    edit: '<path d="m4 16-.8 4 4-.8L18 8l-3-3L4 16Z"/><path d="m13.5 6.5 3 3"/>',
    archive: '<path d="M4 7h16v14H4V7ZM3 3h18v4H3V3Z"/><path d="M9 12h6"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    arrow: '<path d="M5 12h14M14 7l5 5-5 5"/>',
    save: '<path d="M5 3h12l2 2v16H5V3Z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/>'
  };
  return `<svg class="admin-icon${className ? ` ${escapeHtml(className)}` : ''}" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.info}</svg>`;
}
export function panel(title, body, action = '', className = '') {
  return `<section class="panel ${className}"><h2 class="panel-title"><span>${escapeHtml(title)}</span>${action}</h2>${body}</section>`;
}
export function period() {
  return '<select aria-label="Report period" disabled title="Requires saved sales records"><option>This week</option><option>This month</option></select>';
}
export function stats(pending = false) {
  return `<div class="stats">${[['revenue','Total Revenue'],['orders','Total Orders'],...(pending ? [['clock','Pending Orders']] : [])].map(([iconName,label])=>`<section class="stat"><div><span class="stat-icon">${icon(iconName)}</span><strong aria-label="Unavailable">—</strong></div><h2>${label}</h2></section>`).join('')}</div>`;
}
export function statusIndicator(label, tone = 'neutral', detail = '') {
  const safeTone = ['success','warning','danger','info','neutral'].includes(tone) ? tone : 'neutral';
  const iconName = { success: 'check', warning: 'clock', danger: 'alert', info: 'info', neutral: 'archive' }[safeTone];
  return `<span class="status-indicator ${safeTone}">${icon(iconName, 'status-icon')}<span><strong>${escapeHtml(label)}</strong>${detail ? `<small>${escapeHtml(detail)}</small>` : ''}</span></span>`;
}
export function table(columns, message) {
  return `<div class="panel table-scroll"><table class="data-table"><thead><tr>${columns.map(name=>`<th scope="col">${escapeHtml(name)}</th>`).join('')}</tr></thead><tbody><tr><td colspan="${columns.length}" class="empty">${escapeHtml(message)}</td></tr></tbody></table></div>`;
}
export function toolbar(controls = '', searchDisabled = false) {
  return `<div class="toolbar"><label class="admin-search">${icon('search')}<span class="sr-only">Search records</span><input class="search" type="search" placeholder="Search" aria-label="Search records" ${searchDisabled ? 'disabled title="No records are connected"' : ''}></label><div class="controls">${controls}</div></div>`;
}
export function unavailableButton(label) {
  return `<button class="button" disabled title="Requires an authenticated backend">${escapeHtml(label)}</button>`;
}

// Shared native dialog: keyboard focus, Escape and backdrop dismissal.
export function showDetails(title, body, opener) {
  document.querySelector('#admin-dialog')?.remove();
  const dialog = document.createElement('dialog');
  dialog.id = 'admin-dialog';
  dialog.setAttribute('aria-labelledby', 'dialog-title');
  dialog.innerHTML = `<header class="dialog-header"><h2 id="dialog-title">${escapeHtml(title)}</h2><button class="button icon-button" aria-label="Close details" data-close>${icon('close')}</button></header><div class="dialog-body">${body}</div><footer class="dialog-footer"><button class="button primary" data-close>${icon('check')} Done</button></footer>`;
  document.body.append(dialog);
  dialog.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
  dialog.addEventListener('close', () => { dialog.remove(); opener?.focus(); });
  dialog.showModal();
  return dialog;
}
