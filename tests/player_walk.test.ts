// Last Bell playerWalk scene op: resolved wire data, authoritative movement
// through the shared player kernel, skip parity, and unconditional teardown.
import { beforeAll, describe, expect, it } from 'vitest';
import { assembleEventsFrame, serializeEventFragments } from '../server/event_frame';
import { ClientWorld } from '../src/net/online';
import { registerScenario, startScenario } from '../src/sim/scenarios/scenarios';
import { playSceneForPlayer, registerScene, requestSceneSkip } from '../src/sim/scenes/scenes';
import { Sim } from '../src/sim/sim';
import { DT, type SimEvent } from '../src/sim/types';

const WALK_SCENE = 'scn_test_player_walk';
const SHORT_SCENE = 'scn_test_player_walk_short';
const DEGENERATE_SCENE = 'scn_test_player_walk_degenerate';
const INSTANCE_SCENE = 'scn_test_player_walk_instance';
const INSTANCE_SCENARIO = 'sc_test_player_walk_instance';
const INSTANCE_QUEST = 'q_fs_hold_the_riftfields';
const START = { x: 2, z: -2 };
const END = { x: 5, z: -2 };
const SPEED = 2;

beforeAll(() => {
  registerScene({
    id: WALK_SCENE,
    duration: 3,
    ops: [
      { at: 0, kind: 'inputLock', on: true },
      { at: 0, kind: 'playerWalk', to: END, speed: SPEED },
      { at: 2.5, kind: 'inputLock', on: false },
    ],
  });
  registerScene({
    id: SHORT_SCENE,
    duration: 0.2,
    ops: [
      { at: 0, kind: 'inputLock', on: true },
      { at: 0, kind: 'playerWalk', to: { x: 20, z: START.z }, speed: 1 },
    ],
  });
  registerScene({
    id: DEGENERATE_SCENE,
    duration: 1,
    ops: [
      { at: 0, kind: 'inputLock', on: true },
      { at: 0, kind: 'playerWalk', to: START },
    ],
  });
  registerScene({
    id: INSTANCE_SCENE,
    duration: 0.2,
    ops: [{ at: 0, kind: 'playerWalk', to: { x: 3, z: -4 }, speed: 1.5 }],
  });
  registerScenario({
    id: INSTANCE_SCENARIO,
    dungeonId: 'lb_council',
    questId: INSTANCE_QUEST,
    squad: { actorIds: ['coalfast', 'tam'] },
    stages: [{ id: 'walk', objective: { kind: 'scene' }, sceneId: INSTANCE_SCENE }],
  });
});

function makeSim(): Sim {
  const sim = new Sim({ seed: 313, playerClass: 'warrior', playerName: 'Bell' });
  const start = sim.groundPos(START.x, START.z);
  sim.player.pos = { ...start };
  sim.player.prevPos = { ...start };
  sim.rebucket(sim.player);
  return sim;
}

function sceneEvents(events: SimEvent[]): Extract<SimEvent, { type: 'scene' }>[] {
  return events.filter((event): event is Extract<SimEvent, { type: 'scene' }> => {
    return event.type === 'scene';
  });
}

function runUntilSceneEnds(sim: Sim, maxTicks = 200): void {
  for (let i = 0; i < maxTicks && sim.ctx.scenePlaybacks.size > 0; i++) sim.tick();
}

