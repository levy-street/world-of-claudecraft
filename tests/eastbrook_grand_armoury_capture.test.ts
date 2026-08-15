import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const captureContract =
  // @ts-expect-error The executable capture contract intentionally ships as plain Node ESM.
  await import('../scripts/assets/eastbrook_grand_armoury/capture_contract.mjs');
const {
  assertArmouryPerformanceContract,
  assertCaptureCleanupState,
  assertCaptureRenderState,
  assertMatchedLotIdentity,
  assertNoCaptureErrors,
  assertPerformanceBlockState,
  assertPerformanceStateRestored,
  assertTownCaptureMetadata,
  assertTownArmouryIdentity,
  assertTownBaselinePerformanceBlockState,
  assertTownPerformanceBlockState,
  deriveArmouryPerformanceDeltas,
  deriveTownPerformanceDeltas,
  EASTBROOK_ARMOURY_CAPTURE_PROFILES,
  EASTBROOK_ARMOURY_CAPTURE_SEED,
  EASTBROOK_ARMOURY_CAPTURE_VIEWS,
  EASTBROOK_ARMOURY_PERF_CONTRACT,
  EASTBROOK_ARMOURY_PLAYER_STATE,
  EASTBROOK_TOWN_CAPTURE_PROFILES,
  EASTBROOK_TOWN_CAPTURE_CONTRACTS,
  EASTBROOK_TOWN_CAPTURE_SETTLE_MS,
  EASTBROOK_TOWN_CAPTURE_TIMING,
  EASTBROOK_TOWN_CAPTURE_VIEWS,
  EASTBROOK_TOWN_LEGACY_PLACEMENT_INVENTORY,
  EASTBROOK_TOWN_NEW_ASSET_URLS,
  EASTBROOK_TOWN_PERF_SCENARIOS,
  EASTBROOK_TOWN_MOTION_CAPTURE,
  EASTBROOK_TOWN_REBUILD_PLACEMENT_INVENTORY,
  EASTBROOK_TOWN_ROOT_NAME,
  EASTBROOK_TOWN_SURFACE_ATLAS_URL,
  EASTBROOK_POLISH_BASELINE_REVISION,
  expectedTownPlacementInventory,
  expectedCaptureEnvironmentError,
  expectedCaptureProxyConsoleError,
  expectedCaptureProxyConsoleSource,
  expectedCaptureProxyResponse,
  median,
  round,
  selectCaptureConfiguration,
  summarizePerformanceEvidence,
} = captureContract;

const profile = EASTBROOK_ARMOURY_CAPTURE_PROFILES[0];
const view = EASTBROOK_ARMOURY_CAPTURE_VIEWS[1];
const playerState = EASTBROOK_ARMOURY_PLAYER_STATE;

type Vector3 = { x: number; y: number; z: number };
type CaptureRenderState = {
  seed: number;
  tier: string;
  autoGovernor: boolean;
  settings: Record<string, boolean | number>;
  assetPresent: boolean;
  asset: { visible: boolean } | null;
  player: { x: number; y: number; z: number; facing: number };
  camera: Vector3;
  target: Vector3;
  editorCamera: { camera: Vector3; target: Vector3 } | null;
};
type PerfCounts = {
  calls: number;
  triangles: number;
  lines: number;
  points: number;
};
type PerfDeltas = {
  armouryWithoutShadows: PerfCounts;
  armouryWithShadows: PerfCounts;
  shadowPassAttribution: PerfCounts;
};
type PerformanceEvidence = {
  schemaVersion: number;
  shotPrefix: string;
  expectedArmoury: boolean;
  profile: string;
  view: string;
  world: {
    seed: number;
    lot: Record<string, unknown>;
    player: { x: number; y: number; z: number; facing: number };
    camera: Vector3;
    target: Vector3;
  };
  settings: Record<string, boolean | number>;
  gl: { vendor: string; renderer: string };
  captureDiagnostics: { pageErrors: string[]; consoleErrors: string[] };
  deltas: PerfDeltas | null;
  sampledDeltas: PerfDeltas | null;
  directRenderAttribution: { deltas: PerfDeltas } | null;
};

const evidenceDir = new URL('../docs/screenshots/eastbrook-grand-armoury/', import.meta.url);

function readPerformanceEvidence(name: 'before' | 'after') {
  return JSON.parse(
    readFileSync(new URL(`${name}-performance.json`, evidenceDir), 'utf8'),
  ) as PerformanceEvidence;
}

function validRenderState(): CaptureRenderState {
  return {
    seed: 20_061,
    tier: 'ultra',
    autoGovernor: false,
    settings: { ...profile.settings },
    assetPresent: true,
    asset: { visible: true },
    player: { ...playerState },
    camera: { ...view.camera },
    target: { ...view.target },
    editorCamera: { camera: { ...view.camera }, target: { ...view.target } },
  };
}

function assertValidRenderState(renderState = validRenderState()) {
  assertCaptureRenderState({
    renderState,
    expectedSeed: 20_061,
    profile,
    view,
    expectedArmoury: true,
    playerState,
  });
}

function perfRaw({ meshVisible = true, shadowEnabled = true, assetPresent = true } = {}) {
  const meshVisibility = assetPresent ? [true, true, true, true, true, true] : [];
  return {
    armouryChildMeshes: meshVisibility.length,
    observed: {
      wrapperVisible: assetPresent ? true : null,
      visibleMeshes: meshVisible ? meshVisibility.length : 0,
      shadowMapEnabled: shadowEnabled,
      sunCastShadow: shadowEnabled,
    },
    restorationContract: {
      wrapperVisible: assetPresent ? true : null,
      meshVisible: meshVisibility,
      shadowMapEnabled: true,
      sunCastShadow: true,
      infoAutoReset: true,
    },
  };
}

function townPerfRaw({ rootVisible = true, shadowEnabled = true } = {}) {
  return {
    targetName: EASTBROOK_TOWN_ROOT_NAME,
    targetChildMeshes: 18,
    requested: { rootVisible, shadowEnabled },
    observed: {
      rootName: EASTBROOK_TOWN_ROOT_NAME,
      rootPresent: true,
      rootVisible,
      shadowMapEnabled: shadowEnabled,
      sunCastShadow: shadowEnabled,
    },
    drawStats: {
      colorDraws: 18,
      shadowDraws: 9,
      triangles: 29_436,
      buildingCount: 6,
      roofHideTargetCount: 6,
      microBatchCount: 2,
      wallBatchCount: 4,
      wallSegmentCount: 26,
      gateCount: 6,
    },
    restorationContract: {
      rootVisible: true,
      shadowMapEnabled: true,
      sunCastShadow: true,
      infoAutoReset: true,
    },
  };
}

