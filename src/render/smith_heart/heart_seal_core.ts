// The renderer's memory of each Smith's Heart claim's heart seal: which veins
// burn on it and when each lit, and whether (and when) the seal opened into
// the portal. The run's seal markers carry the value in their template id
// (`smith_heart_seal_<value>`, lit-vein bits plus the portal bit,
// sim/encounters/smith_heart/seal.ts); every marker view the renderer builds
// reports what it shows here (../gate_objects.ts, the same seam the
// Gravewyrm Sanctum's story markers ride), and the seal, the light-rivers and
// the portal read the slot's view each frame.
//
// A marker is rebuilt on every template swap, so the newest observation is
// the claim's current value. Since phase 2J the value also carries the
// arrival (the heart awake): seen waking, it records when (the arrival scene
// plays from there); first seen already awake, it snaps (the body is whole). A vein (or the portal) first seen already lit
// snaps (a raid arriving at a lit seal sees it burning, no replay); one seen
// lighting records when, so its river runs, its quarter fills and the portal
// bursts open. A value that LOSES a vein or the portal is a fresh claim in
// the same slot (the run's value only ever grows), so the slot starts over,
// snapped.
//
// The fill: a vein's light runs down its river for HEART_RIVER_RUN_SECONDS;
// when it reaches the seal its quarter fills from the rim inward
// (HEART_SEAL_FILL_SECONDS) behind a white-hot front and a column of its
// colour stands up off the quarter, then the quarter burns steady.
//
// Pure and Three-free (the clock is passed in, render seconds).

import { SMITH_HEART_VEINS, type SmithHeartVein } from '../../sim/content/smith_heart_layout';
import { DUNGEONS, instanceOrigin, instanceSlotForZ } from '../../sim/data';
import {
  SMITH_HEART_SEAL_FULL,
  smithHeartAwakeBitSet,
  smithHeartPortalBitSet,
  smithHeartSealMaskOf,
  smithHeartVeinLit,
} from '../../sim/encounters/smith_heart/seal';
import { HEART_RIVER_RUN_SECONDS } from './heart_rivers_core';

/** The dungeon id whose markers this memory reads. */
export const HEART_SEAL_DUNGEON = 'smith_heart';
/** Seconds a vein counts as "lit long ago" when first seen lit. */
const SNAPPED = 999;

interface SlotMemory {
  mask: number;
  /** When each vein (SMITH_HEART_VEINS order) lit, render seconds, or
   *  Infinity while dark. */
  litAt: number[];
  /** When the portal opened, render seconds, or Infinity while shut. */
  portalAt: number;
  /** When the heart woke (the raid's first arrival), render seconds, or
   *  Infinity while it sleeps. */
  awakeAt: number;
}

const memory = new Map<string, SlotMemory>();

/** The memory key of the slot anchored at (ox, oz). */
export function heartSealSlotKey(ox: number, oz: number): string {
  return `${Math.round(ox)}|${Math.round(oz)}`;
}

function fresh(mask: number, now: number): SlotMemory {
  return {
    mask,
    litAt: SMITH_HEART_VEINS.map((v) => (smithHeartVeinLit(mask, v) ? now - SNAPPED : Infinity)),
    portalAt: smithHeartPortalBitSet(mask) ? now - SNAPPED : Infinity,
    awakeAt: smithHeartAwakeBitSet(mask) ? now - SNAPPED : Infinity,
  };
}

/** Record a seal value (lit veins plus the portal bit) seen for slot `key`
 *  at render time `now`. */
export function observeHeartSealMask(key: string, mask: number, now: number): void {
  const m = memory.get(key);
  // A vein or the portal going dark is a fresh claim (or a dev reset):
  // start over, snapped.
  if (!m || (m.mask & ~mask) !== 0) {
    memory.set(key, fresh(mask, now));
    return;
  }
  if (mask === m.mask) return;
  SMITH_HEART_VEINS.forEach((v, i) => {
    if (smithHeartVeinLit(mask, v) && !smithHeartVeinLit(m.mask, v)) m.litAt[i] = now;
  });
  if (smithHeartPortalBitSet(mask) && !smithHeartPortalBitSet(m.mask)) m.portalAt = now;
  if (smithHeartAwakeBitSet(mask) && !smithHeartAwakeBitSet(m.mask)) m.awakeAt = now;
  m.mask = mask;
}

interface MarkerLike {
  templateId: string;
  dungeonId: string | null;
  pos: { x: number; z: number };
}

/** Is this template id a Smith's Heart seal marker's? */
export function isHeartSealMarker(templateId: string): boolean {
  return smithHeartSealMaskOf(templateId) !== null;
}

/** Report a mirrored entity: a seal marker records its value under its slot;
 *  any other entity is ignored. */
export function observeHeartSealMarker(e: MarkerLike, now: number): void {
  const mask = smithHeartSealMaskOf(e.templateId);
  if (mask === null || e.dungeonId !== HEART_SEAL_DUNGEON) return;
  const def = DUNGEONS[HEART_SEAL_DUNGEON];
  if (!def) return;
  const o = instanceOrigin(def.index, instanceSlotForZ(e.pos.z));
  observeHeartSealMask(heartSealSlotKey(o.x, o.z), mask, now);
}

