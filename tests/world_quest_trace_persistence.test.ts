import { describe, expect, it } from 'vitest';
import type { CharacterState } from '../src/sim/character_state';
import {
  WORLD_QUEST_CALLIGRAPHY_ID as QUEST_ID,
  WORLD_QUEST_CALLIGRAPHY_NPC_IDS,
  WORLD_QUEST_CALLIGRAPHY_NPCS,
  WORLD_QUEST_CALLIGRAPHY_QUEST,
} from '../src/sim/content/world_quest_calligraphy';
import { BUILTIN_WORLD } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';
import { worldQuestTraceShape } from '../src/sim/world_quest_trace_variants';
import { sanitizeWorldQuestProgress } from '../src/sim/world_quests';
import { WORLD_SEED } from '../src/sim/world_seed';

const DEED_ID = 'exp_arcane_calligraphy';
const WORLD = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: WORLD_QUEST_CALLIGRAPHY_NPCS,
  groundObjects: [],
};
const OBJECTIVE = WORLD_QUEST_CALLIGRAPHY_QUEST.objective;
if (OBJECTIVE.type !== 'tracing') throw new Error('Expected the authored tracing objective');
const SHAPES = OBJECTIVE.shapes;

function run(state?: CharacterState) {
  const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', noPlayer: true, world: WORLD });
  // A real host rotation that offers calligraphy; no dev override may mask save loss.
  sim.resetDay = '2026-09-18';
  const pid = sim.addPlayer('warrior', 'Scribe', state ? { state } : undefined);
  const meta = sim.meta(pid)!;
  const player = sim.entities.get(pid)!;
  if (!state) {
    sim.setPlayerLevel(10, pid);
    player.pos = sim.groundPos(172, -35);
    player.prevPos = { ...player.pos };
  }
  const events: SimEvent[] = sim.drainEvents();
  const tick = () => events.push(...sim.tick());
  tick();
  const walk = (point: { x: number; z: number }) => {
    for (
      let i = 0;
      i < 200 && Math.hypot(player.pos.x - point.x, player.pos.z - point.z) >= 0.3;
      i++
    ) {
      player.facing = Math.atan2(point.x - player.pos.x, point.z - player.pos.z);
      meta.moveInput.forward = true;
      tick();
    }
    meta.moveInput.forward = false;
    expect(Math.hypot(player.pos.x - point.x, player.pos.z - point.z)).toBeLessThan(0.3);
  };
  const talk = () => {
    sim.targetEntity(WORLD_QUEST_CALLIGRAPHY_NPC_IDS.calligraphy_instructor, pid);
    sim.interact(pid);
  };
  const prepare = (shapeIndex: number) => {
    expect(meta.worldQuestLog.get(QUEST_ID)?.tracing).toMatchObject({
      phase: 'preview',
      shapeIndex,
    });
    walk(
      worldQuestTraceShape(
        WORLD_QUEST_CALLIGRAPHY_QUEST,
        shapeIndex,
        meta.worldQuestLog.get(QUEST_ID)?.traceVariant,
      )!.points[0],
    );
    for (let i = 0; i < 125; i++) tick();
    expect(meta.worldQuestLog.get(QUEST_ID)?.tracing).toMatchObject({
      phase: 'drawing',
      shapeIndex,
    });
  };
  const finish = (shapeIndex: number) => {
    prepare(shapeIndex);
    for (const point of worldQuestTraceShape(
      WORLD_QUEST_CALLIGRAPHY_QUEST,
      shapeIndex,
      meta.worldQuestLog.get(QUEST_ID)?.traceVariant,
    )!.points.slice(1))
      walk(point);
    expect(meta.worldQuestLog.get(QUEST_ID)?.count).toBe(shapeIndex + 1);
  };
  return { sim, pid, meta, events, tick, walk, talk, finish };
}

function rewardEvents(events: SimEvent[]) {
  return events.filter(
    (event) =>
      (event.type === 'worldQuestDone' && event.questId === QUEST_ID) ||
      (event.type === 'deedUnlocked' && event.deedId === DEED_ID),
  );
}

