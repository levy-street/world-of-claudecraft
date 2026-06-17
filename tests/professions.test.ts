import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/sim';
import { dist2d } from '../src/sim/types';
import { ITEMS, NPCS, MOBS } from '../src/sim/data';
import {
  PROFESSIONS, RECIPES, validateProfessions, difficultyColor,
  clothCandidates, tierCap, nextTier, STANDARD_TIERS, tierLearnCost, recipeLearnCost,
  leatherCandidates, skinNat, skinReq, skinDifficulty, TRADE_GOODS,
} from '../src/sim/content/professions';

function makeSim(cls: 'warrior' | 'mage' = 'warrior', seed = 42) {
  return new Sim({ seed, playerClass: cls, autoEquip: true });
}
const metaOf = (sim: Sim) => (sim as any).players.get(sim.player.id);
const tick = (sim: Sim, secs: number) => { for (let i = 0; i < 20 * secs; i++) sim.tick(); };
const findEntity = (sim: Sim, pred: (e: any) => boolean) =>
  [...(sim as any).entities.values()].find(pred);
// teleport the player onto an NPC by template id and rebucket the grid
const atNpc = (sim: Sim, templateId: string): void => {
  const npc = findEntity(sim, (e) => e.kind === 'npc' && e.templateId === templateId) as any;
  sim.player.pos.x = npc.pos.x;
  sim.player.pos.z = npc.pos.z;
  sim.player.prevPos = { ...sim.player.pos };
  sim.tick();
};
// the starting-town (Eastbrook) First Aid trainer teaches Apprentice only
const atTrainer = (sim: Sim): void => atNpc(sim, 'brother_aldric');
// the later-town (Fenbridge) First Aid trainer teaches Journeyman
const atJourneymanTrainer = (sim: Sim): void => atNpc(sim, 'brother_aldric_fen');

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
    meta.learnedRecipes.add('linen_bandage');
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
    metaOf(sim).learnedRecipes.add('linen_bandage');
    sim.craft('linen_bandage');
    expect(sim.player.castingAbility).toBeNull();
    expect(sim.countItem('linen_bandage')).toBe(0);
  });

  it('skill clamps at the apprentice cap until Journeyman is trained', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    meta.professionSkills.first_aid = 50; // at apprentice cap
    meta.professionTiers.first_aid = 'apprentice';
    meta.learnedRecipes.add('linen_bandage');
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
    meta.learnedRecipes.add('silk_bandage');
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
    meta.learnedRecipes.add('wool_bandage');
    sim.addItem('wool_cloth', 5);
    sim.craft('wool_bandage'); // orange at 60 → always skills up
    tick(sim, 4);
    expect(meta.professionSkills.first_aid).toBe(61);
  });

  it('a craft cast cancelled by movement consumes no reagents', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    meta.professionSkills.first_aid = 1;
    meta.professionTiers.first_aid = 'apprentice';
    meta.learnedRecipes.add('linen_bandage');
    sim.addItem('linen_cloth', 3);

    sim.craft('linen_bandage');
    expect(sim.player.castingAbility).toBe('craft:linen_bandage');

    // move mid-cast: the channel cancels, nothing consumed or produced
    sim.moveInput.forward = true;
    sim.tick();

    expect(sim.player.castingAbility).toBeNull();
    expect(sim.countItem('linen_cloth')).toBe(3); // reagents intact
    expect(sim.countItem('linen_bandage')).toBe(0); // no output
  });
});

