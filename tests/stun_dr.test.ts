import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob, createPlayer } from '../src/sim/entity';
import {
  crowdControlDurationAfterDr,
  diminishedCrowdControlDuration,
  isStunDrCategory,
  stunDrCategory,
} from '../src/sim/stun_dr';
import type { CrowdControlDrCategory, Entity } from '../src/sim/types';

describe('stun DR categories (#1004)', () => {
  it('classifies from-stealth openers as openerStun', () => {
    expect(stunDrCategory('cheap_shot')).toBe('openerStun');
    expect(stunDrCategory('pounce')).toBe('openerStun');
  });

  it('classifies deliberate on-demand stuns as controlledStun', () => {
    expect(stunDrCategory('kidney_shot')).toBe('controlledStun');
    expect(stunDrCategory('hammer_of_justice')).toBe('controlledStun');
    expect(stunDrCategory('bash')).toBe('controlledStun');
    expect(stunDrCategory('charge')).toBe('controlledStun');
    expect(stunDrCategory('bear_charge')).toBe('controlledStun');
  });

  it('keeps opener and controlled stuns in independent buckets', () => {
    // The whole point of the split: a rogue opener must not share a bucket with a
    // controlled stun, so Cheap Shot cannot diminish the following Kidney Shot.
    expect(stunDrCategory('cheap_shot')).not.toBe(stunDrCategory('kidney_shot'));
  });

  it('defaults unknown / proc stuns to randomStun', () => {
    expect(stunDrCategory('some_future_proc_stun')).toBe('randomStun');
  });

  it('recognises all three stun buckets as stun DR categories', () => {
    expect(isStunDrCategory('openerStun')).toBe(true);
    expect(isStunDrCategory('controlledStun')).toBe(true);
    expect(isStunDrCategory('randomStun')).toBe(true);
    expect(isStunDrCategory('root')).toBe(false);
    expect(isStunDrCategory('fear')).toBe(false);
  });
});

