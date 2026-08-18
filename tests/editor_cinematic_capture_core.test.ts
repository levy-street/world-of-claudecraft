import { describe, expect, it } from 'vitest';
import {
  CINEMATIC_CAPTURE_BLOCK_END,
  CINEMATIC_CAPTURE_BLOCK_START,
  CINEMATIC_CAPTURE_TOOL,
  createCinematicCameraCapture,
  formatGeneratedCinematicCaptureFile,
  isCinematicCameraCapture,
} from '../src/editor/cinematic_capture_core';
import { WORLD_SEED } from '../src/world_seed.mjs';

const CAMERA_POSE = {
  position: { x: 12.1234567, y: 20, z: -4 },
  target: { x: 10, y: 7.5, z: 2.7654321 },
};

describe('editor cinematic capture core', () => {
  it('converts the exact camera and look-at points into terrain-relative keyframes', () => {
    const capture = createCinematicCameraCapture({
      sceneId: 'scn_test',
      timeSec: 1.25,
      seed: WORLD_SEED,
      capturedAt: '2026-07-30T01:02:03.000Z',
      pose: CAMERA_POSE,
      groundY: (x, z) => x + z,
    });

    expect(capture).toEqual({
      sceneId: 'scn_test',
      timeSec: 1.25,
      keyframe: {
        camera: { x: 12.123457, z: -4, height: 11.876543 },
        lookAt: {
          kind: 'point',
          point: { x: 10, z: 2.765432, height: -5.265432 },
        },
      },
      provenance: {
        seed: WORLD_SEED,
        tool: CINEMATIC_CAPTURE_TOOL,
        capturedAt: '2026-07-30T01:02:03.000Z',
      },
    });
  });

  it('refuses a capture made against a non-shipping seed', () => {
    expect(
      createCinematicCameraCapture({
        sceneId: 'scn_test',
        timeSec: 0,
        seed: WORLD_SEED + 1,
        capturedAt: '2026-07-30T01:02:03.000Z',
        pose: CAMERA_POSE,
        groundY: () => 0,
      }),
    ).toBeNull();
  });

  it('formats a marked generated file with capture provenance and a paste-ready keyframe', () => {
    const capture = createCinematicCameraCapture({
      sceneId: 'scn_test',
      timeSec: 1.25,
      seed: WORLD_SEED,
      capturedAt: '2026-07-30T01:02:03.000Z',
      pose: CAMERA_POSE,
      groundY: () => 2,
    });
    expect(capture).not.toBeNull();
    if (!capture) throw new Error('expected capture');

    const source = formatGeneratedCinematicCaptureFile(capture);
    expect(source).toContain(CINEMATIC_CAPTURE_BLOCK_START);
    expect(source).toContain(CINEMATIC_CAPTURE_BLOCK_END);
    expect(source).toContain("sceneId: 'scn_test'");
    expect(source).toContain('timeSec: 1.25');
    expect(source).toContain('camera: { x: 12.123457, z: -4, height: 18 }');
    expect(source).toContain('point: { x: 10, z: 2.765432, height: 5.5 }');
    expect(source).toContain(`seed: ${WORLD_SEED}`);
    expect(source).toContain("tool: 'woc-editor-cinematic-panel-v1'");
    expect(source).toContain("capturedAt: '2026-07-30T01:02:03.000Z'");
    expect(source).toContain('points: [LATEST_CINEMATIC_CAMERA_CAPTURE.keyframe.camera]');
    expect(source.match(/BEGIN GENERATED CINEMATIC CAMERA CAPTURE/gu)).toHaveLength(1);
    expect(source.match(/END GENERATED CINEMATIC CAMERA CAPTURE/gu)).toHaveLength(1);
    expect(source.indexOf(CINEMATIC_CAPTURE_BLOCK_START)).toBeLessThan(
      source.indexOf(CINEMATIC_CAPTURE_BLOCK_END),
    );
  });

  it('validates the bounded dev-writer payload', () => {
    const capture = createCinematicCameraCapture({
      sceneId: 'scn_test',
      timeSec: 1.25,
      seed: WORLD_SEED,
      capturedAt: '2026-07-30T01:02:03.000Z',
      pose: CAMERA_POSE,
      groundY: () => 0,
    });
    if (!capture) throw new Error('expected capture');
    expect(isCinematicCameraCapture(capture)).toBe(true);
    expect(isCinematicCameraCapture({ ...capture, timeSec: Number.NaN })).toBe(false);
    expect(
      isCinematicCameraCapture({
        ...capture,
        provenance: { ...capture.provenance, tool: 'other-tool' },
      }),
    ).toBe(false);
    const invalid = [
      { ...capture, sceneId: '../scene' },
      { ...capture, timeSec: -1 },
      {
        ...capture,
        keyframe: {
          ...capture.keyframe,
          camera: { ...capture.keyframe.camera, x: Number.POSITIVE_INFINITY },
        },
      },
      {
        ...capture,
        keyframe: {
          ...capture.keyframe,
          lookAt: { ...capture.keyframe.lookAt, kind: 'subject' },
        },
      },
      {
        ...capture,
        provenance: { ...capture.provenance, seed: WORLD_SEED + 1 },
      },
      {
        ...capture,
        provenance: { ...capture.provenance, capturedAt: 'not-a-date' },
      },
    ];
    for (const value of invalid) expect(isCinematicCameraCapture(value)).toBe(false);

    const boundary = {
      ...capture,
      timeSec: 86_400,
      keyframe: {
        camera: { x: 100_000, z: -100_000, height: 100_000 },
        lookAt: {
          kind: 'point',
          point: { x: -100_000, z: 100_000, height: -100_000 },
        },
      },
    };
    expect(isCinematicCameraCapture(boundary)).toBe(true);
    expect(isCinematicCameraCapture({ ...boundary, timeSec: 86_400.000001 })).toBe(false);
    for (const owner of ['camera', 'lookAt'] as const) {
      for (const coordinate of ['x', 'z', 'height'] as const) {
        const point =
          owner === 'camera' ? boundary.keyframe.camera : boundary.keyframe.lookAt.point;
        const invalidPoint = { ...point, [coordinate]: 100_000.000001 };
        const keyframe =
          owner === 'camera'
            ? { ...boundary.keyframe, camera: invalidPoint }
            : {
                ...boundary.keyframe,
                lookAt: { ...boundary.keyframe.lookAt, point: invalidPoint },
              };
        expect(isCinematicCameraCapture({ ...boundary, keyframe })).toBe(false);
      }
    }
  });
});
