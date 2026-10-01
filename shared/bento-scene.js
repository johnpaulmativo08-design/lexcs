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

// ---- Surface detail -------------------------------------------------------------------------------
// The Blender model has no UV coordinates, so detail is generated in the shader from the world position:
// procedural noise perturbs the normal (bump) and roughness. No texture files, nothing extra to download.
const NOISE_GLSL = `
float sdHash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float sdNoise(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(sdHash(i), sdHash(i + vec3(1,0,0)), f.x), mix(sdHash(i + vec3(0,1,0)), sdHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(sdHash(i + vec3(0,0,1)), sdHash(i + vec3(1,0,1)), f.x), mix(sdHash(i + vec3(0,1,1)), sdHash(i + vec3(1,1,1)), f.x), f.y), f.z); }
float sdFbm(vec3 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * sdNoise(p); p *= 2.03; a *= 0.5; } return v; }`;
const SURF = {
  buttercream: { scale: [1.6, 7, 1.6], fine: 5, strength: 0.016, rough: 0.1 },  // soft spatula streaks on the sides, gentle bumps on top
  piped: { scale: [12, 12, 12], fine: 24, strength: 0.014, rough: 0.08 },        // piping-bag ridges
  glaze: { scale: [4, 4, 4], fine: 10, strength: 0.008, rough: 0.03 },           // glossy drip
  weave: { scale: [40, 40, 40], fine: 80, strength: 0.004, rough: 0.05 },        // satin ribbon / paper fibres
  crinkle: { scale: [18, 18, 18], fine: 40, strength: 0.12, rough: 0.18 },       // gold leaf
  pulp: { scale: [9, 9, 9], fine: 45, strength: 0.012, rough: 0.04 }             // moulded pulp box
};
function withSurface(material, cfg) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSdScale = { value: new THREE.Vector3(...cfg.scale) };
    shader.uniforms.uSdFine = { value: cfg.fine };
    shader.uniforms.uSdStrength = { value: cfg.strength };
    shader.uniforms.uSdRough = { value: cfg.rough };
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec3 vSdPos;\nvoid main() {')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n  vSdPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `varying vec3 vSdPos;\nuniform vec3 uSdScale;\nuniform float uSdFine, uSdStrength, uSdRough;\n${NOISE_GLSL}\nvoid main() {`)
      .replace('#include <roughnessmap_fragment>', `float sdH = sdFbm(vSdPos * uSdScale) * 0.8 + sdNoise(vSdPos * uSdFine) * 0.2;
#include <roughnessmap_fragment>
  roughnessFactor = clamp(roughnessFactor + (sdH - 0.5) * uSdRough, 0.04, 1.0);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  {
    vec3 sdSurf = -vViewPosition; vec2 sdD = vec2(dFdx(sdH), dFdy(sdH)) * uSdStrength;
    vec3 sdSx = dFdx(sdSurf), sdSy = dFdy(sdSurf); vec3 sdR1 = cross(sdSy, normal), sdR2 = cross(normal, sdSx);
    float sdDet = dot(sdSx, sdR1) * (gl_FrontFacing ? 1.0 : -1.0);
    normal = normalize(abs(sdDet) * normal - sign(sdDet) * (sdD.x * sdR1 + sdD.y * sdR2));
  }`);
  };
  material.customProgramCacheKey = () => 'lexc-surface-' + cfg.scale.join('-') + '-' + cfg.fine;
  return material;
}
// Material library: physically based, tuned for bakery surfaces. Colour accuracy matters (customers pick
// frosting colours), so no tone mapping is used and environment light on frosting is kept gentle.
const M = {
  frosting: (color) => withSurface(new THREE.MeshPhysicalMaterial({ color, roughness: 0.6, sheen: 0.3, sheenRoughness: 0.8, sheenColor: 0x3a3a3a, envMapIntensity: 0.25 }), SURF.buttercream),
  piped: (color) => withSurface(new THREE.MeshPhysicalMaterial({ color, roughness: 0.55, sheen: 0.3, sheenRoughness: 0.75, sheenColor: 0x3a3a3a, envMapIntensity: 0.28 }), SURF.piped),
  glaze: (color) => withSurface(new THREE.MeshPhysicalMaterial({ color, roughness: 0.2, clearcoat: 0.8, clearcoatRoughness: 0.12, envMapIntensity: 0.75 }), SURF.glaze),
  satin: (color) => withSurface(new THREE.MeshPhysicalMaterial({ color, roughness: 0.32, sheen: 0.8, sheenRoughness: 0.3, sheenColor: shade(color, 0.18), envMapIntensity: 0.6 }), SURF.weave),
  // Metals mirror their surroundings; a soft glow in their own colour keeps silver silver and gold gold
  // even when the reflection behind them is dark (e.g. viewed from above).
  metal: (color, roughness = 0.2) => new THREE.MeshPhysicalMaterial({ color, metalness: 0.92, roughness, clearcoat: 0.6, clearcoatRoughness: 0.08, envMapIntensity: 1.45,
    emissive: shade(color, -0.18), emissiveIntensity: 0.55 }),
  goldLeaf: () => withSurface(new THREE.MeshPhysicalMaterial({ color: '#f0c65a', metalness: 0.9, roughness: 0.34, emissive: '#6b4a0c', emissiveIntensity: 0.55, envMapIntensity: 1.6, side: THREE.DoubleSide }), SURF.crinkle),
  sugar: (color) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.3, clearcoat: 0.85, clearcoatRoughness: 0.2, envMapIntensity: 0.55 }),
  pulp: (color) => withSurface(new THREE.MeshPhysicalMaterial({ color, roughness: 0.95, envMapIntensity: 0.18 }), SURF.pulp),
  cloth: (color, map = null) => withSurface(new THREE.MeshPhysicalMaterial({ color, map, roughness: 0.85, sheen: 0.35, sheenRoughness: 0.6, sheenColor: 0x444444, envMapIntensity: 0.2, side: THREE.DoubleSide }), SURF.weave)
};

