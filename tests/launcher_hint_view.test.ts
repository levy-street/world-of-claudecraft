import { describe, expect, it } from 'vitest';
import { launcherHintView } from '../src/game/gamepad_launcher_hint_view';
import { GAMEPAD_CYCLE_HUD, GP } from '../src/game/gamepad_map';

describe('launcherHintView', () => {
  it('resolves remapped controller-kind labels from the binding snapshot', () => {
    expect(launcherHintView([{ button: GP.L3, action: GAMEPAD_CYCLE_HUD }], 'nintendo')).toEqual({
      buttonLabel: 'L Stick',
    });
  });

  it('returns null when Cycle Interface has no binding', () => {
    expect(launcherHintView([{ button: GP.R3, action: 'none' }], 'xbox')).toBeNull();
  });
});
