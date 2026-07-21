import { beforeEach, describe, expect, it } from 'vitest';
import {
  defaultPerfOverlayConfig, FONT_SCALE_MAX, FONT_SCALE_MIN, PerfOverlayConfigStore, sanitizePerfOverlayConfig,
} from '../src/ui/perf_overlay_config';

function installStorage(): void {
  const map = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => map.clear(),
  };
}

beforeEach(() => installStorage());

describe('perf overlay config defaults', () => {
  it('starts top-left, off-brand-safe, with the standard metric trio', () => {
    const c = defaultPerfOverlayConfig();
    expect(c.posX).toBe(0);
    expect(c.posY).toBe(0);
    expect(c.opacity).toBeCloseTo(0.55);
    expect(c.solidBg).toBe(false);
    expect(c.fontScale).toBe(1);
    expect(c.textColor).toBe('#ffd76a');
    expect(c.graph).toBe(true);
    expect(c.thresholds).toBe(true);
    expect(c.metrics.fps).toBe(true);
    expect(c.metrics.triangles).toBe(false);
  });
});

describe('sanitizePerfOverlayConfig', () => {
  it('clamps numeric ranges', () => {
    const c = sanitizePerfOverlayConfig({ posX: 5, posY: -2, opacity: 9, fontScale: 99 });
    expect(c.posX).toBe(1);
    expect(c.posY).toBe(0);
    expect(c.opacity).toBe(1);
    expect(c.fontScale).toBe(FONT_SCALE_MAX);
    expect(sanitizePerfOverlayConfig({ fontScale: 0 }).fontScale).toBe(FONT_SCALE_MIN);
  });

  it('rejects malformed colors but keeps valid hex (lowercased)', () => {
    expect(sanitizePerfOverlayConfig({ textColor: 'red' }).textColor).toBe('#ffd76a');
    expect(sanitizePerfOverlayConfig({ textColor: '#ABCDEF' }).textColor).toBe('#abcdef');
    expect(sanitizePerfOverlayConfig({ bgColor: '#zzzzzz' }).bgColor).toBe(defaultPerfOverlayConfig().bgColor);
  });

  it('merges only known metric keys with boolean values', () => {
    const c = sanitizePerfOverlayConfig({ metrics: { fps: false, bogus: true, triangles: 'yes' } as any });
    expect(c.metrics.fps).toBe(false);
    expect((c.metrics as any).bogus).toBeUndefined();
    expect(c.metrics.triangles).toBe(false); // non-boolean ignored, keeps default
  });

  it('falls back to defaults for non-object input', () => {
    expect(sanitizePerfOverlayConfig(null)).toEqual(defaultPerfOverlayConfig());
    expect(sanitizePerfOverlayConfig(42)).toEqual(defaultPerfOverlayConfig());
  });
});

describe('PerfOverlayConfigStore', () => {
  it('persists patches across instances', () => {
    const a = new PerfOverlayConfigStore();
    a.patch({ opacity: 0.9, posX: 0.5 });
    const b = new PerfOverlayConfigStore();
    expect(b.get().opacity).toBeCloseTo(0.9);
    expect(b.get().posX).toBeCloseTo(0.5);
  });

  it('shallow-merges the metric map on patch', () => {
    const s = new PerfOverlayConfigStore();
    s.setMetric('triangles', true);
    expect(s.get().metrics.triangles).toBe(true);
    expect(s.get().metrics.fps).toBe(true); // untouched
    s.patch({ metrics: { fps: false } });
    expect(s.get().metrics.fps).toBe(false);
    expect(s.get().metrics.triangles).toBe(true); // preserved
  });

  it('reset restores defaults; resetPosition only moves it home', () => {
    const s = new PerfOverlayConfigStore();
    s.patch({ posX: 0.8, posY: 0.8, opacity: 0.2 });
    s.resetPosition();
    expect(s.get().posX).toBe(0);
    expect(s.get().posY).toBe(0);
    expect(s.get().opacity).toBeCloseTo(0.2); // appearance untouched
    s.reset();
    expect(s.get()).toEqual(defaultPerfOverlayConfig());
  });

  it('survives corrupt stored JSON', () => {
    localStorage.setItem('woc_perf_overlay', '{not valid');
    const s = new PerfOverlayConfigStore();
    expect(s.get()).toEqual(defaultPerfOverlayConfig());
  });

  it('returns defensive copies (mutating get() does not leak)', () => {
    const s = new PerfOverlayConfigStore();
    const snap = s.get();
    snap.metrics.fps = false;
    snap.opacity = 0.01;
    expect(s.get().metrics.fps).toBe(true);
    expect(s.get().opacity).toBeCloseTo(0.55);
  });
});
