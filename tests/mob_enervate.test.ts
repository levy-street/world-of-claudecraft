import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import type { PlayerClass } from '../src/sim/types';

const SEED = 42;
// Level the victim to 20 so a L18 Boneclad Revenant's swing never one-shots it
// (death would clear the aura before we can read it).
const makeSim = (cls: PlayerClass = 'warrior') => {
  const sim = new Sim({ seed: SEED, playerClass: cls, autoEquip: true });
  sim.setPlayerLevel(20);
  return sim;
};

const spawnRevenant = (sim: Sim) => {
  const mob = createMob(990800, MOBS.boneclad_revenant, 18, { x: 0, y: 0, z: 0 });
  sim.entities.set(mob.id, mob);
  return mob;
};

// Swing until the Soul Siphon buff_sta debuff lands (a swing can miss/dodge).
const swingUntilDrained = (sim: Sim, mob: any, target: any, max = 300) => {
  for (let i = 0; i < max; i++) {
    target.hp = target.maxHp; // top up so a hit never kills (death clears auras)
    (sim as any).mobSwing(mob, target);
    if (target.auras.some((a: any) => a.kind === 'buff_sta' && a.value < 0)) return true;
  }
  return false;
};

describe('mob vitality drain (Soul Siphon)', () => {
  it('Boneclad Revenant template carries the enervate mechanic', () => {
    expect(MOBS.boneclad_revenant.enervate).toBeDefined();
    expect(MOBS.boneclad_revenant.enervate!.name).toBe('Soul Siphon');
  });

  it('a landed hit applies a negative buff_sta aura with the template values', () => {
    const sim = makeSim();
    const player = sim.player;
    const mob = spawnRevenant(sim);
    const enervate = MOBS.boneclad_revenant.enervate!;
    const old = enervate.chance;
    enervate.chance = 1;
    try {
      expect(swingUntilDrained(sim, mob, player)).toBe(true);
    } finally {
      enervate.chance = old;
    }
    const aura = player.auras.find((a) => a.kind === 'buff_sta');
    expect(aura).toBeDefined();
    expect(aura!.name).toBe('Soul Siphon');
    expect(aura!.value).toBe(-enervate.sta); // stored negative
    expect(aura!.sourceId).toBe(mob.id);
    expect(aura!.school).toBe('shadow');
  });

  it('the drain lowers the victim Stamina and shrinks their max-HP pool', () => {
    const sim = makeSim();
    const player = sim.player;
    const mob = spawnRevenant(sim);
    const staBefore = player.stats.sta;
    const maxHpBefore = player.maxHp;
    const enervate = MOBS.boneclad_revenant.enervate!;
    const old = enervate.chance;
    enervate.chance = 1;
    try {
      swingUntilDrained(sim, mob, player);
    } finally {
      enervate.chance = old;
    }
    expect(player.stats.sta).toBe(staBefore - enervate.sta);
    expect(player.maxHp).toBeLessThan(maxHpBefore);
  });

  it('hits every class, not just mana users (warrior gets drained)', () => {
    const sim = makeSim('warrior');
    const player = sim.player;
    expect(player.resourceType).not.toBe('mana');
    const mob = spawnRevenant(sim);
    const enervate = MOBS.boneclad_revenant.enervate!;
    const old = enervate.chance;
    enervate.chance = 1;
    try {
      expect(swingUntilDrained(sim, mob, player)).toBe(true);
    } finally {
      enervate.chance = old;
    }
    expect(player.auras.some((a) => a.kind === 'buff_sta' && a.value < 0)).toBe(true);
  });

  it('never drops the victim below 1 HP (drain cannot kill outright)', () => {
    const sim = makeSim();
    const player = sim.player;
    const mob = spawnRevenant(sim);
    const enervate = MOBS.boneclad_revenant.enervate!;
    const old = enervate.chance;
    enervate.chance = 1;
    try {
      swingUntilDrained(sim, mob, player);
    } finally {
      enervate.chance = old;
    }
    expect(player.hp).toBeGreaterThanOrEqual(1);
  });

  it('refreshes a single shared slot instead of stacking', () => {
    const sim = makeSim();
    const player = sim.player;
    const mob = spawnRevenant(sim);
    const enervate = MOBS.boneclad_revenant.enervate!;
    const old = enervate.chance;
    enervate.chance = 1;
    try {
      for (let i = 0; i < 5; i++) swingUntilDrained(sim, mob, player);
    } finally {
      enervate.chance = old;
    }
    expect(player.auras.filter((a) => a.kind === 'buff_sta' && a.value < 0).length).toBe(1);
  });

  it('a friendly pet never drains its target (hostile guard)', () => {
    const sim = makeSim();
    const player = sim.player;
    const mob = spawnRevenant(sim);
    mob.hostile = false; // emulate a tamed pet swinging through mobSwing
    const enervate = MOBS.boneclad_revenant.enervate!;
    const old = enervate.chance;
    enervate.chance = 1;
    try {
      for (let i = 0; i < 80; i++) { player.hp = player.maxHp; (sim as any).mobSwing(mob, player); }
    } finally {
      enervate.chance = old;
    }
    expect(player.auras.some((a) => a.kind === 'buff_sta' && a.value < 0)).toBe(false);
  });
});
