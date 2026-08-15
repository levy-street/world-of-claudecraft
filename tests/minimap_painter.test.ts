// No-magic-values + cadence guard for the overworld minimap painter (canvas
// sub-rule), plus the NPC glyph sprite-cache behavior driven through a narrow fake 2D
// context (the tests/map_window_painter.test.ts idiom), so the blit anchor, the sprite
// geometry and the caching are behavior assertions rather than source-text guesses.
// The pure marker geometry the painter draws is covered by tests/minimap_markers.test.ts.
// The source-text pins here cover only what a fake context cannot express: zero literal
// colors (the --color-minimap-* tokens resolved once per redraw, never per-marker), the
// Hud-owned cached terrain background blitted (not rebuilt), and the ~10Hz fastHud
// cadence + the '#zone-label' setText preserved from the inline site.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BG_HALF_X, BG_HALF_Z, bgFieldPlanWalls } from '../src/sim/battleground_layout';
import { battlegroundOrigin, GATHER_NODES, QUESTS, YUMI_BAND_X_MIN } from '../src/sim/data';
import { TH_GRAVEYARDS } from '../src/sim/thornhollow_field.generated';
import { EASTBROOK_NOTICEBOARD_TEMPLATE_ID, isQuestTurnInNpc } from '../src/sim/types';
import {
  BG_SURFACE_GRASS,
  BG_SURFACE_GRAVE,
  bgFieldSurfaceAt,
} from '../src/ui/bg_field_relief_core';
import { bgAtlasMarks } from '../src/ui/hud/battleground';
import {
  MAP_MARKER_ART_IDS,
  MAP_MARKER_SIZES,
  type MapMarkerArt,
  type MapMarkerArtId,
  type MapMarkerSize,
} from '../src/ui/map_marker_icon_art';
import {
  createMinimapMarkers,
  type MinimapMarker,
  type MinimapObjectSemantic,
} from '../src/ui/minimap_markers';
import {
  type MinimapColors,
  MinimapPainter,
  MINIMAP_COLOR_TOKENS as PAINTER_TOKEN_TABLE,
} from '../src/ui/minimap_painter';
import type { BgMatchInfo, BgPlayerInfo, IWorld } from '../src/world_api';

const painter = readFileSync(new URL('../src/ui/minimap_painter.ts', import.meta.url), 'utf8');
// Drop comments so prose can't create a false positive (mirrors architecture.test).
const code = painter.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
// Comment-stripped like `code`: a commented-out token declaration must not
// satisfy the design-token pins below.
const tokens = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

// Slice from a REQUIRED marker. A bare `code.slice(code.indexOf(m))` degrades to
// `code.slice(-1)` (a single '}') when the marker is gone, which would turn every
// "this body does not contain X" pin below into a vacuous pass against a full revert.
// With no `end`, the slice runs to EOF: drawMarkers is deliberately the last method in
// the class, so that is exactly the draw loop, and anything appended after it is held to
// the same no-text rule on purpose.
function sliceFrom(source: string, marker: string, end?: string): string {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`minimap_painter.ts no longer contains "${marker}"`);
  if (end === undefined) return source.slice(start);
  const stop = source.indexOf(end, start);
  if (stop < 0) throw new Error(`minimap_painter.ts has no "${end}" after "${marker}"`);
  return source.slice(start, stop);
}

const MINIMAP_COLOR_TOKENS = [
  '--color-minimap-ally-friend',
  '--color-minimap-ally-guild',
  '--color-minimap-npc-quest',
  '--color-minimap-npc-quest-repeat',
  '--color-minimap-portal',
  '--color-minimap-object-loot',
  '--color-minimap-mob-aggro',
  '--color-minimap-mob',
  '--color-minimap-mob-loot',
  '--color-minimap-party-dead',
  '--color-minimap-party-pip',
  '--color-minimap-player',
  '--color-minimap-outline',
];

