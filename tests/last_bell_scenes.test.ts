// The Last Bell scene system, sim side (src/sim/scenes/scenes.ts): timed op
// emission as personal 'scene' events, key-based dialogue (S3: no English
// prose from the sim), authoritative actor ops applying identically watched
// or skipped, the all-living-participants skip rule, and the scenario
// sequencer's scene stage gating on playback state.
import { beforeAll, describe, expect, it } from 'vitest';
import { assembleEventsFrame, serializeEventFragments } from '../server/event_frame';
import { ClientWorld } from '../src/net/online';
import {
  LAST_BELL_CINEMATIC_SHIP_SPEED_CAP_YARDS_PER_SEC,
  LAST_BELL_PROP_PATH_SEGMENTS,
  LB_PROP_CUE_PARK,
} from '../src/sim/content/last_bell_cinematics';
import { GULLHAVEN_HARBOR, MAINLAND_HARBOR } from '../src/sim/harbor_layout';
import { registerScenario, scenarioRunFor, startScenario } from '../src/sim/scenarios/scenarios';
import { answerSceneChoice } from '../src/sim/scenes/choices';
import {
  isSceneTerminalTeardownOp,
  registerScene,
  requestSceneSkip,
  sceneActiveFor,
  sceneById,
} from '../src/sim/scenes/scenes';
import { Sim } from '../src/sim/sim';
import { squadActorEntity } from '../src/sim/squad/squad';
import type { SimEvent } from '../src/sim/types';

const QUEST_ID = 'q_fs_hold_the_riftfields';

beforeAll(() => {
  registerScene({
    id: 'scn_test_doorway',
    duration: 4,
    ops: [
      { at: 0, kind: 'letterbox', on: true },
      { at: 0, kind: 'inputLock', on: true },
      { at: 0.2, kind: 'camera', shot: { kind: 'focus', actorId: 'tam', dist: 6, dur: 2 } },
      {
        at: 0.25,
        kind: 'camera',
        shot: {
          kind: 'dolly',
          points: [
            { x: 1, z: -2, height: 5 },
            { x: 6, z: -4, height: 7 },
          ],
          lookAt: {
            kind: 'subject',
            actorId: 'tam',
            offset: { x: 0, y: 2, z: 0 },
            fallback: { x: 2, z: -3, height: 2 },
          },
          dur: 3,
        },
      },
      {
        at: 0.3,
        kind: 'camera',
        shot: {
          kind: 'attach',
          target: 'test_ship',
          fallbackFrame: { point: { x: 3, z: -5, height: 1 }, yaw: 0.4 },
          offset: { x: -4, y: 3, z: 1 },
          lookAt: { x: 2, y: 1, z: 0 },
        },
      },
      {
        at: 0.5,
        kind: 'line',
        speaker: 'lb.speaker.tam',
        speakerActorId: 'tam',
        key: 'lb.q0.tam.doorway',
        dur: 3,
      },
      { at: 1.0, kind: 'actorMove', actorId: 'coalfast', x: 5, z: -60 },
      { at: 1.2, kind: 'actorFace', actorId: 'tam', facing: 1.5 },
      { at: 3.5, kind: 'letterbox', on: false },
      { at: 3.5, kind: 'inputLock', on: false },
    ],
  });
  registerScene({
    id: 'scn_test_delayed_walk',
    duration: 3,
    ops: [{ at: 1.4, kind: 'playerWalk', to: { x: 40, z: -20 }, speed: 4 }],
  });
  registerScenario({
    id: 'sc_test_scene_stage',
    dungeonId: 'lb_council',
    questId: QUEST_ID,
    squad: { actorIds: ['coalfast', 'tam'] },
    stages: [
      { id: 'opening', objective: { kind: 'scene' }, sceneId: 'scn_test_doorway' },
      { id: 'after', objective: { kind: 'survive', seconds: 1 } },
    ],
  });
  registerScenario({
    id: 'sc_test_delayed_walk_stage',
    dungeonId: 'lb_council',
    questId: QUEST_ID,
    squad: { actorIds: [] },
    stages: [{ id: 'opening', objective: { kind: 'scene' }, sceneId: 'scn_test_delayed_walk' }],
  });
});

function makeSim(): Sim {
  const sim = new Sim({ seed: 313, playerClass: 'warrior', playerName: 'Bell', devCommands: true });
  sim.player.level = 20;
  sim.questLog.set(QUEST_ID, { questId: QUEST_ID, counts: [0], state: 'active' });
  return sim;
}

function collect(sim: Sim, ticks: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) out.push(...sim.tick());
  return out;
}

function sceneOps(events: SimEvent[]): Extract<SimEvent, { type: 'scene' }>[] {
  return events.filter((e): e is Extract<SimEvent, { type: 'scene' }> => e.type === 'scene');
}

function claimIdOf(sim: Sim): number {
  return (
    sim.ctx.instances.find((i) => i.dungeonId === 'lb_council' && i.partyKey !== null)?.exitId ?? -1
  );
}

