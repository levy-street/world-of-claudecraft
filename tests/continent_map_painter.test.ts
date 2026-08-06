// No-magic-values + behavior guard for the continent-overview painter.
//
// The pure geometry is covered by tests/continent_map_view.test.ts. This suite
// (the sibling of tests/map_window_painter.test.ts) enforces the decentralized
// no-magic-values contract for this canvas painter and drives the real painter
// through a narrow fake 2D context so token selection is a behavior assertion,
// not a source-text guess. In most suites here the art plate never decodes (Image
// is stubbed to stay pending), so the painter takes its flat-rectangle fallback
// wash; the land-masked wash proper has its own suite below, on a fresh module
// graph, since the decoded plate is cached at continent_art module scope.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZONES } from '../src/sim/data';
import { ContinentMapPainter } from '../src/ui/continent_map_painter';
import { zoneDisplayName } from '../src/ui/entity_i18n';
import { t } from '../src/ui/i18n';
import type { IWorld } from '../src/world_api';

const painter = readFileSync(
  new URL('../src/ui/continent_map_painter.ts', import.meta.url),
  'utf8',
);
// Drop comments so prose can't create a false positive (mirrors architecture.test).
const code = painter.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
const tokens = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');

const CONTINENT_COLOR_TOKENS = [
  '--color-map-continent-ocean',
  '--color-map-label',
  '--color-map-outline',
  '--color-map-player',
  '--color-map-party-dead',
  '--color-map-region-hover-fill',
  '--color-map-region-current-fill',
  '--color-map-region-current-label',
];

// The classColor resolver every ContinentMapPainter call site now takes (issue
// 2652), mirroring how map_window_painter.test.ts stubs the same seam. Distinct
// per class so a color assertion is decisive rather than "some string".
const classColor = (cls: string): string => `color:${cls}`;

interface PaintTrace {
  fillRects: string[]; // fillStyle at each fillRect (ocean flood + fallback wash)
  // Every gradient minted on the map canvas (the letterbox depth grades), with
  // the endpoints and stops each was built from.
  gradients: Array<{ from: number[]; stops: Array<[number, string]> }>;
  strokeRects: string[]; // strokeStyle at each strokeRect (nothing draws one now)
  arcFills: string[]; // fillStyle at each arc fill (the you-are-here dot)
  labels: Array<{ text: string; color: string }>; // fillText + the fillStyle it used
  styleReads: string[];
}

function newTrace(): PaintTrace {
  return {
    fillRects: [],
    strokeRects: [],
    arcFills: [],
    labels: [],
    gradients: [],
    styleReads: [],
  };
}

