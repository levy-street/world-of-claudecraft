import { describe, expect, it } from 'vitest';
import { WORLD_QUEST_OBJECTS, WORLD_QUESTS_BY_ID } from '../src/sim/content/world_quests';
import { Sim } from '../src/sim/sim';
import type { WorldQuestProgress } from '../src/sim/types';
import {
  generateBonusLeyChallenge,
  generateDailyLeyChallenge,
  WORLD_QUEST_DAILY_GENERATION_CYCLE,
  WORLD_QUEST_LEY_BONUS_LEVELS,
  WORLD_QUEST_LEY_BONUS_SIZES,
} from '../src/sim/world_quest_daily_generation';
import { resolveWorldQuestLeyPuzzle } from '../src/sim/world_quest_daily_levels';
import { leyBonusPending, sanitizeLeyBonusProgress } from '../src/sim/world_quest_ley_bonus';
import {
  traceWorldQuestPuzzle,
  worldQuestPuzzleInitialRotations,
} from '../src/sim/world_quest_puzzle';
import { sanitizeWorldQuestProgress, WORLD_QUEST_LEY_TIMER_SECONDS } from '../src/sim/world_quests';
import { resolveWorldQuestLeyState } from '../src/ui/world_quest_ley_view';
import { buildWorldQuestPuzzleView } from '../src/ui/world_quest_puzzle_view';

const QUEST_ID = 'wq_galecrest_wisps';

function armed(): Sim {
  const sim = new Sim({ seed: 11, playerClass: 'mage', devCommands: true });
  sim.chat('/dev wq ley 3');
  sim.tick();
  return sim;
}

/** Turn every tile to the certified solution; the last turn solves the board. */
function solveOpenBoard(sim: Sim): void {
  const progress = sim.worldQuestLog.get(QUEST_ID)!;
  const quest = WORLD_QUESTS_BY_ID[QUEST_ID];
  const puzzle = resolveWorldQuestLeyPuzzle(quest, progress)!;
  const day = progress.puzzleDay ?? 0;
  const solution = leyBonusPending(progress)
    ? generateBonusLeyChallenge(day, progress.puzzleBonusLevel as number).solution
    : generateDailyLeyChallenge(day).solution;
  for (let index = 0; index < puzzle.tiles.length; index++) {
    let guard = 0;
    // Straight tiles solve on two rotations, so the beam can connect before the
    // recorded rotation is reached: stop the moment the board reads solved.
    for (;;) {
      const rotations = sim.worldQuestLog.get(QUEST_ID)!.puzzleRotations;
      if (!rotations || traceWorldQuestPuzzle(puzzle, rotations).solved) return;
      if (rotations[index] === solution[index]) break;
      sim.rotateWorldQuestPuzzleTile(QUEST_ID, index);
      if (++guard > 4) throw new Error('tile ' + index + ' never reached its solution rotation');
    }
  }
}

function cacheId(sim: Sim): number {
  const cache = WORLD_QUEST_OBJECTS.find((object) => object.itemId === 'leyline_cache')!;
  return cache.entityIds![0];
}

