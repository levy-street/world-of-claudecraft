import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BG_X, DELVE_LIST, DELVE_X_MIN, ZONES } from '../src/sim/data';
import type { QuestObjectiveRef } from '../src/sim/quest_targets';
import type { StationType } from '../src/sim/types';
import type { ContinentZoneRegion } from '../src/ui/continent_map_view';
import { Hud } from '../src/ui/hud';
import type { DelveDrawModel } from '../src/ui/hud/delve/delve_map_painter';
import { MapMarkerInteractionController, MapMarkerTooltipContent } from '../src/ui/hud/map';
import type { RiftMapModel } from '../src/ui/hud/rift/rift_map_core';
import { MapSemanticAccessibilityCore } from '../src/ui/map_semantic_accessibility_core';
import type {
  MapGatherNodeMarker,
  MapNavigationMarker,
  MapNpcMarker,
  MapPointMarkerHit,
  MapQuestAreaMarker,
  MapServiceMarker,
  MapStationMarker,
  MapViewRect,
} from '../src/ui/map_window_view';
import type { WindowDragDeps } from '../src/ui/window_drag';
import type { IWorld, RiftFloorView } from '../src/world_api';

const mapPointMarkerHitsIntoCalls = vi.hoisted(() => vi.fn());
const questAreaObjectivesAtIntoCalls = vi.hoisted(() => vi.fn());
const installWindowDragCalls = vi.hoisted(() => vi.fn());

vi.mock('../src/ui/window_drag', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/ui/window_drag')>();
  return {
    ...actual,
    installWindowDrag: (deps: WindowDragDeps) => {
      installWindowDragCalls(deps);
      return { cancel: () => {}, destroy: () => {} };
    },
  };
});

vi.mock('../src/ui/map_window_view', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/ui/map_window_view')>();
  return {
    ...actual,
    mapPointMarkerHitsInto: (...args: Parameters<typeof actual.mapPointMarkerHitsInto>) => {
      mapPointMarkerHitsIntoCalls(...args);
      return actual.mapPointMarkerHitsInto(...args);
    },
    questAreaObjectivesAtInto: (...args: Parameters<typeof actual.questAreaObjectivesAtInto>) => {
      questAreaObjectivesAtIntoCalls(...args);
      return actual.questAreaObjectivesAtInto(...args);
    },
  };
});

interface MapCanvas extends HTMLCanvasElement {
  getBoundingClientRect(): DOMRect;
}

let hudElements = new Map<string, HTMLElement>();

function fakeElement(tagName: string): HTMLElement {
  return {
    id: '',
    tagName: tagName.toUpperCase(),
    style: { cursor: '', display: '' },
  } as unknown as HTMLElement;
}

function installFakeDocument(): void {
  hudElements = new Map();
  vi.stubGlobal('document', {
    createElement: (tagName: string) => fakeElement(tagName),
    querySelector: (selector: string) =>
      selector.startsWith('#') ? (hudElements.get(selector.slice(1)) ?? null) : null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
    body: {
      append: (...elements: HTMLElement[]) => {
        for (const element of elements) if (element.id) hudElements.set(element.id, element);
      },
      replaceChildren: () => hudElements.clear(),
    },
  } as unknown as Document);
}

