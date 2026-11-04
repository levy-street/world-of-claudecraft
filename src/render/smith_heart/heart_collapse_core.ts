// The Anvil falling apart (Mythic's hidden phase, design doc section 7.5; the sim
// is encounters/smith_heart/final_hidden.ts): the pure half of the room's collapse.
// What the boss's auras say now (`readHeartCollapse`, every host's mirror reads
// the same), each slot's memory of it, the frame-stepped state the painter reads
// (a quarter's seconds since it fell, its warning, the room's dimming, the Heart's
// beats), the slabs' and the landmarks' fall.
//
// Three-free, DOM-free, deterministic in its inputs.

import type { SmithHeartVein } from '../../sim/content/smith_heart_layout';
import { HEART_QUARTER_ORDER, HEART_QUARTERS } from '../../sim/content/smith_heart_quarters';
import {
  FINAL_PHASE_AURAS,
  finalStageOf,
  hiddenNextOf,
  FINAL_PHASES as P,
  quarterBit,
} from '../../sim/encounters/smith_heart/final_phase_ids';

export type HeartCollapseStage = 'none' | 'kneel' | 'rebirth' | 'collapse';

/** What the boss's auras say, plus what the painter feeds back (`dim`, `beat`). */
export interface HeartCollapseView {
  stage: HeartCollapseStage;
  /** The fallen quarters (quarterBit). */
  fallen: number;
  next: SmithHeartVein | 'ring' | null;
  seconds: number;
  /** The room's dimming now, 0 to 1 (the heart's own darkness reads it). */
  dim: number;
  /** The Heart's beat now, 0 to about 1.2. */
  beat: number;
  /** The beats so far this rebirth. */
  beats: number;
}

export function newHeartCollapseView(): HeartCollapseView {
  return { stage: 'none', fallen: 0, next: null, seconds: 0, dim: 0, beat: 0, beats: 0 };
}

interface AuraLike {
  id: string;
  value?: number;
  value2?: number;
  value3?: number;
}

/** Read the boss's auras into `out` (no allocation). */
export function readHeartCollapse(auras: readonly AuraLike[], out: HeartCollapseView): void {
  let phase: AuraLike | undefined;
  let hidden: AuraLike | undefined;
  for (const a of auras) {
    if (a.id === FINAL_PHASE_AURAS.phase) phase = a;
    else if (a.id === FINAL_PHASE_AURAS.hidden) hidden = a;
  }
  const stage = finalStageOf(phase?.value);
  out.stage = stage === 'kneel' || stage === 'rebirth' || stage === 'collapse' ? stage : 'none';
  out.fallen = out.stage === 'collapse' ? Math.round(hidden?.value ?? 0) : 0;
  out.next = out.stage === 'collapse' ? hiddenNextOf(hidden?.value2) : null;
  out.seconds = out.stage === 'collapse' ? Math.max(0, Math.round(hidden?.value3 ?? 0)) : 0;
}

const memory = new Map<string, HeartCollapseView>();

/** The boss of slot `key` shows these auras. */
export function noteHeartCollapse(key: string, auras: readonly AuraLike[]): void {
  let m = memory.get(key);
  if (!m) {
    m = newHeartCollapseView();
    memory.set(key, m);
  }
  readHeartCollapse(auras, m);
}

/** The slot's collapse as last seen, or null. */
export function heartCollapseView(key: string): HeartCollapseView | null {
  return memory.get(key) ?? null;
}

/** The room's dimming in a slot (0 when no collapse was seen). */
export function heartCollapseDim(key: string): number {
  return memory.get(key)?.dim ?? 0;
}

/** Forget every slot (tests). */
export function clearHeartCollapseMemoryForTest(): void {
  memory.clear();
}

// ---- the look's numbers -------------------------------------------------------------------

