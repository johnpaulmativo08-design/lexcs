// Admin → Edit Website (phase 104). Pick a page, switch Edit Mode on, click a section in the live preview (or in the
// list), change its Content / Style / Settings, then Save draft and Publish. The preview is the real site in a frame
// (?cms=edit) showing drafts; visitors only ever see what is published. FAQs and announcements have their own lists.
// Writes: public.save_site_draft / publish_site_page / discard_site_drafts / reset_site_section; images go to the
// "site-media" bucket (Admin only). The section map is shared with the site: shared/site-cms-schema.js.
import { escapeHtml as e, icon } from '../components.js?v=5';
import { db } from '../backend-ui.js?v=3';
import { ask } from '../../shared/ask.js?v=2';

const SCHEMA = () => window.LexcSiteSchema;
let dirty = new Map();        // key -> unsaved content
let guardBound = false;

function loadSchema() {
  return SCHEMA() ? Promise.resolve() : new Promise((resolve, reject) => {
    const s = Object.assign(document.createElement('script'), { src: '../shared/site-cms-schema.js?v=1' });
    s.onload = resolve; s.onerror = reject; document.head.append(s);
  });
}
const toast = (t) => { const el = document.querySelector('#toast'); if (!el) return; el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { el.hidden = true; }, 4500); };
const STYLE_LABEL = { align: 'Text alignment', text_color: 'Text color', heading_color: 'Heading color', heading_size: 'Heading size', bg_color: 'Background color', spacing: 'Spacing' };

