import { describe, expect, it } from 'vitest';
import { applyQuestSelfWire, type QuestSelfMirrors } from '../src/net/quest_snapshot_wire';
import { WORLD_QUESTS_BY_ID } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { WorldQuestProgress } from '../src/sim/types';
import {
  generateDailyLeyChallenge,
  solveDailyMatch3Level,
} from '../src/sim/world_quest_daily_generation';
import {
  resolveWorldQuestLeyPuzzle,
  resolveWorldQuestMatch3Level,
} from '../src/sim/world_quest_daily_levels';
import { worldQuestPuzzleConnectors } from '../src/sim/world_quest_puzzle';
import { worldQuestCycleNumber } from '../src/sim/world_quest_rotation';
import { sanitizeWorldQuestProgress } from '../src/sim/world_quests';
import {
  applyWorldQuestLeyRotation,
  resolveWorldQuestLeyState,
} from '../src/ui/world_quest_ley_view';
import { buildWorldQuestMatch3View } from '../src/ui/world_quest_match3_view';
import { buildWorldQuestPuzzleView } from '../src/ui/world_quest_puzzle_view';

function enter(id: string, day = '2026-08-31') {
  const sim = new Sim({ seed: 991, playerClass: 'warrior', autoEquip: true });
  const quest = WORLD_QUESTS_BY_ID[id];
  sim.setPlayerLevel(30);
  sim.resetDay = day;
  sim.player.pos.x = quest.area.x;
  sim.player.pos.z = quest.area.z;
  sim.tick();
  return { sim, quest, progress: sim.worldQuestLog.get(id)! };
}

