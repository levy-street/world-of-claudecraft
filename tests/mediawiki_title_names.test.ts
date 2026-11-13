import { describe, expect, it } from 'vitest';
import { linkArticleMentions } from '../scripts/mediawiki/article_mentions';
import { assignTitles, idQualifier, qualify } from '../scripts/mediawiki/title_names';

describe('titles for things that share a name', () => {
  it('says what a duplicate is instead of numbering it', () => {
    const used = new Set<string>();
    const titles = assignTitles(
      [
        { key: 'quest/a', base: 'The Wreck Line', hints: ['Quest', 'Quest, The Palmreach'] },
        { key: 'quest/b', base: 'The Wreck Line', hints: ['Quest', 'Quest, The Proving Shore'] },
        { key: 'quest/c', base: 'Mother of Pearl', hints: ['Quest'] },
        { key: 'item/c', base: 'Mother of Pearl', hints: ['', 'Item'] },
        { key: 'item/g', base: 'Gauntlets', hints: ['', 'Item'] },
        { key: 'item/h', base: 'Gauntlets', hints: ['Heroic'] },
        { key: 'mob/x', base: 'Wolf (Mob)', hints: [''] },
      ],
      used,
    );
    expect(titles.get('quest/a')).toBe('The Wreck Line (Quest, The Palmreach)');
    expect(titles.get('quest/b')).toBe('The Wreck Line (Quest, The Proving Shore)');
    // An item keeps its plain name; the quest that shares it is marked.
    expect(titles.get('quest/c')).toBe('Mother of Pearl (Quest)');
    expect(titles.get('item/c')).toBe('Mother of Pearl');
    expect(titles.get('item/g')).toBe('Gauntlets');
    expect(titles.get('item/h')).toBe('Gauntlets (Heroic)');
    expect(titles.get('mob/x')).toBe('Wolf (Mob)');
    expect(new Set(titles.values()).size).toBe(titles.size);
    expect([...titles.values()].every((t) => used.has(t))).toBe(true);
  });
  it('folds a qualifier into an existing suffix and numbers only as a last resort', () => {
    expect(qualify('Brother Aldric (NPC)', 'Mirefen Marsh')).toBe(
      'Brother Aldric (NPC, Mirefen Marsh)',
    );
    expect(qualify('The Wreck Line', 'Quest')).toBe('The Wreck Line (Quest)');
    expect(idQualifier('tideglass_reflection_mage', 'Tideglass Reflection')).toBe('mage');
    const titles = assignTitles(
      [
        { key: 'a', base: 'Twin', hints: ['Same'] },
        { key: 'b', base: 'Twin', hints: ['Same'] },
      ],
      new Set(),
    );
    expect([...titles.values()].sort()).toEqual(['Twin', 'Twin (2)']);
  });
});

describe('automatic links', () => {
  it('does not link a bare list entry to a page that only shares its name', () => {
    const pages = [
      {
        title: 'The Proving Shore',
        text: '== Points of interest ==\n* The Wreck Line\n* The Old Pier\n\nFinish the quest The Wreck Line to move on.\n\n[[Category:Zones]]',
      },
      { title: 'The Wreck Line', text: 'A quest.\n\n[[Category:Quests]]' },
    ];
    linkArticleMentions(pages);
    const zone = pages[0].text;
    expect(zone).toContain('* The Wreck Line\n');
    // The same name in a sentence that says it is a quest is still linked.
    expect(zone).toContain('the quest [[The Wreck Line]] to move on');
  });
});
