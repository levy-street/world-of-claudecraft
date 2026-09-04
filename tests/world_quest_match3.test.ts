import { describe, expect, it } from 'vitest';
import { WORLD_QUESTS_BY_ID } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { WorldQuestDef, WorldQuestObjective } from '../src/sim/types';
import {
  applyWorldQuestMatch3Move,
  sanitizeWorldQuestMatch3Board,
  worldQuestMatch3Matches,
} from '../src/sim/world_quest_match3';
import { worldQuestPuzzleVariantForCycle } from '../src/sim/world_quest_rotation';

type Match3Quest = WorldQuestDef & {
  objective: Extract<WorldQuestObjective, { type: 'match3' }>;
};

function fixture(): {
  quest: Match3Quest;
  levels: Match3Quest['objective']['levels'];
} {
  const quest = WORLD_QUESTS_BY_ID.wq_palmreach_confections;
  if (quest.objective.type !== 'match3') throw new Error('Expected match-three fixture');
  return { quest: quest as Match3Quest, levels: quest.objective.levels };
}

function longestDiagonalRun(board: readonly number[], columns: number, rows: number): number {
  let longest = 1;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      for (const columnStep of [-1, 1]) {
        let length = 1;
        let nextColumn = column + columnStep;
        let nextRow = row + 1;
        while (
          nextColumn >= 0 &&
          nextColumn < columns &&
          nextRow < rows &&
          board[nextRow * columns + nextColumn] === board[row * columns + column]
        ) {
          length++;
          nextColumn += columnStep;
          nextRow++;
        }
        longest = Math.max(longest, length);
      }
    }
  }
  return longest;
}

function activateMatch3(sim: Sim): number {
  const { quest } = fixture();
  const activator = [...sim.entities.values()].find(
    (entity) => entity.objectItemId === quest.objective.activationObjectItemId,
  );
  if (!activator) throw new Error('Missing confection game box');
  sim.player.pos.x = activator.pos.x;
  sim.player.pos.z = activator.pos.z;
  expect(sim.pickUpObject(activator.id)).toBe(true);
  return activator.id;
}

function solveActiveMatch3(sim: Sim): void {
  const { quest } = fixture();
  const progress = sim.worldQuestLog.get(quest.id);
  const level = quest.objective.levels[progress?.puzzleVariant ?? 0];
  if (!progress || !level) throw new Error('Missing active match-three level');
  let board = [...(progress.match3Board ?? level.board)];
  let refillIndex = progress.match3RefillIndex ?? 0;
  for (
    let move = progress.match3Moves ?? 0;
    move < level.maxMoves && sim.worldQuestLog.get(quest.id)?.state === 'active';
    move++
  ) {
    let best:
      | { from: number; to: number; result: ReturnType<typeof applyWorldQuestMatch3Move> }
      | undefined;
    for (let from = 0; from < board.length; from++) {
      for (const to of [from + 1, from + level.columns]) {
        const result = applyWorldQuestMatch3Move(level, board, from, to, refillIndex);
        if (!result.accepted) continue;
        if (!best || result.cleared > best.result.cleared) best = { from, to, result };
      }
    }
    if (!best) throw new Error('Authored match-three level became unsolvable');
    sim.swapWorldQuestMatch3Tiles(quest.id, best.from, best.to);
    board = best.result.board;
    refillIndex = best.result.refillIndex;
  }
  if (sim.worldQuestLog.get(quest.id)?.state === 'active') {
    throw new Error('Authored match-three level cannot reach its target within the move limit');
  }
}

