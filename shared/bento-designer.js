// Bento cake designer (customer). Guided steps with a persistent preview. Choices and prices come from
// public.design_options and the product's variants; the server re-validates and prices every design
// (quote_bento_design / create_order). Adds to the existing cart; never creates an order.
(() => {
  const STEPS = [['style', 'Style'], ['decorate', 'Decorate'], ['message', 'Message'], ['review', 'Review']];
  const SUGGESTIONS = ['Happy Birthday', 'Congratulations', 'Happy Anniversary', 'Best wishes', 'I love you'];
  const DRAFT_KEY = 'lexc_bento_draft_v1';
  const ICON = {
    back: '<path d="m15 18-6-6 6-6"/>', undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>', reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>', view: '<circle cx="12" cy="12" r="3"/><path d="M3 12a9 9 0 0 1 18 0"/>'
  };
  const icon = (n) => `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true">${ICON[n]}</svg>`;
  const esc = (v) => authEscape(String(v ?? ''));
  const money = (v) => checkoutMoney(v).replace('.00', '');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let root = null, product = null, options = null, palette = {}, scene = null, sceneLoading = null;
  let state = null, step = 'style', past = [], future = [], editIndex = null, quote = { status: 'idle' }, quoteTimer = 0, quoteSeq = 0;
  let textTimer = 0, view3d = true;

  const blank = () => ({ variant_id: product.product_variants.filter((v) => v.is_active)[0]?.id, frosting_color: 'white', border: [], accents: [], bow_color: 'pink',
    message: '', lettering: 'piped', lettering_color: 'purple', topper: 'none', topper_text: '', qty: 1 });
  const design = () => ({ designer: 'bento', frosting_color: state.frosting_color, border: [...state.border], accents: [...state.accents],
    bow_color: state.accents.includes('ribbon_bows') ? state.bow_color : null, message: state.message.trim(),
    lettering: state.message.trim() ? state.lettering : null, lettering_color: state.message.trim() ? state.lettering_color : null,
    topper: state.topper, topper_text: state.topper === 'number' ? state.topper_text : '' });
  const opt = (group, code) => options[group]?.find((o) => o.code === code);
  const variant = () => product.product_variants.find((v) => v.id === state.variant_id && v.is_active);
  const cfg = () => product.customization_config || {};

  // Price shown immediately from the same option table; confirmed by the server quote below.
  function localExtras() {
    const d = design(); let sum = 0; const lines = [];
    const add = (o) => { if (o && Number(o.price) > 0) { sum += Number(o.price); lines.push([o.label, Number(o.price)]); } };
    d.border.forEach((c) => add(opt('border', c))); d.accents.forEach((c) => add(opt('accent', c)));
    if (d.message) { add(opt('message', 'custom_message')); add(opt('lettering', d.lettering)); }
    add(opt('topper', d.topper));
    return { sum, lines };
  }
  const unitPrice = () => Number(variant()?.price || 0) + (quote.status === 'ok' ? quote.extra : localExtras().sum);

  // ---- data -------------------------------------------------------------------------------------
  function bentoProduct() { return (typeof liveCatalog !== 'undefined' ? liveCatalog : []).find((p) => p.customization_config?.designer === 'bento'); }
  async function loadOptions() {
    const rows = LexcBackend.unwrap(await LexcBackend.client.from('design_options').select('group_key,code,label,price,hex,sort_order').eq('product_id', product.id).order('sort_order'));
    options = {}; palette = {};
    rows.forEach((r) => { (options[r.group_key] ||= []).push(r); if (r.group_key === 'color') palette[r.code] = r.hex; });
    if (!options.color?.length) throw new Error('No design options');
  }

  // ---- state, history, draft --------------------------------------------------------------------
  const snapshot = () => JSON.stringify(state);
  function commit(mutator, { soft = false } = {}) {
    const before = snapshot(); mutator(state); normalise();
    if (snapshot() === before) return;
    if (!soft) { past.push(before); if (past.length > 60) past.shift(); future = []; }
    afterChange();
  }
  function normalise() {
    const max = Number(cfg().max_accents || 6);
    state.accents = [...new Set(state.accents)].filter((c) => opt('accent', c)).slice(0, max);
    state.border = [...new Set(state.border)].filter((c) => opt('border', c));
    if (!palette[state.frosting_color]) state.frosting_color = options.color[0].code;
    if (!palette[state.bow_color]) state.bow_color = 'pink';
    if (!palette[state.lettering_color]) state.lettering_color = 'purple';
    if (!opt('topper', state.topper)) state.topper = 'none';
    if (!opt('lettering', state.lettering)) state.lettering = 'piped';
    state.topper_text = String(state.topper_text || '').replace(/\D/g, '').slice(0, 3);
    state.qty = Math.min(20, Math.max(1, Number(state.qty) || 1));
    if (!variant()) state.variant_id = product.product_variants.find((v) => v.is_active)?.id;
  }
  function saveDraft() { try { if (editIndex === null) localStorage.setItem(DRAFT_KEY, JSON.stringify({ product_id: product.id, state, step })); } catch {} }
  function undo() { if (!past.length) return; future.push(snapshot()); state = JSON.parse(past.pop()); afterChange(true); }
  function redo() { if (!future.length) return; past.push(snapshot()); state = JSON.parse(future.pop()); afterChange(true); }
  function resetDesign() { if (!window.confirm('Start over with a plain white cake? You can undo this.')) return; commit((s) => Object.assign(s, blank(), { qty: s.qty, variant_id: s.variant_id })); }

  function afterChange(rerender = false) {
    saveDraft(); renderPreview(); scheduleQuote(); updateFooter(); updateTools();
    if (rerender) renderBody(); else refreshBodyState();
  }

  // ---- server quote -----------------------------------------------------------------------------
  function scheduleQuote() {
    clearTimeout(quoteTimer); quote = { status: 'pending' }; updateFooter();
    quoteTimer = setTimeout(runQuote, 350);
  }
  async function runQuote() {
    const seq = ++quoteSeq; const d = design();
    try {
      const r = await LexcBackend.rpc('quote_bento_design', { p_product_id: product.id, p_design: d });
      if (seq !== quoteSeq) return;
      quote = { status: 'ok', extra: Number(r.extra), clean: r.clean };
    } catch (error) {
      if (seq !== quoteSeq) return;
      const msg = String(error?.message || '');
      quote = { status: 'error', message: /^[A-Z][^\n]{3,120}\.$/.test(msg) && !/function|relation|permission|JWT/i.test(msg) ? msg : 'Could not confirm the price. Check your connection and try again.' };
    }
    updateFooter();
  }

  // ---- preview (3D with a flat top-view fallback) -----------------------------------------------
  function topViewSvg() {
    const d = design(), f = palette[d.frosting_color], lc = palette[d.lettering_color] || '#4f3163';
    const lines = d.message ? d.message.split('\n').slice(0, 3) : [];
    const size = lines.length ? Math.min(46, 300 / Math.max(...lines.map((l) => l.length || 1)) * 1.1) : 40;
    const beads = (r, n, fill) => Array.from({ length: n }, (_, i) => { const a = i / n * Math.PI * 2; return `<circle cx="${200 + Math.cos(a) * r}" cy="${200 + Math.sin(a) * r}" r="7" fill="${fill}"/>`; }).join('');
    return `<svg viewBox="0 0 400 400" role="img" aria-label="Top view: ${esc(opt('color', d.frosting_color)?.label)} bento cake${d.message ? ' with the message ' + esc(d.message.replace(/\n/g, ' ')) : ''}">
      <rect x="10" y="10" width="380" height="380" rx="18" fill="#fff3c4" stroke="#f4c430" stroke-width="3" stroke-dasharray="14 10"/>
      <circle cx="200" cy="200" r="170" fill="${f}" stroke="#00000022" stroke-width="3"/>
      ${d.border.includes('shell_top') ? beads(160, 30, f) + `<circle cx="200" cy="200" r="160" fill="none" stroke="#00000018" stroke-width="16"/>` : ''}
      ${d.accents.includes('pearls_gold') || d.accents.includes('pearls_silver') ? beads(148, 26, d.accents.includes('pearls_gold') ? '#d4af37' : '#c9ccd3') : ''}
      ${d.accents.includes('ribbon_bows') ? [45, 135, 225, 315].map((deg) => { const a = deg * Math.PI / 180; return `<text x="${200 + Math.cos(a) * 175}" y="${206 + Math.sin(a) * 175}" font-size="30" text-anchor="middle" fill="${palette[d.bow_color]}">⋈</text>`; }).join('') : ''}
      ${lines.map((l, i) => `<text x="200" y="${200 + (i - (lines.length - 1) / 2) * size * 1.15}" font-family="Nunito,DM Sans,sans-serif" font-weight="800" font-size="${size}" text-anchor="middle" dominant-baseline="middle" fill="${lc}">${esc(d.lettering === 'pearl_letters' ? l.toUpperCase() : l)}</text>`).join('')}
    </svg>`;
  }
  function renderPreview() {
    const box = root.querySelector('[data-bd-canvas]');
    const top = root.querySelector('[data-bd-top]');
    top.hidden = view3d && !!scene;
    if (!top.hidden) top.innerHTML = topViewSvg();
    if (scene) { scene.update(design(), palette); scene.canvas.setAttribute('aria-label', 'Rotatable 3D preview. ' + summaryText()); }
    box.querySelector('.bd-skeleton')?.toggleAttribute('hidden', !!scene || !view3d || !sceneLoading);
  }
  async function ensureScene() {
    if (scene || sceneLoading) return sceneLoading;
    const box = root.querySelector('[data-bd-canvas]');
    sceneLoading = (async () => {
      try {
        const probe = document.createElement('canvas');
        if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) throw new Error('WebGL unavailable');
        const mod = await import('./bento-scene.js?v=3');
        if (!root.isConnected || currentPage !== 'bento') return;
        scene = mod.createBentoScene(box, { reducedMotion });
      } catch (error) {
        console.info('3D preview unavailable, using top view:', error?.message || error);
        view3d = false; syncViewButtons();
        root.querySelector('[data-bd-stage-msg]').hidden = false;
      } finally { sceneLoading = null; renderPreview(); }
    })();
    renderPreview();
    return sceneLoading;
  }
  function disposeScene() { scene?.dispose(); scene = null; }
  function syncViewButtons() { root.querySelectorAll('[data-bd-view]').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.bdView === '3d') === view3d))); root.querySelector('[data-bd-resetview]').hidden = !view3d; }

  // ---- markup -----------------------------------------------------------------------------------
  function shell() {
    root.innerHTML = `<div class="bd-wrap">
      <header class="bd-head">
        <button type="button" class="bd-back" data-bd-exit aria-label="Back to Bento Cake">${icon('back')}<span class="bd-back-text">Bento Cake</span></button>
        <h1>Design your bento</h1>
        <div class="bd-tools" role="group" aria-label="Design history">
          <button type="button" class="bd-tool" data-bd-undo aria-label="Undo">${icon('undo')}<span>Undo</span></button>
          <button type="button" class="bd-tool" data-bd-redo aria-label="Redo">${icon('redo')}<span>Redo</span></button>
          <button type="button" class="bd-tool" data-bd-reset aria-label="Reset design">${icon('reset')}<span>Reset</span></button>
        </div>
      </header>
      <div class="bd-layout">
        <section class="bd-stage" aria-label="Cake preview">
          <div class="bd-canvas-box" data-bd-canvas>
            <div class="bd-skeleton" aria-hidden="true"><span></span></div>
            <div class="bd-topview" data-bd-top hidden></div>
            <p class="bd-stage-msg" data-bd-stage-msg role="status" hidden>3D preview isn’t available on this device, so you’re seeing a top view. Every option still works.</p>
          </div>
          <div class="bd-stage-bar">
            <div class="bd-seg" role="group" aria-label="Preview type"><button type="button" data-bd-view="3d" aria-pressed="true">3D</button><button type="button" data-bd-view="top" aria-pressed="false">Top view</button></div>
            <button type="button" class="bd-tool" data-bd-resetview>${icon('view')}<span>Reset view</span></button>
          </div>
          <p class="bd-hint">Drag to turn the cake, scroll or pinch to zoom. The preview is a guide — handmade decorations vary slightly.</p>
        </section>
        <section class="bd-panel" aria-label="Design options">
          <div class="bd-steps" role="tablist" aria-label="Design steps">${STEPS.map(([k, l], i) => `<button type="button" role="tab" class="bd-step" id="bd-tab-${k}" data-bd-step="${k}" aria-controls="bd-body"><b>${i + 1}</b>${l}</button>`).join('')}</div>
          <div class="bd-body" id="bd-body" role="tabpanel" tabindex="-1"></div>
          <div class="bd-foot">
            <div class="bd-price"><strong data-bd-price>—</strong><span data-bd-price-note aria-live="polite"></span></div>
            <button type="button" class="bd-secondary" data-bd-prev>Back</button>
            <button type="button" class="bd-primary" data-bd-next>Next</button>
          </div>
        </section>
      </div>
    </div>`;
  }

  const swatches = (field, current, label) => `<div class="bd-swatches" role="radiogroup" aria-label="${label}">${options.color.map((c) =>
    `<button type="button" role="radio" class="bd-swatch" style="background:${c.hex}" data-bd-set="${field}" data-value="${c.code}" aria-checked="${c.code === current}" aria-label="${esc(c.label)}" title="${esc(c.label)}"></button>`).join('')}</div>
    <p class="bd-swatch-name" aria-hidden="true">${esc(opt('color', current)?.label || '')}</p>`;
  const priceTag = (o) => Number(o.price) > 0 ? `<small>+${money(o.price)}</small>` : '<small>Free</small>';

  function bodyMarkup() {
    const s = state, max = Number(cfg().max_accents || 6);
    if (step === 'style') return `
      <fieldset class="bd-group"><legend>Flavor <small>Same size and weight</small></legend>
        <div class="bd-cards" role="radiogroup" aria-label="Flavor">${product.product_variants.filter((v) => v.is_active).map((v) =>
          `<button type="button" role="radio" class="bd-card" data-bd-set="variant_id" data-value="${v.id}" aria-checked="${v.id === s.variant_id}"><strong>${esc(v.label === 'Minimalist' ? 'Plain' : v.label)}</strong><span>${money(v.price)}</span></button>`).join('')}</div></fieldset>
      <fieldset class="bd-group"><legend>Frosting color <small>24 colors · free</small></legend>${swatches('frosting_color', s.frosting_color, 'Frosting color')}</fieldset>`;
    if (step === 'decorate') {
      const count = s.accents.length;
      return `
      <fieldset class="bd-group"><legend>Border <small>Piped shells</small></legend>
        <div class="bd-chips">${(options.border || []).map((o) => `<button type="button" class="bd-chip" data-bd-toggle="border" data-value="${o.code}" aria-pressed="${s.border.includes(o.code)}">${esc(o.label.replace('Shell border — ', 'Shell '))} ${priceTag(o)}</button>`).join('')}</div></fieldset>
      <fieldset class="bd-group"><legend>Decorations <small>${count} of ${max} chosen</small></legend>
        <p class="bd-note">Pick gold or silver pearls, not both.</p>
        <div class="bd-chips">${(options.accent || []).map((o) => { const on = s.accents.includes(o.code); return `<button type="button" class="bd-chip" data-bd-toggle="accents" data-value="${o.code}" aria-pressed="${on}" ${!on && count >= max ? 'disabled' : ''}>${esc(o.label)} ${priceTag(o)}</button>`; }).join('')}</div></fieldset>
      ${s.accents.includes('ribbon_bows') ? `<fieldset class="bd-group"><legend>Ribbon color</legend>${swatches('bow_color', s.bow_color, 'Ribbon color')}</fieldset>` : ''}
      <fieldset class="bd-group"><legend>Topper</legend>
        <div class="bd-chips" role="radiogroup" aria-label="Topper">${(options.topper || []).map((o) => `<button type="button" role="radio" class="bd-chip" data-bd-set="topper" data-value="${o.code}" aria-checked="${s.topper === o.code}">${esc(o.label)} ${o.code === 'none' ? '' : priceTag(o)}</button>`).join('')}</div>
        ${s.topper === 'number' ? `<label class="bd-label" for="bd-topper-text" style="margin-top:12px">Number on the topper <small>1–3 digits</small></label><input id="bd-topper-text" class="bd-input" inputmode="numeric" maxlength="3" autocomplete="off" data-bd-text="topper_text" value="${esc(s.topper_text)}">` : ''}
      </fieldset>`;
    }
    if (step === 'message') {
      const maxLen = Number(cfg().message_max || 42), maxLines = Number(cfg().message_max_lines || 3);
      const msgOpt = opt('message', 'custom_message');
      return `
      <label class="bd-label" for="bd-message">Message on the cake <small>${msgOpt ? '+' + money(msgOpt.price) + ' · ' : ''}optional</small></label>
      <textarea id="bd-message" class="bd-textarea" rows="3" maxlength="${maxLen}" data-bd-text="message" aria-describedby="bd-msg-help" placeholder="Happy Birthday Mika">${esc(s.message)}</textarea>
      <div class="bd-counter" id="bd-msg-help"><span>Up to ${maxLines} lines — press Enter for a new line.</span><span data-bd-count>${s.message.length} / ${maxLen}</span></div>
      <div class="bd-chips" style="margin-bottom:18px" aria-label="Message suggestions">${SUGGESTIONS.map((t) => `<button type="button" class="bd-chip" data-bd-suggest="${esc(t)}">${esc(t)}</button>`).join('')}</div>
      <fieldset class="bd-group" ${s.message.trim() ? '' : 'disabled'}><legend>Lettering <small>${s.message.trim() ? '' : 'Write a message first'}</small></legend>
        <div class="bd-cards" role="radiogroup" aria-label="Lettering style">${(options.lettering || []).map((o) => `<button type="button" role="radio" class="bd-card" data-bd-set="lettering" data-value="${o.code}" aria-checked="${s.lettering === o.code}" ${s.message.trim() ? '' : 'disabled'}><strong>${esc(o.label)}</strong><span>${Number(o.price) > 0 ? '+' + money(o.price) : 'Included'}</span></button>`).join('')}</div></fieldset>
      <fieldset class="bd-group" ${s.message.trim() ? '' : 'disabled'}><legend>Lettering color</legend>${s.message.trim() ? swatches('lettering_color', s.lettering_color, 'Lettering color') : '<p class="bd-note">Choose after writing your message.</p>'}</fieldset>`;
    }
    const v = variant(), ex = quote.status === 'ok' ? (quote.clean.extras || []).map((e) => [e.label, Number(e.price)]) : localExtras().lines;
    return `
      <ul class="bd-summary" aria-label="Your design">
        <li><span>Cake</span><strong>${esc(product.name)} · ${esc(v?.label === 'Minimalist' ? 'Plain' : v?.label)} ${money(v?.price || 0)}</strong></li>
        <li><span>Frosting</span><strong>${esc(opt('color', s.frosting_color)?.label)}</strong></li>
        <li><span>Border</span><strong>${s.border.length ? s.border.map((c) => esc(opt('border', c).label.replace('Shell border — ', 'Shell '))).join(', ') : 'None'}</strong></li>
        <li><span>Decorations</span><strong>${s.accents.length ? s.accents.map((c) => esc(opt('accent', c).label) + (c === 'ribbon_bows' ? ' (' + esc(opt('color', s.bow_color)?.label) + ')' : '')).join(', ') : 'None'}</strong></li>
        <li><span>Message</span><strong>${s.message.trim() ? '“' + esc(s.message.trim()) + '”\n' + esc(opt('lettering', s.lettering)?.label) + ', ' + esc(opt('color', s.lettering_color)?.label) : 'None'}</strong></li>
        <li><span>Topper</span><strong>${esc(opt('topper', s.topper)?.label)}${s.topper === 'number' ? ' ' + esc(s.topper_text) : ''}</strong></li>
        ${ex.map(([l, p]) => `<li><span>${esc(l)}</span><strong>+${money(p)}</strong></li>`).join('')}
      </ul>
      <div class="bd-group" style="display:flex;align-items:center;justify-content:space-between;gap:12px">
        <span class="bd-label" style="margin:0" id="bd-qty-label">Quantity</span>
        <div class="bd-qty" role="group" aria-labelledby="bd-qty-label"><button type="button" data-bd-qty="-1" aria-label="Decrease quantity">−</button><output aria-live="polite">${s.qty}</output><button type="button" data-bd-qty="1" aria-label="Increase quantity">+</button></div>
      </div>
      <div class="bd-theme"><span>Want a themed design, like figures or characters? Ask us first.</span><button type="button" class="bd-link" data-bd-chat>${icon('chat')} Ask LexC’s</button></div>`;
  }

  function renderBody() {
    root.querySelectorAll('[data-bd-step]').forEach((b) => { const on = b.dataset.bdStep === step; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
    root.querySelector('#bd-body').setAttribute('aria-labelledby', `bd-tab-${step}`);
    root.querySelector('#bd-body').innerHTML = bodyMarkup();
    updateFooter(); updateTools();
  }
  // Re-render the step body but keep focus/caret on the element the customer is using.
  function refreshBodyState() {
    const active = document.activeElement, key = active?.dataset?.bdText || (active?.dataset?.value ? active.dataset.bdSet || active.dataset.bdToggle : null);
    const value = active?.dataset?.value, caret = active?.selectionStart;
    if (active?.dataset?.bdText) { root.querySelector('[data-bd-count]') && (root.querySelector('[data-bd-count]').textContent = `${state.message.length} / ${Number(cfg().message_max || 42)}`); if (step !== 'message' || !refreshNeededForMessage()) return; }
    renderBody();
    const sel = key ? (value ? `[data-value="${CSS.escape(value)}"][data-bd-set="${key}"],[data-value="${CSS.escape(value)}"][data-bd-toggle="${key}"]` : `[data-bd-text="${key}"]`) : null;
    const target = sel && root.querySelector(sel);
    if (target) { target.focus({ preventScroll: true }); if (caret != null && target.setSelectionRange) target.setSelectionRange(caret, caret); }
  }
  let lastHadMessage = false;
  function refreshNeededForMessage() { const has = !!state.message.trim(); const need = has !== lastHadMessage; lastHadMessage = has; return need; }

  function summaryText() {
    const d = design();
    return [opt('color', d.frosting_color)?.label + ' frosting', ...d.border.map((c) => opt('border', c)?.label), ...d.accents.map((c) => opt('accent', c)?.label),
      d.message ? `message “${d.message.replace(/\n/g, ' / ')}”` : '', d.topper !== 'none' ? opt('topper', d.topper)?.label : ''].filter(Boolean).join(', ');
  }
  function updateFooter() {
    if (!root) return;
    const v = variant(); const idx = STEPS.findIndex(([k]) => k === step);
    root.querySelector('[data-bd-price]').textContent = money(unitPrice() * state.qty);
    const note = root.querySelector('[data-bd-price-note]');
    note.classList.toggle('is-error', quote.status === 'error');
    note.textContent = quote.status === 'error' ? quote.message : quote.status === 'ok' ? `${state.qty} × ${money(unitPrice())} · price confirmed` : `${state.qty} × ${money(unitPrice())} · checking price…`;
    const prev = root.querySelector('[data-bd-prev]'); prev.hidden = idx === 0;
    const next = root.querySelector('[data-bd-next]');
    if (idx < STEPS.length - 1) { next.textContent = 'Next'; next.disabled = false; }
    else { next.textContent = editIndex !== null ? 'Update cart' : 'Add to cart'; next.disabled = quote.status !== 'ok' || !v; }
  }
  function updateTools() {
    if (!root) return;
    root.querySelector('[data-bd-undo]').disabled = !past.length;
    root.querySelector('[data-bd-redo]').disabled = !future.length;
  }
  function goStep(k, focusBody = true) {
    step = k; renderBody(); saveDraft();
    if (focusBody) root.querySelector('#bd-body').focus({ preventScroll: true });
    if (matchMedia('(max-width: 900px)').matches) root.querySelector('.bd-panel').scrollIntoView({ block: 'start', behavior: reducedMotion ? 'auto' : 'smooth' });
  }

  // ---- events -----------------------------------------------------------------------------------
  function bind() {
    root.addEventListener('click', (e) => {
      const t = e.target.closest('button'); if (!t || t.disabled) return;
      root.classList.remove('is-typing');
      if (t.dataset.bdStep) return goStep(t.dataset.bdStep);
      if (t.dataset.bdSet) { const f = t.dataset.bdSet, v = t.dataset.value; return commit((s) => { s[f] = v; }); }
      if (t.dataset.bdToggle) {
        const f = t.dataset.bdToggle, v = t.dataset.value;
        return commit((s) => {
          const list = new Set(s[f]); if (list.has(v)) list.delete(v); else list.add(v);
          if (v === 'pearls_gold' && list.has(v)) list.delete('pearls_silver');
          if (v === 'pearls_silver' && list.has(v)) list.delete('pearls_gold');
          s[f] = [...list];
        });
      }
      if (t.dataset.bdSuggest) { const text = t.dataset.bdSuggest; return commit((s) => { s.message = text; }); }
      if (t.dataset.bdQty) return commit((s) => { s.qty += Number(t.dataset.bdQty); });
      if (t.dataset.bdView) { view3d = t.dataset.bdView === '3d'; syncViewButtons(); if (view3d) ensureScene(); return renderPreview(); }
      if ('bdResetview' in t.dataset) return scene?.resetView();
      if ('bdUndo' in t.dataset) return undo();
      if ('bdRedo' in t.dataset) return redo();
      if ('bdReset' in t.dataset) return resetDesign();
      if ('bdChat' in t.dataset) return openChat();
      if ('bdExit' in t.dataset) return exit();
      if ('bdPrev' in t.dataset) { const i = STEPS.findIndex(([k]) => k === step); return goStep(STEPS[Math.max(0, i - 1)][0]); }
      if ('bdNext' in t.dataset) { const i = STEPS.findIndex(([k]) => k === step); return i < STEPS.length - 1 ? goStep(STEPS[i + 1][0]) : addToCart(); }
    });
    root.addEventListener('input', (e) => {
      const f = e.target.dataset.bdText; if (!f) return;
      let value = e.target.value;
      if (f === 'message') {
        const maxLines = Number(cfg().message_max_lines || 3);
        const lines = value.split('\n'); if (lines.length > maxLines) { value = lines.slice(0, maxLines).join('\n'); e.target.value = value; }
      }
      if (f === 'topper_text') { value = value.replace(/\D/g, '').slice(0, 3); e.target.value = value; }
      const first = !textTimer; clearTimeout(textTimer);
      commit((s) => { s[f] = value; }, { soft: !first });
      textTimer = setTimeout(() => { textTimer = 0; }, 800);
    });
    root.addEventListener('keydown', (e) => {
      if (e.target.closest('[role=tablist]') && ['ArrowLeft', 'ArrowRight'].includes(e.key)) {
        const i = STEPS.findIndex(([k]) => k === step); const n = STEPS[(i + (e.key === 'ArrowRight' ? 1 : STEPS.length - 1)) % STEPS.length][0];
        goStep(n, false); root.querySelector(`[data-bd-step="${n}"]`).focus();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.target.matches('textarea,input')) { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    });
    // Hide the fixed price bar while the phone keyboard is open, so it never covers the text field.
    const typing = (on) => root.classList.toggle('is-typing', on);
    root.addEventListener('focusin', (e) => { if (e.target.matches('textarea,input')) typing(true); });
    root.addEventListener('input', (e) => { if (e.target.matches('textarea,input')) typing(true); });
    root.addEventListener('focusout', (e) => { if (e.target.matches('textarea,input')) typing(false); });
    window.visualViewport?.addEventListener('resize', () => {
      if (currentPage !== 'bento') return;
      const keyboard = window.visualViewport.height < window.innerHeight * 0.75;
      typing(keyboard && document.activeElement?.matches?.('#page-bento textarea, #page-bento input'));
    });
  }

  // ---- chat, cart -------------------------------------------------------------------------------
  function openChat() {
    const toggle = document.getElementById('customer-chat-toggle');
    if (!toggle) { showToast('Chat is loading. Try again in a moment.'); return; }
    if (!window.currentUser) { showToast('Log in to chat with LexC’s — your design is saved on this device.'); saveDraft(); return; }
    toggle.click();
    try { navigator.clipboard?.writeText(`Bento design: ${summaryText()}`); showToast('Design details copied — paste them into the chat if you like.'); } catch {}
  }
  async function addToCart() {
    if (quote.status !== 'ok') return;
    if (cart.some((i) => i.isTest)) return showToast('Payment Test Product must be checked out separately.');
    const v = variant(); const d = design();
    const item = {
      id: 'bento-' + crypto.randomUUID(), product_id: product.id, variant_id: v.id, name: product.name, emoji: '🎂',
      sizeLabel: `${v.label === 'Minimalist' ? 'Plain' : v.label} · ${quote.clean.summary}`, price: Number(v.price) + quote.extra,
      base_price: Number(v.price), extras: quote.extra, qty: state.qty, selected: true, customization: d, preview: scene ? scene.snapshot(160) : ''
    };
    if (editIndex !== null && cart[editIndex]?.customization?.designer === 'bento') { item.id = cart[editIndex].id; cart[editIndex] = item; }
    else cart.push(item);
    const wasEdit = editIndex !== null;
    editIndex = null;
    try { localStorage.removeItem(DRAFT_KEY); } catch {}
    renderCart(); showToast(wasEdit ? 'Your cart design was updated.' : 'Your bento design was added to the cart.');
    navigate('shop'); openCart();
  }

  // ---- open / close -----------------------------------------------------------------------------
  function ensureRoot() {
    root = document.getElementById('page-bento');
    if (!root.dataset.bound) { root.dataset.bound = '1'; shell(); bind(); }
  }
  async function start({ fromCart = null } = {}) {
    ensureRoot();
    product = bentoProduct();
    if (!product) { showToast('The bento designer is not available right now.'); navigate('shop'); return; }
    root.querySelector('#bd-body').innerHTML = '<div class="skel skel-title" style="margin:8px 0 16px"></div><div class="skel skel-line"></div><div class="skel skel-line skel-line--long" style="margin-top:10px"></div>';
    try { await loadOptions(); }
    catch (error) {
      console.warn('Design options could not load:', error);
      root.querySelector('#bd-body').innerHTML = '<div role="alert"><p><strong>The designer could not load.</strong></p><p class="bd-note">Check your connection and try again.</p><button type="button" class="bd-secondary" data-bd-retry>Try again</button></div>';
      root.querySelector('[data-bd-retry]').onclick = () => start({ fromCart });
      return;
    }
    past = []; future = []; editIndex = null;
    if (fromCart !== null && cart[fromCart]?.customization?.designer === 'bento') {
      const c = cart[fromCart]; editIndex = fromCart;
      state = { ...blank(), ...c.customization, border: [...(c.customization.border || [])], accents: [...(c.customization.accents || [])], message: c.customization.message || '', topper_text: c.customization.topper_text || '', variant_id: c.variant_id, qty: c.qty };
      if (!state.bow_color) state.bow_color = 'pink'; if (!state.lettering) state.lettering = 'piped'; if (!state.lettering_color) state.lettering_color = 'purple';
      step = 'review';
    } else {
      let draft = null; try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch {}
      state = draft?.product_id === product.id ? { ...blank(), ...draft.state } : blank();
      step = draft?.product_id === product.id && STEPS.some(([k]) => k === draft.step) ? draft.step : 'style';
      if (draft?.product_id === product.id) showToast('Your saved design was restored.');
    }
    normalise(); lastHadMessage = !!state.message.trim();
    renderBody(); syncViewButtons(); renderPreview(); scheduleQuote();
    if (view3d) ensureScene();
  }
  function exit() {
    const p = products.find((x) => x.product_id === product?.id);
    navigate('shop');
    if (p) setTimeout(() => openProductDetails(p.id), 50);
  }
  function leave() { disposeScene(); clearTimeout(quoteTimer); quoteSeq++; }

  const baseNavigate = window.navigate;
  window.navigate = function navigate(page, anchor) {
    if (currentPage === 'bento' && page !== 'bento') leave();
    return baseNavigate.call(this, page, anchor);
  };
  function whenReady(fn) {
    if (window.lexcCatalogState === 'ready') return fn();
    let waited = 0; const t = setInterval(() => { waited += 200; if (window.lexcCatalogState === 'ready') { clearInterval(t); fn(); } else if (waited > 15000) { clearInterval(t); showToast('The menu could not load. Please try again.'); } }, 200);
  }
  window.LexcBento = Object.freeze({
    open() { whenReady(() => { navigate('bento'); start(); }); },
    edit(index) { window.closeCart?.(); whenReady(() => { navigate('bento'); start({ fromCart: index }); }); },
    isDesignable: (productId) => (typeof liveCatalog !== 'undefined' ? liveCatalog : []).some((p) => p.id === productId && p.customization_config?.designer === 'bento')
  });
  if (new URL(location.href).searchParams.has('design')) { const u = new URL(location.href); u.searchParams.delete('design'); window.history.replaceState(window.history.state, '', u); window.LexcBento.open(); }
})();
