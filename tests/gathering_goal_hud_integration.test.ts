// @vitest-environment happy-dom
//
// Integration coverage for the HUD-side gathering goal coordinator
// (src/ui/hud/professions/gathering_goal_controller.ts, Intentional
// Gathering PR4): the signature-gated repaint (an unchanged goal must never
// touch the DOM, so a player's focus/scroll survives an ordinary poll), the
// explicit-action wrappers (Track/Track commission/Clear each call through
// to the world and repaint immediately), the one preference write, and the
// HUD-held per-recipe goal-quantity map the crafting window's Track control
// reads/writes through this same controller.

import { describe, expect, it, vi } from 'vitest';
import type { GatheringGoalView } from '../src/sim/professions/gathering_goal_types';
import type { HarvestPreference } from '../src/sim/professions/harvest_preference';
import {
  GatheringGoalController,
  type GatheringGoalWorld,
} from '../src/ui/hud/professions/gathering_goal_controller';

// `GatheringGoalWorld` is `Pick<IWorld, ...>`, so `gatheringGoal` carries
// IWorld's own `readonly`. This fake mutates it directly between calls (the
// cheapest way to simulate the sim's read model changing under the
// controller), so the test double strips that one modifier; the real
// `Sim`/`ClientWorld` never assign through this type at all.
type MutableGatheringGoalWorld = {
  -readonly [K in keyof GatheringGoalWorld]: GatheringGoalWorld[K];
};

function fakeWorld(
  goal: GatheringGoalView | null = null,
  harvestPreference: HarvestPreference | null = null,
) {
  return {
    gatheringGoal: goal,
    harvestPreference,
    trackGatheringRecipe: vi.fn<GatheringGoalWorld['trackGatheringRecipe']>(),
    trackGatheringCommission: vi.fn<GatheringGoalWorld['trackGatheringCommission']>(),
    clearGatheringGoal: vi.fn<GatheringGoalWorld['clearGatheringGoal']>(),
    setHarvestPreference: vi.fn<GatheringGoalWorld['setHarvestPreference']>(),
  } satisfies MutableGatheringGoalWorld;
}

const RECIPE_GOAL: GatheringGoalView = {
  goal: { kind: 'recipe', recipeId: 'recipe_iron_pick', count: 3 },
  status: 'collecting',
  reason: null,
  materials: [
    {
      itemId: 'iron_ore',
      required: 5,
      carried: 2,
      stored: 0,
      reachable: 2,
      missing: 3,
      inaccessible: 0,
    },
  ],
  payableCrafts: 0,
  storageRestricted: false,
};

const CORPSE_GOAL: GatheringGoalView = {
  goal: { kind: 'recipe', recipeId: 'recipe_iron_pick', count: 1 },
  status: 'collecting',
  reason: null,
  materials: [
    {
      itemId: 'rough_hide',
      required: 5,
      carried: 0,
      stored: 0,
      reachable: 0,
      missing: 5,
      inaccessible: 0,
    },
  ],
  payableCrafts: 0,
  storageRestricted: false,
};