describe('daily world quest integration', () => {
  it('labels the generated daily slot rather than an unrelated authored level', () => {
    const progress: WorldQuestProgress = {
      questId: 'wq_galecrest_wisps',
      state: 'active',
      count: 0,
      puzzleVariant: 0,
      puzzleDay: 31,
    };
    expect(buildWorldQuestPuzzleView(progress.questId, progress)?.level).toBe(32);
    progress.questId = 'wq_palmreach_confections';
    expect(buildWorldQuestMatch3View(progress.questId, progress)?.level).toBe(32);
  });
  it('keeps a ley offer stable within the day and changes it the very next day', () => {
    const first = enter('wq_galecrest_wisps', '2026-08-31');
    const sameDay = enter(first.quest.id, '2026-08-31');
    expect(sameDay.progress.puzzleDay).toBe(first.progress.puzzleDay);
    expect(resolveWorldQuestLeyPuzzle(sameDay.quest, sameDay.progress)).toEqual(
      resolveWorldQuestLeyPuzzle(first.quest, first.progress),
    );
    const next = enter(first.quest.id, '2026-09-01');
    expect(next.progress.puzzleDay).toBe(first.progress.puzzleDay! + 1);
    expect(resolveWorldQuestLeyPuzzle(next.quest, next.progress)).not.toEqual(
      resolveWorldQuestLeyPuzzle(first.quest, first.progress),
    );
  });
  it('changes the candy board at the next daily reset inside the same calendar week', () => {
    const first = enter('wq_palmreach_confections', '2026-08-31');
    const sameDay = enter(first.quest.id, '2026-08-31');
    const nextDay = enter(first.quest.id, '2026-09-01');
    expect(sameDay.progress.puzzleDay).toBe(first.progress.puzzleDay);
    expect(sameDay.progress.match3Board).toEqual(first.progress.match3Board);
    expect(nextDay.progress.puzzleDay).toBe(first.progress.puzzleDay! + 1);
    expect(nextDay.progress.match3Board).not.toEqual(first.progress.match3Board);
  });
  it('replaces an existing candy attempt on the live daily reset', () => {
    const { sim, quest, progress } = enter('wq_palmreach_confections', '2026-08-31');
    const initialBoard = [...progress.match3Board!];
    sim.resetDay = '2026-09-01';
    sim.tick();
    const next = sim.worldQuestLog.get(quest.id)!;
    expect(next.puzzleDay).toBe(1);
    expect(next.match3Board).not.toEqual(initialBoard);
    expect(next.match3Moves).toBe(0);
    const stable = structuredClone(next);
    sim.tick();
    expect(sim.worldQuestLog.get(quest.id)).toEqual(stable);
  });
  it.each(['wq_galecrest_wisps', 'wq_palmreach_confections'])(
    'preserves %s daily identity through save and wire',
    (id) => {
      const { sim, quest, progress } = enter(id);
      expect(progress.puzzleDay).toBe(worldQuestCycleNumber(sim.worldQuestCycle));
      const saved = sim.serializeCharacter(sim.playerId)!.worldQuests!;
      const normalized = sanitizeWorldQuestProgress(saved.progress, saved.cycle);
      expect(normalized.find((row) => row.questId === id)).toEqual(progress);
      const mirror: QuestSelfMirrors = {
        questLog: new Map(),
        questsDone: new Set(),
        worldQuestCycle: '',
        worldQuestExpiresAtMs: 0,
        worldQuestLog: new Map(),
      };
      applyQuestSelfWire(mirror, { wqday: saved.cycle, wqlog: saved.progress });
      const wire = mirror.worldQuestLog.get(id)!;
      expect(wire).toEqual(progress);
      if (quest.objective.type === 'puzzle') {
        const puzzle = resolveWorldQuestLeyPuzzle(quest, progress)!;
        const view = buildWorldQuestPuzzleView(id, wire)!;
        expect(view.columns).toBe(puzzle.columns);
        expect(view.rows).toBe(puzzle.rows);
        expect(view.tiles.map((tile) => tile.connectors)).toEqual(
          puzzle.tiles.map((tile, index) =>
            worldQuestPuzzleConnectors(tile.kind, progress.puzzleRotations![index]),
          ),
        );
        expect(view.tiles[puzzle.source.tileIndex].sourceSide).toBe(puzzle.source.side);
        expect(view.tiles[puzzle.target.tileIndex].targetSide).toBe(puzzle.target.side);
        const state = resolveWorldQuestLeyState(id, wire, 0, null)!;
        const updated = applyWorldQuestLeyRotation(state, {
          questId: id,
          tileIndex: 0,
          rotation: (state.board!.tiles[0].rotation + 1) % 4,
        })!;
        expect(updated.snapshot?.puzzleDay).toBe(progress.puzzleDay);
        expect(updated.board?.tiles).toHaveLength(16);
      } else {
        expect(buildWorldQuestMatch3View(id, wire)?.cells.map((cell) => cell.candy)).toEqual(
          progress.match3Board,
        );
      }
    },
  );

  it('uses cycle authority for the marker and retains marker-free authored saves', () => {
    const { sim, quest, progress } = enter('wq_palmreach_confections');
    const forged = sanitizeWorldQuestProgress(
      [{ ...progress, puzzleDay: 999999 }],
      sim.worldQuestCycle,
    )[0];
    expect(forged.puzzleDay).toBe(progress.puzzleDay);
    const legacy: WorldQuestProgress = {
      questId: quest.id,
      state: 'active',
      count: 0,
      puzzleVariant: 1,
    };
    if (quest.objective.type !== 'match3') throw new Error('Expected candy quest');
    expect(resolveWorldQuestMatch3Level(quest, legacy)).toBe(quest.objective.levels[1]);
    expect(sanitizeWorldQuestProgress([legacy], sim.worldQuestCycle)[0].puzzleDay).toBeUndefined();
  });

  it.each(['wq_galecrest_wisps', 'wq_palmreach_confections'])(
    'rejects malformed daily markers for %s',
    (id) => {
      const { sim, progress } = enter(id);
      for (const puzzleDay of [null, '1', 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(
          sanitizeWorldQuestProgress([{ ...progress, puzzleDay }], sim.worldQuestCycle)[0]
            .puzzleDay,
        ).toBeUndefined();
      }
    },
  );

  it('completes a generated candy board through authoritative moves and retries the same board', () => {
    const { sim, quest, progress } = enter('wq_palmreach_confections');
    if (quest.objective.type !== 'match3') throw new Error('Expected candy quest');
    const activationObjectItemId = quest.objective.activationObjectItemId;
    const activator = [...sim.entities.values()].find(
      (entity) => entity.objectItemId === activationObjectItemId,
    )!;
    sim.player.pos.x = activator.pos.x;
    sim.player.pos.z = activator.pos.z;
    sim.pickUpObject(activator.id);
    const level = resolveWorldQuestMatch3Level(quest, progress)!;
    const initial = [...progress.match3Board!];
    const moves = solveDailyMatch3Level(level);
    expect(moves).not.toBeNull();
    sim.swapWorldQuestMatch3Tiles(quest.id, ...moves![0]);
    expect(progress.match3Moves).toBe(1);
    expect(progress.match3Board).not.toEqual(initial);
    const state = sim.serializeCharacter(sim.playerId)!;
    const restored = new Sim({ seed: 991, playerClass: 'warrior', noPlayer: true });
    restored.resetDay = sim.resetDay;
    const pid = restored.addPlayer('warrior', 'Candy', { state });
    expect(restored.meta(pid)!.worldQuestLog.get(quest.id)).toEqual(progress);
    const day = progress.puzzleDay;
    sim.resetWorldQuestMatch3(quest.id);
    expect(progress).toMatchObject({
      count: 0,
      match3Moves: 0,
      match3RefillIndex: 0,
      puzzleDay: day,
      match3Board: initial,
    });
    for (const [from, to] of moves!) sim.swapWorldQuestMatch3Tiles(quest.id, from, to);
    expect(progress.state).toBe('completed');
    expect(progress.count).toBe(quest.count);
  });

  it('completes a generated ley circuit through authoritative rotations', () => {
    const { sim, quest, progress } = enter('wq_galecrest_wisps');
    if (quest.objective.type !== 'puzzle') throw new Error('Expected ley quest');
    const activationObjectItemId = quest.objective.activationObjectItemId;
    const activator = [...sim.entities.values()].find(
      (entity) => entity.objectItemId === activationObjectItemId,
    )!;
    sim.player.pos.x = activator.pos.x;
    sim.player.pos.z = activator.pos.z;
    sim.pickUpObject(activator.id);
    const initialRotations = [...progress.puzzleRotations!];
    sim.rotateWorldQuestPuzzleTile(quest.id, 0);
    const saved = sim.serializeCharacter(sim.playerId)!;
    const restored = new Sim({ seed: 991, playerClass: 'warrior', noPlayer: true });
    restored.resetDay = sim.resetDay;
    const pid = restored.addPlayer('warrior', 'Ley', { state: saved });
    const { puzzleExpiresAt: _deadline, ...durableProgress } = progress;
    expect(restored.meta(pid)!.worldQuestLog.get(quest.id)).toEqual(durableProgress);
    sim.resetWorldQuestPuzzle(quest.id);
    expect(progress.puzzleRotations).not.toEqual(initialRotations);
    sim.time = progress.puzzleExpiresAt!;
    sim.resetWorldQuestPuzzle(quest.id);
    expect(progress.puzzleRotations).toEqual(initialRotations);
    expect(progress.puzzleExpiresAt).toBe(sim.time + 90);
    const { solution } = generateDailyLeyChallenge(progress.puzzleDay!);
    for (let index = 0; index < solution.length && progress.state === 'active'; index++) {
      for (
        let turn = 0;
        turn < 4 &&
        progress.puzzleRotations?.[index] !== solution[index] &&
        progress.state === 'active';
        turn++
      )
        sim.rotateWorldQuestPuzzleTile(quest.id, index);
    }
    expect(progress.state).toBe('completed');
  });
});
