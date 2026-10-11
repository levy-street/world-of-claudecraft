import { describe, expect, it } from 'vitest';
import {
  generateDailyLeyChallenge,
  generateDailyLeyPuzzle,
  generateDailyMatch3Level,
  solveDailyMatch3Level,
  WORLD_QUEST_DAILY_GENERATION_CYCLE,
} from '../src/sim/world_quest_daily_generation';
import { applyWorldQuestMatch3Move, worldQuestMatch3Matches } from '../src/sim/world_quest_match3';
import {
  traceWorldQuestPuzzle,
  worldQuestPuzzleInitialRotations,
} from '../src/sim/world_quest_puzzle';

describe('daily procedural world quest levels', () => {
  it('retains 32 distinct days before repetition', () => {
    expect(WORLD_QUEST_DAILY_GENERATION_CYCLE).toBe(32);
  });

  it('certifies every ley variant with an unsolved start and a short winning rotation sequence', () => {
    for (let day = 0; day < WORLD_QUEST_DAILY_GENERATION_CYCLE; day++) {
      const { puzzle, solution } = generateDailyLeyChallenge(day);
      const initial = worldQuestPuzzleInitialRotations(puzzle);
      expect(traceWorldQuestPuzzle(puzzle, initial).solved).toBe(false);
      const solved = traceWorldQuestPuzzle(puzzle, solution);
      expect(solved.solved).toBe(true);
      expect(solved.path.length).toBeGreaterThanOrEqual(7);
      expect(solved.path.length).toBeLessThanOrEqual(10);
      expect(
        solved.path.filter((index) => puzzle.tiles[index].kind === 'corner').length,
      ).toBeGreaterThanOrEqual(3);
      expect(
        solution.reduce(
          (clicks, rotation, index) => clicks + ((rotation - initial[index] + 4) % 4),
          0,
        ),
      ).toBeLessThanOrEqual(30);
    }
  });

  it('changes the solved beam route every day, not just decoys and initial rotations', () => {
    const routes = new Set<string>();
    const sources = new Set<string>();
    const targets = new Set<string>();
    for (let day = 0; day < 32; day++) {
      const { puzzle, solution } = generateDailyLeyChallenge(day);
      const trace = traceWorldQuestPuzzle(puzzle, solution);
      expect(trace.solved).toBe(true);
      // Reversing the same route is not a genuinely new challenge either.
      routes.add([trace.path.join(','), [...trace.path].reverse().join(',')].sort()[0]);
      sources.add(JSON.stringify(puzzle.source));
      targets.add(JSON.stringify(puzzle.target));
    }
    expect(routes.size).toBe(32);
    expect(sources.size).toBeGreaterThanOrEqual(8);
    expect(targets.size).toBeGreaterThanOrEqual(8);
  });

  it('replays a winning match-three witness for every possible daily board', () => {
    for (let day = 0; day < WORLD_QUEST_DAILY_GENERATION_CYCLE; day++) {
      const level = generateDailyMatch3Level(day);
      expect(worldQuestMatch3Matches(level.board, level.columns, level.rows).size).toBe(0);
      const witness = solveDailyMatch3Level(level);
      expect(witness).not.toBeNull();
      let board = [...level.board];
      let refillIndex = 0;
      let cleared = 0;
      for (const [from, to] of witness ?? []) {
        const result = applyWorldQuestMatch3Move(level, board, from, to, refillIndex);
        expect(result.accepted).toBe(true);
        board = result.board;
        refillIndex = result.refillIndex;
        cleared += result.cleared;
      }
      expect(cleared).toBeGreaterThanOrEqual(72);
      expect(witness?.length).toBeLessThanOrEqual(level.maxMoves);
    }
  });

  it('changes actual layouts every day for the whole cycle, including its boundary', () => {
    const ley = new Set<string>();
    const candy = new Set<string>();
    for (let day = 0; day < WORLD_QUEST_DAILY_GENERATION_CYCLE; day++) {
      // A straight tile rotated by 180 degrees is the same playable layout.
      ley.add(
        JSON.stringify(
          generateDailyLeyPuzzle(day).tiles.map((tile) => ({
            kind: tile.kind,
            rotation: tile.initialRotation % (tile.kind === 'straight' ? 2 : 4),
          })),
        ),
      );
      // Normalize candy labels: a recoloring alone must not count as a new board.
      const colors: number[] = [];
      candy.add(
        generateDailyMatch3Level(day)
          .board.map((color) => {
            if (!colors.includes(color)) colors.push(color);
            return colors.indexOf(color);
          })
          .join(','),
      );
    }
    expect(ley.size).toBe(WORLD_QUEST_DAILY_GENERATION_CYCLE);
    expect(candy.size).toBe(WORLD_QUEST_DAILY_GENERATION_CYCLE);
  });

  it('is repeatable across hosts and retries without shared mutable generated state', () => {
    for (const day of [-1, 0, 1, 2950, Number.MAX_SAFE_INTEGER]) {
      expect(generateDailyLeyPuzzle(day)).toEqual(generateDailyLeyPuzzle(day));
      expect(generateDailyMatch3Level(day)).toEqual(generateDailyMatch3Level(day));
    }
    expect(generateDailyLeyPuzzle(32)).toEqual(generateDailyLeyPuzzle(0));
    expect(generateDailyMatch3Level(32)).toEqual(generateDailyMatch3Level(0));
    const edited = generateDailyMatch3Level(0);
    expect(() => {
      (edited.board as number[])[0] = -1;
    }).toThrow(TypeError);
    expect(generateDailyMatch3Level(0).board[0]).toBeGreaterThanOrEqual(0);
    expect(generateDailyMatch3Level(32)).toBe(edited);
    expect(generateDailyMatch3Level(1)).not.toBe(edited);
    expect(Object.isFrozen(edited.refill)).toBe(true);
    expect(Object.isFrozen(edited)).toBe(true);
    const ley = generateDailyLeyPuzzle(0);
    expect(generateDailyLeyPuzzle(32)).toBe(ley);
    expect(Object.isFrozen(ley)).toBe(true);
    expect(Object.isFrozen(ley.tiles)).toBe(true);
    expect(Object.isFrozen(ley.tiles[0])).toBe(true);
    expect(Object.isFrozen(ley.source)).toBe(true);
    expect(Object.isFrozen(ley.target)).toBe(true);
  });
});
