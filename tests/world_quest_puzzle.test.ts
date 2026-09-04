import { describe, expect, it } from 'vitest';
import { WORLD_QUESTS_BY_ID } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import {
  sanitizeWorldQuestPuzzleRotations,
  traceWorldQuestPuzzle,
  worldQuestPuzzleInitialRotations,
} from '../src/sim/world_quest_puzzle';

function puzzleFixture() {
  const quest = WORLD_QUESTS_BY_ID.wq_galecrest_wisps;
  if (quest.objective.type !== 'puzzle') throw new Error('Expected beam-puzzle fixture');
  return { quest, puzzle: quest.objective.puzzles[0] };
}

function activatePuzzle(sim: Sim, questId: string, objectItemId: string): void {
  const object = [...sim.entities.values()].find(
    (entity) => entity.kind === 'object' && entity.objectItemId === objectItemId,
  );
  if (!object) throw new Error(`Missing activator for ${questId}`);
  sim.player.pos.x = object.pos.x;
  sim.player.pos.z = object.pos.z;
  expect(sim.pickUpObject(object.id)).toBe(true);
}

const SOLVED_ROTATIONS = [
  { 1: 1, 2: 1, 3: 1, 4: 3 },
  { 1: 1, 2: 1, 3: 1, 4: 1, 5: 3 },
  { 3: 0, 5: 1, 6: 1, 7: 3, 9: 0, 12: 1, 13: 3 },
] as const;

