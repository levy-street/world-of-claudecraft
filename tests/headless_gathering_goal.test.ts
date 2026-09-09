// Intentional Gathering (PR4), headless supplement: the PARSE and DISPATCH
// halves of the optional `{cmd:'gathering_goal', verb:...}` wire family
// (docs/protocols/gathering-goal.md), a SEPARATE closed family from the PR3
// `{cmd:'gathering', verb:...}` one pinned by tests/headless_gathering_protocol.test.ts
// / tests/headless_gathering_commands.test.ts. This file pins
// `headless/gathering_goal_protocol.ts`'s `parseGatheringGoalRequest` /
// `GATHERING_GOAL_CAPABILITY` and `headless/gathering_goal_commands.ts`'s
// `executeGatheringGoalCommand`, driven through a real `Sim` for the dispatch
// half (same idiom as `tests/sim.test.ts`).
//
// Deliberately NOT re-covered here: the goal projection's own material/status
// rules (tests/professions_gathering_goal*.test.ts, wherever the runtime
// worker's own suite lands) or the commission-authority checks themselves
// (tests/professions_commission_order.test.ts). This file only exercises
// tracking/reading/clearing THROUGH the headless command surface.

import { describe, expect, it } from 'vitest';
import {
  executeGatheringGoalCommand,
  type GatheringGoalReply,
} from '../headless/gathering_goal_commands';
import {
  GATHERING_GOAL_CAPABILITY,
  parseGatheringGoalRequest,
} from '../headless/gathering_goal_protocol';
import { Sim } from '../src/sim/sim';

const VALID_INSPECT = { cmd: 'gathering_goal', verb: 'inspect' } as const;
const VALID_TRACK_RECIPE = {
  cmd: 'gathering_goal',
  verb: 'track_recipe',
  recipeId: 'recipe_tough_jerky',
  count: 5,
} as const;
const VALID_TRACK_COMMISSION = {
  cmd: 'gathering_goal',
  verb: 'track_commission',
  orderId: 7,
} as const;
const VALID_CLEAR = { cmd: 'gathering_goal', verb: 'clear' } as const;

describe('GATHERING_GOAL_CAPABILITY: the exact info-reply advertisement', () => {
  it('advertises version 1 and exactly the four contract verbs', () => {
    expect(GATHERING_GOAL_CAPABILITY).toEqual({
      version: 1,
      verbs: ['inspect', 'track_recipe', 'track_commission', 'clear'],
    });
  });
});

describe('parseGatheringGoalRequest: the four exact valid shapes', () => {
  it('accepts { cmd, verb: inspect } verbatim', () => {
    expect(parseGatheringGoalRequest(VALID_INSPECT)).toEqual({
      ok: true,
      request: VALID_INSPECT,
    });
  });

  it('accepts { cmd, verb: track_recipe, recipeId, count } verbatim', () => {
    expect(parseGatheringGoalRequest(VALID_TRACK_RECIPE)).toEqual({
      ok: true,
      request: VALID_TRACK_RECIPE,
    });
  });

  it('accepts the batch ceiling count (50)', () => {
    const raw = { ...VALID_TRACK_RECIPE, count: 50 };
    expect(parseGatheringGoalRequest(raw)).toEqual({ ok: true, request: raw });
  });

  it('accepts { cmd, verb: track_commission, orderId } verbatim', () => {
    expect(parseGatheringGoalRequest(VALID_TRACK_COMMISSION)).toEqual({
      ok: true,
      request: VALID_TRACK_COMMISSION,
    });
  });

  it('accepts { cmd, verb: clear } verbatim', () => {
    expect(parseGatheringGoalRequest(VALID_CLEAR)).toEqual({ ok: true, request: VALID_CLEAR });
  });
});

