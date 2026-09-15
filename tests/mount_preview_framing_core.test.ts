// The mount preview's camera framing (src/render/mount_preview_framing_core.ts):
// the Three-free math src/render/mount_preview.ts feeds its camera. Registering
// it in RENDER_PURE_CORES proves it is PURE; these arms prove the framing
// tracks the staged rig (taller and wider rigs push the camera out) and never
// collapses onto the origin for an empty stage.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MOUNT_PREVIEW_FOV, mountPreviewFraming } from '../src/render/mount_preview_framing_core';

const base = { width: 1, height: 1, depth: 1 };

describe('mountPreviewFraming', () => {
  it('sits the camera farther back and higher for a taller rig', () => {
    const short = mountPreviewFraming({ ...base, height: 1 });
    const tall = mountPreviewFraming({ ...base, height: 3 });
    expect(tall.z).toBeGreaterThan(short.z);
    expect(tall.y).toBeGreaterThan(short.y);
    expect(tall.lookY).toBeGreaterThan(short.lookY);
  });

  it('pushes the camera back for a wide footprint on either axis', () => {
    const tight = mountPreviewFraming(base);
    const wide = mountPreviewFraming({ ...base, width: 4 });
    const deep = mountPreviewFraming({ ...base, depth: 4 });
    expect(wide.z).toBeGreaterThan(tight.z);
    expect(deep.z).toBeGreaterThan(tight.z);
    // The footprint is its larger side, so width and depth frame alike.
    expect(deep.z).toBeCloseTo(wide.z, 10);
    // Height is untouched by the footprint.
    expect(wide.y).toBe(tight.y);
    expect(wide.lookY).toBe(tight.lookY);
  });

  it('clamps an empty or negative stage to the half-metre floor, never the origin', () => {
    const floor = mountPreviewFraming({ width: 0.5, height: 0.5, depth: 0.5 });
    const zero = mountPreviewFraming({ width: 0, height: 0, depth: 0 });
    const negative = mountPreviewFraming({ width: -2, height: -3, depth: -1 });
    expect(zero).toEqual(floor);
    expect(negative).toEqual(floor);
    expect(zero.z).toBeGreaterThan(0);
    expect(zero.y).toBeGreaterThan(0);
    expect(zero.lookY).toBeGreaterThan(0);
  });

  it('looks at a point below the camera height', () => {
    for (const height of [0.5, 1, 2.5, 6]) {
      const framing = mountPreviewFraming({ ...base, height });
      expect(framing.lookY).toBeLessThan(framing.y);
      expect(framing.lookY).toBeGreaterThan(0);
    }
  });

  it('backs the camera off further under a narrower fov', () => {
    const rig = { width: 1.5, height: 2, depth: 2.5 };
    const wide = mountPreviewFraming(rig, 60);
    const preset = mountPreviewFraming(rig);
    const narrow = mountPreviewFraming(rig, 20);
    expect(narrow.z).toBeGreaterThan(preset.z);
    expect(preset.z).toBeGreaterThan(wide.z);
    expect(mountPreviewFraming(rig, MOUNT_PREVIEW_FOV)).toEqual(preset);
    // The fov only moves the distance; heights come from the rig.
    expect(narrow.y).toBe(preset.y);
    expect(narrow.lookY).toBe(preset.lookY);
  });

  it('imports nothing from three, so a Vitest pins it without a GL context', () => {
    const source = readFileSync(
      new URL('../src/render/mount_preview_framing_core.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toContain("from 'three'");
    expect(source).not.toMatch(/from ['"]three\//);
    expect(source).not.toContain('import ');
  });
});