describe('professions — loot determinism', () => {
  it('cloth injection draws no RNG for non-cloth-family mobs', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    const rng: any = (sim as any).rng;
    const orig = rng.next.bind(rng);
    let draws = 0;
    rng.next = () => { draws++; return orig(); };
    const s0 = rng.s;
    // reset to the same rng state each call so the base loot path makes identical
    // (conditional) draws, isolating the cloth block as the only variable
    const countDraws = (templateId: string, level: number): number => {
      rng.s = s0;
      draws = 0;
      (sim as any).rollLoot({ templateId, level, loot: undefined, lootable: false }, meta);
      return draws;
    };
    const familyId = (fam: string) =>
      Object.keys(MOBS).find((id) => (MOBS as any)[id].family === fam);
    const humanId = familyId('humanoid');
    const beastId = familyId('beast');
    expect(humanId).toBeTruthy();
    expect(beastId).toBeTruthy();

    // a cloth family draws extra RNG only while its level sits in a cloth band
    expect(countDraws(humanId!, 5)).toBeGreaterThan(countDraws(humanId!, 30));
    // a non-cloth family never enters the cloth block: identical draws in/out of band
    expect(countDraws(beastId!, 5)).toBe(countDraws(beastId!, 30));

    rng.next = orig;
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

  it('can start a bandage while in combat (it just breaks on damage)', () => {
    const sim = makeSim();
    sim.addItem('linen_bandage', 1);
    sim.player.hp = 1;
    sim.player.inCombat = true; // bandaging in combat is allowed; only damage/move/action interrupts it
    sim.useItem('linen_bandage');
    expect(sim.player.castingAbility).toBe('bandage');
  });
});

describe('professions — trainers & tier gate', () => {
  it('learn Apprentice in the starting town, then learn Journeyman at a later-town trainer (skill 40 + level 5)', () => {
    const sim = makeSim();
    atTrainer(sim); // Eastbrook — Apprentice only

    const meta = metaOf(sim);
    meta.copper = 5000; // enough to afford both tier costs (Apprentice + Journeyman)
    sim.learnProfession('first_aid', 'apprentice');
    expect(meta.professionSkills.first_aid).toBe(1);
    expect(meta.professionTiers.first_aid).toBe('apprentice');
    expect(meta.copper).toBe(5000 - tierLearnCost(PROFESSIONS.first_aid, 'apprentice'));
    expect([...meta.learnedRecipes]).toContain('linen_bandage'); // starter auto-learned free

    // Journeyman is taught only at a later-town trainer; the skill/level gates still apply there.
    atJourneymanTrainer(sim); // Fenbridge — Journeyman
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

  it('the starting-town trainer teaches only Apprentice tier and sub-cap recipes', () => {
    const sim = makeSim();
    atTrainer(sim); // Eastbrook — Apprentice only
    const meta = metaOf(sim);
    meta.copper = 5000;
    sim.learnProfession('first_aid', 'apprentice');

    // fully qualified for Journeyman, but the Apprentice trainer still refuses the tier
    meta.professionSkills.first_aid = 40;
    sim.setPlayerLevel(5);
    sim.learnProfession('first_aid', 'journeyman');
    expect(meta.professionTiers.first_aid).toBe('apprentice');

    // skill is high enough to learn Wool Bandage (req 50), but it sits at the apprentice
    // cap, so the Apprentice trainer will not teach it — only the trainer tier gates here
    meta.professionSkills.first_aid = 60;
    sim.learnRecipe('wool_bandage');
    expect([...meta.learnedRecipes]).not.toContain('wool_bandage');

    // the same recipe is teachable at the later-town Journeyman trainer
    atJourneymanTrainer(sim);
    sim.learnRecipe('wool_bandage');
    expect([...meta.learnedRecipes]).toContain('wool_bandage');
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
      meta.copper = 1000;
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

  it("unlearn wipes a profession's skill, tier, and its recipes only", () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    meta.professionSkills = { leatherworking: 60, tailoring: 50 };
    meta.professionTiers = { leatherworking: 'journeyman', tailoring: 'apprentice' };
    const lw = Object.values(RECIPES).find((r) => r.profId === 'leatherworking')!;
    const tl = Object.values(RECIPES).find((r) => r.profId === 'tailoring')!;
    meta.learnedRecipes = new Set([lw.id, tl.id]);
    meta.learnedRecipesArr = [...meta.learnedRecipes];

    sim.dropProfession('leatherworking');

    expect(meta.professionSkills.leatherworking).toBeUndefined();
    expect(meta.professionTiers.leatherworking).toBeUndefined();
    expect([...meta.learnedRecipes]).not.toContain(lw.id); // the dropped profession's recipe is gone
    expect([...meta.learnedRecipes]).toContain(tl.id);      // the other profession's recipe is kept
    expect(meta.professionSkills.tailoring).toBe(50);
  });

  it('unlearn frees a primary slot so a third primary can be learned', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    meta.copper = 99999;
    atNpc(sim, 'tanner_yorvek'); sim.learnProfession('skinning', 'apprentice');
    atNpc(sim, 'leatherworker_brida'); sim.learnProfession('leatherworking', 'apprentice');
    expect(meta.professionSkills.skinning).toBe(1);
    expect(meta.professionSkills.leatherworking).toBe(1);

    // a third primary is rejected at the 2-primary cap
    atNpc(sim, 'tailor_marlena'); sim.learnProfession('tailoring', 'apprentice');
    expect(meta.professionSkills.tailoring).toBeUndefined();

    // unlearn one, then the third is allowed
    sim.dropProfession('skinning');
    expect(meta.professionSkills.skinning).toBeUndefined();
    atNpc(sim, 'tailor_marlena'); sim.learnProfession('tailoring', 'apprentice');
    expect(meta.professionSkills.tailoring).toBe(1);
  });

  it('dropping a profession mid-craft yields no output and no phantom skill-up', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    const recipe = Object.values(RECIPES).find((r) => r.profId === 'leatherworking' && !r.station)!;
    meta.professionSkills = { leatherworking: 50 };
    meta.professionTiers = { leatherworking: 'journeyman' };
    meta.learnedRecipes = new Set([recipe.id]);
    meta.learnedRecipesArr = [recipe.id];
    for (const reg of recipe.reagents) sim.addItem(reg.itemId, 99);
    const before = sim.countItem(recipe.output.itemId);

    sim.craft(recipe.id);
    expect(sim.player.castingAbility).toBe(`craft:${recipe.id}`); // cast under way

    sim.dropProfession('leatherworking');
    for (let i = 0; i < 20 * 10; i++) sim.tick(); // let the craft cast run to completion

    expect(sim.countItem(recipe.output.itemId)).toBe(before); // nothing crafted
    expect(meta.professionSkills.leatherworking).toBeUndefined(); // not re-registered by a skill-up
  });
});

describe('professions — learning costs & recipes', () => {
  it('learning a tier costs copper and is rejected when broke', () => {
    const sim = makeSim();
    atTrainer(sim);
    const meta = metaOf(sim);
    const appCost = tierLearnCost(PROFESSIONS.first_aid, 'apprentice');
    meta.copper = appCost - 1;
    sim.learnProfession('first_aid', 'apprentice');
    expect(meta.professionSkills.first_aid).toBeUndefined(); // can't afford it
    meta.copper = appCost;
    sim.learnProfession('first_aid', 'apprentice');
    expect(meta.professionSkills.first_aid).toBe(1);
    expect(meta.copper).toBe(0);
  });

  it('recipes must be learned from the trainer, not just unlocked by skill', () => {
    const sim = makeSim();
    atTrainer(sim);
    const meta = metaOf(sim);
    meta.copper = 1000;
    sim.learnProfession('first_aid', 'apprentice'); // auto-learns the starter (linen_bandage)
    meta.professionSkills.first_aid = 30; // skill is now enough for heavy_linen (req 25)
    sim.addItem('linen_cloth', 5);

    // not learned yet → cannot craft despite skill + materials
    sim.craft('heavy_linen_bandage');
    expect(sim.player.castingAbility).toBeNull();

    // learn it from the trainer (cost = 25 skill x 1c secondary)
    const before = meta.copper;
    sim.learnRecipe('heavy_linen_bandage');
    expect([...meta.learnedRecipes]).toContain('heavy_linen_bandage');
    expect(before - meta.copper).toBe(recipeLearnCost(RECIPES.heavy_linen_bandage));

    // now it crafts
    sim.craft('heavy_linen_bandage');
    expect(sim.player.castingAbility).toBe('craft:heavy_linen_bandage');
  });

  it('cannot learn a recipe above current skill', () => {
    const sim = makeSim();
    atTrainer(sim);
    const meta = metaOf(sim);
    meta.copper = 1000;
    sim.learnProfession('first_aid', 'apprentice'); // skill 1
    sim.learnRecipe('heavy_linen_bandage'); // requires skill 25 → rejected
    expect([...meta.learnedRecipes]).not.toContain('heavy_linen_bandage');
  });
});

describe('professions — persistence', () => {
  it('professionSkills/Tiers round-trip through save/load', () => {
    const sim = makeSim('warrior', 7);
    const meta = metaOf(sim);
    meta.professionSkills.first_aid = 73;
    meta.professionTiers.first_aid = 'journeyman';
    meta.learnedRecipes.add('linen_bandage');
    meta.learnedRecipes.add('wool_bandage');
    const state = sim.serializeCharacter(sim.player.id)!;
    expect(state.professionSkills).toEqual({ first_aid: 73 });
    expect(state.professionTiers).toEqual({ first_aid: 'journeyman' });
    expect(state.learnedRecipes).toEqual(['linen_bandage', 'wool_bandage']);

    const reloaded = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: true, noPlayer: true } as any);
    const pid = reloaded.addPlayer('warrior', 'Reloaded', { state });
    const rmeta = (reloaded as any).players.get(pid);
    expect(rmeta.professionSkills.first_aid).toBe(73);
    expect([...rmeta.learnedRecipes]).toEqual(['linen_bandage', 'wool_bandage']);
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

// --- Skinning (gathering, corpse-based) -----------------------------------

// Force `mob` into a skinnable-corpse state next to the player and rebucket.
function armCorpse(sim: Sim, mob: any, opts: { lootable?: boolean; loot?: any } = {}): void {
  mob.dead = true;
  mob.hp = 0;
  mob.skinned = false;
  mob.lootable = opts.lootable ?? false;
  mob.loot = opts.loot ?? null;
  mob.corpseTimer = 60;
  mob.respawnTimer = 60; // keep it from respawning during the test
  sim.player.pos.x = mob.pos.x + 1;
  sim.player.pos.z = mob.pos.z;
  sim.player.pos.y = mob.pos.y; // grounded — a fall counts as movement and cancels the skin cast
  sim.player.onGround = true;
  sim.player.prevPos = { ...sim.player.pos };
  // pacify the surrounding camp so a live neighbour can't aggro and interrupt
  // the skin cast (we teleported into a spawn cluster). Keep them down with high
  // timers so they don't instantly respawn and re-aggro mid-cast.
  for (const e of [...(sim as any).entities.values()] as any[]) {
    if (e.kind === 'mob' && e.id !== mob.id && !e.dead && dist2d(e.pos, mob.pos) < 50) {
      e.dead = true; e.hostile = false; e.inCombat = false; e.aggroTargetId = null;
      e.corpseTimer = 999; e.respawnTimer = 999;
    }
  }
  sim.player.inCombat = false;
  sim.tick(); // rebucket the spatial grid
}
const beastCorpse = (sim: Sim, templateId: string) =>
  findEntity(sim, (e) => e.kind === 'mob' && e.templateId === templateId) as any;

describe('skinning — pure helpers', () => {
  it('leather bands by mob level, with overlap (parallel to cloth)', () => {
    expect(leatherCandidates(1)).toEqual(['light_leather']);
    expect(leatherCandidates(7)).toEqual(['light_leather', 'medium_leather']);
    expect(leatherCandidates(14)).toEqual(['medium_leather', 'heavy_leather']);
    expect(leatherCandidates(20)).toEqual(['heavy_leather']);
  });
  it('skinReq is graced for level <= 3, then mobLevel*5; difficulty anchors on nat', () => {
    expect(skinReq(1)).toBe(1);
    expect(skinReq(3)).toBe(1);
    expect(skinReq(4)).toBe(20);
    expect(skinReq(10)).toBe(50);
    expect(skinReq(20)).toBe(100);
    // difficulty colors off nat = level*5, NOT the graced gate
    expect(skinNat(4)).toBe(20);
    expect(skinDifficulty(1, 1)).toBe('orange');   // nat 5, skill 1 < 10
    expect(skinDifficulty(10, 1)).toBe('yellow');  // nat 5, 10 in [10,15)
    expect(skinDifficulty(16, 1)).toBe('green');   // nat 5, 16 in [15,20)
    expect(skinDifficulty(20, 1)).toBe('grey');    // nat 5, >=20
  });
});

describe('skinning — gate', () => {
  it('rejects skinning when Skinning is not known', () => {
    const sim = makeSim();
    const wolf = beastCorpse(sim, 'forest_wolf');
    armCorpse(sim, wolf);
    sim.skin(wolf.id);
    expect(sim.player.castingAbility).toBeNull();
    expect(wolf.skinned).toBe(false);
  });

  it('rejects a non-beast corpse', () => {
    const sim = makeSim();
    metaOf(sim).professionSkills.skinning = 50;
    metaOf(sim).professionTiers.skinning = 'apprentice';
    const human = findEntity(sim, (e) => e.kind === 'mob' && MOBS[e.templateId]?.family === 'humanoid') as any;
    expect(human).toBeTruthy();
    armCorpse(sim, human);
    sim.skin(human.id);
    expect(sim.player.castingAbility).toBeNull();
  });

  it('blocks skinning while loot remains, opens once looted', () => {
    const sim = makeSim();
    metaOf(sim).professionSkills.skinning = 5;
    metaOf(sim).professionTiers.skinning = 'apprentice';
    const wolf = beastCorpse(sim, 'forest_wolf');
    armCorpse(sim, wolf, { lootable: true, loot: { copper: 0, items: [{ itemId: 'wolf_fang', count: 1 }] } });
    sim.skin(wolf.id); // loot remains → rejected
    expect(sim.player.castingAbility).toBeNull();

    sim.lootCorpse(wolf.id); // take the loot
    expect(wolf.lootable).toBe(false);
    sim.skin(wolf.id); // now skinnable
    expect(sim.player.castingAbility).toBe('skin:' + wolf.id);
  });

  it('rejects an already-skinned corpse and under-skilled skinning', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    meta.professionSkills.skinning = 1;
    meta.professionTiers.skinning = 'apprentice';
    // a ridge stalker (L13-14) needs skill 65+ — skill 1 is far too low
    const stalker = beastCorpse(sim, 'ridge_stalker');
    if (stalker) {
      armCorpse(sim, stalker);
      sim.skin(stalker.id);
      expect(sim.player.castingAbility).toBeNull(); // under-skilled
    }
    const wolf = beastCorpse(sim, 'forest_wolf');
    armCorpse(sim, wolf);
    wolf.skinned = true; // already skinned
    sim.skin(wolf.id);
    expect(sim.player.castingAbility).toBeNull();
  });

  it('cannot skin while in combat', () => {
    const sim = makeSim();
    metaOf(sim).professionSkills.skinning = 5;
    metaOf(sim).professionTiers.skinning = 'apprentice';
    const wolf = beastCorpse(sim, 'forest_wolf');
    armCorpse(sim, wolf);
    sim.player.inCombat = true;
    sim.skin(wolf.id);
    expect(sim.player.castingAbility).toBeNull();
  });
});

describe('skinning — yield, despawn, skill-up', () => {
  it('skinning a low beast yields leather (or scraps), skills up (orange), and despawns the corpse', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    meta.professionSkills.skinning = 1; // orange vs a L1-2 wolf (nat 5-10)
    meta.professionTiers.skinning = 'apprentice';
    const wolf = beastCorpse(sim, 'forest_wolf');
    armCorpse(sim, wolf);
    sim.skin(wolf.id);
    expect(sim.player.castingAbility).toBe('skin:' + wolf.id);
    tick(sim, 3); // 2s cast + margin

    const gained = sim.countItem('light_leather') + sim.countItem('ruined_leather_scraps');
    expect(gained).toBeGreaterThan(0);
    expect(wolf.skinned).toBe(true);
    expect(wolf.corpseTimer).toBeLessThanOrEqual(4); // collapsed (despawns on respawn timer)
    expect(meta.professionSkills.skinning).toBe(2); // orange always skills up
  });

  it('at grey difficulty the skin never fails (always clean leather) and grants no skill-up', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    meta.professionSkills.skinning = 25; // grey vs a L1-2 wolf (nat 5-10, grey at >=20-25)
    meta.professionTiers.skinning = 'apprentice';
    const wolf = beastCorpse(sim, 'forest_wolf');
    armCorpse(sim, wolf); // dead + looted so completeSkin proceeds
    // drive completeSkin directly many times for a robust statistical check
    let scraps = 0; let leather = 0;
    for (let i = 0; i < 50; i++) {
      wolf.skinned = false; wolf.lootable = false;
      const before = sim.countItem('ruined_leather_scraps');
      const beforeL = sim.countItem('light_leather');
      (sim as any).completeSkin(sim.player, meta, wolf.id);
      scraps += sim.countItem('ruined_leather_scraps') - before;
      leather += sim.countItem('light_leather') - beforeL;
    }
    expect(scraps).toBe(0);     // grey failure chance is 0
    expect(leather).toBeGreaterThan(0);
    expect(meta.professionSkills.skinning).toBe(25); // grey: no skill-up
  });

  it('rare hides drop over many skins; orange skins sometimes fail to scraps', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    meta.professionSkills.skinning = 1; // orange vs the wolf → ~30% scrap failures
    meta.professionTiers.skinning = 'apprentice';
    const wolf = beastCorpse(sim, 'forest_wolf');
    armCorpse(sim, wolf); // dead + looted so completeSkin proceeds
    let scraps = 0; let hides = 0;
    for (let i = 0; i < 400; i++) {
      wolf.skinned = false; wolf.lootable = false;
      meta.professionSkills.skinning = 1; // pin orange
      const bScrap = sim.countItem('ruined_leather_scraps');
      const bHide = sim.countItem('light_hide');
      (sim as any).completeSkin(sim.player, meta, wolf.id);
      if (sim.countItem('ruined_leather_scraps') > bScrap) scraps++;
      if (sim.countItem('light_hide') > bHide) hides++;
    }
    expect(scraps).toBeGreaterThan(0); // orange does fail sometimes
    expect(hides).toBeGreaterThan(0);  // ~3% hide roll lands over 400 skins
  });

  it('a looted-but-unskinned skinnable corpse survives until the respawn timer (skin window stays open)', () => {
    const sim = makeSim();
    metaOf(sim).professionSkills.skinning = 5;
    metaOf(sim).professionTiers.skinning = 'apprentice';
    const wolf = beastCorpse(sim, 'forest_wolf');
    armCorpse(sim, wolf);
    wolf.corpseTimer = 4;     // loot-empty collapsed state
    wolf.respawnTimer = 30;   // respawn still pending
    tick(sim, 5);             // past corpseTimer, before respawnTimer
    expect(wolf.dead).toBe(true);   // not respawned — still skinnable
    expect(wolf.skinned).toBe(false);
  });

  it('looting a skinnable corpse grants a skin grace even when looted at the very end of its life', () => {
    const sim = makeSim();
    metaOf(sim).professionSkills.skinning = 5;
    metaOf(sim).professionTiers.skinning = 'apprentice';
    const wolf = beastCorpse(sim, 'forest_wolf');
    armCorpse(sim, wolf, { lootable: true, loot: { copper: 0, items: [{ itemId: 'wolf_fang', count: 1 }] } });
    wolf.respawnTimer = -1; // respawn timer already lapsed → late-loot worst case
    sim.lootCorpse(wolf.id);
    expect(wolf.lootable).toBe(false);
    expect(wolf.respawnTimer).toBeGreaterThanOrEqual(5); // grace applied on loot
    tick(sim, 3); // still around a few seconds later, skinnable
    expect(wolf.dead).toBe(true);
  });

  it('skin yield is deterministic for the same seed', () => {
    const run = () => {
      const sim = makeSim('warrior', 123);
      const meta = metaOf(sim);
      meta.professionSkills.skinning = 1;
      meta.professionTiers.skinning = 'apprentice';
      const wolf = beastCorpse(sim, 'forest_wolf');
      armCorpse(sim, wolf);
      (sim as any).completeSkin(sim.player, meta, wolf.id);
      return JSON.stringify(meta.inventory);
    };
    expect(run()).toEqual(run());
  });
});

