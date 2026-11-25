// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { layoutLoot } from '../mediawiki/reader/loot_tabs.js';

it('shows Normal and Heroic loot as tabs with one panel open at a time', () => {
  const article = document.createElement('article');
  article.innerHTML =
    '<h2>Loot</h2><p>Note.</p><h3>Normal loot</h3><p><strong>Separate rolls</strong></p><table id="n"></table><h3>Heroic loot</h3><p><strong>Shared roll 1</strong></p><table id="h"></table><h2>Quest credit</h2><p>Kill 4.</p>';
  layoutLoot(article);
  const tabs = [...article.querySelectorAll('[role="tab"]')];
  expect(tabs.map((t) => t.textContent)).toEqual(['Normal', 'Heroic']);
  expect(article.querySelectorAll('h3')).toHaveLength(0);
  const [normal, heroic] = article.querySelectorAll('[role="tabpanel"]');
  expect(normal.hidden).toBe(false);
  expect(heroic.hidden).toBe(true);
  expect(normal.querySelector('#n')).toBeTruthy();
  expect(heroic.querySelector('#h')).toBeTruthy();
  expect(normal.querySelector('p').classList.contains('loot-title')).toBe(true);
  tabs[1].click();
  expect(normal.hidden).toBe(true);
  expect(heroic.hidden).toBe(false);
  expect(tabs[1].getAttribute('aria-selected')).toBe('true');
  expect(tabs[0].getAttribute('aria-selected')).toBe('false');
  // Content after the Loot section is untouched.
  expect(article.querySelector('h2:last-of-type').nextElementSibling.textContent).toBe('Kill 4.');
});

it('leaves a single-view loot section without tabs', () => {
  const article = document.createElement('article');
  article.innerHTML = '<h2>Loot</h2><p><strong>Separate rolls</strong></p><table></table>';
  layoutLoot(article);
  expect(article.querySelector('[role="tablist"]')).toBeNull();
  expect(article.querySelector('p.loot-title')).toBeTruthy();
});
