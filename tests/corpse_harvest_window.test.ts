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

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  type CorpseHarvestViewModel,
  corpseHarvestView,
} from '../src/ui/hud/loot/corpse_harvest_view';
import { renderCorpseHarvestPicker } from '../src/ui/hud/loot/corpse_harvest_window';

function view(overrides: Partial<CorpseHarvestViewModel> = {}): CorpseHarvestViewModel {
  return {
    rows: [
      { tag: 'hide', checked: true },
      { tag: 'fang', checked: false },
    ],
    harvestDisabled: false,
    concentrated: true,
    forfeitsEveryYield: false,
    corpseHarvestable: true,
    ...overrides,
  };
}

describe('renderCorpseHarvestPicker: picker section', () => {
  it('appends one row per tagged component with the checkbox state from the view', () => {
    const container = document.createElement('div');
    renderCorpseHarvestPicker(container, view(), { onHarvest: () => {}, attachTooltip: () => {} });
    expect(container.querySelector('.corpse-harvest')).not.toBeNull();
    const rows = container.querySelectorAll<HTMLElement>('.corpse-harvest-row');
    expect(rows.length).toBe(2);
    const boxes = container.querySelectorAll<HTMLInputElement>('.corpse-harvest-check');
    expect(boxes[0].checked).toBe(true);
    expect(boxes[1].checked).toBe(false);
  });

  it('renders nothing when the corpse has no harvestable components', () => {
    const container = document.createElement('div');
    renderCorpseHarvestPicker(container, view({ rows: [] }), {
      onHarvest: () => {},
      attachTooltip: () => {},
    });
    expect(container.querySelector('.corpse-harvest')).toBeNull();
  });

  it('disables the harvest button when the view says so', () => {
    const container = document.createElement('div');
    renderCorpseHarvestPicker(container, view({ harvestDisabled: true }), {
      onHarvest: () => {},
      attachTooltip: () => {},
    });
    expect(container.querySelector<HTMLButtonElement>('.corpse-harvest-btn')?.disabled).toBe(true);
    // The ONE fixture where the two model fields disagree, so it is the only
    // place that can tell which field each write reads. `harvestDisabled` is
    // true here and `forfeitsEveryYield` is false, so the reason line must
    // stay hidden: a painter that keyed the line off `harvestDisabled` would
    // be invisible to every other case, where the two always coincide.
    expect(container.querySelector<HTMLElement>('.corpse-harvest-warning')?.hidden).toBe(true);
  });

  it('exposes what Harvest does via the shared tooltip idiom, distinct from Take Loot', () => {
    const container = document.createElement('div');
    const attachTooltip = vi.fn();
    renderCorpseHarvestPicker(container, view(), { onHarvest: () => {}, attachTooltip });
    const btn = container.querySelector<HTMLButtonElement>('.corpse-harvest-btn');
    // No native title: the shared idiom covers hover, mobile long-press, and
    // keyboard focus, where a bare title attribute is hover-only.
    expect(btn?.title).toBe('');
    const call = attachTooltip.mock.calls.find(([target]) => target === btn);
    expect(call?.[1]()).toBe(
      'Gathers the checked components. Each corpse can be harvested once, first come. Does not take the loot.',
    );
  });

  it('reports exactly the currently-checked tags to onHarvest (the concentration/timing contract)', () => {
    const container = document.createElement('div');
    const onHarvest = vi.fn();
    renderCorpseHarvestPicker(container, view(), { onHarvest, attachTooltip: () => {} });
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
      { onHarvest, attachTooltip: () => {} },
    );
    container.querySelector<HTMLButtonElement>('.corpse-harvest-btn')?.click();
    expect(onHarvest).toHaveBeenLastCalledWith([]);
  });
});

