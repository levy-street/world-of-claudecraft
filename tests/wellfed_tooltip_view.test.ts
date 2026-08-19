// Well-fed buff-dish tooltip line: the pure string-builder composed inside
// Hud.itemTooltip (the elixir_tooltip_view.test.ts idiom). English copy
// asserted directly; the numbers must mirror each def's own wellfed record,
// never re-invented copy, and every line must state the finish-eating
// trigger, because the buff lands only when the 18s sit-restore COMPLETES
// (an interrupted meal forfeits it), which is exactly the important-trigger
// rule of docs/design/tooltip-writing.md. Also guards the data side: a buff
// dish without a wellfed record would render no well-fed line at all, the
// silent-tooltip bug class the elixir view fixed.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import type { ItemDef } from '../src/sim/types';
import { formatNumber, setLanguage } from '../src/ui/i18n';
import { wellfedTooltipLines } from '../src/ui/wellfed_tooltip_view';

// Synthetic wellfed variants: one def spread with a replaced record, so the
// mapped-stat rows, the formatter options, and the escaping are each pinned
// off-data (every shipped buff dish is a small-number buff_sta, which
// exercises exactly one map row and no grouping, rounding, or escaping).
function wellfedDef(record: NonNullable<ItemDef['wellfed']>): ItemDef {
  return { ...ITEMS.eastbrook_glazed_carrots, wellfed: record };
}

describe('wellfedTooltipLines', () => {
  afterEach(() => setLanguage('en'));

  it('glazed carrots state the buff, duration, and the finish-eating trigger', () => {
    expect(wellfedTooltipLines(ITEMS.eastbrook_glazed_carrots)).toBe(
      '<div class="tt-desc">Well Fed: +3 Stamina for 10 min, granted when you finish eating.</div>',
    );
  });

  it('every buff dish in the game data renders a line carrying its own numbers', () => {
    const dishes = Object.values(ITEMS).filter(
      (def): def is ItemDef & { wellfed: NonNullable<ItemDef['wellfed']> } =>
        def.wellfed !== undefined,
    );
    // carrots, pudding, porridge, greens: one buff dish per crop tier.
    expect(dishes.length).toBeGreaterThanOrEqual(4);
    for (const def of dishes) {
      const html = wellfedTooltipLines(def);
      expect(html, `${def.id} must render a well-fed line`).toContain('Well Fed');
      // Expected fragments built with the same formatter the view uses; the
      // formatter OPTIONS themselves are pinned off-data below.
      expect(html).toContain(`+${formatNumber(def.wellfed.value, { maximumFractionDigits: 0 })} `);
      expect(html).toContain(
        `for ${formatNumber(def.wellfed.duration / 60, { maximumFractionDigits: 1 })} min`,
      );
      // The completion trigger is load-bearing copy: the buff is granted at
      // the END of the sit-restore, never on the first bite.
      expect(html).toContain('when you finish eating');
    }
  });

  it('pins the formatter options off-data: grouped value, fractional minutes', () => {
    const html = wellfedTooltipLines(
      wellfedDef({ aura: 'Probe', kind: 'buff_sta', value: 1234, duration: 450 }),
    );
    expect(html).toBe(
      '<div class="tt-desc">Probe: +1,234 Stamina for 7.5 min, granted when you finish eating.</div>',
    );
  });

  it('maps every stat-buff kind to its own stat label', () => {
    const cases: Array<[NonNullable<ItemDef['wellfed']>['kind'], string]> = [
      ['buff_int', 'Intellect'],
      ['buff_agi', 'Agility'],
      ['buff_armor', 'Armor'],
      ['buff_ap', 'Attack Power'],
    ];
    for (const [kind, label] of cases) {
      const html = wellfedTooltipLines(
        wellfedDef({ aura: 'Probe', kind, value: 8, duration: 600 }),
      );
      expect(html, `${kind} must read as ${label}`).toContain(`+8 ${label} for 10 min`);
    }
  });

  it('renders nothing for items without a wellfed record', () => {
    expect(wellfedTooltipLines(ITEMS.roasted_boar)).toBe('');
    expect(wellfedTooltipLines(ITEMS.vale_hearth_loaf)).toBe('');
    expect(wellfedTooltipLines(ITEMS.elixir_of_the_boar)).toBe('');
  });

  it('an unmapped buff kind falls back to naming the granted aura with the trigger', () => {
    const def = wellfedDef({
      aura: 'Well Fed',
      kind: 'buff_spellpower',
      value: 5,
      duration: 300,
    });
    expect(wellfedTooltipLines(def)).toBe(
      '<div class="tt-desc">Grants Well Fed for 5 min when you finish eating.</div>',
    );
  });

  it('the aura fallback localizes through the buff-bar matcher', () => {
    // Only the aura fragment is pinned: the surrounding sentence is a new
    // catalog key, English-pending in de_DE until the release fill, while
    // the aura name rides the AURA_NAME_KEY matcher (the elixir fixture,
    // whose de_DE row predates this suite).
    const def = wellfedDef({
      aura: 'Might of the Boar',
      kind: 'buff_spellpower',
      value: 5,
      duration: 300,
    });
    setLanguage('de_DE');
    expect(wellfedTooltipLines(def)).toContain('Macht des Ebers');
  });

  it('escapes the interpolated aura name', () => {
    const def = wellfedDef({
      aura: "Grandmother's Cooking",
      kind: 'buff_spellpower',
      value: 5,
      duration: 300,
    });
    expect(wellfedTooltipLines(def)).toContain('Grandmother&#39;s Cooking');
  });

  it('Hud.itemTooltip composes the well-fed line (method-scoped source pin)', () => {
    // Whole-line // comments are stripped before scanning so the pin is not
    // satisfied by prose (the comment-gameable trap; block comments are left
    // alone: a /* strip would misfire on string and regex literals). Scoped
    // to the itemTooltip method body so the call cannot drift into some
    // other surface and still pass.
    const hudSrc = readFileSync(path.join(__dirname, '../src/ui/hud.ts'), 'utf8').replace(
      /^\s*\/\/.*$/gm,
      '',
    );
    const start = hudSrc.indexOf('private itemTooltip(');
    const end = hudSrc.indexOf('private itemProcBlock(');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(hudSrc.slice(start, end)).toContain('html += wellfedTooltipLines(item);');
  });
});
