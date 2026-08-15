// Capture contracts shared by the Fenbridge browser helper and its tests.
// Browser orchestration belongs in capture_ingame.mjs.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { inflateSync } from 'node:zlib';

export const FENBRIDGE_CAPTURE_SEED = 20_061;
export const FENBRIDGE_ZONE_ID = 'mirefen_marsh';
export const FENBRIDGE_LAYOUT_ID = 'fenbridge_rebuild_v1';
export const FENBRIDGE_TOWN_ROOT_NAME = 'fenbridgeTownRebuild';
export const FENBRIDGE_CAPTURE_CHARACTER = Object.freeze({
  name: 'FenVerifier',
  className: 'warrior',
});

// A dry, collision-clear point on the east side of the civic square. Keeping
// this fixed makes the player a useful scale reference in every matched frame.
export const FENBRIDGE_PLAYER_STATE = Object.freeze({
  x: 7,
  y: 1.2,
  z: 303,
  facing: Math.PI,
});

export const FENBRIDGE_STREAMING_CONTRACT = Object.freeze({
  from: Object.freeze({ x: 0, z: 176, zoneId: 'eastbrook_vale' }),
  crossing: Object.freeze({ x: 0, z: 184, zoneId: FENBRIDGE_ZONE_ID }),
  target: Object.freeze({ x: 0, z: 300, zoneId: FENBRIDGE_ZONE_ID }),
  travelFacing: 0,
  readyStableFrames: 3,
  timeoutMs: 60_000,
});

export const FENBRIDGE_CAPTURE_TIMING = Object.freeze({
  // A cold Ultra boot parses the full model catalog under software WebGL in
  // CI. Give that real preload path room to finish before capture starts.
  gameBootTimeoutMs: 240_000,
  bootSettleMs: 2_000,
  viewSettleMs: 1_400,
});

export const FENBRIDGE_EXPECTED_LOCAL_PROXY_502_PATHS = Object.freeze([
  '/api/perf-report',
  '/api/project-stats',
  '/api/site-presence',
]);

export const FENBRIDGE_CAPTURE_PROFILES = Object.freeze([
  Object.freeze({
    name: 'desktop-ultra',
    tier: 'ultra',
    query: '?gfx=ultra&governor=0',
    settings: Object.freeze({
      graphicsPreset: 4,
      graphicsDefaultApplied: true,
      terrainDetail: 1,
      foliageDensity: 1,
      effectsQuality: 1,
      shadowQuality: 1,
      brightness: 1,
      renderScale: 1,
      reduceMotion: true,
    }),
    viewport: Object.freeze({ width: 1600, height: 900, deviceScaleFactor: 1 }),
    canvasPixelRatioCap: 1.75,
    effectiveRenderScale: 1,
    canvasAllocationScale: 1,
    mobile: false,
  }),
  Object.freeze({
    name: 'mobile-low',
    tier: 'low',
    query: '?gfx=low&governor=0',
    settings: Object.freeze({
      graphicsPreset: 1,
      graphicsDefaultApplied: true,
      terrainDetail: 0,
      foliageDensity: 0,
      effectsQuality: 0,
      shadowQuality: 0,
      brightness: 1,
      renderScale: 1,
      reduceMotion: true,
    }),
    // CSS 844x390 at native DPR 3 produces a 2532x1170 frame.
    viewport: Object.freeze({
      width: 844,
      height: 390,
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    }),
    canvasPixelRatioCap: 1.48,
    // Renderer.initialEffectiveRenderScale deliberately starts phone-class
    // Low at 85 percent. Low has no post-composer render region, so that scale
    // is applied to the canvas allocation itself.
    effectiveRenderScale: 0.85,
    canvasAllocationScale: 0.85,
    mobile: true,
  }),
]);

// These cameras are world-space contracts. +z is north and +x is west in
// Fenbridge. Targets are deliberately not derived from the active player or
// orbit controls, so before/after captures remain geometrically matched.
export const FENBRIDGE_CAPTURE_VIEWS = Object.freeze([
  Object.freeze({
    name: 'elevated-overview',
    subject: 'town-footprint',
    camera: Object.freeze({ x: 54, y: 45, z: 252 }),
    target: Object.freeze({ x: 0, y: 3, z: 303 }),
  }),
  Object.freeze({
    name: 'planning-top-down',
    subject: 'site-plan',
    camera: Object.freeze({ x: 0, y: 82, z: 303 }),
    target: Object.freeze({ x: 0, y: 1.2, z: 303 }),
  }),
  Object.freeze({
    name: 'south-causeway-approach',
    subject: 'south-gate-and-causeway',
    camera: Object.freeze({ x: 0, y: 8, z: 244 }),
    target: Object.freeze({ x: 0, y: 3.2, z: 282 }),
  }),
  Object.freeze({
    name: 'civic-square',
    subject: 'cistern-stall-and-civic-ring',
    camera: Object.freeze({ x: 29, y: 9, z: 279 }),
    target: Object.freeze({ x: 0, y: 3, z: 303 }),
  }),
  Object.freeze({
    name: 'player-scale-street',
    subject: 'player-and-boardwalk',
    camera: Object.freeze({ x: 16, y: 4.8, z: 292 }),
    target: Object.freeze({ x: 2, y: 2.6, z: 309 }),
  }),
  Object.freeze({
    name: 'gate-south',
    subject: 'south-gate',
    camera: Object.freeze({ x: 0, y: 7, z: 257 }),
    target: Object.freeze({ x: 0, y: 3, z: 274 }),
  }),
  Object.freeze({
    name: 'gate-west',
    subject: 'west-gate',
    camera: Object.freeze({ x: 50, y: 9, z: 313 }),
    target: Object.freeze({ x: 29, y: 3, z: 313 }),
  }),
  Object.freeze({
    name: 'gate-east',
    subject: 'east-gate',
    camera: Object.freeze({ x: -50, y: 9, z: 314 }),
    target: Object.freeze({ x: -29, y: 3, z: 314 }),
  }),
  Object.freeze({
    name: 'gate-north',
    subject: 'north-gate',
    camera: Object.freeze({ x: 0, y: 9, z: 352 }),
    target: Object.freeze({ x: 0, y: 3, z: 332 }),
  }),
  Object.freeze({
    name: 'tannery-and-hesk',
    subject: 'fenbridge_hesk_tannery',
    camera: Object.freeze({ x: -34, y: 9, z: 336 }),
    target: Object.freeze({ x: -16, y: 3.2, z: 318 }),
  }),
  Object.freeze({
    name: 'chapel-graveyard-archive',
    subject: 'fenbridge_lantern_chapel',
    camera: Object.freeze({ x: -38, y: 10, z: 277 }),
    target: Object.freeze({ x: -19.5, y: 3.8, z: 294 }),
  }),
  Object.freeze({
    name: 'inn-and-provisioner',
    subject: 'fenbridge_crooked_reed_inn',
    camera: Object.freeze({ x: -30, y: 9, z: 331 }),
    target: Object.freeze({ x: -8, y: 3.2, z: 311 }),
  }),
  Object.freeze({
    name: 'bank-and-apothecary',
    subject: 'east-service-aprons',
    camera: Object.freeze({ x: 38, y: 10, z: 278 }),
    target: Object.freeze({ x: 18.5, y: 3.2, z: 300 }),
  }),
  Object.freeze({
    name: 'scout-lodge',
    subject: 'fenbridge_scout_lodge',
    camera: Object.freeze({ x: 18, y: 9, z: 345 }),
    target: Object.freeze({ x: 3, y: 3.2, z: 325 }),
  }),
  Object.freeze({
    name: 'muster-mailbox-chest',
    subject: 'preserved-service-interactions',
    camera: Object.freeze({ x: 22, y: 8, z: 269 }),
    target: Object.freeze({ x: 4, y: 2.6, z: 296 }),
  }),
  Object.freeze({
    name: 'collision-route-overlay',
    subject: 'collision-and-route-overlay',
    camera: Object.freeze({ x: 52, y: 46, z: 350 }),
    target: Object.freeze({ x: 0, y: 1.2, z: 303 }),
    overlay: 'collision-routes',
  }),
]);

export const FENBRIDGE_LEGACY_PLACEMENT_INVENTORY = Object.freeze({
  buildings: Object.freeze([
    'legacy_fenbridge_building_00',
    'legacy_fenbridge_building_01',
    'legacy_fenbridge_building_02',
    'legacy_fenbridge_building_03',
  ]),
  wells: Object.freeze(['legacy_fenbridge_well']),
  stalls: Object.freeze(['legacy_fenbridge_stall']),
  campfires: Object.freeze(['legacy_fenbridge_campfire_00', 'legacy_fenbridge_campfire_01']),
  fences: Object.freeze(['legacy_fenbridge_fence_00', 'legacy_fenbridge_fence_01']),
});

