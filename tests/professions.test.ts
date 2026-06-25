import { describe, expect, it } from 'vitest';
import {
  HARVEST_NODES,
  ITEMS,
  PROFESSIONS,
  RECIPE_BY_ID,
  RECIPES,
} from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import {
  PROFESSION_PRIMARY_CAP,
  PROFESSION_RANKS,
  PROFESSION_SKILL_MAX,
  professionColor,
  professionSkillUpChance,
} from '../src/sim/types';

function newSim(seed = 42): Sim {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: false });
}

/** Move the primary player on top of the first lootable entity whose
 *  objectItemId matches, so an interact lands within INTERACT_RANGE. */
function nodeEntity(sim: Sim, nodeId: string): Entity {
  const obj = [...sim.entities.values()].find(
    (e) => e.kind === 'object' && e.objectItemId === nodeId && e.lootable,
  );
  if (!obj) throw new Error(`no spawned node entity for ${nodeId}`);
  const player = sim.entities.get(sim.primaryId)!;
  player.pos.x = obj.pos.x;
  player.pos.z = obj.pos.z;
  return obj;
}

describe('professions content integrity', () => {
  it('every node yield / recipe reagent / recipe output references a real item', () => {
    for (const node of HARVEST_NODES) {
      for (const y of node.yields) {
        expect(ITEMS[y.itemId], `node ${node.id} yields missing item ${y.itemId}`).toBeDefined();
      }
    }
    for (const r of RECIPES) {
      expect(ITEMS[r.output.itemId], `recipe ${r.id} output ${r.output.itemId}`).toBeDefined();
      for (const rg of r.reagents) {
        expect(ITEMS[rg.itemId], `recipe ${r.id} reagent ${rg.itemId}`).toBeDefined();
      }
    }
  });

  it('every node/recipe profession is registered, and gather nodes are gathering professions', () => {
    for (const node of HARVEST_NODES) {
      const prof = PROFESSIONS[node.profession];
      expect(prof, `node ${node.id} profession`).toBeDefined();
      expect(prof.kind).toBe('gathering');
      expect(node.grey).toBeGreaterThan(node.reqSkill);
    }
    for (const r of RECIPES) {
      expect(PROFESSIONS[r.profession], `recipe ${r.id} profession`).toBeDefined();
      expect(r.grey).toBeGreaterThan(r.reqSkill);
    }
  });

  it('crafted material items are tagged kind:material and are stackable inputs', () => {
    expect(ITEMS.copper_ore?.kind).toBe('material');
    expect(ITEMS.copper_bar?.kind).toBe('material');
    expect(ITEMS.peacebloom?.kind).toBe('material');
  });
});

describe('profession skill math (classic orange/yellow/green/grey)', () => {
  it('is guaranteed at reqSkill (orange) and zero at/above grey', () => {
    expect(professionSkillUpChance(1, 1, 75)).toBe(1);
    expect(professionSkillUpChance(75, 1, 75)).toBe(0);
    expect(professionSkillUpChance(100, 1, 75)).toBe(0);
    // below the requirement you cannot perform it
    expect(professionSkillUpChance(40, 50, 125)).toBe(0);
  });

  it('decreases monotonically across the band', () => {
    let prev = Number.POSITIVE_INFINITY;
    for (let s = 1; s <= 75; s++) {
      const c = professionSkillUpChance(s, 1, 75);
      expect(c).toBeLessThanOrEqual(prev);
      prev = c;
    }
  });

  it('colours track the chance bands', () => {
    expect(professionColor(1, 1, 75)).toBe('orange');
    expect(professionColor(75, 1, 75)).toBe('grey');
    // somewhere mid-band is yellow or green, never orange/grey
    expect(['yellow', 'green']).toContain(professionColor(40, 1, 75));
  });
});

describe('learning professions', () => {
  it('learns a profession at skill 1, Apprentice rank', () => {
    const sim = newSim();
    sim.learnProfession('mining', sim.primaryId);
    const profs = sim.professionState(sim.primaryId);
    expect(profs).toEqual([{ id: 'mining', skill: 1, rankTier: 0 }]);
  });

  it('enforces the primary-profession cap', () => {
    const sim = newSim();
    sim.learnProfession('mining', sim.primaryId);
    sim.learnProfession('herbalism', sim.primaryId);
    sim.learnProfession('alchemy', sim.primaryId); // over the cap
    expect(sim.professionState(sim.primaryId)).toHaveLength(PROFESSION_PRIMARY_CAP);
    const ids = sim.professionState(sim.primaryId).map((p) => p.id);
    expect(ids).toEqual(['mining', 'herbalism']);
  });

  it('abandoning frees a slot', () => {
    const sim = newSim();
    sim.learnProfession('mining', sim.primaryId);
    sim.learnProfession('herbalism', sim.primaryId);
    sim.abandonProfession('mining', sim.primaryId);
    sim.learnProfession('alchemy', sim.primaryId);
    const ids = sim.professionState(sim.primaryId)
      .map((p) => p.id)
      .sort();
    expect(ids).toEqual(['alchemy', 'herbalism']);
  });
});

