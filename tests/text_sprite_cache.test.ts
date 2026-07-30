// Behavior pins for the bounded label-sprite cache (src/ui/text_sprite_cache.ts).
//
// Everything here is driven through a fake document + fake 2D context (the
// tests/minimap_painter.test.ts idiom), never a source-substring scan: the pins
// are the rasterized ink, the sprite geometry, the whole-pixel blit destination,
// the cache identity, and the eviction policy.
//
// The fake canvas mirrors the one real-canvas behavior this module depends on:
// assigning width or height RESETS the context state and clears the surface. A
// rasterizer that set its font before sizing would therefore record its ink
// under the reset defaults, and the geometry/ink pins below would fail.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DUNGEON_LIST, QUESTS, ZONES } from '../src/sim/data';
import { overworldDungeonPortals } from '../src/ui/map_dungeon_portals';
import { TEXT_SPRITE_LIMIT, TextSpriteCache } from '../src/ui/text_sprite_cache';

/** One recorded text draw into a sprite's own context, with the state it used. */
interface FakeInk {
  op: 'fill' | 'stroke';
  text: string;
  x: number;
  y: number;
  font: string;
  color: string;
  align: string;
  baseline: string;
  lineWidth: number;
  /** The join cap in force. A mitered apex reaches miterLimit/2 line widths past
   *  the ink, so this is what makes the sprite's padding a real bound. */
  miterLimit: number;
}

interface FakeSprite {
  width: number;
  height: number;
  ink: FakeInk[];
  /** Every measureText, as `${font}|${align}|${baseline}|${text}`. */
  measured: string[];
  getContext(kind: string): unknown;
}

interface Trace {
  /** Every canvas minted through document.createElement('canvas'). */
  sprites: FakeSprite[];
  /** Every 3-argument drawImage onto the target context. */
  blits: Array<{ sprite: FakeSprite; dx: number; dy: number }>;
  /** Swapped per test to exercise the metrics flavors. Takes the alignment the
   *  module measured under, exactly as a real browser's metrics depend on it. */
  metrics: (text: string, font: string, align: string) => Partial<TextMetrics>;
  /** When false, every sprite's getContext('2d') returns null. */
  spriteContext: boolean;
}

// Canvas defaults a real context resets to when width/height is assigned.
const DEFAULT_FONT = '10px sans-serif';
const DEFAULT_COLOR = '#000000';
// The canvas default join cap, which is exactly the one the module must NOT
// leave in force: at 10, a mitered apex on a 3px outline reaches 15px past the
// ink, well past any padding a sprite can afford.
const DEFAULT_MITER_LIMIT = 10;

/** Metrics like a modern browser's: the actual bounding box is reported relative
 *  to the CURRENT textAlign, so the same text measures differently depending on
 *  the alignment in force. Half the font size per character keeps the arithmetic
 *  checkable by hand; the ascent deliberately exceeds the font size, the way a
 *  tall glyph does, so the union with the em box stays observable. */
function boundingBoxMetrics(text: string, font: string, align: string): Partial<TextMetrics> {
  const px = fontPx(font);
  const width = text.length * px * 0.5;
  const anchored = align === 'center' ? width / 2 : 0;
  return {
    width,
    actualBoundingBoxLeft: anchored,
    actualBoundingBoxRight: width - anchored,
    actualBoundingBoxAscent: px * 1.2,
    actualBoundingBoxDescent: px * 0.25,
  };
}

/** Metrics from a platform that reports only the advance width (older WebKit). */
function widthOnlyMetrics(text: string, font: string): Partial<TextMetrics> {
  return { width: text.length * fontPx(font) * 0.5 };
}

/** Metrics from a platform that ignores textAlign and always anchors its box at
 *  the start of the run. The union rule has to absorb this without clipping. */
function startAnchoredMetrics(text: string, font: string): Partial<TextMetrics> {
  return boundingBoxMetrics(text, font, 'start');
}

/** Metrics for a run whose ink sits WELL INSIDE the em box, which is the case the
 *  ascent's em-box floor exists for: every other fixture here reports an ascent
 *  above the font size, so without this one the floor never wins and could be
 *  deleted with the suite green. */
function shortInkMetrics(text: string, font: string, align: string): Partial<TextMetrics> {
  return { ...boundingBoxMetrics(text, font, align), actualBoundingBoxAscent: fontPx(font) * 0.5 };
}

// Matches the module's own FALLBACK_FONT_PX so a font string with no px size
// gives the fixtures and the module the same arithmetic.
function fontPx(font: string): number {
  return Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 12);
}

