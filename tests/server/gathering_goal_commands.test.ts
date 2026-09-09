// Intentional Gathering PR4: pure boundary validators for the three
// gathering-goal wire commands (server/gathering_goal_commands.ts), the
// corpse_harvest_commands.ts precedent, plus a bounded real-Sim wire
// roundtrip (command helper -> Sim -> appendGatheringGoalSelfWire ->
// decodeGatheringGoalWire) proving owner isolation end to end.

import { describe, expect, it, vi } from 'vitest';
import {
  clearGatheringGoalCommandOutcome,
  dispatchGatheringGoalCommand,
  trackGatheringCommissionCommandOutcome,
  trackGatheringRecipeCommandOutcome,
  validClearGatheringGoalCommand,
  validTrackGatheringCommissionCommand,
  validTrackGatheringRecipeCommand,
} from '../../server/gathering_goal_commands';
import { appendGatheringGoalSelfWire } from '../../server/gathering_goal_wire';
import { decodeGatheringGoalWire } from '../../src/net/gathering_goal_wire';
import { Sim } from '../../src/sim/sim';

describe('validTrackGatheringRecipeCommand', () => {
  it('accepts a printable bounded recipe id with a safe integer count in [1, 50]', () => {
    expect(validTrackGatheringRecipeCommand({ recipe: 'recipe_forge_1', count: 1 })).toBe(true);
    expect(validTrackGatheringRecipeCommand({ recipe: 'recipe_forge_1', count: 50 })).toBe(true);
  });

  it('accepts the real transport envelope: t/cmd always, rid only when correlated', () => {
    expect(
      validTrackGatheringRecipeCommand({
        t: 'cmd',
        cmd: 'track_gathering_recipe',
        recipe: 'recipe_forge_1',
        count: 1,
      }),
    ).toBe(true);
    expect(
      validTrackGatheringRecipeCommand({
        t: 'cmd',
        cmd: 'track_gathering_recipe',
        recipe: 'recipe_forge_1',
        count: 1,
        rid: 7,
      }),
    ).toBe(true);
  });

  it.each([
    ['recipe missing', {}],
    ['recipe not a string', { recipe: 42, count: 1 }],
    ['recipe empty', { recipe: '', count: 1 }],
    ['recipe not printable-bounded (space)', { recipe: 'two words', count: 1 }],
    ['recipe not printable-bounded (newline)', { recipe: 'line\nbreak', count: 1 }],
    ['recipe overlong', { recipe: 'r'.repeat(129), count: 1 }],
    ['count missing', { recipe: 'r' }],
    ['count zero', { recipe: 'r', count: 0 }],
    ['count negative', { recipe: 'r', count: -1 }],
    ['count non-integer', { recipe: 'r', count: 1.5 }],
    ['count NaN', { recipe: 'r', count: Number.NaN }],
    ['count Infinity', { recipe: 'r', count: Infinity }],
    ['count oversized', { recipe: 'r', count: 51 }],
    ['count a string', { recipe: 'r', count: '1' }],
    ['an extra, unknown field (a forged pid)', { recipe: 'r', count: 1, pid: 999999 }],
    ['an extra, unknown field (a forged order)', { recipe: 'r', count: 1, order: 5 }],
  ])('refuses %s', (_label, msg) => {
    expect(validTrackGatheringRecipeCommand(msg)).toBe(false);
  });
});

describe('validTrackGatheringCommissionCommand', () => {
  it('accepts a positive safe integer order id', () => {
    expect(validTrackGatheringCommissionCommand({ order: 1 })).toBe(true);
    expect(validTrackGatheringCommissionCommand({ order: Number.MAX_SAFE_INTEGER })).toBe(true);
  });

  it('accepts the real transport envelope: t/cmd always, rid only when correlated', () => {
    expect(
      validTrackGatheringCommissionCommand({
        t: 'cmd',
        cmd: 'track_gathering_commission',
        order: 1,
      }),
    ).toBe(true);
    expect(
      validTrackGatheringCommissionCommand({
        t: 'cmd',
        cmd: 'track_gathering_commission',
        order: 1,
        rid: 3,
      }),
    ).toBe(true);
  });

  it.each([
    ['order missing', {}],
    ['order zero', { order: 0 }],
    ['order negative', { order: -1 }],
    ['order non-integer', { order: 1.5 }],
    ['order NaN', { order: Number.NaN }],
    ['order not a safe integer', { order: Number.MAX_SAFE_INTEGER + 1 }],
    ['order a string', { order: '7' }],
    ['an extra, unknown field (a forged pid)', { order: 1, pid: 999999 }],
    ['a recipe override riding the commission frame', { order: 1, recipe: 'recipe_forge_1' }],
  ])('refuses %s', (_label, msg) => {
    expect(validTrackGatheringCommissionCommand(msg)).toBe(false);
  });
});

