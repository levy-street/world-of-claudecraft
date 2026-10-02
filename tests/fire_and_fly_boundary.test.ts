// The Fire and Fly arena's invisible boundary at the forest edge: full runs of
// every trial through the real arena probe never carry a body past the wall
// behind the inner tree row, the one row every graphics tier draws whole.

import { describe, expect, it } from 'vitest';
import { FIRE_AND_FLY_DUNGEON_ID } from '../src/sim/content/fire_and_fly_arena';
import { TURRET_SCENARIOS } from '../src/sim/content/fire_and_fly_scenarios';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import {
  FIRE_AND_FLY_TREE_ROWS,
  FIRE_AND_FLY_WALL_RADIUS,
  FIRE_AND_FLY_WALL_REACH,
  fireAndFlyTrunkRadius,
} from '../src/sim/fire_and_fly_field';
import { positionAt, type ThrowProbe } from '../src/sim/minigames/thrown_body';
import {
  createTurretDefense,
  fireTurret,
  type TurretDefenseState,
  tickTurretDefense,
} from '../src/sim/minigames/turret_defense';
import { resolveTurretPlan } from '../src/sim/minigames/turret_defense_plan';
import { turretWorldProbe } from '../src/sim/turret_defense_session';
import { WORLD_SEED } from '../src/sim/world_seed';

const START = 1000;
const SLOT = 3;
// A wall bounce whose body edge reaches the wall's inner face is the boundary,
// not a rock or a trunk, which all stand inside it.
const FACE_SLACK = 0.05;

type Aim = (
  state: TurretDefenseState,
  tick: number,
  probe: ThrowProbe,
) => { x: number; z: number } | null;

function nearestLive(state: TurretDefenseState, tick: number, probe: ThrowProbe) {
  let best: { x: number; z: number } | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const m of state.monsters) {
    if (m.hp <= 0) continue;
    const p = positionAt(m.seg, tick, probe);
    const d = Math.hypot(p.x - state.cx, p.z - state.cz);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

const aimNearest: Aim = (state, tick, probe) =>
  tick >= state.readyTick ? nearestLive(state, tick, probe) : null;

/** `delay` ticks after each reload, up to 3 yd off the nearest monster (turret_scenarios). */
const aimLate =
  (delay: number): Aim =>
  (state, tick, probe) => {
    if (tick < state.readyTick + delay) return null;
    const p = nearestLive(state, tick, probe);
    if (!p) return null;
    return {
      x: p.x + ((tick * 7919) % 600) / 100 - 3,
      z: p.z + ((tick * 104729) % 600) / 100 - 3,
    };
  };

const AIMERS = [
  ['nearest', aimNearest],
  ['sloppy', aimLate(15)],
  ['slow', aimLate(24)],
] as const;

function farthestRun(scenario: (typeof TURRET_SCENARIOS)[number], seed: number, aim: Aim) {
  const center = instanceOrigin(DUNGEONS[FIRE_AND_FLY_DUNGEON_ID].index, SLOT);
  const probe = turretWorldProbe(WORLD_SEED);
  const plan = resolveTurretPlan(scenario);
  const state = createTurretDefense(plan, center, seed, START);
  let farthestEdge = 0;
  let edgeBounces = 0;
  let t = START;
  while (t < START + 20 * 60 * 10 && state.phase !== 'won' && state.phase !== 'lost') {
    t++;
    for (const e of tickTurretDefense(state, t, probe)) {
      if (e.type !== 'bounce' || e.surface !== 'wall') continue;
      const body = state.monsters.find((m) => m.id === e.id);
      if (!body) continue;
      const edge = Math.hypot(e.x - center.x, e.z - center.z) + plan.kinds[body.kind].radius;
      if (edge >= FIRE_AND_FLY_WALL_RADIUS - FACE_SLACK) edgeBounces++;
    }
    for (const m of state.monsters) {
      const p = positionAt(m.seg, t, probe);
      const edge = Math.hypot(p.x - center.x, p.z - center.z) + plan.kinds[m.kind].radius;
      farthestEdge = Math.max(farthestEdge, edge);
    }
    const target = aim(state, t, probe);
    if (target) fireTurret(state, t, target.x, target.z, probe);
  }
  return { state, farthestEdge, edgeBounces };
}

describe('the forest-edge boundary in full runs', () => {
  const secondRow = Math.min(
    ...FIRE_AND_FLY_TREE_ROWS[1].map(
      (tree) => Math.hypot(tree.x, tree.z) - fireAndFlyTrunkRadius(tree),
    ),
  );

  it.each(TURRET_SCENARIOS.map((s) => [s.boardKey, s] as const))(
    'never carries a body past the wall on %s, whatever the aimer',
    (_key, scenario) => {
      let bounces = 0;
      for (const [, aim] of AIMERS) {
        for (const seed of [42, 7]) {
          const r = farthestRun(scenario, seed, aim);
          expect(['won', 'lost']).toContain(r.state.phase);
          expect(r.farthestEdge).toBeLessThanOrEqual(FIRE_AND_FLY_WALL_REACH + 1e-6);
          expect(r.farthestEdge).toBeLessThan(secondRow);
          bounces += r.edgeBounces;
        }
      }
      // The boundary is live: bodies do reach it and bounce back.
      expect(bounces).toBeGreaterThan(0);
    },
  );
});
