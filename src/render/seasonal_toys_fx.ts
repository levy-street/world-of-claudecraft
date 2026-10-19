// Hester's toys' visual layer (sim: src/sim/seasonal/seasonal_toys.ts; the curves live in
// seasonal_toys_fx_core.ts), composed by ScarecrowFx (scarecrow_fx.ts), the Gourdlight Eve
// render layer the renderer already ticks and routes spellfxAt to:
//
//  - PRANKER'S PUMPKIN: a lit pumpkin lobbed end over end from the thrower's hand onto the
//    target's head, a sparkle trail behind it, then a SPLAT of pulp, seeds and a warm flash
//    (the head the target then wears is the Carved Pumpkin Head's own piece, drawn by the
//    character visual off the same aura: seasonal_head_core.ts);
//  - WANDERWISP LANTERN: a little iron lantern set down where it was used, its pale glass
//    lit by the wisp inside, and
//    a small translucent ghost circling its keeper at shoulder height, bobbing and leaning
//    into its turn, faint wisps streaming off its hem;
//  - SACK OF STARTLED BATS: a swarm of bats bursting up out of the sack in a tight spiral,
//    wings beating, then scattering out and away;
//  - MURMURWICK CANDLE: a cluster of green-flamed candles on an iron dish where it was lit,
//    a pool of candlelight on the ground round it and, dancing in that light, the shadows
//    its flames throw: a sitting cat, a bat on the wing and a witch with her broom, each
//    cast away from the flame, stretching and shrinking with its flicker and circling the
//    dish (round 10: the whispers are gone). The light pool is what lets a dark shadow read
//    at night; by day the shadows read dark on the sunlit grass;
//  - GURGLEGREEN CAULDRON (round 10): a squat iron cauldron on three stubby legs set down
//    where it was used (a ground object any player may drink from, sim:
//    seasonal/toy_cauldron.ts), its green brew bubbling and popping, steam and green motes
//    curling up off it, embers under its belly and its bubbling looped at the spot (round
//    11: drawn waist-high, CAULDRON_SCALE). A drinker bursts in green bubbles and smoke and
//    fizzes green (the rig's own aura-glow tint, through the renderer's seam) for
//    BREW_FIZZ_SEC while the goblin body takes over (the polymorph slot's look,
//    form_visual_selection_core.ts), then turns back in a green puff when the look ends.
// Every look is cosmetic: nothing here is actionable, and a stealthed or dead body never
// draws one (a glowing toy where an unseen rogue walks would hand out what stealth hides).
//
// GPU work: one root group built on the first sight of a toy (a look on a body, or a toy's
// cue), attached through the world compile gate (attachSceneGroupGated); every pool is an
// InstancedMesh whose instances start hidden (scale 0) with their instance colours already
// set, so the gate links each program variant before its first real use, and an idle pool
// is hidden once its twin window is over. The thrown pumpkin is an instance of the decor
// kit's own small carved pumpkin (the instanced program variant the decor view links),
// behind its own gate since the kit can finish loading later. The glows are a small
// fixed pool of additive sprites. No light is added: the halos stand in for one. Particles
// ride the pooled point cloud (vfx.ts) through the boss layer's particle seam.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  GURGLEGREEN_CAULDRON_ID,
  gourdlightToy,
  GOURDLIGHT_TOY_FX_PREFIX as TOY_FX_ABILITY_PREFIX,
} from '../sim/content/gourdlight_eve';
import type { SpatialAudioSink } from './audio_sink';
import { attachSceneGroupGated } from './gated_scene_attach';
import { pullDecalTowardCamera } from './ground_decal_pull';
import { gourdlightAssets } from './seasonal_decor_assets';
import {
  BAT_CAP,
  BAT_COUNT,
  batFlight,
  brewGlow,
  CANDLE_SHADOW_FIGURES,
  CAULDRON_BELLY_R,
  CAULDRON_BUBBLE_SFX,
  CAULDRON_BUBBLES,
  CAULDRON_DRAWN,
  CAULDRON_RIM_R,
  CAULDRON_RIM_Y,
  CAULDRON_SCALE,
  candleFlicker,
  candleGlowColumn,
  candleLightPool,
  candleMist,
  candleShadows,
  cauldronBubble,
  ghostOrbit,
  haloSlotFree,
  lookFade,
  PRANK_CAP,
  PRANK_FLIGHT_SEC,
  PRANK_SPLAT_SFX,
  prankArc,
  TOY_CAP,
  toyEffectOf,
} from './seasonal_toys_fx_core';

/** The pooled particle calls this layer uses (vfx.ts, through ScarecrowFx's seam). */
export interface ToyParticles {
  groundPuff(at: THREE.Vector3, power: number, color: number): void;
  toyMote(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    color: number,
    size: number,
    life: number,
    gravity: number,
    kind: 'glow' | 'spark' | 'smoke' | 'wisp' | 'debris',
    rate?: number,
    dt?: number,
  ): void;
}

interface ToyAuraLike {
  id: string;
  kind?: string;
  remaining?: number;
  duration?: number;
  value2?: number;
  value3?: number;
}

export interface ToyEntityLike {
  pos: { x: number; y: number; z: number };
  facing: number;
  dead: boolean;
  kind?: string;
  stealthed?: boolean;
  ghost?: boolean;
  mountKey?: string | null;
  objectItemId?: string | null;
  auras?: readonly ToyAuraLike[];
}

/** The renderer's body-tint seam (CharacterVisual.setAuraGlow): a drinker's green glow. */
export type ToyBodyTint = (entityId: number, color: number, strength: number) => void;

interface ToyCueLike {
  fx: string;
  x: number;
  z: number;
  ability?: string;
  sourceId?: number;
  targetId?: number;
}

/** One toy look's per-body state (keyed by entity id and effect). */
interface LookState {
  born: number;
  seen: number;
  spotY: number;
  /** The bats' anchor (where the sack opened). */
  ax: number;
  ay: number;
  az: number;
  looped: boolean;
  phase: number;
}

interface Flight {
  sourceId: number;
  targetId: number;
  start: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
}

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const TWIN_SEC = 3;
const HALO_CAP = 24;
/** Below this a halo is invisible: it takes no slot. */
const HALO_MIN_OPACITY = 0.005;
const BAT_COLOR = 0x1a1220;
/** The candle cluster's drawn size against its authored one. */
const CANDLE_SCALE = 1.6;
/** Yards the toys' props are pulled toward the eye through the grass (ground_decal_pull.ts). */
const TOY_PROP_PULL = 0.7;
/** The brew's green and a drinker's glow. */
const BREW_COLOR = 0x5cff6a;
const BREW_DEEP = 0x1e9e3a;
/** A drinker's body tint: a deeper green than the brew, so the wash keeps the body's own
 *  shading instead of flattening it to a lime silhouette. */
const BREW_TINT = 0x2fbf45;
/** The shadows' ink: near-black with a cold violet cast, so they read as shadow, not mud. */
const SHADOW_INK = new THREE.Color(0x0a0612);
const PULP = [0xff8a1a, 0xffb347, 0xe0761c, 0xfff0b0] as const;
const m4 = new THREE.Matrix4();
const q4 = new THREE.Quaternion();
const q5 = new THREE.Quaternion();
const q6 = new THREE.Quaternion();
const FWD = new THREE.Vector3(0, 0, 1);
const s4 = new THREE.Vector3();
const p4 = new THREE.Vector3();
const e4 = new THREE.Euler();
const v1 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const WHITE = new THREE.Color(1, 1, 1);
const tint = new THREE.Color();

/** Paint a geometry one vertex colour per vertex from `fn(position)`. */
function paint(geo: THREE.BufferGeometry, fn: (x: number, y: number, z: number) => number[]): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const [r, g, b] = fn(pos.getX(i), pos.getY(i), pos.getZ(i));
    col[i * 3] = r;
    col[i * 3 + 1] = g;
    col[i * 3 + 2] = b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

/** Merge parts that each carry position, normal, uv and color. */
function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  const out = mergeGeometries(flat, false) ?? new THREE.BufferGeometry();
  for (const g of parts) g.dispose();
  for (const g of flat) g.dispose();
  out.computeBoundingSphere();
  return out;
}

/** The little ghost: a round head over a flowing body whose hem ripples, two soft dark
 *  eyes and an "o" of a mouth (dark, so the additive body shows them as holes), bright at
 *  the crown and fading to nothing at the hem. Its front faces +Z. */
