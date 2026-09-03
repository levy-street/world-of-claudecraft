import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

// drawing_buffer_ratio.ts is the thin browser consumer over the pure core: it
// reads window.devicePixelRatio, the active GFX policy and the ?pixelbudget
// dev flag (which render_dev_flags reads ONCE at module load, hence the
// re-import per case).
async function load(search: string, devicePixelRatio: number) {
  vi.resetModules();
  vi.stubGlobal('location', { search });
  vi.stubGlobal('window', { devicePixelRatio });
  const gfx = await import('../src/render/gfx');
  const ratio = await import('../src/render/drawing_buffer_ratio');
  return { gfx, ratio };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('drawing buffer ratio (browser consumer)', () => {
  it('folds the live DPR, the tier cap and the tier budget into one base ratio', async () => {
    const { gfx, ratio } = await load('', 1);
    const restore = gfx.gfxInternalsForTest.overrideSettings({
      pixelRatioCap: 1.75,
      maxDrawingBufferPixels: 4_400_000,
    });
    try {
      expect(ratio.resolveDrawingBufferRatio({ width: 1920, height: 1080 })).toEqual({
        ratio: 1,
        bound: 'dpr',
        budgetBound: false,
      });
      const fourK = ratio.resolveDrawingBufferRatio({ width: 3840, height: 2160 });
      expect(fourK.bound).toBe('budget');
      expect(fourK.ratio).toBeCloseTo(Math.sqrt(4_400_000 / (3840 * 2160)), 6);
      const stats = ratio.drawingBufferPerfStats(
        { width: 2795, height: 1572 },
        { width: 3840, height: 2160 },
      );
      expect(stats).toEqual({
        width: 2795,
        height: 1572,
        maxPixels: 4_400_000,
        bound: 'budget',
        budgetBound: true,
      });
    } finally {
      restore();
    }
  });

  it('restores the DPR-under-cap allocation alone under ?pixelbudget=off', async () => {
    const { gfx, ratio } = await load('?pixelbudget=off', 1);
    const restore = gfx.gfxInternalsForTest.overrideSettings({
      pixelRatioCap: 1.75,
      maxDrawingBufferPixels: 4_400_000,
    });
    try {
      expect(ratio.resolveDrawingBufferRatio({ width: 3840, height: 2160 })).toEqual({
        ratio: 1,
        bound: 'dpr',
        budgetBound: false,
      });
      const stats = ratio.drawingBufferPerfStats(
        { width: 3840, height: 2160 },
        { width: 3840, height: 2160 },
      );
      // A finite sentinel: the block rides the fleet perf report as JSON.
      expect(stats.maxPixels).toBe(0);
      expect(stats.budgetBound).toBe(false);
    } finally {
      restore();
    }
  });

  it('still honors the DPR cap with the budget off (a Retina panel keeps its cap)', async () => {
    const { gfx, ratio } = await load('?pixelbudget=off', 2);
    const restore = gfx.gfxInternalsForTest.overrideSettings({
      pixelRatioCap: 1.48,
      maxDrawingBufferPixels: 2_400_000,
    });
    try {
      expect(ratio.resolveDrawingBufferRatio({ width: 1440, height: 900 })).toEqual({
        ratio: 1.48,
        bound: 'cap',
        budgetBound: false,
      });
    } finally {
      restore();
    }
  });

  it('reads only the static policy: no governor, budget or render-loop import', () => {
    // Fairness: the base ratio is a pure function of tier and device profile,
    // never of the frame-budget governor, so two players in the same spot on
    // the same preset allocate the same buffer.
    const source = readFileSync(
      new URL('../src/render/drawing_buffer_ratio.ts', import.meta.url),
      'utf8',
    );
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]).sort();
    expect(imports).toEqual(['./drawing_buffer_budget_core', './gfx', './render_dev_flags']);
    expect(source).not.toMatch(/render_budget|governor|effectiveRenderScale|performance\.now/);
  });
});
