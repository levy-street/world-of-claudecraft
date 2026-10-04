import { describe, expect, it } from 'vitest';
import { LOSS_FADE_TICKS, LOSS_OUTRO_TICKS } from '../src/sim/graveyard_shift/shift_end_marks';
import { TICK_RATE } from '../src/sim/types';
import { createMorthenFade, MORTHEN_FADE_IN_MS } from '../src/ui/hud/vehicle/morthen_fade_view';

const OUTRO_MS = (LOSS_OUTRO_TICKS / TICK_RATE) * 1000;
const FADE_MS = (LOSS_FADE_TICKS / TICK_RATE) * 1000;

describe('the lost shift fade', () => {
  it('stays clear with no defeat', () => {
    const fade = createMorthenFade();
    expect(fade.tick(0, false)).toBe(0);
    expect(fade.tick(10_000, false)).toBe(0);
  });

  it('holds clear through the scene, then darkens over its last stretch to full black', () => {
    const fade = createMorthenFade();
    const start = 5000;
    expect(fade.tick(start, true)).toBe(0);
    expect(fade.tick(start + OUTRO_MS - FADE_MS, true)).toBe(0);
    expect(fade.tick(start + OUTRO_MS - FADE_MS / 2, true)).toBeCloseTo(0.5);
    expect(fade.tick(start + OUTRO_MS, true)).toBe(1);
    expect(fade.tick(start + OUTRO_MS + 500, true)).toBe(1);
  });

  it('lifts over the fade-in once the defeat is gone, then rests clear', () => {
    const fade = createMorthenFade();
    fade.tick(0, true);
    fade.tick(OUTRO_MS, true);
    const lifted = OUTRO_MS + 100;
    expect(fade.tick(lifted, false)).toBe(1);
    expect(fade.tick(lifted + MORTHEN_FADE_IN_MS / 2, false)).toBeCloseTo(0.5);
    expect(fade.tick(lifted + MORTHEN_FADE_IN_MS, false)).toBe(0);
    expect(fade.tick(lifted + 10 * MORTHEN_FADE_IN_MS, false)).toBe(0);
  });

  it('a second defeat starts its own clock', () => {
    const fade = createMorthenFade();
    fade.tick(0, true);
    fade.tick(OUTRO_MS, false);
    fade.tick(OUTRO_MS + MORTHEN_FADE_IN_MS, false);
    const again = 100_000;
    expect(fade.tick(again, true)).toBe(0);
    expect(fade.tick(again + OUTRO_MS, true)).toBe(1);
  });
});
