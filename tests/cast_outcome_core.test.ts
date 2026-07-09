import { describe, expect, it } from 'vitest';
import {
  activeCastOutcome,
  clearCastOutcomeEntity,
  createCastOutcomeTracker,
  noteCastHidden,
  noteCastStart,
  noteCastStop,
  noteCastVisible,
  pruneExpiredCastOutcomes,
  reconcileCastOutcomeEntities,
  resetCastOutcomeTracker,
} from '../src/ui/cast_outcome_core';

const DURATIONS = { successMs: 350, failureMs: 550 };
const label = (abilityId: string) => `label:${abilityId}`;

describe('cast outcome core', () => {
  it('records and maintains the current visible cast label', () => {
    const tracker = createCastOutcomeTracker();

    noteCastVisible(tracker, 7, 'fireball');
    noteCastVisible(tracker, 7, 'frostbolt');
    noteCastStop(tracker, 7, true, 100, DURATIONS);

    expect(activeCastOutcome(tracker, 7, 101, label)).toEqual({
      kind: 'success',
      label: 'label:frostbolt',
    });
  });

  it('shows Complete only from castStop success true', () => {
    const tracker = createCastOutcomeTracker();

    noteCastStart(tracker, 3, 'fireball');
    noteCastStop(tracker, 3, true, 10, DURATIONS);

    expect(activeCastOutcome(tracker, 3, 11, label)).toEqual({
      kind: 'success',
      label: 'label:fireball',
    });
  });

  it('maps castStop success false to Interrupted', () => {
    const tracker = createCastOutcomeTracker();

    noteCastStart(tracker, 4, 'fireball');
    noteCastStop(tracker, 4, false, 10, DURATIONS);

    expect(activeCastOutcome(tracker, 4, 11, label)).toEqual({
      kind: 'interrupted',
      label: 'label:fireball',
    });
  });

  it('clears a hidden cast without a castStop and does not start success', () => {
    const tracker = createCastOutcomeTracker();

    noteCastVisible(tracker, 8, 'shadow_bolt');
    noteCastHidden(tracker, 8);

    expect(activeCastOutcome(tracker, 8, 20, label)).toBeUndefined();
  });

  it('prunes expired outcomes', () => {
    const tracker = createCastOutcomeTracker();

    noteCastStart(tracker, 1, 'fireball');
    noteCastStop(tracker, 1, true, 100, DURATIONS);
    pruneExpiredCastOutcomes(tracker, 451);

    expect(activeCastOutcome(tracker, 1, 451, label)).toBeUndefined();
    expect(tracker.outcomesByEntity.size).toBe(0);
  });

  it('death cleanup removes labels and outcomes', () => {
    const tracker = createCastOutcomeTracker();

    noteCastVisible(tracker, 2, 'fireball');
    noteCastStop(tracker, 2, true, 10, DURATIONS);
    clearCastOutcomeEntity(tracker, 2);

    expect(tracker.labelsByEntity.has(2)).toBe(false);
    expect(tracker.outcomesByEntity.has(2)).toBe(false);
  });

  it('leave-interest cleanup removes labels and outcomes', () => {
    const tracker = createCastOutcomeTracker();

    noteCastVisible(tracker, 5, 'fireball');
    noteCastStart(tracker, 6, 'frostbolt');
    noteCastStop(tracker, 6, true, 10, DURATIONS);
    reconcileCastOutcomeEntities(tracker, new Set([5]));

    expect(tracker.labelsByEntity.has(5)).toBe(true);
    expect(tracker.outcomesByEntity.has(6)).toBe(false);
  });

  it('world reset cleanup removes all labels and outcomes', () => {
    const tracker = createCastOutcomeTracker();

    noteCastVisible(tracker, 5, 'fireball');
    noteCastStart(tracker, 6, 'frostbolt');
    noteCastStop(tracker, 6, true, 10, DURATIONS);
    resetCastOutcomeTracker(tracker);

    expect(tracker.labelsByEntity.size).toBe(0);
    expect(tracker.outcomesByEntity.size).toBe(0);
  });

  it('does not let a stale label later create Complete', () => {
    const tracker = createCastOutcomeTracker();

    noteCastVisible(tracker, 9, 'pyroblast');
    noteCastHidden(tracker, 9);
    noteCastStop(tracker, 9, true, 100, DURATIONS);

    expect(activeCastOutcome(tracker, 9, 101, label)).toBeUndefined();
  });
});
