// @vitest-environment happy-dom
//
// The material kind-line split: fine grades read "Fine Material", honest
// materials (ores, raw cooking catches, game_meat, ...) read "Material", and
// grey non-material junk keeps "Junk". Kind stays 'junk' internally for sell
// and taxonomy rules. Unit arms drive item_kind_label directly; one integration
// arm keeps Hud.prototype.itemTooltip honest.

import { describe, expect, it } from 'vitest';
import { FARM_CROPS } from '../src/sim/content/farm_crops';
import { RAW_COOKING_CATCH_IDS } from '../src/sim/content/items';
import { ITEMS } from '../src/sim/data';
import { MATERIAL_ITEM_IDS } from '../src/sim/material_taxonomy';
import { baseMaterialFor, materialGradeIds } from '../src/sim/professions/material_grades';
import { Hud } from '../src/ui/hud';
import { itemKindLabel, itemQualityLabel } from '../src/ui/item_kind_label';
import { adoptedTrophyIds } from './helpers/adopted_trophy_ids';

function tooltipHtml(itemId: string): string {
  const h = Object.create(Hud.prototype) as unknown as {
    itemTooltip(item: unknown, compare?: boolean): string;
  };
  const item = ITEMS[itemId];
  if (!item) throw new Error(`missing item ${itemId}`);
  return h.itemTooltip(item, false);
}

describe('itemKindLabel and itemQualityLabel, driven directly', () => {
  it('splits fine grade, honest material, and grey junk off kind junk', () => {
    expect(itemKindLabel('junk', 'fine_iron_ore')).toBe('Fine Material');
    expect(itemKindLabel('junk', 'iron_ore')).toBe('Material');
    expect(itemKindLabel('junk', 'game_meat')).toBe('Material');
    expect(itemKindLabel('junk', 'raw_river_perch')).toBe('Material');
    // No item id at all (callers without one): plain junk.
    expect(itemKindLabel('junk')).toBe('Junk');
    expect(itemKindLabel('weapon', 'fine_iron_ore')).toBe('Weapon');
    // Recipe pattern items render the classic "Pattern" kind line.
    expect(itemKindLabel('recipe')).toBe('Pattern');
    // The phase 06 buff scrolls render their own kind line, not Elixir: the
    // kind exists so the tooltip and use log can say scroll.
    expect(itemKindLabel('scroll')).toBe('Scroll');
  });

  it('quality defaults to common when the def carries none', () => {
    expect(itemQualityLabel(undefined)).toBe(itemQualityLabel('common'));
    expect(itemQualityLabel('epic')).not.toBe(itemQualityLabel('common'));
  });
});