describe('minimap_painter: no magic values (canvas sub-rule)', () => {
  it('carries no literal hex or rgb color in TS', () => {
    const hex = code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    const rgb = code.match(/\brgba?\s*\(/g) ?? [];
    expect(hex, `hex colors: ${hex.join(', ')}`).toEqual([]);
    expect(rgb, `rgb colors: ${rgb.join(', ')}`).toEqual([]);
  });

  it('resolves --color-minimap-* tokens via getComputedStyle exactly once per redraw', () => {
    expect(code).toContain('getComputedStyle');
    expect(code).toContain('getPropertyValue');
    expect(code).toContain('--color-minimap-');
    expect(code).toContain('resolveColors');
    // One getComputedStyle call site total: resolved once per paint into a colors
    // object, never re-read inside a per-marker draw loop.
    expect(code.match(/getComputedStyle/g) ?? []).toHaveLength(1);
  });

  it('resolves the tokens once in paintOverworld, never inside the per-marker draw loop', () => {
    // Cadence teeth that survive a call-site MOVE (the textual getComputedStyle count
    // alone would not catch relocating the resolve into the per-marker loop, since the
    // string lives only at the definition site). The per-marker loop lives in
    // drawMarkers; assert resolveColors() is called exactly once per entry point
    // (paintOverworld + the Protect Yumi paintYumiMaze) and is never referenced inside
    // the drawMarkers body. A runtime getComputedStyle spy is deferred to the browser
    // suite.
    expect(code.match(/this\.resolveColors\(\)/g) ?? []).toHaveLength(2);
    const drawMarkersBody = sliceFrom(code, 'private drawMarkers(');
    expect(drawMarkersBody).not.toContain('resolveColors');
  });

  it('defines every minimap color token it reads in the design-token sheet', () => {
    for (const tok of MINIMAP_COLOR_TOKENS) {
      expect(code, `painter never reads ${tok}`).toContain(tok);
      expect(tokens, `missing ${tok}`).toContain(`${tok}:`);
    }
    // The hand list above cannot see a table entry it was never told about,
    // and resolveColors freezes the WHOLE color set on first resolve, so one
    // token absent from tokens.css draws default ink for the session. Pin
    // EVERY live table entry (the exported source of truth) against the
    // sheet, and the hand list against the table, so neither can drift.
    for (const tok of Object.values(PAINTER_TOKEN_TABLE)) {
      expect(tokens, `tokens.css missing live table entry ${tok}`).toContain(`${tok}:`);
    }
    for (const tok of MINIMAP_COLOR_TOKENS) {
      expect(
        Object.values(PAINTER_TOKEN_TABLE),
        `hand list names a token the painter no longer reads: ${tok}`,
      ).toContain(tok);
    }
  });
});

describe('minimap_painter: cached background + ~10Hz cadence preserved', () => {
  it('blits the Hud-owned cached terrain background rather than rebuilding it', () => {
    // The painter receives the cached bg and only drawImages it (no terrain build).
    expect(code).toContain('ctx.drawImage(');
    expect(code).not.toContain('renderTerrainCanvas');
    // Hud passes the cached canvas + the current zoom in each redraw.
    expect(hud).toContain('this.minimapPainter.paintOverworld(');
    expect(hud).toContain('this.minimapBg');
  });

  it("still redraws updateMinimap from hud.update()'s fastHud (~10Hz) band", () => {
    // The minimap stays gated on the fast band, NOT every frame. Ordinary low-tier
    // maps retain their cost throttle, but Rift lethal mechanics must never inherit it.
    expect(hud).toContain('const fastHud = now - this.lastHudFastAt >= 100;');
    expect(hud).toContain('this.updateMinimap();');
    expect(hud).toContain("minimapRedrawIntervalMs(fxTier, minimapMode(this.sim) === 'rift')");
  });

  it("routes the '#zone-label' text through the elided setText (the one DOM write)", () => {
    expect(code).toContain('this.writers.setText(zoneLabelEl');
  });

  it('keeps the cached Thornhollow Fields sheet bounded for the 240x452yd field', () => {
    // The battleground raster is built ONCE per session and held for it, so its
    // size is a memory decision, not a per-frame one. Thornhollow is over three
    // times the old code-defined field, and the maze arm's shape (one square pad
    // off the LONG half-extent) squares that growth: the pin is that the sheet
    // stays under what the maze constants would mint for this field, and under
    // the pre-Thornhollow sheet, while still sampling finer than the minimap's
    // own base scale so a zoom-1 blit never magnifies.
    const constant = (name: string): number => {
      const m = code.match(new RegExp(`const ${name} = ([0-9.]+);`));
      if (!m) throw new Error(`minimap_painter.ts no longer defines ${name}`);
      return Number(m[1]);
    };
    const px = constant('BG_FIELD_PX_PER_YARD');
    const margin = constant('MAZE_BG_MARGIN_YD');
    const base = constant('MINIMAP_BASE_SCALE');
    const sheet =
      Math.ceil((BG_HALF_X + margin) * 2 * px) * Math.ceil((BG_HALF_Z + margin) * 2 * px);
    const squarePad = Math.ceil((BG_HALF_Z + margin) * 2 * constant('MAZE_BG_PX_PER_YARD')) ** 2;
    expect(sheet).toBeLessThan(squarePad / 2);
    expect(sheet).toBeLessThan(1_000_000);
    expect(px).toBeGreaterThanOrEqual(base);
    // Per-axis, not one square pad: the sheet is taller than it is wide.
    expect(code).toContain('BG_FIELD_PAD_X_YD');
    expect(code).toContain('BG_FIELD_PAD_Z_YD');
  });

  it('rasterizes the field from the collider-backed plan, honouring each wall yaw', () => {
    // The plan is a projection of the real collider set (bgFieldPlanWalls), so
    // the minimap can never show cover that does not block; and Thornhollow's
    // walls are placed structures, so the raster rotates each box instead of
    // filling an axis-aligned rect.
    expect(code).toContain('bgFieldPlanWalls()');
    expect(code).not.toContain('battlegroundWallSegments');
    const bgRaster = sliceFrom(code, 'private ensureBattlegroundBg(', '\n  }');
    expect(bgRaster).toContain('bctx.rotate(-wall.rot)');
    // The ground and the marks both come from the SHARED atlas modules the
    // M-key map plate is built from, never from a second copy of that art
    // living in this painter: one field, one description of it.
    expect(bgRaster).toContain('paintBgFieldAtlas(');
    expect(bgRaster).toContain('drawBgAtlasMarks(');
    expect(code).not.toContain('paintBgFieldRelief');
    // Landmark LABELS are deliberately absent: illegible at 2.5px/yd, and the
    // raster is blitted as a player-centered sub-rect, so baked text would smear
    // across the window rather than sit on its landmark.
    expect(bgRaster).not.toContain('fillText');
    expect(bgRaster).not.toContain('bgAtlasLabels');
    // Tier-identical, the fairness invariant: the raster is built from the
    // field and the resolved tokens alone, with no preset or governor in it.
    for (const knob of ['fxTier', 'governor', 'preset', 'data-fx-level']) {
      expect(bgRaster, `the battleground raster reads ${knob}`).not.toContain(knob);
    }
  });
});

// ---------------------------------------------------------------------------
// NPC glyph sprite cache, driven through a fake 2D context.
//
// Every canvas text entry point (the ctx.font setter, fillText, measureText) re-resolves
// font state against the document, so a per-marker text loop costs in proportion to
// how dirty the style tree is. The glyph rasterizes ONCE into a per-(glyph, fill, outline) sprite
// and each redraw blits it, which is flat. These are behavior pins: the anchor arithmetic,
// the whole-pixel rounding, the sprite geometry, and the cache actually being consulted.

/** One recorded `fillText` into a sprite's own context. */
interface SpriteInk {
  glyph: string;
  x: number;
  y: number;
  font: string;
  fillStyle: string;
}

/** One recorded `strokeText` into a sprite's own context. */
interface SpriteOutline extends SpriteInk {
  strokeStyle: string;
  lineWidth: number;
  lineJoin: CanvasLineJoin;
}

/** A fake offscreen canvas standing in for a glyph sprite. */
interface FakeSprite {
  width: number;
  height: number;
  ink: SpriteInk[];
  outlines: SpriteOutline[];
  textPasses: Array<'stroke' | 'fill'>;
  getContext(kind: string): unknown;
}

/** A successful painted marker sprite returned by the injected art seam. */
interface FakeMarkerSprite {
  markerId: MapMarkerArtId;
  sizeId: MapMarkerSize;
}

interface MarkerArtCall {
  id: MapMarkerArtId;
  size: MapMarkerSize;
}

interface GlyphTrace {
  /** Every 3-argument `drawImage` (the glyph blits; the terrain blit takes 9),
   *  with the context's globalAlpha AT BLIT TIME (the cooldown dim rides the
   *  blit, never the sprite raster). */
  blits: Array<{ sprite: FakeSprite; dx: number; dy: number; alpha: number }>;
  /** Successful stable-marker blits, kept separate from NPC glyph sprites. */
  markerBlits: Array<{
    sprite: FakeMarkerSprite;
    dx: number;
    dy: number;
    alpha: number;
  }>;
  /** Every canvas created through `document.createElement('canvas')`. */
  sprites: FakeSprite[];
  /** Any text drawn straight onto the MINIMAP context (must stay zero). */
  minimapTextCalls: number;
  /** Any `ctx.font` assignment on the MINIMAP context (must stay zero). */
  minimapFontWrites: number;
  color: string;
  outlineColor: string;
  /** Line segments the MINIMAP context path-built, marked when a stroke()
   *  actually rasterized them (the lock-strike decisiveness rig: a built
   *  but never-stroked path draws nothing). */
  segments: Array<{ fromX: number; fromY: number; toX: number; toY: number; stroked: boolean }>;
  /** Arcs that reached fill(), used to prove a missing/unsupported sprite takes
   *  the procedural portal fallback rather than disappearing. */
  filledArcs: Array<{ x: number; y: number; radius: number }>;
  /** Arcs that reached stroke(), including their resolved treatment. */
  strokedArcs: Array<{
    x: number;
    y: number;
    radius: number;
    strokeStyle: string;
    lineWidth: number;
  }>;
  /** Command grammar and treatment of each stroked immediate-mode path. This
   *  pins punctuation identity without coupling the test to one screen pixel. */
  strokedPaths: Array<{
    commands: string[];
    strokeStyle: string;
    lineWidth: number;
  }>;
  /** Immediate-mode rectangle paints. A hollow lootable-corpse marker uses
   *  these instead of depending on color alone. */
  rects: Array<{
    op: 'fill' | 'stroke';
    x: number;
    y: number;
    width: number;
    height: number;
    color: string;
    lineWidth: number;
  }>;
}

const NPC_QUEST_TOKEN = '--color-minimap-npc-quest';
const MINIMAP_OUTLINE_TOKEN = '--color-minimap-outline';
// A real quest whose giver is also its turn-in npc, so one npc template carries both
// the 'available' ('!') and 'ready' ('?') branches against real content.
function requireReadyQuest() {
  const quest = Object.values(QUESTS).find(
    (q) => q.giverNpcId && isQuestTurnInNpc(q, q.giverNpcId),
  );
  if (!quest) throw new Error('expected a quest whose giver is also a turn-in npc');
  return quest;
}
const READY_QUEST = requireReadyQuest();

function makeFakeSprite(trace: GlyphTrace): FakeSprite {
  const ink: SpriteInk[] = [];
  const outlines: SpriteOutline[] = [];
  const textPasses: Array<'stroke' | 'fill'> = [];
  const sctx = {
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineJoin: 'miter' as CanvasLineJoin,
    // globalAlpha + fillRect are what ensureMazeBg draws its wall slabs with; the glyph
    // sprite itself only ever needs font/fillStyle/fillText.
    globalAlpha: 1,
    fillRect(): void {},
    fillText(glyph: string, x: number, y: number): void {
      ink.push({ glyph, x, y, font: sctx.font, fillStyle: sctx.fillStyle });
      textPasses.push('fill');
    },
    strokeText(glyph: string, x: number, y: number): void {
      outlines.push({
        glyph,
        x,
        y,
        font: sctx.font,
        fillStyle: sctx.fillStyle,
        strokeStyle: sctx.strokeStyle,
        lineWidth: sctx.lineWidth,
        lineJoin: sctx.lineJoin,
      });
      textPasses.push('stroke');
    },
  };
  const sprite: FakeSprite = {
    width: 0,
    height: 0,
    ink,
    outlines,
    textPasses,
    getContext: (kind: string) => (kind === '2d' ? sctx : null),
  };
  trace.sprites.push(sprite);
  return sprite;
}

function installGlyphGlobals(trace: GlyphTrace, spriteContext = true): void {
  const resolvedColors = new Map<string, () => string>([
    [NPC_QUEST_TOKEN, () => trace.color],
    [MINIMAP_OUTLINE_TOKEN, () => trace.outlineColor],
  ]);
  vi.stubGlobal('document', {
    documentElement: {},
    createElement(tag: string): unknown {
      if (tag !== 'canvas') throw new Error(`unexpected createElement(${tag})`);
      const sprite = makeFakeSprite(trace);
      if (!spriteContext) sprite.getContext = () => null;
      return sprite;
    },
  });
  vi.stubGlobal('getComputedStyle', () => ({
    // Distinguish the quest token so a mis-keyed cache shows up as the wrong color.
    getPropertyValue: (token: string) => resolvedColors.get(token)?.() ?? `paint:${token}`,
  }));
}

function newTrace(): GlyphTrace {
  return {
    blits: [],
    markerBlits: [],
    sprites: [],
    minimapTextCalls: 0,
    minimapFontWrites: 0,
    color: 'quest-a',
    outlineColor: 'paint:--color-minimap-outline',
    segments: [],
    filledArcs: [],
    strokedArcs: [],
    strokedPaths: [],
    rects: [],
  };
}

function isMarkerSprite(image: unknown): image is FakeMarkerSprite {
  return typeof image === 'object' && image !== null && 'markerId' in image;
}

/** Fake MapMarkerArt with an explicit success set. Every request is recorded,
 *  including misses, so fallback and size routing are both observable. */
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

function fakeMinimapContext(trace: GlyphTrace): CanvasRenderingContext2D {
  let font = '';
  let alpha = 1;
  let pendingArcs: GlyphTrace['filledArcs'] = [];
  let pendingCommands: string[] = [];
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    get globalAlpha(): number {
      return alpha;
    },
    set globalAlpha(value: number) {
      alpha = value;
    },
    imageSmoothingEnabled: true,
    get font(): string {
      return font;
    },
    set font(value: string) {
      trace.minimapFontWrites++;
      font = value;
    },
    fillText(): void {
      trace.minimapTextCalls++;
    },
    strokeText(): void {
      trace.minimapTextCalls++;
    },
    drawImage(image: unknown, ...rest: number[]): void {
      // The 3-argument form is a glyph or painted-marker sprite; the terrain
      // sub-rect blit passes 9.
      if (rest.length === 2) {
        if (isMarkerSprite(image)) {
          trace.markerBlits.push({ sprite: image, dx: rest[0], dy: rest[1], alpha });
        } else {
          trace.blits.push({ sprite: image as FakeSprite, dx: rest[0], dy: rest[1], alpha });
        }
      }
    },
    clearRect(): void {},
    save(): void {},
    restore(): void {},
    beginPath(): void {
      pathStart = null;
      pending.length = 0;
      pendingArcs = [];
      pendingCommands = [];
    },
    closePath(): void {
      pendingCommands.push('closePath');
    },
    clip(): void {},
    arc(x: number, y: number, radius: number): void {
      pendingCommands.push('arc');
      pendingArcs.push({ x, y, radius });
    },
    moveTo(x: number, y: number): void {
      pendingCommands.push('moveTo');
      pathStart = { x, y };
    },
    lineTo(x: number, y: number): void {
      pendingCommands.push('lineTo');
      if (pathStart !== null) {
        pending.push({ fromX: pathStart.x, fromY: pathStart.y, toX: x, toY: y, stroked: false });
      }
      pathStart = { x, y };
    },
    fill(): void {
      trace.filledArcs.push(...pendingArcs);
    },
    stroke(): void {
      trace.strokedPaths.push({
        commands: [...pendingCommands],
        strokeStyle: String(ctx.strokeStyle),
        lineWidth: ctx.lineWidth,
      });
      for (const seg of pending) {
        seg.stroked = true;
        trace.segments.push(seg);
      }
      for (const arc of pendingArcs) {
        trace.strokedArcs.push({
          ...arc,
          strokeStyle: String(ctx.strokeStyle),
          lineWidth: ctx.lineWidth,
        });
      }
      pending.length = 0;
    },
    fillRect(x: number, y: number, width: number, height: number): void {
      trace.rects.push({
        op: 'fill',
        x,
        y,
        width,
        height,
        color: String(ctx.fillStyle),
        lineWidth: ctx.lineWidth,
      });
    },
    strokeRect(x: number, y: number, width: number, height: number): void {
      trace.rects.push({
        op: 'stroke',
        x,
        y,
        width,
        height,
        color: String(ctx.strokeStyle),
        lineWidth: ctx.lineWidth,
      });
    },
    translate(): void {},
    rotate(): void {},
  };
  let pathStart: { x: number; y: number } | null = null;
  const pending: GlyphTrace['segments'] = [];
  return ctx as unknown as CanvasRenderingContext2D;
}

const SYMBOL_COLORS = Object.fromEntries(
  Object.keys(PAINTER_TOKEN_TABLE).map((key) => [key, `paint:${key}`]),
) as MinimapColors;

/** Exercise the actual private immediate-mode draw loop without making entity
 *  classification part of these painter-only silhouette assertions. */