export interface HeartSealView {
  /** Lit-vein mask (the portal bit stripped). */
  mask: number;
  /** Seconds since each vein lit (SMITH_HEART_VEINS order), -1 while dark. */
  since: number[];
  /** Seconds since the seal opened into the portal, -1 while shut. */
  portalSince: number;
  /** Seconds since the heart woke (the arrival), -1 while it sleeps (a
   *  heart first seen awake reads as long awake). */
  awakeSince: number;
}

export function newHeartSealView(): HeartSealView {
  return { mask: 0, since: SMITH_HEART_VEINS.map(() => -1), portalSince: -1, awakeSince: -1 };
}

/** The slot's seal at `now`, written into `out` (allocation-free: the frame
 *  driver calls it every frame). An unseen slot is dark and shut. */
export function heartSealView(
  key: string,
  now: number,
  out: HeartSealView = newHeartSealView(),
): HeartSealView {
  const m = memory.get(key);
  out.mask = m ? m.mask & SMITH_HEART_SEAL_FULL : 0;
  for (let i = 0; i < SMITH_HEART_VEINS.length; i++) {
    const at = m ? m.litAt[i] : Infinity;
    out.since[i] = Number.isFinite(at) ? now - at : -1;
  }
  out.portalSince = m && Number.isFinite(m.portalAt) ? now - m.portalAt : -1;
  out.awakeSince = m && Number.isFinite(m.awakeAt) ? now - m.awakeAt : -1;
  return out;
}

/** Seconds a quarter takes to fill, rim to centre, once its river arrives. */
export const HEART_SEAL_FILL_SECONDS = 2.4;
/** Seconds after a vein lights that its light reaches the seal (its river's
 *  run, a touch early so the front meets the ribbon's end). */
export const HEART_SEAL_ARRIVAL = HEART_RIVER_RUN_SECONDS * 0.92;
/** Seconds the arrival column stands. */
export const HEART_SEAL_COLUMN_SECONDS = 1.8;

/** How far a quarter has filled (0 dark, 1 full): nothing until the river
 *  arrives, then an eased fill from the rim inward. */
export function heartSealQuarterFill(since: number): number {
  if (since < HEART_SEAL_ARRIVAL) return 0;
  const t = Math.min(1, (since - HEART_SEAL_ARRIVAL) / HEART_SEAL_FILL_SECONDS);
  return 1 - (1 - t) * (1 - t);
}

/** A quarter's brightness: 0 dark, 1 burning; it overshoots as the fill
 *  completes (the quarter flares) and settles. */
export function heartSealQuarterLevel(since: number): number {
  const fill = heartSealQuarterFill(since);
  if (fill <= 0) return 0;
  const done = since - HEART_SEAL_ARRIVAL - HEART_SEAL_FILL_SECONDS;
  if (done <= 0) return 0.75 + fill * 0.35;
  return 1 + 0.35 * Math.max(0, 1 - done / 1.2);
}

/** The arrival column's strength (0 to 1): it stands up as the river
 *  reaches the seal and fades. */
export function heartSealColumn(since: number): number {
  const t = since - HEART_SEAL_ARRIVAL;
  if (t < 0 || t > HEART_SEAL_COLUMN_SECONDS) return 0;
  const rise = Math.min(1, t / 0.18);
  return rise * (1 - t / HEART_SEAL_COLUMN_SECONDS) ** 1.5;
}

/** Seconds the arrival's shockwave takes to cross from the seal to the
 *  Ring's outer rim. */
export const HEART_SEAL_WAVE_SECONDS = 1.7;

/** The arrival's shockwave (phase 2F): how far across it has run (0 to 1 of
 *  its reach) `since` seconds after its vein lit, 0 before the light reaches
 *  the seal and after it has crossed. */
export function heartSealArrivalWave(since: number): number {
  const t = (since - HEART_SEAL_ARRIVAL) / HEART_SEAL_WAVE_SECONDS;
  if (t < 0 || t > 1) return 0;
  return Math.max(0.001, 1 - (1 - t) * (1 - t));
}

/** A spire igniting with its vein (phase 2F): `fill` how far up the light
 *  has climbed (0 to 1, from just before the river reaches the seal), and
 *  `flare` a white flash as it reaches the tip, fading. */
export function heartSpireIgnite(
  since: number,
  out: { fill: number; flare: number } = { fill: 0, flare: 0 },
): { fill: number; flare: number } {
  const t = since - (HEART_SEAL_ARRIVAL - 0.25);
  if (since < 0 || t < 0) {
    out.fill = 0;
    out.flare = 0;
    return out;
  }
  out.fill = Math.min(1, t / 0.9);
  const after = t - 0.9;
  out.flare = after < 0 ? 0 : Math.max(0, 1 - after / 0.8) ** 2;
  return out;
}

/** The seal's four quarters: each vein's, centred on the bearing (degrees
 *  clockwise from north) its light-river arrives from: the Breath from the
 *  north, the Quench from the east, the Hammer down the Grand Stair from the
 *  south, the Heat from the west. */
export const HEART_SEAL_QUARTERS: readonly { vein: SmithHeartVein; bearingDeg: number }[] = [
  { vein: 'hammer', bearingDeg: 180 },
  { vein: 'breath', bearingDeg: 0 },
  { vein: 'quench', bearingDeg: 90 },
  { vein: 'heat', bearingDeg: 270 },
];

/** Forget every slot (tests). */
export function clearHeartSealForTest(): void {
  memory.clear();
}
