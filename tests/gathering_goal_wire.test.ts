// Intentional Gathering PR4: the pure client decode leaf
// src/net/gathering_goal_wire.ts (decodeGatheringGoalWire), the
// harvest_preference_wire.ts idiom. The real-Sim wire roundtrip (command
// helper -> Sim -> appendGatheringGoalSelfWire -> decode) lives in
// tests/server/gathering_goal_commands.test.ts; this file exercises the
// decoder's own validation in isolation, including every identity/status/
// reason/material invariant gathering_goal_projection.ts actually produces.

import { describe, expect, it } from 'vitest';
import { decodeGatheringGoalWire } from '../src/net/gathering_goal_wire';
import { CRAFT_BATCH_MAX } from '../src/sim/content/professions';

// Deliberately loose: this builds raw WIRE payloads for decode testing,
// including malformed shapes the real GatheringGoalView type would reject.
function readyRecipeView(overrides: Record<string, unknown> = {}): unknown {
  return {
    goal: { kind: 'recipe', recipeId: 'recipe_test', count: 5 },
    status: 'ready',
    reason: null,
    materials: [
      {
        itemId: 'rough_hide',
        required: 10,
        carried: 6,
        stored: 4,
        reachable: 10,
        missing: 0,
        inaccessible: 0,
      },
    ],
    payableCrafts: 5,
    storageRestricted: false,
    ...overrides,
  };
}

// A recipe-goal 'unavailable' view: reason must be non-null, goal non-null,
// materials empty, payableCrafts 0 (the projection's own unavailable() shape
// for every reason except invalid_goal, which is null-goal only).
function unavailableRecipeView(reason: string): unknown {
  return readyRecipeView({ status: 'unavailable', reason, materials: [], payableCrafts: 0 });
}

