// The item tooltip's authored-affix lines (Spell Power / Healing Power, the
// Crucible tier's affix debut): literal-value pins for the pure string
// builder, its localized labels, the esc() wrap over the composed line, the
// compare-row label-key resolver, and the hud.itemTooltip composition order
// (the tests/item_instance_tooltip.test.ts source-pin idiom).
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ItemDef } from '../src/sim/types';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';
import { compareStatLabelKey, itemAffixTooltipLines } from '../src/ui/item_affix_tooltip';

function item(over: Partial<ItemDef>): ItemDef {
  return {
    id: 'affix_probe',
    name: 'Affix Probe',
    quality: 'epic',
    kind: 'armor',
    slot: 'chest',
    sellValue: 0,
    ...over,
  } as unknown as ItemDef;
}

afterEach(() => setLanguage('en'));

describe('itemAffixTooltipLines: literal English lines', () => {
  it('renders the Spell Power line alone when only spellPower is authored', () => {
    expect(itemAffixTooltipLines(item({ spellPower: 25 }))).toBe(
      '<div class="tt-green">+25 Spell Power</div>',
    );
  });

  it('renders the Healing Power line alone when only healPower is authored', () => {
    expect(itemAffixTooltipLines(item({ healPower: 40 }))).toBe(
      '<div class="tt-green">+40 Healing Power</div>',
    );
  });

  it('renders both lines, Spell Power before Healing Power (the documented affix order)', () => {
    expect(itemAffixTooltipLines(item({ spellPower: 18, healPower: 27 }))).toBe(
      '<div class="tt-green">+18 Spell Power</div><div class="tt-green">+27 Healing Power</div>',
    );
  });

  it('renders nothing for absent, zero, or negative affix values', () => {
    expect(itemAffixTooltipLines(item({}))).toBe('');
    expect(itemAffixTooltipLines(item({ spellPower: 0, healPower: 0 }))).toBe('');
    expect(itemAffixTooltipLines(item({ spellPower: -5, healPower: -1 }))).toBe('');
  });

  it('a zero on one affix never suppresses the other', () => {
    expect(itemAffixTooltipLines(item({ spellPower: 0, healPower: 12 }))).toBe(
      '<div class="tt-green">+12 Healing Power</div>',
    );
  });
});

describe('itemAffixTooltipLines: localized labels (the ja_JP overlay fills)', () => {
  it('resolves both labels and the +{value} pattern through the active locale', async () => {
    // LOADED, not merely selected: setLanguage alone leaves t() on the
    // English fallback for a lazy locale (the bank_bonus_view idiom).
    await ensureLocaleLoaded('ja_JP');
    setLanguage('ja_JP');
    expect(itemAffixTooltipLines(item({ spellPower: 25, healPower: 40 }))).toBe(
      '<div class="tt-green">+25 呪文威力</div><div class="tt-green">+40 治癒力</div>',
    );
  });
});

describe('itemAffixTooltipLines: the esc() wrap over the composed line', () => {
  it('escapes an HTML-hostile localized label instead of injecting it', async () => {
    // No shipped label carries markup, so the hostile case drives the real
    // module against a stubbed t() whose spell-power label IS markup: the
    // line must arrive entity-escaped, proving the whole composition passes
    // through esc() rather than interpolating the label raw.
    vi.resetModules();
    vi.doMock('../src/ui/i18n', async () => {
      const real = await vi.importActual<typeof import('../src/ui/i18n')>('../src/ui/i18n');
      return {
        ...real,
        t: (key: string, values?: Record<string, string | number>) =>
          key === 'hudChrome.statInfo.names.spellPower'
            ? '<b>"Spell" & \'Power\'</b>'
            : (real.t as (k: string, v?: unknown) => string)(key, values),
      };
    });
    try {
      const { itemAffixTooltipLines: lines } = await import('../src/ui/item_affix_tooltip');
      expect(lines(item({ spellPower: 7 }))).toBe(
        '<div class="tt-green">+7 &lt;b&gt;&quot;Spell&quot; &amp; &#39;Power&#39;&lt;/b&gt;</div>',
      );
    } finally {
      vi.doUnmock('../src/ui/i18n');
      vi.resetModules();
    }
  });
});

describe('compareStatLabelKey', () => {
  it('routes healPower to the HUD-chrome label key (no StatId cell exists for it)', () => {
    expect(compareStatLabelKey('healPower')).toBe('hudChrome.statInfo.names.healPower');
  });

  it('routes every other stat through statNameKey', () => {
    expect(compareStatLabelKey('spellPower')).toBe('hudChrome.statInfo.names.spellPower');
    expect(compareStatLabelKey('stamina')).toBe('itemUi.stats.stamina');
  });
});

describe('hud.itemTooltip composition (source pins)', () => {
  const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');

  it('composes the affix lines exactly once, after the stat lines and before the combat ratings', () => {
    const affix = hud.indexOf('itemAffixTooltipLines(item)');
    const bonusStats = hud.indexOf('instanceBonusStatLines(instance)');
    const ratings = hud.indexOf(
      "for (const ratingStat of ['hitRating', 'critRating', 'hasteRating'] as const)",
    );
    expect(bonusStats).toBeGreaterThan(-1);
    // After the def's own stat lines and the baked instance bonus stats
    // (which themselves follow the item.stats loop), matching the module
    // header's Stats | Affix | Ratings column order.
    expect(affix).toBeGreaterThan(bonusStats);
    // Before the hit/crit/haste rating lines.
    expect(ratings).toBeGreaterThan(affix);
    // Exactly one composition site (the import carries no paren, so this
    // matches call sites only).
    expect(hud.indexOf('itemAffixTooltipLines(', affix + 1)).toBe(-1);
  });

  it('the compare rows resolve their labels through compareStatLabelKey', () => {
    expect(hud).toContain('t(compareStatLabelKey(d.stat) as TranslationKey)');
  });
});
