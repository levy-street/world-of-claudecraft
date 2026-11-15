// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import {
  compareCells,
  enhanceItemTable,
  statNames,
  styleSwitchRows,
} from '../mediawiki/reader/item_table.js';

const build = () => {
  const holder = document.createElement('div');
  holder.innerHTML =
    '<div class="scroll"><table class="item-table"><tr><th>Item</th><th>Level</th><th>Quality</th><th>Stats</th></tr>' +
    '<tr><td>Bone Girdle</td><td>20</td><td>Epic</td><td>+7 Strength, +6 Stamina</td></tr>' +
    '<tr><td>Ash Belt</td><td>8</td><td>Uncommon</td><td>+5 Agility, +9 Stamina</td></tr>' +
    '<tr><td>Coral Girdle</td><td>12</td><td>Rare</td><td>+9 Intellect, +20 Haste Rating</td></tr></table></div>';
  const table = holder.querySelector('table');
  enhanceItemTable(table);
  return { holder, table };
};
const names = (table) =>
  [...table.querySelectorAll('tr')]
    .slice(1)
    .filter((row) => !row.hidden)
    .map((row) => row.children[0].textContent);

it('reads stat names and compares numbers, qualities and text', () => {
  expect(statNames('+3 Stamina, +20 Haste Rating')).toEqual(['Stamina', 'Haste Rating']);
  expect(statNames('')).toEqual([]);
  expect(compareCells('8', '20')).toBeLessThan(0);
  expect(compareCells('Epic', 'Uncommon')).toBeGreaterThan(0);
  expect(compareCells('Ash', 'Bone')).toBeLessThan(0);
  expect(compareCells('', '5')).toBeGreaterThan(0);
});

it('filters by name and by every chosen stat, and reports how many are shown', () => {
  const { holder, table } = build();
  const chips = [...holder.querySelectorAll('.item-filter-chip')];
  expect(chips.map((c) => c.textContent)).toEqual([
    'Agility',
    'Haste Rating',
    'Intellect',
    'Stamina',
    'Strength',
  ]);
  chips.find((c) => c.textContent === 'Stamina').click();
  expect(names(table)).toEqual(['Bone Girdle', 'Ash Belt']);
  chips.find((c) => c.textContent === 'Strength').click();
  expect(names(table)).toEqual(['Bone Girdle']);
  expect(holder.querySelector('.item-filter-count').textContent).toBe('1 of 3 items');
  chips.find((c) => c.textContent === 'Strength').click();
  const search = holder.querySelector('.item-filter-search');
  search.value = 'ash';
  search.dispatchEvent(new Event('input'));
  expect(names(table)).toEqual(['Ash Belt']);
});

it('sorts by a column, then reverses on a second click', () => {
  const { table } = build();
  const [, level, quality] = table.querySelectorAll('.item-sort');
  level.click();
  expect(names(table)).toEqual(['Ash Belt', 'Coral Girdle', 'Bone Girdle']);
  level.click();
  expect(names(table)).toEqual(['Bone Girdle', 'Coral Girdle', 'Ash Belt']);
  expect(level.parentNode.getAttribute('aria-sort')).toBe('descending');
  quality.click();
  expect(names(table)).toEqual(['Ash Belt', 'Coral Girdle', 'Bone Girdle']);
  expect(level.parentNode.getAttribute('aria-sort')).toBe('none');
});

it('turns a switch row into buttons and marks the current page', () => {
  const root = document.createElement('div');
  root.innerHTML =
    '<article><p><a href="#Items">Back to items</a></p><p><strong>Slot:</strong> <strong>Belts</strong> · <a href="#Footwear">Footwear</a> · <a href="#Gloves">Gloves</a></p><p><strong>Note:</strong> plain text stays a paragraph.</p></article>';
  styleSwitchRows(root);
  const rows = root.querySelectorAll('.gear-switch');
  expect(rows).toHaveLength(1);
  expect(rows[0].querySelector('.gear-switch-label').textContent).toBe('Slot');
  const options = [...rows[0].querySelectorAll('.gear-switch-option')];
  expect(options.map((o) => o.textContent)).toEqual(['Belts', 'Footwear', 'Gloves']);
  expect(options[0].getAttribute('aria-current')).toBe('page');
  expect(options[1].getAttribute('href')).toBe('#Footwear');
  expect(root.querySelectorAll('article > p')).toHaveLength(2);
});