export const HEART_COLLAPSE_LOOK = {
  /** Seconds a quarter's fall plays (slabs and landmark gone by then). */
  fallSeconds: 7,
  /** A kill or a wipe: the floor rises back this much faster than it fell. */
  restoreRate: 3,
  /** The next quarter's faint mark before its warning, 0 to 1. */
  nextMark: 0.12,
  /** Slabs: the outermost starts at `slabFirst`, the innermost `slabSpread` later
   *  (it breaks from the wall in toward the raid), falling at `slabGravity`. */
  slabFirst: 0.1,
  slabSpread: 1.2,
  slabGravity: 30,
  slabDepth: 130,
  /** The landmark starts to go this long after the floor, over this long. */
  landmarkAt: 0.45,
  landmarkSeconds: 5.5,
  landmarkTilt: 1.05,
  landmarkDrop: 150,
  /** A root tears out of the crown this long after its landmark starts to go. */
  rootLag: 0.3,
  /** The room's dimming: the rebirth's end, then each fallen quarter's share. */
  dimRisen: 0.3,
  dimPerQuarter: 0.13,
} as const;

/** The Heart's beats through the rebirth (seconds), closing up as it wakes. */
export const HEART_REBIRTH_BEATS: readonly number[] = [0.1, 1.5, 2.7, 3.7, 4.5, 5.1, 5.6];

/** The Heart's beat at `t` seconds of the rebirth: each a hard thump, harder each
 *  time. */
export function heartRebirthBeat(t: number): number {
  let v = 0;
  for (let i = 0; i < HEART_REBIRTH_BEATS.length; i++) {
    const d = t - HEART_REBIRTH_BEATS[i];
    if (d < 0) break;
    v = Math.max(v, (0.45 + (0.75 * i) / (HEART_REBIRTH_BEATS.length - 1)) * Math.exp(-d * 5));
  }
  return v;
}

/** How many beats have struck by `t`. */
export function heartRebirthBeats(t: number): number {
  let n = 0;
  for (const at of HEART_REBIRTH_BEATS) if (t >= at) n++;
  return n;
}

// ---- the stepped state --------------------------------------------------------------------

export interface HeartQuarterCollapse {
  /** Seconds into its fall, -1 whole. */
  t: number;
  /** Its warning cracks, 0 to 1. */
  crack: number;
}

export interface HeartCollapseState {
  quarters: Record<SmithHeartVein, HeartQuarterCollapse>;
  /** The ring's cracks, 0 to 1. */
  ringCrack: number;
  ringBroken: boolean;
  dim: number;
  stage: HeartCollapseStage;
  /** Seconds in this stage. */
  clock: number;
}

export function newHeartCollapseState(): HeartCollapseState {
  const q = (): HeartQuarterCollapse => ({ t: -1, crack: 0 });
  return {
    quarters: { breath: q(), quench: q(), hammer: q(), heat: q() },
    ringCrack: 0,
    ringBroken: false,
    dim: 0,
    stage: 'none',
    clock: 0,
  };
}

function approach(v: number, target: number, step: number): number {
  return v < target ? Math.min(target, v + step) : Math.max(target, v - step);
}

function count(mask: number): number {
  let n = 0;
  for (const v of HEART_QUARTER_ORDER) if ((mask & quarterBit(v)) !== 0) n++;
  return n;
}

/** Step the state by `dt` from `view` (null: no boss seen), writing back the dim
 *  and the beat the rest of the room reads. */
