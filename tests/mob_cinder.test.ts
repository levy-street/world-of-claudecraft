import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';

const SEED = 31337;
const makeSim = (cls: 'warrior' | 'mage' = 'warrior') => new Sim({ seed: SEED, playerClass: cls });

// Spawn an Ironvein Sapper adjacent to the player and hand it back.
function spawnSapper(sim: Sim, id = 980001, level = 16) {
  const p = sim.entities.get(sim.playerId)!;
  const mob = createMob(id, MOBS.ironvein_sapper, level, { x: p.pos.x, y: p.pos.y, z: p.pos.z });
  sim.entities.set(mob.id, mob);
  return mob;
}

// mobSwing rolls the hit table, so a single swing may miss/dodge. Swing in a
// loop until the target carries the cinder aura (the chance is 1 in these tests).
function swingUntilCinder(sim: Sim, mob: any, target: any, tries = 60): boolean {
  for (let i = 0; i < tries; i++) {
    (sim as any).mobSwing(mob, target);
    if (target.auras.some((a: any) => a.id === 'cinder_ironvein_sapper')) return true;
  }
  return false;
}

describe('mob cinder (on-hit fire DoT)', () => {
  it('the Ironvein Sapper carries cinder data tuned to a fire DoT', () => {
    const c = MOBS.ironvein_sapper.cinder!;
    expect(c).toBeDefined();
    expect(c.school).toBe('fire');
    expect(c.chance).toBeGreaterThan(0);
    expect(c.perTick).toBeGreaterThan(0);
    expect(c.interval).toBeGreaterThan(0);
    expect(c.duration).toBeGreaterThan(c.interval);
  });

  it('a landed swing sets a burning DoT on the struck player', () => {
    const sim = makeSim();
    const player = sim.entities.get(sim.playerId)!;
    player.maxHp = 5000;
    player.hp = 5000;
    const mob = spawnSapper(sim);
    const orig = MOBS.ironvein_sapper.cinder!.chance;
    MOBS.ironvein_sapper.cinder!.chance = 1;
    try {
      expect(swingUntilCinder(sim, mob, player)).toBe(true);
    } finally {
      MOBS.ironvein_sapper.cinder!.chance = orig;
    }
    const aura = player.auras.find((a) => a.id === 'cinder_ironvein_sapper')!;
    expect(aura.kind).toBe('dot');
    expect(aura.school).toBe('fire');
    expect(aura.sourceId).toBe(mob.id);
    expect(aura.remaining).toBeCloseTo(MOBS.ironvein_sapper.cinder!.duration);
  });

  it('the burning DoT ticks damage to the player over time', () => {
    const sim = makeSim();
    const player = sim.entities.get(sim.playerId)!;
    player.maxHp = 5000;
    player.hp = 5000;
    const mob = spawnSapper(sim);
    const orig = MOBS.ironvein_sapper.cinder!.chance;
    MOBS.ironvein_sapper.cinder!.chance = 1;
    try {
      expect(swingUntilCinder(sim, mob, player)).toBe(true);
    } finally {
      MOBS.ironvein_sapper.cinder!.chance = orig;
    }
    // Park the mob out of melee so only the DoT (not swings) chips the player.
    mob.pos = { x: player.pos.x + 500, y: player.pos.y, z: player.pos.z };
    const before = player.hp;
    for (let i = 0; i < 20 * 4; i++) sim.tick(); // 4s — past one tick interval, beats regen
    expect(player.hp).toBeLessThan(before);
  });

  it('a non-cinder mob (forest wolf) sets no burning aura', () => {
    const sim = makeSim();
    const player = sim.entities.get(sim.playerId)!;
    player.maxHp = 5000;
    player.hp = 5000;
    const wolf = createMob(980050, MOBS.forest_wolf, 16, { x: player.pos.x, y: player.pos.y, z: player.pos.z });
    sim.entities.set(wolf.id, wolf);
    for (let i = 0; i < 60; i++) (sim as any).mobSwing(wolf, player);
    expect(player.auras.some((a) => a.id === 'cinder_forest_wolf')).toBe(false);
  });

  it('refreshes (does not infinitely stack) on repeated hits from the same sapper', () => {
    const sim = makeSim();
    const player = sim.entities.get(sim.playerId)!;
    player.maxHp = 5000;
    player.hp = 5000;
    // The sapper hits hard at L16, and applyAura re-derives maxHp from stamina
    // (wiping any raw hp override), so a plain pool gets ground down across the
    // ~180 swings below. gm keeps the player invulnerable; the cinder roll fires
    // independently of damage landing, so the aura still applies.
    player.gm = true;
    const mob = spawnSapper(sim);
    const orig = MOBS.ironvein_sapper.cinder!.chance;
    MOBS.ironvein_sapper.cinder!.chance = 1;
    try {
      swingUntilCinder(sim, mob, player);
      swingUntilCinder(sim, mob, player);
      swingUntilCinder(sim, mob, player);
    } finally {
      MOBS.ironvein_sapper.cinder!.chance = orig;
    }
    const cinderAuras = player.auras.filter((a) => a.id === 'cinder_ironvein_sapper');
    expect(cinderAuras.length).toBe(1);
  });
});
