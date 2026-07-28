import { describe, expect, it } from 'vitest';
import { evaluateSceneRigPose, sceneRigCameraPosition } from '../src/game/scene_rig_core';
import type { SceneAttachFrame, SceneRigCameraShot, SceneRigPoint } from '../src/sim/types';

const noEntities = (): null => null;
const noAttachments = (): null => null;

function cameraPosition(
  shot: SceneRigCameraShot,
  elapsed: number,
  resolveAttachment: (target: string) => SceneAttachFrame | null = noAttachments,
): SceneRigPoint {
  const pose = evaluateSceneRigPose(shot, elapsed, noEntities, resolveAttachment);
  return sceneRigCameraPosition(pose);
}

function expectPointClose(actual: SceneRigPoint, expected: SceneRigPoint): void {
  expect(actual.x).toBeCloseTo(expected.x, 10);
  expect(actual.y).toBeCloseTo(expected.y, 10);
  expect(actual.z).toBeCloseTo(expected.z, 10);
}

describe('dolly rig', () => {
  it('stays continuous when sampled densely inside one shot', () => {
    const shot: SceneRigCameraShot = {
      kind: 'dolly',
      points: [
        { x: 0, y: 4, z: 0 },
        { x: 4, y: 6, z: 3 },
        { x: 8, y: 5, z: 6 },
        { x: 12, y: 7, z: 2 },
      ],
      lookAt: { kind: 'point', point: { x: 6, y: 2, z: 3 } },
      dur: 4,
    };
    let previousPose = evaluateSceneRigPose(shot, 0, noEntities, noAttachments);
    let previousCamera = sceneRigCameraPosition(previousPose);
    let maxCameraStep = 0;
    let maxFocusStep = 0;
    let maxYawStep = 0;
    let maxPitchStep = 0;
    let maxDistStep = 0;
    for (let i = 1; i <= 400; i++) {
      const currentPose = evaluateSceneRigPose(
        shot,
        (i / 400) * shot.dur,
        noEntities,
        noAttachments,
      );
      const currentCamera = sceneRigCameraPosition(currentPose);
      maxCameraStep = Math.max(
        maxCameraStep,
        Math.hypot(
          currentCamera.x - previousCamera.x,
          currentCamera.y - previousCamera.y,
          currentCamera.z - previousCamera.z,
        ),
      );
      maxFocusStep = Math.max(
        maxFocusStep,
        Math.hypot(
          currentPose.focusX - previousPose.focusX,
          currentPose.focusY - previousPose.focusY,
          currentPose.focusZ - previousPose.focusZ,
        ),
      );
      maxYawStep = Math.max(
        maxYawStep,
        Math.abs(
          Math.atan2(
            Math.sin(currentPose.yaw - previousPose.yaw),
            Math.cos(currentPose.yaw - previousPose.yaw),
          ),
        ),
      );
      maxPitchStep = Math.max(maxPitchStep, Math.abs(currentPose.pitch - previousPose.pitch));
      maxDistStep = Math.max(maxDistStep, Math.abs(currentPose.dist - previousPose.dist));
      previousPose = currentPose;
      previousCamera = currentCamera;
    }
    expect(maxCameraStep).toBeLessThan(0.15);
    expect(maxFocusStep).toBeLessThan(0.15);
    expect(maxYawStep).toBeLessThan(0.1);
    expect(maxPitchStep).toBeLessThan(0.1);
    expect(maxDistStep).toBeLessThan(0.15);
  });

  it('uses eased time while landing exactly on both spline endpoints', () => {
    const shot: SceneRigCameraShot = {
      kind: 'dolly',
      points: [
        { x: 0, y: 5, z: 0 },
        { x: 10, y: 5, z: 0 },
      ],
      lookAt: { kind: 'point', point: { x: 5, y: 2, z: 10 } },
      dur: 4,
    };
    expectPointClose(cameraPosition(shot, 0), { x: 0, y: 5, z: 0 });
    expectPointClose(cameraPosition(shot, 4), { x: 10, y: 5, z: 0 });
    expect(cameraPosition(shot, 1).x).toBeLessThan(2.5);
  });

  it('samples an independently eased spline look-at track', () => {
    const shot: SceneRigCameraShot = {
      kind: 'dolly',
      points: [
        { x: 0, y: 5, z: 0 },
        { x: 10, y: 5, z: 0 },
      ],
      lookAt: {
        kind: 'spline',
        points: [
          { x: 0, y: 2, z: 10 },
          { x: 10, y: 2, z: 10 },
        ],
      },
      dur: 4,
    };
    const start = evaluateSceneRigPose(shot, 0, noEntities, noAttachments);
    const end = evaluateSceneRigPose(shot, 4, noEntities, noAttachments);
    expect({ x: start.focusX, y: start.focusY + 2, z: start.focusZ }).toEqual({
      x: 0,
      y: 2,
      z: 10,
    });
    expect({ x: end.focusX, y: end.focusY + 2, z: end.focusZ }).toEqual({
      x: 10,
      y: 2,
      z: 10,
    });
  });

  it('tracks a live subject and falls back when it is unavailable', () => {
    const shot: SceneRigCameraShot = {
      kind: 'dolly',
      points: [{ x: 0, y: 5, z: 0 }],
      lookAt: {
        kind: 'subject',
        entityId: 7,
        offset: { x: 0, y: 2, z: 0 },
        fallback: { x: 3, y: 4, z: 5 },
      },
      dur: 2,
    };
    const tracked = evaluateSceneRigPose(
      shot,
      1,
      (id) => (id === 7 ? { x: 8, y: 1, z: 9 } : null),
      noAttachments,
    );
    expect({ x: tracked.focusX, y: tracked.focusY + 2, z: tracked.focusZ }).toEqual({
      x: 8,
      y: 3,
      z: 9,
    });
    const fallback = evaluateSceneRigPose(shot, 1, noEntities, noAttachments);
    expect({ x: fallback.focusX, y: fallback.focusY + 2, z: fallback.focusZ }).toEqual({
      x: 3,
      y: 4,
      z: 5,
    });
  });
});

