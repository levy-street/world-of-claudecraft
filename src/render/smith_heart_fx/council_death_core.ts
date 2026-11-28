// The Hammer Council's deaths as numbers, "The quarry falls silent": the
// pure half of council_death_fx.ts and its two parts (council_death_stone.ts,
// the Guardian of the Hammer; council_death_crystal.ts, the Seam Singer). The
// counterpart of the entrance (council_entrance_core.ts, "The quarry wakes"):
// there the rock cracked gold, tore open and the columns lit one by one;
// here it runs back.
//
// Each member dies in its own scene, whenever it falls (they can die apart):
//
//   the Guardian   its cracks blaze gold, racing up it from its feet to its
//                  crown; it sags to its knees (its Death clip); it splits:
//                  heavy slabs break off its body where its rocks hang (the
//                  rig's own bones, council_body_sockets.ts), slump and
//                  settle round it with dust and a thud each, their seams
//                  cooling; the amber core in its chest gutters, flaring
//                  weaker each time, and goes out in a wisp of smoke;
//   the Singer     a last sustained crystal note, rings of resonance pulsing
//                  off her faster; her crystal fractures, light leaking out
//                  through the seams in shafts that multiply and blaze; she
//                  shatters into glittering shards that hang a beat in the
//                  air, turning and glinting, then rain down and fade.
//
// When the SECOND one falls, the encounter's end: the five carved columns
// surge with light once more and power down one by one (the light draining
// from their crowns to their feet, the reverse of their waking), the room's
// crystals settle dark and a last dust drifts down over the quarry.
//
// Presentation only: no camera, no input, nothing held back from loot or
// exit. A member first seen long dead shows its settled rubble and a dark
// husk, none of the scene; a dev replay (`/dev heart council death`) plays
// it on the living bodies and stands them back up.
//
// Node-only (RENDER_PURE_CORES): no three.js, no DOM, deterministic (a hash,
// never rng).

import { QUARRY_PILLAR_SPOTS } from '../../sim/content/smith_heart_layout';
import type { CouncilRole } from '../../sim/encounters/smith_heart/council_ids';
import { COUNCIL_MODEL_HEIGHTS } from './council_bodies_core';
import { COLUMN_ORDER } from './council_entrance_core';

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, x: number) => {
  const k = clamp01((x - a) / (b - a));
  return k * k * (3 - 2 * k);
};
/** A one-shot spike at `since` 0 falling over `span` (0 before). */
const spike = (since: number, span: number) =>
  since < 0 ? 0 : Math.min(1, since / 0.05) * (1 - clamp01(since / span)) ** 2;

/** Deterministic hash in [0, 1). */
export function councilDeathHash(a: number, b: number): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const hash = councilDeathHash;

/** Each member's drawn height (yards): the model heights times the
 *  templates' scales (Guardian 3.2, Singer 2.0). */
export const COUNCIL_DEATH_HEIGHT: Readonly<Record<CouncilRole, number>> = {
  guardian: COUNCIL_MODEL_HEIGHTS.guardian * 3.2,
  singer: COUNCIL_MODEL_HEIGHTS.singer * 2.0,
};

// ---- the beats ------------------------------------------------------------------------------

/** The Guardian's scene (seconds after it fell). */
export const GUARDIAN_DEATH = {
  /** Its cracks race up it, feet to crown, and blaze. */
  seamsTo: 0.75,
  blazeFull: 0.9,
  /** It splits: its body comes apart (its Death clip's collapse) and the
   *  slabs break off with it. */
  splitAt: 1.3,
  /** Its rocks strike the floor (the clip's landing). */
  kneelAt: 1.65,
  /** The slabs' seams cool to embers, then dark. */
  coolFor: 3.4,
  /** The core gutters: weaker flares, then out. */
  gutterFrom: 3.0,
  gutters: [3.6, 4.3, 4.9] as readonly number[],
  coreOut: 5.6,
  end: 6.6,
} as const;

/** The Singer's scene (seconds after she fell). */
export const SINGER_DEATH = {
  /** The last note sounds from the start; its rings pulse off her. */
  noteFrom: 0.05,
  /** Her crystal fractures: the shafts of light leak out. */
  leakFrom: 0.2,
  leakTo: 1.25,
  /** She shatters, as her body gives (her Death clip's fall). */
  shatterAt: 1.45,
  /** The shards hang this long (each a little more), then rain. */
  hang: 0.85,
  hangJitter: 0.55,
  end: 5.6,
} as const;

/** The encounter's end beat after the second death (seconds after its
 *  start, which is the second scene's climax plus a breath). */
export const COUNCIL_END = {
  /** Every standing column surges with light. */
  surgeFor: 0.55,
  /** Then they power down one by one, each `step` after the one before,
   *  its light draining from its crown to its foot over `drain`. */
  firstAt: 0.75,
  step: 0.4,
  drain: 0.75,
  /** The last dust settling over the quarry. */
  settleFor: 1.0,
} as const;

/** When the end beat starts after the second member's death (its own
 *  climax, then a breath): the Guardian's split, the Singer's shatter. */
