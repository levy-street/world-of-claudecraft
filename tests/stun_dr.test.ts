import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob, createPlayer } from '../src/sim/entity';
import {
  crowdControlDurationAfterDr,
  diminishedCrowdControlDuration,
  isStunDrCategory,
  resolveCrowdControlSource,
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
  // Unowned sources never consult the lookup, so the plain-pair tests pass an
  // empty world; the ownership-resolution suite below builds a real one.
  const none = (_id: number): Entity | undefined => undefined;

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
    expect(crowdControlDurationAfterDr(0, friendly, none, source, target, 'root', 6)).toBe(6);
    expect(diminishedCrowdControlDuration(0, friendly, none, source, target, 'root', 6)).toBe(6);
  });

  it('returns the full duration untouched for a player-versus-mob pair even when hostile', () => {
    const source = players().source;
    const target = mob();
    // Mob target: the kind !== 'player' early return fires regardless of isHostileTo.
    expect(crowdControlDurationAfterDr(0, hostile, none, source, target, 'root', 6)).toBe(6);
    expect(diminishedCrowdControlDuration(0, hostile, none, source, target, 'root', 6)).toBe(6);
  });

  it('walks the 100/50/25/immune ladder for a hostile PvP root, then goes immune', () => {
    const { source, target } = players();
    expect(crowdControlDurationAfterDr(0, hostile, none, source, target, 'root', 8)).toBe(8);
    expect(crowdControlDurationAfterDr(0, hostile, none, source, target, 'root', 8)).toBe(4);
    expect(crowdControlDurationAfterDr(0, hostile, none, source, target, 'root', 8)).toBe(2);
    expect(crowdControlDurationAfterDr(0, hostile, none, source, target, 'root', 8)).toBeNull();
    // Once immune, diminishedCrowdControlDuration must pass null straight
    // through rather than multiplying it by the item-set reduction.
    target.ccDurationReduction = 0.5;
    expect(diminishedCrowdControlDuration(0, hostile, none, source, target, 'root', 8)).toBeNull();
  });

  it('walks the same 100/50/25/immune ladder for lockout via the PVP_STUN_DR_RESET timer', () => {
    const { source, target } = players();
    expect(crowdControlDurationAfterDr(0, hostile, none, source, target, 'lockout', 8)).toBe(8);
    expect(crowdControlDurationAfterDr(0, hostile, none, source, target, 'lockout', 8)).toBe(4);
    expect(crowdControlDurationAfterDr(0, hostile, none, source, target, 'lockout', 8)).toBe(2);
    expect(crowdControlDurationAfterDr(0, hostile, none, source, target, 'lockout', 8)).toBeNull();
  });

  it('uses the fixed staged durations for polymorph', () => {
    const { source, target } = players();
    expect(crowdControlDurationAfterDr(0, hostile, none, source, target, 'polymorph', 30)).toBe(10);
    expect(crowdControlDurationAfterDr(0, hostile, none, source, target, 'polymorph', 30)).toBe(5);
    expect(crowdControlDurationAfterDr(0, hostile, none, source, target, 'polymorph', 30)).toBe(1);
    // The staged array is exhausted at index 2; further stages hold at the
    // final entry rather than going null (polymorph never becomes immune).
    expect(crowdControlDurationAfterDr(0, hostile, none, source, target, 'polymorph', 30)).toBe(1);
  });

  it("scales fear from each ability's authored duration", () => {
    const { source, target } = players();
    expect(crowdControlDurationAfterDr(0, hostile, none, source, target, 'fear', 4)).toBe(4);
    expect(crowdControlDurationAfterDr(0, hostile, none, source, target, 'fear', 4)).toBe(2);
    expect(crowdControlDurationAfterDr(0, hostile, none, source, target, 'fear', 4)).toBe(1);
    expect(crowdControlDurationAfterDr(0, hostile, none, source, target, 'fear', 4)).toBe(0.5);
    expect(crowdControlDurationAfterDr(0, hostile, none, source, target, 'fear', 4)).toBe(0.5);
  });

  it('leaves stun categories (openerStun/controlledStun/randomStun) undiminished', () => {
    const stunCategories: CrowdControlDrCategory[] = ['openerStun', 'controlledStun', 'randomStun'];
    for (const category of stunCategories) {
      const { source, target } = players();
      for (let i = 0; i < 5; i++) {
        expect(crowdControlDurationAfterDr(0, hostile, none, source, target, category, 3)).toBe(3);
      }
    }
  });

  it('a fresh DR stage arrives once the reset window has passed', () => {
    const { source, target } = players();
    expect(crowdControlDurationAfterDr(0, hostile, none, source, target, 'root', 8)).toBe(8);
    expect(crowdControlDurationAfterDr(0, hostile, none, source, target, 'root', 8)).toBe(4);
    // PVP_ROOT_DR_RESET is 18s: calling well past the reset restarts the ladder.
    expect(crowdControlDurationAfterDr(100, hostile, none, source, target, 'root', 8)).toBe(8);
  });

  it('applies a target ccDurationReduction multiplicatively, only for hostile player-versus-player pairs', () => {
    // Hostile player pair: the item-set reduction lands on top of the ladder.
    {
      const { source, target } = players();
      target.ccDurationReduction = 0.5;
      expect(diminishedCrowdControlDuration(0, hostile, none, source, target, 'root', 8)).toBe(4);
    }
    // Non-hostile player pair: the reduction never applies.
    {
      const { source, target } = players();
      target.ccDurationReduction = 0.5;
      expect(diminishedCrowdControlDuration(0, friendly, none, source, target, 'root', 8)).toBe(8);
    }
    // Player-versus-mob: the reduction never applies, even if the mob somehow
    // carries a nonzero value and isHostileTo reports true.
    {
      const source = players().source;
      const target = mob();
      target.ccDurationReduction = 0.5;
      expect(diminishedCrowdControlDuration(0, hostile, none, source, target, 'root', 8)).toBe(8);
    }
  });

  it('is deterministic: the same inputs against fresh, identically-shaped entities produce the same result', () => {
    const run = () => {
      const { source, target } = players();
      const first = diminishedCrowdControlDuration(0, hostile, none, source, target, 'root', 8);
      const second = diminishedCrowdControlDuration(0, hostile, none, source, target, 'root', 8);
      return [first, second];
    };
    expect(run()).toEqual(run());
  });
});

