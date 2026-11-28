// Pure plan of the Quench vein's air and weather (phase 2H; quench_air.ts
// paints it): snow drifting down over every Quench walk, frost motes (the
// cold's diamond dust) glinting in the basin and on the landings, steam
// rising off the shelf's vents and out of the rock, a cold pale mist lying in
// the void under the walks and past the shelf's rim, the braziers' fire (the
// one warm thing: a tall flame, embers, a halo seen from anywhere on the
// lake, a warm pool on the snow round each bowl), and the Singing Ice's set
// piece look: a crack creaking out across the sheet every few seconds and
// bursting into frost at its end.
//
// Every motion runs in the shaders on the shared clock; the creak schedule
// below is the same arithmetic the shaders run (pinned by
// tests/smith_heart_quench_air.test.ts). Cosmetic: nothing here is a
// telegraph (the creaks wear the vein's pale ice light, never a threat
// colour, and lie under every telegraph), nothing lies over a walked floor
// thicker than a flake, the mist stays under the walks and past the rims,
// and the low tier builds a third of the particles (the braziers' fire and
// the creaks stay). Three-free, DOM-free, deterministic (a hash, never rng).

import { LAKE_BRAZIERS, QUENCH, SMITH_HEART_FIELD } from '../../sim/content/smith_heart_layout';
import { authoredFieldSurfaceAt } from '../../sim/instances/authored_field';
import { heartHash, heartPropBase } from './heart_plan_core';
import { QUENCH_BRAZIER_FIRE } from './quench_kit_plan_core';

/** The snow's drift (x z, yards a second) and its fall (yards a second). */
export const QUENCH_SNOW = { drift: [0.35, -0.2] as const, fall: 0.9 } as const;

/** The Singing Ice's creaks: one crack every CELL seconds, round the sheet's
 *  cracks in a fixed stride (coprime with their count), growing for GROW
 *  seconds, holding HOLD, fading over FADE; its frost bursts at its end as
 *  it finishes growing. */
export const QUENCH_CREAK = {
  cell: 5.5,
  grow: 1.6,
  hold: 2.0,
  fade: 1.6,
  stride: 3,
  cracks: 7,
} as const;

/** A box of air the snow and the motes fill. */
export interface SnowVolume {
  x: number;
  z: number;
  hw: number;
  hd: number;
  y0: number;
  y1: number;
  flakes: number;
  motes: number;
}

/** A soft mist card (lying low, big, slow). */
export interface MistCard {
  x: number;
  y: number;
  z: number;
  size: number;
}

/** A plume of steam rising (a vent on the shelf, a crack in the rock). */
export interface SteamPlume {
  x: number;
  y: number;
  z: number;
  /** How high it rises before it thins away (yards). */
  rise: number;
}

/** One crack the Singing Ice creaks along (instance-local points, in order
 *  from where it starts). */
export interface SingingCrack {
  pts: { x: number; z: number }[];
}

export interface QuenchAirPlan {
  volumes: SnowVolume[];
  mists: MistCard[];
  steam: SteamPlume[];
  /** The braziers' fire beds (where the flame stands). */
  fires: { x: number; y: number; z: number }[];
  cracks: SingingCrack[];
}

/** The creak `t` seconds into the clock: the crack it runs (index into the
 *  plan's cracks) and how long since it began (seconds; past GROW + HOLD +
 *  FADE: gone). */
export function quenchCreakAt(t: number, cracks: number): { crack: number; since: number } {
  const k = Math.floor(t / QUENCH_CREAK.cell);
  const crack = cracks > 0 ? (((k * QUENCH_CREAK.stride + 1) % cracks) + cracks) % cracks : 0;
  return { crack, since: t - k * QUENCH_CREAK.cell };
}

/** A creak's state `since` seconds after it began: how far along its crack
 *  it has run (0..1), how bright it burns, and its frost burst (0..1, at
 *  the crack's end as it finishes growing). */
export function quenchCreakLook(since: number): { grown: number; glow: number; burst: number } {
  const C = QUENCH_CREAK;
  if (since < 0 || since > C.grow + C.hold + C.fade) return { grown: 0, glow: 0, burst: 0 };
  const grown = Math.min(1, since / C.grow);
  const glow = since < C.grow + C.hold ? 1 : Math.max(0, 1 - (since - C.grow - C.hold) / C.fade);
  const b = since - C.grow;
  const burst = b < 0 ? 0 : Math.max(0, 1 - b / 0.9);
  return { grown, glow, burst };
}

/** The Singing Ice's cracks: wandering lines from hashed starts across the
 *  sheet, every point kept a yard inside it. */
