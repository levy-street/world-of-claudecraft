import { describe, expect, it } from 'vitest';
import {
  applyPerfOrnamentVars,
  PERF_CORNER_SIZE,
  PERF_EDGE_TILE_LENGTH,
  PERF_EDGE_TILE_THICKNESS,
  PERF_MID_EDGE_SIZE,
  perfCornerOrnamentMaskImage,
  perfGiltGradientBackground,
  perfMidEdgeOrnamentMaskImage,
  perfNoisyEdgeMaskImage,
} from '../src/ui/perf_ornament_svg';

// A mask-image data URI never bakes in color: the referencing CSS rule always
// supplies `background: var(--perf-ornament-gilt)` so the shape repaints per
// token change. Any raw hex/rgb inside the SVG markup itself (other than the
// SVG spec's own #000 default-fill boilerplate the mask mechanism relies on)
// would silently defeat that and freeze the ornament to one color forever.
function decodeSvg(dataUri: string): string {
  const match = dataUri.match(/^url\("data:image\/svg\+xml,(.*)"\)$/);
  expect(match).not.toBeNull();
  return decodeURIComponent(match?.[1] ?? '');
}

describe('perf_ornament_svg', () => {
  it('corner mask image has four comma-separated data-URI layers', () => {
    const value = perfCornerOrnamentMaskImage();
    const layers = value.split(', ');
    expect(layers).toHaveLength(4);
    for (const layer of layers) {
      expect(layer).toMatch(/^url\("data:image\/svg\+xml,/);
      const svg = decodeSvg(layer);
      expect(svg).toContain('<svg');
      expect(svg).toContain(`viewBox='0 0 ${PERF_CORNER_SIZE} ${PERF_CORNER_SIZE}'`);
    }
  });

  it('corner motif mirrors are distinct (four different corners, not four copies)', () => {
    const layers = perfCornerOrnamentMaskImage().split(', ');
    expect(new Set(layers).size).toBe(4);
  });

  it('the corner motif is a volute (outer body + inner detail) plus two outward leafy tendrils and a radius trace, never a single bare curl', () => {
    const svg = decodeSvg(perfCornerOrnamentMaskImage().split(', ')[0]);
    const paths = svg.match(/<path[^>]*>/g) ?? [];
    // 6 round-capped strokes (volute outer/inner, top tendril, side run,
    // side curl, side tail) plus the round-capped radius-trace band, plus
    // exactly one filled composite path holding every acanthus leaflet
    // (spiral-wrapping, top-tendril, and side-tendril foliage together).
    const strokes = paths.filter((p) => p.includes('fill="none"'));
    const fills = paths.filter((p) => !p.includes('fill="none"'));
    expect(strokes).toHaveLength(7);
    expect(fills).toHaveLength(1);
    for (const p of strokes) {
      expect(p).toContain('stroke-linecap="round"');
    }
  });

  it('mid-edge mask image has four comma-separated data-URI layers, one per edge midpoint', () => {
    const value = perfMidEdgeOrnamentMaskImage();
    const layers = value.split(', ');
    expect(layers).toHaveLength(4);
    for (const layer of layers) {
      expect(layer).toMatch(/^url\("data:image\/svg\+xml,/);
      const svg = decodeSvg(layer);
      expect(svg).toContain('<svg');
      expect(svg).toContain(`viewBox='0 0 ${PERF_MID_EDGE_SIZE} ${PERF_MID_EDGE_SIZE}'`);
    }
    expect(new Set(layers).size).toBe(4);
  });

  it('each mid-edge motif is exactly left-right symmetric about its own outward axis', () => {
    // The stem tip sits ON the outward axis (radius grows from the pivot only,
    // never sideways), so its distance from the two side-tendril tips must
    // match exactly if the motif truly mirrors around that axis.
    const svg = decodeSvg(perfMidEdgeOrnamentMaskImage().split(', ')[0]);
    const strokePaths = (svg.match(/<path d="([^"]+)" fill="none"/g) ?? []).map((p) => {
      const d = p.match(/d="([^"]+)"/)?.[1] ?? '';
      const [first, ...rest] = d.replace(/^M\s*/, '').split(/\s*L\s*/);
      const last = rest[rest.length - 1] ?? first;
      return { first: first.split(/\s+/).map(Number), last: last.split(/\s+/).map(Number) };
    });
    // strokes: [stem, sideA, sideB] in that emission order.
    expect(strokePaths).toHaveLength(3);
    const pivot = strokePaths[0].first;
    const dist = (p: number[]): number => Math.hypot(p[0] - pivot[0], p[1] - pivot[1]);
    expect(dist(strokePaths[1].last)).toBeCloseTo(dist(strokePaths[2].last), 0);
  });

  it('noisy edge tile is a single closed ribbon path', () => {
    const svg = decodeSvg(perfNoisyEdgeMaskImage(1, false));
    expect(svg).toContain('<path');
    expect(svg).toMatch(/\bZ\b/);
    expect(svg).toContain(`viewBox='0 0 ${PERF_EDGE_TILE_LENGTH} ${PERF_EDGE_TILE_THICKNESS}'`);
  });

  it('the vertical edge tile transposes its viewBox from the horizontal one', () => {
    const h = decodeSvg(perfNoisyEdgeMaskImage(5, false));
    const v = decodeSvg(perfNoisyEdgeMaskImage(5, true));
    const hBox = h
      .match(/viewBox='([^']+)'/)?.[1]
      .split(' ')
      .map(Number);
    const vBox = v
      .match(/viewBox='([^']+)'/)?.[1]
      .split(' ')
      .map(Number);
    expect(hBox?.[2]).toBe(vBox?.[3]);
    expect(hBox?.[3]).toBe(vBox?.[2]);
  });

  it('different seeds produce different edge textures', () => {
    expect(perfNoisyEdgeMaskImage(1, false)).not.toBe(perfNoisyEdgeMaskImage(2, false));
  });

  it('the edge tile is seam-free: its start and end cross-section match exactly', () => {
    // Integer-frequency noise harmonics mean the wobble at t=0 and t=1 (one
    // full period) is identical, so CSS mask-repeat never shows a visible
    // jump where one tile ends and the next begins.
    const svg = decodeSvg(perfNoisyEdgeMaskImage(9, false));
    const d = svg.match(/d="([^"]+)"/)?.[1] ?? '';
    const pairs = d
      .replace(/^M\s*/, '')
      .replace(/\s*Z\s*$/, '')
      .split(/\s*L\s*/)
      .map((pair) => pair.trim().split(/\s+/).map(Number));
    const topCount = pairs.length / 2;
    const firstTopY = pairs[0][1];
    const lastTopY = pairs[topCount - 1][1];
    expect(lastTopY).toBeCloseTo(firstTopY, 1);
  });

  it('no ornament data URI embeds a themed hex color (colorless shapes only)', () => {
    const uris = [
      ...perfCornerOrnamentMaskImage().split(', '),
      ...perfMidEdgeOrnamentMaskImage().split(', '),
      perfNoisyEdgeMaskImage(1, false),
      perfNoisyEdgeMaskImage(2, true),
    ];
    for (const uri of uris) {
      const svg = decodeSvg(uri);
      const hexes = svg.match(/#[0-9a-fA-F]{3,6}/g) ?? [];
      for (const hex of hexes) {
        expect(hex.toLowerCase()).toBe('#000');
      }
    }
  });

  it('the gilt gradient is a seamless repeating-conic-gradient over --color-gold-* tokens only', () => {
    const value = perfGiltGradientBackground();
    expect(value).toMatch(/^repeating-conic-gradient\(/);
    expect(value).toContain('var(--color-gold-600)');
    expect(value).toContain('color-mix(');
    // No raw hex literal anywhere: every color term must be a token
    // reference or a color-mix() of tokens, never a literal (components.css
    // rule: "no hex literal in hud.css/components.css/painter").
    expect(value.match(/#[0-9a-fA-F]{3,6}/g)).toBeNull();
  });

  it('the gilt gradient period divides 360 evenly (no seam where it wraps)', () => {
    const value = perfGiltGradientBackground();
    const degs = (value.match(/(-?\d+(\.\d+)?)deg/g) ?? []).map((s) => Number.parseFloat(s));
    const period = Math.max(...degs);
    expect(360 % period).toBeCloseTo(0, 5);
  });

  it('is deterministic: same inputs produce byte-identical output', () => {
    expect(perfCornerOrnamentMaskImage()).toBe(perfCornerOrnamentMaskImage());
    expect(perfGiltGradientBackground()).toBe(perfGiltGradientBackground());
    expect(perfNoisyEdgeMaskImage(3, false)).toBe(perfNoisyEdgeMaskImage(3, false));
  });

  // Regression coverage for a real bug found while building this: an earlier
  // version mirrored the 4 corners via an SVG `<g transform="scale(-1 ...)">`
  // wrapper. That triggered a genuine Chromium multi-layer `mask-image`
  // rendering bug (confirmed by isolating the variable in a minimal repro
  // outside this repo's test suite): combining several DIFFERING large
  // inline-SVG data URIs in one `mask-image` list, where the differing
  // layers relied on a negative-scale transform, made every layer render as
  // the FIRST (unmirrored) layer's shape. The fix bakes the mirror into
  // plain coordinate math (no SVG transform at all); this test verifies the
  // geometry really IS a mirror, not just "any different string".
  it('the corner mirrors are TRUE geometric mirrors (coordinates flip, not just differ)', () => {
    const layers = perfCornerOrnamentMaskImage().split(', ');
    const bracketPoints = (svg: string): number[][] => {
      // The base (full-length) curl stroke is the first <path>, built from
      // plain M/L commands (no curves), so a simple space/L split is exact.
      const d = svg.match(/<path d="([^"]+)" fill="none"/)?.[1] ?? '';
      return d
        .replace(/^M\s*/, '')
        .split(/\s*[ML]\s*/)
        .filter(Boolean)
        .map((pair) => pair.trim().split(/\s+/).map(Number));
    };
    const tl = bracketPoints(decodeSvg(layers[0]));
    const tr = bracketPoints(decodeSvg(layers[1]));
    const bl = bracketPoints(decodeSvg(layers[2]));
    const br = bracketPoints(decodeSvg(layers[3]));
    expect(tl.length).toBeGreaterThan(0);
    expect(tl.length).toBe(tr.length);
    expect(tl.length).toBe(bl.length);
    expect(tl.length).toBe(br.length);
    for (let i = 0; i < tl.length; i++) {
      const [x, y] = tl[i];
      // top-right: x mirrors (size - x), y unchanged
      expect(tr[i][0]).toBeCloseTo(PERF_CORNER_SIZE - x, 1);
      expect(tr[i][1]).toBeCloseTo(y, 1);
      // bottom-left: x unchanged, y mirrors
      expect(bl[i][0]).toBeCloseTo(x, 1);
      expect(bl[i][1]).toBeCloseTo(PERF_CORNER_SIZE - y, 1);
      // bottom-right: both mirror
      expect(br[i][0]).toBeCloseTo(PERF_CORNER_SIZE - x, 1);
      expect(br[i][1]).toBeCloseTo(PERF_CORNER_SIZE - y, 1);
    }
  });

  // Regression coverage for a second real bug: the CSS combines 4 edge
  // layers (top/bottom/left/right) in one `mask-image` list. An earlier
  // version generated only 2 distinct edge images (one horizontal seed reused
  // for both top AND bottom, one vertical seed reused for both left AND
  // right) and referenced each var() TWICE in the list. That hit a related
  // Chromium bug: a `mask-image` list that repeats the literal same url()
  // value at two different `mask-position` slots only paints the FIRST
  // occurrence. applyPerfOrnamentVars now generates 4 genuinely distinct
  // edge values (never the same seed twice) specifically to avoid it.
  it('applyPerfOrnamentVars sets 4 distinct edge mask values, never reusing one for two edges', () => {
    const written: Record<string, string> = {};
    const fakeRoot = {
      style: {
        setProperty: (prop: string, value: string) => {
          written[prop] = value;
        },
      },
    } as unknown as HTMLElement;
    applyPerfOrnamentVars(fakeRoot);
    const edgeKeys = [
      '--perf-ornament-edge-top',
      '--perf-ornament-edge-bottom',
      '--perf-ornament-edge-left',
      '--perf-ornament-edge-right',
    ];
    const edgeValues = edgeKeys.map((k) => written[k]);
    for (const v of edgeValues) expect(v).toBeTruthy();
    expect(new Set(edgeValues).size).toBe(4);
    expect(written['--perf-ornament-corner']).toBeTruthy();
    expect(written['--perf-ornament-mid-edge']).toBeTruthy();
    expect(written['--perf-ornament-gilt']).toBeTruthy();
  });
});
