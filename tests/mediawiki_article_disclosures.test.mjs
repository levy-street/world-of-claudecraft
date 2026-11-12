// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import {
  hideSpoilers,
  isBossPage,
  organizeReferenceDetails,
} from '../mediawiki/reader/article_disclosures.js';

it('keeps full-zone maps and their legends together in expandable regions', () => {
  const article = document.createElement('article');
  article.innerHTML = ['Vale', 'Marsh', 'Coast']
    .map(
      (name) =>
        '<p><strong><a href="#' +
        name +
        '">' +
        name +
        '</a></strong></p><div class="woc-map" style="background-size:100% 100%"></div><ul><li>Coordinates</li></ul>',
    )
    .join('');
  organizeReferenceDetails(article);
  expect(article.querySelectorAll('details')).toHaveLength(3);
  expect(article.querySelectorAll('details[open]')).toHaveLength(1);
  expect(article.querySelectorAll('details .woc-map')).toHaveLength(3);
  expect(article.querySelectorAll('details ul')).toHaveLength(3);
  expect(article.querySelectorAll('details a')).toHaveLength(3);
});

it('keeps additional source notes available without absorbing the next section', () => {
  const article = document.createElement('article');
  article.innerHTML =
    '<h2>Sources</h2><ul><li><a href="#Quest">Quest reward</a></li></ul><h2>Used for</h2><p>Recipe</p>';
  organizeReferenceDetails(article);
  expect(article.querySelector('details a').getAttribute('href')).toBe('#Quest');
  expect(article.querySelector('details').open).toBe(false);
  expect(article.querySelector('#section-sources').tagName).toBe('SUMMARY');
  expect(article.querySelector('details + h2').textContent).toBe('Used for');
});

it('puts boss fight sections behind a spoiler wall and leaves ordinary creatures open', () => {
  const build = () => {
    const article = document.createElement('article');
    article.innerHTML =
      '<h2>Facts</h2><p>Open.</p><h2>Mechanics</h2><ul><li>Enrages.</li></ul><h2>Normal encounter</h2><p>Phase one.</p><h3>Room</h3><p>Adds.</p><h2>Loot</h2><p>Drops.</p>';
    return article;
  };
  const boss = build();
  hideSpoilers(boss, { text: '! Rank\n| Boss\n' });
  const walls = [...boss.querySelectorAll('details.wiki-spoiler')];
  expect(walls).toHaveLength(2);
  expect(walls.every((w) => !w.open)).toBe(true);
  expect(walls[0].previousElementSibling.textContent).toBe('Mechanics');
  expect(walls[1].textContent).toContain('Phase one.');
  expect(walls[1].textContent).toContain('Adds.');
  expect(walls[1].querySelector('summary').textContent).toContain('Spoiler');
  expect(boss.querySelector('h2:last-of-type').nextElementSibling.textContent).toBe('Drops.');

  const wolf = build();
  hideSpoilers(wolf, { text: '! Rank\n| Elite\n' });
  // An ordinary creature keeps its trait list open; only the encounter guide is walled.
  expect(wolf.querySelectorAll('details.wiki-spoiler')).toHaveLength(1);
  expect(isBossPage({ text: '! Rank\n| World boss\n' })).toBe(true);
});
