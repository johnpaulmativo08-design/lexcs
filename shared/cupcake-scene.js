// Three.js preview for the cupcake designer: the real box in 3D, every cupcake piped from the customer's
// choices the way a baker pipes it (star-tip swirls and rosettes, drop-flower blooms, hydrangea, ruffles),
// sitting in pleated liners, finished with pearls, gold balls, leaves, glitter and fondant topper plaques.
// Loaded on demand; renders only when something changes. Identical cupcakes share one built template.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { M, SURF, withSurface, shade, marbleTexture, linenTexture, fadeTexture } from './bento-scene.js?v=23';

const TAU = Math.PI * 2;
// Units: 1 = 5 cm. rb/rt: liner bottom/top radius, h: liner height, gap: spacing in the box insert.
const SIZES = {
  mini: { rb: 0.3, rt: 0.4, h: 0.33, gap: 0.92 },
  regular: { rb: 0.45, rt: 0.58, h: 0.52, gap: 1.32 }
};
const CRUMB = { scale: [22, 22, 22], fine: 60, strength: 0.022, rough: 0.2 };   // baked cake top: open crumb
const THEME_BG = { mermaid: '#9be3d6', butterfly: '#f9c8e0', unicorn: '#e8d9ff', dinosaur: '#c8ecb0', space: '#2b2f5e', safari: '#f3d9a4', custom: '#fff3c4' };
function seeded(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ---- Blender model (assets/3d/cupcake.glb) -------------------------------------------------------------
// Modelled with the liner's top radius = 1 and its rim at y = 0.9. Pieces: liner, cake_top, frost_swirl,
// frost_rosette (placed on the rim), and bloom, floret, petal, leaf, plaque, pearl_cc (unit parts at the
// origin; their display positions in Blender are ignored). Frosting UVs: u = around the piped rope,
// v = along it, so the customer's colours can be laid in as stripes. Built-in shapes are the fallback.
const MODEL_URL = new URL('../assets/3d/cupcake.glb?v=1', import.meta.url).href, RIM = 0.9;
let modelPromise = null;
function loadModel() {
  modelPromise ||= (async () => {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const gltf = await new GLTFLoader().loadAsync(MODEL_URL), parts = {};
    gltf.scene.traverse((o) => {
      if (!o.isMesh || parts[o.name]) return;
      const g = o.geometry.clone();
      // Pieces made on the cupcake keep their height; loose parts are used from their own origin.
      if (['liner', 'cake_top', 'frost_swirl', 'frost_rosette'].includes(o.name)) g.translate(0, o.position.y, 0);
      parts[o.name] = g;
    });
    for (const need of ['liner', 'cake_top', 'frost_swirl', 'frost_rosette']) if (!parts[need]) throw new Error('Model is missing "' + need + '"');
    // Loose parts are modelled pointing along Blender +Y, which is -Z here; turn them to point along +Z.
    for (const n of ['petal', 'leaf']) parts[n]?.rotateY(Math.PI);
    gltf.scene.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.map?.dispose(); m.dispose(); }); } });
    return parts;
  })();
  return modelPromise;
}
let MODEL = null;
// Model -> this cupcake size: frosting keeps its shape (uniform scale) and sits on the liner rim.
function onRim(geo, s, scale = 1) { const g = geo.clone(); g.translate(0, -RIM, 0); g.scale(s.rt * scale, s.rt * scale, s.rt * scale); g.translate(0, s.h, 0); return g; }
// Colours from the UVs: several colours in one bag give stripes that turn along the rope.
function stripes(geo, colors, turns) {
  const uv = geo.attributes.uv, n = geo.attributes.position.count, out = new Float32Array(n * 3), cols = colors.map((c) => new THREE.Color(c));
  for (let i = 0; i < n; i++) {
    const c = cols.length === 1 || !uv ? cols[0] : cols[Math.floor(((((uv.getX(i) + uv.getY(i) * turns) % 1) + 1) % 1) * cols.length) % cols.length];
    out[i * 3] = c.r; out[i * 3 + 1] = c.g; out[i * 3 + 2] = c.b;
  }
  if (uv) geo.deleteAttribute('uv');
  geo.setAttribute('color', new THREE.BufferAttribute(out, 3)); return geo;
}

