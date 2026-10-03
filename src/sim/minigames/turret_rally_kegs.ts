// Fire and Fly placed kegs: a hunt wave lays its kegs relative to its own rallies instead of
// around the ring (turret_barrels.ts keeps the ring and the lanes for every other wave). A
// front keg stands on the advance path a dozen yards or more tower-side of the rally, a few
// yards off the axis, so the advancing column brushes past it; a side keg stands on the
// same stretch at the column's rim; an axis keg stands just off the advance axis at a set
// distance from the tower. None stands where its blast reaches a member standing at the
// rally, nor nearer the tower than the keg ring's inner edge. Each spot follows the
// barrels' own rules (dry, spaced, clear of bodies) and the keg cap; a keg that finds no
// clear spot in its draws is left out. Pure: private stateless draws only.

import { TURRET_EXPLOSIVE_BARREL, TURRET_RALLY } from '../content/turret_defense';
import type { TurretRallyKegDef } from '../types';
import { groundOr, type ThrowProbe } from './thrown_body';
import { type TurretBarrel, turretBarrelSpotClear } from './turret_barrels';
import type { TurretDefenseState } from './turret_defense';
import type { TurretWavePlan } from './turret_defense_plan';
import { TURRET_STREAM, type TurretDrawSource, turretDraw } from './turret_defense_rng';
import { TURRET_HUNT_LIMITS } from './turret_hunt_plan';
import {
  type TurretRally,
  turretPackSize,
  turretRallyPack,
  turretRallyReach,
} from './turret_rally';

/**
 * The stretch of the advance path a front or side keg may take, as yards tower-side of the
 * rally: from where its blast, `offset` off the axis, stops short of a gathering disc of
 * `reach`, to where it would stand nearer the tower than TURRET_RALLY.towerMin. The first
 * rule wins when a rally stands too near the tower for both.
 */
export function turretRallyKegBand(
  reach: number,
  offset: number,
  fromTower: number,
): { min: number; max: number } {
  const clear = TURRET_EXPLOSIVE_BARREL.blastRadius + reach;
  const min = Math.max(
    TURRET_RALLY.frontMin,
    Math.sqrt(Math.max(0, clear * clear - offset * offset)),
  );
  const tower = TURRET_RALLY.towerMin;
  const inner = fromTower - Math.sqrt(Math.max(0, tower * tower - offset * offset));
  return { min, max: Math.max(min, Math.min(TURRET_RALLY.frontMax, inner)) };
}

/**
 * A rally keg's spot for one draw pair (`side` and `depth`, each in [0, 1)): the side of the
 * axis it stands on and how far off it (both from `side`), and how deep in its band.
 * `reach` is the rally's gathering disc (turretRallyReach).
 */
export function turretRallyKegSpot(
  keg: Readonly<TurretRallyKegDef>,
  rally: { readonly x: number; readonly z: number },
  cx: number,
  cz: number,
  side: number,
  depth: number,
  reach: number,
): { x: number; z: number } {
  const dx = cx - rally.x;
  const dz = cz - rally.z;
  const d = Math.hypot(dx, dz);
  const ux = d > 1e-9 ? dx / d : 0;
  const uz = d > 1e-9 ? dz / d : 1;
  const sign = side < 0.5 ? -1 : 1;
  const vx = -uz * sign;
  const vz = ux * sign;
  const across = side < 0.5 ? side * 2 : side * 2 - 1;
  const at = (lo: number, hi: number) => lo + across * (hi - lo);
  switch (keg.placement) {
    case 'rally-front':
    case 'rally-side': {
      const off =
        keg.placement === 'rally-front'
          ? at(TURRET_RALLY.axisOffsetMin, TURRET_RALLY.axisOffsetMax)
          : at(TURRET_RALLY.sideOffsetMin, TURRET_RALLY.sideOffsetMax);
      const band = turretRallyKegBand(reach, off, d);
      const along = band.min + depth * (band.max - band.min);
      return { x: rally.x + ux * along + vx * off, z: rally.z + uz * along + vz * off };
    }
    case 'axis': {
      const off = at(TURRET_RALLY.axisOffsetMin, TURRET_RALLY.axisOffsetMax);
      return { x: cx - ux * keg.fromTower + vx * off, z: cz - uz * keg.fromTower + vz * off };
    }
  }
}

function draw(run: TurretDrawSource, rally: number, key: number): number {
  return turretDraw(run, TURRET_STREAM.rallyKeg, rally, key);
}

/** Members a rally gathers: its pack's spawns in its wave's plan. */
function rallySize(state: TurretDefenseState, rally: TurretRally): number {
  const hunt = state.plan.waves[Math.floor(rally.id / TURRET_HUNT_LIMITS.packs)]?.hunt;
  const pack = turretRallyPack(rally.id);
  return hunt ? turretPackSize(hunt, pack) : 0;
}

/** Out of a keg blast's reach of every gathering disc still open, an earlier wave's too. */
function clearOfRallies(state: TurretDefenseState, x: number, z: number): boolean {
  return (state.rallies ?? []).every(
    (r) =>
      Math.hypot(r.x - x, r.z - z) >=
      TURRET_EXPLOSIVE_BARREL.blastRadius + turretRallyReach(rallySize(state, r)),
  );
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
    const pack = turretRallyPack(rally.id);
    const kegs = hunt.packs[pack]?.kegs ?? [];
    const reach = turretRallyReach(turretPackSize(hunt, pack));
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
          reach,
        );
        if (!turretBarrelSpotClear(state, spot.x, spot.z, tick, probe)) continue;
        if (!clearOfRallies(state, spot.x, spot.z)) continue;
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
