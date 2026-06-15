import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/sim';
import { ITEMS, NPCS } from '../src/sim/data';
import {
  PROFESSIONS, RECIPES, validateProfessions, difficultyColor,
  clothCandidates, tierCap, nextTier, STANDARD_TIERS,
} from '../src/sim/content/professions';

function makeSim(cls: 'warrior' | 'mage' = 'warrior', seed = 42) {
  return new Sim({ seed, playerClass: cls, autoEquip: true });
}
const metaOf = (sim: Sim) => (sim as any).players.get(sim.player.id);
const tick = (sim: Sim, secs: number) => { for (let i = 0; i < 20 * secs; i++) sim.tick(); };
const findEntity = (sim: Sim, pred: (e: any) => boolean) =>
  [...(sim as any).entities.values()].find(pred);

describe('professions — registry & pure helpers', () => {
  it('the registry validates against the item table', () => {
    expect(validateProfessions(ITEMS)).toEqual([]);
  });

  it('every recipe output and reagent is a real item', () => {
    for (const r of Object.values(RECIPES)) {
      expect(ITEMS[r.output.itemId], r.output.itemId).toBeTruthy();
      for (const reg of r.reagents) expect(ITEMS[reg.itemId], reg.itemId).toBeTruthy();
    }
  });

  it('cloth bands by mob level, with overlap', () => {
    expect(clothCandidates(1)).toEqual(['linen_cloth']);
    expect(clothCandidates(5)).toEqual(['linen_cloth']);
    expect(clothCandidates(7)).toEqual(['linen_cloth', 'wool_cloth']); // overlap
    expect(clothCandidates(8)).toEqual(['linen_cloth', 'wool_cloth']); // overlap
    expect(clothCandidates(11)).toEqual(['wool_cloth']);
    expect(clothCandidates(14)).toEqual(['wool_cloth', 'silk_cloth']); // overlap
    expect(clothCandidates(15)).toEqual(['wool_cloth', 'silk_cloth']); // overlap
    expect(clothCandidates(20)).toEqual(['silk_cloth']);
  });

  it('difficulty color tracks skill vs recipe thresholds', () => {
    const r = RECIPES.linen_bandage; // req1 y20 g35 grey45
    expect(difficultyColor(1, r)).toBe('orange');
    expect(difficultyColor(25, r)).toBe('yellow');
    expect(difficultyColor(40, r)).toBe('green');
    expect(difficultyColor(45, r)).toBe('grey');
  });

  it('tier caps and progression', () => {
    const fa = PROFESSIONS.first_aid;
    expect(tierCap(fa, undefined)).toBe(50);
    expect(tierCap(fa, 'apprentice')).toBe(50);
    expect(tierCap(fa, 'journeyman')).toBe(100);
    expect(nextTier(fa, 'apprentice')?.id).toBe('journeyman');
    expect(nextTier(fa, 'apprentice')?.requiresSkill).toBe(40);
    expect(nextTier(fa, 'journeyman')).toBeNull();
  });
});

describe('professions — crafting & skill-ups', () => {
  it('crafts a bandage, consuming cloth and rolling a skill-up (orange = always)', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    meta.professionSkills.first_aid = 1;
    meta.professionTiers.first_aid = 'apprentice';
    sim.addItem('linen_cloth', 5);

    sim.craft('linen_bandage');
    tick(sim, 4); // 3s cast + margin

    expect(sim.countItem('linen_bandage')).toBe(1);
    expect(sim.countItem('linen_cloth')).toBe(4); // one consumed
    expect(meta.professionSkills.first_aid).toBe(2); // orange always skills up
  });

  it('no reagents = no cast, no consumption', () => {
    const sim = makeSim();
    metaOf(sim).professionSkills.first_aid = 1;
    metaOf(sim).professionTiers.first_aid = 'apprentice';
    sim.craft('linen_bandage');
    expect(sim.player.castingAbility).toBeNull();
    expect(sim.countItem('linen_bandage')).toBe(0);
  });

  it('skill clamps at the apprentice cap until Journeyman is trained', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    meta.professionSkills.first_aid = 50; // at apprentice cap
    meta.professionTiers.first_aid = 'apprentice';
    sim.addItem('linen_cloth', 5);
    sim.craft('linen_bandage');
    tick(sim, 4);
    expect(meta.professionSkills.first_aid).toBe(50); // no skill-up past cap
  });

  it('a recipe above the apprentice cap is unusable until skill rises', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    meta.professionSkills.first_aid = 50; // apprentice cap
    meta.professionTiers.first_aid = 'journeyman'; // trained, so cap is 100
    sim.addItem('silk_cloth', 5);
    sim.craft('silk_bandage'); // requiredSkill 70 > current 50 → rejected
    expect(sim.player.castingAbility).toBeNull();

    meta.professionSkills.first_aid = 70;
    sim.craft('silk_bandage'); // now meets the requirement
    expect(sim.player.castingAbility).toBe('craft:silk_bandage');
  });

  it('skill rises past 50 once Journeyman raises the cap', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    meta.professionSkills.first_aid = 60;
    meta.professionTiers.first_aid = 'journeyman'; // cap 100
    sim.addItem('wool_cloth', 5);
    sim.craft('wool_bandage'); // orange at 60 → always skills up
    tick(sim, 4);
    expect(meta.professionSkills.first_aid).toBe(61);
  });
});