export const FENBRIDGE_REBUILD_REQUIRED_IDS = Object.freeze([
  'fenbridge_warden_gatehouse',
  'fenbridge_crooked_reed_inn',
  'fenbridge_lantern_chapel',
  'fenbridge_moonwort_apothecary',
  'fenbridge_gilded_strongbox',
  'fenbridge_hesk_tannery',
  'fenbridge_scout_lodge',
  'fenbridge_mirelight_cistern',
  'fenbridge_provision_stall',
  'fenbridge_muster_board',
]);

export const FENBRIDGE_TOWN_ASSET_URLS = Object.freeze([
  '/models/props/fenbridge_warden_gatehouse.glb',
  '/models/props/fenbridge_crooked_reed_inn.glb',
  '/models/props/fenbridge_lantern_chapel.glb',
  '/models/props/fenbridge_moonwort_apothecary.glb',
  '/models/props/fenbridge_gilded_strongbox.glb',
  '/models/props/fenbridge_hesk_tannery.glb',
  '/models/props/fenbridge_scout_lodge.glb',
  '/models/props/fenbridge_mirelight_cistern.glb',
  '/models/props/fenbridge_provision_stall.glb',
  '/models/props/fenbridge_muster_board.glb',
  '/models/props/fenbridge_palisade_wing.glb',
  '/models/props/fenbridge_gate_arch.glb',
  '/models/props/fenbridge_boardwalk.glb',
  '/models/quest/fenbridge_muster_order.glb',
]);

export const FENBRIDGE_SURFACE_TEXTURE_URLS = Object.freeze([
  '/textures/fenbridge_surface_atlas.webp',
  '/textures/fenbridge_surface_normal.webp',
  '/textures/fenbridge_surface_roughness.webp',
]);

// These established assets are part of the locked Fenbridge service surface.
// They are not owned by the rebuild root's asset declaration, but acceptance
// still proves that the live mailbox, banker chest, and tannery requested them.
export const FENBRIDGE_SHARED_SERVICE_ASSET_URLS = Object.freeze([
  '/models/props/mailbox_pillar.glb',
  '/models/props/banker_chest.glb',
  '/models/props/leatherworking_rack.glb',
]);

export const FENBRIDGE_REQUIRED_ASSET_REQUEST_URLS = Object.freeze([
  ...FENBRIDGE_TOWN_ASSET_URLS,
  ...FENBRIDGE_SURFACE_TEXTURE_URLS,
  ...FENBRIDGE_SHARED_SERVICE_ASSET_URLS,
]);

export const FENBRIDGE_REPEATED_ASSET_REQUIREMENTS = Object.freeze({
  fenbridge_palisade_wing: Object.freeze({ exact: 16 }),
  fenbridge_gate_arch: Object.freeze({ exact: 4 }),
  fenbridge_boardwalk: Object.freeze({ exact: 12 }),
  fenbridge_muster_order: Object.freeze({ exact: 2 }),
});

export const FENBRIDGE_GAMEPLAY_CONTRACT = Object.freeze({
  npcs: Object.freeze([
    Object.freeze({
      id: 'warden_fenwick',
      x: 4.824455435060822,
      z: 285.6503188335003,
    }),
    Object.freeze({
      id: 'brother_aldric_fen',
      x: -14.960203077497741,
      z: 296.09529088730875,
    }),
    Object.freeze({
      id: 'provisioner_hale',
      x: -12.424844495021249,
      z: 314.94714794895896,
    }),
    Object.freeze({
      id: 'herbalist_yara',
      x: 14.020226082985031,
      z: 293.9419887666108,
    }),
    Object.freeze({
      id: 'scout_maren',
      x: -12.942629598286846,
      z: 320.2950179409249,
    }),
    Object.freeze({
      id: 'bursar_petra_vell',
      x: 15.101663970557492,
      z: 306.79285357068125,
    }),
    Object.freeze({
      id: 'chronicler_osric_fenn',
      x: -15.965942703405933,
      z: 298.27439341010984,
    }),
    Object.freeze({
      id: 'tanner_hesk',
      x: 3.053383957289929,
      z: 315.5600325924389,
    }),
  ]),
  mailbox: Object.freeze({
    id: 'mailbox_fenbridge',
    templateId: 'mailbox',
    x: 6,
    z: 294,
  }),
  station: Object.freeze({
    id: 'station_fenbridge_tannery',
    type: 'tannery',
    zoneId: FENBRIDGE_ZONE_ID,
    masterNpcId: 'tanner_hesk',
    x: 1.0670827486441765,
    z: 315.3263500973041,
  }),
  graveyard: Object.freeze({
    id: 'gy_fenbridge',
    name: 'Fenbridge Barrow',
    healerTemplateId: 'spirit_healer',
    x: -18,
    z: 286,
  }),
  rest: Object.freeze({
    id: 'fenbridge_inn_rest',
    buildingId: 'fenbridge_crooked_reed_inn',
  }),
  musterOrders: Object.freeze([
    Object.freeze({ id: 'fenbridge_muster_order_west', x: -3.75, z: 274.8 }),
    Object.freeze({ id: 'fenbridge_muster_order_east', x: 3.75, z: 274.8 }),
  ]),
  quest: Object.freeze({
    id: 'q_fenbridge_muster',
    giverNpcId: 'brother_aldric',
    turnInNpcId: 'warden_fenwick',
    itemId: 'fen_muster_order',
    count: 1,
    captureState: 'unavailable',
  }),
});

export const FENBRIDGE_LOCKED_ROUTE_ANCHORS = Object.freeze({
  'south-causeway': Object.freeze({ x: -8, z: 240 }),
  fenbridge_gate_south: Object.freeze({ x: -8, z: 240 }),
  fenbridge_gate_west: Object.freeze({ x: 45, z: 336 }),
  fenbridge_gate_east: Object.freeze({ x: -40, z: 370 }),
  fenbridge_gate_north: Object.freeze({ x: 10, z: 400 }),
});

const FENBRIDGE_GATE_IDS = Object.freeze(['south', 'west', 'east', 'north']);

export const FENBRIDGE_OVERLAY_CONTRACT = Object.freeze({
  renderableCount: 3,
  recordIds: Object.freeze({
    colliders: Object.freeze([
      ...FENBRIDGE_REBUILD_REQUIRED_IDS,
      ...Array.from(
        { length: FENBRIDGE_REPEATED_ASSET_REQUIREMENTS.fenbridge_palisade_wing.exact },
        (_, index) => `fenbridge_palisade_wing_${String(index).padStart(2, '0')}`,
      ),
      ...FENBRIDGE_GATE_IDS.flatMap((gate) => [
        `fenbridge_gate_${gate}_jamb_left`,
        `fenbridge_gate_${gate}_jamb_right`,
      ]),
    ]),
    routes: Object.freeze(['south_causeway', 'west_marsh', 'east_marsh', 'north_fen']),
    services: Object.freeze([
      ...FENBRIDGE_GAMEPLAY_CONTRACT.npcs.map((npc) => npc.id),
      FENBRIDGE_GAMEPLAY_CONTRACT.station.id,
      ...FENBRIDGE_GAMEPLAY_CONTRACT.musterOrders.map((order) => order.id),
      'fenbridge_gilded_strongbox_teller',
      FENBRIDGE_GAMEPLAY_CONTRACT.mailbox.id,
      FENBRIDGE_GAMEPLAY_CONTRACT.graveyard.id,
      FENBRIDGE_GAMEPLAY_CONTRACT.rest.id,
      'fenbridge_muster_board',
    ]),
  }),
});

export const FENBRIDGE_TRAVERSAL_DESTINATION_IDS = Object.freeze([
  'south-causeway',
  'fenbridge_gate_south',
  'fenbridge_gate_west',
  'fenbridge_gate_east',
  'fenbridge_gate_north',
  ...FENBRIDGE_GAMEPLAY_CONTRACT.npcs.map((npc) => npc.id),
  FENBRIDGE_GAMEPLAY_CONTRACT.station.id,
  FENBRIDGE_GAMEPLAY_CONTRACT.mailbox.id,
  FENBRIDGE_GAMEPLAY_CONTRACT.graveyard.id,
  'fenbridge_muster_board',
  'fenbridge_provision_stall',
  ...FENBRIDGE_GAMEPLAY_CONTRACT.musterOrders.map((order) => order.id),
  ...[
    'fenbridge_warden_gatehouse',
    'fenbridge_crooked_reed_inn',
    'fenbridge_lantern_chapel',
    'fenbridge_moonwort_apothecary',
    'fenbridge_gilded_strongbox',
    'fenbridge_hesk_tannery',
    'fenbridge_scout_lodge',
  ].map((id) => `${id}:entrance`),
]);

