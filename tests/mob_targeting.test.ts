// Direct unit tests for the extracted mob target-selection module (M1).
//
// These exercise src/sim/mob/targeting.ts in isolation against a minimal fake
// SimContext (just `entities` + the two Nythraxis-add callbacks the module reaches
// through the seam). They pin the exact threat-switch math the parity gate cannot
// see a return value for: the 110% melee / 130% ranged pull-over thresholds and
// their strict-`>` boundaries, the forced-target/taunt branch and its timer expiry,
// retargetMob's highest-pick / fallback / despawn-defer / evade branches, and the
// trivial-con guard.

import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMobScanCounters } from '../src/sim/mob/scan_counters';
import {
  highestThreatTarget,
  isTrivialTo,
  retargetMob,
  tickForcedTarget,
  updateMobTarget,
} from '../src/sim/mob/targeting';
import type { SimContext } from '../src/sim/sim_context';
import { type Entity, MELEE_RANGE } from '../src/sim/types';

// Minimal Entity carrying only the fields the four functions touch.
function ent(id: number, over: Partial<Entity> = {}): Entity {
  return {
    id,
    dead: false,
    pos: { x: 0, y: 0, z: 0 },
    level: 1,
    templateId: 'forest_wolf',
    ownerId: null,
    scale: 1, // updateMobTarget reads scale for the size-scaled melee reach
    aiState: 'idle',
    inCombat: false,
    despawnTimer: undefined,
    aggroTargetId: null,
    forcedTargetId: null,
    forcedTargetTimer: 0,
    threat: new Map<number, number>(),
    ...over,
  } as unknown as Entity;
}

// Fake seam: the module reads `entities` and the mob-scan counters, and calls the
// two Nythraxis helpers.
function fakeCtx(
  entities: Map<number, Entity>,
  opts: { fallback?: Entity | null; despawn?: boolean } = {},
): SimContext {
  return {
    entities,
    mobScanCounters: createMobScanCounters(),
    nythraxisAddFallbackTarget: () => opts.fallback ?? null,
    scheduleNythraxisAddDespawnIfBossReset: () => opts.despawn ?? false,
  } as unknown as SimContext;
}

// In-melee uses dist2d <= MELEE_RANGE * 1.2; place attackers just inside / outside.
const MELEE_IN = MELEE_RANGE * 1.2 - 1; // 5 (inside the 6-yard melee cutoff)
const MELEE_OUT = MELEE_RANGE * 1.2 + 10; // 16 (outside it)

describe('mob/targeting: highestThreatTarget', () => {
  it('picks the highest-threat living attacker', () => {
    const a = ent(1);
    const b = ent(2);
    const ctx = fakeCtx(
      new Map([
        [1, a],
        [2, b],
      ]),
    );
    const mob = ent(10, {
      threat: new Map([
        [1, 30],
        [2, 70],
      ]),
    });
    expect(highestThreatTarget(ctx, mob)).toBe(b);
  });

  it('tie-break keeps the first-inserted on equal threat (strict `>`)', () => {
    const a = ent(1);
    const b = ent(2);
    const ctx = fakeCtx(
      new Map([
        [1, a],
        [2, b],
      ]),
    );
    // Insertion order a then b; equal threat -> b never exceeds bestT, so a wins.
    const mob = ent(10, {
      threat: new Map([
        [1, 50],
        [2, 50],
      ]),
    });
    expect(highestThreatTarget(ctx, mob)).toBe(a);
  });

  it('prunes dead and missing entries mid-iterate', () => {
    const alive = ent(1);
    const dead = ent(2, { dead: true });
    const ctx = fakeCtx(
      new Map([
        [1, alive],
        [2, dead],
      ]),
    ); // id 3 is missing entirely
    const mob = ent(10, {
      threat: new Map([
        [1, 10],
        [2, 99],
        [3, 99],
      ]),
    });
    expect(highestThreatTarget(ctx, mob)).toBe(alive);
    expect(mob.threat.has(2)).toBe(false); // dead pruned
    expect(mob.threat.has(3)).toBe(false); // missing pruned
    expect(mob.threat.has(1)).toBe(true); // living kept
  });
});

