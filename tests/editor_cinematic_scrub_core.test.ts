import { describe, expect, it } from 'vitest';
import { sceneRigLocalToWorld } from '../src/game/scene_rig_core';
import { composeHarborShipAttachFrame } from '../src/render/harbor_ship_attach_core';
import { propPathPoseAt } from '../src/render/prop_path_core';
import { LAST_BELL_PROP_PATH_SEGMENTS } from '../src/sim/content/last_bell_cinematics';
import '../src/sim/data';
import {
  advanceCinematicPlayhead,
  cinematicLivePoseFromCamera,
  cinematicSceneOptions,
  evaluateCinematicScrubFrame,
  sampleCinematicTime,
} from '../src/editor/cinematic_scrub_core';
import type { SceneLivePose } from '../src/game/scene_director_core';
import { MAINLAND_HARBOR } from '../src/sim/harbor_layout';
import type { SceneDef } from '../src/sim/scenes/registry';
import { registeredSceneIds, sceneById } from '../src/sim/scenes/registry';
import { WATER_LEVEL } from '../src/sim/world';

const LIVE: SceneLivePose = {
  yaw: 0,
  pitch: 0.3,
  dist: 12,
  playerX: 0,
  playerY: 0,
  playerZ: 0,
};

function frame(scene: SceneDef, timeSec: number) {
  return evaluateCinematicScrubFrame(scene, timeSec, {
    live: LIVE,
    groundY: () => 0,
    actorPoint: () => null,
  });
}

