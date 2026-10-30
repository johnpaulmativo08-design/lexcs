// Fondant letters PER PIECE (one cupcake or one mini donut): 1–5 letters each, typed piece by piece.
// Shared by the cupcake designer and the mini donut designer. The database re-checks the same rule
// (private.letter_pieces): letters, numbers and ! ? & ' . , - ♥ — no spaces — up to 5 per piece.
(() => {
  const MAX = 5;
  const BAD = /[^A-Za-z0-9!?&'.,♥-]/g;
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clean = (text) => String(text || '').replace(/\s+/g, '').replace(BAD, '').slice(0, MAX);
  // Keep one entry per piece in the box (extra entries are dropped when a smaller box is chosen).
  const fit = (pieces, count) => Array.from({ length: count }, (_, i) => clean((pieces || [])[i]));
  const filled = (pieces) => (pieces || []).filter((p) => clean(p)).length;
  // "Fill several at once": each word goes on the next piece; words longer than 5 letters continue on the next one.
  function spread(text) {
    const out = [];
    for (const word of String(text || '').split(/\s+/).map((w) => w.replace(BAD, '')).filter(Boolean)) {
      for (let i = 0; i < word.length; i += MAX) out.push(word.slice(i, i + MAX));
    }
    return out;
  }
  // "Same on every piece": a word (up to 5) and an optional number (up to 3 digits). Both together on each piece
  // when they fit in 5 characters (HI18); otherwise the pieces take turns: LOVE, 18, LOVE, 18 …
  function same(word, number, count) {
    const w = clean(word).toUpperCase(), n = String(number || '').replace(/\D/g, '').slice(0, 3);
    if (!w && !n) return null;
    const one = (w + n).length <= MAX ? w + n : '';
    const list = Array.from({ length: count }, (_, i) => one || (!w ? n : !n ? w : i % 2 ? n : w));
    const how = one ? `Every piece gets ${one}.` : w && n ? `Too long for one piece, so they take turns: ${w} · ${n} · ${w} · ${n} …` : `Every piece gets ${w || n}.`;
    return { list, how };
  }
  // Older designs stored one sentence spelled across the box; turn it into per-piece entries (same split as before).
  function fromSentence(text) {
    const out = [];
    for (const w of String(text || '').trim().split(/\s+/).filter(Boolean)) {
      if (w.length <= 2) { out.push(w); continue; }
      if (w.length === 3) { out.push(w.slice(0, 1), w.slice(1)); continue; }
      const first = w.length % 2 ? 3 : 2; out.push(w.slice(0, first));
      for (let i = first; i < w.length; i += 2) out.push(w.slice(i, i + 2));
    }
    return out.map(clean);
  }

  function markup({ pieces, count, at = 0, noun = 'piece', id = 'lp' }) {
    const list = fit(pieces, count), here = Math.min(Math.max(0, at), count - 1), text = list[here] || '', n = filled(list);
    const Noun = noun.charAt(0).toUpperCase() + noun.slice(1);
    return `<div class="pcl" data-lp>
      <p class="pcl-hint">Tap a ${esc(noun)}, then type <strong>1–5 letters</strong> for it. ${esc(Noun)}s left empty get no letters.</p>
      <div class="pcl-grid" role="group" aria-label="${esc(Noun)}s in the box">${list.map((p, i) => `<button type="button" class="pcl-chip${i === here ? ' is-active' : ''}${p ? ' has-text' : ''}" data-lp-at="${i}" aria-pressed="${i === here}" aria-label="${esc(Noun)} ${i + 1}${p ? ': ' + esc(p) : ', no letters'}"><small>${i + 1}</small><b>${p ? esc(p) : '+'}</b></button>`).join('')}</div>
      <div class="pcl-editor">
        <label class="pcl-label" for="${id}-input">${esc(Noun)} ${here + 1} letters</label>
        <div class="pcl-row">
          <button type="button" class="pcl-step" data-lp-prev aria-label="Previous ${esc(noun)}" ${here === 0 ? 'disabled' : ''}>‹</button>
          <input id="${id}-input" class="bd-input pcl-input" data-lp-input value="${esc(text)}" maxlength="${MAX}" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="e.g. LOVE" aria-describedby="${id}-count">
          <button type="button" class="pcl-step" data-lp-next aria-label="Next ${esc(noun)}" ${here >= count - 1 ? 'disabled' : ''}>›</button>
        </div>
        <div class="pcl-meta"><span id="${id}-count" data-lp-count>${text.length} / ${MAX} letters</span><span data-lp-filled>${n} of ${count} ${esc(noun)}s have letters</span>${text ? '<button type="button" class="pcl-clear" data-lp-clear>Clear</button>' : ''}</div>
      </div>
      <div class="pcl-all">
        <p class="pcl-all-title">Same on every ${esc(noun)} <small>word · optional number</small></p>
        <div class="pcl-all-row">
          <input class="bd-input pcl-all-word" data-lp-all-word maxlength="${MAX}" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Word, e.g. LOVE" aria-label="Word for every ${esc(noun)}">
          <input class="bd-input pcl-all-num" data-lp-all-num maxlength="3" inputmode="numeric" autocomplete="off" placeholder="No." aria-label="Optional number for every ${esc(noun)}">
          <button type="button" class="bd-chip pcl-all-go" data-lp-all disabled>Apply to all ${count}</button>
        </div>
        <p class="pcl-note" data-lp-all-how>Type a word, a number, or both. You can still change any ${esc(noun)} after.</p>
      </div>
      <details class="pcl-fill"><summary>Different words across the ${esc(noun)}s</summary>
        <div class="pcl-row"><input class="bd-input" data-lp-fill-text placeholder="e.g. HAPPY 7TH BDAY" autocomplete="off" aria-label="Words to spread across the ${esc(noun)}s"><button type="button" class="bd-chip" data-lp-fill>Fill from ${esc(noun)} ${here + 1}</button></div>
        <p class="pcl-note">Each word goes on the next ${esc(noun)}; longer words continue on the one after (5 letters each).</p>
      </details>
      <p class="pcl-error" role="alert" ${n ? 'hidden' : ''}>${n ? '' : `Add letters to at least one ${esc(noun)}, or choose no letters.`}</p>
    </div>`;
  }

  // api: { pieces(), count(), at(), setAt(i), set(pieces, { render }) }
  function bind(root, api) {
    const focusInput = () => { const input = root.querySelector('[data-lp-input]'); if (input) { input.focus({ preventScroll: true }); input.select(); } };
    root.addEventListener('click', (event) => {
      const t = event.target.closest('[data-lp-at],[data-lp-prev],[data-lp-next],[data-lp-clear],[data-lp-fill],[data-lp-all]'); if (!t || !root.contains(t)) return;
      event.stopPropagation();
      const at = api.at(), count = api.count();
      if (t.dataset.lpAt !== undefined) { api.setAt(Number(t.dataset.lpAt)); return focusInput(); }
      if ('lpPrev' in t.dataset) { api.setAt(Math.max(0, at - 1)); return focusInput(); }
      if ('lpNext' in t.dataset) { api.setAt(Math.min(count - 1, at + 1)); return focusInput(); }
      if ('lpClear' in t.dataset) { const p = fit(api.pieces(), count); p[at] = ''; api.set(p, { render: true }); return focusInput(); }
      if ('lpAll' in t.dataset) {
        const res = same(root.querySelector('[data-lp-all-word]')?.value, root.querySelector('[data-lp-all-num]')?.value, count); if (!res) return;
        api.set(res.list, { render: true });
        window.showToast?.(`Applied to all ${count} — tap any one to change it.`, { type: 'success' });
        return;
      }
      if ('lpFill' in t.dataset) {
        const words = spread(root.querySelector('[data-lp-fill-text]')?.value); if (!words.length) return;
        const p = fit(api.pieces(), count); words.slice(0, count - at).forEach((w, k) => { p[at + k] = w; });
        api.set(p, { render: true });
        if (words.length > count - at) window.showToast?.(`Only ${count - at} ${count - at === 1 ? 'spot was' : 'spots were'} left in the box — some words did not fit.`);
      }
    }, true);
    root.addEventListener('input', (event) => {
      // "Same on every piece": tidy what is typed and preview the result before applying
      const all = event.target.closest('[data-lp-all-word],[data-lp-all-num]');
      if (all) {
        if (all.matches('[data-lp-all-word]')) { const v = clean(all.value); if (v !== all.value) all.value = v; }
        else { const v = all.value.replace(/\D/g, '').slice(0, 3); if (v !== all.value) all.value = v; }
        const box = all.closest('.pcl-all'), res = same(box.querySelector('[data-lp-all-word]').value, box.querySelector('[data-lp-all-num]').value, api.count());
        box.querySelector('[data-lp-all]').disabled = !res;
        box.querySelector('[data-lp-all-how]').textContent = res ? res.how : 'Type a word, a number, or both. You can still change any one after.';
        return;
      }
      const input = event.target.closest('[data-lp-input]'); if (!input) return;
      const value = clean(input.value); if (value !== input.value) input.value = value;
      const count = api.count(), at = api.at(), p = fit(api.pieces(), count); p[at] = value;
      api.set(p, { render: false });
      // update the chip and counters in place so typing keeps focus
      const chip = root.querySelector(`[data-lp-at="${at}"]`);
      if (chip) { chip.classList.toggle('has-text', !!value); chip.querySelector('b').textContent = value || '+'; }
      const c = root.querySelector('[data-lp-count]'); if (c) c.textContent = `${value.length} / ${MAX} letters`;
      const n = filled(p), f = root.querySelector('[data-lp-filled]'); if (f) f.textContent = f.textContent.replace(/^\d+/, String(n));
      const err = root.querySelector('.pcl-error'); if (err) err.hidden = n > 0;
    });
    root.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && event.target.closest?.('.pcl-all')) { event.preventDefault(); event.target.closest('.pcl-all').querySelector('[data-lp-all]:not(:disabled)')?.click(); return; }
      if (!event.target.matches('[data-lp-input]') || event.key !== 'Enter') return;
      event.preventDefault(); const at = api.at(), count = api.count();
      if (at < count - 1) { api.setAt(at + 1); focusInput(); }
    });
  }

  window.LexcLetterPieces = { MAX, clean, fit, filled, spread, same, fromSentence, markup, bind };
})();
