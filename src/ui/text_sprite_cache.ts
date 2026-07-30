// Bounded offscreen-sprite cache for outlined canvas labels: the fix for a
// per-item canvas TEXT loop.
//
// WHY IT EXISTS. Every canvas text entry point (the `ctx.font` setter,
// `fillText`, `strokeText`, `measureText`) re-resolves font state against the
// document, so the cost tracks how dirty the style tree is rather than the font
// string or the item count. Measured in Chrome at 17 iterations per redraw
// against a dirty style tree (the crowded-town case: ~80 nameplate transform
// writes land in the same frame): bare `ctx.font` assignments 0.033ms, fillText
// with the font already set 0.037ms, measureText alone 0.0368ms, drawImage
// 0.0062ms. On a quiet page all four are equal. Hoisting `ctx.font` above the
// loop measures no better than leaving it inside (0.0385 vs 0.036): only leaving
// the text API is a fix. See src/ui/CLAUDE.md, "Canvas and DOM hot-path
// techniques".
//
// WHAT IT DOES. Rasterizes each distinct (font, fill, outline, text) label ONCE
// into its own offscreen canvas, then blits it with `drawImage` on every later
// redraw. minimap_painter does the same thing inline for its three fixed NPC
// glyphs; this module is the version for LOCALIZED, OPEN-ENDED text (dungeon
// names, POI labels, player names), which the closed-glyph case does not need:
// the box has to come from measureText rather than a constant, and the live set
// has to be bounded and evicted because ally names are player-supplied.
//
// THE BOUND AND ITS EVICTION. `beginRedraw` trims the cache back to
// TEXT_SPRITE_LIMIT in least-recently-used order; a draw during a redraw never
// evicts. So the cache holds at most TEXT_SPRITE_LIMIT sprites at every redraw
// boundary, plus whatever that one redraw asked for. That ordering is the whole
// point: trimming mid-redraw would let a label-heavy redraw evict the sprites it
// is still drawing and re-rasterize every one of them, every redraw, which is
// worse than the fillText it replaced. Overshoot is reclaimed by the next
// `beginRedraw`.
//
// DOM: needs `document.createElement('canvas')`, so this is a painter-side
// helper, not a pure core. It stays host-agnostic otherwise (no window, no
// Three, no i18n, no CSS-var reads: the caller passes resolved colors), and its
// tests drive it through a fake document + fake 2D context. That contract is
// enforced rather than merely described: the module is registered in
// UI_PAINTER_HELPERS in tests/architecture.test.ts, whose classification sweep
// holds it to exactly this (host-agnostic, deterministic, no literal color, and
// `document` only to mint the canvas above). Keep the registration in sync if
// this file is moved or renamed.

/** How one label rasterizes. `stroke` + `lineWidth` are the classic
 *  outlined-label pair (the outline is what keeps a map label readable over
 *  light terrain); omit `stroke` for a fill-only label. */
export interface TextSpriteStyle {
  font: string;
  fill: string;
  stroke?: string;
  lineWidth?: number;
}

/** A rasterized label plus where the caller's (x, y) anchor sits inside it, so
 *  the blit lands the text exactly where fillText would have. */
interface TextSprite {
  canvas: HTMLCanvasElement;
  originX: number;
  originY: number;
}

/** Ink extents around the anchor, in px: `left`/`right` along the baseline,
 *  `ascent`/`descent` above and below it. */
interface TextInk {
  left: number;
  right: number;
  ascent: number;
  descent: number;
}