export function stepHeartCollapse(
  s: HeartCollapseState,
  view: HeartCollapseView | null,
  dt: number,
): void {
  const L = HEART_COLLAPSE_LOOK;
  const step = Math.max(0, Math.min(0.25, dt));
  const stage = view?.stage ?? 'none';
  const fresh = stage !== s.stage;
  // First sight of a collapse already run (a late arrival): the floor is gone.
  const lateArrival = fresh && stage === 'collapse' && s.stage === 'none';
  s.clock = fresh ? 0 : s.clock + step;
  s.stage = stage;
  const fallen = view?.fallen ?? 0;
  for (const v of HEART_QUARTER_ORDER) {
    const q = s.quarters[v];
    const down = (fallen & quarterBit(v)) !== 0;
    if (down) {
      q.t = q.t < 0 ? (lateArrival ? L.fallSeconds : 0) : Math.min(L.fallSeconds, q.t + step);
      q.crack = 0;
      continue;
    }
    // A kill, a wipe or a reset: it rises back the way it fell.
    if (q.t >= 0) q.t = q.t - step * L.restoreRate;
    if (q.t < 0) q.t = -1;
    let want = 0;
    if (view?.next === v) want = view.seconds <= P.fallWarn ? 1 : L.nextMark;
    q.crack = approach(q.crack, want, step * 1.2);
  }
  s.ringCrack = approach(s.ringCrack, view?.next === 'ring' || fallen === 15 ? 1 : 0, step * 0.7);
  s.ringBroken = stage === 'collapse' && fallen === 15 && view?.next === null;
  let dimTo = 0;
  if (stage === 'kneel') dimTo = 1;
  else if (stage === 'rebirth')
    dimTo = 1 - (1 - L.dimRisen) * Math.min(1, s.clock / P.rebirthSeconds);
  else if (stage === 'collapse') dimTo = L.dimRisen + L.dimPerQuarter * count(fallen);
  s.dim = approach(s.dim, dimTo, step * (stage === 'none' ? 0.5 : 0.8));
  if (view) {
    view.dim = s.dim;
    view.beat = stage === 'rebirth' ? heartRebirthBeat(s.clock) : 0;
    view.beats = stage === 'rebirth' ? heartRebirthBeats(s.clock) : 0;
  }
}

// ---- the slabs and the landmarks ----------------------------------------------------------

export interface HeartSlabPose {
  /** Yards down from the floor; past `slabDepth` it is gone. */
  drop: number;
  /** How far it has turned over (radians). */
  turn: number;
  gone: boolean;
}

/** A slab at radius `r` (the seed's `h`: 0 to 1) `t` seconds into its quarter's
 *  fall, written into `out`. It breaks from the wall in toward the raid. */
export function heartSlabPose(r: number, h: number, t: number, out: HeartSlabPose): void {
  const L = HEART_COLLAPSE_LOOK;
  const { ringR, rimR } = HEART_QUARTERS;
  const u = Math.max(0, Math.min(1, (r - ringR) / (rimR - ringR)));
  const delay = L.slabFirst + (1 - u) * L.slabSpread + h * 0.25;
  const d = t - delay;
  if (d <= 0) {
    out.drop = 0;
    out.turn = 0;
    out.gone = false;
    return;
  }
  out.drop = 0.5 * L.slabGravity * d * d;
  out.turn = d * (0.5 + h * 1.4);
  out.gone = out.drop > L.slabDepth;
}

/** Is any slab of a quarter still moving at `t`? */
export function heartSlabsLive(t: number): boolean {
  const L = HEART_COLLAPSE_LOOK;
  return (
    t >= 0 && t <= L.slabFirst + L.slabSpread + 0.25 + Math.sqrt((2 * L.slabDepth) / L.slabGravity)
  );
}

// ---- the real pieces' fall ----------------------------------------------------------------

// A cut kit piece (docs/design/raid/kit/quarter_split.py) tags each vertex in a byte:
// class * 64 + chunk. Chunk 0 stays when its quarter falls, chunk 1 and up are its break
// cells (a keel's: its masses). Class 0 is the surface, drawn whole; 1 broken rock its
// own fall shows; 2 and 3 broken rock it shows while it stands and its counter-clockwise
// (2) or clockwise (3) neighbour has fallen.

/** A tag's chunk. */
export function heartFallChunk(tag: number): number {
  return tag & 63;
}

/** A tag's class. */
export function heartFallClass(tag: number): number {
  return tag >> 6;
}

export interface HeartFallRange {
  start: number;
  count: number;
}

