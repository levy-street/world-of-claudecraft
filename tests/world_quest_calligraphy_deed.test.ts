import { describe, expect, it } from 'vitest';
import { DEEDS } from '../src/sim/content/deeds';
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
import { WORLD_SEED } from '../src/sim/world_seed';

const DEED_ID = 'exp_arcane_calligraphy';
const WORLD = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: WORLD_QUEST_CALLIGRAPHY_NPCS,
  groundObjects: [],
};

describe('Arcane Calligraphy deed', () => {
  it('pins its outcome-only cosmetic catalog contract', () => {
    expect(DEEDS[DEED_ID]).toEqual({
      id: DEED_ID,
      name: 'A Steady Hand',
      desc: 'Complete Arcane Calligraphy in Eastbrook Vale.',
      category: 'exploration',
      renown: 5,
      trigger: { kind: 'manual' },
    });
  });

  it('awards a walked success, never failure or retry, and retains the deed after save/load', () => {
    const sim = new Sim({
      seed: WORLD_SEED,
      playerClass: 'warrior',
      devCommands: true,
      world: WORLD,
    });
    const meta = sim.meta(sim.playerId)!;
    const events: SimEvent[] = [];
    const tick = () => events.push(...sim.tick());
    const walk = (point: { x: number; z: number }) => {
      for (
        let i = 0;
        i < 200 && Math.hypot(sim.player.pos.x - point.x, sim.player.pos.z - point.z) >= 0.3;
        i++
      ) {
        sim.player.facing = Math.atan2(point.x - sim.player.pos.x, point.z - sim.player.pos.z);
        meta.moveInput.forward = true;
        tick();
      }
      meta.moveInput.forward = false;
      expect(Math.hypot(sim.player.pos.x - point.x, sim.player.pos.z - point.z)).toBeLessThan(0.3);
    };
    const objective = WORLD_QUEST_CALLIGRAPHY_QUEST.objective;
    if (objective.type !== 'tracing') throw new Error('Expected tracing objective');
    const begin = () => {
      sim.targetEntity(WORLD_QUEST_CALLIGRAPHY_NPC_IDS.calligraphy_instructor);
      sim.interact();
      walk(objective.shapes[0].points[0]);
      for (let i = 0; i < 125; i++) tick();
      expect(meta.worldQuestLog.get(QUEST_ID)?.tracing?.phase).toBe('drawing');
    };
    sim.resetDay = '2026-09-04';
    sim.chat('/dev calligraphy');
    sim.player.pos = sim.groundPos(172, -35);
    sim.player.prevPos = { ...sim.player.pos };
    tick();
    begin();
    walk({ x: 172, z: -28 });
    expect(meta.worldQuestLog.get(QUEST_ID)?.tracing?.phase).toBe('failed');
    expect(meta.deedsEarned.has(DEED_ID)).toBe(false);
    walk({ x: 172, z: -35 });
    begin();
    expect(meta.deedsEarned.has(DEED_ID)).toBe(false);
    const renownBefore = meta.renown;
    for (const index of objective.shapes.keys()) {
      const shape = worldQuestTraceShape(
        WORLD_QUEST_CALLIGRAPHY_QUEST,
        index,
        meta.worldQuestLog.get(QUEST_ID)?.traceVariant,
      )!;
      if (index > 0) {
        expect(meta.worldQuestLog.get(QUEST_ID)?.tracing?.phase).toBe('preview');
        walk(shape.points[0]);
        for (let i = 0; i < 125; i++) tick();
      }
      for (const point of shape.points.slice(1)) walk(point);
      if (index < 2) {
        expect(meta.deedsEarned.has(DEED_ID)).toBe(false);
        expect(meta.renown).toBe(renownBefore);
      }
    }
    expect(meta.worldQuestLog.get(QUEST_ID)?.state).toBe('completed');
    expect(meta.deedsEarned.has(DEED_ID)).toBe(true);
    expect(meta.worldQuestLog.get(QUEST_ID)?.traceResult?.rating).toBe('gold');
    expect(meta.deedsEarned.has('exp_arcane_calligraphy_gold')).toBe(true);
    expect(DEEDS.exp_arcane_calligraphy_gold.reward).toEqual({
      kind: 'title',
      text: 'the Runecaller',
    });
    expect(meta.renown).toBe(renownBefore + 15);
    expect(
      events.filter(
        (event) => event.type === 'deedUnlocked' && event.deedId === 'exp_arcane_calligraphy_gold',
      ),
    ).toHaveLength(1);
    expect(
      events.filter((event) => event.type === 'worldQuestDone' && event.questId === QUEST_ID),
    ).toMatchObject([{ traceResult: { rating: 'gold' } }]);
    expect(
      events.filter((event) => event.type === 'deedUnlocked' && event.deedId === DEED_ID),
    ).toHaveLength(1);
    sim.chat('/dev calligraphy');
    sim.interact();
    for (let i = 0; i < 110; i++) tick();
    expect(meta.renown).toBe(renownBefore + 15);
    expect(
      events.filter((event) => event.type === 'deedUnlocked' && event.deedId === DEED_ID),
    ).toHaveLength(1);
    const state = sim.serializeCharacter(sim.playerId)!;
    const restored = new Sim({
      seed: WORLD_SEED,
      playerClass: 'warrior',
      noPlayer: true,
      world: WORLD,
    });
    const pid = restored.addPlayer('warrior', 'Scribe', { state });
    expect(restored.meta(pid)?.deedsEarned.get(DEED_ID)).toBe(meta.deedsEarned.get(DEED_ID));
    expect(restored.meta(pid)?.renown).toBe(meta.renown);
    expect(
      restored
        .drainEvents()
        .filter((event) => event.type === 'deedUnlocked' && event.deedId === DEED_ID),
    ).toHaveLength(0);
  });
});
