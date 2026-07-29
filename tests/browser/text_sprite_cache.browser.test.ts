// Browser-mode guard for the label sprite cache (src/ui/text_sprite_cache.ts).
//
// WHY THIS SUITE EXISTS, precisely. The module's correctness rests on a browser
// text-metrics rule that no fake context can enforce: TextMetrics reports the
// actual bounding box RELATIVE TO the current textAlign. The first version of
// this module measured under the default 'start' and drew under 'center', so
// every sprite was sized as if the run began at the anchor while the glyphs
// actually ran half their advance width to its LEFT, and each label shipped with
// roughly its left half cut off. Fifty-two green Node assertions did not see it,
// because the Node fake reported center-anchored metrics whatever alignment the
// code under test measured under. Only rendering it caught it.
//
// So the pin here is deliberately the one a fake cannot fake: rasterize through
// the real cache in real Chromium and read the PIXELS back. The Node suite
// (tests/text_sprite_cache.test.ts) still owns the cache identity, the eviction
// policy and the geometry arithmetic; this one owns "the glyphs are all there".
//
// The load-bearing assertion is the LAST describe below: no sprite's ink may
// touch its own canvas edge. That is what makes this suite catch a size bug
// whatever its cause, and it is worth being precise about which pin does which
// work, because the obvious one does less than it looks like it does. Comparing
// the blitted result against a plain centered strokeText + fillText catches the
// composite defect that actually shipped (start-anchored measurement AND no
// union floor), but NOT a re-introduced alignment mistake on its own: the union
// with the advance box floors `left` at half the advance either way, so in real
// Chromium the origin, and therefore every pixel on the target surface, comes
// out identical under both alignments. Only the SPRITE's own width moves, which
// is why the edge scan below reads the sprite canvas rather than the surface.
//
// Two of the module's guarantees deliberately have NO pin here, because real
// Chromium is too well-behaved to exercise them: the union floor (Chromium's
// center-anchored box already equals half the advance, to the pixel) and the
// mitered-join cap (no font on this machine is sharp enough to overrun a box
// padded for it). Both exist for platforms that misbehave, so both are pinned in
// the Node suite, where the platform can be faked. Reversing either one there
// fails; reversing it here would not, and a pin that cannot fail is worse than
// no pin at all.
//
// It lives under tests/browser/** and ends in .browser.test.ts, so a bare
// `vitest run` (vite.config.ts test.exclude) skips it; only `npm run test:browser`
// (vitest.browser.config.ts, chromium) runs it.

import { describe, expect, it } from 'vitest';
import { TextSpriteCache, type TextSpriteStyle } from '../../src/ui/text_sprite_cache';

// The map's own label typography and its outlined-label pair, so this exercises
// the real shape rather than a synthetic one. The colors are opaque and distinct
// from the transparent surface, which is all the ink scan needs.
const LABEL_FONT = 'bold 13px Georgia';
const LABEL_FILL = 'rgb(255, 209, 0)';
const LABEL_STROKE = 'rgb(0, 0, 0)';
const LABEL_LINE_WIDTH = 3;
const LABEL: TextSpriteStyle = {
  font: LABEL_FONT,
  fill: LABEL_FILL,
  stroke: LABEL_STROKE,
  lineWidth: LABEL_LINE_WIDTH,
};
const SURFACE = 400;
const ANCHOR_X = SURFACE / 2;
const ANCHOR_Y = 120;

// Latin, Cyrillic and CJK: the clipping bug scaled with advance width, and CJK
// additionally reports an ascent under the em box, which is what the sprite's
// union with the em box covers.
const SAMPLES = [
  'Eastbrook Vale',
  'The Hollow Crypt',
  '\u041a\u0440\u0435\u043f\u043e\u0441\u0442\u044c \u0412\u043e\u0440\u043e\u043d\u0430',
  '\u9ed2\u77f3\u306e\u57ce',
];

// Every style the map actually ships, so the edge scan covers the fill-only badge
// shape (where the padding collapses to the antialias slack) as well as the
// outlined ones, plus the fonts a platform WITHOUT Georgia substitutes. The map's
// font constants name Georgia with no generic fallback, so on Android and most
// Linux these labels really do rasterize in the UA's default sans, whose sharper
// 'M' apex is what a mitered outline spikes hardest on.
const EDGE_STYLES: Array<{ name: string; style: TextSpriteStyle }> = [
  { name: 'title', style: { ...LABEL, font: 'bold 16px Georgia' } },
  { name: 'poi', style: LABEL },
  { name: 'portal', style: { ...LABEL, font: 'bold 12px Georgia' } },
  { name: 'glyph', style: { ...LABEL, font: 'bold 15px Georgia' } },
  { name: 'ally', style: { ...LABEL, font: 'bold 11px Georgia' } },
  { name: 'badge (fill only)', style: { font: 'bold 12px Georgia', fill: LABEL_FILL } },
  { name: 'substituted sans', style: { ...LABEL, font: 'bold 13px sans-serif' } },
  { name: 'substituted sans, large', style: { ...LABEL, font: 'bold 16px sans-serif' } },
];

