import { describe, it, expect } from 'vitest';
import { shouldEngagePointerLock, shouldReleasePointerLock } from '../src/game/pointer_lock';

describe('shouldEngagePointerLock', () => {
  it('engages when a drag starts, the setting is on, not fullscreen, not yet locked', () => {
    expect(shouldEngagePointerLock({ lockOnRotate: true, isFullscreen: false, alreadyLocked: false })).toBe(true);
  });

  it('engages regardless of camera mode (the function takes no mode: both classic and Mouse Camera reach here)', () => {
    // Regression for the reported bug: in Mouse Camera mode the lock was never
    // requested, so the cursor escaped to the screen edge / second monitor.
    // The decision must not depend on the mode at all.
    expect(shouldEngagePointerLock({ lockOnRotate: true, isFullscreen: false, alreadyLocked: false })).toBe(true);
  });

  it('does not engage when the setting is off', () => {
    expect(shouldEngagePointerLock({ lockOnRotate: false, isFullscreen: false, alreadyLocked: false })).toBe(false);
  });

  it('does not engage in fullscreen (Chrome shows its own unavoidable prompt)', () => {
    expect(shouldEngagePointerLock({ lockOnRotate: true, isFullscreen: true, alreadyLocked: false })).toBe(false);
  });

  it('does not re-engage when already locked (avoids re-showing the browser banner mid-drag)', () => {
    expect(shouldEngagePointerLock({ lockOnRotate: true, isFullscreen: false, alreadyLocked: true })).toBe(false);
  });
});

describe('shouldReleasePointerLock', () => {
  it('releases when no button is held and a lock is active', () => {
    expect(shouldReleasePointerLock({ anyButtonDown: false, hasLock: true })).toBe(true);
  });

  it('keeps the lock while a camera button is still held (so a continuous drag never escapes)', () => {
    expect(shouldReleasePointerLock({ anyButtonDown: true, hasLock: true })).toBe(false);
  });

  it('does nothing when there is no lock to release', () => {
    expect(shouldReleasePointerLock({ anyButtonDown: false, hasLock: false })).toBe(false);
  });
});
