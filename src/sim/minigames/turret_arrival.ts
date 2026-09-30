// Fire and Fly arrival patterns: which bearings of the spawn ring a wave's monster
// comes through (the whole ring, one side, two or three flanks, or its pack's
// side) and how long until the next one. The barrels' lane rule applies inside
// the sector (turret_barrels.ts turretSpawnBearing). Pure: private stateless
// draws only, no clock.

import type { TurretArrivalDef } from '../types';
import type { TurretBearingSector } from './turret_barrels';
import type { TurretWavePlan } from './turret_defense_plan';
import { TURRET_STREAM, type TurretDrawSource, turretDraw } from './turret_defense_rng';

const TAU = Math.PI * 2;

/** A side of the ring: key 0 is the wave's own, a burst's pack `p` is key `p + 1`. */
function side(run: TurretDrawSource, wave: number, key: number): number {
  return turretDraw(run, TURRET_STREAM.arrivalSide, wave, key) * TAU;
}

function around(center: number, widthTurn: number): TurretBearingSector {
  const width = widthTurn * TAU;
  return { from: center - width / 2, width };
}

/** The bearings the wave's `index`-th spawn arrives through; null for the whole ring. */
export function turretArrivalSector(
  run: TurretDrawSource,
  wave: number,
  arrival: Readonly<TurretArrivalDef>,
  index: number,
): TurretBearingSector | null {
  switch (arrival.kind) {
    case 'ring':
      return null;
    case 'arc':
      return around(side(run, wave, 0), arrival.widthTurn);
    case 'flanks':
      return around(
        side(run, wave, 0) + ((index % arrival.count) / arrival.count) * TAU,
        arrival.widthTurn,
      );
    case 'burst':
      return around(side(run, wave, 1 + Math.floor(index / arrival.groupSize)), arrival.widthTurn);
  }
}

/** Ticks from the wave's `index`-th spawn (monster `id`) to its next one. */
export function turretArrivalGap(
  run: TurretDrawSource,
  wave: TurretWavePlan,
  index: number,
  id: number,
): number {
  const arrival = wave.arrival;
  if (arrival.kind === 'burst' && (index + 1) % arrival.groupSize === 0) {
    return arrival.groupGapTicks;
  }
  const span = wave.gapMaxTicks - wave.gapMinTicks + 1;
  return wave.gapMinTicks + Math.floor(turretDraw(run, TURRET_STREAM.spawnGap, id) * span);
}
