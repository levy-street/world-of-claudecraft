// Declarative live-world touch-up layer for Fenbridge town layout overrides.
// Pure simulation leaf: no DOM, no Three.js, no randomness, no clocks.

import { FENBRIDGE_LAYOUT } from './fenbridge_layout';
import {
  deepFreeze,
  distancePointToObb,
  facingToward,
  indexById,
  localToWorld,
  makePlacedTownBuilding,
  type Obb2,
  type PlacedTownBuilding,
  type Point2,
  placedTownSeat,
  scalePlacedTownMeasurements,
} from './placed_town_kit';
import type { WorldContent } from './types';

let activeWorldGetter: (() => WorldContent) | null = null;

export function bindFenbridgeActiveWorldGetter(getter: () => WorldContent): void {
  activeWorldGetter = getter;
}

function getBoundActiveWorld(): WorldContent | undefined {
  return activeWorldGetter?.();
}

export interface FenbridgeBuildingTouchup {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly rot: number;
}

export interface FenbridgePropTouchup {
  readonly x: number;
  readonly z: number;
  readonly rot?: number;
}

export interface FenbridgeAddedCottageTouchup {
  readonly id: string;
  readonly uid: string;
  readonly x: number;
  readonly z: number;
  readonly rot: number;
}

export interface FenbridgeNpcTouchup {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly facing?: number;
}

export interface FenbridgeTouchup {
  readonly buildings?: readonly FenbridgeBuildingTouchup[];
  readonly well?: FenbridgePropTouchup;
  readonly marketStall?: FenbridgePropTouchup;
  readonly noticeBoard?: FenbridgePropTouchup;
  readonly addedCottages?: readonly FenbridgeAddedCottageTouchup[];
  readonly npcs?: readonly FenbridgeNpcTouchup[];
  readonly excludedStreetlamps?: readonly Point2[];
}

const PLACED_FRONT_CLEARANCE = 1.8;
const FRONT_CLEARANCE = 1.5;
const WARDEN_HOUSE_SCALE = 1.4;
const INN_SCALE = 1.2;
const CHAPEL_SCALE = 1;
const APOTHECARY_SCALE = 1.5;
const BANK_SCALE = 1.5;
const PAINTED_SET = '/models/tidehold/fenrire';
const TOWN_GROUND_HEIGHT = 1.2;
const PROVISION_STALL_WIDTH = 3.2;
const PROVISION_STALL_DEPTH = 1.6;

function finiteNumber(v: unknown, maxAbs = 100_000): number | null {
  return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= maxAbs ? v : null;
}

