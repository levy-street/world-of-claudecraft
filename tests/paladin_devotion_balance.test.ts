import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

type PaladinSpec = 'holy' | 'protection' | 'retribution';

const PRIORITY: Readonly<Record<PaladinSpec, readonly string[]>> = {
  holy: ['radiant_chorus', 'hammer_of_grace', 'dawns_embrace', 'mercy_lance', 'holy_light'],
  protection: ['sunward_disc', 'consecration', 'vowkeeper_strike', 'hammer_of_grace'],
  retribution: ['hammer_of_wrath', 'final_edict', 'dawnfall', 'hammer_of_grace'],
};

// Re-pinned for the v0.32.1 catch-up (both stay inside the 35-65 contract):
// holy 42.3 to 41.25; retribution 46.85 to 54.35. The retribution slowdown is
// main's hammer_of_wrath execute gate thinning the rotation's Devotion grants
// above 20% target health; flagged for the owner's review, band intact.
// Re-pinned for the v0.36 composition: holy 41.25 to 42.45, protection 38.65
// to 38.1, retribution 54.35 to 48.35. The wide 35-65s design band still holds.
const EXPECTED_SECONDS: Readonly<Record<PaladinSpec, number>> = {
  holy: 42.45,
  protection: 38.1,
  retribution: 48.35,
};

function addDummy(sim: Sim): Entity {
  const player = sim.player;
  const dummy = createMob(9700, MOBS.training_dummy, 20, {
    x: player.pos.x,
    y: player.pos.y,
    z: player.pos.z + 2,
  });
  dummy.maxHp = dummy.hp = 1_000_000_000;
  (sim as unknown as { addEntity(entity: Entity): void }).addEntity(dummy);
  return dummy;
}

function isFree(player: Entity): boolean {
  return player.castingAbility === null && player.gcdRemaining <= 1e-6;
}

function castFirstReady(
  sim: Sim,
  ids: readonly string[],
  target: Entity,
  hostileTarget = target,
): void {
  const player = sim.player;
  for (const id of ids) {
    const beforeGcd = player.gcdRemaining;
    const targetsEnemy = id === 'mercy_lance' || id === 'hammer_of_grace';
    sim.targetEntity(targetsEnemy ? hostileTarget.id : target.id);
    sim.castAbility(id);
    if (player.castingAbility === id || player.gcdRemaining > beforeGcd) return;
  }
}

function secondsToTwenty(spec: PaladinSpec): number {
  const sim = new Sim({ seed: 53, playerClass: 'paladin', autoEquip: true });
  sim.setPlayerLevel(20);
  sim.setSpec(spec);
  if (spec === 'protection') {
    sim.addItem('eastbrook_buckler', 1);
    sim.equipItem('eastbrook_buckler');
  }
  sim.tick();
  const player = sim.player;
  let target: Entity;
  let hostileTarget: Entity;
  if (spec === 'holy') {
    const allyId = sim.addPlayer('warrior', 'Test Ally');
    const ally = sim.entities.get(allyId);
    if (!ally) throw new Error('missing Holy rotation test ally');
    sim.partyInvite(allyId, sim.player.id);
    sim.partyAccept(allyId);
    target = ally;
    hostileTarget = addDummy(sim);
  } else {
    target = addDummy(sim);
    hostileTarget = target;
  }

  for (let tick = 0; tick < 90 * 20; tick++) {
    if (spec === 'holy') target.hp = 1;
    if (isFree(player)) castFirstReady(sim, PRIORITY[spec], target, hostileTarget);
    sim.tick();
    if ((player.paladinDevotion?.value ?? 0) >= 20) return (tick + 1) / 20;
  }
  return Infinity;
}

function protectionSecondsToTwentyWhileBlocking(): { seconds: number; devotionFromBlocks: number } {
  const sim = new Sim({ seed: 61, playerClass: 'paladin', autoEquip: true });
  sim.setPlayerLevel(20);
  sim.setSpec('protection');
  sim.addItem('eastbrook_buckler', 1);
  sim.equipItem('eastbrook_buckler');
  sim.tick();

  const player = sim.player;
  const attacker = addDummy(sim);
  attacker.weapon = { min: 1, max: 1, speed: 2 };
  attacker.attackPower = 0;
  player.facing = 0;
  player.dodgeChance = 0;
  player.blockChance = 1;
  player.stats.armor = 0;
  sim.rng.next = () => 0.9;

  const mobSwing = (sim as unknown as { mobSwing(attacker: Entity, target: Entity): void })
    .mobSwing;
  let devotionFromBlocks = 0;
  for (let tick = 0; tick < 90 * 20; tick++) {
    player.hp = player.maxHp;
    if (tick % 40 === 0) {
      const before = player.paladinDevotion?.value ?? 0;
      mobSwing.call(sim, attacker, player);
      if ((player.paladinDevotion?.value ?? 0) > before) devotionFromBlocks++;
    }
    if (isFree(player)) castFirstReady(sim, PRIORITY.protection, attacker);
    sim.tick();
    if ((player.paladinDevotion?.value ?? 0) >= 20) {
      return { seconds: (tick + 1) / 20, devotionFromBlocks };
    }
  }
  return { seconds: Infinity, devotionFromBlocks };
}

describe('Paladin Devotion rotation pacing', () => {
  it.each(['holy', 'protection', 'retribution'] as const)(
    '%s reaches Ascension readiness in 35 to 65 seconds when each effective cast grants one',
    (spec) => {
      const seconds = secondsToTwenty(spec);
      expect(seconds).toBeGreaterThanOrEqual(35);
      expect(seconds).toBeLessThanOrEqual(65);
      expect(seconds).toBeCloseTo(EXPECTED_SECONDS[spec], 5);
    },
  );

  it('keeps Protection in the target cadence while earning Devotion from real blocks', () => {
    const result = protectionSecondsToTwentyWhileBlocking();
    expect(result.devotionFromBlocks).toBeGreaterThan(0);
    expect(result.seconds).toBeGreaterThanOrEqual(29);
    expect(result.seconds).toBeLessThanOrEqual(65);
    expect(result.seconds).toBeCloseTo(29.65, 5);
    expect(result.seconds).toBeLessThan(EXPECTED_SECONDS.protection);
  });
});
