// Two parity scenarios depend on entity ids only through staggered schedules: the
// caster's sight recheck (`(tickCount + mob.id) % SIGHT_RECHECK_TICKS`, mob/cast_sight.ts),
// the trash kit's sight retry slot (`mob.id % KIT_SIGHT_RETRY_SLOTS`,
// mob/trash_kit/kit_cast_sight.ts) and the like. New world content that spawns entities at
// construction shifts every later id, so these goldens re-record when a zone adds camps
// or keepers, with no change to any game rule. This pins that reading: shifting every id
// by a whole period reproduces the trace exactly, and a shift off the period does not (so
// the check bites). When the Quartered Isle moved ids by 54, a further shift to 60 brought
// back the pre-isle mob_cast_sight_route trace (603 ticks, 5,513 draws, b9deda47) and a
// shift to 55 the pre-isle rift_boss_floor trace (1,377 draws, e83d02e4).
import { describe, expect, it } from 'vitest';
import { SIGHT_RECHECK_TICKS } from '../src/sim/mob/cast_sight';
import { KIT_SIGHT_RETRY_SLOTS } from '../src/sim/mob/trash_kit/kit_cast_sight';
import { record } from './parity/record';
import { SCENARIOS } from './parity/scenarios';

function traceWithIdShift(name: string, shift: number) {
  const base = SCENARIOS.find((s) => s.name === name);
  if (!base) throw new Error(`no scenario ${name}`);
  const { trace } = record({
    ...base,
    build: () => {
      const sim = base.build();
      sim.nextId += shift;
      return sim;
    },
  });
  return { ticks: trace.ticks, draws: trace.draws, digest: trace.drawDigest };
}

const lcm = (a: number, b: number): number => {
  const gcd = (x: number, y: number): number => (y === 0 ? x : gcd(y, x % y));
  return (a * b) / gcd(a, b);
};

describe('parity scenarios see entity ids only through stagger phases', () => {
  it('mob_cast_sight_route is unchanged by an id shift of a whole sight-stagger period', () => {
    const period = lcm(SIGHT_RECHECK_TICKS, KIT_SIGHT_RETRY_SLOTS);
    const base = traceWithIdShift('mob_cast_sight_route', 0);
    expect(traceWithIdShift('mob_cast_sight_route', period)).toEqual(base);
    expect(traceWithIdShift('mob_cast_sight_route', 1)).not.toEqual(base);
    // Three whole-world recordings: past the default timeout on a loaded CI shard.
  }, 120_000);

  it('rift_boss_floor is unchanged by an even id shift', () => {
    const base = traceWithIdShift('rift_boss_floor', 0);
    expect(traceWithIdShift('rift_boss_floor', 2)).toEqual(base);
    expect(traceWithIdShift('rift_boss_floor', 1)).not.toEqual(base);
  }, 120_000);
});
