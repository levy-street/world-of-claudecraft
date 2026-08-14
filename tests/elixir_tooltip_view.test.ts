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
import type { AuraKind, ItemDef } from '../src/sim/types';
import { elixirTooltipLines, wellFedTooltipLines } from '../src/ui/elixir_tooltip_view';
import { formatNumber, setLanguage } from '../src/ui/i18n';

/** The shared temporary-buff effect record both builders read. */
type BuffRecord = { aura: string; kind: AuraKind; value: number; duration: number };

// Synthetic probe defs, so the mapped-stat rows, the formatter options, and the
// escaping are each pinned off-data (every shipped elixir is a small-number
// buff_sta, which exercises exactly one map row and no grouping, rounding, or
// escaping). Written as whole literals rather than a spread of a shipped def:
// ItemDef is a discriminated union whose flask arm NARROWS the effect record's
// kind (types.ts FlaskAuraKind), so a spread carries the whole union's shape
// along and refuses a probe record on the unrelated arms. Both builders read
// only the kind and the payload, so a literal is exactly as faithful.
function elixirDef(record: BuffRecord): ItemDef {
  return {
    id: 'qa_probe_elixir',
    name: 'QA Probe Elixir',
    kind: 'elixir',
    quality: 'common',
    sellValue: 1,
    elixir: record,
  };
}

// The Well Fed twin of elixirDef, carrying a restore line as every shipped role
// food does, so the same off-data sweeps (stat map, formatter options,
// fallback, escaping) run against the food builder.
function wellFedDef(record: BuffRecord): ItemDef {
  return {
    id: 'qa_probe_food',
    name: 'QA Probe Food',
    kind: 'food',
    quality: 'common',
    foodHp: 100,
    sellValue: 1,
    wellFed: record,
  };
}

