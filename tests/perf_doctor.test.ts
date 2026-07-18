import { describe, expect, it } from 'vitest';
import { analyzePerfSuggestions } from '../src/game/perf_doctor';

const base = {
  frameMs: { p95: 16, long50: 0 },
  windows: { last10s: { frames: 600, fps: 60, frameMs: { p95: 16, long50: 0 } } },
  renderer: {
    tier: 'high',
    pixelRatio: 1.5,
    glRenderer: 'ANGLE (Apple, Apple M2, OpenGL)',
    contextLost: 0,
    contextRestored: 0,
  },
  browser: {
    longTasks: { count: 0, p95: 0, max: 0 },
    memory: null,
  },
  device: {
    dpr: 1.5,
    deviceMemory: 8,
    hardwareConcurrency: 8,
    maxTouchPoints: 0,
  },
};

describe('analyzePerfSuggestions', () => {
  it('stays quiet for a healthy session', () => {
    expect(analyzePerfSuggestions(base)).toEqual([]);
  });

  it('flags software rendering as a hardware acceleration problem', () => {
    const suggestions = analyzePerfSuggestions({
      ...base,
      renderer: { ...base.renderer, glRenderer: 'Google SwiftShader' },
    });

    expect(suggestions.map((s) => s.id)).toContain('hardware-acceleration');
  });

  it('flags WARP (Windows D3D11 software fallback) as software rendering', () => {
    const suggestions = analyzePerfSuggestions({
      ...base,
      renderer: {
        ...base.renderer,
        glRenderer: 'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0)',
      },
    });

    const suggestion = suggestions.find((s) => s.id === 'hardware-acceleration');
    expect(suggestion).toBeDefined();
    expect(suggestion?.title).toBe('Software rendering (no real GPU)');
  });

  it('suggests low graphics for high-DPI sessions with bad frame windows', () => {
    const suggestions = analyzePerfSuggestions(
      {
        ...base,
        windows: { last10s: { frames: 300, fps: 30, frameMs: { p95: 40, long50: 4 } } },
        renderer: { ...base.renderer, pixelRatio: 2 },
        device: { ...base.device, dpr: 2 },
      },
      '?foo=bar',
    );

    const highDpi = suggestions.find((s) => s.id === 'high-dpi');
    expect(highDpi?.action?.href).toContain('gfx=low');
  });

  it('does not blame extensions unless frame performance is also bad', () => {
    const healthyWithLongTasks = analyzePerfSuggestions({
      ...base,
      browser: { ...base.browser, longTasks: { count: 4, p95: 120, max: 180 } },
    });
    expect(healthyWithLongTasks.map((s) => s.id)).not.toContain('browser-stalls');

    const badWithLongTasks = analyzePerfSuggestions({
      ...base,
      windows: { last10s: { frames: 300, fps: 30, frameMs: { p95: 42, long50: 5 } } },
      browser: { ...base.browser, longTasks: { count: 4, p95: 120, max: 180 } },
    });
    expect(badWithLongTasks.map((s) => s.id)).toContain('browser-stalls');
  });

  it('warns when high graphics is forced during bad performance', () => {
    const suggestions = analyzePerfSuggestions(
      {
        ...base,
        windows: { last10s: { frames: 280, fps: 28, frameMs: { p95: 45, long50: 8 } } },
      },
      '?gfx=ultra',
    );

    expect(suggestions.map((s) => s.id)).toContain('forced-high-graphics');
  });
});