function fakeContinentContext(trace: PaintTrace): CanvasRenderingContext2D {
  const ctx = {
    fillStyle: '' as string | object,
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    imageSmoothingEnabled: false,
    drawImage(): void {},
    fillRect(): void {
      trace.fillRects.push(typeof ctx.fillStyle === 'string' ? ctx.fillStyle : 'gradient');
    },
    createLinearGradient(x0: number, y0: number, x1: number, y1: number): unknown {
      const grad = {
        from: [x0, y0, x1, y1] as number[],
        stops: [] as Array<[number, string]>,
        addColorStop(offset: number, color: string): void {
          grad.stops.push([offset, color]);
        },
      };
      trace.gradients.push(grad);
      return grad;
    },
    strokeRect(): void {
      trace.strokeRects.push(String(ctx.strokeStyle));
    },
    beginPath(): void {},
    arc(): void {},
    fill(): void {
      trace.arcFills.push(String(ctx.fillStyle));
    },
    stroke(): void {},
    fillText(text: string): void {
      trace.labels.push({ text, color: String(ctx.fillStyle) });
    },
    strokeText(): void {},
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

function installStyleGlobals(trace: PaintTrace): void {
  vi.stubGlobal('document', { documentElement: {} });
  vi.stubGlobal('getComputedStyle', () => ({
    getPropertyValue(token: string): string {
      trace.styleReads.push(token);
      return `paint:${token}`;
    },
  }));
  // The continent painter kicks a plate load via `new Image()`; stub it so the
  // load stays pending (onload never fires) and the painter draws its ocean +
  // region-overlay fallback, which is exactly the path under test. The art loader
  // checks `state instanceof HTMLImageElement`, so that DOM global must exist (as
  // the same class) for the check to evaluate without throwing in Node.
  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 0;
    naturalHeight = 0;
    set src(_v: string) {}
  }
  vi.stubGlobal('Image', FakeImage);
  vi.stubGlobal('HTMLImageElement', FakeImage);
}

// Player at (0,0) sits in eastbrook_vale (the strip starter band), so that zone
// is the current one and the you-are-here marker is on-plate.
function continentWorld(): IWorld {
  return {
    player: { id: 1, kind: 'player', name: 'Painter', pos: { x: 0, z: 0 }, facing: 0 },
    entities: new Map(),
    socialInfo: null,
    cfg: { seed: 42, playerClass: 'warrior' },
    questState: () => 'unavailable',
    questLog: new Map(),
  } as unknown as IWorld;
}

/** continentWorld plus a three-member party: self (pid 1, which must draw no dot
 *  of its own), an alive mage a zone north, and a dead priest nearby. */
function continentPartyWorld(): IWorld {
  const world = continentWorld() as unknown as { partyInfo: unknown };
  world.partyInfo = {
    leader: 1,
    raid: false,
    master: { enabled: false, looter: 0, threshold: 'uncommon' },
    members: [
      { pid: 1, name: 'Painter', cls: 'warrior', level: 20, x: 0, z: 0, dead: 0 },
      { pid: 2, name: 'Ally', cls: 'mage', level: 20, x: 404, z: 1900, dead: 0 },
      { pid: 3, name: 'Fallen', cls: 'priest', level: 20, x: -40, z: 60, dead: 1 },
    ],
  };
  return world as unknown as IWorld;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('continent_map_painter: no magic values', () => {
  it('carries no literal hex or rgb color in TS', () => {
    const hex = code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    const rgb = code.match(/\brgba?\s*\(/g) ?? [];
    expect(hex, `hex colors: ${hex.join(', ')}`).toEqual([]);
    expect(rgb, `rgb colors: ${rgb.join(', ')}`).toEqual([]);
  });

  it('resolves --color-map-* tokens via getComputedStyle exactly once per redraw', () => {
    expect(code).toContain('getComputedStyle');
    expect(code).toContain('getPropertyValue');
    expect(code).toContain('--color-map-');
    expect(code).toContain('resolveColors');
    // One getComputedStyle call site total: resolved once per paint into a colors
    // object, never re-read inside a per-region draw loop.
    expect(code.match(/getComputedStyle/g) ?? []).toHaveLength(1);
  });

  it('defines every continent color token it reads in the design-token sheet', () => {
    for (const tok of CONTINENT_COLOR_TOKENS) {
      expect(code, `painter never reads ${tok}`).toContain(tok);
      expect(tokens, `missing ${tok}`).toContain(`${tok}:`);
    }
  });

  it('letterboxes into its own continent ocean, not the zone map backdrop', () => {
    // The plate is a tall portrait crop, so the flat fill beside it is a wide,
    // very visible band that has to match the sea the plate paints; the per-zone
    // map's --color-map-ocean is a separate (dark, off-map) backdrop. Reverting
    // the painter to that token reds this.
    expect(code).not.toContain("'--color-map-ocean'");
    expect(tokens).toContain('--color-map-continent-ocean:');
  });
});

describe('continent_map_painter: token-driven draw behavior', () => {
  it('floods the ocean, washes the hovered and current zones, and draws NO region borders', () => {
    const trace = newTrace();
    installStyleGlobals(trace);
    const ctx = fakeContinentContext(trace);
    new ContinentMapPainter(classColor).paintContinent(ctx, continentWorld(), {
      canvasSize: 560,
      hoveredZoneId: 'frostveil',
    });

    // Every token is resolved once up front (never per-region).
    for (const tok of CONTINENT_COLOR_TOKENS) expect(trace.styleReads).toContain(tok);

    // Ocean floods under everything. With no plate decoded there is no land mask,
    // so both washes take the flat-rectangle fallback: one for the hovered zone,
    // one for the zone the player is standing in.
    expect(trace.fillRects).toEqual([
      'paint:--color-map-continent-ocean',
      'paint:--color-map-region-current-fill',
      'paint:--color-map-region-hover-fill',
    ]);

    // The grid of zone rectangles is GONE. This is the whole point of the change:
    // a single strokeRect anywhere reds it.
    expect(trace.strokeRects).toEqual([]);

    // The zone the player stands in is called out by its label color instead,
    // exactly once (the flag is single-zone).
    const current = trace.labels.filter(
      (l) => l.color === 'paint:--color-map-region-current-label',
    );
    expect(current.map((l) => l.text)).toEqual([zoneDisplayName('eastbrook_vale')]);
    // Every other zone name draws in the plain label color (as does the on-canvas
    // overview title, which is not a zone).
    const plain = trace.labels.filter(
      (l) => l.color === 'paint:--color-map-label' && l.text !== t('hudChrome.continentMap.title'),
    );
    expect(plain).toHaveLength(ZONES.length - 1);

    // The you-are-here dot fills in the player token (player is on-plate at 0,0).
    expect(trace.arcFills).toContain('paint:--color-map-player');
  });

  it('washes only the current zone when nothing is hovered', () => {
    const trace = newTrace();
    installStyleGlobals(trace);
    const ctx = fakeContinentContext(trace);
    new ContinentMapPainter(classColor).paintContinent(ctx, continentWorld(), {
      canvasSize: 560,
      hoveredZoneId: null,
    });
    expect(trace.fillRects).toEqual([
      'paint:--color-map-continent-ocean',
      'paint:--color-map-region-current-fill',
    ]);
    expect(trace.strokeRects).toEqual([]);
  });

  it('hovering your own zone draws the hover wash alone, not both stacked', () => {
    const trace = newTrace();
    installStyleGlobals(trace);
    const ctx = fakeContinentContext(trace);
    new ContinentMapPainter(classColor).paintContinent(ctx, continentWorld(), {
      canvasSize: 560,
      hoveredZoneId: 'eastbrook_vale', // the zone the player is standing in
    });
    expect(trace.fillRects).toEqual([
      'paint:--color-map-continent-ocean',
      'paint:--color-map-region-hover-fill',
    ]);
  });
});

describe('continent_map_painter: party markers', () => {
  it('fills a class color per living member, the dead token for a fallen one, and self last', () => {
    const trace = newTrace();
    installStyleGlobals(trace);
    const ctx = fakeContinentContext(trace);
    new ContinentMapPainter(classColor).paintContinent(ctx, continentPartyWorld(), {
      canvasSize: 560,
      hoveredZoneId: null,
    });

    // Roster order, then the player's own dot LAST so self draws on top of a
    // stacked group. Self never mints a party dot, so 'color:warrior' is absent.
    expect(trace.arcFills).toEqual([
      'color:mage',
      'paint:--color-map-party-dead',
      'paint:--color-map-player',
    ]);
  });

  it('draws no party dot for a solo player', () => {
    const trace = newTrace();
    installStyleGlobals(trace);
    const ctx = fakeContinentContext(trace);
    new ContinentMapPainter(classColor).paintContinent(ctx, continentWorld(), {
      canvasSize: 560,
      hoveredZoneId: null,
    });

    // Only the you-are-here dot: no class color and no dead token anywhere.
    expect(trace.arcFills).toEqual(['paint:--color-map-player']);
  });
});

// The wash path proper: with a decoded plate the painter builds a land mask and
// composites the highlight through it, so the highlight follows the coastline
// instead of painting the zone's rectangle over the sea. Driven on a FRESH module
// graph (vi.resetModules) because continent_art caches the decoded plate at module
// scope: the suites above deliberately leave that load pending.
describe('continent_map_painter: land-masked zone wash', () => {
  interface Op {
    kind: string;
    detail?: string;
  }
  interface FakeGradient {
    from: [number, number, number, number];
    stops: Array<[number, string]>;
    addColorStop(offset: number, color: string): void;
  }
  interface Surface {
    tag: string;
    width: number;
    height: number;
    ops: Op[];
    gradients: FakeGradient[];
    getContext(kind: string): unknown;
  }

  function fakeSurface(tag: string): Surface {
    const surface: Surface = {
      tag,
      width: 0,
      height: 0,
      ops: [],
      gradients: [],
      getContext: () => ctx,
    };
    const ctx = {
      fillStyle: '' as string | FakeGradient,
      globalCompositeOperation: 'source-over',
      imageSmoothingEnabled: false,
      clearRect(): void {
        surface.ops.push({ kind: 'clearRect' });
      },
      drawImage(src: { tag?: string }): void {
        surface.ops.push({ kind: 'drawImage', detail: src.tag ?? 'unknown' });
      },
      fillRect(): void {
        const style = ctx.fillStyle;
        surface.ops.push({
          kind: 'fillRect',
          detail: `${ctx.globalCompositeOperation}|${
            typeof style === 'string' ? style : 'gradient'
          }`,
        });
      },
      createLinearGradient(x0: number, y0: number, x1: number, y1: number): FakeGradient {
        const grad: FakeGradient = {
          from: [x0, y0, x1, y1],
          stops: [],
          addColorStop(offset: number, color: string): void {
            grad.stops.push([offset, color]);
          },
        };
        surface.gradients.push(grad);
        return grad;
      },
      getImageData(_x: number, _y: number, w: number, h: number): { data: Uint8ClampedArray } {
        // Half sea, half land, so the mask carries both extremes and a coastline.
        const data = new Uint8ClampedArray(w * h * 4);
        for (let i = 0; i < w * h; i++) {
          const sea = i % w < w / 2;
          data[i * 4] = sea ? 23 : 97;
          data[i * 4 + 1] = sea ? 90 : 108;
          data[i * 4 + 2] = sea ? 129 : 40;
          data[i * 4 + 3] = 255;
        }
        return { data };
      },
      createImageData(w: number, h: number): { data: Uint8ClampedArray } {
        return { data: new Uint8ClampedArray(w * h * 4) };
      },
      putImageData(): void {
        surface.ops.push({ kind: 'putImageData' });
      },
    };
    return surface;
  }

  /** The map canvas's own context, recording what actually lands on the map. */
  function fakeTargetContext(trace: PaintTrace, blits: string[]): CanvasRenderingContext2D {
    const ctx = fakeContinentContext(trace) as unknown as {
      drawImage: (src: { tag?: string }) => void;
    };
    ctx.drawImage = (src) => blits.push(src.tag ?? 'unknown');
    return ctx as unknown as CanvasRenderingContext2D;
  }

  it('masks the wash to the land and never fills the zone rectangle on the map', async () => {
    const trace = newTrace();
    const surfaces: Surface[] = [];
    vi.stubGlobal('document', {
      documentElement: {},
      createElement: (): Surface => {
        const surface = fakeSurface(`surface#${surfaces.length}`);
        surfaces.push(surface);
        return surface;
      },
    });
    vi.stubGlobal('getComputedStyle', () => ({
      getPropertyValue: (token: string) => `paint:${token}`,
    }));
    // A plate that decodes immediately, so the painter reaches the mask path.
    class LoadedImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 543;
      naturalHeight = 1100;
      tag = 'plate';
      set src(_v: string) {
        this.onload?.();
      }
    }
    vi.stubGlobal('Image', LoadedImage);
    vi.stubGlobal('HTMLImageElement', LoadedImage);

    vi.resetModules();
    const { ContinentMapPainter: FreshPainter } = await import('../src/ui/continent_map_painter');
    const blits: string[] = [];
    const ctx = fakeTargetContext(trace, blits);
    const painterUnderTest = new FreshPainter(classColor);
    // Hover the player's own zone so exactly ONE wash composites, which makes the
    // op sequence below the whole story rather than an interleaving of two.
    const result = painterUnderTest.paintContinent(ctx, continentWorld(), {
      canvasSize: 560,
      hoveredZoneId: 'eastbrook_vale',
    });

    // Two surfaces, minted once each: the land mask and the composite scratch.
    expect(surfaces.map((s) => s.tag)).toEqual(['surface#0', 'surface#1']);
    const [mask, scratch] = surfaces;
    expect(mask.ops.map((o) => o.kind)).toEqual(['drawImage', 'putImageData']);
    expect(scratch.width).toBe(560);
    expect(scratch.height).toBe(560);

    // The map canvas itself: the ocean flood, then the two letterbox depth grades
    // that darken the open water toward the window edge (the plate is a tall
    // portrait crop, so only the left/right bands exist). NO rectangle wash
    // reaches it, which is the regression this pins (the fallback would fillRect
    // the zone box, and a flat token fill would show as a named color here).
    expect(trace.fillRects).toEqual(['paint:--color-map-continent-ocean', 'gradient', 'gradient']);

    // Those two grades are the open water beside the plate: each runs from the
    // window edge (fully darkened) to the plate edge (clear, so it lands on the
    // ocean token unchanged and leaves no seam where the painted sea begins).
    // A grade running the other way would vignette the plate instead of the sea.
    expect(trace.gradients).toHaveLength(2);
    const [westward, eastward] = trace.gradients;
    const plateLeft = westward.from[2];
    const plateRight = eastward.from[0];
    expect(westward.from).toEqual([0, 0, plateLeft, 0]);
    expect(plateLeft).toBeGreaterThan(0);
    expect(westward.stops).toEqual([
      [0, 'paint:--color-map-continent-backdrop-dim'],
      [1, 'transparent'],
    ]);
    expect(eastward.from).toEqual([plateRight, 0, 560, 0]);
    expect(plateRight).toBeLessThan(560);
    expect(eastward.stops).toEqual([
      [0, 'transparent'],
      [1, 'paint:--color-map-continent-backdrop-dim'],
    ]);
    // The plate is centered in the square canvas, so the two bands are equal.
    expect(560 - plateRight).toBeCloseTo(plateLeft, 6);
    // It receives the plate, then the finished wash as a single blit.
    expect(blits).toEqual(['plate', 'surface#1']);

    // The composite: mask in, tint through it, then the two feather ramps that
    // confine it to this zone and soften the border it shares with the next.
    expect(scratch.ops).toEqual([
      { kind: 'drawImage', detail: 'surface#0' },
      { kind: 'fillRect', detail: 'source-in|paint:--color-map-region-hover-fill' },
      { kind: 'fillRect', detail: 'destination-in|gradient' },
      { kind: 'fillRect', detail: 'destination-in|gradient' },
    ]);

    // Each ramp spans the hovered zone's own bounds on its axis, clear at both
    // edges and opaque between: that fade is what keeps a zone border from
    // reading as a drawn straight line.
    const rect = result.regions.find((r) => r.zoneId === 'eastbrook_vale')?.rect;
    if (!rect) throw new Error('hovered zone has no region');
    const [xRamp, yRamp] = scratch.gradients;
    expect(xRamp.from).toEqual([rect.mx, 0, rect.mx + rect.w, 0]);
    expect(yRamp.from).toEqual([0, rect.my, 0, rect.my + rect.h]);
    for (const ramp of [xRamp, yRamp]) {
      expect(ramp.stops).toHaveLength(4);
      expect(ramp.stops[0]).toEqual([0, 'transparent']);
      expect(ramp.stops[3]).toEqual([1, 'transparent']);
      expect(ramp.stops[1][1]).toBe('white');
      expect(ramp.stops[2][1]).toBe('white');
      expect(ramp.stops[1][0]).toBeGreaterThan(0);
      expect(ramp.stops[1][0]).toBeLessThanOrEqual(0.5);
      expect(ramp.stops[2][0]).toBe(1 - ramp.stops[1][0]);
    }

    // A second redraw with the same hover state COMPOSITES NOTHING: the mask is
    // built once per session and the finished wash is cached and re-blitted, which
    // is what keeps the mediumHud cadence cheap.
    const opsAfterFirst = scratch.ops.length;
    painterUnderTest.paintContinent(ctx, continentWorld(), {
      canvasSize: 560,
      hoveredZoneId: 'eastbrook_vale',
    });
    expect(surfaces).toHaveLength(2);
    expect(scratch.ops).toHaveLength(opsAfterFirst);
    expect(mask.ops.filter((o) => o.kind === 'putImageData')).toHaveLength(1);
    expect(blits).toEqual(['plate', 'surface#1', 'plate', 'surface#1']);

    // Hovering a DIFFERENT zone composites two more washes: that zone's hover, and
    // the quiet one on the zone the player is standing in (which the hover-on-self
    // frames above folded into a single wash). Both are then cached, so coming
    // back to the first hover composites nothing.
    painterUnderTest.paintContinent(ctx, continentWorld(), {
      canvasSize: 560,
      hoveredZoneId: 'frostveil',
    });
    expect(surfaces).toHaveLength(4);
    painterUnderTest.paintContinent(ctx, continentWorld(), {
      canvasSize: 560,
      hoveredZoneId: 'eastbrook_vale',
    });
    expect(surfaces).toHaveLength(4);

    // The cache is CAPPED, so a sweep across the map cannot grow it without
    // bound: after enough distinct hovers the oldest wash is evicted and has to
    // be composited again.
    const before = surfaces.length;
    for (const zoneId of ['wraithwood', 'amberfall', 'drakelands', 'palmreach']) {
      painterUnderTest.paintContinent(ctx, continentWorld(), {
        canvasSize: 560,
        hoveredZoneId: zoneId,
      });
    }
    painterUnderTest.paintContinent(ctx, continentWorld(), {
      canvasSize: 560,
      hoveredZoneId: 'eastbrook_vale',
    });
    expect(surfaces.length).toBeGreaterThan(before + 4);
  });
});

describe('continent_map_painter: composed on the mediumHud cadence', () => {
  it('Hud routes the continent level through the painter behind the display guard', () => {
    expect(hud).toContain('this.continentPainter.paintContinent(ctx, this.sim, {');
    expect(hud).toContain(
      "if ($('#map-window').style.display === 'block') this.updateMapWindow();",
    );
  });
});