describe('elixirTooltipLines', () => {
  afterEach(() => setLanguage('en'));

  it('elixir of the boar states its stamina buff, duration, replacement rule, and combat use', () => {
    // The replacement clause is the family exclusivity rule at the point of
    // use (a scroll and an elixir of one stat share a single buff slot).
    expect(elixirTooltipLines(ITEMS.elixir_of_the_boar)).toBe(
      '<div class="tt-desc">Use: Increases your Stamina by 6 for 10 min. Replaces any other elixir or scroll of the same stat. Usable in combat.</div>',
    );
  });

  it('a buff scroll renders the SAME use line as its band elixir (alternative source)', () => {
    // The inscription scrolls (phase 06) reuse the elixir payload and the
    // same view arm (it gates on the record, not the kind), so a scroll and
    // its band elixir promise the identical buff in the identical words.
    expect(ITEMS.silverleaf_scroll.kind).toBe('scroll');
    expect(elixirTooltipLines(ITEMS.silverleaf_scroll)).toBe(
      elixirTooltipLines(ITEMS.elixir_of_the_boar),
    );
    expect(elixirTooltipLines(ITEMS.goldleaf_scroll)).toBe(
      elixirTooltipLines(ITEMS.venomfire_elixir),
    );
    expect(elixirTooltipLines(ITEMS.sunpetal_scroll)).toBe(
      elixirTooltipLines(ITEMS.elixir_of_the_serpent),
    );
    // And the line is real, not two empty strings agreeing.
    expect(elixirTooltipLines(ITEMS.silverleaf_scroll)).toContain('Use:');
  });

  it('every elixir and scroll in the game data renders a use line carrying its own numbers', () => {
    const elixirs = Object.values(ITEMS).filter(
      (def) => def.kind === 'elixir' || def.kind === 'scroll',
    );
    // bear, boar, venomfire, serpent plus the three phase 06 scrolls: all
    // recipe outputs except the bear, which drops and combo-crafts.
    expect(elixirs.length).toBeGreaterThanOrEqual(7);
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
      '<div class="tt-desc">Use: Increases your Stamina by 1,234 for 7.5 min. Replaces any other elixir or scroll of the same stat. Usable in combat.</div>',
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
      '<div class="tt-desc">Use: Grants Might of the Boar for 5 min. Replaces any other elixir or scroll of its kind. Usable in combat.</div>',
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

  it('Hud.itemTooltip composes BOTH builder lines (method-scoped source pin)', () => {
    // Whole-line // comments are stripped before scanning so the pin is not
    // satisfied by prose (the comment-gameable trap; block comments are left
    // alone: a /* strip would misfire on string and regex literals, the
    // gather_tool_tooltip.test.ts idiom). Scoped to the itemTooltip method
    // body so the call cannot drift into some other surface and still pass.
    // BOTH exports are pinned: this module ships two builders and the Well Fed
    // one could be unwired from the coordinator without any test noticing,
    // which is the same unwiring hazard the elixir pin was written for.
    const hudSrc = readFileSync(path.join(__dirname, '../src/ui/hud.ts'), 'utf8').replace(
      /^\s*\/\/.*$/gm,
      '',
    );
    const start = hudSrc.indexOf('private itemTooltip(');
    const end = hudSrc.indexOf('private itemProcBlock(');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = hudSrc.slice(start, end);
    expect(body).toContain('html += elixirTooltipLines(item);');
    expect(body).toContain('html += wellFedTooltipLines(item);');
  });

  describe('flask rules', () => {
    // A flask renders the shared Use line PLUS three rules; an elixir or scroll
    // of the same family renders the Use line alone. Both directions are
    // pinned, because the gate is the item KIND and an inverted gate would put
    // the flask rules on every elixir in the game.
    const FLASK_RULES = [
      '<div class="tt-desc">Only one flask effect at a time. Drinking another flask replaces this one.</div>',
      '<div class="tt-desc">A weaker elixir or scroll of the same stat cannot replace it.</div>',
      '<div class="tt-desc">The effect remains through death, but ends when you log out.</div>',
    ];

    it('a flask adds its three rules under the shared Use line', () => {
      expect(ITEMS.ironhusk_flask.kind).toBe('flask');
      const html = elixirTooltipLines(ITEMS.ironhusk_flask);
      // The Use line is the SAME sentence the elixirs get, word for word: a
      // flask really does replace the same-stat elixir or scroll, so the rules
      // are additions rather than a restatement.
      expect(html).toContain(
        '<div class="tt-desc">Use: Increases your Stamina by 15 for 20 min. Replaces any other elixir or scroll of the same stat. Usable in combat.</div>',
      );
      for (const rule of FLASK_RULES) expect(html, `flask must state: ${rule}`).toContain(rule);
      // Exactly four blocks, so a rule cannot be dropped or doubled unnoticed.
      expect(html.split('<div class="tt-desc">')).toHaveLength(5);
    });

    it('every shipped flask states all three, on its own stat axis', () => {
      const flasks = Object.values(ITEMS).filter((def) => def.kind === 'flask');
      // The three role flasks: stamina, attack power, intellect.
      expect(flasks.length).toBeGreaterThanOrEqual(3);
      const axes = new Set<string>();
      for (const def of flasks) {
        const html = elixirTooltipLines(def);
        for (const rule of FLASK_RULES)
          expect(html, `${def.id} must state: ${rule}`).toContain(rule);
        axes.add(def.elixir?.kind ?? '');
      }
      // Not one axis three times: the rules ride every role, not just stamina.
      expect(axes.size).toBeGreaterThanOrEqual(3);
    });

    it('an elixir and a scroll state NONE of them (the other direction)', () => {
      for (const def of [
        ITEMS.elixir_of_the_boar,
        ITEMS.elixir_of_the_serpent,
        ITEMS.silverleaf_scroll,
        ITEMS.sunpetal_scroll,
      ]) {
        const html = elixirTooltipLines(def);
        // The premise: these really do render a Use line, so the absences
        // below are refusals rather than an empty string agreeing with itself.
        expect(html, `${def.id} renders a use line`).toContain('Use:');
        for (const rule of FLASK_RULES) {
          expect(html, `${def.id} must NOT state a flask rule`).not.toContain(rule);
        }
        expect(html.split('<div class="tt-desc">')).toHaveLength(2);
      }
    });
  });
});

describe('wellFedTooltipLines', () => {
  afterEach(() => setLanguage('en'));

  it('a role food states its buff, value, duration, and the finish-eating rule', () => {
    // The "once you finish eating" clause is the mechanic: the buff lands only
    // when the 18-second drain completes, so standing up early grants nothing.
    expect(wellFedTooltipLines(ITEMS.stonepot_stew)).toBe(
      '<div class="tt-desc">Well Fed: Increases your Stamina by 6 for 10 min once you finish eating.</div>',
    );
  });

  it('every shipped well-fed food renders a line carrying its own numbers', () => {
    const foods = Object.values(ITEMS).filter(
      (def) => def.kind === 'food' && def.wellFed !== undefined,
    );
    // The three apex role foods (stamina, attack power, intellect).
    expect(foods.length).toBeGreaterThanOrEqual(3);
    for (const def of foods) {
      const fed = def.kind === 'food' ? def.wellFed : undefined;
      expect(fed, `${def.id} must carry a wellFed record`).toBeDefined();
      const html = wellFedTooltipLines(def);
      expect(html, `${def.id} must render a Well Fed line`).toContain('Well Fed:');
      expect(html).toContain(`by ${formatNumber(fed!.value, { maximumFractionDigits: 0 })} `);
      expect(html).toContain(
        `for ${formatNumber(fed!.duration / 60, { maximumFractionDigits: 1 })} min`,
      );
    }
  });

  it('pins the formatter options off-data: grouped value, fractional minutes', () => {
    const html = wellFedTooltipLines(
      wellFedDef({ aura: 'Probe', kind: 'buff_sta', value: 1234, duration: 450 }),
    );
    expect(html).toBe(
      '<div class="tt-desc">Well Fed: Increases your Stamina by 1,234 for 7.5 min once you finish eating.</div>',
    );
  });

  it('maps every stat-buff kind to its own stat label', () => {
    const cases: Array<[AuraKind, string]> = [
      ['buff_sta', 'Stamina'],
      ['buff_int', 'Intellect'],
      ['buff_agi', 'Agility'],
      ['buff_armor', 'Armor'],
      ['buff_ap', 'Attack Power'],
    ];
    for (const [kind, label] of cases) {
      const html = wellFedTooltipLines(
        wellFedDef({ aura: 'Probe', kind, value: 8, duration: 600 }),
      );
      expect(html, `${kind} must read as ${label}`).toContain(
        `Well Fed: Increases your ${label} by 8 for 10 min`,
      );
    }
  });

  it('renders nothing for a food with no wellFed payload, or for any non-food kind', () => {
    // A plain dish: kind matches, payload absent.
    expect(ITEMS.roasted_boar.kind).toBe('food');
    expect(wellFedTooltipLines(ITEMS.roasted_boar)).toBe('');
    // Non-food kinds, including the ones carrying the SIBLING elixir payload:
    // the two builders never answer for each other's items.
    for (const def of [
      ITEMS.elixir_of_the_boar,
      ITEMS.ironhusk_flask,
      ITEMS.silverleaf_scroll,
      ITEMS.healing_potion,
      ITEMS.spring_water,
    ]) {
      expect(wellFedTooltipLines(def), `${def.id} is not a food`).toBe('');
    }
  });

  it('an unmapped buff kind falls back to naming the granted aura', () => {
    const def = wellFedDef({
      aura: 'Might of the Boar',
      kind: 'buff_spellpower',
      value: 5,
      duration: 300,
    });
    expect(wellFedTooltipLines(def)).toBe(
      '<div class="tt-desc">Well Fed: Grants Might of the Boar for 5 min once you finish eating.</div>',
    );
  });

  it('the aura fallback localizes through the buff-bar matcher', () => {
    // Only the aura fragment is pinned: the surrounding sentence is a catalog
    // key filled per locale, while the aura name rides the AURA_NAME_KEY
    // matcher the buff bar itself uses.
    const def = wellFedDef({
      aura: 'Might of the Boar',
      kind: 'buff_spellpower',
      value: 5,
      duration: 300,
    });
    setLanguage('de_DE');
    expect(wellFedTooltipLines(def)).toContain('Macht des Ebers');
  });

  it('escapes the interpolated aura name', () => {
    const def = wellFedDef({
      aura: "Warchief's Blessing",
      kind: 'buff_spellpower',
      value: 5,
      duration: 300,
    });
    expect(wellFedTooltipLines(def)).toContain('Warchief&#39;s Blessing');
  });
});
