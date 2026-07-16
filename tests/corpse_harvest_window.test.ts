// @vitest-environment jsdom
//
// Behavioral pin for the per-corpse harvest picker painter (the pure row/button
// decisions are unit-tested in corpse_harvest_view via the sim suite). Unlike the
// other batch-5 windows, this is NOT a standalone framed window: the loot window
// controller composes renderCorpseHarvestPicker into its cursor-anchored popup,
// which is neither draggable nor resizable, so it
// stays a picker section rather than adopting the .window-frame chrome. This test
// locks the load-bearing contract the AAA pass must NOT disturb: the checkbox
// selection maps straight through to onHarvest (the tags drive the concentrated
// timed harvest in professions/gathering, so the mapping is the "timing" the brief
// requires stay untouched), the harvest-disabled state, and the empty short-circuit.

import { describe, expect, it, vi } from 'vitest';
import type { CorpseHarvestViewModel } from '../src/ui/hud/loot/corpse_harvest_view';
import { renderCorpseHarvestPicker } from '../src/ui/hud/loot/corpse_harvest_window';

function view(overrides: Partial<CorpseHarvestViewModel> = {}): CorpseHarvestViewModel {
  return {
    rows: [
      { tag: 'hide', checked: true },
      { tag: 'fang', checked: false },
    ],
    harvestDisabled: false,
    concentrated: true,
    ...overrides,
  };
}

describe('renderCorpseHarvestPicker: picker section', () => {
  it('appends one row per tagged component with the checkbox state from the view', () => {
    const container = document.createElement('div');
    renderCorpseHarvestPicker(container, view(), { onHarvest: () => {} });
    expect(container.querySelector('.corpse-harvest')).not.toBeNull();
    const rows = container.querySelectorAll<HTMLElement>('.corpse-harvest-row');
    expect(rows.length).toBe(2);
    const boxes = container.querySelectorAll<HTMLInputElement>('.corpse-harvest-check');
    expect(boxes[0].checked).toBe(true);
    expect(boxes[1].checked).toBe(false);
  });

  it('renders nothing when the corpse has no harvestable components', () => {
    const container = document.createElement('div');
    renderCorpseHarvestPicker(container, view({ rows: [] }), { onHarvest: () => {} });
    expect(container.querySelector('.corpse-harvest')).toBeNull();
  });

  it('disables the harvest button when the view says so', () => {
    const container = document.createElement('div');
    renderCorpseHarvestPicker(container, view({ harvestDisabled: true }), { onHarvest: () => {} });
    expect(container.querySelector<HTMLButtonElement>('.corpse-harvest-btn')?.disabled).toBe(true);
  });

  it('exposes what Harvest does via a tooltip, distinct from Take All (playtester clarity)', () => {
    const container = document.createElement('div');
    renderCorpseHarvestPicker(container, view(), { onHarvest: () => {} });
    const btn = container.querySelector<HTMLButtonElement>('.corpse-harvest-btn');
    expect(btn?.title).toBeTruthy();
    expect(btn?.title.length).toBeGreaterThan(0);
  });

  it('reports exactly the currently-checked tags to onHarvest (the concentration/timing contract)', () => {
    const container = document.createElement('div');
    const onHarvest = vi.fn();
    renderCorpseHarvestPicker(container, view(), { onHarvest });
    // As rendered: only "hide" is checked.
    container.querySelector<HTMLButtonElement>('.corpse-harvest-btn')?.click();
    expect(onHarvest).toHaveBeenLastCalledWith(['hide']);
    // Check "fang" too, then harvest again: both tags now flow through.
    const boxes = container.querySelectorAll<HTMLInputElement>('.corpse-harvest-check');
    boxes[1].checked = true;
    container.querySelector<HTMLButtonElement>('.corpse-harvest-btn')?.click();
    expect(onHarvest).toHaveBeenLastCalledWith(['hide', 'fang']);
  });

  it('allows an empty selection (spread across all), which the harvest still accepts', () => {
    const container = document.createElement('div');
    const onHarvest = vi.fn();
    renderCorpseHarvestPicker(
      container,
      view({ rows: [{ tag: 'hide', checked: false }], concentrated: false }),
      { onHarvest },
    );
    container.querySelector<HTMLButtonElement>('.corpse-harvest-btn')?.click();
    expect(onHarvest).toHaveBeenLastCalledWith([]);
  });
});
