import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DungeonMapModel } from '../src/ui/dungeon_map_view';
import {
  BG_MAP_FIELD_PAD_PX,
  type BgMapModel,
  bgMapCanvasY,
  bgMapFitScale,
} from '../src/ui/hud/battleground/battleground_map_view';
import type { DelveDrawModel } from '../src/ui/hud/delve/delve_map_painter';
import type { RiftMapModel } from '../src/ui/hud/rift/rift_map_core';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';
import type { MapInstanceSemantic } from '../src/ui/map_semantic_accessibility_core';
import {
  MapSemanticAccessibilityCore,
  mapSemanticHitsInto,
  mapSemanticLabelId,
  quantizeMapMarkerLocation,
} from '../src/ui/map_semantic_accessibility_core';
import type { MapPaintResult } from '../src/ui/map_window_painter';

function core() {
  return new MapSemanticAccessibilityCore({
    zone: (id) => `Zone ${id}`,
    dungeon: (id) => `Dungeon ${id}`,
    delve: (id) => `Delve ${id}`,
    station: (type) => `Station ${type}`,
    poi: (zoneId, index) => `POI ${zoneId}/${index}`,
    rift: (name, rank) => `${name} (${rank ?? '?'})`,
    npc: (id) => `NPC ${id}`,
    mob: (id) => `Mob ${id}`,
  });
}

function delveModel(
  rewards: DelveDrawModel['rewards'] = [],
  navigation: DelveDrawModel['navigation'] = [],
): DelveDrawModel {
  return {
    layoutId: 'test',
    schematic: [],
    mobs: [],
    rewards,
    navigation,
    party: [],
    player: { kind: 'arrow', cx: 280, cy: 280, angle: 0 },
    areaLabel: 'Test Delve',
  } as unknown as DelveDrawModel;
}

function crowdedOverworldModel(): MapPaintResult {
  const questAreas = [160, 260].flatMap((radius) =>
    Array.from({ length: 8 }, (_, index) => {
      const angle = (index * Math.PI) / 4;
      return {
        mx: 280 + Math.cos(angle) * radius,
        my: 280 + Math.sin(angle) * radius,
        radius: 12,
        objectives: [],
        numbers: [index + 1],
      };
    }),
  );
  return {
    view: {},
    cursor: 'default',
    questAreas,
    npcs: [
      {
        mx: 250,
        my: 250,
        kind: 'available',
        quests: [{ questId: 'available', kind: 'available' }],
      },
      { mx: 310, my: 250, kind: 'ready', quests: [{ questId: 'ready', kind: 'ready' }] },
    ],
    gatherNodes: [
      { mx: 220, my: 300, nodeId: 'ore', type: 'ore', ready: true, locked: false },
      { mx: 230, my: 300, nodeId: 'wood', type: 'wood', ready: true, locked: false },
      { mx: 240, my: 300, nodeId: 'herb', type: 'herb', ready: true, locked: false },
    ],
    stations: (['forge', 'kitchens', 'loom', 'toolworks'] as const).map((type, index) => ({
      mx: 300 + index * 10,
      my: 320,
      stationId: type,
      type,
    })),
    services: [
      { mx: 340, my: 320, kind: 'mailbox' },
      { mx: 350, my: 320, kind: 'noticeboard' },
    ],
    navigation: [
      {
        mx: 280,
        my: 210,
        kind: 'world-passage',
        portalId: 'passage',
        destinationZoneId: 'north',
      },
    ],
    player: { mx: 280, my: 280, angle: 0 },
    allies: [],
    party: [{ mx: 300, my: 280, name: 'Aria', cls: 'priest', dead: false }],
    portals: [],
    pois: [],
  } as unknown as MapPaintResult;
}

const GATHER_ACCESSIBILITY_CASES = [
  { type: 'ore', ready: true, locked: false, label: 'Ready ore node' },
  { type: 'wood', ready: true, locked: false, label: 'Ready wood node' },
  { type: 'herb', ready: true, locked: false, label: 'Ready herb node' },
  { type: 'ore', ready: true, locked: true, label: 'Ready ore node, tool locked' },
  { type: 'wood', ready: true, locked: true, label: 'Ready wood node, tool locked' },
  { type: 'herb', ready: true, locked: true, label: 'Ready herb node, tool locked' },
  { type: 'ore', ready: false, locked: false, label: 'Depleted ore node' },
  { type: 'wood', ready: false, locked: false, label: 'Depleted wood node' },
  { type: 'herb', ready: false, locked: false, label: 'Depleted herb node' },
  { type: 'ore', ready: false, locked: true, label: 'Depleted ore node, tool locked' },
  { type: 'wood', ready: false, locked: true, label: 'Depleted wood node, tool locked' },
  { type: 'herb', ready: false, locked: true, label: 'Depleted herb node, tool locked' },
] as const;