export const COUNCIL_END_LEAD: Readonly<Record<CouncilRole, number>> = {
  guardian: GUARDIAN_DEATH.splitAt + 1.4,
  singer: SINGER_DEATH.shatterAt + 1.5,
};

/** The end beat's length. */
export const COUNCIL_END_SECONDS =
  COUNCIL_END.firstAt +
  (QUARRY_PILLAR_SPOTS.length - 1) * COUNCIL_END.step +
  COUNCIL_END.drain +
  COUNCIL_END.settleFor;

/** Each member's scene length. */
export const COUNCIL_DEATH_END: Readonly<Record<CouncilRole, number>> = {
  guardian: GUARDIAN_DEATH.end,
  singer: SINGER_DEATH.end,
};

/** The longest a second death's scene runs, its end beat included. */
export function councilSecondDeathSeconds(role: CouncilRole): number {
  return Math.max(COUNCIL_DEATH_END[role], COUNCIL_END_LEAD[role] + COUNCIL_END_SECONDS);
}

/** The camera's thuds (at the source, felt to `reach` yards; none under
 *  reduced motion). */
export const COUNCIL_DEATH_SHAKES = {
  kneel: { amount: 0.55, reach: 90 },
  split: { amount: 0.8, reach: 110 },
  land: { amount: 0.22, reach: 50 },
  shatter: { amount: 0.4, reach: 80 },
  surge: { amount: 0.22, reach: 120 },
} as const;

/** A thud of `amount` felt `distance` yards away within `reach`: none under
 *  reduced motion or past the reach. */
export function councilDeathShake(
  amount: number,
  reach: number,
  distance: number,
  reducedMotion: boolean,
): number {
  if (reducedMotion || distance >= reach) return 0;
  return amount * (1 - (distance / reach) * 0.6);
}

/** Reduced motion keeps every flash and flare, never a blaze: their light
 *  scaled by `flash` and capped at `lightCap`. */
export const COUNCIL_DEATH_CALM = { flash: 0.65, lightCap: 0.7 } as const;

/** An added light `v` under the viewer's motion setting. */
export function councilDeathLight(v: number, reducedMotion: boolean): number {
  return reducedMotion ? Math.min(v * COUNCIL_DEATH_CALM.flash, COUNCIL_DEATH_CALM.lightCap) : v;
}

/** The gestures the scene sends through the renderer's gesture seam
 *  (characters/smith_heart_boss_looks.ts binds them): the husk each member
 *  leaves (a shade pulse dulling its stone, re-sent while it holds, as the
 *  entrance's dark is; its model has no emissive map, so the blaze is the
 *  scene's own light over it), and a dev replay's fall (its Death clip on
 *  the living body; the entrance's stand stance stands it back up). Never
 *  sim ids. */
export const COUNCIL_DEATH_GESTURES = {
  guardianHusk: 'smith_heart_council_guardian_death_husk',
  guardianFall: 'smith_heart_council_guardian_death_fall',
  singerHusk: 'smith_heart_council_singer_death_husk',
  singerFall: 'smith_heart_council_singer_death_fall',
} as const;

/** Seconds between re-sends of the husk's shade (it holds a second). */
export const COUNCIL_HUSK_EVERY = 0.35;

/** The husks' shade: each body's own colour times this, stone gone dark. */
export const COUNCIL_HUSK_SHADE: Readonly<Record<CouncilRole, number>> = {
  guardian: 0.34,
  singer: 0.38,
};

/** Did the scene cross `at` between last frame's `prev` and this one's `t`
 *  (a moment fires once, only for a scene seen crossing it, never for a late
 *  sight long past it)? */
export function councilDeathCrossed(prev: number, t: number, at: number): boolean {
  return prev >= 0 && prev < at && t >= at && t - at < 0.5;
}

// ---- the clock --------------------------------------------------------------------------------

/** A dev replay plays a member's scene for this long, then it stands. */
export function councilReplaySeconds(role: CouncilRole): number {
  return councilSecondDeathSeconds(role) + 0.6;
}

/** `/dev heart council death` replays both: the Singer this long after the
 *  Guardian, so the end beat follows her. */
export const COUNCIL_REPLAY_STAGGER = 2.6;

/** A member's scene clock: seconds since it fell at `deadAt` (a corpse first
 *  seen dead is dated long past), or since a dev replay began on it living
 *  at `replayAt` (-1 none); -1 when neither (it stands). */
export function councilDeathTime(
  role: CouncilRole,
  clock: number,
  deadAt: number,
  replayAt: number,
  dead: boolean,
): number {
  if (dead) return clock - deadAt;
  if (replayAt >= 0 && clock >= replayAt && clock - replayAt < councilReplaySeconds(role))
    return clock - replayAt;
  return -1;
}

/** The end beat's clock: both members in their scenes (dead or replayed)
 *  at `gT` and `sT` seconds; -1 while either stands. It starts at the second
 *  one's climax (a long-dead pair is long past it). */
export function councilEndTime(gT: number, sT: number): number {
  if (gT < 0 || sT < 0) return -1;
  // The later death is the one with the smaller scene time.
  const second: CouncilRole = gT <= sT ? 'guardian' : 'singer';
  const t = second === 'guardian' ? gT : sT;
  return t - COUNCIL_END_LEAD[second];
}

