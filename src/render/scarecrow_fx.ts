// Old Thatchgrin's visual layer (Gourdlight Eve's field boss, sim: src/sim/seasonal/
// scarecrow_kit.ts and scarecrow_swell.ts). What the shared vocabulary cannot say alone:
//
//  - GOURDFALL: on his Throw clip's release frame a lit gourd flies from his hand up into
//    the sky, and then a burning pumpkin drops out of the sky onto every ring the sim laid
//    down (the ring itself is the shared encounter rune circle at its true radius, drawn at
//    every graphics tier, never re-drawn here), each on a steep slant behind a comet of
//    fire, landing on its ring's last frame;
//  - the BURST where each lands: a fireball of flame, pumpkin shards and seeds, a smoke
//    column and a dust ring, on top of the shared impact flash and blast ring;
//  - the SMOLDERING CHAFF it leaves: a hot ember disc on the ground at the patch's TRUE
//    radius for exactly its burn time (the read: where not to stand), with flames and smoke
//    rising off it. The disc is actionable information, so it draws at every graphics tier;
//    only the particle density scales;
//  - the SWELLING GOURD: it heaves up out of the stubble, swells as its fuse (its cast bar)
//    runs, glows hotter and throbs faster at the end, leaks embers and smoke; broken, it
//    splits in a spray of pulp and seeds and he reels (dizzy sparks round his head, an
//    ember glow through the split in his chest for as long as he is split open); unbroken,
//    it bursts in a fireball with a shockwave rolling out over the whole field;
// plus the crows bursting off him at his call's peak and straw puffs as he collapses,
// and THATCHBOUND, his mind control: its own layer (thatchbound_fx.ts), composed here,
// and Hester's TOYS (seasonal_toys_fx.ts), composed here too: this is the event's one layer
// the renderer ticks, scans entities for and routes spellfxAt to.
//
// GPU work: every falling pumpkin (and the gourd thrown at the sky) is one instance of a
// pooled InstancedMesh per part of the decor kit's small carved pumpkin over its own purple
// clones of the kit's materials (round 10: new program variants, linked by the pool's own
// gated attach before the first fall), and their fire comets are one more pooled InstancedMesh. The comet, the patch disc, the halo
// sprites and the shockwave ring are built with this layer's root (on the first sight of
// him) and attached through the world compile gate (attachSceneGroupGated), each with a
// hidden twin so its program links before its first use. Every particle rides the pooled
// point cloud (vfx.ts). A rain reuses the pools (only a chaff patch builds its tiny disc).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { resolveScarecrowField } from '../sim/seasonal/scarecrow_field';
import type { SpatialAudioSink } from './audio_sink';
import { attachSceneGroupGated } from './gated_scene_attach';
import { pullDecalTowardCamera } from './ground_decal_pull';
import { cloneMaterialWithHooks } from './material_clone_hooks';
import {
  AWAKEN_HEAD_SEC,
  AWAKEN_LAND_SEC,
  AWAKEN_TEAR_SEC,
  bodyLocalToWorld,
  CHAFF_ABILITY,
  chaffFlameCalls,
  chaffStrength,
  DEATH_FOLD_SEC,
  DEATH_HEAP_SEC,
  FALL_SEC,
  fallOrigin,
  fallPoint,
  fallWindow,
  GOURD_ABILITY,
  GOURD_HAND_LOCAL,
  GOURD_RELEASE_SEC,
  GOURDFALL_PURPLE,
  GOURDFALL_WHISTLE_SFX,
  SUMMON_ABILITY,
  SUMMON_PEAK_SEC,
  SWELL_ABILITY,
  SWELL_PULSE_SFX,
  SWELLING_GOURD_TEMPLATE,
  swellGlow,
  swellPulseGain,
  swellPulseInterval,
  swellScale,
  swellThrob,
  THATCHGRIN_POLE,
  THATCHGRIN_TEMPLATE,
  thatchgrinPoleAt,
} from './scarecrow_fx_core';
import { gourdlightAssets } from './seasonal_decor_assets';
import {
  SeasonalToysFx,
  type ToyBodyTint,
  type ToyEntityLike,
  type ToyParticles,
} from './seasonal_toys_fx';
import { ThatchboundFx } from './thatchbound_fx';

/** The pooled particle calls this layer uses (vfx.ts). */
export interface ScarecrowParticles extends ToyParticles {
  burst(at: THREE.Vector3, school: string, count?: number, power?: number, color?: number): void;
  burstLater(
    seconds: number,
    x: number,
    y: number,
    z: number,
    school: string,
    count?: number,
    power?: number,
    color?: number,
  ): void;
  groundPuff(at: THREE.Vector3, power: number, color: number): void;
  fireworkBurst(at: THREE.Vector3, colors: readonly number[], count?: number, power?: number): void;
  campfireEmber(at: THREE.Vector3, dt: number): void;
  fluidSmoke(x: number, y: number, z: number, color: number, dt: number, rate: number): void;
}

interface EntityLike extends ToyEntityLike {
  templateId: string;
  /** In bed (mob/slumber.ts): by day he hangs on his pole. */
  asleep?: boolean;
  castRemaining?: number;
  castTotal?: number;
  castingAbility?: string | null;
}

interface SpellfxAtLike {
  fx: string;
  x: number;
  z: number;
  ability?: string;
  sourceId?: number;
  targetId?: number;
  radius?: number;
  duration?: number;
}

/** One slot of the falling-pumpkin pool: a drop from the sky (or the gourd thrown up). */
interface FallSlot {
  active: boolean;
  /** true: the lit gourd he throws UP at the sky (it shrinks away into it). */
  up: boolean;
  from: THREE.Vector3;
  to: THREE.Vector3;
  start: number;
  end: number;
  spin: number;
  /** Its fall whistle has sounded (once, the frame it starts to drop). */
  whistled: boolean;
}

interface Patch {
  /** The dark underlay (normal blend) and the violet edge and embers over it (additive). */
  disc: THREE.Mesh;
  glow: THREE.Mesh;
  x: number;
  y: number;
  z: number;
  radius: number;
  born: number;
  total: number;
  flameClock: number;
}

/** The thrown pumpkins' shards: his witch-fire purple (round 10). */
const SHARD_COLORS = GOURDFALL_PURPLE.fire;
/** The Swelling Gourd's own shards stay its orange rind. */
const SWELL_SHARD_COLORS = [0xff8a1a, 0xffb347, 0xd9561a, 0xfff0a8] as const;
const PULP_COLORS = [0xfff0b0, 0xffd27a, 0xff9a2e, 0xe0761c] as const;
const DIRT_COLORS = [0x5a4528, 0x7a6038, 0x3e2e1a] as const;
const FEATHER_COLORS = [0x15141a, 0x24222b, 0x0a0a0d] as const;
const STRAW_COLOR = 0xd8b25a;
const CHAFF_DENSITY = 0.6;
/** Blast rings at once (a full rain is nine landings) and each one's life. */
const BLAST_CAP = 10;
const BLAST_SEC = 0.75;
const blastTint = new THREE.Color();
/** How high a scorched patch is laid over the ground (its depth is pulled through the
 *  stubble toward the eye: ground_decal_pull.ts). */
const CHAFF_LIFT = 0.08;
const SMOKE = 0x2a2420;
/** Falling pumpkins at once (a full rain is nine, plus the gourd thrown up). */
const FALL_CAP = 12;
/** The pumpkin's drawn size in the rain (the decor kit's small carved pumpkin). */
const FALL_SCALE = 1.9;
/** Halo sprites at once: two gourds' glows and his split chest. */
const HALO_CAP = 3;
/** Where his chest glows through the split (world yards above his feet). */
const CHEST_UP = 4.1;
/** Where the dizzy sparks circle (above his hat). */
const DIZZY_UP = 7.9;

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const scratchMat = new THREE.Matrix4();
const scratchQuat = new THREE.Quaternion();
const scratchScale = new THREE.Vector3();
const scratchDir = new THREE.Vector3();
const scratchEuler = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0);
/** Seconds after the root attaches that its idle twins stay drawn (so the gate links
 *  their programs); afterwards an idle pool is hidden, costing no draw. */
