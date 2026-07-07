// The Gauntlet venue renderer: builds the whole six-trial event complex at a
// gauntlet instance slot (src/sim/data.ts gauntletOrigin). Every anchor comes
// from src/sim/content/gauntlet.ts (GAUNTLET_LAYOUT + GAUNTLET_VENUE), so when
// a later release phase ships a trial its gameplay lands exactly where the map
// already is.
//
// LOOK: an ominous stone festival ground. A long sand crossing field walled by
// grandstands and pennant strings, watched from the finish line by the Stone
// Warden, a monolithic hooded effigy whose eyes and the paired signal pylons
// burn green on a green light and red on a red light (the head turns away on
// green and snaps back on red, easing over the telegraph time). Behind the
// start line: the staging plaza with its ceremonial arch, the three-step
// podium, and the spectators' deck. West of the field, the five sealed arenas
// of the future trials (etching pavilion, rope trench, wager courtyard, the
// raised brittle span, the champions' ring), each barred until its trial
// ships. Everything is procedural geometry + canvas textures except a handful
// of CC0 GLB set pieces (banners, torches, pillars, arches), which are
// measured at build time and normalized to a target height so kit scale never
// surprises us.
//
// The venue is STATIC dressing: built once per slot on approach (the hodrics
// idiom, no teardown), with a tiny per-frame update for the light-reactive
// bits. It reads the viewer's own run view (IWorld gauntletRun) only; when no
// run is live the Warden idles and the lamps hold a low amber.

import * as THREE from 'three';
import { GAUNTLET, GAUNTLET_LAYOUT, GAUNTLET_VENUE, sigilRingAngle } from '../sim/content/gauntlet';
import { sigilOutline } from '../sim/gauntlet/sigil_shapes';
import type { GauntletRunView } from '../sim/types';
import { loadGltf } from './assets/loader';
import { registerPreload } from './assets/preload';
import { surfaceMat } from './gfx';
import { freezeStaticMatrices } from './static_matrix';

// ---------------------------------------------------------------------------
// GLB set pieces (all already-bundled CC0 kits; see CREDITS.md).
// ---------------------------------------------------------------------------

const VENUE_MODELS = {
  torchLit: 'models/dungeon/torch_lit.glb',
  pillar: 'models/dungeon/pillar_decorated.glb',
  archGate: 'models/dungeon/arch_gate.glb',
  bannerPurple: 'models/dungeon/banner_patterna_blue.glb',
  bannerRed: 'models/dungeon/banner_patterna_red.glb',
  bannerWhite: 'models/dungeon/banner_patterna_white.glb',
  bannerGreen: 'models/dungeon/banner_patterna_green.glb',
  bannerYellow: 'models/dungeon/banner_patterna_yellow.glb',
} as const;

type VenueModelKey = keyof typeof VENUE_MODELS;

const modelCache = new Map<VenueModelKey, THREE.Object3D>();
const modelHeight = new Map<VenueModelKey, number>();
let assetsPromise: Promise<void> | null = null;

export function ensureGauntletVenueAssets(): Promise<void> {
  assetsPromise ??= Promise.all(
    (Object.keys(VENUE_MODELS) as VenueModelKey[]).map((key) =>
      loadGltf(VENUE_MODELS[key]).then((gltf) => {
        modelCache.set(key, gltf.scene);
        const box = new THREE.Box3().setFromObject(gltf.scene);
        modelHeight.set(key, Math.max(0.001, box.max.y - box.min.y));
      }),
    ),
  ).then(() => undefined);
  return assetsPromise;
}

if (typeof window !== 'undefined') registerPreload(ensureGauntletVenueAssets());

// Clone a cached set piece scaled so its bounding height equals targetH yards
// (kit pieces ship at whatever scale their pack chose; measuring beats
// guessing). Marked sharedGeometry so dispose() leaves the source alone.
function placeProp(
  group: THREE.Group,
  key: VenueModelKey,
  x: number,
  y: number,
  z: number,
  rotY: number,
  targetH: number,
): THREE.Object3D {
  const src = modelCache.get(key);
  if (!src) throw new Error(`gauntlet venue asset not preloaded: ${key}`);
  const obj = src.clone(true);
  obj.userData.sharedGeometry = true;
  obj.scale.setScalar(targetH / (modelHeight.get(key) ?? 1));
  obj.position.set(x, y, z);
  obj.rotation.y = rotY;
  obj.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  group.add(obj);
  return obj;
}

// ---------------------------------------------------------------------------
// Palette: weathered stone and sand under event dressing in the recruiter's
// purple and gold. Signal colors match the HUD light banners.
// ---------------------------------------------------------------------------

const STONE = 0x8d99ae;
const STONE_DARK = 0x5c6470;
const SAND_EDGE = 0xb9a67e;
const WOOD = 0x8a6a48;
const GOLD = 0xd9a53c;
const SILVER = 0xc9d1dc;
const BRONZE = 0xb0793a;
const PURPLE = 0x9b59b6;
const GREEN_LIGHT = 0x3fd98a;
const RED_LIGHT = 0xe8344a;
const IDLE_AMBER = 0xd9a53c;
const PIT_DARK = 0x14161c;
const GLASS_TINT = 0xbfe3ef;

function stoneMat(color: number, opts: { map?: THREE.Texture } = {}) {
  return surfaceMat({ color, map: opts.map, roughness: 0.9 });
}

// ---------------------------------------------------------------------------
// Procedural canvas textures (module-local deterministic rnd, the textures.ts
// convention: no Math.random).
// ---------------------------------------------------------------------------

let rndState = 0x9e3779b9;
function rnd(): number {
  rndState = (rndState + 0x6d2b79f5) | 0;
  let t = Math.imul(rndState ^ (rndState >>> 15), 1 | rndState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const texCache = new Map<string, THREE.CanvasTexture>();

function canvasTex(
  key: string,
  draw: (ctx: CanvasRenderingContext2D) => void,
): THREE.CanvasTexture {
  const cached = texCache.get(key);
  if (cached) return cached;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  draw(ctx);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, tex);
  return tex;
}

// Raked event sand: warm base, speckle, faint drag lines along z.
function sandTex(): THREE.CanvasTexture {
  return canvasTex('sand', (ctx) => {
    ctx.fillStyle = '#d8c49a';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = rnd() < 0.5 ? 'rgba(120,100,64,0.16)' : 'rgba(246,236,206,0.18)';
      ctx.fillRect(rnd() * 256, rnd() * 256, 1.6, 1.6);
    }
    ctx.strokeStyle = 'rgba(120,100,64,0.10)';
    for (let x = 8; x < 256; x += 16) {
      ctx.beginPath();
      ctx.moveTo(x + rnd() * 3, 0);
      ctx.lineTo(x + rnd() * 3, 256);
      ctx.stroke();
    }
  });
}

// Flagstone paving for the staging plaza and walkways.
function paveTex(): THREE.CanvasTexture {
  return canvasTex('pave', (ctx) => {
    ctx.fillStyle = '#7d8798';
    ctx.fillRect(0, 0, 256, 256);
    const step = 42;
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 7; col++) {
        const off = row % 2 === 0 ? 0 : step / 2;
        const g = 118 + Math.floor(rnd() * 26);
        ctx.fillStyle = `rgb(${g},${g + 8},${g + 20})`;
        ctx.fillRect(col * step + off + 2, row * step + 2, step - 4, step - 4);
      }
    }
  });
}

