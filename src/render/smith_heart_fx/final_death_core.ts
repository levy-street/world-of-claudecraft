// The Masterless Strength's death, "The essence escapes" (Jose's lore idea,
// 2026-11-12): the counterpart of its arrival (final_arrival_core.ts), the
// pure half. final_death_fx.ts paints it; final_fx.ts runs its clock (the
// boss's death as IWorld shows it, or a dev replay cue) and lifts the heart
// crystal out of the chest by it. The scene, in order:
//  1. the kneel: the body drops to one knee (its Kneel clip is its death
//     clip, characters/smith_heart_boss_looks.ts) while the four colours
//     fight inside it: the cracks blaze, light crawls over the stone into
//     the chest, chips of rock break off;
//  2. the tear: the heart crystal rips out of the chest in a burst of light
//     and broken stone; the body is left a dark husk of stone on its knee;
//  3. the rise: the crystal climbs over the husk, spinning, blazing, and
//     hangs a breath;
//  4. the split: it bursts into the four elements, each a comet of its
//     vein's colour arcing across the Anvil to its own altar;
//  5. the race: each comet dives into its altar's carved groove and races
//     down the spiral (the same polylines the arrival's light ran,
//     ../smith_heart/heart_vein_groove_core.ts) to the central well, the
//     groove burning behind it;
//  6. the gather: the four wind round each other over the well, tighter
//     and faster, into one blazing core, a vortex of the four colours
//     turning down into the pit;
//  7. the plunge: the core dives into the well: a flash, a column of light
//     thrown back up, a shockwave over the whole floor, the camera's thud;
//  8. the embers: the burning grooves cool to broken embers and die, the
//     altars and the room go dark; one last slow throb of light from deep in
//     the well. It is not over: it waits.
// No camera takeover, no input lock, nothing held back from loot or exit:
// presentation only. A raid that first sees the body already dead sees the
// husk and the dark room (the clock long past the scene).
//
// Node-only (RENDER_PURE_CORES): no three.js, no DOM, deterministic.

import type { SmithHeartVein } from '../../sim/content/smith_heart_layout';
import { HEART_ROOM } from '../../sim/content/smith_heart_layout';
import {
  ARRIVAL_VEINS,
  type ArrivalStreamPath,
  arrivalStreamLift,
  arrivalStreamPath,
  arrivalStreamPointAt,
} from './final_arrival_core';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => {
  const c = clamp01(v);
  return c * c * (3 - 2 * c);
};
const easeOut = (v: number) => 1 - (1 - clamp01(v)) ** 3;
const easeIn = (v: number) => clamp01(v) ** 2;

/** The scene's spacing (seconds). */
export const DEATH_SCENE = {
  /** The four colours fight in the kneeling body before it gives. */
  struggle: 1.5,
  /** The crystal climbs over the husk, then hangs. */
  rise: 0.7,
  hover: 0.35,
  /** A comet's arc from the burst to its altar. */
  fly: 0.95,
  /** Each comet leaves this long after the one before (one burst, four arcs
   *  a hair apart so the eye can follow each). */
  flyStep: 0.05,
  /** At its altar a breath (the altar flares), then down the groove. */
  altar: 0.15,
  /** The race down a spiral, gathering pace. */
  race: 1.75,
  /** The four winding up round the well (and the husk, when it knelt
   *  there) into one over it. */
  gather: 1.1,
  /** The core's dive into the pit. */
  plunge: 0.45,
  /** The grooves cool to embers and die out. */
  embers: 2.7,
} as const;

/** The beats, seconds after the body died. */
export const DEATH_TEAR = DEATH_SCENE.struggle;
export const DEATH_HOVER_AT = DEATH_TEAR + DEATH_SCENE.rise;
export const DEATH_SPLIT = DEATH_HOVER_AT + DEATH_SCENE.hover;

