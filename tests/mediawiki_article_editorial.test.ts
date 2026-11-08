import { expect, it } from 'vitest';
import { questObjectiveText, systemIntroduction } from '../scripts/mediawiki/article_editorial';

it('moves explanatory prose above the walkthrough without losing rules or headings', () => {
  const { lead, rest } = systemIntroduction(
    'Combat uses abilities.\n\nTiming matters.\n\n== Range ==\nStay close.',
  );
  expect(lead).toBe('Combat uses abilities.\n\n');
  expect(rest).toBe('Timing matters.\n\n== Range ==\nStay close.');
  expect(systemIntroduction('== Rules ==\n* A rule')).toEqual({
    lead: '',
    rest: '== Rules ==\n* A rule',
  });
});

it('states objectives plainly while retaining targets and variable counts', () => {
  expect(
    questObjectiveText(
      { type: 'kill', targetMobId: 'wolf', label: 'Wolf slain', count: 8 },
      '[[Forest Wolf]]',
      '8',
    ),
  ).toBe('Defeat [[Forest Wolf]] 8 times.');
  expect(
    questObjectiveText(
      { type: 'gather', nodeType: 'ore', label: 'Ore mined', count: 5 },
      'ore',
      '5',
    ),
  ).toBe('Mine ore veins 5 times.');
  expect(
    questObjectiveText(
      { type: 'collect', itemId: 'ore', label: 'Ore gathered', count: 5 },
      '[[Ore]]',
      '5 plus 2 per previous switch',
    ),
  ).toBe('Collect 5 plus 2 per previous switch × [[Ore]].');
});
