import { describe, expect, it, vi } from 'vitest';
import {
  drawShamanImpactSprite,
  type ShamanSheet,
} from '../src/render/ability_vfx/shaman_impact_sprites';

type Call = { name: string; args: unknown[] };
function canvas() {
  const calls: Call[] = [];
  const initial = {
    globalCompositeOperation: 'lighter',
    lineCap: 'butt',
    lineJoin: 'miter',
    lineWidth: 4,
    fillStyle: 'red',
    strokeStyle: 'blue',
  };
  let state: Record<string, unknown> = { ...initial };
  const stack: Record<string, unknown>[] = [];
  const methods = new Set([
    'translate',
    'rotate',
    'beginPath',
    'moveTo',
    'lineTo',
    'closePath',
    'stroke',
    'fill',
    'clip',
    'ellipse',
    'quadraticCurveTo',
    'bezierCurveTo',
  ]);
  const g = new Proxy(
    {},
    {
      get(_target, key) {
        if (key === 'save')
          return () => {
            stack.push({ ...state });
          };
        if (key === 'restore')
          return () => {
            const prior = stack.pop();
            if (!prior) throw new Error('Unbalanced canvas restore');
            state = prior;
          };
        if (key === 'createLinearGradient')
          return (...args: unknown[]) => {
            calls.push({ name: 'gradient', args });
            return { addColorStop: (...args: unknown[]) => calls.push({ name: 'stop', args }) };
          };
        if (typeof key === 'string' && methods.has(key))
          return (...args: unknown[]) => {
            calls.push({ name: key, args });
          };
        return state[String(key)];
      },
      set(_target, key, value) {
        state[String(key)] = value;
        calls.push({
          name: `set:${String(key)}`,
          args: [typeof value === 'object' ? 'gradient' : value],
        });
        return true;
      },
    },
  ) as CanvasRenderingContext2D;
  return { g, calls, initial, state: () => state, depth: () => stack.length };
}
const styles: ShamanSheet[] = [
  'shaman_storm',
  'shaman_ember',
  'shaman_rime',
  'shaman_dust',
  'shaman_gale',
];

describe('authored Shaman contact sprite contract', () => {
  it.each(styles)(
    '%s is deterministic without ambient randomness and restores the shared atlas context',
    (style) => {
      const first = canvas(),
        second = canvas();
      const random = vi.spyOn(Math, 'random').mockImplementation(() => {
        throw new Error('Frame-random sprite art');
      });
      try {
        drawShamanImpactSprite(first.g, 64, 64, 0.37, style);
        drawShamanImpactSprite(second.g, 64, 64, 0.37, style);
      } finally {
        random.mockRestore();
      }
      expect(first.calls).toEqual(second.calls);
      expect(first.state()).toEqual(first.initial);
      expect(first.depth()).toBe(0);
      expect(first.calls.some((c) => c.name === 'fill' || c.name === 'stroke')).toBe(true);
    },
  );
  it.each(styles)(
    '%s keeps all 64 atlas cels finite and fully dissipates at the final frame',
    (style) => {
      for (let frame = 0; frame < 64; frame++) {
        const h = canvas();
        drawShamanImpactSprite(h.g, 64, 64, frame / 63, style);
        const invalid = h.calls
          .flatMap((call) => call.args)
          .filter((arg) =>
            typeof arg === 'number'
              ? !Number.isFinite(arg)
              : typeof arg === 'string' && /NaN|Infinity/.test(arg),
          );
        expect(invalid).toEqual([]);
        expect(h.depth()).toBe(0);
        if (frame === 63) expect(h.calls).toEqual([]);
      }
    },
  );
  it.each(styles)('%s advects existing detail smoothly between adjacent middle cels', (style) => {
    const a = canvas(),
      b = canvas();
    drawShamanImpactSprite(a.g, 64, 64, 25 / 63, style);
    drawShamanImpactSprite(b.g, 64, 64, 26 / 63, style);
    const coordinates = (h: ReturnType<typeof canvas>) =>
      h.calls.filter((c) =>
        ['translate', 'moveTo', 'lineTo', 'bezierCurveTo', 'quadraticCurveTo', 'ellipse'].includes(
          c.name,
        ),
      );
    const first = coordinates(a),
      second = coordinates(b);
    expect(first.map((c) => c.name)).toEqual(second.map((c) => c.name));
    for (let i = 0; i < first.length; i++) {
      const left = first[i],
        right = second[i];
      if (!left || !right) throw new Error('Missing corresponding material piece');
      for (let j = 0; j < left.args.length; j++)
        expect(Math.abs(Number(left.args[j]) - Number(right.args[j]))).toBeLessThan(4);
    }
  });
  it('rejects nonfinite inputs before touching the shared atlas', () => {
    const h = canvas();
    for (const bad of [NaN, Infinity, -Infinity]) {
      drawShamanImpactSprite(h.g, 64, 64, bad, 'shaman_storm');
      drawShamanImpactSprite(h.g, bad, 64, 0.4, 'shaman_dust');
      drawShamanImpactSprite(h.g, 64, bad, 0.4, 'shaman_rime');
    }
    expect(h.calls).toEqual([]);
  });
});