describe('professions — First Aid bandage + debuff', () => {
  it('bandage heals over the channel and applies Recently Bandaged', () => {
    const sim = makeSim();
    sim.addItem('linen_bandage', 2);
    sim.player.hp = 1;
    const before = sim.player.hp;

    sim.useItem('linen_bandage');
    expect(sim.player.castingAbility).toBe('bandage');
    tick(sim, 9); // 8s channel + margin

    expect(sim.player.hp).toBeGreaterThan(before);
    expect(sim.player.auras.some((a: any) => a.kind === 'recently_bandaged')).toBe(true);
    expect(sim.countItem('linen_bandage')).toBe(1); // one consumed
  });

  it('a bandage cannot be used below its required level', () => {
    const sim = makeSim(); // level 1
    sim.addItem('wool_bandage', 1); // requiredLevel 6
    sim.player.hp = 1;
    sim.useItem('wool_bandage');
    expect(sim.player.castingAbility).toBeNull(); // blocked under level
    expect(sim.countItem('wool_bandage')).toBe(1); // not consumed

    sim.setPlayerLevel(6);
    sim.player.hp = 1; // leveling restored HP to full; hurt again
    sim.useItem('wool_bandage');
    expect(sim.player.castingAbility).toBe('bandage'); // now usable
  });

  it('cannot re-bandage while Recently Bandaged is active', () => {
    const sim = makeSim();
    sim.addItem('linen_bandage', 2);
    sim.player.hp = 1;
    sim.useItem('linen_bandage');
    tick(sim, 9);
    sim.player.hp = 1; // hurt again

    sim.useItem('linen_bandage'); // should be refused
    expect(sim.player.castingAbility).toBeNull();
    expect(sim.countItem('linen_bandage')).toBe(1); // not consumed
  });

  it('taking a hit interrupts the channel and stops the heal', () => {
    const sim = makeSim();
    sim.addItem('linen_bandage', 1);
    sim.player.hp = 1;
    sim.useItem('linen_bandage');
    tick(sim, 1);
    const mob = findEntity(sim, (e) => e.kind === 'mob');
    (sim as any).dealDamage(mob ?? null, sim.player, 1, false, 'physical', 'test', 'hit');
    expect(sim.player.castingAbility).toBeNull(); // interrupted
    expect(sim.player.auras.some((a: any) => a.id === 'bandage')).toBe(false); // HoT removed
    // anti-abuse: the cooldown was applied at cast start, so interrupting does NOT dodge it
    expect(sim.player.auras.some((a: any) => a.kind === 'recently_bandaged')).toBe(true);
  });
});