function ghostGeometry(): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const n = 30;
  for (let i = 0; i <= n; i++) {
    const u = i / n; // 0 crown, 1 hem
    const y = 1 - u;
    const r =
      u < 0.32
        ? 0.3 * Math.sin((u / 0.32) * (Math.PI / 2)) ** 0.8
        : 0.3 + 0.1 * ((u - 0.32) / 0.68) ** 1.4 - 0.025 * Math.sin((u - 0.32) * 9);
    pts.push(new THREE.Vector2(Math.max(0.001, r), y));
  }
  const geo = new THREE.LatheGeometry(pts, 48);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (y < 0.25) {
      // the hem: a scalloped ripple, longer tails swept back
      const a = Math.atan2(x, z);
      const k = (0.25 - y) / 0.25;
      pos.setY(i, y - k * (0.07 * Math.sin(a * 6) + 0.05 + 0.06 * Math.max(0, -Math.cos(a))));
    }
  }
  geo.computeVertexNormals();
  const eye = (x: number, y: number, z: number, cx: number, cy: number, rx: number, ry: number) => {
    if (z < 0.1) return 1;
    const dx = (x - cx) / rx;
    const dy = (y - cy) / ry;
    const d = Math.sqrt(dx * dx + dy * dy);
    return Math.min(1, Math.max(0, (d - 0.65) / 0.35));
  };
  paint(geo, (x, y, z) => {
    const holes =
      eye(x, y, z, -0.1, 0.8, 0.055, 0.075) *
      eye(x, y, z, 0.1, 0.8, 0.055, 0.075) *
      eye(x, y, z, 0, 0.64, 0.05, 0.055);
    const lift = Math.min(1, Math.max(0, (y + 0.05) / 0.95)) ** 0.9;
    const rim = 0.55 + 0.45 * lift;
    return [0.62 * rim * holes, 0.82 * rim * holes, 1.0 * rim * holes];
  });
  return geo;
}

/** A bat's body (a dark furred spindle with two pointed ears), front +Z. */
function batBodyGeometry(): THREE.BufferGeometry {
  const body = new THREE.SphereGeometry(0.07, 10, 8);
  body.scale(0.8, 0.75, 1.5);
  const earL = new THREE.ConeGeometry(0.025, 0.07, 4);
  earL.translate(-0.03, 0.07, 0.07);
  const earR = new THREE.ConeGeometry(0.025, 0.07, 4);
  earR.translate(0.03, 0.07, 0.07);
  return merged(
    [body, earL, earR].map((g) => {
      paint(g, () => [1, 1, 1]);
      return g;
    }),
  );
}

/** One bat wing (+X side; the left is its mirror): a membrane stretched over three finger
 *  bones with a scalloped trailing edge, hinged at the body (x = 0). */
