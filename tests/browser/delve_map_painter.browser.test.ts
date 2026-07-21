// Browser-mode supplement for the delve_map painter (the PainterHost seam pilot).
//
// The Node suite (tests/delve_map_painter.test.ts) drives the PURE path (delveDrawModel)
// and source-scans the no-magic-values guard, but it CANNOT exercise the painter's
// imperative canvas/DOM half: paintMinimapDelve / paintWorldMapDelve need a real 2D
// context plus getComputedStyle, which only exist in a browser. This opt-in suite runs IN
// Chromium (Vitest 4 Browser Mode) and exercises that half end to end: it builds a real
// writer facet, a real canvas 2D context, and a real #zone-label element, then asserts the
// label text node was written and the canvas drew non-blank pixels. It SUPPLEMENTS, never
// replaces, the Node parity test.
//
// It lives under tests/browser/** and ends in .browser.test.ts, so a bare `vitest run`
// (vite.config.ts test.exclude) skips it; only `npm run test:browser`
// (vitest.browser.config.ts, chromium) runs it.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DelveMapPainter } from '../../src/ui/hud/delve/delve_map_painter';
import { makeWriterFacet, type PainterHostWriters } from '../../src/ui/painter_host';
import type { IWorld } from '../../src/world_api';
import { cleanup, host } from './_harness';

// The six `--color-delve-*` tokens the painter resolves via getComputedStyle. The NAMES
// mirror DELVE_COLOR_TOKENS in src/ui/hud/delve/delve_map_painter.ts; the VALUE we set for each is the
// token name itself (the tokens ARE the values). This keeps the test free of an
// out-of-band hex (no magic-color literal duplicating tokens.css), while the painter still
// reads a non-empty string for every token. The value is not a valid CSS color, so Canvas
// leaves fillStyle at its opaque-black default; the schematic still paints visible pixels,
// which is exactly what the structural assertion below checks.
const DELVE_COLOR_TOKENS = [
  '--color-delve-room',
  '--color-delve-mob',
  '--color-delve-mob-aggro',
  '--color-delve-party-dead',
  '--color-delve-label',
  '--color-delve-outline',
] as const;

// One in-delve scenario, mirroring tests/delve_map_painter.test.ts: 2 live mobs (one
// aggroed), 1 dead mob + 1 NPC (dropped), and an alive + dead party member plus the local
// player (dropped). Expressed as plain data so makeWorld can build a structurally-real stub.
const MODULE_ID = 'reliquary_sunken_ossuary';
const ORIGIN = { x: 1000, z: 2000 };
const SCENARIO = {
  player: { id: 1, localX: 0, localZ: 20, facing: 0.5 },
  entities: [
    { id: 2, kind: 'mob', dead: false, localX: 5, localZ: 25, aggro: true },
    { id: 3, kind: 'mob', dead: false, localX: -5, localZ: 15, aggro: false },
    { id: 4, kind: 'mob', dead: true, localX: 2, localZ: 22, aggro: false },
    { id: 5, kind: 'npc', dead: false, localX: -2, localZ: 18, aggro: false },
  ],
  party: [
    { pid: 1, cls: 'warrior', dead: 0, localX: 0, localZ: 20 },
    { pid: 6, cls: 'warrior', dead: 0, localX: 4, localZ: 24 },
    { pid: 7, cls: 'mage', dead: 1, localX: -4, localZ: 16 },
  ],
};

