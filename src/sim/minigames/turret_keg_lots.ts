// Fire and Fly keg lots: every keg of a wave is laid at its start, never mid-combat, lot by
// lot. The field lots first (a random ring, on the lanes or spread evenly, and the tower
// crown, where a slam's thrown bodies come down), then the wave's rallies open clear of
// them (turret_rally.ts), then the path lots, each on the route of a group whose side is
// drawn at the wave's start: a pack's by its rally (turret_rally_kegs.ts), any other's on
// its side's axis inside the keg ring. No path keg stands where its blast reaches a pack
// gathering at its rally. A spot is one keg or a tight cluster, and a spaced lot keeps each
// out of chain reach of every keg standing (turret_keg_clusters.ts). Pure: private
// stateless draws only.

import {
  TURRET_BARREL_RING,
  TURRET_EXPLOSIVE_BARREL,
  TURRET_KEG_CROWN,
  TURRET_RALLY,
} from '../content/turret_defense';
import type { ThrowProbe } from './thrown_body';
import { layTurretKegs, placeTurretBarrels, type TurretBarrel } from './turret_barrels';
import type { TurretDefenseState } from './turret_defense';
import { TURRET_STREAM, turretDraw } from './turret_defense_rng';
import type { TurretWavePlan } from './turret_group_plan';
import { type TurretKegLay, turretKegLay } from './turret_keg_clusters';
import { turretRallyId } from './turret_rally';
import { placeTurretRallyKeg, type TurretPathKeg, turretClearOfRallies } from './turret_rally_kegs';
import { turretGroupLanes, turretWaveLanes } from './turret_wave_groups';

/** A lot's draw keys start at its index times this, past the most keys a lot can use. */
export const LOT_KEYS = 1024;

/** The wave's kegs standing at once, its own included. */
function capOf(wave: TurretWavePlan): number {
  return wave.kegCap ?? TURRET_EXPLOSIVE_BARREL.cap;
}

/** Lays the wave's random and crown lots, in lot order. Returns the kegs placed. */
export function placeTurretFieldKegs(
  state: TurretDefenseState,
  wave: TurretWavePlan,
  tick: number,
  probe: ThrowProbe,
): TurretBarrel[] {
  const placed: TurretBarrel[] = [];
  const cap = capOf(wave);
  wave.kegs.forEach((lot, li) => {
    const keyBase = li * LOT_KEYS;
    const lay = (i: number) => turretKegLay(lot, i);
    if (lot.mode === 'random') {
      const lanes = lot.lanes ? turretWaveLanes(state, state.wave, wave) : null;
      placed.push(...placeTurretBarrels(state, lot, tick, probe, { lanes, keyBase, cap, lay }));
    } else if (lot.mode === 'crown') {
      const ring = { count: lot.count, ...TURRET_KEG_CROWN[lot.size] };
      placed.push(...placeTurretBarrels(state, ring, tick, probe, { keyBase, cap, lay }));
    }
  });
  return placed;
}

/** A path keg on a route other than a pack's: front or side, its distance band from the tower. */
export type TurretRouteKeg = Readonly<TurretPathKeg> & {
  readonly minRadius?: number;
  readonly maxRadius?: number;
};

/**
 * A path keg's spot on a route along `bearing` (x += sin, z += cos) for one draw pair
 * (`side` and `depth`, each in [0, 1)): the side of the axis it stands on and how far off it
 * (both from `side`), and, front or side, how deep in its band (absent: the keg ring's).
 */
export function turretRouteKegSpot(
  keg: TurretRouteKeg,
  bearing: number,
  cx: number,
  cz: number,
  side: number,
  depth: number,
): { x: number; z: number } {
  const ux = Math.sin(bearing);
  const uz = Math.cos(bearing);
  const sign = side < 0.5 ? -1 : 1;
  const across = side < 0.5 ? side * 2 : side * 2 - 1;
  const at = (lo: number, hi: number) => lo + across * (hi - lo);
  const off =
    keg.placement === 'side'
      ? at(TURRET_RALLY.sideOffsetMin, TURRET_RALLY.sideOffsetMax)
      : at(TURRET_RALLY.axisOffsetMin, TURRET_RALLY.axisOffsetMax);
  const min = keg.minRadius ?? TURRET_BARREL_RING.minRadius;
  const max = keg.maxRadius ?? TURRET_BARREL_RING.maxRadius;
  const fromTower = keg.placement === 'axis' ? keg.fromTower : min + depth * (max - min);
  return {
    x: cx + ux * fromTower + uz * off * sign,
    z: cz + uz * fromTower - ux * off * sign,
  };
}

function placeRouteKeg(
  state: TurretDefenseState,
  keg: TurretRouteKeg,
  bearing: number,
  keyBase: number,
  lay: TurretKegLay,
  tick: number,
  probe: ThrowProbe,
): TurretBarrel[] {
  const clear = (x: number, z: number) => turretClearOfRallies(state, x, z);
  for (let attempt = 0; attempt < TURRET_EXPLOSIVE_BARREL.placementTries; attempt++) {
    const key = keyBase + 2 * attempt;
    const spot = turretRouteKegSpot(
      keg,
      bearing,
      state.cx,
      state.cz,
      turretDraw(state, TURRET_STREAM.kegRoute, state.wave, key),
      turretDraw(state, TURRET_STREAM.kegRoute, state.wave, key + 1),
    );
    const site = { stream: TURRET_STREAM.kegCluster, index: state.wave, key };
    const stood = layTurretKegs(state, spot.x, spot.z, lay, site, tick, probe, clear);
    if (stood) return stood;
  }
  return [];
}

/**
 * Lays the wave's path lots, in lot order, once its rallies are open: a group's `k`-th path
 * keg takes, on a walking group, its `k`-th side in turn. Returns the kegs placed.
 */
export function placeTurretPathKegs(
  state: TurretDefenseState,
  wave: TurretWavePlan,
  tick: number,
  probe: ThrowProbe,
): TurretBarrel[] {
  const placed: TurretBarrel[] = [];
  const cap = capOf(wave);
  const taken = new Map<number, number>();
  wave.kegs.forEach((lot, li) => {
    if (lot.mode !== 'path') return;
    const k = taken.get(lot.group) ?? 0;
    taken.set(lot.group, k + 1);
    const lay = turretKegLay(lot, 0);
    if (state.barrels.length + lay.kegs > cap) return;
    const group = wave.groups[lot.group];
    if (group.brick === 'pack') {
      const id = turretRallyId(state.wave, group.pack);
      const rally = state.rallies?.find((r) => r.id === id);
      if (rally) placed.push(...placeTurretRallyKeg(state, rally, lot, k, tick, probe, lay));
    } else {
      const lanes = turretGroupLanes(state, state.wave, wave, lot.group);
      const lane = lanes[k % Math.max(1, lanes.length)];
      if (lane) {
        const bearing = lane.from + lane.width / 2;
        placed.push(...placeRouteKeg(state, lot, bearing, li * LOT_KEYS, lay, tick, probe));
      }
    }
  });
  return placed;
}
