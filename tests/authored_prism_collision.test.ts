import { afterEach, describe, expect, it } from 'vitest';
import { cmBox, cmCylinder } from '../src/editor/cm_mesh';
import { applySessionCollisionOverride, prismsForAssetId } from '../src/sim/asset_collision';
import { invalidateStaticColliders, resolvePosition } from '../src/sim/colliders';
import { getActiveWorldContent } from '../src/sim/data';
import type { PlacedAsset } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

// Collision Master's authored volumes ARE the collision contract: the editor
// draws them as the blue outline, so the sim has to block along that outline.
// It used to block along a rectangle FITTED to each Y band instead, which for a
// round or angled section walls the player off well short of the shape they
// modeled. These tests pin the sim to the drawn outline.

const SEED = 4242;
const ASSET_ID = 'props/prism_probe';
const PATH = `/models/${ASSET_ID}.glb`;
const BODY = 0.25;

// A clear patch of the OPEN world (x below the instanced-interior threshold).
const AT = ((): { x: number; z: number } => {
  for (let z = 900; z < 1400; z += 7) {
    for (let x = -450; x < 450; x += 11) {
      const res = resolvePosition(SEED, x, z, 2, false, undefined, {
        y: groundHeight(x, z, SEED),
        lift: 0,
      });
      if (res.x === x && res.z === z) return { x, z };
    }
  }
  throw new Error('no clear open-world spot found');
})();

function withOverride(
  override: Parameters<typeof applySessionCollisionOverride>[1],
  placements: PlacedAsset[],
  fn: () => void,
): void {
  const content = getActiveWorldContent();
  const prev = content.placements;
  applySessionCollisionOverride(ASSET_ID, override);
  content.placements = placements;
  invalidateStaticColliders();
  try {
    fn();
  } finally {
    content.placements = prev;
    applySessionCollisionOverride(ASSET_ID, null);
    invalidateStaticColliders();
  }
}

/** Smallest distance from the placement centre, along `angle`, where the mover
 *  is no longer pushed: the collider's real reach in that direction. */
