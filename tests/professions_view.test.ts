import { describe, expect, it } from 'vitest';
import { buildProfessionsView, type ProfessionsViewInput } from '../src/ui/professions_view';
import { PROFESSION_PRIMARY_CAP, PROFESSION_RANKS } from '../src/sim/types';
import type { InvSlot } from '../src/sim/types';

// Inputs are built by hand from real profession/recipe/item ids (mining +
// alchemy, see src/sim/content/professions.ts). buildProfessionsView is a pure
// projection over PROFESSIONS / RECIPES_BY_PROFESSION + the catalog helpers, so
// these drive it directly with no DOM.

const APPRENTICE = 0; // PROFESSION_RANKS[0], cap 75
const JOURNEYMAN = 1; // PROFESSION_RANKS[1], cap 150

function mining(skill: number, rankTier = APPRENTICE): ProfessionsViewInput['professions'][number] {
  return { id: 'mining', skill, rankTier };
}

function bag(...slots: [itemId: string, count: number][]): InvSlot[] {
  return slots.map(([itemId, count]) => ({ itemId, count }));
}

describe('buildProfessionsView learned professions', () => {
  it('reports skill/cap, rank, and recipes sorted by reqSkill ascending', () => {
    const view = buildProfessionsView({
      professions: [mining(60)],
      copper: 0,
      inventory: [],
    });
    expect(view.slotsUsed).toBe(1);
    expect(view.slotCap).toBe(PROFESSION_PRIMARY_CAP);
    const prof = view.learned[0];
    expect(prof.id).toBe('mining');
    expect(prof.kind).toBe('gathering');
    expect(prof.skill).toBe(60);
    expect(prof.cap).toBe(PROFESSION_RANKS[APPRENTICE].cap); // 75
    expect(prof.rankId).toBe('apprentice');
    expect(prof.rankName).toBe(PROFESSION_RANKS[APPRENTICE].name);

    const reqs = prof.recipes.map((r) => r.reqSkill);
    const sorted = [...reqs].sort((a, b) => a - b);
    expect(reqs).toEqual(sorted);
    // Smelting recipes belong to mining; the first (copper) is reqSkill 1.
    expect(prof.recipes[0].id).toBe('smelt_copper_bar');
    expect(prof.recipes[0].outputItemId).toBe('copper_bar');
  });

  it('locks a recipe whose reqSkill exceeds the player skill', () => {
    // smelt_iron_bar has reqSkill 100; at skill 60 it is locked.
    const view = buildProfessionsView({ professions: [mining(60)], copper: 0, inventory: [] });
    const iron = view.learned[0].recipes.find((r) => r.id === 'smelt_iron_bar');
    expect(iron).toBeDefined();
    expect(iron!.locked).toBe(true);
    expect(iron!.craftable).toBe(false);
    // Locked rows carry the 'orange' colour placeholder.
    expect(iron!.color).toBe('orange');
  });

  it('marks a recipe craftable when skill >= reqSkill and all reagents are present', () => {
    // smelt_copper_bar: reqSkill 1, needs 1 copper_ore.
    const view = buildProfessionsView({
      professions: [mining(40)],
      copper: 0,
      inventory: bag(['copper_ore', 3]),
    });
    const copper = view.learned[0].recipes.find((r) => r.id === 'smelt_copper_bar')!;
    expect(copper.locked).toBe(false);
    expect(copper.craftable).toBe(true);
    expect(copper.reagents).toEqual([
      { itemId: 'copper_ore', need: 1, have: 3, enough: true },
    ]);
    // Difficulty colour is meaningful for an unlocked recipe.
    expect(['orange', 'yellow', 'green', 'grey']).toContain(copper.color);
  });

  it('marks a recipe not craftable when a reagent is missing, with correct have/need', () => {
    // smelt_bronze_bar: reqSkill 65, needs 1 copper_bar + 1 tin_bar.
    const view = buildProfessionsView({
      professions: [mining(70)],
      copper: 0,
      inventory: bag(['copper_bar', 1]), // tin_bar absent
    });
    const bronze = view.learned[0].recipes.find((r) => r.id === 'smelt_bronze_bar')!;
    expect(bronze.locked).toBe(false);
    expect(bronze.craftable).toBe(false);
    const tin = bronze.reagents.find((r) => r.itemId === 'tin_bar')!;
    expect(tin).toEqual({ itemId: 'tin_bar', need: 1, have: 0, enough: false });
    const copperBar = bronze.reagents.find((r) => r.itemId === 'copper_bar')!;
    expect(copperBar).toEqual({ itemId: 'copper_bar', need: 1, have: 1, enough: true });
  });

  it('sums reagent counts across multiple inventory slots', () => {
    const view = buildProfessionsView({
      professions: [mining(40)],
      copper: 0,
      inventory: bag(['copper_ore', 1], ['copper_ore', 2]),
    });
    const copper = view.learned[0].recipes.find((r) => r.id === 'smelt_copper_bar')!;
    expect(copper.reagents[0].have).toBe(3);
    expect(copper.craftable).toBe(true);
  });

  it('exposes alchemy recipes for a learned crafting profession', () => {
    // craft_minor_healing_potion: reqSkill 1, needs 1 peacebloom.
    const view = buildProfessionsView({
      professions: [{ id: 'alchemy', skill: 10, rankTier: APPRENTICE }],
      copper: 0,
      inventory: bag(['peacebloom', 2]),
    });
    const prof = view.learned[0];
    expect(prof.kind).toBe('crafting');
    expect(prof.feedsFrom).toBe('herbalism');
    const potion = prof.recipes.find((r) => r.id === 'craft_minor_healing_potion')!;
    expect(potion.craftable).toBe(true);
    expect(potion.reagents[0]).toEqual({ itemId: 'peacebloom', need: 1, have: 2, enough: true });
  });
});

