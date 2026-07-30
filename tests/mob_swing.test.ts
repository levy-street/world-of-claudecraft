// Direct unit tests for the mob on-hit affix cascade module (src/sim/mob/mob_swing.ts),
// extracted from Sim.mobSwing in session M3. These import the module entry points and
// drive them against a real Sim's SimContext (so applyAura / dealDamage / effectiveArmor /
// recalcPlayer / emit resolve through the live seam), forcing affix chances to 1 so the
// proc rng.chance rolls always land. They prove the module in isolation: the affixes
// apply, the load-bearing mob.hostile guard short-circuits a friendly swing, and the
// Devour Magic recalc seam un-folds a stripped buff.

import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob, recalcPlayerStats } from '../src/sim/entity';
import { devourBeneficialAura, runMobSwingAffixes } from '../src/sim/mob/mob_swing';
import { Sim } from '../src/sim/sim';
import type { PlayerClass } from '../src/sim/types';

const SEED = 77;

const makeSim = (cls: PlayerClass = 'warrior') => {
  const sim = new Sim({ seed: SEED, playerClass: cls, autoEquip: true });
  sim.setPlayerLevel(16);
  return sim;
};

const ctxOf = (sim: Sim) => (sim as any).ctx;

const spawn = (sim: Sim, key: string, level: number, x = 0, z = 0): any => {
  const mob = createMob((sim as any).nextId++, MOBS[key], level, { x, y: 0, z }) as any;
  (sim as any).addEntity(mob);
  return mob;
};

// Run the affix cascade with a forced-landing base hit. dealt/crit/rawDmg are the base
// result the cascade consumes (lifesteal heal basis / cleave splash basis / crit flag);
// the cascade never recomputes them, so any plausible values exercise the same branches.
const BASE = { dealt: 50, crit: false, rawDmg: 60 };
const cascade = (sim: Sim, mob: any, target: any, base = BASE) =>
  runMobSwingAffixes(ctxOf(sim), mob, target, base);

// Force a template affix's chance to 1 for the duration of fn, then restore (MOBS is a
// process-wide singleton shared across the whole test run).
const withChance = <T>(affix: { chance: number } | undefined, fn: () => T): T => {
  if (!affix) throw new Error('affix missing');
  const old = affix.chance;
  affix.chance = 1;
  try {
    return fn();
  } finally {
    affix.chance = old;
  }
};

describe('mob_swing module: runMobSwingAffixes', () => {
  it('stunOnHit lands a stun aura on a player victim (hostile mob)', () => {
    const sim = makeSim();
    const p = sim.player as any;
    const mob = spawn(sim, 'mogger_lackey', 18);
    mob.hostile = true;
    withChance(MOBS.mogger_lackey.stunOnHit, () => cascade(sim, mob, p));
    expect(p.auras.some((a: any) => a.id === 'stun_mogger_lackey' && a.kind === 'stun')).toBe(true);
  });

  it('venom lands a refreshing dot aura on a player victim (hostile mob)', () => {
    const sim = makeSim();
    const p = sim.player as any;
    const mob = spawn(sim, 'webwood_spider', 18);
    mob.hostile = true;
    withChance(MOBS.webwood_spider.venom, () => cascade(sim, mob, p));
    expect(p.auras.some((a: any) => a.id === 'venom_webwood_spider' && a.kind === 'dot')).toBe(
      true,
    );
  });

  it('a friendly (hostile=false) swing applies NO debuff, even with the proc forced to 1', () => {
    const sim = makeSim();
    const target = spawn(sim, 'forest_wolf', 8, 2, 0);
    target.auras = [];
    // A mogger_lackey acting as a tamed pet: hostile=false short-circuits every proc
    // guard BEFORE its rng.chance, so the stun never lands despite chance === 1.
    const pet = spawn(sim, 'mogger_lackey', 18, 1, 0);
    pet.hostile = false;
    withChance(MOBS.mogger_lackey.stunOnHit, () => cascade(sim, pet, target));
    expect(target.auras.length).toBe(0);
  });

  it('rampage self-buff stacks the attacker up to maxStacks (unconditional on hostile + alive)', () => {
    const sim = makeSim();
    const p = sim.player as any;
    const mob = spawn(sim, 'warlord_drogmar', 18);
    mob.hostile = true;
    const rampage = MOBS.warlord_drogmar.rampage!;
    for (let i = 0; i < rampage.maxStacks + 2; i++) cascade(sim, mob, p);
    const buff = mob.auras.find((a: any) => a.id === 'rampage_warlord_drogmar');
    expect(buff?.kind).toBe('buff_ap');
    expect(buff?.stacks).toBe(rampage.maxStacks); // capped, not unbounded
    expect(buff?.value).toBe(rampage.ap * rampage.maxStacks);
  });

  it('Devour Magic strips exactly one beneficial buff and recalcPlayer un-folds the derived stat', () => {
    const sim = makeSim();
    const p = sim.player as any;
    const meta = (sim as any).players.get(p.id);
    const armorBefore = p.stats.armor;
    p.auras.push({
      id: 'devour_test',
      name: 'Test Armor',
      kind: 'buff_armor',
      remaining: 300,
      duration: 300,
      value: 90,
      sourceId: p.id,
      school: 'arcane',
    });
    p.auras.push({
      id: 'devour_test_2',
      name: 'Test AP',
      kind: 'buff_ap',
      remaining: 300,
      duration: 300,
      value: 40,
      sourceId: p.id,
      school: 'arcane',
    });
    // Fold the pushed buff into derived stats (mirrors applyAura's recalc).
    recalcPlayerStats(p, meta.cls, meta.equipment, meta.talentMods, meta.equipmentInstance);
    expect(p.stats.armor).toBe(armorBefore + 90);
    const auraCountBefore = p.auras.length;

    const removed = devourBeneficialAura(ctxOf(sim), p, 'Devour Magic');
    expect(removed).toBe(true);
    // Stable Warrior stance auras may already be present. Devour still eats
    // exactly one aura, the first devourable enhancement in authored order.
    expect(p.auras.length).toBe(auraCountBefore - 1);
    expect(p.auras.some((a: any) => a.id === 'devour_test')).toBe(false);
    expect(p.auras.some((a: any) => a.id === 'devour_test_2')).toBe(true);
    // recalcPlayer (the new SimContext callback) rebaked stats: the armor un-folded.
    expect(p.stats.armor).toBe(armorBefore);
  });

  it('Devour Magic is a no-op (returns false) when the victim carries no beneficial buff', () => {
    const sim = makeSim();
    const p = sim.player as any;
    p.auras = [];
    p.auras.push({
      id: 'harmful',
      name: 'Bleed',
      kind: 'dot',
      remaining: 300,
      duration: 300,
      value: 5,
      sourceId: p.id,
      school: 'physical',
    });
    const removed = devourBeneficialAura(ctxOf(sim), p, 'Devour Magic');
    expect(removed).toBe(false);
    expect(p.auras.length).toBe(1); // the debuff is left untouched
  });
});
