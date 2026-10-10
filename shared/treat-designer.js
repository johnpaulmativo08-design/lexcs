// Treat designers (customer) for mini donuts and cake pops: the same decorating steps, set up per product by a
// config. Donuts: Party Box and Themed Party Box (same donuts, same choices). Cake pops: round cake pops or mini
// donut pops on sticks (no message step for pops). Mirrors how LexC's decorates: flavour(s) ->
// glaze or coating (one colour, two alternating, or assorted) and finishes -> sprinkles and fondant theme toppers ->
// fondant letters spelled across the box or name plaques. Realistic 3D box (cupcake-scene.js, donut/cakepop mode).
// Options and prices come from public.design_options; the server re-validates and prices every design
// (quote_donut_design / quote_cakepop_design / create_order). Adds to the existing cart; never creates an order.
function makeTreatDesigner(K) {
  const STEPS = [['box', 'Box'], ['glaze', K.coat], ['toppings', 'Toppings'], ['message', 'Message'], ['review', 'Review']].filter(([k]) => k !== 'message' || K.message !== false);
  const DRAFT_KEY = K.draftKey;
  const SLUGS = K.slugs;
  const BOX_NOTE = K.boxNote || {}, NOUN = K.noun, COAT = K.coat.toLowerCase();
  const FLAVOR_NOTE = { vanilla: 'Golden, buttery', chocolate: 'Rich cocoa', ube: 'Purple yam', strawberry: 'Pink, fruity' };
  const THEME_ICON = { none: '—', space: '🪐', butterfly: '🦋', garden: '🌼', bees: '🐝', rainbow: '🌈', fairy: '🍄', construction: '🚧', baby: '🍼', bows: '🎀', custom: '✨' };
  const PATTERN_NOTE = { same: `Every ${NOUN} the same ${COAT}`, alternate: `Two ${COAT}s in a checkerboard`, assorted: `We spread your ${COAT}s across the box` };
  const SPRINKLE_NOTE = { none: `Just the ${COAT}`, white_pearls: 'Tiny white sugar pearls', nonpareils: 'Pick 1–3 colours', gold_pearls: 'Shiny gold pearls' };
  const MESSAGE_NOTE = { none: 'Toppers only', letters: `1–5 letters on each ${NOUN}, you choose which`, plaque: 'A name or number on round plaques' };
  const COLOR_GROUPS = [
    ['Pastels', ['white', 'ivory', 'cream', 'butter', 'peach', 'blush', 'baby_pink', 'lavender', 'lilac', 'baby_blue', 'mint', 'aqua']],
    ['Brights', ['lemon', 'orange', 'lime', 'coral', 'pink', 'hot_pink', 'red', 'purple', 'periwinkle', 'sky_blue', 'azure', 'leaf_green', 'sage']],
    ['Deep', ['deep_rose', 'burgundy', 'denim', 'navy', 'chocolate', 'black']]
  ];
  const LETTER_MAX = { letters: 40, plaque: 14 }, LETTER_OK = /[^A-Za-z0-9 !?&'.,♥-]/g;
  const PRESETS = K.presets;
  const esc = (v) => authEscape(String(v ?? ''));
  const money = (v) => checkoutMoney(v).replace('.00', '');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let root = null, products = {}, optionsBy = {}, state = null, step = 'box', past = [], future = [], editIndex = null;
  let quote = { status: 'idle' }, quoteTimer = 0, quoteSeq = 0, visited = new Set(), scene = null, sceneLoading = null, previewFrame = 0, packed = false;
  const product = () => products[state.box];
  const options = () => optionsBy[state.box] || {};
  const palette = () => Object.fromEntries((options().color || []).map((c) => [c.code, c.hex]));
  const opt = (group, code) => (options()[group] || []).find((o) => o.code === code);
  const variant = () => product()?.product_variants.find((v) => v.id === state.variant_id && v.is_active);
  const countOf = (label) => Number(String(label).match(/(\d+)\s*pcs/i)?.[1]) || Number(String(label).match(/\d+/)?.[0]) || 25;
  const flavorsList = () => (options().flavor || []).filter((o) => o.code !== 'mix');

  function blank(box = 'party') {
    const p = products[box];
    return { box, variant_id: p?.product_variants.filter((v) => v.is_active)[0]?.id, qty: 1, flavors: [K.defaultFlavor], pattern: 'same', glazes: ['pink'], ...(K.styles ? { style: 'round' } : {}),
      finishes: [], sprinkles: 'white_pearls', sprinkle_colors: [], theme: 'none', theme_note: '', message: 'none', message_text: '', message_pieces: [], message_color: 'white', inspiration: [] };
  }
  const design = () => ({ designer: K.designer, ...(K.styles ? { style: state.style } : {}), flavors: [...state.flavors], pattern: state.pattern, glazes: [...state.glazes], finishes: [...state.finishes],
    sprinkles: state.sprinkles, ...(state.sprinkles === 'nonpareils' ? { sprinkle_colors: [...state.sprinkle_colors] } : {}),
    theme: state.theme, ...(state.theme !== 'none' && state.theme_note.trim() ? { theme_note: state.theme_note.trim() } : {}),
    message: state.message, ...(state.message === 'letters' ? { message_pieces: LexcLetterPieces.fit(state.message_pieces, countOf(variant()?.label)), message_text: piecesText(), message_color: state.message_color }
      : state.message !== 'none' ? { message_text: state.message_text.trim(), message_color: state.message_color } : {}) });
  // which donut the customer is typing letters for (not part of the design)
  let pieceAt = 0;
  const piecesText = () => (state.message_pieces || []).filter(Boolean).join(' · ');

  // ---- data ---------------------------------------------------------------------------------------
  async function loadAll() {
    const catalog = typeof liveCatalog !== 'undefined' ? liveCatalog : [];
    products = {};
    for (const [box, slug] of Object.entries(SLUGS)) { const p = catalog.find((x) => x.slug === slug && x.customization_config?.designer === K.designer); if (p) products[box] = p; }
    if (!Object.keys(products).length) throw new Error(K.title + ' unavailable');
    const ids = Object.values(products).map((p) => p.id);
    const rows = LexcBackend.unwrap(await LexcBackend.client.from('design_options').select('product_id,group_key,code,label,price,hex,sort_order').in('product_id', ids).order('sort_order'));
    optionsBy = {};
    for (const [box, p] of Object.entries(products)) { const o = {}; rows.filter((r) => r.product_id === p.id && !(r.group_key === 'theme' && r.code === 'custom')).forEach((r) => (o[r.group_key] ||= []).push(r)); optionsBy[box] = o; }
  }

  // ---- state, history, draft -----------------------------------------------------------------------
  const snap = () => JSON.stringify(state);
  function normalise() {
    if (!products[state.box]) state.box = Object.keys(products)[0];
    if (!variant()) state.variant_id = product().product_variants.find((v) => v.is_active)?.id;
    state.qty = Math.min(20, Math.max(1, Number(state.qty) || 1));
    const flav = new Set(flavorsList().map((o) => o.code));
    state.flavors = [...new Set(state.flavors)].filter((f) => flav.has(f)).slice(0, K.maxFlavors); if (!state.flavors.length) state.flavors = [flavorsList()[0]?.code || 'vanilla'];
    if (K.styles && !opt('style', state.style)) state.style = 'round';
    if (!opt('pattern', state.pattern)) state.pattern = 'same';
    const pal = palette(), [lo, hi] = { same: [1, 1], alternate: [2, 2] }[state.pattern] || [2, 16];
    state.glazes = [...new Set(state.glazes)].filter((c) => pal[c]).slice(-hi);
    for (const c of ['pink', 'purple', 'white', 'sky_blue', 'lemon', 'mint']) if (state.glazes.length < lo && pal[c] && !state.glazes.includes(c)) state.glazes.push(c);
    state.finishes = [...new Set(state.finishes)].filter((f) => opt('finish', f)).slice(-3);
    if (state.finishes.includes('choco_drizzle') && state.finishes.includes('white_drizzle')) state.finishes = state.finishes.filter((f) => f !== 'choco_drizzle');
    if (!opt('sprinkle', state.sprinkles)) state.sprinkles = 'white_pearls';
    state.sprinkle_colors = state.sprinkles === 'nonpareils' ? [...new Set(state.sprinkle_colors)].filter((c) => pal[c]).slice(-3) : [];
    if (state.sprinkles === 'nonpareils' && !state.sprinkle_colors.length) state.sprinkle_colors = ['white'];
    if (!opt('theme', state.theme)) state.theme = 'none';
    state.theme_note = String(state.theme_note || '').slice(0, 60);
    if (K.message === false || !opt('message', state.message)) state.message = 'none';
    if (state.message === 'letters') {
      // older designs spelled one sentence across the box: keep it as per-donut letters
      if (!LexcLetterPieces.filled(state.message_pieces) && String(state.message_text || '').trim()) state.message_pieces = LexcLetterPieces.fromSentence(state.message_text);
      state.message_pieces = LexcLetterPieces.fit(state.message_pieces, countOf(variant()?.label));
      pieceAt = Math.min(pieceAt, state.message_pieces.length - 1);
    } else state.message_text = String(state.message_text || '').replace(LETTER_OK, '').slice(0, LETTER_MAX[state.message] || 40);
    if (!pal[state.message_color]) state.message_color = 'white';
  }
  function commit(mutator, { soft = false } = {}) {
    const before = snap(); mutator(state); normalise();
    if (snap() === before) return;
    if (!soft) { past.push(before); if (past.length > 60) past.shift(); future = []; }
    afterChange();
  }
  function afterChange(rerender = true) { saveDraft(); renderPreview(); scheduleQuote(); updateFooter(); updateTools(); if (rerender) renderBody(); }
  function saveDraft() { if (document.documentElement.classList.contains('design-viewer')) return; try { if (editIndex === null) localStorage.setItem(DRAFT_KEY, JSON.stringify({ state, step })); } catch {} }
  function undo() { if (!past.length) return; future.push(snap()); state = JSON.parse(past.pop()); normalise(); afterChange(); }
  function redo() { if (!future.length) return; past.push(snap()); state = JSON.parse(future.pop()); normalise(); afterChange(); }

  // ---- pricing (server quote) -------------------------------------------------------------------------
  function localExtra() {
    const p = (g, c) => Number(opt(g, c)?.price || 0);
    let e = p('pattern', state.pattern) + p('sprinkle', state.sprinkles) + p('theme', state.theme) + p('message', state.message);
    if (state.flavors.length > 1) e += p('flavor', 'mix');
    state.finishes.forEach((f) => { e += p('finish', f); });
    return e;
  }
  const unitPrice = () => Number(variant()?.price || 0) + (quote.status === 'ok' ? quote.extra : localExtra());
  function scheduleQuote() { clearTimeout(quoteTimer); quote = { status: 'pending' }; updateFooter(); quoteTimer = setTimeout(runQuote, 300); }
  async function runQuote() {
    const seq = ++quoteSeq;
    try {
      const r = await LexcBackend.rpc(K.quoteFn, { p_product_id: product().id, p_design: design() });
      if (seq !== quoteSeq) return;
      quote = { status: 'ok', extra: Number(r.extra), clean: r.clean };
    } catch (error) { if (seq !== quoteSeq) return; quote = { status: 'error', message: error.message || 'This design cannot be priced right now.' }; }
    updateFooter(); if (step === 'review') renderBody();
  }

  // ---- the box: what goes on each donut ------------------------------------------------------------------
  function grid(count) { const g = { 6: [3, 2], 12: [4, 3], 24: [6, 4], 25: [5, 5], 36: [6, 6], 48: [8, 6] }[count]; if (g) return g; const cols = Math.ceil(Math.sqrt(count * 1.4)); return [cols, Math.ceil(count / cols)]; }
  function cellsFor() {
    const pal = palette(), hex = (c) => pal[c] || '#ffffff', count = countOf(variant()?.label), [cols, rows] = grid(count), out = [];
    const decor = new Array(count).fill(null);
    if (state.message === 'letters') {
      (state.message_pieces || []).slice(0, count).forEach((t, k) => { if (t) decor[k] = { type: 'letters', text: t }; });
    } else if (state.message === 'plaque' && state.message_text.trim()) {
      const n = Math.max(1, Math.min(5, Math.round(count / 10)));
      for (let k = 0; k < n; k++) decor[Math.floor(((k + 0.5) * count) / n)] = { type: 'plaque', text: state.message_text.trim() };
    }
    let motif = 0;
    for (let i = 0, r = 0; r < rows; r++) for (let c = 0; c < cols && i < count; c++, i++) {
      const g = state.pattern === 'same' ? state.glazes[0] : state.pattern === 'alternate' ? state.glazes[(r + c) % 2] : state.glazes[i % state.glazes.length];
      const d = decor[i] || (state.theme !== 'none' ? { type: 'theme', theme: state.theme, variant: motif++ } : null);
      out.push({ flavor: state.flavors[i % state.flavors.length], glaze: hex(g), decor: d });
    }
    return { cols, rows, cells: out };
  }
  function sceneSpec() {
    const pal = palette(), { cols, rows, cells } = cellsFor();
    return { size: K.sceneKind, style: state.style, cols, rows, finishes: state.finishes, sprinkles: state.sprinkles, sprinkleColors: state.sprinkle_colors.map((c) => pal[c] || '#fff'), messageColor: pal[state.message_color] || '#fff', cells };
  }

  // Flat picture (fallback without WebGL, and the small preset pictures).
  const DOUGH = { vanilla: '#d9a65a', chocolate: '#4a2c22', ube: '#8a5aa8', strawberry: '#e3a0b2' };
  function donutSvg(cell, seed, sprinkleHex) {
    let s = `<circle cx="50" cy="50" r="48" fill="#f7f4ee" stroke="#e1d8cb"/><circle cx="50" cy="50" r="40" fill="${DOUGH[cell.flavor] || DOUGH.vanilla}"/><circle cx="50" cy="50" r="37" fill="${cell.glaze}"/>${state.style === 'round' ? '' : `<circle cx="50" cy="50" r="9" fill="${DOUGH[cell.flavor] || DOUGH.vanilla}"/>`}`;
    let x = seed * 9301 + 49297;
    const rnd = () => ((x = (x * 9301 + 49297) % 233280) / 233280);
    if (sprinkleHex.length) for (let i = 0; i < 22; i++) { const a = rnd() * 6.283, r = 13 + rnd() * 22; s += `<circle cx="${(50 + Math.cos(a) * r).toFixed(1)}" cy="${(50 + Math.sin(a) * r).toFixed(1)}" r="1.5" fill="${sprinkleHex[i % sprinkleHex.length]}"/>`; }
    if (cell.decor?.type === 'theme') s += `<text x="50" y="54" font-size="30" text-anchor="middle" dominant-baseline="middle">${THEME_ICON[cell.decor.theme] || '✨'}</text>`;
    if (cell.decor?.type === 'letters' || cell.decor?.type === 'plaque') s += `${cell.decor.type === 'plaque' ? '<circle cx="50" cy="50" r="27" fill="#fff"/>' : ''}<text x="50" y="52" font-size="${cell.decor.text.length > 3 ? 13 : 24}" font-weight="800" text-anchor="middle" dominant-baseline="middle" fill="${palette()[state.message_color] || '#fff'}" stroke="rgba(0,0,0,.18)" stroke-width=".6">${esc(cell.decor.text)}</text>`;
    return s;
  }
  function sprinkleHexes() { const pal = palette(); return state.sprinkles === 'white_pearls' ? ['#ffffff'] : state.sprinkles === 'gold_pearls' ? ['#d4af37'] : state.sprinkles === 'nonpareils' ? state.sprinkle_colors.map((c) => pal[c]) : []; }
  function boxSvg(forImage = false) {
    const { cols, rows, cells } = cellsFor(), cell = 100, pad = 26, W = cols * cell + pad * 2, H = rows * cell + pad * 2, sh = sprinkleHexes();
    let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" ${forImage ? `width="${W * 2}" height="${H * 2}"` : 'role="img"'}><rect x="2" y="2" width="${W - 4}" height="${H - 4}" rx="16" fill="#fff" stroke="#e3dbe9" stroke-width="3"/>`;
    cells.forEach((c, i) => { const r = Math.floor(i / cols), k = i % cols; s += `<g transform="translate(${pad + k * cell} ${pad + r * cell}) scale(.96) translate(2 2)">${donutSvg(c, i + 1, sh)}</g>`; });
    return s + '</svg>';
  }
  async function svgSnapshot(size = 480) {
    try {
      const svg = boxSvg(true), img = new Image(), url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      await new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; img.src = url; });
      const k = size / Math.max(img.width, img.height), cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      const g = cv.getContext('2d'); g.fillStyle = '#fcf6ff'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url);
      return cv.toDataURL('image/jpeg', 0.82);
    } catch { return ''; }
  }
  function presetPic(p) {
    const pal = Object.fromEntries((optionsBy[p.box]?.color || optionsBy.party?.color || []).map((c) => [c.code, c.hex]));
    const sp = p.s.sprinkles === 'nonpareils' ? (p.s.sprinkle_colors || []).map((c) => pal[c]) : p.s.sprinkles === 'none' ? [] : ['#ffffff'];
    return `<svg viewBox="0 0 100 100">${donutSvg({ flavor: (p.s.flavors || ['vanilla'])[0], glaze: pal[p.s.glazes[0]] || '#f4b6c8', decor: p.s.theme ? { type: 'theme', theme: p.s.theme } : null }, 3, sp)}</svg>`;
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
        <button type="button" class="bd-back" data-dd-exit aria-label="Back to the menu">${icon('back')}<span class="bd-back-text">Menu</span></button>
        <h1><span class="cd-h1-long">${K.title}</span><span class="cd-h1-short" aria-hidden="true">${K.shortTitle}</span></h1>
        <div class="bd-tools" role="group" aria-label="Design history">
          <button type="button" class="bd-tool" data-dd-undo aria-label="Undo">${icon('undo')}<span>Undo</span></button>
          <button type="button" class="bd-tool" data-dd-redo aria-label="Redo">${icon('redo')}<span>Redo</span></button>
          <button type="button" class="bd-tool" data-dd-reset aria-label="Start over">${icon('reset')}<span>Reset</span></button>
        </div>
      </header>
      <div class="bd-layout">
        <section class="bd-stage cd-stage" aria-label="Box preview">
          <div class="bd-canvas-box cd-canvas" data-dd-3d hidden></div>
          <div class="cd-box" data-dd-box></div>
          <div class="bd-stage-bar" data-dd-bar hidden>
            <div class="bd-seg" role="group" aria-label="View">${[['angle', 'Box'], ['close', 'Close-up'], ['top', 'Top']].map(([k, l]) => `<button type="button" data-dd-view="${k}" aria-pressed="${k === 'angle'}">${l}</button>`).join('')}</div>
            <div class="bd-seg" role="group" aria-label="Scene">${[['studio', 'Studio'], ['bakery', 'Bakery'], ['party', 'Party']].map(([k, l]) => `<button type="button" data-dd-scene="${k}" aria-pressed="${k === 'studio'}">${l}</button>`).join('')}</div>
          </div>
          <p class="bd-hint" data-dd-hint>Your box seen from above. ${K.hint}</p>
        </section>
        <section class="bd-panel">
          <div class="bd-steps dd-steps" role="tablist" aria-label="Design steps">${STEPS.map(([k, l], i) => `<button type="button" role="tab" class="bd-step" data-dd-step="${k}" aria-controls="${K.key}-body"><b>${i + 1}</b>${l}</button>`).join('')}</div>
          <div class="bd-body" id="${K.key}-body" role="tabpanel" tabindex="-1"></div>
          <div class="bd-foot">
            <div class="bd-price cd-price"><strong data-dd-price>—</strong><span data-dd-note aria-live="polite"></span></div>
            <button type="button" class="bd-secondary" data-dd-prev>Back</button>
            <button type="button" class="bd-primary" data-dd-next>Next</button>
          </div>
        </section>
      </div>
    </div>`;
  }
  function swatches(kind, chosen, numbered = true) {
    const pal = options().color || [], known = new Set(COLOR_GROUPS.flatMap(([, cs]) => cs));
    const groups = COLOR_GROUPS.map(([name, codes]) => [name, codes.map((c) => pal.find((o) => o.code === c)).filter(Boolean)]);
    const extra = pal.filter((c) => !known.has(c.code)); if (extra.length) groups.push(['More', extra]);
    return groups.filter(([, l]) => l.length).map(([name, list]) => `<p class="bd-swatch-group">${name}</p><div class="bd-swatches">${list.map((c) => {
      const i = chosen.indexOf(c.code), on = i >= 0;
      return `<button type="button" class="bd-swatch${on ? ' is-on' : ''}${Number(c.price) > 0 ? ` has-price" data-price="+${money(c.price)}` : ''}" style="background:${c.hex}" data-dd-color="${kind}" data-value="${c.code}" aria-pressed="${on}" aria-label="${esc(c.label)}${Number(c.price) > 0 ? ', +' + money(c.price) : ''}" title="${esc(c.label)}${Number(c.price) > 0 ? ' +' + money(c.price) : ''}">${on && numbered ? `<i class="cd-num">${i + 1}</i>` : ''}</button>`;
    }).join('')}</div>`).join('');
  }
  const chosenChips = (codes) => `<div class="cd-chosen">${codes.map((c, i) => `<span class="cd-chip"><i style="background:${palette()[c]}"></i>${i + 1}. ${esc(opt('color', c)?.label)}</span>`).join('')}</div>`;
  const plus = (o) => (Number(o?.price) ? ' · +' + money(o.price) : ' · free');
  function bodyMarkup() {
    const s = state;
    if (step === 'box') return `
      ${K.styles ? `<fieldset class="bd-group"><legend>Pop</legend>
        <div class="bd-cards" role="radiogroup">${(options().style || []).map((o) => `<button type="button" role="radio" class="bd-card" data-dd-set="style" data-value="${o.code}" aria-checked="${s.style === o.code}"><strong>${esc(o.label)}</strong><small>${K.styleNote[o.code] || ''} · ${Number(o.price) > 0 ? '+' + money(o.price) : (options().style || []).some((x) => Number(x.price) > 0) ? 'no extra' : 'same price'}</small></button>`).join('')}</div>
      </fieldset>` : ''}
      ${Object.keys(products).length < 2 ? '' : `<fieldset class="bd-group"><legend>Box</legend>
        <div class="bd-cards" role="radiogroup">${Object.keys(products).map((b) => `<button type="button" role="radio" class="bd-card" data-dd-box="${b}" aria-checked="${s.box === b}"><strong>${b === 'party' ? 'Party Box' : 'Themed Party Box'}</strong><small>${BOX_NOTE[b]}</small></button>`).join('')}</div>
      </fieldset>`}
      <fieldset class="bd-group"><legend>Flavor <small>Pick one, or mix up to 4${opt('flavor', 'mix') ? ' (' + plus(opt('flavor', 'mix')).slice(3) + ')' : ''}</small></legend>
        <div class="bd-cards dd-flavors" role="group">${flavorsList().map((o) => `<button type="button" class="bd-card" data-dd-flavor="${o.code}" aria-pressed="${s.flavors.includes(o.code)}"><span class="dd-dough" style="background:${DOUGH[o.code] || '#d9a65a'}" aria-hidden="true"></span><strong>${esc(o.label)}</strong><small>${FLAVOR_NOTE[o.code] || ''}${Number(o.price) > 0 ? ' · +' + money(o.price) : ''}</small></button>`).join('')}</div>
        ${s.flavors.length > 1 ? `<p class="bd-note">We spread ${s.flavors.map((f) => esc(opt('flavor', f)?.label)).join(', ')} across your box.</p>` : ''}
      </fieldset>
      <fieldset class="bd-group"><legend>Box size</legend>
        <div class="bd-chips" role="radiogroup">${product().product_variants.filter((v) => v.is_active).map((v) => `<button type="button" role="radio" class="bd-chip" data-dd-variant="${v.id}" aria-checked="${s.variant_id === v.id}">${esc(v.label)} · ${money(v.price)}</button>`).join('')}</div>
      </fieldset>
      <fieldset class="bd-group"><legend>Presets <small>Optional · all editable</small></legend>
        <div class="cd-presets">${PRESETS.filter((p) => products[p.box]).map((p) => `<button type="button" class="cd-preset" data-dd-preset="${p.key}"><span class="cd-preset-pic" aria-hidden="true">${presetPic(p)}</span><strong>${esc(p.name)}</strong><small>${K.styles ? (p.s.style === 'donut' ? 'Donut pops' : 'Round pops') : p.box === 'party' ? 'Party box' : 'Themed'}</small></button>`).join('')}</div>
      </fieldset>`;
    if (step === 'glaze') {
      const [lo, hi] = { same: [1, 1], alternate: [2, 2] }[s.pattern] || [2, 16];
      return `
      <fieldset class="bd-group"><legend>${K.coat}</legend>
        <div class="bd-cards cd-patterns" role="radiogroup">${(options().pattern || []).map((o) => `<button type="button" role="radio" class="bd-card" data-dd-set="pattern" data-value="${o.code}" aria-checked="${s.pattern === o.code}"><strong>${esc(o.label)}</strong><small>${PATTERN_NOTE[o.code] || ''}${plus(o)}</small></button>`).join('')}</div>
      </fieldset>
      <fieldset class="bd-group"><legend>${K.coat} ${lo === hi ? (lo === 1 ? 'color' : 'colors') : 'colors'} <small>${lo === hi ? `Pick ${lo}` : `Pick ${lo}–${hi}`} · ${s.glazes.length} chosen</small></legend>
        ${chosenChips(s.glazes)}${swatches('glaze', s.glazes)}
      </fieldset>
      <fieldset class="bd-group"><legend>Finishes <small>Up to 3 · one drizzle</small></legend>
        <div class="bd-chips" role="group">${(options().finish || []).map((o) => `<button type="button" class="bd-chip" data-dd-finish="${o.code}" aria-pressed="${s.finishes.includes(o.code)}">${esc(o.label)}${Number(o.price) ? ' <small>+' + money(o.price) + '</small>' : ''}</button>`).join('')}</div>
      </fieldset>`;
    }
    if (step === 'toppings') return `
      <fieldset class="bd-group"><legend>Sprinkles</legend>
        <div class="bd-cards" role="radiogroup">${(options().sprinkle || []).map((o) => `<button type="button" role="radio" class="bd-card" data-dd-set="sprinkles" data-value="${o.code}" aria-checked="${s.sprinkles === o.code}"><strong>${esc(o.label)}</strong><small>${SPRINKLE_NOTE[o.code] || ''}${plus(o)}</small></button>`).join('')}</div>
        ${s.sprinkles === 'nonpareils' ? `<p class="bd-note cd-need" style="margin-top:12px">Sprinkle colors · pick 1–3 · <b>${s.sprinkle_colors.length} chosen</b></p>${chosenChips(s.sprinkle_colors)}${swatches('sprinkle', s.sprinkle_colors)}` : ''}
      </fieldset>
      <fieldset class="bd-group"><legend>Theme toppers <small>Handmade fondant</small></legend>
        <div class="cd-themes" role="radiogroup">${(options().theme || []).map((o) => `<button type="button" role="radio" class="cd-theme" data-dd-set="theme" data-value="${o.code}" aria-checked="${s.theme === o.code}"><span aria-hidden="true">${THEME_ICON[o.code] || '✨'}</span><strong>${esc(o.label)}</strong><small>${Number(o.price) ? '+' + money(o.price) : 'free'}</small></button>`).join('')}</div>
        ${s.theme !== 'none' ? `<label class="bd-label" for="${K.key}-theme-note" style="margin-top:12px">${s.theme === 'custom' ? 'Your theme' : 'Anything to add?'} <small>${s.theme === 'custom' ? 'Required · e.g. a favourite character · ' : 'Optional · '}up to 60 characters</small></label>
          <input id="${K.key}-theme-note" class="bd-input" maxlength="60" data-dd-input="theme_note" value="${esc(s.theme_note)}" placeholder="${s.theme === 'custom' ? 'e.g. a kitty with a pink bow' : 'e.g. favourite colours'}">` : ''}
      </fieldset>
      ${window.LexcInspiration ? window.LexcInspiration.html(K.key, s.inspiration) : ''}`;
    if (step === 'message') {
      const count = countOf(variant()?.label);
      return `
      <fieldset class="bd-group"><legend>Fondant message</legend>
        <div class="bd-cards cd-patterns" role="radiogroup">${(options().message || []).map((o) => `<button type="button" role="radio" class="bd-card" data-dd-set="message" data-value="${o.code}" aria-checked="${s.message === o.code}"><strong>${esc(o.label)}</strong><small>${MESSAGE_NOTE[o.code] || ''}${plus(o)}</small></button>`).join('')}</div>
      </fieldset>
      ${s.message === 'letters' ? `<fieldset class="bd-group"><legend>Letters on each ${NOUN} <small>1–5 per ${NOUN}</small></legend>
        ${LexcLetterPieces.markup({ pieces: s.message_pieces, count, at: pieceAt, noun: NOUN, id: K.key + '-lp' })}
      </fieldset>` : s.message !== 'none' ? `<fieldset class="bd-group"><legend>Name or number <small>${(s.message_text || '').length}/${LETTER_MAX[s.message]}</small></legend>
        <input class="bd-input" maxlength="${LETTER_MAX[s.message]}" data-dd-input="message_text" value="${esc(s.message_text)}" placeholder="e.g. YANA or 2" autocomplete="off">
        <p class="bd-note" style="margin-top:10px">We put it on a few round fondant plaques spread across the box.</p>
      </fieldset>` : ''}
      ${s.message !== 'none' ? `<fieldset class="bd-group"><legend>Letter color</legend>${swatches('message', [s.message_color], false)}</fieldset>` : ''}`;
    }
    const v = variant(), ex = quote.status === 'ok' ? (quote.clean.extras || []).map((e) => [e.label, Number(e.price)]) : [];
    const labels = (codes) => codes.map((c) => esc(opt('color', c)?.label)).join(', ');
    return `
      <ul class="bd-summary" aria-label="Your design">
        <li><span>Box</span><strong>${esc(product().name)} · ${esc(v?.label)} ${money(v?.price || 0)}</strong></li>
        <li><span>Flavor</span><strong>${s.flavors.map((f) => esc(opt('flavor', f)?.label)).join(' + ')}</strong></li>
        ${K.styles ? `<li><span>Pop</span><strong>${esc(opt('style', s.style)?.label)}</strong></li>` : ''}
        <li><span>${K.coat}</span><strong>${esc(opt('pattern', s.pattern)?.label)} — ${labels(s.glazes)}</strong></li>
        <li><span>Finishes</span><strong>${s.finishes.map((f) => esc(opt('finish', f)?.label)).join(', ') || 'None'}</strong></li>
        <li><span>Sprinkles</span><strong>${esc(opt('sprinkle', s.sprinkles)?.label)}${s.sprinkles === 'nonpareils' ? ' (' + labels(s.sprinkle_colors) + ')' : ''}</strong></li>
        <li><span>Toppers</span><strong>${esc(opt('theme', s.theme)?.label)}${s.theme_note && s.theme !== 'none' ? ': ' + esc(s.theme_note) : ''}</strong></li>
        ${K.message === false ? '' : `<li><span>Message</span><strong>${s.message === 'none' ? 'None' : esc(opt('message', s.message)?.label) + ' “' + esc(s.message === 'letters' ? piecesText() : s.message_text) + '” · ' + esc(opt('color', s.message_color)?.label)}</strong></li>`}
        ${ex.map(([l, p]) => `<li><span>${esc(l)}</span><strong>+${money(p)}</strong></li>`).join('')}
      </ul>
      ${quote.status === 'error' ? `<div class="bd-warning" role="alert">${esc(quote.message)}</div>` : ''}
      <div class="cd-qty-row"><span class="bd-label" style="margin:0" id="${K.key}-qty-label">Boxes</span>
        <div class="bd-qty" role="group" aria-labelledby="${K.key}-qty-label"><button type="button" data-dd-qty="-1" aria-label="One box less">−</button><output aria-live="polite">${s.qty}</output><button type="button" data-dd-qty="1" aria-label="One box more">+</button></div></div>`;
  }

  // ---- render ------------------------------------------------------------------------------------------
  function renderBody() {
    root.querySelectorAll('.bd-steps [data-dd-step]').forEach((b, i) => {
      const k = b.dataset.ddStep, on = k === step, done = visited.has(k) && !on && k !== 'review';
      b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; b.classList.toggle('is-done', done); b.querySelector('b').textContent = done ? '✓' : String(i + 1);
    });
    const body = root.querySelector('#' + K.key + '-body'), keep = document.activeElement?.closest?.('#' + K.key + '-body') ? document.activeElement : null;
    const sel = keep ? Object.entries(keep.dataset).map(([k, v]) => `[data-${k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}="${CSS.escape(v)}"]`).join('') : '';
    const caret = keep?.selectionStart;
    body.innerHTML = bodyMarkup(); updateFooter(); updateTools();
    if (sel) { const again = body.querySelector(sel); if (again) { again.focus({ preventScroll: true }); if (caret != null && again.setSelectionRange) again.setSelectionRange(caret, caret); } }
  }
  function summaryText() { return quote.status === 'ok' ? quote.clean.summary : state.flavors.join(', '); }
  function renderPreview() {
    if (scene) {
      if (!previewFrame) previewFrame = requestAnimationFrame(() => { previewFrame = 0; if (!scene) return; scene.update(sceneSpec()); scene.canvas.setAttribute('aria-label', `Your ${NOUN} box in 3D. ` + summaryText()); });
      return;
    }
    const box = root.querySelector('[data-dd-box]'); if (box) { box.innerHTML = boxSvg(); box.firstElementChild?.setAttribute('aria-label', `Your ${NOUN} box. ` + summaryText()); }
  }
  function ensureScene() {
    if (scene || sceneLoading) return sceneLoading;
    const host = root.querySelector('[data-dd-3d]');
    sceneLoading = (async () => {
      try {
        const [mod] = await Promise.all([import('./cupcake-scene.js?v=21'), document.fonts?.load('800 60px "Baloo 2"').catch(() => null)]);
        if (currentPage !== K.page || scene) return;
        host.hidden = false;
        scene = mod.createCupcakeScene(host, { reducedMotion, kind: K.sceneKind });
        root.querySelector('[data-dd-box]').hidden = true; root.querySelector('[data-dd-bar]').hidden = false;
        root.querySelector('[data-dd-hint]').textContent = 'Drag to turn the box, scroll or pinch to zoom. ' + K.hint;
        root.querySelectorAll('[data-dd-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.ddView === 'angle')));
        root.querySelectorAll('[data-dd-scene]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.ddScene === 'studio')));
        renderPreview();
      } catch (error) {
        console.info('3D preview unavailable, showing the flat picture:', error?.message || error);
        disposeScene(); host.hidden = true; root.querySelector('[data-dd-box]').hidden = false; renderPreview();
      } finally { sceneLoading = null; }
    })();
    return sceneLoading;
  }
  function disposeScene() {
    cancelAnimationFrame(previewFrame); previewFrame = 0;
    try { scene?.dispose(); } catch {}
    scene = null;
    if (root) { root.querySelector('[data-dd-3d]').hidden = true; root.querySelector('[data-dd-bar]').hidden = true; root.querySelector('[data-dd-box]').hidden = false; }
  }
  function updateFooter() {
    if (!root) return;
    const idx = STEPS.findIndex(([k]) => k === step), total = unitPrice() * state.qty;
    root.querySelector('[data-dd-price]').textContent = money(total);
    const note = root.querySelector('[data-dd-note]');
    note.classList.toggle('is-error', quote.status === 'error');
    note.textContent = quote.status === 'error' ? quote.message : `${state.qty} × ${money(unitPrice())} · ${quote.status === 'ok' ? 'price confirmed' : 'checking price…'}`;
    root.querySelector('[data-dd-prev]').hidden = idx === 0;
    const next = root.querySelector('[data-dd-next]');
    if (idx < STEPS.length - 1) { next.textContent = 'Next'; next.disabled = false; }
    else { next.textContent = editIndex !== null ? 'Update cart' : 'Add to cart'; next.disabled = quote.status !== 'ok' || !variant(); }
  }
  function updateTools() { if (!root) return; root.querySelector('[data-dd-undo]').disabled = !past.length; root.querySelector('[data-dd-redo]').disabled = !future.length; }
  function goStep(k) {
    if (step && step !== k) visited.add(step);
    step = k; renderBody(); saveDraft();
    root.querySelector('#' + K.key + '-body').focus({ preventScroll: true });
    if (matchMedia('(max-width: 900px)').matches) root.querySelector('.bd-panel').scrollIntoView({ block: 'start', behavior: reducedMotion ? 'auto' : 'smooth' });
  }

  // ---- events --------------------------------------------------------------------------------------------
  function pickColor(kind, code) {
    commit((s) => {
      if (kind === 'message') { s.message_color = code; return; }
      const key = kind === 'glaze' ? 'glazes' : 'sprinkle_colors';
      const hi = kind === 'glaze' ? ({ same: 1, alternate: 2 }[s.pattern] || 16) : 3, list = s[key], i = list.indexOf(code);
      if (i >= 0) { if (list.length > 1) list.splice(i, 1); return; }
      if (hi === 1) { s[key] = [code]; return; }
      if (list.length >= hi) list.shift();
      list.push(code);
    });
  }
  function applyPreset(key) {
    const p = PRESETS.find((x) => x.key === key); if (!p) return;
    commit((s) => { const keepQty = s.qty, keepBox = products[p.box] ? p.box : s.box; Object.assign(s, blank(keepBox), JSON.parse(JSON.stringify(p.s)), { qty: keepQty }); });
    showToast(`Started from “${p.name}” — change anything you like.`);
  }
  function bind() {
    root.addEventListener('click', (e) => {
      const t = e.target.closest('button'); if (!t || t.disabled) return;
      const d = t.dataset;
      if ('ddViewcart' in d) { navigate('shop'); return openCart(); }
      if ('ddAgain' in d) return designAnother();
      if ('ddExit' in d) return navigate('shop');
      if (d.ddView) { root.querySelectorAll('[data-dd-view]').forEach((b) => b.setAttribute('aria-pressed', String(b === t))); return scene?.setView(d.ddView); }
      if (d.ddScene) { root.querySelectorAll('[data-dd-scene]').forEach((b) => b.setAttribute('aria-pressed', String(b === t))); t.disabled = true;
        return scene?.setScene(d.ddScene).then((shown) => { t.disabled = false; if (shown !== d.ddScene) { showToast('That scene could not load, so the studio is shown.'); root.querySelectorAll('[data-dd-scene]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.ddScene === shown))); } }); }
      if (packed) return;
      if (d.ddStep) return goStep(d.ddStep);
      if (d.ddPreset) return applyPreset(d.ddPreset);
      if (d.ddBox) return commit((s) => { if (s.box !== d.ddBox) { s.box = d.ddBox; s.variant_id = null; } });
      if (d.ddVariant) return commit((s) => { s.variant_id = d.ddVariant; });
      if (d.ddFlavor) return commit((s) => { const i = s.flavors.indexOf(d.ddFlavor); if (i >= 0) { if (s.flavors.length > 1) s.flavors.splice(i, 1); } else s.flavors.push(d.ddFlavor); });
      if (d.ddSet) return commit((s) => { s[d.ddSet] = d.value; });
      if (d.ddColor) return pickColor(d.ddColor, d.value);
      if (d.ddFinish) return commit((s) => { const f = d.ddFinish, set = new Set(s.finishes); if (set.has(f)) set.delete(f); else { set.add(f); if (f === 'choco_drizzle') set.delete('white_drizzle'); if (f === 'white_drizzle') set.delete('choco_drizzle'); } s.finishes = [...set]; });
      if (d.ddQty) return commit((s) => { s.qty += Number(d.ddQty); }, { soft: true });
      if ('ddUndo' in d) return undo();
      if ('ddRedo' in d) return redo();
      if ('ddReset' in d) { commit((s) => Object.assign(s, blank(s.box))); return showToast('Started over. Tap Undo to bring your design back.'); }
      if ('ddPrev' in d) { const i = STEPS.findIndex(([k]) => k === step); return goStep(STEPS[Math.max(0, i - 1)][0]); }
      if ('ddNext' in d) { const i = STEPS.findIndex(([k]) => k === step); return i < STEPS.length - 1 ? goStep(STEPS[i + 1][0]) : addToCart(); }
    });
    // letters per donut (shared picker): typing updates the box shortly after; fill/clear are undoable steps
    let lettersTimer = 0;
    LexcLetterPieces.bind(root, {
      pieces: () => state.message_pieces, count: () => countOf(variant()?.label), at: () => pieceAt,
      setAt: (i) => { pieceAt = i; renderBody(); },
      set: (pieces, { render }) => {
        if (render) return commit((st) => { st.message_pieces = pieces; });
        state.message_pieces = pieces; saveDraft(); scheduleQuote(); clearTimeout(lettersTimer); lettersTimer = setTimeout(renderPreview, 300);
      }
    });
    let typing = 0;
    root.addEventListener('input', (e) => {
      const key = e.target.dataset.ddInput; if (!key) return;
      if (key === 'message_text') { const clean = e.target.value.replace(LETTER_OK, ''); if (clean !== e.target.value) e.target.value = clean; }
      state[key] = e.target.value.slice(0, key === 'theme_note' ? 60 : LETTER_MAX[state.message] || 40);
      saveDraft(); scheduleQuote(); clearTimeout(typing);
      // Letters update the box and the split preview shortly after typing stops.
      typing = setTimeout(() => { renderPreview(); if (key === 'message_text') renderBody(); }, 350);
    });
    root.addEventListener('keydown', (e) => {
      const tab = e.target.closest('.bd-steps [data-dd-step]'); if (!tab || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      e.preventDefault(); const i = STEPS.findIndex(([k]) => k === step), n = STEPS[(i + (e.key === 'ArrowRight' ? 1 : -1) + STEPS.length) % STEPS.length][0];
      goStep(n); root.querySelector(`.bd-steps [data-dd-step="${n}"]`).focus();
    });
  }

  // ---- cart -------------------------------------------------------------------------------------------------
  async function addToCart() {
    if (!window.currentUser) { saveDraft(); showToast('Log in or create an account to add your design to the cart. Your design stays saved on this device.'); navigate('login'); return; }
    if (state.message === 'letters' && !LexcLetterPieces.filled(state.message_pieces)) {
      if (step !== 'message') goStep('message');
      return showToast(`Add letters to at least one ${NOUN}, or choose no message.`);
    }
    if (quote.status !== 'ok') return;
    const v = variant(), d = design(), p = product();
    const item = { id: K.designer + '-' + crypto.randomUUID(), product_id: p.id, variant_id: v.id, name: p.name, emoji: K.emoji,
      sizeLabel: `${v.label} · ${quote.clean.summary}`, price: Number(v.price) + quote.extra, base_price: Number(v.price), extras: quote.extra,
      qty: state.qty, selected: true, customization: d, inspiration: [...(state.inspiration || [])], preview: scene ? scene.snapshot(480) : await svgSnapshot(400) };
    const wasEdit = editIndex !== null && cart[editIndex]?.customization?.designer === K.designer;
    if (wasEdit) { item.id = cart[editIndex].id; cart[editIndex] = item; } else cart.push(item);
    editIndex = null; try { localStorage.removeItem(DRAFT_KEY); } catch {}
    renderCart();
    if (!scene) { showToast(wasEdit ? `Your ${NOUN} design was updated.` : `Your ${NOUN}s were added to the cart.`); navigate('shop'); return openCart(); }
    // Like the bento and the cupcakes: the box is closed and sealed on screen, then a finish panel.
    packed = true; root.classList.add('is-packing');
    const unit = item.price, summary = esc(quote.clean.summary || ''), body = root.querySelector('#' + K.key + '-body');
    body.innerHTML = `<div class="bd-packed" role="status"><span class="bd-packed-icon" aria-hidden="true">📦</span><h2>Packing your ${NOUN}s…</h2><p class="bd-note">${summary}</p></div>`;
    root.querySelector('[data-dd-view="angle"]')?.click();
    if (matchMedia('(max-width: 900px)').matches) root.querySelector('.bd-stage').scrollIntoView({ block: 'start', behavior: reducedMotion ? 'auto' : 'smooth' });
    try { await Promise.race([scene.pack(), new Promise((done) => setTimeout(done, 6000))]); } catch (error) { console.info('Packing animation skipped:', error?.message || error); }
    if (!packed || currentPage !== K.page) return;
    body.innerHTML = `<div class="bd-packed" role="status"><span class="bd-packed-icon" aria-hidden="true">🎉</span>
      <h2>${wasEdit ? 'Your cart design was updated' : 'Boxed and added to your cart!'}</h2>
      <p class="bd-note">${summary}</p>
      <p class="bd-packed-price">${item.qty} × ${money(unit)} = <b>${money(unit * item.qty)}</b></p>
      <div class="bd-packed-actions"><button type="button" class="bd-primary" data-dd-viewcart>View cart</button><button type="button" class="bd-secondary" data-dd-again>Design another</button></div></div>`;
    body.querySelector('[data-dd-viewcart]').focus({ preventScroll: true });
  }
  function designAnother() {
    packed = false; root.classList.remove('is-packing'); scene?.unpack();
    past = []; future = []; editIndex = null; visited.clear(); step = 'box';
    state = blank(state.box); normalise(); renderBody(); renderPreview(); scheduleQuote(); updateTools();
  }

  // ---- open / leave -------------------------------------------------------------------------------------------
  function ensureRoot() { root = document.getElementById('page-' + K.page); if (!root.dataset.bound) { root.dataset.bound = '1'; shell(); bind(); } }
  async function start({ fromCart = null, shared = null, box = null } = {}) {
    ensureRoot();
    root.querySelector('#' + K.key + '-body').innerHTML = '<div class="skel skel-title" style="margin:8px 0 16px"></div><div class="skel skel-line"></div><div class="skel skel-line skel-line--long" style="margin-top:10px"></div>';
    try { await loadAll(); }
    catch (error) {
      console.warn(K.title + ' could not load:', error);
      root.querySelector('#' + K.key + '-body').innerHTML = '<div role="alert"><p><strong>The designer could not load.</strong></p><p class="bd-note">Check your connection and try again.</p><button type="button" class="bd-secondary" data-dd-retry>Try again</button></div>';
      root.querySelector('[data-dd-retry]').onclick = () => start({ fromCart, shared, box });
      return;
    }
    past = []; future = []; editIndex = null; visited.clear(); step = 'box';
    packed = false; root.classList.remove('is-packing'); scene?.unpack();
    const boxOf = (variantId) => Object.entries(products).find(([, p]) => p.product_variants.some((v) => v.id === variantId))?.[0];
    const fromDesign = (d) => ({ ...(K.styles ? { style: d.style || 'round' } : {}), flavors: d.flavors, pattern: d.pattern, glazes: d.glazes, finishes: d.finishes || [], sprinkles: d.sprinkles, sprinkle_colors: d.sprinkle_colors || [],
      theme: d.theme, theme_note: d.theme_note || '', message: d.message || 'none', message_text: d.message_text || '', message_pieces: d.message_pieces || [], message_color: d.message_color || 'white' });
    if (fromCart !== null && cart[fromCart]?.customization?.designer === K.designer) {
      const c = cart[fromCart], b = boxOf(c.variant_id) || 'party'; editIndex = fromCart;
      state = { ...blank(b), ...fromDesign(c.customization), box: b, variant_id: c.variant_id, qty: c.qty, inspiration: [...(c.inspiration || [])] }; step = 'review';
    } else if (shared) {
      const b = boxOf(shared.v) || 'party';
      state = { ...blank(b), ...fromDesign(shared.d), box: b, variant_id: shared.v, qty: 1 }; step = 'review';
      showToast(`Opened a shared ${NOUN} design — change anything you like.`);
    } else {
      let draft = null; try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch {}
      if (draft?.state && !box) { state = { ...blank(draft.state.box || 'party'), ...draft.state }; step = STEPS.some(([k]) => k === draft.step) ? draft.step : 'box'; showToast(`Your saved ${NOUN} design was restored.`); }
      else state = blank(box && products[box] ? box : Object.keys(products)[0]);
    }
    normalise(); renderBody(); renderPreview(); scheduleQuote(); ensureScene();
  }
  function whenReady(fn) {
    if (window.lexcCatalogState === 'ready') return fn();
    let waited = 0; const t = setInterval(() => { waited += 200; if (window.lexcCatalogState === 'ready') { clearInterval(t); fn(); } else if (waited > 15000) { clearInterval(t); showToast('The menu could not load. Please try again.'); } }, 200);
  }
  const fromB64 = (code) => new TextDecoder().decode(Uint8Array.from(atob(code.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));
  function decodeShared(code) { try { const o = JSON.parse(fromB64(code)); return o && o.d && typeof o.d === 'object' ? o : null; } catch { return null; } }

  // inspiration photos (shared/inspiration.js): kept in the design state and the cart item, never in the design itself
  window.LexcInspiration?.register(K.key, () => state?.inspiration || [], (paths) => { if (!state) return; state.inspiration = paths; saveDraft(); if (step === 'toppings') renderBody(); }, saveDraft);
  const api = window[K.global] = Object.freeze({
    open({ productId = null, shared = null } = {}) {
      whenReady(() => {
        const box = productId ? Object.entries(SLUGS).find(([, slug]) => (liveCatalog.find((p) => p.id === productId) || {}).slug === slug)?.[0] : null;
        navigate(K.page); start({ shared, box });
      });
    },
    edit(index) { window.closeCart?.(); whenReady(() => { navigate(K.page); start({ fromCart: index }); }); },
    isDesignable: (productId) => (typeof liveCatalog !== 'undefined' ? liveCatalog : []).some((p) => p.id === productId && p.customization_config?.designer === K.designer)
  });

  const baseNavigate = window.navigate;
  window.navigate = function navigate(page, anchor) {
    if (currentPage === K.page && page !== K.page) { clearTimeout(quoteTimer); quoteSeq++; disposeScene(); }
    const r = baseNavigate.call(this, page, anchor);
    if (page === K.page) document.querySelectorAll('#mainNav .nav-links a[data-page="bento"]').forEach((a) => a.classList.add('active'));
    return r;
  };
  const params = new URL(location.href).searchParams;
  if (params.has(K.param)) {
    const u = new URL(location.href), code = u.searchParams.get(K.param); u.searchParams.delete(K.param); history.replaceState(history.state, '', u);
    const shared = code && code !== '1' ? decodeShared(code) : null;
    if (code && code !== '1' && !shared) showToast('That design link is incomplete, so a new design was started.');
    api.open({ shared });
  }
}

makeTreatDesigner({
  key: 'dd', page: 'donut', designer: 'donut', sceneKind: 'donut', quoteFn: 'quote_donut_design', global: 'LexcDonut', param: 'donut',
  draftKey: 'lexc_donut_draft_v1', slugs: { party: 'product-2', themed: 'product-3' },
  boxNote: { party: 'Glazes, sprinkles and simple toppers', themed: 'Full theme: toppers, letters and plaques' },
  title: 'Design your mini donuts', shortTitle: 'Your donuts', noun: 'donut', emoji: '🍩', coat: 'Glaze', defaultFlavor: 'vanilla', maxFlavors: 4,
  hint: 'Every donut is glazed and decorated by hand.',
  // One-tap looks from LexC's own donut boxes.
  presets: [
    { key: 'pinkpurple', name: 'Pink & purple', box: 'party', s: { pattern: 'alternate', glazes: ['hot_pink', 'purple'], sprinkles: 'white_pearls', theme: 'butterfly' } },
    { key: 'bees', name: 'Bee happy', box: 'themed', s: { pattern: 'alternate', glazes: ['lemon', 'ivory'], finishes: ['honey_drip', 'white_drizzle'], sprinkles: 'none', theme: 'bees', message: 'letters', message_text: 'happy birthday', message_color: 'butter' } },
    { key: 'baby', name: 'Baby shower', box: 'themed', s: { glazes: ['azure'], sprinkles: 'nonpareils', sprinkle_colors: ['white', 'sky_blue'], theme: 'baby', message: 'letters', message_text: 'A BABY BOY ON THE WAY', message_color: 'white' } },
    { key: 'fairy', name: 'Fairy garden', box: 'themed', s: { pattern: 'assorted', glazes: ['mint', 'hot_pink', 'sky_blue', 'leaf_green'], finishes: ['choco_drizzle', 'gold_dust'], theme: 'fairy', message: 'plaque', message_text: 'YANA', message_color: 'white' } },
    { key: 'builder', name: 'Little builder', box: 'themed', s: { flavors: ['vanilla', 'chocolate'], pattern: 'assorted', glazes: ['lemon', 'orange', 'white', 'chocolate'], sprinkles: 'nonpareils', sprinkle_colors: ['orange', 'black', 'lemon'], theme: 'construction', message: 'plaque', message_text: 'TWO', message_color: 'orange' } },
    { key: 'pink', name: 'Pretty in pink', box: 'themed', s: { flavors: ['strawberry'], pattern: 'assorted', glazes: ['pink', 'white'], sprinkles: 'nonpareils', sprinkle_colors: ['hot_pink', 'pink', 'sky_blue'], theme: 'bows', message: 'letters', message_text: 'happy 4th', message_color: 'purple' } }
  ]
});

makeTreatDesigner({
  key: 'cp', page: 'cakepop', designer: 'cakepop', sceneKind: 'cakepop', quoteFn: 'quote_cakepop_design', global: 'LexcCakePop', param: 'cakepop',
  draftKey: 'lexc_cakepop_draft_v1', slugs: { pops: 'cake-pops' },
  title: 'Design your cake pops', shortTitle: 'Your cake pops', noun: 'cake pop', emoji: '🍭', coat: 'Coating', defaultFlavor: 'chocolate', maxFlavors: 2,
  hint: 'Every pop is dipped and decorated by hand.', message: false,
  styles: true, styleNote: { round: 'A ball of cake on a stick', donut: 'A mini donut on a stick' },
  // One-tap looks from LexC's own cake pops.
  presets: [
    { key: 'pastel', name: 'Pastel sprinkles', box: 'pops', s: { pattern: 'assorted', glazes: ['pink', 'aqua', 'lavender'], sprinkles: 'nonpareils', sprinkle_colors: ['hot_pink', 'white', 'azure'] } },
    { key: 'babyshower', name: 'Baby shower', box: 'pops', s: { pattern: 'alternate', glazes: ['sky_blue', 'pink'], sprinkles: 'nonpareils', sprinkle_colors: ['white', 'hot_pink'], theme: 'baby' } },
    { key: 'heroes', name: 'Blue & yellow stars', box: 'pops', s: { style: 'donut', pattern: 'alternate', glazes: ['azure', 'lemon'], finishes: ['gold_star'], sprinkles: 'gold_pearls' } },
    { key: 'space', name: 'Outer space', box: 'pops', s: { style: 'donut', glazes: ['navy'], finishes: ['edible_glitter'], sprinkles: 'gold_pearls', theme: 'space' } },
    { key: 'kitty', name: 'Pink & white', box: 'pops', s: { pattern: 'alternate', glazes: ['pink', 'white'] } }
  ]
});
