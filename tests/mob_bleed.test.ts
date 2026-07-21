// Predators (e.g. the Ridge Stalker's "Rending Claws") can open a bleeding wound
// on a landed melee swing: a refreshing PHYSICAL damage-over-time. Bleed shares
// the on-hit DoT seam with venom, but is physical-school (not nature/poison), so
// it bypasses poison cleanses and ignores nature resistance.
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';

const SEED = 31337;
const makeSim = (cls: 'warrior' | 'mage' = 'warrior') => new Sim({ seed: SEED, playerClass: cls });

// Spawn a Ridge Stalker adjacent to the player and hand it back.
function spawnStalker(sim: Sim, id = 980001, level = 13) {
  const p = sim.entities.get(sim.playerId)!;
  const mob = createMob(id, MOBS.ridge_stalker, level, { x: p.pos.x, y: p.pos.y, z: p.pos.z });
  sim.entities.set(mob.id, mob);
  return mob;
}

// mobSwing rolls the hit table, so a single swing may miss/dodge. Swing in a
// loop until the target carries the bleed aura (the chance is 1 in these tests).
function swingUntilBleed(sim: Sim, mob: any, target: any, tries = 40): boolean {
  for (let i = 0; i < tries; i++) {
    (sim as any).mobSwing(mob, target);
    if (target.auras.some((a: any) => a.id === 'bleed_ridge_stalker')) return true;
  }
  return false;
}

describe('mob bleed (on-hit physical DoT)', () => {
  it('the Ridge Stalker carries bleed data tuned to a physical DoT', () => {
    const b = MOBS.ridge_stalker.bleed!;
    expect(b).toBeDefined();
    expect(b.school).toBe('physical');
    expect(b.chance).toBeGreaterThan(0);
    expect(b.perTick).toBeGreaterThan(0);
    expect(b.interval).toBeGreaterThan(0);
    expect(b.duration).toBeGreaterThan(b.interval);
  });

  it('a landed swing opens a physical-school bleed DoT on the struck player', () => {
    const sim = makeSim();
    const player = sim.entities.get(sim.playerId)!;
    player.maxHp = 5000;
    player.hp = 5000;
    const mob = spawnStalker(sim);
    const orig = MOBS.ridge_stalker.bleed!.chance;
    MOBS.ridge_stalker.bleed!.chance = 1;
    try {
      expect(swingUntilBleed(sim, mob, player)).toBe(true);
    } finally {
      MOBS.ridge_stalker.bleed!.chance = orig;
    }
    const aura = player.auras.find((a) => a.id === 'bleed_ridge_stalker')!;
    expect(aura.kind).toBe('dot');
    expect(aura.school).toBe('physical');
    expect(aura.sourceId).toBe(mob.id);
    expect(aura.remaining).toBeCloseTo(MOBS.ridge_stalker.bleed!.duration);
  });

  it('the bleed DoT ticks damage to the player over time', () => {
    const sim = makeSim();
    const player = sim.entities.get(sim.playerId)!;
    player.maxHp = 5000;
    player.hp = 5000;
    const mob = spawnStalker(sim);
    const orig = MOBS.ridge_stalker.bleed!.chance;
    MOBS.ridge_stalker.bleed!.chance = 1;
    try {
      expect(swingUntilBleed(sim, mob, player)).toBe(true);
    } finally {
      MOBS.ridge_stalker.bleed!.chance = orig;
    }
    // Park the mob out of melee so only the DoT (not swings) chips the player.
    mob.pos = { x: player.pos.x + 500, y: player.pos.y, z: player.pos.z };
    const before = player.hp;
    for (let i = 0; i < 20 * 4; i++) sim.tick(); // 4s — at least one tick interval
    expect(player.hp).toBeLessThan(before);
  });

  it('a non-bleeding mob (forest wolf) opens no bleed aura', () => {
    const sim = makeSim();
    const player = sim.entities.get(sim.playerId)!;
    player.maxHp = 5000;
    player.hp = 5000;
    const wolf = createMob(980050, MOBS.forest_wolf, 4, { x: player.pos.x, y: player.pos.y, z: player.pos.z });
    sim.entities.set(wolf.id, wolf);
    for (let i = 0; i < 40; i++) (sim as any).mobSwing(wolf, player);
    expect(player.auras.some((a) => a.id === 'bleed_ridge_stalker')).toBe(false);
  });

  it('refreshes (does not infinitely stack) on repeated swipes from the same stalker', () => {
    const sim = makeSim();
    const player = sim.entities.get(sim.playerId)!;
    player.maxHp = 5000;
    player.hp = 5000;
    const mob = spawnStalker(sim);
    // Applying the bleed runs applyAura -> recalcPlayerStats, which resets the
    // test's inflated maxHp back to the real (low) level-1 value. A normal stalker
    // swing would then kill the player before the third swipe, and death clears
    // the aura — masking the refresh-vs-stack behaviour under test. Neutralise the
    // swing's damage (a 0-damage landed hit still rolls the hit table and opens the
    // bleed) so the three swipes isolate the refresh.
    mob.weapon = { ...mob.weapon, min: 0, max: 0, speed: 0 };
    const orig = MOBS.ridge_stalker.bleed!.chance;
    MOBS.ridge_stalker.bleed!.chance = 1;
    try {
      swingUntilBleed(sim, mob, player);
      swingUntilBleed(sim, mob, player);
      swingUntilBleed(sim, mob, player);
    } finally {
      MOBS.ridge_stalker.bleed!.chance = orig;
    }
    const bleedAuras = player.auras.filter((a) => a.id === 'bleed_ridge_stalker');
    expect(bleedAuras.length).toBe(1);
  });
});
