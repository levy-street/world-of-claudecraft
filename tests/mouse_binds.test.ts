import { describe, expect, it } from 'vitest';
import {
  bindableMouseCodeForButton,
  isMouseCode,
  isReservedMouseButton,
  isReservedMouseCode,
  mouseCodeForButton,
  mouseCodeLabel,
} from '../src/game/mouse_binds';

describe('mouse pseudo-key numbering', () => {
  it('maps DOM button indices to the classic player-facing numbering', () => {
    // Players say "mouse 4" for the thumb back button, which the DOM calls
    // button 3; the middle button is mouse 3, not mouse 2. Pinned to literals
    // because stored bindings are these exact strings.
    expect(mouseCodeForButton(0)).toBe('Mouse1'); // left
    expect(mouseCodeForButton(1)).toBe('Mouse3'); // middle / wheel
    expect(mouseCodeForButton(2)).toBe('Mouse2'); // right
    expect(mouseCodeForButton(3)).toBe('Mouse4'); // thumb back
    expect(mouseCodeForButton(4)).toBe('Mouse5'); // thumb forward
  });

  it('keeps numbering extra gaming-mouse buttons past the thumb pair', () => {
    expect(mouseCodeForButton(5)).toBe('Mouse6');
    expect(mouseCodeForButton(11)).toBe('Mouse12');
  });

  it('rejects indices that are not real buttons', () => {
    expect(mouseCodeForButton(-1)).toBeNull();
    expect(mouseCodeForButton(1.5)).toBeNull();
    expect(mouseCodeForButton(Number.NaN)).toBeNull();
  });
});

describe('reserved mouse buttons', () => {
  it('reserves left and right, which drive the camera and click-picking', () => {
    expect(isReservedMouseCode('Mouse1')).toBe(true);
    expect(isReservedMouseCode('Mouse2')).toBe(true);
    expect(isReservedMouseButton(0)).toBe(true);
    expect(isReservedMouseButton(2)).toBe(true);
  });

  it('leaves the middle and thumb buttons bindable', () => {
    for (const code of ['Mouse3', 'Mouse4', 'Mouse5', 'Mouse6']) {
      expect(isReservedMouseCode(code)).toBe(false);
    }
    expect(isReservedMouseButton(1)).toBe(false);
    expect(isReservedMouseButton(3)).toBe(false);
    expect(isReservedMouseButton(4)).toBe(false);
  });

  it('treats a nonsense index as unreserved so it cannot claim the camera path', () => {
    expect(isReservedMouseButton(-1)).toBe(false);
  });

  it('bindableMouseCodeForButton returns a code only for bindable buttons', () => {
    expect(bindableMouseCodeForButton(1)).toBe('Mouse3');
    expect(bindableMouseCodeForButton(3)).toBe('Mouse4');
    expect(bindableMouseCodeForButton(4)).toBe('Mouse5');
    expect(bindableMouseCodeForButton(0)).toBeNull();
    expect(bindableMouseCodeForButton(2)).toBeNull();
    expect(bindableMouseCodeForButton(-1)).toBeNull();
  });
});

describe('mouse code recognition and labels', () => {
  it('recognizes only real mouse pseudo-codes', () => {
    expect(isMouseCode('Mouse4')).toBe(true);
    expect(isMouseCode('Mouse12')).toBe(true);
    // A keyboard code that merely starts with the same letters is not one, and
    // neither is a zero/negative/empty index or a combo string.
    expect(isMouseCode('Mouser')).toBe(false);
    expect(isMouseCode('Mouse')).toBe(false);
    expect(isMouseCode('Mouse0')).toBe(false);
    expect(isMouseCode('Mouse-1')).toBe(false);
    expect(isMouseCode('Shift+Mouse4')).toBe(false); // a combo, not a bare code
    expect(isMouseCode('KeyM')).toBe(false);
  });

  it('labels a mouse code with the compact keycap glyph', () => {
    expect(mouseCodeLabel('Mouse3')).toBe('M3');
    expect(mouseCodeLabel('Mouse5')).toBe('M5');
    expect(mouseCodeLabel('Mouse12')).toBe('M12');
  });

  it('returns null for a keyboard code so the keyboard glyph table still runs', () => {
    expect(mouseCodeLabel('KeyW')).toBeNull();
    expect(mouseCodeLabel('Digit1')).toBeNull();
  });
});
