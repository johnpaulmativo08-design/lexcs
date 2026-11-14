// Website CMS on the site (phase 104). Visitors get the PUBLISHED content (public.get_site_content), the active FAQs
// and the announcements that are live now. Inside Admin → Edit Website the site runs in a frame with ?cms=edit:
// it shows the DRAFTS (Admin only), outlines the sections in Edit Mode, and talks to the editor with postMessage.
// Text is always written as text (or the tiny **bold** / *italic* / line-break format, everything else escaped).
(function () {
  const S = () => window.LexcSiteSchema;
  const params = new URLSearchParams(location.search);
  const framed = window.parent !== window && params.get('cms') === 'edit';
  const live = params.get('cms') === 'live';   // the Admin editing the site in place (shared/site-editor.js)
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rich = (v) => esc(v).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>').replace(/\n/g, '<br>');
  const safeLink = (v) => !v || /^(https?:\/\/|mailto:|tel:|#|\/|\?|[a-z0-9][a-z0-9/_.-]*(\?[^ <>"']*)?$)/i.test(v) && !/^\s*(javascript|data|vbscript):/i.test(v);
  const MEDIA = () => (window.LexcSupabaseConfig?.url || '').replace(/\/+$/, '') + '/storage/v1/object/public/site-media/';
  const imgUrl = (v) => !v ? '' : /^https?:\/\//.test(v) ? v : MEDIA() + v.split('/').map(encodeURIComponent).join('/');
  const originals = new Map();   // element -> what the page had, so a removed draft value goes back to the built-in one
  const remember = (el) => { if (!originals.has(el)) originals.set(el, { html: el.innerHTML, src: el.getAttribute('src'), srcset: el.getAttribute('srcset'), href: el.getAttribute('href'), alt: el.getAttribute('alt'), style: el.getAttribute('style') }); return originals.get(el); };
  let content = {}, editing = false, picked = null;

  function setText(el, text, isRich) {
    const o = remember(el);
    if (text == null || text === '') { el.innerHTML = o.html; return; }
    const icon = el.querySelector(':scope > svg');                                    // buttons keep their arrow icon
    el.innerHTML = (isRich ? rich(text) : esc(text)) + (icon ? ' ' + icon.outerHTML : '');
  }
  function applySection(pageId, sec, data) {
    const root = sec.el ? document.querySelector(sec.el) : null;
    if (!root) return;
    const f = data?.fields || {}, st = data?.style || {}, set = data?.settings || {};
    for (const field of sec.fields) {
      const els = field.sel ? root.querySelectorAll(field.sel) : [root]; if (!els.length) continue;
      const v = f[field.k];
      els.forEach((el) => {
        const o = remember(el);
        if (field.type === 'text' || field.type === 'rich') setText(el, v, field.type === 'rich');
        else if (field.type === 'paras') el.innerHTML = v ? String(v).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${rich(p)}</p>`).join('') : o.html;
        else if (field.type === 'image') {
          if (field.mobile) { v ? el.setAttribute('srcset', imgUrl(v)) : o.srcset != null && el.setAttribute('srcset', o.srcset); }
          else if (v) { el.setAttribute('src', imgUrl(v)); el.removeAttribute('srcset'); } else { if (o.src != null) el.setAttribute('src', o.src); if (o.srcset != null) el.setAttribute('srcset', o.srcset); }
        } else if (field.type === 'alt') { v ? el.setAttribute('alt', v) : o.alt != null && el.setAttribute('alt', o.alt); }
        else if (field.type === 'bg') { if (v) el.style.setProperty(field.css, `url('${imgUrl(v).replace(/'/g, '%27')}')`); else if (o.style != null) el.setAttribute('style', o.style); }
        else if (field.type === 'link') { if (v && safeLink(v)) { el.dataset.cmsHref = v; if (el.tagName === 'A') el.setAttribute('href', v); } else { delete el.dataset.cmsHref; if (o.href != null) el.setAttribute('href', o.href); } }
      });
    }
    // style: only what the section offers
    const heads = root.querySelectorAll('h1, h2, .ed-title, .section-title, .carousel-title');
    root.style.textAlign = st.align || '';
    root.style.color = st.text_color || '';
    root.style.background = st.bg_color || '';
    root.style.paddingBlock = st.spacing === 'compact' ? '40px' : st.spacing === 'roomy' ? '140px' : '';
    heads.forEach((h) => { h.style.color = st.heading_color || ''; h.style.fontSize = st.heading_size === 'sm' ? '0.85em' : st.heading_size === 'lg' ? '1.2em' : ''; });
    // settings: visibility per device
    root.classList.toggle('cms-hidden', set.visible === false);
    root.classList.toggle('cms-hide-m', !!set.hide_mobile);
    root.classList.toggle('cms-hide-d', !!set.hide_desktop);
  }
  function applyOrder() {
    const home = S()?.page('home'); if (!home) return;
    const movable = home.sections.filter((s) => s.movable).map((s) => ({ s, el: document.querySelector(s.el), order: content['home/' + s.id]?.settings?.order })).filter((x) => x.el);
    if (!movable.some((x) => Number.isFinite(x.order))) return;
    const parent = movable[0].el.parentElement, after = parent.querySelector('.lp-footer');
    movable.map((x, i) => ({ ...x, o: Number.isFinite(x.order) ? x.order : i })).sort((a, b) => a.o - b.o).forEach((x) => parent.insertBefore(x.el, after));
  }
  function applyFonts() {
    const t = content['global/theme']?.fields || {}, F = S()?.FONTS || [];
    const head = F.find((f) => f.id === t.heading_font), body = F.find((f) => f.id === t.body_font);
    let link = document.getElementById('cmsFonts'); const url = S()?.fontUrl([t.heading_font, t.body_font]);
    if (url) { if (!link) { link = Object.assign(document.createElement('link'), { id: 'cmsFonts', rel: 'stylesheet' }); document.head.append(link); } link.href = url; }
    let css = document.getElementById('cmsFontCss'); if (!css) { css = Object.assign(document.createElement('style'), { id: 'cmsFontCss' }); document.head.append(css); }
    css.textContent = (body?.css ? `body,button,input,select,textarea{font-family:${body.css}}` : '') +
      (head?.css ? `h1,h2,h3,.ed-title,.lp-title,.section-title,.carousel-title,.reg-title{font-family:${head.css}}` : '');
  }
  function applyAll() {
    if (!S()) return;
    for (const p of S().PAGES) for (const sec of p.sections) if (sec.el) applySection(p.id, sec, content[p.id + '/' + sec.id]);
    applyOrder(); applyFonts();
  }
  // FAQs from the database (phase 104); the built-in list stays if the table is empty or not set up
  async function faqs() {
    try {
      const { data, error } = await window.LexcBackend.client.from('site_faqs').select('question,answer,sort_order').eq('is_active', true).order('sort_order').limit(12);
      if (error || !data?.length) return;
      const list = document.querySelector('#page-faq .faq-list'); if (!list) return;
      list.innerHTML = data.map((f) => `<div class="faq-item"><button class="faq-question">${esc(f.question)} <span class="faq-chevron">▾</span></button><div class="faq-answer">${esc(f.answer)}</div></div>`).join('');
      window.initFaq?.();
    } catch {}
  }
  // announcements: published and within their dates (the database only returns those to visitors)
  async function announcements() {
    try {
      const { data } = await window.LexcBackend.client.from('site_announcements').select('id,title,body,image_path,link_url,button_text,status,starts_at,ends_at').eq('status', 'published').order('starts_at', { ascending: false, nullsFirst: false }).limit(3);
      const now = Date.now(), now_ = (data || []).filter((a) => (!a.starts_at || Date.parse(a.starts_at) <= now) && (!a.ends_at || Date.parse(a.ends_at) > now));
      let seen = []; try { seen = JSON.parse(localStorage.getItem('lexc_ann_closed') || '[]'); } catch {}
      const a = now_.find((x) => !seen.includes(x.id)); if (!a || framed || live) return;
      const bar = document.createElement('aside'); bar.className = 'cms-ann'; bar.setAttribute('aria-label', 'Announcement');
      bar.innerHTML = `${a.image_path ? `<img src="${esc(imgUrl(a.image_path))}" alt="" width="40" height="40">` : ''}<p><strong>${esc(a.title)}</strong>${a.body ? ' ' + esc(a.body) : ''}</p>${a.link_url && safeLink(a.link_url) ? `<a href="${esc(a.link_url)}">${esc(a.button_text || 'Learn more')}</a>` : ''}<button type="button" aria-label="Close announcement">×</button>`;
      bar.querySelector('button').onclick = () => { bar.remove(); try { localStorage.setItem('lexc_ann_closed', JSON.stringify([...seen, a.id].slice(-20))); } catch {} };
      document.body.prepend(bar);
    } catch {}
  }
  // buttons given a link in the CMS open it (buttons without one keep their own behaviour)
  document.addEventListener('click', (ev) => {
    if (editing) return;
    const b = ev.target.closest?.('button[data-cms-href]'); if (!b) return;
    ev.preventDefault(); ev.stopImmediatePropagation();
    const href = b.dataset.cmsHref; if (safeLink(href)) location.href = href;
  }, true);

  // ---------------- editor frame: drafts, Edit Mode outlines, messages with Admin → Edit Website ----------------
  function keyOf(el) {
    for (const p of S().PAGES) for (const sec of p.sections) if (sec.el && el.closest(sec.el)) return p.id + '/' + sec.id;
    return null;
  }
  function outline() {
    document.querySelectorAll('.cms-sec').forEach((x) => x.classList.remove('cms-sec', 'cms-picked'));
    if (!editing) return;
    for (const p of S().PAGES) for (const sec of p.sections) { const el = sec.el && document.querySelector(sec.el); if (el) { el.classList.add('cms-sec'); el.dataset.cmsLabel = sec.label; el.classList.toggle('cms-picked', picked === p.id + '/' + sec.id); } }
  }
  async function loadDrafts() {
    try {
      const { data } = await window.LexcBackend.client.from('site_content').select('page,section,draft');
      (data || []).forEach((r) => { content[r.page + '/' + r.section] = r.draft; });
    } catch {}
  }
  if (framed) {
    const style = document.createElement('style');
    style.textContent = '.cms-sec{outline:1.5px dashed rgba(138,99,210,.55);outline-offset:-3px;cursor:pointer;position:relative}.cms-sec:hover{outline:2px solid #8a63d2}.cms-picked{outline:3px solid #c9628f!important}.cms-sec::after{content:attr(data-cms-label);position:absolute;top:6px;left:6px;z-index:50;background:#8a63d2;color:#fff;font:700 11px/1.4 system-ui;padding:2px 8px;border-radius:999px;opacity:0;pointer-events:none;transition:opacity .15s}.cms-sec:hover::after,.cms-picked::after{opacity:1}.cms-picked::after{background:#c9628f}';
    document.head.append(style);
    document.addEventListener('click', (ev) => {
      if (!editing) return;
      const el = ev.target.closest?.('.cms-sec'); if (!el) return;
      ev.preventDefault(); ev.stopImmediatePropagation();
      picked = keyOf(el); outline();
      window.parent.postMessage({ cms: 'picked', key: picked }, location.origin);
    }, true);
    window.addEventListener('message', (ev) => {
      if (ev.origin !== location.origin || !ev.data?.cms) return;
      const m = ev.data;
      if (m.cms === 'mode') { editing = !!m.edit; outline(); }
      if (m.cms === 'preview') { content[m.key] = m.content; applyAll(); outline(); }
      if (m.cms === 'select') { picked = m.key; outline(); const [p, s] = m.key.split('/'); const el = S().section(p, s)?.el && document.querySelector(S().section(p, s).el); el?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      if (m.cms === 'goto') { if (m.route === 'register') { window.navigate?.('register'); setTimeout(() => document.getElementById('regTermsDialog')?.show?.(), 300); } else window.navigate?.(m.route); setTimeout(outline, 400); }
      if (m.cms === 'reload') { content = {}; start(); }
    });
  }
  async function start() {
    try {
      const { data } = await window.LexcBackend.client.rpc('get_site_content');
      content = data || {};
    } catch {}
    if (framed || live) await loadDrafts();
    applyAll(); faqs(); announcements();
    if (framed) { outline(); window.parent.postMessage({ cms: 'ready' }, location.origin); }
  }
  window.LexcSiteCms = { refresh: start, live, content: () => content, set: (key, c) => { content[key] = c; applyAll(); }, applyAll, imgUrl, rich };
  const go = () => (window.LexcBackend ? start() : setTimeout(go, 150));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
})();
