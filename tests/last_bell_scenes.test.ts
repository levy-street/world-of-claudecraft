// The Last Bell scene system, sim side (src/sim/scenes/scenes.ts): timed op
// emission as personal 'scene' events, key-based dialogue (S3: no English
// prose from the sim), authoritative actor ops applying identically watched
// or skipped, the all-living-participants skip rule, and the scenario
// sequencer's scene stage gating on playback state.
import { beforeAll, describe, expect, it } from 'vitest';
import { registerScenario, scenarioRunFor, startScenario } from '../src/sim/scenarios/scenarios';
import { registerScene, requestSceneSkip, sceneActiveFor } from '../src/sim/scenes/scenes';
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
});
