import { describe, expect, it } from 'vitest';
import { analyzePerfSuggestions, PERF_SUGGESTION_IDS } from '../src/game/perf_doctor';

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

describe('PERF_SUGGESTION_IDS catalog', () => {
  it('pins the complete id catalog in emit-priority order', () => {
    // The server allowlist is a deliberate copy of this list (ruling R14);
    // tests/perf_suggestion_id_parity.test.ts pins the two equal, so this pin
    // is where a catalog change must be made CONSCIOUSLY first.
    expect([...PERF_SUGGESTION_IDS]).toEqual([
      'hardware-acceleration',
      'integrated-gpu',
      'high-dpi',
      'forced-high-graphics',
      'low-memory',
      'browser-stalls',
      'heap-pressure',
      'context-loss',
    ]);
  });

  it('emits only cataloged ids across a kitchen-sink bad session', () => {
    const suggestions = analyzePerfSuggestions(
      {
        ...base,
        windows: { last10s: { frames: 280, fps: 20, frameMs: { p95: 60, long50: 12 } } },
        renderer: { ...base.renderer, glRenderer: 'Google SwiftShader', contextLost: 2 },
        browser: {
          longTasks: { count: 6, p95: 140, max: 300 },
          memory: { usedMB: 3900, limitMB: 4096 },
        },
        device: { ...base.device, dpr: 3, deviceMemory: 2 },
      },
      '?gfx=ultra',
    );
    const known = new Set<string>(PERF_SUGGESTION_IDS);
    expect(suggestions.length).toBeGreaterThan(0);
    for (const suggestion of suggestions) expect(known.has(suggestion.id)).toBe(true);
  });
});

describe('integrated-gpu rule', () => {
  const badWindow = { last10s: { frames: 280, fps: 24, frameMs: { p95: 48, long50: 9 } } };
  const IRIS_XE = 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)';
  const UHD_620 = 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)';

  it('fires on bad frames with a mid-integrated adapter outside the desktop shell', () => {
    const suggestions = analyzePerfSuggestions(
      { ...base, windows: badWindow, renderer: { ...base.renderer, glRenderer: IRIS_XE } },
      '',
      { desktopShell: false },
    );
    const integrated = suggestions.find((s) => s.id === 'integrated-gpu');
    expect(integrated).toBeDefined();
    expect(integrated?.severity).toBe('warning');
    // Ruling R15: the copy must stay CONDITIONAL, because the adapter string
    // cannot prove a discrete GPU exists.
    expect(integrated?.body).toContain('If this computer also has a gaming GPU');
  });

  it('fires for the weak-integrated Intel list too, UHD 620 being the hybrid-laptop staple', () => {
    const suggestions = analyzePerfSuggestions(
      { ...base, windows: badWindow, renderer: { ...base.renderer, glRenderer: UHD_620 } },
      '',
      { desktopShell: false },
    );
    expect(suggestions.map((s) => s.id)).toContain('integrated-gpu');
  });

  it('stays quiet on healthy frames even with an integrated adapter', () => {
    const suggestions = analyzePerfSuggestions(
      { ...base, renderer: { ...base.renderer, glRenderer: IRIS_XE } },
      '',
      { desktopShell: false },
    );
    expect(suggestions.map((s) => s.id)).not.toContain('integrated-gpu');
  });

  it('never fires inside the desktop shell, which already forces the dGPU', () => {
    const suggestions = analyzePerfSuggestions(
      { ...base, windows: badWindow, renderer: { ...base.renderer, glRenderer: IRIS_XE } },
      '',
      { desktopShell: true },
    );
    expect(suggestions.map((s) => s.id)).not.toContain('integrated-gpu');
  });

  it('never fires for a discrete or mobile adapter under the same bad frames', () => {
    for (const discrete of [
      'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Laptop GPU Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'Adreno (TM) 640',
      'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)',
    ]) {
      const suggestions = analyzePerfSuggestions(
        { ...base, windows: badWindow, renderer: { ...base.renderer, glRenderer: discrete } },
        '',
        { desktopShell: false },
      );
      expect(suggestions.map((s) => s.id)).not.toContain('integrated-gpu');
    }
  });

  it('is mutually exclusive with the software arm: software classification wins', () => {
    // The WARP fixture pins the common real-world case; the second string is
    // the DECISIVE fixture, matching BOTH the software tokens and the
    // weak-integrated Intel family, so only the else-branch exclusion keeps
    // integrated-gpu out (ruling R15: software classification wins).
    for (const bothArms of [
      'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0)',
      'ANGLE (Intel, Intel(R) UHD Graphics 620, SwiftShader fallback)',
    ]) {
      const suggestions = analyzePerfSuggestions(
        { ...base, windows: badWindow, renderer: { ...base.renderer, glRenderer: bothArms } },
        '',
        { desktopShell: false },
      );
      const ids = suggestions.map((s) => s.id);
      expect(ids).toContain('hardware-acceleration');
      expect(ids).not.toContain('integrated-gpu');
    }
  });
});
