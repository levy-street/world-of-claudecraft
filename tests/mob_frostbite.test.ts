import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';

const SEED = 31337;
const makeSim = (cls: 'warrior' | 'mage' = 'warrior') => new Sim({ seed: SEED, playerClass: cls });

// Spawn a Shardlord adjacent to the player and hand it back.
function spawnShardlord(sim: Sim, id = 970601, level = 18) {
  const p = sim.entities.get(sim.playerId)!;
  const mob = createMob(id, MOBS.shardlord_kazzix, level, { x: p.pos.x, y: p.pos.y, z: p.pos.z });
  sim.entities.set(mob.id, mob);
  return mob;
}

// mobSwing rolls the hit table, so a single swing may miss/dodge. Swing in a
// loop until the target carries the frostbite aura (the chance is 1 in these tests).
function swingUntilFrostbite(sim: Sim, mob: any, target: any, tries = 40): boolean {
  for (let i = 0; i < tries; i++) {
    (sim as any).mobSwing(mob, target);
    if (target.auras.some((a: any) => a.id === 'frostbite_shardlord_kazzix')) return true;
  }
  return false;
}

describe('mob frostbite (on-hit frost DoT)', () => {
  it('Shardlord Kazzix carries frostbite data tuned to a frost DoT', () => {
    const f = MOBS.shardlord_kazzix.frostbite!;
    expect(f).toBeDefined();
    expect(f.school).toBe('frost');
    expect(f.chance).toBeGreaterThan(0);
    expect(f.perTick).toBeGreaterThan(0);
    expect(f.interval).toBeGreaterThan(0);
    expect(f.duration).toBeGreaterThan(f.interval);
  });

  it('a landed frostbitten swing inflicts a frost DoT on the struck player', () => {
    const sim = makeSim();
    const player = sim.entities.get(sim.playerId)!;
    player.maxHp = 5000;
    player.hp = 5000;
    const mob = spawnShardlord(sim);
    const orig = MOBS.shardlord_kazzix.frostbite!.chance;
    MOBS.shardlord_kazzix.frostbite!.chance = 1;
    try {
      expect(swingUntilFrostbite(sim, mob, player)).toBe(true);
    } finally {
      MOBS.shardlord_kazzix.frostbite!.chance = orig;
    }
    const aura = player.auras.find((a) => a.id === 'frostbite_shardlord_kazzix')!;
    expect(aura.kind).toBe('dot');
    expect(aura.school).toBe('frost');
    expect(aura.sourceId).toBe(mob.id);
    expect(aura.remaining).toBeCloseTo(MOBS.shardlord_kazzix.frostbite!.duration);
  });

  it('the frost DoT ticks damage to the player over time', () => {
    const sim = makeSim();
    const player = sim.entities.get(sim.playerId)!;
    player.maxHp = 5000;
    player.hp = 5000;
    const mob = spawnShardlord(sim);
    const orig = MOBS.shardlord_kazzix.frostbite!.chance;
    MOBS.shardlord_kazzix.frostbite!.chance = 1;
    try {
      expect(swingUntilFrostbite(sim, mob, player)).toBe(true);
    } finally {
      MOBS.shardlord_kazzix.frostbite!.chance = orig;
    }
    // Park the mob out of melee so only the DoT (not swings) chips the player.
    mob.pos = { x: player.pos.x + 500, y: player.pos.y, z: player.pos.z };
    const before = player.hp;
    // interval is 3s; tick well past it (8s) so the DoT outpaces out-of-combat regen.
    for (let i = 0; i < 20 * 8; i++) sim.tick();
    expect(player.hp).toBeLessThan(before);
  });

  it('a non-frostbitten mob (forest wolf) applies no frost DoT aura', () => {
    const sim = makeSim();
    const player = sim.entities.get(sim.playerId)!;
    player.maxHp = 5000;
    player.hp = 5000;
    const wolf = createMob(970650, MOBS.forest_wolf, 4, { x: player.pos.x, y: player.pos.y, z: player.pos.z });
    sim.entities.set(wolf.id, wolf);
    for (let i = 0; i < 40; i++) (sim as any).mobSwing(wolf, player);
    expect(player.auras.some((a) => a.id === 'frostbite_forest_wolf')).toBe(false);
  });

  it('refreshes (does not infinitely stack) on repeated strikes from the same Shardlord', () => {
    const sim = makeSim();
    const player = sim.entities.get(sim.playerId)!;
    // Shardlord Kazzix is a level-18 elite; god-mode the dummy so the barrage of forced
    // swings can't kill it (death clears all auras). A raw maxHp bump won't do — the tick's
    // recalcPlayerStats re-derives maxHp from stamina and wipes it; gm survives + still takes auras.
    (player as any).gm = true;
    const mob = spawnShardlord(sim);
    const orig = MOBS.shardlord_kazzix.frostbite!.chance;
    MOBS.shardlord_kazzix.frostbite!.chance = 1;
    try {
      swingUntilFrostbite(sim, mob, player);
      swingUntilFrostbite(sim, mob, player);
      swingUntilFrostbite(sim, mob, player);
    } finally {
      MOBS.shardlord_kazzix.frostbite!.chance = orig;
    }
    const frostAuras = player.auras.filter((a) => a.id === 'frostbite_shardlord_kazzix');
    expect(frostAuras.length).toBe(1);
  });
});