// The sigil pavilion floor: a slate disc with pale etched arcs.
function runeTex(): THREE.CanvasTexture {
  return canvasTex('rune', (ctx) => {
    ctx.fillStyle = '#2b3140';
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = 'rgba(168,222,238,0.55)';
    ctx.lineWidth = 3;
    for (let ring = 0; ring < 3; ring++) {
      ctx.beginPath();
      ctx.arc(128, 128, 40 + ring * 32, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (let i = 0; i < 14; i++) {
      const a0 = rnd() * Math.PI * 2;
      const r0 = 30 + rnd() * 80;
      ctx.beginPath();
      ctx.arc(128, 128, r0, a0, a0 + 0.5 + rnd());
      ctx.stroke();
    }
  });
}

// Event cloth: purple field, gold trim bands, a pale diamond sigil.
function clothTex(): THREE.CanvasTexture {
  return canvasTex('cloth', (ctx) => {
    ctx.fillStyle = '#7d4699';
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = '#d9a53c';
    ctx.fillRect(0, 0, 256, 18);
    ctx.fillRect(0, 238, 256, 18);
    ctx.fillStyle = '#e8d9f2';
    ctx.beginPath();
    ctx.moveTo(128, 78);
    ctx.lineTo(178, 128);
    ctx.lineTo(128, 178);
    ctx.lineTo(78, 128);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#7d4699';
    ctx.beginPath();
    ctx.moveTo(128, 102);
    ctx.lineTo(154, 128);
    ctx.lineTo(128, 154);
    ctx.lineTo(102, 128);
    ctx.closePath();
    ctx.fill();
  });
}

// ---------------------------------------------------------------------------
// Small builders. Everything is instance-local; the group carries the origin.
// ---------------------------------------------------------------------------

function box(
  group: THREE.Group,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  mat: THREE.Material,
  rotY = 0,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.y = rotY;
  m.castShadow = true;
  m.receiveShadow = true;
  group.add(m);
  return m;
}

function groundPlane(
  group: THREE.Group,
  w: number,
  d: number,
  x: number,
  y: number,
  z: number,
  mat: THREE.Material,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  m.receiveShadow = true;
  group.add(m);
  return m;
}

// A freestanding event banner: a slim pole with a hanging cloth quad.
function bannerPole(group: THREE.Group, x: number, z: number, rotY: number, mat: THREE.Material) {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 6.4, 6), stoneMat(STONE_DARK));
  pole.position.set(x, 3.2, z);
  pole.castShadow = true;
  group.add(pole);
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 3.4), mat);
  cloth.position.set(x, 4.4, z);
  cloth.rotation.y = rotY;
  group.add(cloth);
}

// A stone fire bowl on a fluted foot; the coal core glows via the lamp
// material so braziers breathe with the signal light too.
function brazier(group: THREE.Group, x: number, z: number, lampMat: THREE.MeshStandardMaterial) {
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.72, 1.1, 8), stoneMat(STONE_DARK));
  foot.position.set(x, 0.55, z);
  foot.castShadow = true;
  group.add(foot);
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.55, 0.6, 8), stoneMat(STONE));
  bowl.position.set(x, 1.35, z);
  bowl.castShadow = true;
  group.add(bowl);
  const coals = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), lampMat);
  coals.scale.y = 0.5;
  coals.position.set(x, 1.62, z);
  group.add(coals);
}

interface PennantSpan {
  x0: number;
  x1: number;
  y: number;
  z: number;
}

// Instanced triangle pennants strung between posts (the hodrics idiom).
function buildPennants(group: THREE.Group, spans: PennantSpan[]): THREE.InstancedMesh | null {
  const flagsPerSpan = spans.map((s) => Math.floor(Math.abs(s.x1 - s.x0) / 2.1));
  const total = flagsPerSpan.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0, -1.1, 0], 3),
  );
  geo.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  const inst = new THREE.InstancedMesh(geo, mat, total);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const color = new THREE.Color();
  const palette = [PURPLE, GOLD, SILVER];
  let i = 0;
  for (let s = 0; s < spans.length; s++) {
    const span = spans[s];
    for (let k = 0; k < flagsPerSpan[s]; k++) {
      const f = (k + 0.5) / flagsPerSpan[s];
      const sag = Math.sin(f * Math.PI) * 0.6;
      m.compose(new THREE.Vector3(span.x0 + (span.x1 - span.x0) * f, span.y - sag, span.z), q, one);
      inst.setMatrixAt(i, m);
      inst.setColorAt(i, color.setHex(palette[i % palette.length]));
      i++;
    }
  }
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  group.add(inst);
  return inst;
}

// The backdrop sky: a vertical dusk gradient, deep violet down to an amber
// horizon (the renderer's 'gauntlet' fog state hides the HDRI sky out here, so
// this dome IS the sky).
function duskTex(): THREE.CanvasTexture {
  return canvasTex('dusk', (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#241d38');
    g.addColorStop(0.45, '#553a5e');
    g.addColorStop(0.78, '#a06a52');
    g.addColorStop(1, '#dbA46a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    // a scatter of early stars in the upper third
    ctx.fillStyle = 'rgba(255,244,214,0.8)';
    for (let i = 0; i < 90; i++) {
      const y = rnd() * 90;
      ctx.globalAlpha = 0.25 + rnd() * 0.6;
      ctx.fillRect(rnd() * 256, y, 1.2, 1.2);
    }
    ctx.globalAlpha = 1;
  });
}

// The cached canvas textures are shared; consumers that need their own tiling
// clone one (clones share the underlying image, so this is cheap).
function texWithRepeat(tex: THREE.CanvasTexture, rx: number, ry: number): THREE.Texture {
  const t = tex.clone();
  t.repeat.set(rx, ry);
  t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------------------
// The stages of the venue.
// ---------------------------------------------------------------------------

// Stage 1, Sentinel's Crossing: the trial field, its lines, the grandstands,
// the signal pylons, and the Stone Warden past the finish line.
interface WardenRig {
  headGroup: THREE.Group;
  lampMat: THREE.MeshStandardMaterial;
  eyeMat: THREE.MeshStandardMaterial;
}

function buildField(group: THREE.Group): WardenRig {
  const L = GAUNTLET.sentinel.fieldLength;
  const halfW = GAUNTLET.sentinel.fieldHalfWidth;
  const V = GAUNTLET_VENUE;

  // The field proper: a brighter raked strip with start and finish lines.
  const field = texWithRepeat(sandTex(), 6, 14);
  groundPlane(
    group,
    halfW * 2 + 6,
    L + 12,
    0,
    0.03,
    L / 2,
    surfaceMat({ color: 0xe4d2a4, map: field, roughness: 0.95 }),
  );
  const lineMat = surfaceMat({ color: 0xf6f1e4, roughness: 0.8 });
  box(group, halfW * 2 + 4, 0.06, 0.7, 0, 0.05, 0, lineMat);
  box(group, halfW * 2 + 4, 0.06, 0.7, 0, 0.05, L, lineMat);

  // Low kerb walls seat the field into the apron on both sides.
  const kerbMat = stoneMat(SAND_EDGE);
  box(group, 0.8, 0.5, L + 12, -(halfW + 3.4), 0.25, L / 2, kerbMat);
  box(group, 0.8, 0.5, L + 12, halfW + 3.4, 0.25, L / 2, kerbMat);

  // Grandstands: three stepped tiers behind each kerb, a back wall, banner
  // posts, and pennant strings along the top. The east side splits into two
  // segments around the spectators' terrace (knocked-out players park at
  // GAUNTLET_LAYOUT.spectator*, and the terrace must be under their feet).
  const standMat = stoneMat(STONE, { map: texWithRepeat(paveTex(), 1, 8) as THREE.CanvasTexture });
  const spans: PennantSpan[] = [];
  const deckZ0 = GAUNTLET_LAYOUT.spectatorZ - 12;
  const deckZ1 = GAUNTLET_LAYOUT.spectatorZ + 12;
  const segments: Array<[number, number, number]> = [
    [-1, V.standZMin, V.standZMax],
    [1, V.standZMin, deckZ0],
    [1, deckZ1, V.standZMax],
  ];
  for (const [side, z0, z1] of segments) {
    const len = z1 - z0;
    const mid = (z0 + z1) / 2;
    for (let tier = 0; tier < 3; tier++) {
      box(
        group,
        3.4,
        0.9 + tier * 0.9,
        len,
        side * (V.standX + 1.7 + tier * 3.4),
        (0.9 + tier * 0.9) / 2,
        mid,
        standMat,
      );
    }
    box(group, 1, 5.4, len, side * (V.standX + 11.4), 2.7, mid, stoneMat(STONE_DARK));
    for (let z = z0 + 2; z <= z1 - 2; z += 15.5) {
      placeProp(group, 'pillar', side * (V.standX + 10.6), 0, z, 0, 5.6);
      placeProp(
        group,
        side < 0 ? 'bannerPurple' : 'bannerRed',
        side * (V.standX + 10.9),
        3.6,
        Math.min(z + 7.7, z1 - 2),
        side < 0 ? Math.PI / 2 : -Math.PI / 2,
        2.4,
      );
    }
    spans.push({ x0: side * (V.standX + 1), x1: side * (V.standX + 11), y: 6.6, z: z0 });
    spans.push({ x0: side * (V.standX + 1), x1: side * (V.standX + 11), y: 6.6, z: z1 });
  }
  // A string across the start and the finish carries the festival into the field.
  spans.push({ x0: -halfW - 2, x1: halfW + 2, y: 7.4, z: -2 });
  spans.push({ x0: -halfW - 2, x1: halfW + 2, y: 7.4, z: L + 2 });
  buildPennants(group, spans);

  // Torches pace the kerbs.
  for (let z = 6; z < L; z += 21) {
    placeProp(group, 'torchLit', -(halfW + 2.6), 0, z, Math.PI / 2, 2.2);
    placeProp(group, 'torchLit', halfW + 2.6, 0, z, -Math.PI / 2, 2.2);
  }

  // Dynamic-signal materials: OWN instances (never surfaceMat: its cache
  // dedupes by options, and recoloring a shared material would repaint every
  // consumer). Disposed with the venue.
  const lampMat = new THREE.MeshStandardMaterial({
    color: 0x2a2d36,
    emissive: IDLE_AMBER,
    emissiveIntensity: 0.7,
    roughness: 0.4,
  });
  const eyeMat = new THREE.MeshStandardMaterial({
    color: 0x11131a,
    emissive: IDLE_AMBER,
    emissiveIntensity: 1.4,
    roughness: 0.25,
  });

  // Signal pylons flank the finish line.
  for (const side of [-1, 1]) {
    const px = side * (halfW - 2);
    box(group, 1.6, 1.2, 1.6, px, 0.6, L + 3, stoneMat(STONE_DARK));
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 7.4, 8), stoneMat(STONE));
    post.position.set(px, 4.3, L + 3);
    post.castShadow = true;
    group.add(post);
    const cage = new THREE.Mesh(new THREE.SphereGeometry(0.95, 12, 10), lampMat);
    cage.position.set(px, 8.4, L + 3);
    group.add(cage);
  }

  // The Stone Warden: pedestal, robed monolith, hooded head. The body faces
  // the field forever; only the head turns. Eyes sit on the head's local +z
  // face, and the whole warden group is yawed PI so +z looks back down the
  // field toward the start line.
  const wz = L + GAUNTLET_LAYOUT.watcherMargin + 4;
  const warden = new THREE.Group();
  warden.position.set(0, 0, wz);
  warden.rotation.y = Math.PI;
  const ped = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 5.4, 1.6, 10), stoneMat(STONE_DARK));
  ped.position.y = 0.8;
  ped.castShadow = true;
  ped.receiveShadow = true;
  warden.add(ped);
  const robe = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 3.6, 8.4, 10), stoneMat(STONE));
  robe.position.y = 5.8;
  robe.castShadow = true;
  warden.add(robe);
  for (const side of [-1, 1]) {
    const pauldron = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.4, 2.6), stoneMat(STONE_DARK));
    pauldron.position.set(side * 2.1, 9.4, 0);
    pauldron.rotation.z = side * -0.28;
    pauldron.castShadow = true;
    warden.add(pauldron);
  }
  const headGroup = new THREE.Group();
  headGroup.position.y = 11.2;
  const head = new THREE.Mesh(new THREE.BoxGeometry(2.3, 2.7, 2.3), stoneMat(STONE));
  head.castShadow = true;
  headGroup.add(head);
  const hood = new THREE.Mesh(new THREE.ConeGeometry(1.9, 2.6, 8), stoneMat(STONE_DARK));
  hood.position.set(0, 1.6, -0.4);
  hood.castShadow = true;
  headGroup.add(hood);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), eyeMat);
    eye.position.set(side * 0.55, 0.25, 1.18);
    headGroup.add(eye);
  }
  warden.add(headGroup);
  group.add(warden);

  // Braziers ring the warden's pedestal.
  brazier(group, -7, wz - 1, lampMat);
  brazier(group, 7, wz - 1, lampMat);

  return { headGroup, lampMat, eyeMat };
}

