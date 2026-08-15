// The shared building-placement transforms in props.ts: the chapel bell
// tower's world center is derived through ONE helper by the real composed
// chapel (its hideable footprint) and the far impostor collector, so the
// sprite can never stand offset from the model it hands off to (the #2793
// review's lateral-jump defect: an impostor centered at the raw building
// origin while the real tower stands at the rotated CHAPEL_TOWER.dz).

import { describe, expect, it } from 'vitest';
import { chapelTowerWorldCenter } from '../src/render/props';
import { CHAPEL_TOWER } from '../src/sim/prop_layout';

describe('chapelTowerWorldCenter', () => {
  it('applies the rotated rear offset the real composed chapel applies', () => {
    // rot 0: the group-local +z offset stays on world +z
    const flat = chapelTowerWorldCenter({ x: 100, z: 50, rot: 0 });
    expect(flat.x).toBeCloseTo(100, 10);
    expect(flat.z).toBeCloseTo(50 + CHAPEL_TOWER.dz, 10);
  });

  it('rotates with the building yaw exactly like the group transform', () => {
    // a quarter turn maps local +z onto world +x under the rotLocal
    // convention the colliders and hideable footprints share
    const quarter = chapelTowerWorldCenter({ x: 0, z: 0, rot: Math.PI / 2 });
    expect(quarter.x).toBeCloseTo(CHAPEL_TOWER.dz, 10);
    expect(quarter.z).toBeCloseTo(0, 10);
    // and an arbitrary yaw keeps the offset length: the tower stays on the
    // dz circle around the building origin
    const any = chapelTowerWorldCenter({ x: 7, z: -3, rot: 2.31 });
    expect(Math.hypot(any.x - 7, any.z + 3)).toBeCloseTo(Math.abs(CHAPEL_TOWER.dz), 10);
  });

  it('is a REAL offset: ignoring it would misplace the sprite by the full dz', () => {
    // guards the regression class itself: a zero dz would make the helper
    // (and this suite) vacuous; the shipped 0.75u rear offset is what the
    // old raw-origin centering dropped at the handoff
    expect(Math.abs(CHAPEL_TOWER.dz)).toBeGreaterThan(0.5);
  });
});
