import { describe, expect, it } from 'vitest';
import { BUILTIN_WORLD, EASTBROOK_FREIGHT_CARAVAN_ESCORT_ID, ESCORTS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';
import { worldQuestCycleOfferingQuest } from '../src/sim/world_quest_rotation';

const DEF = ESCORTS[EASTBROOK_FREIGHT_CARAVAN_ESCORT_ID];
const QUEST_ID = 'wq_eastbrook_caravan';

function setup() {
  const sim = new Sim({
    seed: 424242,
    playerClass: 'warrior',
    noPlayer: true,
    world: { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] },
  });
  const pid = sim.addPlayer('warrior', 'Listener');
  const player = sim.entities.get(pid)!;
  player.level = 10;
  sim.meta(pid)!.devWorldQuestCycle = worldQuestCycleOfferingQuest('wq3_0', QUEST_ID);
  player.pos = sim.groundPos(DEF.start.x, DEF.start.z);
  player.prevPos = { ...player.pos };
  sim.tick();
  const state = sim.escortRuns.get(DEF.id)!;
  const wagon = sim.entities.get(state.npcId!)!;
  sim.interact(pid);
  return { sim, pid, player, wagon, state };
}

function speeches(events: SimEvent[], entityId: number) {
  return events.filter(
    (event): event is Extract<SimEvent, { type: 'chat' }> =>
      event.type === 'chat' && event.entityId === entityId,
  );
}

function follow(sim: Sim, player: Entity, wagon: Entity) {
  player.pos = sim.groundPos(wagon.pos.x + 1, wagon.pos.z);
  player.prevPos = { ...player.pos };
  wagon.hp = wagon.maxHp;
}

describe('escort checkpoint story', () => {
  it('tells the whole story once in order, suppresses it during waves, and leaves the finale visible', () => {
    const play = () => {
      const { sim, pid, player, wagon, state } = setup();
      const trace = speeches(sim.drainEvents(), wagon.id).map((event) => ({
        text: event.text,
        from: event.from,
        at: sim.time,
      }));
      const heldWaves = new Set<number>();
      let finaleAt: number | undefined;
      for (let tick = 0; tick < 20 * 180 && state.run; tick++) {
        follow(sim, player, wagon);
        const live = state.run.ambushIds
          .map((id) => sim.entities.get(id))
          .filter((entity): entity is Entity => !!entity && !entity.dead);
        if (live.length > 0 && !heldWaves.has(state.run.ambushIds.length)) {
          heldWaves.add(state.run.ambushIds.length);
          const position = { ...wagon.pos };
          // Keep an entire reading interval in combat. No queued story line
          // may be emitted even when its checkpoint and cooldown are satisfied.
          for (let wait = 0; wait < 20 * 9; wait++) {
            follow(sim, player, wagon);
            expect(speeches(sim.tick(), wagon.id)).toEqual([]);
          }
          expect(wagon.pos).toEqual(position);
        }
        for (const enemy of live) {
          enemy.dead = true;
          enemy.hp = 0;
          enemy.respawnTimer = 99_999;
        }
        for (const event of speeches(sim.tick(), wagon.id)) {
          trace.push({ text: event.text, from: event.from, at: sim.time });
          if (event.text === DEF.successText) finaleAt = sim.time;
        }
        if (finaleAt !== undefined && sim.time < finaleAt + 7) {
          expect(sim.entities.has(wagon.id)).toBe(true);
          expect(sim.meta(pid)?.worldQuestLog.get(QUEST_ID)?.state).toBe('active');
        }
      }
      expect(state.run).toBeNull();
      expect(sim.entities.has(wagon.id)).toBe(false);
      expect(sim.meta(pid)?.worldQuestLog.get(QUEST_ID)?.state).toBe('completed');
      expect(heldWaves.size).toBe(3);
      expect(trace.every((line) => line.from === 'Tobin')).toBe(true);
      const narrative = trace.filter((line) => line.text !== DEF.story!.ambushText);
      expect(narrative.map((line) => line.text)).toEqual([
        DEF.startText,
        ...DEF.story!.lines.map((line) => line.text),
        DEF.successText,
      ]);
      expect(trace.filter((line) => line.text === DEF.story!.ambushText)).toHaveLength(3);
      for (let index = 1; index < narrative.length; index++) {
        expect(narrative[index].at - narrative[index - 1].at).toBeGreaterThanOrEqual(7);
      }
      expect(sim.time - finaleAt!).toBeGreaterThanOrEqual(7);
      return trace;
    };
    expect(play()).toEqual(play());
  }, 60_000);

  it('restarts the story after a failed run without retaining a cursor or speech deadline', () => {
    const { sim, pid, player, wagon, state } = setup();
    const first = state.run!;
    first.story!.nextLine = 2;
    first.story!.nextSpeechAt = sim.time + 500;
    wagon.dead = true;
    wagon.hp = 0;
    wagon.respawnTimer = 99_999;
    sim.tick();
    expect(state.run).toBeNull();
    for (let tick = 0; tick < 20 * 31 && state.npcId === null; tick++) sim.tick();
    const replacement = sim.entities.get(state.npcId!)!;
    expect(replacement.id).not.toBe(wagon.id);
    player.pos = { ...replacement.pos };
    player.prevPos = { ...replacement.pos };
    sim.drainEvents();
    sim.interact(pid);
    expect(state.run?.story).toEqual({ nextLine: 0, nextSpeechAt: sim.time + 7 });
    expect(speeches(sim.drainEvents(), replacement.id).map((event) => event.text)).toEqual([
      DEF.startText,
    ]);
  });
});