function makeFakeSprite(trace: Trace): FakeSprite {
  const ctx = {
    font: DEFAULT_FONT,
    fillStyle: DEFAULT_COLOR,
    strokeStyle: DEFAULT_COLOR,
    lineWidth: 1,
    miterLimit: DEFAULT_MITER_LIMIT,
    textAlign: 'start',
    textBaseline: 'alphabetic',
    measureText(text: string): Partial<TextMetrics> {
      sprite.measured.push(`${ctx.font}|${ctx.textAlign}|${ctx.textBaseline}|${text}`);
      return trace.metrics(text, ctx.font, ctx.textAlign);
    },
    fillText(text: string, x: number, y: number): void {
      sprite.ink.push({ op: 'fill', text, x, y, ...state(ctx.fillStyle) });
    },
    strokeText(text: string, x: number, y: number): void {
      sprite.ink.push({ op: 'stroke', text, x, y, ...state(ctx.strokeStyle) });
    },
  };
  const state = (color: string): Omit<FakeInk, 'op' | 'text' | 'x' | 'y'> => ({
    font: ctx.font,
    color,
    align: ctx.textAlign,
    baseline: ctx.textBaseline,
    lineWidth: ctx.lineWidth,
    miterLimit: ctx.miterLimit,
  });
  const sprite = {
    ink: [] as FakeInk[],
    measured: [] as string[],
    getContext: (kind: string): unknown =>
      kind === '2d' && trace.spriteContext ? (ctx as unknown) : null,
  } as unknown as FakeSprite;
  // A real canvas drops its context state and its pixels on a size assignment.
  let w = 300;
  let h = 150;
  const resize = (): void => {
    ctx.font = DEFAULT_FONT;
    ctx.fillStyle = DEFAULT_COLOR;
    ctx.strokeStyle = DEFAULT_COLOR;
    ctx.lineWidth = 1;
    ctx.miterLimit = DEFAULT_MITER_LIMIT;
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
    sprite.ink.length = 0;
  };
  Object.defineProperty(sprite, 'width', {
    get: () => w,
    set: (v: number) => {
      w = v;
      resize();
    },
  });
  Object.defineProperty(sprite, 'height', {
    get: () => h,
    set: (v: number) => {
      h = v;
      resize();
    },
  });
  trace.sprites.push(sprite);
  return sprite;
}

function newTrace(): Trace {
  return { sprites: [], blits: [], metrics: boundingBoxMetrics, spriteContext: true };
}

function installDocument(trace: Trace): void {
  vi.stubGlobal('document', {
    createElement(tag: string): unknown {
      if (tag !== 'canvas') throw new Error(`unexpected createElement(${tag})`);
      return makeFakeSprite(trace);
    },
  });
}

/** The blit target: it records drawImage and nothing else, so a rasterizer that
 *  reached for the text API here would have to invent a method. */
function targetContext(trace: Trace): CanvasRenderingContext2D {
  return {
    drawImage(image: unknown, dx: number, dy: number): void {
      trace.blits.push({ sprite: image as FakeSprite, dx, dy });
    },
  } as unknown as CanvasRenderingContext2D;
}