export function sanitizeFenbridgeTouchup(raw: unknown): FenbridgeTouchup | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const out: {
    buildings?: FenbridgeBuildingTouchup[];
    well?: FenbridgePropTouchup;
    marketStall?: FenbridgePropTouchup;
    noticeBoard?: FenbridgePropTouchup;
    addedCottages?: FenbridgeAddedCottageTouchup[];
    npcs?: FenbridgeNpcTouchup[];
    excludedStreetlamps?: Point2[];
  } = {};

  if (Array.isArray(o.buildings)) {
    const buildings: FenbridgeBuildingTouchup[] = [];
    for (const item of o.buildings.slice(0, 16)) {
      if (!item || typeof item !== 'object') continue;
      const r = item as Record<string, unknown>;
      const id = typeof r.id === 'string' && r.id.length > 0 && r.id.length <= 80 ? r.id : null;
      const x = finiteNumber(r.x);
      const z = finiteNumber(r.z);
      const rot = finiteNumber(r.rot, 100);
      if (id && x !== null && z !== null && rot !== null) {
        buildings.push({ id, x, z, rot });
      }
    }
    if (buildings.length > 0) out.buildings = buildings;
  }

  const sanitizeProp = (prop: unknown): FenbridgePropTouchup | undefined => {
    if (!prop || typeof prop !== 'object' || Array.isArray(prop)) return undefined;
    const r = prop as Record<string, unknown>;
    const x = finiteNumber(r.x);
    const z = finiteNumber(r.z);
    if (x === null || z === null) return undefined;
    const rot = finiteNumber(r.rot, 100);
    return rot !== null ? { x, z, rot } : { x, z };
  };

  const well = sanitizeProp(o.well);
  if (well) out.well = well;
  const marketStall = sanitizeProp(o.marketStall);
  if (marketStall) out.marketStall = marketStall;
  const noticeBoard = sanitizeProp(o.noticeBoard);
  if (noticeBoard) out.noticeBoard = noticeBoard;

  if (Array.isArray(o.addedCottages)) {
    const addedCottages: FenbridgeAddedCottageTouchup[] = [];
    for (const item of o.addedCottages.slice(0, 16)) {
      if (!item || typeof item !== 'object') continue;
      const r = item as Record<string, unknown>;
      const id = typeof r.id === 'string' && r.id.length > 0 && r.id.length <= 80 ? r.id : null;
      const uid =
        typeof r.uid === 'string' && r.uid.length > 0 && r.uid.length <= 80 ? r.uid : null;
      const x = finiteNumber(r.x);
      const z = finiteNumber(r.z);
      const rot = finiteNumber(r.rot, 100);
      if (id && uid && x !== null && z !== null && rot !== null) {
        addedCottages.push({ id, uid, x, z, rot });
      }
    }
    if (addedCottages.length > 0) out.addedCottages = addedCottages;
  }

  if (Array.isArray(o.npcs)) {
    const npcs: FenbridgeNpcTouchup[] = [];
    for (const item of o.npcs.slice(0, 32)) {
      if (!item || typeof item !== 'object') continue;
      const r = item as Record<string, unknown>;
      const id = typeof r.id === 'string' && r.id.length > 0 && r.id.length <= 80 ? r.id : null;
      const x = finiteNumber(r.x);
      const z = finiteNumber(r.z);
      const facing = finiteNumber(r.facing, 100);
      if (id && x !== null && z !== null) {
        npcs.push(facing !== null ? { id, x, z, facing } : { id, x, z });
      }
    }
    if (npcs.length > 0) out.npcs = npcs;
  }

  if (Array.isArray(o.excludedStreetlamps)) {
    const lamps: Point2[] = [];
    for (const item of o.excludedStreetlamps.slice(0, 32)) {
      if (!item || typeof item !== 'object') continue;
      const r = item as Record<string, unknown>;
      const x = finiteNumber(r.x);
      const z = finiteNumber(r.z);
      if (x !== null && z !== null) lamps.push({ x, z });
    }
    if (lamps.length > 0) out.excludedStreetlamps = lamps;
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

function makeHouseACottage(id: string, anchor: Point2, rotation: number): PlacedTownBuilding {
  return makePlacedTownBuilding(
    {
      id,
      assetId: `${PAINTED_SET}/house_a.glb`,
      kind: 'house',
      anchor,
      rotation,
      ...scalePlacedTownMeasurements(
        {
          reach: { x: 0.2145, z: 0, width: 11.763, height: 12.23, depth: 9.8 },
          walls: { x: 0, z: 0, width: 9.36, depth: 7.96 },
          doorX: -1.4,
        },
        WARDEN_HOUSE_SCALE,
      ),
    },
    placedTownSeat(WARDEN_HOUSE_SCALE, PLACED_FRONT_CLEARANCE * WARDEN_HOUSE_SCALE),
  );
}

function padsAlong(building: { reach: Obb2 }, columns: number, rows: number, taper: number) {
  const reach = building.reach;
  const cellWidth = (reach.halfWidth * 2) / columns;
  const cellDepth = (reach.halfDepth * 2) / rows;
  const core = Math.hypot(cellWidth / 2, cellDepth / 2);
  const radius = core + taper;
  const pads: { x: number; z: number; radius: number; delta: number; hardness: number }[] = [];
  for (let column = 0; column < columns; column++) {
    for (let row = 0; row < rows; row++) {
      const center = localToWorld(
        reach.center,
        reach.rotation,
        -reach.halfWidth + cellWidth * (column + 0.5),
        -reach.halfDepth + cellDepth * (row + 0.5),
      );
      pads.push({
        x: center.x,
        z: center.z,
        radius,
        delta: TOWN_GROUND_HEIGHT,
        hardness: core / radius,
      });
    }
  }
  return pads;
}

export type ResolvedFenbridgeLayout = typeof FENBRIDGE_LAYOUT & {
  readonly addedCottageBuildings?: readonly PlacedTownBuilding[];
};

const resolvedCache = new WeakMap<FenbridgeTouchup, ResolvedFenbridgeLayout>();
let lastTouchupRef: FenbridgeTouchup | null = null;
let lastResolvedLayout: ResolvedFenbridgeLayout | null = null;

export function resolveFenbridgeLayout(touchup?: FenbridgeTouchup): ResolvedFenbridgeLayout {
  if (!touchup) return FENBRIDGE_LAYOUT;
  if (touchup === lastTouchupRef && lastResolvedLayout) return lastResolvedLayout;
  const cached = resolvedCache.get(touchup);
  if (cached) {
    lastTouchupRef = touchup;
    lastResolvedLayout = cached;
    return cached;
  }

  const byId = new Map((touchup.buildings ?? []).map((b) => [b.id, b]));
  const overrideFor = (id: string, fallback: PlacedTownBuilding) => {
    const hit = byId.get(id);
    return hit
      ? { anchor: { x: hit.x, z: hit.z }, rotation: hit.rot }
      : {
          anchor: { x: fallback.placement.x, z: fallback.placement.z },
          rotation: fallback.rotation,
        };
  };

  const wardenSpec = overrideFor('fenbridge_warden_gatehouse', FENBRIDGE_LAYOUT.buildings[0]);
  const wardenHouse = makeHouseACottage(
    'fenbridge_warden_gatehouse',
    wardenSpec.anchor,
    wardenSpec.rotation,
  );

  const innSpec = overrideFor('fenbridge_crooked_reed_inn', FENBRIDGE_LAYOUT.buildings[1]);
  const innBase = makePlacedTownBuilding(
    {
      id: 'fenbridge_crooked_reed_inn',
      assetId: `${PAINTED_SET}/tavern.glb`,
      kind: 'inn',
      anchor: innSpec.anchor,
      rotation: innSpec.rotation,
      ...scalePlacedTownMeasurements(
        {
          reach: { x: 0.272, z: -0.05, width: 22.648, height: 18.78, depth: 16.8 },
          walls: { x: 0, z: 0, width: 20, depth: 13 },
          annexes: [
            { name: 'front_bench', x: -5.1, z: -7.25, width: 5.4, depth: 0.9 },
            { name: 'barrels', x: 10.9, z: -4.9, width: 1.1, depth: 2.3 },
          ],
          doorX: 0,
        },
        INN_SCALE,
      ),
      walkIn: true,
    },
    placedTownSeat(INN_SCALE, PLACED_FRONT_CLEARANCE * INN_SCALE),
  );

  const chapelSpec = overrideFor('fenbridge_lantern_chapel', FENBRIDGE_LAYOUT.buildings[2]);
  const chapelBase = makePlacedTownBuilding(
    {
      id: 'fenbridge_lantern_chapel',
      assetId: `${PAINTED_SET}/hall.glb`,
      kind: 'chapel',
      anchor: chapelSpec.anchor,
      rotation: chapelSpec.rotation,
      ...scalePlacedTownMeasurements(
        {
          reach: { x: 1.9255, z: -0.254, width: 18.851, height: 30.5, depth: 24.212 },
          walls: { x: 0, z: 0, width: 12, depth: 22 },
          annexes: [
            { name: 'bell_tower', x: 8.25, z: -9, width: 5.4, depth: 5.4 },
            { name: 'notice_board', x: -4.2, z: -11.8, width: 1.8, depth: 0.6 },
          ],
          doorX: 0,
        },
        CHAPEL_SCALE,
      ),
      walkIn: true,
    },
    placedTownSeat(CHAPEL_SCALE, PLACED_FRONT_CLEARANCE * CHAPEL_SCALE),
  );

  const apothecarySpec = overrideFor(
    'fenbridge_moonwort_apothecary',
    FENBRIDGE_LAYOUT.buildings[3],
  );
  const apothecary = makePlacedTownBuilding(
    {
      id: 'fenbridge_moonwort_apothecary',
      assetId: `${PAINTED_SET}/shop_b.glb`,
      kind: 'house',
      anchor: apothecarySpec.anchor,
      rotation: apothecarySpec.rotation,
      ...scalePlacedTownMeasurements(
        {
          reach: { x: 0.4745, z: -0.849, width: 13.649, height: 18.7, depth: 12.702 },
          walls: { x: 0, z: 0, width: 9.4, depth: 9 },
          annexes: [{ name: 'turret', x: 5.19, z: -4.99, width: 2.66, depth: 2.66 }],
          doorX: -0.7,
        },
        APOTHECARY_SCALE,
      ),
      walkIn: true,
    },
    placedTownSeat(APOTHECARY_SCALE, PLACED_FRONT_CLEARANCE * APOTHECARY_SCALE),
  );

  const bankSpec = overrideFor('fenbridge_gilded_strongbox', FENBRIDGE_LAYOUT.buildings[4]);
  const bankBase = makePlacedTownBuilding(
    {
      id: 'fenbridge_gilded_strongbox',
      assetId: `${PAINTED_SET}/shop_a.glb`,
      kind: 'house',
      anchor: bankSpec.anchor,
      rotation: bankSpec.rotation,
      ...scalePlacedTownMeasurements(
        {
          reach: { x: 0, z: -0.8, width: 13.004, height: 16.28, depth: 12.2 },
          walls: { x: 0, z: 0, width: 11, depth: 8.4 },
          annexes: [
            { name: 'stall_counter', x: 2.375, z: -5.925, width: 3.61, depth: 0.77 },
            { name: 'stall_barrels', x: 4.885, z: -5.762, width: 1.477, depth: 2.169 },
          ],
          doorX: -1.6,
        },
        BANK_SCALE,
      ),
      walkIn: true,
    },
    placedTownSeat(BANK_SCALE, PLACED_FRONT_CLEARANCE * BANK_SCALE),
  );

  const cisternPos = touchup.well
    ? { x: touchup.well.x, z: touchup.well.z }
    : FENBRIDGE_LAYOUT.civic.cistern.position;

  const stallPos = touchup.marketStall
    ? { x: touchup.marketStall.x, z: touchup.marketStall.z }
    : FENBRIDGE_LAYOUT.civic.provisionStall.position;
  const stallRot = touchup.marketStall?.rot ?? facingToward(stallPos, { x: 0, z: stallPos.z });
  const stallVendorPoint = localToWorld(
    stallPos,
    stallRot,
    -(PROVISION_STALL_WIDTH / 2 + 0.9),
    0.15,
  );
  const stallCustomerPoint = localToWorld(stallPos, stallRot, 0, PROVISION_STALL_DEPTH / 2 + 0.9);

  const boardPos = touchup.noticeBoard
    ? { x: touchup.noticeBoard.x, z: touchup.noticeBoard.z }
    : FENBRIDGE_LAYOUT.civic.musterBoard.position;
  const boardRot =
    touchup.noticeBoard?.rot ?? facingToward(boardPos, FENBRIDGE_LAYOUT.civic.center);

  const inn = {
    ...innBase,
    sockets: {
      ...innBase.sockets,
      provisionCounter: {
        id: 'fenbridge_crooked_reed_inn_provision_counter',
        localPosition: null,
        position: stallPos,
        standingPoint: stallVendorPoint,
      },
    },
  };

  const chapelBoardFace = {
    x: -4.2 * CHAPEL_SCALE,
    z: (-11.8 - 0.6 / 2) * CHAPEL_SCALE,
  } as const;
  const chapelArchivePos = localToWorld(
    chapelBase.placement,
    chapelBase.rotation,
    chapelBoardFace.x,
    chapelBoardFace.z,
  );
  const chapelArchiveStand = localToWorld(
    chapelBase.placement,
    chapelBase.rotation,
    chapelBoardFace.x,
    chapelBoardFace.z - FRONT_CLEARANCE,
  );
  const chapel = {
    ...chapelBase,
    sockets: {
      ...chapelBase.sockets,
      archive: {
        id: 'fenbridge_lantern_chapel_archive',
        localPosition: chapelBoardFace,
        position: chapelArchivePos,
        standingPoint: chapelArchiveStand,
      },
    },
  };

  const bank = {
    ...bankBase,
    sockets: {
      ...bankBase.sockets,
      teller: {
        ...bankBase.sockets.entrance,
        id: 'fenbridge_gilded_strongbox_teller',
      },
    },
  };

  const buildings = [wardenHouse, inn, chapel, apothecary, bank] as const;
  const addedCottageBuildings = (touchup.addedCottages ?? []).map((c) =>
    makeHouseACottage(c.id, { x: c.x, z: c.z }, c.rot),
  );

  const ground = [
    { building: wardenHouse, columns: 2, rows: 2, taper: 4, apron: 10 },
    { building: inn, columns: 3, rows: 2, taper: 4, apron: 10 },
    { building: chapel, columns: 2, rows: 3, taper: 4, apron: 10 },
    { building: apothecary, columns: 2, rows: 2, taper: 4, apron: 10 },
    { building: bank, columns: 2, rows: 2, taper: 4, apron: 10 },
    ...addedCottageBuildings.map((building) => ({
      building,
      columns: 2,
      rows: 2,
      taper: 4,
      apron: 10,
    })),
  ];

  const pads = [
    ...ground.flatMap((g) => padsAlong(g.building, g.columns, g.rows, g.apron)),
    ...ground.flatMap((g) => padsAlong(g.building, g.columns, g.rows, g.taper)),
  ].map((pad) => ({ ...pad, falloff: 'smooth' as const, mode: 'level' as const }));

  const npcOverrides = new Map((touchup.npcs ?? []).map((n) => [n.id, n]));
  const crossroads = FENBRIDGE_LAYOUT.civic.crossroads;
  const defaultNpcs = [
    {
      id: 'warden_fenwick',
      position: wardenHouse.frontStandingPoint,
      facing: wardenHouse.frontFacing,
      anchorId: wardenHouse.id,
      bodyRadius: 0.6,
    },
    {
      id: 'brother_aldric_fen',
      position: chapel.frontStandingPoint,
      facing: chapel.frontFacing,
      anchorId: chapel.id,
      bodyRadius: 0.6,
    },
    {
      id: 'provisioner_hale',
      position: stallVendorPoint,
      facing: stallRot,
      anchorId: 'fenbridge_provision_stall',
      bodyRadius: 0.6,
    },
    {
      id: 'herbalist_yara',
      position: apothecary.frontStandingPoint,
      facing: apothecary.frontFacing,
      anchorId: apothecary.id,
      bodyRadius: 0.6,
    },
    {
      id: 'scout_maren',
      position: { x: -1.4, z: 330 },
      facing: facingToward({ x: -1.4, z: 330 }, crossroads),
      anchorId: 'fenbridge_gate_north',
      bodyRadius: 0.6,
    },
    {
      id: 'bursar_petra_vell',
      position: bank.sockets.teller.standingPoint,
      facing: bank.frontFacing,
      anchorId: bank.sockets.teller.id,
      bodyRadius: 0.6,
    },
    {
      id: 'chronicler_osric_fenn',
      position: chapelArchiveStand,
      facing: chapel.frontFacing,
      anchorId: 'fenbridge_lantern_chapel_archive',
      bodyRadius: 0.6,
    },
    {
      id: 'tanner_hesk',
      position: { x: -24, z: 328.5 },
      facing: facingToward({ x: -24, z: 328.5 }, crossroads),
      anchorId: 'station_fenbridge_tannery',
      bodyRadius: 0.6,
    },
    {
      id: 'farmer_teasel',
      position: { x: -21, z: 333.5 },
      facing: 0,
      anchorId: 'patch_mirefen',
      bodyRadius: 0.6,
    },
  ];

  const npcs = defaultNpcs.map((npc) => {
    const over = npcOverrides.get(npc.id);
    if (!over) return npc;
    const position = { x: over.x, z: over.z };
    const facing =
      over.facing ??
      (npc.id === 'scout_maren' || npc.id === 'tanner_hesk'
        ? facingToward(position, crossroads)
        : npc.facing);
    return { ...npc, position, facing };
  });

  const tannerNpc = npcs.find((n) => n.id === 'tanner_hesk');
  const tanneryStationPos = tannerNpc
    ? { x: tannerNpc.position.x - 2, z: tannerNpc.position.z - 1.5 }
    : FENBRIDGE_LAYOUT.services.stations[0].position;
  const stations = FENBRIDGE_LAYOUT.services.stations.map((station) =>
    station.id === 'station_fenbridge_tannery'
      ? { ...station, position: tanneryStationPos }
      : station,
  );

  const resolved = deepFreeze({
    ...FENBRIDGE_LAYOUT,
    buildings,
    addedCottageBuildings,
    civic: {
      ...FENBRIDGE_LAYOUT.civic,
      cistern: {
        ...FENBRIDGE_LAYOUT.civic.cistern,
        position: cisternPos,
      },
      provisionStall: {
        ...FENBRIDGE_LAYOUT.civic.provisionStall,
        position: stallPos,
        rotation: stallRot,
        footprint: {
          id: 'fenbridge_provision_stall',
          center: stallPos,
          halfWidth: PROVISION_STALL_WIDTH / 2,
          halfDepth: PROVISION_STALL_DEPTH / 2,
          rotation: stallRot,
        },
        customerStandingPoint: stallCustomerPoint,
        vendorStandingPoint: stallVendorPoint,
      },
      musterBoard: {
        ...FENBRIDGE_LAYOUT.civic.musterBoard,
        position: boardPos,
        rotation: boardRot,
        footprint: {
          id: 'fenbridge_muster_board',
          center: boardPos,
          halfWidth: 1.2,
          halfDepth: 0.3,
          rotation: boardRot,
        },
        frontStandingPoint: localToWorld(boardPos, boardRot, 0, 1.4),
      },
    },
    pads,
    services: {
      ...FENBRIDGE_LAYOUT.services,
      bank: {
        ...FENBRIDGE_LAYOUT.services.bank,
        entrance: bank.sockets.entrance,
        teller: bank.sockets.teller,
      },
      stations,
      npcs,
    },
  }) as unknown as ResolvedFenbridgeLayout;

  resolvedCache.set(touchup, resolved);
  lastTouchupRef = touchup;
  lastResolvedLayout = resolved;
  return resolved;
}

export function activeFenbridgeLayout(world?: WorldContent): ResolvedFenbridgeLayout {
  const w = world ?? getBoundActiveWorld();
  return resolveFenbridgeLayout(w?.fenbridgeTouchup);
}

export function activeFenbridgeBuildingById(
  id: string,
  world?: WorldContent,
): PlacedTownBuilding | undefined {
  const layout = activeFenbridgeLayout(world);
  return layout.buildings.find((b) => b.id === id);
}

export function activeFenbridgeReachCovers(
  x: number,
  z: number,
  pad: number,
  world?: WorldContent,
): boolean {
  if (z < 200 - pad || z > 380 + pad || x < -80 - pad || x > 80 + pad) return false;
  const w = world ?? getBoundActiveWorld();
  if (!w?.fenbridgeTouchup) return false;
  const layout = resolveFenbridgeLayout(w.fenbridgeTouchup);
  if (Math.hypot(x - layout.hub.center.x, z - layout.hub.center.z) > 80 + pad) return false;
  const point = { x, z };
  for (const building of layout.buildings) {
    if (distancePointToObb(point, building.reach) < pad) return true;
  }
  for (const cottage of layout.addedCottageBuildings ?? []) {
    if (distancePointToObb(point, cottage.reach) < pad) return true;
  }
  return false;
}

export function resolveFenbridgeTerrainEdits(
  terrainEdits: WorldContent['terrainEdits'],
  touchup?: FenbridgeTouchup,
): WorldContent['terrainEdits'] {
  if (!touchup) return terrainEdits;
  const layout = resolveFenbridgeLayout(touchup);
  if (terrainEdits && FENBRIDGE_LAYOUT.pads.length > 0) {
    const firstPad = FENBRIDGE_LAYOUT.pads[0];
    const start = terrainEdits.findIndex(
      (s) =>
        Math.abs(s.x - firstPad.x) < 1e-6 &&
        Math.abs(s.z - firstPad.z) < 1e-6 &&
        Math.abs(s.radius - firstPad.radius) < 1e-6 &&
        s.delta === firstPad.delta &&
        s.mode === firstPad.mode,
    );
    if (start >= 0) {
      terrainEdits = [
        ...terrainEdits.slice(0, start),
        ...layout.pads.map((pad) => ({ ...pad })),
        ...terrainEdits.slice(start + FENBRIDGE_LAYOUT.pads.length),
      ];
    }
  }

  return terrainEdits;
}

export function applyFenbridgeTouchupToWorld(world: WorldContent): WorldContent {
  if (!world.fenbridgeTouchup) return world;
  const layout = resolveFenbridgeLayout(world.fenbridgeTouchup);
  const buildingsById = indexById(layout.buildings);
  const npcsById = indexById(layout.services.npcs);
  const cistern = layout.civic.cistern;
  const stall = layout.civic.provisionStall;
  const board = layout.civic.musterBoard;

  const props = {
    ...world.props,
    buildings: world.props.buildings.map((b) => {
      if (!b.id) return b;
      const updated = buildingsById[b.id];
      if (!updated) return b;
      return {
        ...b,
        x: updated.position.x,
        z: updated.position.z,
        w: updated.nativeDimensions.width,
        d: updated.nativeDimensions.depth,
        rot: updated.rotation,
        height: updated.nativeDimensions.height,
      };
    }),
    wells: world.props.wells.map((w) =>
      w.id === cistern.id
        ? {
            ...w,
            x: cistern.position.x,
            z: cistern.position.z,
            r: cistern.radius,
            height: cistern.height,
          }
        : w,
    ),
    stalls: world.props.stalls.map((s) =>
      s.id === stall.id
        ? {
            ...s,
            x: stall.position.x,
            z: stall.position.z,
            rot: stall.rotation,
            w: stall.width,
            d: stall.depth,
            height: stall.height,
          }
        : s,
    ),
  };

  const baseBoard = FENBRIDGE_LAYOUT.civic.musterBoard;
  const boardChanged =
    board.position.x !== baseBoard.position.x ||
    board.position.z !== baseBoard.position.z ||
    board.rotation !== baseBoard.rotation;
  const tanneryStation = layout.services.stations.find((s) => s.id === 'station_fenbridge_tannery');
  const baseTanneryStation = FENBRIDGE_LAYOUT.services.stations[0];
  const tanneryChanged =
    tanneryStation !== undefined &&
    (tanneryStation.position.x !== baseTanneryStation.position.x ||
      tanneryStation.position.z !== baseTanneryStation.position.z);
  const services =
    world.services && (boardChanged || tanneryChanged)
      ? {
          ...world.services,
          ...(tanneryChanged && tanneryStation
            ? {
                stations: world.services.stations?.map((st) =>
                  st.id === tanneryStation.id
                    ? {
                        ...st,
                        pos: {
                          x: tanneryStation.position.x,
                          z: tanneryStation.position.z,
                        },
                      }
                    : st,
                ),
              }
            : {}),
          ...(boardChanged
            ? {
                musterBoards: world.services.musterBoards?.map((mb) =>
                  mb.id === board.id
                    ? {
                        ...mb,
                        x: board.position.x,
                        z: board.position.z,
                        rotation: board.rotation,
                        frontStandingPoint: { ...board.frontStandingPoint },
                      }
                    : mb,
                ),
              }
            : {}),
        }
      : world.services;

  const baseNpcs = world.npcs;
  const npcs = new Proxy(baseNpcs, {
    get(target, prop, receiver) {
      if (typeof prop === 'string') {
        const updated = npcsById[prop];
        const def = Reflect.get(target, prop, receiver);
        if (updated && def) {
          return {
            ...def,
            pos: { x: updated.position.x, z: updated.position.z },
            facing: updated.facing,
          };
        }
        return def;
      }
      return Reflect.get(target, prop, receiver);
    },
    getOwnPropertyDescriptor(target, prop) {
      const desc = Reflect.getOwnPropertyDescriptor(target, prop);
      if (desc && typeof prop === 'string') {
        const updated = npcsById[prop];
        if (updated && desc.value) {
          return {
            ...desc,
            value: {
              ...desc.value,
              pos: { x: updated.position.x, z: updated.position.z },
              facing: updated.facing,
            },
          };
        }
      }
      return desc;
    },
  });

  const terrainEdits = resolveFenbridgeTerrainEdits(world.terrainEdits, world.fenbridgeTouchup);

  return {
    ...world,
    props,
    ...(services ? { services } : {}),
    npcs,
    ...(terrainEdits ? { terrainEdits } : {}),
  };
}
