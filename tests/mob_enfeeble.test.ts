import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import type { PlayerClass } from '../src/sim/types';

const SEED = 42;
// A mage so the victim is a mana user; level it up so a L17 Zealot's swing
// never one-shots it (death would clear the aura before we can read it).
const makeSim = (cls: PlayerClass = 'mage') => {
  const sim = new Sim({ seed: SEED, playerClass: cls, autoEquip: true });
  sim.setPlayerLevel(20);
  return sim;
};

const spawnZealot = (sim: Sim) => {
  const mob = createMob(990600, MOBS.wyrmcult_zealot, 17, { x: 0, y: 0, z: 0 });
  sim.entities.set(mob.id, mob);
  return mob;
};

// Swing until the maddening-whisper buff_int debuff lands (a swing can miss/dodge).
const swingUntilCursed = (sim: Sim, mob: any, target: any, max = 300) => {
  for (let i = 0; i < max; i++) {
    target.hp = target.maxHp; // top up so a hit never kills (death clears auras)
    (sim as any).mobSwing(mob, target);
    if (target.auras.some((a: any) => a.kind === 'buff_int' && a.value < 0)) return true;
  }
  return false;
};

describe('mob enfeebling curse (Maddening Whisper)', () => {
  it('Wyrmcult Zealot template carries the enfeeble mechanic', () => {
    expect(MOBS.wyrmcult_zealot.enfeeble).toBeDefined();
    expect(MOBS.wyrmcult_zealot.enfeeble!.name).toBe('Maddening Whisper');
  });

  it('a landed hit applies a negative buff_int aura with the template values', () => {
    const sim = makeSim();
    const player = sim.player;
    const mob = spawnZealot(sim);
    const enfeeble = MOBS.wyrmcult_zealot.enfeeble!;
    const old = enfeeble.chance;
    enfeeble.chance = 1;
    try {
      expect(swingUntilCursed(sim, mob, player)).toBe(true);
    } finally {
      enfeeble.chance = old;
    }
    const aura = player.auras.find((a) => a.kind === 'buff_int');
    expect(aura).toBeDefined();
    expect(aura!.name).toBe('Maddening Whisper');
    expect(aura!.value).toBe(-enfeeble.int); // stored negative
    expect(aura!.sourceId).toBe(mob.id);
    expect(aura!.school).toBe('shadow');
  });

  it('the curse lowers the victim Intellect and shrinks their mana pool', () => {
    const sim = makeSim();
    const player = sim.player;
    const mob = spawnZealot(sim);
    const intBefore = player.stats.int;
    const maxManaBefore = player.maxResource;
    const enfeeble = MOBS.wyrmcult_zealot.enfeeble!;
    const old = enfeeble.chance;
    enfeeble.chance = 1;
    try {
      swingUntilCursed(sim, mob, player);
    } finally {
      enfeeble.chance = old;
    }
    expect(player.stats.int).toBe(intBefore - enfeeble.int);
    expect(player.maxResource).toBeLessThan(maxManaBefore);
  });

  it('refreshes a single shared slot instead of stacking', () => {
    const sim = makeSim();
    const player = sim.player;
    const mob = spawnZealot(sim);
    const enfeeble = MOBS.wyrmcult_zealot.enfeeble!;
    const old = enfeeble.chance;
    enfeeble.chance = 1;
    try {
      for (let i = 0; i < 5; i++) swingUntilCursed(sim, mob, player);
    } finally {
      enfeeble.chance = old;
    }
    expect(player.auras.filter((a) => a.kind === 'buff_int' && a.value < 0).length).toBe(1);
  });

  it('never curses a non-mana victim (warrior uses rage)', () => {
    const sim = makeSim('warrior');
    const player = sim.player;
    expect(player.resourceType).not.toBe('mana');
    const mob = spawnZealot(sim);
    const enfeeble = MOBS.wyrmcult_zealot.enfeeble!;
    const old = enfeeble.chance;
    enfeeble.chance = 1;
    try {
      for (let i = 0; i < 80; i++) { player.hp = player.maxHp; (sim as any).mobSwing(mob, player); }
    } finally {
      enfeeble.chance = old;
    }
    expect(player.auras.some((a) => a.kind === 'buff_int')).toBe(false);
  });

  it('a friendly pet never curses its target (hostile guard)', () => {
    const sim = makeSim();
    const player = sim.player;
    const mob = spawnZealot(sim);
    mob.hostile = false; // emulate a tamed pet swinging through mobSwing
    const enfeeble = MOBS.wyrmcult_zealot.enfeeble!;
    const old = enfeeble.chance;
    enfeeble.chance = 1;
    try {
      for (let i = 0; i < 80; i++) { player.hp = player.maxHp; (sim as any).mobSwing(mob, player); }
    } finally {
      enfeeble.chance = old;
    }
    expect(player.auras.some((a) => a.kind === 'buff_int' && a.value < 0)).toBe(false);
  });
});
