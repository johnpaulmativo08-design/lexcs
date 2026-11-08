// Satisfying motion helpers (with shared/motion-plus.css): sections rise into view as you scroll, main buttons get a
// soft ripple where you tap, and counters (cart, bell) bounce when their number changes. Purely visual; nothing
// here changes what a button does. Off when reduced motion is asked for.
(function () {
  const root = document.documentElement;
  const calm = () => root.dataset.motion === 'reduce' || matchMedia('(prefers-reduced-motion: reduce)').matches;

  // 1. sections rise into view
  const SECTIONS = '#page-home .ed-stage,#page-home .ed-two,#page-home .ed-mosaic,#page-home .ed-story,#page-home .ed-dark,#page-home .ed-gallery,#page-home .ed-cta,#page-home .home-faq,.pkg-grid,.shop-grid,.products-grid';
  const GRIDS = '.ed-two-grid,.ed-mosaic-grid,.ed-gallery-grid,.pkg-grid,.shop-grid,.products-grid';
  const seen = new WeakSet();
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }) : null;
  function reveal() {
    if (!io || calm() || /[?&]cms=/.test(location.search)) return;
    document.querySelectorAll(SECTIONS).forEach((el) => {
      if (seen.has(el)) return; seen.add(el);
      const r = el.getBoundingClientRect(); if (r.top < innerHeight * 0.9) return;   // already on screen: leave it
      el.classList.add('mp-reveal'); el.querySelectorAll(GRIDS).forEach((g) => g.classList.add('mp-stagger'));
      if (el.matches(GRIDS)) el.classList.add('mp-stagger');
      io.observe(el);
    });
  }

  // 2. ripple on main buttons
  const RIPPLE = '.btn-primary,.auth-btn,.co-submit-btn,.tc-go,.vw-claim,.cx-go,.bd-primary,.pkg-order-btn,.button.primary';
  document.addEventListener('pointerdown', (ev) => {
    const b = ev.target.closest?.(RIPPLE); if (!b || b.disabled || calm()) return;
    const r = b.getBoundingClientRect(), size = Math.max(r.width, r.height) * 2.2, dot = document.createElement('span');
    dot.className = 'mp-ripple'; dot.style.cssText = `width:${size}px;height:${size}px;left:${ev.clientX - r.left - size / 2}px;top:${ev.clientY - r.top - size / 2}px`;
    if (getComputedStyle(b).position === 'static') b.style.position = 'relative';
    if (getComputedStyle(b).overflow !== 'hidden') b.style.overflow = 'hidden';
    b.append(dot); setTimeout(() => dot.remove(), 650);
  }, { passive: true });

  // 3. the option you tapped pops; found again by its data-* attribute because designers redraw their panel
  const PICKS = '[role="radio"],[aria-pressed],.co-option,.bd-chip,.bd-card,.cd-preset,.bd-preset,.dt-slot,.dt-cal-day,.filter-item,.vw-ticket,.co-addr-opt';
  document.addEventListener('click', (ev) => {
    const el = ev.target.closest?.(PICKS); if (!el || calm()) return;
    const attr = [...el.attributes].find((a) => a.name.startsWith('data-') && a.value);
    setTimeout(() => {
      let target = el.isConnected ? el : null;
      if (!target && attr) { try { target = document.querySelector(`[${attr.name}="${CSS.escape(attr.value)}"]`); } catch { /* odd value */ } }
      if (!target) return;
      target.classList.remove('mp-pick'); void target.offsetWidth; target.classList.add('mp-pick');
      setTimeout(() => target.classList.remove('mp-pick'), 450);
    }, 30);
  });

  // 4. counters bounce when they change
  const COUNTERS = '#cartCount,.cart-count,.nav-cart-count,#notification-count,.notify-count,.nav-count,.lx-notify-count';
  const watch = new MutationObserver((list) => list.forEach((m) => {
    const el = m.target.nodeType === 3 ? m.target.parentElement : m.target;
    const badge = el?.closest?.(COUNTERS); if (!badge || calm()) return;
    badge.classList.remove('mp-bump'); void badge.offsetWidth; badge.classList.add('mp-bump');
  }));
  function start() {
    reveal();
    watch.observe(document.body, { subtree: true, characterData: true, childList: true });
    let queued = false; new MutationObserver(() => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; reveal(); }); }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