/** Sprites kept across redraws.
 *
 *  Sized ABOVE the largest label set a single redraw can possibly ask for, which
 *  is what makes cross-redraw thrash impossible rather than merely unlikely: a
 *  working set larger than the budget would evict each entry just before its
 *  next use and re-rasterize the lot every redraw, which on the unthrottled
 *  drag-pan path is worse than the fillText this replaced. The ceiling, all of it
 *  server- or content-capped (tests/text_sprite_cache.test.ts pins the
 *  arithmetic against those sources, so raising a cap fails there first):
 *
 *    150  ally names   (server/social.ts FRIEND_LIMIT 50 + GUILD_MEMBER_LIMIT 100)
 *     96  badge digits (nothing caps the active quest log, but a badge number is
 *                       an index into it and it is keyed by quest id, so the
 *                       count of quests in the content tables is the ceiling)
 *     11  POI labels   (the widest zone)
 *      3  portal names (the zone with the most dungeon doors)
 *      1  zone title
 *      2  quest-giver glyphs
 *   ----
 *    263, rounded up for headroom.
 *
 *  The budget is a ceiling, not a working set: ordinary play resides at a couple
 *  of dozen sprites, and nothing releases them before then (there is deliberately
 *  no clear-on-close, since keeping them is what makes reopening the map free;
 *  the LRU trim is what bounds them, and `clear` exists only for a language
 *  switch, where every key is dead at once). Measured in Chrome at the sizes this
 *  actually rasterizes: a 16-character ally name 126x43px (21KB of backing
 *  store), a POI label 162x45 (29KB), a portal name 138x44 (24KB), the zone title
 *  154x49 (30KB), a quest-giver glyph 34x48 (6KB), a badge digit 12x20 (1KB). So
 *  the ordinary couple of dozen is around half a megabyte, the 370-label
 *  pathological mix is 5.2MB, and 384 sprites all of them ally names, which
 *  nothing can actually ask for, would be 8.1MB: the same class as a handful of
 *  cached zone terrain canvases. (370 is the worst case the realm grid brought:
 *  more zones means more POI labels and more overworld doors, and the quest
 *  tables grew with them. tests/text_sprite_cache.ts derives it from content.) */
export const TEXT_SPRITE_LIMIT = 384;

// Slack around the measured ink on every side, so glyph antialiasing is never
// clipped. The outline's own reach is added on top (see SPRITE_MITER_LIMIT).
const SPRITE_PADDING = 2;
// The outline's join style, capped, and the ONLY reason the padding below is not
// simply half the line width. A stroke straddles its path, so a straight run
// reaches lineWidth/2 past the ink measureText reports, but a MITERED join at a
// sharp glyph apex reaches miterLimit/2 line widths: at the canvas default of 10
// that is 15px for a 3px outline, which would cost 17px of padding on every side
// of every sprite to hold, so the box was sized for the straight run and clipped
// the apex right off instead. Measured in Chrome, an uncapped 'M' lost 5px of its
// apex at bold 13px sans-serif and 3px at bold 13px Arial. This is not
// hypothetical on the fonts the map names, because they carry no generic fallback
// (bold 13px Georgia, not Georgia, serif), so a platform without Georgia (Android,
// most Linux) substitutes its default standard font, which is a sans.
// Capping at 8 leaves Georgia at every size the map uses BIT-IDENTICAL to an
// uncapped strokeText (its worst extension is 7px, ratio 4.7, over every ASCII
// letter plus Cyrillic, CJK and diacritics), and so are Times New Roman, Verdana
// and Tahoma. Only the sharper substituted-sans apex changes, and it changes from
// clipped to bevelled, which is the better of the two. The reach is then bounded
// at exactly what the padding reserves, so no font can clip its own outline.
const SPRITE_MITER_LIMIT = 8;
// Fallbacks for platforms whose TextMetrics omits the actualBoundingBox* family
// (older WebKit, and the fake contexts the tests drive this with): derive the
// box from the advance width plus the font's px size. Georgia's descender sits
// near 0.22em, so 0.3 leaves room without a second measurement.
const FALLBACK_DESCENT_RATIO = 0.3;
const FALLBACK_FONT_PX = 12;
// The anchor a sprite rasterizes and reports its origin against. Measurement and
// draw MUST agree on both (see measureInk).
const SPRITE_ALIGN = 'center';
const SPRITE_BASELINE = 'alphabetic';

/**
 * A bounded per-(font, fill, outline, text) cache of rasterized labels. One
 * instance per painter; the painter calls `beginRedraw` once per redraw and
 * `draw` per label.
 */
