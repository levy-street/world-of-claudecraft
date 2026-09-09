import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { defaultMarketQuery, marketItemMatches } from '../src/sim/market_query';
import type { ArmorItemDef, ItemDef } from '../src/sim/types';
import {
  isHeroicItem,
  isPatternItem,
  marketArmorBadge,
  marketArmorPips,
  marketHeroicStar,
  marketPatternMark,
} from '../src/ui/market_armor_badge';

function armor(extra: Partial<ArmorItemDef>): ArmorItemDef {
  return {
    id: 'test',
    name: 'Test',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'chest',
    sellValue: 1,
    ...extra,
  };
}

const sword: ItemDef = {
  id: 'sword',
  name: 'Sword',
  kind: 'weapon',
  slot: 'mainhand',
  weapon: { min: 1, max: 2, speed: 2 },
  sellValue: 1,
  requiredClass: ['warrior'],
};

describe('marketArmorBadge', () => {
  it('resolves the armor type and its label key for each armor class', () => {
    expect(marketArmorBadge(armor({ armorType: 'cloth' }))).toEqual({
      armorType: 'cloth',
      labelKey: 'hudChrome.itemArmorType.cloth',
    });
    expect(marketArmorBadge(armor({ armorType: 'leather' }))).toEqual({
      armorType: 'leather',
      labelKey: 'hudChrome.itemArmorType.leather',
    });
    expect(marketArmorBadge(armor({ armorType: 'mail' }))).toEqual({
      armorType: 'mail',
      labelKey: 'hudChrome.itemArmorType.mail',
    });
  });

  it('returns null for non-armor listings (weapons, bags, materials, and so on)', () => {
    expect(marketArmorBadge(sword)).toBeNull();
  });

  it('returns null for a live recipe-kind pattern def (the Browse-row corner stays pip-free)', () => {
    // The redesigned corner family composes with the phase 11 pattern rows only
    // while this resolver answers null for kind 'recipe'; pin it on a SHIPPED
    // catalog def rather than a synthetic one, so the composition is a tested
    // fact about the live content.
    const pattern = ITEMS['pattern_forgefold_legguards'];
    if (!pattern) throw new Error('missing shipped pattern def');
    expect(pattern.kind).toBe('recipe');
    expect(marketArmorBadge(pattern)).toBeNull();
  });

  it('is deterministic for a given item', () => {
    const item = armor({ armorType: 'mail', requiredClass: ['shaman'] });
    expect(marketArmorBadge(item)).toEqual(marketArmorBadge(item));
  });
});

describe('marketArmorPips', () => {
  it('emits a pip count that reads as armor weight (cloth 1, leather 2, mail 3)', () => {
    const count = (html: string) => (html.match(/class="mkt-pip"/g) ?? []).length;
    expect(count(marketArmorPips('cloth', 'Cloth'))).toBe(1);
    expect(count(marketArmorPips('leather', 'Leather'))).toBe(2);
    expect(count(marketArmorPips('mail', 'Mail'))).toBe(3);
  });

  it('carries the localized word as the accessible name so the cue is not color-only', () => {
    const html = marketArmorPips('mail', 'Mail');
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Mail"');
    // NO native title: the row's game tooltip already fires on hover, so a title
    // here would stack a second tooltip and double-announce the aria-label word.
    expect(html).not.toContain('title=');
    // the pips themselves are decorative; the word is announced once
    expect(html).toContain('aria-hidden="true"');
  });

  it('tags the chip with a per-type class for the bonus color channel', () => {
    expect(marketArmorPips('cloth', 'Cloth')).toContain('mkt-armor-pips--cloth');
    expect(marketArmorPips('leather', 'Leather')).toContain('mkt-armor-pips--leather');
    expect(marketArmorPips('mail', 'Mail')).toContain('mkt-armor-pips--mail');
  });

  it('does not re-escape or alter the caller-provided label (caller owns escaping)', () => {
    // The painter passes esc(t(labelKey)); this function must not double-process it.
    expect(marketArmorPips('cloth', 'A&amp;B')).toContain('aria-label="A&amp;B"');
  });
});

