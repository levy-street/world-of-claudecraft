// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyMinimapOrnamentVars,
  minimapGiltSpeckleBackground,
  SPECKLE_R_MAX,
  SPECKLE_R_MIN,
} from '../src/ui/minimap_gilded_ornament';
import { perfGiltGradientBackground } from '../src/ui/perf_ornament_svg';

const GOLD_TOKENS: Record<string, string> = {
  '--color-gold-300': '#ffe5a3',
  '--color-gold-400': '#f0c86d',
  '--color-gold-500': '#d8a645',
  '--color-gold-600': '#bc8732',
  '--color-gold-700': '#926321',
  '--color-gold-800': '#6b4517',
  '--color-gold-900': '#4a2f10',
};

function decodeSvg(dataUri: string): string {
  const match = dataUri.match(/^url\("data:image\/svg\+xml,(.*)"\)$/);
  expect(match).not.toBeNull();
  return decodeURIComponent(match?.[1] ?? '');
}

describe('minimap_gilded_ornament', () => {
  beforeEach(() => {
    for (const [prop, value] of Object.entries(GOLD_TOKENS)) {
      document.documentElement.style.setProperty(prop, value);
    }
  });

  it('writes --minimap-gilt to a paintable background value', () => {
    applyMinimapOrnamentVars(document.documentElement);
    const value = document.documentElement.style.getPropertyValue('--minimap-gilt');
    expect(value).toMatch(/^repeating-conic-gradient\(/);
  });

  it('reuses the exact perf-ornament gilt generator rather than a second implementation', () => {
    applyMinimapOrnamentVars(document.documentElement);
    const value = document.documentElement.style.getPropertyValue('--minimap-gilt');
    expect(value).toBe(perfGiltGradientBackground());
  });

  it('writes --minimap-speckle to an svg data-uri background image', () => {
    applyMinimapOrnamentVars(document.documentElement);
    const value = document.documentElement.style.getPropertyValue('--minimap-speckle');
    expect(value).toMatch(/^url\("data:image\/svg\+xml,/);
  });

  it('the speckle field is a real field of many distinct circles, not one flat shape', () => {
    const svg = decodeSvg(minimapGiltSpeckleBackground(document.documentElement));
    const circles = svg.match(/<circle/g) ?? [];
    expect(circles.length).toBeGreaterThan(40);
  });

  it('speckle fill colors are drawn from the resolved --color-gold-* tokens, not hardcoded', () => {
    const svg = decodeSvg(minimapGiltSpeckleBackground(document.documentElement));
    const fills = new Set(
      (svg.match(/fill="(#[0-9a-fA-F]{6})"/g) ?? []).map((m) => m.slice(6, -1)),
    );
    expect(fills.size).toBeGreaterThan(1);
    for (const fill of fills) {
      expect(Object.values(GOLD_TOKENS)).toContain(fill);
    }
  });

  it('speckles vary in size and opacity rather than being uniform dots', () => {
    const svg = decodeSvg(minimapGiltSpeckleBackground(document.documentElement));
    const radii = new Set(svg.match(/ r="([\d.]+)"/g));
    const opacities = new Set(svg.match(/fill-opacity="([\d.]+)"/g));
    expect(radii.size).toBeGreaterThan(5);
    expect(opacities.size).toBeGreaterThan(5);
  });

  it('is deterministic: same tokens produce byte-identical speckle output', () => {
    expect(minimapGiltSpeckleBackground(document.documentElement)).toBe(
      minimapGiltSpeckleBackground(document.documentElement),
    );
  });

  it('falls back to a single paintable tone when no gold tokens are resolvable', () => {
    const detached = document.createElement('div');
    const svg = decodeSvg(minimapGiltSpeckleBackground(detached));
    const fills = new Set(
      (svg.match(/fill="(#[0-9a-fA-F]{6})"/g) ?? []).map((m) => m.slice(6, -1)),
    );
    // The fallback tone (#bc8732) happens to equal the real --color-gold-600
    // value, so merely finding it in the output does not prove the fallback
    // path ran (a real, fully-resolved token set draws that same hex too, see
    // the "drawn from the resolved tokens" test above). What actually proves
    // the fallback ran is that EVERY speckle drew the single fallback tone,
    // where a real resolved ramp draws from many distinct tones (see the
    // "not hardcoded" test above asserting fills.size > 1).
    expect(fills.size).toBe(1);
    expect(fills).toEqual(new Set(['#bc8732']));
  });

  it('every speckle sits inside the visible outer band, never under the opaque canvas', () => {
    // The dot's own `r` attribute is its drawn SIZE (1.2 to ~3.8, see
    // minimapGiltSpeckleBackground), not its distance from the ring's
    // center: recompute that distance from cx/cy against the 200x200
    // viewBox center (100, 100) to check SPECKLE_R_MIN/MAX, the polar
    // placement bounds.
    const svg = decodeSvg(minimapGiltSpeckleBackground(document.documentElement));
    const positions = [...svg.matchAll(/cx="([\d.]+)" cy="([\d.]+)"/g)].map((m) => ({
      x: Number(m[1]),
      y: Number(m[2]),
    }));
    expect(positions.length).toBeGreaterThan(0);
    for (const { x, y } of positions) {
      const dist = Math.hypot(x - 100, y - 100);
      expect(dist).toBeGreaterThanOrEqual(SPECKLE_R_MIN - 0.01);
      expect(dist).toBeLessThanOrEqual(SPECKLE_R_MAX + 0.01);
    }
    // The canvas covers the inner 93.2% of this element's radius (82px
    // canvas radius / 88px box radius, see the source comment): the visible
    // band starts strictly above that, so SPECKLE_R_MIN itself must clear it
    // or every speckle at the low end of the range would render invisibly
    // under the opaque canvas (the exact bug finding 3 caught: R_MIN was 91,
    // below the 93.2 threshold).
    expect(SPECKLE_R_MIN).toBeGreaterThan(93.2);
  });
});
