import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const captureContract =
  // @ts-expect-error -- the executable capture contract intentionally ships as plain Node ESM.
  await import('../scripts/assets/fenbridge_town/capture_contract.mjs');
const {
  assertFenbridgeCaptureArtifactFiles,
  assertFenbridgeCaptureBatchMetadata,
  assertFenbridgeCaptureMetadata,
  assertFenbridgeCaptureRenderState,
  captureFrameFilename,
  captureMetadataFilename,
  classifyFenbridgePlacementInventory,
  expectedFenbridgeInventory,
  fenbridgeAcceptanceReadiness,
  fenbridgeAssetRequestMatches,
  fenbridgePngFrameEvidence,
  FENBRIDGE_CAPTURE_CHARACTER,
  FENBRIDGE_CAPTURE_HOOK_CONTRACT,
  FENBRIDGE_CAPTURE_PROFILES,
  FENBRIDGE_CAPTURE_SEED,
  FENBRIDGE_CAPTURE_TIMING,
  FENBRIDGE_CAPTURE_VIEWS,
  FENBRIDGE_EXPECTED_LOCAL_PROXY_502_PATHS,
  FENBRIDGE_GAMEPLAY_CONTRACT,
  FENBRIDGE_LAYOUT_ID,
  FENBRIDGE_LEGACY_PLACEMENT_INVENTORY,
  FENBRIDGE_LOCKED_ROUTE_ANCHORS,
  FENBRIDGE_OVERLAY_CONTRACT,
  FENBRIDGE_PLAYER_STATE,
  FENBRIDGE_REBUILD_REQUIRED_IDS,
  FENBRIDGE_REQUIRED_ASSET_REQUEST_URLS,
  FENBRIDGE_REPEATED_ASSET_REQUIREMENTS,
  FENBRIDGE_SHARED_SERVICE_ASSET_URLS,
  FENBRIDGE_SURFACE_TEXTURE_URLS,
  FENBRIDGE_STREAMING_CONTRACT,
  FENBRIDGE_TOWN_ASSET_URLS,
  FENBRIDGE_TOWN_ROOT_NAME,
  FENBRIDGE_TRAVERSAL_BODY_RADII,
  FENBRIDGE_TRAVERSAL_DESTINATION_IDS,
  FENBRIDGE_ZONE_ID,
  selectFenbridgeCaptureConfiguration,
} = captureContract;

const desktop = FENBRIDGE_CAPTURE_PROFILES[0];
const mobile = FENBRIDGE_CAPTURE_PROFILES[1];
const overview = FENBRIDGE_CAPTURE_VIEWS[0];
const overlayView = FENBRIDGE_CAPTURE_VIEWS.find(
  (view: { name: string }) => view.name === 'collision-route-overlay',
);

function validStreaming() {
  return {
    fromZone: 'eastbrook_vale',
    crossingZone: FENBRIDGE_ZONE_ID,
    targetZone: FENBRIDGE_ZONE_ID,
    targetReadyBeforeCrossing: false,
    targetReadyAtFrom: false,
    targetReadyAtCrossing: false,
    readinessPath: 'automatic-wait',
    readinessApi: 'renderer.isZoneReadyAt',
    readinessDeadlineStartedBeforeCrossing: true,
    readinessPollStartedAfterCrossing: true,
    directPrepareZoneAtCalled: false,
    directPrewarmZoneAtCalled: false,
    waitedForReady: true,
    targetPrepared: true,
    targetReady: true,
    readyStableFrames: 3,
    waitMs: 418.2,
    stats: { preparedZones: 2 },
  };
}

function frameDigest(profile: any, view: any): string {
  return createHash('sha256').update(`${profile.name}/${view.name}`).digest('hex');
}

function pngCrc32ForTest(bytes: Buffer): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

function validRenderState(profile = desktop, view = overview): any {
  const canvasPixelRatio =
    Math.min(profile.viewport.deviceScaleFactor, profile.canvasPixelRatioCap) *
    profile.canvasAllocationScale;
  return {
    seed: FENBRIDGE_CAPTURE_SEED,
    profileName: profile.name,
    tier: profile.tier,
    autoGovernor: false,
    effectiveRenderScale: profile.effectiveRenderScale,
    settings: { ...profile.settings },
    player: { ...FENBRIDGE_PLAYER_STATE },
    playerCollisionClear: true,
    zoneId: FENBRIDGE_ZONE_ID,
    camera: { ...view.camera },
    target: { ...view.target },
    editorCamera: {
      camera: { ...view.camera },
      target: { ...view.target },
    },
    viewport: {
      width: profile.viewport.width,
      height: profile.viewport.height,
      deviceScaleFactor: profile.viewport.deviceScaleFactor,
      physicalWidth: profile.viewport.width * profile.viewport.deviceScaleFactor,
      physicalHeight: profile.viewport.height * profile.viewport.deviceScaleFactor,
    },
    mobile: profile.mobile,
    touch: profile.mobile,
    canvas: {
      connected: true,
      visible: true,
      cssWidth: profile.viewport.width,
      cssHeight: profile.viewport.height,
      backingWidth: Math.floor(profile.viewport.width * canvasPixelRatio),
      backingHeight: Math.floor(profile.viewport.height * canvasPixelRatio),
      pixelRatio: canvasPixelRatio,
      frameCount: 120,
    },
    touchHud: {
      exists: true,
      visible: profile.mobile,
      interactiveCount: 14,
      visibleInteractiveCount: profile.mobile ? 12 : 0,
    },
    notices: { gpu: false, performance: false },
    streaming: validStreaming(),
  };
}

