// Inspiration photos while designing (bento, cupcakes, mini donuts, cake pops): up to 3 per designed item.
// Photos are made smaller on the device, uploaded privately (customer-references/<user>/inspiration/…), and kept with
// the cart item; after checkout they are attached to the order line and posted in that order's chat (phase 55).
// A designer registers once: LexcInspiration.register(owner, getPaths, setPaths), then puts html(owner, paths) in a step.
(() => {
  const MAX = 3, owners = new Map(), signed = new Map();
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let busy = '';

  // phone photos are often over 5 MB: scale to 1600 px on the long side and save as JPEG
  async function shrink(file) {
    if (!/^image\//.test(file.type)) throw new Error('Choose a photo (JPG, PNG or WebP).');
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => fail(new Error('That photo could not be opened. Try another one.')); i.src = url; });
      const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(img.naturalWidth * scale), height: Math.round(img.naturalHeight * scale) });
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', 0.85));
      if (!blob) throw new Error('That photo could not be prepared. Try another one.');
      return new File([blob], 'inspiration.jpg', { type: 'image/jpeg' });
    } finally { URL.revokeObjectURL(url); }
  }

  function html(owner, paths = []) {
    const list = (paths || []).slice(0, MAX), user = window.currentUser;
    setTimeout(hydrate, 0);
    return `<div class="bd-group insp" data-insp="${esc(owner)}">
      <span class="bd-label">Inspiration photos <small>Optional · up to ${MAX}</small></span>
      <p class="bd-note">Have a picture of what you have in mind? Add it and LexC’s will see it with your order.</p>
      ${list.length ? `<div class="insp-grid">${list.map((p, i) => `<figure class="insp-pic"><img data-insp-src="${esc(p)}" alt="Inspiration photo ${i + 1}"><button type="button" class="insp-remove" data-insp-remove="${i}" aria-label="Remove inspiration photo ${i + 1}">×</button></figure>`).join('')}</div>` : ''}
      ${!user ? `<button type="button" class="bd-link insp-login" data-insp-login>Log in to add a photo</button>`
        : list.length < MAX ? `<label class="insp-add${busy === owner ? ' is-busy' : ''}"><input type="file" accept="image/jpeg,image/png,image/webp" multiple data-insp-file hidden><span aria-hidden="true">＋</span> ${busy === owner ? 'Adding photo…' : list.length ? 'Add another photo' : 'Add a photo'}</label>` : ''}
      <p class="insp-error" role="alert" hidden></p></div>`;
  }

  async function hydrate() {
    for (const img of document.querySelectorAll('img[data-insp-src]:not([src])')) {
      const path = img.dataset.inspSrc; let entry = signed.get(path);
      if (!entry || Date.now() - entry.at > 45000) { entry = { at: Date.now(), url: LexcBackend.privateImage('customer-references', path) }; signed.set(path, entry); }
      try { img.src = await entry.url; } catch { img.alt = 'Photo unavailable'; }
    }
  }

  document.addEventListener('change', async (event) => {
    const input = event.target.closest?.('[data-insp-file]'); if (!input) return;
    const box = input.closest('[data-insp]'), owner = owners.get(box.dataset.insp); if (!owner || !window.currentUser) return;
    const files = [...input.files].slice(0, MAX - owner.get().length); input.value = '';
    if (!files.length) return;
    const error = box.querySelector('.insp-error');
    busy = box.dataset.insp; owner.set(owner.get());
    try {
      const added = [];
      for (const file of files) added.push(await LexcBackend.upload('customer-references', window.currentUser.id + '/inspiration', await shrink(file)));
      busy = ''; owner.set([...owner.get(), ...added].slice(0, MAX));
    } catch (e) {
      busy = ''; owner.set(owner.get());
      const again = document.querySelector(`[data-insp="${CSS.escape(box.dataset.insp)}"] .insp-error`) || error;
      if (again) { again.textContent = e.message || 'The photo could not be added. Please try again.'; again.hidden = false; }
    }
  });
  document.addEventListener('click', (event) => {
    const remove = event.target.closest?.('[data-insp-remove]');
    if (remove) { const owner = owners.get(remove.closest('[data-insp]').dataset.insp); if (owner) owner.set(owner.get().filter((_, i) => i !== Number(remove.dataset.inspRemove))); return; }
    const login = event.target.closest?.('[data-insp-login]');
    if (login) { const owner = owners.get(login.closest('[data-insp]').dataset.insp); owner?.beforeLogin?.(); window.navigate?.('login'); }
  });

  window.LexcInspiration = Object.freeze({
    MAX, html, hydrate, shrink,
    register(owner, get, set, beforeLogin) { owners.set(owner, { get: () => [...(get() || [])], set, beforeLogin }); }
  });
})();
