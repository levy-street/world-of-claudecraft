import { describe, expect, it } from 'vitest';
import { shouldUseGamepadPointerMode } from '../src/game/gamepad_pointer_mode';

describe('gamepad pointer mode', () => {
  it('opens for the standalone race control as well as windows and prompts', () => {
    expect(shouldUseGamepadPointerMode(false, false, false)).toBe(false);
    expect(shouldUseGamepadPointerMode(true, false, false)).toBe(true);
    expect(shouldUseGamepadPointerMode(false, true, false)).toBe(true);
    expect(shouldUseGamepadPointerMode(false, false, true)).toBe(true);
  });
});