describe('parseGatheringGoalRequest: closed-shape rejection (unknown/extra keys)', () => {
  it('rejects an inspect request carrying any extra key', () => {
    expect(parseGatheringGoalRequest({ ...VALID_INSPECT, extra: 1 })).toEqual({
      ok: false,
      reason: 'invalid_request',
    });
  });

  it('rejects a clear request carrying any extra key', () => {
    expect(parseGatheringGoalRequest({ ...VALID_CLEAR, pid: 1 })).toEqual({
      ok: false,
      reason: 'invalid_request',
    });
  });

  it('rejects track_recipe missing count', () => {
    expect(
      parseGatheringGoalRequest({
        cmd: 'gathering_goal',
        verb: 'track_recipe',
        recipeId: 'recipe_tough_jerky',
      }),
    ).toEqual({ ok: false, reason: 'invalid_request' });
  });

  it('rejects track_recipe carrying an extra orderId (no cross-shape blending)', () => {
    expect(parseGatheringGoalRequest({ ...VALID_TRACK_RECIPE, orderId: 1 })).toEqual({
      ok: false,
      reason: 'invalid_request',
    });
  });

  it('rejects track_commission missing orderId', () => {
    expect(parseGatheringGoalRequest({ cmd: 'gathering_goal', verb: 'track_commission' })).toEqual({
      ok: false,
      reason: 'invalid_request',
    });
  });

  it('rejects track_commission carrying an extra recipeId (no cross-shape blending)', () => {
    expect(parseGatheringGoalRequest({ ...VALID_TRACK_COMMISSION, recipeId: 'x' })).toEqual({
      ok: false,
      reason: 'invalid_request',
    });
  });
});

describe('parseGatheringGoalRequest: structural rejection', () => {
  const nonObjectRaws = [null, undefined, 5, 'gathering_goal', true, Number.NaN];
  it.each(nonObjectRaws.map((v) => [v]))('rejects a non-object raw value: %p', (raw) => {
    expect(parseGatheringGoalRequest(raw)).toEqual({ ok: false, reason: 'invalid_request' });
  });

  const arrayRaws = [
    [],
    ['gathering_goal', 'inspect'],
    [{ cmd: 'gathering_goal', verb: 'inspect' }],
  ];
  it.each(arrayRaws.map((v) => [v]))('rejects an array raw value: %p', (raw) => {
    expect(parseGatheringGoalRequest(raw)).toEqual({ ok: false, reason: 'invalid_request' });
  });

  it('rejects a non-plain-record raw value (a Date instance)', () => {
    expect(parseGatheringGoalRequest(new Date())).toEqual({ ok: false, reason: 'invalid_request' });
  });

  it('rejects the wrong cmd (the sibling PR3 family stays a separate shape)', () => {
    expect(parseGatheringGoalRequest({ cmd: 'gathering', verb: 'inspect' })).toEqual({
      ok: false,
      reason: 'invalid_request',
    });
  });

  it('rejects a missing verb', () => {
    expect(parseGatheringGoalRequest({ cmd: 'gathering_goal' })).toEqual({
      ok: false,
      reason: 'invalid_request',
    });
  });

  it('rejects an unknown verb', () => {
    expect(parseGatheringGoalRequest({ cmd: 'gathering_goal', verb: 'untrack' })).toEqual({
      ok: false,
      reason: 'invalid_request',
    });
  });
});

describe('parseGatheringGoalRequest: malformed recipeId', () => {
  const badRecipeIds = [
    '',
    'x'.repeat(129),
    'Recipe With Spaces',
    'recipe/with/slash',
    5,
    true,
    null,
    undefined,
    [],
    {},
  ];
  it.each(badRecipeIds.map((v) => [v]))(
    'rejects track_recipe with an invalid recipeId: %p',
    (recipeId) => {
      expect(parseGatheringGoalRequest({ ...VALID_TRACK_RECIPE, recipeId })).toEqual({
        ok: false,
        reason: 'invalid_request',
      });
    },
  );
});

describe('parseGatheringGoalRequest: unsafe/out-of-range count', () => {
  const badCounts = [
    0,
    -1,
    1.5,
    51,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
    '5',
    true,
    null,
    undefined,
    [],
    {},
  ];
  it.each(badCounts.map((v) => [v]))('rejects track_recipe with an invalid count: %p', (count) => {
    expect(parseGatheringGoalRequest({ ...VALID_TRACK_RECIPE, count })).toEqual({
      ok: false,
      reason: 'invalid_request',
    });
  });
});