/** When comet `i` (ARRIVAL_VEINS' index) leaves the burst. */
export function deathFlyStart(i: number): number {
  return DEATH_SPLIT + i * DEATH_SCENE.flyStep;
}
/** When comet `i` lands at its altar. */
export function deathLandAt(i: number): number {
  return deathFlyStart(i) + DEATH_SCENE.fly;
}
/** When comet `i` dives into its groove. */
export function deathRaceStart(i: number): number {
  return deathLandAt(i) + DEATH_SCENE.altar;
}
/** When comet `i` reaches the well. */
export function deathRaceEnd(i: number): number {
  return deathRaceStart(i) + DEATH_SCENE.race;
}

const LAST = ARRIVAL_VEINS.length - 1;
/** The last comet reaches the well: the gather starts. */
export const DEATH_GATHER = deathRaceEnd(LAST);
/** The four are one: the plunge starts. */
export const DEATH_MERGE = DEATH_GATHER + DEATH_SCENE.gather;
/** The core strikes the bottom of the pit: the flash and the shockwave. */
export const DEATH_IMPACT = DEATH_MERGE + DEATH_SCENE.plunge;
/** The last slow throb from deep in the well (it waits). */
export const DEATH_THROB = DEATH_IMPACT + DEATH_SCENE.embers - 1.0;
/** The scene is over (a later sight: the husk, the dark room). */
export const DEATH_END = DEATH_IMPACT + DEATH_SCENE.embers;

/** The camera's thuds (shake amounts at the source, felt to `reach` yards). */
export const DEATH_SHAKES = {
  struggle: { amount: 0.18, reach: 110 },
  tear: { amount: 0.7, reach: 140 },
  land: { amount: 0.22, reach: 60 },
  impact: { amount: 1.0, reach: 170 },
} as const;

/** The knee strikes the floor (the Kneel clip's drop, inside `deathKneel`'s
 *  sink): dust and a ring at the feet. */
export const DEATH_KNEE_STRIKE = 0.65;

/** Has the beat at `at` been crossed between the last frame's clock `prev`
 *  and this one's `t` (a moment fires once, and only for a scene seen
 *  crossing it, never for a late sight long past it)? */
export function deathBeatCrossed(prev: number, t: number, at: number): boolean {
  return prev >= 0 && prev < at && t >= at && t - at < 0.5;
}

/** The struggle's rumbles (each a small shake and a flare in the chest). */
export const DEATH_STRUGGLE_BEATS: readonly number[] = [0.35, 0.8, 1.15, 1.38];

// ---- the body -----------------------------------------------------------------------------

/** The rig's presentation gestures for the death (characters/
 *  smith_heart_boss_looks.ts binds them as glow pulses): the cracks blazing
 *  as the colours fight in it, and the stone left a dark husk once the
 *  essence has torn out (a shade pulse re-sent while it holds, as the
 *  arrival's dormant stone is). Never sim ids. */
export const DEATH_GESTURES = {
  blaze: 'smith_heart_final_body_death_blaze',
  husk: 'smith_heart_final_body_death_husk',
} as const;

/** Seconds between re-sends of the husk's shade (it rises at once and holds
 *  a second, so the stone stays dark through a slow frame). */
export const DEATH_HUSK_EVERY = 0.35;

/** The husk's shade: the body's own colour times this, stone gone dark. */
export const DEATH_HUSK_SHADE = 0.32;

/** Is the body a husk at `t`? From the tear on (a corpse stays one; a dev
 *  replay gives the colour back at its end). */
export function deathHusk(t: number, replay: boolean): boolean {
  if (t < DEATH_TEAR) return false;
  return !replay || t < DEATH_END;
}

/** The kneel the anchors read (the heart's and the eyes' height): the body
 *  sinks onto its knee over the Kneel clip's drop. 0 standing, 1 kneeling. */
export function deathKneel(t: number): number {
  if (t < 0) return 0;
  return smooth(t / 0.9);
}

// ---- the heart crystal --------------------------------------------------------------------

