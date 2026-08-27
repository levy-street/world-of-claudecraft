// Proc enchants (raid formulas, docs/prd/ignivar-raid-professions.md): a
// content/enchants.ts def may carry a WeaponProc, resolved by
// src/sim/combat/equip_procs.ts from the striking hand's worn instance
// payload and rolled AFTER any legendary weaponProcs. Pins the crusader
// shape end to end (selfBuff + selfHeal on the wielder), the
// no-proc-no-draw parity invariant, the hand isolation, and the
// heal-trigger recursion guard.
import { afterAll, describe, expect, it } from 'vitest';
import { runWeaponProcs } from '../src/sim/combat/equip_procs';
import { ENCHANTS, type EnchantDef } from '../src/sim/content/enchants';
import { Sim } from '../src/sim/sim';

const FORMULA_ID = 'test_zeal_formula';
const FORMULA: EnchantDef = {
  id: FORMULA_ID,
  name: 'Test Zeal',
  itemSlot: 'mainhand',
  reagents: [],
  statBonus: {},
  acquisition: ['drop'],
  skillReq: 100,
  proc: {
    id: 'test_zeal',
    name: 'Test Zeal',
    trigger: 'weaponHit',
    chance: 1,
    effects: [
      {
        kind: 'selfBuff',
        name: 'Test Zeal',
        buff: 'buff_ap',
        school: 'holy',
        value: 5,
        duration: 8,
      },
      { kind: 'selfHeal', amount: 30 },
    ],
  },
};
ENCHANTS[FORMULA_ID] = FORMULA;

const HEAL_FORMULA_ID = 'test_mend_formula';
ENCHANTS[HEAL_FORMULA_ID] = {
  id: HEAL_FORMULA_ID,
  name: 'Test Mend',
  itemSlot: 'mainhand',
  reagents: [],
  statBonus: {},
  acquisition: ['drop'],
  proc: {
    id: 'test_mend',
    name: 'Test Mend',
    trigger: 'heal',
    chance: 1,
    effects: [{ kind: 'selfHeal', amount: 25 }],
  },
};

afterAll(() => {
  delete ENCHANTS[FORMULA_ID];
  delete ENCHANTS[HEAL_FORMULA_ID];
});

function makeSim(seed = 42) {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: false });
}

function setup(enchantId?: string) {
  const sim = makeSim();
  const p = (sim as any).entities.get(sim.playerId);
  const meta = (sim as any).players.get(sim.playerId);
  if (!p || !meta) throw new Error('player missing');
  if (enchantId) meta.equipmentInstance.mainhand = { enchant: enchantId };
  const mob = [...(sim as any).entities.values()].find(
    (e: any) => e.kind === 'mob' && !e.dead,
  ) as any;
  if (!mob) throw new Error('no live mob in world');
  return { sim, p, meta, mob };
}

function rngState(sim: Sim): number {
  return ((sim as any).rng as any).s;
}

describe('enchant procs', () => {
  it('fires the crusader shape on the wielder: buff aura plus flat heal', () => {
    const { sim, p, mob } = setup(FORMULA_ID);
    p.hp = p.maxHp - 50;
    runWeaponProcs(sim.ctx, p, mob, 'weaponHit', 'worn_sword');
    const buff = p.auras.find((a: any) => a.id === 'test_zeal_buff');
    expect(buff).toBeDefined();
    expect(buff.kind).toBe('buff_ap');
    expect(buff.value).toBe(5);
    expect(buff.duration).toBe(8);
    expect(p.hp).toBe(p.maxHp - 50 + 30);
  });

  it('draws no rng without a proc enchant, and none on a trigger mismatch', () => {
    const plain = setup();
    const before = rngState(plain.sim);
    runWeaponProcs(plain.sim.ctx, plain.p, plain.mob, 'weaponHit', 'worn_sword');
    expect(rngState(plain.sim)).toBe(before);

    // A weaponHit-trigger proc enchant must not draw on a heal trigger.
    const mismatched = setup(FORMULA_ID);
    const beforeHeal = rngState(mismatched.sim);
    runWeaponProcs(mismatched.sim.ctx, mismatched.p, mismatched.p, 'heal', 'worn_sword');
    expect(rngState(mismatched.sim)).toBe(beforeHeal);
  });

  it('reads the STRIKING hand only: a mainhand enchant never procs an offhand swing', () => {
    const { sim, p, mob } = setup(FORMULA_ID);
    const before = rngState(sim);
    runWeaponProcs(sim.ctx, p, mob, 'weaponHit', 'worn_sword', 'offhand');
    expect(rngState(sim)).toBe(before);
    expect(p.auras.find((a: any) => a.id === 'test_zeal_buff')).toBeUndefined();
  });

  it('a heal-trigger proc heals the wielder without re-entering itself', () => {
    const { sim, p } = setup(HEAL_FORMULA_ID);
    p.hp = p.maxHp - 100;
    // The proc's own heal runs canTriggerWeaponProcs=false, so this resolves
    // in one pass: exactly one 25-point heal, no recursion.
    runWeaponProcs(sim.ctx, p, p, 'heal', 'worn_sword');
    expect(p.hp).toBe(p.maxHp - 100 + 25);
  });

  it('a mob wielder never reaches the enchant read', () => {
    const { sim, p, mob } = setup(FORMULA_ID);
    const before = rngState(sim);
    // The mob has no PlayerMeta, so ctx.resolve is null and no draw happens
    // even with a weapon id passed explicitly.
    runWeaponProcs(sim.ctx, mob, p, 'weaponHit', 'worn_sword');
    expect(rngState(sim)).toBe(before);
  });
});
