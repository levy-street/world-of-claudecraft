// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { organizeReferenceDetails } from '../mediawiki/reader/article_disclosures.js';

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