function batWingGeometry(side: 1 | -1): THREE.BufferGeometry {
  // leading edge points, then the scallops' points on the trailing edge
  const lead = [
    [0.04, 0.0, 0.05],
    [0.18, 0.04, 0.06],
    [0.32, 0.02, 0.02],
    [0.42, -0.01, -0.03],
  ];
  const trail = [
    [0.04, 0.0, -0.06],
    [0.14, -0.01, -0.1],
    [0.24, 0.0, -0.08],
    [0.33, -0.01, -0.11],
    [0.42, -0.01, -0.03],
  ];
  const v: number[] = [];
  const tri = (a: number[], b: number[], c: number[]) => {
    for (const p of [a, b, c]) v.push(p[0] * side, p[1], p[2]);
  };
  tri(lead[0], trail[0], trail[1]);
  tri(lead[0], trail[1], lead[1]);
  tri(lead[1], trail[1], trail[2]);
  tri(lead[1], trail[2], lead[2]);
  tri(lead[2], trail[2], trail[3]);
  tri(lead[2], trail[3], lead[3]);
  tri(lead[3], trail[3], trail[4]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  geo.computeVertexNormals();
  return geo;
}

/** The candle's three shadow shapes, side by side in one atlas (cells in
 *  CANDLE_SHADOW_FIGURES order): a sitting cat, a bat on the wing, a witch with her hat and
 *  broom. White on transparent (the ink is the material's), feet at the cell's BOTTOM edge
 *  (the end nearest the flame), the edges softened the way a candle's shadow is. Drawn
 *  from paths, no random: every client paints the same atlas. */
function shadowAtlasTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = S * 3;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, S * 3, S);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#fff';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.filter = 'blur(2.5px)';
    // the cat: sitting side-on, ears up, tail curled round its paws
    ctx.beginPath();
    ctx.ellipse(118, 186, 44, 58, -0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(146, 112, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(126, 96);
    ctx.lineTo(132, 58);
    ctx.lineTo(150, 88);
    ctx.closePath();
    ctx.moveTo(150, 86);
    ctx.lineTo(170, 56);
    ctx.lineTo(174, 100);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(122, 242, 58, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(140, 190, 16, 56);
    ctx.lineWidth = 15;
    ctx.beginPath();
    ctx.moveTo(84, 236);
    ctx.bezierCurveTo(26, 240, 18, 176, 46, 150);
    ctx.bezierCurveTo(60, 138, 70, 152, 60, 160);
    ctx.stroke();
    // the bat: wings spread wide, scalloped trailing edges, pointed ears
    ctx.save();
    ctx.translate(S, 0);
    const wing = (side: number) => {
      ctx.beginPath();
      ctx.moveTo(128, 118);
      ctx.quadraticCurveTo(128 + side * 60, 70, 128 + side * 118, 92);
      ctx.lineTo(128 + side * 104, 150);
      ctx.quadraticCurveTo(128 + side * 92, 128, 128 + side * 78, 160);
      ctx.quadraticCurveTo(128 + side * 66, 138, 128 + side * 50, 168);
      ctx.quadraticCurveTo(128 + side * 38, 146, 128 + side * 20, 172);
      ctx.lineTo(128, 172);
      ctx.closePath();
      ctx.fill();
    };
    wing(1);
    wing(-1);
    ctx.beginPath();
    ctx.ellipse(128, 150, 17, 34, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(128, 110, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(116, 104);
    ctx.lineTo(114, 80);
    ctx.lineTo(126, 98);
    ctx.closePath();
    ctx.moveTo(130, 98);
    ctx.lineTo(142, 80);
    ctx.lineTo(140, 104);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // the witch: side-on in a ragged cloak, hooked nose, tall crooked hat, broom in hand
    ctx.save();
    ctx.translate(S * 2, 0);
    ctx.beginPath();
    ctx.moveTo(112, 122);
    ctx.lineTo(150, 122);
    ctx.quadraticCurveTo(170, 190, 182, 250);
    ctx.lineTo(166, 240);
    ctx.lineTo(152, 252);
    ctx.lineTo(136, 240);
    ctx.lineTo(118, 252);
    ctx.lineTo(102, 240);
    ctx.lineTo(80, 250);
    ctx.quadraticCurveTo(96, 186, 112, 122);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(132, 104, 19, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(146, 96);
    ctx.lineTo(170, 112);
    ctx.lineTo(146, 112);
    ctx.closePath();
    ctx.moveTo(140, 118);
    ctx.lineTo(156, 128);
    ctx.lineTo(144, 126);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(130, 86, 44, 8, -0.08, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(108, 84);
    ctx.quadraticCurveTo(122, 46, 132, 22);
    ctx.quadraticCurveTo(150, 14, 164, 30);
    ctx.quadraticCurveTo(148, 30, 146, 44);
    ctx.quadraticCurveTo(148, 64, 154, 84);
    ctx.closePath();
    ctx.fill();
    // the broom: a crooked stave held across her, a flared brush of twigs at its foot
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(190, 130);
    ctx.lineTo(84, 232);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(96, 222);
    ctx.lineTo(48, 236);
    ctx.lineTo(56, 252);
    ctx.lineTo(76, 254);
    ctx.lineTo(104, 232);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/** One shadow's quad, laid flat on the ground: foot at the origin, the figure running out
 *  along local -Z (its length) and across local X (its width), its UVs on atlas `cell`. */
function shadowGeometry(cell: number): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(1, 1, 1, 1);
  geo.translate(0, 0.5, 0);
  geo.rotateX(-Math.PI / 2);
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setX(i, (cell + uv.getX(i)) / 3);
  uv.needsUpdate = true;
  return geo;
}

/** The shadows' material: the atlas as their shape, the ink as their colour, each
 *  instance's darkness in its instance colour (red channel: 0 is no shadow, 1 full ink).
 *  Alpha-blended: a shadow takes light away, which an additive glow never can. */
function shadowMaterial(map: THREE.Texture | null): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    map: map ?? undefined,
    transparent: true,
    depthWrite: false,
    fog: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.shadowInk = { value: SHADOW_INK };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform vec3 shadowInk;`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>\n#ifdef USE_COLOR\n  diffuseColor.a *= vColor.r;\n#endif\n  diffuseColor.rgb = shadowInk;`,
      );
  };
  mat.customProgramCacheKey = () => 'seasonal-toys-candle-shadow';
  // read through tall meadow grass, still hugging the ground on screen
  pullDecalTowardCamera(mat, 'seasonal-toys-candle-shadow');
  return mat;
}

/** The Gurglegreen Cauldron: a squat, round-bellied iron pot on three stubby claw feet,
 *  a thick rolled rim, two ring handles and a wooden ladle hooked over the lip. Its brew
 *  and its bubbles are the additive pools' (brewGeometry, bubbleGeometry). Base at y = 0. */
function cauldronGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const profile = [
    [0.0, 0.1],
    [0.16, 0.1],
    [0.3, 0.16],
    [0.38, 0.27],
    [CAULDRON_BELLY_R, 0.36],
    [0.35, 0.45],
    [0.3, 0.49],
    [0.29, 0.5],
    [0.27, 0.48],
    [0.25, 0.44],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const pot = new THREE.LatheGeometry(profile, 40);
  const pp = pot.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pp.count; i++) {
    // hammered iron: shallow dents round the belly
    const x = pp.getX(i);
    const z = pp.getZ(i);
    const y = pp.getY(i);
    const a = Math.atan2(x, z);
    const dent = 1 - 0.018 * Math.max(0, Math.sin(a * 7 + y * 9)) * Math.sin(Math.PI * y);
    pp.setXYZ(i, x * dent, y, z * dent);
  }
  pot.computeVertexNormals();
  paint(pot, (x, y, z) => {
    const a = Math.atan2(x, z);
    const soot = 0.55 + 0.45 * Math.min(1, Math.max(0, (y - 0.12) / 0.3));
    const sheen = 0.9 + 0.1 * Math.sin(a * 3 + y * 6);
    // a green crust where the brew has boiled over the lip and run down the belly
    const drip = y > 0.3 && Math.sin(a * 5) > 0.75 ? (y - 0.3) * 3 : 0;
    return [
      (0.13 + 0.02 * sheen) * soot,
      (0.12 + 0.02 * sheen) * soot + 0.25 * drip,
      (0.13 + 0.03 * sheen) * soot + 0.05 * drip,
    ];
  });
  parts.push(pot);
  const rim = new THREE.TorusGeometry(CAULDRON_RIM_R, 0.035, 8, 40);
  rim.rotateX(Math.PI / 2);
  rim.translate(0, CAULDRON_RIM_Y, 0);
  paint(rim, () => [0.2, 0.19, 0.2]);
  parts.push(rim);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + Math.PI / 6;
    const leg = new THREE.CylinderGeometry(0.035, 0.05, 0.16, 6, 1);
    leg.translate(Math.sin(a) * 0.24, 0.07, Math.cos(a) * 0.24);
    paint(leg, () => [0.09, 0.085, 0.09]);
    parts.push(leg);
    const claw = new THREE.SphereGeometry(0.05, 8, 6);
    claw.scale(1.2, 0.6, 1.4);
    claw.translate(Math.sin(a) * 0.27, 0.02, Math.cos(a) * 0.27);
    paint(claw, () => [0.08, 0.075, 0.08]);
    parts.push(claw);
  }
  for (const side of [1, -1]) {
    const ring = new THREE.TorusGeometry(0.075, 0.016, 6, 16);
    ring.rotateY(Math.PI / 2);
    ring.translate(side * 0.39, 0.4, 0);
    paint(ring, () => [0.18, 0.17, 0.18]);
    parts.push(ring);
  }
  // a wooden ladle hooked over the lip at the back, its bowl down in the brew
  const handle = new THREE.CylinderGeometry(0.014, 0.016, 0.62, 6, 1);
  handle.rotateX(-0.55);
  handle.translate(0.06, CAULDRON_RIM_Y + 0.18, -0.2);
  paint(handle, (_x, y) => {
    const k = 0.8 + 0.2 * Math.sin(y * 40);
    return [0.42 * k, 0.27 * k, 0.14 * k];
  });
  parts.push(handle);
  return merged(parts);
}

/** The brew: a disc just under the rim, bright at its heart and deep green at its edge
 *  (additive: the flame pool's material). Its bubbles are their own pool. */
function brewGeometry(): THREE.BufferGeometry {
  const disc = new THREE.CircleGeometry(CAULDRON_RIM_R - 0.02, 32);
  disc.rotateX(-Math.PI / 2);
  disc.translate(0, CAULDRON_RIM_Y - 0.035, 0);
  paint(disc, (x, _y, z) => {
    const r = Math.hypot(x, z) / (CAULDRON_RIM_R - 0.02);
    const k = 1 - 0.65 * r * r;
    return [0.18 * k, 0.9 * k, 0.28 * k];
  });
  return disc;
}

/** One brew bubble: a small round dome, brightest at its rim (additive, tinted per use). */
function bubbleGeometry(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  paint(g, (_x, y) => {
    const rim = 0.45 + 0.55 * (1 - y);
    return [0.35 * rim, 1.0 * rim, 0.45 * rim];
  });
  return g;
}

/** The Wanderwisp Lantern's frame: a small square iron lantern on a footed base, four
 *  corner posts, a peaked cap and a carrying ring. Its pale glass and the wisp inside are
 *  the glow pool's (lanternGlowGeometry). Base at y = 0. */
function lanternFrameGeometry(): THREE.BufferGeometry {
  const iron = () => [0.11, 0.1, 0.12];
  const parts: THREE.BufferGeometry[] = [];
  const base = new THREE.BoxGeometry(0.26, 0.04, 0.26);
  base.translate(0, 0.02, 0);
  parts.push(base);
  const foot = new THREE.BoxGeometry(0.2, 0.03, 0.2);
  foot.translate(0, 0.055, 0);
  parts.push(foot);
  for (const [x, z] of [
    [-0.1, -0.1],
    [0.1, -0.1],
    [-0.1, 0.1],
    [0.1, 0.1],
  ]) {
    const post = new THREE.CylinderGeometry(0.012, 0.012, 0.3, 5, 1);
    post.translate(x, 0.07 + 0.15, z);
    parts.push(post);
  }
  const rail = new THREE.BoxGeometry(0.23, 0.025, 0.23);
  rail.translate(0, 0.37, 0);
  parts.push(rail);
  const cap = new THREE.ConeGeometry(0.19, 0.14, 4, 1);
  cap.rotateY(Math.PI / 4);
  cap.translate(0, 0.45, 0);
  parts.push(cap);
  const ring = new THREE.TorusGeometry(0.05, 0.01, 5, 14);
  ring.translate(0, 0.56, 0);
  parts.push(ring);
  for (const g of parts) paint(g, iron);
  return merged(parts);
}

/** The lantern's glass and the wisp inside it: a pale pane box, brightest at its heart,
 *  and a small soft flame (additive: the glow pool's material). */
function lanternGlowGeometry(): THREE.BufferGeometry {
  const pane = new THREE.BoxGeometry(0.18, 0.28, 0.18, 2, 3, 2);
  pane.translate(0, 0.22, 0);
  paint(pane, (_x, y) => {
    const k = 1 - Math.min(1, Math.abs(y - 0.22) / 0.16) * 0.5;
    return [0.12 * k, 0.26 * k, 0.36 * k];
  });
  const wisp = new THREE.SphereGeometry(0.05, 10, 8);
  wisp.scale(1, 1.5, 1);
  wisp.translate(0, 0.21, 0);
  paint(wisp, () => [0.7, 0.92, 1.0]);
  return merged([pane, wisp]);
}

/** The Murmurwick candles: three pale grey-green wax candles of different heights on an
 *  old iron dish, drips frozen down their sides, black wicks. Flames ride the flame pool. */
const CANDLE_TOPS: readonly [number, number, number][] = [
  [0, 0.34, 0.012],
  [0.12, 0.2, -0.05],
  [-0.09, 0.16, 0.08],
];
function candleGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const dish = new THREE.CylinderGeometry(0.26, 0.22, 0.04, 24, 1);
  dish.translate(0, 0.02, 0);
  paint(dish, () => [0.1, 0.09, 0.085]);
  parts.push(dish);
  const rim = new THREE.TorusGeometry(0.25, 0.015, 6, 24);
  rim.rotateX(Math.PI / 2);
  rim.translate(0, 0.04, 0);
  paint(rim, () => [0.16, 0.14, 0.12]);
  parts.push(rim);
  CANDLE_TOPS.forEach(([x, h, z], k) => {
    const r = k === 0 ? 0.06 : 0.045;
    const wax = new THREE.CylinderGeometry(r * 0.92, r, h, 14, 4);
    const wp = wax.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < wp.count; i++) {
      const vx = wp.getX(i);
      const vz = wp.getZ(i);
      const vy = wp.getY(i);
      const a = Math.atan2(vx, vz);
      const drip = 1 + 0.09 * Math.max(0, Math.sin(a * 5 + k)) * (0.5 - vy / h);
      wp.setXYZ(i, vx * drip, vy, vz * drip);
    }
    wax.computeVertexNormals();
    wax.translate(x, 0.04 + h / 2, z);
    paint(wax, (_x, y) => {
      const k2 = 0.8 + 0.2 * Math.min(1, (y - 0.04) / h);
      return [0.66 * k2, 0.72 * k2, 0.58 * k2];
    });
    parts.push(wax);
    const wick = new THREE.CylinderGeometry(0.006, 0.006, 0.04, 4, 1);
    wick.translate(x, 0.04 + h + 0.015, z);
    paint(wick, () => [0.04, 0.035, 0.03]);
    parts.push(wick);
  });
  return merged(parts);
}

/** A candle flame: a teardrop, white-hot at its root, cold green to its tip (additive). */
function flameGeometry(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 10, 8);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const sh = 1 - 0.7 * Math.max(0, y);
    p.setXYZ(i, p.getX(i) * 0.032 * sh, 0.05 + y * 0.075 + 0.02 * y * y, p.getZ(i) * 0.032 * sh);
  }
  paint(g, (_x, y) => {
    const k = Math.min(1, Math.max(0, (y - 0.0) / 0.12));
    return [0.55 - 0.4 * k, 1.0 - 0.15 * k, 0.6 - 0.35 * k];
  });
  return g;
}

/** The mist's alpha: a soft disc broken into drifting curls (grey on opaque black: an
 *  alpha map reads the green channel). Deterministic: a fixed pattern, no random. */
function mistTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const mid = size / 2;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, size, size);
    const g = ctx.createRadialGradient(mid, mid, 0, mid, mid, mid);
    g.addColorStop(0, 'rgba(255,255,255,0.75)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 46; i++) {
      const a = i * 2.39996;
      const r = Math.sqrt((i + 0.5) / 46) * mid * 0.8;
      const x = mid + Math.cos(a) * r;
      const y = mid + Math.sin(a) * r;
      const rad = 14 + ((i * 37) % 23);
      const c = ctx.createRadialGradient(x, y, 0, x, y, rad);
      c.addColorStop(0, 'rgba(255,255,255,0.35)');
      c.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = c;
      ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/** A soft round halo (white on transparent, tinted per use). */
function haloTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const mid = size / 2;
    const g = ctx.createRadialGradient(mid, mid, 0, mid, mid, mid);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.5)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  return new THREE.CanvasTexture(canvas);
}

/** An instanced pool with every instance hidden and coloured before its first link. */
function pool(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  cap: number,
  name: string,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, mat, cap);
  for (let i = 0; i < cap; i++) {
    mesh.setMatrixAt(i, HIDDEN);
    mesh.setColorAt(i, WHITE);
  }
  mesh.frustumCulled = false;
  mesh.name = name;
  return mesh;
}

/** A kit-part pool (the decor kit's small carved pumpkin, the one the prank throws): one InstancedMesh per part
 *  over the kit's own geometry and materials, behind its own gate. */
class KitPool {
  meshes: THREE.InstancedMesh[] | null = null;
  private parts: unknown = null;
  private group: THREE.Group | null = null;
  private ready = false;
  used = 0;

  constructor(
    private readonly node: 'pumpkin_small',
    private readonly cap: number,
    private readonly gate: ((t: THREE.Object3D) => Promise<unknown>) | undefined,
    private readonly disposed: () => boolean,
  ) {}

  /** The pool when linked, else null (the first ask builds it once the kit is loaded). */
  take(root: THREE.Object3D | null): THREE.InstancedMesh[] | null {
    const parts = gourdlightAssets()?.decor[this.node];
    if (this.meshes && parts === this.parts) return this.ready ? this.meshes : null;
    this.release();
    if (!parts || parts.length === 0 || !root) return null;
    const group = new THREE.Group();
    group.name = `seasonal-toys-${this.node}`;
    this.meshes = parts.map((part) => {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, this.cap);
      for (let i = 0; i < this.cap; i++) mesh.setMatrixAt(i, HIDDEN);
      mesh.frustumCulled = false;
      group.add(mesh);
      return mesh;
    });
    this.parts = parts;
    this.group = group;
    const mine = group;
    const retired = () => this.disposed() || this.group !== mine;
    void attachSceneGroupGated(root, group, this.gate, retired)
      .then(() => {
        if (!retired()) this.ready = true;
      })
      .catch(() => {});
    return null;
  }

  place(index: number, matrix: THREE.Matrix4): void {
    if (!this.meshes) return;
    for (const m of this.meshes) m.setMatrixAt(index, matrix);
  }

  /** Hide the instances past `used` and flag the buffers for upload. */
  finish(twins: boolean): void {
    if (!this.meshes || !this.ready) return;
    for (const m of this.meshes) {
      for (let i = this.used; i < this.cap; i++) m.setMatrixAt(i, HIDDEN);
      m.instanceMatrix.needsUpdate = true;
      m.visible = twins || this.used > 0;
    }
  }

  release(): void {
    if (this.meshes) for (const m of this.meshes) m.dispose();
    this.group?.removeFromParent();
    this.meshes = null;
    this.group = null;
    this.parts = null;
    this.ready = false;
  }
}

/** The standing cauldron's click volume (its art is this layer's, the ground object is a
 *  pick volume only: pick_only_objects.ts). Invisible, so it costs no draw and still takes
 *  the click. A CLOSED cylinder, both caps on and both sides raycastable, wrapping the drawn
 *  pot (CAULDRON_DRAWN) with a little grace: round 10's was open-ended and front-sided, so a
 *  click on the brew from the usual camera (down through the open top, onto culled inner
 *  faces) missed, and only a click on the pot's outer side landed. */
export function buildToyCauldronPickBody(): { group: THREE.Group; height: number } {
  const group = new THREE.Group();
  group.name = 'GurglegreenCauldronPick';
  const height = CAULDRON_DRAWN.rimHeight + 0.15;
  const radius = CAULDRON_DRAWN.bellyRadius + 0.12;
  const proxy = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, height, 16, 1, false),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  );
  proxy.position.y = height / 2;
  proxy.visible = false;
  group.add(proxy);
  return { group, height };
}

export class SeasonalToysFx {
  private root: THREE.Group | null = null;
  private rootBorn = 0;
  private time = 0;
  private dt = 1 / 60;
  private frame = 0;
  private reduced = false;
  private disposed = false;
  private readonly owned: { dispose(): void }[] = [];
  private ghosts: THREE.InstancedMesh | null = null;
  private bats: THREE.InstancedMesh[] = [];
  private candles: THREE.InstancedMesh | null = null;
  private flames: THREE.InstancedMesh | null = null;
  private mists: THREE.InstancedMesh | null = null;
  /** The candle's light pool (additive) and its three shadow pools (one per figure). */
  private lightPools: THREE.InstancedMesh | null = null;
  private shadows: THREE.InstancedMesh[] = [];
  /** The cauldron, its brew and the bubbles on it. */
  private cauldrons: THREE.InstancedMesh | null = null;
  private brews: THREE.InstancedMesh | null = null;
  private bubbles: THREE.InstancedMesh | null = null;
  private halos: THREE.Sprite[] = [];
  private ghostsUsed = 0;
  private batsUsed = 0;
  private candlesUsed = 0;
  private flamesUsed = 0;
  private mistsUsed = 0;
  private lightPoolsUsed = 0;
  private shadowsUsed = 0;
  private cauldronsUsed = 0;
  private bubblesUsed = 0;
  private halosUsed = 0;
  private lanternFrames: THREE.InstancedMesh | null = null;
  private lanternGlows: THREE.InstancedMesh | null = null;
  private lanternsUsed = 0;
  private readonly pumpkins: KitPool;
  private readonly looks = new Map<string, LookState>();
  private readonly flights: Flight[] = [];
  private readonly at = new THREE.Vector3();
  /** Drinkers this layer tinted, by entity id, with the frame it last did. */
  private readonly tinted = new Map<number, number>();

  constructor(
    private readonly scene: THREE.Object3D,
    private readonly particles: ToyParticles,
    private readonly groundY: (x: number, z: number) => number,
    private readonly entity: (id: number) => ToyEntityLike | undefined,
    private readonly compileGate?: (target: THREE.Object3D) => Promise<unknown>,
    private readonly audio: () => SpatialAudioSink | null = () => null,
    private readonly tint: ToyBodyTint = () => {},
  ) {
    const gone = () => this.disposed;
    this.pumpkins = new KitPool('pumpkin_small', PRANK_CAP, compileGate, gone);
  }

  /** Whether a spellfxAt cue is a toy's (this layer claims it: no generic burst). */
  static claims(ability: string | undefined): boolean {
    return ability?.startsWith(TOY_FX_ABILITY_PREFIX) === true;
  }

