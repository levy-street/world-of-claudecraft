// Fire and Fly waves as groups, the engine half: each group of the current wave spawns on
// its own clock from its delay, a tick's due spawns taken group by group in the plan's
// order, and every brick answers two questions for its spawns: through which bearings of
// the spawn ring the next one comes, and how long until the one after. Walkers and the
// bricks built on them are turret_arrival.ts's, packs and the sprint group
// turret_rally.ts's, surgers turret_surgers.ts's. Pure: private stateless draws only.

import {
  turretArrivalGap,
  turretArrivalLanes,
  turretArrivalSector,
  turretBandGap,
} from './turret_arrival';
import type { TurretBearingSector } from './turret_barrels';
import type { TurretDefenseState } from './turret_defense';
import type { TurretDrawSource } from './turret_defense_rng';
import { type TurretWavePlan, turretSpreadTick } from './turret_group_plan';
import { turretHuntSector } from './turret_rally';
import { turretActionBearing, turretSurgerSector } from './turret_surgers';

/** A group of the current wave as it spawns. */
export interface TurretGroupSpawn {
  /** Its monsters spawned so far. */
  cursor: number;
  /** The tick its next monster spawns on. */
  nextTick: number;
  /** Surgers only, once they set off: the action's bearing then. */
  action?: number;
}

/** The groups' clocks at a wave's start: each one's first spawn `delayTicks` after `firstTick`. */
export function startTurretGroups(wave: TurretWavePlan, firstTick: number): TurretGroupSpawn[] {
  return wave.groups.map((group) => ({ cursor: 0, nextTick: firstTick + group.delayTicks }));
}

/** The current wave's monsters not spawned yet (none outside a wave). */
export function turretWaveUnspawned(
  state: Pick<TurretDefenseState, 'phase' | 'plan' | 'wave' | 'spawning'>,
): number {
  const wave = state.phase === 'wave' ? state.plan.waves[state.wave] : undefined;
  if (!wave) return 0;
  let left = 0;
  wave.groups.forEach((group, g) => {
    left += group.count - (state.spawning[g]?.cursor ?? 0);
  });
  return left;
}

/** The bearings group `g`'s `index`-th spawn comes through at `tick`; null for the whole ring. */
export function turretGroupSector(
  state: TurretDefenseState,
  wave: TurretWavePlan,
  g: number,
  index: number,
  tick: number,
): TurretBearingSector | null {
  const group = wave.groups[g];
  switch (group.brick) {
    case 'walkers':
      return turretArrivalSector(state, state.wave, group.sides, index, g);
    case 'pack':
    case 'sprint':
      return turretHuntSector(state, state.wave, wave, g);
    case 'surgers': {
      const run = state.spawning[g];
      run.action ??= turretActionBearing(
        state,
        state.monsters,
        state.cx,
        state.cz,
        tick,
        state.wave,
        g,
      );
      return turretSurgerSector(state, state.wave, g, group, run.action, index);
    }
  }
}

/** Ticks from group `g`'s `index`-th spawn (monster `id`) to its next one. */
export function turretGroupGap(
  run: TurretDrawSource,
  wave: TurretWavePlan,
  g: number,
  index: number,
  id: number,
): number {
  const group = wave.groups[g];
  switch (group.brick) {
    case 'walkers':
      return turretArrivalGap(run, group, index, id);
    case 'surgers':
      return turretBandGap(run, group, id);
    case 'pack':
    case 'sprint':
      return index + 1 < group.count
        ? turretSpreadTick(group.spreadTicks, group.count, index + 1) -
            turretSpreadTick(group.spreadTicks, group.count, index)
        : 0;
  }
}

/**
 * Every side group `g` comes through that is known at the wave's start, in spawn order: a
 * walking group's arc, flanks or bunches, a pack's or the sprint group's arc. Empty for a
 * group off the ring's whole round or a surger (its side waits for the action).
 */
export function turretGroupLanes(
  run: TurretDrawSource,
  waveIndex: number,
  wave: TurretWavePlan,
  g: number,
): TurretBearingSector[] {
  const group = wave.groups[g];
  switch (group.brick) {
    case 'walkers':
      return turretArrivalLanes(run, waveIndex, group.sides, group.count, g);
    case 'pack':
    case 'sprint':
      return [turretHuntSector(run, waveIndex, wave, g)];
    case 'surgers':
      return [];
  }
}

/** Every side the wave's groups come through that is known at its start, group by group; null with none. */
export function turretWaveLanes(
  run: TurretDrawSource,
  waveIndex: number,
  wave: TurretWavePlan,
): TurretBearingSector[] | null {
  const lanes: TurretBearingSector[] = [];
  wave.groups.forEach((_, g) => {
    lanes.push(...turretGroupLanes(run, waveIndex, wave, g));
  });
  return lanes.length ? lanes : null;
}
