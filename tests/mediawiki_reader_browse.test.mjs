import { describe, expect, it } from 'vitest';
import {
  browseTrails,
  directoryLink,
  displayTitle,
  tilePreview,
} from '../mediawiki/reader/browse.js';

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
    // The Reliquary is a top-level subject in the left navigation, so it roots its own trail.
    expect(paths.get('A collection').map((e) => e.title)).toEqual(['The Reliquary']);
    expect(paths.has('A sword')).toBe(false);
  });

  it('reaches pages indexed by a table hub, a class page and the rooms of a raid', () => {
    const pages = new Map();
    const add = (title, text, categories) => pages.set(title, { title, text, categories });
    add(
      'Talent choices',
      ['{|', '! Level', '| Level 5 || [[Ice Floes (Talent)|Ice Floes]]', '|}'].join('\n'),
      ['Character progression'],
    );
    add('Ice Floes (Talent)', 'Article', ['Talent choices', 'Mage']);
    // A specialization lives on its class page, so it browses Classes > Mage.
    add('Classes', '* [[Mage]] · Resource: Mana', ['Portals']);
    add(
      'Mage',
      ['=== Pyromancy ===', '[[Pyromancy (Specialization)|Full Pyromancy page]]'].join('\n'),
      ['Classes'],
    );
    add('Pyromancy (Specialization)', 'Article', ['Specializations', 'Mage']);
    add('Dungeons', '* [[Big Raid (Raid)]] · 10 players', ['Portals']);
    add(
      'Big Raid (Raid)',
      ['* [[Boss (Mob)|Boss]]', '== Room reference ==', '* [[Inner Room]]'].join('\n'),
      ['Raids'],
    );
    add('Inner Room', 'Article', ['Dungeons', 'Big Raid (Raid)']);
    add('Boss (Mob)', 'Article', ['Mobs']);
    const paths = browseTrails(pages);
    expect(paths.get('Pyromancy (Specialization)').map((e) => e.title)).toEqual([
      'Classes',
      'Mage',
    ]);
    expect(paths.get('Ice Floes (Talent)').map((e) => e.title)).toEqual(['Talent choices']);
    expect(paths.get('Inner Room').map((e) => e.title)).toEqual(['Dungeons', 'Big Raid (Raid)']);
    expect(paths.has('Boss (Mob)')).toBe(false);
  });

  it('names hubs as players know them and previews what a group holds', () => {
    expect(displayTitle('Mobs')).toBe('Enemies');
    expect(displayTitle('Dungeons')).toBe('Dungeons and raids');
    expect(displayTitle('Beasts (Enemies index)')).toBe('Beasts');
    expect(displayTitle('Wild Boar (Mob)')).toBe('Wild Boar (Mob)');
    expect(
      tilePreview(
        [
          '== Bosses ==',
          '* [[Bat (Mob)|Colossal Bat]]',
          '* <woc-art path="/a.webp" size="icon" /> [[Deeprake]]',
          '* [[Bat (Mob)|Colossal Bat]]',
          '* [[Owl]]',
          '* [[Wolf]]',
        ].join('\n'),
      ),
    ).toEqual(['Colossal Bat', 'Deeprake', 'Owl']);
    expect(tilePreview('Prose with [[A link]] only.')).toEqual([]);
  });
});
