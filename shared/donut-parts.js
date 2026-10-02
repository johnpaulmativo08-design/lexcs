// Fondant pieces for the donut designer, as LexC's cuts them: flat cut-outs with soft rounded edges,
// layered (a flower's centre sits on its petals), laid on top of the glaze. Built from 2D shapes in a unit
// circle (radius 1 = the donut's outer edge) and extruded; every piece carries its colour as vertex colours
// so one theme's pieces become one mesh. Also: fondant letter decals and scalloped name plaques.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const TAU = Math.PI * 2;

// ---- 2D shape helpers ------------------------------------------------------------------------------
function ellipse(cx, cy, rx, ry, rot = 0, n = 28) {
  const s = new THREE.Shape(), c = Math.cos(rot), sn = Math.sin(rot);
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * TAU, x = Math.cos(a) * rx, y = Math.sin(a) * ry, px = cx + x * c - y * sn, py = cy + x * sn + y * c;
    if (i === 0) s.moveTo(px, py); else s.lineTo(px, py);
  }
  return s;
}
const circle = (cx, cy, r) => ellipse(cx, cy, r, r, 0, 32);
function poly(points) { const s = new THREE.Shape(); points.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y))); s.closePath(); return s; }
function rrect(x, y, w, h, r) {
  const s = new THREE.Shape();
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h); s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return s;
}
function heart(cx, cy, k) {
  const s = new THREE.Shape(); s.moveTo(cx, cy - 0.55 * k);
  s.bezierCurveTo(cx - 0.9 * k, cy - 0.05 * k, cx - 0.55 * k, cy + 0.65 * k, cx, cy + 0.28 * k);
  s.bezierCurveTo(cx + 0.55 * k, cy + 0.65 * k, cx + 0.9 * k, cy - 0.05 * k, cx, cy - 0.55 * k); return s;
}
function star(cx, cy, r1, r2, n = 5, rot = Math.PI / 2) {
  const pts = []; for (let i = 0; i < n * 2; i++) { const a = rot + (i * Math.PI) / n, r = i % 2 ? r2 : r1; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  return poly(pts);
}
function scallop(cx, cy, r, bumps = 16, depth = 0.08) {
  const s = new THREE.Shape(), n = bumps * 8;
  for (let i = 0; i <= n; i++) { const a = (i / n) * TAU, rr = r * (1 - depth + depth * Math.abs(Math.cos(a * bumps / 2))); const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr; if (i) s.lineTo(x, y); else s.moveTo(x, y); }
  return s;
}
const shade = (hex, amt) => { const c = new THREE.Color(hex), hsl = {}; c.getHSL(hsl); return new THREE.Color().setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + amt))); };