const TWIN_SEC = 3;

/** The burning patch's alpha: a dim smoulder across the stubble, scattered live embers
 *  and a hot ragged rim at the edge (the boundary is the read). Built once per layer. */
function emberTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const mid = size / 2;
    // an alpha map reads the GREEN channel, so paint grey on opaque black
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, size, size);
    const g = ctx.createRadialGradient(mid, mid, 0, mid, mid, mid);
    g.addColorStop(0, 'rgba(255,255,255,0.16)');
    g.addColorStop(0.75, 'rgba(255,255,255,0.22)');
    g.addColorStop(0.9, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.96, 'rgba(255,255,255,0.6)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    // live embers and glowing stalks across the patch
    for (let i = 0; i < 140; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * mid * 0.86;
      const x = mid + Math.cos(a) * r;
      const y = mid + Math.sin(a) * r;
      const e = ctx.createRadialGradient(x, y, 0, x, y, 3 + Math.random() * 9);
      e.addColorStop(0, `rgba(255,255,255,${0.5 + Math.random() * 0.5})`);
      e.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = e;
      ctx.fillRect(x - 12, y - 12, 24, 24);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * mid * 0.8;
      ctx.beginPath();
      ctx.moveTo(mid + Math.cos(a) * r, mid + Math.sin(a) * r);
      ctx.lineTo(mid + Math.cos(a + 0.2) * (r + 18), mid + Math.sin(a + 0.2) * (r + 18));
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/** A soft round halo (colour on transparent): the gourd's inner light, his chest's split. */
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
    g.addColorStop(0, 'rgba(255,240,200,1)');
    g.addColorStop(0.25, 'rgba(255,170,70,0.75)');
    g.addColorStop(0.6, 'rgba(255,90,20,0.22)');
    g.addColorStop(1, 'rgba(255,60,10,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  return new THREE.CanvasTexture(canvas);
}

/** The fire comet behind a falling pumpkin: a flame shell round it and a tapering tail
 *  trailing up its path, vertex-coloured hot at the pumpkin to nothing at the tail's end
 *  (additive, so black is clear). Its +Y runs UP THE TRAIL (against the fall). */
function cometGeometry(): THREE.BufferGeometry {
  const shell = new THREE.IcosahedronGeometry(1.25, 1);
  const tail = new THREE.ConeGeometry(1.1, 7.5, 12, 4, true);
  tail.translate(0, 3.75 + 0.2, 0);
  const paint = (geo: THREE.BufferGeometry, fn: (y: number) => [number, number, number]) => {
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const [r, g, b] = fn(pos.getY(i));
      col[i * 3] = r;
      col[i * 3 + 1] = g;
      col[i * 3 + 2] = b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  };
  // kept well under white: additive over a bright sky, a full-strength comet blows out to
  // a white stalk and the pumpkin inside it stops reading
  // round 10: his witch-fire, a deep violet comet (GOURDFALL_PURPLE)
  // kept dim: additive violet over a bright sky blows out to pink very fast
  paint(shell, () => [0.24, 0.04, 0.42]);
  paint(tail, (y) => {
    const t = Math.max(0, Math.min(1, (y - 0.2) / 7.5));
    const k = (1 - t) ** 2.2;
    return [(0.22 - 0.06 * t) * k, 0.03 * k, (0.42 - 0.08 * t) * k];
  });
  const merged = mergeTwo(shell, tail);
  shell.dispose();
  tail.dispose();
  return merged;
}

/** Two non-indexed-compatible geometries in one (position + color), the comet's parts. */
function mergeTwo(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  const ga = a.index ? a.toNonIndexed() : a;
  const gb = b.index ? b.toNonIndexed() : b;
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'color'] as const) {
    const pa = ga.getAttribute(name) as THREE.BufferAttribute;
    const pb = gb.getAttribute(name) as THREE.BufferAttribute;
    const arr = new Float32Array(pa.array.length + pb.array.length);
    arr.set(pa.array as Float32Array, 0);
    arr.set(pb.array as Float32Array, pa.array.length);
    out.setAttribute(name, new THREE.BufferAttribute(arr, 3));
  }
  if (ga !== a) ga.dispose();
  if (gb !== b) gb.dispose();
  out.computeBoundingSphere();
  return out;
}

/** One part of the decor kit's small carved pumpkin, re-dyed for his rain (round 10: the
 *  pumpkins he throws are a dark witch-fire purple): its rind a deep plum, its carved face
 *  and the candle inside a hot violet, its stem left as it is. A clone the pool owns, never
 *  the kit's shared material (the decor's own pumpkins keep their orange). */
function purpleGourdMaterial(source: THREE.Material): THREE.Material {
  // the kit's glow parts carry their rim-shaping hook (seasonal_decor_assets.ts shapeGlow):
  // keep it on the clone, so the purple face still reads as a lit shell
  const m = cloneMaterialWithHooks(source) as THREE.Material & {
    color?: THREE.Color;
    emissive?: THREE.Color;
    emissiveIntensity?: number;
    vertexColors?: boolean;
  };
  const name = source.name ?? '';
  if (/stem|leaf|vine/i.test(name)) return m;
  if (/glow|inner|flesh/i.test(name)) {
    m.color?.setHex(0x8a3cd6);
    m.emissive?.setHex(GOURDFALL_PURPLE.glow);
    if (m.emissiveIntensity !== undefined) m.emissiveIntensity = 1.8;
  } else {
    // the rind: the painted vertex orange would muddy any tint, so the plum stands alone
    m.vertexColors = false;
    m.color?.setHex(GOURDFALL_PURPLE.rind);
    m.emissive?.setHex(0x2a0640);
    if (m.emissiveIntensity !== undefined) m.emissiveIntensity = 0.6;
  }
  m.needsUpdate = true;
  return m;
}

/** His pole (round 10): a weathered, split post driven into the stubble with a crossbar
 *  lashed across it behind his shoulders, rope wound round the join, a rag of sackcloth
 *  knotted to one arm of the bar and straw stuck in the lashings. In his own frame (local
 *  +Z his forward, +X his left), foot at y = 0; vertex-coloured for one Lambert draw. */
