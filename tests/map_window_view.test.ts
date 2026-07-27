// Tests for the overworld map window pure core (map_window_view.ts):
//  - the mode discriminator (delve vs overworld) under both world shapes,
//  - the pure overworld draw model: Sim-vs-ClientWorld parity + determinism,
//  - per-state geometry: the full-zone blit + cursor at zoom 1, the zoomed-detail
//    overlay at/above MAP_DETAIL_ZOOM, the player arrow, and ally dedup/order.
//
// DOM/Three/2D-context-free, so this Node suite drives the core directly. The
// painter's canvas draws (map_window_painter.ts) need a real 2D context +
// getComputedStyle and are covered by the no-magic-values source guard instead.

import { describe, expect, it } from 'vitest';
import {
  CAMPS,
  DUNGEON_LIST,
  PROPS,
  QUESTS,
  WORLD_MAX_X,
  WORLD_MIN_X,
  ZONES,
} from '../src/sim/data';
import { EASTBROOK_LAYOUT } from '../src/sim/eastbrook_layout';
import {
  emptyZoneProps,
  isQuestTurnInNpc,
  type QuestProgress,
  type ZonePropsDef,
} from '../src/sim/types';
import type { Decoration } from '../src/sim/world';
import { overworldDungeonPortals } from '../src/ui/map_dungeon_portals';
import {
  buildOverworldMapModel,
  MAP_DETAIL_ZOOM,
  MAP_MAX_ZOOM,
  mapBuildingMarkerKind,
  mapWindowMode,
  npcMarkerAt,
  type OverworldMapInput,
  questAreaObjectivesAt,
} from '../src/ui/map_window_view';
import type { IWorld } from '../src/world_api';

const ZONE = ZONES[0];
const ZONE_CZ = (ZONE.zMin + ZONE.zMax) / 2; // a z inside the committed zone band
const CANVAS = 560;
// A quest giver with a real giverNpcId, so the npc-marker branch exercises real
// content rather than an undefined === undefined accident.
function requireQuestWithGiver() {
  const quest = Object.values(QUESTS).find((q) => q.giverNpcId);
  if (!quest) throw new Error('expected a quest with a giverNpcId');
  return quest;
}
const GIVER_QUEST = requireQuestWithGiver();
// A quest whose giver is also a turn-in npc, so a single npc can carry a 'ready'
// turn-in (the '?' glyph branch the painter renders, distinct from '!').
function requireReadyQuest() {
  const quest = Object.values(QUESTS).find(
    (q) => q.giverNpcId && isQuestTurnInNpc(q, q.giverNpcId),
  );
  if (!quest) throw new Error('expected a quest whose giver is also a turn-in npc');
  return quest;
}
const READY_QUEST = requireReadyQuest();

// One scenario as plain data, so we can build two structurally-distinct IWorld
// stubs (a "Sim-shaped" one carrying extra sim-only fields the core must ignore,
// and a lean "ClientWorld-mirror-shaped" one) and assert identical output
// Iteration order of consumed collections is kept identical.
function makeOverworldWorld(
  shape: 'sim' | 'client',
  questLog: Map<string, QuestProgress> = new Map(),
): IWorld {
  const simJunk = shape === 'sim' ? { hp: 100, maxHp: 100, castingAbility: null } : {};
  const player = {
    id: 1,
    kind: 'player',
    name: 'Me',
    pos: { x: 0, z: ZONE_CZ },
    facing: 0.5,
    ...simJunk,
  };
  const npc = {
    id: 2,
    kind: 'npc',
    name: 'Giver',
    templateId: GIVER_QUEST.giverNpcId,
    questIds: [GIVER_QUEST.id],
    pos: { x: 10, z: ZONE_CZ },
    ...simJunk,
  };
  const entities = new Map<number, unknown>([
    [player.id, player],
    [npc.id, npc],
  ]);
  const socialInfo = {
    friends: [{ id: 10, name: 'FriendA', online: true, x: 0, z: ZONE_CZ }],
    guild: {
      members: [
        { id: 10, name: 'FriendA', online: true, x: 0, z: ZONE_CZ }, // dup id -> deduped
        { id: 11, name: 'GuildB', online: true, x: 5, z: ZONE_CZ },
      ],
    },
  };
  return {
    player,
    entities,
    socialInfo,
    delveRun: null,
    cfg: { seed: 42, playerClass: 'warrior' },
    playerId: 1,
    questState: (q: string) => (q === GIVER_QUEST.id ? 'available' : 'unavailable'),
    questLog,
  } as unknown as IWorld;
}