// ---- the bodies' points -----------------------------------------------------------------------

/** One point on a member's body: the bone its rock rides on the shipped
 *  model (council_body_sockets.ts hangs a socket there), and where it sits
 *  without the model (a share of the height up the body, yards to its side
 *  and forward over the height), and the rock's size there (a share of the
 *  height). */
export interface CouncilBodyPoint {
  bone: string;
  h: number;
  side: number;
  fwd: number;
  size: number;
}

const pair = (
  bone: string,
  h: number,
  side: number,
  fwd: number,
  size: number,
): CouncilBodyPoint[] => [
  { bone: `${bone}.L`, h, side, fwd, size },
  { bone: `${bone}.R`, h, side: -side, fwd, size },
];

/** The Guardian's rocks (heart_slabwright.glb's bones), feet to crown. */
export const GUARDIAN_POINTS: readonly CouncilBodyPoint[] = [
  { bone: 'Tail3', h: 0.08, side: 0, fwd: 0, size: 0.07 },
  ...pair('ShardG', 0.16, 0.08, 0.04, 0.07),
  { bone: 'Tail1', h: 0.24, side: 0, fwd: -0.02, size: 0.08 },
  ...pair('Hand', 0.3, 0.3, 0.06, 0.09),
  { bone: 'Pelvis', h: 0.38, side: 0, fwd: 0, size: 0.11 },
  { bone: 'WaistA', h: 0.46, side: 0, fwd: 0, size: 0.1 },
  ...pair('ShardD', 0.48, 0.18, -0.08, 0.08),
  ...pair('ForeArm', 0.5, 0.3, 0, 0.09),
  { bone: 'Chest', h: 0.62, side: 0, fwd: 0, size: 0.13 },
  ...pair('ShardB', 0.66, 0.24, -0.02, 0.07),
  ...pair('Shoulder', 0.72, 0.22, -0.03, 0.1),
  ...pair('ShardA', 0.76, 0.18, -0.12, 0.07),
  { bone: 'Head', h: 0.86, side: 0, fwd: 0.03, size: 0.08 },
  { bone: 'Crown', h: 0.95, side: 0, fwd: -0.04, size: 0.06 },
];

/** The Singer's crystal (heart_seam_singer.glb's bones), foot to crown. */
export const SINGER_POINTS: readonly CouncilBodyPoint[] = [
  { bone: 'Tip', h: 0.08, side: 0, fwd: 0, size: 0.05 },
  { bone: 'Col3', h: 0.24, side: 0, fwd: 0, size: 0.06 },
  ...pair('ShardD', 0.3, 0.2, 0.04, 0.05),
  { bone: 'Col2', h: 0.36, side: 0, fwd: 0, size: 0.06 },
  ...pair('Hand', 0.44, 0.22, 0.08, 0.04),
  { bone: 'Col1', h: 0.48, side: 0, fwd: 0, size: 0.07 },
  ...pair('ShardB', 0.52, 0.18, -0.06, 0.05),
  ...pair('UpperArm', 0.6, 0.2, 0, 0.05),
  { bone: 'Chest', h: 0.62, side: 0, fwd: 0, size: 0.07 },
  { bone: 'Gem', h: 0.66, side: 0, fwd: 0.06, size: 0.05 },
  ...pair('Shoulder', 0.7, 0.13, -0.02, 0.05),
  { bone: 'Head', h: 0.82, side: 0, fwd: 0.02, size: 0.05 },
  ...pair('CrownGemLow', 0.86, 0.3, 0.02, 0.05),
  { bone: 'Crown', h: 0.9, side: 0, fwd: -0.06, size: 0.05 },
  { bone: 'CrownTop', h: 0.96, side: 0, fwd: 0.06, size: 0.05 },
];

export const COUNCIL_DEATH_POINTS: Readonly<Record<CouncilRole, readonly CouncilBodyPoint[]>> = {
  guardian: GUARDIAN_POINTS,
  singer: SINGER_POINTS,
};

/** The chest point (index into the role's points): the core, the note. */
export const COUNCIL_DEATH_CHEST: Readonly<Record<CouncilRole, number>> = {
  guardian: GUARDIAN_POINTS.findIndex((p) => p.bone === 'Chest'),
  singer: SINGER_POINTS.findIndex((p) => p.bone === 'Gem'),
};

/** A point without the model (body frame: `side` its left, `fwd` its front,
 *  `y` over its feet), in yards. */
export function councilPointFallback(
  role: CouncilRole,
  i: number,
  out: { side: number; fwd: number; y: number },
): { side: number; fwd: number; y: number } {
  const p = COUNCIL_DEATH_POINTS[role][i];
  const H = COUNCIL_DEATH_HEIGHT[role];
  out.side = p.side * H;
  out.fwd = p.fwd * H;
  out.y = p.h * H;
  return out;
}

// ---- the Guardian ---------------------------------------------------------------------------

export interface GuardianDeathLook {
  /** Its cracks' reach up it (0 none, 1 to its crown) and their blaze. */
  seams: number;
  blaze: number;
  /** The amber core in its chest (0 out, 1 burning, past 1 flaring). */
  core: number;
  /** The slabs: broken off (since the split, negative before), their seams'
   *  heat (molten) and the last ember in them. */
  sinceSplit: number;
  slabHeat: number;
  slabEmber: number;
  /** The husk's dark is held (from the split on). */
  husk: boolean;
}