describe('mob/targeting: updateMobTarget pull-over', () => {
  it('110% melee pull-over: an in-melee attacker past 110% steals aggro', () => {
    const tank = ent(1);
    const bruiser = ent(2, { pos: { x: MELEE_IN, y: 0, z: 0 } });
    const ctx = fakeCtx(
      new Map([
        [1, tank],
        [2, bruiser],
      ]),
    );
    const mob = ent(10, {
      aggroTargetId: 1,
      threat: new Map([
        [1, 100],
        [2, 120],
      ]),
    });
    updateMobTarget(ctx, mob);
    expect(mob.aggroTargetId).toBe(2);
  });

  it('does NOT switch at exactly 110% in melee (strict `>` MELEE_SWITCH_MULT)', () => {
    const tank = ent(1);
    const bruiser = ent(2, { pos: { x: MELEE_IN, y: 0, z: 0 } });
    const ctx = fakeCtx(
      new Map([
        [1, tank],
        [2, bruiser],
      ]),
    );
    const mob = ent(10, {
      aggroTargetId: 1,
      threat: new Map([
        [1, 100],
        [2, 110],
      ]),
    });
    updateMobTarget(ctx, mob);
    expect(mob.aggroTargetId).toBe(1);
  });

  it('130% ranged pull-over: an out-of-melee attacker past 130% steals aggro', () => {
    const tank = ent(1);
    const caster = ent(3, { pos: { x: MELEE_OUT, y: 0, z: 0 } });
    const ctx = fakeCtx(
      new Map([
        [1, tank],
        [3, caster],
      ]),
    );
    const mob = ent(10, {
      aggroTargetId: 1,
      threat: new Map([
        [1, 100],
        [3, 140],
      ]),
    });
    updateMobTarget(ctx, mob);
    expect(mob.aggroTargetId).toBe(3);
  });

  it('does NOT switch at exactly 130% at range (strict `>` RANGED_SWITCH_MULT)', () => {
    const tank = ent(1);
    const caster = ent(3, { pos: { x: MELEE_OUT, y: 0, z: 0 } });
    const ctx = fakeCtx(
      new Map([
        [1, tank],
        [3, caster],
      ]),
    );
    const mob = ent(10, {
      aggroTargetId: 1,
      threat: new Map([
        [1, 100],
        [3, 130],
      ]),
    });
    updateMobTarget(ctx, mob);
    expect(mob.aggroTargetId).toBe(1);
  });

  it('melee threshold (1.1) is looser than ranged (1.3): 120% pulls in melee, holds at range', () => {
    // Same 120% threat, distance is the only difference.
    const melee = (() => {
      const tank = ent(1);
      const att = ent(2, { pos: { x: MELEE_IN, y: 0, z: 0 } });
      const ctx = fakeCtx(
        new Map([
          [1, tank],
          [2, att],
        ]),
      );
      const mob = ent(10, {
        aggroTargetId: 1,
        threat: new Map([
          [1, 100],
          [2, 120],
        ]),
      });
      updateMobTarget(ctx, mob);
      return mob.aggroTargetId;
    })();
    const ranged = (() => {
      const tank = ent(1);
      const att = ent(2, { pos: { x: MELEE_OUT, y: 0, z: 0 } });
      const ctx = fakeCtx(
        new Map([
          [1, tank],
          [2, att],
        ]),
      );
      const mob = ent(10, {
        aggroTargetId: 1,
        threat: new Map([
          [1, 100],
          [2, 120],
        ]),
      });
      updateMobTarget(ctx, mob);
      return mob.aggroTargetId;
    })();
    expect(melee).toBe(2); // 120% > 110% in melee -> switch
    expect(ranged).toBe(1); // 120% <= 130% at range -> hold
  });

  it('repicks the highest threat when the current target is dead/missing', () => {
    const dead = ent(1, { dead: true });
    const alive = ent(3);
    const ctx = fakeCtx(
      new Map([
        [1, dead],
        [3, alive],
      ]),
    );
    const mob = ent(10, {
      aggroTargetId: 1,
      threat: new Map([
        [1, 100],
        [3, 50],
      ]),
    });
    updateMobTarget(ctx, mob);
    expect(mob.aggroTargetId).toBe(3); // fell back to highestThreatTarget
    expect(mob.threat.has(1)).toBe(false); // dead current pruned by the rescan
  });
});

describe('mob/targeting: updateMobTarget forced-target/taunt', () => {
  it('forces the taunter, decrements the timer, then clears + reverts on expiry', () => {
    const tank = ent(1);
    const taunter = ent(2);
    const ctx = fakeCtx(
      new Map([
        [1, tank],
        [2, taunter],
      ]),
    );
    const mob = ent(10, {
      aggroTargetId: 1,
      forcedTargetId: 2,
      forcedTargetTimer: 3,
      threat: new Map([[1, 100]]),
    });

    // (1) Forced: locks onto the taunter despite the tank holding all the threat.
    updateMobTarget(ctx, mob);
    expect(mob.aggroTargetId).toBe(2);
    expect(mob.forcedTargetTimer).toBeCloseTo(2.95, 5); // -= DT (0.05)

    // (2) About to expire: still honored this call (returns before the clear).
    mob.forcedTargetTimer = 0.02;
    updateMobTarget(ctx, mob);
    expect(mob.aggroTargetId).toBe(2);
    expect(mob.forcedTargetId).toBe(2);
    expect(mob.forcedTargetTimer).toBeLessThanOrEqual(0);

    // (3) Expired: forcedTargetId clears and the threat scan reclaims the tank.
    updateMobTarget(ctx, mob);
    expect(mob.forcedTargetId).toBe(null);
    expect(mob.aggroTargetId).toBe(1);
  });
});

