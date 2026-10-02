// The on-model ward cues' viewer-side decision (src/render/eye_ward_marker_drive.ts).
//
// One claim the core tests cannot see: the STATE badge over the boss's head says "his ward
// is down, your damage lands" to the whole raid, and a boss in bed (mob/slumber.ts) is
// neutral and unattackable, so over a sleeper that badge is a lie everyone can see. The
// drive is where the entity's sleep bit meets the ward state, so the gate is pinned here.
import { describe, expect, it } from 'vitest';
import { eyeWardPlanFor } from '../src/render/eye_ward_marker_drive';

const viewer = { x: 0, z: 0 };
const nobody = { equipment: { mainhand: null }, lanceGuidance: null };

describe('eyeWardPlanFor', () => {
  it('plans a state badge for an awake warded boss', () => {
    const plan = eyeWardPlanFor(nobody, viewer, {
      auras: [{ id: 'eye_ward' }],
      pos: { x: 5, z: 0 },
    });
    expect(plan).not.toBeNull();
  });

  it('plans nothing for a boss in bed, whatever his ward says', () => {
    for (const auras of [
      [{ id: 'eye_ward' }],
      [{ id: 'eye_ward_blinded' }],
      [{ id: 'eye_ward' }, { id: 'slumber' }],
    ]) {
      expect(
        eyeWardPlanFor(nobody, viewer, { auras, pos: { x: 5, z: 0 }, asleep: true }),
      ).toBeNull();
    }
    // And an explicit false is the awake case, not a third state.
    expect(
      eyeWardPlanFor(nobody, viewer, {
        auras: [{ id: 'eye_ward' }],
        pos: { x: 5, z: 0 },
        asleep: false,
      }),
    ).not.toBeNull();
  });

  it('plans nothing for a mob with no ward at all', () => {
    expect(eyeWardPlanFor(nobody, viewer, { auras: [], pos: { x: 5, z: 0 } })).toBeNull();
  });
});