export function newGuardianDeathLook(): GuardianDeathLook {
  return { seams: 0, blaze: 0, core: 0, sinceSplit: -99, slabHeat: 0, slabEmber: 0, husk: false };
}

/** The Guardian's look `t` seconds after it fell (a replay: `replay`, its
 *  colour given back at the end). Allocation free. */
export function guardianDeathLook(
  t: number,
  replay: boolean,
  out: GuardianDeathLook = newGuardianDeathLook(),
): GuardianDeathLook {
  const D = GUARDIAN_DEATH;
  if (t < 0) {
    out.seams = 0;
    out.blaze = 0;
    out.core = 0;
    out.sinceSplit = -99;
    out.slabHeat = 0;
    out.slabEmber = 0;
    out.husk = false;
    return out;
  }
  const sinceSplit = t - D.splitAt;
  out.sinceSplit = sinceSplit;
  out.seams = smooth(0, D.seamsTo, t);
  // The blaze: up with the seams, white-hot through the split, gone with it
  // (the seams' fire passes into the slabs).
  out.blaze =
    t < D.splitAt
      ? smooth(0, D.blazeFull, t) * (1 + 0.35 * smooth(D.blazeFull, D.splitAt, t))
      : Math.max(0, 1.35 - sinceSplit * 3);
  // The core: burning through the blaze, a surge at the split, then
  // guttering (each flare weaker) and out.
  let core = 0;
  if (t < D.splitAt) core = 0.6 + 0.6 * smooth(0, D.blazeFull, t);
  else if (t < D.gutterFrom)
    core = 1.2 + 0.8 * spike(sinceSplit, 0.6) - 0.5 * smooth(D.splitAt, D.gutterFrom, t);
  else {
    const fade = 1 - smooth(D.gutterFrom, D.coreOut, t);
    let g = 0;
    for (let i = 0; i < D.gutters.length; i++) {
      const d = t - D.gutters[i];
      g = Math.max(g, (0.9 - i * 0.22) * Math.exp(-d * d * 45));
    }
    core = 0.7 * fade * fade + g * (t < D.coreOut ? 1 : 0);
  }
  out.core = core;
  if (sinceSplit < 0) {
    out.slabHeat = 0;
    out.slabEmber = 0;
  } else {
    out.slabHeat = 1.8 * (1 - smooth(0, D.coolFor, sinceSplit)) ** 1.5;
    out.slabEmber = 0.6 * (1 - smooth(D.coolFor * 0.4, D.end - D.splitAt, sinceSplit));
  }
  out.husk = t >= D.splitAt && (!replay || t < councilReplaySeconds('guardian'));
  return out;
}

/** One slab broken off the Guardian's body: which point of it (its rock),
 *  how it slumps (outward and up, yards a second), its size (yards, a share
 *  of the rock's), its tumble and its rest. Fixed (a seeded plan), so every
 *  client drops the same stone. */
export interface GuardianSlab {
  point: number;
  out: number;
  up: number;
  /** Its heading off the outward line (radians). */
  veer: number;
  sx: number;
  sy: number;
  sz: number;
  spin: number;
  /** Leaves this long after the split (the body comes apart top down). */
  delay: number;
  /** Its tilt at rest (radians, about its own long axis). */
  rest: number;
}

export const GUARDIAN_SLABS: readonly GuardianSlab[] = GUARDIAN_POINTS.map((p, i) => {
  const H = COUNCIL_DEATH_HEIGHT.guardian;
  const s = p.size * H;
  return {
    point: i,
    out: 1.2 + 3.2 * hash(i, 11),
    up: 0.6 + 2.4 * hash(i, 13),
    veer: (hash(i, 17) - 0.5) * 0.9,
    sx: s * (0.7 + 0.35 * hash(i, 19)),
    sy: s * (0.35 + 0.2 * hash(i, 23)),
    sz: s * (0.55 + 0.3 * hash(i, 29)),
    spin: 0.8 + 2.2 * hash(i, 31),
    // The crown first, the feet last: it comes down in a slump.
    delay: (1 - p.h) * 0.32 + 0.06 * hash(i, 37),
    rest: (hash(i, 41) - 0.5) * 0.5,
  };
});

/** The rubble the split throws (small chunks; thinned by the tier). */
export interface GuardianChunk {
  point: number;
  angle: number;
  out: number;
  up: number;
  size: number;
  spin: number;
}

export const GUARDIAN_CHUNKS: readonly GuardianChunk[] = Array.from({ length: 34 }, (_, i) => ({
  point: Math.floor(hash(i, 101) * GUARDIAN_POINTS.length),
  angle: hash(i, 103) * Math.PI * 2,
  out: 3 + 7 * hash(i, 107),
  up: 2 + 7 * hash(i, 109),
  size: (0.25 + 0.55 * hash(i, 113) ** 1.5) * 1.4,
  spin: 2 + 7 * hash(i, 127),
}));

/** Gravity on the falling stone (yards a second squared: heavy). */
export const SLAB_GRAVITY = 30;

