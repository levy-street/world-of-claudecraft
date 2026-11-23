// The Gorgebloom's body effects, planned (gorgebloom_fx.ts draws them): which
// beat fires when after each trigger (a bar opening, a sim event landing, the
// death), the rates its cast clips play at so every contact frame lands on its
// bar's end, the Vine Lash's thorn wave down the rest of its lane, the glow
// pulses of its gullet and sacs, and the splash looks (basin_splash.ts crowns
// and ripples). Times come from the model's measured clips
// (gorgebloom_model_core.ts); every reach stays inside the sim's own numbers.
//
// Three-free, DOM-free, deterministic.

import {
  BLOOM_GORGE,
  BLOOM_POLLINATE,
  BLOOM_SEED_RAIN,
  BLOOM_SEED_SPROUT,
  BLOOM_SPIT,
  BLOOM_TUNING,
  BLOOM_VINE_LASH,
} from '../../sim/encounters/wildheart_basin/ids';
import type { GlowPulseSet } from '../characters/glow_pulse_core';
import { laneWaveDelay, laneWaveStations } from './basin_thorns_core';
import { castBeatTimeScale, GORGEBLOOM_CLIP, gorgebloomModelScale } from './gorgebloom_model_core';
import { SPROUT_CLIP } from './lasher_model_core';
import type { CrownSpec, RippleSpec } from './saurian_fx_core';

// ---- the clips' rates -------------------------------------------------------------

/** Seed Rain, Vine Lash and Gorge play from the bar's start at the rate that
 *  lands their contact frame (the spit, the slam, the bite) on its last frame. */
export const SEED_RAIN_RATE = castBeatTimeScale(GORGEBLOOM_CLIP.seedSpit, BLOOM_TUNING.seedCast);
export const VINE_LASH_RATE = castBeatTimeScale(GORGEBLOOM_CLIP.lashSlam, BLOOM_TUNING.lashCast);
export const GORGE_RATE = castBeatTimeScale(GORGEBLOOM_CLIP.gorgeBite, BLOOM_TUNING.gorgeCast);
/** Bloom Spit is instant in the sim: the clip runs quick so the glob leaves the
 *  maw a beat after the spit lands. */
export const SPIT_RATE = 1.6;
/** Seconds from the Bloom Spit event to the glob leaving the maw. */
export const SPIT_GLOB_DELAY = GORGEBLOOM_CLIP.spitGlob / SPIT_RATE;

// ---- the gestures -------------------------------------------------------------------

/** Glow-only gestures the fx send (glow_pulse_core.ts): the gullet stoked for
 *  a bar (Seed Rain, Gorge), the sacs blazing as Pollinate bursts them, the
 *  throat's flash on a spit. Kept apart from the clips' gestures so the glow
 *  flares even when a strike's play-out holds the clip back. */
export const GORGEBLOOM_GULLET_GESTURE = 'wildheart_gorgebloom_gullet';
export const GORGEBLOOM_SACS_GESTURE = 'wildheart_gorgebloom_sacs';
export const GORGEBLOOM_THROAT_GESTURE = 'wildheart_gorgebloom_throat';
/** A Thorn Sprout bursting out of its pod (VisualDef.entranceGesture: its
 *  Emerge clip, once per sprout). */
export const THORN_SPROUT_EMERGE_GESTURE = 'wildheart_thorn_sprout_emerge';
/** How long after the sprout's event the gesture keeps being offered (the
 *  view may be built a few frames after the entity appears). */
export const THORN_SPROUT_EMERGE_WINDOW = 0.6;
/** The roar on the pull (attackByAbility: Roar). */
export const GORGEBLOOM_ROAR_GESTURE = 'wildheart_gorgebloom_roar';

/** How its own glow map (the gullet and the four sacs) flares and dies. */
export const GORGEBLOOM_GLOW: GlowPulseSet = {
  pulses: [
    // The gullet stoked through a 1.5 s bar: up to a furnace at the bar's end.
    { gesture: GORGEBLOOM_GULLET_GESTURE, rise: 1.45, hold: 0.25, fall: 0.9, peak: 2.4 },
    // Pollinate: the sacs blaze as they burst.
    {
      gesture: GORGEBLOOM_SACS_GESTURE,
      delay: 0.15,
      rise: GORGEBLOOM_CLIP.pollinateBurst - 0.15,
      hold: 0.12,
      fall: 1,
      peak: 4,
    },
    // Bloom Spit: a quick flare of the throat.
    { gesture: GORGEBLOOM_THROAT_GESTURE, rise: SPIT_GLOB_DELAY, hold: 0.05, fall: 0.5, peak: 2.4 },
    // The roar: everything opens and burns.
    {
      gesture: GORGEBLOOM_ROAR_GESTURE,
      rise: GORGEBLOOM_CLIP.roarPeak,
      hold: 0.4,
      fall: 1,
      peak: 2.6,
    },
  ],
  // The glow gutters out as it wilts (gone before the head hits the water).
  deathFade: GORGEBLOOM_CLIP.deathFold,
};