describe('the tooltip kind line for material grades', () => {
  it('a fine grade reads Fine Material, never Junk; its base reads Material', () => {
    expect(ITEMS.fine_iron_ore.kind).toBe('junk');
    expect(baseMaterialFor('fine_iron_ore')).toBe('iron_ore');
    const fine = tooltipHtml('fine_iron_ore');
    expect(fine).toContain('Fine Material');
    // The plain refusal, matching the farm-twin arm below: itemKindLabel can
    // return 'Fine Material' or 'Material' or the kind label, never a "Fine
    // Junk", so the lookbehind this arm used to carry only weakened it. (Kept
    // in step deliberately: the registry suite's lesson this same wave was a
    // floor repaired in one place and left open two lines away.)
    expect(fine).not.toMatch(/\bJunk\b/);
    const base = tooltipHtml('iron_ore');
    expect(base).toContain('Material');
    expect(base).not.toContain('Fine Material');
    expect(base).not.toMatch(/\bJunk\b/);
  });

  it('raw cooking catches and game_meat read Material, not Junk', () => {
    for (const id of RAW_COOKING_CATCH_IDS) {
      expect(MATERIAL_ITEM_IDS.has(id), id).toBe(true);
      expect(itemKindLabel('junk', id), id).toBe('Material');
      const html = tooltipHtml(id);
      expect(html, id).toContain('Material');
      expect(html, id).not.toMatch(/\bJunk\b/);
      expect(html, id).not.toContain('Fine Material');
    }
    expect(itemKindLabel('junk', 'game_meat')).toBe('Material');
    expect(tooltipHtml('game_meat')).toContain('Material');
    expect(tooltipHtml('game_meat')).not.toMatch(/\bJunk\b/);
  });

  it('phase 11l trophies read Material, not Junk, now recipes consume them', () => {
    // Every adopted junk trophy (the shared derivation in
    // tests/helpers/adopted_trophy_ids.ts: the junk-kind reagents of the
    // TROPHY_RECIPES rows no other recipe consumes), by name, so a future
    // adoption or de-adoption moves this arm too. Membership is derived
    // from recipe reagents, so these arms hold the whole promotion visible
    // on the kind line, through the REAL Hud.prototype.itemTooltip.
    const adopted = adoptedTrophyIds(ITEMS);
    expect(adopted).toHaveLength(7);
    for (const id of adopted) {
      expect(MATERIAL_ITEM_IDS.has(id), id).toBe(true);
      expect(itemKindLabel('junk', id), id).toBe('Material');
      const html = tooltipHtml(id);
      expect(html, id).toContain('Material');
      expect(html, id).not.toMatch(/\bJunk\b/);
      expect(html, id).not.toContain('Fine Material');
    }
    // The two holdouts and the three output-excluded trophies (the chipped
    // tusk at the sixth fix round, the bogiron nugget and the cracked fetish
    // at the 11l QA) keep the Junk line, by name.
    for (const id of [
      'tangled_weed',
      'soggy_moccasin',
      'chipped_tusk',
      'bogiron_nugget',
      'cracked_fetish',
    ]) {
      expect(MATERIAL_ITEM_IDS.has(id), id).toBe(false);
      expect(itemKindLabel('junk', id), id).toBe('Junk');
      expect(tooltipHtml(id), id).toContain('Junk');
    }
  });

  it('Core of the Last Flame reads Epic Material, not Epic Junk', () => {
    expect(ITEMS.lastflame_core.kind).toBe('junk');
    expect(MATERIAL_ITEM_IDS.has('lastflame_core')).toBe(true);
    expect(itemKindLabel('junk', 'lastflame_core')).toBe('Material');
    const html = tooltipHtml('lastflame_core');
    expect(html).toContain('Epic Material');
    expect(html).not.toContain('Epic Junk');
  });

  it('ordinary junk-kind items keep the Junk line when not honest materials', () => {
    const junkId = Object.keys(ITEMS).find(
      (id) =>
        ITEMS[id].kind === 'junk' &&
        baseMaterialFor(id) === undefined &&
        !MATERIAL_ITEM_IDS.has(id),
    );
    if (!junkId) throw new Error('no plain junk-kind item in content');
    expect(tooltipHtml(junkId)).toContain('Junk');
    expect(itemKindLabel('junk', junkId)).toBe('Junk');
  });

  it('cooked meals still read Food', () => {
    expect(itemKindLabel('food', 'pan_seared_perch')).toBe('Food');
    expect(tooltipHtml('pan_seared_perch')).toContain('Food');
  });
});

// The farm half of the same split (qr-19-farm-fine-produce-kind-label). The
// twelve farm fine twins used to fall past baseMaterialFor into
// MATERIAL_ITEM_IDS and read the plain "Material" the nine node fine grades
// do not. They now read "Fine Material" through a presentation-only arm. The
// third block below is the load-bearing one: it proves the label moved and
// the SUBSTITUTION did not, because the tempting fix (adding the twins to
// MATERIAL_GRADES) would have let a fine twin satisfy a recipe asking for
// base produce, a gameplay change nobody asked for.
describe('the farm fine produce kind line', () => {
  const crops = Object.values(FARM_CROPS);

  it('every farm fine twin reads Fine Material, like the nine node fine grades', () => {
    expect(crops).toHaveLength(12);
    for (const crop of crops) {
      const id = crop.fineProduceItemId;
      expect(ITEMS[id].kind, id).toBe('junk');
      expect(itemKindLabel('junk', id), id).toBe('Fine Material');
      const html = tooltipHtml(id);
      expect(html, id).toContain('Fine Material');
      // The plain refusal is what is meant: "Fine Junk" is a string the label
      // resolver cannot produce, so the lookbehind the older arms carry would
      // only weaken this one.
      expect(html, id).not.toMatch(/\bJunk\b/);
    }
  });

  it('the base produce and the seeds still read Material, never Fine Material', () => {
    for (const crop of crops) {
      for (const id of [crop.produceItemId, crop.seedItemId]) {
        expect(MATERIAL_ITEM_IDS.has(id), id).toBe(true);
        expect(itemKindLabel('junk', id), id).toBe('Material');
        expect(tooltipHtml(id), id).not.toContain('Fine Material');
      }
    }
  });

  it('the label split leaked no downward substitution into materialGradeIds', () => {
    for (const crop of crops) {
      // The twins are still outside the FINE_GRADE pairing, which is what
      // makes the label arm necessary AND what keeps the substitution shut.
      expect(baseMaterialFor(crop.fineProduceItemId), crop.id).toBeUndefined();
      expect(materialGradeIds(crop.produceItemId), crop.id).toEqual([crop.produceItemId]);
      expect(materialGradeIds(crop.fineProduceItemId), crop.id).toEqual([crop.fineProduceItemId]);
    }
    // The nine node yields are untouched: a base still walks to its fine grade.
    expect(materialGradeIds('iron_ore')).toEqual(['iron_ore', 'fine_iron_ore']);
  });
});