describe('validClearGatheringGoalCommand', () => {
  it('accepts the bare envelope: no payload fields, t/cmd/rid tolerated', () => {
    expect(validClearGatheringGoalCommand({})).toBe(true);
    expect(validClearGatheringGoalCommand({ t: 'cmd', cmd: 'clear_gathering_goal' })).toBe(true);
    expect(validClearGatheringGoalCommand({ t: 'cmd', cmd: 'clear_gathering_goal', rid: 4 })).toBe(
      true,
    );
  });

  it('refuses any payload field at all (clear carries none)', () => {
    expect(validClearGatheringGoalCommand({ pid: 999999 })).toBe(false);
    expect(validClearGatheringGoalCommand({ recipe: 'recipe_forge_1' })).toBe(false);
  });
});

describe('trackGatheringRecipeCommandOutcome', () => {
  it('calls sim.trackGatheringRecipe with the session pid on a valid frame', () => {
    const trackGatheringRecipe = vi.fn(() => true);
    const outcome = trackGatheringRecipeCommandOutcome(
      { trackGatheringRecipe },
      { recipe: 'recipe_forge_1', count: 5 },
      9,
    );
    expect(outcome).toBe(true);
    expect(trackGatheringRecipe).toHaveBeenCalledTimes(1);
    expect(trackGatheringRecipe).toHaveBeenCalledWith('recipe_forge_1', 5, 9);
  });

  it('never calls the sim, and leaves the goal untouched, on an invalid frame', () => {
    const trackGatheringRecipe = vi.fn(() => true);
    const outcome = trackGatheringRecipeCommandOutcome(
      { trackGatheringRecipe },
      { recipe: 'recipe_forge_1', count: 0 },
      9,
    );
    expect(outcome).toBe(false);
    expect(trackGatheringRecipe).not.toHaveBeenCalled();
  });

  it('never calls the sim when the payload carries a forged pid', () => {
    const trackGatheringRecipe = vi.fn(() => true);
    const forged: Record<string, unknown> = { recipe: 'recipe_forge_1', count: 5, pid: 999999 };
    const outcome = trackGatheringRecipeCommandOutcome({ trackGatheringRecipe }, forged, 9);
    expect(outcome).toBe(false);
    expect(trackGatheringRecipe).not.toHaveBeenCalled();
  });
});

describe('trackGatheringCommissionCommandOutcome', () => {
  it('calls sim.trackGatheringCommission with the session pid on a valid frame', () => {
    const trackGatheringCommission = vi.fn(() => true);
    const outcome = trackGatheringCommissionCommandOutcome(
      { trackGatheringCommission },
      { order: 42 },
      9,
    );
    expect(outcome).toBe(true);
    expect(trackGatheringCommission).toHaveBeenCalledTimes(1);
    expect(trackGatheringCommission).toHaveBeenCalledWith(42, 9);
  });

  it('never calls the sim on an invalid frame', () => {
    const trackGatheringCommission = vi.fn(() => true);
    const outcome = trackGatheringCommissionCommandOutcome(
      { trackGatheringCommission },
      { order: -1 },
      9,
    );
    expect(outcome).toBe(false);
    expect(trackGatheringCommission).not.toHaveBeenCalled();
  });

  it('never calls the sim when a recipe override rides the commission frame', () => {
    const trackGatheringCommission = vi.fn(() => true);
    const forged: Record<string, unknown> = { order: 42, recipe: 'recipe_forge_1' };
    const outcome = trackGatheringCommissionCommandOutcome({ trackGatheringCommission }, forged, 9);
    expect(outcome).toBe(false);
    expect(trackGatheringCommission).not.toHaveBeenCalled();
  });
});

describe('clearGatheringGoalCommandOutcome', () => {
  it('calls sim.clearGatheringGoal with the session pid on the bare envelope', () => {
    const clearGatheringGoal = vi.fn();
    const outcome = clearGatheringGoalCommandOutcome({ clearGatheringGoal }, {}, 9);
    expect(outcome).toBe(true);
    expect(clearGatheringGoal).toHaveBeenCalledTimes(1);
    expect(clearGatheringGoal).toHaveBeenCalledWith(9);
  });

  it('never calls the sim when the frame carries an unexpected payload field', () => {
    const clearGatheringGoal = vi.fn();
    const forged: Record<string, unknown> = { pid: 999999 };
    const outcome = clearGatheringGoalCommandOutcome({ clearGatheringGoal }, forged, 9);
    expect(outcome).toBe(false);
    expect(clearGatheringGoal).not.toHaveBeenCalled();
  });
});