// Stage: the staging plaza and its ceremonial arch onto the field.
function buildStaging(group: THREE.Group) {
  groundPlane(
    group,
    GAUNTLET_LAYOUT.stagingHalfWidth * 2 + 8,
    16,
    0,
    0.02,
    GAUNTLET_LAYOUT.stagingZ,
    surfaceMat({ color: 0xaab2c0, map: texWithRepeat(paveTex(), 6, 4), roughness: 0.9 }),
  );
  placeProp(group, 'archGate', 0, 0, -2.4, 0, 7.5);
  const cloth = surfaceMat({ color: 0xffffff, map: clothTex(), roughness: 0.85 });
  for (const side of [-1, 1]) {
    bannerPole(
      group,
      side * (GAUNTLET_LAYOUT.stagingHalfWidth + 2.5),
      GAUNTLET_LAYOUT.stagingZ - 4,
      0,
      cloth,
    );
    placeProp(group, 'torchLit', side * 5.2, 0, -2.2, side > 0 ? -Math.PI / 2 : Math.PI / 2, 2.2);
  }
}

// Stage: the podium, three steps behind the plaza.
function buildPodium(group: THREE.Group, lampMat: THREE.MeshStandardMaterial) {
  const z = GAUNTLET_LAYOUT.podiumZ - 4;
  const base = stoneMat(STONE_DARK);
  box(group, 12, 0.5, 6, 0, 0.25, z, base);
  box(group, 3.2, 1.5, 3.2, 0, 1.25, z, stoneMat(GOLD));
  box(group, 3.2, 1.0, 3.2, -3.6, 1.0, z, stoneMat(SILVER));
  box(group, 3.2, 0.7, 3.2, 3.6, 0.85, z, stoneMat(BRONZE));
  const cloth = surfaceMat({ color: 0xffffff, map: clothTex(), roughness: 0.85 });
  bannerPole(group, -5.4, z - 3.4, 0, cloth);
  bannerPole(group, 5.4, z - 3.4, 0, cloth);
  brazier(group, -5.4, z + 2.6, lampMat);
  brazier(group, 5.4, z + 2.6, lampMat);
}

// Stage: the spectators' terrace, sunk into the gap in the east grandstand.
// Knocked-out players park at (spectatorX, spectatorZ), so the boards sit
// exactly under their feet and the rail faces the field they just left.
function buildSpectatorDeck(group: THREE.Group) {
  const x = GAUNTLET_LAYOUT.spectatorX + 4;
  const z = GAUNTLET_LAYOUT.spectatorZ;
  const wood = surfaceMat({ color: WOOD, roughness: 0.9 });
  groundPlane(group, 16, 22, x, 0.04, z, wood);
  const railMat = stoneMat(STONE_DARK);
  const railX = x - 7.6;
  for (let dz = -10; dz <= 10; dz += 2.5) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.2, 6), railMat);
    post.position.set(railX, 0.6, z + dz);
    group.add(post);
  }
  const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 21.5, 6), railMat);
  rail.rotation.x = Math.PI / 2;
  rail.position.set(railX, 1.2, z);
  group.add(rail);
  box(group, 1.2, 0.45, 8, x + 5, 0.55, z - 6, wood);
  box(group, 1.2, 0.45, 8, x + 5, 0.55, z + 6, wood);
  placeProp(group, 'torchLit', x, 0, z - 10.4, Math.PI, 2.2);
  placeProp(group, 'torchLit', x, 0, z + 10.4, 0, 2.2);
}

// Stages 2 through 6: the five trial arenas. The span and the sigil pavilion
// return live rigs (span panels tint with the shared reveals; the sigil slab
// carries the etched outline the player traces); the rest is static dressing.
interface SpanRig {
  panels: { left: THREE.Mesh; right: THREE.Mesh }[];
  unknownMat: THREE.Material;
  safeMat: THREE.Material;
  brittleMat: THREE.Material;
}