// Height map (white = raised) -> tangent-space normal map, so piping and pearls catch the light.
function heightToNormal(height, strength) {
  const w = height.width, h = height.height, src = height.getContext('2d').getImageData(0, 0, w, h).data;
  const out = document.createElement('canvas'); out.width = w; out.height = h; const g = out.getContext('2d'); const img = g.createImageData(w, h); const d = img.data;
  const at = (x, y) => src[((Math.min(h - 1, Math.max(0, y)) * w) + Math.min(w - 1, Math.max(0, x))) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    const len = Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
    d[i] = (-dx / len * 0.5 + 0.5) * 255; d[i + 1] = (dy / len * 0.5 + 0.5) * 255; d[i + 2] = (1 / len * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return out;
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
// Returns { map, normalMap } for the message: piped letters get a raised, rounded bead of icing;
// pearl letters are built from individual pearls following the letter shapes.
function messageTextures(message, colorHex, style) {
  const text = message.trim(); if (!text) return null;
  const size = 1024, family = "'Nunito','DM Sans',sans-serif";
  const color = document.createElement('canvas'), height = document.createElement('canvas');
  color.width = color.height = height.width = height.height = size;
  const g = color.getContext('2d'), hg = height.getContext('2d');
  hg.fillStyle = '#000'; hg.fillRect(0, 0, size, size);
  let fontSize = 150, lines;
  const body = style === 'pearl_letters' ? text.toUpperCase() : text;
  for (; fontSize > 40; fontSize -= 6) {
    g.font = `800 ${fontSize}px ${family}`;
    lines = layoutLines(g, body, size * 0.84);
    const blockH = lines.length * fontSize * 1.08, widest = Math.max(...lines.map((l) => g.measureText(l).width));
    if (lines.length <= 4 && Math.hypot(widest / 2, blockH / 2) < size * 0.485) break;
  }
  const lh = fontSize * 1.08, top = size / 2 - (lines.length - 1) * lh / 2;
  const base = new THREE.Color(colorHex), dark = shade(colorHex, -0.2).getStyle(), light = shade(colorHex, 0.12).getStyle();
  const drawText = (ctx, fill, stroke = 0) => {
    ctx.font = `800 ${fontSize}px ${family}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    lines.forEach((l, i) => { const y = top + i * lh; if (stroke) { ctx.lineWidth = stroke; ctx.strokeStyle = fill; ctx.strokeText(l, size / 2, y); } ctx.fillStyle = fill; ctx.fillText(l, size / 2, y); });
  };
  // Colours each line with a gentle top-to-bottom shade and a thin highlight on the upper edge only,
  // so dark colours (black, navy, burgundy) stay dark.
  const shadeLines = (width, spec) => {
    g.save(); g.globalCompositeOperation = 'source-atop';
    lines.forEach((l, i) => {
      const y = top + i * lh, grad = g.createLinearGradient(0, y - fontSize * 0.55, 0, y + fontSize * 0.55);
      grad.addColorStop(0, light); grad.addColorStop(0.45, base.getStyle()); grad.addColorStop(1, dark);
      g.fillStyle = grad; g.fillRect(0, y - fontSize, size, fontSize * 2);
    });
    g.globalAlpha = spec; g.font = `800 ${fontSize}px ${family}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    g.lineWidth = width; g.strokeStyle = '#ffffff';
    lines.forEach((l, i) => g.strokeText(l, size / 2 - fontSize * 0.015, top + i * lh - fontSize * 0.03));
    g.restore();
  };
  if (style === 'pearl_letters') {
    // Smooth, rounded candy letters with a soft pearly highlight (the shimmer itself comes from the material).
    g.save(); g.filter = `blur(${Math.round(fontSize * 0.025)}px)`; g.globalAlpha = 0.3; g.translate(5, 8); drawText(g, 'rgba(40,20,50,1)', fontSize * 0.2); g.restore();
    drawText(g, dark, fontSize * 0.2);
    drawText(g, base.getStyle(), fontSize * 0.15);
    shadeLines(fontSize * 0.018, 0.38);
    hg.save(); hg.filter = `blur(${Math.round(fontSize * 0.075)}px)`; drawText(hg, '#fff', fontSize * 0.2); hg.restore();
  } else {
    // Piped icing: a thick rounded line with a darker rim and a soft highlight, plus a blurred height map.
    g.save(); g.filter = `blur(${Math.round(fontSize * 0.02)}px)`; g.globalAlpha = 0.35; g.translate(4, 6); drawText(g, 'rgba(40,20,50,1)', fontSize * 0.16); g.restore();
    drawText(g, dark, fontSize * 0.17);
    drawText(g, base.getStyle(), fontSize * 0.12);
    shadeLines(fontSize * 0.014, 0.25);
    hg.save(); hg.filter = `blur(${Math.round(fontSize * 0.05)}px)`; drawText(hg, '#fff', fontSize * 0.15); hg.restore();
  }
  const map = new THREE.CanvasTexture(color); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
  const normalMap = new THREE.CanvasTexture(heightToNormal(height, style === 'pearl_letters' ? 4.5 : 3.5));
  return { map, normalMap };
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

function stickerTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  g.fillStyle = '#7551aa'; g.beginPath(); g.arc(128, 128, 124, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 6; g.setLineDash([10, 9]); g.beginPath(); g.arc(128, 128, 106, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = "italic 700 64px 'Playfair Display',serif"; g.fillText('LexC’s', 128, 112);
  g.font = "600 26px 'DM Sans',sans-serif"; g.fillText('SNACKTIME', 128, 164);
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
  scene.add(new THREE.HemisphereLight(0xffffff, 0xe8dcef, 0.95));
  const key = new THREE.DirectionalLight(0xfff4e6, 1.9); key.position.set(3.2, 6, 3.5); key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024); key.shadow.camera.left = key.shadow.camera.bottom = -3; key.shadow.camera.right = key.shadow.camera.top = 3; key.shadow.bias = -0.0008;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xe9e0ff, 0.45); fill.position.set(-4, 3, -2); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 0.55); rim.position.set(-1.5, 2.5, -4.5); scene.add(rim);
  // Soft studio reflections (pearls, gold leaf, toppers and satin need something to reflect).
  let envTexture = null;
  import('three/addons/environments/RoomEnvironment.js').then(({ RoomEnvironment }) => {
    if (!alive) return;
    const pmrem = new THREE.PMREMGenerator(renderer); const room = new RoomEnvironment();
    envTexture = pmrem.fromScene(room, 0.035).texture; scene.environment = envTexture;
    room.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } }); pmrem.dispose(); request();
  }).catch((error) => console.info('Studio reflections unavailable:', error?.message || error));

  const disposables = new Set();
  const track = (o) => { disposables.add(o); return o; };
  const mat = (color, rough = 0.62, metal = 0) => track(new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }));
  const world = new THREE.Group(); scene.add(world);

  // --- fixed parts: box, gingham paper, cake body -------------------------------------------------
  const fixed = new THREE.Group(); world.add(fixed);
  const kraft = track(M.pulp(0xeee4cf));
  const tray = new THREE.Mesh(track(new THREE.BoxGeometry(3.3, 0.06, 3.3)), kraft); tray.position.y = -0.03; tray.receiveShadow = true; fixed.add(tray);
  for (const [x, z, w, d] of [[0, -1.62, 3.3, 0.06], [0, 1.62, 3.3, 0.06], [-1.62, 0, 0.06, 3.3], [1.62, 0, 0.06, 3.3]]) {
    const wall = new THREE.Mesh(track(new THREE.BoxGeometry(w, 0.55, d)), kraft); wall.position.set(x, 0.27, z); wall.receiveShadow = true; fixed.add(wall);
  }
  const lid = new THREE.Mesh(track(new THREE.BoxGeometry(3.3, 0.05, 3.3)), kraft);
  const hinge = new THREE.Group(); hinge.position.set(0, 0.55, -1.65); hinge.rotation.x = -1.95; lid.position.set(0, 0, 1.65); hinge.add(lid); fixed.add(hinge);
  const gingham = ginghamTexture(); track(gingham);
  const paper = new THREE.Mesh(track(new THREE.PlaneGeometry(3.0, 3.0, 8, 8)), track(M.cloth(0xffffff, gingham)));
  paper.rotation.x = -Math.PI / 2; paper.rotation.z = 0.08; paper.position.y = 0.005; paper.receiveShadow = true; fixed.add(paper);
  fixed.children.forEach((o) => { o.visible = false; });   // no box while designing; the fallback shows the cake only

  const profile = [new THREE.Vector2(0, 0), new THREE.Vector2(R * 0.985, 0), new THREE.Vector2(R, 0.03)];
  for (let i = 0; i <= 10; i++) { const a = (i / 10) * Math.PI / 2; profile.push(new THREE.Vector2(R - 0.06 + 0.06 * Math.cos(a), H - 0.06 + 0.06 * Math.sin(a))); }
  profile.push(new THREE.Vector2(0, H));
  const cakeMat = track(M.frosting(0xffffff));
  const cake = new THREE.Mesh(track(new THREE.LatheGeometry(profile, 96)), cakeMat); cake.castShadow = true; cake.receiveShadow = true; fixed.add(cake);

  // The cake (model + decorations) sits in "lift" so the packing animation can raise and lower it.
  const lift = new THREE.Group(); world.add(lift);
  const decor = new THREE.Group(); lift.add(decor);
  // While designing, the cake stands on a white cake stand; the box only appears when it is packed.
  const ceramic = track(new THREE.MeshPhysicalMaterial({ color: 0xfbf8ff, roughness: 0.28, clearcoat: 0.6, clearcoatRoughness: 0.2, envMapIntensity: 0.6, transparent: true }));
  const stand = new THREE.Group(); world.add(stand);
  for (const [r1, r2, h, y] of [[R * 1.32, R * 1.28, 0.07, -0.035], [0.2, 0.26, 0.42, -0.28], [0.72, 0.8, 0.06, -0.52]]) {
    const part = new THREE.Mesh(track(new THREE.CylinderGeometry(r1, r2, h, 72)), ceramic); part.position.y = y; part.castShadow = true; part.receiveShadow = true; stand.add(part);
  }
  const clearDecor = () => {
    decor.traverse((o) => { if (o.isMesh) { if (!o.userData.sharedGeometry) o.geometry.dispose(); if (!o.userData.sharedMaterial) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.map?.dispose(); m.dispose(); }); } });
    decor.clear();
  };

  // --- camera orbit (drag / one-finger rotate, wheel / pinch zoom, arrow keys) ----------------------
  const view = { yaw: 0.55, pitch: 0.62, dist: 6.2 };
  const DEFAULT = { ...view };
  const VIEWS = { pack: { yaw: 0.6, pitch: 0.5, dist: 8.4 }, default: DEFAULT, front: { yaw: 0, pitch: 0.3, dist: 5.8 }, top: { yaw: 0, pitch: 1.3, dist: 5.2 }, side: { yaw: Math.PI / 2, pitch: 0.42, dist: 6 } };
  // Small animation system: runs only while something is moving, then the scene goes back to render-on-demand.
  const anims = new Set(); let spin = false, spinTimer = 0, lastTick = 0, spinAllowed = !reducedMotion;
  function animate(fn, ms) {
    if (reducedMotion || ms <= 0) { fn(1); request(); return; }
    const start = performance.now(); anims.add({ fn, start, ms }); loop();
  }
  function loop() {
    if (loop.running) return; loop.running = true; lastTick = performance.now();
    const step = (now) => {
      if (!alive) { loop.running = false; return; }
      for (const a of [...anims]) { const t = Math.min(1, (now - a.start) / a.ms); a.fn(t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2); if (t >= 1) anims.delete(a); }
      if (spin) { view.yaw += (now - lastTick) * 0.00018; placeCamera(false); }
      lastTick = now;
      renderer.render(scene, camera);
      if (anims.size || spin) requestAnimationFrame(step); else loop.running = false;
    };
    requestAnimationFrame(step);
  }
  // Gentle turntable after a few seconds without interaction (never with reduced motion).
  function idle() {
    clearTimeout(spinTimer); spin = false;
    if (spinAllowed && alive) spinTimer = setTimeout(() => { if (alive && !document.hidden) { spin = true; loop(); } }, 6000);
  }
  function setView(name) {
    const to = VIEWS[name] || DEFAULT, from = { ...view };
    let dy = ((to.yaw - from.yaw) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI;   // shortest turn
    idle();
    animate((k) => { view.yaw = from.yaw + dy * k; view.pitch = from.pitch + (to.pitch - from.pitch) * k; view.dist = from.dist + (to.dist - from.dist) * k; placeCamera(false); }, 650);
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) { spin = false; clearTimeout(spinTimer); } else idle(); });
  const pointers = new Map(); let pinchStart = null;
  function placeCamera(render = true) {
    view.pitch = Math.min(1.35, Math.max(0.18, view.pitch)); view.dist = Math.min(9, Math.max(3.4, view.dist));
    camera.position.set(Math.sin(view.yaw) * Math.cos(view.pitch) * view.dist, 0.55 + Math.sin(view.pitch) * view.dist, Math.cos(view.yaw) * Math.cos(view.pitch) * view.dist);
    camera.lookAt(0, 0.55, 0); if (render) request();
  }
  const el = renderer.domElement;
  for (const type of ['pointerdown', 'wheel', 'keydown']) el.addEventListener(type, () => { if (packing) return; anims.clear(); idle(); }, { passive: true });
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
    // Bakery materials in place of the model's plain ones (base colours kept; frosting parts are recoloured later).
    const swap = (o, make) => o && forEachMesh(o, (m) => { const old = m.material; m.material = make(old.color.clone()); old.dispose(); });
    for (const name of ['cake', 'top_frosting']) swap(parts[name], M.frosting);
    for (const name of ['border_top_shell', 'border_bottom_shell']) swap(parts[name], M.piped);
    swap(parts.drip, M.glaze); swap(parts.box_clamshell, M.pulp); swap(parts.gingham_paper, (c) => M.cloth(c));
    for (const name of ['flower_piped', 'leaf_piped']) if (templates[name]) swap(templates[name], M.piped);
    model = { root, parts, templates, bow, topShellY: yTop(parts.border_top_shell), bottomShellY: yTop(parts.border_bottom_shell), pack: buildPack(parts) };
    fixed.visible = false; lift.add(root);
    if (lastDesign) update(lastDesign, lastPalette); else request();
  }
  // --- packaging ---------------------------------------------------------------------------------
  // The model's clamshell is one mesh with its lid standing open behind the base. Split it: triangles
  // above the base rim become the lid, hung on a hinge along the base's back edge (model units).
  const BASE_RIM = 0.0425, HINGE = new THREE.Vector3(0, 0.043, -0.079), LID_CLOSED = 1.83;
  function buildPack(parts) {
    const box = parts.box_clamshell; if (!box?.isMesh) return null;
    const pack = new THREE.Group(); world.add(pack);
    pack.attach(box); if (parts.gingham_paper) pack.attach(parts.gingham_paper);
    const src = box.geometry.index ? box.geometry.toNonIndexed() : box.geometry.clone();
    const names = Object.keys(src.attributes), pos = src.attributes.position, keepBase = [], keepLid = [];
    for (let t = 0; t < pos.count; t += 3) ((pos.getY(t) + pos.getY(t + 1) + pos.getY(t + 2)) / 3 > BASE_RIM ? keepLid : keepBase).push(t);
    const subset = (tris) => {
      const g = new THREE.BufferGeometry();
      for (const name of names) {
        const a = src.attributes[name], out = new a.array.constructor(tris.length * 3 * a.itemSize);
        tris.forEach((t, i) => out.set(a.array.subarray(t * a.itemSize, (t + 3) * a.itemSize), i * 3 * a.itemSize));
        g.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize, a.normalized));
      }
      return g;
    };
    if (!keepLid.length) { src.dispose(); return null; }
    box.geometry.dispose(); box.geometry = subset(keepBase);
    const lid = new THREE.Mesh(subset(keepLid), box.material); lid.castShadow = lid.receiveShadow = true; src.dispose();
    const hinge = new THREE.Group(); hinge.position.copy(HINGE); lid.position.copy(HINGE).negate(); hinge.add(lid); box.add(hinge);
    const sticker = new THREE.Mesh(track(new THREE.CircleGeometry(0.42, 48)), track(new THREE.MeshPhysicalMaterial({ map: track(stickerTexture()), roughness: 0.4, clearcoat: 0.4, transparent: true })));
    sticker.rotation.x = -Math.PI / 2; sticker.visible = false; pack.add(sticker);
    pack.visible = false;
    return { group: pack, hinge, lid, sticker };
  }
  const tween = (fn, ms) => new Promise((done) => animate((k) => { fn(k); if (k >= 1) done(); }, ms));
  const wait = (ms) => new Promise((done) => setTimeout(done, reducedMotion ? 0 : ms));
  let packing = null;
  // Lift the cake off the stand, slide the open box underneath, lower the cake in, close the lid, seal it.
  function pack() {
    if (packing) return packing;
    packing = (async () => {
      const P = model?.pack; if (!P) return;
      clearTimeout(spinTimer); spin = false; spinAllowed = false; anims.clear();
      const toppers = []; decor.traverse((o) => { if (o.userData.topper) toppers.push(o); });
      P.group.visible = true; P.group.position.set(0, 0, -7); P.hinge.rotation.x = 0; P.sticker.visible = false;
      setView('pack'); clearTimeout(spinTimer);
      await tween((k) => { lift.position.y = 0.95 * k; stand.position.y = -1.4 * k; ceramic.opacity = 1 - k; }, 750);
      stand.visible = false;
      await tween((k) => { P.group.position.z = -7 * (1 - k); }, 850);
      await tween((k) => { lift.position.y = 0.95 * (1 - k); }, 650);
      await wait(120);
      await tween((k) => { P.hinge.rotation.x = LID_CLOSED * k; for (const t of toppers) t.scale.setScalar(Math.max(0.001, 1 - k * 1.6)); }, 950);
      await tween((k) => { const b = Math.sin(k * Math.PI); world.scale.set(1 + 0.025 * b, 1 - 0.035 * b, 1 + 0.025 * b); }, 260);
      world.scale.set(1, 1, 1);
      world.updateMatrixWorld(true);
      const top = new THREE.Box3().setFromObject(P.lid, true), c = top.getCenter(new THREE.Vector3());
      P.sticker.position.set(c.x - P.group.position.x, top.max.y + 0.004, c.z - P.group.position.z);
      P.sticker.visible = true;
      await tween((k) => { P.sticker.scale.setScalar(Math.max(0.001, k < 0.7 ? k / 0.7 * 1.15 : 1.15 - (k - 0.7) / 0.3 * 0.15)); }, 420);
      spinAllowed = !reducedMotion; idle();
    })();
    return packing;
  }
  // Back to designing: box away, cake on its stand.
  function unpack() {
    packing = null; anims.clear(); const P = model?.pack;
    if (P) { P.group.visible = false; P.hinge.rotation.x = 0; P.sticker.visible = false; }
    lift.position.y = 0; stand.position.y = 0; stand.visible = true; ceramic.opacity = 1; world.scale.set(1, 1, 1);
    decor.traverse((o) => { if (o.userData.topper) o.scale.setScalar(1); });
    spinAllowed = !reducedMotion; setView('default');
  }
  loadModel().catch((error) => { console.info('Bento model unavailable, using built-in shapes:', error?.message || error); model = null; fixed.visible = true; });
  const placeCopy = (tpl, x, y, z, rotY = 0) => {
    const copy = tpl.clone(true); copy.position.set(x, y, z); copy.rotation.y = rotY;
    copy.traverse((m) => { if (m.isMesh) { m.userData.sharedGeometry = true; m.userData.sharedMaterial = true; m.castShadow = true; } });
    decor.add(copy); return copy;
  };

  // Frosting colour changes fade over ~0.3 s instead of jumping.
  const fadeTargets = new Map();   // material -> target colour
  function fadeColor(material, hex) {
    const to = new THREE.Color(hex);
    if (!material.userData.faded) { material.color.copy(to); material.userData.faded = true; return; }   // first paint: no fade
    if (material.color.equals(to)) return;
    const from = material.color.clone(); fadeTargets.set(material, to);
    animate((k) => { if (fadeTargets.get(material) === to) material.color.copy(from).lerp(to, k); }, 320);
  }

  // --- decorations from the design state ---------------------------------------------------------
  function update(design, palette) {
    lastDesign = design; lastPalette = palette;
    const dmat = (color, rough = 0.62, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
    const hexOf = (code, fallback = '#ffffff') => palette[code] || fallback;
    const frost = hexOf(design.frosting_color);
    fadeColor(cakeMat, frost);
    clearDecor();
    if (model) return updateModel(design, palette, hexOf, frost);
    const rand = seeded(97);
    const accents = new Set(design.accents || []); const borders = new Set(design.border || []);
    const frostMat = M.piped(shade(frost, 0.03));

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
      const dripMat = M.glaze(shade(frost, -0.28));
      for (let i = 0; i < 30; i++) {
        const a = (i / 30) * Math.PI * 2 + rand() * 0.08, len = 0.12 + rand() * 0.35;
        const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, len, 4, 10), dripMat);
        body.position.set(Math.cos(a) * (R + 0.012), H - 0.02 - len / 2, Math.sin(a) * (R + 0.012)); decor.add(body);
      }
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.012, R + 0.012, 0.05, 96), dripMat); cap.position.y = H - 0.02; decor.add(cap);
    }

    const pearl = (hex) => M.metal(hex);
    if (accents.has('pearls_gold') || accents.has('pearls_silver')) {
      const pm = pearl(accents.has('pearls_gold') ? '#d4af37' : '#e4e7ec'); const g = new THREE.SphereGeometry(0.028, 14, 10);
      for (let i = 0; i < 26; i++) { const a = ((i + 0.5) / 26) * Math.PI * 2; const m = new THREE.Mesh(i ? g.clone() : g, pm); m.position.set(Math.cos(a) * (R - 0.05), H + 0.1, Math.sin(a) * (R - 0.05)); decor.add(m); }
      for (let i = 0; i < 18; i++) { const a = rand() * Math.PI * 2, r = TEXT_R + 0.04 + rand() * (R - TEXT_R - 0.2); const m = new THREE.Mesh(g.clone(), pm); m.position.set(Math.cos(a) * r, H + 0.02, Math.sin(a) * r); decor.add(m); }
      if (borders.has('shell_bottom')) for (let i = 0; i < 30; i++) { const a = ((i + 0.5) / 30) * Math.PI * 2; const m = new THREE.Mesh(g.clone(), pm); m.position.set(Math.cos(a) * (R + 0.1), 0.17, Math.sin(a) * (R + 0.1)); decor.add(m); }
    }

    if (accents.has('ribbon_bows')) {
      const bm = M.satin(hexOf(design.bow_color, '#ee82a8'));
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
        const a = (i / 7) * Math.PI * 2 + 0.3, r = R - 0.22; const flower = new THREE.Group(); const pm = M.piped(petalCols[i % petalCols.length]);
        for (let p = 0; p < 5; p++) { const pa = (p / 5) * Math.PI * 2; const petal = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), pm); petal.scale.set(1.2, 0.5, 0.8); petal.position.set(Math.cos(pa) * 0.05, 0, Math.sin(pa) * 0.05); flower.add(petal); }
        const center = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 8), M.piped('#f4d03f')); center.position.y = 0.02; flower.add(center);
        flower.position.set(Math.cos(a) * r, H + 0.02, Math.sin(a) * r); decor.add(flower);
      }
    }
    if (accents.has('piped_leaves')) {
      const lm = M.piped('#3fa66b'), dm = M.piped('#ffffff');
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
      for (let i = 0; i < 90; i++) { const a = rand() * Math.PI * 2, r = TEXT_R + 0.03 + rand() * (R - TEXT_R - 0.12); const m = new THREE.Mesh(g.clone(), M.sugar(cols[i % cols.length])); m.position.set(Math.cos(a) * r, H + 0.012, Math.sin(a) * r); m.rotation.set(Math.PI / 2, 0, rand() * Math.PI); decor.add(m); }
    }
    if (accents.has('gold_leaf')) {
      const gm = M.goldLeaf();
      for (let i = 0; i < 26; i++) { const a = rand() * Math.PI * 2, y = 0.18 + rand() * (H - 0.35); const m = new THREE.Mesh(new THREE.CircleGeometry(0.03 + rand() * 0.035, 5), gm); m.position.set(Math.cos(a) * (R + 0.004), y, Math.sin(a) * (R + 0.004)); m.lookAt(Math.cos(a) * 3, y, Math.sin(a) * 3); m.rotation.z = rand() * 3; decor.add(m); }
    }

    const tex = design.message ? messageTextures(design.message, hexOf(design.lettering_color, '#4f3163'), design.lettering) : null;
    if (tex) {
      const pearls = design.lettering === 'pearl_letters';
      // Pearly shimmer only on light letters; dark candy letters keep their true colour.
      const hsl = {}; new THREE.Color(hexOf(design.lettering_color, '#4f3163')).getHSL(hsl); const shimmer = pearls && hsl.l > 0.55;
      const plane = new THREE.Mesh(new THREE.CircleGeometry(TEXT_R, 64), new THREE.MeshPhysicalMaterial({
        map: tex.map, normalMap: tex.normalMap, normalScale: new THREE.Vector2(pearls ? 0.9 : 1.2, pearls ? 0.9 : 1.2), transparent: true, depthWrite: false,
        roughness: pearls ? 0.45 : 0.6, clearcoat: shimmer ? 0.5 : pearls ? 0.15 : 0, clearcoatRoughness: 0.25, sheen: pearls ? 0 : 0.3, sheenRoughness: 0.75, sheenColor: 0x3a3a3a,
        iridescence: shimmer ? 0.45 : 0, iridescenceIOR: 1.3, iridescenceThicknessRange: [180, 420], envMapIntensity: shimmer ? 0.5 : 0.2 }));
      plane.rotation.x = -Math.PI / 2; plane.position.y = H + 0.004; decor.add(plane);
    }

    if (design.topper && design.topper !== 'none') {
      const label = design.topper === 'number' ? (design.topper_text || '1') : design.topper === 'congrats' ? 'Congrats' : 'Happy Birthday';
      const t = topperTexture(label); const topper = new THREE.Group();
      const face = new THREE.Mesh(new THREE.PlaneGeometry(1.35, 0.68), new THREE.MeshPhysicalMaterial({ map: t, emissiveMap: t, emissive: '#ffffff', emissiveIntensity: 0.35, transparent: true, alphaTest: 0.2, metalness: 0.75, roughness: 0.22, clearcoat: 0.7, clearcoatRoughness: 0.08, envMapIntensity: 1.4, side: THREE.DoubleSide }));
      face.position.y = 0.62; face.castShadow = true; topper.add(face);
      const stick = M.metal('#c9a227', 0.25);
      for (const x of [-0.28, 0.28]) { const s = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 6), stick); s.position.set(x, 0.25, 0); topper.add(s); }
      topper.position.set(0, H - 0.05, -0.32); topper.userData.topper = true; decor.add(topper);
    }
  }

  // Same choices as the built-in shapes, but with the Blender parts and copies of its decorations.
  function updateModel(design, palette, hexOf, frost) {
    const P = model.parts, rand = seeded(97);
    const accents = new Set(design.accents || []), borders = new Set(design.border || []);
    const recolor = (o, hex) => o && forEachMesh(o, (m) => { fadeColor(m.material, hex); if (m.material.sheenColor && m.material.sheen > 0.8) m.material.sheenColor.copy(shade(hex, 0.28)); });
    recolor(P.cake, frost); recolor(P.top_frosting, frost);
    if (P.border_top_shell) { P.border_top_shell.visible = borders.has('shell_top'); recolor(P.border_top_shell, shade(frost, 0.03)); }
    if (P.border_bottom_shell) { P.border_bottom_shell.visible = borders.has('shell_bottom'); recolor(P.border_bottom_shell, shade(frost, 0.03)); }
    if (P.drip) { P.drip.visible = accents.has('drip'); recolor(P.drip, shade(frost, -0.28)); }

    if ((accents.has('pearls_gold') || accents.has('pearls_silver')) && model.templates.pearl) {
      const mat = M.metal(accents.has('pearls_gold') ? '#d4af37' : '#e4e7ec');
      const put = (x, y, z) => placeCopy(model.templates.pearl, x, y, z).traverse((m) => { if (m.isMesh) { m.material = mat; m.userData.sharedMaterial = false; } });
      const topY = borders.has('shell_top') && model.topShellY ? model.topShellY - 0.01 : H + 0.02;
      for (let i = 0; i < 26; i++) { const a = ((i + 0.5) / 26) * Math.PI * 2; put(Math.cos(a) * (R - 0.06), topY, Math.sin(a) * (R - 0.06)); }
      for (let i = 0; i < 18; i++) { const a = rand() * Math.PI * 2, r = TEXT_R + 0.04 + rand() * Math.max(0.02, R - TEXT_R - 0.2); put(Math.cos(a) * r, H + 0.015, Math.sin(a) * r); }
      if (borders.has('shell_bottom') && model.bottomShellY) for (let i = 0; i < 30; i++) { const a = ((i + 0.5) / 30) * Math.PI * 2; put(Math.cos(a) * (R + 0.08), model.bottomShellY - 0.01, Math.sin(a) * (R + 0.08)); }
    }
    if (accents.has('ribbon_bows') && model.bow) {
      const mat = M.satin(hexOf(design.bow_color, '#ee82a8'));
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

  function resetView() { setView('default'); }
  // Small image of the current design for the cart line (supplementary to the stored choices).
  // 'angle' is the cart/order picture; 'top' shows the message and border for the design card.
  function snapshot(size = 240, angle = 'angle') {
    const saved = { ...view }; Object.assign(view, angle === 'top' ? VIEWS.top : { yaw: 0.35, pitch: 0.75, dist: 5.4 }); placeCamera(false);
    renderer.render(scene, camera);
    const out = document.createElement('canvas'); out.width = out.height = size; const g = out.getContext('2d');
    const src = renderer.domElement, s = Math.min(src.width, src.height);
    g.fillStyle = '#fbf6ff'; g.fillRect(0, 0, size, size);
    g.drawImage(src, (src.width - s) / 2, (src.height - s) / 2, s, s, 0, 0, size, size);
    Object.assign(view, saved); placeCamera();
    return out.toDataURL('image/jpeg', 0.78);
  }
  function dispose() {
    alive = false; clearTimeout(spinTimer); anims.clear(); spin = false; cancelAnimationFrame(frame); ro.disconnect(); clearDecor();
    if (model?.pack) forEachMesh(model.pack.group, (m) => m.geometry.dispose());
    if (model) forEachMesh(model.root, (m) => { m.geometry.dispose(); (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => { x.map?.dispose(); x.dispose(); }); });
    envTexture?.dispose(); disposables.forEach((d) => d.dispose?.()); renderer.dispose(); renderer.forceContextLoss?.(); renderer.domElement.remove();
  }
  idle();
  return { update, resetView, setView, setAutoRotate: (on) => { spinAllowed = on && !reducedMotion; idle(); }, snapshot, pack, unpack, dispose, canvas: renderer.domElement };
}
