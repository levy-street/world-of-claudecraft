// Pins the per-copy instance tooltip lines (Professions 2.0 Phase 6): every
// ItemInstancePayload variant renders its exact line set, so a regression in
// any arm (seal, enchanted marker, bonus stats, maker's mark, the legacy
// shapes) fails a decisive assertion. The module is the pure string-builder
// side of hud.itemTooltip's instance composition.
import { describe, expect, it } from 'vitest';
import {
  instanceBadgeLines,
  instanceBonusStatLines,
  instanceMakersMarkLine,
  itemNumber,
  itemStatName,
} from '../src/ui/item_instance_tooltip';

describe('item_instance_tooltip', () => {
  it('masterwork copy gets the gold seal and no enchanted marker', () => {
    const html = instanceBadgeLines({
      signer: 'Anna',
      rolled: { masterwork: true, stats: { str: 2 } },
    });
    expect(html).toContain('Masterwork');
    expect(html).toContain('#ffd100');
    expect(html).not.toContain('Enchanted');
  });

  it('enchant-marker copy gets the enchanted marker and no seal', () => {
    const html = instanceBadgeLines({ enchant: 'ench_firepower' });
    expect(html).toContain('Enchanted');
    expect(html).not.toContain('Masterwork');
  });

  it('legacy enchanted copy (bare rolled.stats, no masterwork flag) reads as enchanted', () => {
    const html = instanceBadgeLines({ rolled: { stats: { int: 3 } } });
    expect(html).toContain('Enchanted');
    expect(html).not.toContain('Masterwork');
  });

  it('masterwork plus enchant renders both badges, seal first', () => {
    const html = instanceBadgeLines({
      enchant: 'ench_firepower',
      rolled: { masterwork: true, stats: { str: 1 } },
    });
    const seal = html.indexOf('Masterwork');
    const ench = html.indexOf('Enchanted');
    expect(seal).toBeGreaterThanOrEqual(0);
    expect(ench).toBeGreaterThan(seal);
  });

  it('legacy signed copy (signer only) renders the mark alone, no badges, no throw', () => {
    expect(instanceBadgeLines({ signer: 'Bob' })).toBe('');
    expect(instanceBonusStatLines({ signer: 'Bob' })).toBe('');
    expect(instanceMakersMarkLine({ signer: 'Bob' })).toContain('Crafted by Bob');
  });

  it('baked bonus stats each render one tt-instance-bonus line', () => {
    const html = instanceBonusStatLines({
      rolled: { masterwork: true, stats: { str: 2, sta: 1 } },
    });
    expect((html.match(/tt-instance-bonus/g) ?? []).length).toBe(2);
    expect(html).toContain(itemStatName('str'));
    expect(html).toContain(itemStatName('sta'));
  });

  it('zero-valued baked stats are skipped', () => {
    expect(instanceBonusStatLines({ rolled: { stats: { str: 0 } } })).toBe('');
  });

  it("maker's mark escapes the signer name", () => {
    const html = instanceMakersMarkLine({ signer: '<b>x</b>' });
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;b&gt;');
  });

  it('undefined instance renders nothing in any line set', () => {
    expect(instanceBadgeLines(undefined)).toBe('');
    expect(instanceBonusStatLines(undefined)).toBe('');
    expect(instanceMakersMarkLine(undefined)).toBe('');
  });

  it('itemNumber pins fraction digits and itemStatName capitalizes unknown keys', () => {
    expect(itemNumber(3)).toBe('3');
    expect(itemNumber(2.5, 1)).toBe('2.5');
    expect(itemStatName('weird')).toBe('Weird');
  });
});

// Composition ORDER inside hud.itemTooltip (the builders are pinned above,
// the composed placement is hud.ts glue): badges under the soulbound line,
// baked bonus stats after the def's own stat lines, the maker's mark near the
// bottom (after the set block, before the sell price).
import { readFileSync } from 'node:fs';

describe('hud.itemTooltip composition order (source pins)', () => {
  const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
  const badges = hud.indexOf('instanceBadgeLines(instance)');
  const bonus = hud.indexOf('instanceBonusStatLines(instance)');
  const mark = hud.indexOf('instanceMakersMarkLine(instance)');
  const soulbound = hud.indexOf("t('hudChrome.itemSoulbound')");
  const setBlock = hud.indexOf('this.itemSetBlock(item)');

  it('composes all three instance line sets exactly once each', () => {
    expect(badges).toBeGreaterThan(-1);
    expect(bonus).toBeGreaterThan(-1);
    expect(mark).toBeGreaterThan(-1);
    expect(hud.indexOf('instanceBadgeLines(instance)', badges + 1)).toBe(-1);
    expect(hud.indexOf('instanceBonusStatLines(instance)', bonus + 1)).toBe(-1);
    expect(hud.indexOf('instanceMakersMarkLine(instance)', mark + 1)).toBe(-1);
  });

  it('orders them badge lines, then bonus stats, then the makers mark', () => {
    expect(soulbound).toBeGreaterThan(-1);
    expect(badges).toBeGreaterThan(soulbound);
    expect(bonus).toBeGreaterThan(badges);
    expect(mark).toBeGreaterThan(bonus);
    expect(mark).toBeGreaterThan(setBlock);
  });
});