function blockedReach(angle: number): number {
  const y = groundHeight(AT.x, AT.z, SEED);
  const dx = Math.cos(angle);
  const dz = Math.sin(angle);
  let lo = 0;
  let hi = 6;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const x = AT.x + dx * mid;
    const z = AT.z + dz * mid;
    const res = resolvePosition(SEED, x, z, BODY, false, undefined, { y: y, lift: 0 });
    const pushed = Math.abs(res.x - x) > 1e-6 || Math.abs(res.z - z) > 1e-6;
    if (pushed) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** Distance from the origin to a regular n-gon's edge along `angle`, for a ring
 *  whose first vertex sits on +X (the cmCylinder winding). */
function ngonReach(r: number, n: number, angle: number): number {
  const step = (Math.PI * 2) / n;
  const half = step / 2;
  let a = ((angle % step) + step) % step;
  if (a > half) a -= step;
  return (r * Math.cos(half)) / Math.cos(a);
}

const cylinderOverride = {
  mode: 'baked',
  // `boxes` is what the sim used to collide with; keeping it here proves the
  // prisms take precedence rather than the table simply being empty.
  boxes: [{ x: 0, y: 1, z: 0, hx: 1, hy: 1, hz: 1 }],
  meshes: [cmCylinder(1, 2, 1, 12)],
} as never;

afterEach(() => {
  applySessionCollisionOverride(ASSET_ID, null);
  invalidateStaticColliders();
});

describe('authored Collision Master volumes drive sim collision', () => {
  it("slices an override's meshes into prisms and caches them", () => {
    applySessionCollisionOverride(ASSET_ID, cylinderOverride);
    const prisms = prismsForAssetId(ASSET_ID);
    expect(prisms).toHaveLength(1);
    expect(prisms[0].poly.length / 2).toBe(12);
    expect(prismsForAssetId(ASSET_ID)).toBe(prisms); // cached
    applySessionCollisionOverride(ASSET_ID, null);
    expect(prismsForAssetId(ASSET_ID)).toHaveLength(0); // and invalidated
  });

  it('blocks along the modeled outline, not a rectangle fitted to it', () => {
    withOverride(
      cylinderOverride,
      [{ path: PATH, x: AT.x, z: AT.z, rotY: 0, scale: 1, collideRadius: 2 }],
      () => {
        for (let i = 0; i < 24; i++) {
          const angle = (i / 24) * Math.PI * 2;
          const reach = blockedReach(angle);
          // The mover stops exactly a body radius off the drawn edge.
          expect(reach - BODY).toBeCloseTo(ngonReach(1, 12, angle), 1);
        }
      },
    );
  });

  it('leaves the corners the old fitted boxes used to wall off', () => {
    withOverride(
      cylinderOverride,
      [{ path: PATH, x: AT.x, z: AT.z, rotY: 0, scale: 1, collideRadius: 2 }],
      () => {
        const y = groundHeight(AT.x, AT.z, SEED);
        // A 1x1 half-extent box (the fitted rectangle) reaches sqrt(2) into the
        // diagonal; the modeled 12-gon stops at ~0.97. Stand between them.
        const d = 1.25 + BODY;
        const x = AT.x + Math.cos(Math.PI / 4) * d;
        const z = AT.z + Math.sin(Math.PI / 4) * d;
        const res = resolvePosition(SEED, x, z, BODY, false, undefined, { y: y, lift: 0 });
        expect(res.x).toBeCloseTo(x, 5);
        expect(res.z).toBeCloseTo(z, 5);
      },
    );
  });

  it('follows the placement yaw and scale', () => {
    const square = { mode: 'baked', meshes: [cmBox(1, 1, 0.25, 1)] } as never;
    withOverride(
      square,
      [{ path: PATH, x: AT.x, z: AT.z, rotY: Math.PI / 2, scale: 2, collideRadius: 2 }],
      () => {
        // Model-space 2 x 0.5 footprint, scaled x2 and turned a quarter turn:
        // the long axis now runs along Z, the short one along X.
        expect(blockedReach(0) - BODY).toBeCloseTo(0.5, 1);
        expect(blockedReach(Math.PI / 2) - BODY).toBeCloseTo(2, 1);
      },
    );
  });

  it('a hand-edited hitbox still overrides the authored volumes', () => {
    withOverride(
      cylinderOverride,
      [
        {
          path: PATH,
          x: AT.x,
          z: AT.z,
          rotY: 0,
          scale: 1,
          collideRadius: 2,
          hitboxes: [{ x: 0, y: 1, z: 0, hx: 2, hy: 1, hz: 2 }],
        },
      ],
      () => {
        // The maker's own box is 2x the authored volume: it must win.
        expect(blockedReach(0) - BODY).toBeCloseTo(2, 1);
      },
    );
  });

  it("a 'basic' authored footprint is not upgraded to the volumes", () => {
    withOverride(
      { mode: 'basic', radius: 3, meshes: [cmCylinder(1, 2, 1, 12)] } as never,
      // collideCustom is what the editor stamps for a 'basic' placement.
      [{ path: PATH, x: AT.x, z: AT.z, rotY: 0, scale: 1, collideRadius: 3, collideCustom: true }],
      () => {
        expect(blockedReach(0) - BODY).toBeCloseTo(3, 1);
      },
    );
  });

  it('a ramp-only authoring stays walk-through', () => {
    withOverride(
      {
        mode: 'baked',
        ramps: [{ x: 0, z: 0, hx: 2, hz: 2, y0: 0, y1: 2 }],
        meshes: [{ ...cmCylinder(1, 2, 1, 12), ramp: true }],
      } as never,
      [{ path: PATH, x: AT.x, z: AT.z, rotY: 0, scale: 1, collideRadius: 2 }],
      () => {
        const y = groundHeight(AT.x, AT.z, SEED);
        const res = resolvePosition(SEED, AT.x, AT.z, BODY, false, undefined, { y: y, lift: 0 });
        expect(res.x).toBeCloseTo(AT.x, 5);
        expect(res.z).toBeCloseTo(AT.z, 5);
      },
    );
  });
});