// ---- geometry helpers ------------------------------------------------------------------------------
function paint(geo, color) {
  if (geo.attributes.uv) geo.deleteAttribute('uv');
  const c = new THREE.Color(color), n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3)); return geo;
}
const helper = new THREE.Object3D();
function placed(geo, pos, rot = [0, 0, 0], scale = [1, 1, 1], order = 'XYZ') {
  helper.position.copy(pos); helper.rotation.set(rot[0], rot[1], rot[2], order); helper.scale.set(...scale); helper.updateMatrix();
  return geo.applyMatrix4(helper.matrix);
}
// A rope of frosting squeezed through a star tip along a path. The cross-section has the tip's teeth;
// a bag filled with several colours side by side gives stripes that turn as the rope is piped.
function pipe(points, { radius, colors, teeth = 8, depth = 0.14, ridgeTwist = 0.15, colorTurns = 2.5, seg = 30, tStart = 0.05, tEnd = 0.14, flat = 0.88 }) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const n = Math.max(12, Math.min(300, Math.round(curve.getLength() / 0.007)));
  const { normals, binormals } = curve.computeFrenetFrames(n, false);
  const pos = new Float32Array((n + 1) * (seg + 1) * 3), col = new Float32Array(pos.length);
  const cols = colors.map((c) => new THREE.Color(c)), p = new THREE.Vector3(), v = new THREE.Vector3();
  let k = 0;
  for (let i = 0; i <= n; i++) {
    const t = i / n; curve.getPointAt(t, p);
    const taper = t < tStart ? Math.sqrt(t / tStart) : t > 1 - tEnd ? Math.pow((1 - t) / tEnd, 0.7) : 1;
    const r = radius(t) * taper;
    for (let j = 0; j <= seg; j++) {
      const th = (j / seg) * TAU, rr = r * (1 + depth * Math.cos(teeth * th + ridgeTwist * t * TAU));
      v.copy(normals[i]).multiplyScalar(Math.cos(th)).addScaledVector(binormals[i], Math.sin(th)); v.y *= flat;
      pos[k] = p.x + v.x * rr; pos[k + 1] = p.y + v.y * rr; pos[k + 2] = p.z + v.z * rr;
      const c = cols.length === 1 ? cols[0] : cols[Math.floor(((((th / TAU) + t * colorTurns) % 1) + 1) % 1 * cols.length) % cols.length];
      col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b; k += 3;
    }
  }
  const idx = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < seg; j++) { const a = i * (seg + 1) + j, b = a + seg + 1; idx.push(a, a + 1, b, b, a + 1, b + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
// Classic swirl (1M tip): one ring on the edge, then rising and narrowing to a peak.
function swirl(s, colors) {
  if (MODEL) return [stripes(onRim(MODEL.frost_swirl, s), colors, colors.length > 1 ? 5 : 0)];
  const R = s.rt, turns = 2.6, steps = 120, pts = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps, a = u * turns * TAU, r = R * 0.8 * Math.pow(1 - u, 0.85) + R * 0.03;
    pts.push(V(Math.cos(a) * r, s.h + R * 0.3 + u * R * 0.95, Math.sin(a) * r));
  }
  pts.push(V(0, s.h + R * 1.36, 0));
  return [pipe(pts, { radius: (t) => R * (0.28 - 0.11 * t), colors, teeth: 9, depth: 0.12, colorTurns: colors.length > 1 ? 4 : 0, tStart: 0.02, tEnd: 0.07 })];
}
// Flat rose: piped from the centre outwards, ending in a tapered tail on the edge.
function rosette(s, colors, { cx = 0, cz = 0, scale = 1, lift = 0, phase = 0 } = {}) {
  if (MODEL) {
    // A smaller rose sits lower on its own, so lift it to stay on top of the cake dome.
    const g = onRim(MODEL.frost_rosette, s, scale); g.translate(0, -s.h, 0); g.rotateY(phase); g.translate(cx, s.h + s.rt * 0.3 * (1 - scale) + lift, cz);
    return stripes(g, colors, colors.length > 1 ? 1.5 : 0);
  }
  const R = s.rt * scale, steps = 90, pts = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps, a = phase + u * 1.75 * TAU, r = R * (0.06 + 0.74 * Math.pow(u, 0.85));
    pts.push(V(cx + Math.cos(a) * r, s.h + s.rt * 0.3 + lift + (1 - u) * R * 0.2, cz + Math.sin(a) * r));
  }
  return pipe(pts, { radius: () => R * 0.27, colors, teeth: 8, depth: 0.17, colorTurns: colors.length > 1 ? 1.5 : 0, tStart: 0.03, tEnd: 0.18 });
}
// Drop flower / star bloom: a short twisted star squeezed straight up.
function bloom(x, y, z, rb, color, teeth = 6) {
  if (MODEL?.bloom) { const g = MODEL.bloom.clone(); g.scale(rb, rb, rb); g.rotateY(x * 37 + z * 11); g.translate(x, y, z); return paint(g, color); }
  const pts = [];
  for (let i = 0; i <= 8; i++) { const u = i / 8; pts.push(V(x + Math.cos(u * 4) * rb * 0.12 * (1 - u), y + u * rb * 1.05, z + Math.sin(u * 4) * rb * 0.12 * (1 - u))); }
  return pipe(pts, { radius: (t) => rb * (1 - 0.3 * t), colors: [color], teeth, depth: 0.34, ridgeTwist: 0.5, seg: 24, tStart: 0, tEnd: 0.4, flat: 1 });
}
function luxe(s, colors) {
  // Half rose on one side, a cluster of deeper-coloured star blooms on the other (as piped in the photos).
  const R = s.rt, list = [rosette(s, [colors[0]], { cx: -R * 0.3, scale: 0.64, lift: R * 0.08 })];
  [[0.36, -0.38, 0.22], [0.5, 0.08, 0.24], [0.22, 0.46, 0.2], [0.02, -0.64, 0.17], [0.7, -0.3, 0.16], [0.62, 0.42, 0.15]].forEach(([x, z, r], i) =>
    list.push(bloom(x * R, s.h + R * 0.22, z * R, r * R, i % 2 ? shade(colors[1], -0.06) : colors[1], i % 2 ? 6 : 8)));
  return list;
}
function hydrangea(s, colors, rand) {
  const R = s.rt, base = new THREE.Color(colors[0]);
  const list = [paint(placed(new THREE.SphereGeometry(R * 0.78, 36, 14, 0, TAU, 0, Math.PI / 2), V(0, s.h + R * 0.12, 0), [0, 0, 0], [1, 0.95, 1]), shade(base, -0.07))];
  for (let i = 0; i < 44; i++) {
    const th = rand() * TAU, ph = Math.acos(1 - rand() * 0.85), x = Math.sin(ph) * Math.cos(th) * R * 0.76, z = Math.sin(ph) * Math.sin(th) * R * 0.76;
    const y = s.h + R * 0.12 + Math.cos(ph) * R * 0.78 * 0.95 - R * 0.07;
    const tone = colors.length > 1 && rand() < 0.3 ? colors[1 + Math.floor(rand() * (colors.length - 1))] : shade(base, (rand() - 0.5) * 0.14);
    if (MODEL?.floret) {
      // Florets face outwards from the dome, like real hydrangea piping.
      const g = MODEL.floret.clone(), q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), V(x, (y - s.h - R * 0.05) * 1.1, z).normalize());
      g.scale(R * 0.2, R * 0.2, R * 0.2); g.rotateY(rand() * TAU); g.applyQuaternion(q); g.translate(x, y + R * 0.06, z);
      list.push(paint(g, tone));
    } else list.push(bloom(x, y, z, R * 0.14, tone, 4));
  }
  return list;
}
function ruffle(s, colors, rand) {
  const R = s.rt, c = colors[0], list = [];
  const petal = MODEL?.petal
    ? (a, dist, y, tilt, w, l, tone) => paint(placed(MODEL.petal.clone(), V(Math.cos(a) * dist * 0.3, y - R * 0.06, Math.sin(a) * dist * 0.3), [-tilt, Math.PI / 2 - a, 0], [w * 2, l * 1.4, l * 2], 'YXZ'), tone)
    : (a, dist, y, tilt, w, l, tone) => paint(placed(new THREE.SphereGeometry(1, 18, 10), V(Math.cos(a) * dist, y, Math.sin(a) * dist), [-tilt, Math.PI / 2 - a, 0], [w, R * 0.05, l], 'YXZ'), tone);
  for (let i = 0; i < 10; i++) list.push(petal(i * TAU / 10 + rand() * 0.2, R * 0.44, s.h + R * 0.36, 0.45, R * 0.27, R * 0.36, c));
  for (let i = 0; i < 7; i++) list.push(petal(i * TAU / 7 + 0.3, R * 0.24, s.h + R * 0.5, 0.95, R * 0.2, R * 0.26, shade(c, 0.05)));
  for (let i = 0; i < 6; i++) { const a = rand() * TAU, d = rand() * R * 0.09; list.push(paint(placed(new THREE.SphereGeometry(R * 0.045, 10, 8), V(Math.cos(a) * d, s.h + R * 0.62, Math.sin(a) * d)), '#E6D44A')); }
  return list;
}
function roseTrio(s, colors) {
  const R = s.rt;
  return [0, 1, 2].map((i) => { const a = Math.PI / 2 + i * TAU / 3; return rosette(s, [colors[i % colors.length]], { cx: Math.cos(a) * R * 0.36, cz: Math.sin(a) * R * 0.36, scale: 0.52, lift: R * 0.04, phase: i }); });
}
function leaves(s, rand) {
  const R = s.rt, list = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU + rand() * 0.3;
    if (MODEL?.leaf) { list.push(paint(placed(MODEL.leaf.clone(), V(Math.cos(a) * R * 0.62, s.h + R * 0.22, Math.sin(a) * R * 0.62), [0.3, Math.PI / 2 - a, 0], [R * 0.38, R * 0.38, R * 0.38], 'YXZ'), shade('#3DB65A', (rand() - 0.5) * 0.12))); continue; }
    list.push(paint(placed(new THREE.SphereGeometry(1, 14, 8), V(Math.cos(a) * R * 0.86, s.h + R * 0.3, Math.sin(a) * R * 0.86), [0.25, Math.PI / 2 - a, 0], [R * 0.12, R * 0.035, R * 0.28], 'YXZ'), shade('#3DB65A', (rand() - 0.5) * 0.12)));
  }
  return list;
}

