// The Proving Grounds (Athenaeum of Trials) gateway: a runed stone frame around
// a swirling energy vortex, used for BOTH the overworld entrance portal and the
// room's exit. Cooler and more "portal" than the plain dungeon-door arch it used
// to reuse: a slim frame, a glowing rim, a spinning vortex disc, and a bright
// core. Procedural + additive-blended (blooms on the composer tiers); the swirl
// disc is spun and opacity-pulsed by the renderer's existing per-frame portal
// hook (the same one that animates dungeon-door portals).
//
// Presentation only. Geometries and the two additive materials are cached
// module-level and flagged `sharedRendererResource` so they survive the
// renderer's object-view teardown on interest churn (only two portals ever
// exist); the frame/rim stone comes from surfaceMat, which dedupes on its own.

import * as THREE from 'three';
import { surfaceMat } from './gfx';

// Matches the renderer's PORTAL_BOOST: additive shimmers are pushed into HDR so
// they bloom on composer tiers (skipped on low gfx, which has no bloom).
const PORTAL_BOOST = 2;

// The entrance (overworld -> Proving Grounds) glows festival purple; the exit
// (room -> town) a cool blue. Same tints the old door-portal used.
const ENTER_TINT = 0x9a5df0;
const EXIT_TINT = 0x6ab8ff;
const FRAME_STONE = 0x2c2436; // deep violet-grey frame stone

export interface HubPortalView {
  group: THREE.Group;
  /** the swirl disc: spun + opacity-pulsed by the renderer's per-frame hook. */
  portal: THREE.Mesh;
  /** nameplate/label anchor height (yards). */
  height: number;
}

// --- shared, cached resources (see the module header on teardown safety) -----

function flagShared<T extends THREE.BufferGeometry | THREE.Material | THREE.Texture>(o: T): T {
  o.userData.sharedRendererResource = true;
  return o;
}

let ringGeo: THREE.TorusGeometry | null = null;
let discGeo: THREE.CircleGeometry | null = null;
let coreGeo: THREE.CircleGeometry | null = null;
let baseGeo: THREE.CylinderGeometry | null = null;
let floorRingGeo: THREE.TorusGeometry | null = null;
let postGeo: THREE.BoxGeometry | null = null;
let lintelGeo: THREE.BoxGeometry | null = null;
let swirlTex: THREE.CanvasTexture | null = null;
const swirlMats = new Map<boolean, THREE.MeshBasicMaterial>();
const coreMats = new Map<boolean, THREE.MeshBasicMaterial>();

function getRingGeo(): THREE.TorusGeometry {
  if (!ringGeo) ringGeo = flagShared(new THREE.TorusGeometry(1.75, 0.16, 12, 40));
  return ringGeo;
}
function getDiscGeo(): THREE.CircleGeometry {
  if (!discGeo) discGeo = flagShared(new THREE.CircleGeometry(1.62, 40));
  return discGeo;
}
function getCoreGeo(): THREE.CircleGeometry {
  if (!coreGeo) coreGeo = flagShared(new THREE.CircleGeometry(0.55, 28));
  return coreGeo;
}
function getBaseGeo(): THREE.CylinderGeometry {
  if (!baseGeo) baseGeo = flagShared(new THREE.CylinderGeometry(2.0, 2.25, 0.3, 32));
  return baseGeo;
}
function getFloorRingGeo(): THREE.TorusGeometry {
  if (!floorRingGeo) floorRingGeo = flagShared(new THREE.TorusGeometry(1.95, 0.09, 8, 40));
  return floorRingGeo;
}
function getPostGeo(): THREE.BoxGeometry {
  if (!postGeo) postGeo = flagShared(new THREE.BoxGeometry(0.3, 4.5, 0.42));
  return postGeo;
}
function getLintelGeo(): THREE.BoxGeometry {
  if (!lintelGeo) lintelGeo = flagShared(new THREE.BoxGeometry(4.6, 0.55, 0.5));
  return lintelGeo;
}

