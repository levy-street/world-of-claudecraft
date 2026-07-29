import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { composeHarborShipAttachFrame } from '../src/render/harbor_ship_attach_core';
import type { SceneAttachFrame } from '../src/sim/types';
import { assertAllocationStable } from './util/alloc_probe';

const MAIN_SOURCE = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const HARBOR_SOURCE = readFileSync(new URL('../src/render/harbor.ts', import.meta.url), 'utf8');

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

    const updateSource = functionSource('updateHarborShips');
    expect(updateSource).toMatch(
      /if \(handle\.cueStartSec === null \|\| handle\.segment === null\) continue;\n {4}handle\.group\.matrixAutoUpdate = true;/,
    );
    expect(updateSource).toContain(
      'const frame = composeHarborShipAttachFrame(handle, pose, SHIP_UPDATE_FRAME);',
    );
    expect(updateSource).toContain(
      'handle.group.position.set(frame.position.x, frame.position.y, frame.position.z);',
    );
    expect(updateSource).toContain('handle.group.rotation.y = frame.yaw;');
  });

  it('keeps a cue pending when its ship handle is not registered yet', () => {
    const cueSource = functionSource('cueHarborShip');
    expect(cueSource).toContain(
      'PENDING_SHIP_CUES.set(target, { cue, startSec: performance.now() / 1000 });',
    );
    expect(cueSource).toContain(
      'if (!handle) {\n    PENDING_SHIP_CUES.set(target, { cue, startSec: performance.now() / 1000 });\n    return;\n  }',
    );
    expect(cueSource).toContain('PENDING_SHIP_CUES.delete(target);');
    expect(cueSource).toMatch(/if \(!segment\) \{\n {4}resetShip\(handle\);\n {4}return;\n {2}\}/);
  });

  it('applies a pending known cue after registration with its original start time', () => {
    const buildSource = functionSource('buildShip');
    expect(buildSource).toContain('SHIPS.set(target, handle);');
    expect(buildSource).toContain('const pending = PENDING_SHIP_CUES.get(target);');
    expect(buildSource).toContain('if (!pending) return;');
    expect(buildSource).toContain('PENDING_SHIP_CUES.delete(target);');
    expect(buildSource).toContain('const segment = PROP_PATH_SEGMENTS[pending.cue];');
    expect(buildSource).toContain('if (!segment) return;');
    expect(buildSource).toContain('handle.cueStartSec = pending.startSec;');
    expect(buildSource).toContain('handle.group.matrixAutoUpdate = true;');
    expect(buildSource).not.toContain('resetShip(handle)');
  });

  it('clears pending cues during scene reset', () => {
    expect(functionSource('resetHarborShipCues')).toContain('PENDING_SHIP_CUES.clear();');
  });
});