// ---- the beats ----------------------------------------------------------------------

/** What starts a run of beats. Bars are seen opening; the rest are sim events
 *  (spellfx) landing on the contact frame, the pull and the death. */
export type BloomTrigger =
  | 'seedBar'
  | 'seedSpit'
  | 'pollinate'
  | 'lashBar'
  | 'lashSlam'
  | 'gorgeBar'
  | 'gorgeBite'
  | 'spit'
  | 'roar'
  | 'sprout'
  | 'death';

export type BloomBeatKind =
  | 'gulletSwell'
  | 'seedSpit'
  | 'sacSwell'
  | 'pollenBurst'
  | 'pollenReach'
  | 'lashRear'
  | 'lashSlam'
  | 'lashWave'
  | 'gorgeDrool'
  | 'gorgeBite'
  | 'gorgeShake'
  | 'gorgeSwallow'
  | 'spitFlash'
  | 'roarPeak'
  | 'deathShriek'
  | 'deathPetals'
  | 'deathSplash'
  | 'deathSink'
  | 'sproutBurst';

export interface BloomBeat {
  kind: BloomBeatKind;
  /** Seconds after the trigger. */
  at: number;
  /** An index within the run (a wave station, a petal fall). */
  k?: number;
}

/** The Vine Lash's thorn wave: stations from where the club lands to the end
 *  of the 30 yd lane, the front racing out at this speed (yd/s). */
export const LASH_WAVE_SPEED = 64;
export const LASH_WAVE_STEP = 2.4;

/** Yards along the lane where the club lands for a bloom at sim `scale`. */
export function lashImpactReach(scale: number): number {
  return GORGEBLOOM_CLIP.lashTipImpact.z * gorgebloomModelScale(scale);
}

/** The wave's stations (yards along the lane), the club's own spot excluded,
 *  out to the lane's end. Writes `out`. */
export function lashWaveStations(scale: number, out: number[]): number[] {
  return laneWaveStations(lashImpactReach(scale), BLOOM_TUNING.lashLength, LASH_WAVE_STEP, out);
}

/** Seconds after the slam the wave reaches `reach` yards along the lane. */
export function lashWaveDelay(reach: number, scale: number): number {
  return laneWaveDelay(reach, lashImpactReach(scale), LASH_WAVE_SPEED);
}

const C = GORGEBLOOM_CLIP;
const SIM_SCALE_STATIONS: number[] = [];

/** The beats one trigger schedules (seconds after it, at the clips' rates). */
export function gorgebloomBeats(trigger: BloomTrigger, scale = 2.8): readonly BloomBeat[] {
  switch (trigger) {
    case 'seedBar':
      // Sap and pollen dust shaken off as the bulb swells and the petals curl.
      return [0.25, 0.7, 1.15].map((at, k) => ({ kind: 'gulletSwell' as const, at, k }));
    case 'seedSpit':
      return [{ kind: 'seedSpit', at: 0 }];
    case 'pollinate':
      return [
        { kind: 'sacSwell', at: 0.15 },
        { kind: 'pollenBurst', at: C.pollinateBurst },
        { kind: 'pollenReach', at: C.pollinateBurst + 0.35 },
      ];
    case 'lashBar':
      return [{ kind: 'lashRear', at: C.lashHigh / VINE_LASH_RATE }];
    case 'lashSlam': {
      const beats: BloomBeat[] = [{ kind: 'lashSlam', at: 0 }];
      lashWaveStations(scale, SIM_SCALE_STATIONS);
      SIM_SCALE_STATIONS.forEach((d, k) => {
        beats.push({ kind: 'lashWave', at: lashWaveDelay(d, scale), k });
      });
      return beats;
    }
    case 'gorgeBar':
      return [{ kind: 'gorgeDrool', at: C.gorgeGape / GORGE_RATE }];
    case 'gorgeBite':
      return [
        { kind: 'gorgeBite', at: 0 },
        ...C.gorgeShakes.map((s, k) => ({
          kind: 'gorgeShake' as const,
          at: (s - C.gorgeBite) / GORGE_RATE,
          k,
        })),
        { kind: 'gorgeSwallow', at: (C.gorgeSwallow - C.gorgeBite) / GORGE_RATE },
      ];
    case 'spit':
      return [{ kind: 'spitFlash', at: SPIT_GLOB_DELAY }];
    case 'roar':
      return [{ kind: 'roarPeak', at: C.roarPeak }];
    case 'sprout':
      // The pod splits on the Sprout's own Emerge frame.
      return [{ kind: 'sproutBurst', at: SPROUT_CLIP.emergeBurst }];
    case 'death':
      return [
        { kind: 'deathShriek', at: C.deathShriek },
        ...[0.95, 1.35, 1.8, 2.25].map((at, k) => ({ kind: 'deathPetals' as const, at, k })),
        { kind: 'deathSplash', at: C.deathSplash },
        ...[3.15, 3.65, 4.15].map((at, k) => ({ kind: 'deathSink' as const, at, k })),
      ];
  }
}