// Sharp apexes first: 'M', 'A', 'W' and 'V' are where an outline's mitered join
// reaches furthest past the glyph, which is the case a box sized for half the
// line width clips right off.
const EDGE_SAMPLES = [...SAMPLES, 'MAX', 'WAVY', 'M', 'A', '7', '96', '!', '?'];

function surface(): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = SURFACE;
  canvas.height = SURFACE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2D context in the browser runner');
  return ctx;
}

/** The offscreen canvas the cache rasterizes a label into, captured on its way
 *  out of document.createElement. The cache deliberately exposes no handle on its
 *  sprites, and the sprite is the only place a sizing bug is observable once the
 *  blit destination has been rounded, so the test reaches for it here. */
function spriteFor(text: string, style: TextSpriteStyle): HTMLCanvasElement {
  const target = surface();
  const real = document.createElement.bind(document);
  const minted: HTMLCanvasElement[] = [];
  (document as unknown as { createElement: (tag: string) => HTMLElement }).createElement = (
    tag: string,
  ): HTMLElement => {
    const el = real(tag);
    if (tag === 'canvas') minted.push(el as HTMLCanvasElement);
    return el;
  };
  try {
    new TextSpriteCache().draw(target, text, ANCHOR_X, ANCHOR_Y, style);
  } finally {
    (document as unknown as { createElement: unknown }).createElement = real;
  }
  const sprite = minted[0];
  if (!sprite) throw new Error(`the cache minted no sprite for "${text}"`);
  return sprite;
}

/** Columns and rows that carry any non-transparent pixel. */
function inkExtent(ctx: CanvasRenderingContext2D): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  count: number;
} {
  const { data } = ctx.getImageData(0, 0, SURFACE, SURFACE);
  let minX = SURFACE;
  let maxX = -1;
  let minY = SURFACE;
  let maxY = -1;
  let count = 0;
  for (let y = 0; y < SURFACE; y++) {
    for (let x = 0; x < SURFACE; x++) {
      if (data[(y * SURFACE + x) * 4 + 3] === 0) continue;
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, maxX, minY, maxY, count };
}

/** How many bytes of the two surfaces differ (0 means pixel-identical). Counted
 *  rather than deep-compared so a failure reports a number, not 640k entries. */
function differingBytes(a: CanvasRenderingContext2D, b: CanvasRenderingContext2D): number {
  const left = a.getImageData(0, 0, SURFACE, SURFACE).data;
  const right = b.getImageData(0, 0, SURFACE, SURFACE).data;
  let differing = 0;
  for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) differing++;
  return differing;
}

/** The reference: exactly the centered strokeText + fillText the sprite replaced. */
function drawDirect(ctx: CanvasRenderingContext2D, text: string): void {
  ctx.font = LABEL_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.strokeStyle = LABEL_STROKE;
  ctx.lineWidth = LABEL_LINE_WIDTH;
  ctx.strokeText(text, ANCHOR_X, ANCHOR_Y);
  ctx.fillStyle = LABEL_FILL;
  ctx.fillText(text, ANCHOR_X, ANCHOR_Y);
}