function validGameplayEvidence(): any {
  return {
    npcs: FENBRIDGE_GAMEPLAY_CONTRACT.npcs.map(
      (npc: { id: string; x: number; z: number }, index: number) => ({
        entityId: 100 + index,
        kind: 'npc',
        templateId: npc.id,
        dead: false,
        x: npc.x,
        z: npc.z,
      }),
    ),
    mailbox: {
      id: FENBRIDGE_GAMEPLAY_CONTRACT.mailbox.id,
      templateId: FENBRIDGE_GAMEPLAY_CONTRACT.mailbox.templateId,
      registrationCount: 1,
      service: {
        x: FENBRIDGE_GAMEPLAY_CONTRACT.mailbox.x,
        z: FENBRIDGE_GAMEPLAY_CONTRACT.mailbox.z,
      },
      entity: {
        entityId: 220,
        kind: 'object',
        templateId: FENBRIDGE_GAMEPLAY_CONTRACT.mailbox.templateId,
        lootable: true,
        dead: false,
        x: FENBRIDGE_GAMEPLAY_CONTRACT.mailbox.x,
        z: FENBRIDGE_GAMEPLAY_CONTRACT.mailbox.z,
      },
      entityCount: 1,
    },
    station: {
      ...FENBRIDGE_GAMEPLAY_CONTRACT.station,
      registrationCount: 1,
    },
    graveyard: {
      ...FENBRIDGE_GAMEPLAY_CONTRACT.graveyard,
      registrationCount: 1,
      healerCount: 1,
      healer: {
        entityId: 221,
        kind: 'npc',
        templateId: FENBRIDGE_GAMEPLAY_CONTRACT.graveyard.healerTemplateId,
        dead: false,
        x: FENBRIDGE_GAMEPLAY_CONTRACT.graveyard.x,
        z: FENBRIDGE_GAMEPLAY_CONTRACT.graveyard.z,
      },
    },
    rest: { ...FENBRIDGE_GAMEPLAY_CONTRACT.rest },
    musterOrders: FENBRIDGE_GAMEPLAY_CONTRACT.musterOrders.map(
      (order: { id: string; x: number; z: number }, index: number) => ({
        entityId: 230 + index,
        placementId: order.id,
        kind: 'object',
        itemId: FENBRIDGE_GAMEPLAY_CONTRACT.quest.itemId,
        lootable: true,
        dead: false,
        x: order.x,
        z: order.z,
      }),
    ),
    quest: {
      id: FENBRIDGE_GAMEPLAY_CONTRACT.quest.id,
      giverNpcId: FENBRIDGE_GAMEPLAY_CONTRACT.quest.giverNpcId,
      turnInNpcId: FENBRIDGE_GAMEPLAY_CONTRACT.quest.turnInNpcId,
      itemId: FENBRIDGE_GAMEPLAY_CONTRACT.quest.itemId,
      count: FENBRIDGE_GAMEPLAY_CONTRACT.quest.count,
      itemQuestId: FENBRIDGE_GAMEPLAY_CONTRACT.quest.id,
      state: FENBRIDGE_GAMEPLAY_CONTRACT.quest.captureState,
    },
    traversability: {
      routes: FENBRIDGE_TRAVERSAL_DESTINATION_IDS.flatMap((destinationId: string) =>
        FENBRIDGE_TRAVERSAL_BODY_RADII.flatMap((bodyRadius: number) =>
          ['out', 'back'].map((direction) => {
            const origin = { x: 3, z: 303 };
            const destination = FENBRIDGE_LOCKED_ROUTE_ANCHORS[destinationId] ?? {
              x: 3.25,
              z: 303.25,
            };
            return {
              destinationId,
              bodyRadius,
              direction,
              clear: true,
              startClear: true,
              endClear: true,
              waypointCount: 3,
              sampleCount: 12,
              start: direction === 'out' ? origin : destination,
              end: direction === 'out' ? destination : origin,
            };
          }),
        ),
      ),
    },
  };
}

function validObserved(expectedFenbridge: boolean, view = overview): any {
  return expectedFenbridge
    ? {
        root: {
          name: FENBRIDGE_TOWN_ROOT_NAME,
          present: true,
          visible: true,
          layoutId: FENBRIDGE_LAYOUT_ID,
          childMeshCount: 97,
          hookFields: {
            layoutId: true,
            placementIds: true,
            assetPlacementCounts: true,
            assetUrls: true,
          },
        },
        inventory: {
          legacyIds: [],
          rebuildIds: [...FENBRIDGE_REBUILD_REQUIRED_IDS],
          renderedRebuildIds: [...FENBRIDGE_REBUILD_REQUIRED_IDS],
          repeatedCounts: {
            fenbridge_palisade_wing: 16,
            fenbridge_gate_arch: 4,
            fenbridge_boardwalk: 12,
            fenbridge_muster_order: 2,
          },
          observedRepeatedCounts: {
            fenbridge_palisade_wing: 16,
            fenbridge_gate_arch: 4,
            fenbridge_boardwalk: 12,
            fenbridge_muster_order: 2,
          },
        },
        assets: {
          declaredUrls: [...FENBRIDGE_TOWN_ASSET_URLS],
          requests: [...FENBRIDGE_REQUIRED_ASSET_REQUEST_URLS],
          failures: [],
        },
        overlay: {
          requested: view.overlay === 'collision-routes',
          supported: view.overlay === 'collision-routes',
          visible: view.overlay === 'collision-routes',
          source: view.overlay === 'collision-routes' ? 'renderer' : null,
          renderableCount:
            view.overlay === 'collision-routes' ? FENBRIDGE_OVERLAY_CONTRACT.renderableCount : 0,
          recordIds:
            view.overlay === 'collision-routes'
              ? Object.fromEntries(
                  Object.entries(FENBRIDGE_OVERLAY_CONTRACT.recordIds).map(([kind, ids]) => [
                    kind,
                    [...(ids as string[])],
                  ]),
                )
              : { colliders: [], routes: [], services: [] },
          recordCounts:
            view.overlay === 'collision-routes'
              ? Object.fromEntries(
                  Object.entries(FENBRIDGE_OVERLAY_CONTRACT.recordIds).map(([kind, ids]) => [
                    kind,
                    (ids as string[]).length,
                  ]),
                )
              : { colliders: 0, routes: 0, services: 0 },
        },
        gameplay: validGameplayEvidence(),
        serviceVisuals: {
          renderedNpcTemplateIds: FENBRIDGE_GAMEPLAY_CONTRACT.npcs.map(
            (npc: { id: string }) => npc.id,
          ),
          mailbox: { rendered: true, entityId: 220, meshCount: 8 },
          bankerChest: {
            rendered: true,
            entityId: 105,
            templateId: 'bursar_petra_vell',
            meshCount: 6,
          },
          spiritHealer: { rendered: true, entityId: 221, meshCount: 4 },
          tannery: { rendered: true, instanceCount: 1 },
          renderedMusterOrderCount: 2,
        },
      }
    : {
        root: {
          name: FENBRIDGE_TOWN_ROOT_NAME,
          present: false,
          visible: false,
          layoutId: null,
          childMeshCount: 0,
        },
        inventory: {
          legacyIds: [...expectedFenbridgeInventory(false).legacyIds],
          rebuildIds: [],
          renderedRebuildIds: [],
          repeatedCounts: {
            fenbridge_palisade_wing: null,
            fenbridge_gate_arch: null,
            fenbridge_boardwalk: null,
            fenbridge_muster_order: 2,
          },
          observedRepeatedCounts: {
            fenbridge_palisade_wing: null,
            fenbridge_gate_arch: null,
            fenbridge_boardwalk: null,
            fenbridge_muster_order: 2,
          },
        },
        assets: {
          declaredUrls: [],
          requests: [...FENBRIDGE_SHARED_SERVICE_ASSET_URLS],
          failures: [],
        },
        overlay: {
          requested: false,
          supported: false,
          visible: false,
          source: null,
        },
      };
}