// Coverage for the two PvP crowd-control duration resolvers (moved here from
// Sim.diminishedCrowdControlDuration / Sim.crowdControlDurationAfterDr; see
// tests/charge_parallel_recharge.test.ts and tests/warfare_set_bonuses.test.ts
// for the indirect coverage this mirrors through the Sim delegate).
describe('crowdControlDurationAfterDr / diminishedCrowdControlDuration', () => {
  const hostile = () => true;
  const friendly = () => false;

  function players(): { source: Entity; target: Entity } {
    return {
      source: createPlayer(1, 'warrior', { x: 0, y: 0, z: 0 }, 'Source'),
      target: createPlayer(2, 'mage', { x: 0, y: 0, z: 0 }, 'Target'),
    };
  }

  function mob(): Entity {
    return createMob(3, MOBS.forest_wolf, 1, { x: 0, y: 0, z: 0 });
  }

  it('returns the full duration untouched for a non-hostile player pair', () => {
    const { source, target } = players();
    expect(crowdControlDurationAfterDr(0, friendly, source, target, 'root', 6)).toBe(6);
    expect(diminishedCrowdControlDuration(0, friendly, source, target, 'root', 6)).toBe(6);
  });

  it('returns the full duration untouched for a player-versus-mob pair even when hostile', () => {
    const source = players().source;
    const target = mob();
    // Mob target: the kind !== 'player' early return fires regardless of isHostileTo.
    expect(crowdControlDurationAfterDr(0, hostile, source, target, 'root', 6)).toBe(6);
    expect(diminishedCrowdControlDuration(0, hostile, source, target, 'root', 6)).toBe(6);
  });

  it('walks the 100/50/25/immune ladder for a hostile PvP root, then goes immune', () => {
    const { source, target } = players();
    expect(crowdControlDurationAfterDr(0, hostile, source, target, 'root', 8)).toBe(8);
    expect(crowdControlDurationAfterDr(0, hostile, source, target, 'root', 8)).toBe(4);
    expect(crowdControlDurationAfterDr(0, hostile, source, target, 'root', 8)).toBe(2);
    expect(crowdControlDurationAfterDr(0, hostile, source, target, 'root', 8)).toBeNull();
    // Once immune, diminishedCrowdControlDuration must pass null straight
    // through rather than multiplying it by the item-set reduction.
    target.ccDurationReduction = 0.5;
    expect(diminishedCrowdControlDuration(0, hostile, source, target, 'root', 8)).toBeNull();
  });

  it('walks the same 100/50/25/immune ladder for lockout via the PVP_STUN_DR_RESET timer', () => {
    const { source, target } = players();
    expect(crowdControlDurationAfterDr(0, hostile, source, target, 'lockout', 8)).toBe(8);
    expect(crowdControlDurationAfterDr(0, hostile, source, target, 'lockout', 8)).toBe(4);
    expect(crowdControlDurationAfterDr(0, hostile, source, target, 'lockout', 8)).toBe(2);
    expect(crowdControlDurationAfterDr(0, hostile, source, target, 'lockout', 8)).toBeNull();
  });

  it('uses the fixed staged durations for polymorph', () => {
    const { source, target } = players();
    expect(crowdControlDurationAfterDr(0, hostile, source, target, 'polymorph', 30)).toBe(10);
    expect(crowdControlDurationAfterDr(0, hostile, source, target, 'polymorph', 30)).toBe(5);
    expect(crowdControlDurationAfterDr(0, hostile, source, target, 'polymorph', 30)).toBe(1);
    // The staged array is exhausted at index 2; further stages hold at the
    // final entry rather than going null (polymorph never becomes immune).
    expect(crowdControlDurationAfterDr(0, hostile, source, target, 'polymorph', 30)).toBe(1);
  });

  it('scales the proportional multiplier ladder for fear off the authored duration', () => {
    const { source, target } = players();
    expect(crowdControlDurationAfterDr(0, hostile, source, target, 'fear', 8)).toBe(8);
    expect(crowdControlDurationAfterDr(0, hostile, source, target, 'fear', 8)).toBe(4);
    expect(crowdControlDurationAfterDr(0, hostile, source, target, 'fear', 8)).toBe(2);
    expect(crowdControlDurationAfterDr(0, hostile, source, target, 'fear', 8)).toBe(1);
    // The multiplier array is exhausted at index 3; further stages hold at the
    // final factor rather than going null (fear never becomes immune).
    expect(crowdControlDurationAfterDr(0, hostile, source, target, 'fear', 8)).toBe(1);
  });

  it("scales fear from each ability's authored duration", () => {
    // A fixed absolute ladder would return 8 then 4 here regardless of the
    // authored duration; the multiplier ladder scales off the real value.
    const { source, target } = players();
    expect(crowdControlDurationAfterDr(0, hostile, source, target, 'fear', 4)).toBe(4);
    expect(crowdControlDurationAfterDr(0, hostile, source, target, 'fear', 4)).toBe(2);
    expect(crowdControlDurationAfterDr(0, hostile, source, target, 'fear', 4)).toBe(1);
    expect(crowdControlDurationAfterDr(0, hostile, source, target, 'fear', 4)).toBe(0.5);
    expect(crowdControlDurationAfterDr(0, hostile, source, target, 'fear', 4)).toBe(0.5);
  });

  it('leaves stun categories (openerStun/controlledStun/randomStun) undiminished', () => {
    const stunCategories: CrowdControlDrCategory[] = ['openerStun', 'controlledStun', 'randomStun'];
    for (const category of stunCategories) {
      const { source, target } = players();
      for (let i = 0; i < 5; i++) {
        expect(crowdControlDurationAfterDr(0, hostile, source, target, category, 3)).toBe(3);
      }
    }
  });

  it('a fresh DR stage arrives once the reset window has passed', () => {
    const { source, target } = players();
    expect(crowdControlDurationAfterDr(0, hostile, source, target, 'root', 8)).toBe(8);
    expect(crowdControlDurationAfterDr(0, hostile, source, target, 'root', 8)).toBe(4);
    // PVP_ROOT_DR_RESET is 18s: calling well past the reset restarts the ladder.
    expect(crowdControlDurationAfterDr(100, hostile, source, target, 'root', 8)).toBe(8);
  });

  it('applies a target ccDurationReduction multiplicatively, only for hostile player-versus-player pairs', () => {
    // Hostile player pair: the item-set reduction lands on top of the ladder.
    {
      const { source, target } = players();
      target.ccDurationReduction = 0.5;
      expect(diminishedCrowdControlDuration(0, hostile, source, target, 'root', 8)).toBe(4);
    }
    // Non-hostile player pair: the reduction never applies.
    {
      const { source, target } = players();
      target.ccDurationReduction = 0.5;
      expect(diminishedCrowdControlDuration(0, friendly, source, target, 'root', 8)).toBe(8);
    }
    // Player-versus-mob: the reduction never applies, even if the mob somehow
    // carries a nonzero value and isHostileTo reports true.
    {
      const source = players().source;
      const target = mob();
      target.ccDurationReduction = 0.5;
      expect(diminishedCrowdControlDuration(0, hostile, source, target, 'root', 8)).toBe(8);
    }
  });

  it('is deterministic: the same inputs against fresh, identically-shaped entities produce the same result', () => {
    const run = () => {
      const { source, target } = players();
      const first = diminishedCrowdControlDuration(0, hostile, source, target, 'root', 8);
      const second = diminishedCrowdControlDuration(0, hostile, source, target, 'root', 8);
      return [first, second];
    };
    expect(run()).toEqual(run());
  });
});