describe('world quest beam puzzle', () => {
  it('authors a different solvable circuit for each weekly slot', () => {
    const { quest } = puzzleFixture();
    if (quest.objective.type !== 'puzzle') throw new Error('Expected beam-puzzle fixture');
    const paths = [
      [3, 4, 1, 2],
      [4, 5, 1, 2, 3],
      [12, 13, 9, 5, 6, 7, 3],
    ];
    quest.objective.puzzles.forEach((puzzle, level) => {
      const rotations = worldQuestPuzzleInitialRotations(puzzle);
      for (const [index, rotation] of Object.entries(SOLVED_ROTATIONS[level])) {
        rotations[Number(index)] = rotation;
      }
      expect(traceWorldQuestPuzzle(puzzle, rotations)).toEqual({
        path: paths[level],
        solved: true,
      });
    });
  });

  it('starts scrambled and follows the solved zig-zag to the destination', () => {
    const { puzzle } = puzzleFixture();
    const initial = worldQuestPuzzleInitialRotations(puzzle);
    expect(traceWorldQuestPuzzle(puzzle, initial)).toEqual({ path: [], solved: false });

    const solved = [...initial];
    solved[1] = 1;
    solved[2] = 1;
    solved[3] = 1;
    solved[4] = 3;
    expect(traceWorldQuestPuzzle(puzzle, solved)).toEqual({ path: [3, 4, 1, 2], solved: true });
  });

  it('normalizes untrusted rotations to one bounded entry per authored tile', () => {
    const { puzzle } = puzzleFixture();
    const initial = worldQuestPuzzleInitialRotations(puzzle);
    expect(sanitizeWorldQuestPuzzleRotations('bad', puzzle)).toEqual(initial);
    expect(sanitizeWorldQuestPuzzleRotations([1], puzzle)).toEqual(initial);
    expect(
      sanitizeWorldQuestPuzzleRotations([5, -1, 2, 3, 0, 1, 2, 3, Number.NaN], puzzle),
    ).toEqual([1, 3, 2, 3, 0, 1, 2, 3, initial[8]]);
  });

  it('persists detached turns, rejects invalid input, reopens, and rewards the solution once', () => {
    const { quest } = puzzleFixture();
    if (quest.objective.type !== 'puzzle') throw new Error('Expected beam-puzzle fixture');
    const sim = new Sim({ seed: 991, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(20);
    sim.resetDay = '2026-08-31';
    sim.player.pos.x = quest.area.x;
    sim.player.pos.z = quest.area.z;
    let events = sim.tick();
    expect(events.map((event) => event.type)).not.toContain('worldQuestPuzzleOpened');

    const untouched = [...(sim.worldQuestLog.get(quest.id)?.puzzleRotations ?? [])];
    sim.rotateWorldQuestPuzzleTile(quest.id, 3);
    expect(sim.worldQuestLog.get(quest.id)?.puzzleRotations).toEqual(untouched);
    const activationObjectItemId = quest.objective.activationObjectItemId;
    activatePuzzle(sim, quest.id, activationObjectItemId);
    expect(sim.drainEvents().map((event) => event.type)).toContain('worldQuestPuzzleOpened');

    sim.rotateWorldQuestPuzzleTile(quest.id, 3);
    sim.rotateWorldQuestPuzzleTile(quest.id, 4);
    expect(sim.worldQuestLog.get(quest.id)?.puzzleRotations?.slice(3, 5)).toEqual([1, 1]);
    const state = sim.serializeCharacter(sim.playerId);
    expect(state?.worldQuests?.progress[0]?.puzzleRotations?.slice(3, 5)).toEqual([1, 1]);
    const savedRotations = [...(state?.worldQuests?.progress[0]?.puzzleRotations ?? [])];
    sim.rotateWorldQuestPuzzleTile(quest.id, 0);
    expect(state?.worldQuests?.progress[0]?.puzzleRotations).toEqual(savedRotations);

    const beforeInvalid = [...(sim.worldQuestLog.get(quest.id)?.puzzleRotations ?? [])];
    sim.rotateWorldQuestPuzzleTile(quest.id, -1);
    sim.rotateWorldQuestPuzzleTile(quest.id, 9);
    sim.rotateWorldQuestPuzzleTile('wq_evergarden_watch', 0);
    sim.player.dead = true;
    sim.rotateWorldQuestPuzzleTile(quest.id, 1);
    sim.player.dead = false;
    expect(sim.worldQuestLog.get(quest.id)?.puzzleRotations).toEqual(beforeInvalid);

    sim.player.pos.x = quest.area.x + quest.area.radius + 5;
    events = sim.tick();
    expect(events.map((event) => event.type)).toContain('worldQuestPuzzleClosed');
    const beforeRemoteTurn = sim.worldQuestLog.get(quest.id)?.puzzleRotations;
    sim.rotateWorldQuestPuzzleTile(quest.id, 4);
    expect(sim.worldQuestLog.get(quest.id)?.puzzleRotations).toEqual(beforeRemoteTurn);

    sim.player.pos.x = quest.area.x;
    events = sim.tick();
    expect(events.map((event) => event.type)).not.toContain('worldQuestPuzzleOpened');
    const beforeReactivation = [...(sim.worldQuestLog.get(quest.id)?.puzzleRotations ?? [])];
    sim.rotateWorldQuestPuzzleTile(quest.id, 4);
    expect(sim.worldQuestLog.get(quest.id)?.puzzleRotations).toEqual(beforeReactivation);
    activatePuzzle(sim, quest.id, activationObjectItemId);
    sim.drainEvents();
    sim.rotateWorldQuestPuzzleTile(quest.id, 4);
    sim.rotateWorldQuestPuzzleTile(quest.id, 4);
    sim.rotateWorldQuestPuzzleTile(quest.id, 1);
    const lifetimeBeforeSolution = sim.lifetimeXp;
    sim.rotateWorldQuestPuzzleTile(quest.id, 2);
    expect(sim.worldQuestLog.get(quest.id)).toEqual({
      questId: quest.id,
      count: 1,
      state: 'completed',
    });
    expect(sim.lifetimeXp - lifetimeBeforeSolution).toBe(2_784);
    const doneEvents = sim.drainEvents().filter((event) => event.type === 'worldQuestDone');
    expect(doneEvents).toHaveLength(1);

    const lifetimeAfterCompletion = sim.lifetimeXp;
    const completedAfterCompletion = sim.meta(sim.playerId)?.counters.questsCompleted;
    sim.rotateWorldQuestPuzzleTile(quest.id, 2);
    expect(sim.lifetimeXp).toBe(lifetimeAfterCompletion);
    expect(sim.meta(sim.playerId)?.counters.questsCompleted).toBe(completedAfterCompletion);
    expect(sim.drainEvents().some((event) => event.type === 'worldQuestDone')).toBe(false);
  });

  it('starts, reloads closed, and completes every weekly circuit variant', () => {
    const { quest } = puzzleFixture();
    if (quest.objective.type !== 'puzzle') throw new Error('Expected beam-puzzle fixture');
    const weeks = [
      ['2026-08-31', 0],
      ['2026-09-09', 1],
      ['2026-09-18', 2],
    ] as const;
    for (const [resetDay, variant] of weeks) {
      const original = new Sim({
        seed: 1_100 + variant,
        playerClass: 'warrior',
        autoEquip: true,
      });
      original.setPlayerLevel(20);
      original.resetDay = resetDay;
      original.player.pos.x = quest.area.x;
      original.player.pos.z = quest.area.z;
      original.tick();
      expect(original.worldQuestLog.get(quest.id)?.puzzleVariant).toBe(variant);
      activatePuzzle(original, quest.id, quest.objective.activationObjectItemId);
      const firstSolutionIndex = Number(Object.keys(SOLVED_ROTATIONS[variant])[0]);
      original.rotateWorldQuestPuzzleTile(quest.id, firstSolutionIndex);
      const state = original.serializeCharacter(original.playerId);
      const before = original.worldQuestLog.get(quest.id);
      if (!state || !before) throw new Error('Missing weekly circuit save');

      const restored = new Sim({
        seed: 1_100 + variant,
        playerClass: 'warrior',
        noPlayer: true,
      });
      restored.resetDay = resetDay;
      const pid = restored.addPlayer('warrior', `Leykeeper${variant}`, { state });
      const player = restored.entities.get(pid);
      if (!player) throw new Error('Missing restored weekly player');
      player.pos.x = quest.area.x;
      player.pos.z = quest.area.z;
      player.prevPos = { ...player.pos };
      expect(restored.tick().map((event) => event.type)).not.toContain('worldQuestPuzzleOpened');
      const loaded = restored.meta(pid)?.worldQuestLog.get(quest.id);
      expect(loaded).toMatchObject({
        puzzleVariant: variant,
        puzzleRotations: before.puzzleRotations,
      });
      activatePuzzle(restored, quest.id, quest.objective.activationObjectItemId);
      for (const [rawIndex, desired] of Object.entries(SOLVED_ROTATIONS[variant])) {
        const index = Number(rawIndex);
        const current = loaded?.puzzleRotations?.[index] ?? 0;
        const turns = (desired - current + 4) % 4;
        for (let turn = 0; turn < turns; turn++) {
          restored.rotateWorldQuestPuzzleTile(quest.id, index);
        }
      }
      expect(restored.meta(pid)?.worldQuestLog.get(quest.id)?.state).toBe('completed');
    }
  });
});