describe('mob/targeting: tickForcedTarget (stunned-path timer slice)', () => {
  it('decrements the window by DT and never touches aggro', () => {
    const mob = ent(10, { aggroTargetId: 1, forcedTargetId: 2, forcedTargetTimer: 3 });
    tickForcedTarget(mob);
    expect(mob.forcedTargetTimer).toBeCloseTo(2.95, 5);
    expect(mob.forcedTargetId).toBe(2); // still running
    expect(mob.aggroTargetId).toBe(1); // unchanged (mob is stunned, cannot act)
  });

  it('clears the forced target once the window elapses', () => {
    const mob = ent(10, { forcedTargetId: 2, forcedTargetTimer: 0.02 });
    tickForcedTarget(mob);
    expect(mob.forcedTargetTimer).toBeLessThanOrEqual(0);
    expect(mob.forcedTargetId).toBe(null);
  });

  it('is a no-op when there is no forced target (timer already 0)', () => {
    const mob = ent(10, { forcedTargetId: null, forcedTargetTimer: 0 });
    tickForcedTarget(mob);
    expect(mob.forcedTargetTimer).toBe(0);
    expect(mob.forcedTargetId).toBe(null);
  });
});

describe('mob/targeting: retargetMob', () => {
  it('grabs the highest-threat target and chases', () => {
    const a = ent(1);
    const b = ent(3);
    const ctx = fakeCtx(
      new Map([
        [1, a],
        [3, b],
      ]),
    );
    const mob = ent(10, {
      aiState: 'attack',
      threat: new Map([
        [1, 100],
        [3, 140],
      ]),
    });
    retargetMob(ctx, mob);
    expect(mob.aggroTargetId).toBe(3);
    expect(mob.aiState).toBe('chase');
    expect(mob.inCombat).toBe(true);
    expect(mob.despawnTimer).toBeUndefined();
  });

  it('evades home when no living threat remains (both Nythraxis callbacks no-op)', () => {
    const ctx = fakeCtx(new Map(), { fallback: null, despawn: false });
    const mob = ent(10, { aiState: 'chase', aggroTargetId: 9, threat: new Map([[900, 50]]) });
    retargetMob(ctx, mob);
    expect(mob.aggroTargetId).toBe(null);
    expect(mob.aiState).toBe('evade');
    expect(mob.threat.size).toBe(0); // the missing entry was pruned
  });

  it('clears an owned pet target without using evade', () => {
    const ctx = fakeCtx(new Map(), { fallback: null, despawn: false });
    const pet = ent(10, {
      ownerId: 1,
      aiState: 'attack',
      aggroTargetId: 9,
      inCombat: true,
      despawnTimer: 3,
      threat: new Map(),
    });
    retargetMob(ctx, pet);
    expect(pet.aggroTargetId).toBeNull();
    expect(pet.aiState).toBe('idle');
    expect(pet.inCombat).toBe(false);
    expect(pet.despawnTimer).toBeUndefined();
  });

  it('takes the Nythraxis fallback target when present and seeds its threat', () => {
    const boss = ent(7);
    const ctx = fakeCtx(new Map([[7, boss]]), { fallback: boss });
    const mob = ent(10, { aiState: 'idle', threat: new Map() });
    retargetMob(ctx, mob);
    expect(mob.aggroTargetId).toBe(7);
    expect(mob.aiState).toBe('chase');
    expect(mob.threat.has(7)).toBe(true); // addThreat seeded the fallback
  });

  it('defers to the despawn scheduler (returns before evade, leaving state untouched)', () => {
    const ctx = fakeCtx(new Map(), { fallback: null, despawn: true });
    const mob = ent(10, { aiState: 'chase', aggroTargetId: 5, threat: new Map() });
    retargetMob(ctx, mob);
    expect(mob.aiState).toBe('chase'); // NOT flipped to 'evade'
    expect(mob.aggroTargetId).toBe(5); // unchanged
  });
});

describe('mob/targeting: isTrivialTo', () => {
  it('a plain wild mob 10+ levels below the player is trivial', () => {
    expect(MOBS.forest_wolf.elite || MOBS.forest_wolf.rare || MOBS.forest_wolf.boss).toBeFalsy();
    const mob = ent(10, { templateId: 'forest_wolf', level: 2 });
    const player = ent(1, { level: 12 });
    expect(isTrivialTo(mob, player)).toBe(true); // gap 10 >= 10
  });

  it('a gap under 10 is not trivial', () => {
    const mob = ent(10, { templateId: 'forest_wolf', level: 2 });
    const player = ent(1, { level: 11 });
    expect(isTrivialTo(mob, player)).toBe(false); // gap 9 < 10
  });

  it('a boss is never trivial regardless of the level gap', () => {
    expect(MOBS.deacon_varric.boss).toBe(true);
    const mob = ent(10, { templateId: 'deacon_varric', level: 2 });
    const player = ent(1, { level: 60 });
    expect(isTrivialTo(mob, player)).toBe(false);
  });
});