describe('editor cinematic scrub core', () => {
  it('lists every registered scene in stable id order with its duration', () => {
    const ids = registeredSceneIds();
    const options = cinematicSceneOptions(ids, sceneById);

    expect(options.length).toBeGreaterThan(0);
    expect(options.map((option) => option.id)).toEqual([...ids].sort());
    expect(options.every((option) => option.duration > 0)).toBe(true);
  });

  it('filters missing definitions and de-duplicates picker ids', () => {
    const defs = new Map<string, SceneDef>([
      ['scene_b', { id: 'scene_b', duration: 8, ops: [] }],
      ['scene_a', { id: 'scene_a', duration: 3, ops: [] }],
    ]);

    expect(
      cinematicSceneOptions(['scene_b', 'missing', 'scene_a', 'scene_b'], (id) => defs.get(id)),
    ).toEqual([
      { id: 'scene_a', duration: 3 },
      { id: 'scene_b', duration: 8 },
    ]);
  });

  it('clamps play time and samples only the mirrored 20 Hz scene clock', () => {
    expect(advanceCinematicPlayhead(1, 0.034, 5)).toBeCloseTo(1.034);
    expect(advanceCinematicPlayhead(4.99, 1, 5)).toBe(5);
    expect(advanceCinematicPlayhead(2, -10, 5)).toBe(0);
    expect(sampleCinematicTime(1.049, 5)).toBeCloseTo(1);
    expect(sampleCinematicTime(1.05, 5)).toBeCloseTo(1.05);
    expect(sampleCinematicTime(99, 5)).toBe(5);
  });

  it('converts a free camera into the director live-pose convention', () => {
    expect(
      cinematicLivePoseFromCamera({
        position: { x: 0, y: 8, z: -10 },
        target: { x: 0, y: 2, z: 0 },
      }),
    ).toMatchObject({
      yaw: 0,
      dist: Math.hypot(6, 10),
      playerX: 0,
      playerY: 0,
      playerZ: 0,
    });
  });

  it('replays interrupted fades through the runtime overlay evaluator', () => {
    const scene: SceneDef = {
      id: 'fade_scene',
      duration: 3,
      ops: [
        { at: 0, kind: 'letterbox', on: true },
        { at: 0, kind: 'fade', to: 'black', dur: 2 },
        { at: 1, kind: 'fade', to: 'clear', dur: 1 },
      ],
    };

    expect(frame(scene, 0.5).overlay).toMatchObject({
      fadeOpacity: 0.25,
      letterbox: true,
    });
    expect(frame(scene, 1.5).overlay).toMatchObject({
      fadeOpacity: 0.25,
      letterbox: true,
    });
    expect(frame(scene, 3).overlay).toMatchObject({
      fadeOpacity: 0,
      letterbox: false,
    });
  });

  it('drives dolly camera poses through the runtime rig evaluator', () => {
    const scene: SceneDef = {
      id: 'dolly_scene',
      duration: 3,
      ops: [
        {
          at: 0,
          kind: 'camera',
          shot: {
            kind: 'dolly',
            points: [
              { x: 0, z: -10, height: 8 },
              { x: 10, z: -10, height: 8 },
            ],
            lookAt: { kind: 'point', point: { x: 0, z: 0, height: 2 } },
            dur: 2,
          },
        },
      ],
    };

    const start = frame(scene, 0).camera;
    expect(start?.position.x).toBeCloseTo(0);
    expect(start?.position.y).toBeCloseTo(8);
    expect(start?.position.z).toBeCloseTo(-10);
    expect(start?.target).toEqual({ x: 0, y: 2, z: 0 });

    const end = frame(scene, 2).camera;
    expect(end?.position.x).toBeCloseTo(10);
    expect(end?.position.y).toBeCloseTo(8);
    expect(end?.position.z).toBeCloseTo(-10);
    expect(end?.target).toEqual({ x: 0, y: 2, z: 0 });
  });

  it('replays nonzero focus and release operations through the director core', () => {
    const scene: SceneDef = {
      id: 'focus_release_scene',
      duration: 4,
      ops: [
        {
          at: 0.5,
          kind: 'camera',
          shot: { kind: 'focus', x: 10, z: 4, dist: 6, pitch: 0.2, yaw: 1, dur: 1 },
        },
        { at: 2, kind: 'camera', shot: { kind: 'release' } },
      ],
    };

    expect(frame(scene, 0.45).camera).toBeNull();
    const held = frame(scene, 1.5).camera;
    expect(held?.target).toEqual({ x: 10, y: 2, z: 4 });
    expect(
      Math.hypot(
        (held?.position.x ?? 0) - (held?.target.x ?? 0),
        (held?.position.y ?? 0) - (held?.target.y ?? 0),
        (held?.position.z ?? 0) - (held?.target.z ?? 0),
      ),
    ).toBeCloseTo(6);
    expect(frame(scene, 2.85).camera).toBeNull();
  });

  it('resolves a ship attachment from the prop evaluator at the selected time', () => {
    const offset = { x: -6, y: 12, z: 3 };
    const lookAt = { x: 4, y: 6, z: 0 };
    const scene: SceneDef = {
      id: 'attach_scene',
      duration: 4,
      ops: [
        {
          at: 0,
          kind: 'prop',
          target: 'harbor_ship_mainland',
          cue: 'lb_voyage_out_cast_off',
        },
        {
          at: 0,
          kind: 'camera',
          shot: {
            kind: 'attach',
            target: 'harbor_ship_mainland',
            fallbackFrame: {
              point: { x: 0, z: 0, height: 0 },
              yaw: 0,
            },
            offset,
            lookAt,
          },
        },
      ],
    };

    const pose = propPathPoseAt(LAST_BELL_PROP_PATH_SEGMENTS.lb_voyage_out_cast_off, 1);
    const attachment = composeHarborShipAttachFrame(
      {
        baseX: MAINLAND_HARBOR.berth.x,
        baseY: WATER_LEVEL - MAINLAND_HARBOR.berth.draft,
        baseZ: MAINLAND_HARBOR.berth.z,
        baseRot: MAINLAND_HARBOR.berth.rot,
      },
      pose,
      { position: { x: 0, y: 0, z: 0 }, yaw: 0 },
    );
    const expectedCamera = sceneRigLocalToWorld(attachment, offset, { x: 0, y: 0, z: 0 });
    const expectedLookAt = sceneRigLocalToWorld(attachment, lookAt, { x: 0, y: 0, z: 0 });

    expect(frame(scene, 1).camera?.position).toEqual(expectedCamera);
    expect(frame(scene, 1).camera?.target).toEqual(expectedLookAt);
  });

  it('evaluates active ship cues through the shared prop path core', () => {
    const scene: SceneDef = {
      id: 'prop_scene',
      duration: 5,
      ops: [
        {
          at: 0,
          kind: 'prop',
          target: 'harbor_ship_mainland',
          cue: 'lb_voyage_out_cast_off',
        },
      ],
    };

    const cue = frame(scene, 2).propCues[0];
    const segment = LAST_BELL_PROP_PATH_SEGMENTS.lb_voyage_out_cast_off;
    expect(cue).toMatchObject({
      target: 'harbor_ship_mainland',
      cue: 'lb_voyage_out_cast_off',
      startedAt: 0,
    });
    expect(cue.pose.x).toBeCloseTo(segment.end.x * 0.75);
    expect(cue.pose.z).toBeCloseTo(segment.end.z * 0.75);
    expect(cue.pose.done).toBe(false);
  });

  it('replays cue replacement, parking, and scene teardown', () => {
    const scene: SceneDef = {
      id: 'prop_replay_scene',
      duration: 4,
      ops: [
        {
          at: 0,
          kind: 'prop',
          target: 'harbor_ship_mainland',
          cue: 'lb_voyage_out_cast_off',
        },
        {
          at: 1,
          kind: 'prop',
          target: 'harbor_ship_gullhaven',
          cue: 'lb_voyage_out_arrival',
        },
        {
          at: 2,
          kind: 'prop',
          target: 'harbor_ship_gullhaven',
          cue: 'lb_prop_cue_park',
        },
      ],
    };

    expect(frame(scene, 0.5).propCues.map((cue) => cue.target)).toEqual(['harbor_ship_mainland']);
    const replacement = frame(scene, 1.5).propCues;
    expect(replacement).toHaveLength(1);
    expect(replacement[0]).toMatchObject({
      target: 'harbor_ship_gullhaven',
      startedAt: 1,
    });
    expect(replacement[0].pose).toEqual(
      propPathPoseAt(LAST_BELL_PROP_PATH_SEGMENTS.lb_voyage_out_arrival, 0.5),
    );
    expect(frame(scene, 2.5).propCues).toEqual([]);
    expect(frame(scene, scene.duration).propCues).toEqual([]);
  });

  it('is repeatable across forward and backward seeks', () => {
    const scene = sceneById('scn_lb_q0_voyage');
    expect(scene).toBeDefined();
    if (!scene) throw new Error('expected registered voyage scene');

    const later = frame(scene, 11.4);
    frame(scene, 2.1);
    expect(frame(scene, 11.4)).toEqual(later);
  });
});
