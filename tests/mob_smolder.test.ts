import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';

const SEED = 31337;
const makeSim = (cls: 'warrior' | 'mage' = 'warrior') => new Sim({ seed: SEED, playerClass: cls });

// Spawn an Ironvein Sapper adjacent to the player and hand it back. Spawned near
// the player's level so the hit table lands reliably (a big level gap inflates miss).
function spawnSapper(sim: Sim, id = 980001, level = 5) {
  const p = sim.entities.get(sim.playerId)!;
  const mob = createMob(id, MOBS.ironvein_sapper, level, { x: p.pos.x, y: p.pos.y, z: p.pos.z });
  sim.entities.set(mob.id, mob);
  return mob;
}

// mobSwing rolls the hit table, so a single swing may miss/dodge. Swing in a
// loop until the target carries the smolder aura (the chance is forced to 1 here).
function swingUntilSmolder(sim: Sim, mob: any, target: any, tries = 40): boolean {
  for (let i = 0; i < tries; i++) {
    (sim as any).mobSwing(mob, target);
    if (target.auras.some((a: any) => a.id === 'smolder_ironvein_sapper')) return true;
  }
  return false;
}

describe('mob smolder (on-hit fire DoT)', () => {
  it('the Ironvein Sapper carries smolder data tuned to a fire DoT', () => {
    const s = MOBS.ironvein_sapper.smolder!;
    expect(s).toBeDefined();
    expect(s.name).toBe('Smoldering Fuse');
    expect(s.chance).toBeGreaterThan(0);
    expect(s.perTick).toBeGreaterThan(0);
    expect(s.interval).toBeGreaterThan(0);
    expect(s.duration).toBeGreaterThan(s.interval);
  });

  it('a landed swing ignites a fire DoT on the struck player', () => {
    const sim = makeSim();
    const player = sim.entities.get(sim.playerId)!;
    player.maxHp = 5000;
    player.hp = 5000;
    const mob = spawnSapper(sim);
    const orig = MOBS.ironvein_sapper.smolder!.chance;
    MOBS.ironvein_sapper.smolder!.chance = 1;
    try {
      expect(swingUntilSmolder(sim, mob, player)).toBe(true);
    } finally {
      MOBS.ironvein_sapper.smolder!.chance = orig;
    }
    const aura = player.auras.find((a) => a.id === 'smolder_ironvein_sapper')!;
    expect(aura.kind).toBe('dot');
    expect(aura.school).toBe('fire');
    expect(aura.sourceId).toBe(mob.id);
    expect(aura.remaining).toBeCloseTo(MOBS.ironvein_sapper.smolder!.duration);
  });

  it('the fire DoT ticks damage to the player over time', () => {
    const sim = makeSim();
    const player = sim.entities.get(sim.playerId)!;
    player.maxHp = 5000;
    player.hp = 5000;
    const mob = spawnSapper(sim);
    const orig = MOBS.ironvein_sapper.smolder!.chance;
    MOBS.ironvein_sapper.smolder!.chance = 1;
    try {
      expect(swingUntilSmolder(sim, mob, player)).toBe(true);
    } finally {
      MOBS.ironvein_sapper.smolder!.chance = orig;
    }
    // Park the mob out of melee so only the DoT (not swings) chips the player.
    mob.pos = { x: player.pos.x + 500, y: player.pos.y, z: player.pos.z };
    const before = player.hp;
    // interval = 3s; run ~7s so the DoT outpaces any out-of-combat regen.
    for (let i = 0; i < 20 * 7; i++) sim.tick();
    expect(player.hp).toBeLessThan(before);
  });

  it('a non-smoldering mob (forest wolf) applies no fire DoT', () => {
    const sim = makeSim();
    const player = sim.entities.get(sim.playerId)!;
    player.maxHp = 5000;
    player.hp = 5000;
    const wolf = createMob(980050, MOBS.forest_wolf, 5, { x: player.pos.x, y: player.pos.y, z: player.pos.z });
    sim.entities.set(wolf.id, wolf);
    for (let i = 0; i < 40; i++) (sim as any).mobSwing(wolf, player);
    expect(player.auras.some((a) => a.kind === 'dot')).toBe(false);
  });

  it('refreshes (does not infinitely stack) on repeated hits from the same sapper', () => {
    const sim = makeSim();
    const player = sim.entities.get(sim.playerId)!;
    player.maxHp = 5000;
    player.hp = 5000;
    const mob = spawnSapper(sim);
    const orig = MOBS.ironvein_sapper.smolder!.chance;
    MOBS.ironvein_sapper.smolder!.chance = 1;
    try {
      swingUntilSmolder(sim, mob, player);
      swingUntilSmolder(sim, mob, player);
      swingUntilSmolder(sim, mob, player);
    } finally {
      MOBS.ironvein_sapper.smolder!.chance = orig;
    }
    const auras = player.auras.filter((a) => a.id === 'smolder_ironvein_sapper');
    expect(auras.length).toBe(1);
  });
});
