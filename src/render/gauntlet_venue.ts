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
// of the future trials (etching pavilion, rope lane, echo courtyard, the
// raised brittle span, the champions' ring), each barred until its trial
// ships. The gameplay-load-bearing geometry (the field lines, the sigil slab,
// the tug rope, the echo rune stones, the span glass, the signal lamps) is
// procedural so it sits at the sim's exact numbers, but the DRESSING is real
// CC0 GLB kit set pieces (banners, torches, pillars, arches, barrels, crates,
// kegs, hay, benches, market stalls, tents, campfires, statues, and the gilded
// prize hoard on the podium), each measured at build time and normalized to a
// target height so kit scale never surprises us. The result reads as a
// lived-in festival ground, not boxes on sand.
//
// The venue is STATIC dressing: built once per slot on approach (the hodrics
// idiom, no teardown), with a tiny per-frame update for the light-reactive
// bits. It reads the viewer's own run view (IWorld gauntletRun) only; when no
// run is live the Warden idles and the lamps hold a low amber.

import * as THREE from 'three';
import {
  ECHO_MAT_GAP,
  ECHO_STATIONS,
  echoStation,
  GAUNTLET,
  GAUNTLET_LAYOUT,
  GAUNTLET_VENUE,
  sigilRingAngle,
} from '../sim/content/gauntlet';
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
  // Festival dressing (crowd clutter, seating, the prize hoard, set pieces).
  barrelLarge: 'models/dungeon/barrel_large.glb',
  barrelSmall: 'models/dungeon/barrel_small.glb',
  keg: 'models/dungeon/keg.glb',
  crate: 'models/dungeon/crate_large.glb',
  crates: 'models/dungeon/crates_stacked.glb',
  rocks: 'models/dungeon/rocks.glb',
  rocksSmall: 'models/dungeon/rocks_small.glb',
  boulder: 'models/biome/desert_boulder_1.glb',
  bench: 'models/dungeon/bench.glb',
  haybale: 'models/dungeon/haybale.glb',
  goldChest: 'models/dungeon/chest_large_gold.glb',
  coinStack: 'models/dungeon/coin_stack_large.glb',
  coinStackSmall: 'models/dungeon/coin_stack_medium.glb',
  gemsPile: 'models/resources/gems_pile_large.glb',
  lantern: 'models/dungeon/lantern_standing.glb',
  bonfire: 'models/props/bonfire.glb',
  marketStand: 'models/props/market_stand_1.glb',
  marketStand2: 'models/props/market_stand_2.glb',
  tent: 'models/props/tent_open.glb',
  statueHead: 'models/props/statue_head.glb',
  statueBlock: 'models/props/statue_block.glb',
  signpost: 'models/biome/camp_signpost.glb',
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

