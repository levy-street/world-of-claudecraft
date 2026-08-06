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
      / {4}nowSec: \(\) => world\.presentationTime,\n {4}musicSilence: [^\n]+,\n {4}playDirective: [^\n]+,\n {4}propCue: \(target, cue, startSec\) => cueHarborShip\(target, cue, startSec\),\n {4}propReset: \(\) => resetHarborShipCues\(\),\n {4}releaseInputLockMirror: [^\n]+,\n {4}attachmentFrame: \(target, out, presentationTimeSec\) =>\n {6}harborShipAttachFrame\(target, out, presentationTimeSec\),/,
    );
    expect(HARBOR_SOURCE).toContain('out: SceneAttachFrame = SHIP_ATTACH_FRAME,');
    expect(HARBOR_SOURCE).toContain('presentationTimeSec?: number,');
  });

  it('shares one composition function between the camera query and mesh update', () => {
    const attachFrameSource = functionSource('harborShipAttachFrame');
    expect(attachFrameSource).toContain('if (!handle) return null;');
    expect(attachFrameSource).toContain(
      '(presentationTimeSec ?? harborSceneNowSec()) - handle.cueStartSec',
    );
    expect(attachFrameSource).toContain('propPathPoseAt(handle.segment, elapsedSec, CUE_POSE)');
    expect(attachFrameSource).toContain('return composeHarborShipAttachFrame(handle, pose, out);');
    expect(attachFrameSource).not.toContain('handle.group.position');
    expect(attachFrameSource).not.toContain('handle.group.rotation');
    expect(attachFrameSource).not.toContain('handle.group.matrixAutoUpdate');

    const updateSource = functionSource('updateHarborShipMotion');
    expect(updateSource).toContain('const elapsedSec = SHIP_CUES.elapsedSec(handle);');
    expect(updateSource).toContain(
      'if (elapsedSec !== null && handle.segment !== null) {\n    handle.group.matrixAutoUpdate = true;',
    );
    expect(updateSource).toContain(
      'const frame = composeHarborShipAttachFrame(handle, pose, handle.frame);',
    );
    expect(updateSource).toContain(
      'handle.group.position.set(frame.position.x, frame.position.y, frame.position.z);',
    );
    expect(updateSource).toContain('handle.group.rotation.y = frame.yaw;');
  });

  it('routes cues through the executable pending-cue registry', () => {
    const cueSource = functionSource('cueHarborShip');
    expect(cueSource).toContain('SHIP_CUES.cue(target, cue, startSec);');
  });

  it('registers built ship handles with the executable pending-cue registry', () => {
    const buildSource = functionSource('buildShip');
    expect(buildSource).toContain('SHIP_CUES.register(target, handle);');
  });

  it('clears pending cues during scene reset', () => {
    expect(functionSource('resetHarborShipCues')).toContain('SHIP_CUES.resetAll();');
  });

  it('distinguishes live graphics cue preservation from a new-world reset', () => {
    // functionSource cannot walk buildHarbors (its return type carries braces),
    // so pin the rebuild discard directly on the module source.
    expect(HARBOR_SOURCE).toContain(
      'if (preserveLiveCues) SHIP_CUES.preserveForRebuild();\n  else SHIP_CUES.clear();',
    );
  });
});