/** How high over its chest the crystal hangs (yards). */
export const DEATH_HOVER_LIFT = 8;

export interface DeathCrystalLook {
  /** Drawn at all (from the tear until the split). */
  shown: boolean;
  /** Share of the climb from the chest to its hover point (0 to 1). */
  lift: number;
  /** Its drawn scale over the kit's own size. */
  scale: number;
  /** How fast it spins (radians a second). */
  spin: number;
  /** Its light (1 burning) and the white flare over it. */
  level: number;
  flare: number;
  /** The halo's size (yards) round it, 0 hidden. */
  halo: number;
}

/** The crystal at `t` (seconds after the death). Before the tear it is the
 *  model's own gem, burning brighter at each struggle beat (the halo only);
 *  torn out it climbs, spins faster and swells toward the split. */
export function deathCrystal(
  t: number,
  out: DeathCrystalLook = {
    shown: false,
    lift: 0,
    scale: 1,
    spin: 0,
    level: 1,
    flare: 0,
    halo: 0,
  },
): DeathCrystalLook {
  out.shown = t >= DEATH_TEAR && t < DEATH_SPLIT;
  if (t < 0 || t >= DEATH_SPLIT) {
    out.lift = 0;
    out.scale = 1;
    out.spin = 0;
    out.level = t < 0 ? 1 : 0;
    out.flare = 0;
    out.halo = 0;
    return out;
  }
  if (t < DEATH_TEAR) {
    // The struggle: the gem in the chest throbbing harder at each beat.
    let beat = 0;
    for (const b of DEATH_STRUGGLE_BEATS) beat = Math.max(beat, Math.exp(-((t - b) ** 2) * 60));
    out.lift = 0;
    out.scale = 1;
    out.spin = 0.4 + 2 * (t / DEATH_TEAR);
    out.level = 1;
    out.flare = 0.25 + 0.9 * beat + 0.4 * (t / DEATH_TEAR);
    out.halo = 10 + 10 * beat + 8 * (t / DEATH_TEAR);
    return out;
  }
  const k = (t - DEATH_TEAR) / DEATH_SCENE.rise;
  const toSplit = clamp01((t - DEATH_HOVER_AT) / DEATH_SCENE.hover);
  out.lift = easeOut(k);
  out.scale = 0.75 + 0.35 * easeOut(k) + 0.35 * easeIn(toSplit);
  out.spin = 3 + 9 * smooth(k) + 14 * easeIn(toSplit);
  out.level = 1;
  // Hot, but its facets and the four veins wound through it still read
  // (a flare past ~0.7 washes the crystal to a white blank).
  out.flare = 0.08 + 0.06 * Math.sin(t * 40) + 0.35 * easeIn(toSplit);
  out.halo = 15 + 9 * easeIn(toSplit);
  return out;
}

/** The crystal's hover point: over the chest it tore from. */
export function deathHoverPoint(
  chest: { x: number; y: number; z: number },
  out: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  out.x = chest.x;
  out.y = chest.y + DEATH_HOVER_LIFT;
  out.z = chest.z;
  return out;
}

// ---- the comets ---------------------------------------------------------------------------

/** Each vein's groove (instance-local; the arrival's own spiral). */
export function deathGroovePath(i: number): ArrivalStreamPath {
  return arrivalStreamPath(ARRIVAL_VEINS[i]);
}

/** How high a comet rides over its groove (yards; over the kerb's leap). */
export const DEATH_RACE_LIFT = 0.9;

/** How high over the floor a comet lands at its altar's groove head. */
export const DEATH_LAND_LIFT = 2.4;

/** The arc's apex over the straight line between the burst and the altar. */
export const DEATH_ARC_RISE = 14;

export type DeathCometPhase = 'off' | 'fly' | 'altar' | 'race' | 'gather' | 'gone';