export interface SlabFlight {
  /** Out along its heading from where it broke (yards) and up (from its
   *  birth; negative is down). */
  out: number;
  y: number;
  /** Its tumble so far (radians) and how far it has settled to rest (0..1). */
  turn: number;
  settle: number;
  /** Its scale (0 gone, 1 whole: it grows out of the body in a blink). */
  scale: number;
  landed: boolean;
  /** Seconds since it landed (-1 in the air). */
  sinceLand: number;
}

export function newSlabFlight(): SlabFlight {
  return { out: 0, y: 0, turn: 0, settle: 0, scale: 0, landed: false, sinceLand: -1 };
}

/** A slab `since` seconds after the split (its own delay counted), falling
 *  `drop` yards to the floor. A slab long fallen lies settled. */
export function guardianSlabAt(
  s: GuardianSlab,
  since: number,
  drop: number,
  out: SlabFlight = newSlabFlight(),
): SlabFlight {
  const t = since - s.delay;
  if (t < 0) {
    out.out = 0;
    out.y = 0;
    out.turn = 0;
    out.settle = 0;
    out.scale = since < 0 ? 0 : 1;
    out.landed = false;
    out.sinceLand = -1;
    return out;
  }
  const g = SLAB_GRAVITY;
  const d = Math.max(0, drop);
  const land = (s.up + Math.sqrt(s.up * s.up + 2 * g * d)) / g;
  const ft = Math.min(t, land);
  // A short skid once down, slowing to a stop.
  const skid = t > land ? 0.55 * (1 - Math.exp(-(t - land) * 5)) : 0;
  out.out = s.out * ft + s.out * 0.18 * skid;
  out.y = t < land ? s.up * t - 0.5 * g * t * t : -d;
  out.turn = s.spin * ft;
  out.settle = t > land ? smooth(0, 0.45, t - land) : 0;
  out.scale = 1;
  out.landed = t >= land;
  out.sinceLand = out.landed ? t - land : -1;
  return out;
}

/** A chunk of rubble `since` seconds after the split, falling `drop`
 *  yards: thrown, landing, gone a while later. */
export function guardianChunkAt(
  c: GuardianChunk,
  since: number,
  drop: number,
  out: SlabFlight = newSlabFlight(),
): SlabFlight {
  if (since < 0) {
    out.scale = 0;
    out.landed = false;
    out.sinceLand = -1;
    return out;
  }
  const g = SLAB_GRAVITY * 0.9;
  const d = Math.max(0, drop);
  const land = (c.up + Math.sqrt(c.up * c.up + 2 * g * d)) / g;
  const ft = Math.min(since, land);
  out.out = c.out * ft;
  out.y = since < land ? c.up * since - 0.5 * g * since * since : -d;
  out.turn = c.spin * ft;
  out.settle = 0;
  out.landed = since >= land;
  out.sinceLand = out.landed ? since - land : -1;
  // Settles into the floor's grit and is gone by the scene's end.
  out.scale =
    c.size *
    (1 -
      smooth(
        GUARDIAN_DEATH.end - GUARDIAN_DEATH.splitAt - 1.8,
        GUARDIAN_DEATH.end - GUARDIAN_DEATH.splitAt - 0.4,
        since,
      ));
  return out;
}

// ---- the Singer -----------------------------------------------------------------------------

export interface SingerDeathLook {
  /** The last note's swell (0..1; its rings and her light ride it). */
  note: number;
  /** Her crystal's fracture: how far its light leaks out (0..1) and the
   *  glow in her body (past 1 blazing just before the shatter). */
  leak: number;
  glow: number;
  /** Seconds since the shatter (negative before). */
  sinceShatter: number;
  /** The burst of light at the shatter (opacity share). */
  flash: number;
  /** The husk's dark is held (from the shatter on). */
  husk: boolean;
}

export function newSingerDeathLook(): SingerDeathLook {
  return { note: 0, leak: 0, glow: 0, sinceShatter: -99, flash: 0, husk: false };
}

/** The Singer's look `t` seconds after she fell. Allocation free. */
export function singerDeathLook(
  t: number,
  replay: boolean,
  out: SingerDeathLook = newSingerDeathLook(),
): SingerDeathLook {
  const D = SINGER_DEATH;
  if (t < 0) {
    out.note = 0;
    out.leak = 0;
    out.glow = 0;
    out.sinceShatter = -99;
    out.flash = 0;
    out.husk = false;
    return out;
  }
  const since = t - D.shatterAt;
  out.sinceShatter = since;
  out.note = since < 0 ? smooth(D.noteFrom, D.noteFrom + 0.5, t) : Math.max(0, 1 - since * 2.5);
  out.leak = since < 0 ? smooth(D.leakFrom, D.leakTo, t) : 0;
  out.glow =
    since < 0 ? 0.5 + 1.1 * smooth(D.leakFrom, D.shatterAt, t) ** 1.6 : 1.6 * spike(since, 0.5);
  out.flash = spike(since, 0.55);
  out.husk = since >= 0 && (!replay || t < councilReplaySeconds('singer'));
  return out;
}

/** The note's rings off her (seconds of her scene): steady, then quicker as
 *  the crystal gives. */
