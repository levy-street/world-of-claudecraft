// @vitest-environment happy-dom
//
// Behavioral tests for the gathering goal panel painter
// (src/ui/hud/professions/gathering_goal_painter.ts, Intentional Gathering
// PR4): callback wiring (exactly once, only on the real action), the
// tracking/rendering-never-invokes-preference contract, and focus carry
// across a rebuild.

import { describe, expect, it, vi } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { itemDisplayName } from '../src/ui/entity_i18n';
import {
  type GatheringGoalPanelDeps,
  renderGatheringGoalPanel,
} from '../src/ui/hud/professions/gathering_goal_painter';
import type { GatheringGoalPanelModel } from '../src/ui/hud/professions/gathering_goal_view';

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
    onClearGoal: vi.fn<GatheringGoalPanelDeps['onClearGoal']>(),
    onSetHarvestPreference: vi.fn<GatheringGoalPanelDeps['onSetHarvestPreference']>(),
    ...overrides,
  };
}

function mount(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

describe('renderGatheringGoalPanel: no goal', () => {
  it('hides the panel and clears its content on TRUE no-selection (goal null, reason null)', () => {
    const el = mount();
    el.innerHTML = '<span>stale</span>';
    renderGatheringGoalPanel(
      el,
      baseModel({
        goal: null,
        reason: null,
        resultItemId: null,
        craftCount: null,
        displayCount: null,
      }),
      deps(),
    );
    expect(el.style.display).toBe('none');
    expect(el.innerHTML).toBe('');
  });

  it('an INVALID persisted selection (goal null, reason set) still renders: explanation plus Clear', () => {
    const el = mount();
    const model = baseModel({
      goal: null,
      status: 'unavailable',
      reason: 'invalid_goal',
      resultItemId: null,
      result: undefined,
      craftCount: null,
      displayCount: null,
      materials: [],
    });
    renderGatheringGoalPanel(el, model, deps());
    // Visible, not hidden: this is NOT the true-empty case.
    expect(el.style.display).toBe('flex');
    expect(el.innerHTML).not.toBe('');
    expect(el.querySelector('.gathering-goal-reason')?.textContent).toBe(
      'This goal is no longer valid.',
    );
    const clearBtn = el.querySelector<HTMLButtonElement>('[data-clear]');
    expect(clearBtn).not.toBeNull();
    const d = deps();
    renderGatheringGoalPanel(el, model, d);
    el.querySelector<HTMLButtonElement>('[data-clear]')?.click();
    expect(d.onClearGoal).toHaveBeenCalledTimes(1);
  });

  it('the invalid-selection header shows a generic label, never a raw internal token', () => {
    const el = mount();
    renderGatheringGoalPanel(
      el,
      baseModel({
        goal: null,
        status: 'unavailable',
        reason: 'invalid_goal',
        resultItemId: null,
        result: undefined,
        craftCount: null,
        displayCount: null,
        materials: [],
      }),
      deps(),
    );
    expect(el.querySelector('.gathering-goal-title')?.textContent).toBe('No longer tracked');
  });
});

describe('renderGatheringGoalPanel: rendering never invokes tracking or preference callbacks', () => {
  it('a plain repaint with materials calls neither onClearGoal nor onSetHarvestPreference', () => {
    const d = deps();
    const el = mount();
    renderGatheringGoalPanel(
      el,
      baseModel({
        materials: [
          {
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
          },
        ],
      }),
      d,
    );
    expect(d.onClearGoal).not.toHaveBeenCalled();
    expect(d.onSetHarvestPreference).not.toHaveBeenCalled();
    expect(el.style.display).toBe('flex');
  });
});

describe('renderGatheringGoalPanel: exact mixed storage/shortfall/ready statuses', () => {
  it('a fully-reachable row reads satisfied with no missing/inaccessible callouts', () => {
    const el = mount();
    renderGatheringGoalPanel(
      el,
      baseModel({
        status: 'ready',
        materials: [
          {
            itemId: 'iron_ore',
            item: undefined,
            required: 5,
            carried: 5,
            stored: 0,
            reachable: 5,
            missing: 0,
            inaccessible: 0,
            satisfied: true,
            sourceFamilyId: 'mining',
            corpsePreferenceItemId: null,
            isCurrentHarvestPreference: false,
          },
        ],
      }),
      deps(),
    );
    const row = el.querySelector('.gathering-goal-material');
    expect(row?.classList.contains('satisfied')).toBe(true);
    expect(el.textContent).not.toMatch(/missing/i);
    expect(el.querySelector('[data-set-pref]')).toBeNull();
  });

  it('a mixed shortfall-plus-inaccessible row reports BOTH counts and is not satisfied', () => {
    const el = mount();
    renderGatheringGoalPanel(
      el,
      baseModel({
        status: 'unavailable',
        reason: null,
        materials: [
          {
            itemId: 'rough_hide',
            item: undefined,
            required: 10,
            carried: 2,
            stored: 3,
            reachable: 4,
            missing: 6,
            inaccessible: 1,
            satisfied: false,
            sourceFamilyId: 'corpseHarvesting',
            corpsePreferenceItemId: 'rough_hide',
            isCurrentHarvestPreference: false,
          },
        ],
      }),
      deps(),
    );
    const row = el.querySelector('.gathering-goal-material');
    expect(row?.classList.contains('satisfied')).toBe(false);
    expect(el.textContent).toMatch(/6/);
    expect(el.textContent).toMatch(/1/);
  });

  it('storageRestricted renders its own note; a non-restricted goal renders none', () => {
    const restricted = mount();
    renderGatheringGoalPanel(restricted, baseModel({ storageRestricted: true }), deps());
    expect(restricted.querySelector('.gathering-goal-storage-note')).not.toBeNull();

    const unrestricted = mount();
    renderGatheringGoalPanel(unrestricted, baseModel({ storageRestricted: false }), deps());
    expect(unrestricted.querySelector('.gathering-goal-storage-note')).toBeNull();
  });

  it('the ready hint never implies gold, station, or bag-space guarantees are met', () => {
    const el = mount();
    renderGatheringGoalPanel(el, baseModel({ status: 'ready' }), deps());
    const hint = el.querySelector('.gathering-goal-ready-hint');
    expect(hint).not.toBeNull();
    // Present as a caveat, not omitted: the ready state must not read as an
    // unconditional delivery promise.
    expect(hint?.textContent ?? '').toMatch(/gold|station|bag/i);
  });
});

describe('renderGatheringGoalPanel: carried/stored counts and source family labels are rendered', () => {
  it('renders exact carried and stored counts on every row, not just reachable/required', () => {
    const el = mount();
    renderGatheringGoalPanel(
      el,
      baseModel({
        materials: [
          {
            itemId: 'iron_ore',
            item: undefined,
            required: 12,
            carried: 3,
            stored: 4,
            reachable: 5,
            missing: 7,
            inaccessible: 0,
            satisfied: false,
            sourceFamilyId: 'mining',
            corpsePreferenceItemId: null,
            isCurrentHarvestPreference: false,
          },
        ],
      }),
      deps(),
    );
    const line = el.querySelector('.gathering-goal-material-line')?.textContent ?? '';
    expect(line).toContain('5 of 12');
    expect(line).toMatch(/3 carried/);
    expect(line).toMatch(/4 in storage/);
  });

  it('renders carried/stored even when both are zero (never omitted as "nothing to say")', () => {
    const el = mount();
    renderGatheringGoalPanel(
      el,
      baseModel({
        materials: [
          {
            itemId: 'iron_ore',
            item: undefined,
            required: 5,
            carried: 0,
            stored: 0,
            reachable: 0,
            missing: 5,
            inaccessible: 0,
            satisfied: false,
            sourceFamilyId: 'mining',
            corpsePreferenceItemId: null,
            isCurrentHarvestPreference: false,
          },
        ],
      }),
      deps(),
    );
    const line = el.querySelector('.gathering-goal-material-line')?.textContent ?? '';
    expect(line).toMatch(/0 carried/);
    expect(line).toMatch(/0 in storage/);
  });

  it('renders the localized source family name per material (mining, corpse harvesting)', () => {
    const el = mount();
    renderGatheringGoalPanel(
      el,
      baseModel({
        materials: [
          {
            itemId: 'iron_ore',
            item: undefined,
            required: 5,
            carried: 5,
            stored: 0,
            reachable: 5,
            missing: 0,
            inaccessible: 0,
            satisfied: true,
            sourceFamilyId: 'mining',
            corpsePreferenceItemId: null,
            isCurrentHarvestPreference: false,
          },
          {
            itemId: 'rough_hide',
            item: undefined,
            required: 5,
            carried: 5,
            stored: 0,
            reachable: 5,
            missing: 0,
            inaccessible: 0,
            satisfied: true,
            sourceFamilyId: 'corpseHarvesting',
            corpsePreferenceItemId: 'rough_hide',
            isCurrentHarvestPreference: false,
          },
        ],
      }),
      deps(),
    );
    const familyLabels = [...el.querySelectorAll('.gathering-goal-material-family')].map(
      (n) => n.textContent,
    );
    expect(familyLabels).toEqual(['Mining', 'Corpse Harvesting']);
  });

  it('renders no family chip for a material no gathering family supplies', () => {
    const el = mount();
    renderGatheringGoalPanel(
      el,
      baseModel({
        materials: [
          {
            itemId: 'gold_coin',
            item: undefined,
            required: 1,
            carried: 0,
            stored: 0,
            reachable: 0,
            missing: 1,
            inaccessible: 0,
            satisfied: false,
            sourceFamilyId: null,
            corpsePreferenceItemId: null,
            isCurrentHarvestPreference: false,
          },
        ],
      }),
      deps(),
    );
    expect(el.querySelector('.gathering-goal-material-family')).toBeNull();
  });
});

describe('renderGatheringGoalPanel: unknown item ids never leak a raw internal token', () => {
  it('a material row with no resolved ItemDef shows the translated unavailable-material label, never the itemId', () => {
    const el = mount();
    renderGatheringGoalPanel(
      el,
      baseModel({
        materials: [
          {
            itemId: 'some_internal_row_token_42',
            item: undefined,
            required: 5,
            carried: 0,
            stored: 0,
            reachable: 0,
            missing: 5,
            inaccessible: 0,
            satisfied: false,
            sourceFamilyId: null,
            corpsePreferenceItemId: null,
            isCurrentHarvestPreference: false,
          },
        ],
      }),
      deps(),
    );
    const line = el.querySelector('.gathering-goal-material-line')?.textContent ?? '';
    expect(line).toContain('Unavailable material');
    expect(line).not.toContain('some_internal_row_token_42');
  });

  it('an unresolved result shows the generic unknown-recipe label, never a raw itemId', () => {
    const el = mount();
    renderGatheringGoalPanel(
      el,
      baseModel({ result: undefined, resultItemId: null, craftCount: null, displayCount: null }),
      deps(),
    );
    const title = el.querySelector('.gathering-goal-title')?.textContent ?? '';
    expect(title).toBe('Unknown recipe');
    expect(title).not.toContain('iron_pick');
  });
});

describe('renderGatheringGoalPanel: multi-output recipe label + craft count line', () => {
  // A real shipped item (iron_ore) so itemDisplayName resolves through the
  // real entity-i18n catalog rather than an unregistered fake id.
  const realItem = ITEMS.iron_ore;
  const realName = itemDisplayName(realItem);

  it('shows the TOTAL OUTPUT in the title and a separate crafts-tracked line when resultCount > 1', () => {
    const el = mount();
    renderGatheringGoalPanel(
      el,
      baseModel({ result: realItem, craftCount: 7, displayCount: 35 }),
      deps(),
    );
    const title = el.querySelector('.gathering-goal-title')?.textContent ?? '';
    expect(title).toBe(`${realName} x35`);
    expect(el.querySelector('.gathering-goal-craft-count')?.textContent).toBe('7 crafts tracked');
  });

  it('omits the crafts-tracked line when craftCount already equals the displayed output', () => {
    const el = mount();
    renderGatheringGoalPanel(
      el,
      baseModel({ result: realItem, craftCount: 3, displayCount: 3 }),
      deps(),
    );
    expect(el.querySelector('.gathering-goal-craft-count')).toBeNull();
  });
});

describe('renderGatheringGoalPanel: header layout keeps the Clear button short-labeled but fully accessible', () => {
  it('the Clear button shows a short visible label while keeping the full sentence as its aria-label', () => {
    const el = mount();
    renderGatheringGoalPanel(el, baseModel(), deps());
    const btn = el.querySelector<HTMLButtonElement>('[data-clear]');
    expect(btn?.textContent).toBe('Clear');
    expect(btn?.getAttribute('aria-label')).toBe('Clear gathering goal');
  });

  it('the status badge and Clear button share a row separate from the title', () => {
    const el = mount();
    renderGatheringGoalPanel(el, baseModel(), deps());
    const controls = el.querySelector('.gathering-goal-header-controls');
    expect(controls?.querySelector('.gathering-goal-status')).not.toBeNull();
    expect(controls?.querySelector('[data-clear]')).not.toBeNull();
    expect(controls?.querySelector('.gathering-goal-title')).toBeNull();
  });
});

describe('renderGatheringGoalPanel: material meta row (family badge + preference button)', () => {
  it('renders the family badge and preference button together in one meta row, separate from the material text', () => {
    const el = mount();
    renderGatheringGoalPanel(
      el,
      baseModel({
        materials: [
          {
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
          },
        ],
      }),
      deps(),
    );
    const meta = el.querySelector('.gathering-goal-material-meta');
    expect(meta?.querySelector('.gathering-goal-material-family')).not.toBeNull();
    expect(meta?.querySelector('[data-set-pref]')).not.toBeNull();
  });

  it('omits the meta row entirely when a material has neither a family badge nor a preference shortcut', () => {
    const el = mount();
    renderGatheringGoalPanel(
      el,
      baseModel({
        materials: [
          {
            itemId: 'gold_coin',
            item: undefined,
            required: 1,
            carried: 0,
            stored: 0,
            reachable: 0,
            missing: 1,
            inaccessible: 0,
            satisfied: false,
            sourceFamilyId: null,
            corpsePreferenceItemId: null,
            isCurrentHarvestPreference: false,
          },
        ],
      }),
      deps(),
    );
    expect(el.querySelector('.gathering-goal-material-meta')).toBeNull();
  });
});

describe('renderGatheringGoalPanel: corrected copy', () => {
  it('the inaccessible-count line never claims every unit is in storage (also covers locked carried slots)', () => {
    const el = mount();
    renderGatheringGoalPanel(
      el,
      baseModel({
        materials: [
          {
            itemId: 'rough_hide',
            item: undefined,
            required: 10,
            carried: 2,
            stored: 3,
            reachable: 4,
            missing: 6,
            inaccessible: 1,
            satisfied: false,
            sourceFamilyId: 'corpseHarvesting',
            corpsePreferenceItemId: 'rough_hide',
            isCurrentHarvestPreference: false,
          },
        ],
      }),
      deps(),
    );
    const line = el.querySelector('.gathering-goal-material-line')?.textContent ?? '';
    expect(line).toContain('1 unavailable for crafting');
    expect(line).not.toMatch(/in storage you cannot reach/i);
  });

  it('the commission-unavailable reason tells the player to re-track from the board, never that the order is gone', () => {
    const el = mount();
    renderGatheringGoalPanel(
      el,
      baseModel({
        goal: null,
        status: 'unavailable',
        reason: 'commission_unavailable',
        resultItemId: null,
        result: undefined,
        craftCount: null,
        displayCount: null,
        materials: [],
      }),
      deps(),
    );
    const reason = el.querySelector('.gathering-goal-reason')?.textContent ?? '';
    expect(reason).toMatch(/track it again/i);
    expect(reason).not.toMatch(/no longer available to accept/i);
  });
});

describe('renderGatheringGoalPanel: current-harvest-preference selected state', () => {
  it('isCurrentHarvestPreference true renders readable selected text, is disabled, and never dispatches on click', () => {
    const d = deps();
    const el = mount();
    renderGatheringGoalPanel(
      el,
      baseModel({
        materials: [
          {
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
            isCurrentHarvestPreference: true,
          },
        ],
      }),
      d,
    );
    const btn = el.querySelector<HTMLButtonElement>('[data-set-pref]');
    expect(btn?.textContent).toBe('Current harvest preference');
    expect(btn?.disabled).toBe(true);
    expect(btn?.getAttribute('aria-disabled')).toBe('true');
    btn?.click();
    expect(d.onSetHarvestPreference).not.toHaveBeenCalled();
  });

  it('false (and missing/undefined) keeps the explicit Set action enabled and clickable', () => {
    const d = deps();
    const el = mount();
    renderGatheringGoalPanel(
      el,
      baseModel({
        materials: [
          {
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
          },
        ],
      }),
      d,
    );
    const btn = el.querySelector<HTMLButtonElement>('[data-set-pref]');
    expect(btn?.textContent).toBe('Set as harvest preference');
    expect(btn?.disabled).toBe(false);
    btn?.click();
    expect(d.onSetHarvestPreference).toHaveBeenCalledTimes(1);
    expect(d.onSetHarvestPreference).toHaveBeenCalledWith('rough_hide');
  });
});

describe('renderGatheringGoalPanel: explicit actions fire exactly once', () => {
  it('clicking Clear calls onClearGoal exactly once', () => {
    const d = deps();
    const el = mount();
    renderGatheringGoalPanel(el, baseModel(), d);
    const btn = el.querySelector<HTMLButtonElement>('[data-clear]');
    expect(btn).not.toBeNull();
    btn?.click();
    expect(d.onClearGoal).toHaveBeenCalledTimes(1);
    expect(d.onSetHarvestPreference).not.toHaveBeenCalled();
  });

  it('clicking a row’s harvest-preference shortcut calls onSetHarvestPreference exactly once with that row’s target', () => {
    const d = deps();
    const el = mount();
    renderGatheringGoalPanel(
      el,
      baseModel({
        materials: [
          {
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
          },
          {
            itemId: 'iron_ore',
            item: undefined,
            required: 5,
            carried: 5,
            stored: 0,
            reachable: 5,
            missing: 0,
            inaccessible: 0,
            satisfied: true,
            sourceFamilyId: 'mining',
            corpsePreferenceItemId: null,
            isCurrentHarvestPreference: false,
          },
        ],
      }),
      d,
    );
    const prefButtons = el.querySelectorAll<HTMLButtonElement>('[data-set-pref]');
    // Only the corpse row offers the shortcut; the mining row never does.
    expect(prefButtons).toHaveLength(1);
    prefButtons[0].click();
    expect(d.onSetHarvestPreference).toHaveBeenCalledTimes(1);
    expect(d.onSetHarvestPreference).toHaveBeenCalledWith('rough_hide');
    expect(d.onClearGoal).not.toHaveBeenCalled();
  });
});

describe('renderGatheringGoalPanel: focus carry across a rebuild', () => {
  it('keeps the Clear button focused across a repaint with the same goal', () => {
    const el = mount();
    renderGatheringGoalPanel(el, baseModel(), deps());
    const before = el.querySelector<HTMLButtonElement>('[data-clear]');
    before?.focus();
    expect(document.activeElement).toBe(before);
    renderGatheringGoalPanel(el, baseModel({ status: 'ready' }), deps());
    const after = el.querySelector<HTMLButtonElement>('[data-clear]');
    expect(document.activeElement).toBe(after);
  });

  it('drops focus cleanly when the goal is cleared out from under an open panel', () => {
    const el = mount();
    renderGatheringGoalPanel(el, baseModel(), deps());
    el.querySelector<HTMLButtonElement>('[data-clear]')?.focus();
    renderGatheringGoalPanel(el, baseModel({ goal: null }), deps());
    expect(el.innerHTML).toBe('');
    expect(el.style.display).toBe('none');
  });
});
