import { describe, expect, it } from 'vitest';
import {
  evaluateCinematicGizmoFrame,
  framingGizmo,
  gizmoState,
  hullGizmos,
} from '../src/editor/cinematic_gizmo_core';
import { GULLHAVEN_HARBOR, MAINLAND_HARBOR } from '../src/sim/harbor_layout';
import {
  attachmentLocalToWorld,
  cameraGeometry,
  shipHullVolumes,
} from '../src/sim/scenes/lint_core';
import type { SceneDef } from '../src/sim/scenes/registry';
import { WATER_LEVEL } from '../src/sim/world';

const SCENE: SceneDef = {
  id: 'scn_gizmo_test',
  duration: 2,
  ops: [
    {
      at: 0,
      kind: 'camera',
      shot: { kind: 'focus', x: 0, z: 0, dist: 10, pitch: 0, yaw: 0, dur: 2 },
    },
  ],
};

const SCRUB_FRAME = {
  timeSec: 1,
  camera: {
    position: { x: 0, y: 2, z: -10 },
    target: { x: 0, y: 2, z: 0 },
  },
  subject: { x: 0, y: 2, z: 0 },
  propCues: [],
  overlay: { fadeOpacity: 0, letterbox: true, cinematic: true },
};

describe('editor cinematic gizmo core', () => {
  it('derives exact support geometry and violation coloring from the shared predicate', () => {
    const frame = evaluateCinematicGizmoFrame(SCENE, SCRUB_FRAME, {
      seed: 42,
      waterLevel: WATER_LEVEL,
      terrainHeight: () => 0,
      entities: [
        {
          key: 'actor',
          label: 'scene actor',
          point: { x: 4, y: 2, z: 3 },
        },
      ],
    });

    expect(
      frame.violations.map(({ check, opIndex, measured }) => ({
        check,
        opIndex,
        measured,
      })),
    ).toEqual([
      {
        check: 'support.entity',
        opIndex: 1,
        measured: 'scene actor is 2.00 yd above terrain',
      },
    ]);
    expect(frame.gizmos).toContainEqual({
      kind: 'support',
      state: 'violation',
      from: { x: 4, y: 3.5, z: 3 },
      to: { x: 4, y: 0, z: 3 },
      label: 'scene actor',
    });
    expect(frame.gizmos.find((gizmo) => gizmo.kind === 'framing')?.state).toBe('neutral');
  });

  it('keeps passing support rays neutral with no violation readout', () => {
    const frame = evaluateCinematicGizmoFrame(SCENE, SCRUB_FRAME, {
      seed: 42,
      waterLevel: WATER_LEVEL,
      terrainHeight: () => 0,
      entities: [
        {
          key: 'actor',
          label: 'scene actor',
          point: { x: 4, y: 0, z: 3 },
        },
      ],
    });

    expect(frame.violations).toEqual([]);
    expect(frame.gizmos.find((gizmo) => gizmo.kind === 'support')).toMatchObject({
      state: 'neutral',
      to: { y: 0 },
    });
  });

  it('moves a scene player support ray with its active rider deck', () => {
    const scene: SceneDef = {
      id: 'scn_lb_q0_voyage',
      duration: 4,
      ops: [
        {
          at: 0,
          kind: 'prop',
          target: 'harbor_ship_gullhaven',
          cue: 'lb_voyage_out_cast_off',
        },
      ],
    };
    const frame = evaluateCinematicGizmoFrame(
      scene,
      {
        ...SCRUB_FRAME,
        camera: null,
        subject: null,
        propCues: [
          {
            target: 'harbor_ship_gullhaven',
            cue: 'lb_voyage_out_cast_off',
            startedAt: 0,
            pose: { x: 4, y: 0, z: 0, yaw: 0, done: false },
          },
        ],
      },
      {
        seed: 42,
        waterLevel: WATER_LEVEL,
        terrainHeight: () => 0,
        entities: [
          {
            key: 'player',
            label: 'player',
            point: {
              x: 725.4,
              y: 0.72,
              z: 132.5,
            },
            riderHarborId: 'gullhaven',
          },
        ],
      },
    );

    expect(
      frame.violations.filter(
        (violation) =>
          violation.check === 'support.entity' || violation.check === 'containment.rider',
      ),
    ).toEqual([]);
    expect(frame.gizmos.find((gizmo) => gizmo.kind === 'support')).toMatchObject({
      kind: 'support',
      state: 'neutral',
      label: 'player',
    });
  });

  it('derives hull boxes and framing bounds without Three.js objects', () => {
    const attachFrame = {
      position: { x: 10, y: 3, z: -4 },
      yaw: Math.PI / 2,
    };
    const volumes = shipHullVolumes(MAINLAND_HARBOR, WATER_LEVEL);
    const hulls = hullGizmos(MAINLAND_HARBOR, attachFrame, WATER_LEVEL, 'lower-hull-body');

    expect(hulls.map((hull) => hull.label)).toEqual(volumes.map((volume) => volume.id));
    expect(hulls).toHaveLength(MAINLAND_HARBOR.shipBlockers.length + 1);
    for (const [index, hull] of hulls.entries()) {
      const volume = volumes[index];
      expect(hull).toEqual({
        kind: 'hull',
        label: volume.id,
        state: volume.id === 'lower-hull-body' ? 'violation' : 'neutral',
        center: attachmentLocalToWorld(attachFrame, {
          x: volume.x,
          y: (volume.bottomY + volume.topY) / 2,
          z: volume.z,
        }),
        size: {
          x: volume.hw * 2,
          y: volume.topY - volume.bottomY,
          z: volume.hd * 2,
        },
        yaw: attachFrame.yaw + volume.rot,
      });
    }

    const framing = framingGizmo(
      cameraGeometry({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 10 }),
      { x: 0, y: 0, z: 10 },
      gizmoState(false),
    );
    expect(framing.state).toBe('neutral');
    expect(framing.camera).toEqual({ x: 0, y: 0, z: 0 });
    expect(framing.corners[0].z).toBeCloseTo(10);
    expect(framing.corners[0].x).toBeLessThan(0);
    expect(framing.corners[0].y).toBeGreaterThan(0);
    expect(framing.corners[2].x).toBeGreaterThan(0);
    expect(framing.corners[2].y).toBeLessThan(0);
  });

  it('marks framing bounds red when the shared direction predicate fails', () => {
    const frame = evaluateCinematicGizmoFrame(
      SCENE,
      {
        ...SCRUB_FRAME,
        subject: { x: 20, y: 2, z: 0 },
      },
      {
        seed: 42,
        waterLevel: WATER_LEVEL,
        terrainHeight: () => 0,
        entities: [],
      },
    );

    expect(frame.violations).toEqual([
      expect.objectContaining({
        check: 'framing.direction',
        opIndex: 1,
      }),
    ]);
    expect(frame.gizmos.find((gizmo) => gizmo.kind === 'framing')?.state).toBe('violation');
  });
});