interface MapHudHarness {
  initWindowManagement(): void;
  showMapTipAt(
    mapCanvas: HTMLCanvasElement,
    clientX: number,
    clientY: number,
    touchTarget?: boolean,
  ): boolean;
  updateMapWindow(): void;
  sim: IWorld;
  mapLevel: 'zone' | 'continent';
  mapHoverZone: string | null;
  mapZoom: number;
  mapCenter: { x: number; z: number } | null;
  mapPing: { x: number; z: number } | null;
  mapZoneOverride: string | null;
  mapZoneId: string;
  lastZoneId: string;
  mapDrag: unknown;
  mapView: MapViewRect | null;
  mapQuestAreas: MapQuestAreaMarker[];
  mapNpcMarkers: MapNpcMarker[];
  mapGatherNodes: MapGatherNodeMarker[];
  mapStations: MapStationMarker[];
  mapServices: MapServiceMarker[];
  mapNavigationMarkers: MapNavigationMarker[];
  mapPointHitsScratch: MapPointMarkerHit[];
  mapQuestObjectiveScratch: QuestObjectiveRef[];
  mapSemanticAccessibility: MapSemanticAccessibilityCore;
  mapMarkerInteraction: MapMarkerInteractionController;
  mapGatherTipMemo: unknown;
  continentRegions: ContinentZoneRegion[];
  questGiverTooltipHtml(marker: MapNpcMarker): string;
  stationMapTooltipHtml(marker: MapStationMarker): string;
  serviceMapTooltipHtml(marker: MapServiceMarker): string;
  navigationMapTooltipHtml(marker: MapNavigationMarker): string;
  gatherNodeMapTooltipHtml(marker: MapGatherNodeMarker): string;
  questAreaTooltipHtml(refs: readonly QuestObjectiveRef[], activeCount?: number): string;
  paintTooltipAt(html: string, clientX: number, clientY: number): void;
  syncAnyWindowOpenState(): void;
  setWindowPixelPosition(element: HTMLElement, left: number, top: number, rect?: DOMRect): void;
  setDisplay(element: HTMLElement, display: string): void;
  setStyleProp(element: HTMLElement, prop: string, value: string): void;
  setText(element: HTMLElement, text: string): void;
  mapZoneBg(): HTMLCanvasElement;
  mapZoneRegion(): { minX: number; maxX: number; minZ: number; maxZ: number };
  mapPainter: {
    paintOverworld(): {
      view: MapViewRect;
      questAreas: MapQuestAreaMarker[];
      npcs: MapNpcMarker[];
      gatherNodes: MapGatherNodeMarker[];
      stations: MapStationMarker[];
      services: MapServiceMarker[];
      navigation: MapNavigationMarker[];
      cursor: 'default' | 'grab';
    };
  };
  bgMapPainter: { paint(): void };
  delvePainter: { paintWorldMapDelve(): DelveDrawModel | null };
  riftPainter: { paintWorldMap(): RiftMapModel | null };
  continentPainter: {
    paintContinent(): { regions: ContinentZoneRegion[] };
  };
}

function semanticCore(): MapSemanticAccessibilityCore {
  return new MapSemanticAccessibilityCore({
    zone: (id) => ZONES.find((zone) => zone.id === id)?.name ?? id,
    dungeon: (id) => id,
    delve: (id) => DELVE_LIST.find((delve) => delve.id === id)?.name ?? id,
    station: (type) => type,
    poi: (zoneId, index) => `${zoneId}/${index}`,
    rift: (name, rank) => `${name}${rank ? ` (${rank})` : ''}`,
  });
}

function wireTooltipResolvers(hud: MapHudHarness): void {
  const controller = new MapMarkerInteractionController({
    names: {
      zone: (id) => ZONES.find((zone) => zone.id === id)?.name ?? id,
      dungeon: (id) => id,
      delve: (id) => DELVE_LIST.find((delve) => delve.id === id)?.name ?? id,
      station: (type) => type,
      poi: (zoneId, index) => `${zoneId}/${index}`,
      rift: (name, rank) => `${name}${rank ? ` (${rank})` : ''}`,
    },
    npc: (marker) => hud.questGiverTooltipHtml(marker),
    navigation: (marker) => hud.navigationMapTooltipHtml(marker),
    station: (marker) => hud.stationMapTooltipHtml(marker),
    service: (marker) => hud.serviceMapTooltipHtml(marker),
    gather: (marker) => hud.gatherNodeMapTooltipHtml(marker),
    questArea: (refs, count) => hud.questAreaTooltipHtml(refs, count),
    paint: (html, x, y) => hud.paintTooltipAt(html, x, y),
    clearMemo: () => {
      hud.mapGatherTipMemo = null;
    },
  });
  controller.questAreas = hud.mapQuestAreas;
  controller.npcs = hud.mapNpcMarkers;
  controller.gatherNodes = hud.mapGatherNodes;
  controller.stations = hud.mapStations;
  controller.services = hud.mapServices;
  controller.navigation = hud.mapNavigationMarkers;
  hud.mapMarkerInteraction = controller;
  const proxy = <K extends keyof MapMarkerInteractionController>(
    legacy: keyof MapHudHarness,
    key: K,
  ): void => {
    Object.defineProperty(hud, legacy, {
      configurable: true,
      get: () => controller[key],
      set: (value) => {
        controller[key] = value;
      },
    });
  };
  proxy('mapQuestAreas', 'questAreas');
  proxy('mapNpcMarkers', 'npcs');
  proxy('mapGatherNodes', 'gatherNodes');
  proxy('mapStations', 'stations');
  proxy('mapServices', 'services');
  proxy('mapNavigationMarkers', 'navigation');
  Object.defineProperty(hud, 'mapPointHitsScratch', {
    configurable: true,
    get: () => controller.pointHits,
  });
  Object.defineProperty(hud, 'mapQuestObjectiveScratch', {
    configurable: true,
    get: () => controller.questObjectives,
  });
  Object.defineProperty(hud, 'mapSemanticAccessibility', {
    configurable: true,
    get: () => controller.semantics,
  });
}

