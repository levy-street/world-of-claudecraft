// @vitest-environment happy-dom
//
// Behavioral tests for the per-material Sources disclosure wired into the
// persistent gathering goal panel (Intentional Gathering PR5:
// src/ui/hud/professions/gathering_goal_painter.ts +
// gathering_source_painter.ts/gathering_source_view.ts, reused unmodified).
// Covers: the disclosure appears only for a material with a real known
// source, real rendered hints with no raw internal ids, native disclosure
// semantics never fire a preference/goal callback, and the open/focus state
// of a disclosure survives a rebuild.

import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import {
  type GatheringGoalPanelDeps,
  renderGatheringGoalPanel,
} from '../src/ui/hud/professions/gathering_goal_painter';
import type {
  GatheringGoalMaterialRow,
  GatheringGoalPanelModel,
} from '../src/ui/hud/professions/gathering_goal_view';

function baseModel(overrides: Partial<GatheringGoalPanelModel> = {}): GatheringGoalPanelModel {
  return {
    goal: { kind: 'recipe', recipeId: 'recipe_iron_pick', count: 3 },
    status: 'collecting',
    reason: null,
    resultItemId: 'iron_pick',
    result: undefined,
    craftCount: 3,
    displayCount: 3,
    materials: [],
    payableCrafts: 0,
    storageRestricted: false,
    ...overrides,
  };
}

function deps(overrides: Partial<GatheringGoalPanelDeps> = {}): GatheringGoalPanelDeps {
  return {
    onClearGoal: () => {},
    onSetHarvestPreference: () => {},
    ...overrides,
  };
}

