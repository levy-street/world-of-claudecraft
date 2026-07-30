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
import { QUESTS, YUMI_BAND_X_MIN } from '../src/sim/data';
import { isQuestTurnInNpc } from '../src/sim/types';
import { MinimapPainter } from '../src/ui/minimap_painter';
import type { IWorld } from '../src/world_api';

const painter = readFileSync(new URL('../src/ui/minimap_painter.ts', import.meta.url), 'utf8');
// Drop comments so prose can't create a false positive (mirrors architecture.test).
const code = painter.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
const tokens = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');

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
    // The minimap stays gated on the fast band, NOT every frame (graphics tiering may later throttle it).
    expect(hud).toContain('const fastHud = now - this.lastHudFastAt >= 100;');
    expect(hud).toContain('this.updateMinimap();');
  });

  it("routes the '#zone-label' text through the elided setText (the one DOM write)", () => {
    expect(code).toContain('this.writers.setText(zoneLabelEl');
  });
});

// ---------------------------------------------------------------------------
// NPC glyph sprite cache, driven through a fake 2D context.
//
// Every canvas text entry point (the ctx.font setter, fillText, measureText) re-resolves
// font state against the document, so a per-marker fillText loop costs in proportion to
// how dirty the style tree is. The glyph rasterizes ONCE into a per-(glyph, color) sprite
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

/** A fake offscreen canvas standing in for a glyph sprite. */
interface FakeSprite {
  width: number;
  height: number;
  ink: SpriteInk[];
  getContext(kind: string): unknown;
}

interface GlyphTrace {
  /** Every 3-argument `drawImage` (the glyph blits; the terrain blit takes 9). */
  blits: Array<{ sprite: FakeSprite; dx: number; dy: number }>;
  /** Every canvas created through `document.createElement('canvas')`. */
  sprites: FakeSprite[];
  /** Any text drawn straight onto the MINIMAP context (must stay zero). */
  minimapTextCalls: number;
  /** Any `ctx.font` assignment on the MINIMAP context (must stay zero). */
  minimapFontWrites: number;
  color: string;
}

const NPC_QUEST_TOKEN = '--color-minimap-npc-quest';
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
  const sctx = {
    font: '',
    fillStyle: '',
    // globalAlpha + fillRect are what ensureMazeBg draws its wall slabs with; the glyph
    // sprite itself only ever needs font/fillStyle/fillText.
    globalAlpha: 1,
    fillRect(): void {},
    fillText(glyph: string, x: number, y: number): void {
      ink.push({ glyph, x, y, font: sctx.font, fillStyle: sctx.fillStyle });
    },
  };
  const sprite: FakeSprite = {
    width: 0,
    height: 0,
    ink,
    getContext: (kind: string) => (kind === '2d' ? sctx : null),
  };
  trace.sprites.push(sprite);
  return sprite;
}

function installGlyphGlobals(trace: GlyphTrace, spriteContext = true): void {
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
    getPropertyValue: (token: string) =>
      token === NPC_QUEST_TOKEN ? trace.color : `paint:${token}`,
  }));
}

function newTrace(): GlyphTrace {
  return { blits: [], sprites: [], minimapTextCalls: 0, minimapFontWrites: 0, color: 'quest-a' };
}

function fakeMinimapContext(trace: GlyphTrace): CanvasRenderingContext2D {
  let font = '';
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
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
      // The 3-argument form is a glyph sprite; the terrain sub-rect blit passes 9.
      if (rest.length === 2) {
        trace.blits.push({ sprite: image as FakeSprite, dx: rest[0], dy: rest[1] });
      }
    },
    clearRect(): void {},
    save(): void {},
    restore(): void {},
    beginPath(): void {},
    closePath(): void {},
    clip(): void {},
    arc(): void {},
    moveTo(): void {},
    lineTo(): void {},
    fill(): void {},
    stroke(): void {},
    fillRect(): void {},
    translate(): void {},
    rotate(): void {},
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

// The player sits at an overworld position with no gather node or station in the rim.
const PLAYER_POS = { x: 0, z: 100 };

