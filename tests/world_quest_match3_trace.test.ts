import { describe, expect, it } from 'vitest';
import type { WorldQuestMatch3LevelDef } from '../src/sim/types';
import {
  applyWorldQuestMatch3Move,
  traceWorldQuestMatch3Move,
  type WorldQuestMatch3CascadeStage,
} from '../src/sim/world_quest_match3';

function gravityLevel(): WorldQuestMatch3LevelDef {
  return {
    columns: 3,
    rows: 4,
    board: [1, 2, 3, 2, 3, 4, 0, 1, 0, 3, 0, 2],
    refill: [4, 0, 1, 2, 3],
    target: 30,
    maxMoves: 20,
  };
}

function cascadeLevel(): WorldQuestMatch3LevelDef {
  return {
    columns: 4,
    rows: 4,
    board: [4, 0, 1, 2, 3, 1, 4, 4, 1, 3, 3, 4, 0, 2, 4, 2],
    refill: [0, 1, 2, 3, 4],
    target: 30,
    maxMoves: 20,
  };
}

describe('world quest match-three display traces', () => {
  it('records the accepted swap, exact clear, moving survivors and ordered refill pieces', () => {
    const level = gravityLevel();
    const trace = traceWorldQuestMatch3Move(level, level.board, 7, 10, 0);
    const swapped = [1, 2, 3, 2, 3, 4, 0, 0, 0, 3, 1, 2];
    const resolved = [4, 0, 1, 1, 2, 3, 2, 3, 4, 3, 1, 2];
    expect(trace).toEqual({
      result: { accepted: true, board: resolved, cleared: 3, refillIndex: 3 },
      stages: [
        { kind: 'swap', fromIndex: 7, toIndex: 10, board: swapped },
        {
          kind: 'cascade',
          before: swapped,
          matchedIndices: [6, 7, 8],
          falls: [
            { candy: 2, fromIndex: 3, toIndex: 6 },
            { candy: 1, fromIndex: 0, toIndex: 3 },
            { candy: 3, fromIndex: 4, toIndex: 7 },
            { candy: 2, fromIndex: 1, toIndex: 4 },
            { candy: 4, fromIndex: 5, toIndex: 8 },
            { candy: 3, fromIndex: 2, toIndex: 5 },
          ],
          refills: [
            { candy: 4, index: 0 },
            { candy: 0, index: 1 },
            { candy: 1, index: 2 },
          ],
          after: resolved,
        },
      ],
    });
  });

  it('keeps subsequent cascades separate and reconstructs their complete boards', () => {
    const level = cascadeLevel();
    const trace = traceWorldQuestMatch3Move(level, level.board, 14, 15, 0);
    const cascades = trace.stages.filter(
      (stage): stage is WorldQuestMatch3CascadeStage => stage.kind === 'cascade',
    );
    expect(cascades.map((stage) => stage.matchedIndices)).toEqual([
      [7, 11, 15],
      [13, 14, 15],
    ]);
    expect(cascades[0].falls).toEqual([{ candy: 2, fromIndex: 3, toIndex: 15 }]);
    expect(cascades[0].refills).toEqual([
      { candy: 0, index: 3 },
      { candy: 1, index: 7 },
      { candy: 2, index: 11 },
    ]);
    expect(cascades[1].refills).toEqual([
      { candy: 3, index: 1 },
      { candy: 4, index: 2 },
      { candy: 0, index: 3 },
    ]);
    expect(cascades[1].before).toEqual(cascades[0].after);
    for (const stage of cascades) {
      const reconstructed: Array<number | null> = [...stage.before];
      for (const index of stage.matchedIndices) reconstructed[index] = null;
      for (const fall of stage.falls) {
        expect(stage.before[fall.fromIndex]).toBe(fall.candy);
        expect(stage.matchedIndices).not.toContain(fall.fromIndex);
        expect(fall.toIndex % level.columns).toBe(fall.fromIndex % level.columns);
        expect(fall.toIndex).toBeGreaterThan(fall.fromIndex);
        reconstructed[fall.fromIndex] = null;
      }
      for (const fall of stage.falls) reconstructed[fall.toIndex] = fall.candy;
      for (const refill of stage.refills) {
        expect(reconstructed[refill.index]).toBeNull();
        reconstructed[refill.index] = refill.candy;
      }
      expect(reconstructed).toEqual(stage.after);
      expect(stage.refills).toHaveLength(stage.matchedIndices.length);
    }
    expect(trace.result).toEqual({
      accepted: true,
      board: [4, 3, 4, 0, 3, 0, 1, 0, 1, 1, 4, 1, 0, 3, 3, 2],
      cleared: 6,
      refillIndex: 6,
    });
    expect(cascades[1].after).toEqual(trace.result.board);
  });

  it.each([
    ['no matching line', 0, 1],
    ['same cell', 7, 7],
    ['row wrap', 2, 3],
    ['non-adjacent', 0, 10],
    ['negative cell', -1, 0],
    ['outside board', 10, 13],
    ['fractional cell', 7.5, 10],
    ['non-finite cell', Number.NaN, 10],
  ])('emits no stages for a rejected move: %s', (_reason, from, to) => {
    const level = gravityLevel();
    expect(traceWorldQuestMatch3Move(level, level.board, from, to, -5)).toEqual({
      result: { accepted: false, board: level.board, cleared: 0, refillIndex: -5 },
      stages: [],
    });
  });

  it('matches ordinary resolution for all fixture cell pairs and refill cursor edge cases', () => {
    let accepted = 0;
    let rejected = 0;
    for (const level of [gravityLevel(), cascadeLevel()]) {
      for (const current of [level.board, []]) {
        for (const refillIndex of [0, 7, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
          for (let from = -1; from <= level.board.length; from++) {
            for (let to = -1; to <= level.board.length; to++) {
              const trace = traceWorldQuestMatch3Move(level, current, from, to, refillIndex);
              expect(trace.result).toEqual(
                applyWorldQuestMatch3Move(level, current, from, to, refillIndex),
              );
              if (trace.result.accepted) {
                accepted++;
                expect(trace.stages.length).toBeGreaterThan(1);
              } else {
                rejected++;
                expect(trace.stages).toEqual([]);
              }
            }
          }
        }
      }
    }
    expect(accepted).toBeGreaterThan(0);
    expect(rejected).toBeGreaterThan(accepted);
  });

  it('never mutates input data and detaches every stage from the result and its neighbours', () => {
    const level = cascadeLevel();
    const original = structuredClone(level);
    Object.freeze(level.board);
    Object.freeze(level.refill);
    Object.freeze(level);
    const trace = traceWorldQuestMatch3Move(level, level.board, 14, 15, 0);
    const repeated = traceWorldQuestMatch3Move(level, level.board, 14, 15, 0);
    expect(trace).toEqual(repeated);
    const swap = trace.stages[0];
    const first = trace.stages[1];
    const last = trace.stages[2];
    if (swap.kind !== 'swap' || first.kind !== 'cascade' || last.kind !== 'cascade') {
      throw new Error('Expected a swap and two cascade stages');
    }
    swap.board[0] = 0;
    expect(first.before[0]).toBe(4);
    first.after[0] = 0;
    expect(last.before[0]).toBe(4);
    last.after[0] = 0;
    expect(trace.result).toEqual(repeated.result);
    expect(level).toEqual(original);
  });
});
