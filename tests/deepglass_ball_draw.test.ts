// The drawn Tidesow must be the sphere the physics uses.
//
// Regression guard for the "I fly straight through the ball" report. The view
// was forked from the Vale Cup boarball and kept two of its assumptions that
// are wrong here:
//
//   1. it fed the SIM radius straight into the geometry, while the renderer
//      scales the whole group by the mob template's entity scale (1.54), so the
//      ball was drawn 54% too wide;
//   2. it lifted every part by one radius, which is right for the boarball
//      (whose sim y rests on the ground) and wrong for the Tidesow (whose sim y
//      IS the free-floating centre), so the ball was drawn 1.85 yd too high.
//
// Together those drew a ball whose lower half was empty water and whose top cap
// could not be touched at any horizontal offset. The Vale Cup view derives its
// radius and never drifts; this test is the equivalent guard for the arena.

import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildTidesow } from '../src/render/deepglass_ball';
import { DEEPGLASS_BALL_MOB } from '../src/sim/deepglass/abilities';
import { DG_BALL_RADIUS } from '../src/sim/deepglass/ball';

/** World-space bounding sphere of a group placed at the origin and scaled the
 *  way the renderer scales an entity view. */
function worldRadius(group: THREE.Object3D, mesh: THREE.Mesh): number {
  group.scale.setScalar(DEEPGLASS_BALL_MOB.scale);
  group.updateMatrixWorld(true);
  mesh.geometry.computeBoundingSphere();
  const local = mesh.geometry.boundingSphere;
  if (!local) throw new Error('no bounding sphere');
  return local.radius * DEEPGLASS_BALL_MOB.scale;
}

describe('Tidesow draw geometry matches the physics ball', () => {
  it('draws the ball at exactly the sim radius once the entity scale is applied', () => {
    const built = buildTidesow();
    const shell = built.spinner as THREE.Mesh;
    expect(worldRadius(built.group, shell)).toBeCloseTo(DG_BALL_RADIUS, 5);
  });

  it('centres the ball on the entity origin (the arena ball floats, it does not rest)', () => {
    const built = buildTidesow();
    // Every part sits at the group origin: the sim y is the ball's centre, so
    // any lift here would draw the ball off its own physics position.
    expect(built.spinner.position.y).toBe(0);
    expect(built.group.userData.ballCentreLift).toBe(0);
  });

  it('reports a height of one full diameter, so nameplates and culling agree', () => {
    const built = buildTidesow();
    expect(built.height * DEEPGLASS_BALL_MOB.scale).toBeCloseTo(DG_BALL_RADIUS * 2, 5);
  });
});

// The aura's pace must be a REAL velocity, not a position delta measured
// between render frames.
//
// syncTidesow used to difference the ball entity's position across a frame and
// divide by DT, a frame delta over a 20 Hz tick step, which is only ever right
// when the two are equal. Above 20 fps most frames find pos === prevPos and
// report a stationary ball; below it, a whole run of ticks is divided by one
// tick's DT (measured 100x out: 1,114 yd/s drawn against 10.8 real). The first
// is what a player sees as the ball flashing in the bell, and this pins why.
describe('the Tidesow aura reads a true velocity', () => {
  /** The aura is the one child whose material carries the uSpeed uniform. */
  function auraOf(group: THREE.Object3D): THREE.Mesh {
    let found: THREE.Mesh | null = null;
    group.traverse((o) => {
      const mat = (o as THREE.Mesh).material as THREE.ShaderMaterial | undefined;
      if (mat?.uniforms?.uSpeed) found = o as THREE.Mesh;
    });
    if (!found) throw new Error('no aura mesh on the Tidesow');
    return found;
  }

  const litOf = (aura: THREE.Mesh): number =>
    (aura.material as THREE.ShaderMaterial).uniforms.uSpeed.value as number;

  /** Drive `frames` at 60 fps, returning the lit level each frame and how many
   *  times the aura switched on or off along the way. */
  function run(
    view: ReturnType<typeof buildTidesow>,
    aura: THREE.Mesh,
    frames: number,
    speedAt: (frame: number) => number,
  ): { lit: number[]; flips: number } {
    const lit: number[] = [];
    let flips = 0;
    let prev = aura.visible;
    for (let f = 0; f < frames; f++) {
      view.update(speedAt(f), 1 / 60);
      if (aura.visible !== prev) flips++;
      prev = aura.visible;
      lit.push(litOf(aura));
    }
    return { lit, flips };
  }

  // A ball drifting across the bell: fast enough to be lit, slow enough that
  // the aura sits near its idle cut, which is exactly where the strobe shows.
  const DRIFT = 6;

  it('holds a steady drifting ball lit, with no flicker', () => {
    const view = buildTidesow();
    const aura = auraOf(view.group);
    run(view, aura, 60, () => DRIFT); // settle
    const { lit, flips } = run(view, aura, 120, () => DRIFT);
    expect(flips).toBe(0);
    expect(aura.visible).toBe(true);
    expect(Math.max(...lit) - Math.min(...lit)).toBeLessThan(0.005);
    view.dispose();
  });

  it('strobes when fed a per-frame delta instead: the shape of the old bug', () => {
    // The same ball at the same pace, reported as moving on one frame in three
    // (60 fps against a 20 Hz tick) and stationary on the other two.
    const view = buildTidesow();
    const aura = auraOf(view.group);
    const perFrameDelta = (f: number) => (f % 3 === 0 ? DRIFT : 0);
    run(view, aura, 60, perFrameDelta); // settle
    const { lit, flips } = run(view, aura, 120, perFrameDelta);
    // The aura switches off and on again repeatedly...
    expect(flips).toBeGreaterThan(4);
    // ...and even when lit it reads as a far slower ball than it is.
    const steady = buildTidesow();
    const steadyAura = auraOf(steady.group);
    run(steady, steadyAura, 60, () => DRIFT);
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    expect(mean(lit)).toBeLessThan(mean(run(steady, steadyAura, 120, () => DRIFT).lit) / 2);
    view.dispose();
    steady.dispose();
  });
});
