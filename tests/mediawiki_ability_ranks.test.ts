import { describe, expect, it } from 'vitest';
import { mergeRankText, rankValues } from '../scripts/mediawiki/ability_ranks';

describe('per-rank ability text', () => {
  it('lists the numbers that change in rank order and leaves the rest alone', () => {
    expect(
      mergeRankText([
        'Heals for 42 to 51. Lasts 6 sec.',
        'Heals for 76 to 90. Lasts 6 sec.',
        'Heals for 122 to 144. Lasts 6 sec.',
      ]),
    ).toBe("Heals for '''42 to 51 / 76 to 90 / 122 to 144'''. Lasts 6 sec.");
    expect(mergeRankText(['Same 5%', 'Same 5%'])).toBe('Same 5%');
  });
  it('keeps a formula or a link in one piece', () => {
    expect(
      mergeRankText([
        'Add <woc-math>SP × frac(1.5, 3.5)</woc-math> to [[Rank 1 (Rift)|it]].',
        'Add <woc-math>SP × frac(2, 3.5)</woc-math> to [[Rank 1 (Rift)|it]].',
      ]),
    ).toBe(
      "Add '''<woc-math>SP × frac(1.5, 3.5)</woc-math> / <woc-math>SP × frac(2, 3.5)</woc-math>''' to [[Rank 1 (Rift)|it]].",
    );
  });
  it('refuses to merge ranks that say different things', () => {
    expect(mergeRankText(['Deals 5 damage.', 'Deals 9 damage and stuns.'])).toBeNull();
    expect(mergeRankText(['Deals 5.', 'Deals 9. Then 2 more.'])).toBeNull();
  });
  it('joins stat values only when they differ', () => {
    expect(rankValues([25, 35, 50])).toBe('25 / 35 / 50');
    expect(rankValues([1.5, 1.5])).toBe('1.5');
  });
});
