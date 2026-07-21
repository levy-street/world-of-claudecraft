import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import type { PlayerClass } from '../src/sim/types';

const SEED = 42;
// A mage victim at the troll's own level: low melee avoidance and no level gap, so
// the troll's swings land reliably (a big level gap would inflate miss/dodge and the
// on-hit roll would rarely fire). We top hp up each swing so a hit never kills.
const makeSim = (cls: PlayerClass = 'mage') => {
  const sim = new Sim({ seed: SEED, playerClass: cls, autoEquip: true });
  sim.setPlayerLevel(12);
  return sim;
};

const spawnTroll = (sim: Sim) => {
  const mob = createMob(990700, MOBS.fen_troll, 12, { x: 0, y: 0, z: 0 });
  sim.entities.set(mob.id, mob);
  return mob;
};

// Swing until the Withering Rot buff_agi debuff lands (a swing can miss/dodge).
const swingUntilWithered = (sim: Sim, mob: any, target: any, max = 300) => {
  for (let i = 0; i < max; i++) {
    target.hp = target.maxHp; // top up so a hit never kills (death clears auras)
    (sim as any).mobSwing(mob, target);
    if (target.auras.some((a: any) => a.kind === 'buff_agi' && a.value < 0)) return true;
  }
  return false;
};

describe('mob withering curse (Withering Rot)', () => {
  it('Mirefen Troll template carries the wither mechanic', () => {
    expect(MOBS.fen_troll.wither).toBeDefined();
    expect(MOBS.fen_troll.wither!.name).toBe('Withering Rot');
  });

  it('a landed hit applies a negative buff_agi aura with the template values', () => {
    const sim = makeSim();
    const player = sim.player;
    const mob = spawnTroll(sim);
    const wither = MOBS.fen_troll.wither!;
    const old = wither.chance;
    wither.chance = 1;
    try {
      expect(swingUntilWithered(sim, mob, player)).toBe(true);
    } finally {
      wither.chance = old;
    }
    const aura = player.auras.find((a) => a.kind === 'buff_agi');
    expect(aura).toBeDefined();
    expect(aura!.name).toBe('Withering Rot');
    expect(aura!.value).toBe(-wither.agi); // stored negative
    expect(aura!.sourceId).toBe(mob.id);
    expect(aura!.school).toBe('nature');
  });

  it('the curse lowers the victim Agility and thins their armor', () => {
    // A rogue has ample base Agility, so the drain lands without flooring at 0.
    // Apply the aura through the normal path (recalcPlayerStats runs on apply).
    const sim = makeSim('rogue');
    const player = sim.player;
    const mob = spawnTroll(sim);
    const agiBefore = player.stats.agi;
    const armorBefore = player.stats.armor;
    const wither = MOBS.fen_troll.wither!;
    expect(agiBefore).toBeGreaterThan(wither.agi); // precondition: no floor
    (sim as any).applyAura(player, {
      id: `wither_${mob.templateId}`, name: wither.name, kind: 'buff_agi',
      remaining: wither.duration, duration: wither.duration,
      value: -wither.agi, sourceId: mob.id, school: 'nature',
    });
    expect(player.stats.agi).toBe(agiBefore - wither.agi);
    // Agility feeds armor at 2 per point, so the drain shaves it too.
    expect(player.stats.armor).toBe(armorBefore - wither.agi * 2);
  });

  it('refreshes a single shared slot instead of stacking', () => {
    const sim = makeSim();
    const player = sim.player;
    const mob = spawnTroll(sim);
    const wither = MOBS.fen_troll.wither!;
    const old = wither.chance;
    wither.chance = 1;
    try {
      for (let i = 0; i < 5; i++) swingUntilWithered(sim, mob, player);
    } finally {
      wither.chance = old;
    }
    expect(player.auras.filter((a) => a.kind === 'buff_agi' && a.value < 0).length).toBe(1);
  });

  it('a friendly pet never curses its target (hostile guard)', () => {
    const sim = makeSim();
    const player = sim.player;
    const mob = spawnTroll(sim);
    mob.hostile = false; // emulate a tamed pet swinging through mobSwing
    const wither = MOBS.fen_troll.wither!;
    const old = wither.chance;
    wither.chance = 1;
    try {
      for (let i = 0; i < 80; i++) { player.hp = player.maxHp; (sim as any).mobSwing(mob, player); }
    } finally {
      wither.chance = old;
    }
    expect(player.auras.some((a) => a.kind === 'buff_agi' && a.value < 0)).toBe(false);
  });
});
