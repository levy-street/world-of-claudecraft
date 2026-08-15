import { describe, expect, it } from 'vitest';
import type { ArmorItemDef, ItemDef } from '../src/sim/types';
import {
  isHeroicItem,
  marketArmorBadge,
  marketArmorPips,
  marketHeroicStar,
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