describe('decodeGatheringGoalWire', () => {
  it('decodes explicit null as null (clears the goal)', () => {
    expect(decodeGatheringGoalWire(null)).toBeNull();
  });

  it('rejects wire-input undefined to null (an omitted key means "unchanged", decided by the caller)', () => {
    expect(decodeGatheringGoalWire(undefined)).toBeNull();
  });

  it('decodes a complete ready recipe view verbatim', () => {
    const raw = readyRecipeView();
    expect(decodeGatheringGoalWire(raw)).toEqual(raw);
  });

  it('preserves a valid empty-reagent recipe (no rows, fully payable)', () => {
    const raw = readyRecipeView({ materials: [], payableCrafts: 5 });
    expect(decodeGatheringGoalWire(raw)).toEqual(raw);
  });

  it('decodes a complete terminal commission view verbatim', () => {
    const raw = readyRecipeView({
      goal: { kind: 'commission', recipeId: 'recipe_test', orderId: 7, count: 1 },
      status: 'delivered',
      materials: [],
      payableCrafts: 0,
    });
    expect(decodeGatheringGoalWire(raw)).toEqual(raw);
  });

  it('decodes an unavailable view with a null goal (invalid_goal)', () => {
    const raw = readyRecipeView({
      goal: null,
      status: 'unavailable',
      reason: 'invalid_goal',
      materials: [],
      payableCrafts: 0,
    });
    expect(decodeGatheringGoalWire(raw)).toEqual(raw);
  });

  it('decodes every non-invalid_goal unavailable reason against a real (non-null) goal', () => {
    for (const reason of [
      'unknown_recipe',
      'recipe_unavailable',
      'commission_unavailable',
      'daily_limit',
      'batch_limit',
    ]) {
      const raw = unavailableRecipeView(reason);
      expect(decodeGatheringGoalWire(raw), reason).toEqual(raw);
    }
  });

  it('decodes every terminal status against a commission goal', () => {
    for (const status of ['delivered', 'cancelled', 'expired']) {
      const raw = readyRecipeView({
        goal: { kind: 'commission', recipeId: 'recipe_test', orderId: 3, count: 1 },
        status,
        materials: [],
        payableCrafts: 0,
      });
      expect(decodeGatheringGoalWire(raw), status).toEqual(raw);
    }
  });

  it('refuses an unknown status or reason', () => {
    expect(decodeGatheringGoalWire(readyRecipeView({ status: 'bogus' }))).toBeNull();
    expect(decodeGatheringGoalWire(unavailableRecipeView('bogus'))).toBeNull();
  });

  // --- identity/status/reason consistency ---------------------------------

  it('refuses a null goal paired with anything but unavailable+invalid_goal', () => {
    expect(
      decodeGatheringGoalWire(readyRecipeView({ goal: null, materials: [], payableCrafts: 0 })),
      'ready with null goal',
    ).toBeNull();
    expect(
      decodeGatheringGoalWire(
        readyRecipeView({
          goal: null,
          status: 'unavailable',
          reason: 'daily_limit',
          materials: [],
          payableCrafts: 0,
        }),
      ),
      'unavailable+daily_limit with null goal',
    ).toBeNull();
  });

  it('refuses invalid_goal paired with a real (non-null) goal', () => {
    expect(decodeGatheringGoalWire(unavailableRecipeView('invalid_goal'))).toBeNull();
  });

  it('refuses a non-unavailable status carrying a non-null reason', () => {
    expect(
      decodeGatheringGoalWire(readyRecipeView({ status: 'collecting', reason: 'daily_limit' })),
    ).toBeNull();
    expect(
      decodeGatheringGoalWire(
        readyRecipeView({
          goal: { kind: 'commission', recipeId: 'recipe_test', orderId: 1, count: 1 },
          status: 'delivered',
          reason: 'daily_limit',
          materials: [],
          payableCrafts: 0,
        }),
      ),
    ).toBeNull();
  });

  it('refuses unavailable with a real goal but a null reason', () => {
    expect(
      decodeGatheringGoalWire(readyRecipeView({ status: 'unavailable', reason: null })),
    ).toBeNull();
  });

  it('refuses a terminal status paired with a recipe-kind goal (terminal is commission-only)', () => {
    for (const status of ['delivered', 'cancelled', 'expired']) {
      expect(
        decodeGatheringGoalWire(readyRecipeView({ status, materials: [], payableCrafts: 0 })),
        status,
      ).toBeNull();
    }
  });

  it('refuses non-empty materials on a non-projecting status', () => {
    expect(decodeGatheringGoalWire(unavailableRecipeView('recipe_unavailable'))).not.toBeNull();
    const dirty = readyRecipeView({ status: 'unavailable', reason: 'recipe_unavailable' });
    expect(decodeGatheringGoalWire(dirty)).toBeNull(); // still carries the default row
  });

  it('refuses a nonzero payableCrafts on a non-projecting status', () => {
    expect(decodeGatheringGoalWire(unavailableRecipeView('recipe_unavailable'))).not.toBeNull();
    const dirty = { ...(unavailableRecipeView('recipe_unavailable') as object), payableCrafts: 1 };
    expect(decodeGatheringGoalWire(dirty)).toBeNull();
  });

  it('refuses payableCrafts exceeding the goal count', () => {
    const raw = readyRecipeView({ payableCrafts: 6 }); // goal.count is 5
    expect(decodeGatheringGoalWire(raw)).toBeNull();
  });

  it('accepts payableCrafts exactly equal to the goal count', () => {
    const raw = readyRecipeView({ payableCrafts: 5 });
    expect(decodeGatheringGoalWire(raw)).toEqual(raw);
  });

  it("refuses a 'ready' status carrying a row with nonzero missing or inaccessible", () => {
    const base = readyRecipeView() as { materials: Record<string, unknown>[] };
    const row = base.materials[0];
    // Internally consistent row (missing/inaccessible correctly derived) but
    // genuinely short: 'ready' must never carry a shortfall row at all.
    const shortRow = { ...row, carried: 2, stored: 0, reachable: 2, missing: 8, inaccessible: 0 };
    expect(decodeGatheringGoalWire({ ...base, status: 'ready', materials: [shortRow] })).toBeNull();
    const inaccessibleRow = {
      ...row,
      carried: 10,
      stored: 0,
      reachable: 4,
      missing: 0,
      inaccessible: 6,
    };
    expect(
      decodeGatheringGoalWire({ ...base, status: 'ready', materials: [inaccessibleRow] }),
    ).toBeNull();
  });

  // --- record shape: plain/null-prototype only ----------------------------

  it('refuses a non-object frame', () => {
    for (const raw of [42, 'x', true, []]) {
      expect(decodeGatheringGoalWire(raw), String(raw)).toBeNull();
    }
  });

  it('refuses a class-instance or exotic object masquerading as the view', () => {
    class Exotic {
      status = 'ready';
      goal = null;
      reason = 'invalid_goal';
      materials: unknown[] = [];
      payableCrafts = 0;
      storageRestricted = false;
    }
    expect(decodeGatheringGoalWire(new Exotic())).toBeNull();
    expect(decodeGatheringGoalWire(new Map())).toBeNull();
  });

  it('refuses a goal identity built on a class instance', () => {
    class Exotic {
      kind = 'recipe';
      recipeId = 'recipe_test';
      count = 5;
    }
    expect(decodeGatheringGoalWire(readyRecipeView({ goal: new Exotic() }))).toBeNull();
  });

  it('refuses a material row built on a class instance', () => {
    class Exotic {
      itemId = 'rough_hide';
      required = 10;
      carried = 6;
      stored = 4;
      reachable = 10;
      missing = 0;
      inaccessible = 0;
    }
    expect(decodeGatheringGoalWire(readyRecipeView({ materials: [new Exotic()] }))).toBeNull();
  });

  // --- identity id shape: canonical, printable, bounded -------------------

  it('refuses a malformed recipe identity: non-string id, control characters, float/NaN/oversized count', () => {
    for (const count of [0, -1, 1.5, Number.NaN, CRAFT_BATCH_MAX + 1, Infinity]) {
      expect(
        decodeGatheringGoalWire(
          readyRecipeView({ goal: { kind: 'recipe', recipeId: 'r', count } }),
        ),
        String(count),
      ).toBeNull();
    }
    expect(
      decodeGatheringGoalWire(
        readyRecipeView({ goal: { kind: 'recipe', recipeId: 42, count: 1 } }),
      ),
    ).toBeNull();
    for (const recipeId of ['two words', 'line\nbreak', 'tab\ttab', '', 'r'.repeat(129)]) {
      expect(
        decodeGatheringGoalWire(readyRecipeView({ goal: { kind: 'recipe', recipeId, count: 1 } })),
        JSON.stringify(recipeId),
      ).toBeNull();
    }
  });

  it('refuses a recipe identity carrying an extra unknown key (exact-keys, saved-goal parity)', () => {
    expect(
      decodeGatheringGoalWire(
        readyRecipeView({ goal: { kind: 'recipe', recipeId: 'r', count: 1, extra: true } }),
      ),
    ).toBeNull();
  });

  it('refuses a malformed commission identity: bad order id or a count other than exactly 1', () => {
    for (const orderId of [0, -1, 1.5, Number.NaN]) {
      expect(
        decodeGatheringGoalWire(
          readyRecipeView({ goal: { kind: 'commission', recipeId: 'r', orderId, count: 1 } }),
        ),
        String(orderId),
      ).toBeNull();
    }
    expect(
      decodeGatheringGoalWire(
        readyRecipeView({ goal: { kind: 'commission', recipeId: 'r', orderId: 1, count: 2 } }),
      ),
    ).toBeNull();
  });

  it('refuses an unknown identity kind', () => {
    expect(
      decodeGatheringGoalWire(
        readyRecipeView({ goal: { kind: 'bogus', recipeId: 'r', count: 1 } }),
      ),
    ).toBeNull();
  });

  // --- materials array + per-row numeric invariants -----------------------

  it('refuses materials that is not an array', () => {
    expect(decodeGatheringGoalWire(readyRecipeView({ materials: {} }))).toBeNull();
    expect(decodeGatheringGoalWire(readyRecipeView({ materials: null }))).toBeNull();
  });

  it('refuses a material row with a non-string/control-char itemId', () => {
    const base = readyRecipeView() as { materials: Record<string, unknown>[] };
    const row = base.materials[0];
    for (const itemId of [42, 'two words', 'line\nbreak', '']) {
      expect(
        decodeGatheringGoalWire({ ...base, materials: [{ ...row, itemId }] }),
        JSON.stringify(itemId),
      ).toBeNull();
    }
  });

  it('refuses a material row with a fractional, negative, NaN, or infinite count', () => {
    const base = readyRecipeView() as { materials: Record<string, unknown>[] };
    const row = base.materials[0];
    for (const field of ['required', 'carried', 'stored', 'reachable', 'missing', 'inaccessible']) {
      for (const bad of [-1, 1.5, Number.NaN, Infinity, '5', undefined]) {
        const patched = { ...row, [field]: bad };
        expect(
          decodeGatheringGoalWire({ ...base, materials: [patched] }),
          `${field}=${String(bad)}`,
        ).toBeNull();
      }
    }
  });

  it('refuses owned (carried+stored) exceeding required', () => {
    const base = readyRecipeView() as { materials: Record<string, unknown>[] };
    const row = base.materials[0];
    // carried+stored (20) > required (10); reachable/missing/inaccessible left
    // otherwise self-consistent for the (wrong) owned total.
    const overOwned = {
      ...row,
      carried: 20,
      stored: 0,
      reachable: 10,
      missing: 0,
      inaccessible: 10,
    };
    expect(decodeGatheringGoalWire({ ...base, materials: [overOwned] })).toBeNull();
  });

  it('refuses reachable exceeding owned (carried+stored)', () => {
    const base = readyRecipeView() as { materials: Record<string, unknown>[] };
    const row = base.materials[0]; // carried 6, stored 4, owned 10
    expect(decodeGatheringGoalWire({ ...base, materials: [{ ...row, reachable: 11 }] })).toBeNull();
  });

  it('refuses a missing count that is not exactly required-owned', () => {
    // status 'collecting' (never 'ready'): a nonzero missing/inaccessible row
    // is itself refused for 'ready' by a separate invariant, tested above;
    // this isolates the per-row arithmetic check.
    const base = readyRecipeView({ status: 'collecting' }) as {
      materials: Record<string, unknown>[];
    };
    const row = base.materials[0]; // required 10, owned 10 -> missing must be 0
    expect(decodeGatheringGoalWire({ ...base, materials: [{ ...row, missing: 1 }] })).toBeNull();
    // A genuinely short row (owned 6 < required 10) still demands the EXACT
    // remainder, not merely a bound: required-owned is 4, not 3 or 5.
    const short = { ...row, carried: 6, stored: 0, reachable: 6 };
    expect(decodeGatheringGoalWire({ ...base, materials: [{ ...short, missing: 3 }] })).toBeNull();
    expect(decodeGatheringGoalWire({ ...base, materials: [{ ...short, missing: 5 }] })).toBeNull();
    expect(
      decodeGatheringGoalWire({ ...base, materials: [{ ...short, missing: 4 }] }),
    ).not.toBeNull();
  });

  it('refuses an inaccessible count that is not exactly owned-reachable', () => {
    const base = readyRecipeView({ status: 'collecting' }) as {
      materials: Record<string, unknown>[];
    };
    const row = base.materials[0]; // owned 10, reachable 10 -> inaccessible must be 0
    expect(
      decodeGatheringGoalWire({ ...base, materials: [{ ...row, inaccessible: 1 }] }),
    ).toBeNull();
    // A genuinely locked row (reachable 4 < owned 10) still demands the exact
    // remainder (6), not merely a bound.
    const locked = { ...row, reachable: 4 };
    expect(
      decodeGatheringGoalWire({ ...base, materials: [{ ...locked, inaccessible: 5 }] }),
    ).toBeNull();
    expect(
      decodeGatheringGoalWire({ ...base, materials: [{ ...locked, inaccessible: 7 }] }),
    ).toBeNull();
    expect(
      decodeGatheringGoalWire({ ...base, materials: [{ ...locked, inaccessible: 6 }] }),
    ).not.toBeNull();
  });

  it('refuses a malformed payableCrafts or storageRestricted', () => {
    expect(decodeGatheringGoalWire(readyRecipeView({ payableCrafts: -1 }))).toBeNull();
    expect(decodeGatheringGoalWire(readyRecipeView({ payableCrafts: 1.5 }))).toBeNull();
    expect(decodeGatheringGoalWire(readyRecipeView({ storageRestricted: 'yes' }))).toBeNull();
  });

  it('drops any unrecognized property on the wire object (no object pollution)', () => {
    const raw = readyRecipeView() as Record<string, unknown>;
    const polluted = { ...raw, extraneous: 'nope' };
    const decoded = decodeGatheringGoalWire(polluted);
    expect(decoded).toEqual(readyRecipeView());
    expect(decoded).not.toHaveProperty('extraneous');
  });
});
