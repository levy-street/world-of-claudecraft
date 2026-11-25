// @vitest-environment happy-dom
// Title search on the static encyclopedia pages (mediawiki/reader/wiki_page.js): which
// rows match, and the results markup built from a fetched index.
import { describe, expect, it } from 'vitest';
import { resultsMarkup, searchRows } from '../mediawiki/reader/wiki_page.js';

const rows = [
  ['Iron Sword', '/wiki/item/iron-sword', '/ui/items/iron_sword.webp', 'Items'],
  ['Iron Shield', '/wiki/item/iron-shield', '', 'Items'],
  ['Sword Master', '/wiki/npc/sword-master', '/ui/npc.webp', 'NPCs'],
];

describe('encyclopedia title search', () => {
  it('needs every word in the title, in any order and case', () => {
    expect(searchRows(rows, 'iron').map(([t]) => t)).toEqual(['Iron Sword', 'Iron Shield']);
    expect(searchRows(rows, 'SWORD iron').map(([t]) => t)).toEqual(['Iron Sword']);
    expect(searchRows(rows, 'sword').map(([t]) => t)).toEqual(['Iron Sword', 'Sword Master']);
    expect(searchRows(rows, '   ')).toEqual([]);
    expect(searchRows(rows, 'axe')).toEqual([]);
  });

  it('escapes what it shows and links only wiki paths with site pictures', () => {
    const hostile = [
      ['<b>Bold</b>', '/wiki/item/bold', '//evil.example/x.png', 'Items'],
      ['Script', 'javascript:alert(1)', '/ui/x.webp', 'Items'],
    ];
    document.body.innerHTML = resultsMarkup('<img src=x onerror=1>', hostile);
    expect(document.querySelector('h1')?.textContent).toBe('<img src=x onerror=1>');
    expect(document.querySelectorAll('h1 img')).toHaveLength(0);
    const links = [...document.querySelectorAll('.results a')].map((a) => a.getAttribute('href'));
    expect(links).toEqual(['/wiki/item/bold']);
    expect(document.querySelector('.results a')?.textContent).toBe('<b>Bold</b>');
    // An off-site picture is dropped; the row still shows.
    expect(document.querySelectorAll('.results img')).toHaveLength(0);
  });

  it('shows the first page of results with a button for more', () => {
    const many = Array.from({ length: 75 }, (_, i) => [
      `Page ${i}`,
      `/wiki/topic/page-${i}`,
      '',
      'Reference',
    ]);
    document.body.innerHTML = resultsMarkup('page', many);
    expect(document.querySelectorAll('.results li')).toHaveLength(70);
    expect(document.querySelector('#more')).not.toBeNull();
    expect(document.body.textContent).toContain('75 results');
    document.body.innerHTML = resultsMarkup('page', many.slice(0, 1));
    expect(document.querySelector('#more')).toBeNull();
    expect(document.body.textContent).toContain('1 result');
  });
});