export interface HeartFallRanges {
  /** The triangles sorted by tag (class, then chunk). */
  index: Uint16Array | Uint32Array;
  /** Each tag's run of indices. */
  byTag: Map<number, HeartFallRange>;
  /** Class 0's run: what a whole floor draws. */
  surface: HeartFallRange;
}

/** Sort a tagged piece's triangles by tag and find each tag's run: one index buffer, so
 *  the whole floor, each falling cell and each neighbour's rock draw a run of it. */
export function heartFallRanges(
  index: ArrayLike<number>,
  tags: ArrayLike<number>,
): HeartFallRanges {
  const lists = new Map<number, number[]>();
  for (let i = 0; i + 2 < index.length; i += 3) {
    const tag = tags[index[i]];
    let l = lists.get(tag);
    if (!l) {
      l = [];
      lists.set(tag, l);
    }
    l.push(index[i], index[i + 1], index[i + 2]);
  }
  const out = tags.length > 65535 ? new Uint32Array(index.length) : new Uint16Array(index.length);
  const byTag = new Map<number, HeartFallRange>();
  let at = 0;
  let surface = 0;
  for (const tag of [...lists.keys()].sort((a, b) => a - b)) {
    const l = lists.get(tag) as number[];
    out.set(l, at);
    byTag.set(tag, { start: at, count: l.length });
    at += l.length;
    if (heartFallClass(tag) === 0) surface = at;
  }
  return { index: out, byTag, surface: { start: 0, count: surface } };
}

/** How a falling piece goes (yards, seconds): a beat where it gives and tips, then it
 *  drops, slow to start and turning slowly, as something very heavy does. */
export const HEART_FALL_LOOK = {
  /** How long a cell gives before it goes, how far it sinks and tips meanwhile. */
  give: P.cellGive,
  giveDrop: 0.55,
  giveTurn: 0.05,
  gravity: P.plungeGravity,
  /** Gone past this: under the heart's bed's surface by then. */
  depth: 92,
  /** A cell's first start (the wall's), the last (the ring's), the scatter. */
  first: P.cellFirst,
  spread: P.cellSpread,
  scatter: P.cellScatter,
  turnBase: 0.1,
  turnRange: 0.28,
  /** The keel's masses go from under the floor first. */
  keelOuter: 0,
  keelInner: 0.45,
} as const;

/** The chasm's layers of light under a fallen quarter (yards under the walk): the heart's
 *  own light far down, smoke in it nearer the hole. */
export const HEART_FALL_DEPTH: readonly { y: number; r: number; k: number; scale: number }[] = [
  // The weak-spots pass of 2026-11-04 (the abyss read as a painted floor): four
  // thin wisps spread from just under the keel down to the bed, each fading where
  // the eye meets it edge on (DEPTH_VERT `vDown`), so the hole keeps its depth
  // from a body's height and gains parallax from above.
  { y: -14, r: 72, k: 0.035, scale: 0.055 },
  { y: -24, r: 74, k: 0.07, scale: 0.042 },
  { y: -34, r: 76, k: 0.13, scale: 0.031 },
  { y: -43, r: 80, k: 0.26, scale: 0.022 },
];
/** The veil of dark air over the heart's bed (it stands lit as a plate from up here): the
 *  bed sinks into it, burning through at the heart. Under the deepest wisp. */
export const HEART_FALL_VEIL = { y: -45, r: 130 } as const;

/** How strong the heart burns for slot `key`, the room's darkness `dark` given: the room
 *  dims through the collapse, but a fallen quarter opens onto the heart itself, awake. */
export function heartCollapseHeartLevel(key: string, dark: number): number {
  const v = memory.get(key);
  return v && v.stage === 'collapse' && v.fallen !== 0 ? 1 : 1 - dark;
}

export interface HeartChunkPose {
  drop: number;
  turn: number;
  gone: boolean;
}