describe('gathering', () => {
  it('harvesting a copper vein yields ore and (at orange) raises skill', () => {
    const sim = newSim();
    const pid = sim.primaryId;
    sim.learnProfession('mining', pid);
    const obj = nodeEntity(sim, 'copper_vein');
    sim.pickUpObject(obj.id, pid);
    expect(sim.countItem('copper_ore', pid)).toBeGreaterThanOrEqual(1);
    // chance at skill 1 vs req 1 is 1.0, so the first harvest is a guaranteed up
    expect(sim.professionState(pid)[0].skill).toBe(2);
    // node is consumed and will respawn
    expect(obj.lootable).toBe(false);
    expect(obj.respawnTimer).toBeGreaterThan(0);
  });

  it('refuses to harvest without the profession', () => {
    const sim = newSim();
    const pid = sim.primaryId;
    const obj = nodeEntity(sim, 'copper_vein');
    sim.pickUpObject(obj.id, pid);
    expect(sim.countItem('copper_ore', pid)).toBe(0);
    expect(obj.lootable).toBe(true); // untouched
  });
});

describe('crafting', () => {
  it('smelts ore into a bar, consuming reagents', () => {
    const sim = newSim();
    const pid = sim.primaryId;
    sim.learnProfession('mining', pid);
    sim.addItem('copper_ore', 5, pid);
    const recipe = RECIPE_BY_ID.smelt_copper_bar;
    expect(recipe).toBeDefined();
    sim.craftItem('smelt_copper_bar', 3, pid);
    expect(sim.countItem('copper_bar', pid)).toBe(3 * recipe.output.count);
    expect(sim.countItem('copper_ore', pid)).toBe(5 - 3 * recipe.reagents[0].count);
  });

  it('stops early when reagents run out and reports it when nothing is made', () => {
    const sim = newSim();
    const pid = sim.primaryId;
    sim.learnProfession('mining', pid);
    sim.craftItem('smelt_copper_bar', 1, pid); // no ore at all
    expect(sim.countItem('copper_bar', pid)).toBe(0);
  });

  it('refuses recipes above the current skill', () => {
    const sim = newSim();
    const pid = sim.primaryId;
    sim.learnProfession('blacksmithing', pid);
    // give plenty of bars for a high-tier recipe
    sim.addItem('mithril_bar', 20, pid);
    const mithril = RECIPES.find((r) => r.profession === 'blacksmithing' && r.reqSkill > 50);
    expect(mithril).toBeDefined();
    sim.craftItem(mithril!.id, 1, pid);
    expect(sim.countItem(mithril!.output.itemId, pid)).toBe(0);
  });
});

describe('rank advancement (gold sink)', () => {
  it('requires the tier maxed and the fee, then raises the cap', () => {
    const sim = newSim();
    const pid = sim.primaryId;
    sim.learnProfession('mining', pid);
    const meta = sim.players.get(pid)!;
    // not yet at the apprentice cap -> rejected
    sim.advanceProfessionRank('mining', pid);
    expect(meta.professions.get('mining')!.rankTier).toBe(0);
    // max the apprentice tier, but no money -> rejected
    meta.professions.get('mining')!.skill = PROFESSION_RANKS[0].cap;
    meta.copper = 0;
    sim.advanceProfessionRank('mining', pid);
    expect(meta.professions.get('mining')!.rankTier).toBe(0);
    // pay the fee -> advances, copper deducted
    meta.copper = PROFESSION_RANKS[1].cost + 10;
    sim.advanceProfessionRank('mining', pid);
    expect(meta.professions.get('mining')!.rankTier).toBe(1);
    expect(meta.copper).toBe(10);
  });

  it('skill never exceeds the active rank cap or the absolute max', () => {
    const sim = newSim();
    const pid = sim.primaryId;
    sim.learnProfession('alchemy', pid);
    const meta = sim.players.get(pid)!;
    meta.professions.get('alchemy')!.skill = PROFESSION_RANKS[0].cap; // apprentice cap
    sim.addItem('peacebloom', 50, pid);
    // craft many minor potions at apprentice cap; skill must stay capped
    sim.craftItem('craft_minor_healing_potion', 20, pid);
    expect(meta.professions.get('alchemy')!.skill).toBeLessThanOrEqual(PROFESSION_RANKS[0].cap);
    expect(meta.professions.get('alchemy')!.skill).toBeLessThanOrEqual(PROFESSION_SKILL_MAX);
  });
});

describe('persistence + determinism', () => {
  it('professions survive a serialize / load roundtrip', () => {
    const sim = newSim();
    const pid = sim.primaryId;
    sim.learnProfession('herbalism', pid);
    const meta = sim.players.get(pid)!;
    meta.professions.get('herbalism')!.skill = 42;
    const state = sim.serializeCharacter(pid)!;
    const sim2 = newSim();
    const pid2 = sim2.addPlayer('warrior', 'Saved', { state });
    expect(sim2.professionState(pid2)).toEqual([{ id: 'herbalism', skill: 42, rankTier: 0 }]);
  });

  it('same seed + same actions gives the same harvest result', () => {
    const run = (): { ore: number; skill: number } => {
      const sim = newSim(7);
      const pid = sim.primaryId;
      sim.learnProfession('mining', pid);
      const obj = nodeEntity(sim, 'tin_vein');
      // tin requires skill 50; grant it deterministically so the harvest succeeds
      sim.players.get(pid)!.professions.get('mining')!.skill = 60;
      sim.pickUpObject(obj.id, pid);
      return {
        ore: sim.countItem('tin_ore', pid),
        skill: sim.professionState(pid)[0].skill,
      };
    };
    expect(run()).toEqual(run());
  });
});
