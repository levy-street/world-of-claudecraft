// The target reticle is a decal on the ground under the unit. Under a unit on
// the wing (the Hollow Crypt's Ossuary Drake flies its loop 22 yd up) it marked
// a spot on the floor where nothing stood, and read as a body a warrior could
// Charge. It hides until the unit comes down.

import { describe, expect, it } from 'vitest';
import {
  reticleGrounded,
  reticleShownUnder,
  SELECTION_RING_AIRBORNE,
} from '../src/render/selection_ring';
import { HOLLOW_CRYPT_SPAWNS } from '../src/sim/content/hollow_crypt';
import { FLIER_OUT_OF_REACH } from '../src/sim/mob/patrol';

describe('selection reticle under an airborne unit', () => {
  it('stays on the ground under a standing or jumping unit', () => {
    expect(reticleGrounded(10, 10)).toBe(true);
    expect(reticleGrounded(10.4, 10)).toBe(true);
    // A jump or a knock-up: the classic grounded decal.
    expect(reticleGrounded(13, 10)).toBe(true);
    expect(reticleGrounded(10 + SELECTION_RING_AIRBORNE, 10)).toBe(true);
    // Standing in a dip under the sampled ground never hides it.
    expect(reticleGrounded(9, 10)).toBe(true);
  });

  it('is not drawn under a unit on the wing', () => {
    expect(reticleGrounded(10 + SELECTION_RING_AIRBORNE + 0.01, 10)).toBe(false);
    // Every flying patrol of the Hollow Crypt flies well over the cut.
    const fliers = HOLLOW_CRYPT_SPAWNS.filter((s) => s.patrol?.altitude !== undefined);
    expect(fliers.map((s) => s.mobId)).toContain('crypt_ossuary_drake');
    for (const s of fliers) {
      const altitude = s.patrol?.altitude ?? 0;
      expect(altitude, s.mobId).toBeGreaterThan(SELECTION_RING_AIRBORNE + 2);
      expect(reticleGrounded(altitude, 0), s.mobId).toBe(false);
    }
  });

  it('shows again before the unit is low enough to be hit', () => {
    // The sim makes a flier a target at FLIER_OUT_OF_REACH over the floor; the
    // reticle is already back by then, so a hittable unit always has its ring.
    expect(SELECTION_RING_AIRBORNE).toBeGreaterThanOrEqual(FLIER_OUT_OF_REACH);
    expect(reticleGrounded(FLIER_OUT_OF_REACH, 0)).toBe(true);
  });
});

describe('reticleShownUnder (the renderer call)', () => {
  it('reads the unit view and the reticle heights', () => {
    const reticle = { position: { y: 4 } };
    expect(reticleShownUnder({ position: { y: 4 } }, reticle)).toBe(true);
    expect(reticleShownUnder({ position: { y: 26 } }, reticle)).toBe(false);
  });
});
