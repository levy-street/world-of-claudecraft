// The pending-learn tracker behind the train window's Learn flow (issue
// #2342): one flight per recipe (the double-submit guard), TTL expiry for
// answers lost to a disconnect, and the confirmed-grant overlay that bridges
// the gap between a trainResult ok and the knownRecipes mirror carrying the
// grant. Time is an explicit parameter, so every case drives the clock.
import { describe, expect, it } from 'vitest';
import { TRAIN_PENDING_TTL_MS, TrainLearnTracker } from '../src/ui/hud/vendor/train_learn_core';

const RECIPE = 'recipe_ironbound_warplate_helm';
const OTHER = 'recipe_volatile_flux_elixir';

describe('TrainLearnTracker flights (the double-submit guard)', () => {
  it('begin opens a flight once; a second begin while open is swallowed', () => {
    const tracker = new TrainLearnTracker();
    expect(tracker.begin(RECIPE, 1000)).toBe(true);
    expect(tracker.begin(RECIPE, 1001)).toBe(false); // the rapid double-click
    expect(tracker.pendingIds(1001).has(RECIPE)).toBe(true);
  });

  it('flights are per recipe: another recipe can open while the first is in flight', () => {
    const tracker = new TrainLearnTracker();
    expect(tracker.begin(RECIPE, 0)).toBe(true);
    expect(tracker.begin(OTHER, 0)).toBe(true);
    expect(tracker.pendingIds(0)).toEqual(new Set([RECIPE, OTHER]));
  });

  it('resolve closes the flight on ok AND on deny (the row re-enables after a deny)', () => {
    for (const ok of [true, false]) {
      const tracker = new TrainLearnTracker();
      tracker.begin(RECIPE, 0);
      tracker.resolve(RECIPE, ok);
      expect(tracker.pendingIds(1).has(RECIPE), `ok=${ok}`).toBe(false);
      // A fresh click may open a new flight after either outcome.
      expect(tracker.begin(RECIPE, 2), `ok=${ok}`).toBe(true);
    }
  });

  it('a flight expires at exactly TRAIN_PENDING_TTL_MS (a lost answer never wedges the row)', () => {
    const tracker = new TrainLearnTracker();
    tracker.begin(RECIPE, 1000);
    expect(tracker.pendingIds(1000 + TRAIN_PENDING_TTL_MS - 1).has(RECIPE)).toBe(true);
    expect(tracker.pendingIds(1000 + TRAIN_PENDING_TTL_MS).has(RECIPE)).toBe(false);
    // After expiry the click path may re-send (resolveTrain's deny order makes
    // the re-send charge-safe: train_already_known precedes any charging arm).
    expect(tracker.begin(RECIPE, 1000 + TRAIN_PENDING_TTL_MS)).toBe(true);
  });

  it('begin itself expires stale flights (the guard never reads a dead flight)', () => {
    const tracker = new TrainLearnTracker();
    tracker.begin(RECIPE, 0);
    // No pendingIds() read in between: begin at TTL must see the flight dead.
    expect(tracker.begin(RECIPE, TRAIN_PENDING_TTL_MS)).toBe(true);
  });
});

describe('TrainLearnTracker confirmed overlay (the mirror-lag bridge)', () => {
  it('an ok joins the overlay until the mirror carries the grant, then drops for good', () => {
    const tracker = new TrainLearnTracker();
    tracker.begin(RECIPE, 0);
    tracker.resolve(RECIPE, true);
    expect(tracker.confirmedIds([]).has(RECIPE)).toBe(true); // mirror not caught up
    expect(tracker.confirmedIds([RECIPE]).has(RECIPE)).toBe(false); // mirror carries it
    expect(tracker.confirmedIds([]).has(RECIPE)).toBe(false); // dropped permanently
  });

  it('a deny never joins the overlay', () => {
    const tracker = new TrainLearnTracker();
    tracker.begin(RECIPE, 0);
    tracker.resolve(RECIPE, false);
    expect(tracker.confirmedIds([]).size).toBe(0);
  });

  it('resolve without a begin still converges (results from another submit path)', () => {
    const tracker = new TrainLearnTracker();
    tracker.resolve(RECIPE, true);
    expect(tracker.confirmedIds([]).has(RECIPE)).toBe(true);
  });
});