function makeWorld(): IWorld {
  const p = SCENARIO.player;
  const player = {
    id: p.id,
    kind: 'player',
    dead: false,
    pos: { x: ORIGIN.x + p.localX, z: ORIGIN.z + p.localZ },
    facing: p.facing,
    aggroTargetId: null,
  };
  const entities = new Map<number, unknown>([[player.id, player]]);
  for (const e of SCENARIO.entities) {
    entities.set(e.id, {
      id: e.id,
      kind: e.kind,
      dead: e.dead,
      pos: { x: ORIGIN.x + e.localX, z: ORIGIN.z + e.localZ },
      facing: 0,
      aggroTargetId: e.aggro ? p.id : null,
    });
  }
  const partyInfo = {
    leader: 1,
    raid: false,
    members: SCENARIO.party.map((m) => ({
      pid: m.pid,
      cls: m.cls,
      dead: m.dead,
      x: ORIGIN.x + m.localX,
      z: ORIGIN.z + m.localZ,
    })),
  };
  return {
    player,
    entities,
    partyInfo,
    delveRun: {
      delveId: 'collapsed_reliquary',
      modules: [MODULE_ID],
      moduleIndex: 0,
      origin: ORIGIN,
    },
  } as unknown as IWorld;
}

// A REAL write-elision facet over fresh caches and no-op counters (the painter routes its one
// DOM write, the #zone-label text, through setText).
function realWriterFacet(): PainterHostWriters {
  return makeWriterFacet(
    new Map<HTMLElement, string>(),
    new Map<HTMLElement, Map<string, string>>(),
    new Map<HTMLElement, Map<string, string>>(),
    new Map<HTMLElement, Map<string, string>>(),
    () => {},
    () => {},
  );
}

// The painter's class-color resolver (used only for live party discs). A plain color keyword
// keeps the stub realistic; the structural assertion never depends on its value.
function makePainter(): DelveMapPainter {
  return new DelveMapPainter(realWriterFacet(), () => 'white');
}

function canvasCtx(size: number): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable in browser mode');
  return ctx;
}

// Non-blank iff at least one pixel has a non-zero alpha (a freshly cleared canvas is fully
// transparent, alpha 0 everywhere, so any drawn opaque pixel differs from that blank base).
// SCOPE: this is a "the imperative half ran and produced output" smoke check, not a per-marker
// assertion. The painter always blits an opaque schematic background, so non-blank confirms
// paintMinimapDelve / paintWorldMapDelve executed end to end against a real 2D context plus
// getComputedStyle without throwing; WHICH primitives drew (mobs, party, the player arrow) is
// covered by the pure delveDrawModel parity in tests/delve_map_painter.test.ts, and the
// #zone-label assertion below is the meaningful DOM-write check this browser test adds on top.
function hasPaintedPixels(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const { data } = ctx.getImageData(0, 0, w, h);
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 0) return true;
  }
  return false;
}

const MINIMAP_SIZE = 162;
const WORLD_MAP_SIZE = 280;

describe('delve_map painter (browser): canvas + #zone-label writes', () => {
  beforeEach(() => {
    for (const name of DELVE_COLOR_TOKENS) {
      document.documentElement.style.setProperty(name, name);
    }
  });

  afterEach(() => {
    cleanup();
    for (const name of DELVE_COLOR_TOKENS) {
      document.documentElement.style.removeProperty(name);
    }
  });

  it('paintMinimapDelve writes the #zone-label text and paints non-blank pixels', () => {
    const world = makeWorld();
    const painter = makePainter();
    const zoneLabel = host('zone-label', '');
    const ctx = canvasCtx(MINIMAP_SIZE);

    painter.paintMinimapDelve(ctx, world, zoneLabel, MINIMAP_SIZE);

    // The one DOM write the Canvas pilot routes through the facet: the area label text node.
    expect((zoneLabel.textContent ?? '').length).toBeGreaterThan(0);
    expect(hasPaintedPixels(ctx, MINIMAP_SIZE, MINIMAP_SIZE)).toBe(true);
  });

  it('paintWorldMapDelve paints non-blank pixels (label drawn on-canvas, no DOM write)', () => {
    const world = makeWorld();
    const painter = makePainter();
    const ctx = canvasCtx(WORLD_MAP_SIZE);

    painter.paintWorldMapDelve(ctx, world, WORLD_MAP_SIZE);

    expect(hasPaintedPixels(ctx, WORLD_MAP_SIZE, WORLD_MAP_SIZE)).toBe(true);
  });
});
