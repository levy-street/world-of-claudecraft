// No-magic-values + cadence guard for the overworld map painter, plus the
// label-sprite behavior (issue 2476).
//
// The pure geometry is covered by tests/map_window_view.test.ts. This suite also
// drives the real painter through a narrow fake 2D context so adapter wiring and
// token selection are behavior assertions rather than source-text guesses. The
// same fake records every canvas TEXT entry point on the map context, so "every
// label goes through the sprite cache" is a behavior pin too: the painter must
// leave that context's text API completely untouched. The cache itself (sizing,
// eviction, the rounding) is pinned in tests/text_sprite_cache.test.ts.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BUILTIN_WORLD,
  CAMPS,
  DUNGEON_LIST,
  QUESTS,
  STRIP_MAX_X,
  STRIP_MIN_X,
  setActiveWorldContent,
  ZONES,
} from '../src/sim/data';
import { emptyZoneProps, isQuestTurnInNpc, type QuestProgress } from '../src/sim/types';
import { overworldDungeonPortals } from '../src/ui/map_dungeon_portals';
import {
  MAP_MARKER_SIZES,
  type MapMarkerArt,
  type MapMarkerArtId,
  type MapMarkerSize,
} from '../src/ui/map_marker_icon_art';
import { STABLE_MAP_NAVIGATION_LANDMARKS } from '../src/ui/map_navigation_landmarks_core';
import {
  MapWindowPainter,
  MAP_COLOR_TOKENS as PAINTER_TOKEN_TABLE,
} from '../src/ui/map_window_painter';
import { buildOverworldMapModel } from '../src/ui/map_window_view';
import { TEXT_SPRITE_LIMIT } from '../src/ui/text_sprite_cache';
import type { IWorld } from '../src/world_api';

const painter = readFileSync(new URL('../src/ui/map_window_painter.ts', import.meta.url), 'utf8');
// Drop comments so prose can't create a false positive (mirrors architecture.test).
const code = painter.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const hudSource = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
// Comments stripped for the same reason as `code` above: a wiring pin that a
// commented-out call satisfies is not a pin (see the repo's raw-source rule).
const hud = hudSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const tooltipAdapter = readFileSync(
  new URL('../src/ui/map_marker_tooltip_adapter.ts', import.meta.url),
  'utf8',
)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');
const markerInteraction = readFileSync(
  new URL('../src/ui/hud/map/map_marker_interaction_controller.ts', import.meta.url),
  'utf8',
)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');
const markerTooltipContent = readFileSync(
  new URL('../src/ui/hud/map/map_marker_tooltip_content.ts', import.meta.url),
  'utf8',
)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');
// Comment-stripped like `code`: a commented-out token declaration must not
// satisfy the design-token pins below.
const tokens = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const MAP_COLOR_TOKENS = [
  '--color-map-ocean',
  '--color-map-label',
  '--color-map-outline',
  '--color-map-portal-dot',
  '--color-map-portal-label',
  '--color-map-npc-quest',
  '--color-map-npc-quest-repeat',
  '--color-map-player',
  '--color-map-ally-friend',
  '--color-map-ally-guild',
  '--color-map-party-dead',
  '--color-map-rock',
  '--color-map-tree',
  '--color-map-oak',
  '--color-map-building-outline',
  '--color-map-building-armoury',
  '--color-map-building-chapel',
  '--color-map-building-inn',
  '--color-map-building-house',
  '--color-map-well',
  '--color-map-stall',
  '--color-map-tent',
  '--color-map-mine',
  '--color-map-graveyard',
  '--color-map-mudhut',
  '--color-map-campfire',
  '--color-map-gather-ore-ready',
  '--color-map-gather-ore-cooldown',
  '--color-map-gather-ore-glow',
  '--color-map-gather-wood-ready',
  '--color-map-gather-wood-cooldown',
  '--color-map-gather-wood-glow',
  '--color-map-gather-herb-ready',
  '--color-map-gather-herb-cooldown',
  '--color-map-gather-herb-glow',
  '--color-map-gather-locked',
];

// The classColor resolver every MapWindowPainter call site now takes (issue 2652),
// mirroring how minimap_painter.test.ts stubs the same seam. Distinct per class so
// a color assertion is decisive rather than "some string".
const classColor = (cls: string): string => `color:${cls}`;

/** One label rasterized into its own offscreen canvas by the sprite cache. */
interface LabelSprite {
  width: number;
  height: number;
  fonts: string[];
  lineWidths: number[];
  /** Each text pass baked into this sprite, in order. The x/y are the sprite's
   *  own origin, which is what the blit destination subtracts. */
  ink: Array<{ op: 'fill' | 'stroke'; color: string; text: string; x: number; y: number }>;
}

/** A successful stable-marker sprite returned by the injected art seam. */
interface FakeMarkerSprite {
  markerId: MapMarkerArtId;
  sizeId: MapMarkerSize;
}

interface MarkerArtCall {
  id: MapMarkerArtId;
  size: MapMarkerSize;
}

/** Where a blit put the label's anchor back: destination plus the sprite origin. */
function blitAnchor(blit: { sprite: LabelSprite; dx: number; dy: number }): {
  x: number;
  y: number;
} {
  const origin = blit.sprite.ink[0];
  return { x: blit.dx + (origin?.x ?? 0), y: blit.dy + (origin?.y ?? 0) };
}

/** One ink pass without its sprite-local origin, for the color/order pins. */
function inkStyle(pass: LabelSprite['ink'][number]): { op: string; color: string; text: string } {
  return { op: pass.op, color: pass.color, text: pass.text };
}

/** The label a sprite carries (every pass bakes the same string). */
function spriteText(sprite: LabelSprite): string {
  return sprite.ink[0]?.text ?? '';
}

interface PaintTrace {
  /** Monotonic draw counter, stamped on every fill and stroke, so a stroke can be
   *  matched to the fill of the SAME path rather than to any similar one
   *  elsewhere in the redraw. */
  seq: number;
  fills: Array<{ style: string; commands: string[]; args: number[]; at: number }>;
  /** Immediate rectangle fills, including the hue-independent rank pips used by
   *  the generated-art fallback. The ocean flood remains distinguishable by
   *  style and dimensions. */
  fillRects: Array<{
    style: string;
    x: number;
    y: number;
    width: number;
    height: number;
    at: number;
  }>;
  styleReads: string[];
  /** Every canvas minted through document.createElement('canvas'). */
  sprites: LabelSprite[];
  /** Every 3-argument drawImage: the label blits (the terrain blit passes 9),
   *  with the context's globalAlpha AT BLIT TIME (the cooldown glyph dims at
   *  the blit, never in the sprite raster). */
  blits: Array<{ sprite: LabelSprite; dx: number; dy: number; alpha: number; at: number }>;
  /** Successful marker-art blits, kept separate from label-cache sprites. */
  markerBlits: Array<{
    sprite: FakeMarkerSprite;
    dx: number;
    dy: number;
    alpha: number;
    at: number;
  }>;
  /** Every canvas text entry point used on the MAP context, which must stay empty. */
  textApi: string[];
  /** Every stroke() on the map context with the stroke state it used. The width
   *  matters as much as the color: the badge block leaves 1.5 behind. */
  strokes: Array<{
    style: string;
    lineWidth: number;
    commands: string[];
    args: number[];
    at: number;
  }>;
}

function makeLabelSprite(trace: PaintTrace): LabelSprite {
  let font = '';
  let lineWidth = 1;
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    get font(): string {
      return font;
    },
    set font(value: string) {
      font = value;
      sprite.fonts.push(value);
    },
    get lineWidth(): number {
      return lineWidth;
    },
    set lineWidth(value: number) {
      lineWidth = value;
      sprite.lineWidths.push(value);
    },
    measureText(text: string): { width: number } {
      return { width: text.length * 6 };
    },
    fillText(text: string, x: number, y: number): void {
      sprite.ink.push({ op: 'fill', color: String(ctx.fillStyle), text, x, y });
    },
    strokeText(text: string, x: number, y: number): void {
      sprite.ink.push({ op: 'stroke', color: String(ctx.strokeStyle), text, x, y });
    },
  };
  const sprite: LabelSprite = {
    width: 0,
    height: 0,
    fonts: [],
    lineWidths: [],
    ink: [] as LabelSprite['ink'],
    getContext: (kind: string): unknown => (kind === '2d' ? (ctx as unknown) : null),
  } as unknown as LabelSprite;
  trace.sprites.push(sprite);
  return sprite;
}

function isMarkerSprite(image: unknown): image is FakeMarkerSprite {
  return typeof image === 'object' && image !== null && 'markerId' in image;
}

/** Fake MapMarkerArt with an explicit success set. Requests that miss still
 *  stay in `calls`, making fallback as observable as the successful blit. */
function fakeMarkerArt(available: readonly MapMarkerArtId[]): {
  art: MapMarkerArt;
  calls: MarkerArtCall[];
} {
  const calls: MarkerArtCall[] = [];
  const allowed = new Set(available);
  const sprites = new Map<string, FakeMarkerSprite>();
  return {
    calls,
    art: {
      sprite(id, size): CanvasImageSource | null {
        calls.push({ id, size });
        if (!allowed.has(id)) return null;
        const key = `${id}:${size}`;
        let sprite = sprites.get(key);
        if (!sprite) {
          sprite = { markerId: id, sizeId: size };
          sprites.set(key, sprite);
        }
        return sprite as unknown as CanvasImageSource;
      },
      preload(): void {},
    },
  };
}

function fakeMapContext(trace: PaintTrace): CanvasRenderingContext2D {
  let commands: string[] = [];
  let pathArgs: number[] = [];
  let font = '';
  let alpha = 1;
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    textAlign: 'start',
    imageSmoothingEnabled: false,
    get globalAlpha(): number {
      return alpha;
    },
    set globalAlpha(value: number) {
      alpha = value;
    },
    get font(): string {
      return font;
    },
    set font(value: string) {
      font = value;
      trace.textApi.push(`font=${value}`);
    },
    drawImage(image: unknown, ...rest: number[]): void {
      // The 3-argument form is a label or painted-marker sprite; the terrain
      // sub-rect blit passes 9.
      if (rest.length === 2) {
        if (isMarkerSprite(image)) {
          trace.markerBlits.push({
            sprite: image,
            dx: rest[0],
            dy: rest[1],
            alpha,
            at: trace.seq++,
          });
        } else {
          trace.blits.push({
            sprite: image as LabelSprite,
            dx: rest[0],
            dy: rest[1],
            alpha,
            at: trace.seq++,
          });
        }
      }
    },
    // the painter floods the ocean before the zone bg blit; the fake context
    // must answer every call it makes, not only the path-building ones
    fillRect(x: number, y: number, width: number, height: number): void {
      trace.fillRects.push({
        style: String(ctx.fillStyle),
        x,
        y,
        width,
        height,
        at: trace.seq++,
      });
    },
    beginPath(): void {
      commands = [];
      pathArgs = [];
    },
    arc(...args: number[]): void {
      commands.push('arc');
      pathArgs.push(...args);
    },
    moveTo(...args: number[]): void {
      commands.push('moveTo');
      pathArgs.push(...args);
    },
    lineTo(...args: number[]): void {
      commands.push('lineTo');
      pathArgs.push(...args);
    },
    closePath(): void {
      commands.push('closePath');
    },
    fill(): void {
      trace.fills.push({
        style: String(ctx.fillStyle),
        commands: [...commands],
        args: [...pathArgs],
        at: trace.seq++,
      });
    },
    stroke(): void {
      trace.strokes.push({
        style: String(ctx.strokeStyle),
        lineWidth: ctx.lineWidth,
        commands: [...commands],
        args: [...pathArgs],
        at: trace.seq++,
      });
    },
    measureText(text: string): { width: number } {
      trace.textApi.push(`measureText:${text}`);
      return { width: 0 };
    },
    fillText(text: string): void {
      trace.textApi.push(`fillText:${text}`);
    },
    strokeText(text: string): void {
      trace.textApi.push(`strokeText:${text}`);
    },
    save(): void {},
    restore(): void {},
    translate(): void {},
    rotate(): void {},
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

function installMapStyleGlobals(trace: PaintTrace): void {
  vi.stubGlobal('document', {
    documentElement: {},
    createElement(tag: string): unknown {
      if (tag !== 'canvas') throw new Error(`unexpected createElement(${tag})`);
      return makeLabelSprite(trace);
    },
  });
  vi.stubGlobal('getComputedStyle', () => ({
    getPropertyValue(token: string): string {
      trace.styleReads.push(token);
      return `paint:${token}`;
    },
  }));
}

function newTrace(): PaintTrace {
  return {
    seq: 0,
    fills: [],
    fillRects: [],
    styleReads: [],
    sprites: [],
    blits: [],
    markerBlits: [],
    textApi: [],
    strokes: [],
  };
}

function mapWorld(): IWorld {
  return {
    player: {
      id: 1,
      kind: 'player',
      name: 'Painter',
      pos: { x: 17.5, z: -5.5 },
      facing: 0,
    },
    entities: new Map(),
    socialInfo: null,
    cfg: { seed: 42, playerClass: 'warrior' },
    questState: () => 'unavailable',
    questLog: new Map(),
    inventory: [],
    gatheringProficiency: {},
    stationPlacements: [],
    civicServicePlacements: [],
    nodeHarvestableByMe: () => true,
  } as unknown as IWorld;
}

afterEach(() => {
  setActiveWorldContent(null);
  vi.unstubAllGlobals();
});

describe('map_window_painter: no magic values', () => {
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
    // object, never re-read inside a per-marker draw loop.
    expect(code.match(/getComputedStyle/g) ?? []).toHaveLength(1);
  });

  it('defines every map color token it reads in the design-token sheet', () => {
    for (const tok of MAP_COLOR_TOKENS) {
      expect(code, `painter never reads ${tok}`).toContain(tok);
      expect(tokens, `missing ${tok}`).toContain(`${tok}:`);
    }
    // The hand list above cannot see a table entry it was never told about,
    // so a token missing from tokens.css would resolve '' and draw default
    // ink. Pin EVERY live table entry (the exported source of truth) against
    // the sheet, and the hand list against the table, so neither can drift
    // (the minimap suite's rationale).
    for (const tok of Object.values(PAINTER_TOKEN_TABLE)) {
      expect(tokens, `tokens.css missing live table entry ${tok}`).toContain(`${tok}:`);
    }
    for (const tok of MAP_COLOR_TOKENS) {
      expect(
        Object.values(PAINTER_TOKEN_TABLE),
        `hand list names a token the painter no longer reads: ${tok}`,
      ).toContain(tok);
    }
  });

  it('caches bounded decorations per zone instead of generating the whole world', () => {
    expect(code).toContain('decorationsByZone.get(opts.zone.id)');
    expect(code).toContain('generateDecorationsInBounds(world.cfg.seed, opts.zoneBg.region)');
    expect(code).toContain('decorationsByZone.set(opts.zone.id, decorations)');
    expect(code).not.toContain('generateDecorations(world.cfg.seed)');
  });

  it('draws the active-world armoury footprint with its dedicated token', () => {
    const trace = newTrace();
    installMapStyleGlobals(trace);
    const ctx = fakeMapContext(trace);
    const painter = new MapWindowPainter(classColor);
    const world = mapWorld();
    const emptyProps = emptyZoneProps();
    const background = { width: 560, height: 560 } as HTMLCanvasElement;
    const zone = ZONES[0];
    const options = {
      zone,
      zoneBg: {
        canvas: background,
        region: {
          minX: zone.xMin ?? STRIP_MIN_X,
          maxX: zone.xMax ?? STRIP_MAX_X,
          minZ: zone.zMin,
          maxZ: zone.zMax,
        },
      },
      canvasSize: 560,
      zoom: 6,
      center: { x: 17.5, z: -5.5 },
    };
    const buildingStyles = new Set([
      'paint:--color-map-building-armoury',
      'paint:--color-map-building-chapel',
      'paint:--color-map-building-inn',
      'paint:--color-map-building-house',
    ]);

    // An empty active-world props bundle must suppress the built-in Eastbrook
    // lots. This fails if the adapter silently falls back to static PROPS.
    setActiveWorldContent({ ...BUILTIN_WORLD, props: emptyProps });
    painter.paintOverworld(ctx, world, options);
    expect(trace.fills.filter((fill) => buildingStyles.has(fill.style))).toEqual([]);

    trace.fills.length = 0;
    setActiveWorldContent({
      ...BUILTIN_WORLD,
      props: {
        ...emptyProps,
        buildings: [
          {
            kind: 'inn',
            landmark: 'eastbrook_grand_armoury',
            x: 17.5,
            z: -5.5,
            w: 13,
            d: 9,
            rot: -Math.PI / 2,
          },
        ],
      },
    });
    painter.paintOverworld(ctx, world, options);

    const buildingFills = trace.fills
      .filter((fill) => buildingStyles.has(fill.style))
      .map(({ style, commands }) => ({ style, commands }));
    expect(buildingFills).toEqual([
      {
        style: 'paint:--color-map-building-armoury',
        commands: ['moveTo', 'lineTo', 'lineTo', 'lineTo', 'closePath'],
      },
    ]);
    expect(trace.styleReads.filter((token) => token.endsWith('building-armoury'))).toHaveLength(2);
  });
});