export interface DeathCometLook {
  phase: DeathCometPhase;
  /** Where it is (instance-local yards; `y` over the floor under it for
   *  'altar', 'race' and 'gather', an absolute height for 'fly'). */
  x: number;
  y: number;
  z: number;
  /** `y` is over the floor (true) or absolute (false). */
  grounded: boolean;
  /** Its glow (1 full) and its head's size (yards). */
  glow: number;
  size: number;
}

const _at = { x: 0, z: 0 };

function setComet(
  out: DeathCometLook,
  phase: DeathCometPhase,
  x: number,
  y: number,
  z: number,
  grounded: boolean,
  glow: number,
  size: number,
): DeathCometLook {
  out.phase = phase;
  out.x = x;
  out.y = y;
  out.z = z;
  out.grounded = grounded;
  out.glow = glow;
  out.size = size;
  return out;
}

/** Comet `i` at `t`, leaving the burst at `hover` (instance-local, absolute
 *  height). `groundAt` answers the floor's height at an instance-local
 *  point (the arc lands on it). */
export function deathComet(
  t: number,
  i: number,
  hover: { x: number; y: number; z: number },
  groundAt: (x: number, z: number) => number,
  out: DeathCometLook = {
    phase: 'off',
    x: 0,
    y: 0,
    z: 0,
    grounded: false,
    glow: 0,
    size: 0,
  },
): DeathCometLook {
  const path = deathGroovePath(i);
  if (t < deathFlyStart(i)) return setComet(out, 'off', hover.x, hover.y, hover.z, false, 0, 0);
  if (t < deathLandAt(i)) {
    // A raised arc (a quadratic) from the burst to the groove's head.
    const k = smooth((t - deathFlyStart(i)) / DEATH_SCENE.fly);
    const ex = path.from.x;
    const ez = path.from.z;
    const ey = groundAt(ex, ez) + DEATH_LAND_LIFT;
    const mx = (hover.x + ex) / 2;
    const mz = (hover.z + ez) / 2;
    const my = Math.max(hover.y, ey) + DEATH_ARC_RISE;
    const a = (1 - k) * (1 - k);
    const b = 2 * (1 - k) * k;
    const c = k * k;
    return setComet(
      out,
      'fly',
      a * hover.x + b * mx + c * ex,
      a * hover.y + b * my + c * ey,
      a * hover.z + b * mz + c * ez,
      false,
      1,
      4,
    );
  }
  if (t < deathRaceStart(i))
    return setComet(out, 'altar', path.from.x, DEATH_LAND_LIFT, path.from.z, true, 1.3, 5);
  if (t < deathRaceEnd(i)) {
    const f = deathRaceFront(t, i);
    arrivalStreamPointAt(path, f, _at);
    const r = Math.hypot(_at.x - HEART_ROOM.x, _at.z - HEART_ROOM.z);
    // It drops from its landing height into the groove in the first yards.
    const drop = 1 - smooth((t - deathRaceStart(i)) / 0.25);
    const y = DEATH_RACE_LIFT + arrivalStreamLift(r) + (DEATH_LAND_LIFT - DEATH_RACE_LIFT) * drop;
    return setComet(out, 'race', _at.x, y, _at.z, true, 1, 3.2);
  }
  if (t < DEATH_MERGE) {
    const g = deathGather(t, i);
    return setComet(out, 'gather', g.x, g.y, g.z, true, 1 + 0.6 * g.k, 3.2 + 1.2 * g.k);
  }
  return setComet(out, 'gone', HEART_ROOM.x, 0, HEART_ROOM.z, true, 0, 0);
}

/** How far comet `i` has run down its groove at `t` (0 at its altar, 1 at
 *  the well; -1 before it dives in). It gathers pace as it runs. */
export function deathRaceFront(t: number, i: number): number {
  const k = (t - deathRaceStart(i)) / DEATH_SCENE.race;
  if (k < 0) return -1;
  // A strong start out of the altar, then faster and faster.
  return clamp01(0.35 * k + 0.65 * k ** 2.2);
}