function validMetadata({
  expectedFenbridge = true,
  acceptanceMode = true,
  profile = desktop,
  view = overview,
} = {}): any {
  return {
    schemaVersion: 1,
    captureScope: 'fenbridge-town',
    contract: {
      layoutId: FENBRIDGE_LAYOUT_ID,
      rootName: FENBRIDGE_TOWN_ROOT_NAME,
      expectedFenbridge,
      acceptanceMode,
    },
    source: { revision: expectedFenbridge ? 'working-tree' : 'release-base' },
    profile: {
      name: profile.name,
      tier: profile.tier,
      viewport: profile.viewport,
    },
    view: {
      name: view.name,
      subject: view.subject,
      overlay: view.overlay ?? null,
      camera: view.camera,
      target: view.target,
    },
    seed: FENBRIDGE_CAPTURE_SEED,
    player: FENBRIDGE_PLAYER_STATE,
    streaming: validStreaming(),
    renderState: validRenderState(profile, view),
    observed: validObserved(expectedFenbridge, view),
    diagnostics: { pageErrors: [], consoleErrors: [], requestFailures: [] },
    frame: {
      output: `/tmp/after-${view.name}-${profile.name}.png`,
      bytes: 12_345,
      width: profile.viewport.width * profile.viewport.deviceScaleFactor,
      height: profile.viewport.height * profile.viewport.deviceScaleFactor,
      settleMs: FENBRIDGE_CAPTURE_TIMING.viewSettleMs,
      sha256: frameDigest(profile, view),
      structure: { ihdr: true, idatChunks: 1, iend: true },
    },
  };
}

function validBatchMetadata(): any {
  return {
    schemaVersion: 1,
    captureScope: 'fenbridge-town-batch',
    complete: true,
    contract: {
      layoutId: FENBRIDGE_LAYOUT_ID,
      rootName: FENBRIDGE_TOWN_ROOT_NAME,
      expectedFenbridge: true,
      acceptanceMode: true,
    },
    source: { revision: 'working-tree' },
    profiles: FENBRIDGE_CAPTURE_PROFILES.map((profile: any) => ({
      profile: {
        name: profile.name,
        tier: profile.tier,
        viewport: profile.viewport,
      },
      records: FENBRIDGE_CAPTURE_VIEWS.map((view: any) => validMetadata({ profile, view })),
    })),
  };
}

