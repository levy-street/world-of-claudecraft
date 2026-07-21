import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';

const SEED = 31337;
const makeSim = (cls: 'warrior' | 'mage' = 'warrior') => new Sim({ seed: SEED, playerClass: cls });

// Spawn a venomous spider adjacent to the player and hand it back.
function spawnSpider(sim: Sim, id = 970001, level = 4) {
  const p = sim.entities.get(sim.playerId)!;
  const mob = createMob(id, MOBS.webwood_spider, level, { x: p.pos.x, y: p.pos.y, z: p.pos.z });
  sim.entities.set(mob.id, mob);
  return mob;
}

// mobSwing rolls the hit table, so a single swing may miss/dodge. Swing in a
// loop until the target carries the venom aura (the chance is 1 in these tests).
function swingUntilVenom(sim: Sim, mob: any, target: any, tries = 40): boolean {
  for (let i = 0; i < tries; i++) {
    (sim as any).mobSwing(mob, target);
    if (target.auras.some((a: any) => a.id === 'venom_webwood_spider')) return true;
  }
  return false;
}

describe('mob venom (on-hit poison DoT)', () => {
  it('the Webwood Lurker carries venom data tuned to a nature DoT', () => {
    const v = MOBS.webwood_spider.venom!;
    expect(v).toBeDefined();
    expect(v.school).toBe('nature');
    expect(v.chance).toBeGreaterThan(0);
    expect(v.perTick).toBeGreaterThan(0);
    expect(v.interval).toBeGreaterThan(0);
    expect(v.duration).toBeGreaterThan(v.interval);
  });

  it('a landed venomous swing inflicts a poison DoT on the struck player', () => {
    const sim = makeSim();
    const player = sim.entities.get(sim.playerId)!;
    player.maxHp = 5000;
    player.hp = 5000;
    const mob = spawnSpider(sim);
    const orig = MOBS.webwood_spider.venom!.chance;
    MOBS.webwood_spider.venom!.chance = 1;
    try {
      expect(swingUntilVenom(sim, mob, player)).toBe(true);
    } finally {
      MOBS.webwood_spider.venom!.chance = orig;
    }
    const aura = player.auras.find((a) => a.id === 'venom_webwood_spider')!;
    expect(aura.kind).toBe('dot');
    expect(aura.school).toBe('nature');
    expect(aura.sourceId).toBe(mob.id);
    expect(aura.remaining).toBeCloseTo(MOBS.webwood_spider.venom!.duration);
  });

  it('the poison DoT ticks damage to the player over time', () => {
    const sim = makeSim();
    const player = sim.entities.get(sim.playerId)!;
    player.maxHp = 5000;
    player.hp = 5000;
    const mob = spawnSpider(sim);
    const orig = MOBS.webwood_spider.venom!.chance;
    MOBS.webwood_spider.venom!.chance = 1;
    try {
      expect(swingUntilVenom(sim, mob, player)).toBe(true);
    } finally {
      MOBS.webwood_spider.venom!.chance = orig;
    }
    // Park the mob out of melee so only the DoT (not swings) chips the player.
    mob.pos = { x: player.pos.x + 500, y: player.pos.y, z: player.pos.z };
    const before = player.hp;
    for (let i = 0; i < 20 * 3; i++) sim.tick(); // 3s — at least one tick interval
    expect(player.hp).toBeLessThan(before);
  });

  it('a non-venomous mob (forest wolf) applies no poison aura', () => {
    const sim = makeSim();
    const player = sim.entities.get(sim.playerId)!;
    player.maxHp = 5000;
    player.hp = 5000;
    const wolf = createMob(970050, MOBS.forest_wolf, 4, { x: player.pos.x, y: player.pos.y, z: player.pos.z });
    sim.entities.set(wolf.id, wolf);
    for (let i = 0; i < 40; i++) (sim as any).mobSwing(wolf, player);
    expect(player.auras.some((a) => a.kind === 'dot')).toBe(false);
  });

  it('refreshes (does not infinitely stack) on repeated bites from the same spider', () => {
    const sim = makeSim();
    const player = sim.entities.get(sim.playerId)!;
    player.maxHp = 5000;
    player.hp = 5000;
    const mob = spawnSpider(sim);
    const orig = MOBS.webwood_spider.venom!.chance;
    MOBS.webwood_spider.venom!.chance = 1;
    try {
      swingUntilVenom(sim, mob, player);
      swingUntilVenom(sim, mob, player);
      swingUntilVenom(sim, mob, player);
    } finally {
      MOBS.webwood_spider.venom!.chance = orig;
    }
    const venomAuras = player.auras.filter((a) => a.id === 'venom_webwood_spider');
    expect(venomAuras.length).toBe(1);
  });
});