describe('isHeroicItem / marketHeroicStar', () => {
  const base = (extra: Partial<ItemDef>): ItemDef =>
    ({
      id: 'x',
      name: 'X',
      kind: 'armor',
      slot: 'chest',
      sellValue: 1,
      ...(extra as object),
    }) as ItemDef;

  it('detects a generated heroic variant (heroicOf set) and a bespoke heroic item', () => {
    expect(isHeroicItem(base({ heroicOf: 'base_id' }))).toBe(true);
    expect(isHeroicItem(base({ heroic: true }))).toBe(true);
  });

  it('is false for an ordinary item', () => {
    expect(isHeroicItem(base({}))).toBe(false);
    expect(isHeroicItem(base({ heroic: false }))).toBe(false);
  });

  it('emits a star only for heroic items, empty otherwise', () => {
    expect(marketHeroicStar(base({ heroicOf: 'b' }), 'Heroic')).toContain('★');
    expect(marketHeroicStar(base({}), 'Heroic')).toBe('');
  });

  it('emits its empty value for a live recipe-kind pattern def', () => {
    // The other Browse-row corner: a shipped pattern is not heroic-tier, so
    // the star resolver must answer the empty string for it, keeping a
    // recipe-kind row's icon free on both corners.
    const pattern = ITEMS['pattern_forgefold_legguards'];
    if (!pattern) throw new Error('missing shipped pattern def');
    expect(isHeroicItem(pattern)).toBe(false);
    expect(marketHeroicStar(pattern, 'Heroic')).toBe('');
  });

  it('carries the localized Heroic word as the accessible name; the glyph is decorative', () => {
    const html = marketHeroicStar(base({ heroic: true }), 'Heroic');
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Heroic"');
    // NO native title (same reason as the pips): avoid a tooltip stacked on the
    // row's game tooltip and a double-announced label.
    expect(html).not.toContain('title=');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('mkt-heroic-star');
  });
});

describe('isPatternItem / marketPatternMark', () => {
  const base = (extra: Partial<ItemDef>): ItemDef =>
    ({
      id: 'x',
      name: 'X',
      kind: 'armor',
      slot: 'chest',
      sellValue: 1,
      ...(extra as object),
    }) as ItemDef;

  it('marks the recipe kind and nothing else', () => {
    expect(isPatternItem(base({ kind: 'recipe' }))).toBe(true);
    for (const kind of ['weapon', 'armor', 'bag', 'potion', 'junk', 'mount'] as const) {
      expect(isPatternItem(base({ kind })), kind).toBe(false);
      expect(marketPatternMark(base({ kind }), 'Patterns')).toBe('');
    }
  });

  it('agrees with the Browse type chip on a LIVE shipped pattern def', () => {
    // The mark and the 'pattern' filter must never disagree about which
    // listings are patterns: both are the recipe kind, checked here against
    // real merged-table content rather than a fixture.
    const pattern = ITEMS.pattern_forgefold_legguards;
    if (!pattern) throw new Error('missing shipped pattern def');
    expect(isPatternItem(pattern)).toBe(true);
    // The field is `itemType`, the name MarketQuery actually carries: a pin
    // written against a `type` key that does not exist typechecks as an excess
    // property and never reached the filter it claims to agree with.
    expect(marketItemMatches(pattern.id, { ...defaultMarketQuery(), itemType: 'pattern' })).toBe(
      true,
    );
    expect(marketPatternMark(pattern, 'Patterns')).toContain('mkt-pattern-mark');
    // The agreement is a BOTH-WAYS claim, so it needs the other arm: a live
    // non-pattern must fail the chip and draw no mark. Without this the pin
    // passes on a filter that accepts everything.
    const liveWeapon = ITEMS.worn_sword;
    if (!liveWeapon) throw new Error('missing shipped weapon def');
    expect(isPatternItem(liveWeapon)).toBe(false);
    expect(marketItemMatches(liveWeapon.id, { ...defaultMarketQuery(), itemType: 'pattern' })).toBe(
      false,
    );
    expect(marketPatternMark(liveWeapon, 'Patterns')).toBe('');
  });

  it('carries the localized word as the accessible name; the glyph is decorative', () => {
    const html = marketPatternMark(base({ kind: 'recipe' }), 'Patterns');
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Patterns"');
    // NO native title, the same reason the other two marks give: the row
    // already shows the full game tooltip on hover.
    expect(html).not.toContain('title=');
    expect(html).toContain('aria-hidden="true"');
  });

  it('is a DIFFERENT glyph from the heroic star, so the two read apart in grayscale', () => {
    // Both can ride one icon (a heroic pattern), and color is never the sole
    // cue, so the silhouettes must differ.
    const heroic = marketHeroicStar(base({ heroic: true }), 'Heroic');
    const patternHtml = marketPatternMark(base({ kind: 'recipe' }), 'Patterns');
    expect(patternHtml).not.toContain('\u2605');
    expect(heroic).not.toContain('\u2756');
    expect(patternHtml).toContain('\u2756');
  });

  it('a heroic pattern wears BOTH marks, on opposite corners', () => {
    const heroicPattern = base({ kind: 'recipe', heroic: true });
    expect(marketHeroicStar(heroicPattern, 'Heroic')).toContain('mkt-heroic-star');
    expect(marketPatternMark(heroicPattern, 'Patterns')).toContain('mkt-pattern-mark');
    // The armor pips are the third corner and never apply to a recipe: a
    // pattern for armor is not itself armor.
    expect(marketArmorBadge(heroicPattern)).toBeNull();
  });
});
