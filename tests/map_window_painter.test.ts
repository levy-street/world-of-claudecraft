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
import { MapWindowPainter } from '../src/ui/map_window_painter';
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
const tokens = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');

const MAP_COLOR_TOKENS = [
  '--color-map-ocean',
  '--color-map-label',
  '--color-map-outline',
  '--color-map-portal-dot',
  '--color-map-portal-label',
  '--color-map-npc-quest',
  '--color-map-player',
  '--color-map-ally-friend',
  '--color-map-ally-guild',
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
];

/** One label rasterized into its own offscreen canvas by the sprite cache. */
interface LabelSprite {
  width: number;
  height: number;
  /** Each text pass baked into this sprite, in order. The x/y are the sprite's
   *  own origin, which is what the blit destination subtracts. */
  ink: Array<{ op: 'fill' | 'stroke'; color: string; text: string; x: number; y: number }>;
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
  fills: Array<{ style: string; commands: string[]; at: number }>;
  styleReads: string[];
  /** Every canvas minted through document.createElement('canvas'). */
  sprites: LabelSprite[];
  /** Every 3-argument drawImage: the label blits (the terrain blit passes 9). */
  blits: Array<{ sprite: LabelSprite; dx: number; dy: number }>;
  /** Every canvas text entry point used on the MAP context, which must stay empty. */
  textApi: string[];
  /** Every stroke() on the map context with the stroke state it used. The width
   *  matters as much as the color: the badge block leaves 1.5 behind. */
  strokes: Array<{ style: string; lineWidth: number; commands: string[]; at: number }>;
}

function makeLabelSprite(trace: PaintTrace): LabelSprite {
  const ctx = {
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    textAlign: 'start',
    textBaseline: 'alphabetic',
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
    ink: [] as LabelSprite['ink'],
    getContext: (kind: string): unknown => (kind === '2d' ? (ctx as unknown) : null),
  } as unknown as LabelSprite;
  trace.sprites.push(sprite);
  return sprite;
}