export const FENBRIDGE_TRAVERSAL_BODY_RADII = Object.freeze([0.5, 0.8]);

export const FENBRIDGE_CAPTURE_HOOK_CONTRACT = Object.freeze({
  rootName: FENBRIDGE_TOWN_ROOT_NAME,
  rootUserData: Object.freeze(['layoutId', 'placementIds', 'assetPlacementCounts', 'assetUrls']),
  overlayName: 'fenbridgeCaptureOverlay',
  overlayController: 'setFenbridgeCaptureOverlay',
});

const LEGACY_IDS = Object.freeze(Object.values(FENBRIDGE_LEGACY_PLACEMENT_INVENTORY).flat());

export function expectedFenbridgeInventory(expectedFenbridge) {
  if (typeof expectedFenbridge !== 'boolean') {
    throw new Error('expectedFenbridge must be a boolean');
  }
  return expectedFenbridge
    ? Object.freeze({
        legacyIds: Object.freeze([]),
        rebuildIds: FENBRIDGE_REBUILD_REQUIRED_IDS,
        repeatedCounts: FENBRIDGE_REPEATED_ASSET_REQUIREMENTS,
      })
    : Object.freeze({
        legacyIds: LEGACY_IDS,
        rebuildIds: Object.freeze([]),
        repeatedCounts: Object.freeze({}),
      });
}

// Classify the small, serializable snapshot gathered in the page. Keeping this
// coordinate migration audit here makes it unit-testable and keeps Puppeteer
// responsible only for observing browser state.
export function classifyFenbridgePlacementInventory(snapshot) {
  const props = snapshot?.props ?? {};
  const root = snapshot?.root ?? {};
  const close = (left, right) => Math.abs(left - right) < 1e-8;
  const inTown = (x, z) => Number.isFinite(x) && Number.isFinite(z) && Math.hypot(x, z - 300) <= 40;
  const legacyIds = [];
  const rebuildIds = [];

  const legacyBuildings = [
    ['legacy_fenbridge_building_00', 'inn', 13, 306, 6, 7, -1],
    ['legacy_fenbridge_building_01', 'house', -13, 308, 7, 6, 0.5],
    ['legacy_fenbridge_building_02', 'house', -12, 291, 6, 5, 2.6],
    ['legacy_fenbridge_building_03', 'house', 11, 316, 6, 5, 0.3],
  ];
  for (const building of props.buildings ?? []) {
    if (!inTown(building.x, building.z)) continue;
    if (typeof building.id === 'string' && building.id.startsWith('fenbridge_')) {
      rebuildIds.push(building.id);
      continue;
    }
    const match = legacyBuildings.find(
      ([, kind, x, z, w, d, rot]) =>
        building.kind === kind &&
        close(building.x, x) &&
        close(building.z, z) &&
        close(building.w, w) &&
        close(building.d, d) &&
        close(building.rot, rot),
    );
    legacyIds.push(
      match?.[0] ??
        `unclassified-building:${building.kind}:${building.x}:${building.z}:${building.w}:${building.d}:${building.rot}`,
    );
  }

  const classifySimple = (entries, legacySpecs, category, coordinates) => {
    for (const entry of entries ?? []) {
      const values = Array.isArray(entry) ? entry : coordinates.map((key) => entry[key]);
      if (!inTown(values[0], values[1])) continue;
      const id = Array.isArray(entry) ? null : entry.id;
      if (typeof id === 'string' && id.startsWith('fenbridge_')) {
        rebuildIds.push(id);
        continue;
      }
      const match = legacySpecs.find((spec) =>
        spec.slice(1).every((expected, index) => close(values[index], expected)),
      );
      legacyIds.push(match?.[0] ?? `unclassified-${category}:${values.join(':')}`);
    }
  };
  classifySimple(props.wells, [['legacy_fenbridge_well', 0, 302, 1.5]], 'well', ['x', 'z', 'r']);
  classifySimple(props.stalls, [['legacy_fenbridge_stall', -5, 310.5, Math.PI / 2, 1.7]], 'stall', [
    'x',
    'z',
    'rot',
    'r',
  ]);
  classifySimple(
    props.campfires,
    [
      ['legacy_fenbridge_campfire_00', 4, 299],
      ['legacy_fenbridge_campfire_01', -2, 293],
    ],
    'campfire',
    ['x', 'z'],
  );
  for (const fence of props.fences ?? []) {
    if (!inTown(fence.x1, fence.z1) && !inTown(fence.x2, fence.z2)) continue;
    if (typeof fence.id === 'string' && fence.id.startsWith('fenbridge_')) {
      rebuildIds.push(fence.id);
      continue;
    }
    const match = [
      ['legacy_fenbridge_fence_00', 16, 311, 21, 299],
      ['legacy_fenbridge_fence_01', -18, 313, -22, 300],
    ].find(
      ([, x1, z1, x2, z2]) =>
        close(fence.x1, x1) && close(fence.z1, z1) && close(fence.x2, x2) && close(fence.z2, z2),
    );
    legacyIds.push(
      match?.[0] ?? `unclassified-fence:${fence.x1}:${fence.z1}:${fence.x2}:${fence.z2}`,
    );
  }

  const appendPlacementIds = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) appendPlacementIds(item);
    } else if (value && typeof value === 'object') {
      for (const item of Object.values(value)) appendPlacementIds(item);
    } else if (typeof value === 'string' && value.startsWith('fenbridge_')) {
      rebuildIds.push(value);
    }
  };
  appendPlacementIds(root.placementIds);
  appendPlacementIds(root.buildingIds);
  appendPlacementIds(root.placementInventory);
  appendPlacementIds(root.capturePlacementIds);
  appendPlacementIds(root.capturePlacementInventory);

  const renderedRebuildIds = sortedUnique(snapshot?.scenePlacementIds).filter((id) =>
    FENBRIDGE_REBUILD_REQUIRED_IDS.includes(id),
  );

  const repeatedCounts = {};
  const observedRepeatedCounts = {};
  for (const assetKey of Object.keys(FENBRIDGE_REPEATED_ASSET_REQUIREMENTS)) {
    const declared = root.assetPlacementCounts?.[assetKey];
    const observed = snapshot?.sceneRepeatedCounts?.[assetKey];
    observedRepeatedCounts[assetKey] =
      Number.isInteger(observed) && observed >= 0 ? observed : null;
    repeatedCounts[assetKey] = Number.isInteger(declared)
      ? declared
      : observedRepeatedCounts[assetKey] !== null
        ? observedRepeatedCounts[assetKey]
        : null;
  }
  if (repeatedCounts.fenbridge_gate_arch === null && Number.isInteger(root.gateCount)) {
    repeatedCounts.fenbridge_gate_arch = root.gateCount;
  }
  if (repeatedCounts.fenbridge_palisade_wing === null && Number.isInteger(root.wallSegmentCount)) {
    repeatedCounts.fenbridge_palisade_wing = root.wallSegmentCount;
  }
  if (repeatedCounts.fenbridge_boardwalk === null && Number.isInteger(root.boardwalkCount)) {
    repeatedCounts.fenbridge_boardwalk = root.boardwalkCount;
  }

  return Object.freeze({
    legacyIds: Object.freeze(sortedUnique(legacyIds)),
    rebuildIds: Object.freeze(
      sortedUnique(rebuildIds).filter((id) => FENBRIDGE_REBUILD_REQUIRED_IDS.includes(id)),
    ),
    renderedRebuildIds: Object.freeze(renderedRebuildIds),
    repeatedCounts: Object.freeze(repeatedCounts),
    observedRepeatedCounts: Object.freeze(observedRepeatedCounts),
  });
}

export function captureFrameFilename(prefix, viewName, profileName) {
  if (!prefix || !viewName || !profileName) throw new Error('capture filename parts are required');
  return `${prefix}-${viewName}-${profileName}.png`;
}

export function captureMetadataFilename(prefix, profileName) {
  if (!prefix || !profileName) throw new Error('metadata filename parts are required');
  return `${prefix}-${profileName}.json`;
}

const PNG_CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < PNG_CRC_TABLE.length; index++) {
  let value = index;
  for (let bit = 0; bit < 8; bit++) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  PNG_CRC_TABLE[index] = value >>> 0;
}

