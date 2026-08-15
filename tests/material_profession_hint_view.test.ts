// @vitest-environment happy-dom
//
// Profession-affinity tooltip line: honest materials name their crafts, Junk
// stays for true grey trash, superseding purpose hints avoid double lines, and
// the Hud.prototype.itemTooltip integration arm stays honest. Multi-craft
// texts are pinned as EXACT strings (not per-name toContain), so the view
// cannot silently reorder or re-sort what the sim derived in ring order.

import { describe, expect, it } from 'vitest';
import { RAW_COOKING_CATCH_IDS } from '../src/sim/content/items';
import { ITEMS } from '../src/sim/data';
import { craftIdsForMaterialItem } from '../src/sim/material_profession_affinity';
import { MATERIAL_ITEM_IDS } from '../src/sim/material_taxonomy';
import { baseMaterialFor } from '../src/sim/professions/material_grades';
import { Hud } from '../src/ui/hud';
import { setLanguage } from '../src/ui/i18n';
import { itemKindLabel } from '../src/ui/item_kind_label';
import { materialProfessionHintText } from '../src/ui/material_profession_hint_view';

function tooltipHtml(itemId: string): string {
  const h = Object.create(Hud.prototype) as unknown as {
    itemTooltip(item: unknown, compare?: boolean): string;
  };
  const item = ITEMS[itemId];
  if (!item) throw new Error(`missing item ${itemId}`);
  return h.itemTooltip(item, false);
}

/** One plain junk-kind item that is neither a material nor a graded fine id:
 *  the arm that must keep saying "Junk". Shared by the unit and integration
 *  suites so the two cannot silently diverge on which item they exercise. */
function plainJunkId(): string {
  const junkId = Object.keys(ITEMS).find(
    (id) =>
      ITEMS[id].kind === 'junk' && baseMaterialFor(id) === undefined && !MATERIAL_ITEM_IDS.has(id),
  );
  if (!junkId) throw new Error('no plain junk-kind item in content');
  return junkId;
}

describe('materialProfessionHintText', () => {
  it('Rough Hide reads the exact ring-ordered Used-by line, never Junk on the kind line', () => {
    expect(itemKindLabel('junk', 'rough_hide')).toBe('Material');
    // Exact string: pins ring order (leatherworking before weaponcrafting
    // before armorcrafting), the localized names, and the en conjunction
    // ("A, B, and C") in one decisive arm. A view-side sort() or a first-seen
    // recipe order both fail here.
    expect(materialProfessionHintText('rough_hide')).toBe(
      'Used by Leatherworking, Weaponcrafting, and Armorcrafting.',
    );
  });

  it('single-craft materials use a simple Used by line', () => {
    expect(materialProfessionHintText('game_meat')).toBe('Used by Cooking.');
    expect(materialProfessionHintText('venom_gland')).toBe('Used by Alchemy.');
  });

  it('skips pure cooking catches; multi-craft catches keep the line, and both arms are live', () => {
    // Sole-cooking catches share cookingCatchHint; the Used-by line would only
    // repeat "Cooking". Multi-craft catches still get Used-by. Count both arms
    // so a content drift that empties either one fails here instead of
    // silently retiring half the claim.
    let soleCooking = 0;
    let multiCraft = 0;
    for (const id of RAW_COOKING_CATCH_IDS) {
      const crafts = craftIdsForMaterialItem(id);
      if (crafts.length === 1 && crafts[0] === 'cooking') {
        soleCooking++;
        expect(materialProfessionHintText(id), id).toBe('');
      } else {
        multiCraft++;
        expect(materialProfessionHintText(id), id).toMatch(/^Used by /);
      }
    }
    expect(soleCooking).toBeGreaterThan(0);
    expect(multiCraft).toBeGreaterThan(0);
    // The two-element en conjunction has no comma; also pins that a catch
    // consumed by engineering AND cooking names both beside the cooking line.
    expect(materialProfessionHintText('raw_stonescale_carp')).toBe(
      'Used by Engineering and Cooking.',
    );
  });

  it('skips enchanting-only materials that already say Enchanting reagent', () => {
    expect(materialProfessionHintText('arcane_dust')).toBe('');
    expect(materialProfessionHintText('resonant_hide')).toBe('');
  });

  it('a fineGrade hint never supersedes: single-craft fine grades keep their line', () => {
    // fine_ironbark_log carries materialHintKey (the shared fineGrade
    // sentence, which names no craft) and exactly one consumer. This is the
    // counterpart pin for the === 'enchanting' comparison in
    // hasSupersedingPurposeHint: dropping it would silently blank this line.
    expect(materialProfessionHintText('fine_ironbark_log')).toBe('Used by Weaponcrafting.');
  });

  it('fine grades name every craft beside the Fine grade purpose line, in ring order', () => {
    expect(materialProfessionHintText('fine_iron_ore')).toBe(
      'Used by Engineering, Weaponcrafting, and Armorcrafting.',
    );
  });

  it('plain grey junk and non-materials get no line', () => {
    expect(materialProfessionHintText(plainJunkId())).toBe('');
    expect(materialProfessionHintText('eastbrook_arming_sword')).toBe('');
  });

  it('the conjunction is locale data, not concatenated English', () => {
    // The craft names have shipped fills and Intl.ListFormat supplies the
    // list conjunction per locale, so under fr_FR the three-name list joins
    // with "et", never the en ", and ". Structural pin only: the sentence
    // template and the names themselves are release-fill material and are
    // deliberately not pinned here.
    try {
      setLanguage('fr_FR');
      const text = materialProfessionHintText('rough_hide');
      expect(text).toContain(' et ');
      expect(text).not.toContain(', and ');
    } finally {
      setLanguage('en');
    }
  });
});