export const SINGER_RINGS: readonly number[] = (() => {
  const out: number[] = [];
  let t = SINGER_DEATH.noteFrom + 0.05;
  let gap = 0.55;
  while (t < SINGER_DEATH.shatterAt - 0.08) {
    out.push(t);
    t += gap;
    gap = Math.max(0.17, gap * 0.82);
  }
  return out;
})();

/** A ring's life (seconds) and reach (yards over her height). */
export const SINGER_RING = { life: 1.05, from: 0.12, to: 1.35 } as const;

/** One shaft of light leaking out of a member's body (the Guardian's
 *  cracks, the Singer's crystal): the point it leaks from, its heading in
 *  the body's frame (yaw off its front, pitch up), when it opens (seconds of
 *  the scene), its length and width (shares of the body's height). */
export interface CouncilLeak {
  point: number;
  yaw: number;
  pitch: number;
  at: number;
  len: number;
  width: number;
}

export const SINGER_LEAKS: readonly CouncilLeak[] = Array.from({ length: 18 }, (_, i) => {
  const D = SINGER_DEATH;
  // The first few at her chest, then spreading over her as she gives.
  const k = i / 17;
  return {
    point: Math.floor(hash(i, 201) * SINGER_POINTS.length),
    yaw: hash(i, 203) * Math.PI * 2,
    pitch: -0.35 + 1.1 * hash(i, 207),
    at: D.leakFrom + (D.leakTo - D.leakFrom) * k ** 1.3 + 0.08 * hash(i, 209),
    len: 0.35 + 0.55 * hash(i, 211),
    width: 0.018 + 0.03 * hash(i, 213),
  };
});

/** The Guardian's big rocks (the points its gold shafts break out between). */
const GUARDIAN_BIG = GUARDIAN_POINTS.map((p, i) => (p.size >= 0.08 ? i : -1)).filter((i) => i >= 0);

export const GUARDIAN_LEAKS: readonly CouncilLeak[] = Array.from({ length: 12 }, (_, i) => {
  const D = GUARDIAN_DEATH;
  const k = i / 11;
  return {
    point: GUARDIAN_BIG[Math.floor(hash(i, 221) * GUARDIAN_BIG.length)],
    yaw: hash(i, 223) * Math.PI * 2,
    pitch: -0.2 + 0.95 * hash(i, 227),
    at: 0.3 + (D.blazeFull + 0.25 - 0.3) * k + 0.06 * hash(i, 229),
    len: 0.22 + 0.3 * hash(i, 231),
    width: 0.012 + 0.014 * hash(i, 233),
  };
});

/** A shaft's strength at `t` (0 shut, 1 open, past 1 as the body blazes;
 *  gone at `closeAt`, the split or the shatter). */
export function councilLeakLevel(l: CouncilLeak, t: number, glow: number, closeAt: number): number {
  if (t < l.at || t >= closeAt) return 0;
  const open = smooth(l.at, l.at + 0.22, t);
  return open * (0.6 + 0.5 * glow);
}

/** One shard of her shattered crystal: the point it bursts from, its
 *  heading (yaw in her frame, pitch), how fast it flies out before the air
 *  holds it, its hang, size (yards) and spin. */
export interface SingerShard {
  point: number;
  yaw: number;
  pitch: number;
  speed: number;
  hang: number;
  size: number;
  spin: number;
  /** Glints this many times a second while it hangs. */
  glint: number;
}

export const SINGER_SHARDS: readonly SingerShard[] = Array.from({ length: 56 }, (_, i) => ({
  point: Math.floor(hash(i, 301) * SINGER_POINTS.length),
  yaw: hash(i, 303) * Math.PI * 2,
  pitch: 0.1 + 1.0 * hash(i, 307),
  speed: 11 + 14 * hash(i, 309),
  hang: SINGER_DEATH.hang + SINGER_DEATH.hangJitter * hash(i, 311),
  size: 0.45 + 1.0 * hash(i, 313) ** 1.6,
  spin: (hash(i, 317) - 0.5) * 7,
  glint: 1.2 + 2.8 * hash(i, 319),
}));

/** The air's hold on a flung shard (per second): it stops within a breath. */
export const SHARD_DRAG = 6.5;
/** How far the air lifts a hanging shard (yards). */
export const SHARD_FLOAT = 2.2;

/** Gravity on a shard once it rains (yards a second squared). */
export const SHARD_GRAVITY = 26;

export interface ShardFlight {
  /** Out along its heading from where it burst (yards), and up. */
  out: number;
  y: number;
  /** Its tumble (radians). */
  turn: number;
  /** Its glint (0..1) and scale (0 gone). */
  glint: number;
  scale: number;
  /** In the air, hanging (true), or raining/landed (false). */
  hanging: boolean;
  landed: boolean;
  sinceLand: number;
}

export function newShardFlight(): ShardFlight {
  return {
    out: 0,
    y: 0,
    turn: 0,
    glint: 0,
    scale: 0,
    hanging: false,
    landed: false,
    sinceLand: -1,
  };
}

/** A shard `since` seconds after the shatter, `drop` yards over the floor at
 *  its birth: flung out, held by the air, hanging a beat, raining down, a
 *  glint on the floor and gone. */