// The etched lectern slab: the sigils trial's input surface. World-space rect
// (center + HALF-extent u/v vectors of the interaction square on the face),
// the outline tube segments rebuilt per shape, the crack-tinted face material,
// and the cursor mote + freedraw stroke trail fed from the hud's stroke glue.
interface SigilRig {
  rect: {
    center: { x: number; y: number; z: number };
    u: { x: number; y: number; z: number };
    v: { x: number; y: number; z: number };
  };
  faceMat: THREE.MeshStandardMaterial;
  tracedMat: THREE.Material;
  paleMat: THREE.Material;
  thinMat: THREE.Material;
  outlineGroup: THREE.Group;
  segs: THREE.Mesh[];
  segThin: boolean[];
  mote: THREE.Mesh;
  // The player's own stroke on the slab: a preallocated FIFO line trail (the
  // mote is the tip). Written on stroke events only, never per frame.
  stroke: THREE.Line;
  strokePos: THREE.BufferAttribute;
  strokeLen: number;
  faceCenter: THREE.Vector3; // instance-local face center
  uDir: THREE.Vector3; // unit, down-slope (the etching's y axis)
  vDir: THREE.Vector3; // unit, across the face (the etching's x axis)
  normal: THREE.Vector3;
}

// The Great Pull rig: the rope IS the meter. Both teams stand ON the rope
// (the sim seats and drags them), so the whole hand-height rope translates
// with the ABSOLUTE wire marker (+ = team 0 winning = hauled toward -x), the
// judge's knot marking its center, and the beat drum by the pit pulses on the
// sim metronome (a steady glow during the opening brace window).
interface PullRig {
  knot: THREE.Group;
  rope: THREE.Mesh;
  drum: THREE.Group;
  drumSkinMat: THREE.MeshStandardMaterial;
  maxOffset: number; // rope travel from center to a threshold stake
  centerX: number;
  centerZ: number;
}

// Keeper's Wager table rig: an instanced marble pool split into the two purse
// piles (driven by the viewer's own wire counts), the floating odd/even choice
// stones (guess rounds), and the five held pebbles (hold rounds). The stones
// and pebbles are the trial's click targets, raycast via pickTargets().
interface WagerRig {
  root: THREE.Group;
  marbles: THREE.InstancedMesh;
  oddStone: THREE.Group;
  evenStone: THREE.Group;
  pebbles: THREE.Mesh[];
  pickList: { id: string; object: THREE.Object3D }[];
  baseZ: number; // the courtyard center row (instance-local)
}

// Rebuild the two marble piles from the viewer's purse counts: the player's
// pile by their west mat, the partner's across the table. Event-driven (counts
// change once per round), never per frame.
const wagerScratchMatrix = new THREE.Matrix4();
function layoutWagerMarbles(rig: WagerRig, mine: number, theirs: number): void {
  const total = Math.min(rig.marbles.instanceMatrix.count, Math.max(0, mine) + Math.max(0, theirs));
  let i = 0;
  const place = (count: number, sideX: number) => {
    for (let k = 0; k < count && i < total; k++, i++) {
      wagerScratchMatrix.makeTranslation(
        sideX + Math.floor(k / 5) * (sideX < 0 ? -0.26 : 0.26),
        0.22,
        -0.6 + (k % 5) * 0.3,
      );
      rig.marbles.setMatrixAt(i, wagerScratchMatrix);
    }
  };
  place(Math.max(0, mine), -2.3);
  place(Math.max(0, theirs), 2.3);
  rig.marbles.count = i;
  rig.marbles.instanceMatrix.needsUpdate = true;
}

// The drum's flash length at each beat, seconds.
const DRUM_FLASH_S = 0.12;

// Positive modulo so the beat phase stays in [0, period) even if the render
// clock briefly reads just before the beat anchor.
const posMod = (a: number, b: number): number => ((a % b) + b) % b;

// Outline tint granularity: the polyline is grouped into this many tube
// segments, tinted gold per the wire's coveredMask bits (one bit per segment;
// freedraw is order-free, so segments light wherever the stroke has carved).
const SIGIL_SEGMENTS = 24;
// The freedraw stroke trail's FIFO capacity (points).
const SIGIL_TRAIL_MAX = 64;

// One lectern: a stone stand on the dais with the angled sugarglass slab.
// Returns the slab mesh (the interactive one carries the crack-tinted face
// material; the cosmetic ring copies share a cached material).
function buildLectern(
  parent: THREE.Group,
  x: number,
  z: number,
  yaw: number,
  faceMat: THREE.Material,
): THREE.Mesh {
  const s = GAUNTLET_VENUE.sigils.slab;
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = yaw;
  parent.add(g);
  // The stand tucks slightly up-slope and stays under the tilted face plane
  // so it never pokes through the etching.
  const stand = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.42, 0.9), stoneMat(STONE_DARK));
  stand.position.set(-0.1, 0.5 + 0.21, 0);
  stand.castShadow = true;
  g.add(stand);
  const slab = new THREE.Mesh(new THREE.BoxGeometry(s.faceSlope, s.thick, s.faceAcross), faceMat);
  slab.position.set(0, s.centerY, 0);
  slab.rotation.z = -s.tiltRad; // face normal tilts toward local +x (the approach)
  slab.castShadow = true;
  g.add(slab);
  return slab;
}

function buildSigilPavilion(group: THREE.Group, ox: number, oz: number): SigilRig {
  const { x, z, radius, slab } = GAUNTLET_VENUE.sigils;
  const dais = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius + 0.6, 0.5, 24),
    surfaceMat({ color: 0x39415a, map: runeTex(), roughness: 0.7 }),
  );
  dais.position.set(x, 0.25, z);
  dais.receiveShadow = true;
  group.add(dais);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    placeProp(
      group,
      'pillar',
      x + Math.sin(a) * (radius + 1.6),
      0,
      z + Math.cos(a) * (radius + 1.6),
      a,
      4.8,
    );
  }
  placeProp(group, 'bannerWhite', x, 3.2, z - radius - 1.4, 0, 2.2);

  // The interactive lectern at the pavilion center. Its face material is
  // venue-owned: the crack tint recolors it, and surfaceMat's cache would
  // repaint every consumer of a shared entry.
  const faceMat = new THREE.MeshStandardMaterial({
    color: 0x232b3d,
    roughness: 0.25,
    metalness: 0.05,
    emissive: RED_LIGHT,
    emissiveIntensity: 0,
  });
  const tracedMat = new THREE.MeshStandardMaterial({
    color: 0x4a3a12,
    emissive: GOLD,
    emissiveIntensity: 1.5,
    roughness: 0.4,
  });
  const paleMat = new THREE.MeshStandardMaterial({
    color: 0xd8d3c4,
    emissive: 0xf0ead0,
    emissiveIntensity: 0.35,
    roughness: 0.5,
  });
  const thinMat = new THREE.MeshStandardMaterial({
    color: 0x5a2e28,
    emissive: 0xff6b5e,
    emissiveIntensity: 0.6,
    roughness: 0.5,
  });
  venueOwnedMats.push(faceMat, tracedMat, paleMat, thinMat);
  buildLectern(group, x, z, 0, faceMat);

  // The cosmetic lectern ring the NPC field mans during the trial (plain
  // glass, no etching): stations at the SAME shared angles the sim seats the
  // etchers from, each slab tilted radially outward toward its etcher.
  const cosmeticFace = surfaceMat({ color: 0x2b3450, roughness: 0.3 });
  const { ring } = GAUNTLET_VENUE.sigils;
  for (let i = 0; i < ring.count; i++) {
    const a = sigilRingAngle(i, ring.count);
    buildLectern(
      group,
      x + Math.sin(a) * ring.radius,
      z + Math.cos(a) * ring.radius,
      a - Math.PI / 2,
      cosmeticFace,
    );
  }

  // Face axes (instance-local; the venue group is unrotated, so world = local
  // + origin). The face normal tilts toward +x; uDir runs down-slope toward
  // the approaching player (the etching's y axis, top of the shape up-slope);
  // vDir is the player's RIGHT across the face (the etching's x axis).
  const tilt = slab.tiltRad;
  const normal = new THREE.Vector3(Math.sin(tilt), Math.cos(tilt), 0);
  const uDir = new THREE.Vector3(Math.cos(tilt), -Math.sin(tilt), 0);
  const vDir = new THREE.Vector3(0, 0, -1);
  const faceCenter = new THREE.Vector3(
    x + normal.x * (slab.thick / 2),
    slab.centerY + normal.y * (slab.thick / 2),
    z + normal.z * (slab.thick / 2),
  );
  const rect = {
    center: { x: faceCenter.x + ox, y: faceCenter.y, z: faceCenter.z + oz },
    u: { x: uDir.x * slab.etchHalf, y: uDir.y * slab.etchHalf, z: uDir.z * slab.etchHalf },
    v: { x: vDir.x * slab.etchHalf, y: vDir.y * slab.etchHalf, z: vDir.z * slab.etchHalf },
  };

  const outlineGroup = new THREE.Group();
  group.add(outlineGroup);
  const mote = new THREE.Mesh(
    new THREE.SphereGeometry(0.045, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 2 }),
  );
  venueOwnedMats.push(mote.material as THREE.Material);
  mote.visible = false;
  group.add(mote);

  // The freedraw stroke trail: a fixed-capacity line whose points are written
  // into the preallocated buffer on stroke events (drawRange bounds the live
  // FIFO window); faded out by clearing on stroke end and on a fresh shape.
  const strokePos = new THREE.BufferAttribute(new Float32Array(SIGIL_TRAIL_MAX * 3), 3);
  strokePos.setUsage(THREE.DynamicDrawUsage);
  const strokeGeo = new THREE.BufferGeometry();
  strokeGeo.setAttribute('position', strokePos);
  strokeGeo.setDrawRange(0, 0);
  const strokeMat = new THREE.LineBasicMaterial({
    color: 0xffe9a8,
    transparent: true,
    opacity: 0.9,
  });
  venueOwnedMats.push(strokeMat);
  const stroke = new THREE.Line(strokeGeo, strokeMat);
  stroke.frustumCulled = false;
  stroke.visible = false;
  group.add(stroke);

  return {
    rect,
    faceMat,
    tracedMat,
    paleMat,
    thinMat,
    outlineGroup,
    segs: [],
    segThin: [],
    mote,
    stroke,
    strokePos,
    strokeLen: 0,
    faceCenter,
    uDir,
    vDir,
    normal,
  };
}