function mount(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

/** Mounts the tracker root exactly as the live HUD entries do
 *  (index.html/play.html): a `#gathering-goal-body` child the painter must
 *  repaint into, plus a sibling frame-chrome node (the interface-unlock
 *  corner move button `movable_frame.ts` appends once a frame joins
 *  HUD_FRAME_SPECS: `.tf-move-btn`) that a repaint must never destroy. */
function mountLive(): { root: HTMLElement; body: HTMLElement; chrome: HTMLElement } {
  const root = document.createElement('div');
  root.id = 'gathering-goal-tracker';
  const chrome = document.createElement('button');
  chrome.type = 'button';
  chrome.className = 'tf-move-btn';
  root.appendChild(chrome);
  const body = document.createElement('div');
  body.id = 'gathering-goal-body';
  root.appendChild(body);
  document.body.appendChild(root);
  return { root, body, chrome };
}

describe('GatheringGoalController: signature-gated repaint', () => {
  it('a null goal hides the panel and touches the DOM only once for repeated no-op updates', () => {
    const element = mount();
    const world = fakeWorld(null);
    const controller = new GatheringGoalController({ element, world: () => world });
    controller.update();
    expect(element.style.display).toBe('none');
    expect(element.innerHTML).toBe('');
    // A second update with the SAME (still null) goal must not re-run the
    // painter at all: capture nothing to mutate, then assert nothing changed
    // by construction (innerHTML stays '').
    controller.update();
    expect(element.innerHTML).toBe('');
  });

  it('an unchanged goal across repeated update() calls never rebuilds the DOM (focus/scroll survive)', () => {
    const element = mount();
    const world = fakeWorld(RECIPE_GOAL);
    const controller = new GatheringGoalController({ element, world: () => world });
    controller.update();
    const clearBtnBefore = element.querySelector<HTMLButtonElement>('[data-clear]');
    expect(clearBtnBefore).not.toBeNull();
    clearBtnBefore?.focus();
    expect(document.activeElement).toBe(clearBtnBefore);

    // A second update with a STRUCTURALLY IDENTICAL (but not reference-equal)
    // goal object: the signature is JSON-based, so this must still early-return.
    world.gatheringGoal = JSON.parse(JSON.stringify(RECIPE_GOAL));
    controller.update();

    const clearBtnAfter = element.querySelector('[data-clear]');
    // Same node instance: the DOM was never rebuilt, so identity AND focus survive.
    expect(clearBtnAfter).toBe(clearBtnBefore);
    expect(document.activeElement).toBe(clearBtnBefore);
  });

  it('a real change (materials shift) DOES rebuild, and the painter carries focus to the equivalent control', () => {
    const element = mount();
    const world = fakeWorld(RECIPE_GOAL);
    const controller = new GatheringGoalController({ element, world: () => world });
    controller.update();
    element.querySelector<HTMLButtonElement>('[data-clear]')?.focus();

    world.gatheringGoal = {
      ...RECIPE_GOAL,
      status: 'ready',
      materials: [{ ...RECIPE_GOAL.materials[0], reachable: 5, missing: 0 }],
    };
    controller.update();

    // The rebuild happened (status text changed) and focus is still on the
    // (newly rebuilt) Clear control, never dropped to <body>.
    expect(element.querySelector('.gathering-goal-status')?.textContent).toBe('Ready');
    expect(document.activeElement).toBe(element.querySelector('[data-clear]'));
  });

  it('relocalize() forces exactly one rebuild even though the signature is unchanged', () => {
    const element = mount();
    const world = fakeWorld(RECIPE_GOAL);
    const controller = new GatheringGoalController({ element, world: () => world });
    controller.update();
    const headerBefore = element.querySelector('.gathering-goal-header');
    expect(headerBefore).not.toBeNull();

    controller.relocalize();
    const headerAfter = element.querySelector('.gathering-goal-header');
    // A NEW node: relocalize cleared the latch and forced a real rebuild,
    // unlike a plain update() with the same goal (previous test).
    expect(headerAfter).not.toBe(headerBefore);

    // And a THIRD plain update() right after settles back into the
    // no-op regime (the latch re-armed at the current signature).
    const headerAfterRelocalize = element.querySelector('.gathering-goal-header');
    controller.update();
    expect(element.querySelector('.gathering-goal-header')).toBe(headerAfterRelocalize);
  });
});

describe('GatheringGoalController: explicit actions call through and repaint immediately', () => {
  it('onClearGoal calls world.clearGatheringGoal exactly once and repaints without waiting for update()', () => {
    const element = mount();
    const world = fakeWorld(RECIPE_GOAL);
    const controller = new GatheringGoalController({ element, world: () => world });
    controller.update();
    world.gatheringGoal = null;
    controller.onClearGoal();
    expect(world.clearGatheringGoal).toHaveBeenCalledTimes(1);
    expect(element.style.display).toBe('none');
  });

  it('onTrackRecipe calls world.trackGatheringRecipe exactly once with a clamped 1..50 count', () => {
    const element = mount();
    const world = fakeWorld(null);
    const controller = new GatheringGoalController({ element, world: () => world });
    controller.onTrackRecipe('recipe_iron_pick', 999);
    expect(world.trackGatheringRecipe).toHaveBeenCalledTimes(1);
    expect(world.trackGatheringRecipe).toHaveBeenCalledWith('recipe_iron_pick', 50);
  });

  it('onTrack (commission) calls world.trackGatheringCommission exactly once with the order id', () => {
    const element = mount();
    const world = fakeWorld(null);
    const controller = new GatheringGoalController({ element, world: () => world });
    controller.onTrack(9);
    expect(world.trackGatheringCommission).toHaveBeenCalledTimes(1);
    expect(world.trackGatheringCommission).toHaveBeenCalledWith(9);
  });

  it('the ONLY call that writes the harvest preference is onSetHarvestPreference', () => {
    const element = mount();
    const world = fakeWorld(RECIPE_GOAL);
    const controller = new GatheringGoalController({ element, world: () => world });
    controller.update();
    controller.onTrackRecipe('recipe_iron_pick', 5);
    controller.onTrack(1);
    controller.onClearGoal();
    controller.relocalize();
    expect(world.setHarvestPreference).not.toHaveBeenCalled();
    controller.onSetHarvestPreference('rough_hide');
    expect(world.setHarvestPreference).toHaveBeenCalledTimes(1);
    expect(world.setHarvestPreference).toHaveBeenCalledWith('rough_hide');
  });
});

describe('GatheringGoalController: detached controls from a prior render are inert', () => {
  it('a stale Clear button from BEFORE a real rebuild can no longer clear the current goal', () => {
    const element = mount();
    const world = fakeWorld(RECIPE_GOAL);
    const controller = new GatheringGoalController({ element, world: () => world });
    controller.update();
    // Captured and RETAINED across the rebuild below, simulating anything
    // that could still hold a reference to a destroyed render's node (a
    // queued event, a stray closure): the live DOM itself replaces this
    // node via the painter's own `el.innerHTML` rebuild, but the guard is
    // what keeps even a deliberately-retained stale reference inert.
    const staleClearBtn = element.querySelector<HTMLButtonElement>('[data-clear]');
    expect(staleClearBtn).not.toBeNull();

    // A real content change: a genuine rebuild, bumping the generation.
    world.gatheringGoal = {
      ...RECIPE_GOAL,
      status: 'ready',
      materials: [{ ...RECIPE_GOAL.materials[0], reachable: 5, missing: 0 }],
    };
    controller.update();
    expect(element.querySelector('[data-clear]')).not.toBe(staleClearBtn);

    // The stale node's own click listener still exists (it was never
    // removed, only detached), but the guard refuses to act on it.
    staleClearBtn?.click();
    expect(world.clearGatheringGoal).not.toHaveBeenCalled();

    // The CURRENT button still works normally.
    element.querySelector<HTMLButtonElement>('[data-clear]')?.click();
    expect(world.clearGatheringGoal).toHaveBeenCalledTimes(1);
  });

  it('a stale harvest-preference button from BEFORE a rebuild can no longer set the preference', () => {
    const element = mount();
    const cornerGoal: GatheringGoalView = {
      ...RECIPE_GOAL,
      materials: [
        {
          itemId: 'rough_hide',
          required: 5,
          carried: 0,
          stored: 0,
          reachable: 0,
          missing: 5,
          inaccessible: 0,
        },
      ],
    };
    const world = fakeWorld(cornerGoal);
    const controller = new GatheringGoalController({ element, world: () => world });
    controller.update();
    const stalePrefBtn = element.querySelector<HTMLButtonElement>('[data-set-pref]');
    expect(stalePrefBtn).not.toBeNull();

    world.gatheringGoal = { ...cornerGoal, status: 'ready' };
    controller.update();
    expect(element.querySelector('[data-set-pref]')).not.toBe(stalePrefBtn);

    stalePrefBtn?.click();
    expect(world.setHarvestPreference).not.toHaveBeenCalled();

    element.querySelector<HTMLButtonElement>('[data-set-pref]')?.click();
    expect(world.setHarvestPreference).toHaveBeenCalledTimes(1);
    expect(world.setHarvestPreference).toHaveBeenCalledWith('rough_hide');
  });

  it('relocalize() also bumps the generation, invalidating a control rendered before it', () => {
    const element = mount();
    const world = fakeWorld(RECIPE_GOAL);
    const controller = new GatheringGoalController({ element, world: () => world });
    controller.update();
    const staleClearBtn = element.querySelector<HTMLButtonElement>('[data-clear]');

    controller.relocalize();

    staleClearBtn?.click();
    expect(world.clearGatheringGoal).not.toHaveBeenCalled();
  });
});

describe('GatheringGoalController: isCurrentHarvestPreference reads the AUTHORITATIVE world mirror', () => {
  it('an authoritative preference matching the row renders it disabled and current, never guessed from the click', () => {
    const element = mount();
    const world = fakeWorld(CORPSE_GOAL, { kind: 'material', itemId: 'rough_hide' });
    const controller = new GatheringGoalController({ element, world: () => world });
    controller.update();

    const btn = element.querySelector<HTMLButtonElement>('[data-set-pref]');
    expect(btn).not.toBeNull();
    expect(btn?.disabled).toBe(true);
    expect(btn?.classList.contains('current')).toBe(true);
  });

  it('online: onSetHarvestPreference sends the command but does NOT optimistically mark the row current until the mirror moves', () => {
    const element = mount();
    // The mirror starts at 'all' and is deliberately left untouched by the
    // click below, simulating the online host: the command is sent, but the
    // authoritative preference only changes when a later snapshot updates
    // `world.harvestPreference` from outside this controller.
    const world = fakeWorld(CORPSE_GOAL, { kind: 'all' });
    const controller = new GatheringGoalController({ element, world: () => world });
    controller.update();

    element.querySelector<HTMLButtonElement>('[data-set-pref]')?.click();
    expect(world.setHarvestPreference).toHaveBeenCalledWith('rough_hide');

    const btnAfter = element.querySelector<HTMLButtonElement>('[data-set-pref]');
    expect(btnAfter?.disabled).toBe(false);
    expect(btnAfter?.classList.contains('current')).toBe(false);
  });

  it('offline: onSetHarvestPreference repaints at once once the world mirror already reflects the new choice', () => {
    const element = mount();
    const world = fakeWorld(CORPSE_GOAL, { kind: 'all' });
    const controller = new GatheringGoalController({ element, world: () => world });
    controller.update();

    // Offline, the sim applies the preference synchronously: the fake mimics
    // that by updating the mirror itself before the controller's own
    // onSetHarvestPreference call reads it back via update().
    world.harvestPreference = { kind: 'material', itemId: 'rough_hide' };
    controller.onSetHarvestPreference('rough_hide');

    const btn = element.querySelector<HTMLButtonElement>('[data-set-pref]');
    expect(btn?.disabled).toBe(true);
    expect(btn?.classList.contains('current')).toBe(true);
  });

  it('a DIFFERENT authoritative preference re-enables a previously-current row', () => {
    const element = mount();
    const world = fakeWorld(CORPSE_GOAL, { kind: 'material', itemId: 'rough_hide' });
    const controller = new GatheringGoalController({ element, world: () => world });
    controller.update();
    expect(element.querySelector<HTMLButtonElement>('[data-set-pref]')?.disabled).toBe(true);

    world.harvestPreference = { kind: 'material', itemId: 'iron_ore' };
    controller.update();

    const btn = element.querySelector<HTMLButtonElement>('[data-set-pref]');
    expect(btn?.disabled).toBe(false);
    expect(btn?.classList.contains('current')).toBe(false);
  });
});

describe('GatheringGoalController: the crafting-window goal quantity map', () => {
  it('defaults to 1, is independent per recipe, and clamps to 1..50', () => {
    const controller = new GatheringGoalController({
      element: mount(),
      world: () => fakeWorld(null),
    });
    expect(controller.goalQty('recipe_a')).toBe(1);
    controller.onGoalQty('recipe_a', 12);
    controller.onGoalQty('recipe_b', 999);
    expect(controller.goalQty('recipe_a')).toBe(12);
    expect(controller.goalQty('recipe_b')).toBe(50);
    // Untouched recipes still default to 1.
    expect(controller.goalQty('recipe_c')).toBe(1);
  });

  it('an ordinary re-render never resets a previously chosen goal quantity', () => {
    const element = mount();
    const world = fakeWorld(RECIPE_GOAL);
    const controller = new GatheringGoalController({ element, world: () => world });
    controller.onGoalQty('recipe_iron_pick', 27);
    controller.update();
    controller.update();
    expect(controller.goalQty('recipe_iron_pick')).toBe(27);
  });
});

// The live HUD passes the tracker root, not its body. Pin that exact
// mounting shape and the same chrome node across every repaint.
describe('GatheringGoalController: frame chrome sibling survives every repaint', () => {
  it('a real (non-empty) render paints into #gathering-goal-body and never wipes the frame-chrome sibling', () => {
    const { root, body, chrome } = mountLive();
    const world = fakeWorld(RECIPE_GOAL);
    const controller = new GatheringGoalController({ element: root, world: () => world });
    controller.update();

    expect(root.style.display).toBe('flex');
    expect(body.querySelector('.gathering-goal-header')).not.toBeNull();
    // The chrome sibling is the SAME node `movable_frame.ts` appended before
    // this controller ever ran: a repaint that wipes it (by writing
    // `.innerHTML` on the ROOT instead of the body) fails this line.
    expect(root.querySelector('.tf-move-btn')).toBe(chrome);
    expect(root.contains(chrome)).toBe(true);
  });

  it('a real goal change repaints the body but leaves the SAME chrome node in place', () => {
    const { root, body, chrome } = mountLive();
    const world = fakeWorld(RECIPE_GOAL);
    const controller = new GatheringGoalController({ element: root, world: () => world });
    controller.update();

    world.gatheringGoal = {
      ...RECIPE_GOAL,
      status: 'ready',
      materials: [{ ...RECIPE_GOAL.materials[0], reachable: 5, missing: 0 }],
    };
    controller.update();

    expect(body.querySelector('.gathering-goal-status')?.textContent).toBe('Ready');
    expect(root.querySelector('.tf-move-btn')).toBe(chrome);
  });

  it('relocalize() forces a body rebuild but leaves the SAME chrome node in place', () => {
    const { root, body, chrome } = mountLive();
    const world = fakeWorld(RECIPE_GOAL);
    const controller = new GatheringGoalController({ element: root, world: () => world });
    controller.update();
    const headerBefore = body.querySelector('.gathering-goal-header');

    controller.relocalize();

    expect(body.querySelector('.gathering-goal-header')).not.toBe(headerBefore);
    expect(root.querySelector('.tf-move-btn')).toBe(chrome);
  });

  it('clearing the goal hides the ROOT and empties the BODY, but never touches the chrome sibling', () => {
    const { root, body, chrome } = mountLive();
    const world = fakeWorld(RECIPE_GOAL);
    const controller = new GatheringGoalController({ element: root, world: () => world });
    controller.update();

    world.gatheringGoal = null;
    controller.onClearGoal();

    expect(root.style.display).toBe('none');
    expect(body.innerHTML).toBe('');
    expect(root.querySelector('.tf-move-btn')).toBe(chrome);
    expect(root.contains(chrome)).toBe(true);
  });
});
