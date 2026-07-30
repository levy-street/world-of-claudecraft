import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  evaluateSceneRigPose,
  type SceneRigPose,
  sampleCatmullRom,
  sceneRigCameraPosition,
} from '../src/game/scene_rig_core';
import type { SceneAttachFrame, SceneRigCameraShot, SceneRigPoint } from '../src/sim/types';
import { assertAllocationStable } from './util/alloc_probe';

const noEntities = (): null => null;
const noAttachments = (): null => null;
const RIG_SOURCE = readFileSync(new URL('../src/game/scene_rig_core.ts', import.meta.url), 'utf8');

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
  it('reuses the caller pose across live dolly frames', () => {
    const shot: SceneRigCameraShot = {
      kind: 'dolly',
      points: [
        { x: 0, y: 5, z: 0 },
        { x: 10, y: 6, z: 4 },
        { x: 20, y: 5, z: 0 },
      ],
      lookAt: { kind: 'point', point: { x: 10, y: 2, z: 10 } },
      dur: 4,
    };
    const out: SceneRigPose = {
      yaw: 0,
      pitch: 0,
      dist: 0,
      focusX: 0,
      focusY: 0,
      focusZ: 0,
    };

    const first = evaluateSceneRigPose(shot, 0.5, noEntities, noAttachments, out);
    const firstYaw = first.yaw;
    const second = evaluateSceneRigPose(shot, 2.5, noEntities, noAttachments, out);

    expect(first).toBe(out);
    expect(second).toBe(out);
    expect(second.yaw).not.toBe(firstYaw);

    let elapsed = 0;
    expect(() =>
      assertAllocationStable(() => {
        elapsed = (elapsed + 0.125) % shot.dur;
        return evaluateSceneRigPose(shot, elapsed, noEntities, noAttachments, out);
      }),
    ).not.toThrow();
  });

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

  it('reuses the caller pose across spline look-at dolly frames', () => {
    const shot: SceneRigCameraShot = {
      kind: 'dolly',
      points: [
        { x: -4, y: 5, z: 0 },
        { x: 6, y: 8, z: 3 },
        { x: 14, y: 4, z: -2 },
      ],
      lookAt: {
        kind: 'spline',
        points: [
          { x: 0, y: 2, z: 10 },
          { x: 8, y: 3, z: 12 },
          { x: 16, y: 2, z: 8 },
        ],
      },
      dur: 4,
    };
    const out: SceneRigPose = {
      yaw: 0,
      pitch: 0,
      dist: 0,
      focusX: 0,
      focusY: 0,
      focusZ: 0,
    };

    const first = evaluateSceneRigPose(shot, 0.25, noEntities, noAttachments, out);
    const firstFocusX = first.focusX;
    const second = evaluateSceneRigPose(shot, 3.25, noEntities, noAttachments, out);

    expect(first).toBe(out);
    expect(second).toBe(out);
    expect(second.focusX).not.toBe(firstFocusX);

    let elapsed = 0;
    expect(() =>
      assertAllocationStable(() => {
        elapsed = (elapsed + 0.125) % shot.dur;
        return evaluateSceneRigPose(shot, elapsed, noEntities, noAttachments, out);
      }),
    ).not.toThrow();
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
  it('reuses caller-owned pose and attachment scratch across live frames', () => {
    const shot: SceneRigCameraShot = {
      kind: 'attach',
      target: 'test_ship',
      fallbackFrame: { position: { x: 0, y: 0, z: 0 }, yaw: 0 },
      offset: { x: 2, y: 3, z: 0 },
      lookAt: { x: 0, y: 1, z: 4 },
    };
    const out: SceneRigPose = {
      yaw: 0,
      pitch: 0,
      dist: 0,
      focusX: 0,
      focusY: 0,
      focusZ: 0,
    };
    let frameNumber = 0;
    let attachmentScratch: SceneAttachFrame | undefined;
    const resolveAttachment = (
      target: string,
      frameOut?: SceneAttachFrame,
    ): SceneAttachFrame | null => {
      expect(target).toBe('test_ship');
      expect(frameOut).toBeDefined();
      if (!frameOut) return null;
      if (attachmentScratch) expect(frameOut).toBe(attachmentScratch);
      else attachmentScratch = frameOut;
      frameNumber += 1;
      frameOut.position.x = 10 + frameNumber;
      frameOut.position.y = 5;
      frameOut.position.z = 20;
      frameOut.yaw = Math.PI / 2;
      return frameOut;
    };

    const first = evaluateSceneRigPose(shot, 0, noEntities, resolveAttachment, out);
    const firstFocusX = first.focusX;
    const second = evaluateSceneRigPose(shot, 1, noEntities, resolveAttachment, out);

    expect(first).toBe(out);
    expect(second).toBe(out);
    expect(second.focusX).not.toBe(firstFocusX);

    let elapsed = 1;
    expect(() =>
      assertAllocationStable(() => {
        elapsed += 1;
        return evaluateSceneRigPose(shot, elapsed, noEntities, resolveAttachment, out);
      }),
    ).not.toThrow();
  });

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

describe('live-pose entry easing', () => {
  const easeFrom: SceneRigPose = {
    yaw: 1,
    pitch: 0.3,
    dist: 12,
    focusX: 0,
    focusY: 0,
    focusZ: 0,
  };

  it('accepts the ease-from pose as explicit dolly input', () => {
    const shot: SceneRigCameraShot = {
      kind: 'dolly',
      points: [
        { x: 2, y: 6, z: 4 },
        { x: 10, y: 8, z: 12 },
      ],
      lookAt: { kind: 'point', point: { x: 6, y: 3, z: 8 } },
      dur: 2,
    };

    expect(
      evaluateSceneRigPose(shot, 0, noEntities, noAttachments, undefined, {
        pose: easeFrom,
        duration: 0.8,
      }),
    ).toEqual(easeFrom);
    const landed = evaluateSceneRigPose(shot, 0.8, noEntities, noAttachments, undefined, {
      pose: easeFrom,
      duration: 0.8,
    });
    const authored = evaluateSceneRigPose(shot, 0.8, noEntities, noAttachments);
    expect(landed).toEqual(authored);
    const authoredHalf = evaluateSceneRigPose(shot, 0.4, noEntities, noAttachments);
    const easedHalf = evaluateSceneRigPose(shot, 0.4, noEntities, noAttachments, undefined, {
      pose: easeFrom,
      duration: 0.8,
    });
    expect(easedHalf.yaw).toBeCloseTo((easeFrom.yaw + authoredHalf.yaw) / 2, 10);
    expect(easedHalf.dist).toBeCloseTo((easeFrom.dist + authoredHalf.dist) / 2, 10);
    expect(easedHalf.focusX).toBeCloseTo((easeFrom.focusX + authoredHalf.focusX) / 2, 10);
  });

  it('accepts the ease-from pose as explicit attach input', () => {
    const shot: SceneRigCameraShot = {
      kind: 'attach',
      target: 'ship',
      fallbackFrame: { position: { x: 10, y: 5, z: 20 }, yaw: 0 },
      offset: { x: 2, y: 3, z: 0 },
      lookAt: { x: 0, y: 1, z: 4 },
    };

    expect(
      evaluateSceneRigPose(shot, 0, noEntities, noAttachments, undefined, {
        pose: easeFrom,
        duration: 0.8,
      }),
    ).toEqual(easeFrom);
    expect(
      evaluateSceneRigPose(shot, 0.8, noEntities, noAttachments, undefined, {
        pose: easeFrom,
        duration: 0.8,
      }),
    ).toEqual(evaluateSceneRigPose(shot, 0.8, noEntities, noAttachments));
    const authoredHalf = evaluateSceneRigPose(shot, 0.4, noEntities, noAttachments);
    const easedHalf = evaluateSceneRigPose(shot, 0.4, noEntities, noAttachments, undefined, {
      pose: easeFrom,
      duration: 0.8,
    });
    expect(easedHalf.yaw).toBeCloseTo((easeFrom.yaw + authoredHalf.yaw) / 2, 10);
    expect(easedHalf.dist).toBeCloseTo((easeFrom.dist + authoredHalf.dist) / 2, 10);
    expect(easedHalf.focusZ).toBeCloseTo((easeFrom.focusZ + authoredHalf.focusZ) / 2, 10);
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

describe('allocation plumbing', () => {
  it('samples a spline into the caller-owned point across progress changes', () => {
    const points: readonly SceneRigPoint[] = [
      { x: 0, y: 2, z: 4 },
      { x: 8, y: 6, z: 10 },
      { x: 16, y: 3, z: 2 },
    ];
    const out: SceneRigPoint = { x: 0, y: 0, z: 0 };

    const first = sampleCatmullRom(points, 0.2, out);
    const firstX = first.x;
    const second = sampleCatmullRom(points, 0.8, out);

    expect(first).toBe(out);
    expect(second).toBe(out);
    expect(second.x).not.toBe(firstX);
  });

  it('routes every live rig point through the module scratch containers', () => {
    expect(RIG_SOURCE).toContain(
      'resolveAttachment(shot.target, ATTACH_FRAME, attachmentTimeSec) ?? shot.fallbackFrame;',
    );
    expect(RIG_SOURCE).toContain('const camera = localToWorld(frame, shot.offset, CAMERA_POINT);');
    expect(RIG_SOURCE).toContain('const lookAt = localToWorld(frame, shot.lookAt, LOOK_AT_POINT);');
    expect(RIG_SOURCE).toContain(
      'const camera = sampleCatmullRom(shot.points, eased, CAMERA_POINT);',
    );
    expect(RIG_SOURCE).toContain(
      'lookAt = sampleCatmullRom(shot.lookAt.points, eased, LOOK_AT_POINT);',
    );
    expect(RIG_SOURCE).toContain('LOOK_AT_POINT.x = subject.x + shot.lookAt.offset.x;');
    expect(RIG_SOURCE).toContain('LOOK_AT_POINT.y = subject.y + shot.lookAt.offset.y;');
    expect(RIG_SOURCE).toContain('LOOK_AT_POINT.z = subject.z + shot.lookAt.offset.z;');
    expect(RIG_SOURCE).toContain('lookAt = LOOK_AT_POINT;');
  });

  it('keeps local-to-world conversion on its provided output', () => {
    const start = RIG_SOURCE.indexOf('function localToWorld');
    const end = RIG_SOURCE.indexOf('function knotInterval', start);
    const source = RIG_SOURCE.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(source).toContain('out.x =');
    expect(source).toContain('out.y =');
    expect(source).toContain('out.z =');
    expect(source).toContain('return out;');
    expect(source).not.toContain('return {');
  });
});