describe('scene playback', () => {
  it('reports persistent active state for reconnect and clears it after completion', () => {
    const sim = makeSim();
    startScenario(sim.ctx, 'sc_test_scene_stage');
    collect(sim, 2);
    expect(sim.sceneReconnectStateFor(sim.playerId)).toMatchObject({
      sceneId: 'scn_test_doorway',
      inputLocked: true,
      letterbox: true,
    });
    expect(sim.sceneReconnectStateFor(sim.playerId)?.remainingSeconds).toBeGreaterThan(0);
    collect(sim, 5 * 20);
    expect(sim.sceneReconnectStateFor(sim.playerId)).toBeNull();
  });

  it('emits ops in time order as personal events, keys only, then ends', () => {
    const sim = makeSim();
    expect(startScenario(sim.ctx, 'sc_test_scene_stage')).toBe(true);
    const events = collect(sim, 5 * 20);
    const ops = sceneOps(events);
    expect(ops.length).toBeGreaterThan(5);
    // Every scene event is personal (delivered per participant).
    for (const ev of ops) expect(ev.pid).toBe(sim.playerId);
    const kinds = ops.map((e) => e.op.kind);
    expect(kinds[0]).toBe('start');
    expect(kinds[kinds.length - 1]).toBe('end');
    expect(kinds).toContain('letterbox');
    expect(kinds).toContain('camera');
    // The dialogue line carries the key and resolved speaker entity.
    const line = ops.find((e) => e.op.kind === 'line');
    expect(line && line.op.kind === 'line' ? line.op.key : '').toBe('lb.q0.tam.doorway');
    const tam = squadActorEntity(sim.ctx, claimIdOf(sim), 'tam');
    expect(line && line.op.kind === 'line' ? line.op.speakerEntityId : null).toBe(tam?.id ?? -1);
    // The camera focus resolved Tam's entity id and world position.
    const cam = ops.find((e) => e.op.kind === 'camera');
    if (cam && cam.op.kind === 'camera' && cam.op.shot.kind === 'focus') {
      expect(cam.op.shot.entityId).toBe(tam?.id);
      expect(Math.abs(cam.op.shot.x - (tam?.pos.x ?? 0))).toBeLessThan(30);
    } else {
      expect.unreachable('camera focus op missing');
    }
    const dolly = ops.find((e) => e.op.kind === 'camera' && e.op.shot.kind === 'dolly');
    const instance = sim.ctx.instances.find((i) => i.exitId === claimIdOf(sim));
    expect(instance).toBeDefined();
    if (!instance) return;
    const origin = sim.ctx.instanceOriginOf(instance);
    if (dolly?.op.kind === 'camera' && dolly.op.shot.kind === 'dolly') {
      const first = dolly.op.shot.points[0];
      expect(first.x).toBeCloseTo(origin.x + 1, 6);
      expect(first.z).toBeCloseTo(origin.z - 2, 6);
      expect(first.y).toBeCloseTo(sim.groundPos(first.x, first.z).y + 5, 6);
      expect(dolly.op.shot.dur).toBe(3);
      expect(dolly.op.shot.lookAt.kind).toBe('subject');
      if (dolly.op.shot.lookAt.kind === 'subject') {
        expect(dolly.op.shot.lookAt.entityId).toBe(tam?.id);
        expect(dolly.op.shot.lookAt.offset).toEqual({ x: 0, y: 2, z: 0 });
      }
    } else {
      expect.unreachable('camera dolly op missing');
    }
    const attach = ops.find((e) => e.op.kind === 'camera' && e.op.shot.kind === 'attach');
    if (attach?.op.kind === 'camera' && attach.op.shot.kind === 'attach') {
      expect(attach.op.shot.target).toBe('test_ship');
      expect(attach.op.shot.dur).toBeCloseTo(3.7, 10);
      expect(attach.op.shot.fallbackFrame.position.x).toBeCloseTo(origin.x + 3, 6);
      expect(attach.op.shot.fallbackFrame.position.z).toBeCloseTo(origin.z - 5, 6);
      expect(attach.op.shot.fallbackFrame.yaw).toBe(0.4);
      expect(attach.op.shot.offset).toEqual({ x: -4, y: 3, z: 1 });
      expect(attach.op.shot.lookAt).toEqual({ x: 2, y: 1, z: 0 });
    } else {
      expect.unreachable('camera attach op missing');
    }
  });

  it('the scene stage holds while the scene plays and advances when it ends', () => {
    const sim = makeSim();
    startScenario(sim.ctx, 'sc_test_scene_stage');
    const run = scenarioRunFor(sim.ctx, claimIdOf(sim));
    collect(sim, 20); // 1s: scene running
    expect(sceneActiveFor(sim.ctx, claimIdOf(sim))).toBe(true);
    expect(run?.stageIndex).toBe(0);
    collect(sim, 4 * 20); // past 4s duration
    expect(sceneActiveFor(sim.ctx, claimIdOf(sim))).toBe(false);
    expect(run?.stageIndex).toBe(1);
  });

  it('applies authoritative actor ops whether watched or skipped', () => {
    // Watched run.
    const watched = makeSim();
    startScenario(watched.ctx, 'sc_test_scene_stage');
    collect(watched, 5 * 20);
    const watchedTam = squadActorEntity(watched.ctx, claimIdOf(watched), 'tam');
    expect(watchedTam?.facing).toBeCloseTo(1.5, 5);

    // Skipped immediately after start: fast-forward must apply the same ops.
    const skipped = makeSim();
    startScenario(skipped.ctx, 'sc_test_scene_stage');
    collect(skipped, 2);
    expect(requestSceneSkip(skipped.ctx)).toBe(true);
    expect(sceneActiveFor(skipped.ctx, claimIdOf(skipped))).toBe(false);
    const skippedTam = squadActorEntity(skipped.ctx, claimIdOf(skipped), 'tam');
    expect(skippedTam?.facing).toBeCloseTo(1.5, 5);
    // The scenario advances immediately past the scene stage.
    collect(skipped, 2);
    expect(scenarioRunFor(skipped.ctx, claimIdOf(skipped))?.stageIndex).toBe(1);
  });

  it('in a party, the scene ends only when every living participant skips', () => {
    const sim = makeSim();
    const a = sim.playerId;
    const b = sim.addPlayer('mage', 'Tamlin');
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    const bMeta = sim.ctx.players.get(b);
    bMeta?.questLog.set(QUEST_ID, { questId: QUEST_ID, counts: [0], state: 'active' });
    startScenario(sim.ctx, 'sc_test_scene_stage', a);
    startScenario(sim.ctx, 'sc_test_scene_stage', b); // partner walks in
    collect(sim, 2);
    expect(requestSceneSkip(sim.ctx, a)).toBe(true);
    expect(sceneActiveFor(sim.ctx, claimIdOf(sim))).toBe(true); // b has not skipped
    expect(requestSceneSkip(sim.ctx, b)).toBe(true);
    expect(sceneActiveFor(sim.ctx, claimIdOf(sim))).toBe(false);
  });

  it('deliberately excludes a party member outside the claim box when the scene arms', () => {
    const worldOutcome = (sim: Sim) => {
      const claimId = claimIdOf(sim);
      const coalfast = squadActorEntity(sim.ctx, claimId, 'coalfast');
      const tam = squadActorEntity(sim.ctx, claimId, 'tam');
      return {
        stageIndex: scenarioRunFor(sim.ctx, claimId)?.stageIndex,
        player: { pos: { ...sim.player.pos }, facing: sim.player.facing },
        coalfast: coalfast ? { pos: { ...coalfast.pos }, facing: coalfast.facing } : null,
        tam: tam ? { pos: { ...tam.pos }, facing: tam.facing } : null,
      };
    };

    const watched = makeSim();
    expect(startScenario(watched.ctx, 'sc_test_scene_stage')).toBe(true);
    collect(watched, 5 * 20);
    const watchedOutcome = worldOutcome(watched);

    const sim = makeSim();
    const includedPid = sim.playerId;
    const outsidePid = sim.addPlayer('mage', 'Outside Member');
    sim.partyInvite(outsidePid, includedPid);
    sim.partyAccept(outsidePid);
    const outsideMeta = sim.ctx.players.get(outsidePid);
    outsideMeta?.questLog.set(QUEST_ID, { questId: QUEST_ID, counts: [0], state: 'active' });
    expect(startScenario(sim.ctx, 'sc_test_scene_stage', includedPid)).toBe(true);
    expect(startScenario(sim.ctx, 'sc_test_scene_stage', outsidePid)).toBe(true);

    const claimId = claimIdOf(sim);
    const instance = sim.ctx.instances.find((slot) => slot.exitId === claimId);
    const outsidePlayer = sim.entities.get(outsidePid);
    expect(instance).toBeDefined();
    expect(outsidePlayer).toBeDefined();
    if (!instance || !outsidePlayer) return;
    const origin = sim.ctx.instanceOriginOf(instance);
    outsidePlayer.pos = sim.groundPos(origin.x + 121, origin.z);
    outsidePlayer.prevPos = { ...outsidePlayer.pos };
    sim.rebucket(outsidePlayer);

    const armedEvents = collect(sim, 2);
    expect(sim.sceneReconnectStateFor(includedPid)).toMatchObject({
      sceneId: 'scn_test_doorway',
    });
    expect(sim.sceneReconnectStateFor(outsidePid)).toBeNull();
    const events = [...armedEvents, ...collect(sim, 5 * 20 - 2)];
    const ops = sceneOps(events);
    expect(ops.filter((event) => event.pid === outsidePid)).toEqual([]);
    expect(ops.filter((event) => event.pid === includedPid).map((event) => event.op.kind)).toEqual(
      expect.arrayContaining(['start', 'end']),
    );
    expect(worldOutcome(sim)).toEqual(watchedOutcome);
  });

  it('sends end to every participant that received start after they leave the audience box', () => {
    const sim = makeSim();
    const a = sim.playerId;
    const b = sim.addPlayer('mage', 'Wayfarer');
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    const bMeta = sim.ctx.players.get(b);
    bMeta?.questLog.set(QUEST_ID, { questId: QUEST_ID, counts: [0], state: 'active' });
    startScenario(sim.ctx, 'sc_test_scene_stage', a);
    startScenario(sim.ctx, 'sc_test_scene_stage', b);

    const started = sceneOps(collect(sim, 2)).filter((event) => event.op.kind === 'start');
    expect(
      started.map((event) => event.pid).sort((left, right) => (left ?? 0) - (right ?? 0)),
    ).toEqual([a, b].sort((left, right) => left - right));

    const instance = sim.ctx.instances.find((slot) => slot.exitId === claimIdOf(sim));
    const playerB = sim.entities.get(b);
    expect(instance).toBeDefined();
    expect(playerB).toBeDefined();
    if (!instance || !playerB) return;
    const origin = sim.ctx.instanceOriginOf(instance);
    playerB.pos.x = origin.x + 121;
    playerB.prevPos = { ...playerB.pos };
    const latePid = sim.addPlayer('rogue', 'Latecomer');
    const latePlayer = sim.entities.get(latePid);
    expect(latePlayer).toBeDefined();
    if (!latePlayer) return;
    latePlayer.pos = { ...sim.player.pos };
    latePlayer.prevPos = { ...latePlayer.pos };

    expect(sim.sceneReconnectStateFor(b)).toMatchObject({
      sceneId: 'scn_test_doorway',
      inputLocked: true,
      letterbox: true,
    });
    expect(sim.sceneReconnectStateFor(latePid)).toBeNull();

    const remaining = sceneOps(collect(sim, 5 * 20));
    expect(remaining.some((event) => event.pid === latePid)).toBe(false);
    expect(remaining.filter((event) => event.pid === b).map((event) => event.op)).toEqual([
      { kind: 'letterbox', on: false },
      { kind: 'inputLock', on: false },
      { kind: 'end' },
    ]);
    const ended = remaining.filter((event) => event.op.kind === 'end');
    expect(
      ended.map((event) => event.pid).sort((left, right) => (left ?? 0) - (right ?? 0)),
    ).toEqual([a, b].sort((left, right) => left - right));
  });

  it('does not apply a delayed player walk to a participant that joined after start', () => {
    const sim = makeSim();
    const startedPid = sim.playerId;
    startScenario(sim.ctx, 'sc_test_delayed_walk_stage');
    const started = sceneOps(collect(sim, 2)).filter((event) => event.op.kind === 'start');
    expect(started.map((event) => event.pid)).toEqual([startedPid]);

    const latePid = sim.addPlayer('rogue', 'Late Walker');
    const latePlayer = sim.entities.get(latePid);
    expect(latePlayer).toBeDefined();
    if (!latePlayer) return;
    latePlayer.pos = { ...sim.player.pos };
    latePlayer.prevPos = { ...latePlayer.pos };

    const events = sceneOps(collect(sim, 2 * 20));
    expect(events.some((event) => event.pid === startedPid && event.op.kind === 'playerWalk')).toBe(
      true,
    );
    expect(events.some((event) => event.pid === latePid && event.op.kind === 'playerWalk')).toBe(
      false,
    );
    expect(sim.scriptedPlayerWalks.has(startedPid)).toBe(true);
    expect(sim.scriptedPlayerWalks.has(latePid)).toBe(false);
    expect(requestSceneSkip(sim.ctx, latePid)).toBe(false);
    expect(requestSceneSkip(sim.ctx, startedPid)).toBe(true);
    expect(sceneActiveFor(sim.ctx, claimIdOf(sim))).toBe(false);
  });

  it('classifies every persistent presentation release as terminal teardown', () => {
    expect([
      isSceneTerminalTeardownOp({ kind: 'end' }),
      isSceneTerminalTeardownOp({ kind: 'camera', shot: { kind: 'release' } }),
      isSceneTerminalTeardownOp({ kind: 'letterbox', on: false }),
      isSceneTerminalTeardownOp({ kind: 'inputLock', on: false }),
      isSceneTerminalTeardownOp({ kind: 'fade', to: 'clear', dur: 0.5 }),
      isSceneTerminalTeardownOp({ kind: 'music', directive: 'resume' }),
    ]).toEqual([true, true, true, true, true, true]);
    expect([
      isSceneTerminalTeardownOp({ kind: 'letterbox', on: true }),
      isSceneTerminalTeardownOp({ kind: 'inputLock', on: true }),
      isSceneTerminalTeardownOp({ kind: 'fade', to: 'black', dur: 0.5 }),
      isSceneTerminalTeardownOp({ kind: 'music', directive: 'silence' }),
    ]).toEqual([false, false, false, false]);
  });

  it('sends end to the started audience when the claim terminates mid-scene', () => {
    const sim = makeSim();
    startScenario(sim.ctx, 'sc_test_scene_stage');
    const started = sceneOps(collect(sim, 2)).filter((event) => event.op.kind === 'start');
    expect(started.map((event) => event.pid)).toEqual([sim.playerId]);

    const claimId = claimIdOf(sim);
    const instanceIndex = sim.ctx.instances.findIndex((slot) => slot.exitId === claimId);
    expect(instanceIndex).toBeGreaterThanOrEqual(0);
    sim.ctx.instances.splice(instanceIndex, 1);

    const ended = sceneOps(sim.tick()).filter((event) => event.op.kind === 'end');
    expect(ended.map((event) => event.pid)).toEqual([sim.playerId]);
    expect(sceneActiveFor(sim.ctx, claimId)).toBe(false);
  });

  it('sends end when a live playback loses its registered scene definition', () => {
    const sim = makeSim();
    startScenario(sim.ctx, 'sc_test_scene_stage');
    const started = sceneOps(collect(sim, 2)).filter((event) => event.op.kind === 'start');
    expect(started.map((event) => event.pid)).toEqual([sim.playerId]);

    const claimId = claimIdOf(sim);
    const playback = sim.scenePlaybacks.get(claimId);
    expect(playback).toBeDefined();
    if (!playback) return;
    playback.sceneId = 'scn_missing_after_start';

    const ended = sceneOps(sim.tick()).filter((event) => event.op.kind === 'end');
    expect(ended.map((event) => event.pid)).toEqual([sim.playerId]);
    expect(sceneActiveFor(sim.ctx, claimId)).toBe(false);
  });
});