// Ownership resolution: for DR purposes any player-owned entity resolves to
// that player, so minion crowd control on a player diminishes on the owner's
// chain instead of bypassing PvP DR through the non-hostile-pair early return
// (pets are entity kind 'mob'). The rule is ownership, not persistence:
// persistent pets, temporary summons, and chained ownership all resolve alike.
describe('minion crowd control resolves to the owning player for DR', () => {
  function world() {
    const owner = createPlayer(1, 'hunter', { x: 0, y: 0, z: 0 }, 'Owner');
    const target = createPlayer(2, 'mage', { x: 0, y: 0, z: 0 }, 'Target');
    const pet = createMob(3, MOBS.forest_wolf, 1, { x: 0, y: 0, z: 0 });
    pet.ownerId = owner.id;
    const summon = createMob(4, MOBS.forest_wolf, 1, { x: 0, y: 0, z: 0 });
    summon.ownerId = owner.id;
    const wild = createMob(5, MOBS.forest_wolf, 1, { x: 0, y: 0, z: 0 });
    const entities = new Map<number, Entity>([
      [owner.id, owner],
      [target.id, target],
      [pet.id, pet],
      [summon.id, summon],
      [wild.id, wild],
    ]);
    const getEntity = (id: number) => entities.get(id);
    // Hostility is judged on the RESOLVED caster: keying it to the owner's id
    // proves the funnel evaluates the owner, not the mob-kind minion (a pet
    // source reaching isHostileTo directly would read as non-hostile here).
    const isHostileTo = (a: Entity, b: Entity) =>
      (a.id === owner.id && b.id === target.id) || (a.id === target.id && b.id === owner.id);
    return { owner, target, pet, summon, wild, entities, getEntity, isHostileTo };
  }

  it('resolveCrowdControlSource resolves owned entities, transitively, to the player', () => {
    const { owner, pet, wild, entities, getEntity } = world();
    expect(resolveCrowdControlSource(owner, getEntity)).toBe(owner);
    expect(resolveCrowdControlSource(wild, getEntity)).toBe(wild);
    expect(resolveCrowdControlSource(pet, getEntity)).toBe(owner);
    // A summon's summon still resolves to the player at the root of the chain.
    const nested = createMob(6, MOBS.forest_wolf, 1, { x: 0, y: 0, z: 0 });
    nested.ownerId = pet.id;
    entities.set(nested.id, nested);
    expect(resolveCrowdControlSource(nested, getEntity)).toBe(owner);
  });

  it('stops on a broken or cyclic ownership chain instead of hanging', () => {
    const { pet, getEntity } = world();
    // Despawned owner: the lookup misses, the walk stops, the minion stays a mob.
    const orphan = createMob(7, MOBS.forest_wolf, 1, { x: 0, y: 0, z: 0 });
    orphan.ownerId = 999;
    expect(resolveCrowdControlSource(orphan, getEntity)).toBe(orphan);
    // Ownership cycle (corrupt state): the visited guard breaks the loop.
    const a = createMob(8, MOBS.forest_wolf, 1, { x: 0, y: 0, z: 0 });
    const b = createMob(9, MOBS.forest_wolf, 1, { x: 0, y: 0, z: 0 });
    a.ownerId = b.id;
    b.ownerId = a.id;
    const cyc = new Map<number, Entity>([
      [a.id, a],
      [b.id, b],
    ]);
    expect(resolveCrowdControlSource(a, (id) => cyc.get(id))).toBe(b);
    expect(pet.ownerId).not.toBeNull(); // fixture sanity: the happy path stays owned
  });

  it("pet crowd control on a player walks the owner's DR ladder", () => {
    const { target, pet, getEntity, isHostileTo } = world();
    expect(diminishedCrowdControlDuration(0, isHostileTo, getEntity, pet, target, 'root', 8)).toBe(
      8,
    );
    expect(diminishedCrowdControlDuration(0, isHostileTo, getEntity, pet, target, 'root', 8)).toBe(
      4,
    );
    expect(diminishedCrowdControlDuration(0, isHostileTo, getEntity, pet, target, 'root', 8)).toBe(
      2,
    );
    expect(
      diminishedCrowdControlDuration(0, isHostileTo, getEntity, pet, target, 'root', 8),
    ).toBeNull();
  });

  it('alternating owner and pet crowd control of one category diminishes as one chain', () => {
    const { owner, target, pet, getEntity, isHostileTo } = world();
    expect(
      diminishedCrowdControlDuration(0, isHostileTo, getEntity, owner, target, 'fear', 8),
    ).toBe(8);
    expect(diminishedCrowdControlDuration(0, isHostileTo, getEntity, pet, target, 'fear', 8)).toBe(
      4,
    );
    expect(
      diminishedCrowdControlDuration(0, isHostileTo, getEntity, owner, target, 'fear', 8),
    ).toBe(2);
    expect(diminishedCrowdControlDuration(0, isHostileTo, getEntity, pet, target, 'fear', 8)).toBe(
      1,
    );
  });

  it('two different minions of the same owner share one chain, and a temporary summon diminishes like a persistent pet', () => {
    const { target, pet, summon, getEntity, isHostileTo } = world();
    expect(diminishedCrowdControlDuration(0, isHostileTo, getEntity, pet, target, 'root', 8)).toBe(
      8,
    );
    expect(
      diminishedCrowdControlDuration(0, isHostileTo, getEntity, summon, target, 'root', 8),
    ).toBe(4);
    expect(diminishedCrowdControlDuration(0, isHostileTo, getEntity, pet, target, 'root', 8)).toBe(
      2,
    );
    expect(
      diminishedCrowdControlDuration(0, isHostileTo, getEntity, summon, target, 'root', 8),
    ).toBeNull();
  });

  it("the target's item-set reduction now applies to minion control from a hostile player", () => {
    const { target, pet, getEntity, isHostileTo } = world();
    target.ccDurationReduction = 0.5;
    expect(diminishedCrowdControlDuration(0, isHostileTo, getEntity, pet, target, 'root', 8)).toBe(
      4,
    );
  });

  it('minion crowd control against a mob/NPC target is unchanged (full duration, no DR state)', () => {
    const { pet, wild, getEntity, isHostileTo } = world();
    for (let i = 0; i < 3; i++) {
      expect(diminishedCrowdControlDuration(0, isHostileTo, getEntity, pet, wild, 'root', 8)).toBe(
        8,
      );
    }
    expect(wild.ccDr.size).toBe(0);
  });

  it('unowned wild mob crowd control on a player is unchanged (full duration, no DR state)', () => {
    const { target, wild, getEntity, isHostileTo } = world();
    for (let i = 0; i < 3; i++) {
      expect(
        diminishedCrowdControlDuration(0, isHostileTo, getEntity, wild, target, 'fear', 8),
      ).toBe(8);
    }
    expect(target.ccDr.size).toBe(0);
  });
});
