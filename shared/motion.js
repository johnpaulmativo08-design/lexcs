// LexC's Snacktime — customer motion and feedback (pairs with shared/motion.css).
// Loaded last. It wraps existing storefront functions to add feedback around them; every wrapper calls the
// original first (or right after an exit animation) and never changes cart, checkout, payment or order logic.
// Success feedback is only shown after the underlying action has really succeeded.
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const calm = () => reduce.matches;
  const EASE = 'cubic-bezier(.22,1,.36,1)', EXIT = 'cubic-bezier(.4,0,1,1)';
  const play = (el, frames, options = {}) => (el?.animate ? el.animate(frames, { duration: 220, easing: EASE, ...options, ...(calm() ? { duration: 1, delay: 0 } : {}) }) : null);
  const has = (name) => typeof window[name] === 'function';
  // Never let an action wait on an animation: browsers pause animations in background tabs and on busy phones.
  const settle = (animation, ms) => Promise.race([animation ? animation.finished.catch(() => {}) : Promise.resolve(), new Promise((resolve) => setTimeout(resolve, ms))]);
  const once = (fn) => { let done = false; return () => { if (!done) { done = true; fn(); } }; };
  const decode = (text) => String(text ?? '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

  // ---------------------------------------------------------------- Toasts (success / info / warning / error)
  let stack, pendingAction = null;
  const ICONS = { success: '✓', error: '!', warning: '!', info: 'i' };
  function toastType(text) {
    if (/^\s*✓/.test(text) || /\b(added|saved|copied|sent|submitted|logged out|signed in)\b/i.test(text)) return 'success';
    if (/could not|couldn’t|failed|error|unable|unavailable|no longer|not accepted|invalid/i.test(text)) return 'error';
    if (/please|choose|select|enter |sign in|wait|must|required|only /i.test(text)) return 'warning';
    return 'info';
  }
  function showToast(message, options = {}) {
    if (!stack) { stack = document.createElement('div'); stack.className = 'mo-toasts'; stack.setAttribute('role', 'status'); stack.setAttribute('aria-live', 'polite'); document.body.append(stack); }
    const text = decode(message).replace(/^\s*✓\s*/, '');
    const type = options.type || toastType(decode(message));
    const action = options.action || pendingAction;
    [...stack.children].forEach((old) => { if (old.dataset.text === text) old.remove(); });
    while (stack.children.length >= 2) stack.firstElementChild.remove();
    const toast = document.createElement('div');
    toast.className = `mo-toast mo-toast--${type}`; toast.dataset.text = text;
    toast.innerHTML = `<span class="mo-toast__icon" aria-hidden="true">${ICONS[type]}</span><span class="mo-toast__text"></span>`;
    toast.querySelector('.mo-toast__text').textContent = text;
    if (action) {
      const button = Object.assign(document.createElement('button'), { type: 'button', className: 'mo-toast__action', textContent: action.label });
      button.onclick = () => { leave(); action.run(); };
      toast.append(button);
    }
    stack.append(toast);
    const leave = () => { if (!toast.isConnected || toast.classList.contains('is-leaving')) return; toast.classList.add('is-leaving'); setTimeout(() => toast.remove(), 200); };
    let timer = setTimeout(leave, options.duration || (type === 'error' ? 4200 : action ? 3600 : 2600));
    toast.addEventListener('pointerenter', () => clearTimeout(timer));
    toast.addEventListener('pointerleave', () => { timer = setTimeout(leave, 1600); });
    return toast;
  }
  window.LexcToast = { show: showToast };
  if (has('showToast')) window.showToast = (message, options) => showToast(message, options);

  // ---------------------------------------------------------------- Numbers that change (prices, totals, quantities)
  const ROLL = '[data-price],[data-qty],[data-quantity],#cartSubtotal,.co-total-value,[data-roll],.strip-amount strong';
  const lastValue = new WeakMap();
  const numberOf = (text) => Number(String(text).replace(/[^0-9.]/g, '')) || 0;
  function roll(el, direction) {
    el.classList.add('mo-roll');
    play(el, [{ opacity: 0, transform: `translateY(${direction * 6}px)` }, { opacity: 1, transform: 'none' }], { duration: 210 });
  }
  function watchRoll(el) {
    const now = el.textContent.trim(), before = lastValue.get(el);
    lastValue.set(el, now);
    if (before === undefined || before === now) return;
    roll(el, numberOf(now) >= numberOf(before) ? 1 : -1);
  }

  // ---------------------------------------------------------------- Busy buttons: "Placing…" gets a spinner, keeps its width
  function syncBusy(button) {
    const busy = button.disabled && /(…|\.\.\.)\s*$/.test(button.textContent.trim());
    if (busy && !button.classList.contains('mo-busy')) {
      if (!button.dataset.moWidth) { button.dataset.moWidth = '1'; button.style.minWidth = `${button.getBoundingClientRect().width}px`; }
      button.classList.add('mo-busy'); button.setAttribute('aria-busy', 'true');
    } else if (!busy && button.classList.contains('mo-busy')) {
      button.classList.remove('mo-busy'); button.removeAttribute('aria-busy');
      if (button.dataset.moWidth) { delete button.dataset.moWidth; button.style.minWidth = ''; }
    }
  }

  // ---------------------------------------------------------------- Chat bubbles: only new messages slide in
  const seenMessages = new Set();
  function revealMessages(nodes) {
    const fresh = nodes.filter((node) => !seenMessages.has(node.dataset.mid));
    const firstLoad = fresh.length > 1 && fresh.length === nodes.length && nodes.length > 1;
    nodes.forEach((node) => seenMessages.add(node.dataset.mid));
    if (firstLoad || calm()) return;
    fresh.forEach((node) => node.classList.add('mo-msg-in'));
  }

  // One observer for prices, busy buttons and chat bubbles.
  const observer = new MutationObserver((mutations) => {
    const messages = [], buttons = new Set(), rolls = new Set();
    for (const m of mutations) {
      const target = m.target.nodeType === 1 ? m.target : m.target.parentElement;
      if (!target) continue;
      const button = target.closest('button'); if (button) buttons.add(button);
      const rollTarget = target.closest(ROLL); if (rollTarget && m.type !== 'attributes') rolls.add(rollTarget);
      for (const node of m.addedNodes || []) {
        if (node.nodeType !== 1) continue;
        if (node.matches('[data-mid]')) messages.push(node);
        node.querySelectorAll?.('[data-mid]').forEach((n) => messages.push(n));
        node.querySelectorAll?.(ROLL).forEach((n) => lastValue.set(n, n.textContent.trim()));
      }
    }
    buttons.forEach(syncBusy); rolls.forEach(watchRoll);
    if (messages.length) revealMessages(messages);
  });
  const startObserver = () => observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['disabled'] });
  if (document.body) startObserver(); else document.addEventListener('DOMContentLoaded', startObserver);

  // ---------------------------------------------------------------- Password show / hide (login & register)
  const EYE = '<svg class="mo-eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg><svg class="mo-eye-off" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.4 0 10 7 10 7a17 17 0 0 1-2.16 3.19M6.6 6.6C3.9 8.4 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="m2 2 20 20"/><path d="M14.1 14.1a3 3 0 0 1-4.2-4.2"/></svg>';
  function addPasswordToggles() {
    document.querySelectorAll('#page-login input[type=password], #page-register input[type=password]').forEach((input) => {
      if (input.closest('.mo-pass-wrap')) return;
      const wrap = Object.assign(document.createElement('span'), { className: 'mo-pass-wrap' });
      input.before(wrap); wrap.append(input);
      const toggle = Object.assign(document.createElement('button'), { type: 'button', className: 'mo-pass-toggle', innerHTML: EYE });
      toggle.setAttribute('aria-label', 'Show password'); toggle.setAttribute('aria-pressed', 'false');
      toggle.onclick = () => { const show = input.type === 'password'; input.type = show ? 'text' : 'password'; toggle.setAttribute('aria-pressed', String(show)); toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password'); input.focus(); };
      wrap.append(toggle);
    });
  }

  // ======================================================================== Storefront only
  if (!has('renderCart')) { addPasswordToggles(); return; }

  // ---- Cart badge bump, fly-to-cart, totals
  const badges = () => [document.getElementById('cartBadge'), document.getElementById('mobileCartCount')].filter((b) => b && !b.hidden);
  const bump = () => { if (calm()) return; badges().forEach((b) => { b.classList.remove('mo-bump'); void b.offsetWidth; b.classList.add('mo-bump'); }); };
  const cartCount = () => (typeof cart !== 'undefined' ? cart.reduce((sum, item) => sum + Number(item.qty || 0), 0) : 0);
  let bumpTimer = null, qtyHint = null;

  const originalRender = window.renderCart;
  window.renderCart = function renderCartWithMotion(...args) {
    const before = cartCount();
    const result = originalRender.apply(this, args);
    if (cartCount() > before) { clearTimeout(bumpTimer); bumpTimer = setTimeout(bump, 0); }
    if (qtyHint) {
      const row = document.querySelectorAll('#cartItemsList .cart-item')[qtyHint.index];
      const number = row?.querySelector('.qty-num'); if (number) roll(number, qtyHint.direction);
      const price = row?.querySelector('.cart-item-price'); if (price) roll(price, qtyHint.direction);
      qtyHint = null;
    }
    return result;
  };

  function cartTarget() {
    const candidates = [document.querySelector('.nav-shopping-btn'), document.getElementById('cartBadge')?.parentElement, document.getElementById('mobileCartCount')?.closest('button')];
    return candidates.find((el) => el && el.getClientRects().length && el.getBoundingClientRect().width > 0);
  }
  let lastPress = null;
  document.addEventListener('pointerdown', (event) => { lastPress = event.target; }, true);
  function flyToCart(id) {
    if (calm()) return null;
    const source = lastPress?.closest?.('.pd-card,.pd-mini,.pd-dialog,.product-card');
    const img = source?.querySelector('.pd-hero img,[data-hero-img],.pd-card__media img,.pd-mini__media img,img');
    const target = cartTarget();
    if (!img || !target || !img.getClientRects().length) return null;
    const from = img.getBoundingClientRect(), to = target.getBoundingClientRect();
    const dot = document.createElement('div'); dot.className = 'mo-fly'; dot.style.backgroundImage = `url("${img.currentSrc || img.src}")`;
    const x0 = from.left + from.width / 2 - 23, y0 = from.top + from.height / 2 - 23, x1 = to.left + to.width / 2 - 23, y1 = to.top + to.height / 2 - 23;
    dot.style.left = '0px'; dot.style.top = '0px'; document.body.append(dot);
    const lift = Math.min(y0, y1) - 60;
    const flight = dot.animate([
      { transform: `translate(${x0}px,${y0}px) scale(1)`, opacity: 1 },
      { transform: `translate(${(x0 + x1) / 2}px,${lift}px) scale(.8)`, opacity: 1, offset: .5 },
      { transform: `translate(${x1}px,${y1}px) scale(.35)`, opacity: .2 }], { duration: 560, easing: 'cubic-bezier(.5,0,.3,1)' });
    settle(flight, 650).then(() => dot.remove());
    return flight;
  }
  if (has('addToCartById')) {
    const originalAdd = window.addToCartById;
    window.addToCartById = function addToCartWithMotion(...args) {
      pendingAction = { label: 'View cart', run: () => window.openCart() };
      let ok;
      try { ok = originalAdd.apply(this, args); } finally { pendingAction = null; }
      if (ok) { const flight = flyToCart(args[0]); if (flight) { clearTimeout(bumpTimer); settle(flight, 620).then(bump); } }
      return ok;
    };
  }

  // ---- Quantity: number moves up or down with the change
  if (has('changeQty')) {
    const originalChange = window.changeQty;
    window.changeQty = function changeQtyWithMotion(index, delta) {
      if (typeof cart !== 'undefined' && cart[index] && cart[index].qty + delta <= 0) return removeWithMotion(index, () => originalChange.call(this, index, delta));
      qtyHint = { index, direction: delta > 0 ? 1 : -1 };
      return originalChange.call(this, index, delta);
    };
  }

  // ---- Remove: fade, collapse, then the list closes up; Undo puts it back
  function removeWithMotion(index, commit) {
    const row = document.querySelectorAll('#cartItemsList .cart-item')[index];
    const item = typeof cart !== 'undefined' ? cart[index] : null;
    const finish = () => {
      commit();
      if (item) showToast(`Removed ${item.name}`, { type: 'info', action: { label: 'Undo', run: () => { cart.splice(Math.min(index, cart.length), 0, item); window.renderCart(); } } });
    };
    if (!row || calm() || row.classList.contains('is-removing')) return finish();
    row.classList.add('is-removing');
    const height = row.getBoundingClientRect().height;
    row.style.overflow = 'hidden';
    const style = getComputedStyle(row);
    settle(play(row, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(14px)' }], { duration: 140, easing: EXIT, fill: 'forwards' }), 180)
      .then(() => settle(play(row, [{ height: `${height}px`, paddingTop: style.paddingTop, paddingBottom: style.paddingBottom, marginBottom: style.marginBottom }, { height: '0px', paddingTop: '0px', paddingBottom: '0px', marginBottom: '0px' }], { duration: 180, easing: EASE, fill: 'forwards' }), 220))
      .then(once(finish));
  }
  if (has('removeCartItem')) {
    const originalRemove = window.removeCartItem;
    window.removeCartItem = function removeCartItemWithMotion(index) { return removeWithMotion(index, () => originalRemove.call(this, index)); };
  }

  // ---- Cart drawer: items arrive in a short stagger the first time it opens
  if (has('openCart')) {
    const originalOpen = window.openCart;
    window.openCart = function openCartWithMotion(...args) {
      const wasOpen = document.getElementById('cartDrawer')?.classList.contains('open');
      const result = originalOpen.apply(this, args);
      if (!wasOpen && !calm()) document.querySelectorAll('#cartItemsList .cart-item').forEach((row, i) => { if (i < 8) play(row, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 260, delay: 80 + i * 40, fill: 'backwards' }); });
      return result;
    };
  }

  // ---- Page changes: the new page fades and rises a little (not on the first load)
  if (has('navigate')) {
    const originalNavigate = window.navigate;
    let ready = false;
    window.navigate = function navigateWithMotion(page, ...rest) {
      const before = document.querySelector('.page.active')?.id;
      const result = originalNavigate.call(this, page, ...rest);
      const active = document.querySelector('.page.active');
      if (ready && active && active.id !== before && !calm()) { active.classList.remove('mo-page-enter'); void active.offsetWidth; active.classList.add('mo-page-enter'); setTimeout(() => active.classList.remove('mo-page-enter'), 450); }
      ready = true;
      if (page === 'login' || page === 'register') addPasswordToggles();
      return result;
    };
    setTimeout(() => { ready = true; }, 800);
  }

  // ---- Shop results: cards that newly appear (category, search, sort) settle in with a short stagger
  if (has('renderShop')) {
    const originalShop = window.renderShop;
    let shown = new Set();
    window.renderShop = function renderShopWithMotion(...args) {
      const grid = document.getElementById('productsGrid');
      const wasLoading = grid?.getAttribute('aria-busy') === 'true';
      const result = originalShop.apply(this, args);
      if (!grid || grid.getAttribute('aria-busy') === 'true') return result;
      const cards = [...grid.querySelectorAll('[data-card]')];
      const next = new Set(cards.map((card) => card.dataset.card));
      // Category or sort changed: the visible set settles in again. Typing a search: only cards that newly appear.
      const changed = next.size !== shown.size || [...next].some((id) => !shown.has(id));
      const typing = document.activeElement?.id === 'shopSearch';
      if (!calm() && (wasLoading || changed)) {
        let n = 0;
        cards.forEach((card) => { if ((wasLoading || !typing || !shown.has(card.dataset.card)) && n < 12) { card.style.setProperty('--mo-delay', `${n * 35}ms`); card.classList.add('mo-enter'); n += 1; } });
      }
      shown = next;
      return result;
    };
  }

  // ---- Sign in / create account: button shows progress, then a short confirmation or a calm error
  function authWithMotion(name, busyText, doneText, errorId) {
    if (!has(name)) return;
    const original = window[name];
    window[name] = async function authMotion(...args) {
      const button = document.querySelector(`[onclick^="${name}"]`);
      const error = document.getElementById(errorId);
      const label = button?.textContent;
      if (button && !button.disabled) { button.disabled = true; button.textContent = busyText; }
      try { await original.apply(this, args); }
      finally {
        if (button) {
          const failed = error?.classList.contains('show');
          if (!failed) {
            button.disabled = false; button.textContent = doneText; button.classList.add('mo-done');
            setTimeout(() => { button.textContent = label; button.classList.remove('mo-done'); }, 1100);
          } else { button.disabled = false; button.textContent = label; }
          if (failed && error) { error.classList.remove('mo-nudge'); void error.offsetWidth; error.classList.add('mo-nudge'); }
        }
      }
    };
  }
  authWithMotion('handleLogin', 'Signing in…', '✓ Signed in', 'loginError');
  authWithMotion('handleRegister', 'Creating account…', '✓ Account created', 'registerError');

  // ---- Checkout: a field that blocks the order gets one small nudge (the message and red border stay the main signal)
  if (has('submitCheckout')) {
    const originalSubmit = window.submitCheckout;
    window.submitCheckout = function submitCheckoutWithMotion(...args) {
      const result = originalSubmit.apply(this, args);
      const field = document.activeElement;
      if (field?.matches?.('input,select,textarea') && field.getAttribute('aria-invalid') === 'true' && !calm()) { field.classList.remove('mo-nudge'); void field.offsetWidth; field.classList.add('mo-nudge'); }
      return result;
    };
  }

  addPasswordToggles();
})();
