// Tests for the delve_map painter (the PainterHost seam pilot):
//  - the pure delveDrawModel: Sim-vs-ClientWorld parity + both-sites determinism,
//  - the no-magic-values canvas guard over the painter source,
//  - the WCAG-chrome boundary over the vendor window the host now composes.
//
// The write-elision facet (makeWriterFacet) is exercised in painter_host.test.ts
// (grew to six writers); this file keeps only the delve-specific path.
// Full pixel-level rendering of paintMinimapDelve / paintWorldMapDelve needs a
// real 2D context + getComputedStyle, so that end-to-end coverage lives in the
// opt-in tests/browser/delve_map_painter.browser.test.ts. This Node suite mostly
// drives the PURE path (delveDrawModel), the contract the per-frame painters lean
// on, plus one narrow behavioral pin (relocalize's cache-bust) over a hand-rolled
// fake 2D context, mirroring tests/map_window_painter.test.ts's fake-context idiom.

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { delveModuleZOffset } from '../src/sim/data';
import { DELVE_MODULE_LAYOUTS } from '../src/sim/delve_layout';
import { delveLocalToCanvas, delveSchematicStatic } from '../src/ui/hud/delve/delve_map';
import { DelveMapPainter, delveDrawModel } from '../src/ui/hud/delve/delve_map_painter';
import type { MapMarkerArt, MapMarkerArtId, MapMarkerSize } from '../src/ui/map_marker_icon_art';
import type { PainterHostWriters } from '../src/ui/painter_host';
import type { IWorld } from '../src/world_api';

// --- Pure draw model: Sim-vs-ClientWorld parity + both-sites determinism --------

const MODULE_ID = 'reliquary_sunken_ossuary';
const LAYOUT = DELVE_MODULE_LAYOUTS[MODULE_ID];
const ORIGIN = { x: 1000, z: 2000 };
const MODULE_Z = delveModuleZOffset([MODULE_ID], 0);
const DELVE_NAME = 'The Collapsed Reliquary';
const MODULE_NAME = 'The Sunken Ossuary';