function drawSymbols(
  markers: readonly MinimapMarker[],
  profile: 'standard' | 'compact' = 'standard',
  markerArt?: MapMarkerArt,
): GlyphTrace {
  const trace = newTrace();
  const painter = newPainter(markerArt) as unknown as {
    drawMarkers(
      ctx: CanvasRenderingContext2D,
      markers: readonly MinimapMarker[],
      colors: MinimapColors,
      profile?: 'standard' | 'compact',
    ): void;
  };
  painter.drawMarkers(fakeMinimapContext(trace), markers, SYMBOL_COLORS, profile);
  return trace;
}

// The player sits at an overworld position with no gather node or station in the rim.
const PLAYER_POS = { x: 0, z: 100 };

// A real cadenced work order drives the repeat/cooldown marker variants.
function requireWorkOrderQuest() {
  const quest = Object.values(QUESTS).find((q) => q.repeatable && q.repeatCadenceTicks);
  if (!quest) throw new Error('expected a cadenced work order');
  return quest;
}
const WORK_ORDER_QUEST = requireWorkOrderQuest();

/** `npcs` are world positions; `state` drives which glyph and marker variant
 *  each quest-giver resolves to (repeat/cooldown ride the real work order
 *  with the questsDone/cadence inputs the classifier reads). */
function glyphWorld(
  npcs: Array<{ x: number; z: number; quest: boolean }>,
  state: 'available' | 'ready' | 'repeat' | 'cooldown',
): IWorld {
  const variant = state === 'repeat' || state === 'cooldown';
  const quest = variant ? WORK_ORDER_QUEST : READY_QUEST;
  const entities = new Map<number, unknown>();
  const player = { id: 1, kind: 'player', name: 'Me', pos: { ...PLAYER_POS }, facing: 0 };
  entities.set(1, player);
  npcs.forEach((npc, index) => {
    entities.set(index + 2, {
      id: index + 2,
      kind: 'npc',
      name: `Npc${index}`,
      dead: false,
      lootable: false,
      aggroTargetId: null,
      templateId: npc.quest ? quest.giverNpcId : '',
      questIds: npc.quest ? [quest.id] : [],
      pos: { x: npc.x, z: npc.z },
    });
  });
  return {
    player,
    entities,
    partyInfo: null,
    socialInfo: null,
    delveRun: null,
    cfg: { seed: 42, playerClass: 'warrior' },
    playerId: 1,
    inventory: [],
    stationPlacements: [],
    nodeHarvestableByMe: () => false,
    questState: (q: string) =>
      q === quest.id
        ? state === 'repeat'
          ? 'available'
          : state === 'cooldown'
            ? 'unavailable'
            : state
        : 'unavailable',
    questsDone: variant ? new Set([quest.id]) : new Set<string>(),
    craftingIdentity: {
      version: 1,
      synced: true,
      cadenceBlockedQuests: state === 'cooldown' ? [quest.id] : [],
    },
  } as unknown as IWorld;
}

function newPainter(
  markerArt?: MapMarkerArt,
  markerProfile: () => 'standard' | 'compact' = () => 'standard',
): MinimapPainter {
  return new MinimapPainter(
    { setText: () => {} } as never,
    () => 'cls-color',
    (zoneId: string) => zoneId,
    (name: string, rank: string | null) => (rank ? `${name} ${rank}` : name),
    () => 'Thornhollow Fields',
    markerArt,
    markerProfile,
  );
}

function paint(p: MinimapPainter, ctx: CanvasRenderingContext2D, world: IWorld): void {
  p.paintOverworld(ctx, world, {} as HTMLElement, { width: 2048 } as HTMLCanvasElement, 1);
}

