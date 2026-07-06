import { describe, expect, it } from 'vitest';
import { GAMEPAD_NONE, GP } from '../src/game/gamepad_map';
import { controllerGuideModel } from '../src/ui/controller_guide_view';

// Deterministic stub deps: glyph echoes the button index + brand, actionLabel
// upper-cases the id, so the test asserts wiring/order without a real controller.
const deps = {
  glyph: (button: number, kind: string) => `${kind}#${button}`,
  actionLabel: (id: string) => id.toUpperCase(),
};

describe('controllerGuideModel', () => {
  it('maps each bound button to a {glyph, action} row in entry order', () => {
    const entries = [
      { button: GP.A, action: 'jump' },
      { button: GP.B, action: 'interact' },
      { button: GP.X, action: 'slot0' },
    ];
    const model = controllerGuideModel(entries, 'xbox', deps);
    expect(model.buttons).toEqual([
      { glyph: 'xbox#0', action: 'JUMP' },
      { glyph: 'xbox#1', action: 'INTERACT' },
      { glyph: 'xbox#2', action: 'SLOT0' },
    ]);
  });

  it('skips unbound buttons (GAMEPAD_NONE or empty), keeping the rest in order', () => {
    const entries = [
      { button: GP.A, action: 'jump' },
      { button: GP.B, action: GAMEPAD_NONE },
      { button: GP.X, action: '' },
      { button: GP.Y, action: 'target' },
    ];
    const model = controllerGuideModel(entries, 'nintendo', deps);
    expect(model.buttons).toEqual([
      { glyph: 'nintendo#0', action: 'JUMP' },
      { glyph: 'nintendo#3', action: 'TARGET' },
    ]);
  });

  it('passes the detected brand through to the glyph resolver', () => {
    const model = controllerGuideModel([{ button: GP.A, action: 'jump' }], 'playstation', deps);
    expect(model.buttons[0].glyph).toBe('playstation#0');
  });

  it('returns an empty list when nothing is bound', () => {
    const entries = [{ button: GP.A, action: GAMEPAD_NONE }];
    expect(controllerGuideModel(entries, 'generic', deps).buttons).toEqual([]);
  });
});
