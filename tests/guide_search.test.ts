// Node-level pins for the Guide search core (src/guide/search.ts): the index contents
// (abilities and public deeds included), the token scoring order, the result cap, and
// the grouped presentation order. The DOM combobox glue stays browser-tested; these
// pins target the pure functions the panel renders from.

import { beforeAll, describe, expect, it } from 'vitest';
import { GUIDE_CLASSES, GUIDE_DEEDS } from '../src/guide/content.generated';
import { buildIndex, groupByType, rank, type SearchEntry } from '../src/guide/search';
import { setLanguage, t } from '../src/ui/i18n';

const entry = (label: string, type = 'T', href = '#'): SearchEntry => ({
  label,
  type,
  href,
  haystack: label.toLowerCase(),
});

describe('guide search ranking', () => {
  it('requires every token somewhere, in any order', () => {
    const index = [entry('The Hollow Crypt'), entry('The Sunken Bastion')];
    expect(rank(index, 'crypt hollow').map((e) => e.label)).toEqual(['The Hollow Crypt']);
    expect(rank(index, 'hollow crypt').map((e) => e.label)).toEqual(['The Hollow Crypt']);
    expect(rank(index, 'hollow bastion')).toEqual([]);
  });

  it('scores label prefix over word prefix over plain substring', () => {
    const index = [entry('XXalphaXX'), entry('Beta Alpha'), entry('Alphabet Soup')];
    expect(rank(index, 'alpha').map((e) => e.label)).toEqual([
      'Alphabet Soup',
      'Beta Alpha',
      'XXalphaXX',
    ]);
  });

  it('caps the ranked list at ten results', () => {
    const index = Array.from({ length: 30 }, (_, i) => entry(`Wolf ${i}`));
    expect(rank(index, 'wolf').length).toBe(10);
  });

  it('returns nothing for an empty or blank query', () => {
    const index = [entry('Anything')];
    expect(rank(index, '')).toEqual([]);
    expect(rank(index, '   ')).toEqual([]);
  });
});

describe('guide search grouping', () => {
  it('keeps cross-group order by best hit and within-group score order', () => {
    const a1 = entry('A first', 'Alpha');
    const b1 = entry('B first', 'Beta');
    const a2 = entry('A second', 'Alpha');
    expect(groupByType([a1, b1, a2])).toEqual([
      ['Alpha', [a1, a2]],
      ['Beta', [b1]],
    ]);
  });
});

describe('guide search index contents', () => {
  beforeAll(() => {
    setLanguage('en');
  });

  it('indexes every signature ability onto its class page', () => {
    const index = buildIndex();
    const abilityType = t('guide.search.typeAbility');
    for (const c of GUIDE_CLASSES) {
      for (const a of c.signatureAbilities) {
        const hit = index.find((e) => e.label === a.name && e.type === abilityType);
        expect(hit, `signature ability "${a.name}" missing from the index`).toBeDefined();
        expect(hit?.href.endsWith(`classes/${c.id}`), `"${a.name}" links off its class`).toBe(true);
      }
    }
  });

  it('indexes every public deed onto its category section of the roll', () => {
    const index = buildIndex();
    const deedType = t('guide.search.typeDeed');
    const deedHits = index.filter((e) => e.type === deedType);
    expect(deedHits.length).toBe(GUIDE_DEEDS.length);
    for (const d of GUIDE_DEEDS.slice(0, 5)) {
      const hit = deedHits.find((e) => e.label === d.name);
      expect(hit?.href.endsWith(`deeds#deed-cat-${d.category}`), `deed "${d.name}" anchor`).toBe(
        true,
      );
    }
  });
});