/** The Protect Yumi arm, which shares drawMarkers with the overworld arm. */
function paintMaze(p: MinimapPainter, ctx: CanvasRenderingContext2D, world: IWorld): void {
  p.paintYumiMaze(ctx, world, {} as HTMLElement, 1, 'Protect Yumi');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('minimap_painter: tiny procedural symbols carry identity without hue', () => {
  it('draws a friend as an outlined circle and a guildmate as an outlined diamond', () => {
    const friend = drawSymbols([{ kind: 'ally', mx: 20, my: 30, ally: 'friend' }]);
    const guild = drawSymbols([{ kind: 'ally', mx: 20, my: 30, ally: 'guild' }]);

    expect(friend.filledArcs).toEqual([{ x: 20, y: 30, radius: 3 }]);
    expect(friend.strokedArcs).toEqual([
      {
        x: 20,
        y: 30,
        radius: 3,
        strokeStyle: 'paint:outline',
        lineWidth: 1.5,
      },
    ]);
    expect(friend.segments).toEqual([]);

    expect(guild.filledArcs).toEqual([]);
    expect(guild.strokedArcs).toEqual([]);
    expect(guild.segments).toEqual([
      { fromX: 20, fromY: 26.5, toX: 23.5, toY: 30, stroked: true },
      { fromX: 23.5, fromY: 30, toX: 20, toY: 33.5, stroked: true },
      { fromX: 20, fromY: 33.5, toX: 16.5, toY: 30, stroked: true },
    ]);
  });

  it('gives loose loot, calm mobs, aggro mobs, and lootable corpses four silhouettes', () => {
    const looseLoot = drawSymbols([{ kind: 'object-loot', mx: 20, my: 30 }]);
    const calmMob = drawSymbols([{ kind: 'mob', mx: 20, my: 30, aggro: false }]);
    const aggroMob = drawSymbols([{ kind: 'mob', mx: 20, my: 30, aggro: true }]);
    const mobLoot = drawSymbols([{ kind: 'mob-loot', mx: 20, my: 30 }]);

    // Loose loot is an eight-point sparkle. The fake records the seven explicit
    // edges; closePath supplies the eighth in the real canvas.
    expect(looseLoot.segments).toHaveLength(7);
    expect(looseLoot.segments[0]).toEqual({
      fromX: 20,
      fromY: 26,
      toX: 21,
      toY: 29,
      stroked: true,
    });
    expect(looseLoot.strokedArcs).toEqual([]);
    expect(looseLoot.rects).toEqual([]);

    expect(calmMob.strokedArcs).toEqual([
      {
        x: 20,
        y: 30,
        radius: 2.25,
        strokeStyle: 'paint:outline',
        lineWidth: 1.25,
      },
    ]);
    expect(calmMob.segments).toEqual([]);

    expect(aggroMob.strokedArcs).toEqual([]);
    expect(aggroMob.segments).toEqual([
      { fromX: 20, fromY: 26.5, toX: 23.5, toY: 30, stroked: true },
      { fromX: 23.5, fromY: 30, toX: 20, toY: 33.5, stroked: true },
      { fromX: 20, fromY: 33.5, toX: 16.5, toY: 30, stroked: true },
    ]);

    expect(mobLoot.strokedArcs).toEqual([]);
    expect(mobLoot.segments).toEqual([]);
    expect(mobLoot.rects).toEqual([
      {
        op: 'fill',
        x: 17.5,
        y: 27.5,
        width: 5,
        height: 5,
        color: 'paint:mobLoot',
        lineWidth: 1.25,
      },
      {
        op: 'stroke',
        x: 17.5,
        y: 27.5,
        width: 5,
        height: 5,
        color: 'paint:outline',
        lineWidth: 1.25,
      },
      {
        op: 'fill',
        x: 19.25,
        y: 29.25,
        width: 1.5,
        height: 1.5,
        color: 'paint:outline',
        lineWidth: 1.25,
      },
    ]);
  });

  it('crosses out dead party discs and arrows while leaving live silhouettes clean', () => {
    const liveDisc = drawSymbols([
      { kind: 'party-disc', mx: 20, my: 30, radius: 5, cls: 'mage', dead: false, pip: true },
    ]);
    const deadDisc = drawSymbols([
      { kind: 'party-disc', mx: 20, my: 30, radius: 5, cls: 'mage', dead: true, pip: false },
    ]);
    const liveArrow = drawSymbols([
      { kind: 'party-arrow', mx: 20, my: 30, angle: 0, cls: 'mage', dead: false },
    ]);
    const deadArrow = drawSymbols([
      { kind: 'party-arrow', mx: 20, my: 30, angle: 0, cls: 'mage', dead: true },
    ]);

    expect(liveDisc.segments).toEqual([]);
    expect(deadDisc.segments).toEqual([
      { fromX: 17.25, fromY: 27.25, toX: 22.75, toY: 32.75, stroked: true },
      { fromX: 22.75, fromY: 27.25, toX: 17.25, toY: 32.75, stroked: true },
    ]);
    // The first two segments are the arrow body. Only the dead arrow adds the
    // two short crossing strokes inside it.
    expect(liveArrow.segments).toHaveLength(2);
    expect(deadArrow.segments.slice(2)).toEqual([
      { fromX: -2.5, fromY: -2.5, toX: 2.5, toY: 2.5, stroked: true },
      { fromX: 2.5, fromY: -2.5, toX: -2.5, toY: 2.5, stroked: true },
    ]);
  });

  it('keeps dungeon entrance and exit fallbacks distinct and dark-outlined', () => {
    const entrance = drawSymbols([{ kind: 'portal', mx: 20, my: 30, portal: 'dungeon-entrance' }]);
    const exit = drawSymbols([{ kind: 'portal', mx: 20, my: 30, portal: 'dungeon-exit' }]);

    expect(entrance.filledArcs).toEqual([
      { x: 20, y: 30, radius: 3.5 },
      { x: 20, y: 30, radius: 1.25 },
    ]);
    expect(entrance.strokedArcs).toEqual([
      {
        x: 20,
        y: 30,
        radius: 3.5,
        strokeStyle: 'paint:outline',
        lineWidth: 1.5,
      },
    ]);
    expect(entrance.segments).toEqual([]);

    // Exit is an outlined upward arrow, never another portal dot.
    expect(exit.filledArcs).toEqual([]);
    expect(exit.strokedArcs).toEqual([]);
    expect(exit.segments).toEqual([
      { fromX: 20, fromY: 26, toX: 23.5, toY: 30, stroked: true },
      { fromX: 23.5, fromY: 30, toX: 21.5, toY: 30, stroked: true },
      { fromX: 21.5, fromY: 30, toX: 21.5, toY: 33.5, stroked: true },
      { fromX: 21.5, fromY: 33.5, toX: 18.5, toY: 33.5, stroked: true },
      { fromX: 18.5, fromY: 33.5, toX: 18.5, toY: 30, stroked: true },
      { fromX: 18.5, fromY: 30, toX: 16.5, toY: 30, stroked: true },
    ]);
  });

  it.each([
    { navigation: 'delve-entrance', id: 'delve-entrance' },
    { navigation: 'world-passage', id: 'world-passage' },
  ] as const)('blits cached $id art for stable routes on both profiles', ({ navigation, id }) => {
    for (const [profile, size] of [
      ['standard', 'minimapNavigation'],
      ['compact', 'minimapNavigationCompact'],
    ] as const) {
      const markerArt = fakeMarkerArt([id]);
      const trace = drawSymbols(
        [{ kind: 'stable-navigation', mx: 20, my: 30, navigation }],
        profile,
        markerArt.art,
      );
      expect(markerArt.calls).toEqual([{ id, size }]);
      expect(trace.markerBlits).toEqual([
        {
          sprite: { markerId: id, sizeId: size },
          dx: Math.round(20 - MAP_MARKER_SIZES[size] / 2),
          dy: Math.round(30 - MAP_MARKER_SIZES[size] / 2),
          alpha: 1,
        },
      ]);
      expect(trace.minimapTextCalls).toBe(0);
      expect(trace.minimapFontWrites).toBe(0);
    }
  });

  it('keeps delve-door and world-passage loading fallbacks visually distinct', () => {
    const delve = drawSymbols([
      { kind: 'stable-navigation', mx: 20, my: 30, navigation: 'delve-entrance' },
    ]);
    const passage = drawSymbols([
      { kind: 'stable-navigation', mx: 20, my: 30, navigation: 'world-passage' },
    ]);
    const operations = (trace: GlyphTrace) => [trace.segments, trace.filledArcs, trace.rects];
    expect(operations(delve)).not.toEqual(operations(passage));
    expect(delve.minimapTextCalls + passage.minimapTextCalls).toBe(0);
    expect(delve.minimapFontWrites + passage.minimapFontWrites).toBe(0);
  });

  it('draws every semantic-object family and rift mechanic without canvas text', () => {
    const semantics: MinimapObjectSemantic[] = [
      { kind: 'rift-entrance', rank: 'S' },
      { kind: 'rift-descent' },
      { kind: 'rift-return', route: 'beacon', rank: null },
      { kind: 'rift-return', route: 'egress', rank: 'A' },
      { kind: 'rift-reward', reward: 'treasure', state: 'available' },
      { kind: 'rift-reward', reward: 'cache', state: 'locked' },
      { kind: 'rift-reward', reward: 'cache', state: 'opened' },
      { kind: 'rift-reward', reward: 'cache', state: 'jammed' },
      { kind: 'delve-passage', state: 'sealed' },
      { kind: 'delve-passage', state: 'open' },
      { kind: 'delve-surface' },
      { kind: 'delve-reward', reward: 'cache', state: 'locked', bountiful: true },
      { kind: 'delve-reward', reward: 'reliquary', state: 'ready', bountiful: false },
      { kind: 'delve-reward', reward: 'reliquary', state: 'active', bountiful: false },
      { kind: 'delve-reward', reward: 'reliquary', state: 'opened', bountiful: false },
      { kind: 'rift-mechanic', mechanic: 'pylon', state: 'unlit' },
      { kind: 'rift-mechanic', mechanic: 'pylon', state: 'lit' },
      { kind: 'rift-mechanic', mechanic: 'sequence-rune', state: 'unlit' },
      { kind: 'rift-mechanic', mechanic: 'ice-goal', state: 'target' },
      { kind: 'rift-mechanic', mechanic: 'boulder-pad', state: 'target' },
      { kind: 'rift-mechanic', mechanic: 'boulder', state: 'movable' },
      { kind: 'rift-mechanic', mechanic: 'boulder', state: 'placed' },
      { kind: 'rift-mechanic', mechanic: 'gate', state: 'sealed' },
      { kind: 'rift-mechanic', mechanic: 'gate', state: 'open' },
      { kind: 'rift-mechanic', mechanic: 'switch', state: 'ready' },
      { kind: 'rift-mechanic', mechanic: 'switch', state: 'on' },
      { kind: 'rift-mechanic', mechanic: 'orb', state: 'dormant' },
      { kind: 'rift-mechanic', mechanic: 'orb', state: 'active' },
      { kind: 'rift-mechanic', mechanic: 'roller', state: 'hazard' },
    ];
    for (const semantic of semantics) {
      const trace = drawSymbols([{ kind: 'semantic-object', mx: 20, my: 30, semantic }]);
      const operations =
        trace.segments.length +
        trace.filledArcs.length +
        trace.strokedArcs.length +
        trace.rects.length;
      expect(operations, JSON.stringify(semantic)).toBeGreaterThan(0);
      expect(trace.minimapTextCalls, JSON.stringify(semantic)).toBe(0);
      expect(trace.minimapFontWrites, JSON.stringify(semantic)).toBe(0);
    }
  });

  it.each([
    {
      semantic: { kind: 'rift-entrance', rank: 'S' },
      id: 'rift-entrance',
      standard: 'minimapNavigationRankS',
      compact: 'minimapNavigationRankSCompact',
    },
    {
      semantic: { kind: 'rift-return', route: 'beacon', rank: null },
      id: 'rift-beacon',
      standard: 'minimapNavigation',
      compact: 'minimapNavigationCompact',
    },
    {
      semantic: { kind: 'rift-reward', reward: 'cache', state: 'jammed' },
      id: 'reward-locked-cache',
      standard: 'minimapRewardJammed',
      compact: 'minimapRewardJammedCompact',
    },
    {
      semantic: {
        kind: 'delve-reward',
        reward: 'reliquary',
        state: 'active',
        bountiful: true,
      },
      id: 'reward-reliquary',
      standard: 'minimapRewardActiveBountiful',
      compact: 'minimapRewardActiveBountifulCompact',
    },
    {
      semantic: { kind: 'delve-passage', state: 'sealed' },
      id: 'delve-passage',
      standard: 'minimapNavigationLocked',
      compact: 'minimapNavigationLockedCompact',
    },
  ] as const)(
    'blits cached $id art for semantic state on both profiles',
    ({ semantic, id, standard, compact }) => {
      for (const [profile, size] of [
        ['standard', standard],
        ['compact', compact],
      ] as const) {
        const markerArt = fakeMarkerArt([id]);
        const trace = drawSymbols(
          [{ kind: 'semantic-object', mx: 20, my: 30, semantic }],
          profile,
          markerArt.art,
        );
        expect(markerArt.calls).toEqual([{ id, size }]);
        expect(trace.markerBlits).toEqual([
          {
            sprite: { markerId: id, sizeId: size },
            dx: Math.round(20 - MAP_MARKER_SIZES[size] / 2),
            dy: Math.round(30 - MAP_MARKER_SIZES[size] / 2),
            alpha: 1,
          },
        ]);
        expect(trace.minimapTextCalls).toBe(0);
      }
    },
  );

  it('keeps rift mechanics procedural and does not request unrelated generated art', () => {
    const markerArt = fakeMarkerArt([...MAP_MARKER_ART_IDS]);
    const trace = drawSymbols(
      [
        {
          kind: 'semantic-object',
          mx: 20,
          my: 30,
          semantic: { kind: 'rift-mechanic', mechanic: 'gate', state: 'sealed' },
        },
      ],
      'standard',
      markerArt.art,
    );
    expect(markerArt.calls).toEqual([]);
    expect(trace.segments.length + trace.rects.length).toBeGreaterThan(0);
  });

  it('uses hue-independent interior marks for blocked, available, and completed states', () => {
    const semantic = (value: MinimapObjectSemantic) =>
      drawSymbols([{ kind: 'semantic-object', mx: 20, my: 30, semantic: value }]);
    const sealed = semantic({ kind: 'delve-passage', state: 'sealed' });
    const open = semantic({ kind: 'delve-passage', state: 'open' });
    expect(sealed.segments).not.toEqual(open.segments);

    const locked = semantic({ kind: 'rift-reward', reward: 'cache', state: 'locked' });
    const opened = semantic({ kind: 'rift-reward', reward: 'cache', state: 'opened' });
    const jammed = semantic({ kind: 'rift-reward', reward: 'cache', state: 'jammed' });
    expect(locked.segments).not.toEqual(opened.segments);
    expect(jammed.segments).not.toEqual(opened.segments);

    const unlit = semantic({ kind: 'rift-mechanic', mechanic: 'pylon', state: 'unlit' });
    const lit = semantic({ kind: 'rift-mechanic', mechanic: 'pylon', state: 'lit' });
    expect(unlit.segments).not.toEqual(lit.segments);
  });

  it('shows rift rank with one to four pips and scales semantic geometry for compact touch', () => {
    const entrance = (rank: 'C' | 'B' | 'A' | 'S', profile: 'standard' | 'compact') =>
      drawSymbols(
        [{ kind: 'semantic-object', mx: 20, my: 30, semantic: { kind: 'rift-entrance', rank } }],
        profile,
      );
    expect(entrance('C', 'standard').rects).toHaveLength(1);
    expect(entrance('S', 'standard').rects).toHaveLength(4);
    const standardRadius = entrance('C', 'standard').strokedArcs[0].radius;
    const compactRadius = entrance('C', 'compact').strokedArcs[0].radius;
    expect(compactRadius).toBeGreaterThan(standardRadius);
  });

  it('restores lineCap after cooldown and lock fallbacks', () => {
    const trace = newTrace();
    const ctx = fakeMinimapContext(trace);
    ctx.lineCap = 'square';
    const painter = newPainter() as unknown as {
      drawMarkers(
        ctx: CanvasRenderingContext2D,
        markers: readonly MinimapMarker[],
        colors: MinimapColors,
        profile?: 'standard' | 'compact',
      ): void;
    };
    painter.drawMarkers(
      ctx,
      [{ kind: 'gather-node', mx: 20, my: 30, type: 'ore', ready: false, locked: true }],
      SYMBOL_COLORS,
      'compact',
    );
    expect(ctx.lineCap).toBe('square');
  });
});

describe('minimap_painter: gathering state cues (decisive trace)', () => {
  // Drive the real fallback paint through the tracing context. The broken
  // cooldown ring and bronze lock remain independent, including when both
  // states apply. No gathering state uses a diagonal strike.
  function nodeWorld(over: { locked: boolean; ready: boolean }): IWorld {
    const node = GATHER_NODES[0];
    const entities = new Map<number, unknown>();
    const player = {
      id: 1,
      kind: 'player',
      name: 'Me',
      pos: { x: node.pos.x, z: node.pos.z },
      facing: 0,
    };
    entities.set(1, player);
    return {
      player,
      entities,
      partyInfo: null,
      socialInfo: null,
      delveRun: null,
      cfg: { seed: 42, playerClass: 'warrior' },
      playerId: 1,
      inventory: over.locked ? [] : [{ itemId: 'copper_mining_pick', count: 1 }],
      gatheringProficiency: {},
      stationPlacements: [],
      nodeHarvestableByMe: () => over.ready,
      questState: () => 'unavailable',
    } as unknown as IWorld;
  }
  const diagonalStrikesOf = (trace: GlyphTrace) =>
    trace.segments.filter(
      (s) => s.stroked && s.toX - s.fromX > 0 && s.toX - s.fromX === -(s.toY - s.fromY),
    );

  it('shows cooldown and lock independently without a diagonal strike', () => {
    for (const [locked, ready, centeredArcCount] of [
      [true, true, 1],
      [true, false, 3],
      [false, true, 1],
      [false, false, 3],
    ] as const) {
      const trace = newTrace();
      installGlyphGlobals(trace);
      paint(newPainter(), fakeMinimapContext(trace), nodeWorld({ locked, ready }));
      expect(diagonalStrikesOf(trace), `locked=${locked} ready=${ready}`).toEqual([]);
      expect(
        trace.strokedArcs.filter((arc) => arc.x === 81 && arc.y === 81),
        `locked=${locked} ready=${ready} cooldown ring`,
      ).toHaveLength(centeredArcCount);
      expect(trace.rects.length > 0, `locked=${locked} ready=${ready} lock badge`).toBe(locked);
      vi.unstubAllGlobals();
    }
  });
});

// ---------------------------------------------------------------------------
// Painted stable marker art. The injected fake returns opaque identities rather
// than canvases so id/size routing, alpha composition, and fallback are visible
// without loading browser images.

const isolatedGatherNode = GATHER_NODES.find(
  (node) =>
    node.tier === 1 &&
    GATHER_NODES.every(
      (other) =>
        other === node || Math.hypot(other.pos.x - node.pos.x, other.pos.z - node.pos.z) > 43,
    ),
);
if (!isolatedGatherNode) throw new Error('expected an isolated tier-1 gathering node');
const ISOLATED_GATHER_NODE = isolatedGatherNode;

const GATHER_IDENTITY_TYPES = ['ore', 'wood', 'herb'] as const;
const ISOLATED_GATHER_NODES_BY_TYPE = GATHER_IDENTITY_TYPES.map((type) => {
  const node = GATHER_NODES.find(
    (candidate) =>
      candidate.type === type &&
      candidate.tier === 1 &&
      GATHER_NODES.every(
        (other) =>
          other === candidate ||
          Math.hypot(other.pos.x - candidate.pos.x, other.pos.z - candidate.pos.z) > 44,
      ),
  );
  if (!node) throw new Error(`expected an isolated tier-1 ${type} gathering node`);
  return node;
});

const TEST_STATION_TYPES = [
  'forge',
  'kitchens',
  'apothecary',
  'tannery',
  'loom',
  'toolworks',
] as const;

function gatherArtWorld(
  ready: boolean,
  locked: boolean,
  node: (typeof GATHER_NODES)[number] = ISOLATED_GATHER_NODE,
): IWorld {
  const player = {
    id: 1,
    kind: 'player',
    name: 'Me',
    pos: { ...node.pos },
    facing: 0,
  };
  return {
    player,
    entities: new Map([[1, player]]),
    partyInfo: null,
    socialInfo: null,
    delveRun: null,
    cfg: { seed: 42, playerClass: 'warrior' },
    playerId: 1,
    inventory: locked
      ? []
      : [
          { itemId: 'copper_mining_pick', count: 1 },
          { itemId: 'handaxe', count: 1 },
          { itemId: 'gathering_sickle', count: 1 },
        ],
    gatheringProficiency: { mining: 1, logging: 1, herbalism: 1 },
    stationPlacements: [],
    nodeHarvestableByMe: (id: string) => id === node.id && ready,
    questState: () => 'unavailable',
  } as unknown as IWorld;
}

function stableMarkerWorld(opts: {
  portals?: Array<'dungeon_door' | 'dungeon_exit'>;
  services?: Array<'mailbox' | typeof EASTBROOK_NOTICEBOARD_TEMPLATE_ID>;
  station?: boolean;
  stationTypes?: readonly (typeof TEST_STATION_TYPES)[number][];
}): IWorld {
  const player = { id: 1, kind: 'player', name: 'Me', pos: { ...PLAYER_POS }, facing: 0 };
  const entities = new Map<number, unknown>([[1, player]]);
  opts.portals?.forEach((templateId, index) => {
    entities.set(index + 2, {
      id: index + 2,
      kind: 'object',
      name: templateId,
      templateId,
      lootable: false,
      pos: { x: PLAYER_POS.x + 4 + index * 3, z: PLAYER_POS.z - 1.5 },
    });
  });
  opts.services?.forEach((templateId, index) => {
    const id = entities.size + 1;
    entities.set(id, {
      id,
      kind: 'object',
      name: templateId,
      templateId,
      lootable: false,
      pos: { x: PLAYER_POS.x - 4 - index * 3, z: PLAYER_POS.z + 1.5 },
    });
  });
  const stationTypes = opts.stationTypes ?? (opts.station ? (['forge'] as const) : []);
  return {
    player,
    entities,
    partyInfo: null,
    socialInfo: null,
    delveRun: null,
    cfg: { seed: 42, playerClass: 'warrior' },
    playerId: 1,
    inventory: [],
    gatheringProficiency: {},
    stationPlacements: stationTypes.map((type, index) => ({
      id: `station_test_${type}`,
      type,
      zoneId: 'eastbrook_vale',
      pos: { x: PLAYER_POS.x - 3 + index * 2, z: PLAYER_POS.z + 2 },
      masterNpcId: `test_${type}_master`,
    })),
    nodeHarvestableByMe: () => false,
    questState: () => 'unavailable',
  } as unknown as IWorld;
}

const gatherDiagonalStrikes = (trace: GlyphTrace) =>
  trace.segments.filter(
    (segment) =>
      segment.stroked &&
      segment.toX - segment.fromX > 0 &&
      segment.toX - segment.fromX === -(segment.toY - segment.fromY),
  );

describe('minimap_painter: painted stable marker sprites', () => {
  it.each(ISOLATED_GATHER_NODES_BY_TYPE)(
    'routes gather-$type through its exact painted identity',
    (node) => {
      const id = `gather-${node.type}` as MapMarkerArtId;
      const markerArt = fakeMarkerArt([id]);
      const trace = newTrace();
      installGlyphGlobals(trace);

      paint(
        newPainter(markerArt.art),
        fakeMinimapContext(trace),
        gatherArtWorld(true, false, node),
      );

      expect(markerArt.calls.filter((call) => call.id === id)).toEqual([
        { id, size: 'minimapGatherReady' },
      ]);
      expect(trace.markerBlits).toEqual([
        {
          sprite: { markerId: id, sizeId: 'minimapGatherReady' },
          dx: 81 - MAP_MARKER_SIZES.minimapGatherReady / 2,
          dy: 81 - MAP_MARKER_SIZES.minimapGatherReady / 2,
          alpha: 1,
        },
      ]);
    },
  );

  it.each([
    { ready: true, locked: false, size: 'minimapGatherReady' },
    { ready: false, locked: false, size: 'minimapGatherCooldown' },
    { ready: true, locked: true, size: 'minimapGatherReadyLocked' },
    { ready: false, locked: true, size: 'minimapGatherCooldownLocked' },
  ] as const)(
    'routes gathering ready=$ready locked=$locked through precomputed $size',
    ({ ready, locked, size }) => {
      const id = `gather-${ISOLATED_GATHER_NODE.type}` as MapMarkerArtId;
      const markerArt = fakeMarkerArt([id]);
      const trace = newTrace();
      installGlyphGlobals(trace);
      const ctx = fakeMinimapContext(trace);
      ctx.globalAlpha = 0.8;

      paint(newPainter(markerArt.art), ctx, gatherArtWorld(ready, locked));

      expect(markerArt.calls).toEqual([{ id, size }]);
      expect(trace.markerBlits).toHaveLength(1);
      expect(trace.markerBlits[0].sprite).toEqual({ markerId: id, sizeId: size });
      expect(trace.markerBlits[0].alpha).toBeCloseTo(0.8);
      expect(trace.markerBlits[0].dx).toBe(Math.round(81 - MAP_MARKER_SIZES[size] / 2));
      expect(trace.markerBlits[0].dy).toBe(Math.round(81 - MAP_MARKER_SIZES[size] / 2));
      expect(gatherDiagonalStrikes(trace)).toEqual([]);
      expect(trace.rects).toEqual([]);
      expect(ctx.globalAlpha).toBe(0.8);
    },
  );

  it.each([
    { ready: true, locked: false, size: 'minimapGatherReadyCompact' },
    { ready: false, locked: false, size: 'minimapGatherCooldownCompact' },
    { ready: true, locked: true, size: 'minimapGatherReadyLockedCompact' },
    { ready: false, locked: true, size: 'minimapGatherCooldownLockedCompact' },
  ] as const)('uses compact gathering raster $size', ({ ready, locked, size }) => {
    const id = `gather-${ISOLATED_GATHER_NODE.type}` as MapMarkerArtId;
    const markerArt = fakeMarkerArt([id]);
    const trace = newTrace();
    installGlyphGlobals(trace);
    const profile = vi.fn(() => 'compact' as const);

    paint(
      newPainter(markerArt.art, profile),
      fakeMinimapContext(trace),
      gatherArtWorld(ready, locked),
    );

    expect(profile).toHaveBeenCalledTimes(1);
    expect(markerArt.calls).toEqual([{ id, size }]);
    expect(trace.markerBlits[0].sprite).toEqual({ markerId: id, sizeId: size });
  });

  it('routes all six station identities through the minimap size and centers each sprite', () => {
    const stationIds = TEST_STATION_TYPES.map((type) => `station-${type}` as MapMarkerArtId);
    const markerArt = fakeMarkerArt(stationIds);
    const trace = newTrace();
    installGlyphGlobals(trace);

    paint(
      newPainter(markerArt.art),
      fakeMinimapContext(trace),
      stableMarkerWorld({ stationTypes: TEST_STATION_TYPES }),
    );

    expect(markerArt.calls.filter((call) => call.id.startsWith('station-'))).toEqual(
      stationIds.map((id) => ({ id, size: 'minimapStation' })),
    );
    expect(trace.markerBlits.map((blit) => blit.sprite)).toEqual(
      stationIds.map((markerId) => ({ markerId, sizeId: 'minimapStation' })),
    );
    expect(
      trace.markerBlits.every((blit) => Number.isInteger(blit.dx) && Number.isInteger(blit.dy)),
    ).toBe(true);
  });

  it('falls back to the procedural station diamond while its art is unavailable', () => {
    const markerArt = fakeMarkerArt([]);
    const trace = newTrace();
    installGlyphGlobals(trace);
    const world = stableMarkerWorld({ station: true });

    paint(newPainter(markerArt.art), fakeMinimapContext(trace), world);

    expect(markerArt.calls.filter((call) => call.id.startsWith('station-'))).toEqual([
      { id: 'station-forge', size: 'minimapStation' },
    ]);
    expect(trace.markerBlits.some((blit) => blit.sprite.markerId === 'station-forge')).toBe(false);
    const station = createMinimapMarkers()
      .build(world, 162, 1.7)
      .markers.find((marker) => marker.kind === 'station');
    if (station?.kind !== 'station') throw new Error('expected the station marker');
    expect(trace.segments).toEqual(
      expect.arrayContaining([
        {
          fromX: station.mx,
          fromY: station.my - 3,
          toX: station.mx + 3,
          toY: station.my,
          stroked: true,
        },
        {
          fromX: station.mx + 3,
          fromY: station.my,
          toX: station.mx,
          toY: station.my + 3,
          stroked: true,
        },
        {
          fromX: station.mx,
          fromY: station.my + 3,
          toX: station.mx - 3,
          toY: station.my,
          stroked: true,
        },
      ]),
    );
  });

  it('routes distinct dungeon entrance and exit paintings through the shared minimap size', () => {
    const markerArt = fakeMarkerArt(['dungeon-entrance', 'dungeon-exit']);
    const trace = newTrace();
    installGlyphGlobals(trace);

    paint(
      newPainter(markerArt.art),
      fakeMinimapContext(trace),
      stableMarkerWorld({ portals: ['dungeon_door', 'dungeon_exit'] }),
    );

    expect(markerArt.calls.filter((call) => call.id.startsWith('dungeon-'))).toEqual([
      { id: 'dungeon-entrance', size: 'minimapDungeon' },
      { id: 'dungeon-exit', size: 'minimapDungeon' },
    ]);
    expect(trace.markerBlits.map((blit) => blit.sprite)).toEqual([
      { markerId: 'dungeon-entrance', sizeId: 'minimapDungeon' },
      { markerId: 'dungeon-exit', sizeId: 'minimapDungeon' },
    ]);
    expect(trace.filledArcs.filter((arc) => arc.radius === 3.5)).toHaveLength(0);
  });

  it('routes civic services through distinct identities at minimapService size', () => {
    const markerArt = fakeMarkerArt(['service-mailbox', 'service-noticeboard']);
    const trace = newTrace();
    installGlyphGlobals(trace);

    paint(
      newPainter(markerArt.art),
      fakeMinimapContext(trace),
      stableMarkerWorld({ services: ['mailbox', EASTBROOK_NOTICEBOARD_TEMPLATE_ID] }),
    );

    expect(markerArt.calls.filter((call) => call.id.startsWith('service-'))).toEqual([
      { id: 'service-mailbox', size: 'minimapService' },
      { id: 'service-noticeboard', size: 'minimapService' },
    ]);
    expect(
      trace.markerBlits
        .filter((blit) => blit.sprite.markerId.startsWith('service-'))
        .map((blit) => blit.sprite),
    ).toEqual([
      { markerId: 'service-mailbox', sizeId: 'minimapService' },
      { markerId: 'service-noticeboard', sizeId: 'minimapService' },
    ]);
  });

  it('uses distinct mailbox and noticeboard silhouettes while service art is unavailable', () => {
    const markerArt = fakeMarkerArt([]);
    const trace = newTrace();
    installGlyphGlobals(trace);
    const world = stableMarkerWorld({ services: ['mailbox', EASTBROOK_NOTICEBOARD_TEMPLATE_ID] });

    paint(newPainter(markerArt.art), fakeMinimapContext(trace), world);

    expect(markerArt.calls.filter((call) => call.id.startsWith('service-'))).toEqual([
      { id: 'service-mailbox', size: 'minimapService' },
      { id: 'service-noticeboard', size: 'minimapService' },
    ]);
    expect(trace.markerBlits.some((blit) => blit.sprite.markerId === 'service-mailbox')).toBe(
      false,
    );
    const service = createMinimapMarkers()
      .build(world, 162, 1.7)
      .markers.find((marker) => marker.kind === 'service');
    if (service?.kind !== 'service') throw new Error('expected the service marker');
    expect(trace.segments).toEqual(
      expect.arrayContaining([
        {
          fromX: service.mx,
          fromY: service.my - 3,
          toX: service.mx + 3,
          toY: service.my,
          stroked: true,
        },
        {
          fromX: service.mx + 3,
          fromY: service.my,
          toX: service.mx,
          toY: service.my + 3,
          stroked: true,
        },
        {
          fromX: service.mx,
          fromY: service.my + 3,
          toX: service.mx - 3,
          toY: service.my,
          stroked: true,
        },
      ]),
    );
    const services = createMinimapMarkers()
      .build(world, 162, 1.7)
      .markers.filter((marker) => marker.kind === 'service');
    const noticeboard = services.find((marker) => marker.service === 'noticeboard');
    if (!noticeboard) throw new Error('expected the noticeboard marker');
    expect(trace.segments).toEqual(
      expect.arrayContaining([
        {
          fromX: noticeboard.mx - 3,
          fromY: noticeboard.my - 2,
          toX: noticeboard.mx + 3,
          toY: noticeboard.my - 2,
          stroked: true,
        },
      ]),
    );
  });

  it('falls back to the procedural entrance dot while art is unavailable', () => {
    const markerArt = fakeMarkerArt([]);
    const trace = newTrace();
    installGlyphGlobals(trace);

    paint(
      newPainter(markerArt.art),
      fakeMinimapContext(trace),
      stableMarkerWorld({ portals: ['dungeon_door'] }),
    );

    expect(markerArt.calls.filter((call) => call.id.startsWith('dungeon-'))).toEqual([
      { id: 'dungeon-entrance', size: 'minimapDungeon' },
    ]);
    expect(trace.markerBlits).toEqual([]);
    expect(trace.filledArcs.filter((arc) => arc.radius === 3.5)).toHaveLength(1);
  });
});

describe('minimap_painter: generated quest art', () => {
  it.each([
    { state: 'available', id: 'quest-available', size: 'minimapQuest' },
    { state: 'ready', id: 'quest-ready', size: 'minimapQuest' },
    { state: 'repeat', id: 'quest-repeat', size: 'minimapQuest' },
    { state: 'cooldown', id: 'quest-cooldown', size: 'minimapQuestCooldown' },
  ] as const)(
    'routes $state through its exact standard raster at full alpha',
    ({ state, id, size }) => {
      const markerArt = fakeMarkerArt([id]);
      const trace = newTrace();
      installGlyphGlobals(trace);
      const ctx = fakeMinimapContext(trace);

      paint(newPainter(markerArt.art), ctx, glyphWorld([{ x: 4, z: 98.5, quest: true }], state));

      expect(markerArt.calls.filter((call) => call.id.startsWith('quest-'))).toEqual([
        { id, size },
      ]);
      expect(trace.markerBlits).toEqual([
        {
          sprite: { markerId: id, sizeId: size },
          dx: Math.round(74.2 - MAP_MARKER_SIZES[size] / 2),
          dy: Math.round(83.55 - MAP_MARKER_SIZES[size] / 2),
          alpha: 1,
        },
      ]);
      expect(trace.blits).toEqual([]);
      expect(trace.minimapTextCalls).toBe(0);
      expect(trace.minimapFontWrites).toBe(0);
    },
  );

  it.each([
    { state: 'available', id: 'quest-available', size: 'minimapQuestCompact' },
    { state: 'ready', id: 'quest-ready', size: 'minimapQuestCompact' },
    { state: 'repeat', id: 'quest-repeat', size: 'minimapQuestCompact' },
    {
      state: 'cooldown',
      id: 'quest-cooldown',
      size: 'minimapQuestCooldownCompact',
    },
  ] as const)('uses the larger compact $state raster', ({ state, id, size }) => {
    const markerArt = fakeMarkerArt([id]);
    const trace = newTrace();
    installGlyphGlobals(trace);
    const markerProfile = vi.fn(() => 'compact' as const);

    paint(
      newPainter(markerArt.art, markerProfile),
      fakeMinimapContext(trace),
      glyphWorld([{ x: 4, z: 98.5, quest: true }], state),
    );

    expect(markerProfile).toHaveBeenCalledTimes(1);
    expect(markerArt.calls.filter((call) => call.id.startsWith('quest-'))).toEqual([{ id, size }]);
    expect(trace.markerBlits[0]).toMatchObject({
      sprite: { markerId: id, sizeId: size },
      dx: Math.round(74.2 - MAP_MARKER_SIZES[size] / 2),
      dy: Math.round(83.55 - MAP_MARKER_SIZES[size] / 2),
      alpha: 1,
    });
  });

  it('keeps cooldown art at the caller alpha and never mutates the context', () => {
    const markerArt = fakeMarkerArt(['quest-cooldown']);
    const trace = newTrace();
    installGlyphGlobals(trace);
    const ctx = fakeMinimapContext(trace);
    ctx.globalAlpha = 0.73;

    paint(newPainter(markerArt.art), ctx, glyphWorld([{ x: 4, z: 98.5, quest: true }], 'cooldown'));

    expect(trace.markerBlits[0].alpha).toBe(0.73);
    expect(ctx.globalAlpha).toBe(0.73);
  });

  it('draws a quiet hollow ring for a non-actionable NPC without loading quest art', () => {
    const markerArt = fakeMarkerArt([
      'quest-available',
      'quest-ready',
      'quest-repeat',
      'quest-cooldown',
    ]);
    const trace = newTrace();
    installGlyphGlobals(trace);

    paint(
      newPainter(markerArt.art),
      fakeMinimapContext(trace),
      glyphWorld([{ x: 6, z: 100, quest: false }], 'ready'),
    );

    expect(markerArt.calls.filter((call) => call.id.startsWith('quest-'))).toEqual([]);
    expect(trace.markerBlits).toEqual([]);
    expect(
      trace.strokedArcs.filter((arc) => arc.x === 70.8 && arc.y === 81).map((arc) => arc.radius),
    ).toEqual([3, 3]);
    expect(trace.minimapTextCalls).toBe(0);
    expect(trace.minimapFontWrites).toBe(0);
  });

  it.each([
    {
      state: 'available',
      commands: ['moveTo', 'lineTo'],
      ink: 'quest-a',
      outlineWidth: 3,
      inkWidth: 1.25,
    },
    {
      state: 'ready',
      commands: ['arc', 'lineTo'],
      ink: 'quest-a',
      outlineWidth: 3,
      inkWidth: 1.25,
    },
    {
      state: 'repeat',
      commands: [
        'moveTo',
        'lineTo',
        'moveTo',
        'lineTo',
        'lineTo',
        'moveTo',
        'lineTo',
        'moveTo',
        'lineTo',
      ],
      ink: 'paint:--color-minimap-npc-quest-repeat',
      outlineWidth: 3,
      inkWidth: 1.25,
    },
    {
      state: 'cooldown',
      commands: ['moveTo', 'lineTo', 'lineTo', 'lineTo'],
      ink: 'paint:--color-minimap-gather-cooldown',
      outlineWidth: 3 * (16 / 20),
      inkWidth: 1,
    },
  ] as const)(
    'uses a distinct allocation-free $state fallback with no canvas text API',
    ({ state, commands, ink, outlineWidth, inkWidth }) => {
      const markerArt = fakeMarkerArt([]);
      const trace = newTrace();
      installGlyphGlobals(trace);

      paint(
        newPainter(markerArt.art),
        fakeMinimapContext(trace),
        glyphWorld([{ x: 4, z: 98.5, quest: true }], state),
      );

      expect(markerArt.calls.filter((call) => call.id.startsWith('quest-'))).toEqual([
        {
          id: `quest-${state}`,
          size: state === 'cooldown' ? 'minimapQuestCooldown' : 'minimapQuest',
        },
      ]);
      expect(trace.markerBlits).toEqual([]);
      expect(trace.minimapTextCalls).toBe(0);
      expect(trace.minimapFontWrites).toBe(0);
      expect(trace.segments.length + trace.strokedArcs.length).toBeGreaterThan(0);
      expect(
        trace.strokedPaths.filter(
          (path) => path.strokeStyle === ink && path.lineWidth === inkWidth,
        ),
      ).toEqual([{ commands: [...commands], strokeStyle: ink, lineWidth: inkWidth }]);
      expect(trace.strokedPaths).toContainEqual({
        commands: [...commands],
        strokeStyle: 'paint:--color-minimap-outline',
        lineWidth: outlineWidth,
      });
    },
  );

  it('keeps all four loading fallbacks pairwise shape-distinct through the real quest classifier', () => {
    const traces = new Map<string, string>();
    for (const state of ['available', 'ready', 'repeat', 'cooldown'] as const) {
      const markerArt = fakeMarkerArt([]);
      const trace = newTrace();
      installGlyphGlobals(trace);
      paint(
        newPainter(markerArt.art),
        fakeMinimapContext(trace),
        glyphWorld([{ x: 4, z: 98.5, quest: true }], state),
      );
      traces.set(
        state,
        JSON.stringify({
          segments: trace.segments,
          filledArcs: trace.filledArcs,
          strokedArcs: trace.strokedArcs,
        }),
      );
      vi.unstubAllGlobals();
    }

    expect(new Set(traces.values()).size).toBe(4);
    const states = [...traces.keys()];
    for (let left = 0; left < states.length; left++) {
      for (let right = left + 1; right < states.length; right++) {
        expect(traces.get(states[left]), `${states[left]} versus ${states[right]}`).not.toBe(
          traces.get(states[right]),
        );
      }
    }
  });

  it('uses the same compact art routing on the Protect Yumi surface', () => {
    const markerArt = fakeMarkerArt(['quest-ready']);
    const trace = newTrace();
    installGlyphGlobals(trace);
    const profile = vi.fn(() => 'compact' as const);
    const world = glyphWorld([{ x: YUMI_BAND_X_MIN + 4, z: 98.5, quest: true }], 'ready');
    (world.player as { pos: { x: number } }).pos.x = YUMI_BAND_X_MIN;

    paintMaze(newPainter(markerArt.art, profile), fakeMinimapContext(trace), world);

    expect(profile).toHaveBeenCalledTimes(1);
    expect(markerArt.calls).toEqual([{ id: 'quest-ready', size: 'minimapQuestCompact' }]);
    expect(trace.markerBlits[0].sprite).toEqual({
      markerId: 'quest-ready',
      sizeId: 'minimapQuestCompact',
    });
  });

  it('keeps every text entry point and profile lookup out of the per-marker loop', () => {
    const drawMarkersBody = sliceFrom(code, 'private drawMarkers(');
    expect(drawMarkersBody).not.toContain('fillText');
    expect(drawMarkersBody).not.toContain('strokeText');
    expect(drawMarkersBody).not.toContain('measureText');
    expect(drawMarkersBody).not.toContain('ctx.font');
    expect(drawMarkersBody).not.toContain('markerProfile()');
  });
});

// ---------------------------------------------------------------------------
// Thornhollow Fields: the ordinary ally dot must NOT track the enemy team.
//
// paintBattleground reuses the ordinary overworld marker set (markers.build),
// so the friend/guild dot the open world draws for anyone on your friends or
// guild list follows you into a rated 5v5. A guildmate drawn on the ENEMY side
// is a live through-wall position feed one team has and the other does not,
// which is the graphics/interface fairness invariant read straight. The filter
// lives in the PURE CORE, so it is asserted there (marker counts), plus the
// routing pin that the bg surface really does draw that same model.

const BG_ORIGIN = battlegroundOrigin(0);
const BG_S = 162;
const BG_PX_PER_YARD = 1.7;
/** Marker x for a body `dxYards` map-east of the viewer (build negates +X). */
const bgMarkerX = (dxYards: number): number => BG_S / 2 - dxYards * BG_PX_PER_YARD;

const bgRosterPlayer = (over: Partial<BgPlayerInfo>): BgPlayerInfo => ({
  pid: 0,
  name: '',
  cls: 'warrior',
  team: 0,
  carrying: false,
  dead: false,
  kills: 0,
  deaths: 0,
  captures: 0,
  assists: 0,
  ...over,
});

/**
 * A viewer standing in the field with two nearby non-party players, BOTH on the
 * viewer's friends list: `Foe` 6yd map-east, `Mate` 6yd map-west. `match` null
 * models the same pair met in the open world (the control arm).
 */
function bgAllyWorld(opts: { match: BgMatchInfo | null; partyPids?: number[] }): IWorld {
  const player = {
    id: 1,
    kind: 'player',
    name: 'Me',
    pos: { x: BG_ORIGIN.x, z: BG_ORIGIN.z },
    facing: 0,
  };
  const other = (id: number, name: string, dx: number) => ({
    id,
    kind: 'player',
    name,
    dead: false,
    lootable: false,
    aggroTargetId: null,
    templateId: '',
    questIds: [],
    pos: { x: BG_ORIGIN.x + dx, z: BG_ORIGIN.z },
  });
  const entities = new Map<number, unknown>([
    [1, player],
    [2, other(2, 'Foe', 6)],
    [3, other(3, 'Mate', -6)],
  ]);
  const partyPids = opts.partyPids ?? [];
  return {
    player,
    entities,
    // Match by PID: both are on the friends list under their real names, so a
    // name-keyed filter would pass this test while still leaking.
    socialInfo: {
      friends: [
        { name: 'Foe', online: true },
        { name: 'Mate', online: true },
      ],
      guild: null,
    },
    partyInfo: partyPids.length
      ? {
          members: partyPids.map((pid) => ({
            pid,
            cls: 'warrior',
            x: BG_ORIGIN.x + (pid === 2 ? 6 : -6),
            z: BG_ORIGIN.z,
            dead: 0,
          })),
        }
      : null,
    bgInfo: opts.match ? { match: opts.match } : null,
    delveRun: null,
    riftFloor: null,
    cfg: { seed: 42, playerClass: 'warrior' },
    playerId: 1,
    inventory: [],
    stationPlacements: [],
    nodeHarvestableByMe: () => false,
    questState: () => 'unavailable',
  } as unknown as IWorld;
}

/** A live match: me + Mate on team 0 (mine), Foe on team 1. */
const bgSplitMatch = (over: Partial<BgMatchInfo> = {}): BgMatchInfo =>
  ({
    state: 'active',
    myTeam: 0,
    capsToWin: 3,
    scores: [0, 0],
    flags: [
      { state: 'home', carrierPid: null, carrierName: null, carrierTeam: null },
      { state: 'home', carrierPid: null, carrierName: null, carrierTeam: null },
    ],
    players: [
      bgRosterPlayer({ pid: 1, name: 'Me', team: 0 }),
      bgRosterPlayer({ pid: 3, name: 'Mate', team: 0 }),
      bgRosterPlayer({ pid: 2, name: 'Foe', team: 1 }),
    ],
    countdown: 0,
    timeLeft: 300,
    waveIn: [10, 10],
    respawnIn: 0,
    winner: null,
    ...over,
  }) as BgMatchInfo;

function bgMarkers(world: IWorld) {
  return createMinimapMarkers().build(world, BG_S, BG_PX_PER_YARD).markers;
}

describe('minimap markers: a battleground never tracks the enemy team', () => {
  it('draws NO ally dot for a friend seated on the enemy roster, and keeps the same-team one', () => {
    const markers = bgMarkers(bgAllyWorld({ match: bgSplitMatch() }));
    const allies = markers.filter((m) => m.kind === 'ally');
    // The positive arm and the negative arm in one assertion: exactly one dot,
    // and it is the WEST body (Mate, my team). A filter that dropped both, or
    // that kept the wrong one, fails here.
    expect(allies).toHaveLength(1);
    expect(allies[0]).toMatchObject({ mx: bgMarkerX(-6) });
    expect(allies.some((m) => m.mx === bgMarkerX(6))).toBe(false);
  });

  it('still draws BOTH dots for the same pair met outside a match (not vacuous)', () => {
    // Without this arm the test above passes just as well against a core that
    // stopped emitting ally markers at all.
    const allies = bgMarkers(bgAllyWorld({ match: null })).filter((m) => m.kind === 'ally');
    expect(allies).toHaveLength(2);
    expect(allies.map((m) => m.mx).sort((a, b) => a - b)).toEqual(
      [bgMarkerX(6), bgMarkerX(-6)].sort((a, b) => a - b),
    );
  });

  it('drops the party disc for an enemy-team pid too (the cross-team party path)', () => {
    const inMatch = bgMarkers(bgAllyWorld({ match: bgSplitMatch(), partyPids: [2, 3] }));
    const discs = inMatch.filter((m) => m.kind === 'party-disc' || m.kind === 'party-arrow');
    expect(discs).toHaveLength(1);
    expect(discs[0]).toMatchObject({ mx: bgMarkerX(-6) });
    // Same party outside a match: both members keep their discs.
    const outside = bgMarkers(bgAllyWorld({ match: null, partyPids: [2, 3] }));
    expect(outside.filter((m) => m.kind === 'party-disc')).toHaveLength(2);
  });

  it('suppresses by PID, not by name: an enemy who renames onto the friends list stays dark', () => {
    // The roster carries the pid; the entity carries the name. Ship a roster
    // whose enemy row has a DIFFERENT name from the entity (a rename mid-match,
    // or an impostor): the dot must still be suppressed, which only holds if the
    // filter reads pids.
    const renamed = bgSplitMatch({
      players: [
        bgRosterPlayer({ pid: 1, name: 'Me', team: 0 }),
        bgRosterPlayer({ pid: 3, name: 'Mate', team: 0 }),
        bgRosterPlayer({ pid: 2, name: 'SomeoneElse', team: 1 }),
      ],
    });
    const allies = bgMarkers(bgAllyWorld({ match: renamed })).filter((m) => m.kind === 'ally');
    expect(allies).toHaveLength(1);
    expect(allies[0]).toMatchObject({ mx: bgMarkerX(-6) });
  });

  it('paints the battleground surface from that same filtered model', () => {
    // (the raster itself is driven end to end in the section below)
    // The core-level arms above only protect the bg surface because
    // paintBattleground builds its markers through the same core (it does not
    // keep a second marker path of its own).
    const body = sliceFrom(code, 'paintBattleground(', 'private ');
    expect(body).toContain('this.markers.build(');
    expect(body).toContain('this.drawMarkers(');
  });
});

// ---------------------------------------------------------------------------
// Thornhollow Fields: the session-cached raster is the ATLAS plate.
//
// The raster is built ONCE per session and blitted forever after, so nothing at
// runtime would notice it drifting, and no source-text pin can say what it
// actually paints. These arms drive the real painter through the public entry
// with a player standing in the band, capture the offscreen build, and assert
// the three layers by behaviour: the shared atlas GROUND (with the graveyard
// plots reading as their own surface family rather than as a flat overlay), the
// shared atlas MARKS baked over it, and the wall plan over both.

/** One recorded draw into the offscreen battleground raster. */
interface RasterOp {
  op: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
  alpha: number;
}

interface RasterTrace {
  /** Every offscreen canvas the painter minted, in creation order. */
  canvases: Array<{ width: number; height: number }>;
  ops: RasterOp[];
  /** The ImageData the ground layer was written into, as put. */
  ground: Uint8ClampedArray | null;
  groundW: number;
}

function fakeRasterCanvas(trace: RasterTrace): unknown {
  const canvas = { width: 0, height: 0 };
  trace.canvases.push(canvas);
  let tx = 0;
  let ty = 0;
  const bctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    save: (): void => {},
    restore: (): void => {},
    translate: (x: number, y: number): void => {
      tx = x;
      ty = y;
    },
    rotate: (): void => {},
    beginPath: (): void => {},
    fill: (): void => {},
    arc: (x: number, y: number, r: number): void => {
      trace.ops.push({
        op: 'arc',
        x,
        y,
        w: r,
        h: r,
        fill: bctx.fillStyle,
        alpha: bctx.globalAlpha,
      });
    },
    // The walls are the only fillRects, and each is drawn under its own
    // translate + yaw, so fold the translate back in to get plate coordinates.
    fillRect: (x: number, y: number, w: number, h: number): void => {
      trace.ops.push({
        op: 'fillRect',
        x: tx + x,
        y: ty + y,
        w,
        h,
        fill: bctx.fillStyle,
        alpha: bctx.globalAlpha,
      });
    },
    createImageData: (w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
      width: w,
      height: h,
    }),
    putImageData: (
      image: { data: Uint8ClampedArray; width: number },
      x: number,
      y: number,
    ): void => {
      trace.ground = image.data;
      trace.groundW = image.width;
      trace.ops.push({ op: 'putImageData', x, y, w: 0, h: 0, fill: '', alpha: 1 });
    },
    fillText: (): void => {
      trace.ops.push({ op: 'fillText', x: 0, y: 0, w: 0, h: 0, fill: '', alpha: 1 });
    },
    strokeText: (): void => {
      trace.ops.push({ op: 'strokeText', x: 0, y: 0, w: 0, h: 0, fill: '', alpha: 1 });
    },
    measureText: (text: string) => ({ width: text.length }),
  };
  return {
    get width(): number {
      return canvas.width;
    },
    set width(v: number) {
      canvas.width = v;
    },
    get height(): number {
      return canvas.height;
    },
    set height(v: number) {
      canvas.height = v;
    },
    getContext: (kind: string): unknown => (kind === '2d' ? bctx : null),
  };
}