export function singerShardAt(
  s: SingerShard,
  since: number,
  drop: number,
  out: ShardFlight = newShardFlight(),
): ShardFlight {
  if (since < 0) {
    out.scale = 0;
    out.hanging = false;
    out.landed = false;
    out.sinceLand = -1;
    out.glint = 0;
    return out;
  }
  const k = SHARD_DRAG;
  const th = Math.min(since, s.hang);
  // Out and up along its heading, the air taking it to a near stop.
  const reach = (s.speed / k) * (1 - Math.exp(-k * th));
  const c = Math.cos(s.pitch);
  const sp = Math.sin(s.pitch);
  out.out = reach * c;
  let y = reach * sp;
  // A slow drift while it hangs (the last of its speed).
  const v = s.speed * Math.exp(-k * th);
  out.turn = s.spin * th * 0.6 + s.spin * Math.max(0, since - s.hang);
  out.hanging = since < s.hang;
  // The air lifts it a little while it hangs (a beat held aloft).
  y += SHARD_FLOAT * smooth(0, s.hang, th);
  if (since <= s.hang) {
    out.y = y;
    out.landed = false;
    out.sinceLand = -1;
    out.glint = 0.5 + 0.5 * Math.sin(since * s.glint * Math.PI * 2 + s.spin);
    out.scale = s.size * smooth(0, 0.06, since);
    return out;
  }
  // The rain: gravity takes it, a little of its last speed still out.
  const tr = since - s.hang;
  const floor = -Math.max(0, drop + y);
  const g = SHARD_GRAVITY;
  const vy0 = v * sp;
  const land = (vy0 + Math.sqrt(vy0 * vy0 + 2 * g * -floor)) / g;
  const ft = Math.min(tr, land);
  out.out += v * c * ft * 0.5;
  y += vy0 * ft - 0.5 * g * ft * ft;
  out.landed = tr >= land;
  out.sinceLand = out.landed ? tr - land : -1;
  out.y = out.landed ? -Math.max(0, drop) : y;
  out.glint = out.landed ? Math.max(0, 1 - out.sinceLand * 2) : 0.35;
  // On the floor it glints once and melts away into light.
  out.scale = s.size * (out.landed ? 1 - smooth(0.25, 1.1, out.sinceLand) : 1);
  return out;
}

// ---- the end: the columns power down --------------------------------------------------------

/** The order the columns go out (indices into QUARRY_PILLAR_SPOTS): the
 *  reverse of their waking, the last lit first, so the dark runs back
 *  across the quarry to the Pit Mouth. */
export const COLUMN_DOWN_ORDER: readonly number[] = [...COLUMN_ORDER].reverse();

/** When column `i` (QUARRY_PILLAR_SPOTS index) starts to drain (seconds of
 *  the end beat). */
export function columnDownAt(i: number): number {
  return COUNCIL_END.firstAt + COLUMN_DOWN_ORDER.indexOf(i) * COUNCIL_END.step;
}

export interface CouncilEndLook {
  active: boolean;
  /** Each column's climb (1 lit to its crown, 0 dark to its foot) and its
   *  light (past 1 surging). */
  climb: number[];
  glow: number[];
  /** The room's crystals' share of their surge (0..1, falling as the
   *  columns go out). */
  crystals: number;
  /** The dust settling over the quarry (0..1). */
  settle: number;
}

export function newCouncilEndLook(): CouncilEndLook {
  return {
    active: false,
    climb: QUARRY_PILLAR_SPOTS.map(() => 0),
    glow: QUARRY_PILLAR_SPOTS.map(() => 0),
    crystals: 0,
    settle: 0,
  };
}

/** The end beat at `t` seconds (-1 none; a pair long dead is long past it:
 *  everything dark). Allocation free. */
export function councilEndLook(
  t: number,
  out: CouncilEndLook = newCouncilEndLook(),
): CouncilEndLook {
  const E = COUNCIL_END;
  out.active = t >= 0 && t < COUNCIL_END_SECONDS;
  if (!out.active) {
    out.climb.fill(0);
    out.glow.fill(0);
    out.crystals = 0;
    out.settle = 0;
    return out;
  }
  const surge = smooth(0, E.surgeFor, t);
  let lit = 0;
  for (let i = 0; i < out.climb.length; i++) {
    const at = columnDownAt(i);
    const drain = smooth(at, at + E.drain, t);
    out.climb[i] = surge * (1 - drain);
    // A flare as it surges, a last flicker as the drain starts.
    const flare = 0.7 * spike(t, 0.9) + 0.45 * Math.exp(-(((t - at) * 6) ** 2));
    out.glow[i] = out.climb[i] > 0.001 ? (0.9 + flare) * (0.5 + 0.5 * (1 - drain)) : 0;
    lit += 1 - drain;
  }
  out.crystals = surge * (lit / out.climb.length);
  const lastOut = columnDownAt(COLUMN_DOWN_ORDER[COLUMN_DOWN_ORDER.length - 1]) + E.drain;
  out.settle = smooth(E.firstAt, lastOut, t) * (1 - smooth(lastOut, COUNCIL_END_SECONDS, t));
  return out;
}

