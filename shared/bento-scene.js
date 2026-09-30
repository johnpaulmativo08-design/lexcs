// Three.js preview for the bento designer. Loaded on demand (dynamic import) so the storefront stays light.
// Uses the Blender model (assets/3d/bento.glb) when it loads; otherwise a cake built from simple shapes,
// so the preview never depends on the file. Renders on demand, not every frame.
import * as THREE from 'three';

const MODEL_URL = new URL('../assets/3d/bento.glb?v=1', import.meta.url).href;
const R = 1.0;                     // cake radius (4" bento, 1 unit = 2")
let H = 1.05;                      // cake top height; replaced by the model's real height when it loads
const TEXT_R = 0.74;               // writing area radius on the top

function seeded(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const shade = (hex, amt) => { const c = new THREE.Color(hex); const hsl = {}; c.getHSL(hsl); return new THREE.Color().setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + amt))); };

function ginghamTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#fffaf0'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = 'rgba(244,196,48,.55)'; for (let i = 0; i < 128; i += 32) { g.fillRect(i, 0, 16, 128); g.fillRect(0, i, 128, 16); }
  g.fillStyle = 'rgba(232,168,20,.35)'; for (let x = 0; x < 128; x += 32) for (let y = 0; y < 128; y += 32) g.fillRect(x, y, 16, 16);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 6); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// Splits the message into at most 3 lines (keeps the customer's own line breaks, wraps long lines by words).