describe('itemTooltip integration for profession material tags', () => {
  it('Rough Hide tooltip carries the exact painted line, never Junk', () => {
    const html = tooltipHtml('rough_hide');
    expect(html).toContain('Material');
    expect(html).not.toMatch(/\bJunk\b/);
    // The full painted element: createTooltipLine output with the
    // tt-material-use modifier carrying the theme craft tint.
    expect(html).toContain(
      '<div class="tt-desc tt-material-use">Used by Leatherworking, Weaponcrafting, and Armorcrafting.</div>',
    );
  });

  it('game meat tooltip names Cooking', () => {
    const html = tooltipHtml('game_meat');
    expect(html).toContain('Material');
    expect(html).toContain('Used by Cooking.');
    expect(html).not.toMatch(/\bJunk\b/);
  });

  it('a fine grade shows hint then Used-by then sell price, in that order', () => {
    const html = tooltipHtml('fine_iron_ore');
    const hintAt = html.indexOf('Fine grade.');
    const usedByAt = html.indexOf('Used by Engineering, Weaponcrafting, and Armorcrafting.');
    const sellAt = html.indexOf('Sell price');
    expect(hintAt).toBeGreaterThanOrEqual(0);
    expect(usedByAt).toBeGreaterThan(hintAt);
    expect(sellAt).toBeGreaterThan(usedByAt);
  });

  it('a sole cooking catch keeps the cooking purpose line without a second Used by Cooking', () => {
    const html = tooltipHtml('raw_river_perch');
    expect(html).toContain('Cooking ingredient');
    expect(html).not.toContain('Used by Cooking.');
  });

  it('an enchanting material keeps its source line without Used by Enchanting', () => {
    const html = tooltipHtml('arcane_dust');
    expect(html).toContain('Enchanting reagent');
    expect(html).not.toContain('Used by Enchanting');
  });

  it('true grey junk still says Junk', () => {
    const junkId = plainJunkId();
    expect(tooltipHtml(junkId)).toContain('Junk');
    expect(tooltipHtml(junkId)).not.toContain('Used by');
  });
});