// ---- the gather over the well -----------------------------------------------------------

/** The gather's whirl (yards): the four leave the grooves' ends, widen
 *  round the well (clear of a husk knelt on it), climb, and close into one
 *  high over it, where the core is born. */
export const DEATH_GATHER_ORBIT = { fromR: 2.4, wideR: 8, top: 21 } as const;

const _g = { x: 0, y: 0, z: 0, k: 0 };

/** Comet `i` winding up over the well at `t` (instance-local; `y` over the
 *  well's floor; `k` 0 to 1 through the gather). Allocation-free (a shared
 *  record, read at once). */
export function deathGather(t: number, i: number): { x: number; y: number; z: number; k: number } {
  // A comet that arrives early circles at the grooves' end until the last.
  const own = clamp01(
    (t - deathRaceEnd(i)) / Math.max(0.05, DEATH_GATHER - deathRaceEnd(i) + 0.05),
  );
  const k = clamp01((t - DEATH_GATHER) / DEATH_SCENE.gather);
  const path = deathGroovePath(i);
  const a0 = Math.atan2(path.to.x - HEART_ROOM.x, path.to.z - HEART_ROOM.z);
  // A whirl that quickens as it climbs and tightens.
  const turn = own * 1.6 + k * 3 + k * k * 7;
  const O = DEATH_GATHER_ORBIT;
  const r = (O.fromR + (O.wideR - O.fromR) * smooth(k / 0.35)) * (1 - smooth((k - 0.45) / 0.55));
  _g.x = HEART_ROOM.x + Math.sin(a0 + turn) * r;
  _g.z = HEART_ROOM.z + Math.cos(a0 + turn) * r;
  _g.y = DEATH_RACE_LIFT + (O.top - DEATH_RACE_LIFT) * smooth(k * 1.05);
  _g.k = k;
  return _g;
}

// ---- the core's plunge, the well --------------------------------------------------------

/** How far under the well's floor the core dives before it is gone (its
 *  last stretch is under the stone: the pit's light swallows it). */
export const DEATH_PLUNGE_DEPTH = 6;

export interface DeathCoreLook {
  shown: boolean;
  /** Over the well's floor (yards; negative under it). */
  y: number;
  /** Its drawn size (yards) and light. */
  size: number;
  glow: number;
}

/** The merged core at `t`: born where the four close high over the well,
 *  swelling, a breath's pull upward, then the dive into the pit. */
export function deathCore(
  t: number,
  out: DeathCoreLook = { shown: false, y: 0, size: 0, glow: 0 },
): DeathCoreLook {
  const born = DEATH_GATHER + DEATH_SCENE.gather * 0.7;
  if (t < born || t >= DEATH_IMPACT) {
    out.shown = false;
    out.size = 0;
    out.glow = 0;
    return out;
  }
  out.shown = true;
  const top = DEATH_GATHER_ORBIT.top;
  if (t < DEATH_MERGE) {
    // The four's light pooling where they close.
    const k = smooth((t - born) / (DEATH_MERGE - born));
    out.y =
      DEATH_RACE_LIFT +
      (top - DEATH_RACE_LIFT) * smooth(((t - DEATH_GATHER) / DEATH_SCENE.gather) * 1.05);
    out.size = 2 + 6 * k;
    out.glow = 0.5 + 0.9 * k;
    return out;
  }
  const k = (t - DEATH_MERGE) / DEATH_SCENE.plunge;
  // A breath's pull upward, then down hard.
  const up = k < 0.25 ? Math.sin((Math.PI * k) / 0.25) * 1.6 : 0;
  const fall = easeIn((k - 0.2) / 0.8);
  out.y = top + up - (top + DEATH_PLUNGE_DEPTH) * fall;
  out.size = 8 - 3 * fall;
  out.glow = 1.5;
  return out;
}