describe('buildProfessionsView next rank', () => {
  it('is reachable only when the current tier cap is reached, and affordable per copper', () => {
    // Apprentice cap is 75; journeyman costs PROFESSION_RANKS[1].cost.
    const cost = PROFESSION_RANKS[JOURNEYMAN].cost;

    // Below cap: not reachable.
    const below = buildProfessionsView({
      professions: [mining(40)],
      copper: cost,
      inventory: [],
    }).learned[0];
    expect(below.atRankCap).toBe(false);
    expect(below.nextRank).toBeDefined();
    expect(below.nextRank!.reachable).toBe(false);
    expect(below.nextRank!.affordable).toBe(true);
    expect(below.nextRank!.cost).toBe(cost);
    expect(below.nextRank!.rankId).toBe('journeyman');

    // At cap but broke: reachable, not affordable.
    const broke = buildProfessionsView({
      professions: [mining(75)],
      copper: cost - 1,
      inventory: [],
    }).learned[0];
    expect(broke.atRankCap).toBe(true);
    expect(broke.nextRank!.reachable).toBe(true);
    expect(broke.nextRank!.affordable).toBe(false);

    // At cap and flush: reachable and affordable.
    const ready = buildProfessionsView({
      professions: [mining(75)],
      copper: cost,
      inventory: [],
    }).learned[0];
    expect(ready.nextRank!.reachable).toBe(true);
    expect(ready.nextRank!.affordable).toBe(true);
  });

  it('omits nextRank at the top tier', () => {
    const top = PROFESSION_RANKS.length - 1;
    const view = buildProfessionsView({
      professions: [mining(PROFESSION_RANKS[top].cap, top)],
      copper: 999999,
      inventory: [],
    }).learned[0];
    expect(view.nextRank).toBeUndefined();
    expect(view.atRankCap).toBe(true);
  });
});

describe('buildProfessionsView available-to-learn list', () => {
  it('is populated with the not-learned professions while under the primary cap', () => {
    const view = buildProfessionsView({ professions: [mining(20)], copper: 0, inventory: [] });
    expect(view.slotsUsed).toBeLessThan(PROFESSION_PRIMARY_CAP);
    const ids = view.available.map((a) => a.id).sort();
    expect(ids).toEqual(['alchemy', 'blacksmithing', 'herbalism']);
    // Learned profession is never offered again.
    expect(ids).not.toContain('mining');
    const bs = view.available.find((a) => a.id === 'blacksmithing')!;
    expect(bs.feedsFrom).toBe('mining');
  });

  it('is empty once the player is at PROFESSION_PRIMARY_CAP learned professions', () => {
    const profs = [mining(20), { id: 'herbalism' as const, skill: 20, rankTier: APPRENTICE }];
    expect(profs.length).toBe(PROFESSION_PRIMARY_CAP);
    const view = buildProfessionsView({ professions: profs, copper: 0, inventory: [] });
    expect(view.slotsUsed).toBe(PROFESSION_PRIMARY_CAP);
    expect(view.available).toEqual([]);
  });
});

describe('buildProfessionsView is a pure projection', () => {
  it('returns an identical structure for identical input (no hidden state)', () => {
    const input: ProfessionsViewInput = {
      professions: [mining(70), { id: 'alchemy', skill: 120, rankTier: JOURNEYMAN }],
      copper: 2500,
      inventory: bag(['copper_ore', 4], ['peacebloom', 1], ['tin_bar', 2]),
    };
    expect(buildProfessionsView(input)).toEqual(buildProfessionsView(input));
  });
});