describe('Fenbridge matched capture constants', () => {
  it('pins the world, player, root, layout, streaming crossing, and timing', () => {
    expect(FENBRIDGE_CAPTURE_SEED).toBe(20_061);
    expect(FENBRIDGE_ZONE_ID).toBe('mirefen_marsh');
    expect(FENBRIDGE_LAYOUT_ID).toBe('fenbridge_rebuild_v1');
    expect(FENBRIDGE_TOWN_ROOT_NAME).toBe('fenbridgeTownRebuild');
    expect(FENBRIDGE_CAPTURE_CHARACTER).toEqual({
      name: 'FenVerifier',
      className: 'warrior',
    });
    expect([...FENBRIDGE_CAPTURE_CHARACTER.name]).toHaveLength(11);
    expect([...FENBRIDGE_CAPTURE_CHARACTER.name].length).toBeLessThanOrEqual(16);
    expect(FENBRIDGE_PLAYER_STATE).toEqual({
      x: 7,
      y: 1.2,
      z: 303,
      facing: Math.PI,
    });
    expect(FENBRIDGE_STREAMING_CONTRACT).toEqual({
      from: { x: 0, z: 176, zoneId: 'eastbrook_vale' },
      crossing: { x: 0, z: 184, zoneId: 'mirefen_marsh' },
      target: { x: 0, z: 300, zoneId: 'mirefen_marsh' },
      travelFacing: 0,
      readyStableFrames: 3,
      timeoutMs: 60_000,
    });
    expect(FENBRIDGE_CAPTURE_TIMING).toEqual({
      gameBootTimeoutMs: 240_000,
      bootSettleMs: 2_000,
      viewSettleMs: 1_400,
    });
    expect(FENBRIDGE_EXPECTED_LOCAL_PROXY_502_PATHS).toEqual([
      '/api/perf-report',
      '/api/project-stats',
      '/api/site-presence',
    ]);
    expect(FENBRIDGE_CAPTURE_HOOK_CONTRACT).toEqual({
      rootName: 'fenbridgeTownRebuild',
      rootUserData: ['layoutId', 'placementIds', 'assetPlacementCounts', 'assetUrls'],
      overlayName: 'fenbridgeCaptureOverlay',
      overlayController: 'setFenbridgeCaptureOverlay',
    });
  });

  it('pins desktop Ultra and native-density mobile Low profiles with the governor off', () => {
    expect(FENBRIDGE_CAPTURE_PROFILES).toEqual([
      {
        name: 'desktop-ultra',
        tier: 'ultra',
        query: '?gfx=ultra&governor=0',
        settings: {
          graphicsPreset: 4,
          graphicsDefaultApplied: true,
          terrainDetail: 1,
          foliageDensity: 1,
          effectsQuality: 1,
          shadowQuality: 1,
          brightness: 1,
          renderScale: 1,
          reduceMotion: true,
        },
        viewport: { width: 1600, height: 900, deviceScaleFactor: 1 },
        canvasPixelRatioCap: 1.75,
        effectiveRenderScale: 1,
        canvasAllocationScale: 1,
        mobile: false,
      },
      {
        name: 'mobile-low',
        tier: 'low',
        query: '?gfx=low&governor=0',
        settings: {
          graphicsPreset: 1,
          graphicsDefaultApplied: true,
          terrainDetail: 0,
          foliageDensity: 0,
          effectsQuality: 0,
          shadowQuality: 0,
          brightness: 1,
          renderScale: 1,
          reduceMotion: true,
        },
        viewport: {
          width: 844,
          height: 390,
          deviceScaleFactor: 3,
          isMobile: true,
          hasTouch: true,
        },
        canvasPixelRatioCap: 1.48,
        effectiveRenderScale: 0.85,
        canvasAllocationScale: 0.85,
        mobile: true,
      },
    ]);
  });

  it('observes runtime-owned mobile activation and persists the measured render state', () => {
    const source = readFileSync(
      new URL('../scripts/assets/fenbridge_town/capture_ingame.mjs', import.meta.url),
      'utf8',
    );
    expect(source).not.toContain("document.body.classList.add('mobile-touch')");
    expect(source).toContain("mobile: document.body.classList.contains('mobile-touch')");
    expect(source).toContain('await installCaptureNoticeDismissal(page);');
    expect(source).toContain("attributeFilter: ['hidden']");
    expect(source).toContain('renderState,');
    expect(source).toContain('assertFenbridgeCaptureArtifactFiles(finalBatch)');
  });

  it('pins the complete stable evidence view inventory', () => {
    expect(FENBRIDGE_CAPTURE_VIEWS.map((view: { name: string }) => view.name)).toEqual([
      'elevated-overview',
      'planning-top-down',
      'south-causeway-approach',
      'civic-square',
      'player-scale-street',
      'gate-south',
      'gate-west',
      'gate-east',
      'gate-north',
      'tannery-and-hesk',
      'chapel-graveyard-archive',
      'inn-and-provisioner',
      'bank-and-apothecary',
      'scout-lodge',
      'muster-mailbox-chest',
      'collision-route-overlay',
    ]);
    expect(new Set(FENBRIDGE_CAPTURE_VIEWS.map((view: { name: string }) => view.name)).size).toBe(
      FENBRIDGE_CAPTURE_VIEWS.length,
    );
    for (const view of FENBRIDGE_CAPTURE_VIEWS) {
      expect(view.subject).toBeTruthy();
      expect(Object.values(view.camera).every(Number.isFinite)).toBe(true);
      expect(Object.values(view.target).every(Number.isFinite)).toBe(true);
    }
    expect(overlayView?.overlay).toBe('collision-routes');
  });

  it('pins exterior route anchors and the exact rendered overlay inventory', () => {
    expect(FENBRIDGE_LOCKED_ROUTE_ANCHORS).toEqual({
      'south-causeway': { x: -8, z: 240 },
      fenbridge_gate_south: { x: -8, z: 240 },
      fenbridge_gate_west: { x: 45, z: 336 },
      fenbridge_gate_east: { x: -40, z: 370 },
      fenbridge_gate_north: { x: 10, z: 400 },
    });
    expect(FENBRIDGE_OVERLAY_CONTRACT.renderableCount).toBe(3);
    expect(FENBRIDGE_OVERLAY_CONTRACT.recordIds.colliders).toHaveLength(34);
    expect(FENBRIDGE_OVERLAY_CONTRACT.recordIds.routes).toEqual([
      'south_causeway',
      'west_marsh',
      'east_marsh',
      'north_fen',
    ]);
    expect(FENBRIDGE_OVERLAY_CONTRACT.recordIds.services).toHaveLength(16);
    expect(new Set(FENBRIDGE_OVERLAY_CONTRACT.recordIds.colliders).size).toBe(34);
    expect(new Set(FENBRIDGE_OVERLAY_CONTRACT.recordIds.services).size).toBe(16);
  });

  it('pins the rebuild and retired-generic placement inventories', () => {
    expect(FENBRIDGE_REBUILD_REQUIRED_IDS).toEqual([
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
    expect(FENBRIDGE_REPEATED_ASSET_REQUIREMENTS).toEqual({
      fenbridge_palisade_wing: { exact: 16 },
      fenbridge_gate_arch: { exact: 4 },
      fenbridge_boardwalk: { exact: 12 },
      fenbridge_muster_order: { exact: 2 },
    });
    expect(FENBRIDGE_TOWN_ASSET_URLS).toEqual([
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
    expect(FENBRIDGE_SHARED_SERVICE_ASSET_URLS).toEqual([
      '/models/props/mailbox_pillar.glb',
      '/models/props/banker_chest.glb',
      '/models/props/leatherworking_rack.glb',
    ]);
    expect(FENBRIDGE_SURFACE_TEXTURE_URLS).toEqual([
      '/textures/fenbridge_surface_atlas.webp',
      '/textures/fenbridge_surface_normal.webp',
      '/textures/fenbridge_surface_roughness.webp',
    ]);
    expect(FENBRIDGE_REQUIRED_ASSET_REQUEST_URLS).toEqual([
      ...FENBRIDGE_TOWN_ASSET_URLS,
      ...FENBRIDGE_SURFACE_TEXTURE_URLS,
      ...FENBRIDGE_SHARED_SERVICE_ASSET_URLS,
    ]);
    expect(
      fenbridgeAssetRequestMatches(
        '/models/props/fenbridge_gate_arch.glb',
        '/media/models/props/fenbridge_gate_arch.0123abcdefff.glb',
      ),
    ).toBe(true);
    expect(
      fenbridgeAssetRequestMatches(
        '/models/props/fenbridge_gate_arch.glb',
        '/media/models/props/fenbridge_boardwalk.0123abcdefff.glb',
      ),
    ).toBe(false);
    expect(FENBRIDGE_LEGACY_PLACEMENT_INVENTORY).toEqual({
      buildings: [
        'legacy_fenbridge_building_00',
        'legacy_fenbridge_building_01',
        'legacy_fenbridge_building_02',
        'legacy_fenbridge_building_03',
      ],
      wells: ['legacy_fenbridge_well'],
      stalls: ['legacy_fenbridge_stall'],
      campfires: ['legacy_fenbridge_campfire_00', 'legacy_fenbridge_campfire_01'],
      fences: ['legacy_fenbridge_fence_00', 'legacy_fenbridge_fence_01'],
    });
    expect(expectedFenbridgeInventory(true)).toEqual({
      legacyIds: [],
      rebuildIds: FENBRIDGE_REBUILD_REQUIRED_IDS,
      repeatedCounts: FENBRIDGE_REPEATED_ASSET_REQUIREMENTS,
    });
    expect(expectedFenbridgeInventory(false).legacyIds).toHaveLength(10);
    expect(() => expectedFenbridgeInventory('yes')).toThrow('expectedFenbridge must be a boolean');
    expect(FENBRIDGE_GAMEPLAY_CONTRACT.npcs).toHaveLength(8);
    expect(
      FENBRIDGE_GAMEPLAY_CONTRACT.npcs.find(
        (npc: { id: string }) => npc.id === 'bursar_petra_vell',
      ),
    ).toEqual({
      id: 'bursar_petra_vell',
      x: 15.101663970557492,
      z: 306.79285357068125,
    });
    expect(FENBRIDGE_GAMEPLAY_CONTRACT.quest).toEqual({
      id: 'q_fenbridge_muster',
      giverNpcId: 'brother_aldric',
      turnInNpcId: 'warden_fenwick',
      itemId: 'fen_muster_order',
      count: 1,
      captureState: 'unavailable',
    });
    expect(FENBRIDGE_TRAVERSAL_DESTINATION_IDS).toHaveLength(27);
    expect(FENBRIDGE_TRAVERSAL_BODY_RADII).toEqual([0.5, 0.8]);
  });

  it('classifies the release-base town snapshot without browser-only logic', () => {
    const inventory = classifyFenbridgePlacementInventory({
      props: {
        buildings: [
          { kind: 'inn', x: 13, z: 306, w: 6, d: 7, rot: -1 },
          { kind: 'house', x: -13, z: 308, w: 7, d: 6, rot: 0.5 },
          { kind: 'house', x: -12, z: 291, w: 6, d: 5, rot: 2.6 },
          { kind: 'house', x: 11, z: 316, w: 6, d: 5, rot: 0.3 },
        ],
        wells: [{ x: 0, z: 302, r: 1.5 }],
        stalls: [{ x: -5, z: 310.5, rot: Math.PI / 2, r: 1.7 }],
        campfires: [
          [4, 299],
          [-2, 293],
          [16, 470],
        ],
        fences: [
          { x1: 16, z1: 311, x2: 21, z2: 299 },
          { x1: -18, z1: 313, x2: -22, z2: 300 },
        ],
      },
      root: {},
      sceneRepeatedCounts: {},
      musterOrderCount: 2,
    });
    expect(inventory.legacyIds).toEqual([...expectedFenbridgeInventory(false).legacyIds].sort());
    expect(inventory.rebuildIds).toEqual([]);
    expect(inventory.renderedRebuildIds).toEqual([]);
    expect(inventory.repeatedCounts).toEqual({
      fenbridge_palisade_wing: null,
      fenbridge_gate_arch: null,
      fenbridge_boardwalk: null,
      fenbridge_muster_order: null,
    });
    expect(inventory.observedRepeatedCounts).toEqual({
      fenbridge_palisade_wing: null,
      fenbridge_gate_arch: null,
      fenbridge_boardwalk: null,
      fenbridge_muster_order: null,
    });
  });

  it('classifies rebuild hooks and repeated scene fallbacks', () => {
    const inventory = classifyFenbridgePlacementInventory({
      props: {
        buildings: [],
        wells: [],
        stalls: [],
        campfires: [],
        fences: [],
      },
      root: {
        placementInventory: { required: FENBRIDGE_REBUILD_REQUIRED_IDS },
        assetPlacementCounts: {
          fenbridge_gate_arch: 4,
          fenbridge_muster_order: 2,
        },
      },
      sceneRepeatedCounts: {
        fenbridge_palisade_wing: 16,
        fenbridge_gate_arch: 4,
        fenbridge_boardwalk: 12,
        fenbridge_muster_order: 2,
      },
      scenePlacementIds: FENBRIDGE_REBUILD_REQUIRED_IDS,
    });
    expect(inventory).toEqual({
      legacyIds: [],
      rebuildIds: [...FENBRIDGE_REBUILD_REQUIRED_IDS].sort(),
      renderedRebuildIds: [...FENBRIDGE_REBUILD_REQUIRED_IDS].sort(),
      repeatedCounts: {
        fenbridge_palisade_wing: 16,
        fenbridge_gate_arch: 4,
        fenbridge_boardwalk: 12,
        fenbridge_muster_order: 2,
      },
      observedRepeatedCounts: {
        fenbridge_palisade_wing: 16,
        fenbridge_gate_arch: 4,
        fenbridge_boardwalk: 12,
        fenbridge_muster_order: 2,
      },
    });
  });
});

describe('Fenbridge capture selection', () => {
  it('selects the full before and after evidence sets', () => {
    const before = selectFenbridgeCaptureConfiguration({
      GAME_URL: 'http://127.0.0.1:5184///',
      SHOT_PREFIX: 'before',
      EXPECT_FENBRIDGE: '0',
    });
    expect(before.gameUrl).toBe('http://127.0.0.1:5184');
    expect(before.expectedFenbridge).toBe(false);
    expect(before.acceptanceMode).toBe(false);
    expect(before.outputDir).toBe('docs/screenshots/fenbridge-rebuild/before');
    expect(before.sourceRevision).toBe('release-base');
    expect(before.profiles).toHaveLength(2);
    expect(before.views).toHaveLength(16);

    const after = selectFenbridgeCaptureConfiguration({
      GAME_URL: 'http://127.0.0.1:5185',
      SHOT_PREFIX: 'after',
      EXPECT_FENBRIDGE: '1',
      ACCEPTANCE_MODE: '1',
      SOURCE_REVISION: 'abc123',
      OUT_DIR: '/tmp/fenbridge',
      METADATA_OUT: '/tmp/fenbridge.json',
    });
    expect(after.expectedFenbridge).toBe(true);
    expect(after.acceptanceMode).toBe(true);
    expect(after.profiles).toHaveLength(2);
    expect(after.views).toHaveLength(16);
    expect(after.sourceRevision).toBe('abc123');
    expect(after.outputDir).toBe('/tmp/fenbridge');
  });

  it('rejects incomplete or ambiguous selections', () => {
    expect(() => selectFenbridgeCaptureConfiguration({})).toThrow(
      'GAME_URL and SHOT_PREFIX are required',
    );
    const base = {
      GAME_URL: 'http://127.0.0.1:5184',
      SHOT_PREFIX: 'after',
      EXPECT_FENBRIDGE: '1',
    };
    expect(() => selectFenbridgeCaptureConfiguration({ ...base, EXPECT_FENBRIDGE: 'yes' })).toThrow(
      'EXPECT_FENBRIDGE must be 0 or 1',
    );
    expect(() => selectFenbridgeCaptureConfiguration({ ...base, ACCEPTANCE_MODE: 'yes' })).toThrow(
      'ACCEPTANCE_MODE must be 0 or 1',
    );
    expect(() => selectFenbridgeCaptureConfiguration({ ...base, PROFILE_NAME: 'medium' })).toThrow(
      'Unknown PROFILE_NAME: medium',
    );
    expect(() => selectFenbridgeCaptureConfiguration({ ...base, VIEW_NAME: 'pretty' })).toThrow(
      'Unknown VIEW_NAME: pretty',
    );
    expect(() =>
      selectFenbridgeCaptureConfiguration({
        ...base,
        ACCEPTANCE_MODE: '1',
        PROFILE_NAME: 'desktop-ultra',
      }),
    ).toThrow('ACCEPTANCE_MODE=1 requires the complete profile and view matrix');
    expect(() =>
      selectFenbridgeCaptureConfiguration({
        ...base,
        ACCEPTANCE_MODE: '1',
        VIEW_NAME: 'civic-square',
      }),
    ).toThrow('ACCEPTANCE_MODE=1 requires the complete profile and view matrix');
    expect(
      selectFenbridgeCaptureConfiguration({
        ...base,
        PROFILE_NAME: 'mobile-low',
        VIEW_NAME: 'civic-square',
      }).views,
    ).toHaveLength(1);
    expect(captureFrameFilename('after', 'civic-square', 'desktop-ultra')).toBe(
      'after-civic-square-desktop-ultra.png',
    );
    expect(captureMetadataFilename('after', 'mobile-low')).toBe('after-mobile-low.json');
  });
});

describe('Fenbridge render-state integrity', () => {
  it.each([
    ['desktop', desktop],
    ['mobile', mobile],
  ])('accepts the pinned %s render state', (_label, profile) => {
    expect(() =>
      assertFenbridgeCaptureRenderState({
        renderState: validRenderState(profile, overview),
        profile,
        view: overview,
      }),
    ).not.toThrow();
  });

  it('accepts the production prestream path when Mirefen won the background race', () => {
    const state = validRenderState();
    state.streaming.targetReadyAtFrom = true;
    state.streaming.targetReadyAtCrossing = true;
    state.streaming.readinessPath = 'prestreamed';
    expect(() =>
      assertFenbridgeCaptureRenderState({
        renderState: state,
        profile: desktop,
        view: overview,
      }),
    ).not.toThrow();
  });

  it.each([
    ['seed', (state: any) => (state.seed = 7), 'expected world seed'],
    ['tier', (state: any) => (state.tier = 'medium'), 'expected ultra tier'],
    ['governor', (state: any) => (state.autoGovernor = true), 'governor must be disabled'],
    ['setting', (state: any) => (state.settings.shadowQuality = 0), 'setting shadowQuality'],
    ['camera', (state: any) => (state.camera.x += 1), 'camera.x'],
    ['editor camera', (state: any) => (state.editorCamera = null), 'editor camera is not active'],
    ['player', (state: any) => (state.player.z += 1), 'player.z'],
    [
      'collision',
      (state: any) => (state.playerCollisionClear = false),
      'player position is blocked',
    ],
    ['zone', (state: any) => (state.zoneId = 'eastbrook_vale'), 'expected player in'],
    [
      'streaming deadline',
      (state: any) => (state.streaming.readinessDeadlineStartedBeforeCrossing = false),
      'required post-crossing ready state',
    ],
    [
      'streaming readiness',
      (state: any) => (state.streaming.targetReady = false),
      'required post-crossing ready state',
    ],
    [
      'manual streaming bypass',
      (state: any) => (state.streaming.directPrepareZoneAtCalled = true),
      'required post-crossing ready state',
    ],
    [
      'readiness path',
      (state: any) => (state.streaming.readinessPath = 'prestreamed'),
      'readiness path is internally inconsistent',
    ],
    ['viewport', (state: any) => (state.viewport.physicalWidth = 1), 'viewport does not match'],
    ['touch', (state: any) => (state.touch = true), 'mobile/touch emulation'],
    [
      'effective render scale',
      (state: any) => (state.effectiveRenderScale = 0.5),
      'live WebGL canvas',
    ],
    ['canvas backing store', (state: any) => (state.canvas.backingWidth = 1), 'live WebGL canvas'],
    ['canvas frame', (state: any) => (state.canvas.frameCount = 0), 'live WebGL canvas'],
    [
      'GPU notice',
      (state: any) => (state.notices.gpu = true),
      'GPU and performance notices must be dismissed',
    ],
    [
      'desktop touch HUD',
      (state: any) => (state.touchHud.visible = true),
      'touch HUD must be hidden',
    ],
  ])('rejects %s drift', (_label, mutate, message) => {
    const state = validRenderState();
    mutate(state);
    expect(() =>
      assertFenbridgeCaptureRenderState({
        renderState: state,
        profile: desktop,
        view: overview,
      }),
    ).toThrow(message);
  });

  it('rejects a mobile profile whose touch HUD is only a body class', () => {
    const state = validRenderState(mobile);
    state.touchHud.visible = false;
    state.touchHud.visibleInteractiveCount = 0;
    expect(() =>
      assertFenbridgeCaptureRenderState({
        renderState: state,
        profile: mobile,
        view: overview,
      }),
    ).toThrow('mobile touch HUD is not visibly rendered');
  });
});

describe('Fenbridge metadata acceptance', () => {
  it('accepts complete rebuild and release-base inventories', () => {
    const after = validMetadata();
    expect(fenbridgeAcceptanceReadiness(after)).toEqual({
      ready: true,
      blockers: [],
    });
    expect(() =>
      assertFenbridgeCaptureMetadata({
        metadata: after,
        profile: desktop,
        view: overview,
        expectedFenbridge: true,
        acceptanceMode: true,
      }),
    ).not.toThrow();

    const before = validMetadata({ expectedFenbridge: false });
    expect(fenbridgeAcceptanceReadiness(before)).toEqual({
      ready: true,
      blockers: [],
    });
    expect(() =>
      assertFenbridgeCaptureMetadata({
        metadata: before,
        profile: desktop,
        view: overview,
        expectedFenbridge: false,
        acceptanceMode: true,
      }),
    ).not.toThrow();
  });

  it.each([
    [
      'profile tier',
      (metadata: any) => (metadata.profile.tier = 'low'),
      'metadata profile does not match the canonical capture contract',
    ],
    [
      'profile viewport',
      (metadata: any) => (metadata.profile.viewport = { ...metadata.profile.viewport, width: 1 }),
      'metadata profile does not match the canonical capture contract',
    ],
    [
      'view overlay',
      (metadata: any) => (metadata.view.overlay = 'collision-routes'),
      'metadata view does not match the canonical capture contract',
    ],
    [
      'view camera',
      (metadata: any) => (metadata.view.camera = { ...metadata.view.camera, x: 999 }),
      'metadata view does not match the canonical capture contract',
    ],
    [
      'player',
      (metadata: any) => (metadata.player = { ...metadata.player, x: 999 }),
      'metadata player does not match the canonical capture contract',
    ],
    [
      'persisted canvas',
      (metadata: any) => (metadata.renderState.canvas.backingWidth = 1),
      'persisted render evidence is invalid',
    ],
    [
      'persisted touch HUD',
      (metadata: any) => (metadata.renderState.touchHud.visible = true),
      'persisted render evidence is invalid',
    ],
    [
      'persisted streaming',
      (metadata: any) => (metadata.streaming.targetReady = false),
      'persisted streaming evidence is inconsistent',
    ],
  ])('rejects canonical %s drift in persisted metadata', (_label, mutate, message) => {
    const metadata = validMetadata();
    mutate(metadata);
    expect(() =>
      assertFenbridgeCaptureMetadata({
        metadata,
        profile: desktop,
        view: overview,
        expectedFenbridge: true,
        acceptanceMode: true,
      }),
    ).toThrow(message);
  });

  it('allows absent future renderer hooks only in exploratory mode', () => {
    const metadata = validMetadata({ acceptanceMode: false });
    metadata.observed = {
      root: { present: false, layoutId: null },
      inventory: { legacyIds: [], rebuildIds: [], repeatedCounts: {} },
      assets: { failures: [] },
      overlay: { supported: false, visible: false },
    };
    expect(() =>
      assertFenbridgeCaptureMetadata({
        metadata,
        profile: desktop,
        view: overview,
        expectedFenbridge: true,
        acceptanceMode: false,
      }),
    ).not.toThrow();

    metadata.contract.acceptanceMode = true;
    expect(() =>
      assertFenbridgeCaptureMetadata({
        metadata,
        profile: desktop,
        view: overview,
        expectedFenbridge: true,
        acceptanceMode: true,
      }),
    ).toThrow(`scene root ${FENBRIDGE_TOWN_ROOT_NAME} is missing`);
  });

  it.each([
    [
      'layout id',
      (metadata: any) => (metadata.observed.root.layoutId = 'fenbridge_draft'),
      `layout id must be ${FENBRIDGE_LAYOUT_ID}`,
    ],
    [
      'required placement',
      (metadata: any) => metadata.observed.inventory.rebuildIds.pop(),
      'missing rebuild placement ids',
    ],
    [
      'rendered required placement',
      (metadata: any) => metadata.observed.inventory.renderedRebuildIds.pop(),
      'missing rendered rebuild placement ids',
    ],
    [
      'root metadata hook',
      (metadata: any) => (metadata.observed.root.hookFields.assetPlacementCounts = false),
      'root metadata hook is missing: assetPlacementCounts',
    ],
    [
      'retired geometry',
      (metadata: any) => metadata.observed.inventory.legacyIds.push('legacy_fenbridge_well'),
      'retired generic Fenbridge placements are still present',
    ],
    [
      'gate count',
      (metadata: any) => (metadata.observed.inventory.repeatedCounts.fenbridge_gate_arch = 3),
      'fenbridge_gate_arch count must be 4',
    ],
    [
      'rendered gate count',
      (metadata: any) =>
        (metadata.observed.inventory.observedRepeatedCounts.fenbridge_gate_arch = 1),
      'rendered fenbridge_gate_arch count must be 4',
    ],
    [
      'missing repeated metadata',
      (metadata: any) => delete metadata.observed.inventory.repeatedCounts.fenbridge_boardwalk,
      'repeated asset count is missing for fenbridge_boardwalk',
    ],
    [
      'asset failure',
      (metadata: any) => metadata.observed.assets.failures.push('/models/fenbridge_bank.glb: 404'),
      'Fenbridge asset failures',
    ],
    [
      'declared asset inventory',
      (metadata: any) => metadata.observed.assets.declaredUrls.pop(),
      'Fenbridge root asset URL inventory mismatch',
    ],
    [
      'shared service asset request',
      (metadata: any) => metadata.observed.assets.requests.pop(),
      'Fenbridge requested asset coverage mismatch',
    ],
    [
      'live NPC',
      (metadata: any) => metadata.observed.gameplay.npcs.pop(),
      'live Fenbridge NPC is invalid',
    ],
    [
      'mailbox service',
      (metadata: any) => (metadata.observed.gameplay.mailbox.entity = null),
      'live Fenbridge mailbox service is invalid',
    ],
    [
      'duplicate mailbox service',
      (metadata: any) => (metadata.observed.gameplay.mailbox.registrationCount = 2),
      'live Fenbridge mailbox service is invalid',
    ],
    [
      'muster quest',
      (metadata: any) => (metadata.observed.gameplay.quest.state = 'available'),
      'live Fenbridge muster quest state is invalid',
    ],
    [
      'blocked service route',
      (metadata: any) => (metadata.observed.gameplay.traversability.routes[0].clear = false),
      'Fenbridge route is not traversable',
    ],
    [
      'short exterior route',
      (metadata: any) => {
        const route = metadata.observed.gameplay.traversability.routes.find(
          (candidate: any) =>
            candidate.destinationId === 'fenbridge_gate_west' &&
            candidate.bodyRadius === 0.8 &&
            candidate.direction === 'out',
        );
        route.end = { x: 34.5, z: 317 };
      },
      'Fenbridge route misses locked exterior anchor',
    ],
    [
      'banker chest visual',
      (metadata: any) => (metadata.observed.serviceVisuals.bankerChest.rendered = false),
      'Fenbridge banker chest visual is missing',
    ],
    [
      'muster order visual',
      (metadata: any) => (metadata.observed.serviceVisuals.renderedMusterOrderCount = 1),
      'rendered Fenbridge muster order count must be 2',
    ],
    [
      'duplicate tannery visual',
      (metadata: any) => (metadata.observed.serviceVisuals.tannery.instanceCount = 2),
      'Fenbridge tannery visual count must be 1',
    ],
  ])('reports a clear acceptance blocker for %s', (_label, mutate, message) => {
    const metadata = validMetadata();
    mutate(metadata);
    expect(fenbridgeAcceptanceReadiness(metadata).ready).toBe(false);
    expect(() =>
      assertFenbridgeCaptureMetadata({
        metadata,
        profile: desktop,
        view: overview,
        expectedFenbridge: true,
        acceptanceMode: true,
      }),
    ).toThrow(message);
  });

  it('requires a visible collision/route overlay only for its acceptance view', () => {
    const metadata = validMetadata({ view: overlayView });
    expect(() =>
      assertFenbridgeCaptureMetadata({
        metadata,
        profile: desktop,
        view: overlayView,
        expectedFenbridge: true,
        acceptanceMode: true,
      }),
    ).not.toThrow();
    metadata.observed.overlay.supported = false;
    metadata.observed.overlay.visible = false;
    expect(() =>
      assertFenbridgeCaptureMetadata({
        metadata,
        profile: desktop,
        view: overlayView,
        expectedFenbridge: true,
        acceptanceMode: true,
      }),
    ).toThrow('collision/route overlay hook is unavailable');

    const emptyOverlay = validMetadata({ view: overlayView });
    emptyOverlay.observed.overlay.recordIds.routes = [];
    emptyOverlay.observed.overlay.recordCounts.routes = 0;
    expect(() =>
      assertFenbridgeCaptureMetadata({
        metadata: emptyOverlay,
        profile: desktop,
        view: overlayView,
        expectedFenbridge: true,
        acceptanceMode: true,
      }),
    ).toThrow('collision/route overlay routes mismatch');

    const inventedOverlay = validMetadata({ view: overlayView });
    inventedOverlay.observed.overlay.recordIds.routes[0] = 'invented-route';
    expect(() =>
      assertFenbridgeCaptureMetadata({
        metadata: inventedOverlay,
        profile: desktop,
        view: overlayView,
        expectedFenbridge: true,
        acceptanceMode: true,
      }),
    ).toThrow('collision/route overlay routes mismatch');

    const metadataOnlyOverlay = validMetadata({ view: overlayView });
    metadataOnlyOverlay.observed.overlay.renderableCount = 0;
    expect(() =>
      assertFenbridgeCaptureMetadata({
        metadata: metadataOnlyOverlay,
        profile: desktop,
        view: overlayView,
        expectedFenbridge: true,
        acceptanceMode: true,
      }),
    ).toThrow('collision/route overlay renderable count must be 3');
  });

  it('requires measured PNG evidence for a complete acceptance record', () => {
    const metadata = validMetadata();
    metadata.frame = null;
    expect(fenbridgeAcceptanceReadiness(metadata).ready).toBe(false);
    expect(fenbridgeAcceptanceReadiness(metadata, { requireFrame: false })).toEqual({
      ready: true,
      blockers: [],
    });
    expect(() =>
      assertFenbridgeCaptureMetadata({
        metadata,
        profile: desktop,
        view: overview,
        expectedFenbridge: true,
        acceptanceMode: true,
      }),
    ).toThrow('capture PNG evidence is missing');

    metadata.frame = {
      output: '/tmp/bad.png',
      bytes: 12,
      width: 844,
      height: 390,
      settleMs: FENBRIDGE_CAPTURE_TIMING.viewSettleMs,
    };
    expect(() =>
      assertFenbridgeCaptureMetadata({
        metadata,
        profile: desktop,
        view: overview,
        expectedFenbridge: true,
        acceptanceMode: true,
      }),
    ).toThrow('capture PNG dimensions must be 1600x900');

    const missingDigest = validMetadata();
    delete missingDigest.frame.sha256;
    expect(fenbridgeAcceptanceReadiness(missingDigest).blockers).toContain(
      'capture PNG SHA-256 evidence is missing',
    );
    const missingStructure = validMetadata();
    missingStructure.frame.structure.idatChunks = 0;
    expect(fenbridgeAcceptanceReadiness(missingStructure).blockers).toContain(
      'capture PNG structure evidence is incomplete',
    );
  });

  it('hashes complete PNG artifacts and detects later replacement', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'fenbridge-capture-'));
    const output = path.join(directory, 'frame.png');
    try {
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      );
      writeFileSync(output, png);
      const frame = fenbridgePngFrameEvidence(output);
      expect(frame).toMatchObject({
        width: 1,
        height: 1,
        sha256: createHash('sha256').update(png).digest('hex'),
        structure: { ihdr: true, idatChunks: 1, iend: true },
      });
      const batch = { profiles: [{ records: [{ frame }] }] };
      expect(() => assertFenbridgeCaptureArtifactFiles(batch)).not.toThrow();

      const corruptCrc = Buffer.from(readFileSync(output));
      corruptCrc[45] ^= 1;
      writeFileSync(output, corruptCrc);
      expect(() => fenbridgePngFrameEvidence(output)).toThrow('corrupt IDAT chunk CRC');

      const corruptZlib = Buffer.from(png);
      const idatTypeOffset = corruptZlib.indexOf(Buffer.from('IDAT'));
      const idatLength = corruptZlib.readUInt32BE(idatTypeOffset - 4);
      const idatDataEnd = idatTypeOffset + 4 + idatLength;
      corruptZlib[idatTypeOffset + 4] ^= 1;
      corruptZlib.writeUInt32BE(
        pngCrc32ForTest(corruptZlib.subarray(idatTypeOffset, idatDataEnd)),
        idatDataEnd,
      );
      writeFileSync(output, corruptZlib);
      expect(() => fenbridgePngFrameEvidence(output)).toThrow('undecodable IDAT stream');

      const replacementPng = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=',
        'base64',
      );
      writeFileSync(output, replacementPng);
      expect(() => assertFenbridgeCaptureArtifactFiles(batch)).toThrow(
        'Fenbridge frame artifact drifted',
      );

      writeFileSync(output, png.subarray(0, 24));
      expect(() => fenbridgePngFrameEvidence(output)).toThrow('not a complete PNG');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects capture diagnostics even outside acceptance mode', () => {
    const metadata = validMetadata({ acceptanceMode: false });
    metadata.diagnostics.pageErrors.push('WebGL context lost');
    expect(() =>
      assertFenbridgeCaptureMetadata({
        metadata,
        profile: desktop,
        view: overview,
        expectedFenbridge: true,
        acceptanceMode: false,
      }),
    ).toThrow('Fenbridge diagnostics.pageErrors: WebGL context lost');
  });

  it('allows shared service requests in a release-base capture but rejects rebuild assets', () => {
    const metadata = validMetadata({ expectedFenbridge: false });
    expect(fenbridgeAcceptanceReadiness(metadata).ready).toBe(true);
    metadata.observed.assets.requests.push(FENBRIDGE_TOWN_ASSET_URLS[0]);
    expect(fenbridgeAcceptanceReadiness(metadata).blockers).toContainEqual(
      expect.stringContaining('release-base capture unexpectedly requested Fenbridge assets'),
    );
    const textureMetadata = validMetadata({ expectedFenbridge: false });
    textureMetadata.observed.assets.requests.push(FENBRIDGE_SURFACE_TEXTURE_URLS[0]);
    expect(fenbridgeAcceptanceReadiness(textureMetadata).blockers).toContainEqual(
      expect.stringContaining('release-base capture unexpectedly requested Fenbridge assets'),
    );
  });
});