describe('text_sprite_cache in a real browser: the sprite carries the whole label', () => {
  for (const text of SAMPLES) {
    it(`straddles the anchor on both sides for "${text}"`, () => {
      const reference = surface();
      drawDirect(reference, text);
      const want = inkExtent(reference);

      const painted = surface();
      new TextSpriteCache().draw(painted, text, ANCHOR_X, ANCHOR_Y, LABEL);
      const got = inkExtent(painted);

      // The bug that motivated this suite left ink on ONE side of the anchor.
      expect(got.count).toBeGreaterThan(0);
      expect(got.minX, 'no ink left of the anchor: the sprite is clipping').toBeLessThan(ANCHOR_X);
      expect(got.maxX, 'no ink right of the anchor').toBeGreaterThan(ANCHOR_X);

      // And it matches the draw it replaced, within the whole-pixel blit snap.
      expect(Math.abs(got.minX - want.minX)).toBeLessThanOrEqual(1);
      expect(Math.abs(got.maxX - want.maxX)).toBeLessThanOrEqual(1);
      expect(Math.abs(got.minY - want.minY)).toBeLessThanOrEqual(1);
      expect(Math.abs(got.maxY - want.maxY)).toBeLessThanOrEqual(1);
      // Ink volume within a few percent: a half-clipped label loses ~45%.
      expect(Math.abs(got.count - want.count) / want.count).toBeLessThan(0.1);
    });
  }

  it('blits a cached sprite to the same pixels it drew the first time', () => {
    const cache = new TextSpriteCache();
    const first = surface();
    cache.draw(first, SAMPLES[0], ANCHOR_X, ANCHOR_Y, LABEL);
    const second = surface();
    cache.draw(second, SAMPLES[0], ANCHOR_X, ANCHOR_Y, LABEL);

    expect(differingBytes(first, second)).toBe(0);
  });

  it('sizes the sprite to its own ink, not to a start-anchored box', () => {
    // The one observable that DOES move under an alignment-only regression: the
    // sprite's own canvas. Measuring under 'start' while drawing under 'center'
    // reports a box running the full advance to the right of the anchor, so the
    // canvas comes out roughly half an advance wider than the ink needs, while
    // every pixel on the target surface stays put. Nothing else in this file
    // would notice.
    for (const text of SAMPLES) {
      const reference = surface();
      drawDirect(reference, text);
      const want = inkExtent(reference);
      const inkWidth = want.maxX - want.minX + 1;

      const sprite = spriteFor(text, LABEL);
      // Sized to the ink plus the padding on each side. Half an advance of slack
      // on one side would be tens of pixels on these labels; the real margin is
      // the padding, twice.
      expect(
        sprite.width - inkWidth,
        `sprite for "${text}" is ${sprite.width}px wide for ${inkWidth}px of ink`,
      ).toBeLessThan(40);
    }
  });

  it('keeps the label crisp with image smoothing left on, as the map painter leaves it', () => {
    // map_window_painter sets imageSmoothingEnabled = true for its terrain blit
    // and never restores it, so every label blit lands under smoothing. A
    // fractional destination resamples to mush there; the rounded one does not.
    const smoothed = surface();
    smoothed.imageSmoothingEnabled = true;
    const cache = new TextSpriteCache();
    cache.draw(smoothed, SAMPLES[0], ANCHOR_X + 0.37, ANCHOR_Y + 0.62, LABEL);

    const crisp = surface();
    crisp.imageSmoothingEnabled = false;
    cache.draw(crisp, SAMPLES[0], ANCHOR_X + 0.37, ANCHOR_Y + 0.62, LABEL);

    // Rounding makes the two settings produce identical pixels: legibility no
    // longer depends on whoever last touched imageSmoothingEnabled.
    expect(differingBytes(smoothed, crisp)).toBe(0);
  });
});

describe('text_sprite_cache in a real browser: no sprite clips its own ink', () => {
  // The general form of every size bug this module can have, pinned without
  // referring to any of its constants: if the box is too small for ANY reason,
  // the glyphs are cut off exactly at the canvas boundary, so ink lands in the
  // outermost row or column. If the box is right, those are transparent padding.
  // A box sized for half the outline width fails this on 'M' in a substituted
  // sans; a start-anchored measurement fails it on the left column.
  for (const { name, style } of EDGE_STYLES) {
    it(`leaves a transparent margin on all four sides for the ${name} style`, () => {
      const touching: string[] = [];
      for (const text of EDGE_SAMPLES) {
        const sprite = spriteFor(text, style);
        const ctx = sprite.getContext('2d');
        if (!ctx) throw new Error('no sprite context');
        const { data } = ctx.getImageData(0, 0, sprite.width, sprite.height);
        const opaqueAt = (x: number, y: number): boolean =>
          data[(y * sprite.width + x) * 4 + 3] !== 0;
        const edges: string[] = [];
        for (let x = 0; x < sprite.width; x++) {
          if (opaqueAt(x, 0)) edges.push('top');
          if (opaqueAt(x, sprite.height - 1)) edges.push('bottom');
        }
        for (let y = 0; y < sprite.height; y++) {
          if (opaqueAt(0, y)) edges.push('left');
          if (opaqueAt(sprite.width - 1, y)) edges.push('right');
        }
        if (edges.length > 0) {
          touching.push(`"${text}" cut off at the ${[...new Set(edges)].join('/')} edge`);
        }
      }
      expect(touching, `${name}: the sprite box is smaller than the ink it drew`).toEqual([]);
    });
  }
});
