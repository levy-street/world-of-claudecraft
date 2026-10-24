import { describe, expect, it } from 'vitest';
import {
  createSpriteFlameState,
  goldFlameGreen,
  SPRITE_FLAME_MAX_LEAN,
  SPRITE_FLAME_MAX_STRETCH,
  SPRITE_SHELL_HIDE,
  SPRITE_SHELL_SHOW,
  spriteMergeDepth,
  stepSpriteFlame,
  tealFlameFade,
} from '../src/render/sprites_buddy_flame_core';

/** Move an orb at a constant velocity for `seconds` at 60 fps. */
function travel(
  vx: number,
  vy: number,
  vz: number,
  seconds: number,
  state = createSpriteFlameState(),
) {
  const dt = 1 / 60;
  let x = 0;
  let y = 0;
  let z = 0;
  stepSpriteFlame(state, x, y, z, dt);
  for (let t = 0; t < seconds; t += dt) {
    x += vx * dt;
    y += vy * dt;
    z += vz * dt;
    stepSpriteFlame(state, x, y, z, dt);
  }
  return state;
}

describe('sprite buddy flame motion', () => {
  it('stands upright at rest', () => {
    const s = travel(0, 0, 0, 2);
    expect(s.leanX).toBeCloseTo(0, 6);
    expect(s.leanZ).toBeCloseTo(0, 6);
    expect(s.stretch).toBeCloseTo(1, 6);
  });

  it('leans away from the direction of travel and stretches with speed', () => {
    const s = travel(3, 0, 0, 2);
    expect(s.leanX).toBeLessThan(-0.2);
    expect(Math.abs(s.leanZ)).toBeLessThan(1e-6);
    expect(s.stretch).toBeGreaterThan(1.04);
  });

  it('caps the lean and the stretch however fast it goes', () => {
    const s = travel(0, 0, -30, 2);
    expect(s.leanZ).toBeGreaterThan(0);
    // The cap is on the spring's target; the spring itself may only overshoot
    // it by a hair once it has settled.
    expect(Math.hypot(s.leanX, s.leanZ)).toBeCloseTo(SPRITE_FLAME_MAX_LEAN, 3);
    expect(s.stretch).toBeLessThanOrEqual(1 + SPRITE_FLAME_MAX_STRETCH + 1e-6);
  });

  it('only stretches, never tips, for vertical motion', () => {
    const s = travel(0, 5, 0, 1);
    expect(s.leanX).toBe(0);
    expect(s.leanZ).toBe(0);
    expect(s.stretch).toBeGreaterThan(1.08);
  });

  it('overshoots upright when the buddy stops, then settles', () => {
    const s = travel(4, 0, 0, 2);
    let peak = 0;
    const dt = 1 / 60;
    for (let t = 0; t < 3; t += dt) {
      stepSpriteFlame(s, s.prevX, 0, 0, dt);
      peak = Math.max(peak, s.leanX);
    }
    expect(peak).toBeGreaterThan(0.005); // swung past upright the other way
    expect(Math.abs(s.leanX)).toBeLessThan(1e-3);
  });

  it('treats a teleport as a reset, not a whip', () => {
    const s = travel(3, 0, 0, 1);
    stepSpriteFlame(s, 500, 0, 0, 1 / 60);
    expect(s.leanX).toBe(0);
    expect(s.stretch).toBe(1);
  });

  it('survives a long frame without blowing up', () => {
    const s = createSpriteFlameState();
    stepSpriteFlame(s, 0, 0, 0, 0.016);
    stepSpriteFlame(s, 1, 0, 0, 0.5);
    expect(Number.isFinite(s.leanX)).toBe(true);
    expect(Math.abs(s.leanX)).toBeLessThanOrEqual(SPRITE_FLAME_MAX_LEAN * 2);
  });
});

describe('sprite buddy flame colour', () => {
  it('measures how deep teal sits in gold', () => {
    expect(spriteMergeDepth(0, 0, 0, 1, 2, 0, 0, 1)).toBeCloseTo(0);
    expect(spriteMergeDepth(0, 0, 0, 1, 0, 0, 0, 1)).toBeCloseTo(1);
    expect(spriteMergeDepth(0, 0, 0, 1, 3, 0, 0, 1)).toBeLessThan(0);
  });

  it('fades teal out as it sinks in and back as it leaves', () => {
    expect(tealFlameFade(-0.5)).toBe(1);
    expect(tealFlameFade(0.3)).toBe(1);
    expect(tealFlameFade(0.65)).toBeGreaterThan(0);
    expect(tealFlameFade(0.65)).toBeLessThan(1);
    expect(tealFlameFade(1)).toBe(0);
  });

  it('turns gold green with the green shell ring', () => {
    expect(goldFlameGreen(1)).toBe(0);
    expect(goldFlameGreen(SPRITE_SHELL_SHOW / SPRITE_SHELL_HIDE)).toBe(1);
    const mid = goldFlameGreen((1 + SPRITE_SHELL_SHOW / SPRITE_SHELL_HIDE) / 2);
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.6);
  });
});
