// The Chapel Gargoyle's death, planned (painter: crypt_gargoyle_crumble_fx.ts).
// A gargoyle is carved stone: it does not lie down, it breaks. Cracks race
// over the body for a held beat, the body bursts into falling blocks that
// smash on the flags, a dust cloud rolls out, and a low heap of rubble is
// left where it stood, which is the corpse the players loot.
//
// Pure: the beat's clock, where each block starts, how it falls and where it
// lands, the heap's footprint and the gestures that hide the rig. No three, no
// DOM, no clock of its own; in RENDER_PURE_CORES
// (tests/hollow_crypt_gargoyle_crumble.test.ts).

import { fxHash } from './crypt_creature_fx_core';
import { GARGOYLE_BODY } from './crypt_trash_kit_fx_core';

/** The rig's whole model hides on this gesture (VisualDef.meshToggles): the
 *  heap stands in for it. Suffixed `@<yards>` when the body was left over the
 *  floor (gargoyleRubbleGesture). */
export const GARGOYLE_RUBBLE_GESTURE = 'crypt_gargoyle_rubble';
/** ...and shows again on this one (a gargoyle that lives again). */
export const GARGOYLE_WHOLE_GESTURE = 'crypt_gargoyle_whole';

/** The scale the kit's rubble pieces are authored for (the template's 1.5). */
export const GARGOYLE_AUTHORED_SCALE = 1.5;

/**
 * The heap (the kit's `Kit_GargoyleRubble`), in WORLD yards at the authored
 * scale: its highest point and the reach of its scatter. A player stands 2.6
 * with the knee near 0.7, so the heap stays under the knee.
 */
export const GARGOYLE_RUBBLE = { height: 0.6, radius: 2.3 } as const;

/**
 * What the rig's click capsule and nameplate shrink to once the model is
 * hidden (VisualDef.meshToggles `remains`), in the rig's own yards (at
 * e.scale = 1): the heap over the authored scale, so a click on the heap is a
 * click on the corpse and the loot marker sits just over it.
 */
export const GARGOYLE_REMAINS = {
  height: GARGOYLE_RUBBLE.height / GARGOYLE_AUTHORED_SCALE,
  radius: GARGOYLE_RUBBLE.radius / GARGOYLE_AUTHORED_SCALE,
} as const;

/** The beat, in seconds from the death. */
export const CRUMBLE = {
  /** Cracks race over the standing body, then it breaks. */
  crack: 0.42,
  /** Blocks let go over this long, from the feet up. */
  release: 0.34,
  /** The heap comes up out of the dust over this long. */
  heap: 0.5,
  /** Dust still settles over the heap until here; then the beat is over. */
  settle: 4.2,
} as const;

/** The calm beat (reduced motion): no flying stone, no shake. The body goes
 *  behind a soft veil of dust and the heap is simply there. */
export const CRUMBLE_CALM = { veil: 0.3, heap: 0.45, settle: 1.8 } as const;

/** Local gravity on the falling blocks (yards a second squared, at scale 1):
 *  quicker than a real fall, so eight yards of stone come down in under a
 *  second and read as heavy. */
export const CRUMBLE_GRAVITY = 22;

/** Falling blocks at full density. */
export const CRUMBLE_CHUNKS = 46;

export interface CrumblePhase {
  /** Crack sprites lit so far, as a share of them (they race, never fade in together). */
  cracks: number;
  /** The glow of the lit cracks. */
  crackGlow: number;
  /** The rig is hidden from here on. */
  broken: boolean;
  /** The flash as it breaks (1 at the break, gone a third of a second on). */
  flash: number;
  /** The heap's rise out of the dust, 0 to 1. */
  heap: number;
  /** Dust still drifting off the heap, 1 fading to 0. */
  settling: number;
  /** The beat is over: only the heap is left. */
  done: boolean;
}

function smooth(t: number): number {
  const k = Math.min(1, Math.max(0, t));
  return k * k * (3 - 2 * k);
}

/**
 * The beat `t` seconds after the death, written into `out`. `fall` is how long
 * the stone takes to reach the floor from where the body broke (0 on the
 * floor): the heap waits for it. `calm` is the reduced-motion beat.
 */
