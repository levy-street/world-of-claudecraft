// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { layoutArticle, sectionRoute } from '../mediawiki/reader/article_layout.js';

it('keeps the article introduction, linked facts, map and categories when laying out the article', () => {
  const view = document.createElement('main');
  view.innerHTML =
    '<div class="article-heading"><img alt=""><h1>The Amberfall</h1></div><div class="tags"><a href="#Zones">Zones</a></div><article><h2>Overview</h2><p>Every leaf burns gold.</p><h2>Facts</h2><div class="scroll"><table><tbody><tr><th>Level range</th><td>18-20</td></tr><tr><th>Hub</th><td><a href="#Lanternmere">Lanternmere</a></td></tr></tbody></table></div><h2>Points of interest</h2><ul><li>The Goldmelt</li></ul><h2>NPCs</h2><p>A watchman.</p></article>';
  layoutArticle(view, { title: 'The Amberfall', categories: ['Zones'] }, true);
  expect(view.querySelector('.wiki-lead').textContent).toContain('levels 18 to 20');
  expect(view.querySelectorAll('table')).toHaveLength(1);
  expect(view.querySelector('.wiki-infobox a').getAttribute('href')).toBe('#Lanternmere');
  expect(view.querySelector('.wiki-infobox img')).toBeTruthy();
  expect(view.querySelector('.wiki-flavor').textContent).toBe('Every leaf burns gold.');
  expect(view.querySelector('article + .wiki-categories a').getAttribute('href')).toBe('#Zones');
  const route = sectionRoute(view.querySelector('.wiki-contents a').hash);
  expect(route).toEqual({ article: 'The Amberfall', section: 'points-of-interest' });
  expect(view.querySelector('#section-' + route.section)).toBeTruthy();
});
it('keeps repeated headings independently linkable and preserves literal hash characters in article names', () => {
  const view = document.createElement('main');
  view.innerHTML =
    '<div class="article-heading"><h1>A #1</h1></div><article><p>Examine this rule.</p><h2>Mechanics</h2><p>One.</p><h3>Timing</h3><p>Two.</p><h2>Mechanics</h2><p>Three.</p></article>';
  layoutArticle(view, { title: 'A #1', categories: ['Systems'] }, false);
  expect(view.querySelector('.wiki-contents').open).toBe(false);
  const links = [...view.querySelectorAll('.wiki-contents a')].map((a) => sectionRoute(a.hash));
  expect(links.map((l) => l.section)).toEqual(['mechanics', 'timing', 'mechanics-2']);
  expect(links.every((l) => l.article === 'A #1')).toBe(true);
  expect(view.querySelectorAll('.wiki-contents ol ol')).toHaveLength(1);
  expect(view.querySelectorAll('.wiki-infobox')).toHaveLength(0);
});

it('keeps all deed rewards together and the related article link outside the infobox', () => {
  const view = document.createElement('main');
  view.innerHTML =
    '<div class="article-heading"><h1>A deed</h1></div><article><p>Earn the deed.</p><h2>How to earn</h2><p>Turn in the quest.</p><h2>Reward</h2><p>Awards 5 Renown.</p><p>Unlocks the title "Hero".</p><p>See <a href="#Book%20of%20Deeds">Book of Deeds</a>.</p></article>';
  layoutArticle(view, { title: 'A deed', categories: ['Book of Deeds'] }, true);
  expect(view.querySelector('.wiki-reward').textContent).toContain(
    'Awards 5 Renown.Unlocks the title "Hero".',
  );
  expect(view.querySelector('.wiki-infobox a')).toBeNull();
  expect(view.querySelector('article > p a').textContent).toBe('Book of Deeds');
  expect([...view.querySelectorAll('h2')].map((h) => h.textContent)).toEqual(['How to earn']);
});

it('lifts ability stats into a strip of label and value pairs under the title', () => {
  const view = document.createElement('main');
  view.innerHTML =
    '<div class="article-heading"><h1>Bolt</h1></div><div class="tags"></div><article><h2>How it works</h2><p>Zaps.</p><h2>Ability stats</h2><div class="scroll"><table><tr><th>Cost</th><td>25 / 35 mana</td></tr><tr><th>Range</th><td>30 yd</td></tr></table></div><h2>Scaling</h2><p>More.</p></article>';
  layoutArticle(view, { title: 'Bolt (Ability)', categories: ['Abilities'], text: '' }, true);
  const stats = [...view.querySelectorAll('.ability-stats div')].map((d) => [
    d.querySelector('dt').textContent,
    d.querySelector('dd').textContent,
  ]);
  expect(stats).toEqual([
    ['Cost', '25 / 35 mana'],
    ['Range', '30 yd'],
  ]);
  expect([...view.querySelectorAll('h2')].map((h) => h.textContent)).not.toContain('Ability stats');
  expect(view.querySelector('.ability-stats').closest('.wiki-opening')).toBeTruthy();
});

it('gives a friendly or escort creature the creature info box', () => {
  const view = document.createElement('main');
  view.innerHTML =
    '<div class="article-heading"><img class="article-art model" alt=""><h1>A Caravan (Mob)</h1></div><article><p>A caravan.</p><h2>Facts</h2><div class="scroll"><table><tbody><tr><th>Family</th><td>Humanoids</td></tr></tbody></table></div></article>';
  layoutArticle(
    view,
    {
      title: 'A Caravan (Mob)',
      // The real page order: no Mobs category at all.
      categories: ['Escorts and objectives', 'Friendly creatures'],
    },
    true,
  );
  const box = view.querySelector('.wiki-infobox');
  expect(box.querySelector('.wiki-box-title').textContent).toBe('Creature information');
  expect(box.querySelector('.wiki-box-art img.model')).toBeTruthy();
});
