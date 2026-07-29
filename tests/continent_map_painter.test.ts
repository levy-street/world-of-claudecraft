// No-magic-values + behavior guard for the continent-overview painter.
//
// The pure geometry is covered by tests/continent_map_view.test.ts. This suite
// (the sibling of tests/map_window_painter.test.ts) enforces the decentralized
// no-magic-values contract for this canvas painter and drives the real painter
// through a narrow fake 2D context so token selection is a behavior assertion,
// not a source-text guess. The art plate never decodes here (Image is stubbed to
// stay pending), so the painter takes its ocean + region-overlay fallback path.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContinentMapPainter } from '../src/ui/continent_map_painter';
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
  '--color-map-region-stroke',
  '--color-map-region-hover-fill',
  '--color-map-region-hover-stroke',
  '--color-map-region-current-stroke',
];

interface PaintTrace {
  fillRects: string[]; // fillStyle at each fillRect (ocean flood + hover fill)
  strokeRects: string[]; // strokeStyle at each strokeRect (region borders)
  arcFills: string[]; // fillStyle at each arc fill (the you-are-here dot)
  styleReads: string[];
}

function fakeContinentContext(trace: PaintTrace): CanvasRenderingContext2D {
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    imageSmoothingEnabled: false,
    drawImage(): void {},
    fillRect(): void {
      trace.fillRects.push(String(ctx.fillStyle));
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
    fillText(): void {},
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
  it('floods the ocean, borders every region, and highlights the hovered + current zones', () => {
    const trace: PaintTrace = { fillRects: [], strokeRects: [], arcFills: [], styleReads: [] };
    installStyleGlobals(trace);
    const ctx = fakeContinentContext(trace);
    new ContinentMapPainter().paintContinent(ctx, continentWorld(), {
      canvasSize: 560,
      hoveredZoneId: 'frostveil',
    });

    // Every token is resolved once up front (never per-region).
    for (const tok of CONTINENT_COLOR_TOKENS) expect(trace.styleReads).toContain(tok);

    // Ocean floods under everything, and the hovered zone gets a translucent fill.
    expect(trace.fillRects).toContain('paint:--color-map-continent-ocean');
    expect(trace.fillRects).toContain('paint:--color-map-region-hover-fill');

    // Region borders: idle on most, the hovered one brighter, the current one distinct.
    expect(trace.strokeRects).toContain('paint:--color-map-region-stroke');
    expect(trace.strokeRects).toContain('paint:--color-map-region-hover-stroke');
    expect(trace.strokeRects).toContain('paint:--color-map-region-current-stroke');
    // Exactly one hovered + one current border (the flags are single-zone).
    expect(
      trace.strokeRects.filter((s) => s === 'paint:--color-map-region-hover-stroke'),
    ).toHaveLength(1);
    expect(
      trace.strokeRects.filter((s) => s === 'paint:--color-map-region-current-stroke'),
    ).toHaveLength(1);

    // The you-are-here dot fills in the player token (player is on-plate at 0,0).
    expect(trace.arcFills).toContain('paint:--color-map-player');
  });

  it('draws no region highlight fill when nothing is hovered', () => {
    const trace: PaintTrace = { fillRects: [], strokeRects: [], arcFills: [], styleReads: [] };
    installStyleGlobals(trace);
    const ctx = fakeContinentContext(trace);
    new ContinentMapPainter().paintContinent(ctx, continentWorld(), {
      canvasSize: 560,
      hoveredZoneId: null,
    });
    expect(trace.fillRects).toContain('paint:--color-map-continent-ocean');
    expect(trace.fillRects).not.toContain('paint:--color-map-region-hover-fill');
    expect(trace.strokeRects).not.toContain('paint:--color-map-region-hover-stroke');
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