function pngCrc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = PNG_CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function pngScanlineLayout(width, height, bitsPerPixel, interlace, output) {
  const passes =
    interlace === 0
      ? [[0, 0, 1, 1]]
      : [
          [0, 0, 8, 8],
          [4, 0, 8, 8],
          [0, 4, 4, 8],
          [2, 0, 4, 4],
          [0, 2, 2, 4],
          [1, 0, 2, 2],
          [0, 1, 1, 2],
        ];
  const scanlines = [];
  let decodedBytes = 0;
  for (const [startX, startY, stepX, stepY] of passes) {
    const passWidth = width <= startX ? 0 : Math.ceil((width - startX) / stepX);
    const passHeight = height <= startY ? 0 : Math.ceil((height - startY) / stepY);
    if (passWidth === 0 || passHeight === 0) continue;
    const rowBytes = Math.ceil((passWidth * bitsPerPixel) / 8);
    for (let row = 0; row < passHeight; row++) {
      scanlines.push(decodedBytes);
      decodedBytes += rowBytes + 1;
    }
  }
  if (!Number.isSafeInteger(decodedBytes) || decodedBytes > 256 * 1024 * 1024) {
    throw new Error(`capture PNG decoded payload is unsafe: ${output}`);
  }
  return { decodedBytes, scanlines };
}

function inspectPngBytes(bytes, output) {
  const signature = '89504e470d0a1a0a';
  if (bytes.length < 45 || bytes.subarray(0, 8).toString('hex') !== signature) {
    throw new Error(`capture output is not a complete PNG: ${output}`);
  }
  let offset = 8;
  let width = null;
  let height = null;
  let idatChunks = 0;
  const idatPayloads = [];
  let sawIend = false;
  let sawPlte = false;
  let idatSequenceEnded = false;
  let chunkIndex = 0;
  let bitDepth = null;
  let colorType = null;
  let interlace = null;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) {
      throw new Error(`capture PNG has a truncated chunk header: ${output}`);
    }
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii');
    const nextOffset = offset + 12 + length;
    if (!/^[A-Za-z]{4}$/.test(type) || nextOffset > bytes.length) {
      throw new Error(`capture PNG has an invalid ${type || 'unknown'} chunk: ${output}`);
    }
    if (type.charCodeAt(2) & 0x20) {
      throw new Error(`capture PNG has an invalid reserved chunk name: ${output}`);
    }
    const dataEnd = offset + 8 + length;
    const expectedCrc = bytes.readUInt32BE(dataEnd);
    const actualCrc = pngCrc32(bytes.subarray(offset + 4, dataEnd));
    if (actualCrc !== expectedCrc) {
      throw new Error(`capture PNG has a corrupt ${type} chunk CRC: ${output}`);
    }
    if (!(type.charCodeAt(0) & 0x20) && !['IHDR', 'PLTE', 'IDAT', 'IEND'].includes(type)) {
      throw new Error(`capture PNG contains an unknown critical ${type} chunk: ${output}`);
    }
    if (chunkIndex === 0) {
      if (type !== 'IHDR' || length !== 13) {
        throw new Error(`capture PNG does not start with a 13-byte IHDR: ${output}`);
      }
      width = bytes.readUInt32BE(offset + 8);
      height = bytes.readUInt32BE(offset + 12);
      if (width < 1 || height < 1) {
        throw new Error(`capture PNG has invalid IHDR dimensions: ${output}`);
      }
      bitDepth = bytes[offset + 16];
      colorType = bytes[offset + 17];
      const compression = bytes[offset + 18];
      const filter = bytes[offset + 19];
      interlace = bytes[offset + 20];
      const validDepths = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16],
      };
      if (
        !validDepths[colorType]?.includes(bitDepth) ||
        compression !== 0 ||
        filter !== 0 ||
        ![0, 1].includes(interlace)
      ) {
        throw new Error(`capture PNG has unsupported IHDR encoding fields: ${output}`);
      }
    } else if (type === 'IHDR') {
      throw new Error(`capture PNG contains a duplicate IHDR: ${output}`);
    }
    if (type === 'PLTE') {
      if (sawPlte || idatChunks > 0 || length < 3 || length > 768 || length % 3 !== 0) {
        throw new Error(`capture PNG has an invalid PLTE chunk: ${output}`);
      }
      sawPlte = true;
    }
    if (type === 'IDAT') {
      if (idatSequenceEnded) {
        throw new Error(`capture PNG has non-consecutive IDAT chunks: ${output}`);
      }
      idatChunks++;
      idatPayloads.push(bytes.subarray(offset + 8, dataEnd));
    } else if (idatChunks > 0 && type !== 'IEND') {
      idatSequenceEnded = true;
    }
    if (type === 'IEND') {
      if (length !== 0 || nextOffset !== bytes.length) {
        throw new Error(`capture PNG has an invalid terminal IEND: ${output}`);
      }
      sawIend = true;
    }
    offset = nextOffset;
    chunkIndex++;
  }
  if (idatChunks < 1 || !sawIend) {
    throw new Error(`capture PNG is missing IDAT or IEND data: ${output}`);
  }
  if ((colorType === 3 && !sawPlte) || ([0, 4].includes(colorType) && sawPlte)) {
    throw new Error(`capture PNG has invalid palette usage: ${output}`);
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  const layout = pngScanlineLayout(width, height, channels * bitDepth, interlace, output);
  const compressed = Buffer.concat(idatPayloads);
  let inflated;
  let consumedBytes;
  try {
    const result = inflateSync(compressed, {
      info: true,
      maxOutputLength: layout.decodedBytes + 1,
    });
    inflated = result.buffer;
    consumedBytes = result.engine.bytesWritten;
  } catch (error) {
    throw new Error(`capture PNG has an undecodable IDAT stream: ${output}`, { cause: error });
  }
  if (consumedBytes !== compressed.length || inflated.length !== layout.decodedBytes) {
    throw new Error(`capture PNG has an invalid decoded IDAT payload: ${output}`);
  }
  for (const scanlineOffset of layout.scanlines) {
    if (inflated[scanlineOffset] > 4) {
      throw new Error(`capture PNG has an invalid scanline filter: ${output}`);
    }
  }
  return { width, height, idatChunks };
}

export function fenbridgePngFrameEvidence(output) {
  const bytes = readFileSync(output);
  const png = inspectPngBytes(bytes, output);
  return Object.freeze({
    output,
    bytes: bytes.length,
    width: png.width,
    height: png.height,
    settleMs: FENBRIDGE_CAPTURE_TIMING.viewSettleMs,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    structure: Object.freeze({ ihdr: true, idatChunks: png.idatChunks, iend: true }),
  });
}

export function assertFenbridgeCaptureArtifactFiles(metadata) {
  for (const profileBatch of metadata?.profiles ?? []) {
    for (const record of profileBatch?.records ?? []) {
      const expected = record?.frame;
      if (typeof expected?.output !== 'string') {
        throw new Error('Fenbridge capture record has no frame artifact path');
      }
      const actual = fenbridgePngFrameEvidence(expected.output);
      if (!isDeepStrictEqual(actual, expected)) {
        throw new Error(`Fenbridge frame artifact drifted: ${expected.output}`);
      }
    }
  }
}

export function selectFenbridgeCaptureConfiguration(env) {
  if (!env.GAME_URL || !env.SHOT_PREFIX) {
    throw new Error('GAME_URL and SHOT_PREFIX are required');
  }
  if (!['0', '1'].includes(env.EXPECT_FENBRIDGE ?? '')) {
    throw new Error('EXPECT_FENBRIDGE must be 0 or 1');
  }
  if (env.ACCEPTANCE_MODE !== undefined && !['0', '1'].includes(env.ACCEPTANCE_MODE)) {
    throw new Error('ACCEPTANCE_MODE must be 0 or 1 when provided');
  }
  const acceptanceMode = env.ACCEPTANCE_MODE === '1';
  if (acceptanceMode && (env.PROFILE_NAME || env.VIEW_NAME)) {
    throw new Error('ACCEPTANCE_MODE=1 requires the complete profile and view matrix');
  }
  const profiles = FENBRIDGE_CAPTURE_PROFILES.filter(
    (profile) => !env.PROFILE_NAME || profile.name === env.PROFILE_NAME,
  );
  const views = FENBRIDGE_CAPTURE_VIEWS.filter(
    (view) => !env.VIEW_NAME || view.name === env.VIEW_NAME,
  );
  if (profiles.length === 0) throw new Error(`Unknown PROFILE_NAME: ${env.PROFILE_NAME}`);
  if (views.length === 0) throw new Error(`Unknown VIEW_NAME: ${env.VIEW_NAME}`);
  return Object.freeze({
    gameUrl: env.GAME_URL.replace(/\/+$/, ''),
    shotPrefix: env.SHOT_PREFIX,
    outputDir:
      env.OUT_DIR ??
      `docs/screenshots/fenbridge-rebuild/${env.EXPECT_FENBRIDGE === '1' ? 'after' : 'before'}`,
    metadataOut: env.METADATA_OUT ?? null,
    expectedFenbridge: env.EXPECT_FENBRIDGE === '1',
    acceptanceMode,
    sourceRevision:
      env.SOURCE_REVISION ?? (env.EXPECT_FENBRIDGE === '1' ? 'working-tree' : 'release-base'),
    profiles: Object.freeze(profiles),
    views: Object.freeze(views),
  });
}