// ---- the sounds -------------------------------------------------------------------------------

/** A sound on a beat (the council's own samples and the raid's, all in the
 *  SFX manifest; no new asset). The death lines are the sim's
 *  (council_voice.ts `death`, `defeat`) and play over them. */
export interface CouncilDeathSound {
  at: number;
  key: string;
  gain: number;
  rate: number;
}

export const GUARDIAN_DEATH_SOUNDS: readonly CouncilDeathSound[] = [
  { at: 0.02, key: 'heart_council_pillar_crack', gain: 1, rate: 0.62 },
  { at: 0.4, key: 'heart_council_wrath_charge', gain: 0.8, rate: 0.7 },
  { at: 0.95, key: 'heart_council_pillar_crack', gain: 0.9, rate: 0.52 },
  { at: GUARDIAN_DEATH.kneelAt, key: 'heart_council_rush_impact', gain: 1, rate: 0.62 },
  { at: GUARDIAN_DEATH.splitAt - 0.05, key: 'heart_council_pillar_collapse', gain: 1, rate: 0.66 },
  { at: GUARDIAN_DEATH.splitAt + 0.04, key: 'heart_council_slab_crush', gain: 1, rate: 0.7 },
  { at: GUARDIAN_DEATH.splitAt + 0.55, key: 'heart_council_rock_impact', gain: 0.9, rate: 0.62 },
  { at: GUARDIAN_DEATH.splitAt + 0.85, key: 'heart_council_rock_impact', gain: 0.75, rate: 0.72 },
  { at: GUARDIAN_DEATH.splitAt + 1.0, key: 'heart_council_slab_grind', gain: 0.7, rate: 0.5 },
  { at: GUARDIAN_DEATH.gutters[0], key: 'heart_council_soul_pip', gain: 0.55, rate: 0.55 },
  { at: GUARDIAN_DEATH.gutters[2], key: 'heart_council_soul_pip', gain: 0.4, rate: 0.45 },
  { at: GUARDIAN_DEATH.coreOut - 0.1, key: 'heart_final_overload_pulse', gain: 0.5, rate: 0.5 },
];

export const SINGER_DEATH_SOUNDS: readonly CouncilDeathSound[] = [
  { at: SINGER_DEATH.noteFrom, key: 'heart_council_song_cast', gain: 0.95, rate: 0.9 },
  { at: 0.6, key: 'heart_council_song_pulse', gain: 0.8, rate: 0.72 },
  ...SINGER_RINGS.map((at, k) => ({
    at,
    key: 'heart_council_resonance',
    gain: 0.45 + Math.min(0.4, k * 0.04),
    rate: Math.min(2.1, 0.85 + k * 0.1),
  })),
  { at: 1.05, key: 'heart_council_pillar_crack', gain: 0.7, rate: 1.7 },
  { at: SINGER_DEATH.shatterAt, key: 'heart_council_soul_burst', gain: 1, rate: 1.2 },
  {
    at: SINGER_DEATH.shatterAt + 0.02,
    key: 'heart_council_pillar_collapse',
    gain: 0.65,
    rate: 1.75,
  },
  { at: SINGER_DEATH.shatterAt + 1.55, key: 'heart_council_resonance', gain: 0.4, rate: 2.2 },
  { at: SINGER_DEATH.shatterAt + 1.85, key: 'heart_council_resonance', gain: 0.35, rate: 2.5 },
  { at: SINGER_DEATH.shatterAt + 2.2, key: 'heart_council_resonance', gain: 0.3, rate: 2.0 },
];

export const COUNCIL_END_SOUNDS: readonly CouncilDeathSound[] = [
  { at: 0.02, key: 'heart_final_tremor', gain: 0.9, rate: 0.55 },
  { at: 0.05, key: 'heart_council_bond_pulse', gain: 0.8, rate: 0.6 },
  ...COLUMN_DOWN_ORDER.map((_, k) => ({
    at: COUNCIL_END.firstAt + k * COUNCIL_END.step,
    key: 'heart_council_pillar_pulse',
    gain: 0.7,
    rate: 0.62 - k * 0.04,
  })),
  {
    at: COUNCIL_END.firstAt + QUARRY_PILLAR_SPOTS.length * COUNCIL_END.step + 0.3,
    key: 'heart_council_slab_grind',
    gain: 0.55,
    rate: 0.4,
  },
];

// ---- the tier --------------------------------------------------------------------------------

/** The low tier's share of a plan: every k-th piece kept, so its shape
 *  stays whole (the Guardian's slabs, the shards' burst, the beams all draw
 *  on every tier; only the rubble, the shards and the particles thin). */
export function councilDeathKept(i: number, share: number): boolean {
  if (share >= 1) return true;
  const k = Math.max(1, Math.round(1 / Math.max(0.05, share)));
  return i % k === 0;
}

/** The particles' rates (a second, before the tier's share). */
export const COUNCIL_DEATH_RATES = {
  /** Sparks spat from each blazing crack. */
  seamSparks: 240,
  /** Dust off the slabs as they slump. */
  slabDust: 30,
  /** Glitter round the hanging shards. */
  glitter: 90,
  /** The last dust settling over the quarry. */
  settleDust: 26,
} as const;