describe('dispatchGatheringGoalCommand', () => {
  // Each case must invoke ONLY its own matching validator/action pair: a fake
  // sim exposing all three methods proves the other two never fire, so the
  // fold in game.ts cannot cross-wire a label to the wrong command body.
  it('routes track_gathering_recipe to trackGatheringRecipe alone', () => {
    const trackGatheringRecipe = vi.fn(() => true);
    const trackGatheringCommission = vi.fn(() => true);
    const clearGatheringGoal = vi.fn();
    const outcome = dispatchGatheringGoalCommand(
      { trackGatheringRecipe, trackGatheringCommission, clearGatheringGoal },
      'track_gathering_recipe',
      { recipe: 'recipe_forge_1', count: 5 },
      9,
    );
    expect(outcome).toBe(true);
    expect(trackGatheringRecipe).toHaveBeenCalledTimes(1);
    expect(trackGatheringRecipe).toHaveBeenCalledWith('recipe_forge_1', 5, 9);
    expect(trackGatheringCommission).not.toHaveBeenCalled();
    expect(clearGatheringGoal).not.toHaveBeenCalled();
  });

  it('routes track_gathering_commission to trackGatheringCommission alone', () => {
    const trackGatheringRecipe = vi.fn(() => true);
    const trackGatheringCommission = vi.fn(() => true);
    const clearGatheringGoal = vi.fn();
    const outcome = dispatchGatheringGoalCommand(
      { trackGatheringRecipe, trackGatheringCommission, clearGatheringGoal },
      'track_gathering_commission',
      { order: 42 },
      9,
    );
    expect(outcome).toBe(true);
    expect(trackGatheringCommission).toHaveBeenCalledTimes(1);
    expect(trackGatheringCommission).toHaveBeenCalledWith(42, 9);
    expect(trackGatheringRecipe).not.toHaveBeenCalled();
    expect(clearGatheringGoal).not.toHaveBeenCalled();
  });

  it('routes clear_gathering_goal to clearGatheringGoal alone', () => {
    const trackGatheringRecipe = vi.fn(() => true);
    const trackGatheringCommission = vi.fn(() => true);
    const clearGatheringGoal = vi.fn();
    const outcome = dispatchGatheringGoalCommand(
      { trackGatheringRecipe, trackGatheringCommission, clearGatheringGoal },
      'clear_gathering_goal',
      {},
      9,
    );
    expect(outcome).toBe(true);
    expect(clearGatheringGoal).toHaveBeenCalledTimes(1);
    expect(clearGatheringGoal).toHaveBeenCalledWith(9);
    expect(trackGatheringRecipe).not.toHaveBeenCalled();
    expect(trackGatheringCommission).not.toHaveBeenCalled();
  });

  it('refuses (and calls no sim method) when the routed label carries a malformed passenger frame', () => {
    const trackGatheringRecipe = vi.fn(() => true);
    const trackGatheringCommission = vi.fn(() => true);
    const clearGatheringGoal = vi.fn();
    const forged: Record<string, unknown> = { recipe: 'recipe_forge_1', count: 5, pid: 999999 };
    const outcome = dispatchGatheringGoalCommand(
      { trackGatheringRecipe, trackGatheringCommission, clearGatheringGoal },
      'track_gathering_recipe',
      forged,
      9,
    );
    expect(outcome).toBe(false);
    expect(trackGatheringRecipe).not.toHaveBeenCalled();
    expect(trackGatheringCommission).not.toHaveBeenCalled();
    expect(clearGatheringGoal).not.toHaveBeenCalled();
  });

  it('refuses clear_gathering_goal when an unexpected payload field rides the bare envelope', () => {
    const trackGatheringRecipe = vi.fn(() => true);
    const trackGatheringCommission = vi.fn(() => true);
    const clearGatheringGoal = vi.fn();
    const forged: Record<string, unknown> = { pid: 999999 };
    const outcome = dispatchGatheringGoalCommand(
      { trackGatheringRecipe, trackGatheringCommission, clearGatheringGoal },
      'clear_gathering_goal',
      forged,
      9,
    );
    expect(outcome).toBe(false);
    expect(clearGatheringGoal).not.toHaveBeenCalled();
    expect(trackGatheringRecipe).not.toHaveBeenCalled();
    expect(trackGatheringCommission).not.toHaveBeenCalled();
  });
});