// Pleated liner: an open cup with folds, plus its base.
function linerGeometry(s) {
  const g = new THREE.CylinderGeometry(s.rt, s.rb, s.h, 168, 3, true), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), a = Math.atan2(z, x), k = 1 + 0.03 * Math.cos(a * 28);
    p.setXYZ(i, x * k, p.getY(i) + s.h / 2, z * k);
  }
  g.computeVertexNormals();
  const bottom = new THREE.CircleGeometry(s.rb * 1.02, 48); bottom.rotateX(-Math.PI / 2); bottom.translate(0, 0.002, 0);
  for (const x of [g, bottom]) x.deleteAttribute('uv');
  return mergeGeometries([g.toNonIndexed(), bottom.toNonIndexed()]);
}
function themeTexture(theme, icon) {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  g.fillStyle = THEME_BG[theme] || '#ffffff'; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 14; g.beginPath(); g.arc(128, 128, 112, 0, TAU); g.stroke();
  g.font = '150px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(icon || '✨', 128, 138);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

export function createCupcakeScene(host, { reducedMotion = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power', preserveDrawingBuffer: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.tabIndex = 0; renderer.domElement.setAttribute('role', 'img');
  host.append(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 80);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xe8dcef, 0.95));
  const key = new THREE.DirectionalLight(0xfff4e6, 1.9); key.position.set(4, 8, 5); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0006; key.shadow.normalBias = 0.01; scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(0xe9e0ff, 0.45); fill.position.set(-5, 4, -2); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 0.5); rim.position.set(-2, 3, -6); scene.add(rim);
  let envTexture = null, alive = true;
  import('three/addons/environments/RoomEnvironment.js').then(({ RoomEnvironment }) => {
    if (!alive) return;
    const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
    envTexture = pmrem.fromScene(room, 0.035).texture; scene.environment = envTexture;
    room.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } }); pmrem.dispose(); request();
  }).catch((error) => console.info('Studio reflections unavailable:', error?.message || error));

  const disposables = new Set();
  const track = (o) => { disposables.add(o); return o; };
  const world = new THREE.Group(); scene.add(world);

  // Shared materials -----------------------------------------------------------------------------
  const MAT = {
    frosting: track(withSurface(new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.55, sheen: 0.3, sheenRoughness: 0.75, sheenColor: 0x3a3a3a, envMapIntensity: 0.28, side: THREE.DoubleSide }), SURF.piped)),
    cake: { chocolate: track(withSurface(new THREE.MeshPhysicalMaterial({ color: '#3b2620', roughness: 0.95, envMapIntensity: 0.12 }), CRUMB)),
      vanilla: track(withSurface(new THREE.MeshPhysicalMaterial({ color: '#d39a4e', roughness: 0.93, envMapIntensity: 0.12 }), CRUMB)) },
    liner: { chocolate: track(new THREE.MeshPhysicalMaterial({ color: '#211b1e', roughness: 0.38, metalness: 0.25, clearcoat: 0.6, clearcoatRoughness: 0.2, envMapIntensity: 0.7, side: THREE.DoubleSide })),
      vanilla: track(withSurface(new THREE.MeshPhysicalMaterial({ color: '#f7f3ec', roughness: 0.8, sheen: 0.3, sheenColor: 0x555555, envMapIntensity: 0.3, side: THREE.DoubleSide }), SURF.weave)) },
    gold: track(M.metal('#d4af37', 0.18)), silver: track(M.metal('#c9ccd3', 0.16)),
    pearl: track(new THREE.MeshPhysicalMaterial({ color: '#fbf8f1', roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.08, iridescence: 0.5, iridescenceIOR: 1.6, envMapIntensity: 0.8 })),
    glitter: track(new THREE.MeshPhysicalMaterial({ color: '#ffffff', metalness: 1, roughness: 0.12, iridescence: 1, iridescenceIOR: 1.8, emissive: '#8a8a8a', emissiveIntensity: 0.35, envMapIntensity: 1.6, side: THREE.DoubleSide })),
    fondant: track(new THREE.MeshPhysicalMaterial({ color: '#fdfbf7', roughness: 0.6, sheen: 0.3, envMapIntensity: 0.3 })),
    board: track(withSurface(new THREE.MeshPhysicalMaterial({ color: '#fbfaf7', roughness: 0.85, envMapIntensity: 0.25 }), SURF.weave))
  };
  const themeMats = new Map();
  // gltf: the Blender plaque's UVs follow the glTF convention (texture not flipped).
  const themeMat = (theme, icon, gltf = false) => {
    const key = theme + (gltf ? ':gltf' : '');
    if (!themeMats.has(key)) { const t = track(themeTexture(theme, icon)); t.flipY = !gltf; themeMats.set(key, track(new THREE.MeshPhysicalMaterial({ map: t, roughness: 0.55, sheen: 0.2, envMapIntensity: 0.3 }))); }
    return themeMats.get(key);
  };

  // Box (rebuilt when the size or count changes) and the ground -------------------------------------
  const boxGroup = new THREE.Group(); world.add(boxGroup);
  const cupcakes = new THREE.Group(); world.add(cupcakes);
  const ground = new THREE.Mesh(track(new THREE.PlaneGeometry(60, 60)), track(new THREE.ShadowMaterial({ opacity: 0.16 })));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.03; ground.receiveShadow = true; world.add(ground);
  let layout = null;   // { size, cols, rows, W, D, s, positions }
  function buildBox(sizeKey, cols, rows) {
    boxGroup.traverse((o) => { if (o.isMesh) o.geometry.dispose(); }); boxGroup.clear();
    const s = SIZES[sizeKey], W = cols * s.gap + 0.22, D = rows * s.gap + 0.22, t = 0.025, wallH = s.h * 0.66;
    const add = (geo, x, y, z) => { const m = new THREE.Mesh(geo, MAT.board); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; boxGroup.add(m); };
    add(new THREE.BoxGeometry(W, t, D), 0, -t / 2, 0);
    add(new THREE.BoxGeometry(W, wallH, t), 0, wallH / 2, -D / 2); add(new THREE.BoxGeometry(W, wallH, t), 0, wallH / 2, D / 2);
    add(new THREE.BoxGeometry(t, wallH, D), -W / 2, wallH / 2, 0); add(new THREE.BoxGeometry(t, wallH, D), W / 2, wallH / 2, 0);
    const positions = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) positions.push(V((c - (cols - 1) / 2) * s.gap, 0, (r - (rows - 1) / 2) * s.gap));
    // The insert: a card with a round hole for each cupcake, part-way up the liners.
    const shape = new THREE.Shape(); shape.moveTo(-W / 2 + t, -D / 2 + t); shape.lineTo(W / 2 - t, -D / 2 + t); shape.lineTo(W / 2 - t, D / 2 - t); shape.lineTo(-W / 2 + t, D / 2 - t); shape.closePath();
    const yIns = s.h * 0.42, rHole = (s.rb + (s.rt - s.rb) * 0.42) * 1.04;
    for (const p of positions) { const hole = new THREE.Path(); hole.absarc(p.x, -p.z, rHole, 0, TAU, true); shape.holes.push(hole); }
    const ins = new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: false, curveSegments: 40 }); ins.rotateX(-Math.PI / 2);
    add(ins, 0, yIns, 0);
    const span = Math.max(W, D) * 0.75 + 1;
    Object.assign(key.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 0.5, far: 30 }); key.shadow.camera.updateProjectionMatrix();
    layout = { size: sizeKey, cols, rows, W, D, s, positions };
  }

  // Cupcake templates ------------------------------------------------------------------------------
  const linerGeos = {}, cakeGeos = {};
  // Liner and cake top: from the Blender model when loaded (stretched to this size's height), else built here.
  const fitBody = (geo, s) => { const g = geo.clone(); if (g.attributes.uv) g.deleteAttribute('uv'); g.scale(s.rt, s.h / RIM, s.rt); return track(g); };
  const linerGeo = (k) => (linerGeos[k] ||= MODEL ? fitBody(MODEL.liner, SIZES[k]) : track(linerGeometry(SIZES[k])));
  const cakeGeo = (k) => { if (!cakeGeos[k] && MODEL) { const s = SIZES[k], g = onRim(MODEL.cake_top, s); if (g.attributes.uv) g.deleteAttribute('uv'); cakeGeos[k] = track(g); } if (!cakeGeos[k]) { const s = SIZES[k], g = new THREE.SphereGeometry(s.rt * 1.02, 48, 14, 0, TAU, 0, Math.PI / 2); g.scale(1, 0.32, 1); g.translate(0, s.h - 0.015, 0); cakeGeos[k] = track(g); } return cakeGeos[k]; };
  const templates = new Map();   // key -> { group, geos[] }
  const raycaster = new THREE.Raycaster(), down = V(0, -1, 0);
  function surfacePoint(mesh, x, z) {
    raycaster.set(V(x, 5, z), down); const hit = raycaster.intersectObject(mesh, false)[0];
    return hit ? { p: hit.point, n: hit.face.normal.clone() } : null;
  }
  function buildTemplate(spec, sizeKey, flavor, finishes, theme, themeIcon, variant) {
    const s = SIZES[sizeKey], R = s.rt, rand = seeded(variant * 7919 + spec.colors.join('').length * 131 + 17);
    const geos = [], group = new THREE.Group();
    const mesh = (geo, mat, shadow = true) => { const m = new THREE.Mesh(geo, mat); m.castShadow = shadow; m.receiveShadow = true; m.userData.shared = true; group.add(m); return m; };
    mesh(linerGeo(sizeKey), MAT.liner[flavor] || MAT.liner.chocolate);
    mesh(cakeGeo(sizeKey), MAT.cake[flavor] || MAT.cake.chocolate);
    const fin = new Set(finishes);
    let parts;
    if (spec.style === 'luxe') parts = luxe(s, spec.colors);
    else if (spec.style === 'floral') parts = spec.sub === 'ruffle' ? ruffle(s, spec.colors, rand) : spec.sub === 'rose_trio' ? roseTrio(s, spec.colors) : hydrangea(s, spec.colors, rand);
    else if (spec.style === 'rosette') parts = [rosette(s, spec.colors)];
    else parts = swirl(s, spec.colors);
    if (fin.has('leaves')) parts.push(...leaves(s, rand));
    const frost = mergeGeometries(parts); parts.forEach((g) => g.dispose()); geos.push(frost);
    const frostMesh = mesh(frost, MAT.frosting);
    // Finishing touches sit on the frosting: find the surface from above.
    const scatter = (count, radius, mat, maxR = 0.72) => {
      const list = [];
      for (let i = 0, tries = 0; i < count && tries < count * 6; tries++) {
        const a = rand() * TAU, d = Math.sqrt(rand()) * R * maxR, hit = surfacePoint(frostMesh, Math.cos(a) * d, Math.sin(a) * d);
        if (!hit) continue; i++;
        list.push(placed(new THREE.SphereGeometry(radius, 14, 10), hit.p.clone().addScaledVector(hit.n, radius * 0.55)));
      }
      if (list.length) { const g = mergeGeometries(list); list.forEach((x) => x.dispose()); geos.push(g); mesh(g, mat); }
    };
    if (fin.has('gold_pearls')) scatter(4 + Math.floor(rand() * 3), R * 0.065, MAT.gold);
    if (fin.has('silver_pearls')) scatter(4 + Math.floor(rand() * 3), R * 0.065, MAT.silver);
    if (fin.has('white_pearls')) scatter(9, R * 0.045, MAT.pearl);
    if (fin.has('gold_balls')) {
      const at = spec.style === 'luxe' ? [-0.02, 0.62] : [0.28, -0.22], hit = surfacePoint(frostMesh, at[0] * R, at[1] * R);
      if (hit) { const g = new THREE.SphereGeometry(R * 0.15, 24, 16); g.translate(hit.p.x, hit.p.y + R * 0.08, hit.p.z); geos.push(g); mesh(g, MAT.gold); }
    }
    if (fin.has('edible_glitter')) {
      const p = frost.attributes.position, n = frost.attributes.normal, flakes = [];
      for (let i = 0, tries = 0; i < 140 && tries < 2000; tries++) {
        const v = Math.floor(rand() * p.count); if (n.getY(v) < 0.25) continue; i++;
        const f = new THREE.CircleGeometry(R * 0.022, 6), pos = V(p.getX(v), p.getY(v), p.getZ(v)).addScaledVector(V(n.getX(v), n.getY(v), n.getZ(v)), 0.004);
        flakes.push(placed(f, pos, [-Math.PI / 2 + (rand() - 0.5) * 1.4, rand() * TAU, (rand() - 0.5) * 1.4]));
      }
      if (flakes.length) { flakes.forEach((f) => { f.deleteAttribute('uv'); }); const g = mergeGeometries(flakes); flakes.forEach((f) => f.dispose()); geos.push(g); mesh(g, MAT.glitter, false); }
    }
    if (theme && theme !== 'none') {
      const at = spec.style === 'luxe' ? [-0.3, 0] : [0, 0.05], hit = surfacePoint(frostMesh, at[0] * R, at[1] * R);
      if (hit) {
        let plaque;
        if (MODEL?.plaque) { const g = MODEL.plaque.clone(); g.scale(R * 0.32, R * 0.32, R * 0.32); geos.push(g); plaque = new THREE.Mesh(g, themeMat(theme, themeIcon, true)); }
        else { const g = new THREE.CylinderGeometry(R * 0.32, R * 0.32, R * 0.05, 40); geos.push(g); plaque = new THREE.Mesh(g, [MAT.fondant, themeMat(theme, themeIcon), MAT.fondant]); }
        plaque.position.set(hit.p.x, hit.p.y + R * 0.2, hit.p.z + R * 0.06); plaque.rotation.set(1.0, 0, 0, 'YXZ'); plaque.castShadow = true; plaque.userData.shared = true; plaque.userData.plaque = true; group.add(plaque);
      }
    }
    return { group, geos };
  }
  function dropTemplate(k) { const t = templates.get(k); if (!t) return; t.geos.forEach((g) => g.dispose()); templates.delete(k); }

  // Animation + camera ---------------------------------------------------------------------------------
  const anims = new Set();
  function animate(fn, ms, delay = 0) {
    if (reducedMotion || ms <= 0) { fn(1); request(); return null; }
    const a = { fn, start: performance.now() + delay, ms }; anims.add(a); loop(); return a;
  }
  function loop() {
    if (loop.running) return; loop.running = true;
    const step = (now) => {
      if (!alive) { loop.running = false; return; }
      for (const a of [...anims]) { if (now < a.start) continue; const t = Math.min(1, (now - a.start) / a.ms); a.fn(t); if (t >= 1) anims.delete(a); }
      renderer.render(scene, camera);
      if (anims.size) requestAnimationFrame(step); else loop.running = false;
    };
    requestAnimationFrame(step);
  }
  const easeOut = (t) => 1 - Math.pow(1 - t, 3), easeBack = (t) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);
  const view = { yaw: 0.45, pitch: 0.72, dist: 8, tx: 0, tz: 0 };
  function viewFor(name) {
    if (!layout) return { ...view };
    const size = Math.max(layout.W, layout.D * 1.15), aspect = camera.aspect || 1, k = aspect < 1 ? 1 / Math.max(0.55, aspect) : 1;
    if (name === 'top') return { yaw: 0, pitch: 1.5, dist: (size * 1.75 + 0.6) * k * 0.92, tx: 0, tz: 0 };
    if (name === 'close') { const p = layout.positions[layout.positions.length - Math.ceil(layout.cols / 2)] || V(0, 0, 0); return { yaw: 0.35, pitch: 0.5, dist: layout.s.rt * 7.5, tx: p.x, tz: p.z }; }
    return { yaw: 0.45, pitch: 0.72, dist: (size * 1.8 + 0.8) * k, tx: 0, tz: 0 };
  }
  let viewName = 'angle', viewAnim = null;
  function setView(name, ms = 650) {
    viewName = name; const to = viewFor(name), from = { ...view };
    const dy = ((to.yaw - from.yaw) % TAU + TAU * 1.5) % TAU - Math.PI;
    anims.clear();
    viewAnim = animate((t) => { const k = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; for (const p of ['pitch', 'dist', 'tx', 'tz']) view[p] = from[p] + (to[p] - from[p]) * k; view.yaw = from.yaw + dy * k; placeCamera(false); }, ms);
  }
  function placeCamera(render = true) {
    const s = layout?.s || SIZES.mini, maxD = layout ? Math.max(layout.W, layout.D) * 3 + 4 : 20;
    view.pitch = Math.min(1.52, Math.max(0.14, view.pitch)); view.dist = Math.min(maxD, Math.max(s.rt * 3.2, view.dist));
    const ty = s.h * 0.9;
    camera.position.set(view.tx + Math.sin(view.yaw) * Math.cos(view.pitch) * view.dist, ty + Math.sin(view.pitch) * view.dist, view.tz + Math.cos(view.yaw) * Math.cos(view.pitch) * view.dist);
    camera.lookAt(view.tx, ty, view.tz); if (render) request();
  }
  const el = renderer.domElement, pointers = new Map(); let pinchStart = null;
  el.addEventListener('pointerdown', (e) => { anims.clear(); el.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinchStart = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: view.dist }; } });
  el.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId); if (!p) return;
    if (pointers.size === 1) { view.yaw -= (e.clientX - p.x) * 0.008; view.pitch += (e.clientY - p.y) * 0.006; placeCamera(); }
    p.x = e.clientX; p.y = e.clientY;
    if (pointers.size === 2 && pinchStart) { const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y); if (d > 10) { view.dist = pinchStart.dist * pinchStart.d / d; placeCamera(); } }
  });
  const up = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinchStart = null; };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', (e) => { e.preventDefault(); anims.clear(); view.dist *= Math.exp(e.deltaY * 0.0012); placeCamera(); }, { passive: false });
  el.addEventListener('keydown', (e) => {
    const k = { ArrowLeft: () => (view.yaw += 0.2), ArrowRight: () => (view.yaw -= 0.2), ArrowUp: () => (view.pitch += 0.12), ArrowDown: () => (view.pitch -= 0.12), '+': () => (view.dist *= 0.9), '=': () => (view.dist *= 0.9), '-': () => (view.dist *= 1.1) }[e.key];
    if (k) { e.preventDefault(); k(); placeCamera(); }
  });

  let frame = 0;
  function request() { if (!frame && alive && !loop.running) frame = requestAnimationFrame(() => { frame = 0; renderer.render(scene, camera); }); }
  function resize() {
    const w = host.clientWidth || 1, h = host.clientHeight || 1;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.fov = w / h < 0.9 ? 40 : 32; camera.updateProjectionMatrix();
    if (layout && !pointers.size) { Object.assign(view, viewFor(viewName)); placeCamera(false); }
    request();
  }
  const ro = new ResizeObserver(resize); ro.observe(host);

  // Update: spec = { size, cols, rows, flavor, finishes, theme, themeIcon, cells: [{ style, colors: [hex], sub }] } --------
  const cellKeys = [], cellObjs = [];
  let lastSpec = null;
  // When the Blender model arrives, rebuild every cupcake from it (the built-in shapes showed meanwhile).
  loadModel().then((parts) => {
    const first = !MODEL; MODEL = parts;
    if (!alive || !first && !lastSpec) return;
    for (const k of [...templates.keys()]) dropTemplate(k);
    for (const cache of [linerGeos, cakeGeos]) for (const k of Object.keys(cache)) { cache[k].dispose(); disposables.delete(cache[k]); delete cache[k]; }
    for (const o of cellObjs) cupcakes.remove(o);
    cellObjs.length = 0; cellKeys.length = 0;
    if (lastSpec) update(lastSpec);
  }).catch((error) => console.info('Cupcake model unavailable, using built-in shapes:', error?.message || error));
  function update(spec) {
    lastSpec = spec;
    const fresh = !layout || layout.size !== spec.size || layout.cols !== spec.cols || layout.rows !== spec.rows;
    if (fresh) {
      // New box: every cupcake gets a hole in the new insert, so none keep their old place.
      buildBox(spec.size, spec.cols, spec.rows);
      for (const o of cellObjs) cupcakes.remove(o);
      cellObjs.length = 0; cellKeys.length = 0;
    }
    const finishes = [...spec.finishes].sort(), used = new Set();
    spec.cells.forEach((cell, i) => {
      const variant = i % 2, k = JSON.stringify([spec.size, spec.flavor, cell.style, cell.colors, cell.sub || '', finishes, spec.theme, variant]);
      used.add(k);
      if (!templates.has(k)) templates.set(k, buildTemplate(cell, spec.size, spec.flavor, finishes, spec.theme, spec.themeIcon, variant));
      if (cellKeys[i] === k && cellObjs[i]) return;
      const obj = templates.get(k).group.clone(), pos = layout.positions[i], rand = seeded(i * 97 + 3);
      obj.position.copy(pos); obj.rotation.y = rand() * TAU;
      // Topper plaques always face the front of the box, whichever way the cupcake was turned.
      obj.traverse((o) => { if (o.userData.plaque) { o.rotation.y = -obj.rotation.y + (rand() - 0.5) * 0.4; o.position.applyAxisAngle(V(0, 1, 0), -obj.rotation.y); } });
      if (cellObjs[i]) cupcakes.remove(cellObjs[i]);
      cupcakes.add(obj); cellObjs[i] = obj; cellKeys[i] = k;
      // Changed cupcakes settle in with a little bounce (the first build drops them into the box).
      if (fresh) { obj.position.y = 0.6; animate((t) => { obj.position.y = 0.6 * (1 - easeOut(t)); }, 420, Math.min(500, i * 18)); }
      else { obj.scale.setScalar(0.85); animate((t) => obj.scale.setScalar(0.85 + 0.15 * easeBack(t)), 380, Math.min(300, i * 8)); }
    });
    while (cellObjs.length > spec.cells.length) cupcakes.remove(cellObjs.pop());
    cellKeys.length = spec.cells.length;
    for (const k of [...templates.keys()]) if (!used.has(k)) dropTemplate(k);
    if (fresh) { anims.delete(viewAnim); viewAnim = null; Object.assign(view, viewFor(viewName === 'close' ? 'angle' : viewName)); if (viewName === 'close') viewName = 'angle'; placeCamera(false); }
    request();
  }

  // Scenes: Studio (plain), Bakery counter (marble) and Party table (linen), same lights so colours stay true.
  const SCENES = {
    bakery: { url: new URL('../assets/3d/comfy_cafe_1k.hdr', import.meta.url).href, intensity: 0.46, blur: 0.42 },
    party: { url: new URL('../assets/3d/warm_reception_dinner_1k.hdr', import.meta.url).href, intensity: 0.42, blur: 0.5 }
  };
  const fade = track(fadeTexture()), surface = new THREE.Group(); surface.visible = false; world.add(surface);
  const marble = new THREE.Mesh(track(new THREE.CircleGeometry(14, 72)), track(new THREE.MeshPhysicalMaterial({ map: track(marbleTexture()), alphaMap: fade, transparent: true, roughness: 0.22, clearcoat: 0.5, clearcoatRoughness: 0.15, envMapIntensity: 0.6 })));
  const cloth = new THREE.Mesh(track(new THREE.CircleGeometry(14, 72)), track(new THREE.MeshPhysicalMaterial({ map: track(linenTexture()), alphaMap: fade, transparent: true, roughness: 0.9, sheen: 0.4, sheenRoughness: 0.7, sheenColor: 0xffffff, envMapIntensity: 0.3 })));
  for (const m of [marble, cloth]) { m.rotation.x = -Math.PI / 2; m.position.y = -0.031; m.receiveShadow = true; surface.add(m); }
  const backdrops = new Map(); let sceneReq = 0;
  async function loadBackdrop(name) {
    if (!backdrops.has(name)) backdrops.set(name, (async () => {
      const { RGBELoader } = await import('three/addons/loaders/RGBELoader.js');
      const tex = await new RGBELoader().loadAsync(SCENES[name].url); tex.mapping = THREE.EquirectangularReflectionMapping; track(tex); return tex;
    })().catch((error) => { backdrops.delete(name); throw error; }));
    return backdrops.get(name);
  }
  function applyScene(name, tex) {
    if (name === 'studio' || !tex) { scene.background = null; surface.visible = false; ground.visible = true; request(); return; }
    scene.background = tex; scene.backgroundBlurriness = SCENES[name].blur; scene.backgroundIntensity = SCENES[name].intensity;
    surface.visible = true; ground.visible = false; marble.visible = name === 'bakery'; cloth.visible = name === 'party'; request();
  }
  async function setScene(name) {
    const req = ++sceneReq;
    if (!SCENES[name]) { applyScene('studio'); return 'studio'; }
    try { const tex = await loadBackdrop(name); if (req === sceneReq && alive) applyScene(name, tex); return name; }
    catch (error) { console.info('Scene photo unavailable:', error?.message || error); if (req === sceneReq) applyScene('studio'); return 'studio'; }
  }

  // Picture of the box for the cart line and the order (angled, plain background).
  function snapshot(size = 480) {
    for (const a of [...anims]) { a.fn(1); } anims.clear();
    const keepBg = scene.background, keepSurface = surface.visible, keepGround = ground.visible, saved = { ...view };
    scene.background = null; surface.visible = false; ground.visible = true;
    Object.assign(view, viewFor('angle')); placeCamera(false); renderer.render(scene, camera);
    const src = renderer.domElement, out = document.createElement('canvas');
    out.width = size; out.height = Math.round(size * Math.min(1.2, src.height / src.width));
    const g = out.getContext('2d'); g.fillStyle = '#fbf6ff'; g.fillRect(0, 0, out.width, out.height);
    const sh = src.width * out.height / out.width; g.drawImage(src, 0, (src.height - sh) / 2, src.width, sh, 0, 0, out.width, out.height);
    Object.assign(view, saved); scene.background = keepBg; surface.visible = keepSurface; ground.visible = keepGround; placeCamera();
    return out.toDataURL('image/jpeg', 0.8);
  }
  function dispose() {
    alive = false; anims.clear(); cancelAnimationFrame(frame); ro.disconnect();
    for (const k of [...templates.keys()]) dropTemplate(k);
    boxGroup.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    envTexture?.dispose(); disposables.forEach((d) => d.dispose?.()); renderer.dispose(); renderer.forceContextLoss?.(); renderer.domElement.remove();
  }
  resize();
  return { update, setView, setScene, snapshot, dispose, canvas: renderer.domElement };
}
