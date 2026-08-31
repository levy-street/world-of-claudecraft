// The Crucible set-bonus resolver (src/sim/set_bonus_mods.ts): worn-set
// counting, the per-tier wearer flags, TalentEffect accumulation on top of
// talents, and the live recompute wiring (equip, unequip, level, respec all
// route through computeCharacterModifiers). The per-bonus engine behavior is
// each class wave's own suite; this file owns the SEAM.
import { describe, expect, it } from 'vitest';
import { setBonusFlag } from '../src/sim/content/ignivar_set_bonuses';
import { computeTalentModifiers } from '../src/sim/content/talents';
import {
  applySetBonusModifiers,
  computeCharacterModifiers,
  wornSetCounts,
} from '../src/sim/set_bonus_mods';
import { Sim } from '../src/sim/sim';
import { expectDefined } from './helpers/defined';

const TWO_PIECES = { helmet: 'slagbreaker_helmet', shoulder: 'slagbreaker_shoulder' };

describe('set_bonus_mods: the resolver', () => {
  it('counts worn pieces per set id from the equipment map', () => {
    const counts = wornSetCounts({ ...TWO_PIECES, chest: 'slagbreaker_chest' });
    expect(counts.get('slagbreaker')).toBe(3);
  });

  it('a met 2-piece tier registers its wearer flag and accumulates its effect', () => {
    const mods = applySetBonusModifiers(computeTalentModifiers('warrior', null), TWO_PIECES);
    expect(mods.selected[setBonusFlag('slagbreaker', 2)]).toBe(true);
    expect(mods.selected[setBonusFlag('slagbreaker', 4)]).toBeUndefined();
    // Slagbreaker 2pc: Redhand's Maiming Strike empower 20 -> 30 percent per
    // stack rides the ability-row buffPct.
    expect(mods.abilities.overpower?.buffPct).toBe(0.5);
  });

  it('one piece grants nothing; four pieces grant both tiers', () => {
    const one = applySetBonusModifiers(computeTalentModifiers('warrior', null), {
      helmet: 'slagbreaker_helmet',
    });
    expect(one.selected[setBonusFlag('slagbreaker', 2)]).toBeUndefined();
    expect(one.abilities.overpower?.buffPct ?? 0).toBe(0);

    const four = applySetBonusModifiers(computeTalentModifiers('warrior', null), {
      ...TWO_PIECES,
      chest: 'slagbreaker_chest',
      legs: 'slagbreaker_legs',
    });
    expect(four.selected[setBonusFlag('slagbreaker', 2)]).toBe(true);
    expect(four.selected[setBonusFlag('slagbreaker', 4)]).toBe(true);
  });

  it('a set id with no engine table folds to nothing (the engineless posture survives per set)', () => {
    // Every Crucible wave is registered now (the druid wave completed the
    // 29), so the rolling still-unregistered anchor retired with it. The
    // posture it guarded is permanent, though: the resolver must treat any
    // worn set WITHOUT a SET_ENGINE_BONUSES entry as inert, and the
    // non-Crucible sets (the leveling lineages, WARFARE) never register one.
    // vale_arcanist is a real leveling set with real ITEM_SETS stat tiers,
    // so this walks the exact production path: counted by wornSetCounts,
    // then skipped by the engine fold.
    const equipment = { helmet: 'acolytes_circlet', chest: 'woven_robe' };
    expect(wornSetCounts(equipment).get('vale_arcanist')).toBe(2);
    const mods = applySetBonusModifiers(computeTalentModifiers('mage', null), equipment);
    expect(Object.keys(mods.selected).filter((k) => k.startsWith('setbonus_'))).toEqual([]);
  });

  it('accumulates ON TOP of talents rather than replacing them', () => {
    const withoutSet = computeCharacterModifiers('warrior', null, 20, {});
    const withSet = computeCharacterModifiers('warrior', null, 20, TWO_PIECES);
    // The talent-derived surface is untouched; only the set additions differ.
    expect(withSet.spec).toBe(withoutSet.spec);
    expect(withSet.global).toEqual(withoutSet.global);
    expect(withSet.abilities.overpower?.buffPct).toBe(0.5);
  });
});

describe('set_bonus_mods: live recompute wiring', () => {
  function warriorAt25() {
    const sim = new Sim({ seed: 11, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Setwearer');
    const meta = expectDefined(sim.ctx.players.get(pid));
    const entity = expectDefined(sim.entities.get(pid));
    entity.level = 25; // the tier pieces require level 20
    return { sim, pid, meta };
  }

  it('equipping to the threshold turns the tier on; unequipping turns it off', () => {
    const { sim, pid, meta } = warriorAt25();
    sim.addItem('slagbreaker_helmet', 1, pid);
    sim.addItem('slagbreaker_shoulder', 1, pid);

    sim.equipItem('slagbreaker_helmet', pid);
    expect(sim.playerMods(meta).selected[setBonusFlag('slagbreaker', 2)]).toBeUndefined();

    sim.equipItem('slagbreaker_shoulder', pid);
    expect(sim.playerMods(meta).selected[setBonusFlag('slagbreaker', 2)]).toBe(true);
    expect(sim.playerMods(meta).abilities.overpower?.buffPct).toBe(0.5);

    sim.unequipItem('helmet', pid);
    expect(sim.playerMods(meta).selected[setBonusFlag('slagbreaker', 2)]).toBeUndefined();
    expect(sim.playerMods(meta).abilities.overpower?.buffPct ?? 0).toBe(0);
  });

  it('a level-up recompute keeps the worn bonuses (the writer passes equipment)', () => {
    const { sim, pid, meta } = warriorAt25();
    sim.addItem('slagbreaker_helmet', 1, pid);
    sim.addItem('slagbreaker_shoulder', 1, pid);
    sim.equipItem('slagbreaker_helmet', pid);
    sim.equipItem('slagbreaker_shoulder', pid);
    expect(sim.playerMods(meta).selected[setBonusFlag('slagbreaker', 2)]).toBe(true);

    // The dev level path re-bakes talentMods from scratch; the set bonuses
    // must survive it, or a ding would silently strip the worn tier.
    sim.setPlayerLevel(26, pid);
    expect(sim.playerMods(meta).selected[setBonusFlag('slagbreaker', 2)]).toBe(true);
  });
});