function mount(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

function materialRow(overrides: Partial<GatheringGoalMaterialRow>): GatheringGoalMaterialRow {
  return {
    itemId: 'rough_hide',
    item: undefined,
    required: 10,
    carried: 2,
    stored: 3,
    reachable: 5,
    missing: 5,
    inaccessible: 0,
    satisfied: false,
    sourceFamilyId: 'corpseHarvesting',
    corpsePreferenceItemId: 'rough_hide',
    isCurrentHarvestPreference: false,
    ...overrides,
  };
}

describe('gathering goal Sources disclosure: presence gated on a real known source', () => {
  it('adds a closed Sources disclosure for a corpse-harvest material (rough_hide)', () => {
    const el = mount();
    renderGatheringGoalPanel(
      el,
      baseModel({ materials: [materialRow({ itemId: 'rough_hide' })] }),
      deps(),
    );
    const details = el.querySelector<HTMLDetailsElement>('.gathering-goal-source');
    expect(details).not.toBeNull();
    expect(details?.hasAttribute('open')).toBe(false);
    expect(details?.querySelector('summary')?.textContent).toBe('Sources');
  });

  it('adds a Sources disclosure for a node material (copper_ore)', () => {
    const el = mount();
    renderGatheringGoalPanel(
      el,
      baseModel({
        materials: [
          materialRow({
            itemId: 'copper_ore',
            sourceFamilyId: 'mining',
            corpsePreferenceItemId: null,
          }),
        ],
      }),
      deps(),
    );
    expect(el.querySelector('.gathering-goal-source')).not.toBeNull();
  });

  it('adds a Sources disclosure for a farm material (vale_wheat)', () => {
    const el = mount();
    renderGatheringGoalPanel(
      el,
      baseModel({
        materials: [
          materialRow({
            itemId: 'vale_wheat',
            sourceFamilyId: 'farming',
            corpsePreferenceItemId: null,
          }),
        ],
      }),
      deps(),
    );
    expect(el.querySelector('.gathering-goal-source')).not.toBeNull();
  });

  it('adds a Sources disclosure for a fishing material (raw_mirror_trout)', () => {
    const el = mount();
    renderGatheringGoalPanel(
      el,
      baseModel({
        materials: [
          materialRow({
            itemId: 'raw_mirror_trout',
            sourceFamilyId: 'fishing',
            corpsePreferenceItemId: null,
          }),
        ],
      }),
      deps(),
    );
    expect(el.querySelector('.gathering-goal-source')).not.toBeNull();
  });

  it('renders NO Sources disclosure at all for a material no gathering family supplies (never an empty action)', () => {
    const el = mount();
    renderGatheringGoalPanel(
      el,
      baseModel({
        materials: [
          materialRow({
            itemId: 'tangled_weed',
            sourceFamilyId: null,
            corpsePreferenceItemId: null,
          }),
        ],
      }),
      deps(),
    );
    expect(el.querySelector('.gathering-goal-source')).toBeNull();
  });
});

describe('gathering goal Sources disclosure: accessible name names the material', () => {
  it('gives two material rows distinct localized aria-labels naming each material, never a raw item id', () => {
    const el = mount();
    renderGatheringGoalPanel(
      el,
      baseModel({
        materials: [
          materialRow({ itemId: 'rough_hide', item: ITEMS.rough_hide }),
          materialRow({
            itemId: 'copper_ore',
            item: ITEMS.copper_ore,
            sourceFamilyId: 'mining',
            corpsePreferenceItemId: null,
          }),
        ],
      }),
      deps(),
    );
    const summaries = [...el.querySelectorAll<HTMLElement>('.gathering-goal-source > summary')];
    expect(summaries).toHaveLength(2);
    const labels = summaries.map((s) => s.getAttribute('aria-label'));
    expect(labels[0]).not.toBeNull();
    expect(labels[1]).not.toBeNull();
    expect(labels[0]).not.toBe(labels[1]);
    for (const label of labels) {
      expect(label).toMatch(/^Sources for /);
      expect(label).not.toContain('rough_hide');
      expect(label).not.toContain('copper_ore');
    }
    // Visible text stays the short shared label; only the accessible name
    // carries the per-row material context.
    for (const summary of summaries) {
      expect(summary.textContent).toBe('Sources');
    }
  });
});

describe('gathering goal Sources disclosure: real rendered content, no raw ids', () => {
  it('expanding shows real creature/zone hints for a corpse material, never the raw mob or zone id', () => {
    const el = mount();
    renderGatheringGoalPanel(
      el,
      baseModel({ materials: [materialRow({ itemId: 'rough_hide' })] }),
      deps(),
    );
    const body = el.querySelector('.gathering-goal-source-body');
    expect(body).not.toBeNull();
    const text = body?.textContent ?? '';
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toContain('forest_wolf');
    expect(text).not.toContain('eastbrook_vale');
    expect(text).not.toContain('rough_hide');
  });

  it('expanding a farm material states real crop requirements (skill/hoe tier), never a raw internal id', () => {
    const el = mount();
    renderGatheringGoalPanel(
      el,
      baseModel({
        materials: [
          materialRow({
            itemId: 'vale_wheat',
            sourceFamilyId: 'farming',
            corpsePreferenceItemId: null,
          }),
        ],
      }),
      deps(),
    );
    const text = el.querySelector('.gathering-goal-source-body')?.textContent ?? '';
    expect(text).toMatch(/farming skill/i);
    expect(text).toMatch(/hoe/i);
    expect(text).not.toContain('vale_wheat');
  });

  it('expanding a specimen row names the base material honestly, never a separate guaranteed find', () => {
    const el = mount();
    renderGatheringGoalPanel(
      el,
      baseModel({
        materials: [
          materialRow({
            itemId: 'pristine_hide',
            sourceFamilyId: 'corpseHarvesting',
            corpsePreferenceItemId: null,
          }),
        ],
      }),
      deps(),
    );
    const text = el.querySelector('.gathering-goal-source-body')?.textContent ?? '';
    expect(text).toMatch(/rare or better/i);
    expect(text).not.toContain('pristine_hide');
  });
});

describe('gathering goal Sources disclosure: opening never fires a goal/preference callback', () => {
  it('toggling a disclosure open (native, no click handler wired) calls neither onClearGoal nor onSetHarvestPreference', () => {
    const d = deps({
      onClearGoal: () => {
        throw new Error('onClearGoal must never fire from opening a Sources disclosure');
      },
      onSetHarvestPreference: () => {
        throw new Error('onSetHarvestPreference must never fire from opening a Sources disclosure');
      },
    });
    const el = mount();
    renderGatheringGoalPanel(
      el,
      baseModel({ materials: [materialRow({ itemId: 'rough_hide' })] }),
      d,
    );
    const details = el.querySelector<HTMLDetailsElement>('.gathering-goal-source');
    expect(details).not.toBeNull();
    // Simulates the player's own disclosure toggle: native browser behavior,
    // no synthetic click dispatch needed since no listener is ever attached.
    details!.open = true;
    expect(details!.open).toBe(true);
  });
});

describe('gathering goal Sources disclosure: survives a rebuild', () => {
  it('keeps a disclosure open across a repaint when the same reagent still exists', () => {
    const el = mount();
    const model = baseModel({ materials: [materialRow({ itemId: 'rough_hide' })] });
    renderGatheringGoalPanel(el, model, deps());
    const details = el.querySelector<HTMLDetailsElement>('.gathering-goal-source');
    details!.open = true;

    // A rebuild the player's own action would trigger (e.g. setting a
    // harvest preference), modeled here as a repaint with a changed row.
    renderGatheringGoalPanel(
      el,
      baseModel({
        materials: [materialRow({ itemId: 'rough_hide', isCurrentHarvestPreference: true })],
      }),
      deps(),
    );
    const after = el.querySelector<HTMLDetailsElement>('.gathering-goal-source');
    expect(after?.open).toBe(true);
  });

  it('does not throw and simply omits the entry when the previously-expanded reagent no longer appears', () => {
    const el = mount();
    renderGatheringGoalPanel(
      el,
      baseModel({ materials: [materialRow({ itemId: 'rough_hide' })] }),
      deps(),
    );
    el.querySelector<HTMLDetailsElement>('.gathering-goal-source')!.open = true;

    expect(() =>
      renderGatheringGoalPanel(
        el,
        baseModel({
          materials: [
            materialRow({
              itemId: 'copper_ore',
              sourceFamilyId: 'mining',
              corpsePreferenceItemId: null,
            }),
          ],
        }),
        deps(),
      ),
    ).not.toThrow();
    const details = el.querySelector<HTMLDetailsElement>('.gathering-goal-source');
    // A fresh row for a different material: never inherits the old open state.
    expect(details?.open).toBe(false);
  });

  it('keeps keyboard focus on the Sources summary across a repaint', () => {
    const el = mount();
    renderGatheringGoalPanel(
      el,
      baseModel({ materials: [materialRow({ itemId: 'rough_hide' })] }),
      deps(),
    );
    const summary = el.querySelector<HTMLElement>('.gathering-goal-source > summary');
    summary?.focus();
    expect(document.activeElement).toBe(summary);

    renderGatheringGoalPanel(
      el,
      baseModel({
        materials: [materialRow({ itemId: 'rough_hide', isCurrentHarvestPreference: true })],
      }),
      deps(),
    );
    const after = el.querySelector<HTMLElement>('.gathering-goal-source > summary');
    expect(document.activeElement).toBe(after);
  });
});

describe('gathering goal Sources disclosure: Set/Clear controls are unaffected', () => {
  it('the harvest-preference Set button still fires exactly once, independent of any Sources disclosure', () => {
    let calls = 0;
    const el = mount();
    renderGatheringGoalPanel(
      el,
      baseModel({ materials: [materialRow({ itemId: 'rough_hide' })] }),
      deps({
        onSetHarvestPreference: () => {
          calls += 1;
        },
      }),
    );
    el.querySelector<HTMLButtonElement>('[data-set-pref]')?.click();
    expect(calls).toBe(1);
  });

  it('Clear still fires exactly once with a Sources disclosure present on the panel', () => {
    let calls = 0;
    const el = mount();
    renderGatheringGoalPanel(
      el,
      baseModel({ materials: [materialRow({ itemId: 'rough_hide' })] }),
      deps({
        onClearGoal: () => {
          calls += 1;
        },
      }),
    );
    el.querySelector<HTMLButtonElement>('[data-clear]')?.click();
    expect(calls).toBe(1);
  });
});