// ---- motifs: lists of [shape, colour, layer] ----------------------------------------------------------
function flower(cx, cy, R, petals, petal, center, n = 10) {
  const out = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * TAU; out.push([ellipse(cx + Math.cos(a) * R * 0.55, cy + Math.sin(a) * R * 0.55, R * 0.48, R * 0.17, a), petal, 0]); }
  out.push([circle(cx, cy, R * 0.3), center, 1]);
  return out;
}
const daisy = (cx, cy, R, center = '#F4C542') => flower(cx, cy, R, 12, '#FFFFFF', center, 12);
const sunflower = (cx, cy, R) => [...flower(cx, cy, R, 14, '#F5B82E', '#6B4226', 14), [circle(cx, cy, R * 0.22), '#4A2C1A', 2]];
function butterfly(cx, cy, k, color, rot = 0) {
  const c = Math.cos(rot), s = Math.sin(rot), P = (x, y) => [cx + x * c - y * s, cy + x * s + y * c];
  const wing = (x, y, rx, ry, a) => { const [px, py] = P(x * k, y * k); return [ellipse(px, py, rx * k, ry * k, a + rot), color, 0]; };
  const [bx, by] = P(0, 0);
  return [wing(-0.42, 0.28, 0.48, 0.34, 0.55), wing(0.42, 0.28, 0.48, 0.34, -0.55), wing(-0.3, -0.3, 0.3, 0.24, -0.5), wing(0.3, -0.3, 0.3, 0.24, 0.5),
    [ellipse(bx, by, 0.08 * k, 0.5 * k, rot), shade(color, -0.22), 1]];
}
function bee(cx, cy, k) {
  return [[ellipse(cx - 0.18 * k, cy + 0.38 * k, 0.3 * k, 0.22 * k, 0.5), '#FFFFFF', 0], [ellipse(cx + 0.18 * k, cy + 0.38 * k, 0.3 * k, 0.22 * k, -0.5), '#FFFFFF', 0],
    [ellipse(cx, cy, 0.42 * k, 0.3 * k, 0), '#F7C842', 1],
    [rrect(cx - 0.17 * k, cy - 0.3 * k, 0.1 * k, 0.6 * k, 0.04 * k), '#222222', 2], [rrect(cx + 0.06 * k, cy - 0.28 * k, 0.1 * k, 0.56 * k, 0.04 * k), '#222222', 2]];
}
function honeycomb(cx, cy, k) {
  const out = [], hex = (x, y, r) => poly(Array.from({ length: 6 }, (_, i) => [x + Math.cos(i * Math.PI / 3) * r, y + Math.sin(i * Math.PI / 3) * r]));
  for (const [dx, dy] of [[0, 0], [0.31, 0.18], [0.31, -0.18], [0, 0.36], [-0.31, 0.18]]) out.push([hex(cx + dx * k, cy + dy * k, 0.17 * k), '#F2C230', 0]);
  return out;
}
function rainbow(cx, cy, k, bands) {
  const out = []; const w = 0.12 * k;
  bands.forEach((col, i) => {
    const r = (0.62 - i * 0.12) * k, s = new THREE.Shape();
    s.absarc(cx, cy, r, 0, Math.PI, false); s.absarc(cx, cy, r - w, Math.PI, 0, true);
    out.push([s, col, 0]);
  });
  return out;
}
function cloud(cx, cy, k) { return [[circle(cx - 0.22 * k, cy, 0.2 * k), '#FFFFFF', 1], [circle(cx, cy + 0.08 * k, 0.25 * k), '#FFFFFF', 1], [circle(cx + 0.24 * k, cy, 0.19 * k), '#FFFFFF', 1], [rrect(cx - 0.4 * k, cy - 0.15 * k, 0.8 * k, 0.17 * k, 0.08 * k), '#FFFFFF', 1]]; }
function mushroom(cx, cy, k, cap) {
  const capS = new THREE.Shape(); capS.absarc(cx, cy, 0.5 * k, 0, Math.PI, false); capS.closePath();
  return [[rrect(cx - 0.15 * k, cy - 0.5 * k, 0.3 * k, 0.52 * k, 0.1 * k), '#F4EFE6', 0], [capS, cap, 1],
    [circle(cx - 0.22 * k, cy + 0.18 * k, 0.07 * k), '#FFFFFF', 2], [circle(cx + 0.05 * k, cy + 0.3 * k, 0.07 * k), '#FFFFFF', 2], [circle(cx + 0.27 * k, cy + 0.12 * k, 0.06 * k), '#FFFFFF', 2]];
}
function truck(cx, cy, k, body) {
  return [[rrect(cx - 0.55 * k, cy - 0.1 * k, 0.75 * k, 0.42 * k, 0.05 * k), body, 0], [poly([[cx + 0.2 * k, cy - 0.1 * k], [cx + 0.55 * k, cy - 0.1 * k], [cx + 0.55 * k, cy + 0.12 * k], [cx + 0.4 * k, cy + 0.3 * k], [cx + 0.2 * k, cy + 0.3 * k]]), shade(body, -0.08), 0],
    [circle(cx - 0.32 * k, cy - 0.18 * k, 0.17 * k), '#3A3A3A', 1], [circle(cx + 0.32 * k, cy - 0.18 * k, 0.17 * k), '#3A3A3A', 1],
    [circle(cx - 0.32 * k, cy - 0.18 * k, 0.07 * k), '#9A9A9A', 2], [circle(cx + 0.32 * k, cy - 0.18 * k, 0.07 * k), '#9A9A9A', 2]];
}
function cone(cx, cy, k) { return [[poly([[cx - 0.35 * k, cy - 0.45 * k], [cx + 0.35 * k, cy - 0.45 * k], [cx + 0.06 * k, cy + 0.5 * k], [cx - 0.06 * k, cy + 0.5 * k]]), '#F28C38', 0], [rrect(cx - 0.2 * k, cy - 0.08 * k, 0.4 * k, 0.12 * k, 0.03 * k), '#FFFFFF', 1]]; }
function hammer(cx, cy, k) { return [[rrect(cx - 0.06 * k, cy - 0.55 * k, 0.12 * k, 0.85 * k, 0.05 * k), '#B8B8C4', 0], [rrect(cx - 0.32 * k, cy + 0.22 * k, 0.64 * k, 0.2 * k, 0.05 * k), '#5A5A66', 1]]; }
function balloon(cx, cy, k, col) {
  return [[ellipse(cx, cy + 0.12 * k, 0.42 * k, 0.48 * k), col, 0], [rrect(cx - 0.1 * k, cy - 0.58 * k, 0.2 * k, 0.16 * k, 0.03 * k), '#C99A5E', 0],
    [ellipse(cx - 0.14 * k, cy + 0.12 * k, 0.08 * k, 0.42 * k), shade(col, 0.12), 1], [ellipse(cx + 0.14 * k, cy + 0.12 * k, 0.08 * k, 0.42 * k), shade(col, 0.12), 1]];
}
function block(cx, cy, k, letterCol) { return [[rrect(cx - 0.32 * k, cy - 0.32 * k, 0.64 * k, 0.64 * k, 0.06 * k), '#FFFFFF', 0], [rrect(cx - 0.18 * k, cy - 0.18 * k, 0.36 * k, 0.36 * k, 0.04 * k), letterCol, 1]]; }
function bow(cx, cy, k, col) {
  return [[poly([[cx, cy], [cx - 0.55 * k, cy + 0.32 * k], [cx - 0.6 * k, cy - 0.3 * k]]), col, 0], [poly([[cx, cy], [cx + 0.55 * k, cy + 0.32 * k], [cx + 0.6 * k, cy - 0.3 * k]]), col, 0],
    [poly([[cx - 0.05 * k, cy], [cx - 0.28 * k, cy - 0.55 * k], [cx - 0.1 * k, cy - 0.5 * k]]), col, 0], [poly([[cx + 0.05 * k, cy], [cx + 0.28 * k, cy - 0.55 * k], [cx + 0.1 * k, cy - 0.5 * k]]), col, 0],
    [circle(cx, cy, 0.14 * k), shade(col, -0.1), 1]];
}
function candy(cx, cy, k, col) {
  return [[poly([[cx - 0.25 * k, cy], [cx - 0.55 * k, cy + 0.22 * k], [cx - 0.55 * k, cy - 0.22 * k]]), '#FFFFFF', 0], [poly([[cx + 0.25 * k, cy], [cx + 0.55 * k, cy + 0.22 * k], [cx + 0.55 * k, cy - 0.22 * k]]), '#FFFFFF', 0],
    [ellipse(cx, cy, 0.3 * k, 0.24 * k), col, 1]];
}