describe('leatherworking & tailoring — crafting', () => {
  // crafted armor would auto-equip and leave the inventory, so disable autoEquip
  // here to assert on the crafted output count directly
  const craftSim = (cls: 'warrior' | 'mage' = 'warrior') =>
    new Sim({ seed: 42, playerClass: cls, autoEquip: false });
  const learn = (sim: Sim, profId: string, recipeId: string, skill = 100) => {
    const meta = metaOf(sim);
    meta.professionSkills[profId] = skill;
    meta.professionTiers[profId] = 'journeyman';
    meta.learnedRecipes.add(recipeId);
  };

  it('tailoring makes a bolt of linen from 3 linen cloth', () => {
    const sim = craftSim('mage');
    learn(sim, 'tailoring', 'bolt_of_linen', 1);
    sim.addItem('linen_cloth', 3);
    sim.craft('bolt_of_linen');
    tick(sim, 3);
    expect(sim.countItem('bolt_of_linen')).toBe(1);
    expect(sim.countItem('linen_cloth')).toBe(0);
  });

  it('the LW free starter recycles 3 ruined scraps into 1 light leather', () => {
    const sim = craftSim();
    learn(sim, 'leatherworking', 'light_leather_from_scraps', 1);
    sim.addItem('ruined_leather_scraps', 3);
    sim.craft('light_leather_from_scraps');
    tick(sim, 3);
    expect(sim.countItem('light_leather')).toBe(1);
    expect(sim.countItem('ruined_leather_scraps')).toBe(0);
  });

  it('crafts equippable cloth armor that the player can equip (requiredClass gate)', () => {
    const sim = craftSim('mage');
    learn(sim, 'tailoring', 'linen_boots');
    sim.addItem('bolt_of_linen', 2);
    sim.addItem('coarse_thread', 1);
    sim.craft('linen_boots');
    tick(sim, 4);
    expect(sim.countItem('linen_boots')).toBe(1);
    sim.equipItem('linen_boots');
    expect(metaOf(sim).equipment.feet).toBe('linen_boots');
    expect(ITEMS.linen_boots.quality).toBe('common');
  });

  it('hide curing: salt + raw hide → cured hide', () => {
    const sim = craftSim();
    learn(sim, 'leatherworking', 'cured_heavy_hide');
    sim.addItem('salt', 1);
    sim.addItem('heavy_hide', 1);
    sim.craft('cured_heavy_hide');
    tick(sim, 3);
    expect(sim.countItem('cured_heavy_hide')).toBe(1);
  });

  it('both blue capstones require the shared premium set (cross-wired professions)', () => {
    // Tailoring blue needs LW-made heavy straps + cured heavy hide; LW blue needs a silk bolt.
    const sim = craftSim('mage');
    learn(sim, 'tailoring', 'silk_brocade_robe');
    sim.addItem('bolt_of_silk', 3);
    sim.addItem('fine_thread', 1);
    // missing heavy_leather_straps + cured_heavy_hide → cannot craft
    sim.craft('silk_brocade_robe');
    expect(sim.player.castingAbility).toBeNull();
    sim.addItem('heavy_leather_straps', 2);
    sim.addItem('cured_heavy_hide', 1);
    sim.craft('silk_brocade_robe');
    expect(sim.player.castingAbility).toBe('craft:silk_brocade_robe');
    tick(sim, 5);
    expect(sim.countItem('silk_brocade_robe')).toBe(1);
    expect(ITEMS.silk_brocade_robe.quality).toBe('rare');
  });

  it('LW uses its own light leather straps on a mid recipe', () => {
    const sim = craftSim();
    learn(sim, 'leatherworking', 'medium_leather_vest');
    sim.addItem('medium_leather', 5);
    sim.addItem('light_leather_straps', 1);
    sim.addItem('rough_thread', 2);
    sim.craft('medium_leather_vest');
    tick(sim, 4);
    expect(sim.countItem('medium_leather_vest')).toBe(1);
    expect(sim.countItem('light_leather_straps')).toBe(0); // consumed
  });
});

