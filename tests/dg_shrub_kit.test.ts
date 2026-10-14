// The Deepglass undergrowth kit (scripts/assets/deepglass/bl_dg_shrubs.py, v2
// 2026-09-24): shrubs, ferns and grass under 300 triangles each, installed at
// their authored scale, walk-through (no collision), on the v2 foliage sheets.

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import overrides from '../data/asset_collision_overrides.json';
import { targetHeightFor } from '../src/render/asset_scale';
import { isBlocked, resolveMovement } from '../src/sim/colliders';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';

const root = path.resolve(__dirname, '..');
const meta: Record<string, { kind: string; tris: number; dims: number[] }> = JSON.parse(
  fs.readFileSync(path.join(root, 'data/dg_shrub_kit.json'), 'utf8'),
);
const names = Object.keys(meta);

describe('Deepglass undergrowth kit', () => {
  it('ships shrubs, grass, and the violet-flowering variants', () => {
    expect(names.filter((n) => meta[n].kind === 'shrub').length).toBeGreaterThanOrEqual(10);
    expect(names.filter((n) => meta[n].kind === 'grass').length).toBeGreaterThanOrEqual(3);
    for (const n of ['shrub_bloom', 'shrub_heather', 'grass_bloom', 'shrub_berry'])
      expect(names).toContain(n);
  });

  it('keeps every piece under 300 GPU triangles (both card windings counted)', () => {
    for (const n of names) expect(meta[n].tris).toBeLessThan(300);
  });

  it('installs each GLB at its authored scale, walk-through except the moss rock', () => {
    const ov = overrides as unknown as Record<
      string,
      { mode: string; boxes?: { hx: number; hy: number }[] }
    >;
    for (const n of names) {
      expect(fs.existsSync(path.join(root, 'public/models/deepglass', `${n}.glb`))).toBe(true);
      expect(targetHeightFor(`/models/deepglass/${n}.glb`)).toBeCloseTo(
        Math.max(...meta[n].dims),
        2,
      );
      // plants are walk-through; the moss rock's STONE blocks (SPACEY, 2026-09-24)
      if (n === 'shrub_rock_cling') {
        expect(ov[`deepglass/${n}`].mode).toBe('baked');
        expect(ov[`deepglass/${n}`].boxes?.length).toBeGreaterThan(0);
      } else expect(ov[`deepglass/${n}`].mode).toBe('none');
    }
  });

  describe('the moss rock blocks a walking player', () => {
    afterEach(() => setActiveWorldContent(null));
    const rock = {
      path: '/models/deepglass/shrub_rock_cling.glb',
      x: 0,
      z: 60,
      rotY: 0,
      scale: 1,
      collideRadius: 0.8,
    };

    it('is solid at its centre and cannot be walked through', () => {
      setActiveWorldContent({ ...BUILTIN_WORLD, placements: [rock] } as never);
      expect(isBlocked(4242, 0, 60, 0.5)).toBe(true);
      // head-on from 3 yd out: stopped short of the stone
      const res = resolveMovement(4242, 0, 57, 0, 63, 0.5);
      expect(res.z).toBeLessThan(59.5);
    });

    it('has no standable top: the 0.6 yd stone is not a kerb to stride up', () => {
      // a standable top under the 1.0 yd stride just gets walked over
      // (SPACEY: "the collision still not working")
      const ov = overrides as unknown as Record<string, { boxes?: { moveTopY?: number }[] }>;
      for (const b of ov['deepglass/shrub_rock_cling'].boxes ?? [])
        expect(b.moveTopY).toBeUndefined();
    });
  });
});