// Churned, trodden dirt for the pull lane: brown with darker scuffs and
// hollows where the teams have dug in.
function dirtTex(): THREE.CanvasTexture {
  return canvasTex('gauntletDirt', (ctx) => {
    ctx.fillStyle = '#6b4f33';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 1300; i++) {
      const shade = rnd();
      ctx.fillStyle =
        shade < 0.4
          ? 'rgba(40,26,14,0.30)'
          : shade < 0.72
            ? 'rgba(120,92,58,0.26)'
            : 'rgba(156,126,84,0.22)';
      ctx.fillRect(rnd() * 256, rnd() * 256, 0.6 + rnd() * 2.4, 0.6 + rnd() * 2.4);
    }
    for (let i = 0; i < 24; i++) {
      ctx.fillStyle = 'rgba(28,18,10,0.30)';
      ctx.beginPath();
      ctx.ellipse(
        rnd() * 256,
        rnd() * 256,
        5 + rnd() * 10,
        3 + rnd() * 6,
        rnd() * Math.PI,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  });
}

// Twisted hemp rope: diagonal light/dark strands so a thick cylinder reads as a
// braided rope rather than a smooth bar.
function ropeTex(): THREE.CanvasTexture {
  return canvasTex('gauntletRope', (ctx) => {
    ctx.fillStyle = '#9c7f52';
    ctx.fillRect(0, 0, 256, 256);
    ctx.lineWidth = 11;
    for (let i = -8; i < 26; i++) {
      ctx.strokeStyle = i % 2 === 0 ? 'rgba(70,52,30,0.6)' : 'rgba(198,170,122,0.55)';
      ctx.beginPath();
      ctx.moveTo(i * 20, -20);
      ctx.lineTo(i * 20 + 96, 276);
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
    // A knot of crowd clutter at the rail foot of each stand segment: hay to
    // perch on and a crate left lying at the front.
    const footX = side * (V.standX - 0.6);
    placeProp(group, 'haybale', footX, 0, mid - 3, side * 0.4, 1.1);
    placeProp(group, 'crate', footX, 0, mid + 3, 0.5, 1.2);
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
  // Two bonfires frame the mouth of the field where the runners break from the
  // start line.
  placeProp(group, 'bonfire', -(halfW + 3.6), 0, -1, 0, 2.2);
  placeProp(group, 'bonfire', halfW + 3.6, 0, -1, 0, 2.2);

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

  // Braziers ring the warden's pedestal, and two stone idols keep the watch
  // beside it (the braziers still breathe with the signal light).
  brazier(group, -7, wz - 1, lampMat);
  brazier(group, 7, wz - 1, lampMat);
  placeProp(group, 'statueBlock', -12, 0, wz - 1, Math.PI, 4.6);
  placeProp(group, 'statueBlock', 12, 0, wz - 1, Math.PI, 4.6);

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
  // A ring of festival stalls, a signpost, and stacked goods frame the plaza
  // just outside the contestants' line-up (stagingHalfWidth), so the muster
  // ground reads as a fairground gate, not bare pavement.
  const sw = GAUNTLET_LAYOUT.stagingHalfWidth;
  const sz = GAUNTLET_LAYOUT.stagingZ;
  placeProp(group, 'marketStand', -(sw + 3.2), 0, sz + 2.5, Math.PI / 2, 3);
  placeProp(group, 'marketStand2', sw + 3.2, 0, sz + 2.5, -Math.PI / 2, 3);
  placeProp(group, 'tent', -(sw + 4), 0, sz - 5, Math.PI / 2, 3.2);
  placeProp(group, 'signpost', sw + 1.5, 0, sz - 5.5, -0.6, 2);
  placeProp(group, 'barrelLarge', -(sw + 1.5), 0, sz - 3.5, 0, 1.05);
  placeProp(group, 'crate', sw + 2, 0, sz - 2.5, 0.4, 1.2);
  placeProp(group, 'keg', sw + 1.2, 0, sz - 3.4, -0.5, 0.82);
}

// Stage: the podium, three steps behind the plaza.
function buildPodium(group: THREE.Group, lampMat: THREE.MeshStandardMaterial) {
  const P = GAUNTLET_LAYOUT.podium;
  const z = P.z;
  const base = stoneMat(STONE_DARK);
  box(group, 12, P.baseH, 6, 0, P.baseH / 2, z, base);
  // The three winners' steps: gold centre, silver, bronze. Each box sits on the
  // base slab (centre = baseH + h/2), so its top is the stand-on height the sim
  // seats a champion at (gauntlet/podium.ts reads the same anchors).
  const stepMats = [GOLD, SILVER, BRONZE];
  for (let i = 0; i < P.steps.length; i++) {
    const s = P.steps[i];
    box(group, 3.2, s.h, 3.2, s.x, P.baseH + s.h / 2, z, stoneMat(stepMats[i]));
  }
  const cloth = surfaceMat({ color: 0xffffff, map: clothTex(), roughness: 0.85 });
  bannerPole(group, -5.4, z - 3.4, 0, cloth);
  bannerPole(group, 5.4, z - 3.4, 0, cloth);
  brazier(group, -5.4, z + 2.6, lampMat);
  brazier(group, 5.4, z + 2.6, lampMat);
  // The prize hoard: the event's gilded pot heaped behind the podium as the
  // ceremony backdrop (a big gold chest flanked by coin stacks and loose gems).
  placeProp(group, 'goldChest', 0, 0, z - 3.6, 0, 1.7);
  placeProp(group, 'coinStack', -2.4, 0, z - 3.3, 0.5, 0.95);
  placeProp(group, 'coinStack', 2.4, 0, z - 3.3, -0.5, 0.95);
  placeProp(group, 'gemsPile', -1.2, 0, z - 2.5, 0.2, 0.5);
  placeProp(group, 'coinStackSmall', 1.4, 0, z - 2.6, 0.9, 0.6);
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
  // Two rows of kit benches face the rail (the field the spectators just left),
  // with a refreshment stall and a keg at the back of the terrace.
  for (let i = -1; i <= 1; i++) {
    placeProp(group, 'bench', x + 2.6, 0, z + i * 6.5, -Math.PI / 2, 0.7);
    placeProp(group, 'bench', x + 5.2, 0, z + i * 6.5, -Math.PI / 2, 0.7);
  }
  placeProp(group, 'marketStand', x + 6.4, 0, z, -Math.PI / 2, 3);
  placeProp(group, 'keg', x + 6.2, 0, z - 8.5, 0.4, 0.82);
  placeProp(group, 'torchLit', x, 0, z - 10.4, Math.PI, 2.2);
  placeProp(group, 'torchLit', x, 0, z + 10.4, 0, 2.2);
}

// The colosseum shell: a low-poly elliptical stadium wall around the whole
// venue complex, built from the GAUNTLET_VENUE.colosseum numbers that
// venue_physics also derives its wall colliders from. Deliberately cheap:
// flat-shaded boxes and 6-sided pilasters, alternating parapet heights and a
// dark inner arcade band for the silhouette, no shadow casting (the ring sits
// far from every play surface), everything matrix-frozen after build.
function buildColosseum(group: THREE.Group) {
  const C = GAUNTLET_VENUE.colosseum;
  const wallMat = stoneMat(STONE);
  const tierMat = stoneMat(SAND_EDGE);
  const darkMat = stoneMat(STONE_DARK);
  const point = (a: number, inset: number) => ({
    x: C.x + Math.sin(a) * (C.rx - inset),
    z: C.z + Math.cos(a) * (C.rz - inset),
  });
  const add = (
    geo: THREE.BoxGeometry,
    x: number,
    y: number,
    z: number,
    rotY: number,
    mat: THREE.Material,
  ) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.y = rotY;
    m.receiveShadow = true;
    group.add(m);
  };
  // One shared 6-sided pilaster profile (geometry.dispose is idempotent, so
  // the venue teardown's per-mesh sweep stays correct).
  const pilasterGeo = new THREE.CylinderGeometry(0.6, 0.75, 14.6, 6);
  for (let i = 0; i < C.segments; i++) {
    const a0 = (i / C.segments) * Math.PI * 2;
    const a1 = ((i + 1) / C.segments) * Math.PI * 2;
    const p0 = point(a0, 0);
    const p1 = point(a1, 0);
    const mid = { x: (p0.x + p1.x) / 2, z: (p0.z + p1.z) / 2 };
    const chord = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    // Yaw that lays the box's local x along the chord (three.js rotation.y
    // maps local +x to (cos r, -sin r) in the xz plane).
    const rot = Math.atan2(-(p1.z - p0.z), p1.x - p0.x);
    // The main wall, parapet heights alternating for a worked silhouette.
    const h = i % 2 === 0 ? 12.4 : 11.2;
    add(new THREE.BoxGeometry(chord + 0.6, h, C.wallDepth), mid.x, h / 2, mid.z, rot, wallMat);
    // The dark arcade band on the inner face (reads as the arch row).
    const inw = Math.hypot(C.x - mid.x, C.z - mid.z);
    const nx = (C.x - mid.x) / inw;
    const nz = (C.z - mid.z) / inw;
    const off = C.wallDepth / 2 + 0.06;
    add(
      new THREE.BoxGeometry(chord * 0.44, 6.8, 0.4),
      mid.x + nx * off,
      3.9,
      mid.z + nz * off,
      rot,
      darkMat,
    );
    // The recessed upper tier ring.
    const q0 = point(a0, 2.6);
    const q1 = point(a1, 2.6);
    const qm = { x: (q0.x + q1.x) / 2, z: (q0.z + q1.z) / 2 };
    const qc = Math.hypot(q1.x - q0.x, q1.z - q0.z);
    const qr = Math.atan2(-(q1.z - q0.z), q1.x - q0.x);
    add(new THREE.BoxGeometry(qc + 0.4, 3.2, C.wallDepth * 0.75), qm.x, h + 1.4, qm.z, qr, tierMat);
    // A pilaster at each segment seam.
    const pil = new THREE.Mesh(pilasterGeo, darkMat);
    pil.position.set(p0.x, 7.3, p0.z);
    pil.receiveShadow = true;
    group.add(pil);
  }
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
  // The flat translucent fill of the etched shape (a ShapeGeometry of the shared
  // SVG outline laid on the slab), rebuilt per shape and disposed on clear.
  reliefMat: THREE.Material;
  relief: THREE.Mesh | null;
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
// judge's knot marking its center. The input is the screen-space shrinking
// circles, so the lane carries no separate beat prop.
interface PullRig {
  knot: THREE.Group;
  rope: THREE.Mesh;
  centerX: number;
  centerZ: number;
}

// The Keeper's Echo table rig: four floating rune stones over the viewer's
// own table row. During the watch phase each stone in the wire sequence
// flashes in turn (emissive boost, key-diffed per step); during the answer
// window all stones glow softly and matched progress dims the tail. The
// stones are the trial's click targets, raycast via pickTargets().
interface EchoRig {
  root: THREE.Group;
  stones: THREE.Group[];
  stoneMats: THREE.MeshStandardMaterial[];
  pickList: { id: string; object: THREE.Object3D }[];
  baseZ: number; // the courtyard center row (instance-local)
  // One cosmetic desk per grid station (see echoStation): static dressing so
  // every seated contestant has a desk. The one the viewer sits at is hidden
  // for the trial while the live rig (root) takes its place.
  desks: { group: THREE.Group; deskX: number; deskZ: number }[];
}

// The echo stones' idle/flash emissive levels.
const ECHO_IDLE = 0.25;
const ECHO_FLASH = 2.4;
// A flash lights the stone for this fraction of its step (the gap between
// flashes is what makes a repeated stone readable).
const ECHO_FLASH_DUTY = 0.72;
// The click-verdict flash: the judged stone burns green (a correct tap) or
// red (a miss) this long, overriding the sequence glow.
const ECHO_JUDGE_S = 0.4;
const ECHO_JUDGE_FLASH = 2.6;

// Outline tint granularity: the polyline is grouped into this many tube
// segments, tinted gold per the wire's coveredMask bits (one bit per segment;
// segments light along the contiguous arc the stroke has traced).
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
    // Standing lanterns between every other pillar light the etching ring.
    if (i % 2 === 0) {
      placeProp(
        group,
        'lantern',
        x + Math.sin(a) * (radius + 2.7),
        0,
        z + Math.cos(a) * (radius + 2.7),
        a,
        1.5,
      );
    }
  }
  placeProp(group, 'bannerWhite', x, 3.2, z - radius - 1.4, 0, 2.2);
  placeProp(group, 'crates', x - radius - 1.2, 0, z + radius - 1, 0.3, 1.5);
  placeProp(group, 'barrelSmall', x + radius + 1.4, 0, z - radius + 1.5, -0.4, 0.7);

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
  // The flat sugarglass fill the outline traces around: a translucent amber pane
  // laid on the slab (a ShapeGeometry of the shared SVG silhouette) so the shape
  // reads as one form under the etched groove rather than a bare set of lines.
  // DoubleSide + depthWrite off keeps the transparent pane artifact-free at any
  // face tilt (placement-basis winding and slab z-fighting both stop mattering).
  const reliefMat = new THREE.MeshStandardMaterial({
    color: 0x6b4a1c,
    emissive: 0xc98a2a,
    emissiveIntensity: 0.28,
    roughness: 0.3,
    metalness: 0.05,
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  venueOwnedMats.push(faceMat, tracedMat, paleMat, thinMat, reliefMat);
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
    new THREE.SphereGeometry(0.06, 10, 8),
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
    reliefMat,
    relief: null,
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
    .addScaledVector(rig.normal, 0.11); // above the raised relief + groove
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
  if (rig.relief) {
    rig.outlineGroup.remove(rig.relief);
    rig.relief.geometry.dispose();
    rig.relief = null;
  }
}

// The etched groove is a thin guide line the player must hug: its tube radius is
// a fraction of the sim's accept band (a shape-local tolerance maps to face
// yards by 2*inner*etchHalf), so what shows reads as a fine line and the tight
// band, not a fat line, sets the difficulty. The flat fill sits just under the
// groove so the shape reads as one form, not a bare set of lines.
const SIGIL_GROOVE_BAND_FRAC = 0.55;
const SIGIL_FILL_LIFT = 0.02; // the flat fill's clearance off the slab face
const SIGIL_GROOVE_LIFT = 0.045; // the groove tubes sit just above the fill

// Rebuild the etched shape for a fresh seed/id: a FLAT translucent fill of the
// SVG silhouette laid on the slab, ringed by ~24 tube segments (tinted per the
// coverage mask) that form the groove the player traces. Both are mapped onto the
// slab face through the SAME pad inset the trace input uses. Event-driven (shape
// changes on shatter/advance), never per frame.
function rebuildSigilOutline(rig: SigilRig, seed: number, shapeId: number): void {
  clearSigilOutline(rig);
  const slab = GAUNTLET_VENUE.sigils.slab;
  const o = sigilOutline(seed, shapeId, GAUNTLET.sigils.outlinePoints);
  const n = o.xs.length;
  const per = Math.max(1, Math.floor(n / SIGIL_SEGMENTS));
  const inner = 1 - 2 * slab.padFrac;
  // Shape-local (sx, sy) in 0..1 -> face offsets (across = vDir, down-slope =
  // uDir) through the shared inset. Shared by the groove tubes and the fill.
  const faceU = (sy: number): number => ((slab.padFrac + sy * inner) * 2 - 1) * slab.etchHalf;
  const faceV = (sx: number): number => ((slab.padFrac + sx * inner) * 2 - 1) * slab.etchHalf;
  const toLocal = (sx: number, sy: number): THREE.Vector3 =>
    new THREE.Vector3()
      .copy(rig.faceCenter)
      .addScaledVector(rig.uDir, faceU(sy))
      .addScaledVector(rig.vDir, faceV(sx))
      .addScaledVector(rig.normal, SIGIL_GROOVE_LIFT);

  // The flat silhouette: a THREE.Shape in the face plane (X = across = vDir, Y =
  // down-slope = uDir), triangulated by ShapeGeometry and laid FLAT on the slab
  // face as a translucent pane. The fill material is DoubleSide + depthWrite off,
  // so the winding of the (left-handed) placement basis is irrelevant and the
  // transparent pane never z-fights the slab behind it.
  const shape = new THREE.Shape();
  for (let i = 0; i < n; i++) {
    const px = faceV(o.xs[i]);
    const py = faceU(o.ys[i]);
    if (i === 0) shape.moveTo(px, py);
    else shape.lineTo(px, py);
  }
  shape.closePath();
  const fillGeo = new THREE.ShapeGeometry(shape);
  // Orient the fill's local axes (X, Y) onto (vDir, uDir) at the face center,
  // lifted a hair off the slab so it sits just under the groove tubes.
  const basis = new THREE.Matrix4().makeBasis(rig.vDir, rig.uDir, rig.normal);
  basis.setPosition(
    rig.faceCenter.x + rig.normal.x * SIGIL_FILL_LIFT,
    rig.faceCenter.y + rig.normal.y * SIGIL_FILL_LIFT,
    rig.faceCenter.z + rig.normal.z * SIGIL_FILL_LIFT,
  );
  fillGeo.applyMatrix4(basis);
  const relief = new THREE.Mesh(fillGeo, rig.reliefMat);
  relief.castShadow = false;
  rig.outlineGroup.add(relief);
  rig.relief = relief;

  const tubeRadius = GAUNTLET.sigils.tolerance * 2 * inner * slab.etchHalf * SIGIL_GROOVE_BAND_FRAC;
  for (let s = 0; s < SIGIL_SEGMENTS; s++) {
    const pts: THREE.Vector3[] = [];
    let thin = false;
    for (let k = 0; k <= per; k++) {
      const i = (s * per + k) % n;
      pts.push(toLocal(o.xs[i], o.ys[i]));
      if (o.thin[i]) thin = true;
    }
    const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 6, tubeRadius, 6, false);
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
  echoRig: EchoRig;
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
    // A churned dirt strip worn down the middle where the teams dig in, laid
    // just over the sand so the lane reads as trodden ground, not clean sand.
    groundPlane(
      group,
      length + 6,
      width - 1,
      x,
      0.03,
      z,
      surfaceMat({ color: 0x7a5c3a, map: texWithRepeat(dirtTex(), 6, 2), roughness: 1 }),
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
    // The rope: a thick braided hemp line the teams hold; it slides through the
    // pit rather than stretching, translated per frame with the marker. The
    // twist texture and the bound (whipped) ends make it read as a real rope
    // rather than a smooth bar. Whipping bands are children so they ride with it.
    const ropeMat = surfaceMat({
      color: 0xb59463,
      map: texWithRepeat(ropeTex(), 1, Math.round(length)),
      roughness: 1,
    });
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, length, 8), ropeMat);
    rope.rotation.z = Math.PI / 2;
    rope.position.set(x, ropeY, z);
    rope.castShadow = true;
    const whipMat = stoneMat(0x3a2a18);
    for (const end of [-1, 1]) {
      const whip = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.26, 8), whipMat);
      whip.position.y = end * (length / 2 - 0.4); // local Y runs along the rope
      rope.add(whip);
    }
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
    // Dressing so the arena reads as a used, lived-in tug ground: low dug-in
    // dirt mounds where the teams brace, loose kit rocks and hay along the
    // sidelines, waiting barrels and a crate stack off the west end, and pitch
    // torches at the corners.
    const moundMat = surfaceMat({ color: 0x6f5236, map: dirtTex(), roughness: 1 });
    const moundSpots: [number, number, number][] = [
      [-length / 2 + 1, width / 2 + 1.4, 0.9],
      [length / 2 - 2, -width / 2 - 1.2, 1.1],
      [-2, -width / 2 - 1.7, 0.7],
      [4, width / 2 + 1.8, 0.85],
    ];
    for (const [dx, dz, r] of moundSpots) {
      const mound = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), moundMat);
      mound.scale.y = 0.4;
      mound.position.set(x + dx, 0.06, z + dz);
      mound.castShadow = true;
      group.add(mound);
    }
    const pullRockKeys = ['rocksSmall', 'rocks', 'boulder'] as const;
    for (let i = 0; i < 6; i++) {
      const rx = x - length / 2 + 2 + (i * (length - 4)) / 5;
      const rz = z + (i % 2 === 0 ? 1 : -1) * (width / 2 + 0.9 + (i % 3) * 0.35);
      placeProp(group, pullRockKeys[i % 3], rx, 0, rz, i * 1.1, 0.62 + (i % 3) * 0.22);
    }
    placeProp(group, 'haybale', x - length / 2 + 3, 0, z - width / 2 - 2.2, 0.4, 1.1);
    placeProp(group, 'haybale', x + length / 2 - 4, 0, z + width / 2 + 2.4, -0.7, 1.1);
    for (const side of [-1, 1]) {
      const rot = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      placeProp(group, 'torchLit', x + side * (length / 2 + 2.2), 0, z - width / 2 - 1, rot, 2.4);
      placeProp(group, 'torchLit', x + side * (length / 2 + 2.2), 0, z + width / 2 + 1, rot, 2.4);
    }
    placeProp(group, 'barrelLarge', x - length / 2 - 1.4, 0, z + width / 2 + 2.3, 0, 1.05);
    placeProp(group, 'keg', x - length / 2 - 0.3, 0, z + width / 2 + 2.7, 0.6, 0.82);
    placeProp(group, 'crates', x - length / 2 - 1.8, 0, z - width / 2 - 2.4, -0.3, 1.5);
    return { knot, rope, centerX: x, centerZ: z };
  })();

  // Trial 4, the Keeper's Echo: a walled courtyard of rune-stone desks, one per
  // contestant (echoStation). Every desk is a low stone table with four floating
  // rune stones; the cosmetic desks are static dressing, and the viewer's own is
  // taken over by the live rig, which flashes the wire sequence and is the click
  // target.
  const echoRig: EchoRig = (() => {
    const { x, z, size } = V.echo;
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
    placeProp(group, 'bannerGreen', x, 3.2, z + size / 2 - 0.4, Math.PI, 2.2);
    // Corner lanterns and a back-wall crate stack (kept in the corners, clear
    // of the desk grid and the contestants' mats along the west edge).
    placeProp(group, 'lantern', x - size / 2 + 1.1, 0, z - size / 2 + 1.1, 0.8, 1.6);
    placeProp(group, 'lantern', x - size / 2 + 1.1, 0, z + size / 2 - 1.1, -0.8, 1.6);
    placeProp(group, 'crates', x + size / 2 - 1.6, 0, z + size / 2 - 1.6, 0.3, 1.5);

    // Desk geometry: a table plus four rune stones in a row, one desk local
    // origin (a mat-gap east of where a contestant stands). One box + one sphere
    // geometry are shared across every desk (geometry.dispose is idempotent).
    const tableGeo = new THREE.BoxGeometry(1.6, 0.9, 3.4);
    const orbGeo = new THREE.SphereGeometry(0.26, 12, 10);
    const orbLocalZ = (k: number) => -1.35 + k * 0.9;

    // A cosmetic desk at each grid station: a table plus four idle rune stones
    // (one shared dim material, they never flash), so every seated contestant
    // has a desk. The viewer's own is hidden for the trial (the live rig takes
    // its place); the rest stay lit as the hall of memory desks.
    const deskOrbMat = new THREE.MeshStandardMaterial({
      color: 0x2a3040,
      emissive: GLASS_TINT,
      emissiveIntensity: ECHO_IDLE,
      roughness: 0.35,
    });
    venueOwnedMats.push(deskOrbMat);
    const desks: { group: THREE.Group; deskX: number; deskZ: number }[] = [];
    for (let i = 0; i < ECHO_STATIONS; i++) {
      const st = echoStation(i);
      const dg = new THREE.Group();
      dg.position.set(st.deskX, 0, st.deskZ);
      const dtable = new THREE.Mesh(tableGeo, stoneMat(STONE));
      dtable.position.set(0.6, 0.45, 0);
      dtable.castShadow = true;
      dg.add(dtable);
      for (let k = 0; k < GAUNTLET.echo.stones; k++) {
        const orb = new THREE.Mesh(orbGeo, deskOrbMat);
        orb.position.set(0.6, 1.35, orbLocalZ(k));
        dg.add(orb);
      }
      group.add(dg);
      desks.push({ group: dg, deskX: st.deskX, deskZ: st.deskZ });
    }

    // The live rig: hidden until the viewer's trial opens, then anchored onto
    // (and replacing) the cosmetic desk the viewer sits at. Its four stones each
    // carry their OWN material so a flash lights exactly one; they carry no
    // numeral (you replay the sequence by clicking the orbs in the order they
    // lit, not by index).
    const root = new THREE.Group();
    root.position.set(x, 0, z);
    root.visible = false;
    group.add(root);
    const table = new THREE.Mesh(tableGeo, stoneMat(STONE));
    table.position.set(0.6, 0.45, 0);
    table.castShadow = true;
    root.add(table);
    const stones: THREE.Group[] = [];
    const stoneMats: THREE.MeshStandardMaterial[] = [];
    for (let k = 0; k < GAUNTLET.echo.stones; k++) {
      const m = new THREE.MeshStandardMaterial({
        color: 0x2a3040,
        emissive: GLASS_TINT,
        emissiveIntensity: ECHO_IDLE,
        roughness: 0.35,
      });
      venueOwnedMats.push(m);
      const g2 = new THREE.Group();
      g2.position.set(0.6, 1.35, orbLocalZ(k));
      const orb = new THREE.Mesh(orbGeo, m);
      g2.add(orb);
      g2.visible = false;
      root.add(g2);
      stones.push(g2);
      stoneMats.push(m);
    }
    const pickList = stones.map((s, k) => ({ id: `echo:${k}`, object: s as THREE.Object3D }));
    return { root, stones, stoneMats, pickList, baseZ: z, desks };
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
    // A signpost and stacked goods mark the crossing's near mouth, before the
    // walk-on ramp (clear of the panels).
    placeProp(group, 'signpost', x + sideX + 3, 0, z - fieldLen / 2 - 2.5, -0.5, 2);
    placeProp(group, 'crates', x - sideX - 3, 0, z - fieldLen / 2 - 2.2, 0.4, 1.5);
    placeProp(group, 'barrelLarge', x - sideX - 2.1, 0, z - fieldLen / 2 - 3.5, 0, 1.05);
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

  // Trial 6, The Final Court: a circular melee arena. Fighters are clamped inside
  // GAUNTLET.court.arenaRadius (trial_court.ts) so the low boundary curb reads as
  // a real wall; a gold champion's medallion marks the centre and torches ring
  // the rim.
  {
    const { x, z } = V.court;
    const floorR = V.court.radius; // the dressed sand floor
    const ringR = GAUNTLET.court.arenaRadius; // where the fighters are clamped
    const floor = new THREE.Mesh(
      new THREE.CylinderGeometry(floorR, floorR, 0.12, 48),
      surfaceMat({ color: 0xc7b58c, map: texWithRepeat(sandTex(), 4, 4), roughness: 0.95 }),
    );
    floor.position.set(x, 0.06, z);
    floor.receiveShadow = true;
    group.add(floor);
    // The boundary curb, a flat ring at the play radius.
    const curb = new THREE.Mesh(
      new THREE.TorusGeometry(ringR, 0.28, 8, 60),
      surfaceMat({ color: 0xf6f1e4, roughness: 0.8 }),
    );
    curb.rotation.x = Math.PI / 2;
    curb.position.set(x, 0.14, z);
    curb.receiveShadow = true;
    group.add(curb);
    // The champion's medallion at the centre.
    const medallion = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 2.4, 0.16, 24),
      surfaceMat({ color: GOLD, roughness: 0.6 }),
    );
    medallion.position.set(x, 0.13, z);
    medallion.receiveShadow = true;
    group.add(medallion);
    // Torches evenly around the rim, flanking idols, and a banner behind.
    const torches = 8;
    for (let i = 0; i < torches; i++) {
      const a = (i / torches) * Math.PI * 2;
      placeProp(
        group,
        'torchLit',
        x + Math.sin(a) * (floorR + 1.5),
        0,
        z + Math.cos(a) * (floorR + 1.5),
        a + Math.PI,
        2.4,
      );
    }
    for (const side of [-1, 1]) {
      placeProp(
        group,
        'statueHead',
        x + side * (floorR + 2.4),
        0,
        z,
        side > 0 ? -Math.PI / 2 : Math.PI / 2,
        2.8,
      );
    }
    placeProp(group, 'bannerYellow', x, 3.2, z - floorR - 2, 0, 2.2);
    placeProp(group, 'crates', x - floorR - 2.2, 0, z + floorR * 0.4, 0.3, 1.5);
    placeProp(group, 'barrelLarge', x + floorR + 2.2, 0, z - floorR * 0.4, 0, 1.05);
  }
  return { spanRig, sigilRig, pullRig, echoRig };
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
  /** The venue's live click targets (the echo rune stones), for pickVenueTarget. */
  pickTargets(): { id: string; object: THREE.Object3D }[];
  /** Flash the clicked echo stone with its sim-graded verdict: green for a
   * correct tap, red for a miss (the gauntletEchoJudge event). */
  echoJudge(stone: number, ok: boolean): void;
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
  // scene fog (they ARE the horizon the fog fades into). The dome is a closed
  // HEMISPHERE, not an open cylinder: it curves shut overhead so it reads as
  // real sky instead of a surrounding wall. Its open bottom rim sits at ground
  // level (y=0) and shares the understory disc's radius and center, so sky and
  // far-ground meet on one horizon seam whatever way the camera faces. A
  // hemisphere's UV v runs the full 0..1 from the zenith pole to that rim, the
  // same span the old cylinder mapped top-to-bottom, so duskTex lands unchanged:
  // deep violet at the pole down to the amber horizon at the rim.
  const domeMat = new THREE.MeshBasicMaterial({
    map: duskTex(),
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
  });
  owned.push(domeMat);
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(235, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2),
    domeMat,
  );
  dome.position.set(0, 0, 42);
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
  buildColosseum(group);
  const { spanRig, sigilRig, pullRig, echoRig } = buildTrialArenas(group, ox, oz);
  scene.add(group);
  // The venue never moves after build: freeze the whole subtree's matrices
  // (real per-frame CPU on thousands of prop nodes), then re-enable the
  // transform-animated children: the Warden's turning head, the sigil trace
  // mote (repositioned per stroke sample), and the pull rig's live pieces
  // (the rope and the marker knot).
  freezeStaticMatrices(group);
  rig.headGroup.matrixAutoUpdate = true;
  sigilRig.mote.matrixAutoUpdate = true;
  pullRig.knot.matrixAutoUpdate = true;
  pullRig.rope.matrixAutoUpdate = true;
  echoRig.root.matrixAutoUpdate = true;

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
  // Echo rig state: show/anchor writes are elided on the composed round key,
  // the per-flash emissive on the step key; the rig anchors to the viewer's
  // own desk once per trial (every contestant sits at a grid station), and
  // hiddenDesk is the cosmetic desk it replaced (restored when the trial ends).
  let lastEchoKey = 'unset';
  let lastEchoFlashKey = -2;
  let echoAnchored = false;
  let hiddenDesk = -1;
  // The click-verdict flash (echoJudge): applied once when set, restored once
  // on expiry; the sequence-glow writer skips the judged stone while it holds.
  let echoJudgeState: { stone: number; ok: boolean; until: number; applied: boolean } | null = null;
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
      // carved segments gold from the coverage mask (they light along the
      // contiguous arc the stroke has traced), and lerp the face toward red with
      // the crack. Every write is elided on a quantized key.
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
      // The Great Pull: the rope rides the wire's `kx`, the SAME eased
      // translation the sim drags the gripping lines (and the players' pins)
      // by, so the rope and the pullers move as one body (a fast local ease
      // only smooths the 0.05 wire quantization and the snapshot cadence). The
      // screen-space circle overlay is the only input cue; the lane has no beat
      // prop of its own.
      const pull = mine?.pull ?? null;
      if (pull || pullLayoutDue) {
        const target = pull ? pull.kx : 0;
        pullKnotX += (target - pullKnotX) * Math.min(1, dt * 12);
        if (!pull && Math.abs(pullKnotX) < 0.01) pullKnotX = 0;
        const kx = pullRig.centerX + pullKnotX;
        pullRig.knot.position.x = kx;
        pullRig.rope.position.x = kx;
        // Stay live while the trial runs or the knot is still easing home.
        pullLayoutDue = pull !== null || pullKnotX !== 0;
      }
      // The Keeper's Echo: the stones show/anchor on one composed key, and the
      // per-flash emissive writes are elided on a step key derived from the
      // wire's absolute flash schedule (t here tracks sim time).
      const echo = mine?.echo ?? null;
      const echoKey = echo ? `${echo.round}:${echo.showStartAt}:${echo.done}` : '';
      if (echoKey !== lastEchoKey) {
        lastEchoKey = echoKey;
        lastEchoFlashKey = -2;
        if (!echo) {
          // Trial over: retire the live rig and give the viewer's desk back.
          if (echoAnchored) {
            echoRig.root.visible = false;
            if (hiddenDesk >= 0) echoRig.desks[hiddenDesk].group.visible = true;
            hiddenDesk = -1;
            echoAnchored = false;
          }
          for (const s of echoRig.stones) s.visible = false;
        } else {
          for (const s of echoRig.stones) s.visible = !echo.done;
        }
      }
      // Anchor once per trial, retried each frame until the viewer entity has
      // streamed in: the sim seats the viewer a mat-gap west of their own desk,
      // so put the live rig on that desk (both x and z) and hide the cosmetic
      // desk it replaces. The rest of the grid stays lit as idle memory desks.
      if (echo && !echoAnchored && viewer) {
        echoAnchored = true;
        const rootX = viewer.x - ox + ECHO_MAT_GAP;
        const rootZ = viewer.z - oz;
        echoRig.root.position.set(rootX, 0, rootZ);
        echoRig.root.visible = true;
        let best = -1;
        let bestD = Number.POSITIVE_INFINITY;
        for (let d = 0; d < echoRig.desks.length; d++) {
          const dk = echoRig.desks[d];
          const dd = (dk.deskX - rootX) ** 2 + (dk.deskZ - rootZ) ** 2;
          if (dd < bestD) {
            bestD = dd;
            best = d;
          }
        }
        if (best >= 0) {
          echoRig.desks[best].group.visible = false;
          hiddenDesk = best;
        }
      }
      // The click-verdict flash rides over the sequence glow: applied once
      // when armed, restored once on expiry (or when the duel ends mid-hold),
      // with the flash key reset so the glow writer re-asserts afterward.
      if (echoJudgeState) {
        const jm = echoRig.stoneMats[echoJudgeState.stone];
        if (t >= echoJudgeState.until || !echo || echo.done) {
          jm.emissive.setHex(GLASS_TINT);
          jm.emissiveIntensity = ECHO_IDLE;
          echoJudgeState = null;
          lastEchoFlashKey = -2;
        } else if (!echoJudgeState.applied) {
          echoJudgeState.applied = true;
          jm.emissive.setHex(echoJudgeState.ok ? GREEN_LIGHT : RED_LIGHT);
          jm.emissiveIntensity = ECHO_JUDGE_FLASH;
        }
      }
      if (echo && !echo.done) {
        // Which stone burns right now: step k of the watch phase while inside
        // its flash duty window, else none (idle glow). One int key.
        const step = Math.floor((t - echo.showStartAt) / Math.max(0.01, echo.stepS));
        const frac = (t - echo.showStartAt) / Math.max(0.01, echo.stepS) - step;
        const flashing =
          step >= 0 && step < echo.seq.length && frac < ECHO_FLASH_DUTY ? echo.seq[step] : -1;
        if (flashing !== lastEchoFlashKey) {
          lastEchoFlashKey = flashing;
          for (let k = 0; k < echoRig.stoneMats.length; k++) {
            if (echoJudgeState?.applied && k === echoJudgeState.stone) continue;
            echoRig.stoneMats[k].emissiveIntensity = k === flashing ? ECHO_FLASH : ECHO_IDLE;
          }
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
      return echoRig.pickList;
    },
    echoJudge(stone: number, ok: boolean) {
      if (stone < 0 || stone >= echoRig.stoneMats.length) return;
      if (echoJudgeState?.applied) {
        // A rapid follow-up tap: restore the previous stone before re-arming.
        const prev = echoRig.stoneMats[echoJudgeState.stone];
        prev.emissive.setHex(GLASS_TINT);
        prev.emissiveIntensity = ECHO_IDLE;
        lastEchoFlashKey = -2;
      }
      echoJudgeState = { stone, ok, until: lastT + ECHO_JUDGE_S, applied: false };
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
        .addScaledVector(sigilRig.normal, 0.12); // floats above the raised relief + groove
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