function validTownMetadata({
  expectedTown = true,
  captureProfile = EASTBROOK_TOWN_CAPTURE_PROFILES[0],
  captureView = EASTBROOK_TOWN_CAPTURE_VIEWS[0],
  contractId = null as 'rebuild-v1' | 'polish-baseline' | 'polish-v2' | null,
} = {}) {
  const townContract = contractId ? EASTBROOK_TOWN_CAPTURE_CONTRACTS[contractId] : null;
  const polishProvenance =
    contractId === 'polish-baseline'
      ? {
          schemaVersion: 1,
          mode: 'baseline-revision',
          baselineRevision: EASTBROOK_POLISH_BASELINE_REVISION,
        }
      : contractId === 'polish-v2'
        ? {
            schemaVersion: 1,
            mode: 'composite-sha256',
            algorithm: 'sha256',
            baselineRevision: EASTBROOK_POLISH_BASELINE_REVISION,
            fingerprint: 'b'.repeat(64),
            components: {
              captureContract: { id: 'polish-v2', sha256: 'c'.repeat(64) },
            },
          }
        : null;
  const touch = captureProfile.mobile;
  const viewport = {
    cssWidth: captureProfile.viewport.width,
    cssHeight: captureProfile.viewport.height,
    devicePixelRatio: captureProfile.viewport.deviceScaleFactor,
    maxTouchPoints: touch ? 1 : 0,
    touch,
    viewportMeta: 'width=device-width, initial-scale=1, viewport-fit=cover',
    safeAreaProbe: { top: 0, right: 0, bottom: 0, left: 0 },
  };
  const inventory = expectedTownPlacementInventory(expectedTown, contractId);
  const atlasConsumer = (name: string, present: boolean, materialBindings: number) => ({
    present,
    materialBindings: expectedTown ? materialBindings : 0,
    roots: present
      ? [
          {
            name,
            metadata: expectedTown
              ? {
                  url: EASTBROOK_TOWN_SURFACE_ATLAS_URL,
                  textureUuid: 'shared-atlas-texture',
                  materialBindings,
                }
              : null,
            observed: {
              materialBindings: expectedTown ? materialBindings : 0,
              textureUuids: expectedTown ? ['shared-atlas-texture'] : [],
            },
          },
        ]
      : [],
  });
  const overlayRequested = captureView.name === 'interaction-collider-overlay';
  const overlayRecordCounts = overlayRequested
    ? expectedTown && townContract
      ? { ...townContract.overlayRecordCounts }
      : {
          obbs: expectedTown ? 43 : 6,
          circles: expectedTown ? 1 : 5,
          points: expectedTown ? 30 : 0,
          gates: expectedTown ? 6 : 0,
        }
    : { obbs: 0, circles: 0, points: 0, gates: 0 };
  const overlayRecords = {
    obbs: Array.from({ length: overlayRecordCounts.obbs }, (_, index) => ({
      id: `obb-${index}`,
      center: { x: index, z: index },
      halfWidth: 1,
      halfDepth: 1,
      rotation: 0,
      category: 'building',
    })),
    circles: Array.from({ length: overlayRecordCounts.circles }, (_, index) => ({
      id: `circle-${index}`,
      x: index,
      z: index,
      radius: 1,
      category: 'well',
    })),
    points: Array.from({ length: overlayRecordCounts.points }, (_, index) => ({
      id: `point-${index}`,
      x: index,
      z: index,
      category: 'service',
    })),
    gates: Array.from({ length: overlayRecordCounts.gates }, (_, index) => ({
      id: `gate-${index}`,
      center: { x: index, z: index },
      start: { x: index - 1, z: index },
      end: { x: index + 1, z: index },
      width: 2,
    })),
  };
  return {
    schemaVersion: 2,
    captureScope: 'town',
    captureMode: 'screenshots',
    source: {
      comparison:
        townContract?.sourceComparison ?? (expectedTown ? 'feature-worktree' : 'pr-2356-head'),
      revision:
        contractId === 'polish-baseline' ? EASTBROOK_POLISH_BASELINE_REVISION : 'test-revision',
      fingerprint: expectedTown ? 'a'.repeat(64) : null,
    },
    polishProvenance,
    townContract: townContract
      ? {
          id: townContract.id,
          layoutId: townContract.layoutId,
          sourceComparison: townContract.sourceComparison,
          placementInventory: townContract.placementInventory,
          townTriangles: townContract.townTriangles,
          assetUrls: [...townContract.assetUrls],
          attributionTargets: townContract.attributionTargets.map(
            (target: Record<string, unknown>) => ({ ...target }),
          ),
          overlayRecordCounts: townContract.overlayRecordCounts,
          motionCapture: townContract.motionCapture,
          ...(townContract.polishProvenance
            ? { polishProvenance: townContract.polishProvenance }
            : {}),
        }
      : null,
    expected: {
      armoury: true,
      bankerChestCount: 1,
      townRoot: expectedTown,
      inventory,
      newAssetUrls: [...EASTBROOK_TOWN_NEW_ASSET_URLS],
      surfaceAtlasUrl: EASTBROOK_TOWN_SURFACE_ATLAS_URL,
      timing: { ...EASTBROOK_TOWN_CAPTURE_TIMING },
    },
    observed: {
      armouryPresent: true,
      armouryRecord: expectedTown
        ? {
            id: 'eastbrook_grand_armoury',
            assetId: '/models/props/eastbrook_grand_armoury.glb',
            kind: 'house',
            landmark: 'eastbrook_grand_armoury',
            x: 17.5,
            z: -5.5,
            w: 13,
            d: 9,
            rot: -Math.PI / 2,
            height: 15,
          }
        : {
            kind: 'inn',
            landmark: 'eastbrook_grand_armoury',
            x: 17.5,
            z: -5.5,
            w: 13,
            d: 9,
            rot: -Math.PI / 2,
          },
      bankerChestPresent: true,
      bankerChestCount: 1,
      townRoot: {
        name: EASTBROOK_TOWN_ROOT_NAME,
        present: expectedTown,
        visible: expectedTown,
        childMeshCount: expectedTown ? 18 : 0,
        newAssetUrls: expectedTown ? [...EASTBROOK_TOWN_NEW_ASSET_URLS] : [],
        assetUrls: expectedTown ? [...EASTBROOK_TOWN_NEW_ASSET_URLS] : [],
        buildingIds: expectedTown ? [...inventory.rebuild.buildings] : [],
        drawStats: expectedTown
          ? {
              colorDraws: 18,
              shadowDraws: 9,
              triangles: townContract?.townTriangles ?? 29_436,
              buildingCount: 6,
              roofHideTargetCount: 6,
              microBatchCount: 2,
              wallBatchCount: 4,
              wallSegmentCount: 26,
              gateCount: 6,
            }
          : null,
        wallSegmentCount: expectedTown ? 26 : 0,
        gateCount: expectedTown ? 6 : 0,
      },
      inventory: structuredClone(inventory),
      assetStates: EASTBROOK_TOWN_NEW_ASSET_URLS.map((url: string) => ({
        url,
        state: expectedTown ? 'loaded' : 'not-requested',
      })),
      surfaceAtlas: {
        url: EASTBROOK_TOWN_SURFACE_ATLAS_URL,
        state: expectedTown ? 'loaded' : 'not-requested',
        textureUuids: expectedTown ? ['shared-atlas-texture'] : [],
        sharedTextureIdentity: expectedTown,
        consumers: {
          townRoot: atlasConsumer(EASTBROOK_TOWN_ROOT_NAME, expectedTown, 14),
          armoury: atlasConsumer('eastbrookGrandArmoury', true, 6),
          bankerChest: atlasConsumer('bankerChestDecoration', true, 2),
        },
      },
      contractTargets:
        townContract?.attributionTargets.map(
          (target: {
            key: string;
            kind: string;
            rootName?: string;
            runtimeBodyName?: string | null;
            layoutServiceId?: string;
            templateId?: string;
          }) => ({
            key: target.key,
            kind: target.kind,
            rootName:
              target.kind === 'scene-root'
                ? target.rootName
                : (target.runtimeBodyName ?? `layout-entity:${target.key}`),
            layoutId: townContract.layoutId,
            ...(target.layoutServiceId ? { layoutServiceId: target.layoutServiceId } : {}),
            templateId: target.templateId ?? null,
            surfaceAtlas: {
              url: EASTBROOK_TOWN_SURFACE_ATLAS_URL,
              textureUuid: 'shared-atlas-texture',
              materialBindings: target.key === 'town-root' ? 14 : 2,
            },
            present: true,
            visible: true,
            childMeshCount: target.key === 'town-root' ? 18 : 2,
          }),
        ) ?? [],
      contractAssetStates:
        townContract?.assetUrls.map((url: string) => ({ url, state: 'loaded' })) ?? [],
    },
    renderer: {
      vendor: 'Test GPU Vendor',
      renderer: 'Test GPU Renderer',
      tier: captureProfile.tier,
      settings: { ...captureProfile.settings },
      governorEnabled: false,
      contextLost: 0,
      contextRestored: 0,
      resources: {
        calls: 100,
        triangles: 50_000,
        geometries: 80,
        textures: 12,
        programs: 9,
        contextLost: 0,
        contextRestored: 0,
      },
    },
    viewport: {
      expected: { ...captureProfile.viewport },
      initial: viewport,
      observed: { ...viewport },
      physical: {
        width: captureProfile.viewport.width * captureProfile.viewport.deviceScaleFactor,
        height: captureProfile.viewport.height * captureProfile.viewport.deviceScaleFactor,
      },
      touchHudVisible: touch,
    },
    world: {
      seed: EASTBROOK_ARMOURY_CAPTURE_SEED,
      player: { ...EASTBROOK_ARMOURY_PLAYER_STATE },
      camera: { ...captureView.camera },
      target: { ...captureView.target },
    },
    settle: {
      requestedMs: EASTBROOK_TOWN_CAPTURE_SETTLE_MS,
      observedMs: EASTBROOK_TOWN_CAPTURE_SETTLE_MS,
      completed: true,
      boot: {
        navigationAndBootMs: 3_000,
        bootSettleMs: EASTBROOK_TOWN_CAPTURE_TIMING.bootSettleMs,
        preloadWaitMs: 250,
        preload: { waitMs: 250 },
        rendererPrewarm: { completed: true },
      },
    },
    overlay: {
      requested: overlayRequested,
      installedDuringCapture: overlayRequested,
      removedAfterCapture: true,
      source: overlayRequested
        ? expectedTown
          ? 'eastbrook-layout'
          : 'zone1-legacy-collision-records'
        : null,
      unsupportedReason: null,
      recordCounts: overlayRecordCounts,
      records: overlayRecords,
    },
    motionEvidence:
      contractId === 'polish-v2' && captureView.name === EASTBROOK_TOWN_MOTION_CAPTURE.viewName
        ? {
            viewName: EASTBROOK_TOWN_MOTION_CAPTURE.viewName,
            frameIntervalMs: EASTBROOK_TOWN_MOTION_CAPTURE.frameIntervalMs,
            beacon: structuredClone(EASTBROOK_TOWN_MOTION_CAPTURE.beacon),
            contact: {
              defaultReducedMotionOutput: '/tmp/polish-civic-motion.png',
              defaultRuntimeReduceMotion: true,
              pairedFrameCount: 4,
            },
            modes: EASTBROOK_TOWN_MOTION_CAPTURE.modes.map(
              (mode: { id: string; reduceMotion: boolean }, modeIndex: number) => ({
                id: mode.id,
                runtimeReduceMotion: mode.reduceMotion,
                frames: ['t0', 't1'].map((phase, frameIndex) => ({
                  phase,
                  output: `/tmp/polish-civic-motion-${mode.id}-${phase}.png`,
                  bytes: 120_000,
                  sha256: String.fromCharCode(97 + modeIndex * 2 + frameIndex).repeat(64),
                })),
              }),
            ),
            restored: true,
          }
        : null,
    diagnostics: {
      pageErrors: [] as string[],
      consoleErrors: [] as string[],
      ignoredConsoleErrors: [] as string[],
      expectedFailures: ['/api/project-stats'],
      assetFailures: [] as string[],
    },
    cleanup: {
      overlayCount: 0,
      rootVisibilityRestored: true,
      shadowMapRestored: true,
      sunShadowRestored: true,
      infoAutoResetRestored: true,
    },
  };
}