describe('parseGatheringGoalRequest: unsafe orderId', () => {
  const badOrderIds = [
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
    '5',
    true,
    null,
    undefined,
    [],
    {},
  ];
  it.each(badOrderIds.map((v) => [v]))(
    'rejects track_commission with an invalid orderId: %p',
    (orderId) => {
      expect(parseGatheringGoalRequest({ ...VALID_TRACK_COMMISSION, orderId })).toEqual({
        ok: false,
        reason: 'invalid_request',
      });
    },
  );
});

function expectOk(reply: GatheringGoalReply): Extract<GatheringGoalReply, { ok: true }> {
  if (!reply.ok) throw new Error(`expected an ok reply, got ${JSON.stringify(reply)}`);
  return reply;
}

function makeSim(seed = 501): Sim {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: true });
}

describe('executeGatheringGoalCommand: gating before an admitted command', () => {
  it('refuses every verb before reset with reset_required', () => {
    for (const raw of [VALID_INSPECT, VALID_TRACK_RECIPE, VALID_TRACK_COMMISSION, VALID_CLEAR]) {
      expect(executeGatheringGoalCommand(null, raw)).toEqual({
        ok: false,
        reason: 'reset_required',
      });
    }
  });

  it('refuses a malformed request as invalid_request even with no Sim at all', () => {
    expect(executeGatheringGoalCommand(null, { cmd: 'gathering_goal', verb: 'bogus' })).toEqual({
      ok: false,
      reason: 'invalid_request',
    });
  });

  it('refuses a malformed request as invalid_request against a real Sim too, leaving it untouched', () => {
    const sim = makeSim();
    const tickBefore = sim.tickCount;
    const timeBefore = sim.time;
    expect(executeGatheringGoalCommand(sim, { ...VALID_TRACK_RECIPE, count: 51 })).toEqual({
      ok: false,
      reason: 'invalid_request',
    });
    expect(sim.tickCount).toBe(tickBefore);
    expect(sim.time).toBe(timeBefore);
    expect(sim.gatheringGoal).toBeNull();
  });
});

describe('inspect: read-only projection, no goal yet', () => {
  it('reports null when nothing has been tracked', () => {
    const sim = makeSim();
    const reply = executeGatheringGoalCommand(sim, VALID_INSPECT);
    expect(reply).toEqual({ ok: true, verb: 'inspect', goal: null });
  });
});

describe('track_recipe: a real goal change, never a projection shortcut', () => {
  it('tracks a real recipe at the batch ceiling (50) with no materials held', () => {
    const sim = makeSim();
    const preferenceBefore = sim.harvestPreferenceFor(sim.playerId);
    const tickBefore = sim.tickCount;
    const timeBefore = sim.time;

    const reply = executeGatheringGoalCommand(sim, {
      cmd: 'gathering_goal',
      verb: 'track_recipe',
      recipeId: 'recipe_tough_jerky',
      count: 50,
    });

    expect(expectOk(reply).verb).toBe('track_recipe');
    expect(expectOk(reply).goal?.goal).toEqual({
      kind: 'recipe',
      recipeId: 'recipe_tough_jerky',
      count: 50,
    });
    // Tracking is a goal-selection write, not a material grant or a station/
    // save/tick side effect.
    expect(sim.tickCount).toBe(tickBefore);
    expect(sim.time).toBe(timeBefore);
    expect(sim.harvestPreferenceFor(sim.playerId)).toEqual(preferenceBefore);
  });

  it('retracking the exact same recipe/count is a valid success, not a refusal', () => {
    const sim = makeSim();
    executeGatheringGoalCommand(sim, VALID_TRACK_RECIPE);
    const reply = executeGatheringGoalCommand(sim, VALID_TRACK_RECIPE);
    expect(expectOk(reply).goal?.goal).toEqual({
      kind: 'recipe',
      recipeId: 'recipe_tough_jerky',
      count: 5,
    });
  });

  it('an out-of-range count is refused at parse time, leaving the prior goal untouched', () => {
    const sim = makeSim();
    executeGatheringGoalCommand(sim, VALID_TRACK_RECIPE);
    const reply = executeGatheringGoalCommand(sim, { ...VALID_TRACK_RECIPE, count: 0 });
    expect(reply).toEqual({ ok: false, reason: 'invalid_request' });
    const after = executeGatheringGoalCommand(sim, VALID_INSPECT);
    expect(expectOk(after).goal?.goal).toEqual({
      kind: 'recipe',
      recipeId: 'recipe_tough_jerky',
      count: 5,
    });
  });

  it('refuses tracking_refused for a recipe id that names no real recipe', () => {
    const sim = makeSim();
    const reply = executeGatheringGoalCommand(sim, {
      cmd: 'gathering_goal',
      verb: 'track_recipe',
      recipeId: 'not_a_real_recipe',
      count: 1,
    });
    expect(reply).toMatchObject({ ok: false, verb: 'track_recipe', reason: 'tracking_refused' });
    expect(sim.gatheringGoal).toBeNull();
  });
});

