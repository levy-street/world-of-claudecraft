// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { groupPhases, layoutEncounter } from '../mediawiki/reader/encounter_layout.js';

function article(html) {
  const node = document.createElement('article');
  node.innerHTML = html;
  return node;
}

const TIER = (tier) =>
  '<p>The foreman, chained to four pillars.</p>' +
  '<h3>The Lock</h3><p>He starts bound.</p><ul><li>Strain. A blast. (deadly)</li></ul>' +
  '<h3>Tips by role</h3><ul><li>tank: Hold him.</li></ul>' +
  (tier === 'heroic' ? '<h3>Heroic changes</h3><ul><li>Hits harder.</li></ul>' : '');

describe('Encyclopedia encounter layout', () => {
  it('shows one Encounter section with Normal and Heroic tabs', () => {
    const page = article(
      '<h2>Mechanics</h2><ul><li>Enrage.</li></ul>' +
        '<h2>Normal encounter</h2>' +
        TIER('normal') +
        '<h2>Heroic encounter</h2>' +
        TIER('heroic') +
        '<h2>Loot</h2><p>Drops.</p>',
    );
    layoutEncounter(page);
    expect([...page.querySelectorAll(':scope > h2')].map((h) => h.textContent)).toEqual([
      'Mechanics',
      'Encounter',
      'Loot',
    ]);
    const tabs = [...page.querySelectorAll('.encounter-tab')];
    expect(tabs.map((t) => t.textContent)).toEqual(['Normal', 'Heroic']);
    const [normal, heroic] = page.querySelectorAll('.encounter-panel');
    expect(normal.hidden).toBe(false);
    expect(heroic.hidden).toBe(true);
    expect(heroic.textContent).toContain('Hits harder.');
    expect(normal.textContent).not.toContain('Hits harder.');
    tabs[1].click();
    expect(normal.hidden).toBe(true);
    expect(heroic.hidden).toBe(false);
    // Loot stays its own section after the encounter.
    expect(page.querySelector('.encounter-panel + h2, .encounter-panel ~ h2').textContent).toBe(
      'Loot',
    );
  });

  it('groups a phase heading with its summary and attacks', () => {
    const page = article(TIER('heroic'));
    const nodes = groupPhases([...page.children]);
    expect(nodes[0].classList.contains('encounter-overview')).toBe(true);
    const [lock, tips, changes] = nodes.slice(1);
    expect(lock.matches('section.encounter-phase:not(.encounter-extra)')).toBe(true);
    expect(lock.querySelector('h3').textContent).toBe('The Lock');
    expect(lock.querySelector('p.encounter-summary').textContent).toBe('He starts bound.');
    expect(lock.querySelector('ul li').textContent).toContain('Strain');
    expect(tips.classList.contains('encounter-extra')).toBe(true);
    expect(changes.classList.contains('encounter-extra')).toBe(true);
  });

  it('keeps a single-difficulty fight as its own section without tabs', () => {
    const page = article('<h2>Normal encounter</h2>' + TIER('normal') + '<h2>Loot</h2>');
    layoutEncounter(page);
    expect(page.querySelector('.encounter-tabs')).toBeNull();
    expect(page.querySelector(':scope > h2').textContent).toBe('Normal encounter');
    expect(page.querySelectorAll('.encounter-phase')).toHaveLength(2);
  });
});
