// Solid status marks (no box behind them): ok ✓, warn ⚠, info !, stop ⯃. Colour comes from the .glyph-* class.
// Plus a few line icons for the order card (customer, phone, pin, note, bag, cake, box).
const SOLID={
 ok:'<circle cx="12" cy="12" r="10"/><path d="m7.5 12.2 3 3 6-6.4" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
 warn:'<path d="M10.3 3.4a2 2 0 0 1 3.4 0l8.4 14.5a2 2 0 0 1-1.7 3H3.6a2 2 0 0 1-1.7-3Z"/><path d="M12 9v4.6M12 17.2h.01" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>',
 info:'<circle cx="12" cy="12" r="10"/><path d="M12 7v6M12 16.8h.01" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>',
 stop:'<path d="M8.1 2h7.8L22 8.1v7.8L15.9 22H8.1L2 15.9V8.1Z"/><path d="M12 7v6M12 16.8h.01" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>'
};
const LINE={
 user:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
 phone:'<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z"/>',
 pin:'<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>',
 note:'<path d="M5 4h14v11l-5 5H5V4Z"/><path d="M14 20v-5h5M9 9h6M9 12.5h4"/>',
 calendar:'<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/>',
 bag:'<path d="M5 8h14l-1 12H6L5 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
 check:'<circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/>',
 cake:'<path d="M4 20h16v-7H4v7Z"/><path d="M4 16.5c2 0 2-1.5 4-1.5s2 1.5 4 1.5 2-1.5 4-1.5 2 1.5 4 1.5M12 13V9.5"/><path d="M12 7c.9-.8.9-1.8 0-2.8-.9 1-.9 2 0 2.8Z"/>',
 box:'<path d="M4 8l8-4 8 4v8l-8 4-8-4V8Z"/><path d="m4 8 8 4 8-4M12 12v8"/>',
 truck:'<path d="M3 7h11v10H3z"/><path d="M14 10h4l3 3v4h-7z"/><circle cx="7" cy="18.5" r="1.5"/><circle cx="18" cy="18.5" r="1.5"/>',
 done:'<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z"/><path d="m9.3 9.6 1.9 1.9 3.6-3.7"/>',
 x:'<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>'
};
export const glyph=kind=>'<svg class="glyph glyph-'+kind+'" viewBox="0 0 24 24" aria-hidden="true">'+(SOLID[kind]||SOLID.info)+'</svg>';
export const line=name=>'<svg class="line-icon" viewBox="0 0 24 24" aria-hidden="true">'+(LINE[name]||LINE.note)+'</svg>';
