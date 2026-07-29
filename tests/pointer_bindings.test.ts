import { describe, expect, it } from 'vitest';
import {
  isWheelBindingCode,
  mouseButtonBindingCode,
  wheelBindingCode,
} from '../src/game/pointer_bindings';

describe('pointer binding codes', () => {
  it('maps browser mouse buttons to the conventional MMO button numbers', () => {
    expect(mouseButtonBindingCode(0)).toBe('Mouse1');
    expect(mouseButtonBindingCode(1)).toBe('Mouse3');
    expect(mouseButtonBindingCode(2)).toBe('Mouse2');
    expect(mouseButtonBindingCode(3)).toBe('Mouse4');
    expect(mouseButtonBindingCode(4)).toBe('Mouse5');
  });

  it('rejects invalid mouse button values instead of persisting unusable codes', () => {
    expect(mouseButtonBindingCode(-1)).toBe(null);
    expect(mouseButtonBindingCode(1.5)).toBe(null);
    expect(mouseButtonBindingCode(Number.NaN)).toBe(null);
  });

  it('normalizes wheel movement to one code per direction', () => {
    expect(wheelBindingCode(-120)).toBe('WheelUp');
    expect(wheelBindingCode(120)).toBe('WheelDown');
    expect(wheelBindingCode(0)).toBe(null);
    expect(isWheelBindingCode('WheelUp')).toBe(true);
    expect(isWheelBindingCode('Shift+WheelDown')).toBe(true);
    expect(isWheelBindingCode('Mouse4')).toBe(false);
  });
});
