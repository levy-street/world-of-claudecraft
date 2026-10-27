// Pure plan of the Heat vein's air and weather (phase 2I; heat_air.ts paints
// it): embers rising over every Heat walk and out of the chasm, thick in the
// Hearth's throat; the first flame burning tall among its crystal; smoke
// climbing out of the chasm and the Hearth's crown and drifting east up to
// the open sky; the fire deep in the chasm glowing under the walks; a halo
// round every cluster of the first flame's crystal; and the heat's haze
// shimmering over the Hearth's mouth, the wellspring and the bridge's chasm.
//
// Every motion runs in the shaders on the shared clock. Cosmetic: nothing
// here is a telegraph (the vein's own white-gold, never a threat colour),
// nothing over a walked floor thicker than an ember, the smoke and the
// chasm's glow stay under the walks and past the lips, and the low tier
// builds a third of the particles and no haze (the flames, the halos and the
// chasm's glow stay: the Hearth's light is how the vein is found). The pour
// (the set piece) is heat_pour_core.ts's. Three-free, DOM-free,
// deterministic (a hash, never rng).

import { GREAT_HEARTH, SMITH_HEART_FIELD } from '../../sim/content/smith_heart_layout';
import { authoredFieldSurfaceAt } from '../../sim/instances/authored_field';
import { HEAT_BRIDGE_CHASM, heartHash, heartPropBase } from './heart_plan_core';
import { HEAT_WALK_SURFACES, HEAT_WELL_FIRE } from './heat_kit_plan_core';
import { lipChains } from './lip_walls_core';

/** The embers' rise (yards a second) and their drift east, out of the
 *  fissure toward the Ring (x z, yards a second). */
export const HEAT_EMBERS = { rise: 1.7, drift: [0.45, 0.06] as const } as const;

/** A box of air the embers fill. */
export interface EmberVolume {
  x: number;
  z: number;
  hw: number;
  hd: number;
  y0: number;
  y1: number;
  embers: number;
}

/** A soft card of light or smoke (instance-local, its size in yards). */
export interface HeatCard {
  x: number;
  y: number;
  z: number;
  size: number;
}

/** A plume of smoke rising (from the chasm, from the Hearth's crown). */
export interface SmokePlume {
  x: number;
  y: number;
  z: number;
  rise: number;
  size: number;
}

/** A tongue of the first flame. */
export interface HearthFlame {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
}

export interface HeatAirPlan {
  volumes: EmberVolume[];
  /** The fire deep in the chasm (cards lying far under the walks). */
  glows: HeatCard[];
  smoke: SmokePlume[];
  flames: HearthFlame[];
  /** Halos round the crystal (the beacons the vein is found by). */
  halos: HeatCard[];
  /** The heat's shimmer (cards standing over the hottest places). */
  haze: HeatCard[];
}

/** The Hearth's throat point at the kit's frame (Blender x across, y into
 *  the mountain, z up: heat_pieces.py MOUTH) in instance-local yards (the
 *  mouth turned so its front faces east, +x). */
export function hearthThroatPoint(
  bx: number,
  by: number,
  bz: number,
): { x: number; y: number; z: number } {
  return { x: GREAT_HEARTH.x - by, y: bz, z: GREAT_HEARTH.z - bx };
}

/** The throat's floor at depth `by` (the kit's: -0.6 at the mouth, rising
 *  toward the back). */
export function hearthThroatFloor(by: number): number {
  const t = Math.max(0, (by + 4.6) / 30.6);
  return -0.6 + 1.6 * t * t;
}

/** The Heat's air. `density` thins the particles (1 full, the low tier a
 *  third); the haze is drawn only at full density. */