describe('attach rig', () => {
  it('rotates the camera offset and local look-at through the prop frame', () => {
    const shot: SceneRigCameraShot = {
      kind: 'attach',
      target: 'test_ship',
      fallbackFrame: { position: { x: 0, y: 0, z: 0 }, yaw: 0 },
      offset: { x: 2, y: 3, z: 0 },
      lookAt: { x: 0, y: 1, z: 4 },
    };
    const frame: SceneAttachFrame = {
      position: { x: 10, y: 5, z: 20 },
      yaw: Math.PI / 2,
    };
    const pose = evaluateSceneRigPose(shot, 0, noEntities, (target) =>
      target === 'test_ship' ? frame : null,
    );
    expect(sceneRigCameraPosition(pose).x).toBeCloseTo(10, 10);
    expect(sceneRigCameraPosition(pose).y).toBeCloseTo(8, 10);
    expect(sceneRigCameraPosition(pose).z).toBeCloseTo(18, 10);
    expect(pose.focusX).toBeCloseTo(14, 10);
    expect(pose.focusY + 2).toBeCloseTo(6, 10);
    expect(pose.focusZ).toBeCloseTo(20, 10);
  });

  it('uses the authored fallback frame when the live prop is unavailable', () => {
    const shot: SceneRigCameraShot = {
      kind: 'attach',
      target: 'missing_ship',
      fallbackFrame: { position: { x: 10, y: 5, z: 20 }, yaw: 0 },
      offset: { x: 2, y: 3, z: 0 },
      lookAt: { x: 0, y: 1, z: 4 },
    };
    expectPointClose(cameraPosition(shot, 0), { x: 12, y: 8, z: 20 });
  });
});

describe('degenerate rig inputs', () => {
  it('holds a single-point spline at every sample', () => {
    const shot: SceneRigCameraShot = {
      kind: 'dolly',
      points: [{ x: 4, y: 6, z: 8 }],
      lookAt: { kind: 'spline', points: [{ x: 1, y: 2, z: 3 }] },
      dur: 5,
    };
    expectPointClose(cameraPosition(shot, -2), { x: 4, y: 6, z: 8 });
    expectPointClose(cameraPosition(shot, 2.5), { x: 4, y: 6, z: 8 });
    expectPointClose(cameraPosition(shot, 20), { x: 4, y: 6, z: 8 });
  });

  it('lands on the final spline point when duration is zero', () => {
    const shot: SceneRigCameraShot = {
      kind: 'dolly',
      points: [
        { x: 1, y: 2, z: 3 },
        { x: 7, y: 8, z: 9 },
      ],
      lookAt: { kind: 'point', point: { x: 0, y: 2, z: 0 } },
      dur: 0,
    };
    expectPointClose(cameraPosition(shot, 0), { x: 7, y: 8, z: 9 });
  });
});