describe('ley bonus boards', () => {
  it('certifies both bonus catalogs: larger, solvable, unsolved at start, distinct routes', () => {
    expect(WORLD_QUEST_LEY_BONUS_SIZES).toEqual([5, 6]);
    expect(WORLD_QUEST_LEY_BONUS_LEVELS).toBe(2);
    for (const [index, size] of WORLD_QUEST_LEY_BONUS_SIZES.entries()) {
      const routes = new Set<string>();
      for (let day = 0; day < WORLD_QUEST_DAILY_GENERATION_CYCLE; day++) {
        const { puzzle, solution } = generateBonusLeyChallenge(day, index + 1);
        expect([puzzle.columns, puzzle.rows]).toEqual([size, size]);
        expect(puzzle.tiles).toHaveLength(size * size);
        expect(traceWorldQuestPuzzle(puzzle, worldQuestPuzzleInitialRotations(puzzle)).solved).toBe(
          false,
        );
        const solved = traceWorldQuestPuzzle(puzzle, solution);
        expect(solved.solved).toBe(true);
        expect(solved.path.length).toBeGreaterThanOrEqual(2 * size - 1);
        routes.add([solved.path.join(','), [...solved.path].reverse().join(',')].sort()[0]);
      }
      expect(routes.size).toBe(WORLD_QUEST_DAILY_GENERATION_CYCLE);
    }
    // The daily 4x4 catalog is untouched by the parametric constructor.
    const daily = generateDailyLeyChallenge(5);
    expect([daily.puzzle.columns, daily.puzzle.rows]).toEqual([4, 4]);
    expect(traceWorldQuestPuzzle(daily.puzzle, daily.solution).path.length).toBeLessThanOrEqual(10);
  });

  it('pays the daily solve once, then offers unlimited reward-free harder boards', () => {
    const sim = armed();
    const meta = sim.meta(sim.playerId)!;
    solveOpenBoard(sim);
    let progress = sim.worldQuestLog.get(QUEST_ID)!;
    expect(progress.state).toBe('completed');
    expect(progress.puzzleBonusLevel).toBe(1);
    expect(progress.puzzleBonusClaimed).toBe(0);
    expect(progress.puzzleRotations).toBeUndefined();
    expect(meta.counters.questsCompleted).toBe(1);
    // The cache still answers: the 5x5 board opens on the same clock.
    expect(sim.pickUpObject(cacheId(sim))).toBe(true);
    progress = sim.worldQuestLog.get(QUEST_ID)!;
    expect(progress.puzzleRotations).toHaveLength(25);
    expect(progress.puzzleExpiresAt! - sim.time).toBeCloseTo(WORLD_QUEST_LEY_TIMER_SECONDS, 1);
    expect(buildWorldQuestPuzzleView(QUEST_ID, progress)?.bonusLevel).toBe(1);
    expect(buildWorldQuestPuzzleView(QUEST_ID, progress)?.columns).toBe(5);
    const copperBefore = meta.copper;
    solveOpenBoard(sim);
    progress = sim.worldQuestLog.get(QUEST_ID)!;
    expect(meta.copper).toBe(copperBefore);
    expect(progress.puzzleBonusClaimed).toBe(1);
    expect(progress.puzzleBonusLevel).toBe(2);
    expect(progress.puzzleRotations).toBeUndefined();
    // No second quest completion, no second base reward.
    expect(meta.counters.questsCompleted).toBe(1);
    expect(sim.pickUpObject(cacheId(sim))).toBe(true);
    progress = sim.worldQuestLog.get(QUEST_ID)!;
    expect(progress.puzzleRotations).toHaveLength(36);
    const secondBefore = meta.copper;
    solveOpenBoard(sim);
    progress = sim.worldQuestLog.get(QUEST_ID)!;
    expect(meta.copper).toBe(secondBefore);
    expect(progress.puzzleBonusClaimed).toBe(2);
    expect(progress.puzzleBonusLevel).toBeUndefined();
    expect(sim.pickUpObject(cacheId(sim))).toBe(true);
    expect(sim.worldQuestLog.get(QUEST_ID)!.puzzleRotations).toHaveLength(25);
    solveOpenBoard(sim);
    expect(meta.copper).toBe(copperBefore);
    expect(meta.counters.questsCompleted).toBe(1);
  });

  it('lets a bonus board time out and reopen without touching the completion', () => {
    const sim = armed();
    const meta = sim.meta(sim.playerId)!;
    solveOpenBoard(sim);
    expect(sim.pickUpObject(cacheId(sim))).toBe(true);
    const before = sim.worldQuestLog.get(QUEST_ID)!.puzzleRotations!.slice();
    sim.rotateWorldQuestPuzzleTile(QUEST_ID, 0);
    expect(sim.worldQuestLog.get(QUEST_ID)!.puzzleRotations![0]).toBe((before[0] + 1) % 4);
    // The 90 s clock runs out: pull the deadline into the past and let one tick sweep it.
    sim.worldQuestLog.get(QUEST_ID)!.puzzleExpiresAt = sim.time - 0.01;
    sim.tick();
    const expired = sim.worldQuestLog.get(QUEST_ID)!;
    expect(expired.state).toBe('completed');
    expect(expired.puzzleBonusLevel).toBe(1);
    expect(expired.puzzleExpiresAt).toBe(0);
    expect(expired.puzzleRotations).toEqual(before);
    sim.rotateWorldQuestPuzzleTile(QUEST_ID, 0);
    expect(sim.worldQuestLog.get(QUEST_ID)!.puzzleRotations![0]).toBe(before[0]);
    sim.resetWorldQuestPuzzle(QUEST_ID);
    expect(sim.worldQuestLog.get(QUEST_ID)!.puzzleExpiresAt! - sim.time).toBeCloseTo(
      WORLD_QUEST_LEY_TIMER_SECONDS,
      1,
    );
    expect(meta.counters.questsCompleted).toBe(1);
  });

  it('sanitizes the bonus row for the wire and saves, rejecting forged levels', () => {
    const cycle = 'wq1_3';
    const rows = sanitizeWorldQuestProgress(
      [
        {
          questId: QUEST_ID,
          count: 1,
          state: 'completed',
          puzzleBonusLevel: 2,
          puzzleBonusClaimed: 1,
          puzzleDay: 99,
          puzzleRotations: Array.from({ length: 36 }, () => 7),
          puzzleExpiresAt: 42,
        },
        { questId: QUEST_ID, count: 1, state: 'completed', puzzleBonusLevel: 9 },
        { questId: QUEST_ID, count: 1, state: 'completed', puzzleBonusClaimed: 2 },
      ] as Partial<WorldQuestProgress>[],
      cycle,
      true,
    );
    expect(rows[0]).toMatchObject({
      state: 'completed',
      puzzleBonusLevel: 2,
      puzzleBonusClaimed: 1,
      puzzleDay: 3,
      puzzleExpiresAt: 42,
    });
    expect(rows[0].puzzleRotations).toHaveLength(36);
    expect(rows[0].puzzleRotations!.every((r) => r >= 0 && r <= 3)).toBe(true);
    // Duplicate ids collapse to the first row; a forged level never survives.
    expect(rows).toHaveLength(1);
    const forged = sanitizeWorldQuestProgress(
      [{ questId: QUEST_ID, count: 1, state: 'completed', puzzleBonusLevel: 9 }],
      cycle,
      true,
    );
    expect(forged[0].puzzleBonusLevel).toBeUndefined();
    const spent = sanitizeWorldQuestProgress(
      [{ questId: QUEST_ID, count: 1, state: 'completed', puzzleBonusClaimed: 2 }],
      cycle,
      true,
    );
    expect(spent[0]).toMatchObject({ puzzleBonusClaimed: 2 });
    expect(spent[0].puzzleBonusLevel).toBeUndefined();
    const normalized: WorldQuestProgress = { questId: QUEST_ID, count: 1, state: 'completed' };
    expect(
      sanitizeLeyBonusProgress(
        { puzzleBonusLevel: 1, puzzleBonusClaimed: 5 },
        normalized,
        WORLD_QUESTS_BY_ID[QUEST_ID],
        4,
      ),
    ).toBe(true);
    expect(normalized).toMatchObject({ puzzleBonusLevel: 1, puzzleBonusClaimed: 0, puzzleDay: 4 });
  });

  it('projects a charged, open bonus board as a live game after the win', () => {
    const sim = armed();
    solveOpenBoard(sim);
    const won = resolveWorldQuestLeyState(
      QUEST_ID,
      sim.worldQuestLog.get(QUEST_ID),
      sim.time,
      null,
    );
    expect(won?.outcome).toBe('won');
    expect(won?.bonusCharged).toBe(1);
    expect(won?.bonusPaid).toBe(0);
    sim.pickUpObject(cacheId(sim));
    const playing = resolveWorldQuestLeyState(
      QUEST_ID,
      sim.worldQuestLog.get(QUEST_ID),
      sim.time,
      won,
    );
    expect(playing?.outcome).toBe('playing');
    expect(playing?.board?.bonusLevel).toBe(1);
    expect(playing?.board?.columns).toBe(5);
    expect(playing?.snapshot?.state).toBe('completed');
    solveOpenBoard(sim);
    const paid = resolveWorldQuestLeyState(
      QUEST_ID,
      sim.worldQuestLog.get(QUEST_ID),
      sim.time,
      playing,
    );
    expect(paid?.outcome).toBe('won');
    expect(paid?.bonusPaid).toBe(1);
    expect(paid?.bonusCharged).toBe(2);
  });
});
