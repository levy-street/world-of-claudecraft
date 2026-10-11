import { describe, expect, it } from 'vitest';
import { dispatchWorldQuestWire } from '../server/quest_command_wire';
import { QuestWorldWireState } from '../src/net/quest_world_wire_state';
import { GLIDER_QUEST_ID } from '../src/sim/content/world_quest_glider';
import { Sim } from '../src/sim/sim';
import { decodeGliderState } from '../src/sim/world_quest_glider_wire';

function setup() {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', devCommands: true });
  sim.resetDay = '2026-09-06';
  sim.chat('/dev glider start');
  const meta = sim.meta(sim.playerId)!;
  const progress = meta.worldQuestLog.get(GLIDER_QUEST_ID)!;
  const state = progress.glider!;
  state.phase = 'flying';
  state.speed = 8;
  return { sim, meta, progress, state };
}

describe('authoritative world quest glider boost', () => {
  it('routes the online action to the authenticated player and mirrors only accepted state', () => {
    const { sim, meta, state } = setup();
    class Transport extends QuestWorldWireState {
      protected override sendQuestWorldCommand(
        command: Parameters<typeof dispatchWorldQuestWire>[1],
      ) {
        dispatchWorldQuestWire(sim, { ...command, pid: 987654, speed: 999 }, sim.playerId);
      }
    }
    const client = new Transport();
    const revision = meta.wireRev;
    client.boostWorldQuestGlider();
    expect(state.speed).toBe(22);
    expect(state.boostReadyTick).toBe(200);
    expect(meta.wireRev).toBe(revision + 1);
    client.boostWorldQuestGlider();
    expect(meta.wireRev).toBe(revision + 1);
    expect(decodeGliderState(state, GLIDER_QUEST_ID)).toEqual(state);
    expect(client.worldQuestLog.size).toBe(0);
    expect(
      sim.serializeCharacter(sim.playerId)?.worldQuests?.progress.some((row) => 'glider' in row),
    ).toBe(false);
  });

  it('does not let an unknown player or another player boost the participant', () => {
    const { sim, state } = setup();
    const other = sim.addPlayer('warrior', 'Other');
    sim.boostWorldQuestGlider(other);
    sim.boostWorldQuestGlider(987654);
    expect(state.speed).toBe(8);
  });

  it('rejects dead players, inactive quests and expired rotations', () => {
    const { sim, meta, progress, state } = setup();
    sim.player.dead = true;
    sim.boostWorldQuestGlider();
    expect(state.speed).toBe(8);
    sim.player.dead = false;
    sim.player.ghost = true;
    sim.boostWorldQuestGlider();
    expect(state.speed).toBe(8);
    sim.player.ghost = false;
    progress.state = 'completed';
    sim.boostWorldQuestGlider();
    expect(state.speed).toBe(8);
    progress.state = 'active';
    meta.devWorldQuestCycle = null;
    sim.resetDay = '2026-09-07';
    sim.boostWorldQuestGlider();
    expect(state.speed).toBe(8);
    expect(sim.worldQuestLog.get(GLIDER_QUEST_ID)?.glider).toBeUndefined();
  });

  it('resets the cooldown when starting a fresh attempt', () => {
    const { sim, state } = setup();
    sim.boostWorldQuestGlider();
    state.phase = 'failed';
    sim.chat('/dev glider start');
    const next = sim.worldQuestLog.get(GLIDER_QUEST_ID)!.glider!;
    expect(next).not.toBe(state);
    expect(next.boostReadyTick).toBe(0);
    sim.boostWorldQuestGlider();
    expect(next.boostReadyTick).toBe(0);
  });

  it('bounds malformed snapshot cooldowns and accepts older omitted fields', () => {
    const { state } = setup();
    for (const value of [undefined, -1, Infinity, 201, 0.5, '200']) {
      expect(
        decodeGliderState({ ...state, boostReadyTick: value }, GLIDER_QUEST_ID)?.boostReadyTick,
      ).toBe(0);
    }
    expect(
      decodeGliderState({ ...state, boostReadyTick: 200 }, GLIDER_QUEST_ID)?.boostReadyTick,
    ).toBe(200);
  });
});
