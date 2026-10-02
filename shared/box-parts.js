// LexC's bakery box, built to fit any box size: a white paperboard tray with rounded folded corners and real
// wall thickness, a deep lid with a clear window (it closes when the customer adds the box to the cart), a lavender
// satin ribbon with a bow, and a soft contact shadow used under each treat. Geometry only; materials are passed in.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function roundedRect(w, d, r, cx = 0, cy = 0) {
  const s = new THREE.Shape(), x = cx - w / 2, y = cy - d / 2;
  r = Math.min(r, w / 2 - 0.001, d / 2 - 0.001);
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x + w, y + d - r); s.absarc(x + w - r, y + d - r, r, 0, Math.PI / 2, false);
  s.lineTo(x + r, y + d); s.absarc(x + r, y + d - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(x, y + r); s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}
function holePath(w, d, r) { const p = new THREE.Path(); p.setFromPoints(roundedRect(w, d, r).getPoints(12).reverse()); return p; }
// Extrude a flat shape upwards: shape XY -> world XZ (shape +y = world -z), thickness along +Y.
function up(shape, depth, bevel = 0) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 10 });
  g.rotateX(-Math.PI / 2); if (g.attributes.uv) g.deleteAttribute('uv'); return g.index ? g.toNonIndexed() : g;
}

// Tray: floor plus a folded wall all round (outer rounded rect minus the inner one), rim softly rounded.
export function trayGeometry(W, D, H, t = 0.03, r = 0.14) {
  const floor = up(roundedRect(W, D, r), t); floor.translate(0, -t, 0);
  const wall = roundedRect(W, D, r); wall.holes.push(holePath(W - t * 2, D - t * 2, Math.max(0.02, r - t)));
  const walls = up(wall, H - 0.012, 0.008); walls.translate(0, 0.004, 0);
  // a narrow paper fold on the inside of the rim, as on a real folded box
  const fold = roundedRect(W - t * 2, D - t * 2, Math.max(0.02, r - t)); fold.holes.push(holePath(W - t * 4.2, D - t * 4.2, Math.max(0.02, r - t * 2)));
  const lip = up(fold, H * 0.32); lip.translate(0, H * 0.66, 0);
  const g = mergeGeometries([floor, walls, lip]); [floor, walls, lip].forEach((x) => x.dispose()); g.computeVertexNormals(); return g;
}
// Pop stand / insert block with rounded corners.
export function blockGeometry(W, D, H, r = 0.1) { const g = up(roundedRect(W, D, r), H - 0.012, 0.008); g.translate(0, 0.004, 0); g.computeVertexNormals(); return g; }

// Lid, in hinge space: its back edge on the hinge line (z = 0), reaching forward to z = D; top at y = topY,
// skirts down to y = 0. Returns { board, window } geometries.
export function lidGeometry(W, D, topY, t = 0.025, r = 0.16) {
  const top = roundedRect(W, D, r, 0, -D / 2), ww = W * 0.62, wd = D * 0.58;
  { const p = new THREE.Path(); p.setFromPoints(roundedRect(ww, wd, 0.08, 0, -D / 2).getPoints(12).reverse()); top.holes.push(p); }   // the window
  const slab = up(top, t, 0.006); slab.translate(0, topY - t, 0);
  const skirtShape = roundedRect(W, D, r, 0, -D / 2); { const p = new THREE.Path(); p.setFromPoints(roundedRect(W - t * 2, D - t * 2, Math.max(0.02, r - t), 0, -D / 2).getPoints(12).reverse()); skirtShape.holes.push(p); }
  const skirts = up(skirtShape, topY - t); skirts.translate(0, 0, 0);
  const board = mergeGeometries([slab, skirts]); slab.dispose(); skirts.dispose(); board.computeVertexNormals();
  const window = up(roundedRect(ww + 0.04, wd + 0.04, 0.09, 0, -D / 2), 0.004); window.translate(0, topY - t * 0.6, 0);
  return { board, window };
}

// Satin ribbon crossing the closed box (over the lid and down every side) with a bow on top.
export function ribbonGeometry(W, D, H, width = 0.16) {
  const th = 0.012, parts = [];
  const strip = (w, h, d, x, y, z) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); parts.push(g); };
  strip(W + th * 2, th, width, 0, H + th / 2, 0); strip(width, th, D + th * 2, 0, H + th / 2, 0);   // over the top
  strip(th, H, width, -W / 2 - th / 2, H / 2, 0); strip(th, H, width, W / 2 + th / 2, H / 2, 0);    // down the sides
  strip(width, H, th, 0, H / 2, -D / 2 - th / 2); strip(width, H, th, 0, H / 2, D / 2 + th / 2);
  const ribbon = mergeGeometries(parts.map((g) => (g.deleteAttribute('uv'), g.index ? g.toNonIndexed() : g))); parts.forEach((g) => g.dispose());
  // bow: two flattened loops, a knot and two tails
  const k = Math.min(W, D) * 0.13 + 0.14, bp = [];
  for (const side of [-1, 1]) {
    // a satin loop: a wide, flat band (a squashed torus with a fat tube), leaning out and up from the knot
    const loop = new THREE.TorusGeometry(k * 0.5, k * 0.2, 12, 32); loop.scale(1, 0.62, 0.42); loop.rotateZ(side * 0.32); loop.rotateY(side * 0.25);
    loop.translate(side * k * 0.52, H + k * 0.34, 0); bp.push(loop);
    const tail = new THREE.BoxGeometry(width * 0.95, 0.012, k * 1.25); tail.rotateY(side * 0.45); tail.translate(side * k * 0.3, H + 0.016, k * 0.5); bp.push(tail);
  }
  const knot = new THREE.SphereGeometry(k * 0.24, 18, 14); knot.scale(1, 0.75, 0.9); knot.translate(0, H + k * 0.2, 0); bp.push(knot);
  const bow = mergeGeometries(bp.map((g) => (g.deleteAttribute('uv'), g.index ? g.toNonIndexed() : g))); bp.forEach((g) => g.dispose());
  ribbon.computeVertexNormals(); bow.computeVertexNormals();
  return { ribbon, bow, bowY: H };
}

// Soft round contact shadow (darkest in the middle), drawn on a flat plane under each treat.
let aoTexture = null;
export function contactShadowTexture() {
  if (aoTexture) return aoTexture;
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 6, 64, 64, 64);
  grad.addColorStop(0, 'rgba(40,24,30,0.55)'); grad.addColorStop(0.55, 'rgba(40,24,30,0.28)'); grad.addColorStop(1, 'rgba(40,24,30,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  aoTexture = new THREE.CanvasTexture(c); aoTexture.colorSpace = THREE.SRGBColorSpace; return aoTexture;
}