describe('scene camera wire transport', () => {
  it('preserves whole dolly and attach ops from the server frame into ClientWorld', () => {
    const events: SimEvent[] = [
      {
        type: 'scene',
        sceneId: 'scn_wire_test',
        pid: 17,
        op: {
          kind: 'camera',
          shot: {
            kind: 'dolly',
            points: [
              { x: 1, y: 2, z: 3 },
              { x: 4, y: 5, z: 6 },
            ],
            lookAt: { kind: 'point', point: { x: 7, y: 8, z: 9 } },
            dur: 2,
          },
        },
      },
      {
        type: 'scene',
        sceneId: 'scn_wire_test',
        pid: 17,
        op: {
          kind: 'camera',
          shot: {
            kind: 'attach',
            target: 'ship',
            fallbackFrame: { position: { x: 10, y: 11, z: 12 }, yaw: 0.7 },
            offset: { x: 1, y: 2, z: 3 },
            lookAt: { x: 4, y: 5, z: 6 },
          },
        },
      },
    ];
    const frame = assembleEventsFrame(serializeEventFragments(events), 4.25);
    const client = Object.create(ClientWorld.prototype) as ClientWorld;
    (client as unknown as { eventQueue: SimEvent[] }).eventQueue = [];
    (client as unknown as { onMessage(raw: string): void }).onMessage(frame);
    expect(client.presentationTime).toBe(4.25);
    expect(client.drainEvents()).toEqual(
      events.map((event) => ({ ...event, presentationTime: 4.25 })),
    );
  });
});

