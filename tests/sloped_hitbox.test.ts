// Sloped standable tops on baked asset boxes (map_doc.ts MapHitbox.slope):
// an authored kit's tree roots are one box each whose crest FALLS along the
// root (colliders.ts TopSlope.fall) and whose flanks fall across it, so a
// walker's feet follow the bark instead of standing on flat terraces over it.

import { afterEach, describe, expect, it } from 'vitest';
import { type Collider, colliderTopAt, supportHeightAt } from '../src/sim/colliders';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { groundHeight } from '../src/sim/world';

const ridge = (fall?: number): Collider => ({
  type: 'obb',
  x: 0,
  z: 0,
  hw: 2,
  hd: 1,
  rot: 0,
  moveTopY: 2,
  standable: true,
  topSlope: { kind: 'ridge', axis: 'x', pitch: 1, eaveY: 0, ...(fall ? { fall } : {}) },
});

describe('a falling ridge (TopSlope.fall)', () => {
  it('falls along the ridge from moveTopY at the box -x end', () => {
    const c = ridge(0.5);
    expect(colliderTopAt(c, -2, 0)).toBeCloseTo(2, 5); // the -x end: the top
    expect(colliderTopAt(c, 0, 0)).toBeCloseTo(1, 5); // halfway: 2 - 2 * 0.5
    expect(colliderTopAt(c, 2, 0)).toBeCloseTo(0, 5); // the +x end
    // and still falls across the ridge by its pitch
    expect(colliderTopAt(c, 0, 0.5)).toBeCloseTo(0.5, 5);
    // never above moveTopY past the -x end, never under the eave
    expect(colliderTopAt(c, -3, 0)).toBeCloseTo(2, 5);
    expect(colliderTopAt(c, 2, 0.9)).toBeCloseTo(0, 5);
  });

  it('leaves every level ridge (the roofs) exactly as it was', () => {
    const c = ridge();
    expect(colliderTopAt(c, -2, 0)).toBeCloseTo(2, 5);
    expect(colliderTopAt(c, 2, 0)).toBeCloseTo(2, 5);
    expect(colliderTopAt(c, 0, 0.5)).toBeCloseTo(1.5, 5);
  });
});

describe('a baked asset box with a sloped top', () => {
  afterEach(() => setActiveWorldContent(null));
  const path = '/models/test/sloped_root.glb';
  const box = {
    x: 0,
    y: 1,
    z: 0,
    hx: 2,
    hy: 1,
    hz: 1,
    slope: 'ridge',
    pitch: 1,
    fall: 0.5,
    eave: 0,
  };

  it('stands a body on the pitched surface of the placed box, scaled with it', () => {
    for (const scale of [1, 2]) {
      const X = 40;
      const Z = 40;
      setActiveWorldContent({
        ...BUILTIN_WORLD,
        placements: [{ path, x: X, z: Z, rotY: 0, scale, collideRadius: 1 }],
        assetCollision: { [path]: [box] },
      } as never);
      const g = groundHeight(X, Z, 42);
      const at = (lx: number, lz: number): number =>
        supportHeightAt(42, X + lx * scale, Z + lz * scale, 0.01, g + 10) - g;
      // model space: 2 at the -x end, 1 halfway, falling 1 per yard across
      expect(at(-1.9, 0)).toBeCloseTo((2 - 0.05) * scale, 1);
      expect(at(0, 0)).toBeCloseTo(1 * scale, 1);
      expect(at(0, 0.5)).toBeCloseTo(0.5 * scale, 1);
    }
  });

  it('is validated and emitted by the collision table generator', async () => {
    // a plain .mjs build helper (no types): loaded through a typed variable
    const helper = '../scripts/lib/collision_overrides_emit.mjs';
    const { emitCollisionOverridesModule, validateOverride } = (await import(
      /* @vite-ignore */ helper
    )) as {
      emitCollisionOverridesModule: (o: object) => { source: string; errors: string[] };
      validateOverride: (id: string, o: object) => string | null;
    };
    expect(validateOverride('test/sloped_root', { mode: 'baked', boxes: [box] })).toBeNull();
    expect(
      validateOverride('test/sloped_root', { mode: 'baked', boxes: [{ ...box, slope: 'dome' }] }),
    ).toMatch(/bad box/);
    const { source, errors } = emitCollisionOverridesModule({
      'test/sloped_root': { mode: 'baked', boxes: [box] },
    });
    expect(errors).toEqual([]);
    expect(source).toContain("slope: 'ridge', pitch: 1, fall: 0.5, eave: 0");
  });
});
