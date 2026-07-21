// Vale Cup render pure-math pins: the nation flag palette resolve (render
// flags, HUD tints, and firework colors all derive from it) and the boarball's
// client-side roll axis math. Both are DOM-free by design; the canvas-painting
// and Three-side halves are exercised by the browser screenshot scripts.
import { describe, expect, it } from 'vitest';
import { BALL_RADIUS, ballRollAxisAngle } from '../src/render/vale_cup_ball';
import { flagPalette, nationColors } from '../src/render/vale_cup_flags';
import { VC_NATIONS } from '../src/sim/content/vale_cup';

describe('vale cup flag palette', () => {
  it('resolves every declared nation to its own colors + emblem, deterministically', () => {
    for (const n of VC_NATIONS) {
      const home = flagPalette(n.id);
      expect(home.field).toBe(n.primary);
      expect(home.accent).toBe(n.secondary);
      expect(home.emblem).toBe(n.emblem);
      // same input, same output (texture cache keys rely on this)
      expect(flagPalette(n.id)).toEqual(home);
    }
  });

  it('the away palette is the exact home inversion (mirror-match rule)', () => {
    for (const n of VC_NATIONS) {
      const away = flagPalette(n.id, true);
      expect(away.field).toBe(n.secondary);
      expect(away.accent).toBe(n.primary);
      expect(away.emblem).toBe(n.emblem);
    }
  });

  it('an unknown nation id falls back to the first nation instead of crashing', () => {
    expect(flagPalette('not_a_nation').field).toBe(VC_NATIONS[0].primary);
  });

  it('nationColors feeds the goal fireworks the same pair the flag flies', () => {
    const p = flagPalette('coliseum');
    expect(nationColors('coliseum')).toEqual([p.field, p.accent]);
    const a = flagPalette('coliseum', true);
    expect(nationColors('coliseum', true)).toEqual([a.field, a.accent]);
  });
});

describe('boarball roll axis math', () => {
  // Rolling without slipping: axis = up x velocity, angle = distance / radius.
  it('rolling east (+x) spins about -z; rolling north (+z) spins about +x', () => {
    const east = ballRollAxisAngle(1, 0, BALL_RADIUS);
    expect(east.ax).toBeCloseTo(0);
    expect(east.az).toBeCloseTo(-1);
    expect(east.angle).toBeCloseTo(1 / BALL_RADIUS);

    const north = ballRollAxisAngle(0, 1, BALL_RADIUS);
    expect(north.ax).toBeCloseTo(1);
    expect(north.az).toBeCloseTo(0);
    expect(north.angle).toBeCloseTo(1 / BALL_RADIUS);
  });

  it('axis is always unit length and lies in the ground plane', () => {
    for (const [dx, dz] of [
      [0.3, -0.7],
      [-1.2, 0.4],
      [0.01, 0.01],
    ]) {
      const r = ballRollAxisAngle(dx, dz, BALL_RADIUS);
      expect(Math.hypot(r.ax, r.ay, r.az)).toBeCloseTo(1);
      expect(r.ay).toBe(0);
      expect(r.angle).toBeCloseTo(Math.hypot(dx, dz) / BALL_RADIUS);
    }
  });

  it('sub-epsilon motion and a degenerate radius produce a zero-angle no-op', () => {
    expect(ballRollAxisAngle(0, 0, BALL_RADIUS).angle).toBe(0);
    expect(ballRollAxisAngle(1e-7, 0, BALL_RADIUS).angle).toBe(0);
    expect(ballRollAxisAngle(1, 0, 0).angle).toBe(0);
  });

  it('writes into the caller-owned out-param (allocation-light hot path)', () => {
    const out = { ax: 0, ay: 0, az: 0, angle: 0 };
    const ret = ballRollAxisAngle(2, 0, 1, out);
    expect(ret).toBe(out);
    expect(out.angle).toBeCloseTo(2);
  });
});