beforeAll(async () => {
  await ensureLocaleLoaded('zh_CN');
});

afterEach(() => {
  setLanguage('en');
});

describe('map semantic accessibility core', () => {
  it('quantizes eight-way direction and coarse distance without exposing raw coordinates', () => {
    expect(quantizeMapMarkerLocation(280, 280, 280, 280, 560)).toEqual({
      direction: 'center',
      distance: 'near',
    });
    expect(quantizeMapMarkerLocation(130, 130, 280, 280, 560)).toEqual({
      direction: 'northwest',
      distance: 'medium',
    });
    expect(quantizeMapMarkerLocation(900, 280, 280, 280, 560)).toEqual({
      direction: 'east',
      distance: 'far',
    });

    const center = 280;
    const radius = 140;
    const directions = [
      ['east', 0],
      ['southeast', 45],
      ['south', 90],
      ['southwest', 135],
      ['west', 180],
      ['northwest', 225],
      ['north', 270],
      ['northeast', 315],
    ] as const;
    for (const [direction, degrees] of directions) {
      const radians = (degrees * Math.PI) / 180;
      expect(
        quantizeMapMarkerLocation(
          center + Math.cos(radians) * radius,
          center + Math.sin(radians) * radius,
          center,
          center,
          560,
        ),
        direction,
      ).toEqual({ direction, distance: 'medium' });
    }

    const beforeNortheast = (22.49 * Math.PI) / 180;
    const atNortheast = (22.5 * Math.PI) / 180;
    expect(
      quantizeMapMarkerLocation(
        center + Math.cos(beforeNortheast) * radius,
        center + Math.sin(beforeNortheast) * radius,
        center,
        center,
        560,
      ).direction,
    ).toBe('east');
    expect(
      quantizeMapMarkerLocation(
        center + Math.cos(atNortheast) * radius,
        center + Math.sin(atNortheast) * radius,
        center,
        center,
        560,
      ).direction,
    ).toBe('southeast');

    expect(quantizeMapMarkerLocation(center + 112, center, center, center, 560).distance).toBe(
      'near',
    );
    expect(quantizeMapMarkerLocation(center + 112.01, center, center, center, 560).distance).toBe(
      'medium',
    );
    expect(quantizeMapMarkerLocation(235.19, 0, 0, 0, 560).distance).toBe('medium');
    expect(quantizeMapMarkerLocation(235.21, 0, 0, 0, 560).distance).toBe('far');
  });

  it('reuses accepted hit slots and resolves exact ties navigation before reward before mechanic', () => {
    const output: Parameters<typeof mapSemanticHitsInto>[7] = [];
    const markers = [
      { cx: 100, cy: 100, semantic: { kind: 'rift-mechanic', mechanic: 'orb', state: 'active' } },
      {
        cx: 100,
        cy: 100,
        semantic: { kind: 'delve-reward', reward: 'cache', state: 'locked', bountiful: false },
      },
      { cx: 100, cy: 100, semantic: { kind: 'delve-passage', state: 'open' } },
    ] as const;
    expect(mapSemanticHitsInto(markers, 100, 100, 20, 280, 280, 560, output)).toBe(3);
    expect(output.map((hit) => hit.layer)).toEqual(['navigation', 'reward', 'mechanic']);
    const firstSlot = output[0];
    expect(mapSemanticHitsInto(markers, 101, 100, 20, 280, 280, 560, output)).toBe(3);
    expect(output[0]).toBe(firstSlot);
  });

  it('exhaustively names every live Rift and Delve semantic state', () => {
    const semantics: MapInstanceSemantic[] = [
      { kind: 'rift-descent' },
      { kind: 'rift-return', route: 'beacon', rank: null },
      { kind: 'rift-return', route: 'egress', rank: 'S' },
      ...(['available', 'locked', 'opened', 'jammed'] as const).flatMap((state) => [
        { kind: 'rift-reward', reward: 'treasure', state } as const,
        { kind: 'rift-reward', reward: 'cache', state } as const,
      ]),
      { kind: 'rift-mechanic', mechanic: 'pylon', state: 'unlit' },
      { kind: 'rift-mechanic', mechanic: 'pylon', state: 'lit' },
      { kind: 'rift-mechanic', mechanic: 'sequence-rune', state: 'unlit' },
      { kind: 'rift-mechanic', mechanic: 'sequence-rune', state: 'lit' },
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
      { kind: 'delve-passage', state: 'sealed' },
      { kind: 'delve-passage', state: 'open' },
      { kind: 'delve-surface' },
      ...(['locked', 'ready', 'active', 'opened'] as const).flatMap((state) => [
        { kind: 'delve-reward', reward: 'cache', state, bountiful: false } as const,
        { kind: 'delve-reward', reward: 'reliquary', state, bountiful: true } as const,
      ]),
    ];
    expect(semantics.map(mapSemanticLabelId)).toEqual([
      'riftDescent',
      'riftReturnBeacon',
      'riftReturnExit',
      'riftTreasureAvailable',
      'riftCacheAvailable',
      'riftTreasureLocked',
      'riftCacheLocked',
      'riftTreasureOpened',
      'riftCacheOpened',
      'riftTreasureJammed',
      'riftCacheJammed',
      'pylonUnlit',
      'pylonLit',
      'sequenceRuneUnlit',
      'sequenceRuneLit',
      'iceGoal',
      'boulderPad',
      'boulderMovable',
      'boulderPlaced',
      'gateSealed',
      'gateOpen',
      'switchReady',
      'switchOn',
      'orbDormant',
      'orbActive',
      'rollerHazard',
      'delvePassageSealed',
      'delvePassageOpen',
      'delveSurfaceExit',
      'delveCacheLocked',
      'delveReliquaryLocked',
      'delveCacheReady',
      'delveReliquaryReady',
      'delveCacheActive',
      'delveReliquaryActive',
      'delveCacheOpened',
      'delveReliquaryOpened',
    ]);
  });

  it('uses one localized formatter for passage, reward, and mechanic descriptions and tips', () => {
    const view = core();
    const passage = {
      cx: 100,
      cy: 100,
      semantic: { kind: 'delve-passage', state: 'sealed' },
    } as const;
    const reward = {
      cx: 180,
      cy: 100,
      semantic: { kind: 'delve-reward', reward: 'cache', state: 'active', bountiful: true },
    } as const;
    const mechanic = {
      cx: 260,
      cy: 100,
      semantic: { kind: 'rift-mechanic', mechanic: 'gate', state: 'open' },
    } as const;
    let description = view.updateDelve(delveModel([reward], [passage]), 560);
    expect(description).toContain('Sealed passage: northwest, far.');
    expect(description).toContain('Bountiful Delve cache active: northwest, medium distance.');
    expect(view.tooltipAt(100, 100, 20)).toBe('Sealed passage: northwest, far.');

    description = view.updateRift(
      {
        staticKey: 'test',
        staticGeometry: {},
        transform: {},
        mobs: [],
        objects: [mechanic],
        party: [],
        deathZones: [],
        corpse: null,
        player: { cx: 280, cy: 280, angle: 0 },
        areaLabel: 'Test Rift',
      } as unknown as RiftMapModel,
      560,
    );
    expect(description).toContain('Open gate: north, medium distance.');
    expect(view.tooltipAt(260, 100, 20)).toBe('Open gate: north, medium distance.');
  });

  it('write-elides localization while raw motion stays in the same sector and range band', () => {
    const stationName = vi.fn((type: string) => `Station ${type}`);
    const view = new MapSemanticAccessibilityCore({
      zone: (id) => id,
      dungeon: (id) => id,
      delve: (id) => id,
      station: stationName,
      poi: (zoneId, index) => `${zoneId}/${index}`,
      rift: (name) => name,
      npc: (id) => id,
      mob: (id) => id,
    });
    const model = {
      view: {},
      cursor: 'default',
      questAreas: [],
      npcs: [],
      gatherNodes: [],
      stations: [{ mx: 100, my: 100, stationId: 'forge', type: 'forge' }],
      services: [],
      navigation: [],
      player: { mx: 280, my: 280, angle: 0 },
      allies: [],
      party: [],
      portals: [],
      pois: [],
    } as unknown as MapPaintResult;
    const first = view.updateOverworld(model, 'Zone', 560);
    model.stations[0].mx = 101;
    model.stations[0].my = 102;
    const second = view.updateOverworld(model, 'Zone', 560);
    expect(second).toBe(first);
    expect(stationName).toHaveBeenCalledTimes(1);
  });

  it('semantically exposes the player, dungeon exits, bosses, NPCs, and party members', () => {
    const description = core().updateDungeon(
      {
        markers: [
          { kind: 'player', cx: 280, cy: 280, angle: 0 },
          { kind: 'exit', cx: 280, cy: 500 },
          { kind: 'gate', cx: 280, cy: 60 },
          { kind: 'npc', cx: 180, cy: 180, templateId: 'maelin' },
          {
            kind: 'mob',
            cx: 380,
            cy: 180,
            templateId: 'varkhul',
            aggro: true,
            boss: true,
          },
          { kind: 'party', cx: 180, cy: 380, cls: 'mage', dead: false },
        ],
      } as unknown as DungeonMapModel,
      'Molten Assembly',
      560,
    );

    expect(description).toContain('You');
    expect(description).toContain('Dungeon exit');
    expect(description).toContain('Sealed gate');
    expect(description).toContain('Point of interest: NPC maelin');
    expect(description).toContain('Boss attacking you: Mob varkhul');
    expect(description).toContain('Party member');
    expect(description).not.toContain('No meaningful markers are visible.');
  });

  it('reserves crowded summaries for every resource, station, and service identity', () => {
    const stationName = vi.fn((type: string) => `Station ${type}`);
    const zoneName = vi.fn((id: string) => `Zone ${id}`);
    const view = new MapSemanticAccessibilityCore({
      zone: zoneName,
      dungeon: (id) => id,
      delve: (id) => id,
      station: stationName,
      poi: (zoneId, index) => `${zoneId}/${index}`,
      rift: (name) => name,
      npc: (id) => id,
      mob: (id) => id,
    });
    const model = crowdedOverworldModel();

    const first = view.updateOverworld(model, 'Eastbrook Vale', 560);
    expect(first).toContain('You: center, near.');
    expect(first).toContain('Passage to Zone north');
    expect(first).toContain('Available quest');
    expect(first).toContain('Quest objective area');
    expect(first).toContain('Party member: Aria');
    expect(first).toContain('Ready ore node');
    expect(first).toContain('Ready wood node');
    expect(first).toContain('Ready herb node');
    for (const type of ['forge', 'kitchens', 'loom', 'toolworks']) {
      expect(first).toContain(`Crafting station: Station ${type}`);
    }
    expect(first).toContain('Service: Mailbox');
    expect(first).toContain('Service: Notice Board');
    expect(first).toContain('Additional markers: 12.');

    const stationCalls = stationName.mock.calls.length;
    const zoneCalls = zoneName.mock.calls.length;
    const second = view.updateOverworld(model, 'Eastbrook Vale', 560);
    expect(second).toBe(first);
    expect(stationName).toHaveBeenCalledTimes(stationCalls);
    expect(zoneName).toHaveBeenCalledTimes(zoneCalls);
  });

  it.each(GATHER_ACCESSIBILITY_CASES)(
    'names $type ready=$ready locked=$locked as "$label"',
    ({ type, ready, locked, label }) => {
      const model = {
        view: {},
        cursor: 'default',
        questAreas: [],
        npcs: [],
        gatherNodes: [
          { mx: 280, my: 280, nodeId: `${type}-${ready}-${locked}`, type, ready, locked },
        ],
        stations: [],
        services: [],
        navigation: [],
        player: null,
        allies: [],
        party: [],
        portals: [],
        pois: [],
      } as unknown as MapPaintResult;

      expect(core().updateOverworld(model, 'Eastbrook Vale', 560)).toContain(
        `${label}: center, near.`,
      );
    },
  );

  it('rebuilds cached prose when only the loaded language changes', () => {
    const view = core();
    const model = crowdedOverworldModel();
    setLanguage('en');
    const english = view.updateOverworld(model, 'Eastbrook Vale', 560);
    setLanguage('zh_CN');
    const chinese = view.updateOverworld(model, 'Eastbrook Vale', 560);
    expect(chinese).not.toBe(english);
    expect(chinese).toContain('可采集矿点');
  });

  it('relocalizes cached tooltips for groups omitted from a crowded summary', () => {
    const view = core();
    const semantics: MapInstanceSemantic[] = [
      { kind: 'rift-reward', reward: 'treasure', state: 'available' },
      { kind: 'rift-reward', reward: 'treasure', state: 'locked' },
      { kind: 'rift-reward', reward: 'treasure', state: 'opened' },
      { kind: 'rift-reward', reward: 'treasure', state: 'jammed' },
      { kind: 'rift-reward', reward: 'cache', state: 'available' },
      { kind: 'rift-reward', reward: 'cache', state: 'locked' },
      { kind: 'rift-reward', reward: 'cache', state: 'opened' },
      { kind: 'rift-reward', reward: 'cache', state: 'jammed' },
      { kind: 'rift-mechanic', mechanic: 'pylon', state: 'unlit' },
      { kind: 'rift-mechanic', mechanic: 'pylon', state: 'lit' },
      { kind: 'rift-mechanic', mechanic: 'sequence-rune', state: 'unlit' },
      { kind: 'rift-mechanic', mechanic: 'sequence-rune', state: 'lit' },
      { kind: 'rift-mechanic', mechanic: 'ice-goal', state: 'target' },
      { kind: 'rift-mechanic', mechanic: 'boulder-pad', state: 'target' },
      { kind: 'rift-mechanic', mechanic: 'boulder', state: 'movable' },
      { kind: 'rift-mechanic', mechanic: 'gate', state: 'sealed' },
      { kind: 'rift-mechanic', mechanic: 'boulder', state: 'placed' },
    ];
    const objects = semantics.map((semantic, index) => ({
      cx: index + 1 === semantics.length ? 500 : 100,
      cy: index + 1 === semantics.length ? 500 : 100,
      semantic,
    }));
    const model = {
      staticKey: 'test',
      staticGeometry: {},
      transform: {},
      mobs: [],
      objects,
      party: [],
      deathZones: [],
      corpse: null,
      player: { cx: 280, cy: 280, angle: 0 },
      areaLabel: 'Test Rift',
    } as unknown as RiftMapModel;

    setLanguage('en');
    view.updateRift(model, 560);
    expect(view.tooltipAt(500, 500, 20)).toBe('Placed boulder: southeast, far.');

    model.objects.push({
      cx: 400,
      cy: 400,
      semantic: { kind: 'rift-descent' },
    });
    model.mobs.push({ cx: 200, cy: 200, aggro: false } as never);
    view.updateRift(model, 560);
    setLanguage('zh_CN');
    view.updateRift(model, 560);
    expect(view.tooltipAt(500, 500, 20)).toBe('已就位的巨石：东南方，远处。');
  });

  it('describes only disclosure-safe battleground markers plus both static flag objectives', () => {
    const model: BgMapModel = {
      active: true,
      myTeam: 0,
      self: { x: 0, z: 0, facing: 0 },
      mates: [{ x: 0, z: 100, dead: false, carrying: true }],
      halfX: 100,
      halfZ: 200,
    };
    const description = core().updateBattleground(model, 'Thornhollow Fields', 560);
    expect(description).toContain('You: center, near.');
    expect(description).toContain('Teammate carrying the flag: north');
    expect(description).toContain('Your flag stand: south, medium distance.');
    expect(description).toContain('Enemy flag stand: north, medium distance.');
    expect(description).not.toContain('Hostile enemy');
  });

  it('keeps your flag stand south and the enemy stand north for either team orientation', () => {
    const model: BgMapModel = {
      active: true,
      myTeam: 1,
      self: { x: 0, z: 0, facing: Math.PI },
      mates: [],
      halfX: 100,
      halfZ: 200,
    };
    const description = core().updateBattleground(model, 'Thornhollow Fields', 560);
    expect(description).toContain('Your flag stand: south, medium distance.');
    expect(description).toContain('Enemy flag stand: north, medium distance.');
  });

  it("uses the painter's exact 18px field inset for battleground distance bands", () => {
    const canvasSize = 560;
    const scale = bgMapFitScale(canvasSize, 100, 200);
    expect(BG_MAP_FIELD_PAD_PX).toBe(18);
    expect(scale).toBeCloseTo(1.31, 10);
    expect(bgMapCanvasY(200, canvasSize, scale)).toBeCloseTo(18, 10);

    const model: BgMapModel = {
      active: true,
      myTeam: 0,
      self: { x: 0, z: 0, facing: 0 },
      // With the old full-canvas projection this was 245px away (far). The
      // painted, padded projection is 229.25px away and therefore medium.
      mates: [{ x: 0, z: 175, dead: false, carrying: false }],
      halfX: 100,
      halfZ: 200,
    };
    expect(core().updateBattleground(model, 'Thornhollow Fields', canvasSize)).toContain(
      'Teammate: north, medium distance.',
    );
  });

  it('does not append a second rank to a localized Rift entrance name', () => {
    const view = core();
    expect(
      view.navigationText({
        kind: 'rift-entrance',
        mx: 0,
        my: 0,
        name: 'Storm Rift',
        rank: 'S',
      }),
    ).toBe('Rift entrance: Storm Rift (S)');
  });
});
