import { describe, expect, it } from 'vitest';
import type { WorldQuestProgress } from '../src/sim/types';
import {
  WORLD_QUEST_LEY_FX_LIMIT,
  worldQuestLeyOutcomeEffects,
} from '../src/ui/world_quest_ley_fx_view';
import {
  applyWorldQuestLeyRotation,
  resolveWorldQuestLeyState,
  setWorldQuestLeyOutcome,
} from '../src/ui/world_quest_ley_view';

const questId = 'wq_galecrest_wisps';
const active: WorldQuestProgress = {
  questId,
  state: 'active',
  count: 0,
  puzzleVariant: 0,
  puzzleExpiresAt: 90,
};

describe('Ley presentation state', () => {
  it('accepts final receipts after a stripped completed snapshot and ignores them after done', () => {
    let state = resolveWorldQuestLeyState(questId, active, 0, null);
    state = resolveWorldQuestLeyState(questId, { questId, state: 'completed', count: 1 }, 0, state);
    for (const [tileIndex, rotation] of [
      [1, 1],
      [2, 1],
      [3, 1],
      [4, 3],
    ]) {
      state = applyWorldQuestLeyRotation(state, { questId, tileIndex, rotation });
    }
    expect(state?.outcome).toBe('won');
    expect(state?.board?.solved).toBe(true);
    state = setWorldQuestLeyOutcome(state, 'won');
    expect(applyWorldQuestLeyRotation(state, { questId, tileIndex: 3, rotation: 0 })).toBe(state);
    expect(resolveWorldQuestLeyState(questId, active, 0, state)).toBe(state);
    expect(setWorldQuestLeyOutcome(state, 'lost')).toBe(state);
  });
  it('does not fabricate a board when opened after completion', () => {
    const state = resolveWorldQuestLeyState(
      questId,
      { questId, state: 'completed', count: 1 },
      0,
      null,
    );
    expect(state?.outcome).toBe('won');
    expect(state?.board).toBeNull();
  });
  it('rejects unrelated and invalid receipts without mutating observed progress', () => {
    const state = resolveWorldQuestLeyState(questId, active, 0, null);
    for (const receipt of [
      { questId: 'other', tileIndex: 0, rotation: 1 },
      { questId, tileIndex: -1, rotation: 1 },
      { questId, tileIndex: 9, rotation: 1 },
      { questId, tileIndex: 0, rotation: 4 },
    ])
      expect(applyWorldQuestLeyRotation(state, receipt)).toBe(state);
    expect(active.puzzleRotations).toBeUndefined();
  });
  it('derives loss and a fresh retry from authoritative deadlines', () => {
    const expired = resolveWorldQuestLeyState(questId, active, 90, null);
    expect(expired?.outcome).toBe('lost');
    expect(expired?.secondsRemaining).toBe(0);

    const retried = resolveWorldQuestLeyState(
      questId,
      { ...active, puzzleExpiresAt: 180 },
      90,
      expired,
    );
    expect(retried?.outcome).toBe('playing');
    expect(retried?.secondsRemaining).toBe(90);
  });
});

describe('Ley outcome effects', () => {
  it('makes victory longer and richer than defeat with a finite budget', () => {
    const victory = worldQuestLeyOutcomeEffects('won');
    const defeat = worldQuestLeyOutcomeEffects('lost');
    expect(victory.length).toBeGreaterThan(defeat.length);
    expect(victory.length).toBeLessThanOrEqual(WORLD_QUEST_LEY_FX_LIMIT);
    expect(Math.max(...victory.map((fx) => fx.delay + fx.duration))).toBeGreaterThan(5000);
    expect(Math.max(...defeat.map((fx) => fx.delay + fx.duration))).toBeLessThanOrEqual(1800);
    expect(defeat.some((fx) => fx.kind === 'star' || fx.kind === 'ray')).toBe(false);
    expect(worldQuestLeyOutcomeEffects('playing')).toEqual([]);
    for (const fx of [...victory, ...defeat])
      for (const [key, value] of Object.entries(fx)) {
        if (key !== 'kind') expect(Number.isFinite(value)).toBe(true);
      }
  });
});