function assertNear(actual, expected, label, tolerance = 0.001) {
  if (typeof actual !== 'number' || Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

function assertVector(actual, expected, label) {
  if (!actual) throw new Error(`${label} is unavailable`);
  assertNear(actual.x, expected.x, `${label}.x`);
  assertNear(actual.y, expected.y, `${label}.y`);
  assertNear(actual.z, expected.z, `${label}.z`);
}

export function assertFenbridgeCaptureRenderState({ renderState, profile, view }) {
  if (renderState.seed !== FENBRIDGE_CAPTURE_SEED) {
    throw new Error(`expected world seed ${FENBRIDGE_CAPTURE_SEED}, got ${renderState.seed}`);
  }
  if (renderState.tier !== profile.tier) {
    throw new Error(`expected ${profile.tier} tier, got ${renderState.tier}`);
  }
  if (renderState.profileName !== profile.name) {
    throw new Error(`expected ${profile.name} profile evidence, got ${renderState.profileName}`);
  }
  if (renderState.autoGovernor !== false) throw new Error('graphics governor must be disabled');
  for (const [key, value] of Object.entries(profile.settings)) {
    if (renderState.settings?.[key] !== value) {
      throw new Error(`setting ${key}: expected ${value}, got ${renderState.settings?.[key]}`);
    }
  }
  assertVector(renderState.camera, view.camera, 'camera');
  assertVector(renderState.target, view.target, 'target');
  if (!renderState.editorCamera) throw new Error('renderer editor camera is not active');
  assertVector(renderState.editorCamera.camera, view.camera, 'editorCamera.camera');
  assertVector(renderState.editorCamera.target, view.target, 'editorCamera.target');
  assertNear(renderState.player?.x, FENBRIDGE_PLAYER_STATE.x, 'player.x');
  assertNear(renderState.player?.y, FENBRIDGE_PLAYER_STATE.y, 'player.y');
  assertNear(renderState.player?.z, FENBRIDGE_PLAYER_STATE.z, 'player.z');
  assertNear(renderState.player?.facing, FENBRIDGE_PLAYER_STATE.facing, 'player.facing');
  if (renderState.playerCollisionClear !== true) {
    throw new Error('pinned Fenbridge player position is blocked');
  }
  if (renderState.zoneId !== FENBRIDGE_ZONE_ID) {
    throw new Error(`expected player in ${FENBRIDGE_ZONE_ID}, got ${renderState.zoneId}`);
  }
  const streaming = renderState.streaming;
  if (
    streaming?.fromZone !== FENBRIDGE_STREAMING_CONTRACT.from.zoneId ||
    streaming?.crossingZone !== FENBRIDGE_STREAMING_CONTRACT.crossing.zoneId ||
    streaming?.targetZone !== FENBRIDGE_ZONE_ID
  ) {
    throw new Error('capture did not exercise the Eastbrook-to-Mirefen streaming boundary');
  }
  if (
    streaming.readinessApi !== 'renderer.isZoneReadyAt' ||
    streaming.readinessDeadlineStartedBeforeCrossing !== true ||
    streaming.readinessPollStartedAfterCrossing !== true ||
    streaming.directPrepareZoneAtCalled !== false ||
    streaming.directPrewarmZoneAtCalled !== false ||
    streaming.waitedForReady !== true ||
    streaming.targetPrepared !== true ||
    streaming.targetReady !== true ||
    streaming.readyStableFrames < FENBRIDGE_STREAMING_CONTRACT.readyStableFrames ||
    !Number.isFinite(streaming.waitMs) ||
    streaming.waitMs < 0
  ) {
    throw new Error(
      'Mirefen automatic streaming did not reach the required post-crossing ready state',
    );
  }
  const validReadinessPath =
    (streaming.readinessPath === 'prestreamed' &&
      streaming.targetReadyAtFrom === true &&
      streaming.targetReadyAtCrossing === true) ||
    (streaming.readinessPath === 'automatic-wait' && streaming.targetReadyAtFrom === false);
  if (!validReadinessPath) {
    throw new Error('Mirefen streaming readiness path is internally inconsistent');
  }
  const expectedPhysical = {
    width: profile.viewport.width * profile.viewport.deviceScaleFactor,
    height: profile.viewport.height * profile.viewport.deviceScaleFactor,
  };
  if (
    renderState.viewport?.width !== profile.viewport.width ||
    renderState.viewport?.height !== profile.viewport.height ||
    renderState.viewport?.deviceScaleFactor !== profile.viewport.deviceScaleFactor ||
    renderState.viewport?.physicalWidth !== expectedPhysical.width ||
    renderState.viewport?.physicalHeight !== expectedPhysical.height
  ) {
    throw new Error('capture viewport does not match the profile contract');
  }
  if (renderState.mobile !== profile.mobile || renderState.touch !== profile.mobile) {
    throw new Error('capture mobile/touch emulation does not match the profile contract');
  }
  const expectedCanvasPixelRatio =
    Math.min(profile.viewport.deviceScaleFactor, profile.canvasPixelRatioCap) *
    profile.canvasAllocationScale;
  const expectedCanvasWidth = Math.floor(profile.viewport.width * expectedCanvasPixelRatio);
  const expectedCanvasHeight = Math.floor(profile.viewport.height * expectedCanvasPixelRatio);
  const canvas = renderState.canvas;
  if (
    canvas?.connected !== true ||
    canvas.visible !== true ||
    canvas.cssWidth !== profile.viewport.width ||
    canvas.cssHeight !== profile.viewport.height ||
    Math.abs((renderState.effectiveRenderScale ?? 0) - profile.effectiveRenderScale) > 0.001 ||
    Math.abs((canvas.pixelRatio ?? 0) - expectedCanvasPixelRatio) > 0.001 ||
    Math.abs((canvas.backingWidth ?? 0) - expectedCanvasWidth) > 1 ||
    Math.abs((canvas.backingHeight ?? 0) - expectedCanvasHeight) > 1 ||
    !Number.isInteger(canvas.frameCount) ||
    canvas.frameCount < 1
  ) {
    throw new Error(
      `live WebGL canvas does not match the profile contract: ${JSON.stringify({
        expected: {
          cssWidth: profile.viewport.width,
          cssHeight: profile.viewport.height,
          effectiveRenderScale: profile.effectiveRenderScale,
          pixelRatio: expectedCanvasPixelRatio,
          backingWidth: expectedCanvasWidth,
          backingHeight: expectedCanvasHeight,
        },
        observed: {
          ...canvas,
          effectiveRenderScale: renderState.effectiveRenderScale,
        },
      })}`,
    );
  }
  const touchHud = renderState.touchHud;
  if (touchHud?.exists !== true) {
    throw new Error('mobile controls DOM is unavailable');
  }
  if (
    profile.mobile &&
    (touchHud.visible !== true ||
      !Number.isInteger(touchHud.interactiveCount) ||
      touchHud.interactiveCount < 1 ||
      !Number.isInteger(touchHud.visibleInteractiveCount) ||
      touchHud.visibleInteractiveCount < 1)
  ) {
    throw new Error('mobile touch HUD is not visibly rendered');
  }
  if (!profile.mobile && touchHud.visible !== false) {
    throw new Error('mobile touch HUD must be hidden on desktop');
  }
  if (renderState.notices?.gpu !== false || renderState.notices?.performance !== false) {
    throw new Error('capture-only GPU and performance notices must be dismissed');
  }
}

function captureProfileRecord(profile) {
  return {
    name: profile.name,
    tier: profile.tier,
    viewport: profile.viewport,
  };
}

function captureViewRecord(view) {
  return {
    name: view.name,
    subject: view.subject,
    overlay: view.overlay ?? null,
    camera: view.camera,
    target: view.target,
  };
}

function assertCanonicalCaptureRecord(metadata) {
  const profile = FENBRIDGE_CAPTURE_PROFILES.find(
    (candidate) => candidate.name === metadata?.profile?.name,
  );
  const view = FENBRIDGE_CAPTURE_VIEWS.find((candidate) => candidate.name === metadata?.view?.name);
  if (!profile || !isDeepStrictEqual(metadata.profile, captureProfileRecord(profile))) {
    throw new Error('Fenbridge metadata profile does not match the canonical capture contract');
  }
  if (!view || !isDeepStrictEqual(metadata.view, captureViewRecord(view))) {
    throw new Error('Fenbridge metadata view does not match the canonical capture contract');
  }
  if (!isDeepStrictEqual(metadata.player, FENBRIDGE_PLAYER_STATE)) {
    throw new Error('Fenbridge metadata player does not match the canonical capture contract');
  }
  if (!isDeepStrictEqual(metadata.streaming, metadata.renderState?.streaming)) {
    throw new Error('Fenbridge persisted streaming evidence is inconsistent');
  }
  try {
    assertFenbridgeCaptureRenderState({ renderState: metadata.renderState, profile, view });
  } catch (error) {
    throw new Error(
      `Fenbridge persisted render evidence is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return { profile, view };
}

function sortedUnique(values) {
  return [...new Set(Array.isArray(values) ? values : [])].sort();
}

function compareExactIds(actual, expected, label, blockers) {
  const actualIds = sortedUnique(actual);
  const expectedIds = sortedUnique(expected);
  if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
    blockers.push(
      `${label} mismatch: expected ${JSON.stringify(expectedIds)}, got ${JSON.stringify(actualIds)}`,
    );
  }
}

export function fenbridgeAssetRequestMatches(logicalUrl, requestUrl) {
  if (typeof logicalUrl !== 'string' || typeof requestUrl !== 'string') {
    return false;
  }
  const pathname = (value) => {
    try {
      return new URL(value, 'http://capture.invalid').pathname;
    } catch {
      return value.split(/[?#]/, 1)[0];
    }
  };
  const logicalPath = pathname(logicalUrl);
  const requestPath = pathname(requestUrl);
  if (requestPath === logicalPath) return true;
  const logicalName = logicalPath.split('/').at(-1) ?? '';
  const requestName = requestPath.split('/').at(-1) ?? '';
  if (requestName === logicalName) return true;
  const extensionIndex = logicalName.lastIndexOf('.');
  if (extensionIndex <= 0) return false;
  const stem = logicalName.slice(0, extensionIndex).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const extension = logicalName.slice(extensionIndex).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${stem}\\.[a-f0-9]{8,64}${extension}$`, 'i').test(requestName);
}

function samePosition(record, expected, tolerance = 0.001) {
  return (
    record &&
    Number.isFinite(record.x) &&
    Number.isFinite(record.z) &&
    Math.abs(record.x - expected.x) <= tolerance &&
    Math.abs(record.z - expected.z) <= tolerance
  );
}

function validateFenbridgeGameplayEvidence(observed, blockers) {
  const gameplay = observed.gameplay ?? {};
  const npcRecords = Array.isArray(gameplay.npcs) ? gameplay.npcs : [];
  for (const expected of FENBRIDGE_GAMEPLAY_CONTRACT.npcs) {
    const matches = npcRecords.filter((npc) => npc.templateId === expected.id);
    if (
      matches.length !== 1 ||
      matches[0].kind !== 'npc' ||
      matches[0].dead !== false ||
      !samePosition(matches[0], expected)
    ) {
      blockers.push(`live Fenbridge NPC is invalid: ${expected.id}`);
    }
  }

  const mailbox = gameplay.mailbox ?? {};
  const mailboxExpected = FENBRIDGE_GAMEPLAY_CONTRACT.mailbox;
  if (
    mailbox.id !== mailboxExpected.id ||
    mailbox.templateId !== mailboxExpected.templateId ||
    mailbox.registrationCount !== 1 ||
    !samePosition(mailbox.service, mailboxExpected) ||
    mailbox.entityCount !== 1 ||
    mailbox.entity?.kind !== 'object' ||
    mailbox.entity?.templateId !== mailboxExpected.templateId ||
    mailbox.entity?.lootable !== true ||
    !samePosition(mailbox.entity, mailboxExpected)
  ) {
    blockers.push('live Fenbridge mailbox service is invalid');
  }

  const station = gameplay.station;
  const stationExpected = FENBRIDGE_GAMEPLAY_CONTRACT.station;
  if (
    station?.registrationCount !== 1 ||
    station?.id !== stationExpected.id ||
    station.type !== stationExpected.type ||
    station.zoneId !== stationExpected.zoneId ||
    station.masterNpcId !== stationExpected.masterNpcId ||
    !samePosition(station, stationExpected)
  ) {
    blockers.push('live Fenbridge tannery station is invalid');
  }

  const graveyard = gameplay.graveyard ?? {};
  const graveyardExpected = FENBRIDGE_GAMEPLAY_CONTRACT.graveyard;
  if (
    graveyard.registrationCount !== 1 ||
    graveyard.id !== graveyardExpected.id ||
    graveyard.name !== graveyardExpected.name ||
    !samePosition(graveyard, graveyardExpected) ||
    graveyard.healerCount !== 1 ||
    graveyard.healer?.kind !== 'npc' ||
    graveyard.healer?.templateId !== graveyardExpected.healerTemplateId ||
    graveyard.healer?.dead !== false ||
    !samePosition(graveyard.healer, graveyardExpected)
  ) {
    blockers.push('live Fenbridge graveyard service is invalid');
  }

  if (
    gameplay.rest?.id !== FENBRIDGE_GAMEPLAY_CONTRACT.rest.id ||
    gameplay.rest?.buildingId !== FENBRIDGE_GAMEPLAY_CONTRACT.rest.buildingId
  ) {
    blockers.push('Fenbridge inn rest service contract is invalid');
  }

  const musterOrders = Array.isArray(gameplay.musterOrders) ? gameplay.musterOrders : [];
  if (musterOrders.length !== FENBRIDGE_GAMEPLAY_CONTRACT.musterOrders.length) {
    blockers.push(
      `live Fenbridge muster order count must be ${FENBRIDGE_GAMEPLAY_CONTRACT.musterOrders.length}; got ${musterOrders.length}`,
    );
  }
  for (const expected of FENBRIDGE_GAMEPLAY_CONTRACT.musterOrders) {
    const matches = musterOrders.filter((order) => order.placementId === expected.id);
    if (
      matches.length !== 1 ||
      matches[0].kind !== 'object' ||
      matches[0].itemId !== FENBRIDGE_GAMEPLAY_CONTRACT.quest.itemId ||
      matches[0].lootable !== true ||
      matches[0].dead !== false ||
      !samePosition(matches[0], expected)
    ) {
      blockers.push(`live Fenbridge muster order is invalid: ${expected.id}`);
    }
  }

  const quest = gameplay.quest ?? {};
  const questExpected = FENBRIDGE_GAMEPLAY_CONTRACT.quest;
  if (
    quest.id !== questExpected.id ||
    quest.giverNpcId !== questExpected.giverNpcId ||
    quest.turnInNpcId !== questExpected.turnInNpcId ||
    quest.itemId !== questExpected.itemId ||
    quest.count !== questExpected.count ||
    quest.itemQuestId !== questExpected.id ||
    quest.state !== questExpected.captureState
  ) {
    blockers.push('live Fenbridge muster quest state is invalid');
  }

  const routes = Array.isArray(gameplay.traversability?.routes)
    ? gameplay.traversability.routes
    : [];
  const expectedRouteCount =
    FENBRIDGE_TRAVERSAL_DESTINATION_IDS.length * FENBRIDGE_TRAVERSAL_BODY_RADII.length * 2;
  if (routes.length !== expectedRouteCount) {
    blockers.push(
      `Fenbridge traversability matrix must contain ${expectedRouteCount} routes; got ${routes.length}`,
    );
  }
  for (const destinationId of FENBRIDGE_TRAVERSAL_DESTINATION_IDS) {
    for (const bodyRadius of FENBRIDGE_TRAVERSAL_BODY_RADII) {
      for (const direction of ['out', 'back']) {
        const matches = routes.filter(
          (route) =>
            route.destinationId === destinationId &&
            route.bodyRadius === bodyRadius &&
            route.direction === direction,
        );
        if (
          matches.length !== 1 ||
          matches[0].clear !== true ||
          matches[0].startClear !== true ||
          matches[0].endClear !== true ||
          !Number.isInteger(matches[0].waypointCount) ||
          matches[0].waypointCount < 1 ||
          !Number.isInteger(matches[0].sampleCount) ||
          matches[0].sampleCount < 2
        ) {
          blockers.push(
            `Fenbridge route is not traversable: ${destinationId}/${bodyRadius}/${direction}`,
          );
        }
        const lockedAnchor = FENBRIDGE_LOCKED_ROUTE_ANCHORS[destinationId];
        if (lockedAnchor) {
          const anchoredEndpoint = direction === 'out' ? matches[0]?.end : matches[0]?.start;
          if (!samePosition(anchoredEndpoint, lockedAnchor)) {
            blockers.push(
              `Fenbridge route misses locked exterior anchor: ${destinationId}/${bodyRadius}/${direction}`,
            );
          }
        }
      }
    }
  }

  const visuals = observed.serviceVisuals ?? {};
  const renderedNpcIds = sortedUnique(visuals.renderedNpcTemplateIds);
  const missingRenderedNpcs = FENBRIDGE_GAMEPLAY_CONTRACT.npcs
    .map((npc) => npc.id)
    .filter((id) => !renderedNpcIds.includes(id));
  if (missingRenderedNpcs.length > 0) {
    blockers.push(`Fenbridge NPC visuals are missing: ${missingRenderedNpcs.join(', ')}`);
  }
  if (
    visuals.mailbox?.rendered !== true ||
    !Number.isInteger(visuals.mailbox?.meshCount) ||
    visuals.mailbox.meshCount < 1
  ) {
    blockers.push('Fenbridge mailbox visual is missing');
  }
  if (
    visuals.bankerChest?.rendered !== true ||
    visuals.bankerChest?.templateId !== 'bursar_petra_vell' ||
    !Number.isInteger(visuals.bankerChest?.meshCount) ||
    visuals.bankerChest.meshCount < 1
  ) {
    blockers.push('Fenbridge banker chest visual is missing');
  }
  if (
    visuals.spiritHealer?.rendered !== true ||
    !Number.isInteger(visuals.spiritHealer?.meshCount) ||
    visuals.spiritHealer.meshCount < 1
  ) {
    blockers.push('Fenbridge spirit healer visual is missing');
  }
  if (visuals.tannery?.rendered !== true || visuals.tannery?.instanceCount !== 1) {
    blockers.push(
      `Fenbridge tannery visual count must be 1; got ${visuals.tannery?.instanceCount ?? 'missing'}`,
    );
  }
  if (visuals.renderedMusterOrderCount !== 2) {
    blockers.push(
      `rendered Fenbridge muster order count must be 2; got ${visuals.renderedMusterOrderCount ?? 'missing'}`,
    );
  }
}

export function fenbridgeAcceptanceReadiness(metadata, { requireFrame = true } = {}) {
  const blockers = [];
  const expectedFenbridge = metadata?.contract?.expectedFenbridge;
  const observed = metadata?.observed ?? {};
  const inventory = observed.inventory ?? {};
  let canonicalProfile = null;
  try {
    canonicalProfile = assertCanonicalCaptureRecord(metadata).profile;
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : String(error));
  }

  if (expectedFenbridge === true) {
    if (observed.root?.present !== true) {
      blockers.push(`scene root ${FENBRIDGE_TOWN_ROOT_NAME} is missing`);
    }
    if (observed.root?.layoutId !== FENBRIDGE_LAYOUT_ID) {
      blockers.push(
        `Fenbridge layout id must be ${FENBRIDGE_LAYOUT_ID}; got ${observed.root?.layoutId ?? 'missing'}`,
      );
    }
    if (observed.root?.visible !== true) {
      blockers.push(`scene root ${FENBRIDGE_TOWN_ROOT_NAME} is not visible`);
    }
    if (!Number.isInteger(observed.root?.childMeshCount) || observed.root.childMeshCount < 1) {
      blockers.push(`scene root ${FENBRIDGE_TOWN_ROOT_NAME} has no rendered meshes`);
    }
    const missingHookFields = FENBRIDGE_CAPTURE_HOOK_CONTRACT.rootUserData.filter(
      (field) => observed.root?.hookFields?.[field] !== true,
    );
    if (missingHookFields.length > 0) {
      blockers.push(`Fenbridge root metadata hook is missing: ${missingHookFields.join(', ')}`);
    }
    const rebuildIds = sortedUnique(inventory.rebuildIds);
    const missing = FENBRIDGE_REBUILD_REQUIRED_IDS.filter((id) => !rebuildIds.includes(id));
    if (missing.length > 0) blockers.push(`missing rebuild placement ids: ${missing.join(', ')}`);
    const renderedRebuildIds = sortedUnique(inventory.renderedRebuildIds);
    const missingRendered = FENBRIDGE_REBUILD_REQUIRED_IDS.filter(
      (id) => !renderedRebuildIds.includes(id),
    );
    if (missingRendered.length > 0) {
      blockers.push(`missing rendered rebuild placement ids: ${missingRendered.join(', ')}`);
    }
    const retired = sortedUnique(inventory.legacyIds);
    if (retired.length > 0) {
      blockers.push(
        `retired generic Fenbridge placements are still present: ${retired.join(', ')}`,
      );
    }
    for (const [assetKey, requirement] of Object.entries(FENBRIDGE_REPEATED_ASSET_REQUIREMENTS)) {
      const count = inventory.repeatedCounts?.[assetKey];
      if (!Number.isInteger(count)) {
        blockers.push(`repeated asset count is missing for ${assetKey}`);
      } else if (requirement.exact !== undefined && count !== requirement.exact) {
        blockers.push(`${assetKey} count must be ${requirement.exact}; got ${count}`);
      } else if (requirement.min !== undefined && count < requirement.min) {
        blockers.push(`${assetKey} count must be at least ${requirement.min}; got ${count}`);
      }
      const observedCount = inventory.observedRepeatedCounts?.[assetKey];
      if (!Number.isInteger(observedCount)) {
        blockers.push(`rendered repeated asset count is missing for ${assetKey}`);
      } else if (requirement.exact !== undefined && observedCount !== requirement.exact) {
        blockers.push(
          `rendered ${assetKey} count must be ${requirement.exact}; got ${observedCount}`,
        );
      } else if (requirement.min !== undefined && observedCount < requirement.min) {
        blockers.push(
          `rendered ${assetKey} count must be at least ${requirement.min}; got ${observedCount}`,
        );
      }
    }
    if ((observed.assets?.failures ?? []).length > 0) {
      blockers.push(`Fenbridge asset failures: ${observed.assets.failures.join('; ')}`);
    }
    compareExactIds(
      observed.assets?.declaredUrls,
      FENBRIDGE_TOWN_ASSET_URLS,
      'Fenbridge root asset URL inventory',
      blockers,
    );
    const assetRequests = observed.assets?.requests ?? [];
    const requestedLogicalUrls = FENBRIDGE_REQUIRED_ASSET_REQUEST_URLS.filter((logicalUrl) =>
      assetRequests.some((requestUrl) => fenbridgeAssetRequestMatches(logicalUrl, requestUrl)),
    );
    compareExactIds(
      requestedLogicalUrls,
      FENBRIDGE_REQUIRED_ASSET_REQUEST_URLS,
      'Fenbridge requested asset coverage',
      blockers,
    );
    validateFenbridgeGameplayEvidence(observed, blockers);
    const canonicalView = FENBRIDGE_CAPTURE_VIEWS.find(
      (view) => view.name === metadata?.view?.name,
    );
    if (canonicalView?.overlay === 'collision-routes') {
      if (observed.overlay?.supported !== true) {
        blockers.push('Fenbridge collision/route overlay hook is unavailable');
      } else if (observed.overlay?.visible !== true) {
        blockers.push('Fenbridge collision/route overlay is not visible');
      }
      if (observed.overlay?.renderableCount !== FENBRIDGE_OVERLAY_CONTRACT.renderableCount) {
        blockers.push(
          `Fenbridge collision/route overlay renderable count must be ${FENBRIDGE_OVERLAY_CONTRACT.renderableCount}; got ${observed.overlay?.renderableCount ?? 'missing'}`,
        );
      }
      for (const kind of ['colliders', 'routes', 'services']) {
        const recordIds = observed.overlay?.recordIds?.[kind];
        const recordCount = observed.overlay?.recordCounts?.[kind];
        const expectedIds = FENBRIDGE_OVERLAY_CONTRACT.recordIds[kind];
        compareExactIds(
          recordIds,
          expectedIds,
          `Fenbridge collision/route overlay ${kind}`,
          blockers,
        );
        if (recordCount !== expectedIds.length || recordCount !== recordIds?.length) {
          blockers.push(
            `Fenbridge collision/route overlay ${kind} count must be ${expectedIds.length}; got ${recordCount ?? 'missing'}`,
          );
        }
      }
    }
  } else if (expectedFenbridge === false) {
    if (observed.root?.present === true) {
      blockers.push(`release-base capture unexpectedly contains ${FENBRIDGE_TOWN_ROOT_NAME}`);
    }
    compareExactIds(
      inventory.legacyIds,
      expectedFenbridgeInventory(false).legacyIds,
      'release-base legacy inventory',
      blockers,
    );
    if (sortedUnique(inventory.rebuildIds).length > 0) {
      blockers.push('release-base capture unexpectedly contains rebuild placement ids');
    }
    const unexpectedTownRequests = [
      ...FENBRIDGE_TOWN_ASSET_URLS,
      ...FENBRIDGE_SURFACE_TEXTURE_URLS,
    ].filter((logicalUrl) =>
      (observed.assets?.requests ?? []).some((requestUrl) =>
        fenbridgeAssetRequestMatches(logicalUrl, requestUrl),
      ),
    );
    if (unexpectedTownRequests.length > 0) {
      blockers.push(
        `release-base capture unexpectedly requested Fenbridge assets: ${unexpectedTownRequests.join(', ')}`,
      );
    }
    if ((observed.assets?.failures ?? []).length > 0) {
      blockers.push(
        `release-base Fenbridge asset failures: ${observed.assets.failures.join('; ')}`,
      );
    }
  } else {
    blockers.push('metadata expectedFenbridge flag is missing');
  }

  if (requireFrame) {
    const frame = metadata?.frame;
    const viewport = canonicalProfile?.viewport;
    const expectedWidth = viewport?.width * viewport?.deviceScaleFactor;
    const expectedHeight = viewport?.height * viewport?.deviceScaleFactor;
    if (
      typeof frame?.output !== 'string' ||
      !frame.output.endsWith('.png') ||
      !Number.isInteger(frame.bytes) ||
      frame.bytes <= 0
    ) {
      blockers.push('capture PNG evidence is missing');
    }
    if (!/^[a-f0-9]{64}$/.test(frame?.sha256 ?? '')) {
      blockers.push('capture PNG SHA-256 evidence is missing');
    }
    if (
      frame?.structure?.ihdr !== true ||
      !Number.isInteger(frame?.structure?.idatChunks) ||
      frame.structure.idatChunks < 1 ||
      frame?.structure?.iend !== true
    ) {
      blockers.push('capture PNG structure evidence is incomplete');
    }
    if (
      !Number.isInteger(frame?.width) ||
      !Number.isInteger(frame?.height) ||
      frame.width !== expectedWidth ||
      frame.height !== expectedHeight
    ) {
      blockers.push(
        `capture PNG dimensions must be ${expectedWidth}x${expectedHeight}; got ${frame?.width ?? 'missing'}x${frame?.height ?? 'missing'}`,
      );
    }
    if (frame?.settleMs !== FENBRIDGE_CAPTURE_TIMING.viewSettleMs) {
      blockers.push(`capture settle time must be ${FENBRIDGE_CAPTURE_TIMING.viewSettleMs}ms`);
    }
  }

  return Object.freeze({
    ready: blockers.length === 0,
    blockers: Object.freeze(blockers),
  });
}

export function assertFenbridgeCaptureMetadata({
  metadata,
  profile,
  view,
  expectedFenbridge,
  acceptanceMode,
  requireFrame = true,
}) {
  if (metadata?.schemaVersion !== 1 || metadata.captureScope !== 'fenbridge-town') {
    throw new Error('Fenbridge metadata schema or capture scope is invalid');
  }
  if (
    metadata.contract?.layoutId !== FENBRIDGE_LAYOUT_ID ||
    metadata.contract?.rootName !== FENBRIDGE_TOWN_ROOT_NAME ||
    metadata.contract?.expectedFenbridge !== expectedFenbridge ||
    metadata.contract?.acceptanceMode !== acceptanceMode
  ) {
    throw new Error('Fenbridge metadata contract is invalid');
  }
  if (metadata.profile?.name !== profile.name || metadata.view?.name !== view.name) {
    throw new Error('Fenbridge metadata profile/view does not match the requested capture');
  }
  assertCanonicalCaptureRecord(metadata);
  if (metadata.seed !== FENBRIDGE_CAPTURE_SEED) {
    throw new Error('Fenbridge metadata seed is invalid');
  }
  if (typeof metadata.source?.revision !== 'string' || metadata.source.revision.length === 0) {
    throw new Error('Fenbridge source revision is missing');
  }
  for (const key of ['pageErrors', 'consoleErrors', 'requestFailures']) {
    if (!Array.isArray(metadata.diagnostics?.[key])) {
      throw new Error(`Fenbridge diagnostics.${key} is missing`);
    }
    if (metadata.diagnostics[key].length > 0) {
      throw new Error(`Fenbridge diagnostics.${key}: ${metadata.diagnostics[key].join('; ')}`);
    }
  }
  if (acceptanceMode) {
    const readiness = fenbridgeAcceptanceReadiness(metadata, { requireFrame });
    if (!readiness.ready) {
      throw new Error(`Fenbridge acceptance blocked: ${readiness.blockers.join(' | ')}`);
    }
  }
}

export function assertFenbridgeCaptureBatchMetadata({
  metadata,
  expectedFenbridge,
  acceptanceMode,
}) {
  if (metadata?.schemaVersion !== 1 || metadata.captureScope !== 'fenbridge-town-batch') {
    throw new Error('Fenbridge batch metadata schema or capture scope is invalid');
  }
  if (
    metadata.contract?.layoutId !== FENBRIDGE_LAYOUT_ID ||
    metadata.contract?.rootName !== FENBRIDGE_TOWN_ROOT_NAME ||
    metadata.contract?.expectedFenbridge !== expectedFenbridge ||
    metadata.contract?.acceptanceMode !== acceptanceMode
  ) {
    throw new Error('Fenbridge batch metadata contract is invalid');
  }
  if (typeof metadata.source?.revision !== 'string' || metadata.source.revision.length === 0) {
    throw new Error('Fenbridge batch source revision is missing');
  }
  if (!Array.isArray(metadata.profiles)) {
    throw new Error('Fenbridge batch profiles are missing');
  }

  const profileNames = metadata.profiles.map((entry) => entry?.profile?.name);
  if (new Set(profileNames).size !== profileNames.length) {
    throw new Error('Fenbridge batch contains duplicate profiles');
  }
  if (acceptanceMode) {
    const expectedProfileNames = FENBRIDGE_CAPTURE_PROFILES.map((profile) => profile.name);
    if (
      metadata.complete !== true ||
      metadata.profiles.length !== FENBRIDGE_CAPTURE_PROFILES.length ||
      JSON.stringify([...profileNames].sort()) !== JSON.stringify([...expectedProfileNames].sort())
    ) {
      throw new Error('Fenbridge acceptance batch requires the complete profile matrix');
    }
  }

  const frameOutputs = new Set();
  const frameHashes = new Set();
  for (const profileBatch of metadata.profiles) {
    const profile = FENBRIDGE_CAPTURE_PROFILES.find(
      (candidate) => candidate.name === profileBatch?.profile?.name,
    );
    if (!profile) {
      throw new Error(
        `Fenbridge batch contains an unknown profile: ${profileBatch?.profile?.name}`,
      );
    }
    if (!isDeepStrictEqual(profileBatch.profile, captureProfileRecord(profile))) {
      throw new Error(`Fenbridge batch profile contract drifted for ${profile.name}`);
    }
    if (!Array.isArray(profileBatch.records)) {
      throw new Error(`Fenbridge batch records are missing for ${profile.name}`);
    }
    const viewNames = profileBatch.records.map((record) => record?.view?.name);
    if (new Set(viewNames).size !== viewNames.length) {
      throw new Error(`Fenbridge batch contains duplicate views for ${profile.name}`);
    }
    if (acceptanceMode) {
      const expectedViewNames = FENBRIDGE_CAPTURE_VIEWS.map((view) => view.name);
      if (
        profileBatch.records.length !== FENBRIDGE_CAPTURE_VIEWS.length ||
        JSON.stringify([...viewNames].sort()) !== JSON.stringify([...expectedViewNames].sort())
      ) {
        throw new Error(`Fenbridge acceptance batch requires every view for ${profile.name}`);
      }
    }
    for (const record of profileBatch.records) {
      const view = FENBRIDGE_CAPTURE_VIEWS.find(
        (candidate) => candidate.name === record?.view?.name,
      );
      if (!view) {
        throw new Error(`Fenbridge batch contains an unknown view: ${record?.view?.name}`);
      }
      if (record.source?.revision !== metadata.source.revision) {
        throw new Error(`Fenbridge batch source revision drifted at ${profile.name}/${view.name}`);
      }
      if (acceptanceMode) {
        const expectedFrameSuffix = `-${view.name}-${profile.name}.png`;
        if (!record.frame?.output?.endsWith(expectedFrameSuffix)) {
          throw new Error(`Fenbridge frame output does not match ${profile.name}/${view.name}`);
        }
        if (frameOutputs.has(record.frame.output)) {
          throw new Error('Fenbridge batch reuses a frame output');
        }
        frameOutputs.add(record.frame.output);
        if (frameHashes.has(record.frame.sha256)) {
          throw new Error('Fenbridge batch contains byte-identical frame artifacts');
        }
        frameHashes.add(record.frame.sha256);
      }
      assertFenbridgeCaptureMetadata({
        metadata: record,
        profile,
        view,
        expectedFenbridge,
        acceptanceMode,
      });
    }
  }
}