function layoutLines(ctx, text, maxWidth) {
  const out = [];
  for (const raw of text.split('\n')) {
    const words = raw.split(/\s+/).filter(Boolean); let line = '';
    for (const w of words) { const test = line ? line + ' ' + w : w; if (line && ctx.measureText(test).width > maxWidth) { out.push(line); line = w; } else line = test; }
    out.push(line);
  }
  return out.filter((l, i, a) => l || a.length === 1);
}
function messageTexture(message, colorHex, style) {
  const size = 1024, c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
  const text = message.trim(); if (!text) return null;
  const family = "'Nunito','DM Sans',sans-serif";
  let fontSize = 150, lines;
  for (; fontSize > 40; fontSize -= 6) {
    g.font = `800 ${fontSize}px ${family}`;
    lines = layoutLines(g, style === 'pearl_letters' ? text.toUpperCase() : text, size * 0.84);
    const blockH = lines.length * fontSize * 1.08;
    const widest = Math.max(...lines.map((l) => g.measureText(l).width));
    // every line must sit inside the circle: check the corners of the text block against the radius
    const half = Math.hypot(widest / 2, blockH / 2);
    if (lines.length <= 4 && half < size * 0.485) break;
  }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const lh = fontSize * 1.08, top = size / 2 - (lines.length - 1) * lh / 2;
  const col = new THREE.Color(colorHex); const dark = shade(colorHex, -0.22).getStyle(); const light = shade(colorHex, 0.28).getStyle();
  lines.forEach((l, i) => {
    const y = top + i * lh;
    if (style === 'pearl_letters') {
      g.lineJoin = 'round'; g.lineWidth = fontSize * 0.1;
      g.fillStyle = 'rgba(40,20,50,.28)'; g.fillText(l, size / 2 + 6, y + 8);
      g.strokeStyle = dark; g.strokeText(l, size / 2, y);
      const grad = g.createLinearGradient(0, y - fontSize / 2, 0, y + fontSize / 2); grad.addColorStop(0, light); grad.addColorStop(0.55, col.getStyle()); grad.addColorStop(1, dark);
      g.fillStyle = grad; g.fillText(l, size / 2, y);
      g.fillStyle = 'rgba(255,255,255,.55)'; g.font = `800 ${fontSize}px ${family}`; g.save(); g.globalCompositeOperation = 'source-atop'; g.fillText(l, size / 2 - 5, y - 6); g.restore();
    } else {
      g.lineJoin = 'round'; g.lineCap = 'round';
      g.lineWidth = fontSize * 0.2; g.strokeStyle = dark; g.strokeText(l, size / 2, y + 3);
      g.lineWidth = fontSize * 0.14; g.strokeStyle = col.getStyle(); g.strokeText(l, size / 2, y);
      g.fillStyle = col.getStyle(); g.fillText(l, size / 2, y);
      g.lineWidth = fontSize * 0.035; g.strokeStyle = light; g.strokeText(l, size / 2 - 3, y - 4);
    }
  });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function topperTexture(label) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512; const g = c.getContext('2d');
  const isNumber = /^[0-9]+$/.test(label);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = isNumber ? "700 360px 'Playfair Display',serif" : "italic 400 170px 'Playfair Display',serif";
  const lines = isNumber ? [label] : label.split(' ');
  const lh = isNumber ? 0 : 175, top = 256 - (lines.length - 1) * lh / 2;
  const grad = g.createLinearGradient(0, 60, 0, 460); grad.addColorStop(0, '#f3dc8a'); grad.addColorStop(0.5, '#c9a227'); grad.addColorStop(1, '#8a6a12');
  g.lineWidth = 26; g.lineJoin = 'round'; g.strokeStyle = '#8a6a12';
  lines.forEach((l, i) => { g.strokeText(l, 512, top + i * lh); });
  g.fillStyle = grad; lines.forEach((l, i) => g.fillText(l, 512, top + i * lh));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function createBentoScene(host, { reducedMotion = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute('role', 'img');
  host.append(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 60);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xe8dcef, 1.25));
  const key = new THREE.DirectionalLight(0xfff4e6, 2.1); key.position.set(3.2, 6, 3.5); key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024); key.shadow.camera.left = key.shadow.camera.bottom = -3; key.shadow.camera.right = key.shadow.camera.top = 3; key.shadow.bias = -0.0008;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xe9e0ff, 0.6); fill.position.set(-4, 3, -2); scene.add(fill);

  const disposables = new Set();
  const track = (o) => { disposables.add(o); return o; };
  const mat = (color, rough = 0.62, metal = 0) => track(new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }));
  const world = new THREE.Group(); scene.add(world);

  // --- fixed parts: box, gingham paper, cake body -------------------------------------------------
  const fixed = new THREE.Group(); world.add(fixed);
  const kraft = mat(0xeee4cf, 0.9);
  const tray = new THREE.Mesh(track(new THREE.BoxGeometry(3.3, 0.06, 3.3)), kraft); tray.position.y = -0.03; tray.receiveShadow = true; fixed.add(tray);
  for (const [x, z, w, d] of [[0, -1.62, 3.3, 0.06], [0, 1.62, 3.3, 0.06], [-1.62, 0, 0.06, 3.3], [1.62, 0, 0.06, 3.3]]) {
    const wall = new THREE.Mesh(track(new THREE.BoxGeometry(w, 0.55, d)), kraft); wall.position.set(x, 0.27, z); wall.receiveShadow = true; fixed.add(wall);
  }
  const lid = new THREE.Mesh(track(new THREE.BoxGeometry(3.3, 0.05, 3.3)), kraft);
  const hinge = new THREE.Group(); hinge.position.set(0, 0.55, -1.65); hinge.rotation.x = -1.95; lid.position.set(0, 0, 1.65); hinge.add(lid); fixed.add(hinge);
  const gingham = ginghamTexture(); track(gingham);
  const paper = new THREE.Mesh(track(new THREE.PlaneGeometry(3.0, 3.0, 8, 8)), track(new THREE.MeshStandardMaterial({ map: gingham, roughness: 0.95, side: THREE.DoubleSide })));
  paper.rotation.x = -Math.PI / 2; paper.rotation.z = 0.08; paper.position.y = 0.005; paper.receiveShadow = true; fixed.add(paper);

  const profile = [new THREE.Vector2(0, 0), new THREE.Vector2(R * 0.985, 0), new THREE.Vector2(R, 0.03)];
  for (let i = 0; i <= 10; i++) { const a = (i / 10) * Math.PI / 2; profile.push(new THREE.Vector2(R - 0.06 + 0.06 * Math.cos(a), H - 0.06 + 0.06 * Math.sin(a))); }
  profile.push(new THREE.Vector2(0, H));
  const cakeMat = mat(0xffffff, 0.68);
  const cake = new THREE.Mesh(track(new THREE.LatheGeometry(profile, 96)), cakeMat); cake.castShadow = true; cake.receiveShadow = true; fixed.add(cake);

  const decor = new THREE.Group(); world.add(decor);
  const clearDecor = () => {
    decor.traverse((o) => { if (o.isMesh) { if (!o.userData.sharedGeometry) o.geometry.dispose(); if (!o.userData.sharedMaterial) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.map?.dispose(); m.dispose(); }); } });
    decor.clear();
  };

  // --- camera orbit (drag / one-finger rotate, wheel / pinch zoom, arrow keys) ----------------------
  const view = { yaw: 0.55, pitch: 0.62, dist: 6.2 };
  const DEFAULT = { ...view };
  const pointers = new Map(); let pinchStart = null;
  function placeCamera() {
    view.pitch = Math.min(1.35, Math.max(0.18, view.pitch)); view.dist = Math.min(9, Math.max(3.4, view.dist));
    camera.position.set(Math.sin(view.yaw) * Math.cos(view.pitch) * view.dist, 0.55 + Math.sin(view.pitch) * view.dist, Math.cos(view.yaw) * Math.cos(view.pitch) * view.dist);
    camera.lookAt(0, 0.55, 0); request();
  }
  const el = renderer.domElement;
  el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinchStart = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: view.dist }; } });
  el.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId); if (!p) return;
    if (pointers.size === 1) { view.yaw -= (e.clientX - p.x) * 0.008; view.pitch += (e.clientY - p.y) * 0.006; placeCamera(); }
    p.x = e.clientX; p.y = e.clientY;
    if (pointers.size === 2 && pinchStart) { const [a, b] = [...pointers.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (d > 10) { view.dist = pinchStart.dist * pinchStart.d / d; placeCamera(); } }
  });
  const up = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinchStart = null; };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', (e) => { e.preventDefault(); view.dist *= Math.exp(e.deltaY * 0.0012); placeCamera(); }, { passive: false });
  el.addEventListener('keydown', (e) => {
    const k = { ArrowLeft: () => (view.yaw += 0.2), ArrowRight: () => (view.yaw -= 0.2), ArrowUp: () => (view.pitch += 0.12), ArrowDown: () => (view.pitch -= 0.12), '+': () => (view.dist -= 0.4), '-': () => (view.dist += 0.4), '=': () => (view.dist -= 0.4) }[e.key];
    if (k) { e.preventDefault(); k(); placeCamera(); }
  });

  // --- render on demand -------------------------------------------------------------------------
  let frame = 0, alive = true;
  function request() { if (!frame && alive) frame = requestAnimationFrame(() => { frame = 0; renderer.render(scene, camera); }); }
  function resize() {
    const w = host.clientWidth || 1, h = host.clientHeight || 1;
    renderer.setSize(w, h, false); camera.aspect = w / h;
    camera.fov = w / h < 0.9 ? 40 : 32; camera.updateProjectionMatrix(); request();
  }
  const ro = new ResizeObserver(resize); ro.observe(host); resize(); placeCamera();

  // --- Blender model ----------------------------------------------------------------------------
  // model = { root, parts: {name: Object3D}, templates: {pearl, flower_piped, leaf_piped}, bow: {object, angle}, topShellY, bottomShellY }
  let model = null, lastDesign = null, lastPalette = null;
  const forEachMesh = (o, fn) => o.traverse((m) => { if (m.isMesh) fn(m); });
  function template(obj, scale) {
    // Re-centre a single decoration so it can be copied anywhere on the cake (keeps its rotation and materials).
    const inner = obj.clone(true); inner.position.set(0, 0, 0);
    const holder = new THREE.Group(); holder.add(inner); holder.scale.setScalar(scale); holder.updateMatrixWorld(true);
    const centre = new THREE.Box3().setFromObject(holder).getCenter(new THREE.Vector3());
    inner.position.sub(centre.divideScalar(scale));
    return holder;
  }
  async function loadModel() {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
    if (!alive) return;
    const root = gltf.scene, parts = {};
    root.traverse((o) => { if (o.name && !parts[o.name]) parts[o.name] = o; });
    for (const need of ['cake', 'top_frosting']) if (!parts[need]) throw new Error('Model is missing "' + need + '"');
    // Scale so the cake is 2 units wide, centred, sitting on y = 0.
    root.updateMatrixWorld(true);
    const cakeBox = new THREE.Box3().setFromObject(parts.cake);
    const s = (2 * R) / Math.max(cakeBox.max.x - cakeBox.min.x, cakeBox.max.z - cakeBox.min.z);
    const c = cakeBox.getCenter(new THREE.Vector3());
    root.scale.setScalar(s); root.position.set(-c.x * s, -cakeBox.min.y * s, -c.z * s); root.updateMatrixWorld(true);
    forEachMesh(root, (m) => { m.castShadow = true; m.receiveShadow = true; });
    // Single decorations are removed from the scene and kept as templates the designer copies around the cake.
    const templates = {};
    for (const name of ['pearl', 'flower_piped', 'leaf_piped']) if (parts[name]) { templates[name] = template(parts[name], s); parts[name].removeFromParent(); }
    let bow = null;
    if (parts.bow) {
      parts.bow.updateWorldMatrix(true, false);
      const wp = parts.bow.getWorldPosition(new THREE.Vector3());
      const obj = parts.bow.clone(true);
      parts.bow.matrixWorld.decompose(obj.position, obj.quaternion, obj.scale);
      bow = { object: obj, angle: Math.atan2(wp.z, wp.x) }; parts.bow.removeFromParent();
    }
    root.updateMatrixWorld(true);
    const yTop = (o) => (o ? new THREE.Box3().setFromObject(o).max.y : null);
    H = Math.max(yTop(parts.top_frosting), yTop(parts.cake));
    // Own materials for recoloured parts, so the originals stay untouched.
    for (const name of ['cake', 'top_frosting', 'border_top_shell', 'border_bottom_shell', 'drip']) if (parts[name]) forEachMesh(parts[name], (m) => { m.material = m.material.clone(); });
    model = { root, parts, templates, bow, topShellY: yTop(parts.border_top_shell), bottomShellY: yTop(parts.border_bottom_shell) };
    fixed.visible = false; world.add(root);
    if (lastDesign) update(lastDesign, lastPalette); else request();
  }
  loadModel().catch((error) => { console.info('Bento model unavailable, using built-in shapes:', error?.message || error); model = null; fixed.visible = true; });
  const placeCopy = (tpl, x, y, z, rotY = 0) => {
    const copy = tpl.clone(true); copy.position.set(x, y, z); copy.rotation.y = rotY;
    copy.traverse((m) => { if (m.isMesh) { m.userData.sharedGeometry = true; m.userData.sharedMaterial = true; m.castShadow = true; } });
    decor.add(copy); return copy;
  };

  // --- decorations from the design state ---------------------------------------------------------
  function update(design, palette) {
    lastDesign = design; lastPalette = palette;
    const dmat = (color, rough = 0.62, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
    const hexOf = (code, fallback = '#ffffff') => palette[code] || fallback;
    const frost = hexOf(design.frosting_color);
    cakeMat.color.set(frost);
    clearDecor();
    if (model) return updateModel(design, palette, hexOf, frost);
    const rand = seeded(97);
    const accents = new Set(design.accents || []); const borders = new Set(design.border || []);
    const frostMat = dmat(shade(frost, 0.03), 0.6);

    const shell = (radius, y, count, scale) => {
      const geo = new THREE.SphereGeometry(0.1, 14, 10);
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        const m = new THREE.Mesh(i === 0 ? geo : geo.clone(), frostMat);
        m.scale.set(scale[0], scale[1], scale[2]); m.position.set(Math.cos(a) * radius, y, Math.sin(a) * radius); m.rotation.y = -a; m.castShadow = true; decor.add(m);
      }
    };
    if (borders.has('shell_top')) shell(R - 0.05, H + 0.01, 26, [0.95, 0.8, 1.55]);
    if (borders.has('shell_bottom')) shell(R + 0.03, 0.08, 30, [1.0, 0.85, 1.6]);

    if (accents.has('drip')) {
      const dripMat = dmat(shade(frost, -0.28), 0.4);
      for (let i = 0; i < 30; i++) {
        const a = (i / 30) * Math.PI * 2 + rand() * 0.08, len = 0.12 + rand() * 0.35;
        const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, len, 4, 10), dripMat);
        body.position.set(Math.cos(a) * (R + 0.012), H - 0.02 - len / 2, Math.sin(a) * (R + 0.012)); decor.add(body);
      }
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.012, R + 0.012, 0.05, 96), dripMat); cap.position.y = H - 0.02; decor.add(cap);
    }

    const pearl = (hex) => dmat(hex, 0.25, 0.85);
    if (accents.has('pearls_gold') || accents.has('pearls_silver')) {
      const pm = pearl(accents.has('pearls_gold') ? '#d4af37' : '#c9ccd3'); const g = new THREE.SphereGeometry(0.028, 14, 10);
      for (let i = 0; i < 26; i++) { const a = ((i + 0.5) / 26) * Math.PI * 2; const m = new THREE.Mesh(i ? g.clone() : g, pm); m.position.set(Math.cos(a) * (R - 0.05), H + 0.1, Math.sin(a) * (R - 0.05)); decor.add(m); }
      for (let i = 0; i < 18; i++) { const a = rand() * Math.PI * 2, r = TEXT_R + 0.04 + rand() * (R - TEXT_R - 0.2); const m = new THREE.Mesh(g.clone(), pm); m.position.set(Math.cos(a) * r, H + 0.02, Math.sin(a) * r); decor.add(m); }
      if (borders.has('shell_bottom')) for (let i = 0; i < 30; i++) { const a = ((i + 0.5) / 30) * Math.PI * 2; const m = new THREE.Mesh(g.clone(), pm); m.position.set(Math.cos(a) * (R + 0.1), 0.17, Math.sin(a) * (R + 0.1)); decor.add(m); }
    }

    if (accents.has('ribbon_bows')) {
      const bm = dmat(hexOf(design.bow_color, '#ee82a8'), 0.35, 0.05);
      for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + i * Math.PI / 2; const bow = new THREE.Group();
        for (const s of [-1, 1]) {
          const loop = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.028, 8, 24), bm); loop.scale.set(1.25, 0.8, 0.35); loop.position.x = s * 0.13; loop.rotation.z = s * 0.25; bow.add(loop);
          const tail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.34, 0.012), bm); tail.position.set(s * 0.06, -0.2, 0); tail.rotation.z = s * 0.35; bow.add(tail);
        }
        const knot = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), bm); knot.scale.set(1, 1, 0.6); bow.add(knot);
        bow.position.set(Math.cos(a) * (R + 0.03), H - 0.14, Math.sin(a) * (R + 0.03)); bow.rotation.y = -a + Math.PI / 2; bow.traverse((o) => { o.castShadow = true; }); decor.add(bow);
      }
    }

    if (accents.has('piped_flowers')) {
      const petalCols = ['#f4b6c8', '#f9e27d', '#bfdddf', '#ffffff', '#cdb8e8'];
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + 0.3, r = R - 0.22; const flower = new THREE.Group(); const pm = dmat(petalCols[i % petalCols.length], 0.55);
        for (let p = 0; p < 5; p++) { const pa = (p / 5) * Math.PI * 2; const petal = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), pm); petal.scale.set(1.2, 0.5, 0.8); petal.position.set(Math.cos(pa) * 0.05, 0, Math.sin(pa) * 0.05); flower.add(petal); }
        const center = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 8), dmat('#f4d03f', 0.5)); center.position.y = 0.02; flower.add(center);
        flower.position.set(Math.cos(a) * r, H + 0.02, Math.sin(a) * r); decor.add(flower);
      }
    }
    if (accents.has('piped_leaves')) {
      const lm = dmat('#3fa66b', 0.5), dm = dmat('#ffffff', 0.5);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 + 0.05, r = R - 0.14;
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), lm); leaf.scale.set(1.6, 0.35, 0.6); leaf.position.set(Math.cos(a) * r, H + 0.015, Math.sin(a) * r); leaf.rotation.y = -a + 0.8; decor.add(leaf);
        const dot = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 8), dm); dot.position.set(Math.cos(a + 0.2) * (r - 0.08), H + 0.015, Math.sin(a + 0.2) * (r - 0.08)); decor.add(dot);
      }
    }
    decorateShared(design, hexOf, rand, accents);
    request();
  }

  // Sprinkles, gold leaf, the written message and the topper are drawn the same way for both paths.
  function decorateShared(design, hexOf, rand, accents) {
    const dmat = (color, rough = 0.62, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
    if (accents.has('sprinkles')) {
      const cols = ['#e0457b', '#f4d03f', '#7fb8e6', '#3fa66b', '#ffffff', '#7e57c2']; const g = new THREE.CapsuleGeometry(0.009, 0.04, 2, 6);
      for (let i = 0; i < 90; i++) { const a = rand() * Math.PI * 2, r = TEXT_R + 0.03 + rand() * (R - TEXT_R - 0.12); const m = new THREE.Mesh(g.clone(), dmat(cols[i % cols.length], 0.45)); m.position.set(Math.cos(a) * r, H + 0.012, Math.sin(a) * r); m.rotation.set(Math.PI / 2, 0, rand() * Math.PI); decor.add(m); }
    }
    if (accents.has('gold_leaf')) {
      const gm = new THREE.MeshStandardMaterial({ color: '#d4af37', roughness: 0.35, metalness: 0.9, side: THREE.DoubleSide });
      for (let i = 0; i < 26; i++) { const a = rand() * Math.PI * 2, y = 0.18 + rand() * (H - 0.35); const m = new THREE.Mesh(new THREE.CircleGeometry(0.03 + rand() * 0.035, 5), gm); m.position.set(Math.cos(a) * (R + 0.004), y, Math.sin(a) * (R + 0.004)); m.lookAt(Math.cos(a) * 3, y, Math.sin(a) * 3); m.rotation.z = rand() * 3; decor.add(m); }
    }

    const tex = design.message ? messageTexture(design.message, hexOf(design.lettering_color, '#4f3163'), design.lettering) : null;
    if (tex) {
      const plane = new THREE.Mesh(new THREE.CircleGeometry(TEXT_R, 64), new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: design.lettering === 'pearl_letters' ? 0.3 : 0.6, depthWrite: false }));
      plane.rotation.x = -Math.PI / 2; plane.position.y = H + 0.004; decor.add(plane);
    }

    if (design.topper && design.topper !== 'none') {
      const label = design.topper === 'number' ? (design.topper_text || '1') : design.topper === 'congrats' ? 'Congrats' : 'Happy Birthday';
      const t = topperTexture(label); const topper = new THREE.Group();
      const face = new THREE.Mesh(new THREE.PlaneGeometry(1.35, 0.68), new THREE.MeshStandardMaterial({ map: t, transparent: true, alphaTest: 0.2, metalness: 0.6, roughness: 0.3, side: THREE.DoubleSide }));
      face.position.y = 0.62; face.castShadow = true; topper.add(face);
      const stick = new THREE.MeshStandardMaterial({ color: '#c9a227', metalness: 0.7, roughness: 0.3 });
      for (const x of [-0.28, 0.28]) { const s = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 6), stick); s.position.set(x, 0.25, 0); topper.add(s); }
      topper.position.set(0, H - 0.05, -0.32); decor.add(topper);
    }
  }

  // Same choices as the built-in shapes, but with the Blender parts and copies of its decorations.
  function updateModel(design, palette, hexOf, frost) {
    const P = model.parts, rand = seeded(97);
    const accents = new Set(design.accents || []), borders = new Set(design.border || []);
    const recolor = (o, hex) => o && forEachMesh(o, (m) => { m.material.color.set(hex); });
    recolor(P.cake, frost); recolor(P.top_frosting, frost);
    if (P.border_top_shell) { P.border_top_shell.visible = borders.has('shell_top'); recolor(P.border_top_shell, shade(frost, 0.03)); }
    if (P.border_bottom_shell) { P.border_bottom_shell.visible = borders.has('shell_bottom'); recolor(P.border_bottom_shell, shade(frost, 0.03)); }
    if (P.drip) { P.drip.visible = accents.has('drip'); recolor(P.drip, shade(frost, -0.28)); }

    if ((accents.has('pearls_gold') || accents.has('pearls_silver')) && model.templates.pearl) {
      const mat = new THREE.MeshStandardMaterial({ color: accents.has('pearls_gold') ? '#d4af37' : '#c9ccd3', roughness: 0.25, metalness: 0.85 });
      const put = (x, y, z) => placeCopy(model.templates.pearl, x, y, z).traverse((m) => { if (m.isMesh) { m.material = mat; m.userData.sharedMaterial = false; } });
      const topY = borders.has('shell_top') && model.topShellY ? model.topShellY - 0.01 : H + 0.02;
      for (let i = 0; i < 26; i++) { const a = ((i + 0.5) / 26) * Math.PI * 2; put(Math.cos(a) * (R - 0.06), topY, Math.sin(a) * (R - 0.06)); }
      for (let i = 0; i < 18; i++) { const a = rand() * Math.PI * 2, r = TEXT_R + 0.04 + rand() * Math.max(0.02, R - TEXT_R - 0.2); put(Math.cos(a) * r, H + 0.015, Math.sin(a) * r); }
      if (borders.has('shell_bottom') && model.bottomShellY) for (let i = 0; i < 30; i++) { const a = ((i + 0.5) / 30) * Math.PI * 2; put(Math.cos(a) * (R + 0.08), model.bottomShellY - 0.01, Math.sin(a) * (R + 0.08)); }
    }
    if (accents.has('ribbon_bows') && model.bow) {
      const mat = new THREE.MeshStandardMaterial({ color: hexOf(design.bow_color, '#ee82a8'), roughness: 0.35, metalness: 0.05 });
      for (let i = 0; i < 4; i++) {
        const target = Math.PI / 4 + i * Math.PI / 2, pivot = new THREE.Group();
        const bow = model.bow.object.clone(true);
        bow.traverse((m) => { if (m.isMesh) { m.userData.sharedGeometry = true; m.material = mat; m.castShadow = true; } });
        pivot.add(bow); pivot.rotation.y = model.bow.angle - target; decor.add(pivot);
      }
    }
    if (accents.has('piped_flowers') && model.templates.flower_piped) {
      for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2 + 0.3, r = R - 0.2; placeCopy(model.templates.flower_piped, Math.cos(a) * r, H + 0.02, Math.sin(a) * r, rand() * Math.PI); }
    }
    if (accents.has('piped_leaves') && model.templates.leaf_piped) {
      for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2 + 0.05, r = R - 0.13; placeCopy(model.templates.leaf_piped, Math.cos(a) * r, H + 0.012, Math.sin(a) * r, -a + 0.8); }
    }
    decorateShared(design, hexOf, rand, accents);
    request();
  }

  function resetView() { Object.assign(view, DEFAULT); placeCamera(); }
  // Small image of the current design for the cart line (supplementary to the stored choices).
  function snapshot(size = 240) {
    const saved = { ...view }; Object.assign(view, { yaw: 0.35, pitch: 0.75, dist: 5.4 }); placeCamera();
    renderer.render(scene, camera);
    const out = document.createElement('canvas'); out.width = out.height = size; const g = out.getContext('2d');
    const src = renderer.domElement, s = Math.min(src.width, src.height);
    g.fillStyle = '#fbf6ff'; g.fillRect(0, 0, size, size);
    g.drawImage(src, (src.width - s) / 2, (src.height - s) / 2, s, s, 0, 0, size, size);
    Object.assign(view, saved); placeCamera();
    return out.toDataURL('image/jpeg', 0.78);
  }
  function dispose() {
    alive = false; cancelAnimationFrame(frame); ro.disconnect(); clearDecor();
    if (model) forEachMesh(model.root, (m) => { m.geometry.dispose(); (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => { x.map?.dispose(); x.dispose(); }); });
    disposables.forEach((d) => d.dispose?.()); renderer.dispose(); renderer.forceContextLoss?.(); renderer.domElement.remove();
  }
  return { update, resetView, snapshot, dispose, canvas: renderer.domElement };
}
