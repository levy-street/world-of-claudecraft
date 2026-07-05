import { describe, it, expect } from 'vitest';
import { downscaleDims } from '../src/render/screenshot';
import { assembleBugReportMeta } from '../src/ui/bug_report';

describe('downscaleDims', () => {
  it('never upscales when already within the cap', () => {
    expect(downscaleDims(800, 600, 1280)).toEqual({ w: 800, h: 600 });
  });

  it('fits the longest edge to maxEdge and preserves aspect ratio', () => {
    expect(downscaleDims(2560, 1440, 1280)).toEqual({ w: 1280, h: 720 });
    expect(downscaleDims(1440, 2560, 1280)).toEqual({ w: 720, h: 1280 });
  });

  it('returns integer dims >= 1 and collapses degenerate input to 1x1', () => {
    expect(downscaleDims(0, 0, 1280)).toEqual({ w: 1, h: 1 });
    expect(downscaleDims(NaN, 100, 1280)).toEqual({ w: 1, h: 100 });
    const d = downscaleDims(3000, 1, 1280);
    expect(Number.isInteger(d.w)).toBe(true);
    expect(d.h).toBeGreaterThanOrEqual(1);
  });
});

describe('assembleBugReportMeta', () => {
  it('clamps non-finite numbers and defaults dpr to 1', () => {
    const meta = assembleBugReportMeta({
      build: 'v1 (abc)',
      userAgent: 'UA',
      viewport: { w: 1920, h: Infinity },
      level: NaN,
      cameraYaw: 3.14,
    });
    expect(meta.viewport).toEqual({ w: 1920, h: 0, dpr: 1 });
    expect(meta.level).toBe(0);
    expect(meta.cameraYaw).toBeCloseTo(3.14);
    expect(meta.zone).toBe('');
  });

  it('truncates over-long strings', () => {
    const meta = assembleBugReportMeta({ userAgent: 'x'.repeat(5000) });
    expect(meta.userAgent.length).toBe(512);
  });
});
