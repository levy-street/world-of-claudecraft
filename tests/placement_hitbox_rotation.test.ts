// Placement yaw applies to per-placement collision boxes: an offset hitbox
// must follow the asset when the maker rotates it (three.js rotation.y
// convention: +X rotates toward -Z for a positive quarter turn). Regression
// pin for "the collision box doesn't rotate with the asset".

import { afterEach, describe, expect, it } from 'vitest';
import { isBlocked } from '../src/sim/colliders';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import type { PlacedAsset, WorldContent } from '../src/sim/types';

const SEED = 4242;

function world(extra: Partial<WorldContent>): WorldContent {
  // A fresh object per test: the collider grid cache is keyed per content.
  return { ...BUILTIN_WORLD, ...extra };
}

function placement(rotY: number): PlacedAsset {
  return {
    path: '/models/props/well.glb',
    x: 0,
    z: 60,
    rotY,
    scale: 1,
    collideRadius: 0.8,
    hitboxes: [{ x: 3, y: 1, z: 0, hx: 0.5, hy: 1, hz: 0.5 }],
  };
}

afterEach(() => {
  setActiveWorldContent(null);
});

describe('rotated placement hitboxes', () => {
  it('unrotated: the offset box blocks at +X only', () => {
    setActiveWorldContent(world({ placements: [placement(0)] }));
    expect(isBlocked(SEED, 3, 60, 0.3)).toBe(true);
    expect(isBlocked(SEED, 0, 57, 0.3)).toBe(false);
    expect(isBlocked(SEED, 0, 63, 0.3)).toBe(false);
  });

  it('a quarter turn carries the box from +X to -Z (three.js yaw)', () => {
    setActiveWorldContent(world({ placements: [placement(Math.PI / 2)] }));
    expect(isBlocked(SEED, 3, 60, 0.3)).toBe(false);
    expect(isBlocked(SEED, 0, 57, 0.3)).toBe(true);
    expect(isBlocked(SEED, 0, 63, 0.3)).toBe(false);
  });

  it('a half turn mirrors the box to -X', () => {
    setActiveWorldContent(world({ placements: [placement(Math.PI)] }));
    expect(isBlocked(SEED, 3, 60, 0.3)).toBe(false);
    expect(isBlocked(SEED, -3, 60, 0.3)).toBe(true);
  });
});

describe('tilted placement hitboxes (rotX/rotZ)', () => {
  // A tall column: base at the origin, rising to y=6.
  function column(rotX: number): PlacedAsset {
    return {
      path: '/models/props/well.glb',
      x: 0,
      z: 60,
      rotY: 0,
      rotX,
      scale: 1,
      collideRadius: 0.8,
      hitboxes: [{ x: 0, y: 3, z: 0, hx: 0.75, hy: 3, hz: 0.75 }],
    };
  }

  it('untilted control: the column blocks at its base only', () => {
    setActiveWorldContent(world({ placements: [column(0)] }));
    expect(isBlocked(SEED, 0, 60, 0.3)).toBe(true);
    expect(isBlocked(SEED, 0, 64, 0.3)).toBe(false);
  });

  it('laid down by a quarter tilt, the column blocks along +Z instead', () => {
    // three.js rotation.set(pi/2, 0, 0) carries +Y to +Z: the column now lies
    // from z=60 to z=66 at ankle height.
    setActiveWorldContent(world({ placements: [column(Math.PI / 2)] }));
    expect(isBlocked(SEED, 0, 64, 0.3)).toBe(true);
    expect(isBlocked(SEED, 0, 57, 0.3)).toBe(false);
    expect(isBlocked(SEED, 3, 64, 0.3)).toBe(false);
  });

  it('the lying column keeps a real Y band: a high mover steps over it', () => {
    setActiveWorldContent(world({ placements: [column(Math.PI / 2)] }));
    expect(isBlocked(SEED, 0, 64, 0.3, false, undefined, 0, { y: 1000, lift: 0 })).toBe(false);
  });
});