export class TextSpriteCache {
  // Insertion order IS the LRU order: a cache hit re-inserts, so the oldest
  // live key is always the front of the iteration.
  private readonly sprites = new Map<string, TextSprite>();

  /** Live sprite count. */
  get size(): number {
    return this.sprites.size;
  }

  /** Drop every sprite. The caller owns the reason: the map painter calls this on
   *  a language switch, where every label re-resolves to a new string and the old
   *  rasters would otherwise sit in the budget until LRU worked them out. */
  clear(): void {
    this.sprites.clear();
  }

  /** Open a redraw: trim back to the budget, oldest first. Called BEFORE the
   *  redraw's draws so a label-heavy redraw can overshoot rather than thrash
   *  (see the header). */
  beginRedraw(): void {
    for (const key of this.sprites.keys()) {
      if (this.sprites.size <= TEXT_SPRITE_LIMIT) return;
      this.sprites.delete(key);
    }
  }

  /**
   * Draw `text` centered on (x, y) along the alphabetic baseline: exactly where
   * `ctx.textAlign = 'center'` plus strokeText + fillText at (x, y) would put
   * it, as one blit of a cached sprite. The blitted sprite carries its own font,
   * alignment, baseline, colors and outline width, so this reads NO text state
   * off `ctx` and leaves none behind.
   *
   * ROUNDED, and that is load-bearing rather than cosmetic: marker positions are
   * continuous floats, and a fractional drawImage destination is RESAMPLED.
   * Measured in Chrome across sub-pixel phases 0.2 to 0.8, blitting a 16x16
   * glyph sprite: fractional with imageSmoothingEnabled OFF stays crisp (35 ink
   * pixels, 5 fully solid, at every phase) but fractional with smoothing ON
   * collapses to 53 ink and ZERO fully solid, i.e. mush. Rounded, both settings
   * give the identical 35/5. Callers that leave smoothing ON (map_window_painter
   * does, for its terrain blit) land in the mush case unrounded, so rounding is
   * what stops legibility depending on an unrelated setting several lines away.
   *
   * The tradeoff, deliberately taken: a label now snaps to whole pixels where
   * fillText advanced it in quarter-pixel steps.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    style: TextSpriteStyle,
  ): void {
    // fillText('') draws nothing; skip before minting a cache entry for it.
    if (text === '') return;
    const sprite = this.sprite(text, style);
    if (!sprite) return;
    ctx.drawImage(sprite.canvas, Math.round(x - sprite.originX), Math.round(y - sprite.originY));
  }

  private sprite(text: string, style: TextSpriteStyle): TextSprite | null {
    const key = spriteKey(text, style);
    const cached = this.sprites.get(key);
    if (cached) {
      // Re-insert so the iteration order stays least-recently-used first.
      this.sprites.delete(key);
      this.sprites.set(key, cached);
      return cached;
    }
    const sprite = rasterize(text, style);
    // A transient 2D-context failure must not be cached: freezing a blank canvas
    // would hide that label for the rest of the session. Skipping this redraw's
    // draw self-heals on the next one.
    if (!sprite) return null;
    // Same rule for a label rasterized before the stylesheet applied: the caller
    // resolves '' for every color token then, and '' is an invalid fillStyle the
    // canvas ignores, so the sprite would freeze in the default black. Draw it
    // this redraw (exactly what the inline fillText did on that frame) but never
    // cache it.
    if (style.fill !== '' && style.stroke !== '') this.sprites.set(key, sprite);
    return sprite;
  }
}

// The outline width a style actually draws at, which is what both the key and the
// padding must agree on. A canvas IGNORES `lineWidth = 0` (it is not a valid
// value), leaving the context default of 1, so a style that names a stroke but no
// width strokes at 1px and has to be padded and keyed for 1px, not for 0.
function outlineWidth(style: TextSpriteStyle): number {
  return style.stroke === undefined ? 0 : (style.lineWidth ?? 1);
}

// The cache key. `text` goes LAST so no separator collision is possible whatever
// the label says, and the separator is a newline because neither a font
// shorthand nor a resolved CSS color can contain one (a space could:
// `rgb(255 209 0)`). The outlined flag is its own field so a fill-only label can
// never alias one whose outline token has not resolved yet ('').
function spriteKey(text: string, style: TextSpriteStyle): string {
  const outlined = style.stroke === undefined ? 'flat' : 'outlined';
  const stroke = style.stroke ?? '';
  return [style.font, style.fill, outlined, stroke, outlineWidth(style), text].join('\n');
}

// Rasterize one label into its own canvas, or null when the 2D context fails.
function rasterize(text: string, style: TextSpriteStyle): TextSprite | null {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const outline = outlineWidth(style);
  // How far the outline can reach past the fill ink measureText reports: half the
  // line width for a straight run, and up to SPRITE_MITER_LIMIT halves at a
  // mitered glyph apex, which is the case that actually governs.
  const pad = Math.ceil((outline * SPRITE_MITER_LIMIT) / 2) + SPRITE_PADDING;
  const ink = measureInk(ctx, text, style.font);
  // originX/originY are where the caller's anchor sits inside the sprite: the ink
  // box grown by the padding on the left and above.
  const originX = Math.ceil(ink.left) + pad;
  const originY = Math.ceil(ink.ascent) + pad;
  // Assigning width/height RESETS every context property (and clears the
  // canvas), so every draw setting below is applied after the resize.
  canvas.width = Math.max(1, originX + Math.ceil(ink.right) + pad);
  canvas.height = Math.max(1, originY + Math.ceil(ink.descent) + pad);
  ctx.font = style.font;
  ctx.textAlign = SPRITE_ALIGN;
  ctx.textBaseline = SPRITE_BASELINE;
  if (style.stroke !== undefined) {
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = outline;
    // Cap the join BEFORE stroking: this is what makes `pad` above a real bound
    // rather than a hope, so the two must never drift apart.
    ctx.miterLimit = SPRITE_MITER_LIMIT;
    ctx.strokeText(text, originX, originY);
  }
  ctx.fillStyle = style.fill;
  ctx.fillText(text, originX, originY);
  return { canvas, originX, originY };
}

// Ink extents around the anchor the sprite is drawn on. TWO rules keep a sprite
// from clipping its own label, and both are load-bearing:
//
//  1. Measure under the SAME textAlign and textBaseline the draw uses. The actual
//     bounding box is reported relative to the alignment point, so measuring
//     under the default 'start' and drawing under 'center' reports a box that
//     starts at the anchor while the glyphs run half their width to its LEFT, and
//     the sprite clips exactly that half away.
//  2. Take the UNION of the reported ink box and the plain advance/em box. That
//     makes rule 1 a tightness optimization rather than a correctness dependency:
//     a platform that ignores textAlign in its metrics, or omits the
//     actualBoundingBox family entirely (older WebKit), gets a box that is a
//     little roomy instead of one that cuts the label in half.
function measureInk(ctx: CanvasRenderingContext2D, text: string, font: string): TextInk {
  ctx.font = font;
  ctx.textAlign = SPRITE_ALIGN;
  ctx.textBaseline = SPRITE_BASELINE;
  const m: Partial<TextMetrics> | undefined = ctx.measureText(text);
  const half = finite(m?.width, 0) / 2;
  const px = fontPx(font);
  const descent = px * FALLBACK_DESCENT_RATIO;
  return {
    left: Math.max(half, finite(m?.actualBoundingBoxLeft, half)),
    right: Math.max(half, finite(m?.actualBoundingBoxRight, half)),
    ascent: Math.max(px, finite(m?.actualBoundingBoxAscent, px)),
    descent: Math.max(descent, finite(m?.actualBoundingBoxDescent, descent)),
  };
}

function finite(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

// The px size out of a CSS shorthand font string ('bold 13px Georgia'), for the
// metrics fallback only.
function fontPx(font: string): number {
  const match = /(\d+(?:\.\d+)?)px/.exec(font);
  return match ? Number(match[1]) : FALLBACK_FONT_PX;
}