// Each theme: a few motifs cycled across the box (variant picks which), coloured to suit the glaze.
const THEMES = {
  butterfly: [(c) => butterfly(0, 0.05, 0.75, c.accent, -0.15), (c) => [...daisy(-0.3, 0.1, 0.32, c.accent2), ...butterfly(0.32, -0.12, 0.36, c.accent, 0.3)], (c) => butterfly(0, 0, 0.62, c.accent2, 0.2)],
  garden: [(c) => [...daisy(-0.25, 0.15, 0.34), ...daisy(0.3, -0.18, 0.28, c.accent)], (c) => sunflower(0, 0, 0.55), (c) => [...daisy(0, 0.25, 0.3, c.accent2), ...daisy(-0.3, -0.25, 0.24), ...daisy(0.33, -0.2, 0.22)]],
  bees: [(c) => bee(0, 0, 0.75), (c) => [...honeycomb(-0.25, 0.1, 0.8), ...daisy(0.38, -0.25, 0.25)], (c) => [...sunflower(-0.25, 0.15, 0.38), ...bee(0.3, -0.25, 0.45)]],
  rainbow: [(c) => [...rainbow(0, -0.1, 0.95, ['#C9A7E8', '#F4B6C8', '#F9E27D', '#BFDDF4']), ...cloud(-0.5, -0.12, 0.55), ...cloud(0.5, -0.12, 0.55)], (c) => [...cloud(0, 0.1, 0.9)]],
  fairy: [(c) => mushroom(0, 0.05, 0.8, c.accent), (c) => butterfly(0, 0, 0.7, c.accent2, 0.15), (c) => [...mushroom(-0.25, 0.05, 0.5, c.accent2), ...butterfly(0.35, -0.15, 0.3, c.accent, 0.4)]],
  construction: [(c) => truck(0, 0.05, 0.85, '#F5C531'), (c) => cone(0, 0, 0.8), (c) => hammer(0, 0, 0.8), (c) => truck(0, 0.05, 0.85, '#F28C38')],
  baby: [(c) => [...balloon(0, 0.12, 0.75, '#9CCFF0'), ...cloud(0, -0.35, 0.6)], (c) => [...block(-0.28, 0.05, 0.75, '#F9E27D'), ...block(0.32, -0.12, 0.6, '#9CCFF0')], (c) => [...rainbow(0, -0.1, 0.9, ['#7FB8E6', '#BFDDF4', '#FFFFFF']), ...cloud(-0.45, -0.12, 0.5)]],
  bows: [(c) => bow(0, 0, 0.8, c.accent), (c) => [...candy(-0.15, 0.2, 0.6, c.accent2), ...candy(0.25, -0.25, 0.55, c.accent)], (c) => [[heart(0, 0.05, 0.85), c.accent, 0]]],
  custom: [(c) => [[star(0, 0, 0.6, 0.27), '#F6D365', 0]], (c) => [[heart(0, 0.05, 0.8), c.accent, 0]]]
};

