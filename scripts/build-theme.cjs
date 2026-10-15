// Builds the customer dark theme and text-size layers from the existing stylesheets.
// Run after changing customer CSS:  node scripts/build-theme.cjs
// Each output repeats every colour rule of its sources in the same order, prefixed with html[data-theme=dark],
// so the cascade between rules stays as it was. Light surfaces become deep plum tints of the same hue, dark ink
// becomes soft light text, saturated brand colours are kept. px font sizes become rem so the text-size setting
// scales them too. Hand-tuned colours live in shared/theme/appearance.css.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const indexInline = () => { const html = read('index.html'); return html.slice(html.indexOf('<style>') + 7, html.indexOf('</style>')); };

const PAGES = {
  'shared/theme/site-dark.css': ['shared/brand.css', indexInline, 'shared/customer-flow.css', 'shared/product-detail.css', 'shared/chat-widget.css', 'shared/fresh-feed.css', 'shared/landing.css', 'shared/bento-designer.css', 'shared/cupcake-designer.css', 'shared/selected-ui.css', 'shared/menu-layout.css', 'shared/motion.css'],
  'shared/theme/payment-dark.css': ['shared/brand.css', 'payment/payment.css', 'shared/motion.css'],
  'shared/theme/chat-dark.css': ['shared/brand.css', 'shared/chat.css', 'shared/motion.css'],
};

// ---------- colours
const NAMED = { white: '#ffffff', black: '#000000' };
function parseColor(text) {
  text = text.trim().toLowerCase();
  if (NAMED[text]) text = NAMED[text];
  let m = text.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  m = text.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4] };
  return null;
}
function toHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
}
function fromHsl(h, s, l, a) {
  const k = (n) => (n + h / 30) % 12, f = (n) => l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  const c = (v) => Math.round(v * 255);
  return a < 1 ? `rgba(${c(f(0))},${c(f(8))},${c(f(4))},${+a.toFixed(3)})` : '#' + [f(0), f(8), f(4)].map((v) => c(v).toString(16).padStart(2, '0')).join('');
}
// surfaces (backgrounds, borders, rings)
// near-neutral colours (white, cream, greys) take the plum hue; real tints (success green, warning amber, pink) keep theirs
const PLUM_HUE = 278;
const chroma = ({ r, g, b }) => (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
function surface(color, border) {
  const { h, l } = toHsl(color), c = chroma(color), neutral = c < 0.07;
  let nl;
  if (l >= 0.85) nl = 0.1 + (1 - l) * 0.8;
  else if (l >= 0.62) nl = 0.19 + (0.85 - l) * 0.5;
  else return null; // saturated brand colour or already dark: keep
  if (border) nl += 0.08;
  return fromHsl(neutral ? PLUM_HUE : h, neutral ? 0.2 : Math.min(0.42, 0.16 + c * 1.1), nl, color.a);
}
// text
function ink(color) {
  const { h, s, l } = toHsl(color), neutral = chroma(color) < 0.07;
  if (l <= 0.5) return fromHsl(neutral ? PLUM_HUE : h, neutral ? 0.22 : Math.min(s, 0.6) * 0.6 + 0.1, 0.9 - l * 0.4, color.a);
  if (l < 0.72) return fromHsl(h, s * 0.85, Math.max(l, 0.74), color.a);
  return null;
}
const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|\b(?:white|black)\b/g;
function mapValue(value, kind) {
  return value.replace(COLOR_RE, (match) => {
    const c = parseColor(match); if (!c) return match;
    const out = kind === 'ink' ? ink(c) : surface(c, kind === 'border');
    return out || match;
  });
}

// ---------- variables (resolved to their light values so each use is mapped by how it is used)
const vars = {};
function collectVars(css) { for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+)/g)) if (!(m[1] in vars)) vars[m[1]] = m[2].trim(); }
const resolve = (value) => value.replace(/var\((--[\w-]+)(?:\s*,\s*([^)]+))?\)/g, (all, name, fallback) => {
  const v = vars[name] ?? fallback; return v && (parseColor(v) || /gradient|#|rgb/.test(v)) ? v : all;
});