function newRasterTrace(): RasterTrace {
  return { canvases: [], ops: [], ground: null, groundW: 0 };
}

function installRasterGlobals(trace: RasterTrace): void {
  vi.stubGlobal('document', {
    documentElement: {},
    createElement(tag: string): unknown {
      if (tag !== 'canvas') throw new Error(`unexpected createElement(${tag})`);
      return fakeRasterCanvas(trace);
    },
  });
  vi.stubGlobal('getComputedStyle', () => ({
    getPropertyValue: (token: string) => `paint:${token}`,
  }));
}

/** The painter's own source constants, so the pins move with a retune instead
 *  of silently going stale. */
function sourceConstant(name: string): number {
  const m = code.match(new RegExp(`const ${name} = ([0-9.]+);`));
  if (!m) throw new Error(`minimap_painter.ts no longer defines ${name}`);
  return Number(m[1]);
}

const RASTER_PX_PER_YARD = sourceConstant('BG_FIELD_PX_PER_YARD');
const RASTER_PAD_X = BG_HALF_X + sourceConstant('MAZE_BG_MARGIN_YD');
const RASTER_PAD_Z = BG_HALF_Z + sourceConstant('MAZE_BG_MARGIN_YD');
/** Field-local yards to raster pixels: +X map-left, +Z map-up, the projection
 *  the sub-rect blit reads the sheet back out with. */
