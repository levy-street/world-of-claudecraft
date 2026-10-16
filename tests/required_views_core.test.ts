// The views the world cannot be entered without: the local player's and its target's
// (src/render/required_views_core.ts). A view counts as created only when it EXISTS after
// its build. A build that made nothing (its assets were unavailable: the fail-soft path)
// used to be counted and sampled as created anyway, so the world-entry prewarm reported
// the player's own view as built while nothing stood on screen (PR 4360 review, S5).
// Node-only (RENDER_PURE_CORES): no Three, no DOM.
import { describe, expect, it, vi } from 'vitest';
import { makeQuestObjectGate } from '../src/render/quest_object_gate_core';
import { createRequiredViews } from '../src/render/required_views_core';
import type { Entity, QuestProgress } from '../src/sim/types';

const entity = (id: number, kind: string, templateId: string, targetId: number | null = null) =>
  ({ id, kind, templateId, targetId, pos: { x: 0, y: 0, z: 0 } }) as unknown as Entity;

/** A renderer-shaped host: `builds` says whether a build of that entity makes a view. */
function host(entities: Entity[], builds: (e: Entity) => boolean) {
  const views = new Map<number, object>();
  const createView = vi.fn((e: Entity) => {
    if (builds(e)) views.set(e.id, {});
  });
  const canAttempt = vi.fn((_id: number, _slot: string, _now: number) => true);
  return {
    sim: {
      entities: new Map(entities.map((e) => [e.id, e])),
      questLog: new Map<string, QuestProgress>(),
    },
    views,
    questObjectHidden: makeQuestObjectGate({}),
    viewCreateRetry: { canAttempt },
    createView,
    canAttempt,
  };
}

describe('createRequiredViews', () => {
  it('builds the player and its target, and counts and samples both', () => {
    const player = entity(1, 'player', 'mage', 2);
    const target = entity(2, 'mob', 'forest_wolf');
    const h = host([player, target], () => true);
    const types: string[] = [];
    expect(createRequiredViews(h, player, types, 500)).toBe(2);
    expect(types).toEqual(['player:mage', 'mob:forest_wolf']);
    expect(h.createView.mock.calls.map(([e]) => e.id)).toEqual([1, 2]);
    // each build asked the retry gate for the entity's own view slot, at the caller's clock
    expect(h.canAttempt.mock.calls).toEqual([
      [1, 'view', 500],
      [2, 'view', 500],
    ]);
  });

  it('does not count or sample a build that made no view', () => {
    // the player's assets are unavailable: createView returns having built nothing
    const player = entity(1, 'player', 'mage');
    const h = host([player], () => false);
    const types: string[] = [];
    expect(createRequiredViews(h, player, types, 0)).toBe(0);
    expect(types).toEqual([]);
    // the build was really attempted (the fail-soft path ran and booked its own cooldown)
    expect(h.createView).toHaveBeenCalledOnce();
    expect(h.views.has(1)).toBe(false);
  });

  it('counts each required view on its own: a failed player beside a built target', () => {
    const player = entity(1, 'player', 'mage', 2);
    const target = entity(2, 'mob', 'forest_wolf');
    const h = host([player, target], (e) => e.id === 2);
    const types: string[] = [];
    expect(createRequiredViews(h, player, types, 0)).toBe(1);
    expect(types).toEqual(['mob:forest_wolf']);
    // and the other way round
    const g = host([player, target], (e) => e.id === 1);
    const others: string[] = [];
    expect(createRequiredViews(g, player, others, 0)).toBe(1);
    expect(others).toEqual(['player:mage']);
  });

  it('skips a view that exists, an absent target and a build sitting out its cooldown', () => {
    const player = entity(1, 'player', 'mage');
    const h = host([player], () => true);
    h.views.set(1, {});
    expect(createRequiredViews(h, player, [], 0)).toBe(0);
    expect(h.createView).not.toHaveBeenCalled();

    const cooling = host([player], () => true);
    cooling.canAttempt.mockReturnValue(false);
    const types: string[] = [];
    expect(createRequiredViews(cooling, player, types, 0)).toBe(0);
    expect(cooling.createView).not.toHaveBeenCalled();
    expect(types).toEqual([]);

    // a target that left the roster
    const gone = host([player], () => true);
    expect(createRequiredViews(gone, { id: 1, targetId: 9 }, [], 0)).toBe(1);
    expect(gone.createView).toHaveBeenCalledOnce();
  });
});