function poleGeometry(): THREE.BufferGeometry {
  const P = THATCHGRIN_POLE;
  const parts: THREE.BufferGeometry[] = [];
  const paintParts = (
    geo: THREE.BufferGeometry,
    fn: (x: number, y: number, z: number) => number[],
  ) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.deleteAttribute('uv');
    g.computeVertexNormals();
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const [r, gg, b] = fn(pos.getX(i), pos.getY(i), pos.getZ(i));
      col[i * 3] = r;
      col[i * 3 + 1] = gg;
      col[i * 3 + 2] = b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push(g);
  };
  // grey-brown weathered wood, darker in its grain and cracks, lighter where the sun bleached it
  const wood = (x: number, y: number, z: number) => {
    const grain = 0.78 + 0.22 * Math.sin(y * 9 + Math.sin(x * 23 + z * 17) * 2);
    const crack = Math.sin(Math.atan2(x, z) * 5 + y * 0.6) > 0.93 ? 0.55 : 1;
    const k = grain * crack;
    return [0.4 * k, 0.27 * k, 0.16 * k];
  };
  const post = new THREE.CylinderGeometry(0.26, 0.32, P.postTop + 0.35, 10, 6);
  const pp = post.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pp.count; i++) {
    // a hand-hewn post: not quite straight, its top split and leaning
    const y = pp.getY(i);
    pp.setX(i, pp.getX(i) + 0.04 * Math.sin(y * 0.9));
  }
  post.translate(0, (P.postTop - 0.35) / 2, -P.postBack);
  paintParts(post, wood);
  const bar = new THREE.CylinderGeometry(0.17, 0.2, P.barHalf * 2, 9, 4);
  const bp = bar.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < bp.count; i++) {
    const y = bp.getY(i);
    // it sags a touch either side of the lashing
    bp.setZ(i, bp.getZ(i) + 0.05 * (y / P.barHalf) ** 2);
  }
  bar.rotateZ(Math.PI / 2);
  bar.translate(0, P.barHeight, -P.barBack);
  paintParts(bar, wood);
  // the lashing: rope wound in an X round the join
  const rope = (x: number, y: number, z: number) => {
    const k = 0.8 + 0.2 * Math.sin((x + y + z) * 60);
    return [0.62 * k, 0.5 * k, 0.3 * k];
  };
  for (const tilt of [0.6, -0.6]) {
    const knot = new THREE.TorusGeometry(0.3, 0.045, 6, 18);
    knot.rotateY(Math.PI / 2);
    knot.rotateX(tilt);
    knot.translate(0, P.barHeight, -P.barBack - 0.06);
    paintParts(knot, rope);
  }
  for (const side of [1, -1]) {
    const band = new THREE.TorusGeometry(0.2, 0.04, 6, 14);
    band.rotateY(Math.PI / 2);
    band.translate(side * (P.barHalf - 0.35), P.barHeight, -P.barBack);
    paintParts(band, rope);
  }
  // a rag of sackcloth knotted to his right arm of the bar, hanging and torn
  const rag = new THREE.PlaneGeometry(0.42, 0.95, 3, 6);
  const rp = rag.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < rp.count; i++) {
    const y = rp.getY(i);
    rp.setZ(i, 0.06 * Math.sin(y * 7 + rp.getX(i) * 5));
    if (y < -0.3) rp.setY(i, y - 0.08 * Math.abs(Math.sin(rp.getX(i) * 31)));
  }
  rag.translate(-(P.barHalf - 0.55), P.barHeight - 0.5, -P.barBack + 0.12);
  paintParts(rag, (x, y) => {
    const k = 0.75 + 0.25 * Math.sin(x * 40) * Math.sin(y * 37);
    return [0.34 * k, 0.26 * k, 0.17 * k];
  });
  // straw stuck in the lashings and at the post's foot
  const straw = (x: number, y: number, z: number) => {
    const k = 0.8 + 0.2 * Math.sin((x * 3 + z * 7) * 11 + y);
    return [0.86 * k, 0.68 * k, 0.32 * k];
  };
  for (let i = 0; i < 9; i++) {
    const a = i * 0.7;
    const stalk = new THREE.CylinderGeometry(0.012, 0.018, 0.55 + 0.1 * (i % 3), 4, 1);
    stalk.rotateZ(0.9 * Math.sin(a) + (i % 2 ? 0.4 : -0.4));
    stalk.rotateX(0.4 * Math.cos(a * 1.3));
    stalk.translate(
      0.12 * Math.cos(a),
      P.barHeight + 0.05 * Math.sin(a),
      -P.barBack + 0.1 * Math.sin(a * 2),
    );
    paintParts(stalk, straw);
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const stalk = new THREE.CylinderGeometry(0.01, 0.016, 0.5 + 0.12 * (i % 4), 4, 1);
    stalk.rotateZ(0.5 * Math.cos(a));
    stalk.rotateX(0.5 * Math.sin(a));
    stalk.translate(0.22 * Math.cos(a), 0.2, -P.postBack + 0.22 * Math.sin(a));
    paintParts(stalk, straw);
  }
  const out = mergeGeometries(parts, false) ?? new THREE.BufferGeometry();
  for (const g of parts) g.dispose();
  out.computeBoundingSphere();
  return out;
}

/** An entity's drawn scale: its own, times any body swell a fight layer puts on it (the
 *  rift death zone's bloat, the Swelling Gourd's ripening). The renderer's one call. */
export function entityDisplayScale(
  e: EntityLike & { id: number; scale: number },
  rift: { bodySwell(id: number): number } | null | undefined,
  scarecrow: ScarecrowFx,
): number {
  return e.scale * (rift?.bodySwell(e.id) ?? 1) * scarecrow.bodySwell(e, e.id);
}

export class ScarecrowFx {
  private root: THREE.Group | null = null;
  private discMaterial: THREE.MeshBasicMaterial | null = null;
  private discGlowMaterial: THREE.MeshBasicMaterial | null = null;
  /** His pole (round 10) and where it stands (null until his field is known). */
  private pole: THREE.Mesh | null = null;
  private poleSpot: { x: number; y: number; z: number; facing: number } | null = null;
  /** Whether each boss was asleep last frame (the nightfall wake's edge), and when the
   *  last wake began on this layer's clock. */
  private readonly asleepSeen = new Map<number, boolean>();
  private awakenAt = -1;
  private awakenFacing = 0;
  private awakenStep = 0;
  private readonly awakenAtPos = new THREE.Vector3();
  /** The pumpkin pool's own purple materials (built over the kit's, owned here). */
  private pumpkinMats: THREE.Material[] = [];
  private discGeometry: THREE.CircleGeometry | null = null;
  private discTexture: THREE.Texture | null = null;
  private cometMaterial: THREE.MeshBasicMaterial | null = null;
  private cometGeo: THREE.BufferGeometry | null = null;
  private comets: THREE.InstancedMesh | null = null;
  private pumpkins: THREE.InstancedMesh[] | null = null;
  /** The pumpkin pool's own gated group, and the kit parts it was built over. */
  private pumpkinGroup: THREE.Group | null = null;
  private pumpkinParts: unknown = null;
  private pumpkinsReady = false;
  private fallsIdle = false;
  private haloTexture: THREE.Texture | null = null;
  private halos: THREE.Sprite[] = [];
  private ringMaterial: THREE.MeshBasicMaterial | null = null;
  private blastMaterial: THREE.MeshBasicMaterial | null = null;
  private blastRings: THREE.InstancedMesh | null = null;
  private readonly blasts: { x: number; y: number; z: number; radius: number; born: number }[] = [];
  private fireballMaterial: THREE.MeshBasicMaterial | null = null;
  private fireball: THREE.Mesh | null = null;
  private ring: THREE.Mesh | null = null;
  private ringBorn = -1;
  private ringAt = new THREE.Vector3();
  private readonly falls: FallSlot[] = [];
  private readonly patches: Patch[] = [];
  private readonly deadSeen = new Set<number>();
  /** The sim time-ish clock each live gourd rose at (by entity id), for its heave. */
  private readonly gourdBorn = new Map<number, number>();
  /** When each live gourd's next heartbeat sounds (this layer's clock). */
  private readonly gourdPulseAt = new Map<number, number>();
  private time = 0;
  private frameDt = 1 / 60;
  private rootBorn = 0;
  private dizzyClock = 0;
  private disposed = false;
  private readonly scratch = new THREE.Vector3();
  private readonly scratch2 = new THREE.Vector3();
  /** Whether this frame's scan saw him standing (Thatchbound's root and scan key on it). */
  private bossNear = false;
  /** Whether this frame's scan saw him at all, alive or a corpse (his pole stands with him). */
  private bossSeen = false;
  /** Thatchbound's eyes, sigils and swirl (his mind control). */
  private readonly thatchbound: ThatchboundFx;
  /** Hester's toys (seasonal_toys_fx.ts): fed by this layer's own entity scan. */
  private readonly toys: SeasonalToysFx;

  constructor(
    private readonly scene: THREE.Object3D,
    private readonly particles: ScarecrowParticles,
    private readonly groundY: (x: number, z: number) => number,
    private readonly entities: () => ReadonlyMap<number, EntityLike>,
    private readonly entity: (id: number) => EntityLike | undefined,
    private readonly compileGate?: (target: THREE.Object3D) => Promise<unknown>,
    /** The spatial audio seam (the renderer's injected sink): this layer's own timed cues. */
    private readonly audio: () => SpatialAudioSink | null = () => null,
    /** The body-tint seam (CharacterVisual.setAuraGlow): a cauldron drinker's green. */
    tint: ToyBodyTint = () => {},
    /** The world seed his field resolves from (the pole's spot before he is ever seen
     *  asleep on it); null leaves the pole to his first sleep. */
    private readonly fieldSeed: () => number | null = () => null,
  ) {
    this.thatchbound = new ThatchboundFx(scene, particles, entities, entity, compileGate);
    this.toys = new SeasonalToysFx(scene, particles, groundY, entity, compileGate, audio, tint);
    for (let i = 0; i < FALL_CAP; i++) {
      this.falls.push({
        active: false,
        up: false,
        from: new THREE.Vector3(),
        to: new THREE.Vector3(),
        start: 0,
        end: 0,
        spin: 0,
        whistled: false,
      });
    }
  }