export interface DeathWellLook {
  /** The pool of light on the well's floor (0 off). */
  pool: number;
  /** The vortex turning down into the pit (0 off) and its spin. */
  funnel: number;
  /** The column of light thrown back up out of the pit (0 off): its
   *  height share and glow. */
  geyserTop: number;
  geyserGlow: number;
}

/** The well at `t`: the pool lighting as the comets arrive, the vortex
 *  through the gather and the plunge, the column thrown up at the impact,
 *  the afterglow and the last throb. */
export function deathWell(
  t: number,
  out: DeathWellLook = { pool: 0, funnel: 0, geyserTop: 0, geyserGlow: 0 },
): DeathWellLook {
  const first = deathRaceEnd(0);
  const lit = smooth((t - first + 0.3) / 0.6);
  const after = t - DEATH_IMPACT;
  const fade = after < 0 ? 1 : Math.max(0, 1 - after / 1.4);
  const throb = Math.exp(-((t - DEATH_THROB) ** 2) * 6);
  out.pool = t < first - 0.3 ? 0 : lit * fade * (0.7 + 0.5 * smooth((t - DEATH_GATHER) / 0.6));
  out.pool = Math.max(out.pool, 0.5 * throb);
  if (after >= 0 && after < 0.35) out.pool = Math.max(out.pool, 1.8 * (1 - after / 0.35));
  const f0 = DEATH_GATHER + DEATH_SCENE.gather * 0.35;
  out.funnel =
    t < f0 || t >= DEATH_IMPACT + 0.25
      ? 0
      : t < DEATH_IMPACT
        ? smooth((t - f0) / 0.5)
        : 1 - (t - DEATH_IMPACT) / 0.25;
  if (after < 0 || after >= 1.1) {
    out.geyserTop = 0;
    out.geyserGlow = 0;
  } else {
    out.geyserTop = easeOut(after / 0.18) * (1 - 0.35 * smooth((after - 0.4) / 0.7));
    out.geyserGlow = Math.max(0, 1 - smooth((after - 0.12) / 0.95)) * 1.4;
  }
  return out;
}

/** The column's size (yards). */
export const DEATH_GEYSER = { height: 70, coreR: 2.4, swirlR: 8, poolR: 13 } as const;

/** The whirlpool's size (yards): its mouth wide and low over the well,
 *  its throat at the pit's floor. */
export const DEATH_FUNNEL = { mouthR: 14, throatR: 1.6, height: 4 } as const;

// ---- the grooves: burning, then embers ----------------------------------------------------

export interface DeathTrailLook {
  /** The run's front (0 to 1; -1 dark): the comet's head, or where the
   *  trail's burning ends. */
  front: number;
  /** How bright the groove burns behind it (0 out). */
  level: number;
  /** The head's glare (the comet in the groove; 0 once it has left). */
  head: number;
  /** How far the light has cooled to broken embers (0 the vein's colour,
   *  1 embers). */
  ember: number;
}

/** Groove `i` at `t`: dark until its comet dives in, burning behind it as it
 *  runs, flaring white with the impact, then cooling to embers and out. */
export function deathTrail(
  t: number,
  i: number,
  out: DeathTrailLook = { front: -1, level: 0, head: 0, ember: 0 },
): DeathTrailLook {
  const f = deathRaceFront(t, i);
  if (f < 0) {
    out.front = -1;
    out.level = 0;
    out.head = 0;
    out.ember = 0;
    return out;
  }
  out.front = f;
  out.head = t < deathRaceEnd(i) ? 1 : Math.max(0, 1 - (t - deathRaceEnd(i)) / 0.25);
  const after = t - DEATH_IMPACT;
  const surge = after >= 0 ? Math.exp(-after * 5) * 0.8 : 0;
  const on = smooth((t - deathRaceStart(i)) / 0.2);
  const cool = after < 0 ? 0 : smooth(after / 1.0);
  const dying = after < 0 ? 1 : 1 - smooth((after - 0.6) / (DEATH_SCENE.embers - 0.6));
  out.level = on * (1 + surge) * (1 - 0.45 * cool) * dying;
  out.ember = cool;
  return out;
}

