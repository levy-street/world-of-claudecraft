// Fire and Fly surgers: a group's bunches of fast monsters set off away from the action and
// run straight in. The action's bearing is read once, as the group's first monster spawns:
// the circle around the tower in equal sectors, each scored by the living monsters in it,
// weighted by how near the tower they stand (TURRET_SURGERS), the best sector's centre
// winning (a tie goes to the lower sector, counted from bearing 0); with no monster alive, a
// private draw. The group's `sides` bunches take the bearings evenly apart from it (one:
// opposite), each wandering a little by its own draw, and its monsters take the bunches in
// turn. Pure: private stateless draws only, no clock.

import { TURRET_ARENA, TURRET_SURGERS } from '../content/turret_defense';
import { horizontalAt } from './thrown_body';
import type { TurretBearingSector } from './turret_barrels';
import type { TurretMonster } from './turret_defense';
import { TURRET_STREAM, type TurretDrawSource, turretDraw } from './turret_defense_rng';
import { TURRET_GROUP_LIMITS } from './turret_group_plan';

const TAU = Math.PI * 2;

function mod(a: number, n: number): number {
  const r = a % n;
  return r < 0 ? r + n : r;
}

/** A living monster's weight at `distance` yd from the tower's centre: the ring's at the ring and beyond, the foot's at the foot. */
export function turretSurgeWeight(distance: number): number {
  const { ringWeight, footWeight } = TURRET_SURGERS;
  const near = TURRET_ARENA.breachRadius;
  const far = TURRET_ARENA.spawnRadius;
  const t = Math.min(1, Math.max(0, (far - distance) / (far - near)));
  return ringWeight + (footWeight - ringWeight) * t;
}

/** The sector a bearing (x += sin, z += cos) falls in, from bearing 0. */
export function turretSurgeSectorOf(bearing: number): number {
  const n = TURRET_SURGERS.sectors;
  return Math.min(n - 1, Math.floor(mod(bearing, TAU) / (TAU / n)));
}

/** Each sector's score at `tick`: its living monsters' weights summed. */
export function turretSurgeScores(
  monsters: readonly Pick<TurretMonster, 'hp' | 'state' | 'seg'>[],
  cx: number,
  cz: number,
  tick: number,
): number[] {
  const scores = new Array<number>(TURRET_SURGERS.sectors).fill(0);
  for (const m of monsters) {
    if (m.hp <= 0 || m.state === 'gone') continue;
    const p = horizontalAt(m.seg, tick);
    const dx = p.x - cx;
    const dz = p.z - cz;
    scores[turretSurgeSectorOf(Math.atan2(dx, dz))] += turretSurgeWeight(Math.hypot(dx, dz));
  }
  return scores;
}

/**
 * The action's bearing at `tick`: the best sector's centre (the lower one on a tie), or a
 * private draw keyed by the wave and the group when no monster lives.
 */
export function turretActionBearing(
  run: TurretDrawSource,
  monsters: readonly Pick<TurretMonster, 'hp' | 'state' | 'seg'>[],
  cx: number,
  cz: number,
  tick: number,
  wave: number,
  group: number,
): number {
  const scores = turretSurgeScores(monsters, cx, cz, tick);
  let best = -1;
  for (let s = 0; s < scores.length; s++) {
    if (scores[s] > 0 && (best < 0 || scores[s] > scores[best])) best = s;
  }
  if (best < 0) return turretDraw(run, TURRET_STREAM.surgeSide, wave, surgeKey(group, 0)) * TAU;
  return ((best + 0.5) / scores.length) * TAU;
}

/** Key 0 is the action's draw, bunch `k`'s jitter is key `k + 1`. */
function surgeKey(group: number, key: number): number {
  return group * TURRET_GROUP_LIMITS.sideKeys + key;
}

/** Bunch `k`'s bearing (from 0) before its jitter: `k + 1` steps of a turn over `sides + 1` from the action. */
export function turretSurgeBearing(action: number, sides: number, k: number): number {
  return action + ((k + 1) / (sides + 1)) * TAU;
}

/** The arc group `group`'s `index`-th surger comes through, its bunch's jittered side. */
export function turretSurgerSector(
  run: TurretDrawSource,
  wave: number,
  group: number,
  brick: { readonly sides: number; readonly widthTurn: number },
  action: number,
  index: number,
): TurretBearingSector {
  const k = index % brick.sides;
  const jitter = turretDraw(run, TURRET_STREAM.surgeSide, wave, surgeKey(group, k + 1)) * 2 - 1;
  const center =
    turretSurgeBearing(action, brick.sides, k) + jitter * TURRET_SURGERS.jitterTurn * TAU;
  const width = brick.widthTurn * TAU;
  return { from: center - width / 2, width };
}