/** `npcs` are world positions; `state` drives which glyph each quest-giver resolves to. */
function glyphWorld(
  npcs: Array<{ x: number; z: number; quest: boolean }>,
  state: 'available' | 'ready',
): IWorld {
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
      templateId: npc.quest ? READY_QUEST.giverNpcId : '',
      questIds: npc.quest ? [READY_QUEST.id] : [],
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
    questState: (q: string) => (q === READY_QUEST.id ? state : 'unavailable'),
  } as unknown as IWorld;
}

function newPainter(): MinimapPainter {
  return new MinimapPainter(
    { setText: () => {} } as never,
    () => 'cls-color',
    (zoneId: string) => zoneId,
    (name: string, rank: string | null) => (rank ? `${name} ${rank}` : name),
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

describe('minimap_painter: NPC glyphs draw from the sprite cache, never per-marker fillText', () => {
  it('blits the sprite on the inline anchor, rounded to a whole pixel', () => {
    const trace = newTrace();
    installGlyphGlobals(trace);
    const ctx = fakeMinimapContext(trace);
    // x = 4 yards map-left, z = 1.5 yards up, at the base scale 1.7 px/yard:
    //   mx = 81 - 4 * 1.7      = 74.2  -> 74.2 - 2 (offset) - 2 (sprite origin) = 70.2
    //   my = 81 + 1.5 * 1.7    = 83.55 -> 83.55 + 3 (offset) - 12 (baseline)    = 74.55
    // Both fractional, so this fails if the destination stops being rounded, and every
    // component is distinct so it also fails on a flipped sign or swapped axis.
    paint(newPainter(), ctx, glyphWorld([{ x: 4, z: 98.5, quest: true }], 'ready'));

    expect(trace.blits).toHaveLength(1);
    expect(trace.blits[0].dx).toBe(70);
    expect(trace.blits[0].dy).toBe(75);
    expect(Number.isInteger(trace.blits[0].dx)).toBe(true);
    expect(Number.isInteger(trace.blits[0].dy)).toBe(true);
  });

  it('never touches the minimap context text API while drawing markers', () => {
    const trace = newTrace();
    installGlyphGlobals(trace);
    const ctx = fakeMinimapContext(trace);
    paint(
      newPainter(),
      ctx,
      glyphWorld(
        [
          { x: 4, z: 98.5, quest: true },
          { x: -3, z: 101, quest: true },
          { x: 6, z: 100, quest: false },
        ],
        'ready',
      ),
    );

    expect(trace.blits).toHaveLength(3);
    expect(trace.minimapTextCalls).toBe(0);
    expect(trace.minimapFontWrites).toBe(0);
  });

  it('rasterizes each glyph once at the pinned font and reuses it across markers and redraws', () => {
    const trace = newTrace();
    installGlyphGlobals(trace);
    const ctx = fakeMinimapContext(trace);
    const p = newPainter();
    const world = glyphWorld(
      [
        { x: 4, z: 98.5, quest: true },
        { x: -3, z: 101, quest: true },
      ],
      'ready',
    );

    paint(p, ctx, world);
    paint(p, ctx, world);

    // Two markers over two redraws: four blits, but the glyph rasterizes ONCE. Without
    // this the change silently stops working and costs more than the fillText it replaced.
    expect(trace.blits).toHaveLength(4);
    expect(trace.sprites).toHaveLength(1);
    expect(trace.blits.every((b) => b.sprite === trace.sprites[0])).toBe(true);

    const sprite = trace.sprites[0];
    expect(sprite.width).toBe(16);
    expect(sprite.height).toBe(16);
    expect(sprite.ink).toEqual([
      { glyph: '?', x: 2, y: 12, font: 'bold 11px Georgia', fillStyle: 'quest-a' },
    ]);
  });

  it('gives each glyph its own sprite', () => {
    const trace = newTrace();
    installGlyphGlobals(trace);
    const ctx = fakeMinimapContext(trace);

    paint(
      newPainter(),
      ctx,
      glyphWorld(
        [
          { x: 4, z: 98.5, quest: true },
          { x: 6, z: 100, quest: false },
        ],
        'ready',
      ),
    );

    expect(trace.sprites.map((s) => s.ink[0].glyph)).toEqual(['?', '•']);
    expect(trace.blits[0].sprite).not.toBe(trace.blits[1].sprite);
  });

  it('re-rasterizes when the resolved quest color changes (the cache key carries it)', () => {
    const trace = newTrace();
    installGlyphGlobals(trace);
    const ctx = fakeMinimapContext(trace);
    const p = newPainter();
    const world = glyphWorld([{ x: 4, z: 98.5, quest: true }], 'ready');

    paint(p, ctx, world);
    // Simulate the theme / contrast cache bust the color cache documents: drop the
    // resolved colors and resolve a different quest color on the next redraw.
    trace.color = 'quest-b';
    (p as unknown as { colors: unknown }).colors = null;
    paint(p, ctx, world);

    expect(trace.sprites).toHaveLength(2);
    expect(trace.sprites.map((s) => s.ink[0].fillStyle)).toEqual(['quest-a', 'quest-b']);
    expect(trace.blits[1].sprite).toBe(trace.sprites[1]);
  });

  it('does not cache a sprite whose 2D context failed', () => {
    const trace = newTrace();
    installGlyphGlobals(trace, false);
    const ctx = fakeMinimapContext(trace);
    const p = newPainter();
    const world = glyphWorld([{ x: 4, z: 98.5, quest: true }], 'ready');

    paint(p, ctx, world);
    paint(p, ctx, world);

    // Caching the blank canvas would hide every NPC glyph for the rest of the session;
    // both sibling caches in this file (ensureMazeBg, resolveColors) refuse it too.
    expect(trace.sprites).toHaveLength(2);
    expect(trace.sprites[0].ink).toEqual([]);
  });

  it('does not cache a sprite rasterized before the tokens resolved', () => {
    const trace = newTrace();
    // A redraw before the stylesheet applies: every token reads ''. resolveColors
    // deliberately refuses to freeze that, and the glyph cache must refuse it too, or
    // three default-black sprites stay resident for the rest of the session.
    trace.color = '';
    installGlyphGlobals(trace);
    const ctx = fakeMinimapContext(trace);
    const p = newPainter();
    const world = glyphWorld([{ x: 4, z: 98.5, quest: true }], 'ready');

    paint(p, ctx, world);
    paint(p, ctx, world);

    expect(trace.sprites).toHaveLength(2);
    // It still DRAWS on that redraw, exactly as the inline fillText did with an
    // unresolved fillStyle: rasterized, just never frozen.
    expect(trace.sprites[0].ink).toHaveLength(1);
    expect(trace.blits).toHaveLength(2);
  });

  it('applies the same rounded blit on the Protect Yumi arm', () => {
    const trace = newTrace();
    installGlyphGlobals(trace);
    const ctx = fakeMinimapContext(trace);
    // paintYumiMaze shares drawMarkers, so the maze arm must land the glyph on the same
    // rounded anchor. Marker projection is player-relative, so holding the npc at the
    // same offset keeps the expected destination. Its maze background canvas is built
    // first, hence the extra createElement in trace.sprites.
    const world = glyphWorld([{ x: YUMI_BAND_X_MIN + 4, z: 98.5, quest: true }], 'ready');
    (world.player as { pos: { x: number } }).pos.x = YUMI_BAND_X_MIN;
    paintMaze(newPainter(), ctx, world);

    expect(trace.blits).toHaveLength(1);
    expect(trace.blits[0].dx).toBe(70);
    expect(trace.blits[0].dy).toBe(75);
    expect(trace.minimapTextCalls).toBe(0);
    expect(trace.minimapFontWrites).toBe(0);
  });

  it('keeps fillText and ctx.font assignment out of the per-marker draw loop', () => {
    // Source-level companion to the behavior pin above: it covers EVERY marker branch,
    // not just the npc one the fake context exercises.
    const drawMarkersBody = sliceFrom(code, 'private drawMarkers(');
    expect(drawMarkersBody).not.toContain('fillText');
    expect(drawMarkersBody).not.toContain('ctx.font');
  });
});
