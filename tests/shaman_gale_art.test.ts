import { describe, expect, it, vi } from 'vitest';
import { paintShamanGale } from '../src/render/ability_vfx/shaman_gale_art';

type Call = { method: string; args: unknown[] };
function paint(time: number) {
  const calls: Call[] = [];
  let depth = 0;
  const g = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === 'save')
          return () => {
            depth++;
          };
        if (property === 'restore')
          return () => {
            depth--;
            expect(depth).toBeGreaterThanOrEqual(0);
          };
        if (property === 'createLinearGradient')
          return (...args: unknown[]) => {
            calls.push({ method: 'gradient', args });
            return {
              addColorStop: (...args: unknown[]) => calls.push({ method: 'colorStop', args }),
            };
          };
        return (...args: unknown[]) => calls.push({ method: String(property), args });
      },
      set(_target, property, value) {
        calls.push({
          method: String(property),
          args: [typeof value === 'object' ? 'gradient' : value],
        });
        return true;
      },
    },
  ) as CanvasRenderingContext2D;
  paintShamanGale(g, time);
  expect(depth).toBe(0);
  return calls;
}

describe('Shaman gale shear atlas', () => {
  it('keeps all 64 cels finite inside the padded atlas and completely clears the last cel', () => {
    for (let frame = 0; frame < 64; frame++) {
      const calls = paint(frame / 63);
      for (const call of calls) {
        for (const value of call.args) {
          if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
          if (typeof value === 'string') expect(value).not.toMatch(/NaN|Infinity/);
        }
        if (call.method === 'moveTo' || call.method === 'lineTo')
          for (const value of call.args) expect(Math.abs(Number(value))).toBeLessThanOrEqual(60);
      }
      if (frame === 63) expect(calls).toEqual([]);
    }
  });
  it('shows the cutting edge immediately, without circles or ambient randomness', () => {
    const random = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('ambient RNG');
    });
    try {
      const first = paint(0);
      expect(first).toEqual(paint(0));
      expect(first.some((c) => c.method === 'stroke')).toBe(true);
      expect(first.some((c) => c.method === 'lineWidth' && Number(c.args[0]) >= 1.4)).toBe(true);
      expect(first.some((c) => c.method === 'arc' || c.method === 'ellipse')).toBe(false);
    } finally {
      random.mockRestore();
    }
  });
  it('moves corresponding pieces continuously through adjacent middle cels', () => {
    const positions = (t: number) =>
      paint(t).filter((c) => c.method === 'lineTo' || c.method === 'moveTo');
    const before = positions(25 / 63),
      after = positions(26 / 63);
    expect(before.map((c) => c.method)).toEqual(after.map((c) => c.method));
    for (let i = 0; i < before.length; i++)
      for (let axis = 0; axis < 2; axis++)
        expect(Math.abs(Number(before[i].args[axis]) - Number(after[i].args[axis]))).toBeLessThan(
          2,
        );
  });
  it('rejects nonfinite time before drawing', () => {
    for (const time of [NaN, Infinity, -Infinity]) expect(paint(time)).toEqual([]);
  });
});
