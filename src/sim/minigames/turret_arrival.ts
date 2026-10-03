// Fire and Fly walkers (and the bricks built on them: the small group, the big one, the
// surge): which bearings of the spawn ring a group's monster comes through (the whole ring,
// one side, two or three flanks, or its bunch's side) and how long until the next one. The
// barrels' lane rule applies inside the sector (turret_barrels.ts turretSpawnBearing). Pure:
// private stateless draws only, no clock.

import type { TurretBearingSector } from './turret_barrels';
import { TURRET_STREAM, type TurretDrawSource, turretDraw } from './turret_defense_rng';
import { TURRET_GROUP_LIMITS, type TurretArrivalPlan } from './turret_group_plan';

const TAU = Math.PI * 2;

/** A side of the ring: key 0 is the group's own, its bunch `b`'s is key `b + 1`. */
function side(run: TurretDrawSource, wave: number, group: number, key: number): number {
  const base = group * TURRET_GROUP_LIMITS.sideKeys;
  return turretDraw(run, TURRET_STREAM.arrivalSide, wave, base + key) * TAU;
}

function turretSectorAround(center: number, widthTurn: number): TurretBearingSector {
  const width = widthTurn * TAU;
  return { from: center - width / 2, width };
}

/** The bearings group `group`'s `index`-th spawn arrives through; null for the whole ring. */
export function turretArrivalSector(
  run: TurretDrawSource,
  wave: number,
  arrival: Readonly<TurretArrivalPlan>,
  index: number,
  group = 0,
): TurretBearingSector | null {
  switch (arrival.kind) {
    case 'ring':
      return null;
    case 'arc':
      return turretSectorAround(side(run, wave, group, 0), arrival.widthTurn);
    case 'flanks':
      return turretSectorAround(
        side(run, wave, group, 0) + ((index % arrival.count) / arrival.count) * TAU,
        arrival.widthTurn,
      );
    case 'bunches':
      return turretSectorAround(
        side(run, wave, group, 1 + Math.floor(index / arrival.size)),
        arrival.widthTurn,
      );
  }
}

/**
 * Every side a walking group of `count` monsters arrives through, in spawn order: the arc,
 * each flank, each bunch's side. Empty for the whole ring.
 */
export function turretArrivalLanes(
  run: TurretDrawSource,
  wave: number,
  arrival: Readonly<TurretArrivalPlan>,
  count: number,
  group: number,
): TurretBearingSector[] {
  const lanes =
    arrival.kind === 'flanks'
      ? arrival.count
      : arrival.kind === 'bunches'
        ? Math.max(1, Math.ceil(count / arrival.size))
        : 1;
  const step = arrival.kind === 'bunches' ? arrival.size : 1;
  const sectors: TurretBearingSector[] = [];
  for (let lane = 0; lane < lanes; lane++) {
    const sector = turretArrivalSector(run, wave, arrival, lane * step, group);
    if (!sector) return [];
    sectors.push(sector);
  }
  return sectors;
}

/** Ticks from a walking group's `index`-th spawn (monster `id`) to its next one. */
export function turretArrivalGap(
  run: TurretDrawSource,
  group: {
    readonly sides: Readonly<TurretArrivalPlan>;
    readonly gapMinTicks: number;
    readonly gapMaxTicks: number;
  },
  index: number,
  id: number,
): number {
  const arrival = group.sides;
  if (arrival.kind === 'bunches' && (index + 1) % arrival.size === 0) return arrival.bunchGapTicks;
  return turretBandGap(run, group, id);
}

/** A gap drawn in the band for monster `id` (ticks). */
export function turretBandGap(
  run: TurretDrawSource,
  band: { readonly gapMinTicks: number; readonly gapMaxTicks: number },
  id: number,
): number {
  const span = band.gapMaxTicks - band.gapMinTicks + 1;
  return band.gapMinTicks + Math.floor(turretDraw(run, TURRET_STREAM.spawnGap, id) * span);
}
