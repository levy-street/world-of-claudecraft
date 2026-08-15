// Battle-elixir tooltip line: the pure string-builder composed inside
// Hud.itemTooltip. English copy asserted directly (the
// gather_tool_tooltip.test.ts idiom); the numbers must mirror each def's own
// elixir record, never re-invented copy. Also guards the data side: an item
// of kind 'elixir' without an elixir record would quaff as a silent no-op
// (sim/items.ts useItem returns early) AND render no use line, which is
// exactly the invisible-tooltip bug this module fixed.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import type { ItemDef } from '../src/sim/types';
import { elixirTooltipLines } from '../src/ui/elixir_tooltip_view';
import { formatNumber, setLanguage } from '../src/ui/i18n';

// Synthetic elixir variants: one def spread with a replaced record, so the
// mapped-stat rows, the formatter options, and the escaping are each pinned
// off-data (every shipped elixir is a small-number buff_sta, which exercises
// exactly one map row and no grouping, rounding, or escaping).
function elixirDef(record: NonNullable<ItemDef['elixir']>): ItemDef {
  return { ...ITEMS.elixir_of_the_boar, elixir: record };
}

describe('elixirTooltipLines', () => {
  afterEach(() => setLanguage('en'));

  it('elixir of the boar states its stamina buff, duration, and combat use', () => {
    expect(elixirTooltipLines(ITEMS.elixir_of_the_boar)).toBe(
      '<div class="tt-desc">Use: Increases your Stamina by 6 for 10 min. Usable in combat.</div>',
    );
  });

  it('every elixir in the game data renders a use line carrying its own numbers', () => {
    const elixirs = Object.values(ITEMS).filter((def) => def.kind === 'elixir');
    // bear, boar, venomfire, serpent: all four are recipe outputs (the bear
    // via the combo recipe, the rest on the alchemy ladder).
    expect(elixirs.length).toBeGreaterThanOrEqual(4);
    for (const def of elixirs) {
      expect(def.elixir, `${def.id} must carry an elixir effect record`).toBeDefined();
      const html = elixirTooltipLines(def);
      expect(html, `${def.id} must render a use line`).toContain('Use:');
      // Expected fragments built with the same formatter the view uses; the
      // formatter OPTIONS themselves are pinned off-data below.
      expect(html).toContain(
        `by ${formatNumber(def.elixir!.value, { maximumFractionDigits: 0 })} `,
      );
      expect(html).toContain(
        `for ${formatNumber(def.elixir!.duration / 60, { maximumFractionDigits: 1 })} min`,
      );
    }
  });

  it('pins the formatter options off-data: grouped value, fractional minutes', () => {
    const html = elixirTooltipLines(
      elixirDef({ aura: 'Probe', kind: 'buff_sta', value: 1234, duration: 450 }),
    );
    expect(html).toBe(
      '<div class="tt-desc">Use: Increases your Stamina by 1,234 for 7.5 min. Usable in combat.</div>',
    );
  });

  it('maps every stat-buff kind to its own stat label', () => {
    const cases: Array<[NonNullable<ItemDef['elixir']>['kind'], string]> = [
      ['buff_int', 'Intellect'],
      ['buff_agi', 'Agility'],
      ['buff_armor', 'Armor'],
      ['buff_ap', 'Attack Power'],
    ];
    for (const [kind, label] of cases) {
      const html = elixirTooltipLines(elixirDef({ aura: 'Probe', kind, value: 8, duration: 600 }));
      expect(html, `${kind} must read as ${label}`).toContain(
        `Use: Increases your ${label} by 8 for 10 min.`,
      );
    }
  });

  it('renders nothing for items without an elixir record', () => {
    expect(elixirTooltipLines(ITEMS.healing_potion)).toBe('');
    expect(elixirTooltipLines(ITEMS.roasted_boar)).toBe('');
  });

  it('an unmapped buff kind falls back to naming the granted aura', () => {
    const def = elixirDef({
      aura: 'Might of the Boar',
      kind: 'buff_spellpower',
      value: 5,
      duration: 300,
    });
    expect(elixirTooltipLines(def)).toBe(
      '<div class="tt-desc">Use: Grants Might of the Boar for 5 min. Usable in combat.</div>',
    );
  });

  it('the aura fallback localizes through the buff-bar matcher', () => {
    // Only the aura fragment is pinned: the surrounding sentence is a new
    // catalog key, English-pending in de_DE until the release fill, while
    // the aura name rides the long-standing AURA_NAME_KEY matcher.
    const def = elixirDef({
      aura: 'Might of the Boar',
      kind: 'buff_spellpower',
      value: 5,
      duration: 300,
    });
    setLanguage('de_DE');
    expect(elixirTooltipLines(def)).toContain('Macht des Ebers');
  });

  it('escapes the interpolated aura name', () => {
    const def = elixirDef({
      aura: "Warchief's Blessing",
      kind: 'buff_spellpower',
      value: 5,
      duration: 300,
    });
    expect(elixirTooltipLines(def)).toContain('Warchief&#39;s Blessing');
  });

  it('Hud.itemTooltip composes the elixir line (method-scoped source pin)', () => {
    // Whole-line // comments are stripped before scanning so the pin is not
    // satisfied by prose (the comment-gameable trap; block comments are left
    // alone: a /* strip would misfire on string and regex literals, the
    // gather_tool_tooltip.test.ts idiom). Scoped to the itemTooltip method
    // body so the call cannot drift into some other surface and still pass.
    const hudSrc = readFileSync(path.join(__dirname, '../src/ui/hud.ts'), 'utf8').replace(
      /^\s*\/\/.*$/gm,
      '',
    );
    const start = hudSrc.indexOf('private itemTooltip(');
    const end = hudSrc.indexOf('private itemProcBlock(');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(hudSrc.slice(start, end)).toContain('html += elixirTooltipLines(item);');
  });
});