const NPC: MapNpcMarker = {
  mx: 140,
  my: 200,
  kind: 'available',
  quests: [],
};
const STATION: MapStationMarker = {
  mx: 140,
  my: 200,
  stationId: 'station',
  type: 'forge' as StationType,
};
const SERVICE: MapServiceMarker = { mx: 140, my: 200, kind: 'mailbox' };
const NAVIGATION: MapNavigationMarker = {
  mx: 140,
  my: 200,
  kind: 'delve-entrance',
  delveId: DELVE_LIST[0].id,
};
const GATHER: MapGatherNodeMarker = {
  mx: 140,
  my: 200,
  nodeId: 'node',
  type: 'ore',
  ready: true,
  locked: false,
};
const QUEST_AREA: MapQuestAreaMarker = {
  mx: 140,
  my: 200,
  radius: 8,
  objectives: [],
  numbers: [],
};
const VIEW: MapViewRect = {
  spanX: 300,
  spanZ: 300,
  minX: -150,
  maxX: 150,
  minZ: -150,
  maxZ: 150,
};

function canvasFixture(): MapCanvas {
  const canvas = document.createElement('canvas') as MapCanvas;
  canvas.id = 'map-canvas';
  canvas.width = 560;
  canvas.height = 560;
  Object.defineProperty(canvas, 'getContext', {
    value: vi.fn(() => ({}) as CanvasRenderingContext2D),
  });
  canvas.getBoundingClientRect = () =>
    ({
      x: 100,
      y: 50,
      left: 100,
      top: 50,
      width: 280,
      height: 280,
      right: 380,
      bottom: 330,
      toJSON: () => ({}),
    }) as DOMRect;
  document.body.append(canvas);
  return canvas;
}

function appendHudElement(id: string): HTMLElement {
  const element = document.createElement('div');
  element.id = id;
  document.body.append(element);
  return element;
}

function markerHarness(): {
  hud: MapHudHarness;
  paint: ReturnType<typeof vi.fn>;
  calls: string[];
} {
  const hud = Object.create(Hud.prototype) as unknown as MapHudHarness;
  const calls: string[] = [];
  const paint = vi.fn();
  Object.assign(hud, {
    mapQuestAreas: [],
    mapNpcMarkers: [NPC],
    mapGatherNodes: [GATHER],
    mapStations: [STATION],
    mapServices: [SERVICE],
    mapNavigationMarkers: [],
    mapPointHitsScratch: [],
    mapQuestObjectiveScratch: [],
    mapSemanticAccessibility: semanticCore(),
    questGiverTooltipHtml: () => {
      calls.push('npc');
      return '';
    },
    stationMapTooltipHtml: () => {
      calls.push('station');
      return '';
    },
    serviceMapTooltipHtml: () => {
      calls.push('service');
      return '';
    },
    navigationMapTooltipHtml: () => {
      calls.push('navigation');
      return '';
    },
    gatherNodeMapTooltipHtml: () => {
      calls.push('gather');
      return '<div>gather</div>';
    },
    questAreaTooltipHtml: () => '',
    paintTooltipAt: paint,
  });
  wireTooltipResolvers(hud);
  return { hud, paint, calls };
}

function worldFixture(): IWorld {
  const zone = ZONES[0];
  return {
    player: {
      id: 1,
      name: 'Tester',
      facing: 0,
      pos: {
        x: ((zone.xMin ?? -300) + (zone.xMax ?? 300)) / 2,
        z: (zone.zMin + zone.zMax) / 2,
      },
    },
    playerId: 1,
    entities: new Map(),
    bgInfo: null,
    delveRun: null,
    riftFloor: null,
    cfg: { seed: 1, playerClass: 'warrior' },
  } as unknown as IWorld;
}

