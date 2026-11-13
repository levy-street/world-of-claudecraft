import { describe, expect, it } from 'vitest';
import { addDisambiguation, articleName } from '../scripts/mediawiki/disambiguation';

const page = (title: string, text = 'Body.\n\n[[Category:Items]]') => ({ title, text });

describe('pages that share a name', () => {
  it('links two namesakes to each other and lists both under the plain name', () => {
    const item = page('Mother of Pearl (Item)', '<woc-art path="/ui/a.webp" />\nBody.');
    const quest = page('Mother of Pearl (Quest)');
    const lone = page('Wolf Fang');
    const created = addDisambiguation([item, quest, lone], articleName);
    // The art line stays first; the note comes straight after it.
    expect(item.text).toBe(
      "<woc-art path=\"/ui/a.webp\" />\n:''Another page has this name: [[Mother of Pearl (Quest)]].''\n\nBody.",
    );
    expect(
      quest.text.startsWith(":''Another page has this name: [[Mother of Pearl (Item)]].''"),
    ).toBe(true);
    expect(lone.text).toBe('Body.\n\n[[Category:Items]]');
    expect(created.map((p) => p.title)).toEqual(['Mother of Pearl']);
    expect(created[0].text).toContain(
      '* [[Mother of Pearl (Item)]]\n* [[Mother of Pearl (Quest)]]',
    );
    expect(created[0].text).toContain('[[Category:Disambiguation]]');
  });
  it('sends three or more namesakes to one list, beside a page that owns the plain name', () => {
    const dungeon = page('The Sunken Bastion');
    const quest = page('The Sunken Bastion (Quest)');
    const set = page('The Sunken Bastion (Collection)');
    const created = addDisambiguation([dungeon, quest, set], articleName);
    expect(created.map((p) => p.title)).toEqual(['The Sunken Bastion (disambiguation)']);
    for (const p of [dungeon, quest, set])
      expect(p.text).toContain(
        '[[The Sunken Bastion (disambiguation)|all pages named The Sunken Bastion]]',
      );
    expect(created[0].text.match(/^\* /gm)).toHaveLength(3);
  });
  it('leaves indexes and directories out', () => {
    const cls = page('Mage', 'Body.\n\n[[Category:Classes]]');
    const index = page('Mage (Abilities index)', '[[Category:Portals]]');
    expect(articleName(index)).toBeNull();
    expect(addDisambiguation([cls, index], articleName)).toEqual([]);
    expect(cls.text.startsWith('Body.')).toBe(true);
  });
});
