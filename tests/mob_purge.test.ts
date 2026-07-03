import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob, recalcPlayerStats } from '../src/sim/entity';
import { devourBeneficialAura } from '../src/sim/mob/mob_swing';
import { Sim } from '../src/sim/sim';
import type { Aura, PlayerClass } from '../src/sim/types';

const SEED = 42;

const makeSim = (cls: PlayerClass = 'warrior') => {
  const sim = new Sim({ seed: SEED, playerClass: cls, autoEquip: true });
  sim.setPlayerLevel(20);
  return sim;
};

// Grubjaw at the player's level so its swings land on an even hit table.
const spawnGrubjaw = (sim: Sim) => {
  const mob = createMob(990700, MOBS.grubjaw, 20, { x: 0, y: 0, z: 0 });
  sim.entities.set(mob.id, mob);
  return mob;
};

const pushBuff = (target: any, kind: Aura['kind'], value: number, id = `test_${kind}`) => {
  const aura: Aura = {
    id,
    name: 'Test Buff',
    kind,
    remaining: 300,
    duration: 300,
    value,
    sourceId: target.id,
    school: 'arcane',
  };
  target.auras.push(aura);
  return aura;
};

// Force-swing until the named beneficial buff is gone (a swing can miss/dodge).
const swingUntilDevoured = (sim: Sim, mob: any, target: any, auraId: string, max = 300) => {
  for (let i = 0; i < max; i++) {
    target.hp = target.maxHp;
    (sim as any).mobSwing(mob, target);
    if (!target.auras.some((a: any) => a.id === auraId)) return true;
  }
  return false;
};

describe('mob purge affix (Spellgnaw)', () => {
  it('Grubjaw the Glutton carries the purge mechanic', () => {
    expect(MOBS.grubjaw.purgeOnHit).toBeDefined();
    expect(MOBS.grubjaw.purgeOnHit!.name).toBe('Spellgnaw');
  });

  it('strips one beneficial buff on a landed hit and recalcs derived stats', () => {
    const sim = makeSim();
    const player = sim.player;
    const mob = spawnGrubjaw(sim);
    const armorBefore = player.stats.armor;
    pushBuff(player, 'buff_armor', 80, 'test_buff_armor');
    // recalc so the pushed buff folds into derived armor (mirrors applyAura).
    const meta = (sim as any).players.get(player.id);
    recalcPlayerStats(player, meta.cls, meta.equipment, meta.talentMods);
    expect(player.stats.armor).toBe(armorBefore + 80);

    const purge = MOBS.grubjaw.purgeOnHit!;
    const old = purge.chance;
    purge.chance = 1;
    try {
      expect(swingUntilDevoured(sim, mob, player, 'test_buff_armor')).toBe(true);
    } finally {
      purge.chance = old;
    }
    expect(player.auras.some((a) => a.id === 'test_buff_armor')).toBe(false);
    expect(player.stats.armor).toBe(armorBefore); // un-folded after the strip
  });

  it('devours only one buff per proc, beneficial buffs only', () => {
    const sim = makeSim();
    const player = sim.player;
    spawnGrubjaw(sim);
    player.auras = [];
    pushBuff(player, 'buff_armor', 80, 'b1');
    pushBuff(player, 'buff_ap', 40, 'b2');
    const removed = devourBeneficialAura((sim as any).ctx, player, 'Spellgnaw');
    expect(removed).toBe(true);
    expect(player.auras.length).toBe(1); // exactly one eaten
  });

  it('never strips a debuff or a negative buff_* drain', () => {
    const sim = makeSim();
    const player = sim.player;
    spawnGrubjaw(sim);
    player.auras = [];
    pushBuff(player, 'dot', 5, 'd1'); // harmful DoT
    pushBuff(player, 'buff_int', -18, 'd2'); // enfeeble-style stat drain
    const removed = devourBeneficialAura((sim as any).ctx, player, 'Spellgnaw');
    expect(removed).toBe(false);
    expect(player.auras.length).toBe(2); // both left untouched
  });

  it('is a harmless no-op when the victim carries no beneficial buff', () => {
    const sim = makeSim();
    const player = sim.player;
    const mob = spawnGrubjaw(sim);
    player.auras = [];
    const purge = MOBS.grubjaw.purgeOnHit!;
    const old = purge.chance;
    purge.chance = 1;
    try {
      for (let i = 0; i < 40; i++) {
        player.hp = player.maxHp;
        (sim as any).mobSwing(mob, player);
      }
    } finally {
      purge.chance = old;
    }
    expect(player.dead).toBe(false);
  });

  it('a friendly pet never purges its owner (hostile guard)', () => {
    const sim = makeSim();
    const player = sim.player;
    const mob = spawnGrubjaw(sim);
    mob.hostile = false; // emulate a tamed pet swinging through mobSwing
    player.auras = [];
    pushBuff(player, 'buff_armor', 80, 'pet_buff');
    const purge = MOBS.grubjaw.purgeOnHit!;
    const old = purge.chance;
    purge.chance = 1;
    try {
      for (let i = 0; i < 80; i++) {
        player.hp = player.maxHp;
        (sim as any).mobSwing(mob, player);
      }
    } finally {
      purge.chance = old;
    }
    expect(player.auras.some((a) => a.id === 'pet_buff')).toBe(true);
  });
});
