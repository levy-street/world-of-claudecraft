// The operator world quest block (src/sim/world_quest_block.ts): an account the
// admin dashboard has blocked starts, progresses, and earns nothing from world
// quests, while a lifted block resumes them without replaying a claimed reward.
// Driven through the real Sim tick and the real kill-credit arm.
import { describe, expect, it } from 'vitest';
import { GLIDER_APPRENTICE_NPC_DEF } from '../src/sim/content/world_quest_glider';
import { WORLD_QUESTS_BY_ID } from '../src/sim/content/world_quests';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';
import { setWorldQuestsBlocked, worldQuestsBlocked } from '../src/sim/world_quest_block';
import { awardWorldQuestBonusCopper } from '../src/sim/world_quest_bonus';
import { onMobKilledForWorldQuests, talkToWorldQuestInstructor } from '../src/sim/world_quests';

const THORNPEAK = 'wq_thornpeak_stormcrag';

function metaOf(sim: Sim): PlayerMeta {
  const meta = sim.meta(sim.playerId);
  if (!meta) throw new Error('Missing player meta');
  return meta;
}

function placeAt(sim: Sim, x: number, z: number): void {
  const player = sim.player;
  player.pos.x = x;
  player.pos.z = z;
  player.pos.y = terrainHeight(x, z, sim.cfg.seed);
  player.prevPos = { ...player.pos };
}

/** A capped warrior on the first cycle, standing outside every quest area. */
function cappedSim(blocked: boolean): Sim {
  const sim = new Sim({ seed: 4711, playerClass: 'warrior', autoEquip: true });
  sim.setPlayerLevel(20);
  sim.utcDay = '2026-08-31';
  sim.resetDay = '2026-08-31';
  setWorldQuestsBlocked(metaOf(sim), blocked);
  return sim;
}

/** Steps into Thornpeak and runs one tick; returns that tick's events. */
function enterThornpeak(sim: Sim): SimEvent[] {
  const quest = WORLD_QUESTS_BY_ID[THORNPEAK];
  placeAt(sim, quest.area.x, quest.area.z);
  return sim.tick();
}

/** One Thornpeak kill through the real credit arm, the target inside the area. */
function killThornpeakTarget(sim: Sim, times = 1): void {
  const quest = WORLD_QUESTS_BY_ID[THORNPEAK];
  if (quest.objective.type !== 'kill') throw new Error('Expected a kill objective');
  const targetMobId = quest.objective.targetMobId;
  const target = [...sim.entities.values()].find(
    (entity) => entity.kind === 'mob' && entity.templateId === targetMobId,
  );
  if (!target) throw new Error(`Missing target ${targetMobId}`);
  target.pos.x = quest.area.x;
  target.pos.z = quest.area.z;
  for (let i = 0; i < times; i++) onMobKilledForWorldQuests(sim.ctx, target, metaOf(sim));
}

function worldQuestDoneEvents(sim: Sim): number {
  return sim.drainEvents().filter((event) => event.type === 'worldQuestDone').length;
}

describe('the world quest block flag', () => {
  it('is absent when unblocked, never false', () => {
    const meta: { worldQuestsBlocked?: boolean } = {};
    setWorldQuestsBlocked(meta, true);
    expect(meta.worldQuestsBlocked).toBe(true);
    expect(worldQuestsBlocked(meta)).toBe(true);
    setWorldQuestsBlocked(meta, false);
    expect('worldQuestsBlocked' in meta).toBe(false);
    expect(worldQuestsBlocked(meta)).toBe(false);
  });

  it('is never set on a fresh offline character', () => {
    const sim = new Sim({ seed: 4711, playerClass: 'warrior' });
    expect(worldQuestsBlocked(metaOf(sim))).toBe(false);
  });
});