export function crumblePhaseInto(
  t: number,
  fall: number,
  calm: boolean,
  out: CrumblePhase,
): CrumblePhase {
  if (calm) {
    out.cracks = 0;
    out.crackGlow = 0;
    out.broken = t >= CRUMBLE_CALM.veil;
    out.flash = 0;
    out.heap = smooth((t - CRUMBLE_CALM.veil) / CRUMBLE_CALM.heap);
    out.settling = out.broken ? Math.max(0, 1 - t / CRUMBLE_CALM.settle) : 0;
    out.done = t >= CRUMBLE_CALM.settle;
    return out;
  }
  const k = Math.min(1, Math.max(0, t / CRUMBLE.crack));
  out.broken = t >= CRUMBLE.crack;
  // The cracks race: slow to start, then all over the body at once.
  out.cracks = out.broken ? 0 : k * k * (1.6 - 0.6 * k);
  out.crackGlow = out.broken ? 0 : 0.55 + 0.45 * k;
  const since = t - CRUMBLE.crack;
  out.flash = since < 0 ? 0 : Math.max(0, 1 - since / 0.32) ** 2;
  // The heap builds as the first blocks land, a moment after the break.
  out.heap = smooth((since - 0.14 - Math.max(0, fall)) / CRUMBLE.heap);
  out.settling = out.broken ? Math.max(0, 1 - since / (CRUMBLE.settle - CRUMBLE.crack)) : 0;
  out.done = t >= CRUMBLE.settle + Math.max(0, fall);
  return out;
}

/** Seconds a block takes to fall `drop` world yards at entity `scale`. */
export function crumbleFallSeconds(drop: number, scale: number): number {
  if (!(drop > 0) || !(scale > 0)) return 0;
  return Math.sqrt((2 * drop) / (CRUMBLE_GRAVITY * scale));
}

/** A region of the body the blocks are cut from, in the rig's own yards at
 *  scale 1 (x across, y up over the floor, z ahead), with its share of them. */
interface BodyRegion {
  share: number;
  /** Mirrored across the body (one region per side, alternating). */
  paired: boolean;
  /** It breaks into long splinters (a wing's ribs, the tail), not blocks. */
  long: boolean;
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
}

/** The gargoyle in its fighting crouch (GARGOYLE_BODY is its trunk), cut into
 *  the parts a player can tell apart as they fall. */
const BODY_REGIONS: readonly BodyRegion[] = [
  // The trunk.
  {
    share: 0.3,
    paired: false,
    long: false,
    x: 0,
    y: GARGOYLE_BODY.up - 0.3,
    z: GARGOYLE_BODY.forward - 0.2,
    rx: GARGOYLE_BODY.rx * 0.8,
    ry: GARGOYLE_BODY.ry * 0.78,
    rz: GARGOYLE_BODY.rz * 0.66,
  },
  // The horned head.
  { share: 0.1, paired: false, long: false, x: 0, y: 4.35, z: 1.75, rx: 0.6, ry: 0.55, rz: 0.7 },
  // The arms, down to the talons.
  { share: 0.12, paired: true, long: false, x: 1.5, y: 2.2, z: 1.0, rx: 0.42, ry: 1.2, rz: 0.55 },
  // The haunches and legs.
  { share: 0.14, paired: true, long: false, x: 0.9, y: 1.1, z: -0.2, rx: 0.5, ry: 1.05, rz: 0.7 },
  // The wings.
  { share: 0.26, paired: true, long: true, x: 3.0, y: 4.4, z: -0.7, rx: 1.7, ry: 1.15, rz: 0.5 },
  // The tail.
  { share: 0.08, paired: false, long: true, x: 0, y: 1.1, z: -2.2, rx: 0.35, ry: 0.6, rz: 1.0 },
];

/** How high the body stands in that crouch (wing tips included), at scale 1. */
export const GARGOYLE_CROUCH_TOP = 5.6;

/** One falling block, in the rig's own yards at scale 1 (x across, y up, z ahead). */
export interface CrumbleChunk {
  /** Where it sits in the body when it breaks. */
  x: number;
  y: number;
  z: number;
  /** Seconds after the break it lets go (the feet give way first). */
  delay: number;
  /** Its velocity as it lets go. */
  vx: number;
  vy: number;
  vz: number;
  /** The block's size (the kit's block is about a yard across at 1). */
  size: number;
  /** A long splinter (a wing rib, a horn) instead of a block. */
  shard: boolean;
  /** Its turn at the break and its tumble (radians, radians a second) about `axis`. */
  yaw: number;
  spin: number;
  ax: number;
  ay: number;
  az: number;
  /** It survives its first impact, bounces once and lies there a while. */
  survives: boolean;
}