describe('professions — recipe-source seam (learnRecipe item-use)', () => {
  it('using a pattern item teaches its recipe and consumes the item', () => {
    const sim = makeSim('mage');
    const meta = metaOf(sim);
    meta.professionSkills.tailoring = 50;
    meta.professionTiers.tailoring = 'journeyman';
    // synthetic pattern item (the seam ships with no shipped pattern items in PR 2)
    (ITEMS as any).pattern_linen_robe = {
      id: 'pattern_linen_robe', name: 'Pattern: Linen Robe', kind: 'reagent',
      use: { type: 'learnRecipe', recipeId: 'linen_robe' }, sellValue: 1,
    };
    try {
      sim.addItem('pattern_linen_robe', 1);
      expect(meta.learnedRecipes.has('linen_robe')).toBe(false);
      sim.useItem('pattern_linen_robe');
      expect(meta.learnedRecipes.has('linen_robe')).toBe(true);
      expect(sim.countItem('pattern_linen_robe')).toBe(0); // consumed
    } finally {
      delete (ITEMS as any).pattern_linen_robe;
    }
  });
});

describe('professions — three-primary cap with the real professions', () => {
  it('rejects a third primary once Skinning + Leatherworking are known', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    meta.copper = 100000;
    const goTo = (templateId: string) => {
      const npc = findEntity(sim, (e) => e.kind === 'npc' && e.templateId === templateId) as any;
      sim.player.pos.x = npc.pos.x; sim.player.pos.z = npc.pos.z;
      sim.player.prevPos = { ...sim.player.pos };
      sim.tick();
    };
    goTo('tanner_yorvek'); sim.learnProfession('skinning', 'apprentice');
    goTo('leatherworker_brida'); sim.learnProfession('leatherworking', 'apprentice');
    expect(meta.professionSkills.skinning).toBe(1);
    expect(meta.professionSkills.leatherworking).toBe(1);
    goTo('tailor_marlena'); sim.learnProfession('tailoring', 'apprentice'); // 3rd primary → rejected
    expect(meta.professionSkills.tailoring).toBeUndefined();
  });
});

describe('professions — trade goods', () => {
  it('every TRADE_GOODS id is a real, vendor-buyable reagent stocked by a Provisioner', () => {
    for (const id of TRADE_GOODS) {
      expect(ITEMS[id], id).toBeTruthy();
      expect(ITEMS[id].kind).toBe('reagent');
      expect(ITEMS[id].buyValue, id).toBeGreaterThan(0);
    }
    const stocked = new Set<string>();
    for (const npc of Object.values(NPCS)) for (const it of (npc.vendorItems ?? [])) stocked.add(it);
    for (const id of TRADE_GOODS) expect(stocked.has(id), `${id} should be sold by a vendor`).toBe(true);
  });
});
