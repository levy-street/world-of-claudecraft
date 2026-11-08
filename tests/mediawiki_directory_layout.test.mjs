// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { activityFacts, layoutDirectory } from '../mediawiki/reader/directory_layout.js';

it('groups activity facts while retaining unknown future metadata', () => {
  expect(activityFacts('Normal Finder levels 7 to 10 · Heroic available · 4 encounters')).toEqual([
    ['Normal level', '7 to 10'],
    ['Difficulty', 'Normal / Heroic'],
    ['Bosses', '4'],
  ]);
  expect(
    activityFacts('10 players · Normal and Heroic · 1 boss encounter · New requirement'),
  ).toEqual([
    ['Group size', '10 players'],
    ['Difficulty', 'Normal / Heroic'],
    ['Bosses', '1'],
    ['', 'New requirement'],
  ]);
});

it('keeps activity links and artwork, moves the lead ahead of navigation, and retains interior references', () => {
  const view = document.createElement('main');
  view.innerHTML =
    '<div class="article-heading"><h1>Dungeons</h1></div><div class="tags"></div><nav class="jump"><a data-part="dungeons">Dungeons</a></nav><article><p>Find a dungeon.</p><h2 id="dungeons">Five-player dungeons</h2><p>Finder levels.</p><ul class="browse-records"><li><img data-game-art="/ui/crypt.webp"><a href="#Crypt">Crypt</a> · Normal Finder levels 7 to 10 · Heroic available · 4 encounters</li></ul><h2>Raids</h2><ul class="browse-records"><li><img data-game-art="/ui/raid.webp"><a href="#Raid">The raid</a> · 10 players · Normal and Heroic · 1 boss encounter</li></ul><h2>Other interiors</h2><ul class="browse-records"><li><a href="#Crypt">Crypt</a> · Complete <a href="#Quest">a quest</a>.</li></ul></article>';
  layoutDirectory(view, { title: 'Dungeons' });
  expect(view.querySelector('.directory-contents').previousElementSibling.textContent).toBe(
    'Find a dungeon.',
  );
  expect(view.querySelectorAll('.activity-link')).toHaveLength(2);
  expect(view.querySelectorAll('.activity-raids .activity-link')).toHaveLength(1);
  expect(view.querySelector('.activity-link').getAttribute('href')).toBe('#Crypt');
  expect(view.querySelector('.activity-art').dataset.gameArt).toBe('/ui/crypt.webp');
  expect(view.querySelectorAll('.activity-link a')).toHaveLength(0);
  expect(view.querySelector('.activity-facts').textContent).toContain('Normal level7 to 10');
  expect(view.querySelector('.record-detail a').getAttribute('href')).toBe('#Quest');
  expect(view.querySelector('.record-detail').textContent).toBe('Complete a quest.');
  expect(view.querySelector('#dungeons')).toBeTruthy();
});

it('preserves dense item catalog rows and their filtering hooks', () => {
  const view = document.createElement('main');
  view.innerHTML =
    '<article><ul class="browse-records"><li><img data-game-art="/ui/item.webp"><a href="#Item">Item</a> · Buy from <a href="#Vendor">Vendor</a>.</li></ul></article>';
  layoutDirectory(view, { title: 'Items' });
  expect(view.querySelectorAll('.browse-records > li')).toHaveLength(1);
  expect(view.querySelector('.activity-link')).toBeNull();
  expect([...view.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
    '#Item',
    '#Vendor',
  ]);
  expect(view.textContent).toContain('Buy from Vendor.');
});