// #2509: the picker's mirror of the command-boundary refusal. Checking only
// families with no harvest item behind them (claw, tusk, gills, horn) is a
// command the sim refuses pre-claim, so the button goes dead and the section
// says why IN PLACE: a `disabled` button takes no pointer events and leaves the
// tab order (src/ui/focus_manager.ts), so a tooltip on it is unreachable.
describe('renderCorpseHarvestPicker: a selection that forfeits every yield (#2509)', () => {
  // old_greyjaw's real tags. Only claw is unmapped.
  const GREYJAW = ['hide', 'fang', 'claw'];
  const rowsFor = (tags: string[], checked: string[] = []) =>
    tags.map((tag) => ({ tag, checked: checked.includes(tag) }));

  function render(tags: string[], checked: string[] = []) {
    const container = document.createElement('div');
    const onHarvest = vi.fn();
    const attachTooltip = vi.fn();
    // The REAL view core for the initial model, not a hand-rolled guess at it.
    // The painter re-derives through corpseHarvestView on every `change` event
    // anyway (corpse_harvest_window.ts), so a second, approximate copy of the
    // rule here only created a first render that could disagree with every
    // render after it: the old inline `checked.every(t => t === 'claw' ...)`
    // answered TRUE for an all-unmapped corpse where the core answers false
    // (nothing is forfeited there; #2513's separate term is what disables it).
    renderCorpseHarvestPicker(container, corpseHarvestView(tags, new Set(checked)), {
      onHarvest,
      attachTooltip,
    });
    const boxes = [...container.querySelectorAll<HTMLInputElement>('.corpse-harvest-check')];
    return {
      container,
      onHarvest,
      attachTooltip,
      boxes,
      btn: container.querySelector<HTMLButtonElement>('.corpse-harvest-btn')!,
      warning: container.querySelector<HTMLElement>('.corpse-harvest-warning')!,
      // The real user gesture. Setting `.checked` fires no `change`, so a test
      // that mutated the property directly would assert a stale button and
      // pass whatever the handler did.
      toggle(tag: string) {
        const box = boxes.find((b) => b.value === tag)!;
        box.checked = !box.checked;
        box.dispatchEvent(new Event('change', { bubbles: true }));
      },
    };
  }

  it('hides the reason line while the selection can still yield something', () => {
    const t = render(GREYJAW, ['hide']);
    expect(t.btn.disabled).toBe(false);
    expect(t.warning.hidden).toBe(true);
  });

  it('kills the button and states why when the last mapped box is unchecked', () => {
    const t = render(GREYJAW, ['hide', 'claw']);
    expect(t.btn.disabled).toBe(false);
    t.toggle('hide');
    expect(t.btn.disabled).toBe(true);
    expect(t.warning.hidden).toBe(false);
    expect(t.warning.textContent).toBe('Nothing you selected can be harvested from this corpse.');
    // The dead button really is dead: a click submits nothing.
    t.btn.click();
    expect(t.onHarvest).not.toHaveBeenCalled();
  });

  it('announces the reason, since the button silently leaves the tab order', () => {
    // A `disabled` button takes no pointer events and is not focusable, so
    // neither the shared tooltip nor an aria-label on it is reachable at the
    // moment the action dies. The live region is what carries the why.
    const t = render(GREYJAW, ['hide']);
    expect(t.warning.getAttribute('role')).toBe('status');
    expect(t.warning.getAttribute('aria-live')).toBe('polite');
    // Said once, not twice: the sentence lives on the line alone, never also
    // on the button, so browse mode does not read it back to back.
    t.toggle('hide');
    t.toggle('claw');
    expect(t.warning.hidden).toBe(false);
    expect(t.btn.getAttribute('aria-label')).toBeNull();
  });

  it('keeps the reason line BELOW the button, so showing it never moves the control', () => {
    // The line appears and disappears on a checkbox toggle. Above the button
    // it would shove Harvest down at the exact moment the player is reaching
    // for it; below, only the popup's bottom edge moves. Pinned because the
    // whole layout-stability argument is invisible to every other assertion.
    const t = render(GREYJAW, ['claw']);
    expect(t.btn.nextElementSibling).toBe(t.warning);
  });

  it('styles the reason line as an error, from the shared token', () => {
    // The class is otherwise pinned only by this file's own querySelector, so
    // renaming it on one side would leave the line rendering as ordinary body
    // text with every test still green.
    const css = readFileSync(
      path.resolve(process.cwd(), 'src/styles/components.css'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = /\.corpse-harvest-warning\s*\{([^}]*)\}/.exec(css);
    expect(rule, '.corpse-harvest-warning has no rule in components.css').not.toBeNull();
    expect(rule?.[1]).toContain('var(--color-text-error)');
  });

  it('comes back to life the moment a mapped family is checked again', () => {
    const t = render(GREYJAW, ['claw']);
    expect(t.btn.disabled).toBe(true);
    expect(t.warning.hidden).toBe(false);
    t.toggle('fang');
    expect(t.btn.disabled).toBe(false);
    expect(t.warning.hidden).toBe(true);
    t.btn.click();
    expect(t.onHarvest).toHaveBeenLastCalledWith(['fang', 'claw']);
  });

  it('never disables on the way back to an empty selection, which spreads', () => {
    const t = render(GREYJAW, ['claw']);
    expect(t.btn.disabled).toBe(true);
    t.toggle('claw');
    expect(t.btn.disabled).toBe(false);
    expect(t.warning.hidden).toBe(true);
    t.btn.click();
    expect(t.onHarvest).toHaveBeenLastCalledWith([]);
  });

  it('draws NO section at all for an all-unmapped corpse (#2513)', () => {
    // fen_troll (claw, tusk). The sim refuses the command at its corpse-level
    // gate, so there is nothing for the picker to submit. Drawing the section
    // with a dead button would be a NEW state and a bad one: the reason line
    // reports a FORFEIT, which is a statement about the selection, and nothing
    // is being forfeited here, so it stays hidden and the player would get a
    // disabled control with no explanation and two checkboxes that do nothing.
    // An untagged corpse already shows no section; this matches it.
    const container = document.createElement('div');
    const onHarvest = vi.fn();
    renderCorpseHarvestPicker(container, corpseHarvestView(['claw', 'tusk'], new Set()), {
      onHarvest,
      attachTooltip: () => {},
    });
    expect(container.querySelector('.corpse-harvest')).toBeNull();
    expect(container.querySelector('.corpse-harvest-btn')).toBeNull();
    expect(container.querySelector('.corpse-harvest-check')).toBeNull();
    expect(container.children).toHaveLength(0);
    // The discriminator on the identical call: a MIXED corpse carrying the same
    // unmapped families still draws its section, so this is the predicate and
    // not the painter refusing everything.
    const mixed = document.createElement('div');
    renderCorpseHarvestPicker(mixed, corpseHarvestView(['hide', 'tusk', 'meat'], new Set()), {
      onHarvest,
      attachTooltip: () => {},
    });
    expect(mixed.querySelector('.corpse-harvest')).not.toBeNull();
    expect(mixed.querySelectorAll('.corpse-harvest-check')).toHaveLength(3);
  });

  it('refuses the section on the view model FIELD, not on the tag list it came from', () => {
    // The painter reads `corpseHarvestable`, so a caller that hands it a model
    // built some other way still gets the refusal. Rows are non-empty here, so
    // the pre-existing `rows.length === 0` early return cannot be what fires:
    // the two arms are pinned apart.
    const container = document.createElement('div');
    renderCorpseHarvestPicker(
      container,
      view({ rows: [{ tag: 'hide', checked: false }], corpseHarvestable: false }),
      { onHarvest: () => {}, attachTooltip: () => {} },
    );
    expect(container.querySelector('.corpse-harvest')).toBeNull();
    // Same rows, field flipped: the section appears. Without this the assertion
    // above would pass against a painter that never drew anything.
    const on = document.createElement('div');
    renderCorpseHarvestPicker(
      on,
      view({ rows: [{ tag: 'hide', checked: false }], corpseHarvestable: true }),
      { onHarvest: () => {}, attachTooltip: () => {} },
    );
    expect(on.querySelector('.corpse-harvest')).not.toBeNull();
  });

  it('still submits on a MIXED corpse carrying the same unmapped families', () => {
    // The discriminator for the case above: wild_boar's real tags carry tusk
    // beside hide and meat, so the button lives and the pick goes through.
    const t = render(['hide', 'tusk', 'meat'], []);
    expect(t.btn.disabled).toBe(false);
    t.toggle('tusk');
    // tusk alone forfeits every yield: that is the #2509 arm, with its line.
    expect(t.btn.disabled).toBe(true);
    expect(t.warning.hidden).toBe(false);
    t.toggle('hide');
    expect(t.btn.disabled).toBe(false);
    expect(t.warning.hidden).toBe(true);
    t.btn.click();
    expect(t.onHarvest).toHaveBeenLastCalledWith(['hide', 'tusk']);
  });

  it('registers the tooltip exactly once, however many times the selection changes', () => {
    // Hud.attachTooltip binds a fresh listener set per call, so re-attaching
    // per toggle would stack them silently.
    const t = render(GREYJAW, ['hide']);
    t.toggle('hide');
    t.toggle('claw');
    t.toggle('claw');
    expect(t.attachTooltip.mock.calls.filter(([target]) => target === t.btn)).toHaveLength(1);
  });
});