// --- bounded real-Sim wire roundtrip: command helper -> Sim -> ------------
// --- appendGatheringGoalSelfWire -> decodeGatheringGoalWire ---------------
//
// A common (grandfathered, no acquisition gate) recipe so a fresh two-player
// Sim needs no material/skill setup for a deterministic non-null projection;
// the exact material/status arithmetic is gathering_goal_runtime.test.ts's
// scope, not this file's. This suite proves only the WIRE path: what the
// command helper writes is exactly what appendGatheringGoalSelfWire emits and
// decodeGatheringGoalWire reads back, per player, with no cross-player leak
// and no forged-field influence.
describe('two-player wire roundtrip: command helper -> Sim -> appendGatheringGoalSelfWire -> decode', () => {
  const RECIPE_ID = 'recipe_eastbrook_arming_sword';

  function makeTwoPlayerSim() {
    const sim = new Sim({ seed: 11, playerClass: 'warrior', autoEquip: false, noPlayer: true });
    const pidA = sim.addPlayer('warrior', 'Ayla');
    const pidB = sim.addPlayer('warrior', 'Borin');
    return { sim, pidA, pidB };
  }

  function wireValueFor(sim: Sim, pid: number): unknown {
    const captured: Record<string, unknown> = {};
    appendGatheringGoalSelfWire(sim, pid, (key, value) => {
      captured[key] = value;
    });
    return captured.ggoal;
  }

  it('tracks only the authenticated pid; the wire roundtrip matches the direct read exactly', () => {
    const { sim, pidA, pidB } = makeTwoPlayerSim();

    const outcome = trackGatheringRecipeCommandOutcome(sim, { recipe: RECIPE_ID, count: 3 }, pidA);
    expect(outcome).toBe(true);

    const direct = sim.gatheringGoalFor(pidA);
    expect(direct).not.toBeNull();
    expect(direct?.goal).toEqual({ kind: 'recipe', recipeId: RECIPE_ID, count: 3 });
    expect(decodeGatheringGoalWire(wireValueFor(sim, pidA))).toEqual(direct);

    // The second, uninvolved player never sees pidA's goal, on either read path.
    expect(sim.gatheringGoalFor(pidB)).toBeNull();
    expect(decodeGatheringGoalWire(wireValueFor(sim, pidB))).toBeNull();
  });

  it('a spoofed pid on the payload refuses the command; neither player is affected', () => {
    const { sim, pidA, pidB } = makeTwoPlayerSim();
    const forged: Record<string, unknown> = { recipe: RECIPE_ID, count: 1, pid: pidB };

    const outcome = trackGatheringRecipeCommandOutcome(sim, forged, pidA);

    expect(outcome).toBe(false);
    expect(sim.gatheringGoalFor(pidA)).toBeNull();
    expect(sim.gatheringGoalFor(pidB)).toBeNull();
    expect(decodeGatheringGoalWire(wireValueFor(sim, pidA))).toBeNull();
    expect(decodeGatheringGoalWire(wireValueFor(sim, pidB))).toBeNull();
  });

  it('commission metadata forged onto a recipe track cannot cross into a commission binding', () => {
    const { sim, pidA } = makeTwoPlayerSim();
    const forged: Record<string, unknown> = { recipe: RECIPE_ID, count: 1, order: 1 };

    const outcome = trackGatheringRecipeCommandOutcome(sim, forged, pidA);

    expect(outcome).toBe(false);
    expect(sim.gatheringGoalFor(pidA)).toBeNull();
  });

  it('an explicit clear emits null for that owner while the second owner is unaffected', () => {
    const { sim, pidA, pidB } = makeTwoPlayerSim();
    expect(trackGatheringRecipeCommandOutcome(sim, { recipe: RECIPE_ID, count: 2 }, pidA)).toBe(
      true,
    );
    expect(trackGatheringRecipeCommandOutcome(sim, { recipe: RECIPE_ID, count: 5 }, pidB)).toBe(
      true,
    );

    expect(clearGatheringGoalCommandOutcome(sim, {}, pidA)).toBe(true);

    expect(sim.gatheringGoalFor(pidA)).toBeNull();
    expect(decodeGatheringGoalWire(wireValueFor(sim, pidA))).toBeNull();

    const bDirect = sim.gatheringGoalFor(pidB);
    expect(bDirect).not.toBeNull();
    expect(bDirect?.goal).toEqual({ kind: 'recipe', recipeId: RECIPE_ID, count: 5 });
    expect(decodeGatheringGoalWire(wireValueFor(sim, pidB))).toEqual(bDirect);
  });
});