export function planHeatAir(density = 1): HeatAirPlan {
  const n = (v: number) => Math.max(1, Math.round(v * density));
  const volumes: EmberVolume[] = [
    // The Forge, the casting floor and the hall.
    { x: -214, z: 0, hw: 38, hd: 42, y0: 0, y1: 20, embers: n(150) },
    { x: -144, z: 0, hw: 18, hd: 34, y0: 0, y1: 15, embers: n(70) },
    { x: -100, z: 0, hw: 22, hd: 12, y0: 0, y1: 12, embers: n(40) },
    // Out of the chasm under the anvil bridge.
    {
      x: HEAT_BRIDGE_CHASM.x,
      z: HEAT_BRIDGE_CHASM.z,
      hw: 4,
      hd: 18,
      y0: -26,
      y1: 6,
      embers: n(60),
    },
    // The Hearth's throat, thick.
    { x: GREAT_HEARTH.x - 9, z: GREAT_HEARTH.z, hw: 7, hd: 12, y0: 0, y1: 30, embers: n(90) },
  ];
  // The fire deep in the chasm and the smoke climbing out of it, along every
  // Heat lip over the void (past the lip, far under the walk).
  const glows: HeatCard[] = [];
  const smoke: SmokePlume[] = [];
  let k = 0;
  for (const chain of lipChains(HEAT_WALK_SURFACES)) {
    let walked = 0;
    for (let i = 1; i < chain.length; i++) {
      const a = chain[i - 1];
      const b = chain[i];
      const seg = Math.hypot(b.x - a.x, b.z - a.z);
      walked += seg;
      if (walked < 15) continue;
      walked = 0;
      k++;
      const out = 7 + heartHash(k, 301) * 9;
      const x = b.x + b.nx * out;
      const z = b.z + b.nz * out;
      if (authoredFieldSurfaceAt(SMITH_HEART_FIELD, x, z)) continue;
      glows.push({ x, y: -24 - heartHash(k, 303) * 10, z, size: 18 + heartHash(k, 305) * 12 });
      if (k % 2 === 0)
        smoke.push({
          x: b.x + b.nx * (out * 0.7),
          y: -12,
          z: b.z + b.nz * (out * 0.7),
          rise: 46 + heartHash(k, 307) * 14,
          size: 7 + heartHash(k, 309) * 4,
        });
    }
  }
  // Under the bridge, the fire's river runs on deep in the chasm.
  for (const dz of [-14, -5, 5, 14])
    glows.push({ x: HEAT_BRIDGE_CHASM.x, y: -30, z: HEAT_BRIDGE_CHASM.z + dz, size: 22 });
  // The Hearth's crown smoking.
  for (const dz of [-8, 0, 8]) {
    const p = hearthThroatPoint(dz, 10, 0);
    smoke.push({ x: p.x, y: 34, z: p.z, rise: 44, size: 11 });
  }
  // The first flame in the throat: tall tongues among its crystal, the
  // tallest at the heart.
  const flames: HearthFlame[] = [];
  for (const [bx, by, w, h] of [
    [-1.5, 13, 3.4, 12],
    [3.5, 11, 2.8, 9],
    [-6.0, 10, 2.6, 8],
    [6.5, 14, 2.4, 9.5],
    [0.5, 7, 2.2, 6.5],
    [-9.5, 6, 1.8, 5],
    [10.0, 5, 1.8, 5],
  ] as const) {
    const p = hearthThroatPoint(bx, by, hearthThroatFloor(by));
    flames.push({ x: p.x, y: p.y, z: p.z, w, h });
  }
  // The halos: every crystal cluster, the wellspring, the altar-stone's
  // crown, and the Hearth's heart (the vein's beacon from the bridge).
  const halos: HeatCard[] = [];
  for (const p of SMITH_HEART_FIELD.props) {
    const y = heartPropBase(p.x, p.z);
    if (p.kind === 'sh_crucible') halos.push({ x: p.x, y: y + 3.4, z: p.z, size: 7 });
    else if (p.kind === 'sh_pour_crucible')
      halos.push({ x: p.x, y: y + HEAT_WELL_FIRE + 1.4, z: p.z, size: 6.5 });
    else if (p.kind === 'sh_giant_anvil') {
      // Its crown at the north end (local +z).
      halos.push({
        x: p.x + Math.sin(p.rot) * 6.8,
        y: y + 7.6,
        z: p.z + Math.cos(p.rot) * 6.8,
        size: 6,
      });
    }
  }
  const heart = hearthThroatPoint(-0.5, 22, 9);
  halos.push({ x: heart.x, y: heart.y, z: heart.z, size: 20 });
  const mouth = hearthThroatPoint(0, 4, 10);
  halos.push({ x: mouth.x, y: mouth.y, z: mouth.z, size: 14 });
  // The haze: over the Hearth's mouth, the wellspring and the bridge's chasm.
  const haze: HeatCard[] =
    density < 0.99
      ? []
      : [
          { ...hearthThroatPoint(0, -3, 10), size: 26 },
          {
            x: SMITH_HEART_FIELD.props.find((p) => p.kind === 'sh_pour_crucible')?.x ?? -150,
            y: HEAT_WELL_FIRE + 2.6,
            z: SMITH_HEART_FIELD.props.find((p) => p.kind === 'sh_pour_crucible')?.z ?? 31,
            size: 5,
          },
          { x: HEAT_BRIDGE_CHASM.x, y: -2, z: HEAT_BRIDGE_CHASM.z, size: 11 },
        ];
  return { volumes, glows, smoke, flames, halos, haze };
}