// One scenario, expressed as plain data, so we can build two structurally-identical
// IWorld stubs (one "Sim-shaped", one "ClientWorld-mirror-shaped") and prove the
// painter reads only IWorld-declared fields.
const SCENARIO = {
  player: { id: 1, localX: 0, localZ: 20, facing: 0.5 },
  // 2 live mobs (one aggroed on the player), 1 dead mob + 1 NPC that must be dropped.
  entities: [
    { id: 2, kind: 'mob', dead: false, localX: 5, localZ: 25, aggro: true },
    { id: 3, kind: 'mob', dead: false, localX: -5, localZ: 15, aggro: false },
    { id: 4, kind: 'mob', dead: true, localX: 2, localZ: 22, aggro: false },
    { id: 5, kind: 'npc', dead: false, localX: -2, localZ: 18, aggro: false },
  ],
  // 1 alive + 1 dead party member, plus the local player (must be dropped).
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
    pos: { x: ORIGIN.x + p.localX, z: ORIGIN.z + MODULE_Z + p.localZ },
    facing: p.facing,
    aggroTargetId: null,
  };
  const entities = new Map<number, unknown>([[player.id, player]]);
  for (const e of SCENARIO.entities) {
    entities.set(e.id, {
      id: e.id,
      kind: e.kind,
      dead: e.dead,
      hostile: e.kind === 'mob',
      pos: { x: ORIGIN.x + e.localX, z: ORIGIN.z + MODULE_Z + e.localZ },
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
      z: ORIGIN.z + MODULE_Z + m.localZ,
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

const MINIMAP = { size: 162, pad: 8 };
const WORLDMAP = { size: 280, pad: Math.round(280 * 0.06) };

describe('delveDrawModel (pure draw model)', () => {
  it('drops dead mobs, NPCs, and the local player; keeps live mobs + party with flags', () => {
    const model = delveDrawModel(makeWorld(), MINIMAP.size, MINIMAP.pad, DELVE_NAME, MODULE_NAME);
    expect(model).not.toBeNull();
    if (!model) return;
    expect(model.areaLabel).toBe('The Collapsed Reliquary: The Sunken Ossuary');
    expect(model.layoutId).toBe(MODULE_ID);
    // mob 4 is dead, mob 5 is an NPC, the player is excluded -> only mobs 2 + 3.
    expect(model.mobs).toHaveLength(2);
    expect(model.mobs.map((m) => m.aggro)).toEqual([true, false]);
    // party self (pid 1) excluded -> the warrior (alive) + the mage (dead).
    expect(model.party).toHaveLength(2);
    expect(model.party.map((m) => m.dead)).toEqual([0, 1]);
    expect(model.party.map((m) => m.cls)).toEqual(['warrior', 'mage']);
    expect(model.player.kind).toBe('arrow');
  });

  it('returns null when the world is not in a delve', () => {
    const overworld = { delveRun: null } as unknown as IWorld;
    expect(
      delveDrawModel(overworld, MINIMAP.size, MINIMAP.pad, DELVE_NAME, MODULE_NAME),
    ).toBeNull();
  });

  it('positions every marker via the delve_map core (one source of truth)', () => {
    const model = delveDrawModel(makeWorld(), MINIMAP.size, MINIMAP.pad, DELVE_NAME, MODULE_NAME);
    if (!model) throw new Error('expected a model');
    // The static schematic is the core builder's output verbatim.
    expect(model.schematic).toEqual(delveSchematicStatic(LAYOUT, MINIMAP.size, MINIMAP.pad));
    // The first live mob's canvas position matches delveLocalToCanvas exactly.
    const first = SCENARIO.entities[0];
    const expected = delveLocalToCanvas(
      first.localX,
      first.localZ,
      LAYOUT,
      MINIMAP.size,
      MINIMAP.pad,
    );
    expect({ cx: model.mobs[0].cx, cy: model.mobs[0].cy }).toEqual(expected);
  });

  it('subtracts the active module stack origin for every live marker', () => {
    const world = makeWorld() as unknown as {
      player: { pos: { x: number; z: number } };
      entities: Map<number, { pos: { x: number; z: number } }>;
      partyInfo: { members: Array<{ pid: number; x: number; z: number }> };
      delveRun: {
        origin: { x: number; z: number };
        modules: string[];
        moduleIndex: number;
      };
    };
    world.delveRun.modules = ['reliquary_sunken_ossuary', 'reliquary_bell_niche'];
    world.delveRun.moduleIndex = 1;
    const zBase = delveModuleZOffset(world.delveRun.modules, world.delveRun.moduleIndex);
    world.player.pos.z = ORIGIN.z + zBase + 20;
    const mob = world.entities.get(2);
    if (!mob) throw new Error('expected seeded mob');
    mob.pos.z = ORIGIN.z + zBase + 25;
    const member = world.partyInfo.members.find((item) => item.pid === 6);
    if (!member) throw new Error('expected seeded party member');
    member.z = ORIGIN.z + zBase + 24;

    const layout = DELVE_MODULE_LAYOUTS.reliquary_bell_niche;
    const model = delveDrawModel(
      world as unknown as IWorld,
      MINIMAP.size,
      MINIMAP.pad,
      DELVE_NAME,
      MODULE_NAME,
    );
    if (!model) throw new Error('expected a model');
    expect(model.player.cy).toBeCloseTo(
      delveLocalToCanvas(0, 20, layout, MINIMAP.size, MINIMAP.pad).cy,
    );
    expect(model.mobs[0].cy).toBeCloseTo(
      delveLocalToCanvas(5, 25, layout, MINIMAP.size, MINIMAP.pad).cy,
    );
    expect(model.party[0].cy).toBeCloseTo(
      delveLocalToCanvas(4, 24, layout, MINIMAP.size, MINIMAP.pad).cy,
    );
  });

  it('excludes the delve companion from hostile mobs and classifies live reward/navigation objects', () => {
    const world = makeWorld() as unknown as {
      entities: Map<number, Record<string, unknown>>;
      companionState: { entityId: number };
      delveRun: {
        exitPortalOpen: boolean;
        bountiful: boolean;
        rite: { phase: 'choose' };
      };
    };
    world.entities.set(20, {
      id: 20,
      kind: 'mob',
      dead: false,
      hostile: false,
      pos: { x: ORIGIN.x + 3, z: ORIGIN.z + MODULE_Z + 21 },
      aggroTargetId: null,
    });
    world.companionState = { entityId: 20 };
    world.delveRun.exitPortalOpen = true;
    world.delveRun.bountiful = true;
    world.delveRun.rite = { phase: 'choose' };
    const object = (id: number, templateId: string, localX: number, localZ: number) => ({
      id,
      kind: 'object',
      templateId,
      dead: false,
      pos: { x: ORIGIN.x + localX, z: ORIGIN.z + MODULE_Z + localZ },
    });
    world.entities.set(21, object(21, 'delve_locked_chest', -4, 30));
    world.entities.set(22, object(22, 'delve_module_exit', 0, 50));
    world.entities.set(23, object(23, 'delve_drowned_reliquary', 4, 35));
    world.entities.set(24, object(24, 'delve_surface_exit', 0, 55));

    const model = delveDrawModel(
      world as unknown as IWorld,
      MINIMAP.size,
      MINIMAP.pad,
      DELVE_NAME,
      MODULE_NAME,
    );
    if (!model) throw new Error('expected a model');
    expect(model.mobs).toHaveLength(2); // the original hostiles, never the companion
    expect(model.rewards.map((marker) => marker.semantic)).toEqual([
      { kind: 'delve-reward', reward: 'cache', state: 'locked', bountiful: true },
      { kind: 'delve-reward', reward: 'reliquary', state: 'ready', bountiful: true },
    ]);
    expect(model.navigation.map((marker) => marker.semantic)).toEqual([
      { kind: 'delve-passage', state: 'open' },
      { kind: 'delve-surface' },
    ]);
  });

  it('never paints a friendly summon as a hostile delve mob', () => {
    const world = makeWorld() as unknown as {
      entities: Map<number, Record<string, unknown>>;
    };
    world.entities.set(30, {
      id: 30,
      kind: 'mob',
      hostile: false,
      ownerId: 1,
      dead: false,
      pos: { x: ORIGIN.x + 2, z: ORIGIN.z + MODULE_Z + 20 },
      aggroTargetId: null,
    });

    const model = delveDrawModel(
      world as unknown as IWorld,
      MINIMAP.size,
      MINIMAP.pad,
      DELVE_NAME,
      MODULE_NAME,
    );
    expect(model?.mobs).toHaveLength(2);
  });

  it('is deterministic: identical inputs produce a deep-equal model', () => {
    const a = delveDrawModel(makeWorld(), MINIMAP.size, MINIMAP.pad, DELVE_NAME, MODULE_NAME);
    const b = delveDrawModel(makeWorld(), MINIMAP.size, MINIMAP.pad, DELVE_NAME, MODULE_NAME);
    expect(a).toEqual(b);
  });

  it('Sim-shaped and ClientWorld-mirror-shaped IWorld stubs render identically', () => {
    // Two independently-built stubs with the same data: the painter must read only
    // IWorld-declared fields, so the minimap player schematic (party discs/arrows)
    // can never silently misrender online.
    const sim = makeWorld();
    const clientMirror = makeWorld();
    expect(sim).not.toBe(clientMirror);
    const fromSim = delveDrawModel(sim, MINIMAP.size, MINIMAP.pad, DELVE_NAME, MODULE_NAME);
    const fromClient = delveDrawModel(
      clientMirror,
      MINIMAP.size,
      MINIMAP.pad,
      DELVE_NAME,
      MODULE_NAME,
    );
    expect(fromSim).toEqual(fromClient);
  });

  it('matches an interest-pruned mirror and hides distant enemy, reward, and route state', () => {
    const disclosureWorld = (includeOffInterest: boolean): IWorld => {
      const world = makeWorld() as unknown as {
        player: { pos: { x: number; z: number } };
        entities: Map<number, Record<string, unknown>>;
        delveRun: {
          exitPortalOpen: boolean;
          bountiful: boolean;
          rite: null;
        };
      };
      world.player.pos.z = ORIGIN.z + MODULE_Z - 10;
      world.delveRun.exitPortalOpen = false;
      world.delveRun.bountiful = false;
      world.delveRun.rite = null;
      const mob = (id: number, localZ: number) => ({
        id,
        kind: 'mob',
        hostile: true,
        dead: false,
        pos: { x: ORIGIN.x, z: ORIGIN.z + MODULE_Z + localZ },
        aggroTargetId: null,
      });
      const object = (id: number, templateId: string, localZ: number) => ({
        id,
        kind: 'object',
        templateId,
        dead: false,
        pos: { x: ORIGIN.x, z: ORIGIN.z + MODULE_Z + localZ },
      });
      world.entities.set(31, object(31, 'delve_locked_chest', 0));
      world.entities.set(32, object(32, 'delve_module_exit', 5));
      if (includeOffInterest) {
        world.entities.set(41, mob(41, 71));
        world.entities.set(42, object(42, 'delve_locked_chest', 72));
        world.entities.set(43, object(43, 'delve_module_exit', 73));
      }
      return world as unknown as IWorld;
    };

    const fromCompleteSimRoster = delveDrawModel(
      disclosureWorld(true),
      WORLDMAP.size,
      WORLDMAP.pad,
      DELVE_NAME,
      MODULE_NAME,
    );
    const fromInterestPrunedClient = delveDrawModel(
      disclosureWorld(false),
      WORLDMAP.size,
      WORLDMAP.pad,
      DELVE_NAME,
      MODULE_NAME,
    );

    expect(fromCompleteSimRoster).toEqual(fromInterestPrunedClient);
    expect(fromCompleteSimRoster?.mobs).toHaveLength(2);
    expect(fromCompleteSimRoster?.rewards).toHaveLength(1);
    expect(fromCompleteSimRoster?.navigation).toHaveLength(1);
  });

  it('both call sites share one core path: minimap + world-map differ only by viewport', () => {
    const mini = delveDrawModel(makeWorld(), MINIMAP.size, MINIMAP.pad, DELVE_NAME, MODULE_NAME);
    const world = delveDrawModel(makeWorld(), WORLDMAP.size, WORLDMAP.pad, DELVE_NAME, MODULE_NAME);
    if (!mini || !world) throw new Error('expected both models');
    // Same world -> same identity-level facts (label, module, marker counts)...
    expect(world.areaLabel).toBe(mini.areaLabel);
    expect(world.layoutId).toBe(mini.layoutId);
    expect(world.mobs).toHaveLength(mini.mobs.length);
    expect(world.party).toHaveLength(mini.party.length);
    // ...but the schematic scales with the viewport (different size + pad).
    expect(world.schematic).toEqual(delveSchematicStatic(LAYOUT, WORLDMAP.size, WORLDMAP.pad));
    expect(world.schematic).not.toEqual(mini.schematic);
  });
});

// --- relocalize(): the cached schematic background (incl. the baked compass-N
// glyph) is keyed only on module id, never locale, so a language switch alone can
// never bust it; relocalize() must force exactly one rebuild. ------------------

/** A minimal 2D-context stub covering every call drawSchematic/paintMinimapDelve
 *  makes for the non-litany reliquary module (no clipToOutline prims -> no
 *  Path2D). Mirrors the hand-rolled fake in tests/map_window_painter.test.ts;
 *  this file only needs it not to throw, not to record draws. */
interface DelveCanvasTrace {
  fillRects: number[][];
  arcs: number[][];
  moves: number[][];
  lines: number[][];
  lineWidths: number[];
  text: Array<{ op: 'fill' | 'stroke'; text: string; x: number; y: number; font: string }>;
  ops: Array<{
    kind: string;
    args: unknown[];
    fillStyle: string;
    strokeStyle: string;
    lineWidth: number;
  }>;
}

function newDelveCanvasTrace(): DelveCanvasTrace {
  return { fillRects: [], arcs: [], moves: [], lines: [], lineWidths: [], text: [], ops: [] };
}

function fakeDelveCtx(
  draws: Array<{ image: unknown; args: number[] }> = [],
  trace?: DelveCanvasTrace,
): CanvasRenderingContext2D {
  let lineWidth = 1;
  const record = (kind: string, args: unknown[] = []): void => {
    trace?.ops.push({
      kind,
      args,
      fillStyle: String(ctx.fillStyle),
      strokeStyle: String(ctx.strokeStyle),
      lineWidth,
    });
  };
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    get lineWidth(): number {
      return lineWidth;
    },
    set lineWidth(value: number) {
      lineWidth = value;
      trace?.lineWidths.push(value);
    },
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    imageSmoothingEnabled: false,
    globalAlpha: 1,
    save(): void {
      record('save');
    },
    restore(): void {
      record('restore');
    },
    beginPath(): void {
      record('beginPath');
    },
    moveTo(...args: number[]): void {
      trace?.moves.push(args);
      record('moveTo', args);
    },
    lineTo(...args: number[]): void {
      trace?.lines.push(args);
      record('lineTo', args);
    },
    closePath(): void {
      record('closePath');
    },
    ellipse(): void {},
    arc(...args: number[]): void {
      trace?.arcs.push(args);
      record('arc', args);
    },
    clip(): void {
      record('clip');
    },
    fill(): void {
      record('fill');
    },
    stroke(): void {
      record('stroke');
    },
    fillRect(...args: number[]): void {
      trace?.fillRects.push(args);
      record('fillRect', args);
    },
    strokeRect(...args: number[]): void {
      record('strokeRect', args);
    },
    clearRect(): void {},
    drawImage(image: unknown, ...args: number[]): void {
      draws.push({ image, args });
      record('drawImage', [image, ...args]);
    },
    translate(...args: number[]): void {
      record('translate', args);
    },
    rotate(): void {},
    setTransform(): void {},
    measureText(): TextMetrics {
      return {
        width: 72,
        actualBoundingBoxLeft: 36,
        actualBoundingBoxRight: 36,
        actualBoundingBoxAscent: 12,
        actualBoundingBoxDescent: 3,
      } as TextMetrics;
    },
    strokeText(text: string, x: number, y: number): void {
      trace?.text.push({ op: 'stroke', text, x, y, font: ctx.font });
    },
    fillText(text: string, x: number, y: number): void {
      trace?.text.push({ op: 'fill', text, x, y, font: ctx.font });
    },
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

function opsAfterBackground(trace: DelveCanvasTrace): DelveCanvasTrace['ops'] {
  const backgroundAt = trace.ops.findIndex(({ kind }) => kind === 'drawImage');
  if (backgroundAt < 0) throw new Error('expected cached delve background blit');
  return trace.ops.slice(backgroundAt + 1);
}

/** Stubs `document`/`getComputedStyle` for the painter's offscreen-canvas cache
 *  and color resolution, counting every `document.createElement('canvas')` so a
 *  cache hit vs. a rebuild is observable without inspecting private fields. */
function installDelveStyleGlobals(): {
  canvasesCreated: () => number;
  canvasTraces: DelveCanvasTrace[];
} {
  let created = 0;
  const canvasTraces: DelveCanvasTrace[] = [];
  vi.stubGlobal('document', {
    documentElement: {},
    createElement(tag: string): unknown {
      if (tag !== 'canvas') throw new Error(`unexpected createElement(${tag})`);
      created++;
      const canvasTrace = newDelveCanvasTrace();
      canvasTraces.push(canvasTrace);
      const bg = fakeDelveCtx([], canvasTrace);
      return { width: 0, height: 0, getContext: (kind: string) => (kind === '2d' ? bg : null) };
    },
  });
  vi.stubGlobal('getComputedStyle', () => ({
    getPropertyValue: (token: string): string => `paint:${token}`,
  }));
  return { canvasesCreated: () => created, canvasTraces };
}

function delveWorldForPainter(): IWorld {
  const p = {
    id: 1,
    kind: 'player',
    dead: false,
    pos: { x: 0, z: MODULE_Z + 20 },
    facing: 0,
  };
  return {
    player: p,
    entities: new Map([[1, p]]),
    partyInfo: null,
    delveRun: {
      delveId: 'collapsed_reliquary',
      modules: [MODULE_ID],
      moduleIndex: 0,
      origin: { x: 0, z: 0 },
    },
  } as unknown as IWorld;
}

function delveWorldWithLiveGeometry(): IWorld {
  const world = delveWorldForPainter() as unknown as {
    entities: Map<number, unknown>;
    partyInfo: unknown;
  };
  world.entities.set(2, {
    id: 2,
    kind: 'mob',
    hostile: true,
    dead: false,
    pos: { x: 5, z: MODULE_Z + 25 },
    aggroTargetId: null,
  });
  world.partyInfo = {
    members: [{ pid: 3, cls: 'mage', dead: 0, x: -4, z: MODULE_Z + 16 }],
  };
  return world as unknown as IWorld;
}

describe('DelveMapPainter.relocalize', () => {
  it('busts the cached minimap background so the next paint rebuilds it exactly once', () => {
    const trace = installDelveStyleGlobals();
    try {
      const writers = {
        setText: (el: HTMLElement, text: string): void => {
          (el as unknown as { textContent: string }).textContent = text;
        },
      } as unknown as PainterHostWriters;
      const painter = new DelveMapPainter(writers, () => 'white');
      const world = delveWorldForPainter();
      const zoneLabel = { textContent: '' } as unknown as HTMLElement;
      const ctx = fakeDelveCtx();

      painter.paintMinimapDelve(ctx, world, zoneLabel, MINIMAP.size);
      expect(trace.canvasesCreated()).toBe(1); // first paint bakes the bg canvas

      painter.paintMinimapDelve(ctx, world, zoneLabel, MINIMAP.size);
      expect(trace.canvasesCreated()).toBe(1); // same module: cache hit, no rebuild

      painter.relocalize();
      painter.paintMinimapDelve(ctx, world, zoneLabel, MINIMAP.size);
      expect(trace.canvasesCreated()).toBe(2); // relocalize forced exactly one rebuild

      painter.paintMinimapDelve(ctx, world, zoneLabel, MINIMAP.size);
      expect(trace.canvasesCreated()).toBe(2); // re-latched: no further rebuild
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('busts the world-map background cache independently of the minimap one', () => {
    const trace = installDelveStyleGlobals();
    try {
      const writers = { setText: (): void => {} } as unknown as PainterHostWriters;
      const painter = new DelveMapPainter(writers, () => 'white');
      const world = delveWorldForPainter();
      const ctx = fakeDelveCtx();

      painter.paintWorldMapDelve(ctx, world, WORLDMAP.size);
      expect(trace.canvasesCreated()).toBe(2); // schematic background + cached title sprite
      painter.paintWorldMapDelve(ctx, world, WORLDMAP.size);
      expect(trace.canvasesCreated()).toBe(2);

      painter.relocalize();
      painter.paintWorldMapDelve(ctx, world, WORLDMAP.size);
      expect(trace.canvasesCreated()).toBe(4); // both localized caches rebuild once
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('returns the exact disclosure-filtered world-map model and null outside a delve', () => {
    installDelveStyleGlobals();
    try {
      const painter = new DelveMapPainter(
        { setText: (): void => {} } as unknown as PainterHostWriters,
        () => 'white',
      );
      const ctx = fakeDelveCtx();
      const model = painter.paintWorldMapDelve(ctx, delveWorldForPainter(), WORLDMAP.size);
      expect(model).not.toBeNull();
      expect(model?.areaLabel).toBe(`${DELVE_NAME}: ${MODULE_NAME}`);
      expect(model?.mobs).toEqual([]);
      expect(
        painter.paintWorldMapDelve(ctx, { delveRun: null } as unknown as IWorld, WORLDMAP.size),
      ).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('DelveMapPainter responsive live geometry', () => {
  it('uses one compact minimap profile for mob, party, player, and circular fit', () => {
    installDelveStyleGlobals();
    try {
      const profile = vi.fn(() => 'compact' as const);
      const painter = new DelveMapPainter(
        { setText: (): void => {} } as unknown as PainterHostWriters,
        () => 'class:mage',
        undefined,
        profile,
      );
      const trace = newDelveCanvasTrace();
      const ctx = fakeDelveCtx([], trace);

      painter.paintMinimapDelve(ctx, delveWorldWithLiveGeometry(), {} as HTMLElement, MINIMAP.size);

      expect(profile).toHaveBeenCalledTimes(1);
      expect(trace.fillRects.some((rect) => rect[2] === 4.5 && rect[3] === 4.5)).toBe(true);
      expect(trace.arcs.some((arc) => arc[2] === 5.5)).toBe(true);
      expect(trace.moves).toContainEqual([0, -(MINIMAP.size * 0.045 * 1.35)]);
      expect(trace.lines).toContainEqual([
        MINIMAP.size * 0.045 * 1.35 * 0.6,
        MINIMAP.size * 0.045 * 1.35 * 0.8,
      ]);
      expect(trace.lineWidths.slice(-2)).toEqual([2, 2]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('uses one compact M-map profile for live geometry and a legible title style', () => {
    const browser = installDelveStyleGlobals();
    try {
      const profile = vi.fn(() => 'compact' as const);
      const painter = new DelveMapPainter(
        { setText: (): void => {} } as unknown as PainterHostWriters,
        () => 'class:mage',
        undefined,
        profile,
      );
      const trace = newDelveCanvasTrace();
      const ctx = fakeDelveCtx([], trace);

      const model = painter.paintWorldMapDelve(ctx, delveWorldWithLiveGeometry(), WORLDMAP.size);

      expect(profile).toHaveBeenCalledTimes(1);
      expect(model?.areaLabel).toBeTruthy();
      expect(trace.fillRects.some((rect) => rect[2] === 6 && rect[3] === 6)).toBe(true);
      expect(trace.arcs.some((arc) => arc[2] === 7)).toBe(true);
      expect(trace.moves).toContainEqual([0, -(WORLDMAP.size * 0.045 * 1.35)]);
      expect(trace.text).toEqual([]); // no font shaping on the hot destination context
      const titleTrace = browser.canvasTraces.at(-1);
      expect(titleTrace?.text.map(({ op, text, font }) => ({ op, text, font }))).toEqual([
        { op: 'stroke', text: model?.areaLabel, font: 'bold 21px Georgia' },
        { op: 'fill', text: model?.areaLabel, font: 'bold 21px Georgia' },
      ]);
      expect(titleTrace?.lineWidths.at(-1)).toBe(4.5);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('DelveMapPainter generated semantic art', () => {
  function artHarness(): {
    art: MapMarkerArt;
    calls: Array<{ id: MapMarkerArtId; size: MapMarkerSize }>;
  } {
    const calls: Array<{ id: MapMarkerArtId; size: MapMarkerSize }> = [];
    return {
      calls,
      art: {
        sprite(id, size): CanvasImageSource {
          calls.push({ id, size });
          return { markerId: id, sizeId: size } as unknown as CanvasImageSource;
        },
        preload(): void {},
      },
    };
  }

  function semanticDelveWorld(): IWorld {
    const world = delveWorldForPainter() as unknown as {
      entities: Map<number, Record<string, unknown>>;
      delveRun: {
        exitPortalOpen: boolean;
        bountiful: boolean;
        rite: null;
      };
    };
    world.delveRun.exitPortalOpen = false;
    world.delveRun.bountiful = true;
    world.delveRun.rite = null;
    const object = (id: number, templateId: string, x: number, z: number) => ({
      id,
      kind: 'object',
      templateId,
      dead: false,
      pos: { x, z: MODULE_Z + z },
    });
    world.entities.set(11, object(11, 'delve_locked_chest', -4, 30));
    world.entities.set(12, object(12, 'delve_module_exit', 0, 45));
    world.entities.set(13, object(13, 'delve_surface_exit', 4, 50));
    return world as unknown as IWorld;
  }

  it.each([
    {
      profile: 'standard',
      paint: 'minimap',
      expected: [
        { id: 'reward-locked-cache', size: 'minimapRewardLockedBountiful' },
        { id: 'delve-passage', size: 'minimapNavigationLocked' },
        { id: 'delve-surface-exit', size: 'minimapNavigation' },
      ],
    },
    {
      profile: 'compact',
      paint: 'minimap',
      expected: [
        { id: 'reward-locked-cache', size: 'minimapRewardLockedBountifulCompact' },
        { id: 'delve-passage', size: 'minimapNavigationLockedCompact' },
        { id: 'delve-surface-exit', size: 'minimapNavigationCompact' },
      ],
    },
    {
      profile: 'standard',
      paint: 'map',
      expected: [
        { id: 'reward-locked-cache', size: 'mapRewardLockedBountiful' },
        { id: 'delve-passage', size: 'mapNavigationLocked' },
        { id: 'delve-surface-exit', size: 'mapNavigation' },
      ],
    },
    {
      profile: 'compact',
      paint: 'map',
      expected: [
        { id: 'reward-locked-cache', size: 'mapRewardLockedBountifulCompact' },
        { id: 'delve-passage', size: 'mapNavigationLockedCompact' },
        { id: 'delve-surface-exit', size: 'mapNavigationCompact' },
      ],
    },
  ] as const)(
    'blits exact $profile $paint rasters from the shared cache',
    ({ profile, paint, expected }) => {
      installDelveStyleGlobals();
      try {
        const markerArt = artHarness();
        const profileResolver = vi.fn(() => profile);
        const painter = new DelveMapPainter(
          { setText: (): void => {} } as unknown as PainterHostWriters,
          () => 'white',
          markerArt.art,
          profileResolver,
        );
        const draws: Array<{ image: unknown; args: number[] }> = [];
        const ctx = fakeDelveCtx(draws);
        if (paint === 'minimap') {
          painter.paintMinimapDelve(ctx, semanticDelveWorld(), {} as HTMLElement, MINIMAP.size);
        } else {
          painter.paintWorldMapDelve(ctx, semanticDelveWorld(), WORLDMAP.size);
        }
        expect(profileResolver).toHaveBeenCalledTimes(1);
        expect(markerArt.calls).toEqual(expected);
        const markerDraws = draws.filter(
          ({ image }) => typeof image === 'object' && image !== null && 'markerId' in image,
        );
        expect(markerDraws).toHaveLength(expected.length);
        for (const draw of markerDraws) expect(draw.args).toHaveLength(2);
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  type DelveFallbackWorld = {
    entities: Map<number, Record<string, unknown>>;
    delveRun: {
      exitPortalOpen: boolean;
      bountiful: boolean;
      rite: null | { phase: 'choose' | 'input' | 'open' };
    };
  };
  const fallbackSurfaceProfiles = [
    { surface: 'minimap', profile: 'standard', sizeIndex: 0 },
    { surface: 'minimap', profile: 'compact', sizeIndex: 1 },
    { surface: 'map', profile: 'standard', sizeIndex: 2 },
    { surface: 'map', profile: 'compact', sizeIndex: 3 },
  ] as const;
  const fallbackCases = [
    {
      label: 'locked cache',
      templateId: 'delve_locked_chest',
      prepare(world: DelveFallbackWorld): void {
        world.delveRun.bountiful = true;
      },
      id: 'reward-locked-cache',
      sizes: [
        'minimapRewardLockedBountiful',
        'minimapRewardLockedBountifulCompact',
        'mapRewardLockedBountiful',
        'mapRewardLockedBountifulCompact',
      ],
      operations:
        'beginPath,fillRect,strokeRect,beginPath,arc,stroke,beginPath,arc,stroke,fillRect',
      fill: 'paint:--color-delve-label',
    },
    {
      label: 'ready reliquary',
      templateId: 'delve_drowned_reliquary',
      prepare(world: DelveFallbackWorld): void {
        world.delveRun.rite = { phase: 'choose' };
      },
      id: 'reward-reliquary',
      sizes: [
        'minimapRewardAvailable',
        'minimapRewardAvailableCompact',
        'mapRewardAvailable',
        'mapRewardAvailableCompact',
      ],
      operations:
        'beginPath,moveTo,lineTo,lineTo,lineTo,closePath,fill,stroke,beginPath,moveTo,lineTo,moveTo,lineTo,stroke',
      fill: 'paint:--color-delve-label',
    },
    {
      label: 'active reliquary',
      templateId: 'delve_drowned_reliquary',
      prepare(world: DelveFallbackWorld): void {
        world.delveRun.rite = { phase: 'input' };
      },
      id: 'reward-reliquary',
      sizes: [
        'minimapRewardActive',
        'minimapRewardActiveCompact',
        'mapRewardActive',
        'mapRewardActiveCompact',
      ],
      operations:
        'beginPath,moveTo,lineTo,lineTo,lineTo,closePath,fill,stroke,beginPath,moveTo,lineTo,lineTo,stroke',
      fill: 'paint:--color-delve-mob-aggro',
    },
    {
      label: 'opened cache',
      templateId: 'delve_reward_chest',
      prepare(_world: DelveFallbackWorld): void {},
      id: 'reward-locked-cache',
      sizes: [
        'minimapRewardOpened',
        'minimapRewardOpenedCompact',
        'mapRewardOpened',
        'mapRewardOpenedCompact',
      ],
      operations: 'beginPath,fillRect,strokeRect,beginPath,moveTo,lineTo,lineTo,stroke',
      fill: 'paint:--color-delve-party-dead',
    },
    {
      label: 'sealed passage',
      templateId: 'delve_module_exit',
      prepare(world: DelveFallbackWorld): void {
        world.delveRun.exitPortalOpen = false;
      },
      id: 'delve-passage',
      sizes: [
        'minimapNavigationLocked',
        'minimapNavigationLockedCompact',
        'mapNavigationLocked',
        'mapNavigationLockedCompact',
      ],
      operations:
        'beginPath,arc,lineTo,lineTo,closePath,fill,stroke,beginPath,moveTo,lineTo,moveTo,lineTo,stroke',
      fill: 'paint:--color-delve-party-dead',
    },
    {
      label: 'open passage',
      templateId: 'delve_module_exit',
      prepare(world: DelveFallbackWorld): void {
        world.delveRun.exitPortalOpen = true;
      },
      id: 'delve-passage',
      sizes: [
        'minimapNavigation',
        'minimapNavigationCompact',
        'mapNavigation',
        'mapNavigationCompact',
      ],
      operations:
        'beginPath,arc,lineTo,lineTo,closePath,fill,stroke,beginPath,moveTo,lineTo,lineTo,closePath,fill',
      fill: 'paint:--color-delve-label',
    },
    {
      label: 'surface stairs',
      templateId: 'delve_surface_exit',
      prepare(_world: DelveFallbackWorld): void {},
      id: 'delve-surface-exit',
      sizes: [
        'minimapNavigation',
        'minimapNavigationCompact',
        'mapNavigation',
        'mapNavigationCompact',
      ],
      operations:
        'beginPath,moveTo,lineTo,moveTo,lineTo,moveTo,lineTo,moveTo,lineTo,moveTo,lineTo,moveTo,lineTo,stroke',
      fill: null,
    },
  ] as const;

  it.each(
    fallbackCases.flatMap((fallback) =>
      fallbackSurfaceProfiles.map(({ surface, profile, sizeIndex }) => ({
        ...fallback,
        surface,
        profile,
        size: fallback.sizes[sizeIndex],
      })),
    ),
  )(
    'keeps the $profile $surface $label fallback visible and state-distinct while art is unavailable',
    ({ templateId, prepare, id, size, operations, fill, surface, profile }) => {
      installDelveStyleGlobals();
      try {
        const world = delveWorldForPainter() as unknown as DelveFallbackWorld;
        world.delveRun.exitPortalOpen = false;
        world.delveRun.bountiful = false;
        world.delveRun.rite = null;
        prepare(world);
        world.entities.set(11, {
          id: 11,
          kind: 'object',
          templateId,
          dead: false,
          pos: { x: 0, z: MODULE_Z + 35 },
        });
        const calls: Array<{ id: MapMarkerArtId; size: MapMarkerSize }> = [];
        const resolveProfile = vi.fn(() => profile);
        const painter = new DelveMapPainter(
          { setText: (): void => {} } as unknown as PainterHostWriters,
          () => 'white',
          {
            sprite(artId, artSize): null {
              calls.push({ id: artId, size: artSize });
              return null;
            },
            preload(): void {},
          },
          resolveProfile,
        );
        const trace = newDelveCanvasTrace();
        const ctx = fakeDelveCtx([], trace);
        if (surface === 'minimap') {
          painter.paintMinimapDelve(
            ctx,
            world as unknown as IWorld,
            {} as HTMLElement,
            MINIMAP.size,
          );
        } else {
          painter.paintWorldMapDelve(ctx, world as unknown as IWorld, WORLDMAP.size);
        }

        expect(resolveProfile).toHaveBeenCalledTimes(1);
        expect(calls).toEqual([{ id, size }]);
        const fallbackOps = opsAfterBackground(trace);
        expect(fallbackOps.map(({ kind }) => kind).join(',')).toContain(operations);
        if (fill === null) {
          expect(fallbackOps.find(({ kind }) => kind === 'stroke')?.strokeStyle).toBe(
            'paint:--color-delve-outline',
          );
        } else {
          expect(
            fallbackOps.find(({ kind }) => kind === 'fill' || kind === 'fillRect')?.fillStyle,
          ).toBe(fill);
        }
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );
});

// --- No-magic-values canvas guard (MANDATORY for a Canvas painter) --

describe('delve_map_painter: no magic values', () => {
  const src = readFileSync(
    new URL('../src/ui/hud/delve/delve_map_painter.ts', import.meta.url),
    'utf8',
  );
  // Drop comments so prose can't create a false positive (mirrors architecture.test).
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('carries no literal hex or rgb color in TS', () => {
    const hex = code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    const rgb = code.match(/\brgba?\s*\(/g) ?? [];
    expect(hex, `hex colors: ${hex.join(', ')}`).toEqual([]);
    expect(rgb, `rgb colors: ${rgb.join(', ')}`).toEqual([]);
  });

  it('resolves --color-delve-* tokens via getComputedStyle (cached per redraw)', () => {
    expect(code).toContain('getComputedStyle');
    expect(code).toContain('getPropertyValue');
    expect(code).toContain('--color-delve-');
    // Resolved once per paint into a colors object, never inside a marker loop.
    expect(code).toContain('resolveColors');
  });

  it('uses circular minimap projection and frozen redraw-level compact profiles', () => {
    expect(code).toContain("t('hudChrome.compass.N'),\n      'circle',");
    expect(code).toContain('DELVE_DYNAMIC_GEOMETRY.minimap[profile]');
    expect(code).toContain('DELVE_DYNAMIC_GEOMETRY.map[profile]');
    expect(code).toContain('DELVE_MAP_TEXT_STYLE[profile]');
    expect(code).not.toContain('this.markerProfile() ===');
    expect(code.match(/Object\.freeze/g)?.length).toBeGreaterThanOrEqual(7);
  });

  it('uses a bounded title sprite cache instead of hot canvas text APIs', () => {
    expect(code).toContain('new TextSpriteCache(8)');
    expect(code).toContain('titleSprites.beginRedraw()');
    const worldMapPaint = code.slice(code.indexOf('paintWorldMapDelve('));
    expect(worldMapPaint).not.toContain('fillText(');
    expect(worldMapPaint).not.toContain('strokeText(');
  });

  it('defines the delve color tokens it reads in the design-token sheet', () => {
    const tokens = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
    for (const tok of [
      '--color-delve-room',
      '--color-delve-mob',
      '--color-delve-mob-aggro',
      '--color-delve-party-dead',
      '--color-delve-label',
      '--color-delve-outline',
    ]) {
      expect(tokens, `missing ${tok}`).toContain(`${tok}:`);
    }
  });
});

// --- WCAG-chrome boundary over the vendor window the host now composes ----------
// No DOM/axe in this Node suite, and the vendor change is purely compositional
// (VendorWindowDeps composes PainterHostPresentation; the call site spreads the
// same bag), so renderVendorWindow's accessible markup is byte-identical. This
// source scan is the axe-core-equivalent: it asserts the a11y-bearing structure
// survives the composition. The delve schematic Canvas is the 3D-world-class
// surface that is OUT of a11y scope; the '#zone-label' the painter writes stays a
// real text node (setText -> textContent), which IS in scope.

describe('vendor window WCAG-chrome (compositional, markup intact)', () => {
  const vendor = readFileSync(
    new URL('../src/ui/hud/vendor/vendor_window.ts', import.meta.url),
    'utf8',
  );

  it('composes the PainterHostPresentation base', () => {
    expect(vendor).toContain('extends PainterHostPresentation');
  });

  it('keeps the accessible vendor markup (focusable buttons + aria labels)', () => {
    // Close control: a real button with an aria-label ON THE SAME TAG. A
    // regex rather than an adjacency literal: the focus-restore key landed
    // between the two attributes, and the claim was never about adjacency.
    expect(vendor).toMatch(/data-close[^>]*aria-label=/);
    // Item rows: real <button>s with per-row aria-labels (keyboard reachable,
    // native target size), unchanged by the composition.
    expect(vendor).toContain("row.type = 'button'");
    expect(vendor).toContain("row.setAttribute('aria-label'");
  });
});
