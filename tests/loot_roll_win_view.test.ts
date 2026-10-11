import { afterEach, describe, expect, it } from 'vitest';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';
import { lootRollWinBanner } from '../src/ui/loot_roll_win_view';

afterEach(() => setLanguage('en'));

describe('lootRollWinBanner', () => {
  it('uses the exact winner name, item display name, roll, and five-second gold celebration', () => {
    expect(lootRollWinBanner('A.+ wins [[i:greyjaw_hide_boots]] (87)', 'A.+')).toEqual([
      'Congratulations! You won [Greyjaw Hide Boots] with a roll of 87',
      true,
      undefined,
      'default',
      undefined,
      5000,
      null,
      'loot',
    ]);
  });

  it.each([
    ['Anna wins [[i:greyjaw_hide_boots]] (87)', 'Ann'],
    ['Ann wins [[i:greyjaw_hide_boots]] (87)', undefined],
    ['Ann wins [[i:missing_item]] (87)', 'Ann'],
    ['Ann wins [[i:greyjaw_hide_boots]] (0)', 'Ann'],
    ['Ann wins [[i:greyjaw_hide_boots]] (101)', 'Ann'],
    ['Ann wins [[i:greyjaw_hide_boots]] (NaN)', 'Ann'],
    ['Ann rolls Need [[i:greyjaw_hide_boots]] (87)', 'Ann'],
  ])('ignores another winner or malformed result: %s', (text, name) => {
    expect(lootRollWinBanner(text, name)).toBeNull();
  });

  it('localizes the congratulations and the item name', async () => {
    await ensureLocaleLoaded('ja_JP');
    setLanguage('ja_JP');
    const result = lootRollWinBanner('Ann wins [[i:greyjaw_hide_boots]] (87)', 'Ann');
    expect(result?.[0]).toContain('おめでとうございます！');
    expect(result?.[0]).not.toContain('Greyjaw Hide Boots');
    expect(result?.[0]).not.toContain('[[i:');
    expect(result?.[0]).toContain('87');
  });
});