describe('map_window_painter: cadence + cached background preserved', () => {
  it("still redraws from hud.update()'s mediumHud band behind the display guard", () => {
    expect(hud).toContain(
      "if ($('#map-window').style.display === 'block') this.updateMapWindow();",
    );
    expect(hud).toContain('this.mapPainter.paintOverworld(ctx, this.sim, {');
  });

  it('wires landmark and gather hit targets: stores, clears, memos, and tooltip priority', () => {
    // The overworld paint stores this paint's hit-test markers; the delve and
    // non-zone branches clear them so no stale zone icon answers a tap.
    expect(hud).toContain('this.mapMarkerInteraction.setOverworld(result);');
    expect(markerInteraction).toContain('this.gatherNodes = EMPTY_MARKERS;');
    expect(markerInteraction).toContain('this.stations = EMPTY_MARKERS;');
    expect(markerInteraction).toContain('this.services = EMPTY_MARKERS;');
    expect(markerInteraction).toContain('this.navigation = EMPTY_MARKERS;');
    expect(hud.match(/this\.clearMapHitState\(canvas\);/g)).toHaveLength(4);
    // The gather-tip resolve memo resets inside the shared clear and beside the
    // overworld store, bounding its staleness at the same
    // mediumHud repaint that refreshes the painted icon.
    expect(markerInteraction.match(/this\.clearMemo\(\);/g)).toHaveLength(2);
    expect(hud.match(/this\.mapView = null;/g)).toHaveLength(1);
    expect(hud).toContain('this.continentRegions.length = 0;');
    // Point markers resolve globally by distance. Exact-distance ties follow
    // visual top order in the pure resolver; quest areas remain the fallback.
    const pointHitsAt = tooltipAdapter.indexOf('const pointHitCount = html');
    const pointLoopAt = tooltipAdapter.indexOf(
      'for (let i = 0; i < pointHitCount; i++)',
      pointHitsAt,
    );
    const npcAt = tooltipAdapter.indexOf("if (hit.kind === 'npc')", pointHitsAt);
    const navigationAt = tooltipAdapter.indexOf("else if (hit.kind === 'navigation')", pointHitsAt);
    const stationAt = tooltipAdapter.indexOf("else if (hit.kind === 'station')", pointHitsAt);
    const serviceAt = tooltipAdapter.indexOf("else if (hit.kind === 'service')", pointHitsAt);
    const gatherAt = tooltipAdapter.indexOf('else html = resolvers.gather', pointHitsAt);
    const areaAt = tooltipAdapter.indexOf('questAreaObjectivesAtInto(', pointHitsAt);
    expect(pointHitsAt).toBeGreaterThan(-1);
    expect(pointLoopAt).toBeGreaterThan(pointHitsAt);
    expect(npcAt).toBeGreaterThan(pointLoopAt);
    expect(navigationAt).toBeGreaterThan(npcAt);
    expect(stationAt).toBeGreaterThan(navigationAt);
    expect(serviceAt).toBeGreaterThan(stationAt);
    expect(gatherAt).toBeGreaterThan(serviceAt);
    expect(areaAt).toBeGreaterThan(gatherAt);
    expect(tooltipAdapter).toContain('pointHits,');
    expect(tooltipAdapter).toContain('questObjectives);');
    expect(tooltipAdapter).toContain('if (!html && questAreas.length > 0)');
    expect(tooltipAdapter).toContain('resolvers.questArea(questObjectives, objectiveCount)');
    // Touch passes through the same resolver with a finger-sized radius in CSS
    // pixels converted to the map's backing coordinates.
    expect(tooltipAdapter).toContain(
      'MAP_TOUCH_POINT_HIT_RADIUS_CSS_PX * geometry.backingPerCssPx',
    );
    expect(hud).toContain('showMapTipAt(clientX, clientY, true)');
    expect(tooltipAdapter).toContain('resolvers.service(hit.marker)');
    expect(markerTooltipContent).toContain("marker.kind === 'mailbox'");
    expect(markerTooltipContent).toContain("'worldContent.mailboxName'");
    expect(markerTooltipContent).toContain("'worldContent.noticeboardName'");
    expect(markerTooltipContent).toContain('stationNameText(marker.type)');
    expect(tooltipAdapter).toContain('resolvers.station(hit.marker)');
    // Pointer motion must not mint resolver closures or input bags. Both are
    // stable Hud-owned fields passed straight through the tiny hot-path method.
    const method = markerInteraction.slice(
      markerInteraction.indexOf('showAt('),
      markerInteraction.indexOf('clear(): void', markerInteraction.indexOf('showAt(')),
    );
    expect(method).not.toContain('=>');
    expect(method).not.toContain('new ');
    expect(method).not.toContain(' = {');
    expect(method).not.toContain(' = [');
    expect(method).not.toContain('const state =');
    expect(method).not.toContain('const resolvers =');
    expect(method).toContain('this.pointHits');
    expect(method).toContain('this.questObjectives');
    expect(method).toContain('this.tooltipResolvers');
    expect(method).not.toContain('getBoundingClientRect');
    const pointerPath = tooltipAdapter.slice(tooltipAdapter.indexOf('showMapMarkerTooltipAt('));
    expect(pointerPath).not.toContain('getBoundingClientRect');
    expect(tooltipAdapter).not.toContain('getBoundingClientRect');
    expect(markerInteraction.match(/\.getBoundingClientRect\(/g)).toHaveLength(1);
    expect(hud).toContain('this.mapMarkerInteraction.refreshGeometry(canvas);');
    expect(hud).toContain(
      "if (el.id === 'map-window') this.mapMarkerInteraction.refreshCurrentGeometry();",
    );
    // The gather arm resolves through the shared world-hover pair (behind the
    // tested memo seam), so the map tip and the 3D node tip cannot disagree.
    expect(markerTooltipContent).toContain('resolveGatherTipMemo(this.gatherMemo, marker.nodeId');
    expect(markerTooltipContent).toContain('buildGatherNodeTooltip(this.world, nodeId)');
    expect(markerTooltipContent).toContain('gatherNodeTooltipHtml(model)');
  });

  it('accepts only the current Hud-owned zone background and never prewarms all zones', () => {
    // The painter receives one cached bg and only drawImages it (no terrain build).
    expect(code).toContain('ctx.drawImage(');
    expect(code).not.toContain('paintTerrainRows');
    expect(code).not.toContain('renderTerrainCanvas');
    expect(code).toContain('zoneBg: MapZoneBg');
    expect(code).not.toContain('zoneBgs');
    expect(hud).toContain('canvas: this.mapZoneBg(zone)');
    expect(hud).not.toContain('prewarmAllZones');
  });
});

// ---------------------------------------------------------------------------
// Label sprites (issue 2476): every on-canvas label is a cached blit.
// ---------------------------------------------------------------------------

const LABEL_ZONE = ZONES[0];
const LABEL_ZONE_CZ = (LABEL_ZONE.zMin + LABEL_ZONE.zMax) / 2;

// Real content rather than a synthetic fixture, so a rename in the quest tables
// cannot leave this passing against a stale expectation.
function questWithGiver() {
  const quest = Object.values(QUESTS).find((q) => q.giverNpcId);
  if (!quest) throw new Error('expected a quest with a giverNpcId');
  return quest;
}

function killQuestInZone() {
  for (const quest of Object.values(QUESTS)) {
    for (const objective of quest.objectives) {
      if (objective.type !== 'kill') continue;
      const camp = CAMPS.find(
        (c) =>
          c.mobId === objective.targetMobId &&
          c.center.z >= LABEL_ZONE.zMin &&
          c.center.z < LABEL_ZONE.zMax,
      );
      if (camp) return quest;
    }
  }
  throw new Error('expected a kill quest with a camp in the first zone');
}

function dungeonName(id: string): string {
  const dungeon = DUNGEON_LIST.find((d) => d.id === id);
  if (!dungeon) throw new Error(`unknown dungeon ${id}`);
  return dungeon.name;
}

/** A world that exercises every label layer at once: the zone title, the POI
 *  labels, a dungeon portal name, a quest-giver glyph, two ally names, and a
 *  numbered quest badge. */
function labelWorld(): IWorld {
  const giver = questWithGiver();
  const kill = killQuestInZone();
  return {
    player: { id: 1, kind: 'player', name: 'Painter', pos: { x: 0, z: LABEL_ZONE_CZ }, facing: 0 },
    entities: new Map([
      [
        2,
        {
          id: 2,
          kind: 'npc',
          name: 'Giver',
          templateId: giver.giverNpcId,
          questIds: [giver.id],
          pos: { x: 10, z: LABEL_ZONE_CZ },
        },
      ],
    ]),
    socialInfo: {
      friends: [{ id: 10, name: 'FriendA', online: true, x: 4, z: LABEL_ZONE_CZ }],
      guild: { members: [{ id: 11, name: 'GuildB', online: true, x: 6, z: LABEL_ZONE_CZ }] },
    },
    cfg: { seed: 42, playerClass: 'warrior' },
    questState: (q: string) => (q === giver.id ? 'available' : 'unavailable'),
    questLog: new Map<string, QuestProgress>([
      [
        kill.id,
        { questId: kill.id, counts: kill.objectives.map(() => 0), state: 'active' as const },
      ],
    ]),
    // The quest-marker inputs both worlds expose (the phase 23 classifier).
    questsDone: new Set<string>(),
    craftingIdentity: { version: 1, synced: true, cadenceBlockedQuests: [] },
    inventory: [],
    gatheringProficiency: {},
    stationPlacements: [],
    civicServicePlacements: [],
    nodeHarvestableByMe: () => true,
  } as unknown as IWorld;
}

/** A quest whose giver is also its turn-in npc, so one npc can show the '?'
 *  (ready) glyph rather than the '!' (available) one. */
function turnInQuestWithGiver() {
  const quest = Object.values(QUESTS).find(
    (q) => q.giverNpcId && isQuestTurnInNpc(q, q.giverNpcId),
  );
  if (!quest) throw new Error('expected a quest whose giver is also a turn-in npc');
  return quest;
}

/** The same world with its one quest-giver ready to turn in. */
function readyGlyphWorld(): IWorld {
  const quest = turnInQuestWithGiver();
  const world = labelWorld() as unknown as {
    entities: Map<number, { templateId: string; questIds: string[] }>;
    questState: (q: string) => string;
  };
  const npc = world.entities.get(2);
  if (!npc) throw new Error('expected the fixture npc');
  npc.templateId = quest.giverNpcId as string;
  npc.questIds = [quest.id];
  world.questState = (q: string) => (q === quest.id ? 'ready' : 'unavailable');
  return world as unknown as IWorld;
}

/** The label fixture's one NPC staged in each drawable map quest state. */
function questVariantWorld(state: 'available' | 'ready' | 'repeat' | 'cooldown'): IWorld {
  if (state === 'ready') return readyGlyphWorld();
  if (state === 'available') return labelWorld();
  const workOrder = Object.values(QUESTS).find((q) => q.repeatable && q.repeatCadenceTicks);
  if (!workOrder) throw new Error('expected a cadenced work order');
  const world = labelWorld() as unknown as {
    entities: Map<number, { templateId: string; questIds: string[] }>;
    questState: (q: string) => string;
    questsDone: Set<string>;
    craftingIdentity: { cadenceBlockedQuests: string[] };
  };
  const npc = world.entities.get(2);
  if (!npc) throw new Error('expected the fixture npc');
  npc.templateId = workOrder.giverNpcId;
  npc.questIds = [workOrder.id];
  world.questsDone = new Set([workOrder.id]);
  world.questState = (q) =>
    state === 'repeat' && q === workOrder.id ? 'available' : 'unavailable';
  world.craftingIdentity.cadenceBlockedQuests = state === 'cooldown' ? [workOrder.id] : [];
  return world as unknown as IWorld;
}

/** A world with more distinct ally names than the sprite budget holds, so a
 *  redraw overshoots it and the next redraw's trim is observable. */
function crowdedAllyWorld(count: number): IWorld {
  const world = labelWorld() as unknown as {
    socialInfo: { friends: Array<Record<string, unknown>>; guild: null };
  };
  world.socialInfo = {
    friends: Array.from({ length: count }, (_, i) => ({
      id: 100 + i,
      name: `Ally${i}`,
      online: true,
      x: -40 + (i % 60),
      z: LABEL_ZONE_CZ,
    })),
    guild: null,
  };
  return world as unknown as IWorld;
}

/** The same world with nothing in the quest log, so the painter draws no quest
 *  areas and no badges. This is the arm where the portal block's own stroke
 *  state is load-bearing: with quest areas present the badge block happens to
 *  leave the outline color behind, so the portal block inherits it by luck. */
function noQuestWorld(): IWorld {
  const world = labelWorld() as unknown as {
    questLog: Map<string, unknown>;
    questState: (q: string) => string;
  };
  world.questLog = new Map();
  world.questState = () => 'unavailable';
  return world as unknown as IWorld;
}

/** Two active quests whose kill objectives share one camp, so a single quest
 *  area carries TWO badge numbers and the side-by-side layout is exercised. */
function sharedCampWorld(): { world: IWorld; questIds: string[] } {
  const shared = new Map<string, string[]>();
  for (const quest of Object.values(QUESTS)) {
    for (const objective of quest.objectives) {
      if (objective.type !== 'kill') continue;
      const camp = CAMPS.find(
        (c) =>
          c.mobId === objective.targetMobId &&
          c.center.z >= LABEL_ZONE.zMin &&
          c.center.z < LABEL_ZONE.zMax,
      );
      if (!camp) continue;
      const ids = shared.get(String(objective.targetMobId)) ?? [];
      if (!ids.includes(quest.id)) ids.push(quest.id);
      shared.set(String(objective.targetMobId), ids);
    }
  }
  const pair = [...shared.values()].find((ids) => ids.length >= 2);
  if (!pair) throw new Error('expected two quests sharing a camp in the first zone');
  const questIds = pair.slice(0, 2);
  const world = labelWorld() as unknown as { questLog: Map<string, QuestProgress> };
  world.questLog = new Map(
    questIds.map((id) => [
      id,
      {
        questId: id,
        counts: (QUESTS[id]?.objectives ?? []).map(() => 0),
        state: 'active' as const,
      },
    ]),
  );
  return { world: world as unknown as IWorld, questIds };
}

/** The dungeon name the committed zone's one portal carries. */
function portalLabelText(): string {
  return dungeonName(overworldDungeonPortals(DUNGEON_LIST, LABEL_ZONE.zMin, LABEL_ZONE.zMax)[0].id);
}

/** Every label this world must put on the canvas, sourced from the content
 *  tables rather than from the painter's own localizers. */
function expectedLabels(): Set<string> {
  return new Set<string>([
    LABEL_ZONE.name,
    ...LABEL_ZONE.pois.map((poi) => poi.label),
    ...overworldDungeonPortals(DUNGEON_LIST, LABEL_ZONE.zMin, LABEL_ZONE.zMax).map((portal) =>
      dungeonName(portal.id),
    ),
    'FriendA',
    'GuildB',
    '1', // the single active quest's badge number
  ]);
}

function labelPaintOptions(ping?: { x: number; z: number }) {
  return {
    zone: LABEL_ZONE,
    // The committed zone background, in the painter's own shape: a cached
    // canvas plus the world region it covers (the painter composites only the
    // current zone's plate, so it needs the rect to place it).
    zoneBg: {
      canvas: { width: 560, height: 560 } as HTMLCanvasElement,
      region: {
        minX: LABEL_ZONE.xMin ?? STRIP_MIN_X,
        maxX: LABEL_ZONE.xMax ?? STRIP_MAX_X,
        minZ: LABEL_ZONE.zMin,
        maxZ: LABEL_ZONE.zMax,
      },
    },
    canvasSize: 560,
    zoom: 1,
    center: null,
    ping: ping ?? null,
  };
}

function zonePaintOptions(zone: (typeof ZONES)[number]) {
  return {
    zone,
    zoneBg: {
      canvas: { width: 560, height: 560 } as HTMLCanvasElement,
      region: {
        minX: zone.xMin ?? STRIP_MIN_X,
        maxX: zone.xMax ?? STRIP_MAX_X,
        minZ: zone.zMin,
        maxZ: zone.zMax,
      },
    },
    canvasSize: 560,
    zoom: 1,
    center: null,
    ping: null,
  };
}

const TEST_STATION_TYPES = [
  'forge',
  'kitchens',
  'apothecary',
  'tannery',
  'loom',
  'toolworks',
] as const;

function stationTypesLabelWorld(types: readonly (typeof TEST_STATION_TYPES)[number][]): IWorld {
  const world = labelWorld() as unknown as { stationPlacements: unknown[] };
  const minX = LABEL_ZONE.xMin ?? STRIP_MIN_X;
  const maxX = LABEL_ZONE.xMax ?? STRIP_MAX_X;
  const step = (maxX - minX) / (types.length + 1);
  world.stationPlacements = types.map((type, index) => ({
    id: `station_test_${type}`,
    type,
    zoneId: LABEL_ZONE.id,
    pos: { x: minX + step * (index + 1), z: LABEL_ZONE_CZ },
    masterNpcId: `test_${type}_master`,
  }));
  return world as unknown as IWorld;
}

function stationLabelWorld(): IWorld {
  return stationTypesLabelWorld(['forge']);
}

function serviceWorldContent() {
  const noticeboard = BUILTIN_WORLD.services?.noticeboards?.[0];
  if (!noticeboard) throw new Error('expected the built-in noticeboard fixture');
  return {
    ...BUILTIN_WORLD,
    services: {
      ...BUILTIN_WORLD.services,
      stations: [],
      mailboxes: [{ x: 24, z: LABEL_ZONE_CZ + 18 }],
      noticeboards: [
        {
          ...noticeboard,
          x: -26,
          z: LABEL_ZONE_CZ - 20,
          frontStandingPoint: { x: -26, z: LABEL_ZONE_CZ - 22 },
        },
      ],
      musterBoards: BUILTIN_WORLD.services?.musterBoards ?? [],
    },
  };
}

function serviceLabelWorld(): IWorld {
  const world = labelWorld() as unknown as {
    civicServicePlacements: Array<{
      kind: 'mailbox' | 'noticeboard';
      x: number;
      z: number;
    }>;
  };
  const services = serviceWorldContent().services;
  world.civicServicePlacements = [
    ...(services.mailboxes ?? []).map(({ x, z }) => ({ kind: 'mailbox' as const, x, z })),
    ...(services.noticeboards ?? []).map(({ x, z }) => ({
      kind: 'noticeboard' as const,
      x,
      z,
    })),
  ];
  return world as unknown as IWorld;
}

describe('map_window_painter: painted stable marker sprites', () => {
  it('routes dungeon entrances through mapDungeon while preserving their labels', () => {
    const markerArt = fakeMarkerArt(['dungeon-entrance']);
    const trace = newTrace();
    installMapStyleGlobals(trace);
    setActiveWorldContent(BUILTIN_WORLD);
    const world = labelWorld();

    new MapWindowPainter(classColor, markerArt.art).paintOverworld(
      fakeMapContext(trace),
      world,
      labelPaintOptions(),
    );
    const model = buildOverworldMapModel({
      world,
      props: BUILTIN_WORLD.props,
      zone: LABEL_ZONE,
      zoom: 1,
      center: null,
      canvasSize: 560,
      decorations: [],
      ping: null,
    });
    const portals = overworldDungeonPortals(DUNGEON_LIST, LABEL_ZONE.zMin, LABEL_ZONE.zMax);
    const calls = markerArt.calls.filter((call) => call.id === 'dungeon-entrance');
    expect(calls).toEqual(portals.map(() => ({ id: 'dungeon-entrance', size: 'mapDungeon' })));
    const blits = trace.markerBlits.filter((blit) => blit.sprite.markerId === 'dungeon-entrance');
    expect(blits).toHaveLength(portals.length);
    expect(blits.map(({ sprite, dx, dy }) => ({ sprite, dx, dy }))).toEqual(
      model.portals.map((portal) => ({
        sprite: { markerId: 'dungeon-entrance', sizeId: 'mapDungeon' },
        dx: Math.round(portal.mx - MAP_MARKER_SIZES.mapDungeon / 2),
        dy: Math.round(portal.my - MAP_MARKER_SIZES.mapDungeon / 2),
      })),
    );
    for (const portal of portals) {
      expect(trace.blits.some((blit) => spriteText(blit.sprite) === dungeonName(portal.id))).toBe(
        true,
      );
    }
  });

  it.each([
    { kind: 'delve-entrance', id: 'delve-entrance' },
    { kind: 'world-passage', id: 'world-passage' },
  ] as const)('routes static $kind sites through mapNavigation art', ({ kind, id }) => {
    const site = STABLE_MAP_NAVIGATION_LANDMARKS.find((landmark) => landmark.kind === kind);
    if (!site) throw new Error(`expected a shipped ${kind} site`);
    const zone = ZONES.find((candidate) => candidate.id === site.zoneId);
    if (!zone) throw new Error(`unknown zone ${site.zoneId}`);
    const world = mapWorld();
    const markerArt = fakeMarkerArt([id]);
    const trace = newTrace();
    installMapStyleGlobals(trace);
    setActiveWorldContent(BUILTIN_WORLD);

    const result = new MapWindowPainter(classColor, markerArt.art).paintOverworld(
      fakeMapContext(trace),
      world,
      zonePaintOptions(zone),
    );

    const matching = result.navigation.filter((marker) => marker.kind === kind);
    expect(matching).toHaveLength(1);
    expect(markerArt.calls.filter((call) => call.id === id)).toEqual([
      { id, size: 'mapNavigation' },
    ]);
    expect(trace.markerBlits.filter((blit) => blit.sprite.markerId === id)).toEqual([
      expect.objectContaining({ sprite: { markerId: id, sizeId: 'mapNavigation' }, alpha: 1 }),
    ]);
  });

  it.each([
    {
      kind: 'delve-entrance',
      id: 'delve-entrance',
      commands: 'arc,lineTo,lineTo,closePath',
      args(marker: { mx: number; my: number }): number[] {
        const radius = 22 * 0.33;
        return [
          marker.mx,
          marker.my,
          radius,
          Math.PI,
          Math.PI * 2,
          marker.mx + radius,
          marker.my + radius,
          marker.mx - radius,
          marker.my + radius,
        ];
      },
    },
    {
      kind: 'world-passage',
      id: 'world-passage',
      commands: 'moveTo,lineTo,lineTo,closePath,moveTo,lineTo,lineTo,closePath',
      args(marker: { mx: number; my: number }): number[] {
        const radius = 22 * 0.33;
        return [
          marker.mx - radius,
          marker.my - radius,
          marker.mx,
          marker.my,
          marker.mx - radius,
          marker.my + radius,
          marker.mx + radius,
          marker.my - radius,
          marker.mx,
          marker.my,
          marker.mx + radius,
          marker.my + radius,
        ];
      },
    },
  ] as const)(
    'keeps the full-map $kind silhouette visible while generated art is unavailable',
    ({ kind, id, commands, args }) => {
      const site = STABLE_MAP_NAVIGATION_LANDMARKS.find((landmark) => landmark.kind === kind);
      if (!site) throw new Error(`expected a shipped ${kind} site`);
      const zone = ZONES.find((candidate) => candidate.id === site.zoneId);
      if (!zone) throw new Error(`unknown zone ${site.zoneId}`);
      const markerArt = fakeMarkerArt([]);
      const trace = newTrace();
      installMapStyleGlobals(trace);
      setActiveWorldContent(BUILTIN_WORLD);

      const result = new MapWindowPainter(classColor, markerArt.art).paintOverworld(
        fakeMapContext(trace),
        mapWorld(),
        zonePaintOptions(zone),
      );

      const marker = result.navigation.find((candidate) => candidate.kind === kind);
      if (!marker) throw new Error(`expected painted ${kind} marker`);
      expect(markerArt.calls.filter((call) => call.id === id)).toEqual([
        { id, size: 'mapNavigation' },
      ]);
      expect(trace.markerBlits.filter((blit) => blit.sprite.markerId === id)).toEqual([]);
      const fill = trace.fills.find(
        (candidate) =>
          candidate.style === 'paint:--color-map-portal-dot' &&
          candidate.commands.join() === commands &&
          candidate.args[0] === args(marker)[0],
      );
      expect(fill, `${kind} fallback fill`).toBeDefined();
      expect(fill?.args).toEqual(args(marker));
      const stroke = trace.strokes.find((candidate) => candidate.at > (fill?.at ?? -1));
      expect(stroke).toMatchObject({
        style: 'paint:--color-map-outline',
        lineWidth: 1.5,
        commands: commands.split(','),
        args: args(marker),
      });
    },
  );

  it.each([
    {
      profile: 'standard',
      rank: null,
      size: 'mapNavigation',
      sizePx: 22,
      pips: 0,
      outlineWidth: 1.5,
    },
    {
      profile: 'standard',
      rank: 'C',
      size: 'mapNavigationRankC',
      sizePx: 22,
      pips: 1,
      outlineWidth: 1.5,
    },
    {
      profile: 'standard',
      rank: 'B',
      size: 'mapNavigationRankB',
      sizePx: 22,
      pips: 2,
      outlineWidth: 1.5,
    },
    {
      profile: 'standard',
      rank: 'A',
      size: 'mapNavigationRankA',
      sizePx: 22,
      pips: 3,
      outlineWidth: 1.5,
    },
    {
      profile: 'standard',
      rank: 'S',
      size: 'mapNavigationRankS',
      sizePx: 22,
      pips: 4,
      outlineWidth: 1.5,
    },
    {
      profile: 'compact',
      rank: null,
      size: 'mapNavigationCompact',
      sizePx: 30,
      pips: 0,
      outlineWidth: 2,
    },
    {
      profile: 'compact',
      rank: 'C',
      size: 'mapNavigationRankCCompact',
      sizePx: 30,
      pips: 1,
      outlineWidth: 2,
    },
    {
      profile: 'compact',
      rank: 'B',
      size: 'mapNavigationRankBCompact',
      sizePx: 30,
      pips: 2,
      outlineWidth: 2,
    },
    {
      profile: 'compact',
      rank: 'A',
      size: 'mapNavigationRankACompact',
      sizePx: 30,
      pips: 3,
      outlineWidth: 2,
    },
    {
      profile: 'compact',
      rank: 'S',
      size: 'mapNavigationRankSCompact',
      sizePx: 30,
      pips: 4,
      outlineWidth: 2,
    },
  ] as const)(
    'keeps the $profile full-map Rift rank $rank fallback visible with $pips literal pips',
    ({ profile, rank, size, sizePx, pips, outlineWidth }) => {
      const world = mapWorld() as unknown as {
        player: { pos: { x: number; z: number } };
        entities: Map<number, unknown>;
      };
      world.player.pos = { x: 0, z: LABEL_ZONE_CZ };
      world.entities = new Map([
        [
          99,
          {
            id: 99,
            kind: 'object',
            templateId: 'rift_portal',
            name: 'The Loading Rift',
            ...(rank === null ? {} : { riftTier: rank }),
            pos: { x: 20, z: LABEL_ZONE_CZ },
          },
        ],
      ]);
      const markerArt = fakeMarkerArt([]);
      const trace = newTrace();
      installMapStyleGlobals(trace);
      setActiveWorldContent(BUILTIN_WORLD);
      const resolveProfile = vi.fn(() => profile);

      const result = new MapWindowPainter(classColor, markerArt.art, resolveProfile).paintOverworld(
        fakeMapContext(trace),
        world as unknown as IWorld,
        labelPaintOptions(),
      );

      expect(resolveProfile).toHaveBeenCalledTimes(1);
      const marker = result.navigation.find((candidate) => candidate.kind === 'rift-entrance');
      if (!marker) throw new Error('expected live Rift navigation marker');
      expect(marker.rank).toBe(rank);
      expect(markerArt.calls.filter((call) => call.id === 'rift-entrance')).toEqual([
        { id: 'rift-entrance', size },
      ]);
      expect(trace.markerBlits.filter((blit) => blit.sprite.markerId === 'rift-entrance')).toEqual(
        [],
      );

      const radius = sizePx * 0.33;
      const core = radius * 0.38;
      expect(
        trace.fills
          .filter(
            (fill) =>
              fill.commands.join() === 'arc' &&
              fill.args[0] === marker.mx &&
              fill.args[1] === marker.my,
          )
          .map(({ style, commands, args }) => ({ style, commands, args })),
      ).toEqual([
        {
          style: 'paint:--color-map-portal-dot',
          commands: ['arc'],
          args: [marker.mx, marker.my, radius, 0, Math.PI * 2],
        },
        {
          style: 'paint:--color-map-outline',
          commands: ['arc'],
          args: [marker.mx, marker.my, core, 0, Math.PI * 2],
        },
      ]);
      expect(
        trace.strokes.find(
          (stroke) =>
            stroke.commands.join() === 'arc' &&
            stroke.args[0] === marker.mx &&
            stroke.args[1] === marker.my,
        ),
      ).toMatchObject({
        style: 'paint:--color-map-outline',
        lineWidth: outlineWidth,
        args: [marker.mx, marker.my, radius, 0, Math.PI * 2],
      });

      const pip = Math.max(1, sizePx * 0.13);
      const gap = sizePx * 0.08;
      const pipWidth = pips * pip + Math.max(0, pips - 1) * gap;
      const paintedPips = trace.fillRects.filter(
        (rect) => rect.style === 'paint:--color-map-player',
      );
      expect(paintedPips).toHaveLength(pips);
      paintedPips.forEach((rect, index) => {
        // The painter advances a running x; compare geometry numerically so a
        // harmless floating-association bit cannot masquerade as a missing pip.
        expect(rect.x).toBeCloseTo(marker.mx - pipWidth / 2 + index * (pip + gap), 12);
        expect(rect.y).toBeCloseTo(marker.my + radius * 0.58, 12);
        expect(rect.width).toBe(pip);
        expect(rect.height).toBe(pip);
      });
    },
  );

  it('routes a nearby live S-rank Rift through ranked zone-map art', () => {
    const world = mapWorld() as unknown as {
      player: { pos: { x: number; z: number } };
      entities: Map<number, unknown>;
    };
    world.player.pos = { x: 0, z: LABEL_ZONE_CZ };
    world.entities = new Map([
      [
        99,
        {
          id: 99,
          kind: 'object',
          templateId: 'rift_portal',
          name: 'The Painted Rift',
          riftTier: 'S',
          pos: { x: 20, z: LABEL_ZONE_CZ },
        },
      ],
    ]);
    const markerArt = fakeMarkerArt(['rift-entrance']);
    const trace = newTrace();
    installMapStyleGlobals(trace);
    setActiveWorldContent(BUILTIN_WORLD);

    const result = new MapWindowPainter(classColor, markerArt.art).paintOverworld(
      fakeMapContext(trace),
      world as unknown as IWorld,
      labelPaintOptions(),
    );

    expect(result.navigation).toContainEqual(
      expect.objectContaining({ kind: 'rift-entrance', name: 'The Painted Rift', rank: 'S' }),
    );
    expect(markerArt.calls.filter((call) => call.id === 'rift-entrance')).toEqual([
      { id: 'rift-entrance', size: 'mapNavigationRankS' },
    ]);
    expect(
      trace.markerBlits.filter((blit) => blit.sprite.markerId === 'rift-entrance')[0]?.sprite,
    ).toEqual({ markerId: 'rift-entrance', sizeId: 'mapNavigationRankS' });
  });

  it('centers station art at mapStation and draws the quest painting over it', () => {
    const markerArt = fakeMarkerArt(['station-forge', 'quest-available']);
    const trace = newTrace();
    installMapStyleGlobals(trace);
    setActiveWorldContent(BUILTIN_WORLD);

    const result = new MapWindowPainter(classColor, markerArt.art).paintOverworld(
      fakeMapContext(trace),
      stationLabelWorld(),
      labelPaintOptions(),
    );

    expect(result.stations).toHaveLength(1);
    expect(markerArt.calls.filter((call) => call.id === 'station-forge')).toEqual([
      { id: 'station-forge', size: 'mapStation' },
    ]);
    const stationBlit = trace.markerBlits.find((blit) => blit.sprite.markerId === 'station-forge');
    expect(stationBlit).toMatchObject({
      sprite: { markerId: 'station-forge', sizeId: 'mapStation' },
      dx: Math.round(result.stations[0].mx - MAP_MARKER_SIZES.mapStation / 2),
      dy: Math.round(result.stations[0].my - MAP_MARKER_SIZES.mapStation / 2),
      alpha: 1,
    });
    const questBlit = trace.markerBlits.find((blit) => blit.sprite.markerId === 'quest-available');
    expect(questBlit, 'fixture must carry actionable quest art').toBeDefined();
    expect(stationBlit?.at).toBeLessThan(questBlit?.at ?? -1);
  });

  it('routes all six crafting-station identities through mapStation art', () => {
    const stationIds = TEST_STATION_TYPES.map((type) => `station-${type}` as MapMarkerArtId);
    const markerArt = fakeMarkerArt(stationIds);
    const trace = newTrace();
    installMapStyleGlobals(trace);
    setActiveWorldContent(BUILTIN_WORLD);

    const result = new MapWindowPainter(classColor, markerArt.art).paintOverworld(
      fakeMapContext(trace),
      stationTypesLabelWorld(TEST_STATION_TYPES),
      labelPaintOptions(),
    );

    expect(result.stations.map((station) => station.type)).toEqual(TEST_STATION_TYPES);
    expect(markerArt.calls.filter((call) => call.id.startsWith('station-'))).toEqual(
      stationIds.map((id) => ({ id, size: 'mapStation' })),
    );
    const blits = trace.markerBlits.filter((blit) => blit.sprite.markerId.startsWith('station-'));
    expect(blits.map((blit) => blit.sprite)).toEqual(
      stationIds.map((markerId) => ({ markerId, sizeId: 'mapStation' })),
    );
    expect(blits.map(({ dx, dy }) => ({ dx, dy }))).toEqual(
      result.stations.map((station) => ({
        dx: Math.round(station.mx - MAP_MARKER_SIZES.mapStation / 2),
        dy: Math.round(station.my - MAP_MARKER_SIZES.mapStation / 2),
      })),
    );
  });

  it('falls back to the station diamond when its sprite is unavailable', () => {
    const markerArt = fakeMarkerArt([]);
    const trace = newTrace();
    installMapStyleGlobals(trace);
    setActiveWorldContent(BUILTIN_WORLD);

    const result = new MapWindowPainter(classColor, markerArt.art).paintOverworld(
      fakeMapContext(trace),
      stationLabelWorld(),
      labelPaintOptions(),
    );

    expect(result.stations).toHaveLength(1);
    expect(markerArt.calls.filter((call) => call.id === 'station-forge')).toEqual([
      { id: 'station-forge', size: 'mapStation' },
    ]);
    expect(trace.markerBlits.some((blit) => blit.sprite.markerId === 'station-forge')).toBe(false);
    const diamond = trace.fills.find(
      (fill) =>
        fill.style === 'paint:--color-map-stall' &&
        fill.commands.join() === 'moveTo,lineTo,lineTo,lineTo,closePath',
    );
    expect(diamond, 'missing station art must retain the procedural diamond').toBeDefined();
    const outline = trace.strokes.find((stroke) => stroke.at > (diamond?.at ?? Number.MAX_VALUE));
    expect(outline).toMatchObject({
      style: 'paint:--color-map-outline',
      lineWidth: 1.5,
      commands: ['moveTo', 'lineTo', 'lineTo', 'lineTo', 'closePath'],
    });
  });

  it('routes civic services through exact mapService art, result markers, and quest-underlay order', () => {
    const markerArt = fakeMarkerArt(['service-mailbox', 'service-noticeboard', 'quest-available']);
    const trace = newTrace();
    installMapStyleGlobals(trace);
    setActiveWorldContent(serviceWorldContent());

    const result = new MapWindowPainter(classColor, markerArt.art).paintOverworld(
      fakeMapContext(trace),
      serviceLabelWorld(),
      labelPaintOptions(),
    );

    expect(MAP_MARKER_SIZES.mapService).toBe(20);
    expect(result.services.map((service) => service.kind)).toEqual(['mailbox', 'noticeboard']);
    expect(markerArt.calls.filter((call) => call.id.startsWith('service-'))).toEqual([
      { id: 'service-mailbox', size: 'mapService' },
      { id: 'service-noticeboard', size: 'mapService' },
    ]);
    const serviceBlits = trace.markerBlits.filter((blit) =>
      blit.sprite.markerId.startsWith('service-'),
    );
    expect(serviceBlits.map((blit) => blit.sprite)).toEqual([
      { markerId: 'service-mailbox', sizeId: 'mapService' },
      { markerId: 'service-noticeboard', sizeId: 'mapService' },
    ]);
    expect(serviceBlits.map(({ dx, dy }) => ({ dx, dy }))).toEqual(
      result.services.map((service) => ({
        dx: Math.round(service.mx - MAP_MARKER_SIZES.mapService / 2),
        dy: Math.round(service.my - MAP_MARKER_SIZES.mapService / 2),
      })),
    );
    const questBlit = trace.markerBlits.find((blit) => blit.sprite.markerId === 'quest-available');
    expect(questBlit, 'fixture must carry actionable quest art').toBeDefined();
    expect(Math.max(...serviceBlits.map((blit) => blit.at))).toBeLessThan(questBlit?.at ?? -1);
  });

  it('keeps distinct mailbox and noticeboard fallbacks at their returned hit coordinates', () => {
    const markerArt = fakeMarkerArt([]);
    const trace = newTrace();
    installMapStyleGlobals(trace);
    setActiveWorldContent(serviceWorldContent());

    const result = new MapWindowPainter(classColor, markerArt.art).paintOverworld(
      fakeMapContext(trace),
      serviceLabelWorld(),
      labelPaintOptions(),
    );

    expect(result.services.map((service) => service.kind)).toEqual(['mailbox', 'noticeboard']);
    expect(markerArt.calls.filter((call) => call.id.startsWith('service-'))).toEqual([
      { id: 'service-mailbox', size: 'mapService' },
      { id: 'service-noticeboard', size: 'mapService' },
    ]);
    expect(trace.markerBlits.some((blit) => blit.sprite.markerId.startsWith('service-'))).toBe(
      false,
    );
    const [mailbox, noticeboard] = result.services;
    const serviceFills = trace.fills.filter(
      (fill) =>
        fill.style === 'paint:--color-map-stall' &&
        fill.commands.join() === 'moveTo,lineTo,lineTo,lineTo,closePath',
    );
    const radius = MAP_MARKER_SIZES.mapService / 3;
    const noticeHalfWidth = MAP_MARKER_SIZES.mapService * 0.375;
    const noticeHalfHeight = MAP_MARKER_SIZES.mapService * 0.22;
    expect(serviceFills.map((fill) => fill.args)).toEqual([
      [
        mailbox.mx,
        mailbox.my - radius,
        mailbox.mx + radius,
        mailbox.my,
        mailbox.mx,
        mailbox.my + radius,
        mailbox.mx - radius,
        mailbox.my,
      ],
      [
        noticeboard.mx - noticeHalfWidth,
        noticeboard.my - noticeHalfHeight,
        noticeboard.mx + noticeHalfWidth,
        noticeboard.my - noticeHalfHeight,
        noticeboard.mx + noticeHalfWidth,
        noticeboard.my + noticeHalfHeight,
        noticeboard.mx - noticeHalfWidth,
        noticeboard.my + noticeHalfHeight,
      ],
    ]);
    for (const fill of serviceFills) {
      const outline = trace.strokes.find((stroke) => stroke.at > fill.at);
      expect(outline).toMatchObject({
        style: 'paint:--color-map-outline',
        lineWidth: 1.5,
        commands: ['moveTo', 'lineTo', 'lineTo', 'lineTo', 'closePath'],
      });
    }
    const questOutline = trace.strokes.find(
      (stroke) => stroke.lineWidth === 4 && stroke.commands.join() === 'moveTo,lineTo',
    );
    expect(questOutline, 'fixture must carry the actionable quest fallback').toBeDefined();
    expect(Math.max(...serviceFills.map((fill) => fill.at))).toBeLessThan(questOutline?.at ?? -1);
  });

  it('uses one compact profile for landmark art, placement, labels, and ping geometry', () => {
    const markerArt = fakeMarkerArt([
      'dungeon-entrance',
      'station-forge',
      'service-mailbox',
      'service-noticeboard',
    ]);
    const trace = newTrace();
    installMapStyleGlobals(trace);
    setActiveWorldContent(BUILTIN_WORLD);
    const services = serviceLabelWorld() as unknown as {
      civicServicePlacements: unknown[];
    };
    const world = stationLabelWorld() as unknown as {
      civicServicePlacements: unknown[];
    };
    world.civicServicePlacements = services.civicServicePlacements;
    const portal = overworldDungeonPortals(DUNGEON_LIST, LABEL_ZONE.zMin, LABEL_ZONE.zMax)[0];
    if (!portal) throw new Error('expected a dungeon portal in the label zone');
    const profile = vi.fn(() => 'compact' as const);

    new MapWindowPainter(classColor, markerArt.art, profile).paintOverworld(
      fakeMapContext(trace),
      world as unknown as IWorld,
      labelPaintOptions({ x: portal.x, z: portal.z }),
    );

    expect(profile).toHaveBeenCalledTimes(1);
    expect(markerArt.calls.filter((call) => call.id === 'dungeon-entrance')).toEqual(
      overworldDungeonPortals(DUNGEON_LIST, LABEL_ZONE.zMin, LABEL_ZONE.zMax).map(() => ({
        id: 'dungeon-entrance',
        size: 'mapDungeonCompact',
      })),
    );
    expect(markerArt.calls.filter((call) => call.id === 'station-forge')).toEqual([
      { id: 'station-forge', size: 'mapStationCompact' },
    ]);
    expect(markerArt.calls.filter((call) => call.id.startsWith('service-'))).toEqual([
      { id: 'service-mailbox', size: 'mapServiceCompact' },
      { id: 'service-noticeboard', size: 'mapServiceCompact' },
    ]);
    expect(
      trace.markerBlits
        .filter((blit) =>
          ['dungeon-entrance', 'station-forge', 'service-mailbox', 'service-noticeboard'].includes(
            blit.sprite.markerId,
          ),
        )
        .map((blit) => blit.sprite.sizeId),
    ).toEqual(
      expect.arrayContaining([
        'mapDungeonCompact',
        'mapStationCompact',
        'mapServiceCompact',
        'mapServiceCompact',
      ]),
    );

    const portalMarker = buildOverworldMapModel({
      world: world as unknown as IWorld,
      props: BUILTIN_WORLD.props,
      zone: LABEL_ZONE,
      zoom: 1,
      center: null,
      canvasSize: 560,
      decorations: [],
      ping: { x: portal.x, z: portal.z },
      markerProfile: 'compact',
    }).portals[0];
    const portalName = trace.blits.find(
      (blit) => spriteText(blit.sprite) === dungeonName(portal.id),
    );
    expect(portalName && blitAnchor(portalName)).toEqual({
      x: Math.round(portalMarker.mx),
      y: Math.round(portalMarker.my - 17),
    });
    expect(
      trace.strokes
        .filter((stroke) => stroke.style === 'paint:--color-map-ping')
        .map((stroke) => ({ radius: stroke.args[2], lineWidth: stroke.lineWidth })),
    ).toEqual([
      { radius: 17, lineWidth: 4 },
      { radius: 23, lineWidth: 4 },
    ]);
  });

  it('uses that one compact profile for all live player, ally, and party geometry', () => {
    const trace = newTrace();
    installMapStyleGlobals(trace);
    setActiveWorldContent(BUILTIN_WORLD);
    const world = partyWorld();
    const profile = vi.fn(() => 'compact' as const);

    new MapWindowPainter(classColor, undefined, profile).paintOverworld(
      fakeMapContext(trace),
      world,
      labelPaintOptions(),
    );

    expect(profile).toHaveBeenCalledTimes(1);
    const player = trace.fills.find(
      (fill) =>
        fill.style === 'paint:--color-map-player' &&
        fill.commands.join() === 'moveTo,lineTo,lineTo,closePath',
    );
    expect(player?.args).toEqual([0, -10.5, 7.5, 9, -7.5, 9]);
    const liveDotStyles = new Set([
      'paint:--color-map-ally-friend',
      'paint:--color-map-ally-guild',
      'color:mage',
      'paint:--color-map-party-dead',
    ]);
    const liveDots = trace.fills.filter(
      (fill) => liveDotStyles.has(fill.style) && fill.commands.join() === 'arc',
    );
    expect(liveDots).toHaveLength(4);
    expect(liveDots.map((fill) => fill.args[2])).toEqual([6, 6, 6, 6]);
    const liveOutlines = [player, ...liveDots].map((fill) => {
      const stroke = trace.strokes.find((candidate) => candidate.at > (fill?.at ?? Infinity));
      return { style: stroke?.style, lineWidth: stroke?.lineWidth };
    });
    expect(liveOutlines).toEqual(
      Array.from({ length: 5 }, () => ({
        style: 'paint:--color-map-outline',
        lineWidth: 4,
      })),
    );

    const model = buildOverworldMapModel({
      world,
      props: BUILTIN_WORLD.props,
      zone: LABEL_ZONE,
      zoom: 1,
      center: null,
      canvasSize: 560,
      decorations: [],
      ping: null,
      markerProfile: 'compact',
    });
    const labelFont = (text: string): string | undefined =>
      trace.sprites.find((sprite) => spriteText(sprite) === text)?.fonts.at(-1);
    expect(labelFont(LABEL_ZONE.name)).toBe('bold 24px Georgia');
    expect(labelFont(LABEL_ZONE.pois[0].label)).toBe('bold 20px Georgia');
    expect(labelFont(portalLabelText())).toBe('bold 18px Georgia');
    expect(labelFont('FriendA')).toBe('bold 16px Georgia');
    expect(labelFont('Ally')).toBe('bold 16px Georgia');
    expect(labelFont('1')).toBe('bold 18px Georgia');
    const labelOutline = (text: string): number | undefined =>
      trace.sprites.find((sprite) => spriteText(sprite) === text)?.lineWidths.at(-1);
    expect(labelOutline(LABEL_ZONE.name)).toBe(4.5);
    expect(labelOutline(LABEL_ZONE.pois[0].label)).toBe(4.5);
    expect(labelOutline(portalLabelText())).toBe(4.5);
    expect(labelOutline('FriendA')).toBe(4);
    expect(labelOutline('Ally')).toBe(4);
    const titleBlit = trace.blits.find((entry) => spriteText(entry.sprite) === LABEL_ZONE.name);
    expect(titleBlit && blitAnchor(titleBlit)).toEqual({ x: 280, y: 30 });
    const questNumber = trace.blits.find((entry) => spriteText(entry.sprite) === '1');
    expect(questNumber && blitAnchor(questNumber)).toEqual({
      x: Math.round(model.questAreas[0].mx),
      y: Math.round(model.questAreas[0].my + 6),
    });
    for (const marker of [...model.allies, ...model.party]) {
      const blit = trace.blits.find((entry) => spriteText(entry.sprite) === marker.name);
      expect(blit && blitAnchor(blit)).toEqual({
        x: Math.round(marker.mx),
        y: Math.round(marker.my - 12),
      });
    }
  });
});

describe('map_window_painter: labels blit from the sprite cache', () => {
  it('returns direct references to every already-painted a11y marker family', () => {
    const trace = newTrace();
    installMapStyleGlobals(trace);
    setActiveWorldContent(BUILTIN_WORLD);
    const world = partyWorld();

    const result = new MapWindowPainter(classColor).paintOverworld(
      fakeMapContext(trace),
      world,
      labelPaintOptions(),
    );
    const model = buildOverworldMapModel({
      world,
      props: BUILTIN_WORLD.props,
      zone: LABEL_ZONE,
      zoom: 1,
      center: null,
      canvasSize: 560,
      decorations: [],
      ping: null,
    });

    expect(result.player).toEqual(model.player);
    expect(result.allies).toEqual(model.allies);
    expect(result.party).toEqual(model.party);
    expect(result.portals).toEqual(model.portals);
    expect(result.pois).toEqual(model.pois);
  });

  it('draws every label layer without touching the map context text API', () => {
    const trace = newTrace();
    installMapStyleGlobals(trace);
    setActiveWorldContent(BUILTIN_WORLD);
    const ctx = fakeMapContext(trace);

    new MapWindowPainter(classColor).paintOverworld(ctx, labelWorld(), labelPaintOptions());

    // The whole point of the change: no ctx.font assignment, no fillText,
    // strokeText or measureText on the surface the painter draws to.
    expect(trace.textApi).toEqual([]);
    // Every label was rasterized once, and every one of them was blitted.
    expect(new Set(trace.sprites.map(spriteText))).toEqual(expectedLabels());
    expect(new Set(trace.blits.map((blit) => spriteText(blit.sprite)))).toEqual(expectedLabels());
    expect(trace.blits.length).toBeGreaterThanOrEqual(trace.sprites.length);
  });

  it('lands each label on the anchor its layer names, rounded', () => {
    const trace = newTrace();
    installMapStyleGlobals(trace);
    setActiveWorldContent(BUILTIN_WORLD);
    const world = labelWorld();

    new MapWindowPainter(classColor).paintOverworld(
      fakeMapContext(trace),
      world,
      labelPaintOptions(),
    );

    // The same pure model the painter builds, so this pins the painter's OFFSETS
    // and rounding rather than re-deriving the projection.
    const model = buildOverworldMapModel({
      world,
      props: BUILTIN_WORLD.props,
      zone: LABEL_ZONE,
      zoom: 1,
      center: null,
      canvasSize: 560,
      decorations: [],
      ping: null,
    });
    const anchorOf = (text: string): { x: number; y: number } => {
      const blit = trace.blits.find((b) => spriteText(b.sprite) === text);
      if (!blit) throw new Error(`no blit for ${text}`);
      return blitAnchor(blit);
    };
    const at = (x: number, y: number): { x: number; y: number } => ({
      x: Math.round(x),
      y: Math.round(y),
    });

    // Title: centered on the canvas, on its own baseline row.
    expect(anchorOf(LABEL_ZONE.name)).toEqual(at(560 / 2, 20));
    // POI label: on the POI point itself.
    expect(anchorOf(LABEL_ZONE.pois[0].label)).toEqual(at(model.pois[0].mx, model.pois[0].my));
    // Dungeon name: 12px above its standard-profile portal badge.
    expect(anchorOf(portalLabelText())).toEqual(at(model.portals[0].mx, model.portals[0].my - 12));
    // Ally names: 8px above their dots, one per ally.
    const friend = model.allies.find((a) => a.name === 'FriendA');
    const guild = model.allies.find((a) => a.name === 'GuildB');
    expect(anchorOf('FriendA')).toEqual(at(friend?.mx ?? 0, (friend?.my ?? 0) - 8));
    expect(anchorOf('GuildB')).toEqual(at(guild?.mx ?? 0, (guild?.my ?? 0) - 8));
    // Badge number: lifted 4px above its disc centre.
    expect(anchorOf('1')).toEqual(at(model.questAreas[0].mx, model.questAreas[0].my + 4));
  });

  it('rounds every label blit to a whole pixel', () => {
    const trace = newTrace();
    installMapStyleGlobals(trace);
    setActiveWorldContent(BUILTIN_WORLD);

    new MapWindowPainter(classColor).paintOverworld(
      fakeMapContext(trace),
      labelWorld(),
      labelPaintOptions(),
    );

    expect(trace.blits.length).toBeGreaterThan(0);
    const fractional = trace.blits.filter(
      (blit) => !Number.isInteger(blit.dx) || !Number.isInteger(blit.dy),
    );
    expect(fractional).toEqual([]);
  });

  it('bakes the outline into each label, and leaves the badge number outline-free', () => {
    const trace = newTrace();
    installMapStyleGlobals(trace);
    setActiveWorldContent(BUILTIN_WORLD);

    new MapWindowPainter(classColor).paintOverworld(
      fakeMapContext(trace),
      labelWorld(),
      labelPaintOptions(),
    );

    const title = trace.sprites.find((s) => spriteText(s) === LABEL_ZONE.name);
    expect(title?.ink.map(inkStyle)).toEqual([
      { op: 'stroke', color: 'paint:--color-map-outline', text: LABEL_ZONE.name },
      { op: 'fill', color: 'paint:--color-map-label', text: LABEL_ZONE.name },
    ]);
    const friend = trace.sprites.find((s) => spriteText(s) === 'FriendA');
    expect(friend?.ink.map(inkStyle)).toEqual([
      { op: 'stroke', color: 'paint:--color-map-outline', text: 'FriendA' },
      { op: 'fill', color: 'paint:--color-map-ally-friend', text: 'FriendA' },
    ]);
    const guild = trace.sprites.find((s) => spriteText(s) === 'GuildB');
    expect(guild?.ink.map(inkStyle)[1]).toEqual({
      op: 'fill',
      color: 'paint:--color-map-ally-guild',
      text: 'GuildB',
    });
    const poi = trace.sprites.find((s) => spriteText(s) === LABEL_ZONE.pois[0].label);
    expect(poi?.ink.map(inkStyle)).toEqual([
      { op: 'stroke', color: 'paint:--color-map-outline', text: LABEL_ZONE.pois[0].label },
      { op: 'fill', color: 'paint:--color-map-label', text: LABEL_ZONE.pois[0].label },
    ]);
    const portalLabel = dungeonName(
      overworldDungeonPortals(DUNGEON_LIST, LABEL_ZONE.zMin, LABEL_ZONE.zMax)[0].id,
    );
    const portal = trace.sprites.find((s) => spriteText(s) === portalLabel);
    expect(portal?.ink.map(inkStyle)).toEqual([
      { op: 'stroke', color: 'paint:--color-map-outline', text: portalLabel },
      { op: 'fill', color: 'paint:--color-map-portal-label', text: portalLabel },
    ]);
    // The badge sits on its own gold disc, so it is the one label with no outline.
    const badge = trace.sprites.find((s) => spriteText(s) === '1');
    expect(badge?.ink.map(inkStyle)).toEqual([
      { op: 'fill', color: 'paint:--color-map-quest-badge-text', text: '1' },
    ]);
  });

  it('reuses the sprites on the next redraw instead of rasterizing again', () => {
    const trace = newTrace();
    installMapStyleGlobals(trace);
    setActiveWorldContent(BUILTIN_WORLD);
    const ctx = fakeMapContext(trace);
    const painter = new MapWindowPainter(classColor);
    const world = labelWorld();

    painter.paintOverworld(ctx, world, labelPaintOptions());
    const minted = trace.sprites.length;
    const blitted = trace.blits.length;
    expect(minted).toBeGreaterThan(0);

    painter.paintOverworld(ctx, world, labelPaintOptions());
    expect(trace.sprites).toHaveLength(minted); // no new canvases
    expect(trace.blits).toHaveLength(blitted * 2); // but every label drawn again
    expect(trace.textApi).toEqual([]);
  });

  it('draws each label exactly once per redraw, and keeps smoothing on', () => {
    const trace = newTrace();
    installMapStyleGlobals(trace);
    setActiveWorldContent(BUILTIN_WORLD);
    const ctx = fakeMapContext(trace);

    const result = new MapWindowPainter(classColor).paintOverworld(
      ctx,
      labelWorld(),
      labelPaintOptions(),
    );

    const badges = result.questAreas.reduce((n, area) => n + area.numbers.length, 0);
    const expected =
      1 + // the zone title
      LABEL_ZONE.pois.length +
      overworldDungeonPortals(DUNGEON_LIST, LABEL_ZONE.zMin, LABEL_ZONE.zMax).length +
      2 + // the two allies
      badges;
    expect(trace.blits).toHaveLength(expected);
    // The rounding rationale hangs on smoothing staying ON for the terrain blit.
    expect(ctx.imageSmoothingEnabled).toBe(true);
  });

  it('colors each ally dot by its own relationship', () => {
    const trace = newTrace();
    installMapStyleGlobals(trace);
    setActiveWorldContent(BUILTIN_WORLD);

    new MapWindowPainter(classColor).paintOverworld(
      fakeMapContext(trace),
      labelWorld(),
      labelPaintOptions(),
    );

    // The model plots friends before guild members, so the dot fills follow.
    const allyDots = trace.fills
      .filter((fill) => fill.style.endsWith('ally-friend') || fill.style.endsWith('ally-guild'))
      .map(({ style, commands }) => ({ style, commands }));
    expect(allyDots).toEqual([
      { style: 'paint:--color-map-ally-friend', commands: ['arc'] },
      { style: 'paint:--color-map-ally-guild', commands: ['arc'] },
    ]);
  });

  it.each([
    { state: 'available', id: 'quest-available', size: 'mapQuest' },
    { state: 'ready', id: 'quest-ready', size: 'mapQuest' },
    { state: 'repeat', id: 'quest-repeat', size: 'mapQuest' },
    { state: 'cooldown', id: 'quest-cooldown', size: 'mapQuestCooldown' },
  ] as const)('routes $state through its exact standard quest raster', ({ state, id, size }) => {
    const markerArt = fakeMarkerArt([id]);
    const trace = newTrace();
    installMapStyleGlobals(trace);
    setActiveWorldContent(BUILTIN_WORLD);

    const result = new MapWindowPainter(classColor, markerArt.art).paintOverworld(
      fakeMapContext(trace),
      questVariantWorld(state),
      labelPaintOptions(),
    );

    expect(result.npcs).toHaveLength(1);
    expect(markerArt.calls.filter((call) => call.id.startsWith('quest-'))).toEqual([{ id, size }]);
    const blit = trace.markerBlits.find((candidate) => candidate.sprite.markerId === id);
    expect(blit).toMatchObject({
      sprite: { markerId: id, sizeId: size },
      dx: Math.round(result.npcs[0].mx - MAP_MARKER_SIZES[size] / 2),
      dy: Math.round(result.npcs[0].my - MAP_MARKER_SIZES[size] / 2),
      alpha: 1,
    });
    expect(trace.textApi).toEqual([]);
    expect(trace.sprites.some((sprite) => ['!', '?'].includes(spriteText(sprite)))).toBe(false);
  });

  it.each([
    { state: 'available', id: 'quest-available', size: 'mapQuestCompact' },
    { state: 'ready', id: 'quest-ready', size: 'mapQuestCompact' },
    { state: 'repeat', id: 'quest-repeat', size: 'mapQuestCompact' },
    { state: 'cooldown', id: 'quest-cooldown', size: 'mapQuestCooldownCompact' },
  ] as const)('selects compact $state art once per redraw', ({ state, id, size }) => {
    const markerArt = fakeMarkerArt([id]);
    const trace = newTrace();
    installMapStyleGlobals(trace);
    setActiveWorldContent(BUILTIN_WORLD);
    const profile = vi.fn(() => 'compact' as const);

    const result = new MapWindowPainter(classColor, markerArt.art, profile).paintOverworld(
      fakeMapContext(trace),
      questVariantWorld(state),
      labelPaintOptions(),
    );

    expect(profile).toHaveBeenCalledTimes(1);
    expect(markerArt.calls.filter((call) => call.id.startsWith('quest-'))).toEqual([{ id, size }]);
    expect(trace.markerBlits.find((candidate) => candidate.sprite.markerId === id)).toMatchObject({
      sprite: { markerId: id, sizeId: size },
      dx: Math.round(result.npcs[0].mx - MAP_MARKER_SIZES[size] / 2),
      dy: Math.round(result.npcs[0].my - MAP_MARKER_SIZES[size] / 2),
      alpha: 1,
    });
  });

  it('keeps cooldown art at the caller alpha without a dimming write', () => {
    const markerArt = fakeMarkerArt(['quest-cooldown']);
    const trace = newTrace();
    installMapStyleGlobals(trace);
    setActiveWorldContent(BUILTIN_WORLD);
    const ctx = fakeMapContext(trace);
    ctx.globalAlpha = 0.9;

    new MapWindowPainter(classColor, markerArt.art).paintOverworld(
      ctx,
      questVariantWorld('cooldown'),
      labelPaintOptions(),
    );

    const blit = trace.markerBlits.find(
      (candidate) => candidate.sprite.markerId === 'quest-cooldown',
    );
    expect(blit?.alpha).toBe(0.9);
    expect(ctx.globalAlpha).toBe(0.9);
  });

  it.each([
    { state: 'available', commands: 'moveTo,lineTo' },
    { state: 'ready', commands: 'arc,lineTo' },
    {
      state: 'repeat',
      commands: 'moveTo,lineTo,moveTo,lineTo,lineTo,moveTo,lineTo,moveTo,lineTo',
    },
    { state: 'cooldown', commands: 'moveTo,lineTo,lineTo,lineTo' },
  ] as const)('draws a distinct no-text $state fallback while art loads', ({ state, commands }) => {
    const markerArt = fakeMarkerArt([]);
    const trace = newTrace();
    installMapStyleGlobals(trace);
    setActiveWorldContent(BUILTIN_WORLD);

    new MapWindowPainter(classColor, markerArt.art).paintOverworld(
      fakeMapContext(trace),
      questVariantWorld(state),
      labelPaintOptions(),
    );

    const expectedId = `quest-${state}` as MapMarkerArtId;
    expect(markerArt.calls.filter((call) => call.id.startsWith('quest-'))).toEqual([
      {
        id: expectedId,
        size: state === 'cooldown' ? 'mapQuestCooldown' : 'mapQuest',
      },
    ]);
    expect(trace.markerBlits.some((blit) => blit.sprite.markerId === expectedId)).toBe(false);
    expect(trace.strokes.some((stroke) => stroke.commands.join() === commands)).toBe(true);
    expect(trace.textApi).toEqual([]);
    expect(trace.sprites.some((sprite) => ['!', '?'].includes(spriteText(sprite)))).toBe(false);
  });

  it('keeps profile resolution and every canvas text entry point out of the quest loop', () => {
    expect(code).not.toContain('NPC_GLYPH_FONT');
    const questLoop = code.slice(code.indexOf('for (const npc of model.npcs)'));
    expect(questLoop).not.toContain('markerProfile()');
    expect(questLoop.slice(0, questLoop.indexOf('if (model.player)'))).not.toMatch(
      /fillText|strokeText|measureText|\.font\s*=/,
    );
  });

  it('opens each redraw on the cache, so the budget is enforced in the shipped path', () => {
    const trace = newTrace();
    installMapStyleGlobals(trace);
    setActiveWorldContent(BUILTIN_WORLD);
    const ctx = fakeMapContext(trace);
    const painter = new MapWindowPainter(classColor);
    const world = crowdedAllyWorld(TEXT_SPRITE_LIMIT + 8);

    painter.paintOverworld(ctx, world, labelPaintOptions());
    const minted = trace.sprites.length;
    expect(minted).toBeGreaterThan(TEXT_SPRITE_LIMIT);

    // The second redraw opens with a trim, so the labels that fell out of the
    // budget rasterize again. Without the beginRedraw call nothing is evicted and
    // this mints zero, which is the unbounded growth the budget exists to stop.
    painter.paintOverworld(ctx, world, labelPaintOptions());
    expect(trace.sprites.length).toBeGreaterThan(minted);
  });

  it("holds every zone's static labels inside the budget, so ordinary play never evicts", () => {
    const trace = newTrace();
    installMapStyleGlobals(trace);
    setActiveWorldContent(BUILTIN_WORLD);
    const ctx = fakeMapContext(trace);
    const painter = new MapWindowPainter(classColor);
    const world = labelWorld();

    for (const zone of ZONES) {
      painter.paintOverworld(ctx, world, { ...labelPaintOptions(), zone });
    }

    expect(trace.sprites.length).toBeLessThan(TEXT_SPRITE_LIMIT);
  });

  it('drops its label sprites when Hud relocalizes the dynamic UI', () => {
    const trace = newTrace();
    installMapStyleGlobals(trace);
    setActiveWorldContent(BUILTIN_WORLD);
    const ctx = fakeMapContext(trace);
    const painter = new MapWindowPainter(classColor);
    const world = labelWorld();

    painter.paintOverworld(ctx, world, labelPaintOptions());
    const minted = trace.sprites.length;
    painter.paintOverworld(ctx, world, labelPaintOptions());
    expect(trace.sprites).toHaveLength(minted); // cached, as usual

    painter.relocalize();
    painter.paintOverworld(ctx, world, labelPaintOptions());
    expect(trace.sprites).toHaveLength(minted * 2); // every label rasterized again
  });

  it('is wired to the language switch Hud fans out', () => {
    // The painter cannot listen for woc:languagechange itself (it owns no DOM),
    // so the one-line wiring in Hud's relocalizer is what makes the clear happen.
    expect(hud).toContain("document.addEventListener('woc:languagechange'");
    // Scoped to the relocalizer the language switch fans out to, not just to the
    // 8000-line file: a bare toContain also passes when the call has been moved
    // to a branch that never runs.
    expect(hud).toContain('() => this.refreshLocalizedDynamicUi()');
    const relocalizer = /private refreshLocalizedDynamicUi\(\): void \{([\s\S]*?)\n {2}\}/.exec(
      hud,
    );
    expect(relocalizer, 'hud.refreshLocalizedDynamicUi no longer parses').not.toBeNull();
    expect(relocalizer?.[1]).toContain('this.mapPainter.relocalize();');
  });

  it('outlines each portal dot in the outline token at the label width', () => {
    // Both halves are load-bearing and neither was observable before: the badge
    // block immediately above leaves lineWidth at 1.5, so without the portal
    // block naming its own the dots outline at half width on every zone that has
    // an active quest, which is the ordinary case.
    for (const [arm, world] of [
      ['with quest areas', labelWorld()],
      // And with the quest log empty NOTHING sets strokeStyle before the portal
      // loop, so the color half only becomes observable here.
      ['without quest areas', noQuestWorld()],
    ] as const) {
      const trace = newTrace();
      const markerArt = fakeMarkerArt([]);
      installMapStyleGlobals(trace);
      setActiveWorldContent(BUILTIN_WORLD);

      const result = new MapWindowPainter(classColor, markerArt.art).paintOverworld(
        fakeMapContext(trace),
        world,
        labelPaintOptions(),
      );

      const portals = overworldDungeonPortals(DUNGEON_LIST, LABEL_ZONE.zMin, LABEL_ZONE.zMax);
      expect(portals.length, arm).toBeGreaterThan(0);
      expect(
        markerArt.calls.filter((call) => call.id === 'dungeon-entrance'),
        `${arm}: art miss still routes the stable portal identity and size`,
      ).toEqual(portals.map(() => ({ id: 'dungeon-entrance', size: 'mapDungeon' })));
      expect(trace.markerBlits.some((blit) => blit.sprite.markerId === 'dungeon-entrance')).toBe(
        false,
      );
      // Each portal dot fills then strokes the SAME path, so its own outline is
      // the first stroke after its fill. Matching by draw order rather than by
      // "some arc somewhere used these settings" is what makes this decisive:
      // the ally dots later in the redraw use the identical color and width.
      const dotFills = trace.fills.filter(
        (fill) => fill.style === 'paint:--color-map-portal-dot' && fill.commands.join() === 'arc',
      );
      expect(dotFills, arm).toHaveLength(portals.length);
      const dotStrokes = dotFills.map((fill) => {
        const stroke = trace.strokes.find((s) => s.at > fill.at);
        if (!stroke) throw new Error(`${arm}: no stroke follows a portal dot fill`);
        return { style: stroke.style, lineWidth: stroke.lineWidth };
      });
      expect(dotStrokes, `${arm}: each portal dot outlines in the outline token at 3`).toEqual(
        dotFills.map(() => ({ style: 'paint:--color-map-outline', lineWidth: 3 })),
      );
      // And the badge width may not survive into any later arc.
      const badges = result.questAreas.reduce((n, a) => n + a.numbers.length, 0);
      const narrowArcs = trace.strokes.filter(
        (stroke) => stroke.commands.join() === 'arc' && stroke.lineWidth === 1.5,
      );
      expect(narrowArcs.length, arm).toBe(badges);
    }
  });

  it('fills each quest badge disc in its own token', () => {
    // Hoisted above the badge loop when the labels became sprites; unhoisted it
    // silently paints in the quest-area blob color set a few lines earlier.
    const trace = newTrace();
    installMapStyleGlobals(trace);
    setActiveWorldContent(BUILTIN_WORLD);

    const result = new MapWindowPainter(classColor).paintOverworld(
      fakeMapContext(trace),
      labelWorld(),
      labelPaintOptions(),
    );

    const badges = result.questAreas.reduce((n, area) => n + area.numbers.length, 0);
    expect(badges).toBeGreaterThan(0);
    const discs = trace.fills.filter(
      (fill) =>
        fill.style === 'paint:--color-map-quest-badge-fill' && fill.commands.join() === 'arc',
    );
    expect(discs).toHaveLength(badges);
  });

  it('lays two badges on one camp side by side around its centre', () => {
    // With one number per area the layout term is always zero, so the offset
    // ships unexercised: this is the arm where it does something.
    const trace = newTrace();
    installMapStyleGlobals(trace);
    setActiveWorldContent(BUILTIN_WORLD);
    const { world } = sharedCampWorld();

    const result = new MapWindowPainter(classColor).paintOverworld(
      fakeMapContext(trace),
      world,
      labelPaintOptions(),
    );

    const shared = result.questAreas.find((area) => area.numbers.length === 2);
    expect(shared, 'expected one area serving two quests').toBeDefined();
    if (!shared) return;
    const anchorOf = (text: string): { x: number; y: number } => {
      const blit = trace.blits.find((b) => spriteText(b.sprite) === text);
      if (!blit) throw new Error(`no blit for ${text}`);
      return blitAnchor(blit);
    };
    // Radius 9, gap 2, so the pair straddles the centre at -10 and +10, both
    // lifted the same 4px above it.
    const [first, second] = shared.numbers.map(String);
    expect(anchorOf(first)).toEqual({
      x: Math.round(shared.mx - 10),
      y: Math.round(shared.my + 4),
    });
    expect(anchorOf(second)).toEqual({
      x: Math.round(shared.mx + 10),
      y: Math.round(shared.my + 4),
    });
  });

  it('keeps the Show-on-Map ping color off every later outline', () => {
    const trace = newTrace();
    installMapStyleGlobals(trace);
    setActiveWorldContent(BUILTIN_WORLD);

    new MapWindowPainter(classColor).paintOverworld(
      fakeMapContext(trace),
      labelWorld(),
      labelPaintOptions({ x: 0, z: LABEL_ZONE_CZ }),
    );

    // The ping rings themselves do draw in the ping token.
    expect(trace.strokes.some((s) => s.style === 'paint:--color-map-ping')).toBe(true);
    // The player arrow is stroked after them and must not inherit that color.
    const arrow = trace.strokes.filter(
      (s) => s.commands.join(',') === 'moveTo,lineTo,lineTo,closePath',
    );
    expect(arrow.map((s) => s.style)).toEqual(['paint:--color-map-outline']);
    // Neither may the allocation-free quest fallback, which names both of its
    // strokes explicitly while generated art is still loading.
    const questOutline = trace.strokes.find(
      (stroke) => stroke.lineWidth === 4 && stroke.commands.join() === 'moveTo,lineTo',
    );
    expect(questOutline?.style).toBe('paint:--color-map-outline');
  });
});

// ---------------------------------------------------------------------------
// Party markers (issue 2652): a class-colored dot + name label per member,
// live world position, distinct from the ally dots and the player arrow.
// ---------------------------------------------------------------------------

/** labelWorld plus a three-member party: self (pid 1, must draw no marker of
 *  its own), one alive member of a distinct class, and one dead member. */
function partyWorld(): IWorld {
  const world = labelWorld() as unknown as { partyInfo: unknown };
  world.partyInfo = {
    leader: 1,
    raid: false,
    master: { enabled: false, looter: 0, threshold: 'uncommon' },
    members: [
      { pid: 1, name: 'Painter', cls: 'warrior', dead: 0, x: 0, z: LABEL_ZONE_CZ },
      { pid: 2, name: 'Ally', cls: 'mage', dead: 0, x: 20, z: LABEL_ZONE_CZ },
      { pid: 3, name: 'Fallen', cls: 'priest', dead: 1, x: -20, z: LABEL_ZONE_CZ },
    ],
  };
  return world as unknown as IWorld;
}

// The three silhouette path signatures (the fake context records commands per
// fill/stroke): ore = flat-top hex, wood = pine crown + trunk (one closed
// path), herb = three moveTo+arc petals. A collapsed or swapped silhouette
// changes its signature and fails the sequence pin below.
const GATHER_SILHOUETTE: Record<string, string[]> = {
  ore: ['moveTo', 'lineTo', 'lineTo', 'lineTo', 'lineTo', 'lineTo', 'closePath'],
  wood: ['moveTo', 'lineTo', 'lineTo', 'lineTo', 'lineTo', 'lineTo', 'lineTo', 'closePath'],
  herb: ['moveTo', 'arc', 'moveTo', 'arc', 'moveTo', 'arc'],
};
const GATHER_STRIKE_COMMANDS = ['moveTo', 'lineTo'];

function paintGatherZone(
  world: IWorld,
  markerArt?: MapMarkerArt,
  initialAlpha = 1,
  markerProfile: () => 'standard' | 'compact' = () => 'standard',
) {
  const trace = newTrace();
  installMapStyleGlobals(trace);
  setActiveWorldContent(BUILTIN_WORLD);
  const ctx = fakeMapContext(trace);
  ctx.globalAlpha = initialAlpha;
  const result = new MapWindowPainter(classColor, markerArt, markerProfile).paintOverworld(
    ctx,
    world,
    {
      zone: ZONES[0],
      zoneBg: {
        canvas: { width: 560, height: 560 } as HTMLCanvasElement,
        region: {
          minX: ZONES[0].xMin ?? STRIP_MIN_X,
          maxX: ZONES[0].xMax ?? STRIP_MAX_X,
          minZ: ZONES[0].zMin,
          maxZ: ZONES[0].zMax,
        },
      },
      canvasSize: 560,
      zoom: 1,
      center: null,
    },
  );
  const gatherFills = trace.fills
    .filter((fill) => fill.style.startsWith('paint:--color-map-gather-'))
    .map(({ style, commands }) => ({ style, commands }));
  const strikes = trace.strokes.filter(
    (stroke) =>
      stroke.style === 'paint:--color-map-outline' &&
      stroke.lineWidth === 1.5 &&
      stroke.commands.join(',') === GATHER_STRIKE_COMMANDS.join(','),
  );
  const silhouetteStrokes = trace.strokes.filter((stroke) =>
    Object.values(GATHER_SILHOUETTE).some((sig) => stroke.commands.join(',') === sig.join(',')),
  );
  return { trace, result, gatherFills, strikes, silhouetteStrokes, ctx };
}

function toolWorld(): IWorld {
  const world = mapWorld() as unknown as {
    inventory: { itemId: string; count: number }[];
    gatheringProficiency: Record<string, number>;
  };
  // Cover every gathering profession at tier 1 so ore/wood/herb all unlock.
  world.inventory = [
    { itemId: 'copper_mining_pick', count: 1 },
    { itemId: 'handaxe', count: 1 },
    { itemId: 'gathering_sickle', count: 1 },
  ];
  world.gatheringProficiency = { mining: 1, logging: 1, herbalism: 1 };
  return world as unknown as IWorld;
}

describe('map_window_painter: zone-map gather nodes', () => {
  it('locked viewer: ready identity plus a padlock, never a glow or strike', () => {
    const markerArt = fakeMarkerArt([]);
    const { result, trace, gatherFills, strikes } = paintGatherZone(mapWorld(), markerArt.art);
    expect(result.gatherNodes.length).toBeGreaterThan(0);
    expect(markerArt.calls.filter((call) => call.id.startsWith('gather-'))).toEqual(
      result.gatherNodes.map((node) => ({
        id: `gather-${node.type}`,
        size: 'mapGatherReadyLocked',
      })),
    );
    // Fixture guard: every node is locked AND ready here, so the no-glow
    // assertion below genuinely exercises the `!node.locked` conjunct of the
    // glow gate (a not-ready fixture would defuse it silently).
    expect(result.gatherNodes.every((n) => n.locked && n.ready)).toBe(true);
    const readyFills = result.gatherNodes.map((node) =>
      gatherFills.find((fill) => fill.style === `paint:--color-map-gather-${node.type}-ready`),
    );
    expect(readyFills.every(Boolean)).toBe(true);
    for (const tok of [
      '--color-map-gather-ore-glow',
      '--color-map-gather-wood-glow',
      '--color-map-gather-herb-glow',
    ]) {
      expect(
        gatherFills.some((f) => f.style === `paint:${tok}`),
        `locked viewer must not fill ${tok}`,
      ).toBe(false);
    }
    expect(strikes).toEqual([]);
    expect(
      trace.strokes.filter(
        (stroke) =>
          stroke.style === 'paint:--color-map-gather-locked' &&
          stroke.lineWidth === 1.4 &&
          stroke.commands.join(',') === 'arc',
      ),
    ).toHaveLength(result.gatherNodes.length);
  });

  it('ready viewer: glow-under-silhouette per node, tokens matched to the node type', () => {
    const { result, gatherFills, strikes, silhouetteStrokes } = paintGatherZone(toolWorld());
    expect(result.gatherNodes.length).toBeGreaterThan(0);
    expect(result.gatherNodes.every((n) => !n.locked && n.ready)).toBe(true);
    // The full fill sequence in model order: glow halo (a plain arc) under the
    // type silhouette, each carrying ITS OWN type's token. A permuted color
    // resolver, a swapped silhouette, or a glow painted over the icon all
    // break this exact sequence.
    expect(gatherFills).toEqual(
      result.gatherNodes.flatMap((n) => [
        { style: `paint:--color-map-gather-${n.type}-glow`, commands: ['arc'] },
        { style: `paint:--color-map-gather-${n.type}-ready`, commands: GATHER_SILHOUETTE[n.type] },
      ]),
    );
    // Ready silhouettes carry the outline stroke; nothing is locked, so no
    // strike strokes at all.
    expect(silhouetteStrokes.length).toBe(result.gatherNodes.length);
    expect(strikes.length).toBe(0);
  });

  it('routes painted gathering art through ready/cooldown sprites at caller alpha', () => {
    const world = toolWorld() as unknown as { nodeHarvestableByMe: (id: string) => boolean };
    world.nodeHarvestableByMe = (id) => !id.startsWith('ore_');
    const markerArt = fakeMarkerArt(['gather-ore', 'gather-wood', 'gather-herb']);

    const { result, trace, ctx } = paintGatherZone(world as unknown as IWorld, markerArt.art, 0.8);

    expect(result.gatherNodes.some((node) => !node.ready)).toBe(true);
    expect(result.gatherNodes.some((node) => node.ready)).toBe(true);
    expect(new Set(result.gatherNodes.map((node) => node.type))).toEqual(
      new Set(['ore', 'wood', 'herb']),
    );
    expect(markerArt.calls.filter((call) => call.id.startsWith('gather-'))).toEqual(
      result.gatherNodes.map((node) => ({
        id: `gather-${node.type}`,
        size: node.ready ? 'mapGatherReady' : 'mapGatherCooldown',
      })),
    );
    const blits = trace.markerBlits.filter((blit) => blit.sprite.markerId.startsWith('gather-'));
    expect(blits).toHaveLength(result.gatherNodes.length);
    expect(blits.map((blit) => blit.sprite)).toEqual(
      result.gatherNodes.map((node) => ({
        markerId: `gather-${node.type}`,
        sizeId: node.ready ? 'mapGatherReady' : 'mapGatherCooldown',
      })),
    );
    // The cooldown-size sprite is precomputed grayscale + outlined by the art
    // loader, so the painter preserves the caller's alpha instead of dimming
    // the finished marker a second time.
    expect(blits.map((blit) => blit.alpha)).toEqual(result.gatherNodes.map(() => 0.8));
    for (let i = 0; i < blits.length; i++) {
      const node = result.gatherNodes[i];
      const sizeId = node.ready ? 'mapGatherReady' : 'mapGatherCooldown';
      expect(blits[i].dx).toBe(Math.round(node.mx - MAP_MARKER_SIZES[sizeId] / 2));
      expect(blits[i].dy).toBe(Math.round(node.my - MAP_MARKER_SIZES[sizeId] / 2));
    }
    expect(ctx.globalAlpha).toBe(0.8);
  });

  it('draws every full-map gathering painting below the actionable quest-glyph layer', () => {
    const markerArt = fakeMarkerArt([
      'gather-ore',
      'gather-wood',
      'gather-herb',
      'quest-available',
    ]);
    const trace = newTrace();
    installMapStyleGlobals(trace);
    setActiveWorldContent(BUILTIN_WORLD);

    const result = new MapWindowPainter(classColor, markerArt.art).paintOverworld(
      fakeMapContext(trace),
      labelWorld(),
      labelPaintOptions(),
    );

    const gatherBlits = trace.markerBlits.filter((blit) =>
      blit.sprite.markerId.startsWith('gather-'),
    );
    const questBlits = trace.markerBlits.filter((blit) =>
      blit.sprite.markerId.startsWith('quest-'),
    );
    expect(result.gatherNodes.length).toBeGreaterThan(0);
    expect(result.npcs.length).toBeGreaterThan(0);
    expect(gatherBlits).toHaveLength(result.gatherNodes.length);
    expect(questBlits).toHaveLength(result.npcs.length);
    expect(Math.max(...gatherBlits.map((blit) => blit.at))).toBeLessThan(
      Math.min(...questBlits.map((blit) => blit.at)),
    );
  });

  it('uses a precomputed locked painted icon at caller alpha with no runtime overlay', () => {
    const markerArt = fakeMarkerArt(['gather-ore', 'gather-wood', 'gather-herb']);
    const { result, trace, strikes, ctx } = paintGatherZone(mapWorld(), markerArt.art, 0.8);

    expect(result.gatherNodes.every((node) => node.ready && node.locked)).toBe(true);
    const blits = trace.markerBlits.filter((blit) => blit.sprite.markerId.startsWith('gather-'));
    expect(blits).toHaveLength(result.gatherNodes.length);
    expect(blits.every((blit) => blit.sprite.sizeId === 'mapGatherReadyLocked')).toBe(true);
    expect(blits.every((blit) => blit.alpha === 0.8)).toBe(true);
    expect(strikes).toEqual([]);
    expect(ctx.globalAlpha).toBe(0.8);
  });

  it('preserves both gray cooldown and lock states in one cached sprite', () => {
    const world = mapWorld() as unknown as { nodeHarvestableByMe: () => boolean };
    world.nodeHarvestableByMe = () => false;
    const markerArt = fakeMarkerArt(['gather-ore', 'gather-wood', 'gather-herb']);

    const { result, trace, gatherFills, strikes, ctx } = paintGatherZone(
      world as unknown as IWorld,
      markerArt.art,
      0.8,
    );

    expect(result.gatherNodes.length).toBeGreaterThan(0);
    expect(result.gatherNodes.every((node) => !node.ready && node.locked)).toBe(true);
    expect(markerArt.calls.filter((call) => call.id.startsWith('gather-'))).toEqual(
      result.gatherNodes.map((node) => ({
        id: `gather-${node.type}`,
        size: 'mapGatherCooldownLocked',
      })),
    );
    const blits = trace.markerBlits.filter((blit) => blit.sprite.markerId.startsWith('gather-'));
    expect(blits.map((blit) => blit.sprite)).toEqual(
      result.gatherNodes.map((node) => ({
        markerId: `gather-${node.type}`,
        sizeId: 'mapGatherCooldownLocked',
      })),
    );
    expect(blits.every((blit) => blit.alpha === 0.8)).toBe(true);
    expect(gatherFills).toEqual([]);
    expect(strikes).toHaveLength(0);
    expect(ctx.globalAlpha).toBe(0.8);
  });

  it.each([
    { ready: true, locked: false, size: 'mapGatherReadyCompact' },
    { ready: false, locked: false, size: 'mapGatherCooldownCompact' },
    { ready: true, locked: true, size: 'mapGatherReadyLockedCompact' },
    { ready: false, locked: true, size: 'mapGatherCooldownLockedCompact' },
  ] as const)('uses compact gathering raster $size', ({ ready, locked, size }) => {
    const world = (locked ? mapWorld() : toolWorld()) as unknown as {
      nodeHarvestableByMe: () => boolean;
    };
    world.nodeHarvestableByMe = () => ready;
    const markerArt = fakeMarkerArt(['gather-ore', 'gather-wood', 'gather-herb']);
    const profile = vi.fn(() => 'compact' as const);

    const { result, trace, strikes } = paintGatherZone(
      world as unknown as IWorld,
      markerArt.art,
      1,
      profile,
    );

    expect(profile).toHaveBeenCalledTimes(1);
    expect(result.gatherNodes.every((node) => node.ready === ready && node.locked === locked)).toBe(
      true,
    );
    expect(markerArt.calls.filter((call) => call.id.startsWith('gather-'))).toEqual(
      result.gatherNodes.map((node) => ({ id: `gather-${node.type}`, size })),
    );
    expect(
      trace.markerBlits
        .filter((blit) => blit.sprite.markerId.startsWith('gather-'))
        .every((blit) => blit.sprite.sizeId === size),
    ).toBe(true);
    expect(strikes).toEqual([]);
  });

  it('the locked token references the minimap rust token (both surfaces retune together)', () => {
    // The map side of the agreement is this var() reference; the minimap side
    // (the declaration of --color-minimap-node-locked itself) is pinned by
    // tests/minimap_painter.test.ts, so a rename of either end fails a suite.
    expect(tokens).toContain('--color-map-gather-locked: var(--color-minimap-node-locked)');
  });

  it('pins one literal neutral cooldown gray across minimap and all full-map fallbacks', () => {
    expect(tokens).toContain('--color-minimap-gather-cooldown: #90989a;');
    expect(tokens).toContain('--color-map-gather-ore-cooldown: #90989a;');
    expect(tokens).toContain('--color-map-gather-wood-cooldown: #90989a;');
    expect(tokens).toContain('--color-map-gather-herb-cooldown: #90989a;');
  });

  it('cooldown viewer: neutral outlined silhouette, no glow or strike', () => {
    const world = toolWorld() as unknown as { nodeHarvestableByMe: (id: string) => boolean };
    // Tools for everything, but every ore vein is on this viewer's respawn
    // cooldown: the cooldown arm (smaller bare silhouette) paints for ore
    // while wood/herb stay on the ready arm.
    world.nodeHarvestableByMe = (id) => !id.startsWith('ore_');
    const { trace, result, gatherFills, strikes } = paintGatherZone(world as unknown as IWorld);
    const oreMarkers = result.gatherNodes.filter((n) => n.type === 'ore');
    expect(oreMarkers.length).toBeGreaterThan(0);
    expect(oreMarkers.every((n) => !n.ready && !n.locked)).toBe(true);
    const oreCooldownFills = gatherFills.filter(
      (fill) => fill.style === 'paint:--color-map-gather-ore-cooldown',
    );
    expect(oreCooldownFills.length).toBe(oreMarkers.length);
    // Cooldown keeps the type silhouette (the hex), but the shared cooldown
    // tokens resolve to neutral gray rather than a dim profession hue.
    for (const fill of oreCooldownFills) {
      expect(fill.commands).toEqual(GATHER_SILHOUETTE.ore);
    }
    // No ore glow and no ore ready fill while cooling; wood/herb still glow.
    expect(gatherFills.some((f) => f.style === 'paint:--color-map-gather-ore-glow')).toBe(false);
    expect(gatherFills.some((f) => f.style === 'paint:--color-map-gather-ore-ready')).toBe(false);
    expect(gatherFills.some((f) => f.style === 'paint:--color-map-gather-wood-glow')).toBe(true);
    expect(gatherFills.some((f) => f.style === 'paint:--color-map-gather-herb-glow')).toBe(true);
    // Cooldown fallbacks retain an outline so they survive terrain while art
    // is loading. Nothing here is locked, so no diagonal strikes appear.
    expect(strikes.length).toBe(0);
    const hexStrokes = trace.strokes.filter(
      (stroke) => stroke.commands.join(',') === GATHER_SILHOUETTE.ore.join(','),
    );
    expect(hexStrokes).toHaveLength(oreMarkers.length);
  });
});

describe('map_window_painter: party markers', () => {
  it('draws a class-colored dot for an alive member and the dead token for a fallen one', () => {
    const trace = newTrace();
    installMapStyleGlobals(trace);
    setActiveWorldContent(BUILTIN_WORLD);

    new MapWindowPainter(classColor).paintOverworld(
      fakeMapContext(trace),
      partyWorld(),
      labelPaintOptions(),
    );

    const aliveDot = trace.fills.find(
      (fill) => fill.style === 'color:mage' && fill.commands.join() === 'arc',
    );
    expect(aliveDot, 'expected the alive mage member to fill in its class color').toBeDefined();
    const deadDot = trace.fills.find(
      (fill) => fill.style === 'paint:--color-map-party-dead' && fill.commands.join() === 'arc',
    );
    expect(deadDot, 'expected the dead member to fill in the party-dead token').toBeDefined();
    // Self never gets a party marker: only the arrow (moveTo/lineTo/lineTo/closePath)
    // may fill in warrior's classColor.
    const selfColorFills = trace.fills.filter((fill) => fill.style === 'color:warrior');
    expect(selfColorFills).toEqual([]);
  });

  it('labels each member by name, anchored the same as an ally dot', () => {
    const trace = newTrace();
    installMapStyleGlobals(trace);
    setActiveWorldContent(BUILTIN_WORLD);
    const world = partyWorld();

    new MapWindowPainter(classColor).paintOverworld(
      fakeMapContext(trace),
      world,
      labelPaintOptions(),
    );

    const model = buildOverworldMapModel({
      world,
      props: BUILTIN_WORLD.props,
      zone: LABEL_ZONE,
      zoom: 1,
      center: null,
      canvasSize: 560,
      decorations: [],
      ping: null,
    });
    expect(model.party.map((m) => m.name)).toEqual(['Ally', 'Fallen']);
    const anchorOf = (text: string): { x: number; y: number } => {
      const blit = trace.blits.find((b) => spriteText(b.sprite) === text);
      if (!blit) throw new Error(`no blit for ${text}`);
      return blitAnchor(blit);
    };
    const at = (x: number, y: number): { x: number; y: number } => ({
      x: Math.round(x),
      y: Math.round(y),
    });
    const ally = model.party.find((m) => m.name === 'Ally');
    const fallen = model.party.find((m) => m.name === 'Fallen');
    expect(anchorOf('Ally')).toEqual(at(ally?.mx ?? 0, (ally?.my ?? 0) - 8));
    expect(anchorOf('Fallen')).toEqual(at(fallen?.mx ?? 0, (fallen?.my ?? 0) - 8));
    // Self ('Painter') never mints a party-name sprite; the only 'Painter' text
    // anywhere on this canvas would be one, and the player arrow carries no label.
    expect(trace.sprites.some((s) => spriteText(s) === 'Painter')).toBe(false);
  });

  it('outlines every party dot in the outline token at the label width', () => {
    const trace = newTrace();
    installMapStyleGlobals(trace);
    setActiveWorldContent(BUILTIN_WORLD);

    new MapWindowPainter(classColor).paintOverworld(
      fakeMapContext(trace),
      partyWorld(),
      labelPaintOptions(),
    );

    const partyFills = trace.fills.filter(
      (fill) =>
        (fill.style === 'color:mage' || fill.style === 'paint:--color-map-party-dead') &&
        fill.commands.join() === 'arc',
    );
    expect(partyFills).toHaveLength(2);
    const partyStrokes = partyFills.map((fill) => {
      const stroke = trace.strokes.find((s) => s.at > fill.at);
      if (!stroke) throw new Error('expected a stroke to follow each party dot fill');
      return { style: stroke.style, lineWidth: stroke.lineWidth };
    });
    expect(partyStrokes).toEqual(
      partyFills.map(() => ({ style: 'paint:--color-map-outline', lineWidth: 3 })),
    );
  });

  it('draws nothing for a solo player (no partyInfo)', () => {
    const trace = newTrace();
    installMapStyleGlobals(trace);
    setActiveWorldContent(BUILTIN_WORLD);

    new MapWindowPainter(classColor).paintOverworld(
      fakeMapContext(trace),
      labelWorld(),
      labelPaintOptions(),
    );

    expect(trace.fills.some((fill) => fill.style.startsWith('color:'))).toBe(false);
    expect(trace.fills.some((fill) => fill.style === 'paint:--color-map-party-dead')).toBe(false);
  });
});
