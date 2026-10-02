// The styled table the designers stand on (assets/3d/set.glb, modelled in Blender): an oak plank table and a
// lilac panelled wall with a shelf of candy jars, plus two prop sets — Bakery (cake on a stand, tulips, mixing
// bowl and whisk, teacup, macarons, rolling pin) and Party (balloons, gifts, party hats, bunting, confetti).
// Props were arranged around a 6.4-unit box; they are moved out (or in) to suit what is on the table, so a
// 48-piece box and a single bento cake both get a full, uncluttered frame. Loaded once, shared by every scene.
import * as THREE from 'three';

const SET_URL = new URL('../assets/3d/set.glb?v=1', import.meta.url).href;
const REF_HALF = 3.2, REF_GAP = 1.6, GAP = 0.9;   // props were placed REF_GAP outside a 6.4 box; keep GAP outside the real one
let setPromise = null;
// Oak grain drawn in the shader from the world position (the planks run front to back): long wavy lines,
// a few darker streaks and a soft sheen variation. No texture to download.
function woodGrain(material) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('void main() {', 'varying vec3 vGrainPos;\nvoid main() {')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n  vGrainPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('void main() {', `varying vec3 vGrainPos;
float gHash(float n){ return fract(sin(n) * 43758.5453); }
void main() {`).replace('#include <color_fragment>', `#include <color_fragment>
  {
    vec3 p = vGrainPos;
    float plank = floor((p.x + 22.0) / 4.889);
    float wave = sin(p.z * 0.23 + plank * 1.7) * 1.3 + sin(p.z * 0.07 + plank) * 2.0;
    float lines = sin((p.x + wave * 0.12) * 21.0 + gHash(plank) * 6.0);
    float rings = smoothstep(0.55, 1.0, lines) * 0.09 + smoothstep(0.92, 1.0, sin((p.x + wave * 0.2) * 5.0 + plank * 3.0)) * 0.07;
    diffuseColor.rgb *= 1.0 - rings + (gHash(plank + 3.0) - 0.5) * 0.06;
  }`);
  };
  material.customProgramCacheKey = () => 'lexc-oak-grain';
}
function loadSet() {
  setPromise ||= (async () => {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const gltf = await new GLTFLoader().loadAsync(SET_URL);
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      o.receiveShadow = true; o.castShadow = !/confetti|bunting|wall|table/.test(o.name);
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        m.envMapIntensity = /gold|steel|rim|balloon/.test(m.name) ? 1.1 : 0.35;
        if (/oak/.test(m.name)) { m.color.lerp(new THREE.Color('#FFFFFF'), 0.32); woodGrain(m); }   // a pale, bright oak under the warm key light
        if (/wall|panel/.test(m.name)) m.roughness = 0.95;
        if (/glass/.test(m.name)) { m.transparent = true; m.opacity = 0.3; m.depthWrite = false; }
      }
    });
    return gltf.scene;
  })().catch((error) => { setPromise = null; throw error; });
  return setPromise;
}

// Places the set in `parent` at height y. show('bakery' | 'party' | null, { W, D }) — W, D: footprint on the table.
export function createSet(parent, { y = 0, background = '#EFE7F5' } = {}) {
  let root = null, base = null, current = null, footprint = { W: REF_HALF * 2, D: REF_HALF * 2 }, alive = true;
  const group = new THREE.Group(); group.position.y = y; group.visible = false; parent.add(group);
  async function ready() {
    if (root) return root;
    const src = await loadSet(); if (!alive) return null;
    root = src.clone(true); group.add(root);
    base = new Map(); root.traverse((o) => base.set(o, o.position.clone()));
    return root;
  }
  function layout() {
    if (!root) return;
    const sx = Math.max(0.42, (footprint.W / 2 + GAP) / (REF_HALF + REF_GAP)), sz = Math.max(0.42, (footprint.D / 2 + GAP) / (REF_HALF + REF_GAP));
    for (const name of ['bakery', 'party']) {
      const g = root.getObjectByName(name); if (!g) continue;
      g.visible = name === current;
      for (const p of g.children) {
        const b = base.get(p);
        if (/confetti/.test(p.name)) { p.scale.set(sx, 1, sz); continue; }
        p.position.set(b.x * sx, b.y, b.z * sz);
      }
    }
    const wall = root.getObjectByName('wall'); if (wall) wall.position.z = base.get(wall).z - 13 * (sz - 1);
  }
  return {
    // Resolves to true when the set is showing (false if the model could not load).
    async show(name, fp) {
      current = name; if (fp) footprint = fp;
      if (!name) { group.visible = false; return true; }
      try { await ready(); } catch (error) { console.info('Table set unavailable:', error?.message || error); return false; }
      if (!alive || current !== name) return false;
      layout(); group.visible = true; return true;
    },
    resize(fp) { footprint = fp; layout(); },
    // Hide or restore at once (for a plain-background snapshot); returns what it was.
    peek(on) { const was = group.visible; group.visible = !!on && !!root && !!current; return was; },
    get visible() { return group.visible; },
    background: new THREE.Color(background),
    dispose() { alive = false; parent.remove(group); }   // geometry and materials are shared with the cached set
  };
}