function lifecycleHarness(): {
  hud: MapHudHarness;
  canvas: MapCanvas;
  paintTooltip: ReturnType<typeof vi.fn>;
} {
  const canvas = canvasFixture();
  appendHudElement('map-summary');
  appendHudElement('map-marker-summary');
  appendHudElement('map-level-toggle');
  appendHudElement('map-zoom');
  const zone = ZONES[0];
  const paintTooltip = vi.fn();
  const hud = Object.create(Hud.prototype) as unknown as MapHudHarness;
  Object.assign(hud, {
    sim: worldFixture(),
    mapLevel: 'zone',
    mapHoverZone: null,
    mapZoom: 1,
    mapCenter: null,
    mapPing: null,
    mapZoneOverride: null,
    mapZoneId: zone.id,
    lastZoneId: zone.id,
    mapDrag: null,
    mapView: null,
    mapQuestAreas: [],
    mapNpcMarkers: [],
    mapGatherNodes: [],
    mapStations: [],
    mapServices: [],
    mapNavigationMarkers: [],
    mapPointHitsScratch: [],
    mapQuestObjectiveScratch: [],
    mapSemanticAccessibility: semanticCore(),
    mapGatherTipMemo: { nodeId: 'stale' },
    continentRegions: [],
    setDisplay: vi.fn(),
    setStyleProp: vi.fn((element: HTMLElement, prop: string, value: string) => {
      (element.style as unknown as Record<string, string>)[prop] = value;
    }),
    setText: vi.fn(),
    mapZoneBg: () => document.createElement('canvas'),
    mapZoneRegion: () => ({ minX: -150, maxX: 150, minZ: -150, maxZ: 150 }),
    mapPainter: {
      paintOverworld: () => ({
        view: VIEW,
        questAreas: [QUEST_AREA],
        npcs: [NPC],
        gatherNodes: [GATHER],
        stations: [STATION],
        services: [SERVICE],
        navigation: [NAVIGATION],
        player: { mx: 280, my: 280, angle: 0 },
        allies: [],
        party: [],
        portals: [],
        pois: [],
        cursor: 'default' as const,
      }),
    },
    bgMapPainter: { paint: vi.fn() },
    delvePainter: { paintWorldMapDelve: vi.fn(() => null) },
    riftPainter: { paintWorldMap: vi.fn(() => null) },
    continentPainter: {
      paintContinent: () => ({
        regions: [
          {
            zoneId: zone.id,
            rect: { mx: 0, my: 0, w: 10, h: 10 },
            labelX: 5,
            labelY: 5,
            isCurrent: true,
            isHovered: false,
            levelMin: zone.levelRange[0],
            levelMax: zone.levelRange[1],
          },
        ],
      }),
    },
    questGiverTooltipHtml: () => '<div>npc</div>',
    stationMapTooltipHtml: () => '<div>station</div>',
    serviceMapTooltipHtml: () => '<div>service</div>',
    navigationMapTooltipHtml: () => '<div>navigation</div>',
    gatherNodeMapTooltipHtml: () => '<div>gather</div>',
    questAreaTooltipHtml: () => '<div>area</div>',
    paintTooltipAt: paintTooltip,
    hideTooltip: vi.fn(),
  });
  wireTooltipResolvers(hud);
  return { hud, canvas, paintTooltip };
}

beforeEach(() => {
  installFakeDocument();
  installWindowDragCalls.mockClear();
  mapPointMarkerHitsIntoCalls.mockClear();
  questAreaObjectivesAtIntoCalls.mockClear();
});

afterEach(() => vi.unstubAllGlobals());