// ---- the room ------------------------------------------------------------------------------

/** How bright altar `i`'s vein burns at `t` (heart_room_kit.ts `setVein`,
 *  through ../smith_heart/heart_arrival_light_core.ts): burning until its
 *  comet has come and gone down its groove, then going out with the impact
 *  to a last ember. */
export function deathAltarLevel(t: number, i: number): number {
  if (t < deathLandAt(i)) return 1;
  const after = t - DEATH_IMPACT;
  if (after < 0) return 1;
  return 0.12 + 0.88 * (1 - smooth(after / 1.6));
}

/** The sky's flare (0 to 1): a breath of it at the tear, a blaze at the
 *  impact. */
export function deathSkyFlare(t: number): number {
  const tear = t >= DEATH_TEAR ? 0.35 * Math.exp(-(t - DEATH_TEAR) * 3) : 0;
  const hit = t >= DEATH_IMPACT ? 0.85 * Math.exp(-(t - DEATH_IMPACT) * 1.6) : 0;
  return Math.min(1, tear + hit);
}

// ---- the debris ---------------------------------------------------------------------------

/** The broken stone the tear throws off the body: each piece's heading
 *  (radians off the facing), its speed out and up, size and tumble. Fixed
 *  (a seeded plan), so every client throws the same stone. */
export interface DeathDebrisPiece {
  angle: number;
  out: number;
  up: number;
  size: number;
  spin: number;
  /** Born at the chest's height share (0 the feet, 1 the chest). */
  from: number;
}

export const DEATH_DEBRIS_COUNT = 22;

/** The low tier throws every k-th piece (a share, the burst's shape whole). */
export function deathDebrisKept(i: number, share: number): boolean {
  if (share >= 1) return true;
  const k = Math.max(1, Math.round(1 / Math.max(0.05, share)));
  return i % k === 0;
}

export const DEATH_DEBRIS: readonly DeathDebrisPiece[] = (() => {
  let s = 0x2c9e5;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) | 0;
    return (s >>> 0) / 4294967296;
  };
  const out: DeathDebrisPiece[] = [];
  for (let i = 0; i < DEATH_DEBRIS_COUNT; i++) {
    out.push({
      // Mostly forward and to the sides of the chest (the crystal rips out
      // the front), a few thrown back over the shoulders.
      angle: (rnd() * 2 - 1) * (i % 5 === 0 ? Math.PI : Math.PI * 0.65),
      out: 6 + rnd() * 10,
      up: 5 + rnd() * 9,
      size: 0.35 + rnd() * 0.75,
      spin: 2 + rnd() * 6,
      from: 0.55 + rnd() * 0.45,
    });
  }
  return out;
})();

/** Gravity on a thrown piece (yards a second squared). */
export const DEATH_DEBRIS_GRAVITY = 26;

/** A piece of the husk `age` seconds after the tear: its offset from where
 *  it broke off (forward along the body's facing for angle 0), how far it
 *  has fallen, its scale (it settles, then sinks away near the scene's end).
 *  `drop` is how far under its birth the floor lies (yards). */
export function deathDebrisAt(
  piece: DeathDebrisPiece,
  age: number,
  drop: number,
  out: { side: number; fwd: number; y: number; scale: number; turn: number } = {
    side: 0,
    fwd: 0,
    y: 0,
    scale: 0,
    turn: 0,
  },
): { side: number; fwd: number; y: number; scale: number; turn: number } {
  if (age < 0) {
    out.scale = 0;
    return out;
  }
  // When it reaches the floor (solving up*t - g/2 t^2 = -drop).
  const g = DEATH_DEBRIS_GRAVITY;
  const land = (piece.up + Math.sqrt(piece.up * piece.up + 2 * g * drop)) / g;
  const ft = Math.min(age, land);
  const slide = age > land ? Math.min(0.35, (age - land) * 0.9) : 0;
  const reach = piece.out * (ft + slide * 0.4);
  out.fwd = Math.cos(piece.angle) * reach;
  out.side = Math.sin(piece.angle) * reach;
  out.y = age < land ? piece.up * age - 0.5 * g * age * age : -drop;
  out.turn = piece.spin * ft;
  const end = DEATH_END - DEATH_TEAR;
  out.scale = piece.size * (1 - smooth((age - (end - 1.2)) / 1.2));
  return out;
}

