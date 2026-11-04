import { describe, expect, it } from 'vitest';
import { browseTrails, directoryLink } from '../mediawiki/reader/browse.js';

describe('encyclopedia directory navigation', () => {
  it('keeps display names and full paths, including disambiguated article destinations', () => {
    const pages = new Map();
    const add = (title, text, categories) => pages.set(title, { title, text, categories });
    add('Items', '* [[Chest armor (Items index)|Chest armor]] (2)', ['Portals']);
    add('Chest armor (Items index)', '* [[Tunic]]\n* [[Tunic (2)|Tunic]]', ['Portals']);
    add('Tunic', 'An article', ['Items']);
    add('Tunic (2)', 'A different article', ['Items']);
    expect(directoryLink('[[Tunic (2)|Tunic]]')).toEqual({ title: 'Tunic (2)', label: 'Tunic' });
    expect(
      browseTrails(pages)
        .get('Tunic (2)')
        .map((e) => e.label),
    ).toEqual(['Items', 'Chest armor']);
  });
  it('only uses member links in a collection as children', () => {
    const pages = new Map();
    const add = (title, text, categories) => pages.set(title, { title, text, categories });
    add('Gameplay Systems', '* [[The Reliquary]]', ['Systems']);
    add('The Reliquary', '* [[A sword]] is an example reward.\n== Entries ==\n* [[A collection]]', [
      'Systems',
    ]);
    add('A collection', 'Article', ['The Reliquary']);
    add('A sword', 'Article', ['Items']);
    const paths = browseTrails(pages);
    expect(paths.get('A collection').map((e) => e.title)).toEqual([
      'Gameplay Systems',
      'The Reliquary',
    ]);
    expect(paths.has('A sword')).toBe(false);
  });
});
