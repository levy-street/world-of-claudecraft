import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { talentSummary } from '../scripts/mediawiki/talent_articles';
import { ROW_TREES, TALENTS } from '../src/sim/content/talents';

const seed = readFileSync('mediawiki/seed/pages.xml', 'utf8');
function page(title: string): string {
  const start = seed.indexOf('<title>' + title + '</title>');
  expect(start, title).toBeGreaterThan(-1);
  return seed.slice(start, seed.indexOf('</page>', start));
}

describe('Encyclopedia class pages hold their specializations and talents', () => {
  it('writes every spec and the talent grid into its class page', () => {
    for (const cls of Object.values(TALENTS)) {
      const text = page(cls.class[0].toUpperCase() + cls.class.slice(1));
      expect(text).toContain('== Specializations ==');
      for (const spec of cls.specs) {
        expect(text).toContain('=== ' + spec.name.replace(/'/g, '&apos;') + ' ===');
      }
      // One mastery line per spec (a mastery named like an ability may be linked).
      expect(text.match(/Mastery: /g)).toHaveLength(cls.specs.length);
      expect(text).toContain('{| class=&quot;wikitable talent-grid&quot;');
      for (const row of ROW_TREES[cls.class]) expect(text).toContain('Level ' + row.level + ' ||');
      // The old link-only build section and the duplicated talent ability list are gone.
      expect(text).not.toContain('== Build choices ==');
      expect(text).not.toContain('== Talent choices ==');
    }
  });

  it('shows every class on Talent choices as a grid with an explanation', () => {
    const text = page('Talent choices');
    expect(text).toContain('== How talents work ==');
    expect(text.match(/wikitable talent-grid/g)).toHaveLength(Object.keys(TALENTS).length);
  });

  it('keeps a talent summary to its first sentence', () => {
    expect(talentSummary('Rush to a friend. Then shield them.')).toBe('Rush to a friend.');
    expect(talentSummary('x'.repeat(300)).length).toBeLessThanOrEqual(150);
  });
});
