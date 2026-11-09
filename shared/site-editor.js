// Edit the website in place (phase 104): Admin → "Edit website" opens the real site with ?cms=live. For a signed-in
// Admin the whole page becomes editable — click any text to type, click an image to replace it, hover a section to
// hide or move it. Changes are drafts: Save keeps them, Publish shows them to visitors, Discard throws them away.
// Visitors never load this file's effects (it does nothing unless an Admin opened ?cms=live). Uses the same section
// map as before (shared/site-cms-schema.js) and the same database functions (save_site_draft, publish_site_page…).
(function () {
  if (new URLSearchParams(location.search).get('cms') !== 'live') return;
  const S = () => window.LexcSiteSchema, C = () => window.LexcSiteCms, db = () => window.LexcBackend;
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dirty = new Set(); let editing = true, bar = null, busy = false, admin = false;   // nothing reacts until the Admin check passes
  const keyOf = (p, s) => p.id + '/' + s.id;
  const get = (key) => structuredClone(C().content()[key] || {});
  const put = (key, c) => { dirty.add(key); C().set(key, c); mark(); status(); };

  // ---------------- toolbar
  function toolbar() {
    bar = document.createElement('div'); bar.className = 'se-bar'; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Website editor');
    bar.innerHTML = `<strong>Editing website</strong>
      <select data-se-page aria-label="Page to edit">${S().PAGES.filter((p) => p.id !== 'global').map((p) => `<option value="${p.id}">${esc(p.label)}</option>`).join('')}</select>
      <span class="se-state" data-se-state>Published</span>
      <label class="se-toggle"><input type="checkbox" data-se-edit checked> Edit mode</label>
      <span class="se-grow"></span>
      <button type="button" data-se-fonts>Fonts</button>
      <a href="admin/#website/faqs">FAQs</a>
      <button type="button" data-se-discard>Discard</button>
      <button type="button" data-se-save>Save draft</button>
      <button type="button" class="is-primary" data-se-publish>Publish</button>
      <a href="admin/" data-se-exit>Exit</a>`;
    document.body.prepend(bar); document.documentElement.classList.add('se-on');
    bar.addEventListener('change', (ev) => {
      if (ev.target.matches('[data-se-edit]')) { editing = ev.target.checked; document.documentElement.classList.toggle('se-on', editing); mark(); }
      if (ev.target.matches('[data-se-page]')) goPage(ev.target.value);
    });
    bar.addEventListener('click', (ev) => {
      const b = ev.target.closest('button,a'); if (!b) return;
      if (b.matches('[data-se-save]')) save();
      if (b.matches('[data-se-publish]')) publish();
      if (b.matches('[data-se-discard]')) discard();
      if (b.matches('[data-se-fonts]')) fonts();
      if (b.matches('[data-se-exit]') && dirty.size && !confirm('You have unsaved changes. Leave without saving?')) ev.preventDefault();
    });
    window.addEventListener('beforeunload', (ev) => { if (dirty.size) { ev.preventDefault(); ev.returnValue = ''; } });
  }
  function status(text) {
    const el = bar?.querySelector('[data-se-state]'); if (!el) return;
    if (text) { el.textContent = text; return; }
    el.className = 'se-state ' + (dirty.size ? 'is-dirty' : 'is-live');
    el.textContent = dirty.size ? `Unsaved changes (${dirty.size})` : 'All saved';
    bar.querySelector('[data-se-save]').disabled = !dirty.size;
  }
  function goPage(id) {
    const p = S().page(id); if (!p) return;
    if (p.route === 'register') { window.navigate?.('register'); setTimeout(() => { const d = document.getElementById('regTermsDialog'); if (d && !d.open) d.show(); d?.querySelectorAll('details').forEach((x) => { x.open = true; }); mark(); }, 350); }   // every Terms section open to edit
    else { window.navigate?.(p.route); setTimeout(mark, 350); }
  }

  // ---------------- make the page editable
  function mark() {
    document.querySelectorAll('.se-text,.se-img,.se-sec').forEach((el) => { el.classList.remove('se-text', 'se-img', 'se-sec', 'se-off'); el.removeAttribute('contenteditable'); });
    document.querySelectorAll('.se-chip').forEach((x) => x.remove());
    if (!editing) return;
    for (const p of S().PAGES) for (const sec of p.sections) {
      const root = sec.el && document.querySelector(sec.el); if (!root) continue;
      const key = keyOf(p, sec), c = C().content()[key] || {};
      root.classList.add('se-sec'); root.classList.toggle('se-off', c.settings?.visible === false); root.dataset.seKey = key;
      for (const f of sec.fields) {
        const els = f.sel ? root.querySelectorAll(f.sel) : [root];
        els.forEach((el) => {
          if (['text', 'rich', 'paras'].includes(f.type)) { el.classList.add('se-text'); el.dataset.seField = key + '|' + f.k; }
          if (f.type === 'image' && !f.mobile && el.tagName === 'IMG') { el.classList.add('se-img'); el.dataset.seField = key + '|' + f.k; }
          if (f.type === 'bg' && !f.mobile) { el.classList.add('se-img'); el.dataset.seField = key + '|' + f.k; }
        });
      }
      const chip = document.createElement('div'); chip.className = 'se-chip'; chip.contentEditable = 'false';
      chip.innerHTML = `<span>${esc(sec.label)}${c.settings?.visible === false ? ' · hidden' : ''}</span>
        <button type="button" data-se-hide="${key}">${c.settings?.visible === false ? 'Show' : 'Hide'}</button>
        ${sec.movable ? `<button type="button" data-se-move="-1" data-se-key="${key}" aria-label="Move up">↑</button><button type="button" data-se-move="1" data-se-key="${key}" aria-label="Move down">↓</button>` : ''}
        ${sec.fields.some((f) => f.type === 'link') ? `<button type="button" data-se-link="${key}">Button link</button>` : ''}
        ${sec.style.length ? `<button type="button" data-se-style="${key}">Style</button>` : ''}
        ${sec.fields.some((f) => f.mobile) ? `<button type="button" data-se-mobile="${key}">Phone image</button>` : ''}`;
      if (getComputedStyle(root).position === 'static') root.style.position = 'relative';
      root.append(chip);
    }
  }
  const fieldOf = (el) => { const [key, k] = (el.dataset.seField || '').split('|'); const [p, s] = key.split('/'); return { key, k, sec: S().section(p, s), f: S().section(p, s)?.fields.find((x) => x.k === k) }; };
  // text: the element's text back to the stored format (**bold**, *italic*, line breaks; nothing else survives)
  function textOf(el, type) {
    const clone = el.cloneNode(true); clone.querySelectorAll('svg,.se-chip').forEach((x) => x.remove());
    if (type === 'paras') return [...clone.querySelectorAll('p')].map((p) => md(p)).join('\n\n') || md(clone);
    return type === 'rich' ? md(clone) : clone.textContent.trim();
  }
  function md(node) {
    let out = '';
    node.childNodes.forEach((n) => {
      if (n.nodeType === 3) out += n.textContent;
      else if (n.nodeName === 'BR') out += '\n';
      else if (n.nodeName === 'STRONG' || n.nodeName === 'B') out += '**' + n.textContent + '**';
      else if (n.nodeName === 'EM' || n.nodeName === 'I') out += '*' + n.textContent + '*';
      else if (n.nodeName === 'DIV' || n.nodeName === 'P') out += (out ? '\n' : '') + md(n);
      else out += n.textContent;
    });
    return out.replace(/ /g, ' ').trim();
  }

  document.addEventListener('click', async (ev) => {
    if (!admin || !editing || ev.target.closest('.se-bar,.se-pop')) return;
    const chipBtn = ev.target.closest('.se-chip button');
    if (chipBtn) { ev.preventDefault(); ev.stopImmediatePropagation(); chipAction(chipBtn); return; }
    const text = ev.target.closest('.se-text'), img = ev.target.closest('.se-img');
    if (ev.target.closest('.se-sec')) { ev.preventDefault(); ev.stopImmediatePropagation(); }   // links and buttons don't navigate while editing
    if (text && !text.isContentEditable) {
      text.contentEditable = 'true'; text.focus();
      const sel = getSelection(), r = document.caretRangeFromPoint?.(ev.clientX, ev.clientY); if (r) { sel.removeAllRanges(); sel.addRange(r); }
      text.addEventListener('blur', () => {
        text.removeAttribute('contenteditable');
        const { key, k, f } = fieldOf(text), v = textOf(text, f.type), c = get(key);
        if ((c.fields?.[k] ?? null) === v) return;
        c.fields = { ...(c.fields || {}), [k]: v }; put(key, c);
      }, { once: true });
    } else if (img) pickImage(fieldOf(img));
  }, true);
  document.addEventListener('keydown', (ev) => {
    const t = ev.target; if (!admin || !t.classList?.contains('se-text') || !t.isContentEditable) return;
    const { f } = fieldOf(t);
    if (ev.key === 'Enter' && f.type === 'text') { ev.preventDefault(); t.blur(); }
    if (ev.key === 'Escape') { t.blur(); }
    if ((ev.ctrlKey || ev.metaKey) && ['b', 'i'].includes(ev.key.toLowerCase()) && f.type === 'text') ev.preventDefault();
  });
  document.addEventListener('paste', (ev) => {   // paste as plain text only
    const t = ev.target.closest?.('.se-text'); if (!admin || !t?.isContentEditable) return;
    ev.preventDefault(); document.execCommand('insertText', false, ev.clipboardData.getData('text/plain'));
  });

  function pickImage({ key, k }) {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/jpeg,image/png,image/webp' });
    input.onchange = async () => {
      const file = input.files?.[0]; if (!file) return;
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) return alert('Use a JPG, PNG or WebP image up to 5 MB.');
      status('Uploading…');
      const path = `cms/${key.split('/')[0]}/${crypto.randomUUID()}.${file.type.split('/')[1].replace('jpeg', 'jpg')}`;
      const { error } = await db().client.storage.from('site-media').upload(path, file, { contentType: file.type, cacheControl: '31536000', upsert: false });
      if (error) { status(); return alert(error.message); }
      const c = get(key); c.fields = { ...(c.fields || {}), [k]: path }; put(key, c);
    };
    input.click();
  }
  function popover(anchor, html, onSave) {
    document.querySelector('.se-pop')?.remove();
    const pop = document.createElement('form'); pop.className = 'se-pop'; pop.innerHTML = html + '<div class="se-pop-actions"><button type="button" data-cancel>Cancel</button><button type="submit" class="is-primary">Apply</button></div>';
    document.body.append(pop);
    const r = anchor.getBoundingClientRect(); pop.style.top = Math.min(innerHeight - 20 - pop.offsetHeight, r.bottom + 6) + 'px'; pop.style.left = Math.max(10, Math.min(innerWidth - pop.offsetWidth - 10, r.left)) + 'px';
    pop.querySelector('[data-cancel]').onclick = () => pop.remove();
    pop.onsubmit = (ev) => { ev.preventDefault(); onSave(new FormData(pop)); pop.remove(); };
    pop.querySelector('input,select,textarea')?.focus();
  }
  function chipAction(b) {
    const key = b.dataset.seHide || b.dataset.seKey || b.dataset.seLink || b.dataset.seStyle || b.dataset.seMobile, c = get(key);
    const [p, s] = key.split('/'), sec = S().section(p, s);
    if (b.dataset.seHide) {
      const hide = c.settings?.visible !== false;
      if (hide && sec.legal && !confirm('This is legal text customers agree to. Hide it anyway?')) return;
      c.settings = { ...(c.settings || {}), visible: !hide }; put(key, c);
    }
    if (b.dataset.seMove) {
      const page = S().page(p), list = page.sections.filter((x) => x.movable).map((x, i) => ({ x, o: C().content()[keyOf(page, x)]?.settings?.order ?? i })).sort((a, b2) => a.o - b2.o).map((y) => y.x);
      const i = list.indexOf(sec), j = i + Number(b.dataset.seMove); if (j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      list.forEach((x, n) => { const k = keyOf(page, x), cc = get(k); if (cc.settings?.order === n) return; cc.settings = { ...(cc.settings || {}), order: n }; put(k, cc); });
    }
    if (b.dataset.seLink) {
      const f = sec.fields.find((x) => x.type === 'link');
      popover(b, `<label>${esc(f.label)}<input name="v" value="${esc(c.fields?.[f.k] || '')}" placeholder="${esc(f.placeholder || '?page=shop')}"></label><small>A page like ?page=shop, or a full https:// address. Empty = as before.</small>`,
        (fd) => { c.fields = { ...(c.fields || {}), [f.k]: fd.get('v').trim() }; put(key, c); });
    }
    if (b.dataset.seMobile) pickImage({ key, k: sec.fields.find((x) => x.mobile).k });
    if (b.dataset.seStyle) {
      const st = c.style || {}, set = c.settings || {};
      const color = (n, l) => sec.style.includes(n) ? `<label>${l}<span class="se-color"><input type="color" name="${n}" value="${esc(st[n] || '#2b1530')}"><label><input type="checkbox" name="${n}_off" ${st[n] ? '' : 'checked'}> default</label></span></label>` : '';
      popover(b, `${sec.style.includes('align') ? `<label>Text alignment<select name="align">${[['', 'Default'], ['left', 'Left'], ['center', 'Center'], ['right', 'Right']].map(([v, l]) => `<option value="${v}" ${(st.align || '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>` : ''}
        ${sec.style.includes('heading_size') ? `<label>Heading size<select name="heading_size">${[['', 'Default'], ['sm', 'Smaller'], ['lg', 'Larger']].map(([v, l]) => `<option value="${v}" ${(st.heading_size || '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>` : ''}
        ${sec.style.includes('spacing') ? `<label>Spacing<select name="spacing">${[['', 'Default'], ['compact', 'Compact'], ['roomy', 'Roomy']].map(([v, l]) => `<option value="${v}" ${(st.spacing || '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>` : ''}
        ${color('text_color', 'Text color')}${color('heading_color', 'Heading color')}${color('bg_color', 'Background')}
        <label class="se-row"><input type="checkbox" name="hide_mobile" ${set.hide_mobile ? 'checked' : ''}> Hide on phones</label><label class="se-row"><input type="checkbox" name="hide_desktop" ${set.hide_desktop ? 'checked' : ''}> Hide on computers</label>`,
        (fd) => {
          const next = {}; for (const n of ['align', 'heading_size', 'spacing']) if (fd.get(n)) next[n] = fd.get(n);
          for (const n of ['text_color', 'heading_color', 'bg_color']) if (sec.style.includes(n) && !fd.get(n + '_off')) next[n] = fd.get(n);
          c.style = next; c.settings = { ...set, hide_mobile: !!fd.get('hide_mobile'), hide_desktop: !!fd.get('hide_desktop') }; put(key, c);
        });
    }
  }
  function fonts() {
    const key = 'global/theme', c = get(key), F = S().FONTS, url = S().fontUrl(F.map((f) => f.id));
    if (url && !document.getElementById('seFontPreview')) document.head.append(Object.assign(document.createElement('link'), { id: 'seFontPreview', rel: 'stylesheet', href: url }));
    const pick = (name, cur) => F.map((f) => `<label class="se-font"><input type="radio" name="${name}" value="${f.id}" ${(cur || 'brand') === f.id ? 'checked' : ''}><span style="${f.css ? 'font-family:' + esc(f.css) : ''}"><b>${esc(f.label)}</b> Made for sweet moments</span></label>`).join('');
    popover(bar.querySelector('[data-se-fonts]'), `<fieldset><legend>Headings</legend>${pick('heading_font', c.fields?.heading_font)}</fieldset><fieldset><legend>Body text</legend>${pick('body_font', c.fields?.body_font)}</fieldset>`,
      (fd) => { c.fields = { heading_font: fd.get('heading_font'), body_font: fd.get('body_font') }; put(key, c); });
  }

  // ---------------- save / publish / discard
  async function save() {
    if (busy || !dirty.size) return; busy = true; status('Saving…');
    try { for (const key of [...dirty]) { const [p, s] = key.split('/'); await db().rpc('save_site_draft', { target_page: p, target_section: s, content: C().content()[key] || {} }); dirty.delete(key); } status(); toast('Saved. Publish when you’re ready.'); }
    catch (error) { status(); alert(error.message); } finally { busy = false; }
  }
  async function publish() {
    if (!confirm('Publish? Visitors will see your saved changes right away.')) return;
    await save(); if (dirty.size) return;
    status('Publishing…');
    try { let n = 0; for (const p of S().PAGES) n += await db().rpc('publish_site_page', { target_page: p.id }); status(); toast(n ? 'Published. Visitors now see your changes.' : 'Nothing new to publish.'); }
    catch (error) { status(); alert(error.message); }
  }
  async function discard() {
    if (!confirm('Throw away unsaved changes and saved drafts that aren’t published? What visitors see stays the same.')) return;
    try { for (const p of S().PAGES) await db().rpc('discard_site_drafts', { target_page: p.id }); dirty.clear(); location.reload(); } catch (error) { alert(error.message); }
  }
  function toast(t) { const el = document.createElement('div'); el.className = 'se-toast'; el.textContent = t; document.body.append(el); setTimeout(() => el.remove(), 3500); }

  // ---------------- start: only for a signed-in Admin
  async function start() {
    if (!S() || !C() || !db()) return setTimeout(start, 200);
    const me = await db().identity().catch(() => null);
    if (me?.role !== 'admin') { const u = new URL(location.href); u.searchParams.delete('cms'); history.replaceState(null, '', u); return; }
    document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: 'shared/site-editor.css?v=2' }));
    admin = true; toolbar(); status(); setTimeout(mark, 600);
    // the page re-renders parts (navigation, async sections): keep the markers on
    const ours = (n) => n.nodeType !== 1 || n.classList?.contains('se-chip') || n.classList?.contains('se-pop') || n.classList?.contains('se-toast');
    let t = 0; new MutationObserver((list) => {
      if (list.every((m) => [...m.addedNodes, ...m.removedNodes].every(ours))) return;   // our own labels and popups
      clearTimeout(t); t = setTimeout(() => { if (!document.querySelector('[contenteditable=true]')) mark(); }, 400);
    }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
