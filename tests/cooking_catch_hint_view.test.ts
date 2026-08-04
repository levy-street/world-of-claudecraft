// @vitest-environment happy-dom
//
// Raw cooking catch purpose line: pure key table (every RAW_COOKING_CATCH_IDS
// member shares one key) plus createElement paint (tt-desc + textContent, no
// innerHTML). Integration: Hud itemTooltip shows the cooking line and never a
// restore-health / foodHp line.

import { describe, expect, it } from 'vitest';
import { RAW_COOKING_CATCH_IDS } from '../src/sim/content/items';
import { ITEMS } from '../src/sim/data';
import { COOKING_CATCH_HINT_KEY, cookingCatchHintKey } from '../src/ui/cooking_catch_hint_view';
import { Hud } from '../src/ui/hud';
import { t } from '../src/ui/i18n';
import { createTooltipLine } from '../src/ui/tooltip_line';

function tooltipHtml(itemId: string): string {
  const h = Object.create(Hud.prototype) as unknown as {
    itemTooltip(item: unknown, compare?: boolean): string;
  };
  const item = ITEMS[itemId];
  if (!item) throw new Error(`missing item ${itemId}`);
  return h.itemTooltip(item, false);
}

describe('cooking_catch_hint_view (pure keys)', () => {
  it('every raw cooking catch shares the one cooking-ingredient key', () => {
    expect(RAW_COOKING_CATCH_IDS.size).toBe(7);
    const keys = new Set([...RAW_COOKING_CATCH_IDS].map((id) => cookingCatchHintKey(id)));
    expect(keys.size).toBe(1);
    expect([...keys][0]).toBe(COOKING_CATCH_HINT_KEY);
    expect(COOKING_CATCH_HINT_KEY).toBe('hudChrome.materialHint.cookingCatch');
  });

  it('cooked meals and non-catch junk stay unhinted', () => {
    for (const id of ['pan_seared_perch', 'game_meat', 'iron_ore', 'tangled_weed', 'baked_bread']) {
      expect(cookingCatchHintKey(id), id).toBeUndefined();
    }
  });

  it('resolves to the locked cook-first English, not restore-health', () => {
    expect(t(COOKING_CATCH_HINT_KEY)).toBe('Cooking ingredient. Must be cooked before eating.');
  });
});

describe('createTooltipLine (createElement paint)', () => {
  it('builds tt-desc with textContent and never assigns innerHTML', () => {
    const line = createTooltipLine('Cooking ingredient. Must be cooked before eating.', 'tt-desc');
    expect(line.tagName).toBe('DIV');
    expect(line.className).toBe('tt-desc');
    expect(line.textContent).toBe('Cooking ingredient. Must be cooked before eating.');
    // Source of truth: text lives in textContent; no child HTML nodes.
    expect(line.childNodes.length).toBe(1);
    expect(line.childNodes[0].nodeType).toBe(Node.TEXT_NODE);
  });

  it('supports tt-sub class for shared reuse', () => {
    const line = createTooltipLine('sub line', 'tt-sub');
    expect(line.className).toBe('tt-sub');
    expect(line.textContent).toBe('sub line');
  });

  it('new feature modules do not introduce innerHTML assignments', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    // Repo root is process.cwd() under vitest (worktree root).
    for (const rel of ['src/ui/cooking_catch_hint_view.ts', 'src/ui/tooltip_line.ts']) {
      const src = readFileSync(join(process.cwd(), rel), 'utf8');
      expect(src, rel).not.toMatch(/\.innerHTML\s*=/);
      expect(src, rel).not.toMatch(/`[\s\S]*class="tt-/);
    }
  });
});

describe('itemTooltip integration for raw catches', () => {
  it('shows the cooking-ingredient line and never a restore-health line', () => {
    const cookingText = t(COOKING_CATCH_HINT_KEY);
    for (const id of RAW_COOKING_CATCH_IDS) {
      const html = tooltipHtml(id);
      expect(html, id).toContain(cookingText);
      expect(html, id).toContain('class="tt-desc"');
      expect(html, id).not.toMatch(/Restores .+ health/i);
      expect(html, id).not.toContain('Must remain seated while eating');
      // Def has no foodHp so useFood never fires.
      expect(ITEMS[id].foodHp, id).toBeUndefined();
    }
  });

  it('cooked control still shows the restore-health use line', () => {
    const html = tooltipHtml('pan_seared_perch');
    expect(html).toMatch(/Restores .+ health/i);
    expect(html).not.toContain(t(COOKING_CATCH_HINT_KEY));
  });
});

describe('bank deposit-all copy after catches are materials', () => {
  it('depositAllTooltip still describes crafting reagents and junk', () => {
    // #2715: button gates on isMaterialItem; raw catches are honest materials.
    // Full sentence pin so a rewrite that keeps only loose tokens fails.
    expect(t('hudChrome.bank.depositAllTooltip')).toBe(
      'Sends every crafting reagent and junk item from your bags to the bank in one trip. Gathering tools, equipped gear, quest items, and consumables are never touched.',
    );
  });
});