function makeDelveWorld(shape: 'sim' | 'client'): IWorld {
  const simJunk = shape === 'sim' ? { hp: 100 } : {};
  return {
    player: { id: 1, kind: 'player', name: 'Me', pos: { x: 5000, z: 0 }, facing: 0, ...simJunk },
    entities: new Map(),
    socialInfo: null,
    delveRun: { delveId: 'd', modules: ['m'], moduleIndex: 0, origin: { x: 5000, z: 0 } },
    cfg: { seed: 42, playerClass: 'warrior' },
    playerId: 1,
    questState: () => 'unavailable',
    questLog: new Map(),
  } as unknown as IWorld;
}

const NO_DECOR: Decoration[] = [];

function input(
  world: IWorld,
  zoom: number,
  decorations: Decoration[] = NO_DECOR,
  props: ZonePropsDef = PROPS,
): OverworldMapInput {
  return { world, props, zone: ZONE, zoom, center: null, canvasSize: CANVAS, decorations };
}

describe('mapWindowMode (delve vs overworld discriminator)', () => {
  it('returns overworld for an overworld position with no run (both shapes)', () => {
    expect(mapWindowMode(makeOverworldWorld('sim'))).toBe('overworld');
    expect(mapWindowMode(makeOverworldWorld('client'))).toBe('overworld');
  });

  it('returns delve when the player is in a delve band with an active run (both shapes)', () => {
    expect(mapWindowMode(makeDelveWorld('sim'))).toBe('delve');
    expect(mapWindowMode(makeDelveWorld('client'))).toBe('delve');
  });

  it('returns overworld in a delve band when no run is active (the data-absent trap)', () => {
    const world = makeDelveWorld('client') as unknown as { delveRun: unknown };
    world.delveRun = null;
    expect(mapWindowMode(world as unknown as IWorld)).toBe('overworld');
  });
});