const OUTLINED = { font: 'bold 12px Georgia', fill: 'ink', stroke: 'halo', lineWidth: 3 };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('text_sprite_cache: rasterize once, blit thereafter', () => {
  it('bakes the outline pass and the fill pass into one sprite, sized after measuring', () => {
    const trace = newTrace();
    installDocument(trace);
    const cache = new TextSpriteCache();

    cache.draw(targetContext(trace), 'AB', 100, 50, OUTLINED);

    expect(trace.sprites).toHaveLength(1);
    const sprite = trace.sprites[0];
    // 'AB' at 12px measured under 'center': advance 12, so left = right = 6;
    // ascent 14.4 (over the 12px em box, so the union takes it), descent 3 (under
    // the 3.6 em fallback, so the union takes that). The outline allowance is the
    // MITER reach, not half the width: pad = ceil(3 * 8 / 2) + 2 = 14, giving
    // originX = 6 + 14 = 20 and originY = ceil(14.4) + 14 = 29.
    expect(sprite.width).toBe(40); // 20 + ceil(6) + 14
    expect(sprite.height).toBe(47); // 29 + ceil(3.6) + 14
    // Measured under the same anchor it draws on: see the clipping trap below.
    expect(sprite.measured).toEqual(['bold 12px Georgia|center|alphabetic|AB']);
    // Both passes recorded AFTER the resize (the fake clears ink on resize), at
    // the sprite origin, centered on the alphabetic baseline.
    expect(sprite.ink).toEqual([
      {
        op: 'stroke',
        text: 'AB',
        x: 20,
        y: 29,
        font: 'bold 12px Georgia',
        color: 'halo',
        align: 'center',
        baseline: 'alphabetic',
        lineWidth: 3,
        // Capped BEFORE the stroke, and the same 8 the padding above is sized
        // from: at the canvas default of 10 a mitered apex outreaches the box.
        miterLimit: 8,
      },
      {
        op: 'fill',
        text: 'AB',
        x: 20,
        y: 29,
        font: 'bold 12px Georgia',
        color: 'ink',
        align: 'center',
        baseline: 'alphabetic',
        lineWidth: 3,
        miterLimit: 8,
      },
    ]);
  });

  it('blits the cached sprite on later redraws instead of rasterizing again', () => {
    const trace = newTrace();
    installDocument(trace);
    const cache = new TextSpriteCache();
    const ctx = targetContext(trace);

    cache.beginRedraw();
    cache.draw(ctx, 'Eastbrook', 10, 10, OUTLINED);
    cache.beginRedraw();
    cache.draw(ctx, 'Eastbrook', 20, 20, OUTLINED);
    cache.beginRedraw();
    cache.draw(ctx, 'Eastbrook', 30, 30, OUTLINED);

    expect(trace.sprites).toHaveLength(1);
    expect(trace.blits).toHaveLength(3);
    expect(trace.blits.every((b) => b.sprite === trace.sprites[0])).toBe(true);
    expect(cache.size).toBe(1);
  });

  it('skips the outline pass for a fill-only style', () => {
    const trace = newTrace();
    installDocument(trace);
    const cache = new TextSpriteCache();

    cache.draw(targetContext(trace), '7', 0, 0, { font: 'bold 12px Georgia', fill: 'gold' });

    expect(trace.sprites[0].ink.map((i) => i.op)).toEqual(['fill']);
    // No outline means no miter allowance: pad is the antialias slack only, so
    // originX = ceil(3) + 2 = 5 ('7' measures 6 wide at 12px). A fill has no
    // joins, so the cap is left at the canvas default rather than set.
    expect(trace.sprites[0].width).toBe(10);
    expect(trace.sprites[0].ink[0].miterLimit).toBe(DEFAULT_MITER_LIMIT);
  });

  it('draws nothing at all for empty text', () => {
    const trace = newTrace();
    installDocument(trace);
    const cache = new TextSpriteCache();

    cache.draw(targetContext(trace), '', 10, 10, OUTLINED);

    expect(trace.sprites).toEqual([]);
    expect(trace.blits).toEqual([]);
    expect(cache.size).toBe(0);
  });
});

describe('text_sprite_cache: the blit lands on the anchor, rounded', () => {
  it('rounds the destination to whole pixels', () => {
    const trace = newTrace();
    installDocument(trace);
    const cache = new TextSpriteCache();

    // origin is (20, 29) as computed above, so the raw destination would be
    // (80.4, 21.6): a fractional destination is resampled, which is mush when
    // the caller left imageSmoothingEnabled on.
    cache.draw(targetContext(trace), 'AB', 100.4, 50.6, OUTLINED);

    expect(trace.blits).toEqual([{ sprite: trace.sprites[0], dx: 80, dy: 22 }]);
  });

  it('keeps every destination integral across sub-pixel phases', () => {
    const trace = newTrace();
    installDocument(trace);
    const cache = new TextSpriteCache();
    const ctx = targetContext(trace);

    for (const phase of [0, 0.2, 0.4, 0.5, 0.6, 0.8]) {
      cache.draw(ctx, 'AB', 100 + phase, 50 + phase, OUTLINED);
    }

    // Value-pinned on BOTH axes, so a floor/ceil/trunc on either one fails here.
    expect(trace.blits.map((b) => b.dx)).toEqual([80, 80, 80, 81, 81, 81]);
    expect(trace.blits.map((b) => b.dy)).toEqual([21, 21, 21, 22, 22, 22]);
  });
});

