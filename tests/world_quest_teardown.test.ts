import { describe, expect, it } from 'vitest';
import { GLIDER_NPC_DEF, GLIDER_QUEST_ID } from '../src/sim/content/world_quest_glider';
import {
  INVESTIGATION_MOB_ID,
  INVESTIGATION_QUEST_ID,
} from '../src/sim/content/world_quest_investigation';
import {
  WISP_MAZE_NPC_DEF,
  WISP_MAZE_QUEST_ID,
  WISP_MAZE_SITE,
} from '../src/sim/content/world_quest_wisp_maze';
import { WORLD_QUESTS_BY_ID } from '../src/sim/content/world_quests';
import { summonQuestMob } from '../src/sim/encounters/quest_summon';
import type { GliderFlightState } from '../src/sim/minigames/glider_flight';
import { createWispMaze } from '../src/sim/minigames/wisp_maze';
import { Sim } from '../src/sim/sim';
import {
  hasWorldQuestDeliveryCargo,
  takeWorldQuestDeliveryCargo,
} from '../src/sim/world_quest_delivery';
import { endWorldQuestSession } from '../src/sim/world_quest_teardown';

function setup() {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
  sim.setPlayerLevel(20);
  const meta = sim.meta(sim.playerId);
  if (!meta) throw new Error('Expected player meta');
  return { sim, meta };
}

function near(a: { x: number; z: number }, b: { x: number; z: number }, yards: number) {
  return Math.hypot(a.x - b.x, a.z - b.z) <= yards;
}

describe('endWorldQuestSession', () => {
  it('lands a glider flight back at the launch', () => {
    const { sim, meta } = setup();
    const quest = WORLD_QUESTS_BY_ID[GLIDER_QUEST_ID];
    const progress = { questId: quest.id, count: 0, state: 'active' as const };
    meta.worldQuestLog.set(quest.id, {
      ...progress,
      glider: { phase: 'flying' } as GliderFlightState,
    });
    sim.player.pos = sim.groundPos(GLIDER_NPC_DEF.pos.x + 300, GLIDER_NPC_DEF.pos.z + 300);
    endWorldQuestSession(sim.ctx, meta, quest);
    expect(meta.worldQuestLog.get(quest.id)?.glider).toBeUndefined();
    expect(near(sim.player.pos, GLIDER_NPC_DEF.pos, 2)).toBe(true);
  });

  it('drops the investigation suspect the player summoned', () => {
    const { sim, meta } = setup();
    const quest = WORLD_QUESTS_BY_ID[INVESTIGATION_QUEST_ID];
    const pos = { x: quest.area.x, y: 0, z: quest.area.z };
    summonQuestMob(sim.ctx, INVESTIGATION_MOB_ID, pos, meta.entityId, { perOwner: true });
    const mob = [...sim.entities.values()].find((e) => e.templateId === INVESTIGATION_MOB_ID);
    if (!mob) throw new Error('Expected the summoned suspect');
    expect(mob.tappedById).toBe(meta.entityId);
    meta.worldQuestLog.set(quest.id, {
      questId: quest.id,
      count: 0,
      state: 'active',
      investigation: { heard: 7, clues: 7, cleared: 0, mobId: mob.id },
    });
    endWorldQuestSession(sim.ctx, meta, quest);
    expect(sim.entities.has(mob.id)).toBe(false);
    expect(meta.worldQuestLog.get(quest.id)?.investigation?.mobId).toBeUndefined();
  });

  it('walks a player out of a wisp maze run in play, and leaves a paused one alone', () => {
    const { sim, meta } = setup();
    const quest = WORLD_QUESTS_BY_ID[WISP_MAZE_QUEST_ID];
    const maze = createWispMaze(1);
    meta.worldQuestLog.set(quest.id, {
      questId: quest.id,
      count: 0,
      state: 'active',
      wispMaze: { ...maze, paused: false },
    });
    const inMaze = { x: WISP_MAZE_SITE.x + maze.playerX, z: WISP_MAZE_SITE.z + maze.playerZ };
    sim.player.pos = sim.groundPos(inMaze.x, inMaze.z);
    endWorldQuestSession(sim.ctx, meta, quest);
    expect(near(sim.player.pos, WISP_MAZE_NPC_DEF.pos, 2)).toBe(true);

    meta.worldQuestLog.set(quest.id, {
      questId: quest.id,
      count: 0,
      state: 'active',
      wispMaze: { ...maze, paused: true },
    });
    sim.player.pos = sim.groundPos(inMaze.x, inMaze.z);
    endWorldQuestSession(sim.ctx, meta, quest);
    expect(near(sim.player.pos, inMaze, 0.01)).toBe(true);
  });

  it('drops delivery freight only when the player is inside that quest area', () => {
    const { sim, meta } = setup();
    const quest = WORLD_QUESTS_BY_ID.wq_eastbrook_bandits;
    expect(quest.objective.type).toBe('delivery');
    expect(takeWorldQuestDeliveryCargo(sim.ctx, sim.player)).toBe(true);

    endWorldQuestSession(sim.ctx, meta, quest);
    expect(hasWorldQuestDeliveryCargo(sim.player)).toBe(true);

    meta.worldQuestAreas.add(quest.id);
    endWorldQuestSession(sim.ctx, meta, quest);
    expect(hasWorldQuestDeliveryCargo(sim.player)).toBe(false);
  });

  it('closes the open puzzle board of that quest and no other', () => {
    const { sim, meta } = setup();
    const quest = WORLD_QUESTS_BY_ID.wq_galecrest_wisps;
    const other = WORLD_QUESTS_BY_ID.wq_palmreach_confections;
    meta.openWorldQuestPuzzleId = quest.id;
    sim.drainEvents();

    endWorldQuestSession(sim.ctx, meta, other);
    expect(meta.openWorldQuestPuzzleId).toBe(quest.id);
    expect(sim.drainEvents().some((e) => e.type === 'worldQuestPuzzleClosed')).toBe(false);

    endWorldQuestSession(sim.ctx, meta, quest);
    expect(meta.openWorldQuestPuzzleId).toBeNull();
    expect(sim.drainEvents()).toContainEqual(
      expect.objectContaining({ type: 'worldQuestPuzzleClosed', questId: quest.id }),
    );
  });
});