  /** Built on the first sight of a toy: a world that never plays one links nothing. */
  private ensureRoot(): THREE.Group {
    if (this.root) return this.root;
    const root = new THREE.Group();
    root.name = 'seasonal-toys-fx';
    const own = <T extends { dispose(): void }>(x: T): T => {
      this.owned.push(x);
      return x;
    };
    const ghostMat = own(
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    this.ghosts = pool(own(ghostGeometry()), ghostMat, TOY_CAP, 'seasonal-toys-ghosts');
    root.add(this.ghosts);
    const batMat = own(new THREE.MeshBasicMaterial({ color: BAT_COLOR, side: THREE.DoubleSide }));
    const bodyGeo = own(batBodyGeometry());
    this.bats = [
      pool(bodyGeo, batMat, BAT_CAP, 'seasonal-toys-bat-bodies'),
      pool(own(batWingGeometry(-1)), batMat, BAT_CAP, 'seasonal-toys-bat-wings-l'),
      pool(own(batWingGeometry(1)), batMat, BAT_CAP, 'seasonal-toys-bat-wings-r'),
    ];
    for (const m of this.bats) root.add(m);
    const lambert = own(new THREE.MeshLambertMaterial({ vertexColors: true }));
    // the toys set down on the ground (the candle's dish, the lantern, the cauldron) stand
    // in the meadow's tall grass: their depth comes forward through it (ground_decal_pull.ts)
    pullDecalTowardCamera(lambert, 'seasonal-toys-props', TOY_PROP_PULL);
    this.candles = pool(own(candleGeometry()), lambert, TOY_CAP, 'seasonal-toys-candles');
    root.add(this.candles);
    this.cauldrons = pool(own(cauldronGeometry()), lambert, TOY_CAP, 'seasonal-toys-cauldrons');
    root.add(this.cauldrons);
    this.lanternFrames = pool(
      own(lanternFrameGeometry()),
      lambert,
      TOY_CAP,
      'seasonal-toys-lanterns',
    );
    root.add(this.lanternFrames);
    const flameMat = own(
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    pullDecalTowardCamera(flameMat, 'seasonal-toys-flames', TOY_PROP_PULL);
    this.flames = pool(own(flameGeometry()), flameMat, TOY_CAP * 3, 'seasonal-toys-flames');
    root.add(this.flames);
    this.lanternGlows = pool(
      own(lanternGlowGeometry()),
      flameMat,
      TOY_CAP,
      'seasonal-toys-lantern-glows',
    );
    root.add(this.lanternGlows);
    this.brews = pool(own(brewGeometry()), flameMat, TOY_CAP, 'seasonal-toys-brews');
    root.add(this.brews);
    this.bubbles = pool(
      own(bubbleGeometry()),
      flameMat,
      TOY_CAP * CAULDRON_BUBBLES,
      'seasonal-toys-bubbles',
    );
    root.add(this.bubbles);
    const mistTex = mistTexture();
    if (mistTex) own(mistTex);
    const mistMat = own(
      new THREE.MeshBasicMaterial({
        color: 0x4cff7a,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        alphaMap: mistTex ?? undefined,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
    );
    const groundDisc = own(new THREE.CircleGeometry(1, 40));
    groundDisc.rotateX(-Math.PI / 2);
    this.mists = pool(groundDisc, mistMat, TOY_CAP, 'seasonal-toys-mists');
    root.add(this.mists);
    const halo = haloTexture();
    if (halo) own(halo);
    // the candle's pool of light on the ground: the halo's soft falloff, laid flat, warm
    // gold-green per instance (additive), drawn BEFORE the shadows it holds
    const poolMat = own(
      new THREE.MeshBasicMaterial({
        map: halo ?? undefined,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      }),
    );
    pullDecalTowardCamera(poolMat, 'seasonal-toys-light-pool');
    pullDecalTowardCamera(mistMat, 'seasonal-toys-mist');
    this.lightPools = pool(groundDisc, poolMat, TOY_CAP, 'seasonal-toys-light-pools');
    this.lightPools.renderOrder = 1;
    root.add(this.lightPools);
    // the dancing shadows: one pool per figure over one atlas and one material
    const atlas = shadowAtlasTexture();
    if (atlas) own(atlas);
    const inkMat = own(shadowMaterial(atlas));
    this.shadows = CANDLE_SHADOW_FIGURES.map((figure, cell) => {
      const m = pool(own(shadowGeometry(cell)), inkMat, TOY_CAP, `seasonal-toys-shadow-${figure}`);
      m.renderOrder = 2;
      root.add(m);
      return m;
    });
    for (let i = 0; i < HALO_CAP; i++) {
      const sprite = new THREE.Sprite(
        own(
          new THREE.SpriteMaterial({
            map: halo ?? undefined,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            opacity: 0,
          }),
        ),
      );
      sprite.visible = i === 0; // the program twin (opacity 0)
      sprite.scale.setScalar(0.001);
      root.add(sprite);
      this.halos.push(sprite);
    }
    this.root = root;
    this.rootBorn = this.time;
    void attachSceneGroupGated(this.scene, root, this.compileGate, () => this.disposed).catch(
      () => {},
    );
    return root;
  }

  /** A toy's moment (the sim's spellfxAt cue). True: claimed, no generic burst. */
  handleCue(ev: ToyCueLike): boolean {
    if (this.disposed || !SeasonalToysFx.claims(ev.ability)) return false;
    this.ensureRoot();
    const effect = ev.ability?.slice(TOY_FX_ABILITY_PREFIX.length);
    const y = this.groundY(ev.x, ev.z);
    const src = ev.sourceId !== undefined ? this.entity(ev.sourceId) : undefined;
    if (src && !this.drawable(src)) return true;
    const sy = src ? src.pos.y : y;
    if (effect === 'prank' && ev.sourceId !== undefined && ev.targetId !== undefined) {
      if (this.flights.length >= PRANK_CAP) this.flights.shift();
      const from = new THREE.Vector3(
        (src?.pos.x ?? ev.x) + Math.sin(src?.facing ?? 0) * 0.35,
        sy + 1.55,
        (src?.pos.z ?? ev.z) + Math.cos(src?.facing ?? 0) * 0.35,
      );
      this.flights.push({
        sourceId: ev.sourceId,
        targetId: ev.targetId,
        start: this.time,
        from,
        to: new THREE.Vector3(ev.x, y + 1.85, ev.z),
      });
    } else if (effect === 'lantern') {
      for (let i = 0; i < 14; i++) {
        const a = i * 0.45;
        this.particles.toyMote(
          ev.x,
          sy + 0.3,
          ev.z,
          Math.cos(a) * 0.9,
          0.9 + (i % 4) * 0.3,
          Math.sin(a) * 0.9,
          0xbfe6ff,
          0.35,
          1.3,
          -0.3,
          'wisp',
        );
      }
    } else if (effect === 'bats') {
      this.particles.groundPuff(this.at.set(ev.x, sy, ev.z), 0.6, 0x2a2230);
      for (let i = 0; i < 10; i++) {
        const a = i * 0.63;
        this.particles.toyMote(
          ev.x,
          sy + 1.0,
          ev.z,
          Math.cos(a) * 1.4,
          1.6,
          Math.sin(a) * 1.4,
          0x3a2a40,
          0.22,
          0.9,
          1.5,
          'debris',
        );
      }
    } else if (effect === 'candle') {
      // the wick catches: a soft green flare and a ring of motes thrown off the flames,
      // then the shadows stand up out of the dark round the dish
      for (let i = 0; i < 18; i++) {
        const a = i * 0.35;
        this.particles.toyMote(
          ev.x,
          sy + 0.35,
          ev.z,
          Math.cos(a) * 1.1,
          0.6 + (i % 3) * 0.4,
          Math.sin(a) * 1.1,
          i % 3 === 0 ? 0xd8ffd0 : 0x55ff7a,
          0.3,
          1.1,
          -0.2,
          'glow',
        );
      }
      this.particles.groundPuff(this.at.set(ev.x, sy, ev.z), 0.8, 0x2f7a3e);
    } else if (effect === 'cauldron') {
      // set down with a slosh: green brew splashed up over the rim, a puff of steam, the
      // ground thumped under its feet
      const cy = y + CAULDRON_RIM_Y * CAULDRON_SCALE;
      this.particles.groundPuff(this.at.set(ev.x, y, ev.z), 1, 0x3c4a34);
      for (let i = 0; i < 26; i++) {
        const a = i * 0.24;
        const up = 1.6 + (i % 5) * 0.45;
        this.particles.toyMote(
          ev.x,
          cy,
          ev.z,
          Math.cos(a) * (0.6 + (i % 3) * 0.35),
          up,
          Math.sin(a) * (0.6 + (i % 3) * 0.35),
          i % 4 === 0 ? 0xd6ffd0 : BREW_COLOR,
          i % 3 === 0 ? 0.2 : 0.13,
          0.9,
          6.5,
          i % 3 === 0 ? 'glow' : 'debris',
        );
      }
      for (let i = 0; i < 6; i++) {
        const a = i * 1.05;
        this.particles.toyMote(
          ev.x + Math.cos(a) * 0.4,
          cy + 0.15,
          ev.z + Math.sin(a) * 0.4,
          Math.cos(a) * 0.25,
          0.9,
          Math.sin(a) * 0.25,
          0x9fe8a8,
          0.9,
          1.8,
          -0.05,
          'smoke',
        );
      }
    } else if (effect === 'cauldron_drink') {
      // the drinker's gulp: a burst of green bubbles off them, a flash of the glow and a
      // puff of green smoke the goblin body steps out of (round 11)
      const target = ev.targetId !== undefined ? this.entity(ev.targetId) : undefined;
      if (target && !this.drawable(target)) return true;
      const tx = target?.pos.x ?? ev.x;
      const ty = target?.pos.y ?? y;
      const tz = target?.pos.z ?? ev.z;
      for (let i = 0; i < 30; i++) {
        const a = i * 2.39996;
        const r = 0.25 + (i % 4) * 0.08;
        this.particles.toyMote(
          tx + Math.cos(a) * r,
          ty + 0.6 + (i % 6) * 0.22,
          tz + Math.sin(a) * r,
          Math.cos(a) * 0.5,
          1.2 + (i % 5) * 0.35,
          Math.sin(a) * 0.5,
          i % 5 === 0 ? 0xe4ffe0 : BREW_COLOR,
          0.12 + (i % 3) * 0.05,
          1.2,
          -0.6,
          'glow',
        );
      }
      this.particles.groundPuff(this.at.set(tx, ty, tz), 1, 0x3f9a4c);
      for (let i = 0; i < (this.reduced ? 5 : 10); i++) {
        const a = i * 0.628;
        this.particles.toyMote(
          tx + Math.cos(a) * 0.35,
          ty + 0.4 + (i % 3) * 0.45,
          tz + Math.sin(a) * 0.35,
          Math.cos(a) * 0.55,
          0.7,
          Math.sin(a) * 0.55,
          i % 2 === 0 ? 0x9fe8a8 : 0x5fc56c,
          1.0,
          1.3,
          -0.05,
          'smoke',
        );
      }
      this.halo(tx, ty + 1.2, tz, 3.2, 0.75, BREW_COLOR);
    }
    return true;
  }

  /** Before the frame's entity scan. */
  begin(dt: number, reducedMotion: boolean): void {
    if (this.disposed) return;
    this.time += dt;
    this.dt = dt;
    this.frame++;
    this.reduced = reducedMotion;
    this.ghostsUsed = 0;
    this.batsUsed = 0;
    this.candlesUsed = 0;
    this.flamesUsed = 0;
    this.mistsUsed = 0;
    this.lightPoolsUsed = 0;
    this.shadowsUsed = 0;
    this.cauldronsUsed = 0;
    this.bubblesUsed = 0;
    this.halosUsed = 0;
    this.lanternsUsed = 0;
    this.pumpkins.used = 0;
  }

  /** Per entity, per frame (ScarecrowFx's scan): its toy looks, if any, and a standing
   *  cauldron. Allocation-free for a body wearing none. */
  watch(e: ToyEntityLike, id: number): void {
    if (this.disposed) return;
    if (e.kind === 'object') {
      if (e.objectItemId === GURGLEGREEN_CAULDRON_ID && !e.dead) this.drawCauldron(e, id);
      return;
    }
    if (e.kind !== 'player' || !e.auras || e.auras.length === 0) return;
    for (const a of e.auras) {
      if (a.kind !== 'seasonal_cosmetic') continue;
      const effect = toyEffectOf(a.id);
      if (!effect || effect === 'prank') continue;
      if (!this.drawable(e)) return;
      this.ensureRoot();
      const key = `${id}:${effect}`;
      const remaining = Math.max(0, a.remaining ?? 0);
      const elapsed = Math.max(0, (a.duration ?? 0) - remaining);
      const st = this.lookState(key, e, id, elapsed, a.value2, a.value3);
      const fade = lookFade(elapsed, remaining);
      if (effect === 'lantern') this.drawLantern(e, a, st, fade);
      else if (effect === 'bats') this.drawBats(st, a.duration ?? 6);
      else if (effect === 'candle') this.drawCandle(a, st, fade, remaining);
      else if (effect === 'cauldron') this.drawBrew(e, id, st, elapsed);
    }
  }

  /** A look's per-body state, made on its first sight. */
  private lookState(
    key: string,
    e: ToyEntityLike,
    id: number,
    elapsed: number,
    spotX?: number,
    spotZ?: number,
  ): LookState {
    const known = this.looks.get(key);
    if (known) {
      known.seen = this.frame;
      return known;
    }
    const sx = spotX ?? e.pos.x;
    const sz = spotZ ?? e.pos.z;
    const near = Math.hypot(sx - e.pos.x, sz - e.pos.z) < 4;
    const st: LookState = {
      born: this.time - elapsed,
      seen: this.frame,
      spotY: near ? e.pos.y : this.groundY(sx, sz),
      ax: e.pos.x,
      ay: e.pos.y,
      az: e.pos.z,
      looped: false,
      phase: (id % 97) * 0.37,
    };
    this.looks.set(key, st);
    return st;
  }

  /** After the scan: the flights, the stale looks, and every pool's unused tail. */
  end(): void {
    if (this.disposed) return;
    this.updateFlights();
    for (const [key, st] of this.looks) {
      if (st.seen === this.frame) continue;
      if (key.endsWith(':pot')) {
        // the cauldron's time ran out (or it was replaced): its bubbling stops, and it
        // goes in a last hiss of green steam
        const id = key.slice(0, key.indexOf(':'));
        if (st.looped) {
          this.audio()?.timedGroundLoop(`gurglegreen-${id}`, CAULDRON_BUBBLE_SFX, 0, 0, 0, 0.01);
        }
        for (let i = 0; i < 8; i++) {
          const a = i * 0.785;
          this.particles.toyMote(
            st.ax + Math.cos(a) * 0.45,
            st.spotY + CAULDRON_DRAWN.rimHeight,
            st.az + Math.sin(a) * 0.45,
            Math.cos(a) * 0.4,
            0.8,
            Math.sin(a) * 0.4,
            0x8fe39a,
            0.8,
            1.4,
            -0.05,
            'smoke',
          );
        }
      } else if (key.endsWith(':cauldron')) {
        // the goblin's time ran out (or a fight or a costume took it off) while its body is
        // still in sight: it turns back in a green puff. A body that left sight (out of
        // range, stealthed, dead) is not a turn back, so nothing plays.
        const body = this.entity(Number(key.slice(0, key.indexOf(':'))));
        if (body && body.kind === 'player' && this.drawable(body)) {
          this.goblinPoof(body.pos.x, body.pos.y, body.pos.z);
        }
      }
      this.looks.delete(key);
    }
    // a drinker whose fizz ran out (or who left sight) gets their own colours back. The tint
    // rides the rig's one aura-glow slot (CharacterVisual.setAuraGlow): an ability glow live
    // on the same body in the same few seconds shares it, the last writer winning, and this
    // release clears only bodies this layer tinted. The release reaches EVERY body of the
    // view (renderer.ts: the own rig and the form slot), since the goblin can take over
    // mid-fizz and leave the green on the body it replaced
    for (const [id, frame] of this.tinted) {
      if (frame === this.frame) continue;
      this.tint(id, BREW_COLOR, 0);
      this.tinted.delete(id);
    }
    if (!this.root) return;
    const twins = this.time - this.rootBorn < TWIN_SEC;
    const tail = (m: THREE.InstancedMesh | null, used: number) => {
      if (!m) return;
      for (let i = used; i < m.count; i++) m.setMatrixAt(i, HIDDEN);
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.visible = twins || used > 0;
    };
    tail(this.ghosts, this.ghostsUsed);
    for (const m of this.bats) tail(m, this.batsUsed);
    tail(this.candles, this.candlesUsed);
    tail(this.flames, this.flamesUsed);
    tail(this.mists, this.mistsUsed);
    tail(this.lightPools, this.lightPoolsUsed);
    for (const m of this.shadows) tail(m, this.shadowsUsed);
    tail(this.cauldrons, this.cauldronsUsed);
    tail(this.brews, this.cauldronsUsed);
    tail(this.bubbles, this.bubblesUsed);
    tail(this.lanternFrames, this.lanternsUsed);
    tail(this.lanternGlows, this.lanternsUsed);
    this.pumpkins.finish(twins);
    for (let i = this.halosUsed; i < this.halos.length; i++) {
      const s = this.halos[i];
      (s.material as THREE.SpriteMaterial).opacity = 0;
      s.scale.setScalar(0.001);
      s.visible = twins && i === 0;
    }
  }

  /** A body this layer may dress: alive, seen, and not hidden in stealth. */
  private drawable(e: ToyEntityLike): boolean {
    return !e.dead && !e.ghost && !e.stealthed;
  }

  /** One pooled glow sprite. An `accent` (the candle's column, the broom's raised glow)
   *  is the first to go in a crowd: it never takes the slots kept for the pumpkin
   *  flights and splats, which ask last (updateFlights runs after every body's look).
   *  A glow too faint to see takes no slot and no draw. */
  private halo(
    x: number,
    y: number,
    z: number,
    size: number,
    opacity: number,
    color: number,
    accent = false,
  ) {
    if (opacity <= HALO_MIN_OPACITY) return;
    if (!haloSlotFree(this.halosUsed, this.halos.length, accent)) return;
    const s = this.halos[this.halosUsed++];
    s.visible = true;
    s.position.set(x, y, z);
    s.scale.setScalar(size);
    const m = s.material as THREE.SpriteMaterial;
    m.opacity = opacity;
    m.color.setHex(color);
  }

  private drawLantern(e: ToyEntityLike, a: ToyAuraLike, st: LookState, fade: number): void {
    const t = this.time - st.born;
    // the lantern where it was set down
    const lx = a.value2 ?? e.pos.x;
    const lz = a.value3 ?? e.pos.z;
    const ly = st.spotY;
    const flick = candleFlicker(this.time, st.phase);
    if (this.lanternFrames && this.lanternGlows && this.lanternsUsed < TOY_CAP) {
      const grow = Math.min(1, t / 0.35);
      m4.compose(p4.set(lx, ly, lz), q4.setFromAxisAngle(UP, st.phase), s4.setScalar(1.5 * grow));
      const i = this.lanternsUsed++;
      this.lanternFrames.setMatrixAt(i, m4);
      this.lanternGlows.setMatrixAt(i, m4);
      this.lanternGlows.setColorAt(i, tint.setScalar(fade * (0.75 + 0.25 * flick)));
    }
    this.halo(lx, ly + 0.36, lz, 1.4 * flick, 0.5 * fade, 0x9fd8ff);
    this.halo(lx, ly + 0.06, lz, 2.4, 0.16 * fade, 0x6fb8ff);
    // the ghost circling its keeper
    if (!this.ghosts || this.ghostsUsed >= TOY_CAP) return;
    const o = ghostOrbit(t, st.phase);
    const gx = e.pos.x + o.x;
    const gy = e.pos.y + o.y;
    const gz = e.pos.z + o.z;
    const out = Math.min(1, t / 0.8);
    // it faces half along its path and half out from its keeper, so its face reads
    e4.set(0.25 * Math.sin(t * 1.7), o.yaw - 0.8, -0.22);
    q4.setFromEuler(e4);
    const breathe = 1 + 0.05 * Math.sin(t * 3.1 + st.phase);
    m4.compose(
      p4.set(gx, gy - 0.45, gz),
      q4,
      s4.set(0.78 * breathe, 0.78 / breathe, 0.78).multiplyScalar(out),
    );
    const i = this.ghostsUsed++;
    this.ghosts.setMatrixAt(i, m4);
    this.ghosts.setColorAt(i, tint.setScalar(0.85 * fade));
    this.halo(gx, gy - 0.05, gz, 1.6, 0.3 * fade, 0x8fd0ff);
    this.halo(gx, gy + 0.1, gz, 0.6, 0.35 * fade, 0xdff4ff);
    // faint wisps streaming off its hem, back along its path
    const back = o.yaw + Math.PI;
    this.particles.toyMote(
      gx + Math.sin(back) * 0.15,
      gy - 0.5,
      gz + Math.cos(back) * 0.15,
      Math.sin(back) * 0.35,
      -0.05,
      Math.cos(back) * 0.35,
      0xa8dcff,
      0.3,
      1.3,
      -0.15,
      'wisp',
      (this.reduced ? 8 : 18) * fade,
      this.dt,
    );
  }

  private drawBats(st: LookState, life: number): void {
    const t = this.time - st.born;
    if (this.bats.length < 3) return;
    const [body, wingL, wingR] = this.bats;
    for (let i = 0; i < BAT_COUNT && this.batsUsed < BAT_CAP; i++) {
      const b = batFlight(i, t, life);
      if (!b || b.alpha <= 0.01) continue;
      const x = st.ax + b.x;
      const y = st.ay + b.y;
      const z = st.az + b.z;
      const k = this.batsUsed++;
      e4.set(0.25 * Math.sin(t * 7 + i), b.yaw, 0);
      q4.setFromEuler(e4);
      const sc = b.scale * (0.35 + 0.65 * b.alpha) * 2.0;
      m4.compose(p4.set(x, y, z), q4, s4.setScalar(sc));
      body.setMatrixAt(k, m4);
      // each wing hinged at the body, beating about the body's long (+Z) axis
      q6.copy(q4).multiply(q5.setFromAxisAngle(FWD, -b.flap));
      m4.compose(p4, q6, s4);
      wingL.setMatrixAt(k, m4);
      q6.copy(q4).multiply(q5.setFromAxisAngle(FWD, b.flap));
      m4.compose(p4, q6, s4);
      wingR.setMatrixAt(k, m4);
    }
  }

  private drawCandle(a: ToyAuraLike, st: LookState, fade: number, remaining: number) {
    const t = this.time - st.born;
    const cx = a.value2 ?? 0;
    const cz = a.value3 ?? 0;
    const cy = st.spotY;
    if (this.candles && this.candlesUsed < TOY_CAP) {
      const grow = Math.min(1, t / 0.3);
      m4.compose(
        p4.set(cx, cy, cz),
        q4.setFromAxisAngle(UP, st.phase),
        s4.setScalar(CANDLE_SCALE * grow),
      );
      this.candles.setMatrixAt(this.candlesUsed++, m4);
    }
    // the cold green flames, each on its own flicker; the shadows follow their average
    let flickSum = 0;
    for (let k = 0; k < 3; k++) {
      const fl = candleFlicker(this.time, st.phase + k * 1.7);
      flickSum += fl;
      if (!this.flames || this.flamesUsed >= TOY_CAP * 3) continue;
      const [ox, h, oz] = CANDLE_TOPS[k];
      const c = Math.cos(st.phase);
      const s = Math.sin(st.phase);
      const fx = cx + (ox * c + oz * s) * CANDLE_SCALE;
      const fz = cz + (-ox * s + oz * c) * CANDLE_SCALE;
      const fy = cy + (0.04 + h + 0.03) * CANDLE_SCALE;
      e4.set(0.08 * Math.sin(this.time * 5 + k), 0, 0.08 * Math.cos(this.time * 4 + k));
      m4.compose(
        p4.set(fx, fy, fz),
        q4.setFromEuler(e4),
        s4.set(CANDLE_SCALE, CANDLE_SCALE * fl, CANDLE_SCALE).multiplyScalar(fade),
      );
      const i = this.flamesUsed++;
      this.flames.setMatrixAt(i, m4);
      this.flames.setColorAt(i, tint.setScalar(1));
      this.halo(fx, fy + 0.08, fz, 0.7 * fl, 0.55 * fade, 0x66ff8a);
    }
    const flick = flickSum / 3;
    this.halo(cx, cy + 0.3, cz, 3.2, 0.08 * fade, 0x3cff6e);
    // the glow column and the wisps climbing out of the flames: what still reads over
    // tall grass and in daylight, where the dish sinks out of sight
    const column = candleGlowColumn(t, remaining);
    this.halo(cx, cy + column.height, cz, 1.7, column.opacity * fade, 0x52ff84, true);
    this.particles.toyMote(
      cx,
      cy + 0.35,
      cz,
      0.12 * Math.sin(this.time * 1.9 + st.phase),
      0.55,
      0.12 * Math.cos(this.time * 2.3 + st.phase),
      0x7dffa2,
      0.2,
      2.4,
      -0.04,
      'wisp',
      (this.reduced ? 0.5 : 1) * column.wispRate,
      this.dt,
    );
    // the pool of candlelight the shadows dance in (what makes a shadow read at night)
    const light = candleLightPool(t, remaining, flick);
    if (this.lightPools && this.lightPoolsUsed < TOY_CAP) {
      m4.compose(p4.set(cx, cy + 0.07, cz), q4.identity(), s4.set(light.radius, 1, light.radius));
      const i = this.lightPoolsUsed++;
      this.lightPools.setMatrixAt(i, m4);
      const k = 0.62 * light.strength * fade;
      this.lightPools.setColorAt(i, tint.setRGB(0.55 * k, 0.95 * k, 0.42 * k));
    }
    // a thin green haze still hangs low round the dish
    const mist = candleMist(t, remaining);
    if (this.mists && this.mistsUsed < TOY_CAP) {
      m4.compose(
        p4.set(cx, cy + 0.06, cz),
        q4.setFromAxisAngle(UP, this.time * 0.08 + st.phase),
        s4.set(mist.radius, 1, mist.radius),
      );
      const i = this.mistsUsed++;
      this.mists.setMatrixAt(i, m4);
      this.mists.setColorAt(i, tint.setScalar(0.045 * mist.strength));
    }
    // the shadows: a cat, a bat and a witch thrown out from the flames, circling the dish,
    // stretching and shrinking as the flames jump (they never take a step the light did not)
    if (this.shadows.length === CANDLE_SHADOW_FIGURES.length && this.shadowsUsed < TOY_CAP) {
      const slot = this.shadowsUsed++;
      const figures = candleShadows(t, st.phase, flick, fade);
      for (let k = 0; k < figures.length; k++) {
        const f = figures[k];
        const dx = Math.sin(f.bearing);
        const dz = Math.cos(f.bearing);
        const mid = f.foot + f.length * 0.5;
        // seated on the ground under its own middle, never below the dish's floor
        const gy = Math.max(cy, this.groundY(cx + dx * mid, cz + dz * mid)) + 0.08;
        m4.compose(
          p4.set(cx + dx * f.foot, gy, cz + dz * f.foot),
          q4.setFromAxisAngle(UP, f.bearing + Math.PI),
          s4.set(f.width, 1, f.length),
        );
        const mesh = this.shadows[k];
        mesh.setMatrixAt(slot, m4);
        mesh.setColorAt(slot, tint.setRGB(f.alpha, f.alpha, f.alpha));
      }
    }
  }

  /** A standing Gurglegreen Cauldron (a ground object): the pot, its brew, its bubbles,
   *  steam and green motes off the top, embers under its belly, its bubbling looped. */
  private drawCauldron(e: ToyEntityLike, id: number): void {
    this.ensureRoot();
    const st = this.lookState(`${id}:pot`, e, id, 0);
    st.ax = e.pos.x;
    st.az = e.pos.z;
    st.spotY = e.pos.y;
    const t = this.time - st.born;
    const x = e.pos.x;
    const y = e.pos.y;
    const z = e.pos.z;
    if (!st.looped) {
      st.looped = true;
      const stands = gourdlightToy(GURGLEGREEN_CAULDRON_ID)?.standsFor ?? 60;
      this.audio()?.timedGroundLoop(
        `gurglegreen-${id}`,
        CAULDRON_BUBBLE_SFX,
        x,
        y + 0.5,
        z,
        stands,
      );
    }
    // it lands with a little settle (overshoot, then rest)
    const k = Math.min(1, t / 0.32);
    const settle = 1 + 0.12 * Math.sin(k * Math.PI) * (1 - k);
    const size = CAULDRON_SCALE * (0.6 + 0.4 * k) * settle;
    if (this.cauldrons && this.brews && this.cauldronsUsed < TOY_CAP) {
      m4.compose(p4.set(x, y, z), q4.setFromAxisAngle(UP, e.facing), s4.setScalar(size));
      const i = this.cauldronsUsed++;
      this.cauldrons.setMatrixAt(i, m4);
      this.brews.setMatrixAt(i, m4);
      const throb = 0.82 + 0.12 * Math.sin(t * 3.1 + st.phase) + 0.06 * Math.sin(t * 7.7);
      this.brews.setColorAt(i, tint.setScalar(throb * k));
    }
    // the effects round it were tuned on round 10's knee-high pot: g is 1 at that size and
    // grows with the pot, so the steam, the embers and the glow stay in proportion
    const g = size / 1.25;
    // the brew's bubbles: each swells, pops, and comes back somewhere else on the surface
    const rimY = y + (CAULDRON_RIM_Y - 0.03) * size;
    const r = (CAULDRON_RIM_R - 0.04) * size;
    for (let b = 0; b < CAULDRON_BUBBLES; b++) {
      const bub = cauldronBubble(b, t + st.phase);
      if (this.bubbles && this.bubblesUsed < TOY_CAP * CAULDRON_BUBBLES && bub.size > 0.02) {
        const bs = (0.035 + 0.03 * ((b * 5) % 3)) * size * bub.size;
        m4.compose(p4.set(x + bub.x * r, rimY, z + bub.z * r), q4.identity(), s4.setScalar(bs));
        const i = this.bubblesUsed++;
        this.bubbles.setMatrixAt(i, m4);
        this.bubbles.setColorAt(i, tint.setScalar(0.85));
      }
      // a popped bubble flicks a drop of brew up off the surface
      if (bub.pop > 0 && bub.pop < 0.3 && !this.reduced) {
        this.particles.toyMote(
          x + bub.x * r,
          rimY + 0.04 * g,
          z + bub.z * r,
          bub.x * 0.3 * g,
          1.1 * g,
          bub.z * 0.3 * g,
          0xc8ffc0,
          0.07 * g,
          0.45,
          4,
          'glow',
          6,
          this.dt,
        );
      }
    }
    // steam curling off the top and green motes drifting up out of it
    this.particles.toyMote(
      x + 0.1 * g * Math.sin(this.time * 1.3 + st.phase),
      rimY + 0.12 * g,
      z + 0.1 * g * Math.cos(this.time * 1.7 + st.phase),
      0.08 * g * Math.sin(this.time * 0.9),
      0.55 * g,
      0.08 * g * Math.cos(this.time * 1.1),
      0x9fe8a8,
      0.7 * g,
      2.2,
      -0.04,
      'smoke',
      (this.reduced ? 2 : 4) * k,
      this.dt,
    );
    this.particles.toyMote(
      x + r * 0.6 * Math.sin(this.time * 2.7 + st.phase),
      rimY + 0.08 * g,
      z + r * 0.6 * Math.cos(this.time * 2.3 + st.phase),
      0,
      0.7 * g,
      0,
      BREW_COLOR,
      0.11 * g,
      1.6,
      -0.2,
      'glow',
      (this.reduced ? 5 : 12) * k,
      this.dt,
    );
    // embers glowing under its belly: the heat that keeps it bubbling
    this.particles.toyMote(
      x + 0.18 * g * Math.sin(this.time * 4.1 + st.phase),
      y + 0.06 * g,
      z + 0.18 * g * Math.cos(this.time * 3.3 + st.phase),
      0,
      0.5 * g,
      0,
      0xff8a2a,
      0.06 * g,
      0.6,
      0.2,
      'spark',
      (this.reduced ? 3 : 7) * k,
      this.dt,
    );
    this.halo(x, y + 0.12 * g, z, 1.0 * g, 0.32 * k, 0xff7a24);
    this.halo(x, rimY + 0.15 * g, z, 1.6 * g, 0.42 * k, BREW_COLOR);
    this.halo(x, rimY + 0.55 * g, z, 2.4 * g, 0.12 * k, BREW_DEEP, true);
  }

  /** A drinker, while the goblin body takes over (BREW_FIZZ_SEC): the body flushed green,
   *  bubbles boiling up off them and a green halo round their chest, all draining away so
   *  the goblin reads in its own colours for the rest of the look. The goblin itself is the
   *  polymorph slot's look (form_visual_selection_core.ts, the costumes' seam). */
  private drawBrew(e: ToyEntityLike, id: number, st: LookState, elapsed: number): void {
    // where the goblin last stood: its turn back to a body plays there (end())
    st.ax = e.pos.x;
    st.ay = e.pos.y;
    st.az = e.pos.z;
    const glow = brewGlow(elapsed, this.time + st.phase);
    if (glow <= 0) return;
    this.tint(id, BREW_TINT, glow);
    this.tinted.set(id, this.frame);
    const ang = this.time * 7.3 + st.phase;
    const rise = (this.time * 1.9 + st.phase) % 1;
    for (let k = 0; k < 2; k++) {
      const a = ang + k * Math.PI;
      this.particles.toyMote(
        e.pos.x + Math.cos(a) * 0.42,
        e.pos.y + 0.25 + rise * 1.6,
        e.pos.z + Math.sin(a) * 0.42,
        Math.cos(a) * 0.18,
        1.1,
        Math.sin(a) * 0.18,
        Math.sin(a * 3) > 0.6 ? 0xe4ffe0 : BREW_COLOR,
        0.12 + 0.06 * Math.abs(Math.sin(a * 1.7)),
        1.3,
        -0.35,
        'glow',
        (this.reduced ? 14 : 34) * glow,
        this.dt,
      );
    }
    this.halo(e.pos.x, e.pos.y + 1.0, e.pos.z, 2.6, 0.9 * glow, BREW_COLOR, true);
  }

  /** The goblin turns back: a green puff and a pop of bubbles where it stood. */
  private goblinPoof(x: number, y: number, z: number): void {
    this.particles.groundPuff(this.at.set(x, y, z), 1, 0x3f9a4c);
    const n = this.reduced ? 8 : 18;
    for (let i = 0; i < n; i++) {
      const a = i * 2.39996;
      this.particles.toyMote(
        x + Math.cos(a) * 0.3,
        y + 0.5 + (i % 5) * 0.2,
        z + Math.sin(a) * 0.3,
        Math.cos(a) * 0.7,
        0.9 + (i % 4) * 0.3,
        Math.sin(a) * 0.7,
        i % 3 === 0 ? 0xbfffc4 : 0x7fe08a,
        i % 3 === 0 ? 0.9 : 0.12,
        i % 3 === 0 ? 1.4 : 0.9,
        i % 3 === 0 ? -0.05 : -0.5,
        i % 3 === 0 ? 'smoke' : 'glow',
      );
    }
    this.halo(x, y + 1.0, z, 2.2, 0.5, BREW_COLOR);
  }

  private updateFlights(): void {
    for (let i = this.flights.length - 1; i >= 0; i--) {
      const f = this.flights[i];
      const target = this.entity(f.targetId);
      if (target) f.to.set(target.pos.x, target.pos.y + 1.85, target.pos.z);
      const u = (this.time - f.start) / PRANK_FLIGHT_SEC;
      if (u >= 1) {
        this.splat(f.to);
        this.flights.splice(i, 1);
        continue;
      }
      const p = prankArc(f.from, f.to, u);
      const kit = this.pumpkins.take(this.root);
      if (kit && this.pumpkins.used < PRANK_CAP) {
        e4.set(p.spin, 0.6, p.spin * 0.4);
        m4.compose(p4.set(p.x, p.y - 0.15, p.z), q4.setFromEuler(e4), s4.setScalar(0.9));
        this.pumpkins.place(this.pumpkins.used++, m4);
      }
      this.halo(p.x, p.y, p.z, 1.1, 0.5, 0xffa040);
      this.particles.toyMote(
        p.x,
        p.y,
        p.z,
        0,
        0.2,
        0,
        0xffc060,
        0.16,
        0.5,
        0.5,
        'spark',
        60,
        this.dt,
      );
    }
  }

  /** The pumpkin bursting on a head: pulp and seeds, a warm flash, and its splat. */
  private splat(at: THREE.Vector3): void {
    const n = this.reduced ? 14 : 30;
    for (let i = 0; i < n; i++) {
      const a = i * 2.39996;
      const up = 0.6 + ((i * 7) % 5) * 0.45;
      const sp = 1.2 + ((i * 13) % 7) * 0.35;
      this.particles.toyMote(
        at.x,
        at.y + 0.1,
        at.z,
        Math.cos(a) * sp,
        up,
        Math.sin(a) * sp,
        PULP[i % PULP.length],
        i % 3 === 0 ? 0.11 : 0.2,
        0.7 + (i % 4) * 0.12,
        7.5,
        i % 3 === 0 ? 'debris' : 'glow',
      );
    }
    this.particles.groundPuff(this.at.set(at.x, at.y - 1.85, at.z), 0.5, 0xe0761c);
    this.halo(at.x, at.y, at.z, 2.4, 0.8, 0xffb050);
    this.audio()?.playAt?.(PRANK_SPLAT_SFX, at.x, at.y, at.z, { gain: 0.9, cooldown: 0.05 });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pumpkins.release();
    this.root?.removeFromParent();
    for (const m of [
      this.ghosts,
      this.candles,
      this.flames,
      this.mists,
      this.lightPools,
      this.cauldrons,
      this.brews,
      this.bubbles,
      this.lanternFrames,
      this.lanternGlows,
      ...this.bats,
      ...this.shadows,
    ])
      m?.dispose();
    // a drinker still glowing when the layer goes keeps no tint
    for (const id of this.tinted.keys()) this.tint(id, BREW_COLOR, 0);
    this.tinted.clear();
    for (const x of this.owned) x.dispose();
    this.owned.length = 0;
    this.root = null;
    this.ghosts = null;
    this.candles = null;
    this.lightPools = null;
    this.cauldrons = null;
    this.brews = null;
    this.bubbles = null;
    this.shadows = [];
    this.flames = null;
    this.mists = null;
    this.lanternFrames = null;
    this.lanternGlows = null;
    this.bats = [];
    this.halos = [];
    this.looks.clear();
    this.flights.length = 0;
  }
}
