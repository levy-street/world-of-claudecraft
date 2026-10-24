// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMouseCameraSetting } from '../src/game/mouse_camera_settings';
import { Settings } from '../src/game/settings';

beforeEach(() => localStorage.clear());

describe('mouse camera settings seam', () => {
  it('applies the persisted value at boot and live changes to only the owning input setter', () => {
    const settings = new Settings();
    const input = {
      setMouseCameraEnabled: vi.fn(),
      setLockCursorOnRotate: vi.fn(),
      setRawMouseInput: vi.fn(),
    };
    const rows = [
      ['mouseCamera', input.setMouseCameraEnabled],
      ['lockCursorOnRotate', input.setLockCursorOnRotate],
      ['rawMouseInput', input.setRawMouseInput],
    ] as const;
    for (const [key, setter] of rows) {
      for (const value of [false, true]) {
        vi.clearAllMocks();
        expect(applyMouseCameraSetting(settings, input, key, value)).toBe(true);
        expect(setter).toHaveBeenCalledExactlyOnceWith(value);
        for (const [other, otherSetter] of rows) {
          if (other !== key) expect(otherSetter).not.toHaveBeenCalled();
        }
        const reloaded = new Settings();
        expect(reloaded.get(key)).toBe(value);
        setter.mockClear();
        expect(applyMouseCameraSetting(reloaded, input, key, reloaded.get(key))).toBe(true);
        expect(setter).toHaveBeenCalledExactlyOnceWith(value);
      }
    }
    vi.clearAllMocks();
    expect(applyMouseCameraSetting(settings, input, 'music', true)).toBe(false);
    for (const [, setter] of rows) expect(setter).not.toHaveBeenCalled();
  });
});