// Append the newest stroke point to the trail (FIFO shift once full). Event
// driven: runs per claimed stroke sample, never per frame.
const strokeScratch = new THREE.Vector3();
function pushSigilStrokePoint(rig: SigilRig, u: number, v: number): void {
  const half = GAUNTLET_VENUE.sigils.slab.etchHalf;
  strokeScratch
    .copy(rig.faceCenter)
    .addScaledVector(rig.uDir, (u * 2 - 1) * half)
    .addScaledVector(rig.vDir, (v * 2 - 1) * half)
    .addScaledVector(rig.normal, 0.06);
  const arr = rig.strokePos.array as Float32Array;
  if (rig.strokeLen >= SIGIL_TRAIL_MAX) {
    arr.copyWithin(0, 3);
    rig.strokeLen = SIGIL_TRAIL_MAX - 1;
  }
  arr[rig.strokeLen * 3] = strokeScratch.x;
  arr[rig.strokeLen * 3 + 1] = strokeScratch.y;
  arr[rig.strokeLen * 3 + 2] = strokeScratch.z;
  rig.strokeLen++;
  rig.strokePos.needsUpdate = true;
  rig.stroke.geometry.setDrawRange(0, rig.strokeLen);
  rig.stroke.visible = true;
}

function clearSigilStroke(rig: SigilRig): void {
  if (rig.strokeLen === 0) return;
  rig.strokeLen = 0;
  rig.stroke.geometry.setDrawRange(0, 0);
  rig.stroke.visible = false;
}

function clearSigilOutline(rig: SigilRig): void {
  for (const m of rig.segs) {
    rig.outlineGroup.remove(m);
    m.geometry.dispose();
  }
  rig.segs.length = 0;
  rig.segThin.length = 0;
}

// Rebuild the etched outline for a fresh shape (seed/id change): ~24 tube
// segments along the shared deterministic sigilOutline polyline, mapped onto
// the slab face through the SAME pad inset the trace input uses. Event-driven
// (shape changes on shatter/advance), never per frame.
function rebuildSigilOutline(rig: SigilRig, seed: number, shapeId: number): void {
  clearSigilOutline(rig);
  const slab = GAUNTLET_VENUE.sigils.slab;
  const o = sigilOutline(seed, shapeId, GAUNTLET.sigils.outlinePoints);
  const n = o.xs.length;
  const per = Math.max(1, Math.floor(n / SIGIL_SEGMENTS));
  const inner = 1 - 2 * slab.padFrac;
  const toLocal = (sx: number, sy: number): THREE.Vector3 =>
    new THREE.Vector3()
      .copy(rig.faceCenter)
      .addScaledVector(rig.uDir, ((slab.padFrac + sy * inner) * 2 - 1) * slab.etchHalf)
      .addScaledVector(rig.vDir, ((slab.padFrac + sx * inner) * 2 - 1) * slab.etchHalf)
      .addScaledVector(rig.normal, 0.02);
  for (let s = 0; s < SIGIL_SEGMENTS; s++) {
    const pts: THREE.Vector3[] = [];
    let thin = false;
    for (let k = 0; k <= per; k++) {
      const i = (s * per + k) % n;
      pts.push(toLocal(o.xs[i], o.ys[i]));
      if (o.thin[i]) thin = true;
    }
    // Radius sized so the visible line reads close to the sim's tolerance
    // band rather than suggesting a hairline the scoring never demands.
    const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 6, 0.035, 5, false);
    const mesh = new THREE.Mesh(geo, rig.paleMat);
    rig.outlineGroup.add(mesh);
    rig.segs.push(mesh);
    rig.segThin.push(thin);
  }
}