// A swirling vortex: a bright radial core fading to transparent, overlaid with
// three logarithmic spiral arms. Grayscale (the material colour tints it), so
// one texture serves both portals. Built in the browser on first placement.
function getSwirlTexture(): THREE.CanvasTexture {
  if (swirlTex) return swirlTex;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('hub portal: 2d canvas context unavailable');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 256, 256);
  const cx = 128;
  const cy = 128;
  const grad = ctx.createRadialGradient(cx, cy, 4, cx, cy, 128);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.4, 'rgba(190,180,255,0.45)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 7;
  for (let arm = 0; arm < 3; arm++) {
    ctx.beginPath();
    for (let t = 0; t <= 1.001; t += 0.02) {
      const ang = arm * ((Math.PI * 2) / 3) + t * Math.PI * 2.4;
      const rad = t * 122;
      const x = cx + Math.cos(ang) * rad;
      const y = cy + Math.sin(ang) * rad;
      if (t === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  swirlTex = tex;
  return flagShared(tex);
}

function getSwirlMat(entering: boolean, lowGfx: boolean): THREE.MeshBasicMaterial {
  const cached = swirlMats.get(entering);
  if (cached) return cached;
  const m = new THREE.MeshBasicMaterial({
    map: getSwirlTexture(),
    color: entering ? ENTER_TINT : EXIT_TINT,
    transparent: true,
    opacity: 0.6,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  if (!lowGfx) m.color.multiplyScalar(PORTAL_BOOST);
  flagShared(m); // the renderer disposes v.portal.material only when NOT shared
  swirlMats.set(entering, m);
  return m;
}

function getCoreMat(entering: boolean, lowGfx: boolean): THREE.MeshBasicMaterial {
  const cached = coreMats.get(entering);
  if (cached) return cached;
  const m = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  // a faint wash of the portal colour so the core is not a pure-white dot
  m.color.lerp(new THREE.Color(entering ? ENTER_TINT : EXIT_TINT), 0.25);
  if (!lowGfx) m.color.multiplyScalar(PORTAL_BOOST);
  flagShared(m);
  coreMats.set(entering, m);
  return m;
}

/** Build one hub portal: a runed frame around a swirling vortex. The returned
 *  `portal` mesh is the swirl disc, which the renderer spins and pulses each
 *  frame (its per-frame door-portal hook). */
export function buildHubPortal(opts: { entering: boolean; lowGfx: boolean }): HubPortalView {
  const { entering, lowGfx } = opts;
  const tint = entering ? ENTER_TINT : EXIT_TINT;
  const group = new THREE.Group();

  // frame stone + the emissive glow material (both deduped by surfaceMat)
  const stone = surfaceMat({ color: FRAME_STONE, roughness: 0.7, metalness: 0.15 });
  const glow = surfaceMat({
    color: 0x120a1e,
    emissive: tint,
    emissiveIntensity: 1.4,
    roughness: 0.35,
    metalness: 0.2,
  });

  // base plinth + a flat glowing rune ring on the floor around it
  const base = new THREE.Mesh(getBaseGeo(), stone);
  base.position.y = 0.15;
  base.receiveShadow = true;
  group.add(base);
  const floorRing = new THREE.Mesh(getFloorRingGeo(), glow);
  floorRing.rotation.x = Math.PI / 2;
  floorRing.position.y = 0.08;
  group.add(floorRing);

  // a slim frame: two side posts + a top lintel (not a heavy dungeon arch)
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(getPostGeo(), stone);
    post.position.set(sx * 1.95, 2.25, 0);
    post.castShadow = true;
    group.add(post);
  }
  const lintel = new THREE.Mesh(getLintelGeo(), stone);
  lintel.position.set(0, 4.55, 0);
  lintel.castShadow = true;
  group.add(lintel);

  // the glowing portal rim (a vertical ring facing +z)
  const rim = new THREE.Mesh(getRingGeo(), glow);
  rim.position.y = 2.25;
  group.add(rim);

  // the swirling vortex disc (kept circular so the per-frame spin reads clean)
  const portal = new THREE.Mesh(getDiscGeo(), getSwirlMat(entering, lowGfx));
  portal.position.set(0, 2.25, -0.03);
  group.add(portal);

  // a bright core at the vortex centre
  const core = new THREE.Mesh(getCoreGeo(), getCoreMat(entering, lowGfx));
  core.position.set(0, 2.25, 0.02);
  group.add(core);

  return { group, portal, height: 4.9 };
}