function fallFrom(delay: number, h: number, t: number, out: HeartChunkPose): void {
  const L = HEART_FALL_LOOK;
  const d = t - delay;
  out.gone = false;
  if (d <= -L.give) {
    out.drop = 0;
    out.turn = 0;
    return;
  }
  if (d <= 0) {
    const k = 1 + d / L.give;
    const e = k * k * (3 - 2 * k);
    out.drop = L.giveDrop * e;
    out.turn = L.giveTurn * e;
    return;
  }
  out.drop = L.giveDrop + 0.5 * L.gravity * d * d;
  out.turn = L.giveTurn + d * (L.turnBase + h * L.turnRange);
  out.gone = out.drop > L.depth;
}

/** A break cell whose middle lies `r` from the room's centre (`h`: its own 0 to 1), `t`
 *  seconds into its quarter's fall: it breaks from the wall in toward the raid. */
export function heartCellPose(r: number, h: number, t: number, out: HeartChunkPose): void {
  const L = HEART_FALL_LOOK;
  const { ringR, rimR } = HEART_QUARTERS;
  const u = Math.max(0, Math.min(1, (r - ringR) / (rimR - ringR)));
  fallFrom(L.give + L.first + (1 - u) * L.spread + h * L.scatter, h, t, out);
}

/** One of a quarter's keel masses (`mass` 3 the inner one). */
export function heartKeelPose(mass: number, h: number, t: number, out: HeartChunkPose): void {
  const L = HEART_FALL_LOOK;
  fallFrom(L.give + (mass === 3 ? L.keelInner : L.keelOuter), h * 0.4, t, out);
}

/** When the last real piece of a quarter has gone. */
export function heartFallDone(): number {
  const L = HEART_FALL_LOOK;
  const fallTime = Math.sqrt((2 * (L.depth - L.giveDrop)) / L.gravity);
  return L.give + L.first + L.spread + L.scatter + fallTime;
}

/** The floor's warning stays lit over a cell until it has gone: 1 at the break, 0 once
 *  the last of the floor has left (a body goes as its own stretch does: hiddenCellGoes). */
export function heartFallEdgeLight(t: number): number {
  const L = HEART_FALL_LOOK;
  if (t < 0) return 0;
  const end = L.give + L.first + L.spread + L.scatter + 0.5;
  return Math.max(0, 1 - t / end);
}

/** A root of the mountain whose landmark falls (the weak-spots pass of
 *  2026-11-04: it stayed hanging from the crown over the hole, its foot torn
 *  off in the air). It tears out of the crown a beat after its landmark starts
 *  to go and drops after it into the abyss, gone with it: its drop (yards)
 *  `t` seconds into its quarter's fall. */
export function heartRootFall(t: number): { drop: number; gone: boolean } {
  const L = HEART_COLLAPSE_LOOK;
  if (t < 0) return { drop: 0, gone: false };
  const k = Math.max(0, Math.min(1, (t - L.landmarkAt - L.rootLag) / L.landmarkSeconds));
  return { drop: L.landmarkDrop * 1.4 * k ** 2.2, gone: k >= 1 };
}

/** A quarter's ridge horn: it goes with the first of its two quarters to fall. */
export function heartHornT(ta: number, tb: number): number {
  return Math.max(ta, tb);
}

/** The landmark's topple `t` seconds into the fall: its tilt in toward the room
 *  (radians), its drop (yards), and whether it has gone from sight. */
export function heartLandmarkFall(t: number): { tilt: number; drop: number; gone: boolean } {
  const L = HEART_COLLAPSE_LOOK;
  if (t < 0) return { tilt: 0, drop: 0, gone: false };
  const k = Math.max(0, Math.min(1, (t - L.landmarkAt) / L.landmarkSeconds));
  return {
    tilt: L.landmarkTilt * k * k * (3 - 2 * k),
    drop: L.landmarkDrop * k ** 2.4,
    gone: k >= 1,
  };
}