function buildTrialArenas(
  group: THREE.Group,
  ox: number,
  oz: number,
): {
  spanRig: SpanRig;
  sigilRig: SigilRig;
  pullRig: PullRig;
  wagerRig: WagerRig;
} {
  const V = GAUNTLET_VENUE;

  // Trial 2, Sugarglass Sigils: a rune-floored pavilion ringed by pillars,
  // with the etched lectern slab (the trial's input surface) at its center.
  const sigilRig = buildSigilPavilion(group, ox, oz);

  // Trial 3, The Great Pull: a flat rope lane with a central mud pit. Both
  // teams stand ON the rope (the sim seats and drags them), so the rope is a
  // single hand-height line that translates with the marker, and the losing
  // line ends up dragged onto the pit mouth.
  const pullRig: PullRig = (() => {
    const { x, z, length, width, ropeY, pitHalfX, pitHalfZ, knotTravel } = V.pull;
    // The lane: a packed-sand strip under the whole line.
    groundPlane(
      group,
      length + 14,
      width + 4,
      x,
      0.02,
      z,
      surfaceMat({ color: 0xc7b58c, map: texWithRepeat(sandTex(), 5, 2), roughness: 0.95 }),
    );
    // The pit: a flush dark mouth with a low stone lip.
    groundPlane(
      group,
      pitHalfX * 2,
      pitHalfZ * 2,
      x,
      0.04,
      z,
      surfaceMat({ color: PIT_DARK, roughness: 1 }),
    );
    const lip = stoneMat(STONE_DARK);
    box(group, pitHalfX * 2 + 0.5, 0.14, 0.25, x, 0.07, z - pitHalfZ, lip);
    box(group, pitHalfX * 2 + 0.5, 0.14, 0.25, x, 0.07, z + pitHalfZ, lip);
    box(group, 0.25, 0.14, pitHalfZ * 2, x - pitHalfX, 0.07, z, lip);
    box(group, 0.25, 0.14, pitHalfZ * 2, x + pitHalfX, 0.07, z, lip);
    // The painted center line under the rope, and the threshold stakes.
    const lineMat = surfaceMat({ color: 0xf6f1e4, roughness: 0.8 });
    box(group, 0.3, 0.06, width + 2, x, 0.05, z, lineMat);
    const maxOffset = knotTravel;
    const stakeMat = surfaceMat({ color: RED_LIGHT, roughness: 0.6 });
    for (const side of [-1, 1]) {
      const stake = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 1.4, 6), stakeMat);
      stake.position.set(x + side * maxOffset, 0.7, z + pitHalfZ + 1.4);
      stake.castShadow = true;
      group.add(stake);
    }
    // The rope: one hand-height line the teams hold; it slides through the
    // pit rather than stretching, translated per frame with the marker.
    const ropeMat = surfaceMat({ color: 0xa8895e, roughness: 1 });
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, length, 6), ropeMat);
    rope.rotation.z = Math.PI / 2;
    rope.position.set(x, ropeY, z);
    rope.castShadow = true;
    group.add(rope);
    // The knot: a wrapped coil with the judge's red streamer hanging under it,
    // riding the rope's center.
    const knot = new THREE.Group();
    const coil = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 10, 8),
      surfaceMat({ color: 0x8a6a42, roughness: 1 }),
    );
    knot.add(coil);
    const streamer = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.55, 0.28), stakeMat);
    streamer.position.y = -0.42;
    knot.add(streamer);
    knot.position.set(x, ropeY, z);
    group.add(knot);
    // The beat drum south of the pit: wooden shell, glowing skin.
    const drum = new THREE.Group();
    drum.position.set(x, 0.5, z + pitHalfZ + 2.8);
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.95, 1.1, 12), stoneMat(WOOD));
    shell.position.y = 0.55;
    shell.castShadow = true;
    drum.add(shell);
    const drumSkinMat = new THREE.MeshStandardMaterial({
      color: 0xe8dcc2,
      emissive: GOLD,
      emissiveIntensity: 0.35,
      roughness: 0.7,
    });
    venueOwnedMats.push(drumSkinMat);
    const skin = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 0.82, 0.08, 12), drumSkinMat);
    skin.position.y = 1.14;
    drum.add(skin);
    group.add(drum);
    placeProp(group, 'bannerRed', x, 3.2, z + width / 2 + 1.6, Math.PI, 2.2);
    return { knot, rope, drum, drumSkinMat, maxOffset, centerX: x, centerZ: z };
  })();

  // Trial 4, Keeper's Wager: a walled courtyard with two facing wager mats,
  // plus the live table rig (marble piles, the floating choice stones, the
  // held-pebble row) anchored to the viewer's own duel row.
  const wagerRig: WagerRig = (() => {
    const { x, z, size } = V.wager;
    groundPlane(
      group,
      size,
      size,
      x,
      0.02,
      z,
      surfaceMat({ color: 0x9aa2b2, map: texWithRepeat(paveTex(), 3, 3), roughness: 0.9 }),
    );
    const wall = stoneMat(STONE_DARK);
    box(group, size, 1.6, 0.7, x, 0.8, z - size / 2, wall);
    box(group, size, 1.6, 0.7, x, 0.8, z + size / 2, wall);
    box(group, 0.7, 1.6, size, x - size / 2, 0.8, z, wall);
    const matA = box(
      group,
      2.6,
      0.12,
      2.6,
      x - 3.2,
      0.12,
      z,
      surfaceMat({ color: PURPLE, roughness: 0.9 }),
    );
    matA.rotation.y = Math.PI / 4;
    const matB = box(
      group,
      2.6,
      0.12,
      2.6,
      x + 3.2,
      0.12,
      z,
      surfaceMat({ color: GOLD, roughness: 0.9 }),
    );
    matB.rotation.y = Math.PI / 4;
    placeProp(group, 'bannerGreen', x, 3.2, z + size / 2 - 0.4, Math.PI, 2.2);

    // The live rig, all children local to a root the update loop re-anchors to
    // the viewer's duel row when their trial opens.
    const root = new THREE.Group();
    root.position.set(x, 0, z);
    group.add(root);
    const marbleMat = surfaceMat({ color: GLASS_TINT, roughness: 0.25 });
    const marbles = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.09, 8, 6),
      marbleMat,
      GAUNTLET.wager.startingMarbles * 2,
    );
    marbles.count = 0;
    root.add(marbles);
    // Choice stones for a guess round: dark orbs floating over the table, one
    // dot for odd, two for even (procedural emboss, no text mesh).
    const stoneMatDark = surfaceMat({ color: 0x2a3040, roughness: 0.35 });
    const dotMat = new THREE.MeshStandardMaterial({
      color: 0xf3ead2,
      emissive: 0xf3ead2,
      emissiveIntensity: 0.9,
      roughness: 0.4,
    });
    venueOwnedMats.push(dotMat);
    const makeStone = (sx: number, dots: number): THREE.Group => {
      const g2 = new THREE.Group();
      g2.position.set(sx, 1.35, 0);
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), stoneMatDark);
      g2.add(orb);
      for (let d = 0; d < dots; d++) {
        const dot = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), dotMat);
        dot.position.set(-0.24, dots === 1 ? 0 : d === 0 ? 0.11 : -0.11, 0);
        g2.add(dot);
      }
      g2.visible = false;
      root.add(g2);
      return g2;
    };
    const oddStone = makeStone(-0.9, 1);
    const evenStone = makeStone(0.9, 2);
    // The hold row: five pebbles lined on the viewer's edge of the table.
    const pebbleMat = surfaceMat({ color: 0xcfc4a4, roughness: 0.8 });
    const pebbles: THREE.Mesh[] = [];
    for (let k = 0; k < 5; k++) {
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), pebbleMat);
      p.position.set(-2, 0.3, -1.2 + k * 0.6);
      p.visible = false;
      root.add(p);
      pebbles.push(p);
    }
    const pickList = [
      { id: 'wager:odd', object: oddStone as THREE.Object3D },
      { id: 'wager:even', object: evenStone as THREE.Object3D },
      ...pebbles.map((p, k) => ({ id: `wager:hold:${k + 1}`, object: p as THREE.Object3D })),
    ];
    return { root, marbles, oddStone, evenStone, pebbles, pickList, baseZ: z };
  })();

  // Trial 5, The Brittle Span: paired panels over a dark pit, at ground level
  // and at EXACTLY the sim's panel rects (trial_span.ts step detection reads
  // the same GAUNTLET.span numbers), so what shatters is what you stood on.
  const spanRig: SpanRig = (() => {
    const { x, z } = V.span;
    const t = GAUNTLET.span;
    const fieldLen = t.steps * t.panelLength;
    const zStart = z - fieldLen / 2;
    const sideX = t.panelGap / 2 + t.panelWidth / 2;
    box(group, (sideX + t.panelWidth) * 2 + 4, 0.5, fieldLen + 8, x, 0.18, z, stoneMat(SAND_EDGE));
    box(
      group,
      (sideX + t.panelWidth) * 2 + 1.5,
      0.2,
      fieldLen + 5,
      x,
      0.35,
      z,
      surfaceMat({ color: PIT_DARK, roughness: 1 }),
    );
    const unknownMat = new THREE.MeshStandardMaterial({
      color: GLASS_TINT,
      transparent: true,
      opacity: 0.4,
      roughness: 0.15,
      metalness: 0,
    });
    const safeMat = new THREE.MeshStandardMaterial({
      color: 0x9fe6c8,
      transparent: true,
      opacity: 0.85,
      roughness: 0.35,
      metalness: 0,
    });
    const brittleMat = new THREE.MeshStandardMaterial({
      color: 0x232833,
      transparent: true,
      opacity: 0.55,
      roughness: 0.9,
      metalness: 0,
    });
    venueOwnedMats.push(unknownMat, safeMat, brittleMat);
    const panels: { left: THREE.Mesh; right: THREE.Mesh }[] = [];
    const geo = new THREE.BoxGeometry(t.panelWidth, 0.12, t.panelLength - 0.15);
    for (let i = 0; i < t.steps; i++) {
      const pz = zStart + (i + 0.5) * t.panelLength;
      const left = new THREE.Mesh(geo, unknownMat);
      left.position.set(x - sideX, 0.52, pz);
      group.add(left);
      const right = new THREE.Mesh(geo, unknownMat);
      right.position.set(x + sideX, 0.52, pz);
      group.add(right);
      panels.push({ left, right });
    }
    placeProp(group, 'bannerWhite', x, 3.4, z - fieldLen / 2 - 3, 0, 2.4);
    placeProp(group, 'torchLit', x - sideX - 2.4, 0, zStart - 1.5, Math.PI / 2, 2.2);
    placeProp(group, 'torchLit', x + sideX + 2.4, 0, zStart - 1.5, -Math.PI / 2, 2.2);
    // Walk-on ramps at both crossing ends: the sim's ground skirt raises a
    // mover onto the deck over the same run, so what you climb is what you
    // see (venue_physics shares these numbers).
    const rampMat = stoneMat(SAND_EDGE);
    for (const side of [-1, 1]) {
      const ramp = new THREE.Mesh(
        new THREE.BoxGeometry(sideX * 2 + t.panelWidth + 0.8, 0.08, 1.08),
        rampMat,
      );
      ramp.position.set(x, 0.29, z + side * (fieldLen / 2 + 0.45));
      ramp.rotation.x = side * 0.57;
      ramp.castShadow = true;
      ramp.receiveShadow = true;
      group.add(ramp);
    }
    return { panels, unknownMat, safeMat, brittleMat };
  })();

  // Trial 6, The Final Court: the duel lane (trial_court.ts geometry: entry
  // line at -courtLength/2, neck line, head zone at the far end), painted like
  // the crossing field.
  {
    const { x, z } = V.court;
    const c = GAUNTLET.court;
    const z0 = z - c.courtLength / 2;
    groundPlane(
      group,
      c.courtHalfWidth * 2 + 4,
      c.courtLength + 6,
      x,
      0.03,
      z,
      surfaceMat({ color: 0xc7b58c, map: texWithRepeat(sandTex(), 3, 5), roughness: 0.95 }),
    );
    const lineMat = surfaceMat({ color: 0xf6f1e4, roughness: 0.8 });
    for (const side of [-1, 1]) {
      box(group, 0.35, 0.06, c.courtLength, x + side * c.courtHalfWidth, 0.06, z, lineMat);
    }
    box(group, c.courtHalfWidth * 2, 0.06, 0.35, x, 0.06, z0, lineMat);
    box(group, c.courtHalfWidth * 2, 0.06, 0.35, x, 0.06, z0 + c.courtLength, lineMat);
    // the neck: the attacker's movement penalty lifts past this line
    box(group, c.courtHalfWidth * 2, 0.06, 0.2, x, 0.06, z0 + c.neckZ, lineMat);
    const head = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 2.4, 0.18, 20),
      surfaceMat({ color: GOLD, roughness: 0.6 }),
    );
    head.position.set(x, 0.12, z0 + c.courtLength - 1.2);
    head.receiveShadow = true;
    group.add(head);
    for (const side of [-1, 1]) {
      placeProp(group, 'torchLit', x + side * (c.courtHalfWidth + 2), 0, z0 + 2, 0, 2.4);
      placeProp(
        group,
        'torchLit',
        x + side * (c.courtHalfWidth + 2),
        0,
        z0 + c.courtLength - 2,
        Math.PI,
        2.4,
      );
    }
    placeProp(group, 'bannerYellow', x, 3.2, z0 - 2, 0, 2.2);
  }
  return { spanRig, sigilRig, pullRig, wagerRig };
}

