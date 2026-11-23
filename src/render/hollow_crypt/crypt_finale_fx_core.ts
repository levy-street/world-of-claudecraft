// PURE plan of the Hollow Crypt finale's effects (crypt_finale_fx.ts): how
// bright each piece of Morthen's entrance burns at each moment of it, read off
// his cast bar, and the Knellwyrm's pyre and lane timings. No three, no DOM, no
// clock of its own; in RENDER_PURE_CORES, tested by
// tests/crypt_finale_fx_core.test.ts.

import {
  KNELL_LANE_MARK_TEMPLATE,
  KNELL_LANE_TEMPLATE,
  KNELLWYRM_TUNING,
  MORTHEN_DESCEND,
  MORTHEN_PROCLAIM,
  MORTHEN_RISE,
  MORTHEN_RITE_WAKES,
} from '../../sim/encounters/hollow_crypt/ids';

/** Is a crypt floor object one of the Knellwyrm's Pyre Strafe lanes (marked
 *  or burning)? The crypt's object set also carries the trash kit's floor
 *  objects (the rupture ring and pool, the Barrow Embers), which
 *  crypt_trash_fx.ts draws: never a lane. */
export function isKnellLaneTemplate(templateId: string): boolean {
  return templateId === KNELL_LANE_MARK_TEMPLATE || templateId === KNELL_LANE_TEMPLATE;
}

/** What the entrance lights, each 0..1. */
export interface RiteLevels {
  /** The ritual circle's glyph band, igniting round the ring (a sweep). */
  circle: number;
  /** The soul columns rising round his spot. */
  columns: number;
  /** The great light column over the ring. */
  light: number;
  /** The spectral wind spiralling round him. */
  wind: number;
  /** Debris and dust thrown off the broken floor. */
  quake: number;
}

const ZERO: RiteLevels = { circle: 0, columns: 0, light: 0, wind: 0, quake: 0 };

function bar(castRemaining: number, castTotal: number): number {
  if (!(castTotal > 0)) return 1;
  return Math.min(1, Math.max(0, 1 - castRemaining / castTotal));
}

/**
 * The entrance's levels for Morthen's current cast (null when he is not in
 * it). The circle ignites over the wake bar and stays lit; the columns and the
 * light column swell through the rise and peak as he speaks; the wind rides
 * the rise and the hover; the floor quakes as he breaks it.
 */
export function riteLevels(
  castId: string | null,
  castRemaining: number,
  castTotal: number,
): RiteLevels {
  const k = bar(castRemaining, castTotal);
  switch (castId) {
    case MORTHEN_RITE_WAKES:
      return {
        circle: k,
        columns: 0.15 * k,
        light: 0.35 + 0.25 * k,
        wind: 0.2 * k,
        quake: 0.25 * k,
      };
    case MORTHEN_RISE:
      return {
        circle: 1,
        columns: 0.3 + 0.7 * k,
        light: 0.6 + 0.4 * k,
        wind: 0.6 + 0.4 * Math.sin(Math.PI * Math.min(1, k * 1.2)),
        quake: k < 0.35 ? 1 : Math.max(0, 1 - (k - 0.35) * 2.5),
      };
    case MORTHEN_PROCLAIM:
      return { circle: 1, columns: 1, light: 1, wind: 1, quake: 0 };
    case MORTHEN_DESCEND:
      return {
        circle: 1 - 0.5 * k,
        columns: 1 - 0.7 * k,
        light: 1 - 0.5 * k,
        wind: 1 - k,
        quake: 0,
      };
    default:
      return ZERO;
  }
}

/** The warning's fill `age` seconds after the pyre appeared (it lands at 1). */
export function pyreFill(age: number): number {
  return Math.min(1, Math.max(0, age / KNELLWYRM_TUNING.pyreSeconds));
}

/** A burning lane's strength `age` seconds after it caught: flares, holds,
 *  then gutters out over its last two seconds. */
export function laneBurn(age: number): number {
  const T = KNELLWYRM_TUNING.laneSeconds;
  if (age < 0 || age > T) return 0;
  const flare = Math.min(1, age / 0.3);
  const gutter = age > T - 2 ? (T - age) / 2 : 1;
  return flare * gutter;
}

/** Evenly spread spots along a lane (`count` of them), each jittered off the
 *  centre line by a fixed pattern: where its flames stand. Unit along [0, 1]
 *  and side offset in lane half-widths [-1, 1]. */
export function laneFlameSpots(count: number): { along: number; side: number }[] {
  const out: { along: number; side: number }[] = [];
  for (let i = 0; i < count; i++) {
    const along = (i + 0.5) / count;
    const side = Math.sin(i * 2.399) * 0.85;
    out.push({ along, side });
  }
  return out;
}