// ---------- tiny CSS parser: rules, @media/@supports/@container blocks; @keyframes and @font-face are skipped
function parse(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let i = 0;
  function block() {
    const items = [];
    while (i < css.length) {
      const close = css.indexOf('}', i), open = css.indexOf('{', i);
      if (close !== -1 && (open === -1 || close < open)) { i = close + 1; return items; }
      if (open === -1) { i = css.length; break; }
      const head = css.slice(i, open).trim().replace(/^[;\s]+/, ''); i = open + 1;
      if (/^@(media|supports|container|layer)/.test(head)) items.push({ at: head, items: block() });
      else if (head.startsWith('@')) skip();
      else { const end = findClose(); items.push({ sel: head, body: css.slice(i, end) }); i = end + 1; }
    }
    return items;
  }
  function skip() { let depth = 1; while (i < css.length && depth) { if (css[i] === '{') depth++; else if (css[i] === '}') depth--; i++; } }
  function findClose() { let depth = 1, j = i; while (j < css.length) { if (css[j] === '{') depth++; else if (css[j] === '}' && !--depth) return j; j++; } return j; }
  return block();
}
function splitTop(text, sep) { const out = []; let depth = 0, cur = ''; for (const ch of text) { if (ch === '(' || ch === '[') depth++; if (ch === ')' || ch === ']') depth--; if (ch === sep && !depth) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; }

const PROP_KIND = (prop) => {
  if (/^(color|caret-color|-webkit-text-fill-color|text-decoration-color|fill|stroke|column-rule-color)$/.test(prop)) return 'ink';
  if (/^(border(-(top|right|bottom|left|block|inline)(-(start|end))?)?(-color)?|outline(-color)?)$/.test(prop)) return 'border';
  if (/^(background(-color|-image)?|box-shadow|text-shadow|accent-color|scrollbar-color)$/.test(prop)) return 'surface';
  return null;
};
function prefix(sel, attr) {
  return splitTop(sel, ',').map((s) => {
    s = s.trim(); if (!s) return s;
    if (/^:root\b/.test(s)) return 'html' + attr + s.slice(5);
    if (/^html\b/.test(s)) return 'html' + attr + s.slice(4);
    return 'html' + attr + ' ' + s;
  }).join(',');
}
function build(items, mode) {
  let out = '';
  for (const item of items) {
    if (item.at) { const inner = build(item.items, mode); if (inner) out += item.at + '{' + inner + '}\n'; continue; }
    const decls = [];
    for (const raw of splitTop(item.body, ';')) {
      const at = raw.indexOf(':'); if (at < 0) continue;
      const prop = raw.slice(0, at).trim().toLowerCase(); let value = raw.slice(at + 1).trim();
      if (!value || prop.startsWith('--')) continue;
      if (mode === 'dark') {
        const kind = PROP_KIND(prop); if (!kind) continue;
        const resolved = resolve(value);
        if (!COLOR_RE.test(resolved) && resolved === value) { COLOR_RE.lastIndex = 0; continue; }
        COLOR_RE.lastIndex = 0;
        decls.push(prop + ':' + mapValue(resolved, kind));
      } else if (prop === 'font-size') {
        decls.push(prop + ':' + value.replace(/(\d*\.?\d+)px/g, (m, n) => +(n / 16).toFixed(4) + 'rem'));
      }
    }
    if (decls.length) out += prefix(item.sel, mode === 'dark' ? '[data-theme=dark]' : '[data-text]') + '{' + decls.join(';') + '}\n';
  }
  return out;
}

for (const [out, sources] of Object.entries(PAGES)) {
  const texts = sources.map((src) => typeof src === 'function' ? src() : read(src));
  texts.forEach(collectVars);
  let dark = '', size = '';
  texts.forEach((css, n) => {
    const name = typeof sources[n] === 'function' ? 'index.html <style>' : sources[n];
    const tree = parse(css);
    const d = build(tree, 'dark'); if (d) dark += `/* ${name} */\n` + d;
    if (/font-size\s*:[^;}]*\d+px/.test(css)) { const s = build(tree, 'size'); if (s) size += `/* ${name} */\n` + s; }
  });
  fs.mkdirSync(path.dirname(path.join(root, out)), { recursive: true });
  fs.writeFileSync(path.join(root, out), '/* Generated by scripts/build-theme.cjs — do not edit by hand. */\n' + dark);
  fs.writeFileSync(path.join(root, out.replace('-dark.css', '-text.css')), '/* Generated by scripts/build-theme.cjs — do not edit by hand. */\n' + size);
  console.log(out, (dark.length / 1024).toFixed(0) + ' KB dark,', (size.length / 1024).toFixed(0) + ' KB text');
}