describe('text_sprite_cache: cache identity', () => {
  it('gives every distinct text, fill, outline, width and font its own sprite', () => {
    const trace = newTrace();
    installDocument(trace);
    const cache = new TextSpriteCache();
    const ctx = targetContext(trace);

    cache.draw(ctx, 'AB', 0, 0, OUTLINED);
    cache.draw(ctx, 'AC', 0, 0, OUTLINED); // different text
    cache.draw(ctx, 'AB', 0, 0, { ...OUTLINED, fill: 'other' }); // different fill
    cache.draw(ctx, 'AB', 0, 0, { ...OUTLINED, stroke: 'other' }); // different outline
    cache.draw(ctx, 'AB', 0, 0, { ...OUTLINED, lineWidth: 1 }); // different width
    cache.draw(ctx, 'AB', 0, 0, { ...OUTLINED, font: 'bold 16px Georgia' }); // different font
    expect(trace.sprites).toHaveLength(6);

    // Re-requesting each one hits the cache.
    cache.draw(ctx, 'AB', 0, 0, OUTLINED);
    cache.draw(ctx, 'AC', 0, 0, OUTLINED);
    cache.draw(ctx, 'AB', 0, 0, { ...OUTLINED, fill: 'other' });
    cache.draw(ctx, 'AB', 0, 0, { ...OUTLINED, stroke: 'other' });
    cache.draw(ctx, 'AB', 0, 0, { ...OUTLINED, lineWidth: 1 });
    cache.draw(ctx, 'AB', 0, 0, { ...OUTLINED, font: 'bold 16px Georgia' });
    expect(trace.sprites).toHaveLength(6);
    expect(cache.size).toBe(6);
  });

  it('never aliases a fill-only label onto one whose outline token is unresolved', () => {
    const trace = newTrace();
    installDocument(trace);
    const cache = new TextSpriteCache();
    const ctx = targetContext(trace);

    // The two styles differ ONLY in stroke being absent vs present-but-unresolved:
    // same font, same fill, and both default to lineWidth 0, so the key's
    // dedicated outlined field is the only thing separating them.
    cache.draw(ctx, '7', 0, 0, { font: 'bold 12px Georgia', fill: 'gold' });
    cache.draw(ctx, '7', 0, 0, { font: 'bold 12px Georgia', fill: 'gold', stroke: '' });

    expect(trace.sprites).toHaveLength(2);
    expect(trace.sprites[0].ink.map((i) => i.op)).toEqual(['fill']);
    expect(trace.sprites[1].ink.map((i) => i.op)).toEqual(['stroke', 'fill']);
  });

  it('does not cache a sprite whose 2D context failed', () => {
    const trace = newTrace();
    trace.spriteContext = false;
    installDocument(trace);
    const cache = new TextSpriteCache();
    const ctx = targetContext(trace);

    cache.draw(ctx, 'AB', 0, 0, OUTLINED);
    expect(trace.blits).toEqual([]); // nothing to blit, rather than a blank box
    expect(cache.size).toBe(0);

    // Self-heals: the next redraw retries instead of serving a frozen blank.
    trace.spriteContext = true;
    cache.draw(ctx, 'AB', 0, 0, OUTLINED);
    expect(trace.sprites).toHaveLength(2);
    expect(trace.blits).toHaveLength(1);
    expect(cache.size).toBe(1);
  });

  it('draws but never caches a label rasterized before the color tokens resolved', () => {
    const trace = newTrace();
    installDocument(trace);
    const cache = new TextSpriteCache();
    const ctx = targetContext(trace);

    // What resolveColors returns before the stylesheet applies: '' for every token.
    cache.draw(ctx, 'AB', 0, 0, { font: 'bold 12px Georgia', fill: '', stroke: '', lineWidth: 3 });
    expect(trace.blits).toHaveLength(1); // still drawn this redraw
    expect(cache.size).toBe(0); // but never frozen in the default black

    cache.draw(ctx, 'AB', 0, 0, { font: 'bold 12px Georgia', fill: '', stroke: '', lineWidth: 3 });
    expect(trace.sprites).toHaveLength(2);

    // An unresolved outline alone is enough to refuse the cache.
    cache.draw(ctx, 'AB', 0, 0, {
      font: 'bold 12px Georgia',
      fill: 'ink',
      stroke: '',
      lineWidth: 3,
    });
    expect(cache.size).toBe(0);

    // And so is an unresolved FILL alone. Pinned on its own, because the fixture
    // above sets both at once and the outline arm alone satisfies it: with only
    // that case the fill half of the guard could be deleted with this file green.
    cache.draw(ctx, 'AB', 0, 0, {
      font: 'bold 12px Georgia',
      fill: '',
      stroke: 'halo',
      lineWidth: 3,
    });
    expect(cache.size).toBe(0);

    // Including on the fill-only shape the quest badges actually ship, where the
    // outline half of the guard is vacuously true (stroke is undefined, never
    // ''), so the fill check is the ONLY thing standing between a pre-stylesheet
    // redraw and a black digit frozen in for the session.
    cache.draw(ctx, '7', 0, 0, { font: 'bold 12px Georgia', fill: '' });
    expect(cache.size).toBe(0);

    // Once both resolve, it caches.
    cache.draw(ctx, 'AB', 0, 0, OUTLINED);
    expect(cache.size).toBe(1);
  });
});