describe('Hud zone-map marker interaction', () => {
  it('converts client coordinates to backing pixels and passes each marker array in draw order', () => {
    const canvas = canvasFixture();
    const { hud, paint, calls } = markerHarness();
    hud.mapMarkerInteraction.refreshGeometry(canvas);

    expect(hud.showMapTipAt(canvas, 170, 150)).toBe(true);

    expect(mapPointMarkerHitsIntoCalls).toHaveBeenCalledWith(
      [NPC],
      [],
      [SERVICE],
      [STATION],
      [GATHER],
      140,
      200,
      10,
      hud.mapPointHitsScratch,
    );
    expect(calls).toEqual(['npc', 'station', 'service', 'gather']);
    expect(paint).toHaveBeenCalledWith('<div>gather</div>', 170, 150);
  });

  it('uses backing-scaled touch radius while hover keeps the glyph radius', () => {
    const canvas = canvasFixture();
    const { hud, paint } = markerHarness();
    hud.mapMarkerInteraction.refreshGeometry(canvas);
    hud.mapNpcMarkers = [];
    hud.mapStations = [];
    hud.mapServices = [];
    hud.mapGatherNodes = [{ ...GATHER, mx: 175 }];

    expect(hud.showMapTipAt(canvas, 170, 150)).toBe(false);
    expect(hud.showMapTipAt(canvas, 170, 150, true)).toBe(true);

    expect(mapPointMarkerHitsIntoCalls.mock.calls.map((call) => call[7])).toEqual([10, 40]);
    expect(paint).toHaveBeenCalledTimes(1);
  });

  it('fills the Hud-owned quest scratch only when quest areas can answer the pointer', () => {
    const canvas = canvasFixture();
    const { hud, paint } = markerHarness();
    hud.mapMarkerInteraction.refreshGeometry(canvas);
    const objective: QuestObjectiveRef = { questId: 'quest', objectiveIndex: 0 };
    const area = { ...QUEST_AREA, objectives: [objective] };
    const areaTip = vi.fn((_refs: QuestObjectiveRef[], activeCount?: number) =>
      activeCount === 1 ? '<div>area</div>' : '',
    );
    hud.mapNpcMarkers = [];
    hud.mapStations = [];
    hud.mapServices = [];
    hud.mapGatherNodes = [];
    hud.mapQuestAreas = [area];
    hud.questAreaTooltipHtml = areaTip;

    expect(hud.showMapTipAt(canvas, 170, 150)).toBe(true);
    expect(questAreaObjectivesAtIntoCalls).toHaveBeenCalledWith(
      [area],
      140,
      200,
      hud.mapQuestObjectiveScratch,
    );
    expect(areaTip).toHaveBeenCalledWith(hud.mapQuestObjectiveScratch, 1);
    expect(hud.mapQuestObjectiveScratch[0]).toBe(objective);
    expect(paint).toHaveBeenCalledWith('<div>area</div>', 170, 150);

    const areaCallCount = questAreaObjectivesAtIntoCalls.mock.calls.length;
    hud.mapQuestAreas = [];
    hud.mapNpcMarkers = [{ ...NPC, mx: 500, my: 500 }];
    expect(hud.showMapTipAt(canvas, 170, 150)).toBe(false);
    expect(questAreaObjectivesAtIntoCalls).toHaveBeenCalledTimes(areaCallCount);
    expect(areaTip).toHaveBeenCalledTimes(1);
  });

  it('lets the globally nearest point marker win before category tie priority', () => {
    const canvas = canvasFixture();
    const { hud, calls } = markerHarness();
    hud.mapMarkerInteraction.refreshGeometry(canvas);
    hud.mapNpcMarkers = [{ ...NPC, mx: 148 }];
    hud.mapStations = [{ ...STATION, mx: 146 }];
    hud.mapServices = [{ ...SERVICE, mx: 144 }];
    hud.mapGatherNodes = [{ ...GATHER, mx: 142 }];
    hud.questGiverTooltipHtml = () => {
      calls.push('npc');
      return '<div>npc</div>';
    };

    expect(hud.showMapTipAt(canvas, 170, 150)).toBe(true);
    expect(calls).toEqual(['gather']);
  });

  it('gives an exact-distance navigation painting priority over lower landmark layers', () => {
    const canvas = canvasFixture();
    const { hud, calls, paint } = markerHarness();
    hud.mapMarkerInteraction.refreshGeometry(canvas);
    hud.mapNavigationMarkers = [NAVIGATION];
    hud.navigationMapTooltipHtml = () => {
      calls.push('navigation');
      return '<div>navigation</div>';
    };

    expect(hud.showMapTipAt(canvas, 170, 150)).toBe(true);
    expect(calls).toEqual(['npc', 'navigation']);
    expect(paint).toHaveBeenCalledWith('<div>navigation</div>', 170, 150);
  });

  it('uses content names for route tooltips and escapes generated Rift names', () => {
    const semantics = semanticCore();
    const content = new MapMarkerTooltipContent({} as IWorld);
    const navigationHtml = (marker: MapNavigationMarker): string =>
      content.navigation(semantics.navigationText(marker));
    expect(navigationHtml(NAVIGATION)).toContain(DELVE_LIST[0].name);
    expect(
      navigationHtml({
        kind: 'world-passage',
        mx: 0,
        my: 0,
        portalId: 'test',
        destinationZoneId: ZONES[1].id,
      }),
    ).toContain(ZONES[1].name);
    const rift = navigationHtml({
      kind: 'rift-entrance',
      mx: 0,
      my: 0,
      name: '<Rift>',
      rank: 'S',
    });
    expect(rift).toContain('&lt;Rift&gt;');
    expect(rift).not.toContain('<Rift>');
    expect(rift).toContain('(S)');
  });

  it('uses the same localized state and location copy for instance hover and touch tips', () => {
    const canvas = canvasFixture();
    const { hud, paint } = markerHarness();
    hud.mapMarkerInteraction.refreshGeometry(canvas);
    hud.mapNpcMarkers = [];
    hud.mapGatherNodes = [];
    hud.mapStations = [];
    hud.mapServices = [];
    const passage = {
      cx: 140,
      cy: 200,
      semantic: { kind: 'delve-passage', state: 'sealed' },
    } as const;
    hud.mapSemanticAccessibility.updateDelve(
      {
        mobs: [],
        rewards: [],
        navigation: [passage],
        party: [],
        player: { cx: 280, cy: 280 },
        areaLabel: 'Test Delve',
      },
      560,
    );
    expect(hud.showMapTipAt(canvas, 170, 150)).toBe(true);
    expect(paint).toHaveBeenLastCalledWith(
      '<div class="tt-title">Sealed passage: northwest, medium distance.</div>',
      170,
      150,
    );
    hud.mapSemanticAccessibility.updateDelve(
      {
        mobs: [],
        rewards: [],
        navigation: [{ ...passage, semantic: { kind: 'delve-passage', state: 'open' } }],
        party: [],
        player: { cx: 280, cy: 280 },
        areaLabel: 'Test Delve',
      },
      560,
    );
    expect(hud.showMapTipAt(canvas, 170, 150)).toBe(true);
    expect(paint.mock.lastCall?.[0]).toContain('Open passage');

    const reward = {
      cx: 175,
      cy: 200,
      semantic: { kind: 'delve-reward', reward: 'cache', state: 'active', bountiful: false },
    } as const;
    hud.mapSemanticAccessibility.updateDelve(
      {
        mobs: [],
        rewards: [reward],
        navigation: [],
        party: [],
        player: { cx: 280, cy: 280 },
        areaLabel: 'Test Delve',
      },
      560,
    );
    expect(hud.showMapTipAt(canvas, 170, 150)).toBe(false);
    expect(hud.showMapTipAt(canvas, 170, 150, true)).toBe(true);
    expect(paint).toHaveBeenLastCalledWith(
      '<div class="tt-title">Delve cache active: northwest, medium distance.</div>',
      170,
      150,
    );
  });

  it.each(['locked', 'active', 'opened'] as const)(
    'keeps the %s reward state explicit in the semantic tooltip',
    (state) => {
      const canvas = canvasFixture();
      const { hud, paint } = markerHarness();
      hud.mapMarkerInteraction.refreshGeometry(canvas);
      hud.mapNpcMarkers = [];
      hud.mapGatherNodes = [];
      hud.mapStations = [];
      hud.mapServices = [];
      hud.mapSemanticAccessibility.updateDelve(
        {
          mobs: [],
          rewards: [
            {
              cx: 140,
              cy: 200,
              semantic: { kind: 'delve-reward', reward: 'reliquary', state, bountiful: false },
            },
          ],
          navigation: [],
          party: [],
          player: { cx: 280, cy: 280 },
          areaLabel: 'Test Delve',
        },
        560,
      );
      expect(hud.showMapTipAt(canvas, 170, 150)).toBe(true);
      expect(paint.mock.lastCall?.[0]).toContain(
        state === 'locked'
          ? 'Locked reliquary'
          : state === 'active'
            ? 'Reliquary rite active'
            : 'Reliquary opened',
      );
    },
  );

  it('reuses cached projection geometry until a bounded map-paint refresh', () => {
    const canvas = canvasFixture();
    let left = 100;
    let size = 280;
    const readRect = vi.fn(
      () =>
        ({
          x: left,
          y: 50,
          left,
          top: 50,
          width: size,
          height: size,
          right: left + size,
          bottom: 50 + size,
          toJSON: () => ({}),
        }) as DOMRect,
    );
    canvas.getBoundingClientRect = readRect;
    const { hud } = markerHarness();

    expect(hud.showMapTipAt(canvas, 170, 150)).toBe(false);
    expect(readRect).not.toHaveBeenCalled();

    hud.mapMarkerInteraction.refreshGeometry(canvas);
    expect(hud.showMapTipAt(canvas, 170, 150)).toBe(true);
    expect(hud.showMapTipAt(canvas, 170, 150)).toBe(true);
    expect(readRect).toHaveBeenCalledTimes(1);

    left = 30;
    size = 140;
    expect(hud.showMapTipAt(canvas, 65, 100)).toBe(false);
    expect(readRect).toHaveBeenCalledTimes(1);

    hud.mapMarkerInteraction.refreshGeometry(canvas);
    expect(hud.showMapTipAt(canvas, 65, 100)).toBe(true);
    expect(readRect).toHaveBeenCalledTimes(2);
  });

  it('refreshes cached projection geometry only when the map window drag commits', () => {
    const canvas = canvasFixture();
    let left = 100;
    const readRect = vi.fn(
      () =>
        ({
          x: left,
          y: 50,
          left,
          top: 50,
          width: 280,
          height: 280,
          right: left + 280,
          bottom: 330,
          toJSON: () => ({}),
        }) as DOMRect,
    );
    canvas.getBoundingClientRect = readRect;
    const { hud } = markerHarness();
    Object.assign(hud, {
      windowObserver: null,
      syncAnyWindowOpenState: vi.fn(),
      setWindowPixelPosition: (element: HTMLElement, nextLeft: number) => {
        if (element.id === 'map-window') left = nextLeft;
      },
    });
    vi.stubGlobal(
      'MutationObserver',
      class {
        observe(): void {}
      },
    );
    vi.stubGlobal('window', { addEventListener: vi.fn() });

    hud.initWindowManagement();
    const dragDeps = installWindowDragCalls.mock.lastCall?.[0] as WindowDragDeps | undefined;
    expect(dragDeps).toBeDefined();
    hud.mapMarkerInteraction.refreshGeometry(canvas);
    expect(hud.showMapTipAt(canvas, 170, 150)).toBe(true);
    expect(readRect).toHaveBeenCalledTimes(1);

    dragDeps?.commitWindow({ id: 'bags' } as HTMLElement, 60, 50, {} as DOMRect);
    expect(hud.showMapTipAt(canvas, 170, 150)).toBe(true);
    expect(readRect).toHaveBeenCalledTimes(1);

    dragDeps?.commitWindow({ id: 'map-window' } as HTMLElement, 30, 50, {} as DOMRect);
    expect(hud.showMapTipAt(canvas, 170, 150)).toBe(false);
    expect(hud.showMapTipAt(canvas, 100, 150)).toBe(true);
    expect(readRect).toHaveBeenCalledTimes(2);
  });
});

