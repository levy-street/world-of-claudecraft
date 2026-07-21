import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import type { PlayerClass } from '../src/sim/types';

const SEED = 42;
// A mage so the victim is a mana user; level it up so Sister Nhalia's L12 elite
// swing never one-shots it (death would clear the aura before we can read it).
const makeSim = (cls: PlayerClass = 'mage') => {
  const sim = new Sim({ seed: SEED, playerClass: cls, autoEquip: true });
  sim.setPlayerLevel(20);
  return sim;
};

// Spawn Nhalia at the player's level so the hit table is even — an L12 elite
// swinging at an L20 mage misses almost every time, and the on-hit affix only
// fires on a connecting hit. The victim is set gm in the swing loops so her
// elite swing can't kill it mid-test (death clears auras).
const spawnNhalia = (sim: Sim) => {
  const mob = createMob(990700, MOBS.sister_nhalia, sim.player.level, { x: 0, y: 0, z: 0 });
  sim.entities.set(mob.id, mob);
  return mob;
};

// Spirit regen tick mirror (updateRegen): mana recovers by spi/3 + 4 + lvl/5.
const spiritRegen = (p: any) => Math.round(p.stats.spi / 3 + 4 + Math.floor(p.level / 5));

// Swing until the Spirit Siphon (negative buff_spi) debuff lands (a swing can miss/dodge).
const swingUntilSiphoned = (sim: Sim, mob: any, target: any, max = 300) => {
  target.gm = true; // invulnerable so an elite swing can't kill it (applyAura still lands)
  for (let i = 0; i < max; i++) {
    target.hp = target.maxHp; // top up so a hit never kills (death clears auras)
    (sim as any).mobSwing(mob, target);
    if (target.auras.some((a: any) => a.kind === 'buff_spi' && a.value < 0)) return true;
  }
  return false;
};

describe('mob Spirit Siphon (Sister Nhalia)', () => {
  it('Sister Nhalia template carries the siphonSpirit mechanic', () => {
    expect(MOBS.sister_nhalia.siphonSpirit).toBeDefined();
    expect(MOBS.sister_nhalia.siphonSpirit!.name).toBe('Spirit Siphon');
  });

  it('a landed hit applies a negative buff_spi aura with the template values', () => {
    const sim = makeSim();
    const player = sim.player;
    const mob = spawnNhalia(sim);
    const siphon = MOBS.sister_nhalia.siphonSpirit!;
    const old = siphon.chance;
    siphon.chance = 1;
    try {
      expect(swingUntilSiphoned(sim, mob, player)).toBe(true);
    } finally {
      siphon.chance = old;
    }
    const aura = player.auras.find((a) => a.kind === 'buff_spi');
    expect(aura).toBeDefined();
    expect(aura!.name).toBe('Spirit Siphon');
    expect(aura!.value).toBe(-siphon.spi); // stored negative
    expect(aura!.sourceId).toBe(mob.id);
    expect(aura!.school).toBe('shadow');
  });

  it('the siphon lowers Spirit and thus the out-of-combat mana regen rate', () => {
    const sim = makeSim();
    const player = sim.player;
    const mob = spawnNhalia(sim);
    const spiBefore = player.stats.spi;
    const regenBefore = spiritRegen(player);
    const siphon = MOBS.sister_nhalia.siphonSpirit!;
    const old = siphon.chance;
    siphon.chance = 1;
    try {
      swingUntilSiphoned(sim, mob, player);
    } finally {
      siphon.chance = old;
    }
    expect(player.stats.spi).toBe(spiBefore - siphon.spi);
    expect(spiritRegen(player)).toBeLessThan(regenBefore);
  });

  it('Spirit is floored at 0 even if the drain exceeds the victim pool', () => {
    const sim = makeSim();
    const player = sim.player;
    const mob = spawnNhalia(sim);
    const siphon = MOBS.sister_nhalia.siphonSpirit!;
    const oldChance = siphon.chance;
    const oldSpi = siphon.spi;
    siphon.chance = 1;
    siphon.spi = 100000; // absurd drain
    try {
      swingUntilSiphoned(sim, mob, player);
    } finally {
      siphon.chance = oldChance;
      siphon.spi = oldSpi;
    }
    expect(player.stats.spi).toBe(0);
    expect(player.stats.spi).toBeGreaterThanOrEqual(0);
  });

  it('refreshes a single shared slot instead of stacking', () => {
    const sim = makeSim();
    const player = sim.player;
    const mob = spawnNhalia(sim);
    const siphon = MOBS.sister_nhalia.siphonSpirit!;
    const old = siphon.chance;
    siphon.chance = 1;
    try {
      for (let i = 0; i < 5; i++) swingUntilSiphoned(sim, mob, player);
    } finally {
      siphon.chance = old;
    }
    expect(player.auras.filter((a) => a.kind === 'buff_spi' && a.value < 0).length).toBe(1);
  });

  it('never siphons a non-mana victim (warrior uses rage)', () => {
    const sim = makeSim('warrior');
    const player = sim.player;
    expect(player.resourceType).not.toBe('mana');
    const mob = spawnNhalia(sim);
    const siphon = MOBS.sister_nhalia.siphonSpirit!;
    const old = siphon.chance;
    siphon.chance = 1;
    try {
      for (let i = 0; i < 80; i++) { player.hp = player.maxHp; (sim as any).mobSwing(mob, player); }
    } finally {
      siphon.chance = old;
    }
    expect(player.auras.some((a) => a.kind === 'buff_spi')).toBe(false);
  });

  it('a friendly pet never siphons its target (hostile guard)', () => {
    const sim = makeSim();
    const player = sim.player;
    const mob = spawnNhalia(sim);
    mob.hostile = false; // emulate a tamed pet swinging through mobSwing
    const siphon = MOBS.sister_nhalia.siphonSpirit!;
    const old = siphon.chance;
    siphon.chance = 1;
    try {
      for (let i = 0; i < 80; i++) { player.hp = player.maxHp; (sim as any).mobSwing(mob, player); }
    } finally {
      siphon.chance = old;
    }
    expect(player.auras.some((a) => a.kind === 'buff_spi' && a.value < 0)).toBe(false);
  });
});
