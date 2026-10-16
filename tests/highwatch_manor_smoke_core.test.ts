import { describe, expect, it } from 'vitest';
import {
  MANOR_SMOKE_PUFFS,
  MANOR_SMOKE_SOURCES,
  type ManorSmokePuff,
  manorSmokePuffInto,
} from '../src/render/highwatch_manor_smoke_core';

const fresh = (): ManorSmokePuff => ({ x: 0, y: 0, z: 0, size: 0, alpha: 0 });

describe('the Highwatch manor chimney smoke core', () => {
  it('streams two plumes from the kitchen chimney pots, every puff over the pots', () => {
    expect(MANOR_SMOKE_SOURCES).toHaveLength(2);
    expect(MANOR_SMOKE_PUFFS).toBe(MANOR_SMOKE_SOURCES.reduce((n, s) => n + s.puffs, 0));
    // the pots stand on the kitchen chimney (manor_shell.py chimney(): x 20.3, z 15.9)
    for (const src of MANOR_SMOKE_SOURCES) {
      expect(Math.abs(src.x - 20.3)).toBeLessThan(1);
      expect(src.z).toBeCloseTo(15.9, 5);
      expect(src.y).toBeGreaterThan(16);
    }
    const out = fresh();
    for (let t = 0; t < 30; t += 0.37) {
      for (let i = 0; i < MANOR_SMOKE_PUFFS; i++) {
        manorSmokePuffInto(i, t, out);
        expect(out.y).toBeGreaterThanOrEqual(16.4 - 1e-9);
        expect(out.alpha).toBeGreaterThanOrEqual(0);
        expect(out.alpha).toBeLessThanOrEqual(1);
        expect(out.size).toBeGreaterThan(0.5);
      }
    }
  });

  it('is deterministic, and a puff rises, grows and thins over its life', () => {
    const a = manorSmokePuffInto(3, 12.5, fresh());
    const b = manorSmokePuffInto(3, 12.5, fresh());
    expect(a).toEqual(b);
    const src = MANOR_SMOKE_SOURCES[0];
    // puff 0 is born at t = 0: watch it through one life
    const early = manorSmokePuffInto(0, src.life * 0.15, fresh());
    const late = manorSmokePuffInto(0, src.life * 0.9, fresh());
    expect(late.y).toBeGreaterThan(early.y + 3);
    expect(late.size).toBeGreaterThan(early.size);
    expect(late.alpha).toBeLessThan(early.alpha);
  });
});