describe('professions — trainers & tier gate', () => {
  it('learn First Aid from a trainer, then gate Journeyman at skill 40', () => {
    const sim = makeSim();
    const npc = findEntity(sim, (e) => e.kind === 'npc' && e.templateId === 'brother_aldric');
    expect(npc, 'brother_aldric trainer should exist').toBeTruthy();
    sim.player.pos.x = npc.pos.x;
    sim.player.pos.z = npc.pos.z;
    sim.player.prevPos = { ...sim.player.pos };
    sim.tick(); // rebucket the spatial grid so nearTrainer sees the npc

    const meta = metaOf(sim);
    sim.learnProfession('first_aid', 'apprentice');
    expect(meta.professionSkills.first_aid).toBe(1);
    expect(meta.professionTiers.first_aid).toBe('apprentice');

    sim.learnProfession('first_aid', 'journeyman'); // skill 1 < 40 → rejected
    expect(meta.professionTiers.first_aid).toBe('apprentice');

    meta.professionSkills.first_aid = 40;
    sim.learnProfession('first_aid', 'journeyman'); // skill ok, but level 1 < 5 → still rejected
    expect(meta.professionTiers.first_aid).toBe('apprentice');

    sim.setPlayerLevel(5);
    sim.learnProfession('first_aid', 'journeyman'); // skill 40 + level 5 → allowed
    expect(meta.professionTiers.first_aid).toBe('journeyman');
    expect(tierCap(PROFESSIONS.first_aid, meta.professionTiers.first_aid)).toBe(100);
  });

  it('cannot learn a profession away from its trainer', () => {
    const sim = makeSim();
    sim.learnProfession('first_aid', 'apprentice'); // player spawns away from the trainer
    expect(metaOf(sim).professionSkills.first_aid).toBeUndefined();
  });

  it('caps primary professions at 2 but allows unlimited secondaries', () => {
    // No primary profession ships in Commit 1 (First Aid is secondary), so inject
    // synthetic primaries to exercise the slot cap; restored in finally.
    for (const id of ['p1', 'p2', 'p3']) {
      (PROFESSIONS as any)[id] = { id, name: id, kind: 'primary', maxSkill: 100, tiers: STANDARD_TIERS, recipes: [] };
    }
    const savedTrains = NPCS.brother_aldric.trains;
    try {
      const sim = makeSim();
      const npc = findEntity(sim, (e) => e.kind === 'npc' && e.templateId === 'brother_aldric');
      sim.player.pos.x = npc.pos.x;
      sim.player.pos.z = npc.pos.z;
      sim.player.prevPos = { ...sim.player.pos };
      sim.tick();
      const meta = metaOf(sim);
      meta.professionSkills.p1 = 1; meta.professionTiers.p1 = 'apprentice';
      meta.professionSkills.p2 = 1; meta.professionTiers.p2 = 'apprentice';

      // a secondary (First Aid) is still learnable with two primaries known
      sim.learnProfession('first_aid', 'apprentice');
      expect(meta.professionSkills.first_aid).toBe(1);

      // a third PRIMARY is rejected
      (NPCS.brother_aldric as any).trains = 'p3';
      sim.learnProfession('p3', 'apprentice');
      expect(meta.professionSkills.p3).toBeUndefined();
    } finally {
      for (const id of ['p1', 'p2', 'p3']) delete (PROFESSIONS as any)[id];
      (NPCS.brother_aldric as any).trains = savedTrains;
    }
  });
});

describe('professions — persistence', () => {
  it('professionSkills/Tiers round-trip through save/load', () => {
    const sim = makeSim('warrior', 7);
    const meta = metaOf(sim);
    meta.professionSkills.first_aid = 73;
    meta.professionTiers.first_aid = 'journeyman';
    const state = sim.serializeCharacter(sim.player.id)!;
    expect(state.professionSkills).toEqual({ first_aid: 73 });
    expect(state.professionTiers).toEqual({ first_aid: 'journeyman' });

    const reloaded = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: true, noPlayer: true } as any);
    const pid = reloaded.addPlayer('warrior', 'Reloaded', { state });
    const rmeta = (reloaded as any).players.get(pid);
    expect(rmeta.professionSkills.first_aid).toBe(73);
    expect(rmeta.professionTiers.first_aid).toBe('journeyman');
  });

  it('a save with no profession fields loads as empty', () => {
    const sim = makeSim('warrior', 7);
    const state = sim.serializeCharacter(sim.player.id)!;
    delete (state as any).professionSkills;
    delete (state as any).professionTiers;
    const reloaded = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: true, noPlayer: true } as any);
    const pid = reloaded.addPlayer('warrior', 'Old', { state });
    const rmeta = (reloaded as any).players.get(pid);
    expect(rmeta.professionSkills).toEqual({});
    expect(rmeta.professionTiers).toEqual({});
  });
});

describe('professions — cloth drops', () => {
  it('humanoid cloth drops are deterministic for the same seed', () => {
    const run = () => {
      const sim = makeSim('warrior', 99);
      const mob = findEntity(sim, (e) => e.kind === 'mob');
      if (!mob) return null;
      const meta = metaOf(sim);
      (sim as any).rollLoot(mob, meta, [meta]);
      return JSON.stringify(mob.loot ?? null);
    };
    expect(run()).toEqual(run());
  });
});
