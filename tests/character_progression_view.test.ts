// @vitest-environment happy-dom

// The Specialization board on the character sheet's stats rail: a stat-panel
// shaped like Offense and Defense, the chosen spec and role as rows, the
// mastery line under them, and the no-spec readout for a fresh character.

import { describe, expect, it } from 'vitest';
import { specializationPanelHtml } from '../src/ui/character_progression_view';
import type { IWorld } from '../src/world_api';

function world(playerClass: string, talentSpec: string | null): IWorld {
  return { cfg: { playerClass }, talentSpec } as unknown as IWorld;
}

function render(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el;
}

describe('specializationPanelHtml', () => {
  it('is a stat board titled Specialization with the spec, its role and the mastery line', () => {
    const el = render(specializationPanelHtml(world('warrior', 'arms')));
    const panel = el.querySelector('.stat-panel.char-spec-panel');
    expect(panel).not.toBeNull();
    expect(panel?.querySelector('.sp-title')?.textContent).toBe('Specialization');
    const rows = [...(panel?.querySelectorAll('.stat-cell') ?? [])].map((row) => [
      row.childNodes[0]?.textContent,
      row.querySelector('b')?.textContent,
    ]);
    expect(rows).toEqual([['Role', 'Damage']]);
    expect(panel?.querySelector('.char-spec-name')?.textContent).toBe('Battlecraft');
    expect(panel?.querySelector('.char-spec-class')?.textContent).toBe('Warrior');
    expect(panel?.querySelector('.char-spec-emblem')?.getAttribute('src')).toBe(
      '/ui/specs/warrior/arms.webp',
    );
    const mastery = panel?.querySelector('.char-spec-mastery');
    expect(mastery?.textContent).toContain('Mastery:');
    expect(mastery?.querySelector('b')?.textContent?.length).toBeGreaterThan(0);
    expect(mastery?.querySelector('.cp-none')?.textContent?.length).toBeGreaterThan(0);
  });

  it('reads "no specialization chosen" for a fresh character, with no role or mastery rows', () => {
    const el = render(specializationPanelHtml(world('warrior', null)));
    const rows = [...el.querySelectorAll('.stat-cell')];
    expect(rows).toHaveLength(0);
    expect(el.querySelector('.char-spec-name')?.textContent).toBe('No specialization chosen');
    expect(el.querySelector('.char-spec-class')?.textContent).toBe('Warrior');
    expect(el.querySelector('.char-spec-emblem')).toBeNull();
    expect(el.querySelector('.char-spec-mastery')).toBeNull();
  });

  it('renders nothing for a class without a talent tree', () => {
    expect(specializationPanelHtml(world('nobody', null))).toBe('');
  });

  it('resolves the current class and specialization on every render', () => {
    const state = world('rogue', 'assassination');
    const first = render(specializationPanelHtml(state));
    expect(first.querySelector('.char-spec-name')?.textContent).toBe('Knifework');
    expect(first.querySelector('.char-spec-class')?.textContent).toBe('Rogue');
    const second = render(specializationPanelHtml({ ...state, talentSpec: 'combat' }));
    expect(second.querySelector('.char-spec-name')?.textContent).toBe('Thuggery');
    expect(second.querySelector('.char-spec-emblem')?.getAttribute('src')).toBe(
      '/ui/specs/rogue/combat.webp',
    );
  });
});