describe('track_commission: real accepted-order identity, never a recreated authority gate', () => {
  it('tracks a live order this (default, primary) player really accepted as the crafter', () => {
    const sim = makeSim();
    const requester = sim.addPlayer('warrior', 'Requester');
    // Commission opt-in is equipment-only (weapon/armor/held_offhand):
    // recipe_eastbrook_arming_sword outputs a real weapon, unlike the
    // consumable recipe_tough_jerky used above. The headless surface always
    // acts as the sim's default (primary) player, so the primary is seated
    // as the ACCEPTER here, never the requester.
    sim.openCommissionOrder('recipe_eastbrook_arming_sword', 'open', undefined, requester);
    const orderId = sim.commissionOrderBoard[0].id;
    sim.acceptCommissionOrder(orderId, sim.playerId);

    const reply = executeGatheringGoalCommand(sim, {
      cmd: 'gathering_goal',
      verb: 'track_commission',
      orderId,
    });
    expect(expectOk(reply).verb).toBe('track_commission');
    expect(expectOk(reply).goal?.goal).toEqual({
      kind: 'commission',
      recipeId: 'recipe_eastbrook_arming_sword',
      orderId,
      count: 1,
    });
  });

  it('refuses tracking_refused for the requester of an order this (default, primary) player never accepted', () => {
    const sim = makeSim();
    const crafter = sim.addPlayer('warrior', 'Crafty');
    sim.openCommissionOrder('recipe_eastbrook_arming_sword', 'open', undefined, sim.playerId);
    const orderId = sim.commissionOrderBoard[0].id;
    sim.acceptCommissionOrder(orderId, crafter);

    const reply = executeGatheringGoalCommand(sim, {
      cmd: 'gathering_goal',
      verb: 'track_commission',
      orderId,
    });
    expect(reply).toMatchObject({ ok: false, reason: 'tracking_refused' });
    expect(sim.gatheringGoal).toBeNull();
  });

  it('refuses tracking_refused for an order id naming no real order', () => {
    const sim = makeSim();
    const reply = executeGatheringGoalCommand(sim, {
      cmd: 'gathering_goal',
      verb: 'track_commission',
      orderId: 999999,
    });
    expect(reply).toEqual({
      ok: false,
      verb: 'track_commission',
      goal: null,
      reason: 'tracking_refused',
    });
    expect(sim.gatheringGoal).toBeNull();
  });
});

describe('clear: always a real, unconditional success', () => {
  it('clears a tracked goal back to null', () => {
    const sim = makeSim();
    executeGatheringGoalCommand(sim, VALID_TRACK_RECIPE);
    const reply = executeGatheringGoalCommand(sim, VALID_CLEAR);
    expect(reply).toEqual({ ok: true, verb: 'clear', goal: null });
    expect(sim.gatheringGoal).toBeNull();
  });

  it('clearing with no goal tracked is still a real success', () => {
    const sim = makeSim();
    const reply = executeGatheringGoalCommand(sim, VALID_CLEAR);
    expect(reply).toEqual({ ok: true, verb: 'clear', goal: null });
  });

  it('never advances sim time or touches the harvest preference', () => {
    const sim = makeSim();
    const preferenceBefore = sim.harvestPreferenceFor(sim.playerId);
    executeGatheringGoalCommand(sim, VALID_TRACK_RECIPE);
    const tickBefore = sim.tickCount;
    const timeBefore = sim.time;
    executeGatheringGoalCommand(sim, VALID_CLEAR);
    expect(sim.tickCount).toBe(tickBefore);
    expect(sim.time).toBe(timeBefore);
    expect(sim.harvestPreferenceFor(sim.playerId)).toEqual(preferenceBefore);
  });
});