describe('buildOverworldMapModel (pure draw model)', () => {
  it('Sim-shaped and ClientWorld-mirror-shaped stubs render identically', () => {
    const sim = makeOverworldWorld('sim');
    const client = makeOverworldWorld('client');
    expect(sim).not.toBe(client);
    const fromSim = buildOverworldMapModel(input(sim, 3));
    const fromClient = buildOverworldMapModel(input(client, 3));
    expect(fromSim).toEqual(fromClient);
  });

  it('is deterministic: identical inputs produce a deep-equal model', () => {
    const a = buildOverworldMapModel(input(makeOverworldWorld('sim'), 3));
    const b = buildOverworldMapModel(input(makeOverworldWorld('sim'), 3));
    expect(a).toEqual(b);
  });

  it('at zoom 1 blits the whole cached background and is not draggable', () => {
    const model = buildOverworldMapModel(input(makeOverworldWorld('sim'), 1));
    expect(model.blit).toEqual({ sxFrac: 0, syFrac: 0, swFrac: 1, shFrac: 1 });
    expect(model.cursor).toBe('default');
    expect(model.detail).toBeNull();
    expect(model.view).toEqual({
      spanX: WORLD_MAX_X - WORLD_MIN_X,
      spanZ: ZONE.zMax - ZONE.zMin,
      minX: WORLD_MIN_X,
      maxX: WORLD_MAX_X,
      minZ: ZONE.zMin,
      maxZ: ZONE.zMax,
    });
    expect(model.zoneId).toBe(ZONE.id);
  });

  it('zooms into a sub-rect and turns draggable above zoom 1', () => {
    const model = buildOverworldMapModel(input(makeOverworldWorld('sim'), 3));
    expect(model.cursor).toBe('grab');
    expect(model.blit.swFrac).toBeCloseTo(1 / 3, 10);
    expect(model.view.spanX).toBeCloseTo((WORLD_MAX_X - WORLD_MIN_X) / 3, 6);
  });

  it('builds the zoomed-detail overlay only at/above MAP_DETAIL_ZOOM', () => {
    const decor: Decoration[] = [
      { kind: 'rock', x: 0, z: ZONE_CZ, scale: 1, variant: 0, biome: ZONE.biome },
      { kind: 'tree', x: 1, z: ZONE_CZ, scale: 1, variant: 0, biome: ZONE.biome },
      { kind: 'tree2', x: -1, z: ZONE_CZ, scale: 1, variant: 0, biome: ZONE.biome },
    ];
    expect(buildOverworldMapModel(input(makeOverworldWorld('sim'), 1, decor)).detail).toBeNull();
    const detail = buildOverworldMapModel(
      input(makeOverworldWorld('sim'), MAP_DETAIL_ZOOM, decor),
    ).detail;
    expect(detail).not.toBeNull();
    // rock/tree(pine)/tree2(oak) map to the three decoration color keys, in order.
    expect(detail?.decorations.map((d) => d.kind)).toEqual(['rock', 'tree', 'oak']);
  });

  it('classifies the Eastbrook landmark before its semantic inn kind', () => {
    expect(mapBuildingMarkerKind({ kind: 'inn', landmark: 'eastbrook_grand_armoury' })).toBe(
      'armoury',
    );
    expect(mapBuildingMarkerKind({ kind: 'inn' })).toBe('inn');

    const world = makeOverworldWorld('sim') as unknown as {
      player: { pos: { x: number; z: number } };
    };
    world.player.pos.x = 17.5;
    world.player.pos.z = -5.5;
    const detail = buildOverworldMapModel(input(world as unknown as IWorld, MAP_MAX_ZOOM)).detail;
    const armouries = detail?.buildings.filter((building) => building.kind === 'armoury');
    expect(armouries).toHaveLength(1);
    expect(armouries?.[0].points).toEqual([
      { mx: 322, my: 219.33333333333334 },
      { mx: 322, my: 340.66666666666663 },
      { mx: 238, my: 340.66666666666663 },
      { mx: 238, my: 219.33333333333334 },
    ]);
  });

  it('maps every rebuilt Eastbrook building, civic prop, stall, and authored wall segment', () => {
    const model = buildOverworldMapModel(input(makeOverworldWorld('sim'), MAP_DETAIL_ZOOM));
    const detail = model.detail;
    expect(detail).not.toBeNull();
    if (!detail) return;

    expect(
      detail.buildings.filter((marker) => marker.kind !== 'wall').map((marker) => marker.id),
    ).toEqual([
      ...EASTBROOK_LAYOUT.preservedBuildings.map((building) => building.id),
      ...EASTBROOK_LAYOUT.buildings.map((building) => building.id),
    ]);
    expect(
      detail.props.filter((marker) => marker.kind === 'well').map((marker) => marker.id),
    ).toEqual([EASTBROOK_LAYOUT.civic.wellBeacon.id]);
    const stallMarkerIds = detail.props
      .filter((marker) => marker.kind === 'stall')
      .map((marker) => marker.id);
    expect(stallMarkerIds).toEqual([
      'eastbrook_market_stall_world_market',
      'eastbrook_market_stall_provisions',
    ]);
    expect(stallMarkerIds).not.toContain('eastbrook_market_stall_artisans');
    expect(
      detail.buildings.filter((marker) => marker.kind === 'wall').map((marker) => marker.id),
    ).toEqual(EASTBROOK_LAYOUT.wall.segments.map((segment) => segment.id));
    expect(detail.buildings.every((marker) => marker.points.length === 4)).toBe(true);
    expect(
      detail.buildings.every((marker) =>
        marker.points.every((point) => Number.isFinite(point.mx) && Number.isFinite(point.my)),
      ),
    ).toBe(true);
  });

  it('projects wall footprints from the injected active-world dimensions', () => {
    const props = emptyZoneProps();
    props.walls = [
      {
        id: 'custom_wall',
        assetId: '/models/props/custom_wall.glb',
        x: 1,
        z: 2,
        w: 8,
        d: 1,
        rot: 0,
        height: 3,
      },
    ];
    const detail = buildOverworldMapModel(
      input(makeOverworldWorld('client'), MAP_MAX_ZOOM, NO_DECOR, props),
    ).detail;
    expect(detail?.buildings).toHaveLength(1);
    const wall = detail?.buildings[0];
    expect(wall).toMatchObject({ id: 'custom_wall', kind: 'wall' });
    if (!wall) return;
    const spanX = (WORLD_MAX_X - WORLD_MIN_X) / MAP_MAX_ZOOM;
    const spanZ = (ZONE.zMax - ZONE.zMin) / MAP_MAX_ZOOM;
    expect(Math.abs(wall.points[1].mx - wall.points[0].mx)).toBeCloseTo((8 / spanX) * CANVAS, 10);
    expect(Math.abs(wall.points[2].my - wall.points[1].my)).toBeCloseTo((1 / spanZ) * CANVAS, 10);
  });

  it('renders only injected custom-world town records without canonical Eastbrook leakage', () => {
    const props = emptyZoneProps();
    props.buildings.push({
      id: 'custom_hall',
      assetId: '/models/props/custom_hall.glb',
      kind: 'house',
      x: 0,
      z: 0,
      w: 6,
      d: 5,
      rot: 0,
      height: 7,
    });
    props.wells.push({ id: 'custom_well', x: 4, z: 0, r: 1 });
    props.stalls.push({ id: 'custom_stall', x: -4, z: 0, rot: 0, r: 1 });
    props.walls = [
      {
        id: 'custom_wall',
        assetId: '/models/props/custom_wall.glb',
        x: 0,
        z: 8,
        w: 7,
        d: 0.5,
        rot: 0,
        height: 3,
      },
    ];

    const detail = buildOverworldMapModel(
      input(makeOverworldWorld('client'), MAP_DETAIL_ZOOM, NO_DECOR, props),
    ).detail;
    expect(detail?.buildings.map((marker) => [marker.id, marker.kind])).toEqual([
      ['custom_hall', 'house'],
      ['custom_wall', 'wall'],
    ]);
    expect(detail?.props.map((marker) => [marker.id, marker.kind])).toEqual([
      ['custom_well', 'well'],
      ['custom_stall', 'stall'],
    ]);
  });

  it('emits a player arrow at -facing and one quest-giver glyph', () => {
    const model = buildOverworldMapModel(input(makeOverworldWorld('sim'), 1));
    expect(model.player).not.toBeNull();
    expect(model.player?.angle).toBe(-0.5);
    // the npc has an available quest from its own giver -> one '!' (not ready) glyph
    expect(model.npcs).toHaveLength(1);
    expect(model.npcs[0].ready).toBe(false);
    // the glyph carries its quest identity for the hover tooltip
    expect(model.npcs[0].quests).toEqual([{ questId: GIVER_QUEST.id, ready: false }]);
  });

  it('hit-tests the nearest glyph within the hover radius (and misses outside it)', () => {
    const model = buildOverworldMapModel(input(makeOverworldWorld('sim'), 1));
    const glyph = model.npcs[0];
    expect(npcMarkerAt(model.npcs, glyph.mx, glyph.my)).toBe(glyph);
    expect(npcMarkerAt(model.npcs, glyph.mx + 5, glyph.my - 5)).toBe(glyph); // slack
    expect(npcMarkerAt(model.npcs, glyph.mx + 500, glyph.my)).toBeNull();
    expect(npcMarkerAt([], glyph.mx, glyph.my)).toBeNull();
  });

  it("marks the glyph ready when a turn-in is ready (the '?' branch, not '!')", () => {
    const world = makeOverworldWorld('client') as unknown as {
      entities: Map<number, { templateId: string; questIds: string[] }>;
      questState: (q: string) => string;
    };
    // Re-point the in-zone npc (id 2) at a quest whose giver is its turn-in npc,
    // and make that quest ready: hasReady wins, so the painter draws '?' not '!'.
    const npc = world.entities.get(2);
    if (!npc) throw new Error('expected the seeded in-zone npc');
    npc.templateId = READY_QUEST.giverNpcId as string;
    npc.questIds = [READY_QUEST.id];
    world.questState = (q) => (q === READY_QUEST.id ? 'ready' : 'unavailable');
    const model = buildOverworldMapModel(input(world as unknown as IWorld, 1));
    expect(model.npcs).toHaveLength(1);
    expect(model.npcs[0].ready).toBe(true);
  });

  it('projects zone POIs and the in-band dungeon portals into the model', () => {
    // ZONE (eastbrook_vale) carries POIs and one overworld dungeon entrance, so
    // the pois/portals projection the painter draws is actually exercised here; a
    // regression that dropped or mis-projected either array would be caught.
    const model = buildOverworldMapModel(input(makeOverworldWorld('sim'), 1));
    expect(model.pois).toHaveLength(ZONE.pois.length);
    expect(model.pois.map((p) => p.poiIndex)).toEqual(ZONE.pois.map((_, i) => i));
    expect(model.pois.every((p) => p.zoneId === ZONE.id)).toBe(true);
    // At zoom 1 the region is the whole committed zone, so a POI projects by the
    // documented flip (+X is map-left): mx = (maxX - x)/spanX * S, my likewise in Z.
    const poi0 = ZONE.pois[0];
    expect(model.pois[0].mx).toBeCloseTo(
      ((WORLD_MAX_X - poi0.x) / (WORLD_MAX_X - WORLD_MIN_X)) * CANVAS,
      6,
    );
    expect(model.pois[0].my).toBeCloseTo(
      ((ZONE.zMax - poi0.z) / (ZONE.zMax - ZONE.zMin)) * CANVAS,
      6,
    );
    const expectedPortals = overworldDungeonPortals(DUNGEON_LIST, ZONE.zMin, ZONE.zMax);
    expect(expectedPortals.length).toBeGreaterThan(0);
    expect(model.portals.map((p) => p.dungeonId)).toEqual(expectedPortals.map((p) => p.id));
    expect(model.portals.every((p) => Number.isFinite(p.mx) && Number.isFinite(p.my))).toBe(true);
  });

  it('dedups allies by id (friend wins ties) and orders friends before guild', () => {
    const model = buildOverworldMapModel(input(makeOverworldWorld('sim'), 1));
    expect(model.allies.map((a) => a.kind)).toEqual(['friend', 'guild']);
    expect(model.allies.map((a) => a.name)).toEqual(['FriendA', 'GuildB']);
  });

  it('drops the player marker when standing east past the world edge', () => {
    const world = makeOverworldWorld('client') as unknown as { player: { pos: { x: number } } };
    world.player.pos.x = WORLD_MAX_X + 50;
    const model = buildOverworldMapModel(input(world as unknown as IWorld, 1));
    expect(model.player).toBeNull();
  });

  it('exposes the zoom ceiling used by the zoom control', () => {
    expect(MAP_MAX_ZOOM).toBeGreaterThan(1);
  });
});

