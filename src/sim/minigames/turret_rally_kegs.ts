// Fire and Fly placed kegs: a hunt wave lays its kegs relative to its own rallies instead of
// around the ring (turret_barrels.ts keeps the ring and the lanes for every other wave). A
// front keg stands on the advance axis a few yards tower-side of the rally, just off the
// axis, so the advancing pack brushes past it; a side keg stands beside the rally at the
// gathering pack's rim; an axis keg stands on the advance axis at a set distance from the
// tower. Each spot follows the barrels' own rules (dry, spaced, clear of bodies) and the
// keg cap; a keg that finds no clear spot in its draws is left out. Pure: private
// stateless draws only.

import { TURRET_EXPLOSIVE_BARREL, TURRET_RALLY } from '../content/turret_defense';
import type { TurretRallyKegDef } from '../types';
import { groundOr, type ThrowProbe } from './thrown_body';
import { type TurretBarrel, turretBarrelSpotClear } from './turret_barrels';
import type { TurretDefenseState } from './turret_defense';
import type { TurretWavePlan } from './turret_defense_plan';
import { TURRET_STREAM, type TurretDrawSource, turretDraw } from './turret_defense_rng';
import { type TurretRally, turretRallyPack } from './turret_rally';

/**
 * A rally keg's spot for one draw pair (`side` and `depth`, each in [0, 1)): the side of the
 * axis it stands on, and how deep in the front band.
 */
export function turretRallyKegSpot(
  keg: Readonly<TurretRallyKegDef>,
  rally: { readonly x: number; readonly z: number },
  cx: number,
  cz: number,
  side: number,
  depth: number,
): { x: number; z: number } {
  const dx = cx - rally.x;
  const dz = cz - rally.z;
  const d = Math.hypot(dx, dz);
  const ux = d > 1e-9 ? dx / d : 0;
  const uz = d > 1e-9 ? dz / d : 1;
  const sign = side < 0.5 ? -1 : 1;
  const vx = -uz * sign;
  const vz = ux * sign;
  switch (keg.placement) {
    case 'rally-front': {
      const along = TURRET_RALLY.frontMin + depth * (TURRET_RALLY.frontMax - TURRET_RALLY.frontMin);
      const off = TURRET_RALLY.axisOffset;
      return { x: rally.x + ux * along + vx * off, z: rally.z + uz * along + vz * off };
    }
    case 'rally-side':
      return {
        x: rally.x + vx * TURRET_RALLY.sideOffset,
        z: rally.z + vz * TURRET_RALLY.sideOffset,
      };
    case 'axis': {
      const off = TURRET_RALLY.axisOffset;
      return { x: cx - ux * keg.fromTower + vx * off, z: cz - uz * keg.fromTower + vz * off };
    }
  }
}

function draw(run: TurretDrawSource, rally: number, key: number): number {
  return turretDraw(run, TURRET_STREAM.rallyKeg, rally, key);
}

/**
 * Lays the kegs of the rallies just opened (`rallies`, in pack order, then each pack's kegs
 * in order) while the standing kegs stay under the wave's cap. Returns the ones placed.
 */
export function placeTurretRallyKegs(
  state: TurretDefenseState,
  wave: TurretWavePlan,
  rallies: readonly TurretRally[],
  tick: number,
  probe: ThrowProbe,
): TurretBarrel[] {
  const placed: TurretBarrel[] = [];
  const hunt = wave.hunt;
  if (!hunt) return placed;
  const cap = wave.barrels.cap ?? TURRET_EXPLOSIVE_BARREL.cap;
  const tries = TURRET_EXPLOSIVE_BARREL.placementTries;
  for (const rally of rallies) {
    const kegs = hunt.packs[turretRallyPack(rally.id)]?.kegs ?? [];
    kegs.forEach((keg, k) => {
      if (state.barrels.length >= cap) return;
      for (let attempt = 0; attempt < tries; attempt++) {
        const key = 2 * (k * tries + attempt);
        const spot = turretRallyKegSpot(
          keg,
          rally,
          state.cx,
          state.cz,
          draw(state, rally.id, key),
          draw(state, rally.id, key + 1),
        );
        if (!turretBarrelSpotClear(state, spot.x, spot.z, tick, probe)) continue;
        const barrel: TurretBarrel = {
          id: state.nextBarrelId++,
          x: spot.x,
          y: groundOr(probe, spot.x, spot.z, 0),
          z: spot.z,
          litTick: -1,
          blowTick: -1,
        };
        state.barrels.push(barrel);
        placed.push(barrel);
        return;
      }
    });
  }
  return placed;
}