describe('text_sprite_cache: the bound and its eviction', () => {
  it('ships the budget it documents', () => {
    // Pinned to the literal: every other assertion here is parameterized on the
    // constant, so without this the budget could change with the suite green.
    expect(TEXT_SPRITE_LIMIT).toBe(384);
  });

  it('stays above the largest label set one redraw can ask for', () => {
    // The budget is only thrash-proof while it exceeds the worst case, and every
    // term of that worst case lives somewhere else: two server caps and the
    // content tables. Recompute them here so raising a cap, adding quests, or
    // authoring a wider zone fails HERE rather than silently degrading the map
    // into a rasterize-every-redraw loop on the unthrottled drag-pan path.
    // Comments stripped first, so a commented-out declaration above the real one
    // cannot satisfy the regex (the repo's raw-source pin rule).
    const social = readFileSync(new URL('../server/social.ts', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    const cap = (name: string): number => {
      const match = new RegExp(`const ${name} = (\\d+);`).exec(social);
      if (!match) throw new Error(`server/social.ts no longer declares ${name}`);
      return Number(match[1]);
    };
    const allyNames = cap('FRIEND_LIMIT') + cap('GUILD_MEMBER_LIMIT');
    // The hard ceiling, deliberately: nothing caps the active quest log, so every
    // quest in the content tables can in principle carry a badge number at once.
    const badgeDigits = Object.keys(QUESTS).length;
    const poiLabels = Math.max(...ZONES.map((zone) => zone.pois.length));
    const portalNames = Math.max(
      ...ZONES.map((zone) => overworldDungeonPortals(DUNGEON_LIST, zone.zMin, zone.zMax).length),
    );
    const zoneTitle = 1;
    const questGiverGlyphs = 2;

    const worstCase =
      allyNames + badgeDigits + poiLabels + portalNames + zoneTitle + questGiverGlyphs;
    // Each term on its own, so a single one degenerating to zero under a refactor
    // cannot hide behind another one's growth. Without these, the one-sided check
    // at the bottom passes just as happily on a worst case of 3.
    expect(allyNames, 'ally names: the two server caps').toBe(150);
    expect(badgeDigits, 'badge digits: one per quest').toBeGreaterThan(0);
    expect(poiLabels, 'POI labels: the widest zone').toBeGreaterThan(0);
    expect(portalNames, 'portal names: the zone with the most doors').toBeGreaterThan(0);
    // And the total may not silently shrink below the figure the module header
    // quotes, which is the other direction the check below cannot see.
    expect(
      worstCase,
      'the header quotes 370; a SMALLER total means a term broke',
    ).toBeGreaterThanOrEqual(370);
    expect(
      TEXT_SPRITE_LIMIT,
      `worst case grew to ${worstCase}: raise TEXT_SPRITE_LIMIT above it, or the map thrashes`,
    ).toBeGreaterThanOrEqual(worstCase);
  });

  it('keys a label containing the key separator apart from its prefix', () => {
    const trace = newTrace();
    installDocument(trace);
    const cache = new TextSpriteCache();
    const ctx = targetContext(trace);

    // Ally names are player-supplied, so a label can carry whatever the key uses
    // as a separator. Text is the LAST key field for exactly this reason: a
    // newline in a label appends to the key rather than shifting the fields that
    // would have followed it.
    cache.draw(ctx, 'A', 0, 0, OUTLINED);
    cache.draw(ctx, 'A\nbold 12px Georgia', 0, 0, OUTLINED);
    cache.draw(ctx, 'A\nbold 12px Georgia', 0, 0, OUTLINED);

    expect(trace.sprites).toHaveLength(2);
    expect(trace.blits).toHaveLength(3);

    // And the separator has to actually be there. Text is keyed immediately after
    // the outline width, so these two differ only in where that boundary falls:
    // a key built by plain concatenation reads both as ...312 and serves the
    // second label from the first one's sprite.
    cache.draw(ctx, '12', 0, 0, { ...OUTLINED, lineWidth: 3 });
    cache.draw(ctx, '2', 0, 0, { ...OUTLINED, lineWidth: 31 });
    expect(trace.sprites).toHaveLength(4);
  });

  it('drops every sprite on clear, so a language switch carries no dead rasters', () => {
    const trace = newTrace();
    installDocument(trace);
    const cache = new TextSpriteCache();
    const ctx = targetContext(trace);

    cache.draw(ctx, 'Eastbrook Vale', 0, 0, OUTLINED);
    cache.draw(ctx, 'The Hollow Crypt', 0, 0, OUTLINED);
    expect(cache.size).toBe(2);

    cache.clear();
    expect(cache.size).toBe(0);
    // And the next draw genuinely re-rasterizes rather than serving a stale hit.
    cache.draw(ctx, 'Eastbrook Vale', 0, 0, OUTLINED);
    expect(trace.sprites).toHaveLength(3);
  });

  it('trims to the budget at the redraw boundary, least recently used first', () => {
    const trace = newTrace();
    installDocument(trace);
    const cache = new TextSpriteCache();
    const ctx = targetContext(trace);
    const over = 3;

    cache.beginRedraw();
    for (let i = 0; i < TEXT_SPRITE_LIMIT + over; i++) {
      cache.draw(ctx, `L${i}`, 0, 0, OUTLINED);
    }
    // No eviction DURING a redraw, so the redraw keeps every sprite it drew.
    expect(cache.size).toBe(TEXT_SPRITE_LIMIT + over);
    // Touching the oldest label makes it the most recently used one.
    cache.draw(ctx, 'L0', 0, 0, OUTLINED);
    expect(trace.sprites).toHaveLength(TEXT_SPRITE_LIMIT + over);

    cache.beginRedraw();
    expect(cache.size).toBe(TEXT_SPRITE_LIMIT);

    // L1..L3 were the least recently used, so they are the ones that went.
    const before = trace.sprites.length;
    cache.draw(ctx, 'L1', 0, 0, OUTLINED);
    cache.draw(ctx, 'L2', 0, 0, OUTLINED);
    cache.draw(ctx, 'L3', 0, 0, OUTLINED);
    expect(trace.sprites).toHaveLength(before + over);
    // The touched one survived, and so did everything after the evicted run.
    cache.draw(ctx, 'L0', 0, 0, OUTLINED);
    cache.draw(ctx, 'L4', 0, 0, OUTLINED);
    cache.draw(ctx, `L${TEXT_SPRITE_LIMIT + over - 1}`, 0, 0, OUTLINED);
    expect(trace.sprites).toHaveLength(before + over);
  });

  it('leaves the cache at the budget when a redraw asks for nothing new', () => {
    const trace = newTrace();
    installDocument(trace);
    const cache = new TextSpriteCache();
    const ctx = targetContext(trace);

    for (let i = 0; i < TEXT_SPRITE_LIMIT; i++) cache.draw(ctx, `L${i}`, 0, 0, OUTLINED);
    cache.beginRedraw();
    expect(cache.size).toBe(TEXT_SPRITE_LIMIT);
    cache.beginRedraw();
    expect(cache.size).toBe(TEXT_SPRITE_LIMIT);
  });

  it('rasterizes a label-heavy redraw once per label rather than thrashing', () => {
    const trace = newTrace();
    installDocument(trace);
    const cache = new TextSpriteCache();
    const ctx = targetContext(trace);
    const labels = TEXT_SPRITE_LIMIT + 5;

    // One redraw whose label count exceeds the budget, each label drawn twice
    // (a map can draw the same name for two markers). Evicting mid-redraw would
    // re-rasterize on the second pass, which is worse than the fillText this
    // replaces; the trim happens at the boundary instead.
    cache.beginRedraw();
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < labels; i++) cache.draw(ctx, `L${i}`, 0, 0, OUTLINED);
    }

    expect(trace.sprites).toHaveLength(labels);
    expect(trace.blits).toHaveLength(labels * 2);
    // The overshoot is reclaimed at the next boundary.
    cache.beginRedraw();
    expect(cache.size).toBe(TEXT_SPRITE_LIMIT);
  });
});

