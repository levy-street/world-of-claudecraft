import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { harborShipAttachFrameFrom } from '../src/render/harbor_ship_attach_core';
import type { SceneAttachFrame } from '../src/sim/types';
import { assertAllocationStable } from './util/alloc_probe';

const MAIN_SOURCE = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const HARBOR_SOURCE = readFileSync(new URL('../src/render/harbor.ts', import.meta.url), 'utf8');

describe('harborShipAttachFrameFrom', () => {
  it('returns null for an unknown target', () => {
    const handles = new Map([
      [
        'harbor_ship_mainland',
        {
          group: {
            position: { x: 165, y: -2.4, z: -48 },
            rotation: { y: Math.PI / 2 },
          },
        },
      ],
    ]);

    expect(harborShipAttachFrameFrom(handles, 'harbor_ship_unknown')).toBeNull();
  });

  it('reads the current parked and mid-segment group frames without changing the freeze state', () => {
    const group = {
      position: { x: 165, y: -2.4, z: -48 },
      rotation: { y: Math.PI / 2 },
      matrixAutoUpdate: false,
    };
    const handles = new Map([['harbor_ship_mainland', { group }]]);

    expect(harborShipAttachFrameFrom(handles, 'harbor_ship_mainland')).toEqual({
      position: { x: 165, y: -2.4, z: -48 },
      yaw: Math.PI / 2,
    });
    expect(group.matrixAutoUpdate).toBe(false);

    group.position.x = 170.25;
    group.position.y = -1.9;
    group.position.z = -52.75;
    group.rotation.y = Math.PI * 0.75;
    group.matrixAutoUpdate = true;

    expect(harborShipAttachFrameFrom(handles, 'harbor_ship_mainland')).toEqual({
      position: { x: 170.25, y: -1.9, z: -52.75 },
      yaw: Math.PI * 0.75,
    });
    expect(group.matrixAutoUpdate).toBe(true);
  });

  it('writes changing live frames into the caller-owned output', () => {
    const group = {
      position: { x: 165, y: -2.4, z: -48 },
      rotation: { y: Math.PI / 2 },
    };
    const handles = new Map([['harbor_ship_mainland', { group }]]);
    const out: SceneAttachFrame = {
      position: { x: 0, y: 0, z: 0 },
      yaw: 0,
    };

    const first = harborShipAttachFrameFrom(handles, 'harbor_ship_mainland', out);
    expect(first).toBe(out);
    expect(out).toEqual({
      position: { x: 165, y: -2.4, z: -48 },
      yaw: Math.PI / 2,
    });

    group.position.x = 170.25;
    group.rotation.y = Math.PI * 0.75;
    const second = harborShipAttachFrameFrom(handles, 'harbor_ship_mainland', out);
    expect(second).toBe(out);
    expect(out.position.x).toBe(170.25);
    expect(out.yaw).toBe(Math.PI * 0.75);

    expect(() =>
      assertAllocationStable(() => harborShipAttachFrameFrom(handles, 'harbor_ship_mainland', out)),
    ).not.toThrow();
  });
});

describe('harbor ship attachment wiring', () => {
  it('binds the live harbor frame beside the SceneDirector prop dependencies', () => {
    expect(MAIN_SOURCE).toMatch(
      / {4}propCue: \(target, cue\) => cueHarborShip\(target, cue\),\n {4}propReset: \(\) => resetHarborShipCues\(\),\n {4}attachmentFrame: \(target, out\) => harborShipAttachFrame\(target, out\),/,
    );
    expect(HARBOR_SOURCE).toContain('out: SceneAttachFrame = SHIP_ATTACH_FRAME,');
    expect(HARBOR_SOURCE).toContain('return harborShipAttachFrameFrom(SHIPS, target, out);');
  });
});