export function planSingingCracks(count = QUENCH_CREAK.cracks): SingingCrack[] {
  const I = QUENCH.ice;
  const out: SingingCrack[] = [];
  const onSheet = (x: number, z: number) =>
    authoredFieldSurfaceAt(SMITH_HEART_FIELD, x, z)?.id === 'singing_ice';
  for (let k = 0; k < count; k++) {
    // A start on the sheet itself (never where a stair's foot meets it).
    let x = 0;
    let z = 0;
    // Spread over the sheet: each crack starts in its own cell of a three
    // by three grid (so a creak runs somewhere new each time).
    const cell = (k * 4) % 9;
    const cw = (I.x1 - I.x0 - 6) / 3;
    const cd = (I.z1 - I.z0 - 6) / 3;
    for (let t = 0; t < 12; t++) {
      x = I.x0 + 3 + ((cell % 3) + heartHash(k * 13 + t, 211)) * cw;
      z = I.z0 + 3 + (Math.floor(cell / 3) + heartHash(k * 13 + t, 213)) * cd;
      if (onSheet(x, z)) break;
    }
    let a = heartHash(k, 217) * Math.PI * 2;
    const pts = [{ x, z }];
    const steps = 16 + Math.floor(heartHash(k, 219) * 9);
    for (let i = 0; pts.length <= steps && i < steps * 4; i++) {
      a += (heartHash(k * 31 + i, 223) - 0.5) * 0.7;
      let nx = x + Math.sin(a) * 0.9;
      let nz = z + Math.cos(a) * 0.9;
      // Turn back off the sheet's edges (a yard in).
      if (nx < I.x0 + 1 || nx > I.x1 - 1) {
        a = -a;
        nx = Math.max(I.x0 + 1, Math.min(I.x1 - 1, nx));
      }
      if (nz < I.z0 + 1 || nz > I.z1 - 1) {
        a = Math.PI - a;
        nz = Math.max(I.z0 + 1, Math.min(I.z1 - 1, nz));
      }
      // Never off the sheet onto a floor that meets it (the stairs' feet).
      if (!onSheet(nx, nz)) {
        a += Math.PI * 0.75;
        continue;
      }
      x = nx;
      z = nz;
      pts.push({ x, z });
    }
    out.push({ pts });
  }
  return out;
}

/** The Quench's air. `density` thins the particles (1 full, the low tier a
 *  third); the mist thins too, never the fires or the creaks. */
export function planQuenchAir(density = 1): QuenchAirPlan {
  const n = (v: number) => Math.max(1, Math.round(v * density));
  const S = QUENCH.shelf;
  const volumes: SnowVolume[] = [
    // Over the basin: the lake and its shelf.
    { x: S.x, z: S.z, hw: S.rx, hd: S.rz, y0: S.h, y1: S.h + 16, flakes: n(170), motes: n(70) },
    // The Singing Ice.
    {
      x: (QUENCH.ice.x0 + QUENCH.ice.x1) / 2,
      z: (QUENCH.ice.z0 + QUENCH.ice.z1) / 2,
      hw: (QUENCH.ice.x1 - QUENCH.ice.x0) / 2 + 6,
      hd: (QUENCH.ice.z1 - QUENCH.ice.z0) / 2 + 6,
      y0: QUENCH.ice.h,
      y1: QUENCH.ice.h + 13,
      flakes: n(70),
      motes: n(26),
    },
    // The landings and the stairs between them.
    ...[QUENCH.q1, QUENCH.q2].map((q) => ({
      x: q.x,
      z: q.z,
      hw: q.r + 6,
      hd: q.r + 6,
      y0: q.h,
      y1: q.h + 12,
      flakes: n(50),
      motes: n(16),
    })),
    { x: 118, z: -24, hw: 9, hd: 16, y0: -16, y1: -2, flakes: n(30), motes: n(6) },
    { x: 134, z: -66, hw: 10, hd: 12, y0: -24, y1: -10, flakes: n(26), motes: n(6) },
    { x: 182, z: -60, hw: 10, hd: 16, y0: -30, y1: -16, flakes: n(30), motes: n(6) },
  ];
  // The mist: cards lying in the void round the shelf, under the descent
  // and under the landings, every one under the walk above it.
  const mists: MistCard[] = [];
  const ring = n(20);
  for (let i = 0; i < ring; i++) {
    const a = (i / ring) * Math.PI * 2 + heartHash(i, 31) * 0.3;
    const out = 6 + heartHash(i, 33) * 18;
    mists.push({
      x: S.x + Math.sin(a) * (S.rx + out),
      y: S.h - 5 - heartHash(i, 35) * 16,
      z: S.z + Math.cos(a) * (S.rz + out),
      size: 16 + heartHash(i, 37) * 14,
    });
  }
  const under: [number, number, number][] = [
    [110, 0, -8],
    [122, -48, -16],
    [118, -24, -12],
    [134, -66, -20],
    [159, -86, -24],
    [182, -60, -27],
  ];
  for (const [i, [x, z, h]] of under.entries()) {
    for (let j = 0; j < n(3); j++) {
      mists.push({
        x: x + (heartHash(i * 7 + j, 41) - 0.5) * 22,
        y: h - 8 - heartHash(i * 7 + j, 43) * 14,
        z: z + (heartHash(i * 7 + j, 45) - 0.5) * 22,
        size: 14 + heartHash(i * 7 + j, 47) * 10,
      });
    }
  }
  // The steam: off each vent on the shelf, and out of a few cracks low in
  // the basin's walls past its rim.
  const steam: SteamPlume[] = SMITH_HEART_FIELD.props
    .filter((p) => p.kind === 'sh_steam_vent')
    .map((p) => ({ x: p.x, y: heartPropBase(p.x, p.z), z: p.z, rise: 11 }));
  for (const deg of [25, 160, 250]) {
    const a = (deg * Math.PI) / 180;
    steam.push({
      x: S.x + Math.sin(a) * (S.rx + 7),
      y: S.h - 4,
      z: S.z + Math.cos(a) * (S.rz + 7),
      rise: 18,
    });
  }
  const fires = LAKE_BRAZIERS.map((p) => ({
    x: p.x,
    y: heartPropBase(p.x, p.z) + QUENCH_BRAZIER_FIRE,
    z: p.z,
  }));
  return { volumes, mists, steam, fires, cracks: planSingingCracks() };
}
