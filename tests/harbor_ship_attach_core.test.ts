import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  composeHarborShipAttachFrame,
  HarborShipPendingCueState,
} from '../src/render/harbor_ship_attach_core';
import type { PropPathSegment } from '../src/render/prop_path_core';
import type { SceneAttachFrame } from '../src/sim/types';
import { assertAllocationStable } from './util/alloc_probe';

const MAIN_SOURCE = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const HARBOR_SOURCE = readFileSync(new URL('../src/render/harbor.ts', import.meta.url), 'utf8');
const TEST_SEGMENT = {
  start: { x: 0, y: 0, z: 0, yaw: 0 },
  end: { x: 12, y: 0, z: -4, yaw: Math.PI / 3 },
  duration: 4,
  ease: 'linear',
} satisfies PropPathSegment;
const TEST_SEGMENTS: Readonly<Record<string, PropPathSegment | undefined>> = {
  depart: TEST_SEGMENT,
};

function functionSource(name: string): string {
  const start = HARBOR_SOURCE.indexOf(`function ${name}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  const bodyStart = HARBOR_SOURCE.indexOf('{', start);
  let depth = 0;
  for (let i = bodyStart; i < HARBOR_SOURCE.length; i++) {
    if (HARBOR_SOURCE[i] === '{') depth++;
    if (HARBOR_SOURCE[i] !== '}') continue;
    depth--;
    if (depth === 0) return HARBOR_SOURCE.slice(start, i + 1);
  }
  throw new Error(`Could not find the end of ${name}`);
}

describe('composeHarborShipAttachFrame', () => {
  const base = {
    baseX: 10,
    baseY: -4,
    baseZ: 20,
    baseRot: Math.PI / 6,
  };

  it('returns the base pose for a parked ship', () => {
    const out: SceneAttachFrame = {
      position: { x: 0, y: 0, z: 0 },
      yaw: 0,
    };

    expect(composeHarborShipAttachFrame(base, null, out)).toEqual({
      position: { x: 10, y: -4, z: 20 },
      yaw: Math.PI / 6,
    });
  });

  it('composes a mid-segment local offset under the combined yaw', () => {
    const out: SceneAttachFrame = {
      position: { x: 0, y: 0, z: 0 },
      yaw: 0,
    };
    const pose = {
      x: 3,
      y: 1.5,
      z: -2,
      yaw: Math.PI / 12,
      done: false,
    };

    const frame = composeHarborShipAttachFrame(base, pose, out);
    const halfRootTwo = Math.SQRT1_2;
    const expected = {
      x: 10 + halfRootTwo,
      y: -2.5,
      z: 20 - 5 * halfRootTwo,
      yaw: Math.PI / 4,
    };

    expect(Math.abs(frame.position.x - expected.x)).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(frame.position.y - expected.y)).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(frame.position.z - expected.z)).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(frame.yaw - expected.yaw)).toBeLessThanOrEqual(1e-9);
  });

  it('reuses the caller-owned output container', () => {
    const out: SceneAttachFrame = {
      position: { x: 0, y: 0, z: 0 },
      yaw: 0,
    };
    const pose = {
      x: 3,
      y: 1.5,
      z: -2,
      yaw: Math.PI / 12,
      done: false,
    };

    expect(composeHarborShipAttachFrame(base, pose, out)).toBe(out);
    expect(() =>
      assertAllocationStable(() => composeHarborShipAttachFrame(base, pose, out)),
    ).not.toThrow();
    expect(composeHarborShipAttachFrame(base, null, out)).toBe(out);
    expect(out).toEqual({
      position: { x: 10, y: -4, z: 20 },
      yaw: Math.PI / 6,
    });
  });
});

describe('HarborShipPendingCueState', () => {
  it('resolves a known cue immediately when its ship handle exists', () => {
    const cues = new HarborShipPendingCueState(TEST_SEGMENTS);

    expect(cues.routeCue('harbor_ship_mainland', 'depart', 23.5, true)).toEqual({
      segment: TEST_SEGMENT,
      cueStartSec: 23.5,
    });
  });

  it('records a cue when its ship handle is missing', () => {
    const cues = new HarborShipPendingCueState(TEST_SEGMENTS);

    expect(cues.routeCue('harbor_ship_mainland', 'depart', 41.25, false)).toBeNull();
    expect(cues.consumePending('harbor_ship_mainland')?.segment).toBe(TEST_SEGMENT);
  });

  it('preserves the recorded cue start value when the ship attaches', () => {
    const cues = new HarborShipPendingCueState(TEST_SEGMENTS);
    const recordedStartSec = 173.625;
    cues.routeCue('harbor_ship_mainland', 'depart', recordedStartSec, false);

    const resolved = cues.consumePending('harbor_ship_mainland');

    expect(resolved?.cueStartSec).toBe(recordedStartSec);
  });

  it('rejects an unknown segment and leaves the attached ship parked', () => {
    const cues = new HarborShipPendingCueState(TEST_SEGMENTS);
    const ship: {
      segment: PropPathSegment | null;
      cueStartSec: number | null;
    } = {
      segment: null,
      cueStartSec: null,
    };
    cues.routeCue('harbor_ship_mainland', 'unknown', 82.5, false);

    const resolved = cues.consumePending('harbor_ship_mainland');
    if (resolved) {
      ship.segment = resolved.segment;
      ship.cueStartSec = resolved.cueStartSec;
    }

    expect(resolved).toBeNull();
    expect(ship).toEqual({ segment: null, cueStartSec: null });
  });

  it('clears pending cues for a scene reset', () => {
    const cues = new HarborShipPendingCueState(TEST_SEGMENTS);
    cues.routeCue('harbor_ship_mainland', 'depart', 54.75, false);

    cues.clearPending();

    expect(cues.consumePending('harbor_ship_mainland')).toBeNull();
  });

  it('clears pending cues for a harbor world rebuild', () => {
    const cues = new HarborShipPendingCueState(TEST_SEGMENTS);
    cues.routeCue('harbor_ship_mainland', 'depart', 96.125, false);

    cues.clearPending();

    expect(cues.consumePending('harbor_ship_mainland')).toBeNull();
  });
});

describe('harbor ship attachment wiring', () => {
  it('binds the live harbor frame beside the SceneDirector prop dependencies', () => {
    expect(MAIN_SOURCE).toMatch(
      / {4}propCue: \(target, cue\) => cueHarborShip\(target, cue\),\n {4}propReset: \(\) => resetHarborShipCues\(\),\n {4}attachmentFrame: \(target, out\) => harborShipAttachFrame\(target, out\),/,
    );
    expect(HARBOR_SOURCE).toContain('out: SceneAttachFrame = SHIP_ATTACH_FRAME,');
  });

  it('shares one composition function between the camera query and mesh update', () => {
    const attachFrameSource = functionSource('harborShipAttachFrame');
    expect(attachFrameSource).toContain('if (!handle) return null;');
    expect(attachFrameSource).toContain(
      'propPathPoseAt(handle.segment, performance.now() / 1000 - handle.cueStartSec, CUE_POSE)',
    );
    expect(attachFrameSource).toContain('return composeHarborShipAttachFrame(handle, pose, out);');
    expect(attachFrameSource).not.toContain('handle.group.position');
    expect(attachFrameSource).not.toContain('handle.group.rotation');
    expect(attachFrameSource).not.toContain('handle.group.matrixAutoUpdate');

    const updateSource = functionSource('updateHarborShipMotion');
    expect(updateSource).toContain(
      'if (handle.cueStartSec !== null && handle.segment !== null) {\n    handle.group.matrixAutoUpdate = true;',
    );
    expect(updateSource).toContain(
      'const frame = composeHarborShipAttachFrame(handle, pose, SHIP_UPDATE_FRAME);',
    );
    expect(updateSource).toContain(
      'handle.group.position.set(frame.position.x, frame.position.y, frame.position.z);',
    );
    expect(updateSource).toContain('handle.group.rotation.y = frame.yaw;');
  });

  it('routes cues through the executable pending-cue registry', () => {
    const cueSource = functionSource('cueHarborShip');
    expect(cueSource).toContain('SHIP_CUES.cue(target, cue);');
  });

  it('registers built ship handles with the executable pending-cue registry', () => {
    const buildSource = functionSource('buildShip');
    expect(buildSource).toContain('SHIP_CUES.register(target, handle);');
  });

  it('clears pending cues during scene reset', () => {
    expect(functionSource('resetHarborShipCues')).toContain('SHIP_CUES.resetAll();');
  });
});