// Track venue-created dynamic materials for dispose (surfaceMat ones are
// cache-shared and must stay alive).
let venueOwnedMats: THREE.Material[] = [];

// ---------------------------------------------------------------------------
// Public build + update + dispose
// ---------------------------------------------------------------------------

export interface GauntletVenueView {
  group: THREE.Group;
  update(
    t: number,
    run: GauntletRunView | null,
    viewer?: { x: number; y: number; z: number },
  ): void;
  /** The sigil slab's interaction rect, WORLD space (center + half-extent u/v). */
  sigilSlabRect(): {
    center: { x: number; y: number; z: number };
    u: { x: number; y: number; z: number };
    v: { x: number; y: number; z: number };
  };
  /** Place the trace cursor mote at a rect-local 0..1 point and extend the
   * freedraw stroke trail behind it; null hides the mote and clears the trail
   * (stroke end). */
  setSigilCursor(p: { u: number; v: number } | null): void;
  /** The venue's live click targets (the wager stones/pebbles), for pickVenueTarget. */
  pickTargets(): { id: string; object: THREE.Object3D }[];
  dispose(scene: THREE.Scene): void;
}

export async function buildGauntletVenue(
  scene: THREE.Scene,
  ox: number,
  oz: number,
  // World-space shatter poof hook (the renderer binds its pooled vfx).
  onPoof?: (x: number, y: number, z: number) => void,
): Promise<GauntletVenueView> {
  await ensureGauntletVenueAssets();
  const group = new THREE.Group();
  group.position.set(ox, 0, oz);
  venueOwnedMats = [];
  const owned = venueOwnedMats;

  // The one sand apron under everything (the far band has no terrain mesh).
  const V = GAUNTLET_VENUE;
  groundPlane(
    group,
    V.groundHalfWidth * 2,
    V.groundZMax - V.groundZMin,
    0,
    0.01,
    (V.groundZMin + V.groundZMax) / 2,
    surfaceMat({ color: 0xcdbb90, map: texWithRepeat(sandTex(), 26, 20), roughness: 1 }),
  );

  // The dusk dome and its wide understory disc: the venue's own sky and
  // far-ground, so nothing past the apron ever reads as bare void. Both ignore
  // scene fog (they ARE the horizon the fog fades into).
  const domeMat = new THREE.MeshBasicMaterial({
    map: duskTex(),
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
  });
  owned.push(domeMat);
  const dome = new THREE.Mesh(new THREE.CylinderGeometry(235, 235, 130, 36, 1, true), domeMat);
  dome.position.set(0, 40, 42);
  group.add(dome);
  const understoryMat = new THREE.MeshBasicMaterial({ color: 0x8a744f, fog: false });
  owned.push(understoryMat);
  const understory = new THREE.Mesh(new THREE.CircleGeometry(235, 36), understoryMat);
  understory.rotation.x = -Math.PI / 2;
  understory.position.set(0, -0.05, 42);
  group.add(understory);

  const rig = buildField(group);
  owned.push(rig.lampMat, rig.eyeMat);
  buildStaging(group);
  buildPodium(group, rig.lampMat);
  buildSpectatorDeck(group);
  const { spanRig, sigilRig, pullRig, wagerRig } = buildTrialArenas(group, ox, oz);
  scene.add(group);
  // The venue never moves after build: freeze the whole subtree's matrices
  // (real per-frame CPU on thousands of prop nodes), then re-enable the
  // transform-animated children: the Warden's turning head, the sigil trace
  // mote (repositioned per stroke sample), and the pull rig's live pieces
  // (rope halves, marker knot, pulsing drum).
  freezeStaticMatrices(group);
  rig.headGroup.matrixAutoUpdate = true;
  sigilRig.mote.matrixAutoUpdate = true;
  pullRig.knot.matrixAutoUpdate = true;
  pullRig.rope.matrixAutoUpdate = true;
  pullRig.drum.matrixAutoUpdate = true;
  wagerRig.root.matrixAutoUpdate = true;

  let lastT = 0;
  let headYaw = 0;
  let lastRevealKey = 'unset';
  let lastRevealed: number[] = [];
  let lastSigilShapeKey = '';
  let lastSigilMaskKey = -1;
  let lastSigilCrackKey = -1;
  // Pull rig state: the eased knot offset, plus a live flag so the rope lays
  // out once at idle (build leaves the halves unstretched) and resets once
  // when the trial ends, with zero writes on ordinary idle frames.
  let pullKnotX = 0;
  let pullLayoutDue = true;
  // Wager rig state: writes are elided on the composed key; the rig anchors to
  // the viewer's own duel row once per trial (players duel at spread mats).
  let lastWagerKey = '';
  let wagerAnchored = false;
  return {
    group,
    update(t: number, run: GauntletRunView | null, viewer?: { x: number; y: number; z: number }) {
      const dt = Math.min(0.1, Math.max(0, t - lastT));
      lastT = t;
      const mine = run && run.originX === ox && run.originZ === oz ? run : null;
      const light = mine?.sentinel ? mine.sentinel.light : null;
      // Span panels tint with the shared reveals (unknown glass, proven-safe
      // frosted, proven-brittle dark). Material swaps are elided on a key; a
      // pair OBSERVED flipping from unknown to revealed pops a shatter poof on
      // its brittle side (never on the venue's first sync mid-run).
      const revealKey = mine?.span ? mine.span.revealed.join(',') : '';
      if (revealKey !== lastRevealKey) {
        const observedBefore = lastRevealKey !== 'unset' && lastRevealKey !== '';
        lastRevealKey = revealKey;
        const revealed = mine?.span?.revealed ?? null;
        for (let i = 0; i < spanRig.panels.length; i++) {
          const r = revealed ? (revealed[i] ?? -1) : -1;
          const pair = spanRig.panels[i];
          if (observedBefore && r !== -1 && (lastRevealed[i] ?? -1) === -1 && onPoof) {
            const brittle = r === 0 ? pair.right : pair.left;
            onPoof(ox + brittle.position.x, brittle.position.y, oz + brittle.position.z);
          }
          pair.left.material =
            r === -1 ? spanRig.unknownMat : r === 0 ? spanRig.safeMat : spanRig.brittleMat;
          pair.right.material =
            r === -1 ? spanRig.unknownMat : r === 1 ? spanRig.safeMat : spanRig.brittleMat;
        }
        lastRevealed = revealed ? [...revealed] : [];
      }
      // The sigil slab: rebuild the etched outline on a fresh shape, tint the
      // carved segments gold from the coverage mask (freedraw is order-free,
      // so segments light wherever the stroke has carved), and lerp the face
      // toward red with the crack. Every write is elided on a quantized key.
      const sig = mine?.sigils ?? null;
      const shapeKey = sig ? `${sig.shapeSeed}:${sig.shapeId}` : '';
      if (shapeKey !== lastSigilShapeKey) {
        lastSigilShapeKey = shapeKey;
        lastSigilMaskKey = -1;
        lastSigilCrackKey = -1;
        // A fresh pane (a shatter, the next trial, or the run ending) drops
        // whatever stroke was mid-flight.
        clearSigilStroke(sigilRig);
        if (sig) {
          rebuildSigilOutline(sigilRig, sig.shapeSeed, sig.shapeId);
        } else {
          clearSigilOutline(sigilRig);
          sigilRig.mote.visible = false;
          sigilRig.faceMat.emissiveIntensity = 0;
        }
      }
      if (sig) {
        const maskKey = sig.coveredMask >>> 0;
        if (maskKey !== lastSigilMaskKey) {
          lastSigilMaskKey = maskKey;
          for (let i = 0; i < sigilRig.segs.length; i++) {
            sigilRig.segs[i].material =
              (maskKey & (1 << i)) !== 0
                ? sigilRig.tracedMat
                : sigilRig.segThin[i]
                  ? sigilRig.thinMat
                  : sigilRig.paleMat;
          }
        }
        const crackFrac = sig.crackMax > 0 ? Math.min(1, Math.max(0, sig.crack / sig.crackMax)) : 0;
        const crackKey = Math.round(crackFrac * 24);
        if (crackKey !== lastSigilCrackKey) {
          lastSigilCrackKey = crackKey;
          sigilRig.faceMat.emissiveIntensity = (crackKey / 24) * 0.9;
        }
      }
      // The Great Pull: ease the whole rope toward the wire marker's
      // translation (ABSOLUTE, + = team 0 winning = hauled toward -x; the sim
      // drags the gripping lines toward the same target, so hands stay on the
      // rope); the drum pulses on the beat (steady glow through the brace
      // window).
      const pull = mine?.pull ?? null;
      if (pull || pullLayoutDue) {
        const frac = pull
          ? Math.max(-1, Math.min(1, pull.marker / Math.max(1, pull.winThreshold)))
          : 0;
        const target = -frac * pullRig.maxOffset;
        pullKnotX += (target - pullKnotX) * Math.min(1, dt * 8);
        if (!pull && Math.abs(pullKnotX) < 0.01) pullKnotX = 0;
        const kx = pullRig.centerX + pullKnotX;
        pullRig.knot.position.x = kx;
        pullRig.rope.position.x = kx;
        if (pull) {
          const brace = t < pull.braceUntil;
          const beatFrac = pull.beatPeriodS > 0 ? posMod(t - pull.beatAnchor, pull.beatPeriodS) : 1;
          const flash = !brace && beatFrac < DRUM_FLASH_S;
          pullRig.drum.scale.setScalar(flash ? 1.12 : 1);
          pullRig.drumSkinMat.emissiveIntensity = brace ? 1.2 : flash ? 1.9 : 0.35;
        } else {
          pullRig.drum.scale.setScalar(1);
          pullRig.drumSkinMat.emissiveIntensity = 0.35;
        }
        // Stay live while the trial runs or the knot is still easing home.
        pullLayoutDue = pull !== null || pullKnotX !== 0;
      }
      // Keeper's Wager: the marble piles mirror the viewer's own purses, the
      // choice stones float up on a guess round, the pebble row on a hold
      // round. Everything is elided on one composed key.
      const wager = mine?.wager ?? null;
      const wagerKey = wager ? `${wager.stage}:${wager.mine}:${wager.theirs}` : '';
      if (wagerKey !== lastWagerKey) {
        lastWagerKey = wagerKey;
        if (!wager) {
          wagerAnchored = false;
          wagerRig.marbles.count = 0;
          wagerRig.oddStone.visible = false;
          wagerRig.evenStone.visible = false;
          for (const p of wagerRig.pebbles) p.visible = false;
        } else {
          // Anchor once per trial: the sim seats the viewer at their own mat
          // row, so their position IS the row (clamped into the courtyard).
          if (!wagerAnchored && viewer) {
            wagerAnchored = true;
            const half = GAUNTLET_VENUE.wager.size / 2 - 1.5;
            const rowZ = Math.max(
              wagerRig.baseZ - half,
              Math.min(wagerRig.baseZ + half, viewer.z - oz),
            );
            wagerRig.root.position.z = rowZ;
          }
          layoutWagerMarbles(wagerRig, wager.mine, wager.theirs);
          wagerRig.oddStone.visible = wager.stage === 'guess';
          wagerRig.evenStone.visible = wager.stage === 'guess';
          for (const p of wagerRig.pebbles) p.visible = wager.stage === 'hold';
        }
      }
      // Head: green = turned away (yaw PI), red = eyes on the field (yaw 0);
      // no live trial = a slow patrol sweep. The ease rate echoes the
      // telegraph window so the turn reads as the warning it is.
      const target = light === 'green' ? Math.PI : light === 'red' ? 0 : Math.sin(t * 0.35) * 0.7;
      headYaw += (target - headYaw) * Math.min(1, dt * 5);
      rig.headGroup.rotation.y = headYaw;
      const hex = light === 'green' ? GREEN_LIGHT : light === 'red' ? RED_LIGHT : IDLE_AMBER;
      rig.lampMat.emissive.setHex(hex);
      rig.eyeMat.emissive.setHex(hex);
      const boost = light === 'red' ? 2.6 : light === 'green' ? 1.8 : 1.4;
      rig.eyeMat.emissiveIntensity = boost;
      rig.lampMat.emissiveIntensity = light ? 1.6 : 0.7;
    },
    sigilSlabRect() {
      return sigilRig.rect;
    },
    pickTargets() {
      return wagerRig.pickList;
    },
    setSigilCursor(p: { u: number; v: number } | null) {
      if (!p) {
        // Stroke end: the mote lifts and the freedraw trail clears with it.
        sigilRig.mote.visible = false;
        clearSigilStroke(sigilRig);
        return;
      }
      const half = GAUNTLET_VENUE.sigils.slab.etchHalf;
      sigilRig.mote.position
        .copy(sigilRig.faceCenter)
        .addScaledVector(sigilRig.uDir, (p.u * 2 - 1) * half)
        .addScaledVector(sigilRig.vDir, (p.v * 2 - 1) * half)
        .addScaledVector(sigilRig.normal, 0.05);
      sigilRig.mote.visible = true;
      pushSigilStrokePoint(sigilRig, p.u, p.v);
    },
    dispose(s: THREE.Scene) {
      s.remove(group);
      // The stroke trail is a Line (not a Mesh), so the mesh traversal below
      // never reaches its geometry.
      sigilRig.stroke.geometry.dispose();
      group.traverse((o) => {
        if (o.userData.sharedGeometry) return;
        let shared = false;
        for (let p = o.parent; p; p = p.parent) {
          if (p.userData.sharedGeometry) {
            shared = true;
            break;
          }
        }
        if (!shared && (o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose();
      });
      for (const m of owned) m.dispose();
    },
  };
}