/** Which body trigger a Gorgebloom spellfx is (null: not a body beat). */
export function bloomEventTrigger(ability: string | undefined): BloomTrigger | null {
  switch (ability) {
    case BLOOM_SEED_RAIN:
      return 'seedSpit';
    case BLOOM_POLLINATE:
      return 'pollinate';
    case BLOOM_VINE_LASH:
      return 'lashSlam';
    case BLOOM_GORGE:
      return 'gorgeBite';
    case BLOOM_SPIT:
      return 'spit';
    case BLOOM_SEED_SPROUT:
      return 'sprout';
    default:
      return null;
  }
}

/** Which bar trigger a cast opening is (null: none of its bars). */
export function bloomBarTrigger(castId: string | null | undefined): BloomTrigger | null {
  switch (castId) {
    case BLOOM_SEED_RAIN:
      return 'seedBar';
    case BLOOM_VINE_LASH:
      return 'lashBar';
    case BLOOM_GORGE:
      return 'gorgeBar';
    default:
      return null;
  }
}

/** Seconds a bar's clip keeps playing after its bar ends (its play-out): an
 *  ability gesture in this window would cut the strike's follow-through. */
export function bloomPlayOutSeconds(castId: string | null | undefined): number {
  switch (castId) {
    case BLOOM_SEED_RAIN:
      return (C.seedLength - C.seedSpit) / SEED_RAIN_RATE;
    case BLOOM_VINE_LASH:
      return (C.lashLength - C.lashSlam) / VINE_LASH_RATE;
    case BLOOM_GORGE:
      return (C.gorgeLength - C.gorgeBite) / GORGE_RATE;
    default:
      return 0;
  }
}

// ---- the splashes -------------------------------------------------------------------

/** The root pool's skin of water stands this far over the dais. */
export const ROOT_POOL_LIFT = 0.08;

export const BLOOM_CROWNS = {
  /** The club slamming the loam at the lane's near end. */
  clubSlam: { r0: 0.6, r1: 3, height: 3.4, life: 0.85 },
  /** Thorns tearing up out of the loam down the lane. */
  thorn: { r0: 0.3, r1: 1.5, height: 2.1, life: 0.6 },
  /** The roots heaving in the pool as it roars. */
  roar: { r0: 2.4, r1: 7, height: 1.6, life: 0.9 },
  /** The head crashing into the root pool. */
  deathSplash: { r0: 1.4, r1: 6.2, height: 5.6, life: 1.35 },
} as const satisfies Record<string, CrownSpec>;

export const BLOOM_RIPPLES = {
  clubSlam: { reach: 5.5, life: 1.1, rings: 3 },
  roar: { reach: 10, life: 1.5, rings: 3 },
  deathSplash: { reach: 13, life: 2.3, rings: 4 },
  deathSink: { reach: 7.5, life: 1.9, rings: 2 },
} as const satisfies Record<string, RippleSpec>;

/** The tints: the loam and the bloom's sap, its gullet acid, the pool. */
export const BLOOM_TINTS = {
  loam: 0xb8a070,
  sap: 0x9cc65a,
  acid: 0xb6ff5a,
  water: 0xffffff,
  pollen: 0xffe27a,
} as const;