export async function renderWebsite(content, sub) {
  await loadSchema();
  if (!guardBound) {
    guardBound = true;
    window.addEventListener('beforeunload', (ev) => { if (dirty.size) { ev.preventDefault(); ev.returnValue = ''; } });
  }
  if (sub === 'faqs') return renderFaqs(content);
  if (sub === 'announcements') return renderAnnouncements(content);
  const page = SCHEMA().page(sub) || SCHEMA().page('home');
  if (dirty.size && !(await ask('You have unsaved changes on another page. Leave them?', { title: 'Unsaved changes', confirm: 'Leave without saving', tone: 'danger' }))) { history.back(); return; }
  dirty = new Map();
  let rows = new Map(), picked = null, tab = 'content', editMode = true, width = 'desktop';

  content.innerHTML = `<div class="ws">
    <header class="ws-bar">
      <div><small>Edit Website</small><h1>${e(page.label)}</h1></div>
      <span class="ws-state" data-state>Loading…</span>
      <div class="ws-tools">
        <label class="ws-toggle"><input type="checkbox" data-edit checked><span>Edit Mode</span></label>
        <div class="ws-seg" role="group" aria-label="Preview width">${['desktop', 'tablet', 'phone'].map((w) => `<button type="button" data-w="${w}" aria-pressed="${w === 'desktop'}">${w[0].toUpperCase() + w.slice(1)}</button>`).join('')}</div>
        <a class="button" href="../${page.route === 'home' ? '' : '?page=' + page.route}" target="_blank" rel="noopener">${icon('eye')} Live site</a>
        <button class="button" type="button" data-discard>Discard</button>
        <button class="button" type="button" data-save>Save draft</button>
        <button class="button primary" type="button" data-publish>Publish</button>
      </div>
    </header>
    <div class="ws-body">
      <div class="ws-stage"><div class="ws-frame is-desktop" data-frame-wrap><div class="ws-skel skel" aria-hidden="true"></div>
        <iframe title="Website preview" data-frame src="../?cms=edit&t=${Date.now()}"></iframe></div></div>
      <aside class="ws-panel" data-panel></aside>
    </div></div>`;
  const $ = (s) => content.querySelector(s), frame = $('[data-frame]');
  const post = (m) => frame.contentWindow?.postMessage(m, location.origin);
  const keyOf = (sec) => page.id + '/' + sec.id;
  const current = (key) => dirty.get(key) ?? rows.get(key)?.draft ?? {};

  async function loadRows() {
    const { data, error } = await db.client.from('site_content').select('page,section,draft,published,draft_updated_at,published_at').eq('page', page.id);
    if (error) throw error;
    rows = new Map((data || []).map((r) => [r.page + '/' + r.section, r]));
  }
  function state() {
    const unpublished = [...rows.values()].some((r) => JSON.stringify(r.draft) !== JSON.stringify(r.published));
    const el = $('[data-state]');
    el.className = 'ws-state ' + (dirty.size ? 'is-dirty' : unpublished ? 'is-draft' : 'is-live');
    el.textContent = dirty.size ? `Unsaved changes (${dirty.size})` : unpublished ? 'Saved — not published yet' : 'Published';
    $('[data-save]').disabled = !dirty.size; $('[data-discard]').disabled = !dirty.size && !unpublished; $('[data-publish]').disabled = !dirty.size && !unpublished;
  }
  function changed(key, next) { dirty.set(key, next); post({ cms: 'preview', key, content: next }); state(); }

  // ---------------- the panel: section list, or the picked section's Content / Style / Settings
  function panel() {
    const box = $('[data-panel]'), sec = picked && page.sections.find((s) => keyOf(s) === picked);
    if (!sec) {
      box.innerHTML = `<h2>Sections</h2><p class="ws-hint">${editMode ? 'Click a section in the preview, or pick one here.' : 'Turn Edit Mode on to pick sections in the preview.'}</p>
        <ol class="ws-list">${page.sections.map((s, i) => { const c = current(keyOf(s)), hidden = c.settings?.visible === false;
          return `<li><button type="button" data-pick="${e(keyOf(s))}"><b>${e(s.label)}</b>${hidden ? '<small>Hidden</small>' : rows.has(keyOf(s)) || dirty.has(keyOf(s)) ? '<small>Edited</small>' : ''}</button>
          ${s.movable ? `<span class="ws-move"><button type="button" data-up="${i}" aria-label="Move ${e(s.label)} up">↑</button><button type="button" data-down="${i}" aria-label="Move ${e(s.label)} down">↓</button></span>` : ''}</li>`; }).join('')}</ol>
        ${page.id === 'home' ? `<p class="ws-links"><a href="#website/faqs">Manage FAQs →</a><a href="#website/announcements">Announcements →</a></p>` : ''}`;
      return;
    }
    const key = keyOf(sec), c = current(key), f = c.fields || {}, st = c.style || {}, set = c.settings || {};
    const tabs = [['content', 'Content'], ['style', 'Style'], ['settings', 'Settings']].filter(([t]) => t !== 'style' || sec.style.length);
    let body = '';
    if (tab === 'content') body = sec.fields.map((fd) => field(fd, f[fd.k])).join('') + (sec.note ? `<p class="ws-hint">${e(sec.note)}</p>` : '') + (sec.faqs ? '<p class="ws-links"><a href="#website/faqs">Manage the questions →</a></p>' : '');
    if (tab === 'style') body = sec.style.map((s) => styleControl(s, st[s])).join('') || '<p class="ws-hint">This section has no style options.</p>';
    if (tab === 'settings') body = `<label class="ws-check"><input type="checkbox" data-set="visible" ${set.visible === false ? '' : 'checked'}> Show this section</label>
      <label class="ws-check"><input type="checkbox" data-set="hide_mobile" ${set.hide_mobile ? 'checked' : ''}> Hide on phones</label>
      <label class="ws-check"><input type="checkbox" data-set="hide_desktop" ${set.hide_desktop ? 'checked' : ''}> Hide on computers</label>
      ${sec.movable ? '<p class="ws-hint">Change the order with ↑ ↓ in the section list.</p>' : ''}
      <button type="button" class="button ws-reset" data-reset>Reset to the built-in content</button>`;
    box.innerHTML = `<button type="button" class="ws-back" data-unpick>← All sections</button><h2>${e(sec.label)}</h2>
      <div class="ws-tabs" role="tablist">${tabs.map(([t, l]) => `<button type="button" role="tab" aria-selected="${t === tab}" data-tab="${t}">${l}</button>`).join('')}</div>
      <form class="ws-form" data-form>${body}</form>`;
    const form = box.querySelector('[data-form]');
    form.addEventListener('input', (ev) => {
      const el = ev.target, next = structuredClone(current(key));
      if (el.dataset.f) { next.fields = { ...(next.fields || {}), [el.dataset.f]: el.value }; }
      if (el.dataset.s) { next.style = { ...(next.style || {}), [el.dataset.s]: el.value }; if (el.type === 'color') el.closest('.ws-color')?.querySelector('[data-clear-style]')?.removeAttribute('hidden'); }
      if (el.dataset.set) { next.settings = { ...(next.settings || {}), [el.dataset.set]: el.dataset.set === 'visible' ? el.checked : el.checked }; }
      if (el.dataset.set === 'visible' && !el.checked && sec.legal) { ask('This is legal text customers agree to. Hiding it removes it from sign-up.', { title: 'Hide the Terms?', confirm: 'Hide it', tone: 'danger' }).then((yes) => { if (yes) changed(key, next); else el.checked = true; }); return; }
      changed(key, next);
    });
    form.addEventListener('change', (ev) => { if (ev.target.type === 'file') upload(ev.target, key); if (ev.target.type === 'radio') form.dispatchEvent(new Event('input')); });
  }
  function field(fd, v) {
    const val = v ?? '';
    if (fd.type === 'image' || fd.type === 'bg') return `<div class="ws-field"><span>${e(fd.label)}</span><div class="ws-img">
      ${val ? `<img src="${e(mediaUrl(val))}" alt="">` : '<span class="ws-img-empty">Built-in image</span>'}
      <label class="button">${icon('plus')} ${val ? 'Replace' : 'Upload'}<input type="file" accept="image/jpeg,image/png,image/webp" data-upload="${e(fd.k)}" hidden></label>
      ${val ? `<button type="button" class="button" data-clear="${e(fd.k)}">Remove</button>` : ''}</div><small>JPG, PNG or WebP, up to 5 MB.</small></div>`;
    if (fd.type === 'font') return `<fieldset class="ws-fonts"><legend>${e(fd.label)}</legend>${SCHEMA().FONTS.map((ft) => `<label class="ws-font"><input type="radio" name="${e(fd.k)}" value="${e(ft.id)}" data-f="${e(fd.k)}" ${(val || 'brand') === ft.id ? 'checked' : ''}>
      <span style="${ft.css ? `font-family:${e(ft.css)}` : ''}"><b>${e(ft.label)}</b><i>Made for sweet moments</i><small>${e(ft.note)}</small></span></label>`).join('')}</fieldset>`;
    const long = fd.type === 'paras' || fd.type === 'rich' || /description|body|lede|paragraph/i.test(fd.label);
    return `<label class="ws-field"><span>${e(fd.label)}</span>${long ? `<textarea data-f="${e(fd.k)}" rows="${fd.type === 'paras' ? 14 : 3}" placeholder="Leave empty to keep the built-in text">${e(val)}</textarea>` : `<input data-f="${e(fd.k)}" value="${e(val)}" placeholder="${e(fd.placeholder || 'Leave empty to keep the built-in text')}">`}
      ${fd.type === 'rich' || fd.type === 'paras' ? '<small>**bold**, *italic*, Enter for a new line.</small>' : ''}</label>`;
  }
  function styleControl(s, v) {
    if (s === 'align') return `<fieldset class="ws-field"><legend>${STYLE_LABEL[s]}</legend><div class="ws-seg">${[['', 'Default'], ['left', 'Left'], ['center', 'Center'], ['right', 'Right']].map(([x, l]) => `<label><input type="radio" name="align" value="${x}" data-s="align" ${(v || '') === x ? 'checked' : ''}>${l}</label>`).join('')}</div></fieldset>`;
    if (s === 'spacing') return `<label class="ws-field"><span>${STYLE_LABEL[s]}</span><select data-s="spacing">${[['', 'Default'], ['compact', 'Compact'], ['roomy', 'Roomy']].map(([x, l]) => `<option value="${x}" ${(v || '') === x ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
    if (s === 'heading_size') return `<label class="ws-field"><span>${STYLE_LABEL[s]}</span><select data-s="heading_size">${[['', 'Default'], ['sm', 'Smaller'], ['lg', 'Larger']].map(([x, l]) => `<option value="${x}" ${(v || '') === x ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
    return `<div class="ws-field ws-color"><span>${STYLE_LABEL[s]}</span><input type="color" data-s="${s}" value="${e(v || '#2b1530')}"><button type="button" class="button" data-clear-style="${s}" ${v ? '' : 'hidden'}>Use default</button></div>`;
  }
  const mediaUrl = (v) => /^https?:/.test(v) ? v : (window.LexcSupabaseConfig?.url || '').replace(/\/+$/, '') + '/storage/v1/object/public/site-media/' + v;
  async function upload(input, key) {
    const file = input.files?.[0]; if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return toast('Use a JPG, PNG or WebP image.');
    if (file.size > 5 * 1024 * 1024) return toast('That image is over 5 MB.');
    const path = `cms/${page.id}/${crypto.randomUUID()}.${file.type.split('/')[1].replace('jpeg', 'jpg')}`;
    input.closest('.ws-img')?.classList.add('is-busy');
    const { error } = await db.client.storage.from('site-media').upload(path, file, { contentType: file.type, cacheControl: '31536000', upsert: false });
    if (error) { input.closest('.ws-img')?.classList.remove('is-busy'); return toast(/bucket|not found/i.test(error.message) ? 'Run database/phase104-website-cms.sql first.' : error.message); }
    const next = structuredClone(current(key)); next.fields = { ...(next.fields || {}), [input.dataset.upload]: path };
    changed(key, next); panel();
  }

  // ---------------- actions
  content.addEventListener('click', async (ev) => {
    const t = ev.target.closest('button,[data-pick]'); if (!t) return;
    if (t.dataset.pick) { picked = t.dataset.pick; tab = 'content'; post({ cms: 'select', key: picked }); panel(); }
    if ('unpick' in t.dataset) { picked = null; post({ cms: 'select', key: '' }); panel(); }
    if (t.dataset.tab) { tab = t.dataset.tab; panel(); }
    if (t.dataset.w) { width = t.dataset.w; content.querySelectorAll('[data-w]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.w === width))); $('[data-frame-wrap]').className = 'ws-frame is-' + width; }
    if (t.dataset.clear) { const key = picked, next = structuredClone(current(key)); delete next.fields?.[t.dataset.clear]; changed(key, next); panel(); }
    if (t.dataset.clearStyle) { const key = picked, next = structuredClone(current(key)); delete next.style?.[t.dataset.clearStyle]; changed(key, next); panel(); }
    if (t.dataset.up || t.dataset.down) {
      const movable = page.sections.filter((s) => s.movable), list = movable.map((s, i) => ({ s, o: current(keyOf(s)).settings?.order ?? i })).sort((a, b) => a.o - b.o).map((x) => x.s);
      const sec = page.sections[Number(t.dataset.up ?? t.dataset.down)], i = list.indexOf(sec), j = i + (t.dataset.up ? -1 : 1);
      if (i < 0 || j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      list.forEach((s, n) => { const k = keyOf(s), next = structuredClone(current(k)); next.settings = { ...(next.settings || {}), order: n }; if (JSON.stringify(next) !== JSON.stringify(current(k))) changed(k, next); });
      panel();
    }
    if ('reset' in t.dataset) {
      const sec = page.sections.find((s) => keyOf(s) === picked);
      if (!(await ask(`“${sec.label}” goes back to the site’s built-in content${sec.legal ? ' (the original Terms text)' : ''}. This takes effect right away.`, { title: 'Reset this section?', confirm: 'Reset', tone: 'danger' }))) return;
      try { await db.rpc('reset_site_section', { target_page: page.id, target_section: sec.id }); dirty.delete(picked); await loadRows(); post({ cms: 'reload' }); state(); panel(); toast('Section reset.'); } catch (error) { toast(error.message); }
    }
    if ('save' in t.dataset) await save();
    if ('publish' in t.dataset) {
      if (!(await ask('Visitors will see this page’s saved changes right away.', { title: `Publish ${page.label}?`, confirm: 'Publish' }))) return;
      t.disabled = true;
      try { if (dirty.size) await save(); const n = await db.rpc('publish_site_page', { target_page: page.id }); await loadRows(); state(); toast(n ? 'Published. Visitors now see your changes.' : 'Nothing new to publish.'); } catch (error) { toast(error.message); } finally { state(); }
    }
    if ('discard' in t.dataset) {
      if (!(await ask('Unsaved changes and saved drafts that aren’t published yet will be thrown away. What visitors see stays the same.', { title: 'Discard changes?', confirm: 'Discard', tone: 'danger' }))) return;
      try { dirty = new Map(); await db.rpc('discard_site_drafts', { target_page: page.id }); await loadRows(); post({ cms: 'reload' }); state(); panel(); toast('Changes discarded.'); } catch (error) { toast(error.message); }
    }
  });
  async function save() {
    const button = $('[data-save]'); button.disabled = true;
    try {
      for (const [key, c] of dirty) { const [p, s] = key.split('/'); await db.rpc('save_site_draft', { target_page: p, target_section: s, content: c }); }
      dirty = new Map(); await loadRows(); toast('Saved. Publish when you’re ready.');
    } catch (error) { toast(/save_site_draft|schema cache/i.test(error.message || '') ? 'Run database/phase104-website-cms.sql first.' : error.message); }
    finally { state(); }
  }
  $('[data-edit]').addEventListener('change', (ev) => { editMode = ev.target.checked; post({ cms: 'mode', edit: editMode }); if (!editMode) { picked = null; } panel(); });
  window.addEventListener('message', function onMsg(ev) {
    if (!content.isConnected) return window.removeEventListener('message', onMsg);
    if (ev.origin !== location.origin || !ev.data?.cms) return;
    if (ev.data.cms === 'ready') { $('.ws-skel')?.remove(); post({ cms: 'goto', route: page.route }); post({ cms: 'mode', edit: editMode }); for (const [key, c] of dirty) post({ cms: 'preview', key, content: c }); }
    if (ev.data.cms === 'picked' && ev.data.key?.startsWith(page.id + '/')) { picked = ev.data.key; tab = 'content'; panel(); }
  });
  try { await loadRows(); }
  catch (error) { $('[data-panel]').innerHTML = `<p class="ws-hint" role="alert">${/site_content|schema cache/i.test(error.message || '') ? 'The website editor isn’t set up yet. Run database/phase104-website-cms.sql in the Supabase SQL editor.' : 'Could not load this page’s content.'}</p>`; return; }
  state(); panel();
  if (page.id === 'global') { picked = 'global/theme'; panel(); }
}

// ---------------- FAQs: at most 10 active (the database enforces it too)
async function renderFaqs(content) {
  content.innerHTML = `<header class="module-heading"><div><h1>FAQs</h1><p>Questions on the homepage. Up to 10 can be shown at a time.</p></div><button class="button primary" type="button" data-add>${icon('plus')} Add question</button></header><div data-list class="ws-faqs"><div class="skel" style="height:160px;border-radius:14px"></div></div>`;
  const list = content.querySelector('[data-list]');
  async function draw() {
    const { data, error } = await db.client.from('site_faqs').select('*').order('sort_order');
    if (error) { list.innerHTML = `<p class="ws-hint" role="alert">${/site_faqs|schema cache/i.test(error.message) ? 'Run database/phase104-website-cms.sql first.' : e(error.message)}</p>`; return; }
    const active = data.filter((f) => f.is_active).length;
    list.innerHTML = `<p class="ws-count${active >= 10 ? ' is-full' : ''}">${active} of 10 shown on the homepage</p>` + (data.length ? data.map((f, i) => `<form class="ws-faq${f.is_active ? '' : ' is-off'}" data-id="${e(f.id)}">
      <div class="ws-faq-order"><button type="button" data-move="-1" ${i ? '' : 'disabled'} aria-label="Move up">↑</button><button type="button" data-move="1" ${i < data.length - 1 ? '' : 'disabled'} aria-label="Move down">↓</button></div>
      <div class="ws-faq-fields"><input name="question" value="${e(f.question)}" maxlength="200" aria-label="Question"><textarea name="answer" rows="2" maxlength="2000" aria-label="Answer">${e(f.answer)}</textarea></div>
      <div class="ws-faq-actions"><label class="ws-check"><input type="checkbox" name="is_active" ${f.is_active ? 'checked' : ''}> Shown</label><button class="button" type="submit">Save</button><button class="button vc-danger" type="button" data-del aria-label="Delete">${icon('close')}</button></div></form>`).join('')
      : '<p class="ws-hint">No questions yet. Add the first one.</p>');
    list.querySelectorAll('form').forEach((form) => {
      const id = form.dataset.id;
      form.onsubmit = async (ev) => { ev.preventDefault(); const x = form.elements;
        const { error: err } = await db.client.from('site_faqs').update({ question: x.question.value.trim(), answer: x.answer.value.trim(), is_active: x.is_active.checked }).eq('id', id);
        toast(err ? (err.message.includes('10') ? 'Only 10 FAQs can be shown. Turn one off first.' : err.message) : 'Saved. It’s live on the homepage.'); draw(); };
      form.querySelector('[data-del]').onclick = async () => { if (!(await ask('This question is removed from the homepage for good.', { title: 'Delete this FAQ?', confirm: 'Delete', tone: 'danger' }))) return; await db.client.from('site_faqs').delete().eq('id', id); draw(); };
      form.querySelectorAll('[data-move]').forEach((b) => (b.onclick = async () => {
        const i = data.findIndex((f) => f.id === id), j = i + Number(b.dataset.move), a = data[i], c = data[j]; if (!c) return;
        await db.client.from('site_faqs').update({ sort_order: j }).eq('id', a.id); await db.client.from('site_faqs').update({ sort_order: i }).eq('id', c.id);
        await Promise.all(data.map((f, n) => n !== i && n !== j && f.sort_order !== n ? db.client.from('site_faqs').update({ sort_order: n }).eq('id', f.id) : null)); draw();
      }));
    });
  }
  content.querySelector('[data-add]').onclick = async () => {
    const { data } = await db.client.from('site_faqs').select('id,is_active');
    const full = (data || []).filter((f) => f.is_active).length >= 10;
    const { error } = await db.client.from('site_faqs').insert({ question: 'New question?', answer: 'Write the answer here.', sort_order: (data || []).length, is_active: !full });
    toast(error ? error.message : full ? 'Added as hidden: 10 FAQs are already shown.' : 'Added. Edit it below, then Save.'); draw();
  };
  draw();
}

// ---------------- announcements: draft / published / archived, with dates
async function renderAnnouncements(content) {
  content.innerHTML = `<header class="module-heading"><div><h1>Announcements</h1><p>A bar at the top of the site. Only published ones within their dates are shown.</p></div><button class="button primary" type="button" data-add>${icon('plus')} New announcement</button></header><div data-list class="ws-anns"><div class="skel" style="height:140px;border-radius:14px"></div></div>`;
  const list = content.querySelector('[data-list]');
  const local = (iso) => iso ? new Date(new Date(iso).getTime() + 8 * 36e5).toISOString().slice(0, 16) : '';
  const fromLocal = (v) => v ? new Date(v + ':00+08:00').toISOString() : null;
  const live = (a) => a.status === 'published' && (!a.starts_at || Date.parse(a.starts_at) <= Date.now()) && (!a.ends_at || Date.parse(a.ends_at) > Date.now());
  async function draw() {
    const { data, error } = await db.client.from('site_announcements').select('*').order('created_at', { ascending: false });
    if (error) { list.innerHTML = `<p class="ws-hint" role="alert">${/site_announcements|schema cache/i.test(error.message) ? 'Run database/phase104-website-cms.sql first.' : e(error.message)}</p>`; return; }
    list.innerHTML = data.length ? data.map((a) => `<form class="ws-ann" data-id="${e(a.id)}">
      <div class="ws-ann-head"><span class="vc-pill is-${live(a) ? 'ok' : a.status === 'published' ? 'wait' : 'off'}">${live(a) ? 'Showing now' : a.status === 'published' ? 'Scheduled / ended' : a.status === 'archived' ? 'Archived' : 'Draft'}</span>
        <select name="status" aria-label="Status"><option value="draft" ${a.status === 'draft' ? 'selected' : ''}>Draft</option><option value="published" ${a.status === 'published' ? 'selected' : ''}>Published</option><option value="archived" ${a.status === 'archived' ? 'selected' : ''}>Archived</option></select></div>
      <div class="vc-grid"><label class="form-field">Title<input name="title" maxlength="120" value="${e(a.title)}" required></label>
        <label class="form-field">Message<input name="body" maxlength="600" value="${e(a.body || '')}"></label>
        <label class="form-field">Button text<input name="button_text" maxlength="40" value="${e(a.button_text || '')}" placeholder="Learn more"></label>
        <label class="form-field">Link<input name="link_url" maxlength="300" value="${e(a.link_url || '')}" placeholder="?page=shop or https://…"></label>
        <label class="form-field">Show from<input name="starts_at" type="datetime-local" value="${e(local(a.starts_at))}"></label>
        <label class="form-field">Show until<input name="ends_at" type="datetime-local" value="${e(local(a.ends_at))}"></label></div>
      <div class="ws-img">${a.image_path ? `<img src="${e((window.LexcSupabaseConfig?.url || '').replace(/\/+$/, '') + '/storage/v1/object/public/site-media/' + a.image_path)}" alt="">` : '<span class="ws-img-empty">No image</span>'}
        <label class="button">${icon('plus')} ${a.image_path ? 'Replace image' : 'Add image'}<input type="file" accept="image/jpeg,image/png,image/webp" hidden data-img></label>${a.image_path ? '<button type="button" class="button" data-noimg>Remove image</button>' : ''}</div>
      <div class="ws-faq-actions"><button class="button primary" type="submit">Save</button><button class="button vc-danger" type="button" data-del>${icon('close')} Delete</button></div></form>`).join('')
      : '<p class="ws-hint">No announcements yet.</p>';
    list.querySelectorAll('form').forEach((form) => {
      const id = form.dataset.id, x = form.elements;
      form.onsubmit = async (ev) => { ev.preventDefault();
        if (x.starts_at.value && x.ends_at.value && x.ends_at.value <= x.starts_at.value) return toast('“Show until” must be after “Show from”.');
        const { error: err } = await db.client.from('site_announcements').update({ title: x.title.value.trim(), body: x.body.value.trim() || null, button_text: x.button_text.value.trim() || null, link_url: x.link_url.value.trim() || null, starts_at: fromLocal(x.starts_at.value), ends_at: fromLocal(x.ends_at.value), status: x.status.value }).eq('id', id);
        toast(err ? err.message : 'Saved.'); draw(); };
      form.querySelector('[data-del]').onclick = async () => { if (!(await ask('This announcement is deleted for good. To keep it, archive it instead.', { title: 'Delete this announcement?', confirm: 'Delete', tone: 'danger' }))) return; await db.client.from('site_announcements').delete().eq('id', id); draw(); };
      form.querySelector('[data-noimg]')?.addEventListener('click', async () => { await db.client.from('site_announcements').update({ image_path: null }).eq('id', id); draw(); });
      form.querySelector('[data-img]').onchange = async (ev) => {
        const file = ev.target.files?.[0]; if (!file) return;
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) return toast('Use a JPG, PNG or WebP image up to 5 MB.');
        const path = `cms/announcements/${crypto.randomUUID()}.${file.type.split('/')[1].replace('jpeg', 'jpg')}`;
        const { error: err } = await db.client.storage.from('site-media').upload(path, file, { contentType: file.type, upsert: false });
        if (err) return toast(err.message);
        await db.client.from('site_announcements').update({ image_path: path }).eq('id', id); draw();
      };
    });
  }
  content.querySelector('[data-add]').onclick = async () => { const { error } = await db.client.from('site_announcements').insert({ title: 'New announcement', status: 'draft' }); toast(error ? error.message : 'Added as a draft. Fill it in, set Published, then Save.'); draw(); };
  draw();
}
