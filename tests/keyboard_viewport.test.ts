import { describe, expect, it } from 'vitest';
import { keyboardViewportState } from '../src/game/keyboard_viewport';

describe('keyboardViewportState', () => {
  it('reports closed when the visual viewport matches the window height', () => {
    const state = keyboardViewportState(390, 390);
    expect(state.open).toBe(false);
    expect(state.visibleHeight).toBe(390);
  });

  it('reports open once the visual viewport shrinks well below the window height', () => {
    const state = keyboardViewportState(390, 200);
    expect(state.open).toBe(true);
    expect(state.visibleHeight).toBe(200);
  });

  it('is not fooled by a small dynamic-toolbar shrink', () => {
    const state = keyboardViewportState(390, 370);
    expect(state.open).toBe(false);
  });

  it('rounds the visible height and floors it at 1', () => {
    expect(keyboardViewportState(390, 199.6).visibleHeight).toBe(200);
    expect(keyboardViewportState(0, 0).visibleHeight).toBe(1);
    expect(keyboardViewportState(0, 0).open).toBe(false);
  });
});
