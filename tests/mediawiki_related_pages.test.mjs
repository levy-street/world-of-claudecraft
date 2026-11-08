// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import {
  mountRelatedPages,
  relatedGroups,
  relatedPageIndex,
} from '../mediawiki/reader/related_pages.js';

const page = (title, text, categories) => ({ title, text, categories });
it('uses directory members, preserves ambiguous titles, and ignores incidental links', () => {
  const pages = new Map([
    ['Items', page('Items', '* [[Weapons (Items index)|Weapons]]', ['Portals'])],
    [
      'Weapons (Items index)',
      page('Weapons (Items index)', '* [[Axe]]\n* [[Axe (2)|Axe]]', ['Portals']),
    ],
    ['Axe', page('Axe', 'Reward from [[A quest]].', ['Items'])],
    ['Axe (2)', page('Axe (2)', '', ['Items'])],
    ['A quest', page('A quest', '* [[Axe]]', ['Quests'])],
  ]);
  const index = relatedPageIndex(pages);
  expect(relatedGroups(pages.get('Axe'), index).map((g) => g.title)).toEqual([
    'Weapons (Items index)',
  ]);
  const view = document.createElement('main');
  view.innerHTML = '<article>Article</article><div class="wiki-categories"></div>';
  mountRelatedPages(view, pages.get('Axe'), index, pages);
  expect(view.querySelector('article + nav').getAttribute('aria-label')).toBe('Related pages');
  expect(view.querySelector('[aria-current="page"]').textContent).toBe('Axe');
  expect([...view.querySelectorAll('a')].some((a) => a.hash === '#Axe%20(2)')).toBe(true);
  expect(view.textContent).not.toContain('A quest');
});

it('groups system articles by the editorial directory sections', () => {
  const pages = new Map([
    [
      'Gameplay Systems',
      page(
        'Gameplay Systems',
        '== Trades ==\n* [[Mining]]\n* [[Cooking]]\n== Combat ==\n* [[Duels]]',
        ['Systems'],
      ),
    ],
    ...['Mining', 'Cooking', 'Duels'].map((title) => [
      title,
      page(title, '', ['Systems', 'Gameplay Systems']),
    ]),
  ]);
  const groups = relatedGroups(pages.get('Mining'), relatedPageIndex(pages));
  expect(groups.map((g) => g.label)).toEqual(['Trades']);
  expect(groups[0].members.map((m) => m.title)).toEqual(['Cooking', 'Mining']);
});

it('keeps every member accessible in a large category without a giant initial box', async () => {
  const names = Array.from({ length: 45 }, (_, i) => 'Entry ' + i);
  const pages = new Map([
    [
      'Mounts',
      page('Mounts', '== Entries ==\n' + names.map((n) => '* [[' + n + ']]').join('\n'), [
        'Systems',
      ]),
    ],
    ...names.map((name) => [name, page(name, '', ['Mounts'])]),
  ]);
  const view = document.createElement('main');
  view.innerHTML = '<article></article>';
  mountRelatedPages(view, pages.get('Entry 20'), relatedPageIndex(pages), pages);
  expect(view.querySelectorAll('.wiki-navbox-links li')).toHaveLength(12);
  const more = view.querySelector('.wiki-navbox-more');
  expect(more.querySelector('summary').textContent).toBe('Show all 45 pages');
  more.open = true;
  more.dispatchEvent(new Event('toggle'));
  expect(more.querySelectorAll('li')).toHaveLength(45);
  expect(more.querySelector('[aria-current="page"]')).toBeTruthy();
});

it('does not mistake collection-guide example links for collection membership', () => {
  const pages = new Map([
    ['Collection', page('Collection', '* [[Sword]]\n== Entries ==\n* [[Relic]]', ['Systems'])],
    ['Sword', page('Sword', '', ['Items'])],
    ['Relic', page('Relic', '', ['Collection'])],
  ]);
  expect(relatedGroups(pages.get('Sword'), relatedPageIndex(pages))).toEqual([]);
});