describe('calligraphy completed-round persistence', () => {
  it('keeps the original star for a legacy save without a variant field', () => {
    const [legacy] = sanitizeWorldQuestProgress([{ questId: QUEST_ID, count: 2, state: 'active' }]);
    expect(legacy.traceVariant).toBe('star');
    expect(worldQuestTraceShape(WORLD_QUEST_CALLIGRAPHY_QUEST, 2, legacy.traceVariant)?.kind).toBe(
      'star',
    );
  });
  it('retains future variant IDs, drops invalid style metrics and never trusts a supplied Gold result', () => {
    const [future] = sanitizeWorldQuestProgress([
      {
        questId: QUEST_ID,
        count: 2,
        state: 'active',
        traceVariant: 'future-rune',
        traceScores: [{ precision: Infinity, efficiency: 100, time: 100 }],
        traceResult: { rating: 'gold', score: 100 },
      },
    ]);
    expect(future).toMatchObject({ count: 2, traceVariant: 'future-rune' });
    expect(future.traceScores).toBeUndefined();
    expect(future.traceResult).toBeUndefined();
    expect(
      worldQuestTraceShape(WORLD_QUEST_CALLIGRAPHY_QUEST, 2, future.traceVariant),
    ).toBeUndefined();
    const [completed] = sanitizeWorldQuestProgress([
      {
        questId: QUEST_ID,
        count: 3,
        state: 'completed',
        traceVariant: 'star',
        traceScores: Array.from({ length: 3 }, () => ({ precision: 50, efficiency: 50, time: 50 })),
        traceResult: { rating: 'gold', score: 100 },
      },
    ]);
    expect(completed.traceResult).toEqual({
      precision: 50,
      efficiency: 50,
      time: 50,
      score: 50,
      rating: 'bronze',
    });
  });

  it.each([1, 2])('resumes after %s completed outlines without replaying rewards', (completed) => {
    const original = run();
    const xp = original.meta.xp;
    original.talk();
    for (let shapeIndex = 0; shapeIndex < completed; shapeIndex++) original.finish(shapeIndex);
    expect(original.meta.worldQuestLog.get(QUEST_ID)?.tracing).toMatchObject({
      phase: 'preview',
      shapeIndex: completed,
    });
    expect(original.meta.xp).toBe(xp);
    expect(original.meta.deedsEarned.has(DEED_ID)).toBe(false);
    expect(rewardEvents(original.events)).toEqual([]);
    const saved = original.sim.serializeCharacter(original.pid)!;
    const savedProgress = saved.worldQuests?.progress.find(
      (progress) => progress.questId === QUEST_ID,
    );
    expect(savedProgress).toMatchObject({
      questId: QUEST_ID,
      count: completed,
      state: 'active',
    });
    expect(savedProgress?.traceVariant).toBe(
      original.meta.worldQuestLog.get(QUEST_ID)?.traceVariant,
    );
    expect(savedProgress?.traceScores).toHaveLength(completed);
    expect(savedProgress?.tracing).toBeUndefined();

    const restored = run(saved);
    expect(restored.meta.worldQuestLog.get(QUEST_ID)).toEqual(savedProgress);
    expect(restored.meta.worldQuestLog.get(QUEST_ID)).toMatchObject({
      questId: QUEST_ID,
      count: completed,
      state: 'active',
    });
    expect(restored.meta.xp).toBe(xp);
    expect(restored.meta.deedsEarned.has(DEED_ID)).toBe(false);
    expect(rewardEvents(restored.events)).toEqual([]);
    restored.walk({ x: 172, z: -35 });
    restored.talk();
    expect(restored.meta.worldQuestLog.get(QUEST_ID)?.tracing).toMatchObject({
      phase: 'preview',
      shapeIndex: completed,
      segment: 0,
      trail: [],
    });
    for (let shapeIndex = completed; shapeIndex < SHAPES.length; shapeIndex++)
      restored.finish(shapeIndex);
    expect(restored.meta.worldQuestLog.get(QUEST_ID)?.state).toBe('completed');
    expect(restored.meta.xp).toBeGreaterThan(xp);
    expect(rewardEvents(restored.events)).toHaveLength(2);
    const paidXp = restored.meta.xp;
    const completedSave = restored.sim.serializeCharacter(restored.pid)!;
    const completedProgress = completedSave.worldQuests?.progress.find(
      (progress) => progress.questId === QUEST_ID,
    );
    expect(completedProgress?.traceScores).toHaveLength(3);
    expect(completedProgress?.traceResult?.rating).toBe('gold');
    const finalLoad = run(completedSave);
    finalLoad.talk();
    for (let i = 0; i < 125; i++) finalLoad.tick();
    expect(finalLoad.meta.xp).toBe(paidXp);
    expect(finalLoad.meta.deedsEarned.get(DEED_ID)).toBe(restored.meta.deedsEarned.get(DEED_ID));
    expect(finalLoad.meta.worldQuestLog.get(QUEST_ID)).toEqual(completedProgress);
    expect(rewardEvents(finalLoad.events)).toEqual([]);
  });
});