describe('playerWalk scene op', () => {
  it('walks through intermediate positions and matches an immediate skip endpoint exactly', () => {
    const watched = makeSim();
    expect(playSceneForPlayer(watched.ctx, watched.playerId, WALK_SCENE)).toBe(true);

    const armedEvents = sceneEvents(watched.tick());
    const wire = armedEvents.find((event) => event.op.kind === 'playerWalk');
    expect(wire?.op).toEqual({
      kind: 'playerWalk',
      to: watched.groundPos(END.x, END.z),
      speed: SPEED,
    });
    expect(watched.ctx.scriptedPlayerWalks.has(watched.playerId)).toBe(true);

    const intermediate: number[] = [];
    let movementTicks = 0;
    while (watched.ctx.scriptedPlayerWalks.has(watched.playerId) && movementTicks < 100) {
      watched.tick();
      movementTicks++;
      intermediate.push(watched.player.pos.x);
    }
    const expectedTicks = Math.ceil((END.x - START.x) / (SPEED * DT));
    expect(Math.abs(movementTicks - expectedTicks)).toBeLessThanOrEqual(1);
    expect(intermediate.some((x) => x > START.x && x < END.x)).toBe(true);
    expect(watched.player.pos).toEqual(watched.groundPos(END.x, END.z));
    expect(watched.ctx.scriptedPlayerWalks.has(watched.playerId)).toBe(false);
    runUntilSceneEnds(watched);
    expect(watched.ctx.scenePlaybacks.size).toBe(0);

    const skipped = makeSim();
    expect(playSceneForPlayer(skipped.ctx, skipped.playerId, WALK_SCENE)).toBe(true);
    expect(requestSceneSkip(skipped.ctx, skipped.playerId)).toBe(true);
    expect(skipped.ctx.scenePlaybacks.size).toBe(0);
    expect(skipped.ctx.scriptedPlayerWalks.has(skipped.playerId)).toBe(false);
    expect(skipped.player.pos).toEqual(watched.player.pos);

    if (!wire) expect.unreachable('playerWalk wire op missing');
    const frame = assembleEventsFrame(serializeEventFragments([wire]), 3.5);
    const client = Object.create(ClientWorld.prototype) as ClientWorld;
    (client as unknown as { eventQueue: SimEvent[] }).eventQueue = [];
    (client as unknown as { onMessage(raw: string): void }).onMessage(frame);
    expect(client.presentationTime).toBe(3.5);
    expect(client.drainEvents()).toEqual([{ ...wire, presentationTime: 3.5 }]);
  });

  it('clears an unfinished walk unconditionally when the scene ends', () => {
    const sim = makeSim();
    playSceneForPlayer(sim.ctx, sim.playerId, SHORT_SCENE);
    sim.tick();
    expect(sim.ctx.scriptedPlayerWalks.has(sim.playerId)).toBe(true);
    runUntilSceneEnds(sim);
    expect(sim.ctx.scenePlaybacks.size).toBe(0);
    expect(sim.ctx.scriptedPlayerWalks.has(sim.playerId)).toBe(false);
    expect(sim.player.pos).toEqual(sim.groundPos(20, START.z));
  });

  it('settles an under-authored natural end and a skip at the identical endpoint', () => {
    const watched = makeSim();
    expect(playSceneForPlayer(watched.ctx, watched.playerId, SHORT_SCENE)).toBe(true);
    runUntilSceneEnds(watched);

    const skipped = makeSim();
    expect(playSceneForPlayer(skipped.ctx, skipped.playerId, SHORT_SCENE)).toBe(true);
    expect(requestSceneSkip(skipped.ctx, skipped.playerId)).toBe(true);

    const endpoint = watched.groundPos(20, START.z);
    expect(watched.player.pos).toEqual(endpoint);
    expect(skipped.player.pos).toEqual(endpoint);
    expect(watched.player.pos).toEqual(skipped.player.pos);
  });

  it('terminates immediately when the player already occupies the endpoint', () => {
    const sim = makeSim();
    const before = { ...sim.player.pos };
    playSceneForPlayer(sim.ctx, sim.playerId, DEGENERATE_SCENE);
    const events = sceneEvents(sim.tick());
    expect(events.some((event) => event.op.kind === 'playerWalk')).toBe(true);
    expect(sim.ctx.scriptedPlayerWalks.has(sim.playerId)).toBe(false);
    expect(sim.player.pos).toEqual(before);
  });

  it('adds the claim origin for instance-local authoring coordinates', () => {
    const sim = makeSim();
    sim.player.level = 20;
    sim.questLog.set(INSTANCE_QUEST, {
      questId: INSTANCE_QUEST,
      counts: [0],
      state: 'active',
    });
    expect(startScenario(sim.ctx, INSTANCE_SCENARIO)).toBe(true);
    const events = sceneEvents([...sim.tick(), ...sim.tick()]);
    const walk = events.find((event) => event.op.kind === 'playerWalk');
    const instance = sim.ctx.instances.find((slot) => slot.dungeonId === 'lb_council');
    expect(instance).toBeDefined();
    if (!instance || walk?.op.kind !== 'playerWalk') {
      expect.unreachable('resolved instance playerWalk op missing');
    }
    const origin = sim.ctx.instanceOriginOf(instance);
    const expected = sim.groundPos(origin.x + 3, origin.z - 4);
    expect(walk.op.to).toEqual(expected);
    expect(walk.op.speed).toBe(1.5);
  });
});