describe('Eastbrook Grand Armoury capture contract', () => {
  it('literal-pins the world anchor, both complete profiles, and all three matched cameras', () => {
    expect(EASTBROOK_ARMOURY_CAPTURE_SEED).toBe(20_061);
    expect(EASTBROOK_ARMOURY_PLAYER_STATE).toEqual({
      x: 8,
      y: 1.5,
      z: 2,
      facing: Math.PI / 2,
    });
    expect(EASTBROOK_ARMOURY_CAPTURE_PROFILES).toEqual([
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
          deviceScaleFactor: 1,
          isMobile: true,
          hasTouch: true,
        },
        mobile: true,
      },
    ]);
    expect(EASTBROOK_ARMOURY_CAPTURE_VIEWS).toEqual([
      {
        name: 'wide',
        camera: { x: -1, y: 14, z: -23.5 },
        target: { x: 12.9, y: 5.8, z: -10 },
      },
      {
        name: 'close',
        camera: { x: 2.2, y: 7.8, z: -5.5 },
        target: { x: 7, y: 6.32, z: -5.5 },
      },
      {
        name: 'side-rear',
        camera: { x: 36, y: 14, z: 13 },
        target: { x: 22.4, y: 6, z: 0.13 },
      },
    ]);
  });

  it('literal-pins every town evidence view and the DPR-3 touch profile', () => {
    expect(EASTBROOK_TOWN_CAPTURE_PROFILES).toEqual([
      EASTBROOK_ARMOURY_CAPTURE_PROFILES[0],
      {
        ...EASTBROOK_ARMOURY_CAPTURE_PROFILES[1],
        viewport: {
          width: 844,
          height: 390,
          deviceScaleFactor: 3,
          isMobile: true,
          hasTouch: true,
        },
      },
    ]);
    expect(EASTBROOK_TOWN_CAPTURE_VIEWS).toEqual([
      {
        name: 'elevated-overview',
        camera: { x: -31, y: 28, z: -36 },
        target: { x: 0, y: 2.5, z: -1.5 },
      },
      {
        name: 'planning-top-down',
        camera: { x: 0, y: 54, z: -0.5 },
        target: { x: 0, y: 0, z: -1.5 },
      },
      {
        name: 'gate-approach',
        camera: { x: -32, y: 7, z: -32 },
        target: { x: 0, y: 3, z: -1.5 },
      },
      {
        name: 'central-square',
        camera: { x: -20, y: 8, z: -18 },
        target: { x: 0, y: 2.5, z: 5.5 },
      },
      {
        name: 'armoury-facade',
        camera: { x: 2.2, y: 7.8, z: -5.5 },
        target: { x: 7, y: 6.32, z: -5.5 },
      },
      {
        name: 'armoury-relation',
        camera: { x: 34, y: 15, z: 25 },
        target: { x: 10, y: 4, z: -2 },
      },
      {
        name: 'bank-and-chest',
        camera: { x: 30, y: 8, z: 22 },
        target: { x: 14.156943251329539, y: 3.2, z: 8.685223202016726 },
      },
      {
        name: 'smithy-and-forge',
        camera: { x: 16, y: 9, z: 31 },
        target: { x: 3.3817510253835374, y: 3, z: 14.399753759739639 },
      },
      {
        name: 'inn-and-kitchens',
        camera: { x: -29, y: 9, z: 29 },
        target: { x: -5, y: 3, z: 9 },
      },
      {
        name: 'market-and-fence',
        camera: { x: -24, y: 9, z: 24 },
        target: { x: -2.87967661431468, y: 3, z: 6.20921163603936 },
      },
      {
        name: 'chapel-and-weaving',
        camera: { x: -32, y: 11, z: -27 },
        target: { x: -9, y: 3, z: -7 },
      },
      {
        name: 'toolworks-service-perimeter',
        camera: { x: 21, y: 9, z: -31 },
        target: { x: 4.457282212971036, y: 3, z: -13.397884008445395 },
      },
      {
        name: 'player-scale',
        camera: { x: 2, y: 4.5, z: 9 },
        target: { x: 12.5, y: 3.8, z: -4 },
      },
      {
        name: 'interaction-collider-overlay',
        camera: { x: -36, y: 30, z: 34 },
        target: { x: 0, y: 1.5, z: -1.5 },
      },
      {
        name: 'side-rear-proof',
        camera: { x: 38, y: 16, z: 18 },
        target: { x: 23, y: 4, z: 2 },
      },
    ]);
  });

  it('literal-pins the rebuilt root, nine shipping assets, attribution scenarios, and inventories', () => {
    expect(EASTBROOK_TOWN_ROOT_NAME).toBe('eastbrookTownRebuild');
    expect(EASTBROOK_TOWN_SURFACE_ATLAS_URL).toBe('/textures/eastbrook_surface_atlas.webp');
    expect(EASTBROOK_TOWN_CAPTURE_SETTLE_MS).toBe(1_400);
    expect(EASTBROOK_TOWN_CAPTURE_TIMING).toEqual({
      bootSettleMs: 2_000,
      viewSettleMs: 1_400,
      perfWarmupMs: 800,
      perfSampleMs: 2_400,
      perfRepeats: 2,
    });
    expect(EASTBROOK_TOWN_NEW_ASSET_URLS).toEqual([
      '/models/props/eastbrook_bank.glb',
      '/models/props/eastbrook_smithy.glb',
      '/models/props/eastbrook_inn.glb',
      '/models/props/eastbrook_chapel.glb',
      '/models/props/eastbrook_weaving_workshop.glb',
      '/models/props/eastbrook_toolworks.glb',
      '/models/props/eastbrook_civic_well_beacon.glb',
      '/models/props/eastbrook_market_stall.glb',
      '/models/props/eastbrook_wall_wing.glb',
    ]);
    expect(EASTBROOK_TOWN_PERF_SCENARIOS).toEqual([
      { name: 'main-gate', viewName: 'gate-approach' },
      { name: 'elevated', viewName: 'elevated-overview' },
      { name: 'central', viewName: 'central-square' },
      { name: 'armoury-facing', viewName: 'armoury-relation' },
    ]);
    expect(EASTBROOK_TOWN_LEGACY_PLACEMENT_INVENTORY).toEqual({
      buildings: [
        'legacy_eastbrook_house_northeast',
        'legacy_eastbrook_house_northwest',
        'legacy_eastbrook_chapel',
      ],
      wells: ['legacy_eastbrook_well'],
      stalls: [
        'legacy_eastbrook_provisioner_stall',
        'legacy_eastbrook_smithy_stall',
        'legacy_eastbrook_world_market_stall',
      ],
      campfires: ['legacy_eastbrook_town_fire'],
      fences: ['legacy_eastbrook_fence_east', 'legacy_eastbrook_fence_west'],
      artisanRow: [
        'engineering_workbench',
        'alchemy_cauldron',
        'cooking_spit',
        'leatherworking_rack',
        'tailoring_loom',
        'inscription_lectern',
        'enchanting_altar',
        'jewelcrafting_bench',
        'mining_ore_cart',
        'herbalism_drying_rack',
      ],
      benches: [],
      walls: [],
      gates: [],
    });
    expect(EASTBROOK_TOWN_REBUILD_PLACEMENT_INVENTORY).toEqual({
      buildings: [
        'eastbrook_bank',
        'eastbrook_smithy',
        'eastbrook_inn',
        'eastbrook_chapel',
        'eastbrook_weaving_workshop',
        'eastbrook_toolworks',
      ],
      wells: ['eastbrook_civic_well_beacon'],
      stalls: [
        'eastbrook_market_stall_world_market',
        'eastbrook_market_stall_provisions',
        'eastbrook_market_stall_artisans',
      ],
      campfires: [],
      fences: [
        'eastbrook_fence_smithy_west',
        'eastbrook_fence_smithy_outer',
        'eastbrook_fence_smithy_east',
      ],
      artisanRow: [],
      benches: [
        'eastbrook_civic_bench_north',
        'eastbrook_civic_bench_south',
        'eastbrook_civic_bench_west',
      ],
      walls: Array.from(
        { length: 26 },
        (_, index) => `eastbrook_wall_${String(index).padStart(2, '0')}`,
      ),
      gates: [
        'eastbrook_gate_east',
        'eastbrook_gate_northeast',
        'eastbrook_gate_north',
        'eastbrook_gate_northwest',
        'eastbrook_gate_southwest',
        'eastbrook_gate_bandit',
      ],
    });
    expect(expectedTownPlacementInventory(false)).toEqual({
      legacy: EASTBROOK_TOWN_LEGACY_PLACEMENT_INVENTORY,
      rebuild: {
        buildings: [],
        wells: [],
        stalls: [],
        campfires: [],
        fences: [],
        artisanRow: [],
        benches: [],
        walls: [],
        gates: [],
      },
    });
    expect(expectedTownPlacementInventory(true)).toEqual({
      legacy: {
        buildings: [],
        wells: [],
        stalls: [],
        campfires: [],
        fences: [],
        artisanRow: [],
        benches: [],
        walls: [],
        gates: [],
      },
      rebuild: EASTBROOK_TOWN_REBUILD_PLACEMENT_INVENTORY,
    });
  });

  it('keeps all twelve committed screenshots present at their exact profile viewport', () => {
    for (const prefix of ['before', 'after']) {
      for (const captureProfile of EASTBROOK_ARMOURY_CAPTURE_PROFILES) {
        for (const captureView of EASTBROOK_ARMOURY_CAPTURE_VIEWS) {
          const imageUrl = new URL(
            `${prefix}-${captureView.name}-${captureProfile.name}.png`,
            evidenceDir,
          );
          const bytes = readFileSync(imageUrl);
          expect(statSync(imageUrl).size, imageUrl.pathname).toBeGreaterThan(50_000);
          expect(bytes.subarray(0, 8).toString('hex'), imageUrl.pathname).toBe('89504e470d0a1a0a');
          expect(bytes.readUInt32BE(8), imageUrl.pathname).toBe(13);
          expect(bytes.subarray(12, 16).toString('ascii'), imageUrl.pathname).toBe('IHDR');
          expect(bytes.readUInt32BE(16), imageUrl.pathname).toBe(captureProfile.viewport.width);
          expect(bytes.readUInt32BE(20), imageUrl.pathname).toBe(captureProfile.viewport.height);
        }
      }
    }
  });

  it('pins committed native-GPU performance evidence to the matched world and shipping deltas', () => {
    const before = readPerformanceEvidence('before');
    const after = readPerformanceEvidence('after');
    for (const [name, evidence, expectedArmoury] of [
      ['before', before, false],
      ['after', after, true],
    ] as const) {
      expect(evidence.schemaVersion, name).toBe(1);
      expect(evidence.shotPrefix, name).toBe(name);
      expect(evidence.expectedArmoury, name).toBe(expectedArmoury);
      expect(evidence.profile, name).toBe('desktop-ultra');
      expect(evidence.view, name).toBe('close');
      expect(evidence.world.seed, name).toBe(EASTBROOK_ARMOURY_CAPTURE_SEED);
      expect(evidence.world.player, name).toEqual(EASTBROOK_ARMOURY_PLAYER_STATE);
      expect(evidence.world.camera, name).toEqual(view.camera);
      expect(evidence.world.target, name).toEqual(view.target);
      expect(
        () => assertMatchedLotIdentity(evidence.world.lot, expectedArmoury),
        name,
      ).not.toThrow();
      expect(evidence.settings, name).toMatchObject(profile.settings);
      expect(evidence.gl, name).toEqual({
        vendor: 'Google Inc. (Apple)',
        renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Max, Unspecified Version)',
      });
      expect(evidence.captureDiagnostics.pageErrors, name).toEqual([]);
      expect(evidence.captureDiagnostics.consoleErrors, name).toEqual([]);
    }

    expect(before.deltas).toBeNull();
    expect(before.sampledDeltas).toBeNull();
    expect(before.directRenderAttribution).toBeNull();
    expect(after.deltas).toEqual({
      armouryWithShadows: EASTBROOK_ARMOURY_PERF_CONTRACT.withShadows,
      armouryWithoutShadows: EASTBROOK_ARMOURY_PERF_CONTRACT.withoutShadows,
      shadowPassAttribution: EASTBROOK_ARMOURY_PERF_CONTRACT.shadowPass,
    });
    expect(after.directRenderAttribution?.deltas).toEqual(after.deltas);
  });

  it('rejects missing or incompatible capture environment selections', () => {
    const valid = {
      GAME_URL: 'http://127.0.0.1:5184/',
      SHOT_PREFIX: 'after',
      EXPECT_ARMOURY: '1',
    };
    const selected = selectCaptureConfiguration(valid);
    expect(selected.gameUrl).toBe('http://127.0.0.1:5184');
    expect(selected.expectedArmoury).toBe(true);
    expect(selected.expectedTown).toBeNull();
    expect(selected.measurePerf).toBe(false);
    expect(selected.captureScope).toBe('armoury');
    expect(selected.profiles).toHaveLength(2);
    expect(selected.views).toHaveLength(3);

    const town = selectCaptureConfiguration({
      ...valid,
      CAPTURE_SCOPE: 'town',
    });
    expect(town.captureScope).toBe('town');
    expect(town.expectedTown).toBeNull();
    expect(town.profiles).toEqual(EASTBROOK_TOWN_CAPTURE_PROFILES);
    expect(town.views).toEqual(EASTBROOK_TOWN_CAPTURE_VIEWS);

    const beforeTown = selectCaptureConfiguration({
      ...valid,
      CAPTURE_SCOPE: 'town',
      EXPECT_ARMOURY: '1',
      EXPECT_TOWN: '0',
    });
    expect(beforeTown.expectedArmoury).toBe(true);
    expect(beforeTown.expectedTown).toBe(false);
    expect(beforeTown.sourceRevision).toBe('pull/2356/head');

    const afterTown = selectCaptureConfiguration({
      ...valid,
      CAPTURE_SCOPE: 'town',
      EXPECT_ARMOURY: '1',
      EXPECT_TOWN: '1',
    });
    expect(afterTown.expectedArmoury).toBe(true);
    expect(afterTown.expectedTown).toBe(true);
    expect(afterTown.sourceRevision).toBe('working-tree');
    expect(
      selectCaptureConfiguration({
        ...valid,
        CAPTURE_SCOPE: 'town',
        EXPECT_TOWN: '1',
        SOURCE_REVISION: 'feature/eastbrook-town',
      }).sourceRevision,
    ).toBe('feature/eastbrook-town');

    const legacyTownDefault = selectCaptureConfiguration({
      ...valid,
      CAPTURE_SCOPE: 'town',
      EXPECT_ARMOURY: '0',
    });
    expect(legacyTownDefault.expectedTown).toBeNull();

    const mobileWide = selectCaptureConfiguration({
      ...valid,
      EXPECT_ARMOURY: '0',
      PROFILE_NAME: 'mobile-low',
      VIEW_NAME: 'wide',
      MEASURE_PERF: '0',
    });
    expect(mobileWide.expectedArmoury).toBe(false);
    expect(mobileWide.measurePerf).toBe(false);
    expect(mobileWide.profiles.map((entry: { name: string }) => entry.name)).toEqual([
      'mobile-low',
    ]);
    expect(mobileWide.views.map((entry: { name: string }) => entry.name)).toEqual(['wide']);

    const perf = selectCaptureConfiguration({
      ...valid,
      PROFILE_NAME: 'desktop-ultra',
      VIEW_NAME: 'close',
      MEASURE_PERF: '1',
    });
    expect(perf.measurePerf).toBe(true);
    expect(perf.profiles.map((entry: { name: string }) => entry.name)).toEqual(['desktop-ultra']);
    expect(perf.views.map((entry: { name: string }) => entry.name)).toEqual(['close']);

    const townPerf = selectCaptureConfiguration({
      ...valid,
      CAPTURE_SCOPE: 'town',
      PROFILE_NAME: 'desktop-ultra',
      VIEW_NAME: 'elevated-overview',
      MEASURE_PERF: '1',
    });
    expect(townPerf.measurePerf).toBe(true);
    expect(townPerf.captureScope).toBe('town');
    expect(townPerf.views.map((entry: { name: string }) => entry.name)).toEqual([
      'elevated-overview',
    ]);

    const townMobilePerf = selectCaptureConfiguration({
      ...valid,
      CAPTURE_SCOPE: 'town',
      PROFILE_NAME: 'mobile-low',
      VIEW_NAME: 'elevated-overview',
      MEASURE_PERF: '1',
    });
    expect(townMobilePerf.measurePerf).toBe(true);
    expect(townMobilePerf.profiles.map((entry: { name: string }) => entry.name)).toEqual([
      'mobile-low',
    ]);

    expect(() => selectCaptureConfiguration({ ...valid, GAME_URL: '' })).toThrow(
      'GAME_URL and SHOT_PREFIX are required',
    );
    expect(() => selectCaptureConfiguration({ ...valid, SHOT_PREFIX: '' })).toThrow(
      'GAME_URL and SHOT_PREFIX are required',
    );
    expect(() => selectCaptureConfiguration({ ...valid, EXPECT_ARMOURY: 'yes' })).toThrow(
      'EXPECT_ARMOURY must be 0 or 1',
    );
    expect(() => selectCaptureConfiguration({ ...valid, MEASURE_PERF: 'yes' })).toThrow(
      'MEASURE_PERF must be 0 or 1',
    );
    expect(() => selectCaptureConfiguration({ ...valid, PROFILE_NAME: 'cinematic' })).toThrow(
      'Unknown PROFILE_NAME',
    );
    expect(() => selectCaptureConfiguration({ ...valid, VIEW_NAME: 'front' })).toThrow(
      'Unknown VIEW_NAME',
    );
    expect(() => selectCaptureConfiguration({ ...valid, CAPTURE_SCOPE: 'vale' })).toThrow(
      'CAPTURE_SCOPE must be armoury or town',
    );
    expect(() =>
      selectCaptureConfiguration({
        ...valid,
        CAPTURE_SCOPE: 'town',
        EXPECT_TOWN: 'yes',
      }),
    ).toThrow('EXPECT_TOWN must be 0 or 1');
    expect(
      selectCaptureConfiguration({
        ...valid,
        CAPTURE_SCOPE: 'armoury',
        EXPECT_TOWN: 'yes',
      }).expectedTown,
    ).toBeNull();
    expect(() =>
      selectCaptureConfiguration({
        ...valid,
        PROFILE_NAME: 'mobile-low',
        MEASURE_PERF: '1',
      }),
    ).toThrow('MEASURE_PERF=1 requires PROFILE_NAME=desktop-ultra');
    expect(() =>
      selectCaptureConfiguration({
        ...valid,
        VIEW_NAME: 'wide',
        MEASURE_PERF: '1',
      }),
    ).toThrow('MEASURE_PERF=1 requires VIEW_NAME=close');
  });

  it('fails town metadata closed across root, inventory, assets, viewport, touch, and cleanup', () => {
    const desktop = validTownMetadata();
    expect(() =>
      assertTownCaptureMetadata({
        metadata: desktop,
        expectedTown: true,
        expectedArmoury: true,
        profile: EASTBROOK_TOWN_CAPTURE_PROFILES[0],
        view: EASTBROOK_TOWN_CAPTURE_VIEWS[0],
        playerState: EASTBROOK_ARMOURY_PLAYER_STATE,
        expectedSeed: EASTBROOK_ARMOURY_CAPTURE_SEED,
        settleMs: EASTBROOK_TOWN_CAPTURE_SETTLE_MS,
      }),
    ).not.toThrow();

    const before = validTownMetadata({ expectedTown: false });
    expect(() =>
      assertTownCaptureMetadata({
        metadata: before,
        expectedTown: false,
        expectedArmoury: true,
        profile: EASTBROOK_TOWN_CAPTURE_PROFILES[0],
        view: EASTBROOK_TOWN_CAPTURE_VIEWS[0],
        playerState: EASTBROOK_ARMOURY_PLAYER_STATE,
        expectedSeed: EASTBROOK_ARMOURY_CAPTURE_SEED,
        settleMs: EASTBROOK_TOWN_CAPTURE_SETTLE_MS,
      }),
    ).not.toThrow();

    const overlayView = EASTBROOK_TOWN_CAPTURE_VIEWS.find(
      (entry: { name: string }) => entry.name === 'interaction-collider-overlay',
    );
    const mobile = validTownMetadata({
      captureProfile: EASTBROOK_TOWN_CAPTURE_PROFILES[1],
      captureView: overlayView,
    });
    expect(() =>
      assertTownCaptureMetadata({
        metadata: mobile,
        expectedTown: true,
        expectedArmoury: true,
        profile: EASTBROOK_TOWN_CAPTURE_PROFILES[1],
        view: overlayView,
        playerState: EASTBROOK_ARMOURY_PLAYER_STATE,
        expectedSeed: EASTBROOK_ARMOURY_CAPTURE_SEED,
        settleMs: EASTBROOK_TOWN_CAPTURE_SETTLE_MS,
      }),
    ).not.toThrow();

    const incompleteOverlay = validTownMetadata({ captureView: overlayView });
    incompleteOverlay.overlay.records.obbs.pop();
    expect(() =>
      assertTownCaptureMetadata({
        metadata: incompleteOverlay,
        expectedTown: true,
        expectedArmoury: true,
        profile: EASTBROOK_TOWN_CAPTURE_PROFILES[0],
        view: overlayView,
        playerState: EASTBROOK_ARMOURY_PLAYER_STATE,
        expectedSeed: EASTBROOK_ARMOURY_CAPTURE_SEED,
        settleMs: EASTBROOK_TOWN_CAPTURE_SETTLE_MS,
      }),
    ).toThrow('capture overlay record inventory');

    const failures: Array<[string, (metadata: ReturnType<typeof validTownMetadata>) => void]> = [
      ['town root presence', (metadata) => (metadata.observed.townRoot.present = false)],
      ['capture source fingerprint', (metadata) => (metadata.source.fingerprint = 'wrong')],
      ['town armoury kind', (metadata) => (metadata.observed.armouryRecord.kind = 'inn')],
      ['banker chest presence', (metadata) => (metadata.observed.bankerChestPresent = false)],
      ['banker chest count', (metadata) => (metadata.observed.bankerChestCount = 2)],
      ['town root asset URLs', (metadata) => metadata.observed.townRoot.newAssetUrls.pop()],
      [
        'town root draw stats',
        (metadata) => {
          const drawStats = metadata.observed.townRoot.drawStats;
          if (drawStats) drawStats.colorDraws = 13;
        },
      ],
      [
        'legacy placement inventory',
        (metadata) => metadata.observed.inventory.legacy.buildings.push('legacy-leak'),
      ],
      [
        'rebuild placement inventory',
        (metadata) => metadata.observed.inventory.rebuild.buildings.pop(),
      ],
      ['asset URL inventory', (metadata) => metadata.observed.assetStates.pop()],
      ['asset load state', (metadata) => (metadata.observed.assetStates[0].state = 'failed')],
      ['surface atlas load state', (metadata) => (metadata.observed.surfaceAtlas.state = 'failed')],
      [
        'surface atlas bindings',
        (metadata) => (metadata.observed.surfaceAtlas.consumers.armoury.materialBindings = 0),
      ],
      [
        'surface atlas bindings',
        (metadata) => {
          const atlasMetadata = metadata.observed.surfaceAtlas.consumers.armoury.roots[0].metadata;
          if (atlasMetadata) atlasMetadata.textureUuid = 'different-atlas-texture';
        },
      ],
      [
        'surface atlas bindings',
        (metadata) =>
          (metadata.observed.surfaceAtlas.consumers.bankerChest.roots[0].observed.materialBindings = 1),
      ],
      ['renderer vendor', (metadata) => (metadata.renderer.vendor = '')],
      ['renderer resources', (metadata) => (metadata.renderer.resources.textures = -1)],
      ['graphics governor', (metadata) => (metadata.renderer.governorEnabled = true)],
      ['CSS viewport', (metadata) => (metadata.viewport.observed.cssWidth = 800)],
      ['viewport mutation', (metadata) => (metadata.viewport.observed.viewportMeta = 'mutated')],
      ['settle window', (metadata) => (metadata.settle.requestedMs = 1)],
      ['capture errors', (metadata) => metadata.diagnostics.pageErrors.push('boom')],
      ['asset failures', (metadata) => metadata.diagnostics.assetFailures.push('missing.glb')],
      ['capture cleanup', (metadata) => (metadata.cleanup.overlayCount = 1)],
    ];
    for (const [message, mutate] of failures) {
      const changed = validTownMetadata();
      mutate(changed);
      expect(
        () =>
          assertTownCaptureMetadata({
            metadata: changed,
            expectedTown: true,
            expectedArmoury: true,
            profile: EASTBROOK_TOWN_CAPTURE_PROFILES[0],
            view: EASTBROOK_TOWN_CAPTURE_VIEWS[0],
            playerState: EASTBROOK_ARMOURY_PLAYER_STATE,
            expectedSeed: EASTBROOK_ARMOURY_CAPTURE_SEED,
            settleMs: EASTBROOK_TOWN_CAPTURE_SETTLE_MS,
          }),
        message,
      ).toThrow(message);
    }

    const badMobile = validTownMetadata({
      captureProfile: EASTBROOK_TOWN_CAPTURE_PROFILES[1],
      captureView: overlayView,
    });
    badMobile.viewport.touchHudVisible = false;
    expect(() =>
      assertTownCaptureMetadata({
        metadata: badMobile,
        expectedTown: true,
        expectedArmoury: true,
        profile: EASTBROOK_TOWN_CAPTURE_PROFILES[1],
        view: overlayView,
        playerState: EASTBROOK_ARMOURY_PLAYER_STATE,
        expectedSeed: EASTBROOK_ARMOURY_CAPTURE_SEED,
        settleMs: EASTBROOK_TOWN_CAPTURE_SETTLE_MS,
      }),
    ).toThrow('touch HUD');

    const badOverlay = validTownMetadata({ captureView: overlayView });
    badOverlay.overlay.removedAfterCapture = false;
    expect(() =>
      assertTownCaptureMetadata({
        metadata: badOverlay,
        expectedTown: true,
        expectedArmoury: true,
        profile: EASTBROOK_TOWN_CAPTURE_PROFILES[0],
        view: overlayView,
        playerState: EASTBROOK_ARMOURY_PLAYER_STATE,
        expectedSeed: EASTBROOK_ARMOURY_CAPTURE_SEED,
        settleMs: EASTBROOK_TOWN_CAPTURE_SETTLE_MS,
      }),
    ).toThrow('capture overlay');
  });

  it('validates an integrated polish-v2 metadata record and rejects each contract drift independently', () => {
    const polishView = EASTBROOK_TOWN_CAPTURE_CONTRACTS['polish-v2'].views.find(
      (candidate: { name: string }) => candidate.name === EASTBROOK_TOWN_MOTION_CAPTURE.viewName,
    );
    if (!polishView) throw new Error('missing polish-v2 civic motion view fixture');
    const pristine = validTownMetadata({
      contractId: 'polish-v2',
      captureView: polishView,
    });
    const expectedPolishProvenance = structuredClone(pristine.polishProvenance);
    const assertPolishV2 = (metadata: ReturnType<typeof validTownMetadata>) =>
      assertTownCaptureMetadata({
        metadata,
        contractId: 'polish-v2',
        expectedTown: true,
        expectedArmoury: true,
        profile: EASTBROOK_TOWN_CAPTURE_PROFILES[0],
        view: polishView,
        playerState: EASTBROOK_ARMOURY_PLAYER_STATE,
        expectedSeed: EASTBROOK_ARMOURY_CAPTURE_SEED,
        settleMs: EASTBROOK_TOWN_CAPTURE_SETTLE_MS,
        expectedPolishProvenance,
      });

    expect(() => assertPolishV2(pristine)).not.toThrow();
    expect(() =>
      assertTownCaptureMetadata({
        metadata: pristine,
        contractId: 'polish-v2',
        expectedTown: true,
        expectedArmoury: true,
        profile: EASTBROOK_TOWN_CAPTURE_PROFILES[0],
        view: polishView,
        playerState: EASTBROOK_ARMOURY_PLAYER_STATE,
        expectedSeed: EASTBROOK_ARMOURY_CAPTURE_SEED,
        settleMs: EASTBROOK_TOWN_CAPTURE_SETTLE_MS,
      }),
    ).toThrow('expected polish provenance is missing');

    const failures: Array<
      [string, string, (metadata: ReturnType<typeof validTownMetadata>) => void]
    > = [
      [
        'contract id',
        'town capture contract id',
        (metadata) => {
          if (metadata.townContract) metadata.townContract.id = 'polish-baseline';
        },
      ],
      [
        'layout id',
        'town capture contract',
        (metadata) => {
          if (metadata.townContract) metadata.townContract.layoutId = 'eastbrook_civic_layout_v1';
        },
      ],
      [
        'source comparison',
        'town capture contract',
        (metadata) => {
          if (metadata.townContract) metadata.townContract.sourceComparison = 'feature-worktree';
        },
      ],
      [
        'placement inventory',
        'town capture contract',
        (metadata) => {
          if (metadata.townContract) metadata.townContract.placementInventory.stalls.pop();
        },
      ],
      [
        'town triangles',
        'town capture contract',
        (metadata) => {
          if (metadata.townContract) metadata.townContract.townTriangles += 1;
        },
      ],
      [
        'contract asset URLs',
        'town capture contract',
        (metadata) => {
          if (metadata.townContract) metadata.townContract.assetUrls.pop();
        },
      ],
      [
        'contract attribution targets',
        'town capture contract',
        (metadata) => {
          if (metadata.townContract) metadata.townContract.attributionTargets.pop();
        },
      ],
      [
        'contract overlay counts',
        'town capture contract',
        (metadata) => {
          if (metadata.townContract) metadata.townContract.overlayRecordCounts.points += 1;
        },
      ],
      [
        'contract motion fields',
        'town capture contract',
        (metadata) => {
          if (metadata.townContract?.motionCapture) {
            metadata.townContract.motionCapture.frameIntervalMs += 1;
          }
        },
      ],
      [
        'contract polish provenance',
        'town capture contract',
        (metadata) => {
          if (metadata.townContract?.polishProvenance) {
            metadata.townContract.polishProvenance.baselineRevision = 'wrong-revision';
          }
        },
      ],
      [
        'contract asset states non-array',
        'town contract asset inventory',
        (metadata) => {
          metadata.observed.contractAssetStates =
            null as unknown as typeof metadata.observed.contractAssetStates;
        },
      ],
      [
        'contract asset state length',
        'town contract asset inventory',
        (metadata) => {
          metadata.observed.contractAssetStates.pop();
        },
      ],
      [
        'contract asset state URL',
        'town contract asset inventory',
        (metadata) => {
          metadata.observed.contractAssetStates[0].url = '/models/props/wrong.glb';
        },
      ],
      [
        'contract asset state',
        'town contract asset inventory',
        (metadata) => {
          metadata.observed.contractAssetStates[0].state = 'failed';
        },
      ],
      [
        'composite provenance',
        'polish capture provenance',
        (metadata) => {
          if (metadata.polishProvenance && 'fingerprint' in metadata.polishProvenance) {
            metadata.polishProvenance.fingerprint = '0'.repeat(64);
          }
        },
      ],
      [
        'target visibility',
        'visibility is incorrect',
        (metadata) => {
          metadata.observed.contractTargets[1].visible = false;
        },
      ],
      [
        'target stable identity',
        'stable layout ids',
        (metadata) => {
          metadata.observed.contractTargets[2].rootName = 'wrongNoticeboardRoot';
        },
      ],
      [
        'motion mode',
        'motion-on runtime reduce-motion state',
        (metadata) => {
          if (metadata.motionEvidence) metadata.motionEvidence.modes[0].runtimeReduceMotion = true;
        },
      ],
      [
        'reduced-motion cleanup',
        'civic motion evidence is incomplete',
        (metadata) => {
          if (metadata.motionEvidence) metadata.motionEvidence.restored = false;
        },
      ],
    ];
    for (const [label, message, mutate] of failures) {
      const changed = structuredClone(pristine);
      mutate(changed);
      expect(() => assertPolishV2(changed), label).toThrow(message);
    }

    const nonMotionView = EASTBROOK_TOWN_CAPTURE_CONTRACTS['polish-v2'].views.find(
      (candidate: { name: string }) => candidate.name !== EASTBROOK_TOWN_MOTION_CAPTURE.viewName,
    );
    if (!nonMotionView) throw new Error('missing polish-v2 non-motion view fixture');
    const nonMotion = validTownMetadata({
      contractId: 'polish-v2',
      captureView: nonMotionView,
    });
    nonMotion.motionEvidence = structuredClone(pristine.motionEvidence);
    expect(() =>
      assertTownCaptureMetadata({
        metadata: nonMotion,
        contractId: 'polish-v2',
        expectedTown: true,
        expectedArmoury: true,
        profile: EASTBROOK_TOWN_CAPTURE_PROFILES[0],
        view: nonMotionView,
        playerState: EASTBROOK_ARMOURY_PLAYER_STATE,
        expectedSeed: EASTBROOK_ARMOURY_CAPTURE_SEED,
        settleMs: EASTBROOK_TOWN_CAPTURE_SETTLE_MS,
        expectedPolishProvenance: structuredClone(nonMotion.polishProvenance),
      }),
    ).toThrow('motion evidence was attached to a non-motion capture view');

    const baselineContract = EASTBROOK_TOWN_CAPTURE_CONTRACTS['polish-baseline'];
    const baselineView = baselineContract.views[0];
    const baseline = validTownMetadata({
      contractId: 'polish-baseline',
      captureView: baselineView,
    });
    const expectedBaselineProvenance = structuredClone(baseline.polishProvenance);
    const assertBaseline = () =>
      assertTownCaptureMetadata({
        metadata: baseline,
        contractId: 'polish-baseline',
        expectedTown: true,
        expectedArmoury: true,
        profile: EASTBROOK_TOWN_CAPTURE_PROFILES[0],
        view: baselineView,
        playerState: EASTBROOK_ARMOURY_PLAYER_STATE,
        expectedSeed: EASTBROOK_ARMOURY_CAPTURE_SEED,
        settleMs: EASTBROOK_TOWN_CAPTURE_SETTLE_MS,
        expectedPolishProvenance: expectedBaselineProvenance,
      });
    expect(assertBaseline).not.toThrow();
    baseline.source.revision = 'not-the-pinned-baseline-revision';
    expect(assertBaseline).toThrow('polish baseline source revision');
  });

  it('pins seed, every graphics setting, asset visibility, player anchor, and camera coordinates', () => {
    expect(() => assertValidRenderState()).not.toThrow();

    const failures: Array<[string, (state: CaptureRenderState) => void]> = [
      ['expected world seed', (state) => (state.seed = 4_717)],
      ['expected ultra tier', (state) => (state.tier = 'low')],
      ['graphics governor must be disabled', (state) => (state.autoGovernor = true)],
      [
        'graphicsDefaultApplied must remain true',
        (state) => (state.settings.graphicsDefaultApplied = false),
      ],
      ['expected armoury presence true', (state) => (state.assetPresent = false)],
      [
        'not visibly framed',
        (state) => {
          if (!state.asset) throw new Error('test fixture lost asset');
          state.asset.visible = false;
        },
      ],
      ['editor camera is not active', (state) => (state.editorCamera = null)],
      ['player.x', (state) => (state.player.x += 0.1)],
      ['player.y', (state) => (state.player.y += 0.1)],
      ['player.z', (state) => (state.player.z += 0.1)],
      ['player.facing', (state) => (state.player.facing = 0)],
    ];
    for (const key of Object.keys(profile.settings)) {
      if (key === 'graphicsDefaultApplied') continue;
      failures.push([`setting ${key}`, (state) => (state.settings[key] = -1)]);
    }
    for (const axis of ['x', 'y', 'z'] as Array<keyof Vector3>) {
      failures.push([`camera.${axis}`, (state) => (state.camera[axis] += 0.1)]);
      failures.push([`target.${axis}`, (state) => (state.target[axis] += 0.1)]);
      failures.push([
        `editorCamera.camera.${axis}`,
        (state) => {
          if (!state.editorCamera) throw new Error('test fixture lost editor camera');
          state.editorCamera.camera[axis] += 0.1;
        },
      ]);
      failures.push([
        `editorCamera.target.${axis}`,
        (state) => {
          if (!state.editorCamera) throw new Error('test fixture lost editor camera');
          state.editorCamera.target[axis] += 0.1;
        },
      ]);
    }

    for (const [message, mutate] of failures) {
      const state = validRenderState();
      mutate(state);
      expect(() => assertValidRenderState(state), message).toThrow(message);
    }
  });

  it('requires the old southeast inn on base captures and the exact replacement lot on feature captures', () => {
    const baseLot = { kind: 'inn', x: 12, z: -6, w: 6, d: 7, rot: 2.4 };
    const featureLot = {
      kind: 'inn',
      landmark: 'eastbrook_grand_armoury',
      x: 17.5,
      z: -5.5,
      w: 13,
      d: 9,
      rot: -Math.PI / 2,
    };
    expect(() => assertMatchedLotIdentity(baseLot, false)).not.toThrow();
    expect(() => assertMatchedLotIdentity(featureLot, true)).not.toThrow();

    for (const key of Object.keys(featureLot) as Array<keyof typeof featureLot>) {
      const changed = { ...featureLot };
      changed[key] = (key === 'kind' || key === 'landmark' ? 'wrong' : 999) as never;
      expect(() => assertMatchedLotIdentity(changed, true), key).toThrow(`matched lot ${key}`);
    }
    for (const key of Object.keys(baseLot) as Array<keyof typeof baseLot>) {
      const changed = { ...baseLot };
      changed[key] = (key === 'kind' ? 'wrong' : 999) as never;
      expect(() => assertMatchedLotIdentity(changed, false), key).toThrow(`matched lot ${key}`);
    }
    expect(() => assertMatchedLotIdentity({ ...baseLot, landmark: null }, false)).toThrow(
      'matched base lot landmark: expected omitted',
    );
  });

  it('pins the rebuilt town Armoury as the preserved house landmark independently of town presence', () => {
    const townArmoury = {
      id: 'eastbrook_grand_armoury',
      assetId: '/models/props/eastbrook_grand_armoury.glb',
      kind: 'house',
      landmark: 'eastbrook_grand_armoury',
      x: 17.5,
      z: -5.5,
      w: 13,
      d: 9,
      rot: -Math.PI / 2,
      height: 15,
    };
    const baseArmoury = {
      kind: 'inn',
      landmark: 'eastbrook_grand_armoury',
      x: 17.5,
      z: -5.5,
      w: 13,
      d: 9,
      rot: -Math.PI / 2,
    };
    expect(() => assertTownArmouryIdentity(baseArmoury, false)).not.toThrow();
    expect(() => assertTownArmouryIdentity(townArmoury, true)).not.toThrow();
    for (const key of Object.keys(townArmoury) as Array<keyof typeof townArmoury>) {
      const changed = { ...townArmoury };
      changed[key] = (typeof changed[key] === 'number' ? 999 : 'wrong') as never;
      expect(() => assertTownArmouryIdentity(changed, true), key).toThrow(`town armoury ${key}`);
    }
    for (const key of Object.keys(baseArmoury) as Array<keyof typeof baseArmoury>) {
      const changed = { ...baseArmoury };
      changed[key] = (typeof changed[key] === 'number' ? 999 : 'wrong') as never;
      expect(() => assertTownArmouryIdentity(changed, false), key).toThrow(`town armoury ${key}`);
    }
  });

  it('accepts the release-base render only when the landmark mesh is absent', () => {
    const state = validRenderState();
    state.assetPresent = false;
    state.asset = null;
    expect(() =>
      assertCaptureRenderState({
        renderState: state,
        expectedSeed: 20_061,
        profile,
        view,
        expectedArmoury: false,
        playerState,
      }),
    ).not.toThrow();
    state.asset = { visible: true };
    expect(() =>
      assertCaptureRenderState({
        renderState: state,
        expectedSeed: 20_061,
        profile,
        view,
        expectedArmoury: false,
        playerState,
      }),
    ).toThrow('release-base armoury asset details must be null');
  });

  it('keeps the headless-only console allowlist narrow', () => {
    expect(expectedCaptureEnvironmentError('Failed to fetch project stats')).toBe(true);
    expect(
      expectedCaptureEnvironmentError(
        'THREE.WebGLProgram: Shader Error Material Name: EquirectangularToCubeUV',
      ),
    ).toBe(true);
    expect(
      expectedCaptureEnvironmentError(
        'THREE.WebGLProgram: Shader Error Material Name: SphericalGaussianBlur',
      ),
    ).toBe(true);
    expect(
      expectedCaptureEnvironmentError(
        'character visual unavailable, skipping view (mob_training_dummy)',
      ),
    ).toBe(true);

    expect(expectedCaptureEnvironmentError('GET /api/characters 502 (Bad Gateway)')).toBe(false);
    expect(expectedCaptureProxyResponse('http://127.0.0.1:5184/api/project-stats', 502)).toBe(true);
    expect(expectedCaptureProxyResponse('http://127.0.0.1:5184/api/site-presence', 502)).toBe(true);
    expect(expectedCaptureProxyResponse('http://127.0.0.1:5184/api/characters', 502)).toBe(false);
    expect(expectedCaptureProxyResponse('http://127.0.0.1:5184/api/project-stats', 500)).toBe(
      false,
    );
    expect(expectedCaptureProxyResponse('not a URL', 502)).toBe(false);
    expect(
      expectedCaptureProxyConsoleError(
        'Failed to load resource: the server responded with a status of 502 (Bad Gateway)',
      ),
    ).toBe(true);
    expect(
      expectedCaptureProxyConsoleError(
        'Failed to load resource: the server responded with a status of 404 (Not Found)',
      ),
    ).toBe(false);
    expect(
      expectedCaptureProxyConsoleSource(
        'Failed to load resource: the server responded with a status of 502 (Bad Gateway)',
        'http://127.0.0.1:5184/api/site-presence',
      ),
    ).toBe(true);
    expect(
      expectedCaptureProxyConsoleSource(
        'Failed to load resource: the server responded with a status of 502 (Bad Gateway)',
        'http://127.0.0.1:5184/api/characters',
      ),
    ).toBe(false);
    expect(
      expectedCaptureEnvironmentError(
        'THREE.WebGLProgram: Shader Error Material Name: EastbrookArmoury',
      ),
    ).toBe(false);
    expect(expectedCaptureEnvironmentError('Material Name: EquirectangularToCubeUV')).toBe(false);
    expect(expectedCaptureEnvironmentError('Uncaught TypeError: render failed')).toBe(false);
    expect(() => assertNoCaptureErrors([], [])).not.toThrow();
    expect(() => assertNoCaptureErrors(['page exploded'], [])).toThrow('page exploded');
    expect(() => assertNoCaptureErrors([], ['console exploded'])).toThrow('console exploded');
  });

  it('pins visible, hidden, base, shadow, wrapper, and restoration performance branches', () => {
    const visible = perfRaw();
    expect(() =>
      assertPerformanceBlockState({
        raw: visible,
        label: 'visible-shadow-on',
        meshVisible: true,
        shadowEnabled: true,
      }),
    ).not.toThrow();

    const hidden = perfRaw({ meshVisible: false, shadowEnabled: false });
    expect(() =>
      assertPerformanceBlockState({
        raw: hidden,
        label: 'hidden-shadow-off',
        meshVisible: false,
        shadowEnabled: false,
      }),
    ).not.toThrow();

    const base = perfRaw({
      meshVisible: false,
      shadowEnabled: false,
      assetPresent: false,
    });
    expect(() =>
      assertPerformanceBlockState({
        raw: base,
        label: 'base-shadow-off',
        meshVisible: null,
        shadowEnabled: false,
      }),
    ).not.toThrow();

    const wrongShadow = perfRaw();
    wrongShadow.observed.shadowMapEnabled = false;
    expect(() =>
      assertPerformanceBlockState({
        raw: wrongShadow,
        label: 'wrong-shadow',
        meshVisible: true,
        shadowEnabled: true,
      }),
    ).toThrow('shadow-map state');

    const wrongSun = perfRaw();
    wrongSun.observed.sunCastShadow = false;
    expect(() =>
      assertPerformanceBlockState({
        raw: wrongSun,
        label: 'wrong-sun',
        meshVisible: true,
        shadowEnabled: true,
      }),
    ).toThrow('sun shadow state');

    const missingWrapper = perfRaw();
    missingWrapper.observed.wrapperVisible = false;
    expect(() =>
      assertPerformanceBlockState({
        raw: missingWrapper,
        label: 'missing-wrapper',
        meshVisible: true,
        shadowEnabled: true,
      }),
    ).toThrow('wrapper or child meshes were unavailable');

    const missingChildren = perfRaw();
    missingChildren.armouryChildMeshes = 0;
    expect(() =>
      assertPerformanceBlockState({
        raw: missingChildren,
        label: 'missing-children',
        meshVisible: true,
        shadowEnabled: true,
      }),
    ).toThrow('wrapper or child meshes were unavailable');

    const wrongVisibility = perfRaw();
    wrongVisibility.observed.visibleMeshes = 0;
    expect(() =>
      assertPerformanceBlockState({
        raw: wrongVisibility,
        label: 'wrong-visibility',
        meshVisible: true,
        shadowEnabled: true,
      }),
    ).toThrow('expected 6 visible child meshes');

    expect(() =>
      assertPerformanceStateRestored({
        restored: structuredClone(visible.restorationContract),
        original: visible.restorationContract,
        label: 'visible-shadow-on',
      }),
    ).not.toThrow();
    const restorationMutations = [
      (state: typeof visible.restorationContract) => (state.wrapperVisible = false),
      (state: typeof visible.restorationContract) => (state.meshVisible[0] = false),
      (state: typeof visible.restorationContract) => (state.shadowMapEnabled = false),
      (state: typeof visible.restorationContract) => (state.sunCastShadow = false),
      (state: typeof visible.restorationContract) => (state.infoAutoReset = false),
    ];
    for (const mutate of restorationMutations) {
      const changed = structuredClone(visible.restorationContract);
      mutate(changed);
      expect(() =>
        assertPerformanceStateRestored({
          restored: changed,
          original: visible.restorationContract,
          label: 'visible-shadow-on',
        }),
      ).toThrow('were not restored');
    }
  });

  it('attributes town cost only through the stable rebuild root and restores every mutation', () => {
    const visible = townPerfRaw();
    expect(() =>
      assertTownPerformanceBlockState({
        raw: visible,
        label: 'town-visible-shadow-on',
        rootVisible: true,
        shadowEnabled: true,
      }),
    ).not.toThrow();
    const hidden = townPerfRaw({ rootVisible: false, shadowEnabled: false });
    expect(() =>
      assertTownPerformanceBlockState({
        raw: hidden,
        label: 'town-hidden-shadow-off',
        rootVisible: false,
        shadowEnabled: false,
      }),
    ).not.toThrow();

    const wrongTarget = townPerfRaw();
    wrongTarget.targetName = 'eastbrookGrandArmoury';
    expect(() =>
      assertTownPerformanceBlockState({
        raw: wrongTarget,
        label: 'wrong-target',
        rootVisible: true,
        shadowEnabled: true,
      }),
    ).toThrow('eastbrookTownRebuild');

    const wrongVisibility = townPerfRaw();
    wrongVisibility.observed.rootVisible = false;
    expect(() =>
      assertTownPerformanceBlockState({
        raw: wrongVisibility,
        label: 'wrong-visibility',
        rootVisible: true,
        shadowEnabled: true,
      }),
    ).toThrow('root visibility');

    const missingDrawStats = townPerfRaw();
    missingDrawStats.drawStats.colorDraws = 0;
    expect(() =>
      assertTownPerformanceBlockState({
        raw: missingDrawStats,
        label: 'missing-draw-stats',
        rootVisible: true,
        shadowEnabled: true,
      }),
    ).toThrow('draw stats');

    const wrongTriangleCount = townPerfRaw();
    wrongTriangleCount.drawStats.triangles = 29_643;
    expect(() =>
      assertTownPerformanceBlockState({
        raw: wrongTriangleCount,
        label: 'wrong-triangle-count',
        rootVisible: true,
        shadowEnabled: true,
      }),
    ).toThrow('draw stats');

    const baseline = {
      targetName: EASTBROOK_TOWN_ROOT_NAME,
      targetChildMeshes: 0,
      requested: { rootVisible: null, shadowEnabled: true },
      observed: {
        rootName: EASTBROOK_TOWN_ROOT_NAME,
        rootPresent: false,
        rootVisible: null,
        shadowMapEnabled: true,
        sunCastShadow: true,
      },
      drawStats: null,
    };
    expect(() =>
      assertTownBaselinePerformanceBlockState({
        raw: baseline,
        label: 'town-baseline-shadow-on',
        shadowEnabled: true,
      }),
    ).not.toThrow();
    const baselineUsingArmoury = structuredClone(baseline);
    baselineUsingArmoury.targetName = 'eastbrookGrandArmoury';
    expect(() =>
      assertTownBaselinePerformanceBlockState({
        raw: baselineUsingArmoury,
        label: 'town-baseline-wrong-target',
        shadowEnabled: true,
      }),
    ).toThrow(EASTBROOK_TOWN_ROOT_NAME);

    expect(() =>
      assertCaptureCleanupState({
        cleanup: {
          overlayCount: 0,
          rootVisibilityRestored: true,
          shadowMapRestored: true,
          sunShadowRestored: true,
          infoAutoResetRestored: true,
        },
        label: 'town cleanup',
      }),
    ).not.toThrow();
    for (const key of [
      'overlayCount',
      'rootVisibilityRestored',
      'shadowMapRestored',
      'sunShadowRestored',
      'infoAutoResetRestored',
    ] as const) {
      const cleanup = {
        overlayCount: 0,
        rootVisibilityRestored: true,
        shadowMapRestored: true,
        sunShadowRestored: true,
        infoAutoResetRestored: true,
      };
      cleanup[key] = (key === 'overlayCount' ? 1 : false) as never;
      expect(() => assertCaptureCleanupState({ cleanup, label: 'town cleanup' }), key).toThrow(
        'town cleanup',
      );
    }
  });

  it('derives separately named town color and shadow attribution deltas', () => {
    const conditions = {
      hiddenShadowOn: {
        renderMedian: { calls: 100, triangles: 100_000, lines: 2, points: 3 },
      },
      visibleShadowOn: {
        renderMedian: { calls: 130, triangles: 160_000, lines: 2, points: 3 },
      },
      hiddenShadowOff: {
        renderMedian: { calls: 80, triangles: 70_000, lines: 2, points: 3 },
      },
      visibleShadowOff: {
        renderMedian: { calls: 98, triangles: 105_000, lines: 2, points: 3 },
      },
    };
    expect(deriveTownPerformanceDeltas(conditions)).toEqual({
      townWithoutShadows: { calls: 18, triangles: 35_000, lines: 0, points: 0 },
      townWithShadows: { calls: 30, triangles: 60_000, lines: 0, points: 0 },
      shadowPassAttribution: {
        calls: 12,
        triangles: 25_000,
        lines: 0,
        points: 0,
      },
    });
  });

  it('derives and literal-pins the measured default-seed color and shadow contribution', () => {
    expect(EASTBROOK_ARMOURY_PERF_CONTRACT).toEqual({
      withoutShadows: { calls: 6, triangles: 8_226, lines: 0, points: 0 },
      withShadows: { calls: 10, triangles: 15_844, lines: 0, points: 0 },
      shadowPass: { calls: 4, triangles: 7_618, lines: 0, points: 0 },
    });
    const conditions = {
      hiddenShadowOn: {
        renderMedian: { calls: 100, triangles: 100_000, lines: 2, points: 3 },
      },
      visibleShadowOn: {
        renderMedian: { calls: 110, triangles: 115_844, lines: 2, points: 3 },
      },
      hiddenShadowOff: {
        renderMedian: { calls: 80, triangles: 70_000, lines: 2, points: 3 },
      },
      visibleShadowOff: {
        renderMedian: { calls: 86, triangles: 78_226, lines: 2, points: 3 },
      },
    };
    const valid = deriveArmouryPerformanceDeltas(conditions) as PerfDeltas;
    expect(valid).toEqual({
      armouryWithoutShadows: {
        calls: 6,
        triangles: 8_226,
        lines: 0,
        points: 0,
      },
      armouryWithShadows: { calls: 10, triangles: 15_844, lines: 0, points: 0 },
      shadowPassAttribution: {
        calls: 4,
        triangles: 7_618,
        lines: 0,
        points: 0,
      },
    });
    expect(() => assertArmouryPerformanceContract(valid)).not.toThrow();

    for (const group of Object.keys(valid) as Array<keyof PerfDeltas>) {
      for (const key of Object.keys(valid[group]) as Array<keyof PerfCounts>) {
        const changed = structuredClone(valid);
        changed[group][key] += 1;
        expect(() => assertArmouryPerformanceContract(changed), `${group}.${key}`).toThrow(
          `${group}.${key}`,
        );
      }
    }
    expect(() => assertArmouryPerformanceContract(null)).toThrow(
      'performance deltas are unavailable',
    );
  });

  it('keeps median reduction stable across sample order and fails closed on invalid evidence', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1])).toBe(2.5);
    expect(() => median([])).toThrow('only finite numeric samples');
    expect(() => median([1, Number.NaN])).toThrow('only finite numeric samples');
    expect(() => median([Number.POSITIVE_INFINITY])).toThrow('only finite numeric samples');
    expect(round(1.236)).toBe(1.24);
    expect(() => round(Number.NaN)).toThrow('must be finite');
  });

  it('summarizes warmed CPU and rAF evidence without presenting it as GPU timing', () => {
    const summary = summarizePerformanceEvidence({
      samples: [
        {
          calls: 10,
          shadowDraws: 2,
          triangles: 1_000,
          lines: 0,
          points: 0,
          cpuSubmitMs: 1,
          rendererWorldMs: 2,
          geometries: 20,
          textures: 5,
          programs: 3,
          heapUsedMb: 100,
          contextLost: 0,
        },
        {
          calls: 12,
          shadowDraws: 4,
          triangles: 1_400,
          lines: 1,
          points: 2,
          cpuSubmitMs: 3,
          rendererWorldMs: 4,
          geometries: 22,
          textures: 7,
          programs: 5,
          heapUsedMb: 120,
          contextLost: 0,
        },
        {
          calls: 11,
          shadowDraws: 3,
          triangles: 1_200,
          lines: 0,
          points: 1,
          cpuSubmitMs: 2,
          rendererWorldMs: 3,
          geometries: 21,
          textures: 6,
          programs: 4,
          heapUsedMb: 110,
          contextLost: 0,
        },
      ],
      rafDeltasMs: [10, 20, 60],
      report: {
        browser: { longTasks: { count: 2, p95: 55, max: 81 } },
        input: { intentToVisible: { count: 0, p95: 0 } },
        renderer: { contextLost: 0, contextRestored: 0 },
      },
      assetFailures: [],
    });
    expect(summary).toEqual({
      timingBasis: 'CPU and requestAnimationFrame timing only; GPU timing was not measured',
      renderMedian: {
        calls: 11,
        shadowDraws: 3,
        triangles: 1_200,
        lines: 0,
        points: 1,
        cpuSubmitMs: 2,
      },
      renderWorst: {
        calls: 12,
        shadowDraws: 4,
        triangles: 1_400,
        lines: 1,
        points: 2,
        cpuSubmitMs: 3,
      },
      resourcesMedian: {
        geometries: 21,
        textures: 6,
        programs: 4,
        heapUsedMb: 110,
      },
      resourcesWorst: {
        geometries: 22,
        textures: 7,
        programs: 5,
        heapUsedMb: 120,
      },
      rafFrameInterval: {
        samples: 3,
        meanMs: 30,
        p95Ms: 60,
        p99Ms: 60,
        maxMs: 60,
        long50: 1,
      },
      longTasks: { count: 2, p95Ms: 55, maxMs: 81 },
      rendererCpu: { worldP95Ms: 4, submitP95Ms: 3 },
      inputToVisibleP95Ms: null,
      context: { lost: 0, restored: 0 },
      assetFailures: [],
    });

    const observedInput = summarizePerformanceEvidence({
      samples: [
        {
          calls: 1,
          shadowDraws: 0,
          triangles: 1,
          lines: 0,
          points: 0,
          cpuSubmitMs: 1,
          rendererWorldMs: 1,
          geometries: 1,
          textures: 1,
          programs: 1,
          heapUsedMb: 1,
          contextLost: 0,
        },
      ],
      rafDeltasMs: [16],
      report: {
        browser: { longTasks: { count: 0, p95: 0, max: 0 } },
        input: { intentToVisible: { count: 2, p95: 7.5 } },
        renderer: { contextLost: 0, contextRestored: 1 },
      },
      assetFailures: ['eastbrook_bank.glb'],
    });
    expect(observedInput.inputToVisibleP95Ms).toBe(7.5);
    expect(observedInput.assetFailures).toEqual(['eastbrook_bank.glb']);
    expect(() =>
      summarizePerformanceEvidence({
        samples: [],
        rafDeltasMs: [],
        report: {},
        assetFailures: [],
      }),
    ).toThrow('performance samples');
  });

  it('wires every pure check into the executable capture coordinator', () => {
    const source = readFileSync(
      new URL('../scripts/assets/eastbrook_grand_armoury/capture_ingame.mjs', import.meta.url),
      'utf8',
    );
    for (const call of [
      'selectCaptureConfiguration(process.env)',
      'expectedCaptureEnvironmentError(text)',
      'expectedCaptureProxyResponse(response.url(), response.status())',
      'expectedCaptureProxyConsoleSource(text, sourceUrl)',
      'assertMatchedLotIdentity(sceneState.lot, expectedArmoury)',
      'assertNoCaptureErrors(pageErrors, consoleErrors)',
      'assertCaptureRenderState({',
      'assertPerformanceBlockState({',
      'assertPerformanceStateRestored({',
      'deriveArmouryPerformanceDeltas(conditions)',
      'assertArmouryPerformanceContract(deltas)',
      'directRenderAttribution = await measureDirectRenderAttribution(page)',
      'assertTownArmouryIdentity(sceneState.lot, expectedTown)',
      'assertTownCaptureMetadata({',
      'assertTownPerformanceBlockState({',
      'assertTownBaselinePerformanceBlockState({',
      'deriveTownPerformanceDeltas(conditions)',
      'summarizePerformanceEvidence({',
      "game.perf.markInputIntent('look', performance.now())",
      'inputProbe < 5',
      "if (enablePerf) localStorage.setItem('woc_perf', '1')",
      'captureConfig.perfScenarios',
      'installTownCaptureOverlay(page',
      'colliderInternalsForTest.staticWorldColliders',
      'removeTownCaptureOverlay(page)',
      'writeCaptureMetadata(',
      "captureScope === 'town' && !MEASURE_PERF",
      'townPerformanceOutputPath(',
      'root.visible = requestedRootVisible',
      "'eastbrookTownRebuild'",
      'const texture = material.map',
      "'--enable-precise-memory-info'",
    ]) {
      expect(source).toContain(call);
    }
    expect(source).toMatch(
      /expectedCaptureProxyConsoleError\(text\)\s*&&\s*pendingProxyFailures\.length > 0/,
    );
    expect(source).not.toContain('[material.map, material.roughnessMap]');
    expect(source).toMatch(/closePromise\.then\(\s*\(\) => true,\s*\(\) => false,?\s*\)/);
    expect(source).not.toMatch(/viewportMeta\.setAttribute|name=['"]viewport['"][^\n]*content\s*=/);
  });
});
