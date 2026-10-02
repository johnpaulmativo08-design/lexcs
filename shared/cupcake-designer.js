// Cupcake designer (customer): Mini Cupcakes and 3oz Cupcakes. Mirrors how LexC's pipes a box:
// size and flavor -> box pattern + piping style + palette (design A, and B when alternating) -> finishing
// (pearls, gold balls, leaves, glitter) and theme toppers. Live top-down picture of the actual box.
// Options and prices come from public.design_options; the server re-validates and prices every design
// (quote_cupcake_design / create_order). Adds to the existing cart; never creates an order itself.
(() => {
  const STEPS = [['box', 'Box'], ['design', 'Design'], ['finish', 'Finish'], ['review', 'Review']];
  const DRAFT_KEY = 'lexc_cupcake_draft_v1';
  const SLUGS = { mini: 'product-5', regular: 'product-6' };
  // Colour rules per piping style (the server enforces the same numbers).
  const RULE = { rosette: [1, 1], two_tone: [2, 2], luxe: [2, 2], rainbow: [3, 5], floral: [1, 5] };
  const STYLE_NOTE = {
    rosette: 'One big swirl', two_tone: 'Two colors in one bag', rainbow: '3–5 pastel stripes',
    luxe: 'Half rose, darker blooms, gold ball', floral: 'Hydrangea, ruffle and rose trio'
  };
  const THEME_ICON = { none: '—', mermaid: '🐚', butterfly: '🦋', unicorn: '🦄', dinosaur: '🦖', space: '🚀', safari: '🦁', custom: '✨' };
  const COLOR_GROUPS = [
    ['Pastels', ['white', 'ivory', 'cream', 'butter', 'peach', 'blush', 'baby_pink', 'lavender', 'lilac', 'baby_blue', 'mint', 'aqua']],
    ['Brights', ['lemon', 'lime', 'coral', 'pink', 'hot_pink', 'red', 'purple', 'periwinkle', 'sky_blue', 'azure', 'leaf_green', 'sage']],
    ['Deep', ['deep_rose', 'burgundy', 'denim', 'navy', 'chocolate', 'black']]
  ];
  // One-tap looks taken from LexC's own cupcake photos. size: which product they are piped on.
  const PRESETS = [
    { key: 'ocean', name: 'Ocean swirl', size: 'mini', s: { pattern: 'same', a: { style: 'two_tone', colors: ['azure', 'white'] }, finishes: ['gold_pearls'] } },
    { key: 'pinkwhite', name: 'Pink & white', size: 'mini', s: { pattern: 'alternate', a: { style: 'rosette', colors: ['hot_pink'] }, b: { style: 'rosette', colors: ['white'] }, finishes: ['gold_pearls'] } },
    { key: 'glam', name: 'Black & blush', size: 'mini', s: { pattern: 'alternate', a: { style: 'rosette', colors: ['black'] }, b: { style: 'rosette', colors: ['baby_pink'] }, finishes: ['gold_pearls'] } },
    { key: 'rainbow', name: 'Pastel rainbow', size: 'mini', s: { pattern: 'same', a: { style: 'rainbow', colors: ['baby_pink', 'butter', 'sky_blue', 'lavender', 'mint'] }, finishes: ['gold_pearls'] } },
    { key: 'blush', name: 'Blush luxe', size: 'regular', s: { flavor: 'vanilla', pattern: 'alternate', a: { style: 'luxe', colors: ['blush', 'deep_rose'] }, b: { style: 'rosette', colors: ['pink'] }, finishes: ['gold_pearls', 'gold_balls'] } },
    { key: 'royal', name: 'Royal navy', size: 'regular', s: { flavor: 'vanilla', pattern: 'alternate', a: { style: 'luxe', colors: ['white', 'denim'] }, b: { style: 'rosette', colors: ['denim'] }, finishes: ['gold_pearls', 'gold_balls'] } },
    { key: 'garden', name: 'Flower garden', size: 'regular', s: { pattern: 'same', a: { style: 'floral', colors: ['baby_pink', 'lime', 'lilac', 'sky_blue'] }, finishes: ['gold_pearls', 'leaves'] } },
    { key: 'mermaid', name: 'Mermaid', size: 'regular', s: { pattern: 'same', a: { style: 'rainbow', colors: ['pink', 'aqua', 'lavender'] }, finishes: ['gold_pearls', 'white_pearls'], theme: 'mermaid' } }
  ];
  const luminance = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const esc = (v) => authEscape(String(v ?? ''));
  const money = (v) => checkoutMoney(v).replace('.00', '');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let root = null, products = {}, optionsBy = {}, state = null, step = 'box', past = [], future = [], editIndex = null;
  let quote = { status: 'idle' }, quoteTimer = 0, quoteSeq = 0, visited = new Set(), scene = null, sceneLoading = null, previewFrame = 0, packed = false;
  const product = () => products[state.size];
  const options = () => optionsBy[state.size] || {};
  const palette = () => Object.fromEntries((options().color || []).map((c) => [c.code, c.hex]));
  const opt = (group, code) => (options()[group] || []).find((o) => o.code === code);
  const variant = () => product()?.product_variants.find((v) => v.id === state.variant_id && v.is_active);
  const countOf = (label) => Number(String(label).match(/(\d+)\s*pcs/i)?.[1]) || Number(String(label).match(/\d+/)?.[0]) || 12;

  function blank(size = 'mini') {
    const p = products[size];
    return { size, variant_id: p?.product_variants.filter((v) => v.is_active)[0]?.id, qty: 1, flavor: 'chocolate', pattern: 'same',
      a: { style: 'rosette', colors: ['baby_pink'] }, b: { style: 'rosette', colors: ['white'] }, finishes: ['gold_pearls'], theme: 'none', theme_note: '' };
  }
  const design = () => ({ designer: 'cupcake', flavor: state.flavor, pattern: state.pattern,
    a: { style: state.a.style, colors: [...state.a.colors] },
    ...(state.pattern === 'alternate' ? { b: { style: state.b.style, colors: [...state.b.colors] } } : {}),
    finishes: [...state.finishes], theme: state.theme, ...(state.theme !== 'none' && state.theme_note.trim() ? { theme_note: state.theme_note.trim() } : {}) });

  // ---- data ---------------------------------------------------------------------------------------
  async function loadAll() {
    const catalog = typeof liveCatalog !== 'undefined' ? liveCatalog : [];
    products = {};
    for (const [size, slug] of Object.entries(SLUGS)) { const p = catalog.find((x) => x.slug === slug && x.customization_config?.designer === 'cupcake'); if (p) products[size] = p; }
    if (!Object.keys(products).length) throw new Error('Cupcake designer unavailable');
    const ids = Object.values(products).map((p) => p.id);
    const rows = LexcBackend.unwrap(await LexcBackend.client.from('design_options').select('product_id,group_key,code,label,price,hex,sort_order').in('product_id', ids).order('sort_order'));
    optionsBy = {};
    for (const [size, p] of Object.entries(products)) { const o = {}; rows.filter((r) => r.product_id === p.id).forEach((r) => (o[r.group_key] ||= []).push(r)); optionsBy[size] = o; }
  }

  // ---- state, history, draft -----------------------------------------------------------------------
  const snap = () => JSON.stringify(state);
  function normalise() {
    if (!products[state.size]) state.size = Object.keys(products)[0];
    if (!variant()) state.variant_id = product().product_variants.find((v) => v.is_active)?.id;
    state.qty = Math.min(20, Math.max(1, Number(state.qty) || 1));
    if (!opt('flavor', state.flavor)) state.flavor = 'chocolate';
    if (!opt('pattern', state.pattern)) state.pattern = 'same';
    const pal = palette();
    for (const k of ['a', 'b']) {
      const part = state[k];
      if (!opt('style', part.style)) part.style = 'rosette';
      part.colors = [...new Set(part.colors)].filter((c) => pal[c]);
      const [lo, hi] = state.pattern === 'assorted' && k === 'a' ? [2, 16] : RULE[part.style];
      part.colors = part.colors.slice(0, hi);
      const fill = ['white', 'baby_pink', 'azure', 'lavender', 'butter', 'mint'].filter((c) => pal[c]);
      for (const c of fill) if (part.colors.length < lo && !part.colors.includes(c)) part.colors.push(c);
    }
    state.finishes = [...new Set(state.finishes)].filter((f) => opt('finish', f));
    if (state.finishes.includes('gold_pearls') && state.finishes.includes('silver_pearls')) state.finishes = state.finishes.filter((f) => f !== 'silver_pearls');
    if (!opt('theme', state.theme)) state.theme = 'none';
    state.theme_note = String(state.theme_note || '').slice(0, 60);
  }
  function commit(mutator, { soft = false } = {}) {
    const before = snap(); mutator(state); normalise();
    if (snap() === before) return;
    if (!soft) { past.push(before); if (past.length > 60) past.shift(); future = []; }
    afterChange();
  }
  function afterChange(rerender = true) { saveDraft(); renderPreview(); scheduleQuote(); updateFooter(); updateTools(); if (rerender) renderBody(); }
  function saveDraft() { try { if (editIndex === null) localStorage.setItem(DRAFT_KEY, JSON.stringify({ state, step })); } catch {} }
  function undo() { if (!past.length) return; future.push(snap()); state = JSON.parse(past.pop()); normalise(); afterChange(); }
  function redo() { if (!future.length) return; past.push(snap()); state = JSON.parse(future.pop()); normalise(); afterChange(); }

  // ---- pricing (server quote) -------------------------------------------------------------------------
  function localExtra() {
    const o = options(); const p = (g, c) => Number(o[g]?.find((x) => x.code === c)?.price || 0);
    let e = p('pattern', state.pattern) + p('style', state.a.style);
    if (state.pattern === 'alternate' && state.b.style !== state.a.style) e += p('style', state.b.style);
    state.finishes.forEach((f) => { e += p('finish', f); }); e += p('theme', state.theme);
    return e;
  }
  const unitPrice = () => Number(variant()?.price || 0) + (quote.status === 'ok' ? quote.extra : localExtra());
  function scheduleQuote() { clearTimeout(quoteTimer); quote = { status: 'pending' }; updateFooter(); quoteTimer = setTimeout(runQuote, 280); }
  async function runQuote() {
    const seq = ++quoteSeq;
    try {
      const r = await LexcBackend.rpc('quote_cupcake_design', { p_product_id: product().id, p_design: design() });
      if (seq !== quoteSeq) return;
      quote = { status: 'ok', extra: Number(r.extra), clean: r.clean };
    } catch (error) { if (seq !== quoteSeq) return; quote = { status: 'error', message: error.message || 'This design cannot be priced right now.' }; }
    updateFooter(); if (step === 'review') renderBody();
  }

  // ---- drawing: one cupcake seen from above (100×100), then the whole box -------------------------------
  const shade = (hex, amt) => { const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    const f = (v) => Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt); return '#' + [f(r), f(g), f(b)].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join(''); };
  function spiral(cx, cy, r0, r1, turns, phase = 0) {
    const pts = []; const steps = Math.round(turns * 28);
    for (let i = 0; i <= steps; i++) { const t = i / steps, a = phase + t * turns * Math.PI * 2, r = r0 + (r1 - r0) * t; pts.push(`${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`); }
    return pts.join(' ');
  }
  // Piped outline: the star tip leaves a wavy edge around the swirl.
  function scallop(cx, cy, R, n) {
    const pts = []; for (let i = 0; i <= 120; i++) { const a = i / 120 * Math.PI * 2, r = R * (0.94 + 0.06 * Math.cos(a * n)); pts.push(`${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`); }
    return 'M' + pts.join('L') + 'Z';
  }
  let uid = 0;
  function swirl(cx, cy, R, colors) {
    // A piped rosette: base colour, extra colours as wide spiral bands, then fine ridges for depth.
    const id = 'cl' + (++uid), base = colors[0], edge = scallop(cx, cy, R, 11);
    let s = `<clipPath id="${id}"><path d="${edge}"/></clipPath><path d="${edge}" fill="${base}" stroke="${shade(base, -0.2)}" stroke-width="1"/>`;
    s += `<g clip-path="url(#${id})">`;
    colors.slice(1).forEach((c, k) => { s += `<polyline points="${spiral(cx, cy, 2, R * 1.02, 3, (k + 1) * Math.PI * 2 / colors.length)}" fill="none" stroke="${c}" stroke-width="${R * 0.24}" stroke-linecap="round"/>`; });
    s += `<polyline points="${spiral(cx, cy, 2, R, 3, 0.4)}" fill="none" stroke="${shade(base, -0.3)}" stroke-opacity=".45" stroke-width="${(R / 22).toFixed(1)}"/>`;
    s += `<polyline points="${spiral(cx, cy, 3, R, 3, 0.9)}" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="${(R / 30).toFixed(1)}"/></g><circle cx="${cx - R * 0.25}" cy="${cy - R * 0.3}" r="${R * 0.35}" fill="#fff" opacity=".12"/>`;
    return s;
  }
  const star = (cx, cy, r, n, color, rot = 0) => { const p = []; for (let i = 0; i < n * 2; i++) { const a = rot + i * Math.PI / n, rr = i % 2 ? r * 0.45 : r; p.push(`${(cx + Math.cos(a) * rr).toFixed(1)},${(cy + Math.sin(a) * rr).toFixed(1)}`); }
    return `<polygon points="${p.join(' ')}" fill="${color}" stroke="${shade(color, -0.2)}" stroke-width=".6"/>`; };
  const rng = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  function leaves(rand) { let s = ''; for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 + rand() * 0.3, x = 50 + Math.cos(a) * 41, y = 50 + Math.sin(a) * 41;
    s += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="7" ry="3.6" transform="rotate(${(a * 180 / Math.PI + 90).toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})" fill="#3DB65A" stroke="#2b8a42" stroke-width=".6"/>`; } return s; }
  function cupcake(spec, flavor, finishes, theme, seed) {
    const rand = rng(seed * 7919 + 13), fin = new Set(finishes), c = spec.colors;
    let s = flavor === 'vanilla'
      ? '<circle cx="50" cy="50" r="48" fill="#f4efe6" stroke="#d8ccb8"/><circle cx="50" cy="50" r="45" fill="#d9a65a"/>'
      : '<circle cx="50" cy="50" r="48" fill="#241816" stroke="#120b0a"/><circle cx="50" cy="50" r="45" fill="#3a2620"/>';
    if (fin.has('leaves') && spec.style !== 'luxe') s += leaves(rand);
    if (spec.style === 'luxe') {
      s += swirl(39, 50, 27, [c[0]]);
      [[70, 33, 9], [74, 58, 9], [61, 73, 8]].forEach(([x, y, r]) => { s += `<circle cx="${x}" cy="${y}" r="${r}" fill="${c[1]}" stroke="${shade(c[1], -0.2)}" stroke-width=".8"/><circle cx="${x - 2.5}" cy="${y - 3}" r="${r * 0.3}" fill="#fff" opacity=".35"/>`; });
      s += star(63, 47, 9, 8, shade(c[1], -0.06), 0.2) + star(80, 45, 7, 8, c[1], 0.5);
      if (fin.has('gold_balls')) s += '<circle cx="58" cy="27" r="6.5" fill="#d4af37"/><circle cx="56" cy="25" r="2.2" fill="#fff6c9"/>';
    } else if (spec.style === 'floral') {
      const kind = spec.sub || 'hydrangea';
      if (kind === 'hydrangea') {
        s += `<circle cx="50" cy="50" r="38" fill="${shade(c[0], -0.08)}"/>`;
        for (let i = 0; i < 26; i++) { const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * 32; s += star(50 + Math.cos(a) * r, 50 + Math.sin(a) * r, 6, 5, shade(c[0], (rand() - 0.5) * 0.18), rand() * 2); }
      } else if (kind === 'ruffle') {
        for (let i = 0; i < 9; i++) { const a = i * 40; s += `<ellipse cx="50" cy="30" rx="13" ry="19" transform="rotate(${a} 50 50)" fill="${c[0]}" stroke="${shade(c[0], -0.18)}" stroke-width=".8"/>`; }
        for (let i = 0; i < 6; i++) { const a = i * 60 + 20; s += `<ellipse cx="50" cy="38" rx="8" ry="12" transform="rotate(${a} 50 50)" fill="${shade(c[0], 0.12)}" stroke="${shade(c[0], -0.15)}" stroke-width=".6"/>`; }
        for (let i = 0; i < 5; i++) s += star(50 + (rand() - 0.5) * 8, 50 + (rand() - 0.5) * 8, 4, 5, '#E6E04A');
      } else {
        const cols = [c[0], c[1 % c.length], c[2 % c.length]];
        s += swirl(36, 40, 17, [cols[0]]) + swirl(64, 42, 16, [cols[1]]) + swirl(48, 66, 17, [cols[2]]);
      }
    } else {
      s += swirl(50, 50, 40, c);
    }
    const pearl = (color, hi, r) => { const a = rand() * Math.PI * 2, rr = 6 + rand() * 18; const x = 50 + Math.cos(a) * rr, y = 50 + Math.sin(a) * rr;
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${color}"/><circle cx="${(x - r * 0.35).toFixed(1)}" cy="${(y - r * 0.35).toFixed(1)}" r="${(r * 0.35).toFixed(2)}" fill="${hi}"/>`; };
    if (fin.has('gold_pearls')) for (let i = 0; i < 3 + Math.floor(rand() * 3); i++) s += pearl('#c99a2e', '#fff1b8', 2.6);
    if (fin.has('silver_pearls')) for (let i = 0; i < 3 + Math.floor(rand() * 3); i++) s += pearl('#b8bec7', '#ffffff', 2.6);
    if (fin.has('white_pearls')) for (let i = 0; i < 8; i++) s += pearl('#fbfbfb', '#ffffff', 1.7);
    if (fin.has('gold_balls') && spec.style !== 'luxe') s += '<circle cx="62" cy="34" r="5.5" fill="#d4af37"/><circle cx="60" cy="32" r="1.9" fill="#fff6c9"/>';
    if (fin.has('edible_glitter')) for (let i = 0; i < 16; i++) s += `<circle cx="${(18 + rand() * 64).toFixed(1)}" cy="${(18 + rand() * 64).toFixed(1)}" r=".9" fill="#fff" opacity=".85"/>`;
    if (theme && theme !== 'none') s += `<text x="${theme === 'custom' ? 50 : 58}" y="${theme === 'custom' ? 58 : 50}" font-size="26" text-anchor="middle" dominant-baseline="middle">${THEME_ICON[theme] || '✨'}</text>`;
    return s;
  }
  const FLORAL_SUBS = ['hydrangea', 'ruffle', 'rose_trio'];
  function specFor(i, r, c) {
    const A = state.a, B = state.b;
    if (state.pattern === 'alternate') { const p = (r + c) % 2 ? B : A; return { ...p, sub: FLORAL_SUBS[i % 3] }; }
    if (state.pattern === 'assorted') {
      const pal = A.colors, n = pal.length, at = (k) => pal[(i + k) % n];
      const colors = A.style === 'rosette' ? [at(0)] : A.style === 'rainbow' ? Array.from({ length: Math.min(5, Math.max(3, n)) }, (_, k) => at(k)) : A.style === 'floral' ? [at(0), at(1), at(2)] : [at(0), at(1)];
      return { style: A.style, colors, sub: FLORAL_SUBS[i % 3] };
    }
    if (A.style === 'floral') { const n = A.colors.length; return { style: 'floral', colors: [A.colors[i % n], A.colors[(i + 1) % n], A.colors[(i + 2) % n]], sub: FLORAL_SUBS[i % 3] }; }
    return { ...A };
  }
  function grid(count) { const g = { 6: [3, 2], 12: [4, 3], 24: [6, 4], 25: [5, 5], 36: [6, 6], 48: [8, 6] }[count]; if (g) return g; const cols = Math.ceil(Math.sqrt(count * 1.4)); return [cols, Math.ceil(count / cols)]; }
  function boxSvg(forImage = false) {
    const pal = palette(), hex = (code) => pal[code] || '#ffffff';
    const count = countOf(variant()?.label), [cols, rows] = grid(count), cell = 100, pad = 26;
    const W = cols * cell + pad * 2, H = rows * cell + pad * 2;
    let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" ${forImage ? `width="${W * 2}" height="${H * 2}"` : 'role="img"'}>`;
    s += `<rect x="2" y="2" width="${W - 4}" height="${H - 4}" rx="16" fill="#ffffff" stroke="#e3dbe9" stroke-width="3"/><rect x="${pad - 8}" y="${pad - 8}" width="${W - pad * 2 + 16}" height="${H - pad * 2 + 16}" rx="10" fill="#f5f2f7"/>`;
    uid = 0; let i = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols && i < count; c++, i++) {
      const spec = specFor(i, r, c);
      s += `<g transform="translate(${pad + c * cell} ${pad + r * cell}) scale(.96) translate(2 2)">${cupcake({ ...spec, colors: spec.colors.map(hex) }, state.flavor, state.finishes, state.theme, i + 1)}</g>`;
    }
    return s + '</svg>';
  }
  async function snapshot(size = 520) {
    try {
      const svg = boxSvg(true), img = new Image(), url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      await new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; img.src = url; });
      const scale = size / Math.max(img.width, img.height), cv = document.createElement('canvas');
      cv.width = Math.round(img.width * scale); cv.height = Math.round(img.height * scale);
      const g = cv.getContext('2d'); g.fillStyle = '#fcf6ff'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url); return cv.toDataURL('image/jpeg', 0.82);
    } catch (error) { console.info('Cupcake picture unavailable:', error); return ''; }
  }

  // ---- markup ------------------------------------------------------------------------------------------
  const ICON = {
    back: '<path d="m15 18-6-6 6-6"/>', undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>', reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'
  };
  const icon = (n) => `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true">${ICON[n]}</svg>`;
  function shell() {
    root.innerHTML = `<div class="bd-wrap cd-wrap">
      <header class="bd-head">
        <button type="button" class="bd-back" data-cd-exit aria-label="Back to the menu">${icon('back')}<span class="bd-back-text">Menu</span></button>
        <h1><span class="cd-h1-long">Design your cupcakes</span><span class="cd-h1-short" aria-hidden="true">Your cupcakes</span></h1>
        <div class="bd-tools" role="group" aria-label="Design history">
          <button type="button" class="bd-tool" data-cd-undo aria-label="Undo">${icon('undo')}<span>Undo</span></button>
          <button type="button" class="bd-tool" data-cd-redo aria-label="Redo">${icon('redo')}<span>Redo</span></button>
          <button type="button" class="bd-tool" data-cd-reset aria-label="Start over">${icon('reset')}<span>Reset</span></button>
        </div>
      </header>
      <div class="bd-layout">
        <section class="bd-stage cd-stage" aria-label="Box preview">
          <div class="bd-canvas-box cd-canvas" data-cd-3d hidden></div>
          <div class="cd-box" data-cd-box></div>
          <div class="bd-stage-bar" data-cd-bar hidden>
            <div class="bd-seg" role="group" aria-label="View">${[['angle', 'Box'], ['close', 'Close-up'], ['top', 'Top']].map(([k, l]) => `<button type="button" data-cd-view="${k}" aria-pressed="${k === 'angle'}">${l}</button>`).join('')}</div>
            <div class="bd-seg" role="group" aria-label="Scene">${[['studio', 'Studio'], ['bakery', 'Bakery'], ['party', 'Party']].map(([k, l]) => `<button type="button" data-cd-scene="${k}" aria-pressed="${k === 'studio'}">${l}</button>`).join('')}</div>
          </div>
          <p class="bd-hint" data-cd-hint>Your box seen from above. Handmade piping varies a little from box to box.</p>
        </section>
        <section class="bd-panel">
          <div class="bd-steps" role="tablist" aria-label="Design steps">${STEPS.map(([k, l], i) => `<button type="button" role="tab" class="bd-step" data-cd-step="${k}" aria-controls="cd-body"><b>${i + 1}</b>${l}</button>`).join('')}</div>
          <div class="bd-body" id="cd-body" role="tabpanel" tabindex="-1"></div>
          <div class="bd-foot">
            <div class="bd-price cd-price"><strong data-cd-price>—</strong><span data-cd-note aria-live="polite"></span></div>
            <button type="button" class="bd-secondary" data-cd-prev>Back</button>
            <button type="button" class="bd-primary" data-cd-next>Next</button>
          </div>
        </section>
      </div>
    </div>`;
  }
  const swatchBtn = (k, code, c, on, n) => `<button type="button" class="bd-swatch${on ? ' is-on' : ''}${Number(c.price) > 0 ? ` has-price" data-price="+${money(c.price)}` : ''}" style="background:${c.hex}" data-cd-color="${k}" data-value="${code}" aria-pressed="${on}" aria-label="${esc(c.label)}${Number(c.price) > 0 ? ', +' + money(c.price) : ''}${on ? ', color ' + n : ''}" title="${esc(c.label)}${Number(c.price) > 0 ? ' +' + money(c.price) : ''}">${on && n ? `<i class="cd-num">${n}</i>` : ''}</button>`;
  function colorPicker(k) {
    const part = state[k], assorted = state.pattern === 'assorted' && k === 'a';
    const [lo, hi] = assorted ? [2, 16] : RULE[part.style];
    const pal = options().color || [], known = new Set(COLOR_GROUPS.flatMap(([, cs]) => cs));
    const groups = COLOR_GROUPS.map(([name, codes]) => [name, codes.map((c) => pal.find((o) => o.code === c)).filter(Boolean)]);
    const extra = pal.filter((c) => !known.has(c.code)); if (extra.length) groups.push(['More', extra]);
    const need = lo === hi ? `Pick ${lo} color${lo > 1 ? 's' : ''}` : `Pick ${lo}–${hi} colors`;
    const tip = harmonyTip(part.colors);
    return `<p class="bd-note cd-need">${need} · <b>${part.colors.length} chosen</b>${part.colors.length > 1 ? ' — the order is the piping order' : ''}</p>
      <div class="cd-chosen" aria-label="Chosen colors">${part.colors.map((c, i) => `<span class="cd-chip"><i style="background:${palette()[c]}"></i>${i + 1}. ${esc(opt('color', c)?.label)}</span>`).join('')}</div>
      ${tip ? `<p class="cd-tip">${tip}</p>` : ''}
      ${groups.filter(([, l]) => l.length).map(([name, list]) => `<p class="bd-swatch-group">${name}</p><div class="bd-swatches">${list.map((c) => { const i = part.colors.indexOf(c.code); return swatchBtn(k, c.code, c, i >= 0, i + 1); }).join('')}</div>`).join('')}`;
  }
  // Colour advice from how LexC's combines colours: colour + white, two shades, bold contrast, pastel sets.
  function harmonyTip(colors) {
    if (colors.length < 2) return '';
    const pal = palette(), L = colors.map((c) => luminance(pal[c] || '#ffffff'));
    const dark = L.filter((l) => l < 0.08).length;
    if (dark >= 2 && colors.length <= 3) return 'Tip: two dark colors can look heavy. Pair a dark color with white or a pastel, like black and blush.';
    if (colors.length >= 3 && Math.max(...L) - Math.min(...L) > 0.75 && dark) return 'Tip: rainbow swirls look softest in pastels; save dark colors for contrast boxes.';
    return '';
  }
  function partEditor(k, title) {
    const part = state[k];
    return `<fieldset class="bd-group"><legend>${title} · piping style</legend>
        <div class="bd-cards cd-styles" role="radiogroup">${(options().style || []).map((o) => `<button type="button" role="radio" class="bd-card" data-cd-style="${k}" data-value="${o.code}" aria-checked="${part.style === o.code}">
          <span class="cd-style-pic" aria-hidden="true">${miniPic(o.code, part.colors)}</span><strong>${esc(o.label)}</strong><small>${STYLE_NOTE[o.code] || ''}${Number(o.price) ? ' · +' + money(o.price) : ' · free'}</small></button>`).join('')}</div>
        ${state.size === 'mini' ? '<p class="bd-note">Luxe and floral styles are piped on our 3oz cupcakes.</p>' : ''}
      </fieldset>
      <fieldset class="bd-group"><legend>${title} · colors</legend>${colorPicker(k)}</fieldset>`;
  }
  function miniPic(style, colors) {
    const pal = palette(), hex = colors.map((c) => pal[c] || '#fff');
    const want = RULE[style][0], cols = [...hex]; const fill = ['#F4B6C8', '#FFFFFF', '#BFDDF4', '#CDB8E8', '#F9E27D'];
    while (cols.length < Math.max(want, style === 'floral' ? 3 : 1)) cols.push(fill[cols.length % fill.length]);
    uid += 100;
    return `<svg viewBox="0 0 100 100">${cupcake({ style, colors: style === 'rosette' ? [cols[0]] : style === 'two_tone' || style === 'luxe' ? cols.slice(0, 2) : cols.slice(0, style === 'rainbow' ? Math.max(3, Math.min(5, cols.length)) : 3), sub: style === 'floral' ? 'ruffle' : undefined }, state.flavor, [], 'none', 3)}</svg>`;
  }
  function bodyMarkup() {
    const s = state;
    if (step === 'box') return `
      <fieldset class="bd-group"><legend>Start from one of our boxes <small>Optional · all editable</small></legend>
        <div class="cd-presets">${PRESETS.filter((p) => products[p.size]).map((p) => `<button type="button" class="cd-preset" data-cd-preset="${p.key}"><span class="cd-preset-pic" aria-hidden="true">${presetPic(p)}</span><strong>${esc(p.name)}</strong><small>${p.size === 'mini' ? 'Mini' : '3oz'}</small></button>`).join('')}</div>
      </fieldset>
      <fieldset class="bd-group"><legend>Cupcake size</legend>
        <div class="bd-cards" role="radiogroup">${Object.keys(products).map((size) => `<button type="button" role="radio" class="bd-card" data-cd-size="${size}" aria-checked="${s.size === size}"><strong>${size === 'mini' ? 'Mini cupcakes' : '3oz cupcakes'}</strong><small>${size === 'mini' ? 'Bite-size · rosette, two-tone, rainbow' : 'Full size · all styles incl. luxe & floral'}</small></button>`).join('')}</div>
      </fieldset>
      <fieldset class="bd-group"><legend>Box size</legend>
        <div class="bd-chips" role="radiogroup">${product().product_variants.filter((v) => v.is_active).map((v) => `<button type="button" role="radio" class="bd-chip" data-cd-variant="${v.id}" aria-checked="${s.variant_id === v.id}">${esc(v.label)} · ${money(v.price)}</button>`).join('')}</div>
      </fieldset>
      <fieldset class="bd-group"><legend>Flavor <small>Same price</small></legend>
        <div class="bd-cards" role="radiogroup">${(options().flavor || []).map((o) => `<button type="button" role="radio" class="bd-card" data-cd-set="flavor" data-value="${o.code}" aria-checked="${s.flavor === o.code}"><strong>${esc(o.label)}</strong><small>${o.code === 'chocolate' ? 'Dark cake, black liners' : 'Golden cake, white liners'}${Number(o.price) > 0 ? ' · +' + money(o.price) : ''}</small></button>`).join('')}</div>
      </fieldset>`;
    if (step === 'design') return `
      <fieldset class="bd-group"><legend>How is the box arranged?</legend>
        <div class="bd-cards cd-patterns" role="radiogroup">${(options().pattern || []).map((o) => `<button type="button" role="radio" class="bd-card" data-cd-set="pattern" data-value="${o.code}" aria-checked="${s.pattern === o.code}"><strong>${esc(o.label)}</strong><small>${{ same: 'Every cupcake alike', alternate: 'Two designs, checkerboard', assorted: 'We mix your palette across the box' }[o.code] || ''}${Number(o.price) ? ' · +' + money(o.price) : ' · free'}</small></button>`).join('')}</div>
      </fieldset>
      ${partEditor('a', s.pattern === 'alternate' ? 'Design A' : s.pattern === 'assorted' ? 'Your palette' : 'Design')}
      ${s.pattern === 'alternate' ? partEditor('b', 'Design B') : ''}`;
    if (step === 'finish') return `
      <fieldset class="bd-group"><legend>Finishing touches</legend>
        <div class="bd-chips" role="group">${(options().finish || []).map((o) => `<button type="button" class="bd-chip" data-cd-finish="${o.code}" aria-pressed="${s.finishes.includes(o.code)}">${esc(o.label)}${Number(o.price) ? ' <small>+' + money(o.price) + '</small>' : ''}</button>`).join('')}</div>
        <p class="bd-note">Pick gold or silver pearls, not both.</p>
      </fieldset>
      <fieldset class="bd-group"><legend>Theme toppers <small>Handmade fondant</small></legend>
        <div class="cd-themes" role="radiogroup">${(options().theme || []).map((o) => `<button type="button" role="radio" class="cd-theme" data-cd-set="theme" data-value="${o.code}" aria-checked="${s.theme === o.code}"><span aria-hidden="true">${THEME_ICON[o.code] || '✨'}</span><strong>${esc(o.label)}</strong>${Number(o.price) ? `<small>+${money(o.price)}</small>` : '<small>free</small>'}</button>`).join('')}</div>
        ${s.theme !== 'none' ? `<label class="bd-label" for="cd-theme-note" style="margin-top:12px">${s.theme === 'custom' ? 'Your theme' : 'Anything to add?'} <small>${s.theme === 'custom' ? 'Required · ' : 'Optional · '}up to 60 characters</small></label>
          <input id="cd-theme-note" class="bd-input" maxlength="60" data-cd-note-input value="${esc(s.theme_note)}" placeholder="${s.theme === 'custom' ? 'e.g. Sonic and friends' : 'e.g. favorite colors, a name'}">` : ''}
      </fieldset>`;
    const v = variant(), ex = quote.status === 'ok' ? (quote.clean.extras || []).map((e) => [e.label, Number(e.price)]) : [];
    const partText = (p) => `${esc(opt('style', p.style)?.label)} — ${p.colors.map((c) => esc(opt('color', c)?.label)).join(', ')}`;
    return `
      <ul class="bd-summary" aria-label="Your design">
        <li><span>Box</span><strong>${esc(product().name)} · ${esc(v?.label)} ${money(v?.price || 0)}</strong></li>
        <li><span>Flavor</span><strong>${esc(opt('flavor', s.flavor)?.label)}</strong></li>
        <li><span>Arrangement</span><strong>${esc(opt('pattern', s.pattern)?.label)}</strong></li>
        <li><span>${s.pattern === 'alternate' ? 'Design A' : 'Design'}</span><strong>${partText(s.a)}</strong></li>
        ${s.pattern === 'alternate' ? `<li><span>Design B</span><strong>${partText(s.b)}</strong></li>` : ''}
        <li><span>Finishing</span><strong>${s.finishes.map((f) => esc(opt('finish', f)?.label)).join(', ') || 'None'}</strong></li>
        <li><span>Theme</span><strong>${esc(opt('theme', s.theme)?.label)}${s.theme_note && s.theme !== 'none' ? ': ' + esc(s.theme_note) : ''}</strong></li>
        ${ex.map(([l, p]) => `<li><span>${esc(l)}</span><strong>+${money(p)}</strong></li>`).join('')}
      </ul>
      ${quote.status === 'error' ? `<div class="bd-warning" role="alert">${esc(quote.message)}</div>` : ''}
      <div class="cd-qty-row"><span class="bd-label" style="margin:0" id="cd-qty-label">Boxes</span>
        <div class="bd-qty" role="group" aria-labelledby="cd-qty-label"><button type="button" data-cd-qty="-1" aria-label="One box less">−</button><output aria-live="polite">${s.qty}</output><button type="button" data-cd-qty="1" aria-label="One box more">+</button></div></div>`;
  }
  function presetPic(p) { const pal = palette(); const a = p.s.a; uid += 100;
    return `<svg viewBox="0 0 100 100">${cupcake({ style: products[p.size] && optionsBy[p.size]?.style?.some((o) => o.code === a.style) ? a.style : 'rosette', colors: a.colors.map((c) => optionsBy[p.size]?.color?.find((o) => o.code === c)?.hex || pal[c] || '#fff'), sub: 'hydrangea' }, p.s.flavor || 'chocolate', p.s.finishes, p.s.theme || 'none', 5)}</svg>`; }

  // ---- render ------------------------------------------------------------------------------------------
  function renderBody() {
    root.querySelectorAll('.bd-steps [data-cd-step]').forEach((b, i) => {
      const k = b.dataset.cdStep, on = k === step, done = visited.has(k) && !on && k !== 'review';
      b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; b.classList.toggle('is-done', done); b.querySelector('b').textContent = done ? '✓' : String(i + 1);
    });
    const body = root.querySelector('#cd-body'), keep = document.activeElement?.closest?.('#cd-body') ? document.activeElement : null;
    const sel = keep ? Object.entries(keep.dataset).map(([k, v]) => `[data-${k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}="${CSS.escape(v)}"]`).join('') : '';
    const caret = keep?.selectionStart;
    body.innerHTML = bodyMarkup(); updateFooter(); updateTools();
    if (sel) { const again = body.querySelector(sel); if (again) { again.focus({ preventScroll: true }); if (caret != null && again.setSelectionRange) again.setSelectionRange(caret, caret); } }
  }
  function renderPreview() {
    if (scene) {
      // Several quick changes (e.g. undo/redo) rebuild the 3D box once per frame.
      if (!previewFrame) previewFrame = requestAnimationFrame(() => { previewFrame = 0; if (!scene) return; scene.update(sceneSpec()); scene.canvas.setAttribute('aria-label', 'Your cupcake box in 3D. ' + summaryText()); });
      return;
    }
    const box = root.querySelector('[data-cd-box]'); if (box) { box.innerHTML = boxSvg(); box.firstElementChild?.setAttribute('aria-label', 'Your cupcake box. ' + summaryText()); }
  }
  function sceneSpec() {
    const pal = palette(), hex = (code) => pal[code] || '#ffffff', count = countOf(variant()?.label), [cols, rows] = grid(count), cells = [];
    for (let i = 0, r = 0; r < rows; r++) for (let c = 0; c < cols && i < count; c++, i++) { const sp = specFor(i, r, c); cells.push({ style: sp.style, colors: sp.colors.map(hex), sub: sp.style === 'floral' ? sp.sub : '' }); }
    return { size: state.size, cols, rows, flavor: state.flavor, finishes: state.finishes, theme: state.theme, themeIcon: THEME_ICON[state.theme], cells };
  }
  // The realistic 3D box (three.js) loads on demand; without WebGL the flat picture stays.
  function ensureScene() {
    if (scene || sceneLoading) return sceneLoading;
    const host = root.querySelector('[data-cd-3d]');
    sceneLoading = (async () => {
      try {
        const mod = await import('./cupcake-scene.js?v=17');
        if (currentPage !== 'cupcake' || scene) return;
        host.hidden = false;
        scene = mod.createCupcakeScene(host, { reducedMotion });
        root.querySelector('[data-cd-box]').hidden = true; root.querySelector('[data-cd-bar]').hidden = false;
        root.querySelector('[data-cd-hint]').textContent = 'Drag to turn the box, scroll or pinch to zoom. Handmade piping varies a little from box to box.';
        root.querySelectorAll('[data-cd-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cdView === 'angle')));
        root.querySelectorAll('[data-cd-scene]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cdScene === 'studio')));
        renderPreview();
      } catch (error) {
        console.info('3D preview unavailable, showing the flat picture:', error?.message || error);
        disposeScene(); host.hidden = true; root.querySelector('[data-cd-box]').hidden = false; renderPreview();
      } finally { sceneLoading = null; }
    })();
    return sceneLoading;
  }
  function disposeScene() {
    cancelAnimationFrame(previewFrame); previewFrame = 0;
    try { scene?.dispose(); } catch {}
    scene = null;
    if (root) { root.querySelector('[data-cd-3d]').hidden = true; root.querySelector('[data-cd-bar]').hidden = true; root.querySelector('[data-cd-box]').hidden = false; }
  }
  function summaryText() { return quote.status === 'ok' ? quote.clean.summary : `${opt('flavor', state.flavor)?.label} · ${opt('style', state.a.style)?.label}`; }
  function updateFooter() {
    if (!root) return;
    const idx = STEPS.findIndex(([k]) => k === step), total = unitPrice() * state.qty;
    root.querySelector('[data-cd-price]').textContent = money(total);
    const note = root.querySelector('[data-cd-note]');
    note.classList.toggle('is-error', quote.status === 'error');
    note.textContent = quote.status === 'error' ? quote.message : `${state.qty} × ${money(unitPrice())} · ${quote.status === 'ok' ? 'price confirmed' : 'checking price…'}`;
    root.querySelector('[data-cd-prev]').hidden = idx === 0;
    const next = root.querySelector('[data-cd-next]');
    if (idx < STEPS.length - 1) { next.textContent = 'Next'; next.disabled = false; }
    else { next.textContent = editIndex !== null ? 'Update cart' : 'Add to cart'; next.disabled = quote.status !== 'ok' || !variant(); }
  }
  function updateTools() { if (!root) return; root.querySelector('[data-cd-undo]').disabled = !past.length; root.querySelector('[data-cd-redo]').disabled = !future.length; }
  function goStep(k) {
    if (step && step !== k) visited.add(step);
    step = k; renderBody(); saveDraft();
    root.querySelector('#cd-body').focus({ preventScroll: true });
    if (matchMedia('(max-width: 900px)').matches) root.querySelector('.bd-panel').scrollIntoView({ block: 'start', behavior: reducedMotion ? 'auto' : 'smooth' });
  }

  // ---- events --------------------------------------------------------------------------------------------
  function toggleColor(k, code) {
    commit((s) => {
      const part = s[k], assorted = s.pattern === 'assorted' && k === 'a', [, hi] = assorted ? [2, 16] : RULE[part.style];
      const i = part.colors.indexOf(code);
      if (i >= 0) { if (part.colors.length > 1) part.colors.splice(i, 1); return; }
      if (hi === 1) { part.colors = [code]; return; }
      if (part.colors.length >= hi) part.colors.shift();
      part.colors.push(code);
    });
  }
  function applyPreset(key) {
    const p = PRESETS.find((x) => x.key === key); if (!p) return;
    const switched = p.size !== state.size;
    commit((s) => { const keepQty = s.qty; Object.assign(s, blank(p.size), JSON.parse(JSON.stringify(p.s)), { qty: keepQty }); if (!s.b) s.b = { style: 'rosette', colors: ['white'] }; });
    showToast(`Started from “${p.name}”${switched ? ` on ${p.size === 'mini' ? 'mini' : '3oz'} cupcakes` : ''} — change anything you like.`);
  }
  function bind() {
    root.addEventListener('click', (e) => {
      const t = e.target.closest('button'); if (!t || t.disabled) return;
      const d = t.dataset;
      if ('cdViewcart' in d) { navigate('shop'); return openCart(); }
      if ('cdAgain' in d) return designAnother();
      if (packed && !d.cdView && !d.cdScene && !('cdExit' in d)) return;
      if (d.cdStep) return goStep(d.cdStep);
      if (d.cdView) { root.querySelectorAll('[data-cd-view]').forEach((b) => b.setAttribute('aria-pressed', String(b === t))); return scene?.setView(d.cdView); }
      if (d.cdScene) { root.querySelectorAll('[data-cd-scene]').forEach((b) => b.setAttribute('aria-pressed', String(b === t))); t.disabled = true;
        return scene?.setScene(d.cdScene).then((shown) => { t.disabled = false; if (shown !== d.cdScene) { showToast('That scene could not load, so the studio is shown.'); root.querySelectorAll('[data-cd-scene]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cdScene === shown))); } }); }
      if (d.cdPreset) return applyPreset(d.cdPreset);
      if (d.cdSize) return commit((s) => { if (s.size !== d.cdSize) { s.size = d.cdSize; s.variant_id = null; } });
      if (d.cdVariant) return commit((s) => { s.variant_id = d.cdVariant; });
      if (d.cdSet) return commit((s) => { s[d.cdSet] = d.value; });
      if (d.cdStyle) return commit((s) => { s[d.cdStyle].style = d.value; });
      if (d.cdColor) return toggleColor(d.cdColor, d.value);
      if (d.cdFinish) return commit((s) => { const f = d.cdFinish, set = new Set(s.finishes); if (set.has(f)) set.delete(f); else { set.add(f); if (f === 'gold_pearls') set.delete('silver_pearls'); if (f === 'silver_pearls') set.delete('gold_pearls'); } s.finishes = [...set]; });
      if (d.cdQty) return commit((s) => { s.qty += Number(d.cdQty); }, { soft: true });
      if ('cdUndo' in d) return undo();
      if ('cdRedo' in d) return redo();
      if ('cdReset' in d) { commit((s) => Object.assign(s, blank(s.size))); return showToast('Started over. Tap Undo to bring your design back.'); }
      if ('cdExit' in d) return navigate('shop');
      if ('cdPrev' in d) { const i = STEPS.findIndex(([k]) => k === step); return goStep(STEPS[Math.max(0, i - 1)][0]); }
      if ('cdNext' in d) { const i = STEPS.findIndex(([k]) => k === step); return i < STEPS.length - 1 ? goStep(STEPS[i + 1][0]) : addToCart(); }
    });
    root.addEventListener('input', (e) => {
      if (!e.target.matches('[data-cd-note-input]')) return;
      state.theme_note = e.target.value.slice(0, 60); saveDraft(); scheduleQuote();
    });
    root.addEventListener('keydown', (e) => {
      const tab = e.target.closest('.bd-steps [data-cd-step]'); if (!tab || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      e.preventDefault(); const i = STEPS.findIndex(([k]) => k === step), n = STEPS[(i + (e.key === 'ArrowRight' ? 1 : -1) + STEPS.length) % STEPS.length][0];
      goStep(n); root.querySelector(`.bd-steps [data-cd-step="${n}"]`).focus();
    });
  }

  // ---- cart -------------------------------------------------------------------------------------------------
  async function addToCart() {
    if (quote.status !== 'ok') return;
    const v = variant(), d = design(), p = product();
    const item = { id: 'cupcake-' + crypto.randomUUID(), product_id: p.id, variant_id: v.id, name: p.name, emoji: '🧁',
      sizeLabel: `${v.label} · ${quote.clean.summary}`, price: Number(v.price) + quote.extra, base_price: Number(v.price), extras: quote.extra,
      qty: state.qty, selected: true, customization: d, preview: scene ? scene.snapshot(480) : await snapshot(400) };
    const wasEdit = editIndex !== null && cart[editIndex]?.customization?.designer === 'cupcake';
    if (wasEdit) { item.id = cart[editIndex].id; cart[editIndex] = item; } else cart.push(item);
    editIndex = null; try { localStorage.removeItem(DRAFT_KEY); } catch {}
    renderCart();
    if (!scene) { showToast(wasEdit ? 'Your cupcake design was updated.' : 'Your cupcakes were added to the cart.'); navigate('shop'); return openCart(); }
    // Like the bento: the box is closed and sealed on screen, then a finish panel offers the cart or a new design.
    packed = true; root.classList.add('is-packing');
    const unit = item.price, summary = esc(quote.clean.summary || ''), body = root.querySelector('#cd-body');
    body.innerHTML = `<div class="bd-packed" role="status"><span class="bd-packed-icon" aria-hidden="true">📦</span><h2>Packing your cupcakes…</h2><p class="bd-note">${summary}</p></div>`;
    root.querySelector('[data-cd-view="angle"]')?.click();
    if (matchMedia('(max-width: 900px)').matches) root.querySelector('.bd-stage').scrollIntoView({ block: 'start', behavior: reducedMotion ? 'auto' : 'smooth' });
    try { await scene.pack(); } catch (error) { console.info('Packing animation skipped:', error?.message || error); }
    if (!packed || currentPage !== 'cupcake') return;
    body.innerHTML = `<div class="bd-packed" role="status"><span class="bd-packed-icon" aria-hidden="true">🎉</span>
      <h2>${wasEdit ? 'Your cart design was updated' : 'Boxed and added to your cart!'}</h2>
      <p class="bd-note">${summary}</p>
      <p class="bd-packed-price">${item.qty} × ${money(unit)} = <b>${money(unit * item.qty)}</b></p>
      <div class="bd-packed-actions"><button type="button" class="bd-primary" data-cd-viewcart>View cart</button><button type="button" class="bd-secondary" data-cd-again>Design another</button></div></div>`;
    body.querySelector('[data-cd-viewcart]').focus({ preventScroll: true });
  }
  function designAnother() {
    packed = false; root.classList.remove('is-packing'); scene?.unpack();
    past = []; future = []; editIndex = null; visited.clear(); step = 'box';
    state = blank(state.size); normalise(); renderBody(); renderPreview(); scheduleQuote(); updateTools();
  }

  // ---- open / leave -------------------------------------------------------------------------------------------
  function ensureRoot() { root = document.getElementById('page-cupcake'); if (!root.dataset.bound) { root.dataset.bound = '1'; shell(); bind(); } }
  async function start({ fromCart = null, shared = null, size = null } = {}) {
    ensureRoot();
    root.querySelector('#cd-body').innerHTML = '<div class="skel skel-title" style="margin:8px 0 16px"></div><div class="skel skel-line"></div><div class="skel skel-line skel-line--long" style="margin-top:10px"></div>';
    try { await loadAll(); }
    catch (error) {
      console.warn('Cupcake designer could not load:', error);
      root.querySelector('#cd-body').innerHTML = '<div role="alert"><p><strong>The cupcake designer could not load.</strong></p><p class="bd-note">Check your connection and try again.</p><button type="button" class="bd-secondary" data-cd-retry>Try again</button></div>';
      root.querySelector('[data-cd-retry]').onclick = () => start({ fromCart, shared, size });
      return;
    }
    past = []; future = []; editIndex = null; visited.clear(); step = 'box';
    packed = false; root.classList.remove('is-packing'); scene?.unpack();
    const sizeOf = (variantId) => Object.entries(products).find(([, p]) => p.product_variants.some((v) => v.id === variantId))?.[0];
    if (fromCart !== null && cart[fromCart]?.customization?.designer === 'cupcake') {
      const c = cart[fromCart], sz = sizeOf(c.variant_id) || 'mini'; editIndex = fromCart;
      state = { ...blank(sz), ...JSON.parse(JSON.stringify(c.customization)), size: sz, variant_id: c.variant_id, qty: c.qty }; step = 'review';
    } else if (shared) {
      const sz = sizeOf(shared.v) || 'mini';
      state = { ...blank(sz), ...shared.d, size: sz, variant_id: shared.v, qty: 1 }; step = 'review';
      showToast('Opened a shared cupcake design — change anything you like.');
    } else {
      let draft = null; try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch {}
      if (draft?.state && !size) { state = { ...blank(draft.state.size || 'mini'), ...draft.state }; step = STEPS.some(([k]) => k === draft.step) ? draft.step : 'box'; showToast('Your saved cupcake design was restored.'); }
      else state = blank(size && products[size] ? size : Object.keys(products)[0]);
    }
    if (!state.b) state.b = { style: 'rosette', colors: ['white'] };
    normalise(); renderBody(); renderPreview(); scheduleQuote(); ensureScene();
  }
  function whenReady(fn) {
    if (window.lexcCatalogState === 'ready') return fn();
    let waited = 0; const t = setInterval(() => { waited += 200; if (window.lexcCatalogState === 'ready') { clearInterval(t); fn(); } else if (waited > 15000) { clearInterval(t); showToast('The menu could not load. Please try again.'); } }, 200);
  }
  const fromB64 = (code) => new TextDecoder().decode(Uint8Array.from(atob(code.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));
  function decodeShared(code) { try { const o = JSON.parse(fromB64(code)); return o && o.d && typeof o.d === 'object' ? o : null; } catch { return null; } }

  window.LexcCupcake = Object.freeze({
    open({ productId = null, shared = null } = {}) {
      whenReady(() => {
        const size = productId ? Object.entries(SLUGS).find(([, slug]) => (liveCatalog.find((p) => p.id === productId) || {}).slug === slug)?.[0] : null;
        navigate('cupcake'); start({ shared, size });
      });
    },
    edit(index) { window.closeCart?.(); whenReady(() => { navigate('cupcake'); start({ fromCart: index }); }); },
    isDesignable: (productId) => (typeof liveCatalog !== 'undefined' ? liveCatalog : []).some((p) => p.id === productId && p.customization_config?.designer === 'cupcake')
  });

  // "Custom": choose what to design (bento cake, cupcakes or mini donuts).
  let chooser = null;
  window.LexcCustom = Object.freeze({
    choose() {
      if (!chooser) {
        chooser = document.createElement('dialog'); chooser.className = 'cd-chooser'; chooser.setAttribute('aria-labelledby', 'cd-chooser-title');
        chooser.innerHTML = `<div class="cd-chooser-head"><h2 id="cd-chooser-title">What would you like to design?</h2><button type="button" class="bd-tool" data-close aria-label="Close">×</button></div>
          <div class="cd-chooser-grid">
            <button type="button" data-pick="bento"><span aria-hidden="true">🎂</span><strong>Bento cake</strong><small>Colors, borders, decorations and your message, in 3D</small></button>
            <button type="button" data-pick="cupcake"><span aria-hidden="true">🧁</span><strong>Cupcakes</strong><small>Mini or 3oz · piping styles, palettes and theme toppers</small></button>
            <button type="button" data-pick="donut"><span aria-hidden="true">🍩</span><strong>Mini donuts</strong><small>Glazes, sprinkles, fondant toppers and letters</small></button>
            <button type="button" data-pick="cakepop"><span aria-hidden="true">🍭</span><strong>Cake pops</strong><small>Round or donut pops: coatings, sprinkles and fondant toppers</small></button>
          </div>`;
        chooser.addEventListener('click', (e) => {
          if (e.target === chooser || e.target.closest('[data-close]')) return chooser.close();
          const pick = e.target.closest('[data-pick]')?.dataset.pick; if (!pick) return;
          chooser.close(); if (pick === 'bento') window.LexcBento?.open(); else if (pick === 'donut') window.LexcDonut?.open(); else if (pick === 'cakepop') window.LexcCakePop?.open(); else window.LexcCupcake.open();
        });
        document.body.append(chooser);
      }
      window.closeCustomerMoreMenu?.(); chooser.showModal(); chooser.querySelector('[data-pick]').focus();
    }
  });

  const baseNavigate = window.navigate;
  window.navigate = function navigate(page, anchor) {
    if (currentPage === 'cupcake' && page !== 'cupcake') { clearTimeout(quoteTimer); quoteSeq++; disposeScene(); }
    const r = baseNavigate.call(this, page, anchor);
    if (page === 'cupcake') document.querySelectorAll('#mainNav .nav-links a[data-page="bento"]').forEach((a) => a.classList.add('active'));
    return r;
  };
  const params = new URL(location.href).searchParams;
  if (params.has('cupcake')) {
    const u = new URL(location.href), code = u.searchParams.get('cupcake'); u.searchParams.delete('cupcake'); history.replaceState(history.state, '', u);
    const shared = code && code !== '1' ? decodeShared(code) : null;
    if (code && code !== '1' && !shared) showToast('That design link is incomplete, so a new design was started.');
    window.LexcCupcake.open({ shared });
  }
})();