// ---------------------------------------------------------------------------
// The voyage cinematic (H3): the paid crossing plays a personal scene that
// cues the harbor ship prop and the bell, splices the Q0 arrival after the
// held black on the first crossing, stays line-free on re-rides, and tears
// down to consistent state on a skip at any point (the sim teleported the
// rider onto the destination ship before the scene started, then the scene
// walks the real player down the gangplank).
// ---------------------------------------------------------------------------

describe('the voyage cinematic', () => {
  const Q0 = 'q_lb_q0_ashore';

  function makeRider(): Sim {
    const sim = new Sim({
      seed: 4242,
      playerClass: 'warrior',
      playerName: 'Ash',
      devCommands: true,
    });
    sim.player.level = 6;
    const meta = sim.ctx.players.get(sim.playerId);
    if (meta) meta.copper = 100;
    return sim;
  }

  function board(sim: Sim, x: number, z: number, choiceId: string): void {
    const pos = sim.groundPos(x, z);
    sim.player.pos = { ...pos };
    sim.player.prevPos = { ...pos };
    sim.rebucket(sim.player);
    const keeperId = x < 400 ? 'ferryman_ewald' : 'ferrykeeper_odda';
    const gatekeeper = [...sim.entities.values()].find((e) => e.templateId === keeperId);
    expect(gatekeeper).toBeTruthy();
    sim.player.targetId = gatekeeper?.id ?? null;
    sim.interact();
    expect(answerSceneChoice(sim.ctx, choiceId, 'pay')).toBe(true);
  }

  it('pins the C5 segment records and camera grammar in both directions', () => {
    expect(LAST_BELL_CINEMATIC_SHIP_SPEED_CAP_YARDS_PER_SEC).toBe(12);
    expect({
      outCastOff: LAST_BELL_PROP_PATH_SEGMENTS.lb_voyage_out_cast_off,
      outOpenWater: LAST_BELL_PROP_PATH_SEGMENTS.lb_voyage_out_open_water,
      outArrival: LAST_BELL_PROP_PATH_SEGMENTS.lb_voyage_out_arrival,
      backCastOff: LAST_BELL_PROP_PATH_SEGMENTS.lb_voyage_back_cast_off,
      backOpenWater: LAST_BELL_PROP_PATH_SEGMENTS.lb_voyage_back_open_water,
      backArrival: LAST_BELL_PROP_PATH_SEGMENTS.lb_voyage_back_arrival,
    }).toEqual({
      outCastOff: {
        start: { x: 0, y: 0, z: 0, yaw: 0 },
        end: { x: 22, y: 0, z: 7, yaw: 0 },
        duration: 4,
        ease: 'linear',
      },
      outOpenWater: {
        start: { x: -0.480547, y: 0, z: -164.456482, yaw: -1.910796 },
        end: { x: 47.519453, y: 0, z: -164.456482, yaw: -1.910796 },
        duration: 4.3,
        ease: 'linear',
      },
      outArrival: {
        start: { x: -40, y: 0, z: -13, yaw: -Math.PI / 2 },
        end: { x: 0, y: 0, z: 0, yaw: 0 },
        duration: 7,
        ease: 'linear',
      },
      backCastOff: {
        start: { x: 0, y: 0, z: 0, yaw: 0 },
        end: { x: 22, y: 0, z: -7, yaw: 0 },
        duration: 4,
        ease: 'linear',
      },
      backOpenWater: {
        start: { x: 148.090701, y: 0, z: -130.436384, yaw: 1.199203 },
        end: { x: 196.090701, y: 0, z: -130.436384, yaw: 1.199203 },
        duration: 4.3,
        ease: 'linear',
      },
      backArrival: {
        start: { x: -40, y: 0, z: 13, yaw: Math.PI / 2 },
        end: { x: 0, y: 0, z: 0, yaw: 0 },
        duration: 7,
        ease: 'linear',
      },
    });

    const out = sceneById('scn_lb_ferry_depart_out');
    const back = sceneById('scn_lb_ferry_depart_back');
    const q0 = sceneById('scn_lb_q0_voyage');
    expect(out).toBeDefined();
    expect(back).toBeDefined();
    expect(q0).toBeDefined();
    if (!out || !back || !q0) return;
    expect({
      out: out.duration,
      back: back.duration,
      q0: q0.duration,
    }).toEqual({ out: 21.5, back: 21.5, q0: 36.7 });
    const cameraTimes = (scene: typeof out): number[] =>
      scene.ops.flatMap((op) => (op.kind === 'camera' ? [op.at] : []));
    expect(cameraTimes(out)).toEqual([0.2, 4.2, 8.5, 15.5, 20.5]);
    expect(cameraTimes(back)).toEqual([0.2, 4.2, 8.5, 15.5, 20.5]);
    expect(cameraTimes(q0)).toEqual([0.2, 4.2, 8.5, 15.5, 21, 28.8, 35.7]);

    for (const scene of [out, back, q0]) {
      expect(
        scene.ops.some(
          (op) => op.at === 0 && op.kind === 'fade' && op.to === 'black' && op.dur === 0,
        ),
      ).toBe(true);
      const finalFade = scene.ops.filter((op) => op.kind === 'fade').at(-1);
      expect(finalFade).toMatchObject({ kind: 'fade', to: 'clear', dur: 0.4 });
      expect(finalFade?.at).toBeCloseTo(scene === q0 ? 35.75 : 20.55, 8);
    }

    const shotKinds = (scene: typeof out): string[] =>
      scene.ops.flatMap((op) => (op.kind === 'camera' ? [op.shot.kind] : []));
    expect(shotKinds(out)).toEqual(['attach', 'attach', 'attach', 'dolly', 'release']);
    expect(shotKinds(back)).toEqual(['attach', 'attach', 'attach', 'dolly', 'release']);
    expect(shotKinds(q0)).toEqual([
      'attach',
      'attach',
      'attach',
      'dolly',
      'dolly',
      'dolly',
      'release',
    ]);

    const attachSpecs = (scene: typeof out) =>
      scene.ops.flatMap((op) =>
        op.kind === 'camera' && op.shot.kind === 'attach'
          ? [
              {
                target: op.shot.target,
                offset: op.shot.offset,
                lookAt: op.shot.lookAt,
              },
            ]
          : [],
      );
    expect(attachSpecs(out)).toEqual([
      {
        target: 'harbor_ship_mainland',
        offset: { x: -20, y: 16, z: 22 },
        lookAt: { x: 6.6, y: 8.6, z: 0 },
      },
      {
        target: 'harbor_ship_mainland',
        offset: { x: 6.6, y: 18, z: -28 },
        lookAt: { x: 6.6, y: 8.6, z: 0 },
      },
      {
        target: 'harbor_ship_gullhaven',
        offset: { x: 6.6, y: 20, z: -20 },
        lookAt: { x: 24, y: 8.6, z: 0 },
      },
    ]);
    expect(attachSpecs(back)).toEqual([
      {
        target: 'harbor_ship_gullhaven',
        offset: { x: -20, y: 16, z: -22 },
        lookAt: { x: 6.6, y: 8.6, z: 0 },
      },
      {
        target: 'harbor_ship_gullhaven',
        offset: { x: 6.6, y: 18, z: 28 },
        lookAt: { x: 6.6, y: 8.6, z: 0 },
      },
      {
        target: 'harbor_ship_mainland',
        offset: { x: 6.6, y: 20, z: 20 },
        lookAt: { x: 24, y: 8.6, z: 0 },
      },
    ]);

    const walks = (scene: typeof out) =>
      scene.ops.flatMap((op) =>
        op.kind === 'playerWalk' ? [{ at: op.at, to: op.to, speed: op.speed }] : [],
      );
    expect(walks(out)).toHaveLength(1);
    expect(walks(out)[0]?.at).toBeCloseTo(15.9, 8);
    expect(walks(out)[0]).toMatchObject({
      to: { x: GULLHAVEN_HARBOR.gangplank.x, z: GULLHAVEN_HARBOR.gangplank.z },
      speed: 2.75,
    });
    expect(walks(back)).toHaveLength(1);
    expect(walks(back)[0]?.at).toBeCloseTo(15.9, 8);
    expect(walks(back)[0]).toMatchObject({
      to: { x: MAINLAND_HARBOR.gangplank.x, z: MAINLAND_HARBOR.gangplank.z },
      speed: 2.75,
    });
    expect(out.ops.some((op) => op.kind === 'line')).toBe(false);
    expect(back.ops.some((op) => op.kind === 'line')).toBe(false);

    for (const scene of [out, back]) {
      const pierFade = scene.ops.flatMap((op) =>
        op.kind === 'fade' && op.to === 'black' && op.at > 8.5 && op.at < 15.5
          ? [{ at: op.at, dur: op.dur }]
          : [],
      );
      expect(pierFade).toHaveLength(2);
      expect(pierFade.map((op) => op.dur)).toEqual([0.4, 0]);
      expect(pierFade[0]?.at).toBeCloseTo(15.05, 8);
      expect(pierFade[1]?.at).toBeCloseTo(15.45, 8);
    }

    const arrivalCutKinds = (scene: typeof out) =>
      scene.ops
        .filter((op) => Math.abs(op.at - 15.5) < 1e-8)
        .map((op) => (op.kind === 'prop' ? `${op.kind}/${op.cue}` : op.kind));
    expect(arrivalCutKinds(out)).toEqual([`prop/${LB_PROP_CUE_PARK}`, 'fade', 'camera']);
    expect(arrivalCutKinds(back)).toEqual([`prop/${LB_PROP_CUE_PARK}`, 'fade', 'camera']);

    const q0Lines = q0.ops.flatMap((op) =>
      op.kind === 'line' ? [{ at: op.at, key: op.key, dur: op.dur }] : [],
    );
    expect(q0Lines.map(({ key, dur }) => ({ key, dur }))).toEqual([
      { key: 'lb.q0.scene.harbor', dur: 4.75 },
      { key: 'lb.q0.scene.plinth', dur: 7.5 },
      { key: 'lb.q0.scene.toll', dur: 6.5 },
    ]);
    expect(q0Lines.map((line) => line.at)).toEqual([
      expect.closeTo(16, 8),
      expect.closeTo(21.2, 8),
      expect.closeTo(29, 8),
    ]);
    expect(
      q0.ops.filter((op) => op.kind === 'music' && op.directive === 'lb_bell_toll_one'),
    ).toHaveLength(2);
  });

  it('the first paid crossing plays the spliced voyage: ship cue, bell, then the arrival', () => {
    const sim = makeRider();
    board(sim, 238, -47.5, 'ch_lb_ferry_fare_out');
    const ops = sceneOps(collect(sim, 16 * 20));
    expect(ops.every((e) => e.sceneId === 'scn_lb_q0_voyage')).toBe(true);
    const props = ops
      .filter((e): e is typeof e & { op: { kind: 'prop'; target: string; cue: string } } => {
        return e.op.kind === 'prop';
      })
      .map((e) => ({ target: e.op.target, cue: e.op.cue }));
    expect(props).toEqual([
      {
        target: 'harbor_ship_mainland',
        cue: 'lb_voyage_out_cast_off',
      },
      {
        target: 'harbor_ship_mainland',
        cue: 'lb_voyage_out_open_water',
      },
      {
        target: 'harbor_ship_gullhaven',
        cue: 'lb_voyage_out_arrival',
      },
      {
        target: 'harbor_ship_gullhaven',
        cue: LB_PROP_CUE_PARK,
      },
    ]);
    const directives = ops
      .filter((e): e is typeof e & { op: { kind: 'music'; directive: string } } => {
        return e.op.kind === 'music';
      })
      .map((e) => e.op.directive);
    expect(directives).toContain('lb_harbor_ambience');
    expect(directives).toContain('lb_bell_toll_one');
    expect(directives).toContain('lb_ship_castoff');
    const walk = ops.find((e) => e.op.kind === 'playerWalk');
    expect(walk?.op).toEqual({
      kind: 'playerWalk',
      to: sim.groundPos(GULLHAVEN_HARBOR.gangplank.x, GULLHAVEN_HARBOR.gangplank.z),
      speed: 2.75,
    });
    const gullhavenEnd = sim.groundPos(GULLHAVEN_HARBOR.gangplank.x, GULLHAVEN_HARBOR.gangplank.z);
    const gullhavenRemaining = Math.hypot(
      sim.player.pos.x - gullhavenEnd.x,
      sim.player.pos.z - gullhavenEnd.z,
    );
    expect(gullhavenRemaining).toBeGreaterThan(0);
    expect(gullhavenRemaining).toBeLessThan(
      Math.hypot(
        GULLHAVEN_HARBOR.deckArrival.x - gullhavenEnd.x,
        GULLHAVEN_HARBOR.deckArrival.z - gullhavenEnd.z,
      ),
    );
    // The arrival half: its first line lands after the splice point.
    const line = ops.find((e) => e.op.kind === 'line');
    expect(line?.op.kind === 'line' ? line.op.key : '').toBe('lb.q0.scene.harbor');
    // The whole voyage ends as one scene.
    const tail = sceneOps(collect(sim, 21 * 20));
    const lineKeys = [...ops, ...tail]
      .filter((e): e is typeof e & { op: { kind: 'line'; key: string } } => e.op.kind === 'line')
      .map((e) => e.op.key);
    expect(lineKeys).toEqual(['lb.q0.scene.harbor', 'lb.q0.scene.plinth', 'lb.q0.scene.toll']);
    expect(tail.some((e) => e.op.kind === 'end')).toBe(true);
    expect(sim.ctx.scenePlaybacks.size).toBe(0);
    expect(sim.player.pos).toEqual(gullhavenEnd);
  });

  it('a re-ride departure cues the ship on its own side and stays line-free', () => {
    const sim = makeRider();
    sim.ctx.players.get(sim.playerId)?.questsDone.add(Q0);
    board(sim, 238, -47.5, 'ch_lb_ferry_fare_out');
    // Let the outbound departure finish before riding back.
    collect(sim, 22 * 20);
    expect(sim.player.pos).toEqual(
      sim.groundPos(GULLHAVEN_HARBOR.gangplank.x, GULLHAVEN_HARBOR.gangplank.z),
    );
    board(
      sim,
      GULLHAVEN_HARBOR.boarding.x,
      GULLHAVEN_HARBOR.boarding.z,
      'ch_lb_ferry_fare_back',
    );
    const ops = sceneOps(collect(sim, 10 * 20));
    expect(ops.length).toBeGreaterThan(0);
    expect(ops.every((e) => e.sceneId === 'scn_lb_ferry_depart_back')).toBe(true);
    const props = ops
      .filter((e): e is typeof e & { op: { kind: 'prop'; target: string; cue: string } } => {
        return e.op.kind === 'prop';
      })
      .map((e) => ({ target: e.op.target, cue: e.op.cue }));
    expect(props).toEqual([
      {
        target: 'harbor_ship_gullhaven',
        cue: 'lb_voyage_back_cast_off',
      },
      {
        target: 'harbor_ship_gullhaven',
        cue: 'lb_voyage_back_open_water',
      },
      {
        target: 'harbor_ship_mainland',
        cue: 'lb_voyage_back_arrival',
      },
    ]);
    expect(ops.some((e) => e.op.kind === 'line')).toBe(false);
    const arrivalOps = sceneOps(collect(sim, 7 * 20));
    const walk = arrivalOps.find((e) => e.op.kind === 'playerWalk');
    expect(walk?.op).toEqual({
      kind: 'playerWalk',
      to: sim.groundPos(MAINLAND_HARBOR.gangplank.x, MAINLAND_HARBOR.gangplank.z),
      speed: 2.75,
    });
    const mainlandEnd = sim.groundPos(MAINLAND_HARBOR.gangplank.x, MAINLAND_HARBOR.gangplank.z);
    const mainlandRemaining = Math.hypot(
      sim.player.pos.x - mainlandEnd.x,
      sim.player.pos.z - mainlandEnd.z,
    );
    expect(mainlandRemaining).toBeGreaterThan(0);
    expect(mainlandRemaining).toBeLessThan(
      Math.hypot(
        MAINLAND_HARBOR.deckArrival.x - mainlandEnd.x,
        MAINLAND_HARBOR.deckArrival.z - mainlandEnd.z,
      ),
    );
    collect(sim, 5 * 20);
    expect(sim.ctx.scenePlaybacks.size).toBe(0);
    expect(sim.player.pos).toEqual(mainlandEnd);
  });

  it('skipping the voyage tears down cleanly with the rider already ashore', () => {
    const sim = makeRider();
    board(sim, 238, -47.5, 'ch_lb_ferry_fare_out');
    collect(sim, 4);
    expect(sim.ctx.scenePlaybacks.size).toBe(1);
    expect(requestSceneSkip(sim.ctx)).toBe(true);
    const ops = sceneOps(collect(sim, 2));
    expect(ops.some((e) => e.op.kind === 'end')).toBe(true);
    expect(sim.ctx.scenePlaybacks.size).toBe(0);
    // The crossing happened at pay time and skip settles the un-emitted walk
    // at the pier-side end of the gangplank.
    expect(sim.player.pos).toEqual(
      sim.groundPos(GULLHAVEN_HARBOR.gangplank.x, GULLHAVEN_HARBOR.gangplank.z),
    );
    expect(sim.questLog.get(Q0)?.state).toBe('active');
  });

  it('skipping a return re-ride applies the un-emitted mainland walk endpoint', () => {
    const sim = makeRider();
    sim.ctx.players.get(sim.playerId)?.questsDone.add(Q0);
    board(
      sim,
      GULLHAVEN_HARBOR.boarding.x,
      GULLHAVEN_HARBOR.boarding.z,
      'ch_lb_ferry_fare_back',
    );
    collect(sim, 4);
    expect(requestSceneSkip(sim.ctx)).toBe(true);
    const ops = sceneOps(collect(sim, 2));
    expect(ops.some((e) => e.op.kind === 'end')).toBe(true);
    expect(sim.ctx.scenePlaybacks.size).toBe(0);
    expect(sim.player.pos).toEqual(
      sim.groundPos(MAINLAND_HARBOR.gangplank.x, MAINLAND_HARBOR.gangplank.z),
    );
  });
});