  /** Built on the first sight of him (or his gourd): a world that never sees the boss
   *  links nothing. Every program this layer will need is in the gated attach. */
  private ensureRoot(): THREE.Group {
    if (this.root) return this.root;
    const root = new THREE.Group();
    root.name = 'scarecrow-fx';
    this.discTexture = emberTexture();
    // round 10: a dark purple scorch laid on the stubble (normal blend, so it reads in full
    // daylight) under a violet edge and embers (additive, so the boundary glows at night)
    this.discMaterial = new THREE.MeshBasicMaterial({
      color: GOURDFALL_PURPLE.ink,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      alphaMap: this.discTexture ?? undefined,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    this.discGlowMaterial = new THREE.MeshBasicMaterial({
      color: GOURDFALL_PURPLE.rim,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      alphaMap: this.discTexture ?? undefined,
      polygonOffset: true,
      polygonOffsetFactor: -3,
    });
    // read through the field's tall stubble, still hugging the ground on screen
    pullDecalTowardCamera(this.discMaterial, 'scarecrow-chaff-ink');
    pullDecalTowardCamera(this.discGlowMaterial, 'scarecrow-chaff-glow');
    this.discGeometry = new THREE.CircleGeometry(1, 40);
    this.discGeometry.rotateX(-Math.PI / 2);
    // hidden twins so the gate links both disc programs before the first patch
    for (const mat of [this.discMaterial, this.discGlowMaterial]) {
      const twin = new THREE.Mesh(this.discGeometry, mat);
      twin.scale.setScalar(0.001);
      root.add(twin);
    }
    // his pole (round 10): built with the root, placed on the first sight of his field
    this.pole = new THREE.Mesh(
      poleGeometry(),
      new THREE.MeshLambertMaterial({ vertexColors: true }),
    );
    this.pole.name = 'scarecrow-fx-pole';
    this.pole.visible = false;
    root.add(this.pole);
    // the fire comets: one pooled instanced draw for every falling pumpkin
    this.cometGeo = cometGeometry();
    this.cometMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const comets = new THREE.InstancedMesh(this.cometGeo, this.cometMaterial, FALL_CAP);
    for (let i = 0; i < FALL_CAP; i++) comets.setMatrixAt(i, HIDDEN);
    comets.frustumCulled = false;
    comets.name = 'scarecrow-fx-comets';
    root.add(comets);
    this.comets = comets;
    // the halo sprites (the gourd's inner light, his split chest): a small fixed pool
    this.haloTexture = haloTexture();
    for (let i = 0; i < HALO_CAP; i++) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.haloTexture ?? undefined,
          color: 0xffffff,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          opacity: 0,
        }),
      );
      sprite.visible = i === 0; // the first stands as the program twin (opacity 0)
      sprite.scale.setScalar(0.001);
      root.add(sprite);
      this.halos.push(sprite);
    }
    // the burst's shockwave: one flat ring, rolled out over the field and faded
    this.ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xff8a2a,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const ringGeo = new THREE.RingGeometry(0.82, 1, 72);
    ringGeo.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(ringGeo, this.ringMaterial);
    this.ring.scale.setScalar(0.001);
    root.add(this.ring);
    // the landings' blast rings (round 10): one pooled additive draw, violet per instance
    this.blastMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    pullDecalTowardCamera(this.blastMaterial, 'scarecrow-blast-ring');
    this.blastRings = new THREE.InstancedMesh(ringGeo, this.blastMaterial, BLAST_CAP);
    for (let i = 0; i < BLAST_CAP; i++) {
      this.blastRings.setMatrixAt(i, HIDDEN);
      this.blastRings.setColorAt(i, blastTint.setHex(GOURDFALL_PURPLE.rim));
    }
    this.blastRings.frustumCulled = false;
    this.blastRings.name = 'scarecrow-fx-blast-rings';
    root.add(this.blastRings);
    // the burst's fireball: one additive ball, blown out and faded (it shares the ring's clock)
    this.fireballMaterial = new THREE.MeshBasicMaterial({
      color: 0xff6a18,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.fireball = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), this.fireballMaterial);
    this.fireball.scale.setScalar(0.001);
    root.add(this.fireball);
    this.root = root;
    this.rootBorn = this.time;
    void attachSceneGroupGated(this.scene, root, this.compileGate, () => this.disposed).catch(
      () => {},
    );
    return root;
  }

  /** The pooled pumpkins: one InstancedMesh per part of the decor kit's small carved
   *  pumpkin, FALL_CAP instances each, over the kit's own geometry and this pool's purple
   *  material clones (purpleGourdMaterial: their programs link through the pool's own
   *  gate). Null until the kit has loaded. */
  private ensurePumpkins(): THREE.InstancedMesh[] | null {
    const parts = gourdlightAssets()?.decor.pumpkin_small;
    if (this.pumpkins && parts === this.pumpkinParts)
      return this.pumpkinsReady ? this.pumpkins : null;
    // a material-tier rebuild of the kit retires the pool built over its old materials
    this.releasePumpkins();
    if (!parts || !this.root) return null;
    const group = new THREE.Group();
    group.name = 'scarecrow-fx-pumpkins';
    for (const m of this.pumpkinMats) m.dispose();
    this.pumpkinMats = parts.map((part) => purpleGourdMaterial(part.material));
    this.pumpkins = parts.map((part, k) => {
      const mesh = new THREE.InstancedMesh(part.geometry, this.pumpkinMats[k], FALL_CAP);
      for (let i = 0; i < FALL_CAP; i++) mesh.setMatrixAt(i, HIDDEN);
      mesh.frustumCulled = false;
      mesh.visible = false;
      group.add(mesh);
      return mesh;
    });
    this.pumpkinParts = parts;
    this.pumpkinGroup = group;
    // its own gate: the kit may finish loading mid-fight, before the decor's gate settles
    const mine = group;
    const retired = () => this.disposed || this.pumpkinGroup !== mine;
    void attachSceneGroupGated(this.root, group, this.compileGate, retired)
      .then(() => {
        if (!retired()) this.pumpkinsReady = true;
      })
      .catch(() => {});
    return null;
  }

  private releasePumpkins(): void {
    // the geometry is the decor kit's: the instance buffers and our purple materials go
    for (const m of this.pumpkinMats) m.dispose();
    this.pumpkinMats = [];
    if (this.pumpkins) for (const m of this.pumpkins) m.dispose();
    this.pumpkinGroup?.removeFromParent();
    this.pumpkins = null;
    this.pumpkinGroup = null;
    this.pumpkinParts = null;
    this.pumpkinsReady = false;
  }

  /** A landing's blast ring: rolled out to the pumpkin's TRUE radius in 0.35 s (the area
   *  it hit) and faded, in his witch-fire violet. A small fixed pool. */
  private addBlastRing(x: number, z: number, radius: number): void {
    this.ensureRoot();
    if (this.blasts.length >= BLAST_CAP) this.blasts.shift();
    this.blasts.push({ x, y: this.groundY(x, z) + CHAFF_LIFT + 0.04, z, radius, born: this.time });
  }

  private updateBlastRings(): void {
    const m = this.blastRings;
    if (!m) return;
    let used = 0;
    for (let i = this.blasts.length - 1; i >= 0; i--) {
      const b = this.blasts[i];
      const age = this.time - b.born;
      if (age >= BLAST_SEC) {
        this.blasts.splice(i, 1);
        continue;
      }
      const k = Math.min(1, age / 0.35);
      const r = b.radius * (0.35 + 0.65 * (1 - (1 - k) ** 3));
      scratchMat.compose(
        this.scratch.set(b.x, b.y, b.z),
        scratchQuat.identity(),
        scratchScale.set(r, 1, r),
      );
      m.setMatrixAt(used, scratchMat);
      const fade = (1 - age / BLAST_SEC) ** 1.4;
      m.setColorAt(used, blastTint.setHex(GOURDFALL_PURPLE.rim).multiplyScalar(fade));
      used++;
    }
    for (let i = used; i < BLAST_CAP; i++) m.setMatrixAt(i, HIDDEN);
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.visible = used > 0 || this.time - this.rootBorn < TWIN_SEC;
  }

  private takeSlot(): FallSlot | null {
    for (const s of this.falls) if (!s.active) return s;
    return null;
  }

  /** The sim's spellfxAt for his abilities. True when this layer CLAIMS the event (the
   *  renderer's generic arms skip it); false lets the shared rune / impact draw too. */
  handleSpellfxAt(ev: SpellfxAtLike): boolean {
    if (this.disposed) return false;
    if (SeasonalToysFx.claims(ev.ability)) return this.toys.handleCue(ev);
    if (ThatchboundFx.claims(ev.ability)) {
      this.thatchbound.handleMark(ev);
      return false; // the shared encounter rune circle marks the victim's feet
    }
    if (ev.ability === GOURD_ABILITY && ev.fx === 'runeCircle') {
      this.scheduleFall(ev);
      return false; // the shared encounter rune circle is the ring, at its true radius
    }
    if (ev.ability === GOURD_ABILITY && ev.fx === 'nova') {
      this.pumpkinBurst(ev.x, ev.z, ev.radius ?? 4);
      // claimed (round 10): its own violet blast ring at the true radius replaces the shared
      // one, which would draw in the fire school's orange
      this.addBlastRing(ev.x, ev.z, ev.radius ?? 4);
      return true;
    }
    if (ev.ability === CHAFF_ABILITY) {
      this.addPatch(ev.x, ev.z, ev.radius ?? 2.5, ev.duration ?? 6);
      return true;
    }
    if (ev.ability === SUMMON_ABILITY && ev.fx === 'burst') {
      const y = this.groundY(ev.x, ev.z);
      this.particles.groundPuff(this.scratch.set(ev.x, y, ev.z), 1, 0x8a7350);
      return false;
    }
    if (ev.ability === SWELL_ABILITY) {
      if (ev.fx === 'burst') this.gourdRises(ev);
      else if (ev.fx === 'tick') this.gourdBreaks(ev.x, ev.z);
      else if (ev.fx === 'nova') {
        this.gourdBursts(ev.x, ev.z, ev.radius ?? 40);
        return false; // the shared impact flash and blast ring ride on top
      }
      return true;
    }
    return false;
  }

  /** The windup cue of his call or his throw: the crows burst off him at the call's peak;
   *  the throw flings a lit gourd from his hand up into the sky on its release frame. */
  handleWindup(sourceId: number, ability: string | undefined): void {
    if (this.disposed) return;
    const boss = this.entity(sourceId);
    if (!boss) return;
    if (ability === GOURD_ABILITY) {
      this.throwSkyward(boss);
      return;
    }
    if (ability !== SUMMON_ABILITY) return;
    const y = boss.pos.y + 5.2;
    for (let i = 0; i < 3; i++) {
      this.particles.burstLater(
        SUMMON_PEAK_SEC + i * 0.08,
        boss.pos.x,
        y,
        boss.pos.z,
        'shadow',
        26,
        1.4,
        FEATHER_COLORS[i],
      );
    }
    this.particles.burstLater(
      SUMMON_PEAK_SEC,
      boss.pos.x,
      boss.pos.y + 3.4,
      boss.pos.z,
      'nature',
      22,
      1.2,
      STRAW_COLOR,
    );
  }

  /** The lit gourd he hurls at the sky: from his hand at the clip's release, up and away. */
  private throwSkyward(boss: EntityLike): void {
    this.ensureRoot();
    const slot = this.takeSlot();
    if (!slot) return;
    const hand = bodyLocalToWorld(
      boss.pos.x,
      boss.pos.z,
      boss.facing,
      GOURD_HAND_LOCAL.left,
      GOURD_HAND_LOCAL.forward,
    );
    slot.active = true;
    slot.up = true;
    slot.from.set(hand.x, boss.pos.y + GOURD_HAND_LOCAL.up, hand.z);
    slot.to.set(
      hand.x + Math.sin(boss.facing) * 4,
      boss.pos.y + 34,
      hand.z + Math.cos(boss.facing) * 4,
    );
    slot.start = this.time + GOURD_RELEASE_SEC;
    slot.end = slot.start + 0.9;
    slot.spin = 4;
  }

  private scheduleFall(ev: SpellfxAtLike): void {
    this.ensureRoot();
    const slot = this.takeSlot();
    if (!slot) return;
    const y = this.groundY(ev.x, ev.z);
    const o = fallOrigin(ev.x, y, ev.z);
    const w = fallWindow(this.time, ev.duration ?? 2.4);
    slot.active = true;
    slot.up = false;
    slot.from.set(o.x, o.y, o.z);
    slot.to.set(ev.x, y + 0.7, ev.z);
    slot.start = w.start;
    slot.end = w.end;
    slot.spin = 3 + (Math.abs(ev.x * 7.3 + ev.z * 3.1) % 3);
    slot.whistled = false;
  }

  private pumpkinBurst(x: number, z: number, radius: number): void {
    const y = this.groundY(x, z);
    const at = this.scratch.set(x, y + 0.8, z);
    // the fireball: a hard flash, then witch-fire rolling up and out (round 10: purple)
    this.particles.burst(at, 'shadow', 34, 2.3, GOURDFALL_PURPLE.fire[3]);
    this.particles.fireworkBurst(at, SHARD_COLORS, 30, 1.5);
    this.particles.groundPuff(this.scratch.set(x, y, z), 0.85, 0x3a2a44);
    for (let i = 0; i < 3; i++) {
      this.particles.burstLater(
        0.06 + i * 0.1,
        x,
        y + 0.9 + i * 0.6,
        z,
        'shadow',
        18,
        1.5 - i * 0.25,
        GOURDFALL_PURPLE.fire[i % GOURDFALL_PURPLE.fire.length],
      );
    }
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const r = radius * 0.7;
      this.particles.burstLater(
        0.04,
        x + Math.sin(a) * r,
        y + 0.4,
        z + Math.cos(a) * r,
        'shadow',
        6,
        0.7,
        GOURDFALL_PURPLE.fire[0],
      );
    }
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      this.particles.fluidSmoke(
        x + Math.sin(a),
        y,
        z + Math.cos(a),
        GOURDFALL_PURPLE.smoke,
        1,
        1000,
      );
    }
  }

  /** The gourd heaves up out of the stubble: dirt and straw thrown up round it. */
  private gourdRises(ev: SpellfxAtLike): void {
    this.ensureRoot();
    if (ev.targetId !== undefined) this.gourdBorn.set(ev.targetId, this.time);
    const y = this.groundY(ev.x, ev.z);
    this.particles.groundPuff(this.scratch.set(ev.x, y, ev.z), 2.2, 0x5a4528);
    this.particles.fireworkBurst(this.scratch.set(ev.x, y + 0.5, ev.z), DIRT_COLORS, 60, 1.6);
    this.particles.burst(this.scratch.set(ev.x, y + 0.6, ev.z), 'nature', 40, 1.6, STRAW_COLOR);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      this.particles.fluidSmoke(
        ev.x + Math.sin(a) * 2,
        y,
        ev.z + Math.cos(a) * 2,
        0x4a3c2c,
        1,
        1000,
      );
    }
  }

  /** The fuse ran out: a fireball, pumpkin shards over the field, and a shockwave. */
  private gourdBursts(x: number, z: number, radius: number): void {
    this.ensureRoot();
    const y = this.groundY(x, z);
    const at = this.scratch.set(x, y + 2, z);
    this.particles.burst(at, 'fire', 120, 4.2, 0xfff0c0);
    this.particles.fireworkBurst(at, SWELL_SHARD_COLORS, 110, 3.4);
    this.particles.fireworkBurst(this.scratch.set(x, y + 1.2, z), PULP_COLORS, 60, 2.4);
    this.particles.groundPuff(this.scratch.set(x, y, z), 3, 0x5a4528);
    for (let i = 0; i < 9; i++) {
      this.particles.burstLater(0.05 + i * 0.1, x, y + 2 + i * 0.9, z, 'fire', 46, 3.2 - i * 0.25);
    }
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      this.particles.burstLater(
        0.12,
        x + Math.sin(a) * 4,
        y + 0.6,
        z + Math.cos(a) * 4,
        'fire',
        14,
        1.6,
      );
    }
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const r = 3 + (i % 3);
      this.particles.fluidSmoke(x + Math.sin(a) * r, y, z + Math.cos(a) * r, SMOKE, 1, 1000);
    }
    if (this.ring && this.ringMaterial) {
      this.ringMaterial.color.setHex(0xff8a2a);
      this.ringAt.set(x, y + 0.25, z);
      this.ringBorn = this.time;
      this.ring.userData.radius = Math.min(radius, 26);
      this.ring.userData.wake = false;
    }
  }

  /** Broken: it splits in a spray of pulp and seeds. */
  private gourdBreaks(x: number, z: number): void {
    const y = this.groundY(x, z);
    const at = this.scratch.set(x, y + 1.6, z);
    this.particles.fireworkBurst(at, PULP_COLORS, 90, 2.2);
    this.particles.burst(at, 'fire', 30, 1.6, 0xffb347);
    this.particles.groundPuff(this.scratch.set(x, y, z), 1.6, 0x8a6a34);
  }

  private addPatch(x: number, z: number, radius: number, total: number): void {
    const root = this.ensureRoot();
    if (!this.discMaterial) return;
    // draped on the ground under it, so a patch on a slope never half-sinks into the hill
    const geometry = new THREE.CircleGeometry(radius, 40, 0, Math.PI * 2);
    geometry.rotateX(-Math.PI / 2);
    const y = this.groundY(x, z);
    const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
    // the field grows tall, and a hazard's boundary hidden in it is a hazard nobody can
    // read: the patch's material pulls its depth through the stubble (ground_decal_pull.ts)
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, this.groundY(x + pos.getX(i), z + pos.getZ(i)) - y + CHAFF_LIFT);
    }
    pos.needsUpdate = true;
    const disc = new THREE.Mesh(geometry, this.discMaterial);
    disc.position.set(x, y, z);
    disc.visible = false;
    root.add(disc);
    const glow = new THREE.Mesh(geometry, this.discGlowMaterial ?? this.discMaterial);
    glow.position.set(x, y + 0.01, z);
    glow.visible = false;
    root.add(glow);
    this.patches.push({ disc, glow, x, y, z, radius, born: this.time, total, flameClock: 0 });
  }

  /** The Swelling Gourd's drawn size (the renderer folds it into the entity's scale):
   *  1 for every other body. */
  bodySwell(e: EntityLike & { id?: number }, id: number): number {
    if (e.templateId !== SWELLING_GOURD_TEMPLATE || e.dead) return 1;
    const total = e.castTotal ?? 0;
    const p = total > 0 ? 1 - (e.castRemaining ?? 0) / total : 1;
    const born = this.gourdBorn.get(id);
    const since = born === undefined ? 99 : this.time - born;
    return swellScale(p, since, this.time);
  }

  update(dt: number, reducedMotion: boolean): void {
    if (this.disposed) return;
    this.time += dt;
    this.frameDt = dt;
    this.updateFalls(dt, reducedMotion);
    this.updatePatches(dt);
    this.updateShockwave();
    this.updateBlastRings();
    this.halosUsed = 0;
    // his collapse into straw, his gourds' glow, his reel
    this.bossNear = false;
    this.toys.begin(dt, reducedMotion);
    this.bossSeen = false;
    this.entities().forEach(this.watchEntity);
    this.toys.end();
    // his pole stands only while he does (the event open, his field raised)
    if (this.pole) this.pole.visible = this.bossSeen && this.poleSpot !== null;
    this.updateAwaken();
    // his curse: built on the first sight of him, scanned only while he or a puppet is near
    this.thatchbound.update(dt, reducedMotion, this.bossNear);
    const twins = this.time - this.rootBorn < TWIN_SEC;
    for (let i = this.halosUsed; i < this.halos.length; i++) {
      const s = this.halos[i];
      (s.material as THREE.SpriteMaterial).opacity = 0;
      s.scale.setScalar(0.001);
      s.visible = twins && i === 0;
    }
    if (this.gourdBorn.size > 0) {
      for (const id of this.gourdBorn.keys()) if (!this.entity(id)) this.gourdBorn.delete(id);
    }
    if (this.gourdPulseAt.size > 0) {
      for (const id of this.gourdPulseAt.keys()) {
        const g = this.entity(id);
        if (!g || g.dead) this.gourdPulseAt.delete(id);
      }
    }
  }

  private updateFalls(dt: number, reducedMotion: boolean): void {
    if (!this.comets) return;
    const pumpkins = this.ensurePumpkins();
    const twins = this.time - this.rootBorn < TWIN_SEC;
    // an idle pool past its twin window was hidden last frame: nothing to rewrite
    if (this.fallsIdle && !twins && !this.falls.some((f) => f.active)) return;
    let any = false;
    for (let i = 0; i < this.falls.length; i++) {
      const f = this.falls[i];
      let shown = false;
      if (f.active && this.time >= f.start) {
        const t = (this.time - f.start) / Math.max(0.05, f.end - f.start);
        if (t >= 1) {
          f.active = false;
        } else {
          shown = true;
          any = true;
          if (!f.up && !f.whistled) {
            // the whistle starts as it drops out of the sky, heard where it will land
            f.whistled = true;
            this.audio()?.playAt?.(GOURDFALL_WHISTLE_SFX, f.to.x, f.to.y, f.to.z, {
              gain: 0.8,
              cooldown: 0.05,
            });
          }
          const p = f.up
            ? fallPoint(f.from, f.to, 1 - (1 - t) * (1 - t))
            : fallPoint(f.from, f.to, t);
          const size = f.up ? FALL_SCALE * 0.75 * (1 - t * 0.85) : FALL_SCALE;
          // the pumpkin, tumbling
          const spin = reducedMotion ? 0 : (this.time - f.start) * f.spin;
          scratchQuat.setFromEuler(scratchEuler.set(spin, spin * 0.6, spin * 0.3));
          scratchMat.compose(
            this.scratch.set(p.x, p.y, p.z),
            scratchQuat,
            scratchScale.setScalar(size),
          );
          if (pumpkins) for (const m of pumpkins) m.setMatrixAt(i, scratchMat);
          // its comet: the tail pointing back up the path it came down
          scratchDir.subVectors(f.from, f.to).normalize();
          scratchQuat.setFromUnitVectors(UP, scratchDir);
          const flick = reducedMotion ? 1 : 0.9 + 0.2 * Math.sin(this.time * 31 + i);
          scratchMat.compose(
            this.scratch2.set(p.x, p.y, p.z),
            scratchQuat,
            scratchScale.set(size * 0.42 * flick, size * 0.55, size * 0.42 * flick),
          );
          this.comets.setMatrixAt(i, scratchMat);
          // sparks and smoke shed along the trail
          this.particles.burst(
            this.scratch.set(p.x, p.y, p.z),
            'shadow',
            1,
            0.18,
            GOURDFALL_PURPLE.fire[1],
          );
          this.particles.toyMote(
            p.x,
            p.y - 0.5,
            p.z,
            0,
            0.6,
            0,
            GOURDFALL_PURPLE.fire[3],
            0.12,
            0.6,
            -0.2,
            'spark',
            40,
            dt,
          );
          if (!f.up) this.particles.fluidSmoke(p.x, p.y, p.z, GOURDFALL_PURPLE.smoke, dt, 4);
        }
      }
      if (!shown) {
        this.comets.setMatrixAt(i, HIDDEN);
        if (pumpkins) for (const m of pumpkins) m.setMatrixAt(i, HIDDEN);
      }
    }
    this.comets.instanceMatrix.needsUpdate = true;
    if (pumpkins) for (const m of pumpkins) m.instanceMatrix.needsUpdate = true;
    // an idle pool draws nothing (its programs linked with the root's gated attach)
    this.comets.visible = any || twins;
    if (pumpkins) for (const m of pumpkins) m.visible = any;
    this.fallsIdle = !any && !twins && pumpkins !== null;
  }

  private updatePatches(dt: number): void {
    // fixed density: the governor never thins a hazard a player reacts to
    const calls = chaffFlameCalls(CHAFF_DENSITY);
    for (let i = this.patches.length - 1; i >= 0; i--) {
      const patch = this.patches[i];
      const age = this.time - patch.born;
      const k = chaffStrength(age, patch.total);
      if (age >= patch.total) {
        patch.disc.removeFromParent();
        patch.glow.removeFromParent();
        patch.disc.geometry.dispose();
        this.patches.splice(i, 1);
        continue;
      }
      // the disc is drawn at the TRUE radius for the whole burn: the edge a player reads is
      // the edge that burns (it only shows once the patch has caught)
      patch.disc.visible = k > 0.02;
      patch.glow.visible = k > 0.02;
      for (let c = 0; c < calls; c++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * patch.radius * 0.95;
        // violet embers lifting off the scorched stubble (his witch-fire, round 10)
        this.particles.toyMote(
          patch.x + Math.sin(a) * r,
          patch.y + 0.1,
          patch.z + Math.cos(a) * r,
          0,
          0.9 + Math.random() * 0.6,
          0,
          c % 3 === 2 ? GOURDFALL_PURPLE.fire[1] : GOURDFALL_PURPLE.fire[0],
          0.09,
          0.9,
          -0.3,
          'spark',
          14 * k,
          dt,
        );
      }
      // low tongues of flame licking up off the stubble, a few a second
      patch.flameClock -= dt;
      if (patch.flameClock <= 0 && k > 0.2) {
        patch.flameClock = 0.14;
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * patch.radius * 0.85;
        this.particles.burst(
          this.scratch.set(patch.x + Math.sin(a) * r, patch.y + 0.15, patch.z + Math.cos(a) * r),
          'shadow',
          4,
          0.35,
          GOURDFALL_PURPLE.fire[1],
        );
      }
      this.particles.fluidSmoke(patch.x, patch.y, patch.z, GOURDFALL_PURPLE.smoke, dt, 2 * k);
    }
  }

  private updateShockwave(): void {
    if (!this.ring || !this.ringMaterial || !this.fireball || !this.fireballMaterial) return;
    if (this.ringBorn < 0) {
      const twins = this.time - this.rootBorn < TWIN_SEC;
      this.ring.visible = twins;
      this.fireball.visible = twins;
      return;
    }
    this.ring.visible = true;
    // the nightfall wake rolls only the ring out (no gourd's fireball at his feet)
    this.fireball.visible = this.ring.userData.wake !== true;
    const age = this.time - this.ringBorn;
    // the fireball: swells to 7 yd in a third of a second, then rolls up and fades
    const fk = Math.min(1, age / 1.1);
    const grow = 1 - (1 - Math.min(1, age / 0.32)) ** 3;
    this.fireball.position.set(this.ringAt.x, this.ringAt.y + 1.5 + 2.2 * fk, this.ringAt.z);
    this.fireball.scale.set(7 * grow, 6 * grow * (1 + 0.3 * fk), 7 * grow);
    this.fireballMaterial.opacity = 0.85 * (1 - fk) ** 1.5;
    this.fireballMaterial.color.setRGB(1, 0.42 - 0.22 * fk, 0.1 - 0.08 * fk);
    const life = 1.1;
    if (age >= life) {
      this.ringBorn = -1;
      this.ringMaterial.opacity = 0;
      this.ring.scale.setScalar(0.001);
      this.fireballMaterial.opacity = 0;
      this.fireball.scale.setScalar(0.001);
      return;
    }
    const k = Math.min(1, age / 0.75);
    const r = (this.ring.userData.radius as number) * (1 - (1 - k) ** 3);
    this.ring.position.copy(this.ringAt);
    this.ring.scale.setScalar(Math.max(0.001, r));
    this.ringMaterial.opacity = 0.9 * (1 - k);
  }

  private halosUsed = 0;

  private placeHalo(x: number, y: number, z: number, size: number, opacity: number, color: number) {
    if (this.halosUsed >= this.halos.length) return;
    const s = this.halos[this.halosUsed++];
    s.visible = true;
    s.position.set(x, y, z);
    s.scale.setScalar(size);
    const m = s.material as THREE.SpriteMaterial;
    m.opacity = opacity;
    m.color.setHex(color);
  }

  /** Per entity, per frame: allocation-free (a bound method over Map.forEach). */
  private readonly watchEntity = (e: EntityLike, id: number): void => {
    this.toys.watch(e, id);
    if (e.templateId === THATCHGRIN_TEMPLATE && !e.dead) this.bossNear = true;
    if (e.templateId === SWELLING_GOURD_TEMPLATE) {
      this.ensureRoot();
      if (e.dead) return;
      const total = e.castTotal ?? 0;
      const p = total > 0 ? 1 - (e.castRemaining ?? 0) / total : 0;
      const swell = this.bodySwell(e, id);
      const cy = e.pos.y + 1.9 * swell;
      const glow = swellGlow(p, this.time);
      // its heartbeat, quickening as it ripens (the throb's sound)
      const next = this.gourdPulseAt.get(id);
      if (next === undefined) this.gourdPulseAt.set(id, this.time + swellPulseInterval(p));
      else if (this.time >= next) {
        this.gourdPulseAt.set(id, this.time + swellPulseInterval(p));
        this.audio()?.playAt?.(SWELL_PULSE_SFX, e.pos.x, cy, e.pos.z, {
          gain: swellPulseGain(p),
          cooldown: 0.1,
        });
      }
      // a hot core seen through its carved face and seams, kept small and soft so the gourd
      // itself (its grin, its rind) still reads through it
      this.placeHalo(
        e.pos.x,
        cy,
        e.pos.z,
        2.0 * swell * (0.85 + 0.3 * glow),
        0.1 + 0.4 * glow,
        0xffffff,
      );
      // embers and smoke leaking out of its seams, more and faster as it ripens
      const leak = 0.6 + 2.4 * p + Math.max(0, swellThrob(p, this.time));
      this.particles.campfireEmber(
        this.scratch.set(e.pos.x, cy + 1.2 * swell, e.pos.z),
        this.frameDt * leak,
      );
      this.particles.fluidSmoke(
        e.pos.x,
        cy + 1.4 * swell,
        e.pos.z,
        SMOKE,
        this.frameDt,
        1.5 + 4 * p,
      );
      return;
    }
    if (e.templateId !== THATCHGRIN_TEMPLATE) return;
    this.ensureRoot();
    this.bossSeen = true;
    this.placePole(e);
    if (!e.dead) {
      this.deadSeen.delete(id);
      this.watchWake(e, id);
      this.watchReel(e);
      return;
    }
    if (this.deadSeen.has(id)) return;
    this.deadSeen.add(id);
    const { x, y, z } = e.pos;
    this.particles.burstLater(DEATH_FOLD_SEC, x, y + 2.2, z, 'nature', 36, 1.6, STRAW_COLOR);
    this.particles.burstLater(DEATH_HEAP_SEC, x, y + 0.6, z, 'nature', 48, 1.9, STRAW_COLOR);
    this.particles.burstLater(DEATH_HEAP_SEC, x, y + 0.4, z, 'nature', 24, 1.2, 0x8a6a34);
  };

  /** Seat his pole: exactly where he hangs on it while asleep (the sim snaps his bed to his
   *  spawn and its facing), else his field's own spot and facing. Placed once a spot is
   *  known; moved only if he is seen asleep somewhere else (a new field). */
  private placePole(e: EntityLike): void {
    if (!this.pole) return;
    let spot = this.poleSpot;
    if (e.asleep && !e.dead) {
      const moved =
        !spot ||
        Math.abs(spot.x - e.pos.x) > 0.05 ||
        Math.abs(spot.z - e.pos.z) > 0.05 ||
        Math.abs(spot.facing - e.facing) > 0.01;
      if (moved) spot = { x: e.pos.x, y: e.pos.y, z: e.pos.z, facing: e.facing };
    } else if (!spot) {
      const seed = this.fieldSeed();
      const field = seed === null ? null : resolveScarecrowField(seed);
      if (field) {
        spot = { x: field.x, y: this.groundY(field.x, field.z), z: field.z, facing: field.facing };
      }
    }
    if (!spot || spot === this.poleSpot) return;
    this.poleSpot = spot;
    // the post's foot sits on the ground under it, not under his feet
    const at = thatchgrinPoleAt(spot.x, spot.z, spot.facing).post;
    const y = Math.min(spot.y, this.groundY(at.x, at.z));
    this.pole.position.set(spot.x, y, spot.z);
    this.pole.rotation.set(0, spot.facing, 0);
    this.pole.updateMatrixWorld(true);
  }

  /** The nightfall wake's edge (asleep last frame, awake now): start its VFX timeline. */
  private watchWake(e: EntityLike, id: number): void {
    const asleep = e.asleep === true;
    const was = this.asleepSeen.get(id);
    this.asleepSeen.set(id, asleep);
    if (was === true && !asleep) {
      this.awakenAt = this.time;
      this.awakenAtPos.set(e.pos.x, e.pos.y, e.pos.z);
      this.awakenFacing = e.facing;
      this.awakenStep = 0;
    }
  }

  /** The wake's beats, on this layer's clock (scarecrow_clips.py awaken_keys): a violet
   *  flare in his skull as his head jerks up, splinters and crows bursting off the bar as he
   *  tears free, the stubble thrown up in a ring of witch-fire as his feet hit it. */
  private updateAwaken(): void {
    if (this.awakenAt < 0) return;
    const t = this.time - this.awakenAt;
    const { x, y, z } = this.awakenAtPos;
    const head = y + 6.3;
    if (this.awakenStep === 0 && t >= 0.05) {
      this.awakenStep = 1;
      // a shiver of straw off him as the first twitch runs through
      this.particles.burst(this.scratch.set(x, y + 3.6, z), 'nature', 18, 0.8, STRAW_COLOR);
    }
    if (this.awakenStep === 1 && t >= AWAKEN_HEAD_SEC) {
      this.awakenStep = 2;
      this.particles.burst(
        this.scratch.set(x, head, z),
        'shadow',
        46,
        1.6,
        GOURDFALL_PURPLE.fire[1],
      );
      this.particles.fireworkBurst(this.scratch.set(x, head, z), GOURDFALL_PURPLE.fire, 40, 1.4);
      this.audio()?.playAt?.(SWELL_PULSE_SFX, x, head, z, { gain: 0.7, cooldown: 0.2 });
    }
    if (this.awakenStep === 2 && t >= AWAKEN_TEAR_SEC) {
      this.awakenStep = 3;
      const P = THATCHGRIN_POLE;
      for (const side of [1, -1]) {
        const end = bodyLocalToWorld(x, z, this.awakenFacing, side * (P.barHalf - 0.4), -P.barBack);
        this.particles.fireworkBurst(
          this.scratch.set(end.x, y + P.barHeight, end.z),
          DIRT_COLORS,
          26,
          1.3,
        );
        this.particles.burst(
          this.scratch.set(end.x, y + P.barHeight, end.z),
          'nature',
          16,
          1.0,
          STRAW_COLOR,
        );
      }
      for (let i = 0; i < 3; i++) {
        this.particles.burst(this.scratch.set(x, y + 5.4, z), 'shadow', 22, 1.5, FEATHER_COLORS[i]);
      }
    }
    if (this.awakenStep === 3 && t >= AWAKEN_LAND_SEC) {
      this.awakenStep = 4;
      this.particles.groundPuff(this.scratch.set(x, y, z), 2.6, 0x4a3c2c);
      this.particles.fireworkBurst(this.scratch.set(x, y + 0.4, z), GOURDFALL_PURPLE.fire, 70, 2.2);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        this.particles.burstLater(
          0.05,
          x + Math.sin(a) * 2.6,
          y + 0.3,
          z + Math.cos(a) * 2.6,
          'shadow',
          10,
          1.0,
          GOURDFALL_PURPLE.fire[i % GOURDFALL_PURPLE.fire.length],
        );
      }
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        this.particles.fluidSmoke(
          x + Math.sin(a) * 1.8,
          y,
          z + Math.cos(a) * 1.8,
          GOURDFALL_PURPLE.smoke,
          1,
          1000,
        );
      }
      // the shockwave ring rolls out over the stubble in his witch-fire
      if (this.ring && this.ringMaterial && this.ringBorn < 0) {
        this.ringMaterial.color.setHex(GOURDFALL_PURPLE.rim);
        this.ringAt.set(x, y + 0.25, z);
        this.ringBorn = this.time;
        this.ring.userData.radius = 9;
        this.ring.userData.wake = true;
      }
    }
    // the flare in his skull, swelling as his head comes up and holding to his landing
    if (t < AWAKEN_LAND_SEC + 0.8) {
      const k = Math.max(0, Math.min(1, (t - AWAKEN_HEAD_SEC + 0.25) / 0.35));
      const fade = Math.max(0, Math.min(1, (AWAKEN_LAND_SEC + 0.8 - t) / 0.6));
      const pulse = 0.8 + 0.2 * Math.sin(t * 17);
      this.placeHalo(x, head - 0.4, z, 3.6 * pulse * k, 0.85 * k * fade, GOURDFALL_PURPLE.glow);
    } else {
      this.awakenAt = -1;
    }
  }

  /** His reel after a gourd breaks: dizzy sparks circling over his hat while he is
   *  Uprooted, an ember glow through the split in his chest while his rind is Split. */
  private watchReel(e: EntityLike): void {
    const auras = e.auras;
    if (!auras || auras.length === 0) return;
    let stunned = false;
    let split = false;
    for (const a of auras) {
      if (a.id === 'thatchgrin_uprooted') stunned = true;
      else if (a.id === 'thatchgrin_split_rind') split = true;
    }
    if (split) {
      const pulse = 0.75 + 0.25 * Math.sin(this.time * 7);
      this.placeHalo(e.pos.x, e.pos.y + CHEST_UP, e.pos.z, 3.4 * pulse, 0.75 * pulse, 0xff6a2a);
    }
    if (stunned) {
      this.dizzyClock -= this.frameDt;
      if (this.dizzyClock <= 0) {
        this.dizzyClock = 0.05;
        for (let k = 0; k < 3; k++) {
          const a = this.time * 5 + (k / 3) * Math.PI * 2;
          this.particles.burst(
            this.scratch.set(
              e.pos.x + Math.cos(a) * 1.4,
              e.pos.y + DIZZY_UP + 0.2 * Math.sin(this.time * 9 + k),
              e.pos.z + Math.sin(a) * 1.4,
            ),
            'holy',
            1,
            0.05,
            0xffe066,
          );
        }
        this.particles.burst(
          this.scratch.set(e.pos.x, e.pos.y + 3, e.pos.z),
          'nature',
          1,
          0.6,
          STRAW_COLOR,
        );
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.thatchbound.dispose();
    this.toys.dispose();
    for (const p of this.patches) p.disc.geometry.dispose();
    this.patches.length = 0;
    this.root?.removeFromParent();
    this.discMaterial?.dispose();
    this.discGeometry?.dispose();
    this.discTexture?.dispose();
    this.cometMaterial?.dispose();
    this.cometGeo?.dispose();
    this.comets?.dispose();
    this.releasePumpkins();
    this.haloTexture?.dispose();
    for (const s of this.halos) (s.material as THREE.SpriteMaterial).dispose();
    this.ringMaterial?.dispose();
    this.ring?.geometry.dispose();
    this.blastRings?.dispose();
    this.blastMaterial?.dispose();
    this.pole?.geometry.dispose();
    (this.pole?.material as THREE.Material | undefined)?.dispose();
    this.pole = null;
    this.poleSpot = null;
    this.blastRings = null;
    this.blastMaterial = null;
    this.blasts.length = 0;
    this.fireballMaterial?.dispose();
    this.fireball?.geometry.dispose();
    this.fireballMaterial = null;
    this.fireball = null;
    this.discMaterial = null;
    this.discGeometry = null;
    this.discTexture = null;
    this.cometMaterial = null;
    this.cometGeo = null;
    this.comets = null;
    this.halos = [];
    this.ring = null;
    this.ringMaterial = null;
    this.root = null;
  }
}
