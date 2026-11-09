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

it('reads labelled facts for zone and class cards', () => {
  expect(activityFacts('Levels: 1 to 7 · Town: Eastbrook')).toEqual([
    ['Levels', '1 to 7'],
    ['Town', 'Eastbrook'],
  ]);
});

it('lays out the zone and class hubs as illustrated feature cards with labelled facts', () => {
  for (const [title, variant] of [
    ['Zones', 'activity-grid'],
    ['Classes', 'activity-emblems'],
  ]) {
    const view = document.createElement('main');
    view.innerHTML =
      '<article><h2>Regions</h2><ul class="browse-records"><li><img data-game-art="/map_bg/vale.webp"><a href="#Vale">Vale</a> · Levels: 1 to 7 · Town: Eastbrook</li></ul></article>';
    layoutDirectory(view, { title });
    const list = view.querySelector('.activity-list');
    expect(list.classList.contains(variant), title).toBe(true);
    expect(view.querySelector('.activity-link').getAttribute('href')).toBe('#Vale');
    expect(view.querySelector('.activity-art').dataset.gameArt).toBe('/map_bg/vale.webp');
    expect([...view.querySelectorAll('.activity-facts dt')].map((d) => d.textContent)).toEqual([
      'Levels',
      'Town',
    ]);
    expect(view.querySelector('h2 .section-count').textContent).toBe('1');
  }
});

it('frames entry art in record lists without dropping the entry link', () => {
  const view = document.createElement('main');
  view.innerHTML =
    '<article><ul class="browse-records"><li><img data-game-art="/ui/mobs/bat.webp"><a href="#Bat">Bat</a></li></ul></article>';
  layoutDirectory(view, { title: 'Beasts (Enemies index)' });
  const frame = view.querySelector('.record-art');
  expect(frame.querySelector('img').dataset.gameArt).toBe('/ui/mobs/bat.webp');
  expect(frame.nextElementSibling.querySelector('a.record-name').getAttribute('href')).toBe('#Bat');
});

it('drops tile art only when every tile in a group would show the same picture', () => {
  const tile = (name, art) =>
    '<li><a class="browse-tile" href="#' +
    name +
    '"><span class="tile-art"><img data-game-art="' +
    art +
    '"></span><span class="tile-copy"><strong>' +
    name +
    '</strong></span></a></li>';
  const view = document.createElement('main');
  view.innerHTML =
    '<article><ul class="browse-groups">' +
    tile('Banker', '/ui/npc.webp') +
    tile('Cook', '/ui/npc.webp') +
    tile('Smith', '/ui/npc.webp') +
    '</ul><ul class="browse-groups">' +
    tile('Beasts', '/ui/bat.webp') +
    tile('Undead', '/ui/lich.webp') +
    tile('Trolls', '/ui/bat.webp') +
    '</ul></article>';
  layoutDirectory(view, { title: 'NPCs' });
  const [same, varied] = view.querySelectorAll('.browse-groups');
  expect(same.querySelectorAll('.tile-art')).toHaveLength(0);
  expect(same.querySelectorAll('.browse-tile.no-art')).toHaveLength(3);
  expect(varied.querySelectorAll('.tile-art')).toHaveLength(3);
});
