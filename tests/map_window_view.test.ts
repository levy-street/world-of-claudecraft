// Tests for the overworld map window pure core (map_window_view.ts):
//  - the mode discriminator (delve vs overworld) under both world shapes,
//  - the pure overworld draw model: Sim-vs-ClientWorld parity + determinism,
//  - per-state geometry: the current-zone square + cursor at zoom 1, the zoomed
//    sub-rect above it, current-zone-only markers/detail, the player arrow, and
//    ally dedup/order.
//
// DOM/Three/2D-context-free, so this Node suite drives the core directly. The
// painter's canvas draws (map_window_painter.ts) need a real 2D context +
// getComputedStyle and are covered by the no-magic-values source guard instead.

import { describe, expect, it } from 'vitest';
import {
  CAMPS,
  DELVE_X_MIN,
  PROPS,
  QUESTS,
  STRIP_MAX_X,
  STRIP_MIN_X,
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
import {
  buildOverworldMapModel,
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
const ZONE_MIN_X = ZONE.xMin ?? STRIP_MIN_X;
const ZONE_MAX_X = ZONE.xMax ?? STRIP_MAX_X;
const FULL_SPAN = Math.max(ZONE_MAX_X - ZONE_MIN_X, ZONE.zMax - ZONE.zMin);
const ZONE_CX = (ZONE_MIN_X + ZONE_MAX_X) / 2;
const LABELS_ZOOM = 1;
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

/** makeOverworldWorld plus a party roster (issue 2652): self (pid 1, must draw
 *  no marker), one alive member inside the zone/view, one dead member inside
 *  the zone/view, and one member well outside the committed zone. */
function makeOverworldWorldWithParty(shape: 'sim' | 'client'): IWorld {
  const world = makeOverworldWorld(shape) as unknown as { partyInfo: unknown };
  world.partyInfo = {
    leader: 1,
    raid: false,
    master: { enabled: false, looter: 0, threshold: 'uncommon' },
    members: [
      { pid: 1, name: 'Me', cls: 'warrior', dead: 0, x: 0, z: ZONE_CZ },
      { pid: 5, name: 'Ally', cls: 'mage', dead: 0, x: 15, z: ZONE_CZ },
      { pid: 6, name: 'Fallen', cls: 'priest', dead: 1, x: -15, z: ZONE_CZ },
      { pid: 7, name: 'FarAway', cls: 'rogue', dead: 0, x: ZONE_MAX_X + 50, z: ZONE_CZ },
    ],
  };
  return world as unknown as IWorld;
}

function makeDelveWorld(shape: 'sim' | 'client'): IWorld {
  const simJunk = shape === 'sim' ? { hp: 100 } : {};
  return {
    player: {
      id: 1,
      kind: 'player',
      name: 'Me',
      pos: { x: DELVE_X_MIN + 200, z: 0 },
      facing: 0,
      ...simJunk,
    },
    entities: new Map(),
    socialInfo: null,
    delveRun: {
      delveId: 'd',
      modules: ['m'],
      moduleIndex: 0,
      origin: { x: DELVE_X_MIN + 200, z: 0 },
    },
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

  it('at zoom 1 frames only the current zone square and is not draggable', () => {
    const model = buildOverworldMapModel(input(makeOverworldWorld('sim'), 1));
    expect(model.cursor).toBe('default');
    expect(model.detail).not.toBeNull();
    // zoom 1 = the current zone framed as a square; no global world bounds are
    // involved. The visible region equals that zone-local frame.
    expect(model.view.spanX).toBe(model.view.spanZ);
    expect(model.view).toEqual({
      spanX: FULL_SPAN,
      spanZ: FULL_SPAN,
      minX: ZONE_CX - FULL_SPAN / 2,
      maxX: ZONE_CX + FULL_SPAN / 2,
      minZ: ZONE_CZ - FULL_SPAN / 2,
      maxZ: ZONE_CZ + FULL_SPAN / 2,
    });
    expect(model.region).toEqual({
      minX: ZONE_CX - FULL_SPAN / 2,
      maxX: ZONE_CX + FULL_SPAN / 2,
      minZ: ZONE_CZ - FULL_SPAN / 2,
      maxZ: ZONE_CZ + FULL_SPAN / 2,
    });
    expect(model.zoneId).toBe(ZONE.id);
  });

  it('zooms into a smaller square sub-rect and turns draggable above zoom 1', () => {
    const model = buildOverworldMapModel(input(makeOverworldWorld('sim'), 3));
    expect(model.cursor).toBe('grab');
    // the visible span is the framed square divided by the zoom (uniform, square)
    expect(model.view.spanX).toBeCloseTo(FULL_SPAN / 3, 6);
    expect(model.region.maxX - model.region.minX).toBeCloseTo(FULL_SPAN / 3, 6);
    expect(model.region.maxZ - model.region.minZ).toBeCloseTo(FULL_SPAN / 3, 6);
  });

  it('builds the detail overlay from current-zone content at zone scale', () => {
    const decor: Decoration[] = [
      { kind: 'rock', x: 0, z: ZONE_CZ, scale: 1, variant: 0, biome: ZONE.biome },
      { kind: 'tree', x: 1, z: ZONE_CZ, scale: 1, variant: 0, biome: ZONE.biome },
      { kind: 'tree2', x: -1, z: ZONE_CZ, scale: 1, variant: 0, biome: ZONE.biome },
    ];
    const detail = buildOverworldMapModel(input(makeOverworldWorld('sim'), 1, decor)).detail;
    expect(detail).not.toBeNull();
    // rock/tree(pine)/tree2(oak) map to the three decoration color keys, in order.
    expect(detail?.decorations.map((d) => d.kind)).toEqual(['rock', 'tree', 'oak']);
  });

  it('projects markers at world scale: +X is map-left, centred on the player when zoomed in', () => {
    // A galecrest-shaped realm (x 180..540); the player at (394, 697) projects by
    // the world region (east = map-left) and, being interior, sits centred at max
    // zoom (the map is world-relative now, not one zone stretched to the canvas).
    const col: typeof ZONE = {
      ...ZONE,
      id: 'col_zone',
      zMin: 180,
      zMax: 700,
      xMin: 180,
      xMax: 540,
    };
    const world = makeOverworldWorld('sim') as unknown as {
      player: { pos: { x: number; z: number } };
    };
    world.player.pos.x = 394;
    world.player.pos.z = 500;
    const model = buildOverworldMapModel({
      world: world as unknown as IWorld,
      zone: col,
      props: PROPS,
      zoom: MAP_MAX_ZOOM,
      center: null,
      canvasSize: CANVAS,
      decorations: NO_DECOR,
    });
    expect(model.player).not.toBeNull();
    // centred within a pixel at max zoom, since (394, 500) is interior
    expect(model.player?.mx).toBeCloseTo(CANVAS / 2, 0);
    expect(model.player?.my).toBeCloseTo(CANVAS / 2, 0);
    // matches the world region transform exactly (+X is map-left)
    const r = model.region;
    expect(model.player?.mx).toBeCloseTo(((r.maxX - 394) / (r.maxX - r.minX)) * CANVAS, 6);
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
    const model = buildOverworldMapModel(input(makeOverworldWorld('sim'), MAP_MAX_ZOOM));
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
    const model = buildOverworldMapModel(
      input(makeOverworldWorld('client'), MAP_MAX_ZOOM, NO_DECOR, props),
    );
    const detail = model.detail;
    expect(detail?.buildings).toHaveLength(1);
    const wall = detail?.buildings[0];
    expect(wall).toMatchObject({ id: 'custom_wall', kind: 'wall' });
    if (!wall) return;
    // Scale off the model's OWN projected region: the map is world-region
    // relative, so the visible x span is the realm rect, not the full world
    // width. Deriving it here keeps this an assertion about the footprint
    // transform rather than about which constants bound the region.
    const spanX = model.view.spanX;
    const spanZ = model.view.spanZ;
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
      input(makeOverworldWorld('client'), MAP_MAX_ZOOM, NO_DECOR, props),
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

  it('emits a player arrow at -facing and one quest-giver glyph when zoomed in', () => {
    const model = buildOverworldMapModel(input(makeOverworldWorld('sim'), LABELS_ZOOM));
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

  it('still shows the quest-giver glyph when the npc entity is not mirrored (online interest-radius parity)', () => {
    // Online, ClientWorld.entities only carries entities inside the ~120-130yd
    // interest radius, so a distant quest giver is never mirrored into it. The
    // glyph must resolve from static NPCS content regardless, exactly like the
    // quest-area blobs already do (documented at the top of this file).
    const world = makeOverworldWorld('client') as unknown as { entities: Map<number, unknown> };
    world.entities.delete(2); // the seeded giver npc; only the player remains
    const model = buildOverworldMapModel(input(world as unknown as IWorld, 1));
    expect(model.npcs).toHaveLength(1);
    expect(model.npcs[0].ready).toBe(false);
    expect(model.npcs[0].quests).toEqual([{ questId: GIVER_QUEST.id, ready: false }]);
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
    const model = buildOverworldMapModel(input(world as unknown as IWorld, LABELS_ZOOM));
    expect(model.npcs).toHaveLength(1);
    expect(model.npcs[0].ready).toBe(true);
  });

  it('projects only current-zone POIs and portals by the zone-local transform', () => {
    // ZONE (eastbrook_vale) carries POIs and one overworld dungeon entrance.
    // At the opening zoom all vale POIs are present and no neighbouring zone can
    // contribute a marker.
    const model = buildOverworldMapModel(input(makeOverworldWorld('sim'), LABELS_ZOOM));
    expect(model.pois).toHaveLength(ZONE.pois.length);
    expect(new Set(model.pois.map((p) => p.zoneId))).toEqual(new Set([ZONE.id]));
    expect(model.pois.map((p) => p.poiIndex)).toEqual(ZONE.pois.map((_, i) => i));
    const r = model.region;
    const poi0 = ZONE.pois[0];
    expect(model.pois[0].mx).toBeCloseTo(((r.maxX - poi0.x) / (r.maxX - r.minX)) * CANVAS, 6);
    expect(model.pois[0].my).toBeCloseTo(((r.maxZ - poi0.z) / (r.maxZ - r.minZ)) * CANVAS, 6);
    // dungeon portals in view are finite-projected (portals show at every zoom)
    expect(model.portals.every((p) => Number.isFinite(p.mx) && Number.isFinite(p.my))).toBe(true);
  });

  it('dedups allies by id (friend wins ties) and orders friends before guild (zoomed in)', () => {
    const model = buildOverworldMapModel(input(makeOverworldWorld('sim'), LABELS_ZOOM));
    expect(model.allies.map((a) => a.kind)).toEqual(['friend', 'guild']);
    expect(model.allies.map((a) => a.name)).toEqual(['FriendA', 'GuildB']);
  });

  it('is empty solo / with no party formed', () => {
    const model = buildOverworldMapModel(input(makeOverworldWorld('sim'), LABELS_ZOOM));
    expect(model.party).toEqual([]);
  });

  describe('party markers (issue 2652)', () => {
    it('projects one marker per member, excluding self and a member outside the committed zone', () => {
      const model = buildOverworldMapModel(input(makeOverworldWorldWithParty('sim'), LABELS_ZOOM));
      expect(model.party.map((m) => m.name)).toEqual(['Ally', 'Fallen']);
    });

    it('carries only cls/dead/name identity, no resolved color, at the same projection every other marker uses', () => {
      const model = buildOverworldMapModel(input(makeOverworldWorldWithParty('sim'), LABELS_ZOOM));
      const ally = model.party.find((m) => m.name === 'Ally');
      expect(ally).toBeDefined();
      if (!ally) return;
      expect(Object.keys(ally).sort()).toEqual(['cls', 'dead', 'mx', 'my', 'name'].sort());
      expect(ally.cls).toBe('mage');
      expect(ally.dead).toBe(false);
      const r = model.region;
      expect(ally.mx).toBeCloseTo(((r.maxX - 15) / (r.maxX - r.minX)) * CANVAS, 6);
      expect(ally.my).toBeCloseTo(((r.maxZ - ZONE_CZ) / (r.maxZ - r.minZ)) * CANVAS, 6);
    });

    it('marks a dead member dead, distinctly from an alive one', () => {
      const model = buildOverworldMapModel(input(makeOverworldWorldWithParty('sim'), LABELS_ZOOM));
      const fallen = model.party.find((m) => m.name === 'Fallen');
      expect(fallen?.dead).toBe(true);
      expect(fallen?.cls).toBe('priest');
    });

    it('drops a member outside the committed zone, like every other marker kind', () => {
      const model = buildOverworldMapModel(input(makeOverworldWorldWithParty('sim'), LABELS_ZOOM));
      expect(model.party.some((m) => m.name === 'FarAway')).toBe(false);
    });

    it('Sim-shaped and ClientWorld-mirror-shaped stubs render an identical party array', () => {
      const fromSim = buildOverworldMapModel(
        input(makeOverworldWorldWithParty('sim'), LABELS_ZOOM),
      );
      const fromClient = buildOverworldMapModel(
        input(makeOverworldWorldWithParty('client'), LABELS_ZOOM),
      );
      expect(fromSim.party).toEqual(fromClient.party);
    });

    it('draws a party member who is also an online friend once, as the party marker, not twice', () => {
      const world = makeOverworldWorldWithParty('sim') as unknown as {
        socialInfo: {
          friends: { id: number; name: string; online: boolean; x: number; z: number }[];
        };
      };
      // 'Ally' is party pid 5 at x=15; also list them as an online friend at the
      // same spot, the common case of partying with someone on your friends list.
      world.socialInfo.friends.push({ id: 99, name: 'Ally', online: true, x: 15, z: ZONE_CZ });
      const model = buildOverworldMapModel(input(world as unknown as IWorld, LABELS_ZOOM));
      expect(model.party.filter((m) => m.name === 'Ally')).toHaveLength(1);
      expect(model.allies.filter((a) => a.name === 'Ally')).toHaveLength(0);
    });
  });

  // NPC quest-giver glyphs get their own zone-culling coverage below: they
  // resolve from static NPCS content, not the entity mirror, so they are not
  // interest-radius limited the way the player/ally markers here are.
  it('drops player and ally markers outside the committed zone', () => {
    const world = makeOverworldWorld('client') as unknown as {
      player: { pos: { x: number; z: number } };
      socialInfo: {
        friends: { x?: number; z?: number }[];
        guild: { members: { x?: number; z?: number }[] };
      };
    };
    const outsideX = ZONE_MAX_X + 50;
    world.player.pos.x = outsideX;
    for (const friend of world.socialInfo.friends) friend.x = outsideX;
    for (const member of world.socialInfo.guild.members) member.x = outsideX;
    const model = buildOverworldMapModel(input(world as unknown as IWorld, 1));
    expect(model.player).toBeNull();
    expect(model.allies).toEqual([]);
  });

  it('drops an npc quest-giver glyph outside the committed zone z-band (static content, not entity-scoped)', () => {
    // questGiverNpcMarkers resolves from static NPCS content, so unlike the
    // player/ally markers above it is never interest-radius limited, but it
    // is still zone-scoped the same way every other marker family is: the
    // shared inZone/inView(x,z) test, not z alone.
    const world = makeOverworldWorld('client');
    const outsideZone = { ...ZONE, zMin: ZONE.zMax + 1000, zMax: ZONE.zMax + 2000 };
    const model = buildOverworldMapModel({
      world,
      props: PROPS,
      zone: outsideZone,
      zoom: 1,
      center: null,
      canvasSize: CANVAS,
      decorations: NO_DECOR,
    });
    expect(model.npcs).toEqual([]);
  });

  it('drops an npc quest-giver glyph inside the zone z-band but outside its x-range', () => {
    // Zones are not z-disjoint (a z band can hold multiple zones side by
    // side), so the x test is load bearing: a giver whose z falls inside
    // this zone's band but whose x falls outside its x-range must still be
    // culled, not just projected off-canvas.
    const world = makeOverworldWorld('client');
    const outsideXZone = { ...ZONE, xMin: ZONE_MAX_X + 1000, xMax: ZONE_MAX_X + 2000 };
    const model = buildOverworldMapModel({
      world,
      props: PROPS,
      zone: outsideXZone,
      zoom: 1,
      center: null,
      canvasSize: CANVAS,
      decorations: NO_DECOR,
    });
    expect(model.npcs).toEqual([]);
  });

  it('uses a rectangular column zone as the sole frame, with ocean letterboxing', () => {
    const col = ZONES.find((z) => z.id === 'galecrest');
    if (!col || col.xMin === undefined || col.xMax === undefined)
      throw new Error('expected galecrest column bounds');
    const world = makeOverworldWorld('client') as unknown as {
      player: { pos: { x: number; z: number } };
    };
    world.player.pos = { x: (col.xMin + col.xMax) / 2, z: (col.zMin + col.zMax) / 2 };
    const model = buildOverworldMapModel({
      world: world as unknown as IWorld,
      zone: col,
      props: PROPS,
      zoom: 1,
      center: null,
      canvasSize: CANVAS,
      decorations: NO_DECOR,
    });
    const span = Math.max(col.xMax - col.xMin, col.zMax - col.zMin);
    expect(model.view.spanX).toBe(span);
    expect(model.view.spanZ).toBe(span);
    expect(model.pois).toHaveLength(col.pois.length);
    expect(model.pois.every((poi) => poi.zoneId === col.id)).toBe(true);
    expect(model.player?.mx).toBeCloseTo(CANVAS / 2, 6);
    expect(model.player?.my).toBeCloseTo(CANVAS / 2, 6);
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
