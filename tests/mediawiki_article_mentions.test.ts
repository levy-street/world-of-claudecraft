import { describe, expect, it } from 'vitest';
import { linkArticleMentions } from '../scripts/mediawiki/article_mentions';

const page = (title: string, category: string, body = '') => ({
  title,
  text: body + '\n[[Category:' + category + ']]',
});

describe('links in player-facing wiki prose', () => {
  it('links a named region heading without changing the heading level or its display name', () => {
    const subject = page('Travel notes', 'Systems', '=== Eastbrook Vale ===\n== Objectives ==');
    linkArticleMentions([subject, page('Eastbrook Vale', 'Zones')]);
    expect(subject.text).toContain('=== [[Eastbrook Vale]] ===\n== Objectives ==');
  });
  it('links repeated names, table values, possessives and qualified names without altering their labels', () => {
    const subject = page(
      'Walkthrough',
      'Systems',
      'Speak to Riftwright Maelis in The Farshore. Maelis also works in the Farshore.\n* Use Rook’s Sigil. Rook\'s Sigil is consumed.\n{| class="wikitable"\n|-\n! Trainer\n| Riftwright Maelis\n|}\nRook is a different name.',
    );
    const pages = [
      subject,
      page('Riftwright Maelis (NPC)', 'NPCs'),
      page('The Farshore', 'Zones'),
      page("Rook's Sigil", 'Items'),
    ];
    linkArticleMentions(pages);
    expect(subject.text).toContain(
      '[[Riftwright Maelis (NPC)|Riftwright Maelis]] in [[The Farshore]]. [[Riftwright Maelis (NPC)|Maelis]]',
    );
    expect(subject.text).toContain(
      "Use [[Rook's Sigil|Rook’s Sigil]]. [[Rook's Sigil]] is consumed.",
    );
    expect(subject.text).toContain('! Trainer\n| [[Riftwright Maelis (NPC)|Riftwright Maelis]]');
    expect(subject.text).toContain('Rook is a different name.');
    const result = subject.text;
    linkArticleMentions(pages);
    expect(subject.text).toBe(result);
  });

  it('keeps homonyms distinct using profession, ability and zone context', () => {
    const subject = page(
      'Route',
      'Quests',
      'In Eastbrook Vale, Turn in Wolves at the Door. Buy Copper Ore. Learn the Copper Ore recipe. Cast Charge. Pay a charge per use.',
    );
    const pages = [
      subject,
      { title: 'Wolves at the Door', text: '[[Category:Quests]]\n[[Category:Eastbrook Vale]]' },
      {
        title: 'Wolves at the Door (2)',
        text: '[[Category:Quests]]\n[[Category:The Frostveil Reach]]',
      },
      page('Copper Ore', 'Items'),
      page('Copper Ore (Recipe)', 'Crafting recipes'),
      page('Charge (Ability)', 'Abilities'),
    ];
    linkArticleMentions(pages);
    expect(subject.text).toContain(
      'Turn in [[Wolves at the Door]]. Buy [[Copper Ore]]. Learn the [[Copper Ore (Recipe)|Copper Ore]] recipe. Cast [[Charge (Ability)|Charge]]. Pay a charge per use.',
    );
  });

  it('leaves markup, link destinations, structural headings, code and the current article untouched', () => {
    const markup = [
      '== Copper Ore ==',
      '[[Copper Ore|its ore]]',
      '[https://game.test/Copper Copper Ore]',
      '<woc-art path="/ui/items/Copper_Ore.webp" />',
      '<div class="woc-map"><span title="Copper Ore">S</span></div>',
      '`Copper Ore` <code>Copper Ore</code>',
      'https://game.test/Copper',
      '/Copper',
      '<!-- Copper Ore -->',
    ].join('\n');
    const subject = page(
      'Starter Guide',
      'Systems',
      markup + '\nStarter Guide mentions Copper Ore.',
    );
    const css = page('MediaWiki:Common.css', 'Wiki', '.Copper { content: "Copper Ore" }');
    const untouched = css.text;
    linkArticleMentions([subject, css, page('Copper', 'Items'), page('Copper Ore', 'Items')]);
    expect(subject.text).toContain(markup + '\nStarter Guide mentions [[Copper Ore]].');
    expect(css.text).toBe(untouched);
  });

  it('does not turn everyday words, role labels or unresolved homonyms into unrelated links', () => {
    const subject = page(
      'Other',
      'Systems',
      'All classes can defeat a world boss. The merchant sells mail armor. Pay the Charge. Wolves at the Door. FURY spends fury.',
    );
    linkArticleMentions([
      subject,
      page('All classes (Abilities index)', 'Portals'),
      page('World boss (Weekly Quest)', 'Weekly quests'),
      page('The Merchant (NPC)', 'NPCs'),
      page('Mail', 'Systems'),
      page('Charge (Ability)', 'Abilities'),
      page('Wolves at the Door', 'Quests'),
      page('Wolves at the Door (2)', 'Quests'),
      page('FURY (NPC)', 'NPCs'),
    ]);
    expect(subject.text).toContain(
      'All classes can defeat a world boss. The merchant sells mail armor. Pay the Charge. Wolves at the Door. [[FURY (NPC)|FURY]] spends fury.',
    );
  });
});
