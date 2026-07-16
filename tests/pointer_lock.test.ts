import { describe, expect, it } from 'vitest';
import {
  pointerLockNeedsSyncGesture,
  shouldEngagePointerLock,
  shouldEngagePointerLockOnMouseDown,
  shouldReleasePointerLock,
} from '../src/game/pointer_lock';

describe('shouldEngagePointerLock', () => {
  it('engages when a drag starts, the setting is on, not fullscreen, not yet locked', () => {
    expect(
      shouldEngagePointerLock({ lockOnRotate: true, isFullscreen: false, alreadyLocked: false }),
    ).toBe(true);
  });

  it('engages regardless of camera mode (the function takes no mode: both classic and Mouse Camera reach here)', () => {
    // Regression for the reported bug: in Mouse Camera mode the lock was never
    // requested, so the cursor escaped to the screen edge / second monitor.
    // The decision must not depend on the mode at all.
    expect(
      shouldEngagePointerLock({ lockOnRotate: true, isFullscreen: false, alreadyLocked: false }),
    ).toBe(true);
  });

  it('does not engage when the setting is off', () => {
    expect(
      shouldEngagePointerLock({ lockOnRotate: false, isFullscreen: false, alreadyLocked: false }),
    ).toBe(false);
  });

  it('engages in fullscreen so mouselook still gets relative mouse deltas', () => {
    expect(
      shouldEngagePointerLock({ lockOnRotate: true, isFullscreen: true, alreadyLocked: false }),
    ).toBe(true);
  });

  it('does not re-engage when already locked (avoids re-showing the browser banner mid-drag)', () => {
    expect(
      shouldEngagePointerLock({ lockOnRotate: true, isFullscreen: false, alreadyLocked: true }),
    ).toBe(false);
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

describe('pointerLockNeedsSyncGesture', () => {
  it('is true on Firefox user agents', () => {
    expect(
      pointerLockNeedsSyncGesture(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
      ),
    ).toBe(true);
  });

  it('is false on Chromium user agents (deferred mousemove request works there)', () => {
    expect(
      pointerLockNeedsSyncGesture(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      ),
    ).toBe(false);
  });

  it('is false on Safari user agents', () => {
    expect(
      pointerLockNeedsSyncGesture(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      ),
    ).toBe(false);
  });
});

describe('shouldEngagePointerLockOnMouseDown', () => {
  const base = {
    button: 2,
    clickMoveButton: null as 0 | 2 | null,
    needsSyncGesture: true,
    lockOnRotate: true,
    alreadyLocked: false,
  };

  it('engages synchronously on mousedown for the right button when the browser needs it', () => {
    expect(shouldEngagePointerLockOnMouseDown(base)).toBe(true);
  });

  it('engages synchronously on mousedown for the left button too (blocking regression: both drag buttons must sync, not just the active camera mode look button)', () => {
    // Camera drag can start on EITHER left or right in either camera mode
    // (input.ts's onMouseMove gates on leftDown || rightDown, not one
    // button), so classic left-drag orbit and Mouse Camera right-drag both
    // need the synchronous Firefox request, not just the mode's nominal
    // "look" button.
    expect(shouldEngagePointerLockOnMouseDown({ ...base, button: 0 })).toBe(true);
  });

  it('does not engage when the browser does not need a synchronous gesture (Chromium keeps the deferred path)', () => {
    expect(shouldEngagePointerLockOnMouseDown({ ...base, needsSyncGesture: false })).toBe(false);
  });

  it('does not engage for the click-to-move button', () => {
    // Regression (#116 on Firefox): syncing on every mousedown of the
    // click-to-move button would fire the lock on every ordinary click, not
    // just camera drags.
    expect(shouldEngagePointerLockOnMouseDown({ ...base, button: 0, clickMoveButton: 0 })).toBe(
      false,
    );
  });

  it('still engages for the OTHER button when a click-to-move button is bound', () => {
    expect(shouldEngagePointerLockOnMouseDown({ ...base, button: 2, clickMoveButton: 0 })).toBe(
      true,
    );
  });

  it('does not engage for a non-drag button (e.g. middle-click)', () => {
    expect(shouldEngagePointerLockOnMouseDown({ ...base, button: 1 })).toBe(false);
  });

  it('does not engage when the setting is off', () => {
    expect(shouldEngagePointerLockOnMouseDown({ ...base, lockOnRotate: false })).toBe(false);
  });

  it('does not re-engage when already locked', () => {
    expect(shouldEngagePointerLockOnMouseDown({ ...base, alreadyLocked: true })).toBe(false);
  });
});