// Accent colours that read on the glaze: light glazes get the deeper accents, deep glazes the pastels.
function accents(glazeHex) {
  const l = new THREE.Color(glazeHex).getHSL({}).l;
  return l > 0.6 ? { accent: '#9B6FD0', accent2: '#E86FA3' } : { accent: '#F4B6C8', accent2: '#CDB8E8' };
}

// Extruded, vertex-coloured fondant: geometry lies flat (thickness along +Y), centred on the origin.
export function fondant(list, scale) {
  const geos = list.map(([shape, color, layer]) => {
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.022, bevelSegments: 2, curveSegments: 10 });
    g.translate(0, 0, layer * 0.045); g.rotateX(-Math.PI / 2); g.scale(scale, scale, scale);
    if (g.attributes.uv) g.deleteAttribute('uv');
    const c = new THREE.Color(color), n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g.index ? g.toNonIndexed() : g;
  });
  const merged = mergeGeometries(geos); geos.forEach((g) => g.dispose()); merged.computeVertexNormals(); return merged;
}
export function themePiece(theme, variant, glazeHex, scale) {
  const list = THEMES[theme]; if (!list) return null;
  return fondant(list[variant % list.length](accents(glazeHex)), scale);
}
export function plaquePiece(scale) { return fondant([[scallop(0, 0, 0.78, 16, 0.07), '#FFFFFF', 0]], scale); }

// Fondant letters: a canvas decal (letters with a soft darker edge so they read as raised fondant).
export function letterTexture(text, colorHex) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256; const g = c.getContext('2d');
  const len = Math.max(1, [...text].length), size = Math.min(210, 420 / (len * 0.62));
  g.font = `800 ${size}px "Baloo 2", "Fredoka", "Nunito", "DM Sans", Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  const base = new THREE.Color(colorHex), edge = shade(colorHex, -0.22).getStyle(), hi = shade(colorHex, 0.12).getStyle();
  g.lineJoin = 'round';
  g.fillStyle = edge; g.strokeStyle = edge; g.lineWidth = size * 0.12; g.strokeText(text, 262, 136); g.fillText(text, 262, 136);
  g.fillStyle = base.getStyle(); g.fillText(text, 256, 128);
  g.fillStyle = hi; g.globalAlpha = 0.35; g.fillText(text, 253, 124); g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