describe('active-quest objective areas (the classic POI blobs)', () => {
  // A kill quest whose target mob camps inside the committed zone band, so the
  // quest-area branch exercises real content rather than a synthetic fixture.
  function requireKillQuestInZone() {
    for (const q of Object.values(QUESTS)) {
      for (const obj of q.objectives) {
        if (obj.type !== 'kill') continue;
        const camp = CAMPS.find(
          (c) => c.mobId === obj.targetMobId && c.center.z >= ZONE.zMin && c.center.z < ZONE.zMax,
        );
        if (camp) return { quest: q, camp };
      }
    }
    throw new Error('expected a kill quest with a camp in the first zone');
  }
  const { quest } = requireKillQuestInZone();
  const activeLog = (): Map<string, QuestProgress> =>
    new Map([
      [
        quest.id,
        { questId: quest.id, counts: quest.objectives.map(() => 0), state: 'active' as const },
      ],
    ]);

  it('plots a blob over the target camp for an active kill quest (both shapes, identical)', () => {
    const sim = buildOverworldMapModel(input(makeOverworldWorld('sim', activeLog()), 1));
    const client = buildOverworldMapModel(input(makeOverworldWorld('client', activeLog()), 1));
    expect(sim.questAreas.length).toBeGreaterThan(0);
    expect(client.questAreas).toEqual(sim.questAreas);
    for (const a of sim.questAreas) {
      expect(a.radius).toBeGreaterThan(0);
      expect(Number.isFinite(a.mx)).toBe(true);
      expect(Number.isFinite(a.my)).toBe(true);
    }
  });

  it('plots nothing with an empty quest log or once the quest is turn-in ready', () => {
    expect(buildOverworldMapModel(input(makeOverworldWorld('sim'), 1)).questAreas).toEqual([]);
    const readyLog: Map<string, QuestProgress> = new Map([
      [
        quest.id,
        {
          questId: quest.id,
          counts: quest.objectives.map((o) => o.count),
          state: 'ready' as const,
        },
      ],
    ]);
    expect(
      buildOverworldMapModel(input(makeOverworldWorld('sim', readyLog), 1)).questAreas,
    ).toEqual([]);
  });

  it('scales the blob radius with the zoom level', () => {
    const z1 = buildOverworldMapModel(input(makeOverworldWorld('sim', activeLog()), 1));
    const z2 = buildOverworldMapModel(input(makeOverworldWorld('sim', activeLog()), 2));
    expect(z2.questAreas[0].radius).toBeCloseTo(z1.questAreas[0].radius * 2, 5);
  });

  it('numbers areas by the quest log acceptance order', () => {
    const model = buildOverworldMapModel(input(makeOverworldWorld('sim', activeLog()), 1));
    // single-quest log: every area carries badge number 1
    for (const a of model.questAreas) expect(a.numbers).toEqual([1]);
  });

  it('hit-tests a hovered point to the objective identities under it (deduped)', () => {
    const model = buildOverworldMapModel(input(makeOverworldWorld('sim', activeLog()), 1));
    const a = model.questAreas[0];
    // the blob carries its objective identity for the tooltip
    expect(a.objectives.length).toBeGreaterThan(0);
    const inside = questAreaObjectivesAt(model.questAreas, a.mx, a.my);
    expect(inside.length).toBeGreaterThan(0);
    expect(inside.some((r) => r.questId === quest.id)).toBe(true);
    // far outside every blob: nothing under the cursor
    expect(questAreaObjectivesAt(model.questAreas, -10_000, -10_000)).toEqual([]);
    // overlapping duplicates never repeat a ref
    const dup = questAreaObjectivesAt([...model.questAreas, ...model.questAreas], a.mx, a.my);
    expect(dup).toEqual(inside);
  });
});
