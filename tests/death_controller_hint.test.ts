import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deathControllerConfirmLabel,
  syncDeathControllerHints,
} from '../src/game/death_controller_hint';
import { GAMEPAD_CONFIRM, GP } from '../src/game/gamepad_map';

describe('death controller hint', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the connected controller family and live confirm remap', () => {
    expect(deathControllerConfirmLabel([{ button: GP.A, action: GAMEPAD_CONFIRM }], 'xbox')).toBe(
      'A',
    );
    expect(
      deathControllerConfirmLabel([{ button: GP.A, action: GAMEPAD_CONFIRM }], 'playstation'),
    ).toBe('Cross');
    expect(deathControllerConfirmLabel([{ button: GP.B, action: GAMEPAD_CONFIRM }], 'xbox')).toBe(
      'B',
    );
  });

  it('stays silent when confirm is unbound', () => {
    expect(deathControllerConfirmLabel([{ button: GP.A, action: 'jump' }], 'xbox')).toBeNull();
  });

  it('paints the live cap onto all three localized death buttons', () => {
    const attrs = new Map<string, string>();
    const button = {
      setAttribute: (name: string, value: string) => attrs.set(name, value),
      removeAttribute: (name: string) => attrs.delete(name),
    };
    vi.stubGlobal('document', { getElementById: () => button });

    syncDeathControllerHints({
      entries: () => [{ button: GP.A, action: GAMEPAD_CONFIRM }],
      kind: () => 'xbox',
    });
    expect(attrs.get('data-gamepad-confirm-label')).toBe('A');
  });
});