function regionOf(i: number): BodyRegion {
  // A golden stride through the shares, so neighbours in index are apart in the body.
  const u = ((i * 0.61803399) % 1) * 0.999;
  let acc = 0;
  for (const r of BODY_REGIONS) {
    if (u < acc + r.share) return r;
    acc += r.share;
  }
  return BODY_REGIONS[BODY_REGIONS.length - 1];
}

/**
 * Block `i`, written into `out`. Stateless: the same index always
 * gives the same block, so the plan needs no memory and a test can walk it.
 */
export function crumbleChunkInto(i: number, out: CrumbleChunk): CrumbleChunk {
  const region = regionOf(i);
  const side = region.paired ? (i % 2 === 0 ? 1 : -1) : 1;
  // A point inside the region's ellipsoid.
  const a = fxHash(i * 3.7 + 1.1) * Math.PI * 2;
  const up = fxHash(i * 5.3 + 2.9) * 2 - 1;
  const r = Math.sqrt(Math.max(0, 1 - up * up)) * Math.cbrt(0.2 + 0.8 * fxHash(i * 9.1 + 4.3));
  out.x = side * region.x + Math.sin(a) * r * region.rx;
  out.y = Math.max(0.2, region.y + up * region.ry);
  out.z = region.z + Math.cos(a) * r * region.rz;
  // The feet give way first and the wing tips last.
  out.delay =
    CRUMBLE.release * Math.min(1, out.y / GARGOYLE_CROUCH_TOP) * (0.75 + 0.25 * fxHash(i * 2.3));
  // A collapse, not a blast: mostly down, pushed out from the body's axis a
  // little, the outer parts (the wings) folding in as much as they fly.
  const away = Math.hypot(out.x, out.z) || 1;
  const push = 0.6 + 2.2 * fxHash(i * 7.7 + 0.4);
  const inward = Math.abs(out.x) > 2.2 ? -0.9 : 1;
  out.vx = (out.x / away) * push * inward + (fxHash(i * 1.9 + 6.1) - 0.5) * 1.2;
  out.vz = (out.z / away) * push + (fxHash(i * 4.1 + 8.3) - 0.5) * 1.2;
  out.vy = -0.5 + 2.4 * fxHash(i * 6.3 + 3.7);
  // The wings and the tail break into long splinters; the rest into blocks,
  // the biggest of them out of the trunk.
  out.shard = region.long && i % 3 !== 0;
  out.size = out.shard
    ? 0.55 + 0.45 * fxHash(i * 8.9)
    : (region === BODY_REGIONS[0] ? 0.44 : 0.32) + 0.4 * fxHash(i * 8.9) ** 1.5;
  out.yaw = fxHash(i * 11.3) * Math.PI * 2;
  out.spin = (2.2 + 4.6 * fxHash(i * 12.7)) * (i % 2 === 0 ? 1 : -1);
  const ax = fxHash(i * 13.1) - 0.5;
  const ay = (fxHash(i * 14.9) - 0.5) * 0.6;
  const az = fxHash(i * 16.3) - 0.5;
  const len = Math.hypot(ax, ay, az) || 1;
  out.ax = ax / len;
  out.ay = ay / len;
  out.az = az / len;
  out.survives = i % 3 === 0;
  return out;
}

/** Where a block is, and what it is doing. */
export interface CrumbleChunkPose {
  x: number;
  y: number;
  z: number;
  /** Its turn about its axis (radians). */
  angle: number;
  /** Its drawn size as a share of its own (0: gone). */
  scale: number;
  /** Seconds since the break at which it first hits the floor. */
  impactAt: number;
  /** It has hit the floor. */
  landed: boolean;
}

/** A block lies this long after its bounce, then sinks into the heap's dust. */
const CHUNK_REST = 0.7;
const CHUNK_SINK = 0.55;
/** How much of its fall a surviving block keeps on the bounce. */
const CHUNK_BOUNCE = 0.24;