const rasterX = (x: number): number => (RASTER_PAD_X - x) * RASTER_PX_PER_YARD;
const rasterZ = (z: number): number => (RASTER_PAD_Z - z) * RASTER_PX_PER_YARD;

/** Paint the battleground surface through the PUBLIC entry (a player standing
 *  in the band routes paintOverworld to the battleground branch). */
function paintBg(p: MinimapPainter, ctx: CanvasRenderingContext2D, world: IWorld): void {
  p.paintOverworld(ctx, world, {} as HTMLElement, {} as HTMLCanvasElement, 1);
}

/** The rgb of the ground pixel covering a field-local point. */
function groundRgb(trace: RasterTrace, x: number, z: number): number[] {
  const data = trace.ground;
  if (!data) throw new Error('the raster wrote no ground layer');
  const ix = Math.floor(rasterX(x));
  const iy = Math.floor(rasterZ(z));
  const k = (iy * trace.groundW + ix) * 4;
  return [data[k], data[k + 1], data[k + 2], data[k + 3]];
}

describe('minimap_painter: the battleground raster bakes the shared atlas plate', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds it ONCE per session, at the pinned sheet size', () => {
    const trace = newRasterTrace();
    installRasterGlobals(trace);
    const ctx = fakeMinimapContext(newTrace());
    const p = newPainter();
    const world = bgAllyWorld({ match: null });

    paintBg(p, ctx, world);
    paintBg(p, ctx, world);

    // One canvas for the whole session: the second redraw is blit + markers,
    // which is the entire point of a raster this expensive to build.
    expect(trace.canvases).toHaveLength(1);
    expect(trace.canvases[0].width).toBe(Math.ceil(RASTER_PAD_X * 2 * RASTER_PX_PER_YARD));
    expect(trace.canvases[0].height).toBe(Math.ceil(RASTER_PAD_Z * 2 * RASTER_PX_PER_YARD));
    // and the ground really is the full sheet, laid at the origin.
    const put = trace.ops.filter((o) => o.op === 'putImageData');
    expect(put).toHaveLength(1);
    expect([put[0].x, put[0].y]).toEqual([0, 0]);
    expect(trace.ground).toHaveLength(trace.canvases[0].width * trace.canvases[0].height * 4);
  });

  it('lays the ATLAS ground, with the graveyard plots as their own surface family', () => {
    // The decisive difference from the flat hypsometric wash this replaced. That
    // wash was a sand ramp, warm everywhere (r > g > b) and blind to what the
    // ground IS; the atlas takes its base color from the authored paint, so the
    // field chamber must read GREEN (g > r, which the wash could never produce)
    // and the graveyard plot must read as turned earth, warm and distinctly
    // apart from the turf beside it, rather than as a flat rectangle laid over a
    // finished raster.
    const trace = newRasterTrace();
    installRasterGlobals(trace);
    paintBg(newPainter(), fakeMinimapContext(newTrace()), bgAllyWorld({ match: null }));

    const plot = TH_GRAVEYARDS[0];
    expect(bgFieldSurfaceAt(plot.x, plot.z)).toBe(BG_SURFACE_GRAVE);
    expect(bgFieldSurfaceAt(0, -82)).toBe(BG_SURFACE_GRASS);
    const turf = groundRgb(trace, 0, -82);
    const grave = groundRgb(trace, plot.x, plot.z);
    expect(turf[3], 'the sheet is opaque, or it blits as a hole').toBe(255);
    expect(grave[3]).toBe(255);
    expect(turf[1] - turf[0], 'the field chamber does not read as turf').toBeGreaterThan(3);
    expect(grave[0] - grave[1], 'the plot does not read as turned earth').toBeGreaterThan(5);
    // Ground, not an overlay: the plot is textured (the mottle every other
    // surface family gets), so a window over it is not one flat color.
    const tones = new Set<string>();
    for (let dx = -3; dx <= 3; dx++) {
      for (let dz = -3; dz <= 3; dz++) {
        const rgb = groundRgb(trace, plot.x + dx * 0.4, plot.z + dz * 0.4);
        tones.add(`${rgb[0]},${rgb[1]},${rgb[2]}`);
      }
    }
    expect(tones.size, 'the plot is a flat fill, not painted ground').toBeGreaterThan(10);
  });

  it('bakes every atlas mark, then draws the wall plan OVER them', () => {
    const trace = newRasterTrace();
    installRasterGlobals(trace);
    paintBg(newPainter(), fakeMinimapContext(newTrace()), bgAllyWorld({ match: null }));

    // The marks are the shared routine's, so every headstone the pure core
    // emits lands as a drawn mark at its own projected position. Headstones are
    // the decisive kind: they are what says the grave ground is a graveyard.
    const arcs = trace.ops.filter((o) => o.op === 'arc');
    const stones = bgAtlasMarks().filter((mark) => mark.kind === 'headstone');
    expect(stones.length).toBeGreaterThan(0);
    for (const stone of stones) {
      const sx = rasterX(stone.x);
      const sy = rasterZ(stone.z);
      expect(
        arcs.some((a) => Math.hypot(a.x - sx, a.y - sy) < 1),
        `no headstone baked for the stone at (${stone.x}, ${stone.z})`,
      ).toBe(true);
    }
    // Crowns and boulders too, so this is the whole mark set and not one kind.
    expect(arcs.length).toBeGreaterThan(bgAtlasMarks().length);

    // WALLS ARE COVER, so they go on last and they go on strong: every real box
    // collider, in the resolved outline token, at an alpha that may only rise
    // from the 0.85 it carried over the old pale wash (the atlas ground is
    // darker, so an unchanged alpha would have cost the one actionable layer on
    // this sheet contrast it used to have).
    const walls = trace.ops.filter((o) => o.op === 'fillRect');
    expect(walls).toHaveLength(bgFieldPlanWalls().length);
    const alpha = sourceConstant('BG_FIELD_WALL_ALPHA');
    expect(alpha).toBeGreaterThanOrEqual(0.85);
    for (const wall of walls) {
      expect(wall.fill).toBe('paint:--color-minimap-outline');
      expect(wall.alpha).toBe(alpha);
    }
    const lastMark = trace.ops.map((o) => o.op).lastIndexOf('arc');
    const firstWall = trace.ops.map((o) => o.op).indexOf('fillRect');
    expect(firstWall, 'a wall is drawn under the atlas marks').toBeGreaterThan(lastMark);
    // and no landmark label is baked into the sheet (see the header: at this
    // scale a name is a few pixels tall and the blit is a moving sub-rect).
    expect(trace.ops.filter((o) => o.op === 'fillText' || o.op === 'strokeText')).toEqual([]);
  });
});