function fakeMapContext(trace: PaintTrace): CanvasRenderingContext2D {
  let commands: string[] = [];
  let font = '';
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    textAlign: 'start',
    imageSmoothingEnabled: false,
    get font(): string {
      return font;
    },
    set font(value: string) {
      font = value;
      trace.textApi.push(`font=${value}`);
    },
    drawImage(image: unknown, ...rest: number[]): void {
      // The 3-argument form is a label sprite; the terrain sub-rect blit passes 9.
      if (rest.length === 2) {
        trace.blits.push({ sprite: image as LabelSprite, dx: rest[0], dy: rest[1] });
      }
    },
    // the painter floods the ocean before the zone bg blit; the fake context
    // must answer every call it makes, not only the path-building ones
    fillRect(): void {},
    beginPath(): void {
      commands = [];
    },
    arc(): void {
      commands.push('arc');
    },
    moveTo(): void {
      commands.push('moveTo');
    },
    lineTo(): void {
      commands.push('lineTo');
    },
    closePath(): void {
      commands.push('closePath');
    },
    fill(): void {
      trace.fills.push({ style: String(ctx.fillStyle), commands: [...commands], at: trace.seq++ });
    },
    stroke(): void {
      trace.strokes.push({
        style: String(ctx.strokeStyle),
        lineWidth: ctx.lineWidth,
        commands: [...commands],
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
  return { seq: 0, fills: [], styleReads: [], sprites: [], blits: [], textApi: [], strokes: [] };
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
    const painter = new MapWindowPainter();
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
    '!', // the quest-giver glyph for an available quest
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

describe('map_window_painter: labels blit from the sprite cache', () => {
  it('draws every label layer without touching the map context text API', () => {
    const trace = newTrace();
    installMapStyleGlobals(trace);
    setActiveWorldContent(BUILTIN_WORLD);
    const ctx = fakeMapContext(trace);

    new MapWindowPainter().paintOverworld(ctx, labelWorld(), labelPaintOptions());

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

    new MapWindowPainter().paintOverworld(fakeMapContext(trace), world, labelPaintOptions());

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
    // Quest-giver glyph: on the marker, which is what the hover hit-test
    // (npcMarkerAt, over the same mx/my) resolves against.
    expect(anchorOf('!')).toEqual(at(model.npcs[0].mx, model.npcs[0].my));
    // Dungeon name: 9px above its portal dot.
    expect(anchorOf(portalLabelText())).toEqual(at(model.portals[0].mx, model.portals[0].my - 9));
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

    new MapWindowPainter().paintOverworld(fakeMapContext(trace), labelWorld(), labelPaintOptions());

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

    new MapWindowPainter().paintOverworld(fakeMapContext(trace), labelWorld(), labelPaintOptions());

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
    const painter = new MapWindowPainter();
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

    const result = new MapWindowPainter().paintOverworld(ctx, labelWorld(), labelPaintOptions());

    const badges = result.questAreas.reduce((n, area) => n + area.numbers.length, 0);
    const expected =
      1 + // the zone title
      LABEL_ZONE.pois.length +
      overworldDungeonPortals(DUNGEON_LIST, LABEL_ZONE.zMin, LABEL_ZONE.zMax).length +
      result.npcs.length +
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

    new MapWindowPainter().paintOverworld(fakeMapContext(trace), labelWorld(), labelPaintOptions());

    // The model plots friends before guild members, so the dot fills follow.
    const allyDots = trace.fills
      .filter((fill) => fill.style.endsWith('ally-friend') || fill.style.endsWith('ally-guild'))
      .map(({ style, commands }) => ({ style, commands }));
    expect(allyDots).toEqual([
      { style: 'paint:--color-map-ally-friend', commands: ['arc'] },
      { style: 'paint:--color-map-ally-guild', commands: ['arc'] },
    ]);
  });

  it("draws the '?' glyph for a turn-in that is ready, with the same styling", () => {
    const trace = newTrace();
    installMapStyleGlobals(trace);
    setActiveWorldContent(BUILTIN_WORLD);

    new MapWindowPainter().paintOverworld(
      fakeMapContext(trace),
      readyGlyphWorld(),
      labelPaintOptions(),
    );

    const glyphs = trace.sprites.filter((sprite) => ['?', '!'].includes(spriteText(sprite)));
    expect(glyphs.map(spriteText)).toEqual(['?']);
    expect(glyphs[0].ink.map(inkStyle)).toEqual([
      { op: 'stroke', color: 'paint:--color-map-outline', text: '?' },
      { op: 'fill', color: 'paint:--color-map-npc-quest', text: '?' },
    ]);
  });

  it('opens each redraw on the cache, so the budget is enforced in the shipped path', () => {
    const trace = newTrace();
    installMapStyleGlobals(trace);
    setActiveWorldContent(BUILTIN_WORLD);
    const ctx = fakeMapContext(trace);
    const painter = new MapWindowPainter();
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
    const painter = new MapWindowPainter();
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
    const painter = new MapWindowPainter();
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
      installMapStyleGlobals(trace);
      setActiveWorldContent(BUILTIN_WORLD);

      const result = new MapWindowPainter().paintOverworld(
        fakeMapContext(trace),
        world,
        labelPaintOptions(),
      );

      const portals = overworldDungeonPortals(DUNGEON_LIST, LABEL_ZONE.zMin, LABEL_ZONE.zMax);
      expect(portals.length, arm).toBeGreaterThan(0);
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

    const result = new MapWindowPainter().paintOverworld(
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

    const result = new MapWindowPainter().paintOverworld(
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

    new MapWindowPainter().paintOverworld(
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
    // Neither may the quest-giver glyph, which now names its outline explicitly.
    const glyph = trace.sprites.find((s) => spriteText(s) === '!');
    expect(glyph?.ink.map(inkStyle)).toEqual([
      { op: 'stroke', color: 'paint:--color-map-outline', text: '!' },
      { op: 'fill', color: 'paint:--color-map-npc-quest', text: '!' },
    ]);
  });
});