describe('text_sprite_cache: the sprite box never clips its own label', () => {
  // The bug this suite exists to prevent: the actual bounding box is reported
  // relative to the CURRENT textAlign. Measuring under the default 'start' and
  // drawing under 'center' sizes the box as if the run started at the anchor,
  // while the glyphs actually run half their advance width to its LEFT, so the
  // sprite cuts the first half of every label away. It looks like a plausible
  // label, which is why only a real browser or this pin catches it.
  it('measures under the same alignment and baseline it draws with', () => {
    const trace = newTrace();
    installDocument(trace);
    const cache = new TextSpriteCache();

    cache.draw(targetContext(trace), 'Eastbrook Vale', 100, 50, OUTLINED);

    expect(trace.sprites[0].measured).toEqual([
      'bold 12px Georgia|center|alphabetic|Eastbrook Vale',
    ]);
  });

  it('keeps the anchor at least half the advance width in from the left edge', () => {
    for (const metrics of [boundingBoxMetrics, widthOnlyMetrics, startAnchoredMetrics]) {
      const trace = newTrace();
      trace.metrics = metrics;
      installDocument(trace);
      const cache = new TextSpriteCache();

      cache.draw(targetContext(trace), 'Eastbrook Vale', 100, 50, OUTLINED);

      // 14 characters at 12px measure 84 wide, so a centered draw needs 42px of
      // sprite to the left of the anchor plus the outline padding.
      const originX = 100 - trace.blits[0].dx;
      expect(originX).toBeGreaterThanOrEqual(42 + 14);
      expect(trace.sprites[0].width - originX).toBeGreaterThanOrEqual(42 + 14);
      vi.unstubAllGlobals();
    }
  });

  it('takes the union of the reported ink box and the advance box', () => {
    const trace = newTrace();
    trace.metrics = startAnchoredMetrics;
    installDocument(trace);
    const cache = new TextSpriteCache();

    cache.draw(targetContext(trace), 'AB', 100, 50, OUTLINED);

    // Start-anchored metrics claim left 0 and right 12. The union floors both at
    // half the advance (6), so the origin is the same 20 as the centered case and
    // only the right edge is roomier: 20 + 12 + 14.
    expect(trace.blits[0].dx).toBe(80);
    expect(trace.sprites[0].width).toBe(46);
  });
});