// ---- the sounds -----------------------------------------------------------------------------

/** Where a sound sits: on the husk, the crystal, an altar, the well. */
export type DeathSoundAt = 'body' | 'crystal' | 'altar' | 'well';

/** The scene's sounds on their beats (the raid's own samples, the SFX
 *  manifest's `heart_*` keys; no new asset). The boss's death line is the
 *  sim's (final_voice.ts `death`) and plays over it. */
export const DEATH_SOUNDS: readonly {
  at: number;
  key: string;
  gain: number;
  rate: number;
  where: DeathSoundAt;
  /** The altar's vein (for `altar`). */
  vein?: number;
}[] = [
  { at: 0.05, key: 'heart_final_kneel', gain: 1, rate: 0.9, where: 'body' },
  { at: 0.3, key: 'heart_final_overload_rising', gain: 0.85, rate: 0.8, where: 'body' },
  { at: DEATH_TEAR - 0.06, key: 'heart_final_shield_break', gain: 1, rate: 0.85, where: 'crystal' },
  { at: DEATH_TEAR, key: 'heart_final_overload_burst', gain: 1, rate: 0.82, where: 'crystal' },
  { at: DEATH_SPLIT, key: 'heart_final_quarter_shift', gain: 0.95, rate: 1.05, where: 'crystal' },
  ...ARRIVAL_VEINS.map((_, i) => ({
    at: deathLandAt(i),
    key: 'heart_final_vein_shock',
    gain: 0.7,
    rate: 0.9 + i * 0.07,
    where: 'altar' as const,
    vein: i,
  })),
  { at: DEATH_GATHER - 0.2, key: 'heart_final_rebirth', gain: 0.9, rate: 1.1, where: 'well' },
  { at: DEATH_MERGE, key: 'heart_final_quarter_fall', gain: 1, rate: 0.9, where: 'well' },
  { at: DEATH_IMPACT, key: 'heart_final_overload_burst', gain: 1, rate: 0.6, where: 'well' },
  { at: DEATH_IMPACT + 0.05, key: 'heart_final_tremor', gain: 1, rate: 0.7, where: 'well' },
  {
    at: DEATH_THROB - 0.15,
    key: 'heart_final_overload_pulse',
    gain: 0.6,
    rate: 0.55,
    where: 'well',
  },
];

// ---- the clock ----------------------------------------------------------------------------

/** A dev replay (`/dev heart final death`) of the scene on a living boss
 *  plays for this long, then the body stands. */
export const DEATH_REPLAY_SECONDS = DEATH_END + 0.5;

/** The scene's clock: seconds since the body died at `deadAt` (a body
 *  first seen dead is dated long past, so `deadAt` may be negative), or
 *  since a dev replay started on a living one at `replayAt` (-1 none); -1
 *  when neither (the boss stands). */
export function deathSceneTime(
  clock: number,
  deadAt: number,
  replayAt: number,
  dead: boolean,
): number {
  if (dead) return clock - deadAt;
  if (!dead && replayAt >= 0 && clock - replayAt < DEATH_REPLAY_SECONDS) return clock - replayAt;
  return -1;
}

/** The veins in the scene's order (ARRIVAL_VEINS: one comet each). */
export const DEATH_VEINS: readonly SmithHeartVein[] = ARRIVAL_VEINS;