describe('weekly world quest match-three', () => {
  it('avoids obvious three-candy diagonal streaks on every weekly board', () => {
    const { levels } = fixture();
    for (const level of levels) {
      expect(longestDiagonalRun(level.board, level.columns, level.rows)).toBeLessThan(3);
    }
  });

  it('ships three stable, solvable boards with deterministic refills', () => {
    const { levels } = fixture();
    const traces: string[][] = [];
    for (const level of levels) {
      expect(worldQuestMatch3Matches(level.board, level.columns, level.rows).size).toBe(0);
      expect(sanitizeWorldQuestMatch3Board('bad', level)).toEqual(level.board);
      let board = [...level.board];
      let refillIndex = 0;
      let cleared = 0;
      const trace: string[] = [];
      for (let move = 0; move < level.maxMoves && cleared < level.target; move++) {
        let best:
          | { from: number; to: number; result: ReturnType<typeof applyWorldQuestMatch3Move> }
          | undefined;
        for (let from = 0; from < board.length; from++) {
          for (const to of [from + 1, from + level.columns]) {
            const result = applyWorldQuestMatch3Move(level, board, from, to, refillIndex);
            if (!result.accepted) continue;
            if (!best || result.cleared > best.result.cleared) best = { from, to, result };
          }
        }
        expect(best).toBeDefined();
        if (!best) break;
        board = best.result.board;
        refillIndex = best.result.refillIndex;
        cleared += best.result.cleared;
        trace.push(`${best.from}>${best.to}:${best.result.cleared}`);
      }
      expect(cleared).toBeGreaterThanOrEqual(level.target);
      traces.push(trace);
    }
    expect(traces).toEqual([
      [
        '26>32:12',
        '0>1:3',
        '1>7:3',
        '0>1:3',
        '0>1:3',
        '8>14:3',
        '1>7:4',
        '0>6:3',
        '0>1:3',
        '6>7:3',
        '2>8:3',
        '2>8:3',
        '7>13:6',
        '11>17:3',
        '3>4:3',
        '9>10:3',
        '3>9:3',
        '2>3:3',
        '27>28:6',
      ],
      [
        '27>33:9',
        '14>20:6',
        '26>27:6',
        '6>7:6',
        '24>25:6',
        '4>10:3',
        '3>9:3',
        '8>9:6',
        '14>15:3',
        '4>5:3',
        '2>3:3',
        '15>21:6',
        '10>16:3',
        '18>24:9',
      ],
      [
        '27>33:12',
        '8>9:3',
        '15>21:9',
        '22>28:11',
        '0>6:3',
        '14>20:3',
        '20>26:9',
        '7>8:3',
        '2>3:3',
        '3>9:3',
        '16>17:3',
        '2>3:3',
        '13>14:4',
        '15>16:3',
      ],
    ]);
  });

  it('rejects remote play, preserves a detached save, and completes after physical activation', () => {
    const { quest, levels } = fixture();
    if (quest.objective.type !== 'match3') throw new Error('Expected match-three fixture');
    const sim = new Sim({ seed: 992, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(20);
    sim.resetDay = '2026-08-31';
    sim.player.pos.x = quest.area.x;
    sim.player.pos.z = quest.area.z;
    const events = sim.tick();
    expect(events.map((event) => event.type)).not.toContain('worldQuestPuzzleOpened');
    const level = levels[0];

    sim.swapWorldQuestMatch3Tiles(quest.id, 2, 3);
    expect(sim.worldQuestLog.get(quest.id)?.count).toBe(0);
    const activationObjectItemId = quest.objective.activationObjectItemId;
    const activator = [...sim.entities.values()].find(
      (entity) => entity.objectItemId === activationObjectItemId,
    );
    if (!activator) throw new Error('Missing confection game box');
    sim.player.pos.x = activator.pos.x;
    sim.player.pos.z = activator.pos.z;
    expect(sim.pickUpObject(activator.id)).toBe(true);
    expect(sim.drainEvents().map((event) => event.type)).toContain('worldQuestPuzzleOpened');

    sim.swapWorldQuestMatch3Tiles(quest.id, 2, 3);
    expect(sim.worldQuestLog.get(quest.id)).toMatchObject({
      count: 3,
      match3Moves: 1,
    });
    const saved = sim.serializeCharacter(sim.playerId);
    const savedBoard = [...(saved?.worldQuests?.progress[0]?.match3Board ?? [])];
    sim.swapWorldQuestMatch3Tiles(quest.id, 8, 9);
    expect(saved?.worldQuests?.progress[0]?.match3Board).toEqual(savedBoard);

    const countBeforeLeaving = sim.worldQuestLog.get(quest.id)?.count;
    sim.player.pos.x = quest.area.x + quest.area.radius + 5;
    expect(sim.tick().map((event) => event.type)).toContain('worldQuestPuzzleClosed');
    sim.player.pos.x = quest.area.x;
    expect(sim.tick().map((event) => event.type)).not.toContain('worldQuestPuzzleOpened');
    sim.swapWorldQuestMatch3Tiles(quest.id, 7, 13);
    expect(sim.worldQuestLog.get(quest.id)?.count).toBe(countBeforeLeaving);
    sim.player.pos.x = activator.pos.x;
    sim.player.pos.z = activator.pos.z;
    expect(sim.pickUpObject(activator.id)).toBe(true);
    sim.drainEvents();

    let board = [...(sim.worldQuestLog.get(quest.id)?.match3Board ?? level.board)];
    let refillIndex = sim.worldQuestLog.get(quest.id)?.match3RefillIndex ?? 0;
    for (
      let move = 0;
      move < level.maxMoves && sim.worldQuestLog.get(quest.id)?.state === 'active';
      move++
    ) {
      let best:
        | { from: number; to: number; result: ReturnType<typeof applyWorldQuestMatch3Move> }
        | undefined;
      for (let from = 0; from < board.length; from++) {
        for (const to of [from + 1, from + level.columns]) {
          const result = applyWorldQuestMatch3Move(level, board, from, to, refillIndex);
          if (!result.accepted) continue;
          if (!best || result.cleared > best.result.cleared) best = { from, to, result };
        }
      }
      if (!best) break;
      sim.swapWorldQuestMatch3Tiles(quest.id, best.from, best.to);
      board = best.result.board;
      refillIndex = best.result.refillIndex;
    }
    expect(sim.worldQuestLog.get(quest.id)).toEqual({
      questId: quest.id,
      count: quest.count,
      state: 'completed',
    });
    const rewardCount = sim.countItem('rift_essence');
    expect(rewardCount).toBeGreaterThan(0);
    sim.meta(sim.playerId)!.openWorldQuestPuzzleId = quest.id;
    sim.resetWorldQuestMatch3(quest.id);
    sim.swapWorldQuestMatch3Tiles(quest.id, 2, 3);
    expect(sim.worldQuestLog.get(quest.id)).toEqual({
      questId: quest.id,
      count: quest.count,
      state: 'completed',
    });
    expect(sim.countItem('rift_essence')).toBe(rewardCount);
  });

  it('restores the weekly board, moves, and cleared count across a reconnect', () => {
    const { quest } = fixture();
    if (quest.objective.type !== 'match3') throw new Error('Expected match-three fixture');
    const original = new Sim({
      seed: 993,
      playerClass: 'warrior',
      autoEquip: true,
    });
    original.setPlayerLevel(20);
    original.resetDay = '2026-08-31';
    original.player.pos.x = quest.area.x;
    original.player.pos.z = quest.area.z;
    original.tick();
    const objectItemId = quest.objective.activationObjectItemId;
    const activator = [...original.entities.values()].find(
      (entity) => entity.objectItemId === objectItemId,
    );
    if (!activator) throw new Error('Missing confection game box');
    original.player.pos.x = activator.pos.x;
    original.player.pos.z = activator.pos.z;
    original.pickUpObject(activator.id);
    original.swapWorldQuestMatch3Tiles(quest.id, 2, 3);
    const before = original.worldQuestLog.get(quest.id);
    const state = original.serializeCharacter(original.playerId);
    if (!before || !state) throw new Error('Missing persisted match-three state');

    const restored = new Sim({
      seed: 993,
      playerClass: 'warrior',
      noPlayer: true,
    });
    restored.resetDay = '2026-08-31';
    const pid = restored.addPlayer('warrior', 'Sweetkeeper', { state });
    const player = restored.entities.get(pid);
    if (!player) throw new Error('Missing restored player');
    player.pos.x = quest.area.x;
    player.pos.z = quest.area.z;
    player.prevPos = { ...player.pos };
    const events = restored.tick();
    expect(events.map((event) => event.type)).not.toContain('worldQuestPuzzleOpened');
    expect(restored.meta(pid)?.worldQuestLog.get(quest.id)).toMatchObject({
      count: before.count,
      puzzleVariant: before.puzzleVariant,
      match3Moves: before.match3Moves,
      match3Board: before.match3Board,
      match3RefillIndex: before.match3RefillIndex,
    });
    activateMatch3(restored);
    const level = quest.objective.levels[before.puzzleVariant ?? 0];
    const board = before.match3Board ?? level.board;
    const refillIndex = before.match3RefillIndex ?? 0;
    let nextMove: [number, number] | null = null;
    for (let from = 0; from < board.length && !nextMove; from++) {
      for (const to of [from + 1, from + level.columns]) {
        if (applyWorldQuestMatch3Move(level, board, from, to, refillIndex).accepted) {
          nextMove = [from, to];
          break;
        }
      }
    }
    if (!nextMove) throw new Error('Missing continuation move');
    original.swapWorldQuestMatch3Tiles(quest.id, ...nextMove);
    restored.swapWorldQuestMatch3Tiles(quest.id, ...nextMove);
    expect(restored.meta(pid)?.worldQuestLog.get(quest.id)).toMatchObject({
      count: original.worldQuestLog.get(quest.id)?.count,
      match3Moves: original.worldQuestLog.get(quest.id)?.match3Moves,
      match3Board: original.worldQuestLog.get(quest.id)?.match3Board,
      match3RefillIndex: original.worldQuestLog.get(quest.id)?.match3RefillIndex,
    });
  });

  it('rejects wrong objects and invalid play, and resets the authoritative level', () => {
    const { quest, levels } = fixture();
    const sim = new Sim({ seed: 994, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(20);
    sim.resetDay = '2026-08-31';
    sim.player.pos.x = quest.area.x;
    sim.player.pos.z = quest.area.z;
    sim.tick();
    const activatorId = activateMatch3(sim);
    sim.drainEvents();
    const progress = sim.worldQuestLog.get(quest.id);
    const level = levels[0];
    if (!progress) throw new Error('Missing match-three progress');

    sim.swapWorldQuestMatch3Tiles(quest.id, 2, 3);
    expect(progress).toMatchObject({ count: 3, match3Moves: 1 });
    expect(progress.match3RefillIndex).toBeGreaterThan(0);
    sim.resetWorldQuestMatch3(quest.id);
    expect(progress).toMatchObject({
      count: 0,
      match3Moves: 0,
      match3RefillIndex: 0,
    });
    expect(progress.match3Board).toEqual(level.board);

    const before = JSON.stringify(progress);
    const rejectedPairs: [number, number][] = [
      [-1, 0],
      [0, level.board.length],
      [0, 0],
      [0, level.columns + 1],
    ];
    const noMatchPair = level.board
      .map((_, from) => [from, from + 1] as [number, number])
      .find(([from, to]) =>
        to < level.board.length && to % level.columns !== 0
          ? !applyWorldQuestMatch3Move(level, level.board, from, to, 0).accepted
          : false,
      );
    if (!noMatchPair) throw new Error('Missing rejected adjacent fixture');
    rejectedPairs.push(noMatchPair);
    for (const [from, to] of rejectedPairs) sim.swapWorldQuestMatch3Tiles(quest.id, from, to);
    expect(JSON.stringify(progress)).toBe(before);

    sim.player.dead = true;
    sim.swapWorldQuestMatch3Tiles(quest.id, 2, 3);
    sim.player.dead = false;
    expect(JSON.stringify(progress)).toBe(before);
    progress.match3Moves = level.maxMoves;
    sim.swapWorldQuestMatch3Tiles(quest.id, 2, 3);
    expect(progress.count).toBe(0);
    sim.resetWorldQuestMatch3(quest.id);

    const wrongObject = [...sim.entities.values()].find(
      (entity) => entity.objectItemId === 'leyline_cache',
    );
    const activator = sim.entities.get(activatorId);
    if (!wrongObject || !activator) throw new Error('Missing physical object fixture');
    wrongObject.pos = { ...activator.pos };
    sim.ctx.rebucket(wrongObject);
    sim.meta(sim.playerId)!.openWorldQuestPuzzleId = null;
    expect(sim.pickUpObject(wrongObject.id)).toBe(false);
    expect(sim.meta(sim.playerId)?.openWorldQuestPuzzleId).toBeNull();
  });

  it('authorizes reset only for a living player with the active match-three box open', () => {
    const { quest } = fixture();
    const sim = new Sim({ seed: 995, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(20);
    sim.resetDay = '2026-08-31';
    sim.player.pos.x = quest.area.x;
    sim.player.pos.z = quest.area.z;
    sim.tick();
    sim.drainEvents();
    const meta = sim.meta(sim.playerId);
    if (!meta) throw new Error('Missing player metadata');

    const assertRejectedReset = (questId = quest.id): void => {
      const before = JSON.stringify(meta.worldQuestLog.get(quest.id));
      const revision = meta.wireRev;
      sim.resetWorldQuestMatch3(questId);
      expect(JSON.stringify(meta.worldQuestLog.get(quest.id))).toBe(before);
      expect(meta.wireRev).toBe(revision);
      expect(sim.drainEvents().map((event) => event.type)).not.toContain('worldQuestMatch3Updated');
    };

    assertRejectedReset();
    activateMatch3(sim);
    sim.drainEvents();
    sim.swapWorldQuestMatch3Tiles(quest.id, 2, 3);
    sim.drainEvents();

    sim.player.pos.x = quest.area.x + quest.area.radius + 5;
    assertRejectedReset();
    sim.tick();
    sim.drainEvents();

    sim.player.pos.x = quest.area.x;
    sim.player.pos.z = quest.area.z;
    sim.tick();
    activateMatch3(sim);
    sim.drainEvents();
    sim.player.dead = true;
    assertRejectedReset();
    sim.player.dead = false;

    assertRejectedReset('wq_galecrest_wisps');
    assertRejectedReset('not_a_world_quest');
  });

  it('runs, persists, and completes all three authored weekly variants', () => {
    const { quest } = fixture();
    const weeks = [
      ['2026-08-31', 0],
      ['2026-09-09', 1],
      ['2026-09-18', 2],
    ] as const;
    for (const [resetDay, variant] of weeks) {
      const original = new Sim({
        seed: 1_000 + variant,
        playerClass: 'warrior',
        autoEquip: true,
      });
      original.setPlayerLevel(20);
      original.resetDay = resetDay;
      original.player.pos.x = quest.area.x;
      original.player.pos.z = quest.area.z;
      original.tick();
      expect(original.worldQuestLog.get(quest.id)?.puzzleVariant).toBe(variant);
      activateMatch3(original);
      const state = original.serializeCharacter(original.playerId);
      if (!state) throw new Error('Missing weekly match-three save');

      const restored = new Sim({
        seed: 1_000 + variant,
        playerClass: 'warrior',
        noPlayer: true,
      });
      restored.resetDay = resetDay;
      const pid = restored.addPlayer('warrior', `Sweetkeeper${variant}`, {
        state,
      });
      const player = restored.entities.get(pid);
      if (!player) throw new Error('Missing restored weekly player');
      player.pos.x = quest.area.x;
      player.pos.z = quest.area.z;
      player.prevPos = { ...player.pos };
      restored.tick();
      expect(restored.meta(pid)?.worldQuestLog.get(quest.id)?.puzzleVariant).toBe(variant);
      activateMatch3(restored);
      solveActiveMatch3(restored);
      expect(restored.meta(pid)?.worldQuestLog.get(quest.id)?.state).toBe('completed');
    }
  });

  it('selects one stable authored variant from the weekly schedule', () => {
    expect(worldQuestPuzzleVariantForCycle('wq3_0', 3)).toBe(0);
    expect(worldQuestPuzzleVariantForCycle('wq3_3', 3)).toBe(1);
    expect(worldQuestPuzzleVariantForCycle('wq3_5', 3)).toBe(2);
    expect(worldQuestPuzzleVariantForCycle('bad', 3)).toBe(0);
  });
});