describe('a blocked account', () => {
  it('starts nothing on entering a quest area', () => {
    const sim = cappedSim(true);
    const events = enterThornpeak(sim);
    const meta = metaOf(sim);
    expect(meta.worldQuestLog.has(THORNPEAK)).toBe(false);
    expect(meta.worldQuestAreas.size).toBe(0);
    expect(events.some((event) => event.type === 'worldQuestStarted')).toBe(false);
  });

  it('earns no progress, completion, XP or copper from kills in the area', () => {
    const sim = cappedSim(true);
    enterThornpeak(sim);
    const meta = metaOf(sim);
    const copper = meta.copper;
    const xp = meta.xp;
    const completed = meta.counters.questsCompleted;
    sim.drainEvents();
    killThornpeakTarget(sim, WORLD_QUESTS_BY_ID[THORNPEAK].count);
    expect(meta.worldQuestLog.has(THORNPEAK)).toBe(false);
    expect(meta.copper).toBe(copper);
    expect(meta.xp).toBe(xp);
    expect(meta.counters.questsCompleted).toBe(completed);
    expect(worldQuestDoneEvents(sim)).toBe(0);
  });

  it('drops an in-progress row and its area the tick the block lands, and kills stop counting', () => {
    const sim = cappedSim(false);
    enterThornpeak(sim);
    const meta = metaOf(sim);
    killThornpeakTarget(sim);
    expect(meta.worldQuestLog.get(THORNPEAK)).toMatchObject({ state: 'active', count: 1 });
    expect(meta.worldQuestAreas.has(THORNPEAK)).toBe(true);

    setWorldQuestsBlocked(meta, true);
    const wireRev = meta.wireRev;
    sim.tick();
    expect(meta.worldQuestLog.has(THORNPEAK)).toBe(false);
    expect(meta.worldQuestAreas.size).toBe(0);
    expect(meta.wireRev).toBeGreaterThan(wireRev);

    const copper = meta.copper;
    killThornpeakTarget(sim, WORLD_QUESTS_BY_ID[THORNPEAK].count);
    expect(meta.worldQuestLog.has(THORNPEAK)).toBe(false);
    expect(meta.copper).toBe(copper);
  });

  it('keeps a completed row, so lifting the block the same day cannot replay its reward', () => {
    const sim = cappedSim(false);
    enterThornpeak(sim);
    const meta = metaOf(sim);
    killThornpeakTarget(sim, WORLD_QUESTS_BY_ID[THORNPEAK].count);
    expect(meta.worldQuestLog.get(THORNPEAK)?.state).toBe('completed');
    sim.drainEvents();

    setWorldQuestsBlocked(meta, true);
    sim.tick();
    expect(meta.worldQuestLog.get(THORNPEAK)?.state).toBe('completed');

    setWorldQuestsBlocked(meta, false);
    const copper = meta.copper;
    sim.tick();
    killThornpeakTarget(sim, WORLD_QUESTS_BY_ID[THORNPEAK].count);
    expect(meta.worldQuestLog.get(THORNPEAK)?.state).toBe('completed');
    expect(meta.copper).toBe(copper);
    expect(worldQuestDoneEvents(sim)).toBe(0);
  });

  it('closes an open puzzle board on its next tick', () => {
    const sim = cappedSim(false);
    const meta = metaOf(sim);
    // Settle the cycle first: the rollover closes an open board on its own, and
    // this pins the block's teardown, not the rollover's.
    sim.tick();
    meta.openWorldQuestPuzzleId = THORNPEAK;
    setWorldQuestsBlocked(meta, true);
    const events = enterThornpeak(sim);
    expect(meta.openWorldQuestPuzzleId).toBeNull();
    expect(
      events.some(
        (event) => event.type === 'worldQuestPuzzleClosed' && event.questId === THORNPEAK,
      ),
    ).toBe(true);
  });

  it('gets no bonus purse', () => {
    const sim = cappedSim(true);
    const meta = metaOf(sim);
    const copper = meta.copper;
    awardWorldQuestBonusCopper(sim.ctx, meta, 5_000);
    expect(meta.copper).toBe(copper);
    setWorldQuestsBlocked(meta, false);
    awardWorldQuestBonusCopper(sim.ctx, meta, 5_000);
    expect(meta.copper).toBe(copper + 5_000);
  });

  it('opens nothing at an instructor, and the talk falls through as a non-instructor would', () => {
    const sim = cappedSim(true);
    sim.tick();
    const npc = [...sim.entities.values()].find(
      (entity) => entity.kind === 'npc' && entity.templateId === GLIDER_APPRENTICE_NPC_DEF.id,
    );
    if (!npc) throw new Error('Missing glider instructor');
    const meta = metaOf(sim);
    placeAt(sim, npc.pos.x + 1, npc.pos.z);
    expect(talkToWorldQuestInstructor(sim.ctx, npc, meta, sim.player)).toBe(false);
    expect(meta.worldQuestLog.size).toBe(0);
  });
});

describe('a lifted block', () => {
  it('resumes world quests: the area starts the quest and the kills pay', () => {
    const sim = cappedSim(true);
    enterThornpeak(sim);
    const meta = metaOf(sim);
    expect(meta.worldQuestLog.has(THORNPEAK)).toBe(false);

    setWorldQuestsBlocked(meta, false);
    const events = sim.tick();
    expect(meta.worldQuestLog.get(THORNPEAK)?.state).toBe('active');
    expect(events.some((event) => event.type === 'worldQuestStarted')).toBe(true);
    const copper = meta.copper;
    sim.drainEvents();
    killThornpeakTarget(sim, WORLD_QUESTS_BY_ID[THORNPEAK].count);
    expect(meta.worldQuestLog.get(THORNPEAK)?.state).toBe('completed');
    expect(meta.copper).toBeGreaterThan(copper);
    expect(worldQuestDoneEvents(sim)).toBe(1);
  });
});
