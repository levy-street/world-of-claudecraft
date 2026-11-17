// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { layoutMechanicList, layoutMechanics } from '../mediawiki/reader/mechanic_cards.js';

function list(items) {
  const ul = document.createElement('ul');
  ul.innerHTML = items.map((html) => '<li>' + html + '</li>').join('');
  return ul;
}

describe('Encyclopedia mechanic cards', () => {
  it('cards a creature mechanic with its numbers as labelled stats, pairing damage', () => {
    const ul = list([
      'Chain Lightning. Damages targets in range. minimum damage 20, maximum damage 30, radius 13 yd, between uses 8 sec, school nature.',
    ]);
    expect(layoutMechanicList(ul)).toBe(true);
    const card = ul.querySelector('li.mechanic-card');
    expect(card.querySelector('.mechanic-name').textContent).toBe('Chain Lightning');
    expect(card.querySelector('.mechanic-text').textContent).toBe('Damages targets in range.');
    const stats = [...card.querySelectorAll('.mechanic-stats > div')].map((row) => [
      row.querySelector('dt').textContent,
      row.querySelector('dd').textContent,
    ]);
    expect(stats).toEqual([
      ['damage', '20 to 30'],
      ['radius', '13 yd'],
      ['between uses', '8 sec'],
      ['school', 'nature'],
    ]);
  });

  it('keeps the snapshot beside the card and marks it', () => {
    const ul = list([
      '<img class="attack-shot" alt=""><span>Lightning Rod. Marks the ground under a player. Get out before the cast ends, or you die. cast time 4.5 sec, radius 9 yd.</span>',
    ]);
    layoutMechanicList(ul);
    const card = ul.querySelector('li.mechanic-card.has-shot');
    expect(card.firstElementChild.matches('img.attack-shot')).toBe(true);
    expect(card.querySelector('.mechanic-text').textContent).toBe(
      'Marks the ground under a player. Get out before the cast ends, or you die.',
    );
    expect(card.querySelectorAll('.mechanic-stats > div')).toHaveLength(2);
  });

  it('turns journal flags into tags and keeps prose numbers as prose', () => {
    const ul = list([
      'Strain. Every 20 sec, a 2 sec cast, then a blast: 180 to 220 damage. Step away. (deadly, important)',
    ]);
    layoutMechanicList(ul);
    const card = ul.querySelector('li.mechanic-card');
    expect([...card.querySelectorAll('.mechanic-flag')].map((f) => f.textContent)).toEqual([
      'Deadly',
      'Important',
    ]);
    expect(card.querySelector('.mechanic-stats')).toBeNull();
    expect(card.querySelector('.mechanic-text').textContent).toBe(
      'Every 20 sec, a 2 sec cast, then a blast: 180 to 220 damage. Step away.',
    );
  });

  it('reads names that end in their own punctuation', () => {
    const ul = list([
      'Heel! The hounds return to his side. (important)',
      'How many chains do you break? Each broken chain removes 20% of his damage cut.',
    ]);
    layoutMechanicList(ul);
    expect([...ul.querySelectorAll('.mechanic-name')].map((n) => n.firstChild.textContent)).toEqual(
      ['Heel!', 'How many chains do you break?'],
    );
  });

  it('labels role tips, gathers bare traits and leaves other lines as notes', () => {
    const ul = list([
      'Thunder Slam. Knocks the target back. chance 30%, distance 9 yd.',
      'tank: Hold him in the middle.',
      'Immune to crowd control.',
      'Ignores taunts.',
      'In <a href="#Rifts">Rifts</a>, each rank adds the next attack on this list.',
    ]);
    layoutMechanicList(ul);
    const tip = ul.querySelector('li.mechanic-tip');
    expect(tip.querySelector('.mechanic-role').textContent).toBe('Tank');
    expect(tip.textContent).toContain('Hold him in the middle.');
    expect([...ul.querySelectorAll('.mechanic-traits span')].map((s) => s.textContent)).toEqual([
      'Immune to crowd control',
      'Ignores taunts',
    ]);
    expect(ul.querySelector('li.mechanic-note').textContent).toContain('each rank adds');
    // A sentence with a comma before its first stop is not an attack name.
    expect(ul.querySelectorAll('li.mechanic-card')).toHaveLength(1);
  });

  it('leaves lists outside mechanics and encounter sections alone', () => {
    const article = document.createElement('article');
    article.innerHTML =
      '<h2>Loot</h2><ul><li>Copper Ore. A common ore. chance 30%.</li></ul>' +
      '<h2>Mechanics</h2><details class="wiki-spoiler"><summary>Spoiler</summary><ul><li>Maul Arc. A cleave in front.</li></ul></details>';
    layoutMechanics(article);
    expect(article.querySelectorAll('.mechanic-card')).toHaveLength(1);
    expect(article.querySelector('.mechanic-card .mechanic-name').textContent).toBe('Maul Arc');
  });
});
