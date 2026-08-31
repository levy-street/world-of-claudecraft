import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { shaderDebugRequested } from '../src/render/shader_debug_flag';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('shaderDebugRequested', () => {
  it('is off by default, so no context pays the info-log round trip', () => {
    vi.stubGlobal('location', { search: '' });
    expect(shaderDebugRequested()).toBe(false);
  });

  it('is on with ?shaderdebug, valued or bare', () => {
    for (const search of ['?shaderdebug', '?shaderdebug=1', '?gfx=low&shaderdebug=0']) {
      vi.stubGlobal('location', { search });
      // Presence, not truthiness: ?shaderdebug=0 is still an author asking for
      // logs, matching the world renderer's own has() check.
      expect(shaderDebugRequested(), search).toBe(true);
    }
  });

  it('is off for a near miss, so a typo does not silently re-enable the stalls', () => {
    for (const search of ['?shaderdebugging=1', '?debug=shader', '?shader=debug']) {
      vi.stubGlobal('location', { search });
      expect(shaderDebugRequested(), search).toBe(false);
    }
  });

  it('answers false in a headless host with no location, instead of throwing', () => {
    vi.stubGlobal('location', undefined);
    expect(() => shaderDebugRequested()).not.toThrow();
    expect(shaderDebugRequested()).toBe(false);
  });

  it('answers false when reading location throws', () => {
    vi.stubGlobal('location', {
      get search(): string {
        throw new Error('cross-origin');
      },
    });
    expect(shaderDebugRequested()).toBe(false);
  });
});

// The three secondary WebGL contexts this client mints kept three's default
// checkShaderErrors = true, so each of them paid the synchronous
// getProgramInfoLog / getShaderInfoLog round trip on every program's first use,
// the exact cost renderer.ts turned off for the world context. There is no unit
// seam that constructs these renderers (they call `new THREE.WebGLRenderer`
// directly and need a real GL context), so the wiring is pinned in source, the
// way tests/three_reflection_contract.test.ts pins the world renderer's line.
const SECONDARY_CONTEXTS: ReadonlyArray<[string, string, string]> = [
  [
    'the Guide model viewer',
    '../src/guide/viewer/scene.ts',
    'this.renderer.debug.checkShaderErrors = shaderDebugRequested();',
  ],
  [
    'the character-creation preview',
    '../src/render/characters/preview.ts',
    'this.renderer.debug.checkShaderErrors = shaderDebugRequested();',
  ],
  [
    'the portrait headshot rig',
    '../src/render/characters/portrait.ts',
    'newRenderer.debug.checkShaderErrors = shaderDebugRequested();',
  ],
  [
    'the armory preview',
    '../src/render/armory_preview.ts',
    'renderer.debug.checkShaderErrors = shaderDebugRequested();',
  ],
];

describe('secondary WebGL contexts disable checkShaderErrors', () => {
  for (const [name, path, line] of SECONDARY_CONTEXTS) {
    it(`${name} sets it through the shared helper`, () => {
      const source = readFileSync(new URL(path, import.meta.url), 'utf8');
      expect(source).toContain(line);
      // Through the helper, never a second inline URLSearchParams read that
      // could drift from the world renderer's switch.
      expect(source).toContain('shaderDebugRequested');
      expect(source).not.toContain("has('shaderdebug')");
    });

    it(`${name} sets it on the renderer it just constructed`, () => {
      // Ordering matters: three reads debug.checkShaderErrors at a program's
      // FIRST USE, but placing the assignment after the first render would let
      // the preview's own warm draw pay the round trip it exists to avoid.
      const source = readFileSync(new URL(path, import.meta.url), 'utf8');
      const constructed = source.indexOf('new THREE.WebGLRenderer(');
      const flagged = source.indexOf(line);
      const firstRender = source.indexOf('.render(');
      expect(constructed).toBeGreaterThan(-1);
      expect(flagged).toBeGreaterThan(constructed);
      if (firstRender > -1) expect(flagged).toBeLessThan(firstRender);
    });
  }
});