describe('Hud zone-map marker lifecycle', () => {
  it('clears every zone hit target on rift, battleground, delve, and continent transitions', () => {
    const { hud, canvas, paintTooltip } = lifecycleHarness();
    const zone = ZONES[0];
    const world = hud.sim as unknown as {
      player: { pos: { x: number; z: number } };
      delveRun: unknown;
      riftFloor: RiftFloorView | null;
    };
    const assertZoneMarkers = (): void => {
      expect(hud.mapQuestAreas).toEqual([QUEST_AREA]);
      expect(hud.mapNpcMarkers).toEqual([NPC]);
      expect(hud.mapGatherNodes).toEqual([GATHER]);
      expect(hud.mapStations).toEqual([STATION]);
      expect(hud.mapServices).toEqual([SERVICE]);
      expect(hud.mapNavigationMarkers).toEqual([NAVIGATION]);
      expect(hud.showMapTipAt(canvas, 170, 150)).toBe(true);
    };
    const assertNoZoneHits = (): void => {
      expect(hud.mapQuestAreas).toEqual([]);
      expect(hud.mapNpcMarkers).toEqual([]);
      expect(hud.mapGatherNodes).toEqual([]);
      expect(hud.mapStations).toEqual([]);
      expect(hud.mapServices).toEqual([]);
      expect(hud.mapNavigationMarkers).toEqual([]);
      expect(hud.mapSemanticAccessibility.instanceMarkers).toEqual([]);
      expect(hud.mapGatherTipMemo).toBeNull();
      expect(hud.mapView).toBeNull();
      expect(hud.showMapTipAt(canvas, 170, 150, true)).toBe(false);
    };
    const returnToZone = (): void => {
      const zone = ZONES[0];
      world.player.pos.x = ((zone.xMin ?? -300) + (zone.xMax ?? 300)) / 2;
      world.player.pos.z = (zone.zMin + zone.zMax) / 2;
      world.delveRun = null;
      world.riftFloor = null;
      hud.mapLevel = 'zone';
      hud.updateMapWindow();
      assertZoneMarkers();
    };

    hud.updateMapWindow();
    assertZoneMarkers();

    world.riftFloor = {
      eventId: null,
      instanceId: 1,
      seed: 1,
      baseLevel: 20,
      floorIndex: 0,
      floorCount: 3,
      origin: { x: 4000, z: -1000 },
      contentId: 'test',
      contentHash: 'test',
      upgrade: null,
      name: 'The Test Rift',
      themeName: 'Test',
      tier: 'B',
    };
    hud.mapLevel = 'continent';
    hud.mapCenter = { x: 1, z: 2 };
    hud.mapPing = { x: 3, z: 4 };
    hud.mapZoneOverride = zone.id;
    hud.mapDrag = {};
    hud.updateMapWindow();
    assertNoZoneHits();
    expect(hud.mapLevel).toBe('zone');
    expect(hud.mapCenter).toBeNull();
    expect(hud.mapPing).toBeNull();
    expect(hud.mapZoneOverride).toBeNull();
    expect(hud.mapDrag).toBeNull();

    world.riftFloor = null;
    world.player.pos.x = BG_X;
    hud.updateMapWindow();
    assertNoZoneHits();

    returnToZone();
    world.player.pos.x = DELVE_X_MIN;
    world.delveRun = {
      delveId: DELVE_LIST[0].id,
      modules: [],
      moduleIndex: 0,
      origin: { x: DELVE_X_MIN, z: 0 },
    };
    hud.updateMapWindow();
    assertNoZoneHits();

    returnToZone();
    hud.mapLevel = 'continent';
    hud.updateMapWindow();
    assertNoZoneHits();
    expect(hud.continentRegions).toHaveLength(1);

    expect(paintTooltip).toHaveBeenCalledTimes(3);
  });

  it('wires the exact returned Rift model into the hidden summary and mechanic hit layer', () => {
    const { hud, canvas, paintTooltip } = lifecycleHarness();
    const world = hud.sim as unknown as { riftFloor: RiftFloorView | null };
    world.riftFloor = {
      eventId: null,
      instanceId: 1,
      seed: 1,
      baseLevel: 20,
      floorIndex: 0,
      floorCount: 3,
      origin: { x: 4000, z: -1000 },
      contentId: 'test',
      contentHash: 'test',
      upgrade: null,
      name: 'The Test Rift',
      themeName: 'Test',
      tier: 'B',
    };
    const mechanic = {
      cx: 140,
      cy: 200,
      semantic: { kind: 'rift-mechanic', mechanic: 'orb', state: 'active' },
    } as const;
    hud.riftPainter.paintWorldMap = vi.fn(
      () =>
        ({
          staticKey: 'test',
          staticGeometry: { walkable: [], structures: [], clipped: [] },
          transform: {},
          mobs: [],
          objects: [mechanic],
          party: [],
          deathZones: [],
          corpse: null,
          player: { cx: 280, cy: 280, angle: 0 },
          areaLabel: 'The Test Rift',
        }) as unknown as RiftMapModel,
    );

    hud.updateMapWindow();

    expect(hud.mapSemanticAccessibility.instanceMarkers).toEqual([mechanic]);
    expect(hud.showMapTipAt(canvas, 170, 150)).toBe(true);
    expect(paintTooltip.mock.lastCall?.[0]).toContain('Active orb');
    expect(hud.setText).toHaveBeenCalledWith(
      hudElements.get('map-marker-summary'),
      expect.stringContaining('Active orb'),
    );
  });
});