/**
 * Block `c`, `t` seconds after the break, written into `out`. `lift` is how
 * far over the floor the body broke (the rig's own yards: 0 on the floor, a
 * dive's height in the air), so a block always comes to rest ON the floor.
 * Closed form: no state, so a frame can be skipped or replayed.
 */
export function crumbleChunkPoseInto(
  c: CrumbleChunk,
  t: number,
  lift: number,
  out: CrumbleChunkPose,
): CrumbleChunkPose {
  const g = CRUMBLE_GRAVITY;
  const rest = c.size * (c.shard ? 0.12 : 0.3);
  const y0 = c.y + Math.max(0, lift);
  const drop = Math.max(0, y0 - rest);
  const fall = (c.vy + Math.sqrt(c.vy * c.vy + 2 * g * drop)) / g;
  out.impactAt = c.delay + fall;
  const tau = t - c.delay;
  if (tau <= 0) {
    out.x = c.x;
    out.y = y0;
    out.z = c.z;
    out.angle = c.yaw;
    out.scale = 1;
    out.landed = false;
    return out;
  }
  if (tau < fall) {
    out.x = c.x + c.vx * tau;
    out.y = y0 + c.vy * tau - 0.5 * g * tau * tau;
    out.z = c.z + c.vz * tau;
    out.angle = c.yaw + c.spin * tau;
    out.scale = 1;
    out.landed = false;
    return out;
  }
  out.landed = true;
  const hx = c.x + c.vx * fall;
  const hz = c.z + c.vz * fall;
  if (!c.survives) {
    // It smashes on the flags: gone in the frame it lands (its dust and
    // splinters are the painter's).
    out.x = hx;
    out.y = rest;
    out.z = hz;
    out.angle = c.yaw + c.spin * fall;
    out.scale = 0;
    return out;
  }
  const after = tau - fall;
  const speed = Math.abs(c.vy - g * fall);
  const up = Math.min(4.2, speed * CHUNK_BOUNCE);
  const hop = (2 * up) / g;
  const air = Math.min(after, hop);
  out.x = hx + c.vx * 0.45 * air;
  out.z = hz + c.vz * 0.45 * air;
  out.y = rest + Math.max(0, up * air - 0.5 * g * air * air);
  out.angle = c.yaw + c.spin * fall + c.spin * 0.35 * air;
  const lying = after - hop - CHUNK_REST;
  const sink = lying <= 0 ? 0 : Math.min(1, lying / CHUNK_SINK);
  out.scale = 1 - sink * sink;
  out.y -= rest * sink;
  return out;
}

/** Seconds after the break by which every block has landed and gone (the
 *  painter stops drawing them), for a body that broke `lift` over the floor. */
export function crumbleChunksSeconds(lift: number): number {
  const drop = GARGOYLE_CROUCH_TOP + Math.max(0, lift);
  const fall = (2.4 + Math.sqrt(2.4 * 2.4 + 2 * CRUMBLE_GRAVITY * drop)) / CRUMBLE_GRAVITY;
  return CRUMBLE.release + fall + (2 * 4.2) / CRUMBLE_GRAVITY + CHUNK_REST + CHUNK_SINK + 0.1;
}

/** How many blocks fall at an effects `density` (1, or under half on the low
 *  tier). The heap and the corpse are the same on every tier. */
export function crumbleChunkCount(density: number): number {
  return Math.max(10, Math.round(CRUMBLE_CHUNKS * Math.min(1, Math.max(0, density))));
}

/** The heap's turn on the floor: off the gargoyle's facing, different for
 *  each one, so two heaps side by side are not twins. */
export function crumbleHeapYaw(id: number, facing: number): number {
  return facing + fxHash(id * 0.731 + 0.19) * Math.PI * 2;
}

/**
 * The gesture that hides the rig. A body the sim left over the floor (killed
 * mid dive: a dead mob never falls) says how far under it the heap lies, in
 * the rig's own yards, so its click capsule drops onto the heap
 * (characters/gesture_mesh_toggles.ts reads the suffix).
 */
export function gargoyleRubbleGesture(dropWorld: number, scale: number): string {
  const drop = scale > 0 ? dropWorld / scale : 0;
  if (!(drop > 0.05)) return GARGOYLE_RUBBLE_GESTURE;
  return `${GARGOYLE_RUBBLE_GESTURE}@${drop.toFixed(2)}`;
}