describe('Fenbridge acceptance batch', () => {
  it('accepts exactly two profiles by sixteen views with measured frames', () => {
    const metadata = validBatchMetadata();
    expect(() =>
      assertFenbridgeCaptureBatchMetadata({
        metadata,
        expectedFenbridge: true,
        acceptanceMode: true,
      }),
    ).not.toThrow();
    expect(
      metadata.profiles.reduce((count: number, profile: any) => count + profile.records.length, 0),
    ).toBe(32);
  });

  it.each([
    ['unfinished batch', (metadata: any) => (metadata.complete = false), 'complete profile matrix'],
    ['missing profile', (metadata: any) => metadata.profiles.pop(), 'complete profile matrix'],
    [
      'duplicate profile',
      (metadata: any) => metadata.profiles.push(metadata.profiles[0]),
      'duplicate profiles',
    ],
    ['missing view', (metadata: any) => metadata.profiles[0].records.pop(), 'requires every view'],
    [
      'duplicate view',
      (metadata: any) => metadata.profiles[0].records.push(metadata.profiles[0].records[0]),
      'duplicate views',
    ],
    [
      'missing written frame',
      (metadata: any) => (metadata.profiles[0].records[0].frame = null),
      'frame output does not match',
    ],
    [
      'reused written frame',
      (metadata: any) => {
        const first = metadata.profiles[0].records[0];
        const second = metadata.profiles[0].records[1];
        second.frame.output = first.frame.output;
      },
      'frame output does not match',
    ],
    [
      'byte-identical frames',
      (metadata: any) => {
        metadata.profiles[0].records[1].frame.sha256 = metadata.profiles[0].records[0].frame.sha256;
      },
      'byte-identical frame artifacts',
    ],
    [
      'source drift',
      (metadata: any) => (metadata.profiles[0].records[0].source.revision = 'other-tree'),
      'source revision drifted',
    ],
  ])('rejects an acceptance batch with %s', (_label, mutate, message) => {
    const metadata = validBatchMetadata();
    mutate(metadata);
    expect(() =>
      assertFenbridgeCaptureBatchMetadata({
        metadata,
        expectedFenbridge: true,
        acceptanceMode: true,
      }),
    ).toThrow(message);
  });
});
