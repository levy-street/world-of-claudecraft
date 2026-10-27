// Pure plan of the Breath vein's air and weather (phase 2G; breath_air.ts
// paints it): the gale streaming over the summit from the north-west (wind
// streaks and the grit it carries over every Breath walk), the storm's cloud
// banks rolling past below the Cornice's rim and through the chasm under the
// Wind Bridge, the bridge's gusts sweeping down its ramp in a steady rhythm,
// and the lightning striking the Cornice's rods one after another.
//
// Every motion runs in the shaders on the shared clock; the strike and gust
// schedules below are the same arithmetic the shaders run (pinned by
// tests/smith_heart_breath_kit.test.ts). Cosmetic: nothing here is a
// telegraph, nothing lies over a walked floor thicker than a streak, the
// clouds stay under the Cornice's walk and past its rim, and the low tier
// builds a third of the particles (the strikes and the gusts' band stay).
// Three-free, DOM-free, deterministic (a hash, never rng).

import { BREATH, SMITH_HEART_FIELD, WIND_BRIDGE } from '../../sim/content/smith_heart_layout';
import { heartHash } from './heart_plan_core';

/** The gale's heading over the summit (from the north-west, x z unit). */
export const BREATH_WIND: readonly [number, number] = [0.6, -0.8];

/** The bridge's gust rhythm: one gust every PERIOD seconds, its band taking
 *  SWEEP seconds to run down the ramp from the high end to the low. */
export const BREATH_GUST = { period: 8, sweep: 1.8, offset: 2.5 } as const;

/** The strikes on the Cornice's rods: one every CELL seconds, round the
 *  rods in a fixed stride (coprime with their count), each visible for
 *  FLASH seconds. */
export const BREATH_STRIKE = { cell: 7.5, flash: 0.42, stride: 5 } as const;

/** A box of air the gale streams through. */
export interface WindVolume {
  x: number;
  z: number;
  hw: number;
  hd: number;
  y0: number;
  y1: number;
  streaks: number;
  grit: number;
  /** 1 where the bridge's gusts drive it (its streaks surge with them). */
  gust: number;
}

/** A cloud card rolling past (soft, big, slow). */
export interface CloudCard {
  x: number;
  y: number;
  z: number;
  size: number;
}

export interface BreathAirPlan {
  volumes: WindVolume[];
  clouds: CloudCard[];
  /** The rods' crowns (where the strikes land), in the layout's order. */
  crowns: { x: number; y: number; z: number }[];
}

/** How high a rod's crown stands over its foot (the kit's Kit_StormRod). */
export const BREATH_ROD_CROWN = 20.6;

/** The gust's state `t` seconds into the clock: which gust (its index), how
 *  far its band has run down the ramp (0 the high end, 1 the low; < 0 not
 *  yet), and its strength (0..1, the surge the streaks take). */
export function breathGustAt(t: number): { index: number; front: number; strength: number } {
  const local = t - BREATH_GUST.offset;
  const index = Math.floor(local / BREATH_GUST.period);
  const phase = local - index * BREATH_GUST.period;
  const front = phase / BREATH_GUST.sweep;
  const strength =
    phase < BREATH_GUST.sweep
      ? Math.min(1, phase / 0.3)
      : Math.max(0, 1 - (phase - BREATH_GUST.sweep) / 1.2);
  return { index, front: front <= 1.4 ? front : -1, strength };
}

/** The strike `t` seconds into the clock: the rod it lands on (index into
 *  the crowns), and its phase (seconds since it landed; < 0 or past FLASH:
 *  none showing). */
export function breathStrikeAt(t: number, rods: number): { rod: number; since: number } {
  const k = Math.floor(t / BREATH_STRIKE.cell);
  const at = k * BREATH_STRIKE.cell + fract(k * 0.618) * (BREATH_STRIKE.cell - 1);
  const rod = rods > 0 ? (((k * BREATH_STRIKE.stride + 2) % rods) + rods) % rods : 0;
  return { rod, since: t - at };
}

function fract(v: number): number {
  return v - Math.floor(v);
}

/** The Breath's air. `density` thins the particles (1 full, the low tier a
 *  third); the clouds thin too, never the strikes or the gusts. */
export function planBreathAir(density = 1): BreathAirPlan {
  const n = (v: number) => Math.max(1, Math.round(v * density));
  const C = BREATH.cornice;
  const midX = (WIND_BRIDGE.fromX + WIND_BRIDGE.toX) / 2;
  const midZ = (WIND_BRIDGE.fromZ + WIND_BRIDGE.toZ) / 2;
  const volumes: WindVolume[] = [
    // Over the Cornice, a man's height to a few over the walk.
    {
      x: C.x,
      z: C.z,
      hw: C.rx,
      hd: C.rz,
      y0: C.h + 0.6,
      y1: C.h + 7,
      streaks: n(90),
      grit: n(46),
      gust: 0,
    },
    // Down the Wind Bridge and the chasm under it.
    { x: midX, z: midZ, hw: 16, hd: 18, y0: 14, y1: 46, streaks: n(60), grit: n(30), gust: 1 },
    // The climb to the Cornice.
    { x: -84, z: 186, hw: 22, hd: 10, y0: 42, y1: 66, streaks: n(26), grit: n(12), gust: 0 },
    // The landings.
    ...[BREATH.b1, BREATH.b2, BREATH.b3].map((b) => ({
      x: b.x,
      z: b.z,
      hw: b.r + 4,
      hd: b.r + 4,
      y0: b.h + 0.6,
      y1: b.h + 6,
      streaks: n(14),
      grit: n(6),
      gust: 0,
    })),
  ];
  const clouds: CloudCard[] = [];
  // Banks round the Cornice, under its walk and past its rim.
  const banks = n(22);
  for (let i = 0; i < banks; i++) {
    const a = (i / banks) * Math.PI * 2 + heartHash(i, 3) * 0.3;
    const out = 10 + heartHash(i, 5) * 26;
    clouds.push({
      x: C.x + Math.sin(a) * (C.rx + out),
      y: C.h - 6 - heartHash(i, 7) * 26,
      z: C.z + Math.cos(a) * (C.rz + out),
      size: 16 + heartHash(i, 11) * 16,
    });
  }
  // Through the chasm under the Wind Bridge and the chimney's.
  const under = n(10);
  for (let i = 0; i < under; i++) {
    const t = (i + 0.5) / under;
    clouds.push({
      x:
        WIND_BRIDGE.fromX +
        (WIND_BRIDGE.toX - WIND_BRIDGE.fromX) * t +
        (heartHash(i, 13) - 0.5) * 14,
      y: 4 - heartHash(i, 17) * 22 + t * 12,
      z:
        WIND_BRIDGE.fromZ +
        (WIND_BRIDGE.toZ - WIND_BRIDGE.fromZ) * t +
        (heartHash(i, 19) - 0.5) * 14,
      size: 14 + heartHash(i, 23) * 12,
    });
  }
  const crowns = SMITH_HEART_FIELD.props
    .filter((p) => p.kind === 'sh_lightning_rod')
    .map((p) => ({ x: p.x, y: C.h + BREATH_ROD_CROWN, z: p.z }));
  return { volumes, clouds, crowns };
}
