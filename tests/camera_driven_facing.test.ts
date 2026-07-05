import { describe, expect, it } from 'vitest';
import { isCameraDrivenFacingActive } from '../src/game/camera_driven_facing';
import { mouselookReleaseFacing } from '../src/game/mouselook_release';

// Bug: main.ts only fed classic right-mouse mouselook into mouselookReleaseFacing's
// falling-edge tracker. Mouse Camera mode ALSO hands the camera ownership of the
// player's heading, while a movement key drives the character (see
// renderFacingOverride in main.ts) - but its release never committed the final
// camera yaw, so the same "final slice of motion since the last tick is dropped"
// bug #1053 fixed for mouselook reappears the moment a Mouse Camera mode move key
// is released: the character settles a fraction of a turn behind the camera and
// the follow camera then backtracks onto that stale facing.
describe('isCameraDrivenFacingActive', () => {
  it('is active under classic right-mouse mouselook', () => {
    expect(isCameraDrivenFacingActive(false, false, true, false)).toBe(true);
  });

  it('is active under Mouse Camera mode while a movement key drives the character', () => {
    expect(isCameraDrivenFacingActive(true, true, false, false)).toBe(true);
  });

  it('is inactive under Mouse Camera mode with no movement key held', () => {
    expect(isCameraDrivenFacingActive(true, false, false, false)).toBe(false);
  });

  it('mouselook is ignored while Mouse Camera mode owns the override', () => {
    expect(isCameraDrivenFacingActive(true, false, true, false)).toBe(false);
  });

  it('is inactive while dead, regardless of mode', () => {
    expect(isCameraDrivenFacingActive(false, false, true, true)).toBe(false);
    expect(isCameraDrivenFacingActive(true, true, false, true)).toBe(false);
  });
});

describe('mouselookReleaseFacing driven by isCameraDrivenFacingActive (regression)', () => {
  it('commits the final camera yaw when a Mouse Camera mode move key is released', () => {
    const camYaw = 1.9;
    const prevActive = isCameraDrivenFacingActive(true, true, false, false); // W held
    const nowActive = isCameraDrivenFacingActive(true, false, false, false); // W released
    expect(mouselookReleaseFacing(prevActive, nowActive, camYaw)).toBe(camYaw);
  });

  it('does not commit while the Mouse Camera mode move key stays held', () => {
    const camYaw = 1.9;
    const prevActive = isCameraDrivenFacingActive(true, true, false, false);
    const nowActive = isCameraDrivenFacingActive(true, true, false, false);
    expect(mouselookReleaseFacing(prevActive, nowActive, camYaw)).toBeNull();
  });
});