describe('text_sprite_cache: hostile and partial metrics', () => {
  it('never sizes a canvas below one pixel, whatever the platform reports', () => {
    for (const metrics of [
      () => ({}),
      () => ({ width: 0 }),
      () => ({
        width: 0,
        actualBoundingBoxLeft: -5,
        actualBoundingBoxRight: -5,
        actualBoundingBoxAscent: -5,
        actualBoundingBoxDescent: -5,
      }),
      () => ({ width: Number.NaN, actualBoundingBoxAscent: Number.POSITIVE_INFINITY }),
    ]) {
      const trace = newTrace();
      trace.metrics = metrics;
      installDocument(trace);
      new TextSpriteCache().draw(targetContext(trace), 'AB', 100, 50, OUTLINED);

      const sprite = trace.sprites[0];
      expect(sprite.width).toBeGreaterThanOrEqual(1);
      expect(sprite.height).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(trace.blits[0].dx)).toBe(true);
      expect(Number.isInteger(trace.blits[0].dy)).toBe(true);
      vi.unstubAllGlobals();
    }
  });

  it('rejects a non-finite metric per field rather than sizing from it', () => {
    const trace = newTrace();
    trace.metrics = () => ({
      width: Number.NaN,
      actualBoundingBoxAscent: Number.POSITIVE_INFINITY,
    });
    installDocument(trace);

    new TextSpriteCache().draw(targetContext(trace), 'AB', 100, 50, OUTLINED);

    // NaN width falls back to 0 and the infinite ascent to the 12px font size;
    // sizing from either would give a NaN or an enormous canvas.
    expect(trace.sprites[0].width).toBe(28);
    expect(trace.sprites[0].height).toBe(44);
  });

  it('takes each bounding-box field independently, not all or nothing', () => {
    const trace = newTrace();
    trace.metrics = () => ({ width: 20, actualBoundingBoxAscent: 30 });
    installDocument(trace);

    new TextSpriteCache().draw(targetContext(trace), 'AB', 100, 50, OUTLINED);

    // The reported ascent (30) is used; left, right and descent fall back to half
    // the advance (10) and the 3.6 em descent.
    expect(trace.sprites[0].width).toBe(48); // (10 + 14) + 10 + 14
    expect(trace.sprites[0].height).toBe(62); // (30 + 14) + ceil(3.6) + 14
  });

  it('pads and strokes at 1px when a style names an outline but no width', () => {
    // A canvas IGNORES lineWidth = 0, so such a style strokes at the context
    // default of 1. The key and the padding have to follow the width that is
    // actually drawn, not the 0 the style literally carries.
    const trace = newTrace();
    installDocument(trace);

    new TextSpriteCache().draw(targetContext(trace), 'AB', 100, 50, {
      font: 'bold 12px Georgia',
      fill: 'ink',
      stroke: 'halo',
    });

    const sprite = trace.sprites[0];
    expect(sprite.ink.map((i) => i.lineWidth)).toEqual([1, 1]);
    // pad = ceil(1 * 8 / 2) + 2 = 6, so originX = ceil(6) + 6 = 12.
    expect(sprite.width).toBe(24); // 12 + ceil(6) + 6
  });

  it('reads the px size out of the shorthand shapes a font string can take', () => {
    // Only the fallback path consumes this, but it consumes it for the SIZE of
    // the sprite, so a mis-parse is a clipped or a bloated label.
    const cases: Array<{ font: string; height: number }> = [
      // A fractional size keeps its fraction: ascent 13.5 -> ceil 14.
      { font: 'bold 13.5px Georgia', height: 14 + 14 + Math.ceil(13.5 * 0.3) + 14 },
      // A line-height shorthand takes the SIZE, not the ratio after the slash.
      { font: 'bold 13px/1.2 Georgia', height: 13 + 14 + Math.ceil(13 * 0.3) + 14 },
      // A family whose name contains the units does not win over the real size.
      { font: 'bold 15px "Px Grotesk"', height: 15 + 14 + Math.ceil(15 * 0.3) + 14 },
    ];
    for (const { font, height } of cases) {
      const trace = newTrace();
      trace.metrics = () => ({ width: 20 });
      installDocument(trace);

      new TextSpriteCache().draw(targetContext(trace), 'AB', 100, 50, { ...OUTLINED, font });

      expect(trace.sprites[0].height, font).toBe(height);
      vi.unstubAllGlobals();
    }
  });

  it('never sizes below the em box when the reported ink sits inside it', () => {
    const trace = newTrace();
    trace.metrics = shortInkMetrics;
    installDocument(trace);

    new TextSpriteCache().draw(targetContext(trace), 'AB', 100, 50, OUTLINED);

    // Reported ascent is 6 at 12px, but the box is floored at the em size, so
    // originY is 12 + 14 = 26 rather than 6 + 14 = 20. Taking the report at face
    // value would clip a tall glyph in the same run, which is what a mixed-script
    // label is (the Latin cap height and a CJK glyph's do not agree).
    expect(trace.sprites[0].height).toBe(44); // (12 + 14) + ceil(3.6) + 14
    expect(trace.blits[0].dy).toBe(24); // 50 - 26
  });

  it('falls back to a nominal font size when the font string carries no px', () => {
    const sized = newTrace();
    sized.metrics = () => ({ width: 20 });
    installDocument(sized);
    new TextSpriteCache().draw(targetContext(sized), 'AB', 100, 50, {
      ...OUTLINED,
      font: 'bold 16px Georgia',
    });
    expect(sized.sprites[0].height).toBe(49); // (16 + 14) + ceil(4.8) + 14
    vi.unstubAllGlobals();

    const unsized = newTrace();
    unsized.metrics = () => ({ width: 20 });
    installDocument(unsized);
    new TextSpriteCache().draw(targetContext(unsized), 'AB', 100, 50, {
      ...OUTLINED,
      font: 'small-caps Georgia',
    });
    expect(unsized.sprites[0].height).toBe(44); // (12 + 14) + ceil(3.6) + 14
  });
});

