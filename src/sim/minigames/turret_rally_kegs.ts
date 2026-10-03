// Fire and Fly path kegs on a pack's route (turret_keg_lots.ts dispatches a wave's lots): a
// pack's kegs stand relative to its rally instead of around the ring. A front keg stands on the advance path a dozen yards or more tower-side of the rally, a few
// yards off the axis, so the advancing column brushes past it; a side keg stands on the
// same stretch at the column's rim; an axis keg stands just off the advance axis at a set
// distance from the tower. None stands where its blast reaches a member standing at the
// rally, nor nearer the tower than the keg ring's inner edge. Each spot follows the
// barrels' own rules (dry, spaced, clear of bodies) and the keg cap; a keg that finds no
// clear spot in its draws is left out. Pure: private stateless draws only.

import { TURRET_EXPLOSIVE_BARREL, TURRET_RALLY } from '../content/turret_defense';
import type { ThrowProbe } from './thrown_body';
import { standTurretBarrel, type TurretBarrel, turretBarrelSpotClear } from './turret_barrels';
import type { TurretDefenseState } from './turret_defense';
import { TURRET_STREAM, type TurretDrawSource, turretDraw } from './turret_defense_rng';
import { TURRET_HUNT_LIMITS } from './turret_hunt_plan';
import {
  type TurretRally,
  turretPackSize,
  turretRallyPack,
  turretRallyReach,
} from './turret_rally';

/** Where a path keg stands on its group's route. */
export type TurretPathKeg =
  | { placement: 'front' | 'side' }
  | { placement: 'axis'; fromTower: number };

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
  keg: Readonly<TurretPathKeg>,
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
    case 'front':
    case 'side': {
      const off =
        keg.placement === 'front'
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
  const wave = state.plan.waves[Math.floor(rally.id / TURRET_HUNT_LIMITS.packs)];
  return wave ? turretPackSize(wave, turretRallyPack(rally.id)) : 0;
}

/** Out of a keg blast's reach of every gathering disc still open, an earlier wave's too. */
export function turretClearOfRallies(state: TurretDefenseState, x: number, z: number): boolean {
  return (state.rallies ?? []).every(
    (r) =>
      Math.hypot(r.x - x, r.z - z) >=
      TURRET_EXPLOSIVE_BARREL.blastRadius + turretRallyReach(rallySize(state, r)),
  );
}

/**
 * Lays one keg of a pack on its route by its rally, the pack's `k`-th path keg: the first of
 * its draws on a clear spot, none when every draw is covered. Returns it once placed.
 */
export function placeTurretRallyKeg(
  state: TurretDefenseState,
  rally: TurretRally,
  keg: Readonly<TurretPathKeg>,
  k: number,
  tick: number,
  probe: ThrowProbe,
): TurretBarrel | null {
  const tries = TURRET_EXPLOSIVE_BARREL.placementTries;
  const reach = turretRallyReach(rallySize(state, rally));
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
    if (!turretClearOfRallies(state, spot.x, spot.z)) continue;
    return standTurretBarrel(state, spot.x, spot.z, probe);
  }
  return null;
}
