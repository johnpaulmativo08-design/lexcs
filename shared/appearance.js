// Customer appearance: Light / Dark theme and text size, remembered on this device.
// Loaded in <head> (not deferred) so the saved look applies before the page draws, with no white flash.
// <script src="shared/appearance.js" data-page="site|payment|chat"></script>
(function () {
  const script = document.currentScript, base = script.src.replace(/appearance\.js.*$/, ''), page = script.dataset.page || 'site';
  const root = document.documentElement;
  const SIZES = [['sm', 'Small'], ['md', 'Default'], ['lg', 'Large'], ['xl', 'Extra large']];
  const read = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
  const save = (key, value) => { try { localStorage.setItem(key, value); } catch { /* private mode: applies for this visit only */ } };
  // Admin previews of a customer design keep the default look
  const embedded = /[?&]embed=/.test(location.search);
  let darkSheet = null;

  function setTheme(theme) {
    theme = theme === 'dark' ? 'dark' : 'light';
    if (theme === 'dark' && !darkSheet) {
      darkSheet = document.createElement('link'); darkSheet.rel = 'stylesheet'; darkSheet.href = base + 'theme/' + page + '-dark.css?v=1';
      document.head.append(darkSheet);
    }
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    let meta = document.querySelector('meta[name=theme-color]');
    if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.append(meta); }
    meta.content = theme === 'dark' ? '#17121c' : '#fbf9fd';
  }
  function setSize(size) {
    if (size && size !== 'md' && SIZES.some(([key]) => key === size)) root.dataset.text = size; else delete root.dataset.text;
  }
  if (!embedded) { setTheme(read('lexc_theme')); setSize(read('lexc_text')); }

  // smooth blend between themes (skipped when the device asks for reduced motion)
  function blend() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    root.classList.add('lx-theme-blend'); clearTimeout(blend.timer);
    blend.timer = setTimeout(() => root.classList.remove('lx-theme-blend'), 450);
  }

  const ICON = {
    sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    moon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>',
    palette: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 0 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-.9-.6-1.3-.6-2.1 0-.9.7-1.6 1.6-1.6H17a4 4 0 0 0 4-4C21 7 17 3 12 3z"/><circle cx="7.5" cy="11" r="1.2"/><circle cx="10" cy="7" r="1.2"/><circle cx="15" cy="7.5" r="1.2"/></svg>',
  };
  let dialog = null, opener = null;
  function render() {
    const theme = root.dataset.theme || 'light', size = root.dataset.text || 'md';
    dialog.querySelectorAll('[data-theme-choice]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.themeChoice === theme)));
    dialog.querySelectorAll('[data-size-choice]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.sizeChoice === size)));
  }
  function build() {
    dialog = document.createElement('dialog');
    dialog.className = 'lx-appear';
    dialog.setAttribute('aria-labelledby', 'lxAppearTitle');
    dialog.innerHTML =
      '<div class="lx-appear-head"><h2 id="lxAppearTitle">Appearance</h2><button type="button" class="lx-appear-close" aria-label="Close appearance settings" data-close>×</button></div>' +
      '<p class="lx-appear-label" id="lxThemeLabel">Theme</p><div class="lx-appear-themes" role="radiogroup" aria-labelledby="lxThemeLabel">' +
      '<button type="button" role="radio" data-theme-choice="light"><span class="lx-swatch lx-swatch--light" aria-hidden="true"><i></i><i></i><i></i></span><span class="lx-appear-name">' + ICON.sun + 'Light</span></button>' +
      '<button type="button" role="radio" data-theme-choice="dark"><span class="lx-swatch lx-swatch--dark" aria-hidden="true"><i></i><i></i><i></i></span><span class="lx-appear-name">' + ICON.moon + 'Dark</span></button></div>' +
      '<p class="lx-appear-label" id="lxSizeLabel">Text size</p><div class="lx-appear-sizes" role="radiogroup" aria-labelledby="lxSizeLabel">' +
      SIZES.map(([key, label], n) => '<button type="button" role="radio" data-size-choice="' + key + '" aria-label="' + label + '"><span style="font-size:' + (13 + n * 3) + 'px" aria-hidden="true">A</span><small>' + label + '</small></button>').join('') + '</div>' +
      '<p class="lx-appear-preview">Freshly baked treats, made to order. This is how text will look.</p>' +
      '<p class="lx-appear-note">Saved on this device.</p>';
    document.body.append(dialog);
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog || event.target.closest('[data-close]')) return close();
      const themeButton = event.target.closest('[data-theme-choice]'), sizeButton = event.target.closest('[data-size-choice]');
      if (themeButton) { blend(); setTheme(themeButton.dataset.themeChoice); save('lexc_theme', root.dataset.theme); render(); }
      if (sizeButton) { setSize(sizeButton.dataset.sizeChoice); save('lexc_text', sizeButton.dataset.sizeChoice); render(); }
    });
    // arrow keys move between options inside each group
    dialog.addEventListener('keydown', (event) => {
      const group = event.target.closest('[role=radiogroup]'); if (!group || !/^Arrow(Left|Right|Up|Down)$/.test(event.key)) return;
      const items = [...group.querySelectorAll('[role=radio]')], at = items.indexOf(event.target.closest('[role=radio]'));
      const next = items[(at + (/Right|Down/.test(event.key) ? 1 : -1) + items.length) % items.length];
      event.preventDefault(); next.focus(); next.click();
    });
    dialog.addEventListener('close', () => opener?.focus?.());
  }
  function open(event) {
    if (!dialog) build();
    opener = event?.currentTarget || document.activeElement;
    render();
    dialog.showModal();
    dialog.querySelector('[aria-checked=true]')?.focus();
  }
  function close() { dialog?.close(); }

  // Entry points: desktop nav, the mobile "More" menu, and the header on the payment and chat pages
  function addButtons() {
    if (embedded) return;
    const button = (cls, text) => { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.setAttribute('aria-label', 'Appearance: theme and text size'); b.innerHTML = ICON.palette + (text ? '<span>' + text + '</span>' : ''); b.addEventListener('click', open); return b; };
    const cart = document.getElementById('navShoppingButton');
    if (cart) cart.before(button('nav-appear-btn'));
    const account = document.getElementById('customerAccountAction');
    if (account) { const b = button('lx-more-appear', 'Appearance'); b.addEventListener('click', () => window.closeCustomerMoreMenu?.()); account.before(b); }
    if (page !== 'site') document.querySelector('body > header')?.append(button('lx-header-appear', 'Appearance'));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addButtons); else addButtons();

  window.LexcAppearance = { open, close, setTheme: (t) => { blend(); setTheme(t); save('lexc_theme', root.dataset.theme); }, setSize: (s) => { setSize(s); save('lexc_text', s); } };
})();