describe('text_sprite_cache: stays a host-agnostic painter helper', () => {
  // This module ends in neither _view/_core nor _painter, so it is swept by
  // NEITHER the pure-core gate nor the painter gate, and it used to carry the
  // whole host-agnosticism scan itself. That scan now lives where it cannot be
  // forgotten by the next module of this shape: the src/ui module-classification
  // sweep in tests/architecture.test.ts registers this file in
  // UI_PAINTER_HELPERS and enforces the forbidden hosts, the single sanctioned
  // document.createElement call, the deterministic-clock rule and the
  // no-literal-color rule against it.
  //
  // What stays here are the two pins that sweep deliberately does not make. It
  // applies the shared pure-core import rule (no three, no render/game/net, no
  // DOM-owning painter), which would happily allow a sibling ui import, while this
  // module imports NOTHING AT ALL, and staying that way is what lets a Vitest
  // drive it through a fake document with no module graph behind it. And it bounds
  // `document` to createElement calls without bounding HOW MANY, while this module
  // makes exactly one DOM call, which is the tighter thing worth keeping.
  const source = readFileSync(new URL('../src/ui/text_sprite_cache.ts', import.meta.url), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('imports nothing at all, so it cannot drift into the render or HUD graph', () => {
    expect(code.match(/^import\s/gm) ?? []).toEqual([]);
  });

  // The sweep bounds document access to createElement calls; it pins neither WHICH
  // element nor HOW MANY, and minting one offscreen canvas is the whole reason
  // this helper is allowed near the DOM at all.
  it('makes exactly one DOM call: the offscreen canvas it mints', () => {
    expect(code.match(/document\b/g) ?? []).toEqual(['document']);
    expect(code).toContain("document.createElement('canvas')");
  });
});

describe('text_sprite_cache: metrics fallback', () => {
  it('sizes from the advance width and font size when the bounding box is absent', () => {
    const trace = newTrace();
    trace.metrics = widthOnlyMetrics;
    installDocument(trace);
    const cache = new TextSpriteCache();

    cache.draw(targetContext(trace), 'AB', 100, 50, OUTLINED);

    // width 12 -> left = right = 6; ascent falls back to the 12px font size and
    // descent to 0.3 of it (3.6). pad = 14.
    const sprite = trace.sprites[0];
    expect(sprite.width).toBe(40); // (6 + 14) + 6 + 14
    expect(sprite.height).toBe(44); // (12 + 14) + ceil(3.6) + 14
    expect(trace.blits).toEqual([{ sprite, dx: 80, dy: 24 }]);
    // Still wide enough to hold a centered label: the anchor sits at least half
    // the advance width in from the left edge.
    expect(100 - trace.blits[0].dx).toBeGreaterThanOrEqual(6);
  });

  it('sizes a real box even when the platform reports no metrics at all', () => {
    const trace = newTrace();
    trace.metrics = () => ({});
    installDocument(trace);
    const cache = new TextSpriteCache();

    cache.draw(targetContext(trace), 'AB', 100, 50, OUTLINED);

    // Nothing to measure: width falls back to 0 so left = right = 0, ascent to
    // the 12px font size and descent to 0.3 of it. pad = 14.
    const sprite = trace.sprites[0];
    expect(sprite.width).toBe(28); // 14 + 0 + 14
    expect(sprite.height).toBe(44); // (12 + 14) + ceil(3.6) + 14
    expect(trace.blits).toEqual([{ sprite, dx: 86, dy: 24 }]);
  });
});
