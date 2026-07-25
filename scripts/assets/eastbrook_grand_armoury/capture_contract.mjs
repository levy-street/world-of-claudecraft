// Pure integrity checks shared by the reproducible in-game capture helper and
// its regression tests. Keep browser orchestration in capture_ingame.mjs.

import { createHash } from 'node:crypto';

export const EASTBROOK_ARMOURY_CAPTURE_SEED = 20_061;
// Collision-free on the town plateau and outside both the release inn's
// legacy two-yard rest padding and the replacement garrison's narrow halo.
export const EASTBROOK_ARMOURY_PLAYER_STATE = Object.freeze({
  x: 8,
  y: 1.5,
  z: 2,
  facing: Math.PI / 2,
});

export const EASTBROOK_TOWN_ROOT_NAME = 'eastbrookTownRebuild';
export const EASTBROOK_TOWN_SURFACE_ATLAS_URL = '/textures/eastbrook_surface_atlas.webp';
export const EASTBROOK_TOWN_CAPTURE_SETTLE_MS = 1_400;
export const EASTBROOK_TOWN_CAPTURE_TIMING = Object.freeze({
  bootSettleMs: 2_000,
  viewSettleMs: EASTBROOK_TOWN_CAPTURE_SETTLE_MS,
  perfWarmupMs: 800,
  perfSampleMs: 2_400,
  perfRepeats: 2,
});

export const EASTBROOK_TOWN_NEW_ASSET_URLS = Object.freeze([
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

export const EASTBROOK_TOWN_LEGACY_PLACEMENT_INVENTORY = Object.freeze({
  buildings: Object.freeze([
    'legacy_eastbrook_house_northeast',
    'legacy_eastbrook_house_northwest',
    'legacy_eastbrook_chapel',
  ]),
  wells: Object.freeze(['legacy_eastbrook_well']),
  stalls: Object.freeze([
    'legacy_eastbrook_provisioner_stall',
    'legacy_eastbrook_smithy_stall',
    'legacy_eastbrook_world_market_stall',
  ]),
  campfires: Object.freeze(['legacy_eastbrook_town_fire']),
  fences: Object.freeze(['legacy_eastbrook_fence_east', 'legacy_eastbrook_fence_west']),
  artisanRow: Object.freeze([
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
  ]),
  benches: Object.freeze([]),
  walls: Object.freeze([]),
  gates: Object.freeze([]),
});

export const EASTBROOK_TOWN_REBUILD_PLACEMENT_INVENTORY = Object.freeze({
  buildings: Object.freeze([
    'eastbrook_bank',
    'eastbrook_smithy',
    'eastbrook_inn',
    'eastbrook_chapel',
    'eastbrook_weaving_workshop',
    'eastbrook_toolworks',
  ]),
  wells: Object.freeze(['eastbrook_civic_well_beacon']),
  stalls: Object.freeze([
    'eastbrook_market_stall_world_market',
    'eastbrook_market_stall_provisions',
    'eastbrook_market_stall_artisans',
  ]),
  campfires: Object.freeze([]),
  fences: Object.freeze([
    'eastbrook_fence_smithy_west',
    'eastbrook_fence_smithy_outer',
    'eastbrook_fence_smithy_east',
    'eastbrook_fence_market_outer',
  ]),
  artisanRow: Object.freeze([]),
  benches: Object.freeze([
    'eastbrook_civic_bench_north',
    'eastbrook_civic_bench_south',
    'eastbrook_civic_bench_west',
  ]),
  walls: Object.freeze(
    Array.from({ length: 26 }, (_, index) => `eastbrook_wall_${String(index).padStart(2, '0')}`),
  ),
  gates: Object.freeze([
    'eastbrook_gate_east',
    'eastbrook_gate_northeast',
    'eastbrook_gate_north',
    'eastbrook_gate_northwest',
    'eastbrook_gate_southwest',
    'eastbrook_gate_bandit',
  ]),
});

export const EASTBROOK_TOWN_POLISH_V2_PLACEMENT_INVENTORY = Object.freeze({
  ...EASTBROOK_TOWN_REBUILD_PLACEMENT_INVENTORY,
  stalls: Object.freeze([
    'eastbrook_market_stall_world_market',
    'eastbrook_market_stall_provisions',
  ]),
});

const EASTBROOK_TOWN_HISTORICAL_TRIANGLES = 29_644;
const EASTBROOK_TOWN_POLISH_V2_TRIANGLES = 28_330;

const EMPTY_TOWN_PLACEMENT_INVENTORY = Object.freeze(
  Object.fromEntries(
    Object.keys(EASTBROOK_TOWN_REBUILD_PLACEMENT_INVENTORY).map((key) => [key, Object.freeze([])]),
  ),
);

export function expectedTownPlacementInventory(expectedTown, contractId = null) {
  if (typeof expectedTown !== 'boolean') {
    throw new Error('expectedTown must be a boolean');
  }
  const rebuildInventory = contractId
    ? townCaptureContract(contractId).placementInventory
    : EASTBROOK_TOWN_REBUILD_PLACEMENT_INVENTORY;
  return expectedTown
    ? Object.freeze({
        legacy: EMPTY_TOWN_PLACEMENT_INVENTORY,
        rebuild: rebuildInventory,
      })
    : Object.freeze({
        legacy: EASTBROOK_TOWN_LEGACY_PLACEMENT_INVENTORY,
        rebuild: EMPTY_TOWN_PLACEMENT_INVENTORY,
      });
}

export const EASTBROOK_ARMOURY_CAPTURE_PROFILES = Object.freeze([
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
    viewport: Object.freeze({
      width: 844,
      height: 390,
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
    }),
    mobile: true,
  }),
]);

// Town evidence keeps the accepted Armoury profiles untouched while exercising
// the requested native-density mobile viewport. The CSS viewport remains
// 844x390; screenshots are written at 2532x1170 physical pixels.
export const EASTBROOK_TOWN_CAPTURE_PROFILES = Object.freeze([
  EASTBROOK_ARMOURY_CAPTURE_PROFILES[0],
  Object.freeze({
    ...EASTBROOK_ARMOURY_CAPTURE_PROFILES[1],
    viewport: Object.freeze({
      width: 844,
      height: 390,
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    }),
  }),
]);

// Every target lies immediately outside its relevant collider face. This
// preserves matched cameras while keeping the normal camera ghosting active.
export const EASTBROOK_ARMOURY_CAPTURE_VIEWS = Object.freeze([
  Object.freeze({
    name: 'wide',
    camera: Object.freeze({ x: -1, y: 14, z: -23.5 }),
    target: Object.freeze({ x: 12.9, y: 5.8, z: -10 }),
  }),
  Object.freeze({
    name: 'close',
    camera: Object.freeze({ x: 2.2, y: 7.8, z: -5.5 }),
    target: Object.freeze({ x: 7, y: 6.32, z: -5.5 }),
  }),
  Object.freeze({
    name: 'side-rear',
    camera: Object.freeze({ x: 36, y: 14, z: 13 }),
    target: Object.freeze({ x: 22.4, y: 6, z: 0.13 }),
  }),
]);

// A distinct set keeps the twelve accepted Armoury screenshots and their
// default helper behavior stable. Every target is collision-clear at seed
// 20061 and keeps the preserved Armoury in frame as the scale/hierarchy anchor.
export const EASTBROOK_TOWN_CAPTURE_VIEWS = Object.freeze([
  Object.freeze({
    name: 'elevated-overview',
    camera: Object.freeze({ x: -31, y: 28, z: -36 }),
    target: Object.freeze({ x: 0, y: 2.5, z: -1.5 }),
  }),
  Object.freeze({
    name: 'planning-top-down',
    camera: Object.freeze({ x: 0, y: 54, z: -0.5 }),
    target: Object.freeze({ x: 0, y: 0, z: -1.5 }),
  }),
  Object.freeze({
    name: 'gate-approach',
    camera: Object.freeze({ x: -32, y: 7, z: -32 }),
    target: Object.freeze({ x: 0, y: 3, z: -1.5 }),
  }),
  Object.freeze({
    name: 'central-square',
    camera: Object.freeze({ x: -20, y: 8, z: -18 }),
    target: Object.freeze({ x: 0, y: 2.5, z: 5.5 }),
  }),
  Object.freeze({
    name: 'armoury-facade',
    camera: Object.freeze({ x: 2.2, y: 7.8, z: -5.5 }),
    target: Object.freeze({ x: 7, y: 6.32, z: -5.5 }),
  }),
  Object.freeze({
    name: 'armoury-relation',
    camera: Object.freeze({ x: 34, y: 15, z: 25 }),
    target: Object.freeze({ x: 10, y: 4, z: -2 }),
  }),
  Object.freeze({
    name: 'bank-and-chest',
    camera: Object.freeze({ x: 30, y: 8, z: 22 }),
    target: Object.freeze({ x: 14.156943251329539, y: 3.2, z: 8.685223202016726 }),
  }),
  Object.freeze({
    name: 'smithy-and-forge',
    camera: Object.freeze({ x: 16, y: 9, z: 31 }),
    target: Object.freeze({ x: 3.3817510253835374, y: 3, z: 14.399753759739639 }),
  }),
  Object.freeze({
    name: 'inn-and-kitchens',
    camera: Object.freeze({ x: -29, y: 9, z: 29 }),
    // Keep the kitchens in frame without placing the matched camera target
    // inside either the PR #2356 northwest-house collider or the rebuild Inn.
    target: Object.freeze({ x: -5, y: 3, z: 9 }),
  }),
  Object.freeze({
    name: 'market-and-fence',
    camera: Object.freeze({ x: -24, y: 9, z: 24 }),
    target: Object.freeze({ x: -2.87967661431468, y: 3, z: 6.20921163603936 }),
  }),
  Object.freeze({
    name: 'chapel-and-weaving',
    camera: Object.freeze({ x: -32, y: 11, z: -27 }),
    target: Object.freeze({ x: -9, y: 3, z: -7 }),
  }),
  Object.freeze({
    name: 'toolworks-service-perimeter',
    camera: Object.freeze({ x: 21, y: 9, z: -31 }),
    target: Object.freeze({ x: 4.457282212971036, y: 3, z: -13.397884008445395 }),
  }),
  Object.freeze({
    name: 'player-scale',
    camera: Object.freeze({ x: 2, y: 4.5, z: 9 }),
    target: Object.freeze({ x: 12.5, y: 3.8, z: -4 }),
  }),
  Object.freeze({
    name: 'interaction-collider-overlay',
    camera: Object.freeze({ x: -36, y: 30, z: 34 }),
    target: Object.freeze({ x: 0, y: 1.5, z: -1.5 }),
  }),
  Object.freeze({
    name: 'side-rear-proof',
    camera: Object.freeze({ x: 38, y: 16, z: 18 }),
    // Aim just outside the Armoury's camera-side corner. The building remains
    // centered beyond the target without activating normal roof ghosting.
    target: Object.freeze({ x: 23, y: 4, z: 2 }),
  }),
]);

export const EASTBROOK_TOWN_PERF_SCENARIOS = Object.freeze([
  Object.freeze({ name: 'main-gate', viewName: 'gate-approach' }),
  Object.freeze({ name: 'elevated', viewName: 'elevated-overview' }),
  Object.freeze({ name: 'central', viewName: 'central-square' }),
  Object.freeze({ name: 'armoury-facing', viewName: 'armoury-relation' }),
]);

// The accepted rebuild evidence above is immutable. Polish evidence opts into
// these additional views instead of replacing or renaming any of the original
// fifteen view contracts.
export const EASTBROOK_TOWN_POLISH_CAPTURE_VIEWS = Object.freeze([
  Object.freeze({
    name: 'stall-world-market',
    subject: 'eastbrook_market_stall_world_market',
    camera: Object.freeze({ x: -2.54, y: 6, z: 5.47 }),
    target: Object.freeze({ x: -4.55381837226296, y: 2.5, z: 8.20975183498178 }),
  }),
  Object.freeze({
    name: 'stall-provisions',
    subject: 'eastbrook_market_stall_provisions',
    camera: Object.freeze({ x: -3, y: 6, z: 0 }),
    target: Object.freeze({ x: -7.421769629642221, y: 2.5, z: 0.7630378263298812 }),
  }),
  Object.freeze({
    name: 'apothecary-lin',
    subject: 'apothecary_lin',
    camera: Object.freeze({ x: 1.8, y: 6, z: 6 }),
    target: Object.freeze({ x: 2.8431593444121797, y: 2.5, z: 9.717148252611294 }),
  }),
  Object.freeze({
    name: 'ravenpost-mailbox',
    subject: 'mailbox_eastbrook',
    camera: Object.freeze({ x: 0, y: 5, z: -2 }),
    target: Object.freeze({ x: 0, y: 2, z: -6.2 }),
  }),
  Object.freeze({
    name: 'noticeboard',
    subject: 'eastbrook_noticeboard',
    camera: Object.freeze({ x: 5, y: 6, z: -4 }),
    target: Object.freeze({ x: 9.010050506338834, y: 2.2, z: -7.010050506338834 }),
  }),
  Object.freeze({
    name: 'civic-motion',
    subject: 'eastbrook_civic_well_beacon',
    camera: Object.freeze({ x: -10, y: 6, z: -7 }),
    target: Object.freeze({ x: -0.75, y: 2.8, z: 0 }),
  }),
  Object.freeze({
    name: 'ravenpost-chronicler',
    subject: 'chronicler_saul',
    camera: Object.freeze({ x: -10, y: 6.5, z: -11 }),
    target: Object.freeze({ x: 0, y: 2.5, z: -14.5 }),
  }),
  Object.freeze({
    name: 'west-wall-quartermaster',
    subject: 'fury',
    camera: Object.freeze({ x: -16, y: 6, z: -3 }),
    target: Object.freeze({ x: -22.5, y: 2.5, z: -7.5 }),
  }),
]);

// The historical rebuild-v1 camera list remains immutable. Matched polish
// before/after evidence shares this derived list so outward service moves can
// be framed from their public faces without invalidating accepted PR #2356
// evidence. The matching baseline deliberately uses these same cameras.
export const EASTBROOK_TOWN_POLISH_MATCHED_VIEW_OVERRIDES = Object.freeze({
  'bank-and-chest': Object.freeze({
    camera: Object.freeze({ x: 5, y: 7, z: 2 }),
    target: Object.freeze({ x: 14.156943251329539, y: 3.2, z: 8.685223202016726 }),
  }),
  'smithy-and-forge': Object.freeze({
    camera: Object.freeze({ x: 10, y: 7, z: 8 }),
    target: Object.freeze({ x: 3.687633548766497, y: 3, z: 15.598153967032626 }),
  }),
  'inn-and-kitchens': Object.freeze({
    camera: Object.freeze({ x: 0, y: 8, z: 8 }),
    target: Object.freeze({ x: -10.018829436136041, y: 3, z: 13.621842145917809 }),
  }),
  'chapel-and-weaving': Object.freeze({
    camera: Object.freeze({ x: 0, y: 12, z: 4 }),
    target: Object.freeze({ x: -13.2, y: 3, z: -10.5 }),
  }),
  'toolworks-service-perimeter': Object.freeze({
    camera: Object.freeze({ x: 4, y: 7, z: -9 }),
    target: Object.freeze({ x: 5, y: 5, z: -14.25 }),
  }),
  'stall-world-market': Object.freeze({
    camera: Object.freeze({ x: -6, y: 6, z: 0 }),
    target: Object.freeze({ x: -5.75, y: 2.5, z: 7 }),
  }),
});

export const EASTBROOK_TOWN_POLISH_MATCHED_CAPTURE_VIEWS = Object.freeze([
  ...EASTBROOK_TOWN_CAPTURE_VIEWS.map((view) => {
    const override = EASTBROOK_TOWN_POLISH_MATCHED_VIEW_OVERRIDES[view.name];
    return override ? Object.freeze({ ...view, ...override }) : view;
  }),
  ...EASTBROOK_TOWN_POLISH_CAPTURE_VIEWS.map((view) => {
    const override = EASTBROOK_TOWN_POLISH_MATCHED_VIEW_OVERRIDES[view.name];
    return override ? Object.freeze({ ...view, ...override }) : view;
  }),
]);

export const EASTBROOK_TOWN_MOTION_CAPTURE = Object.freeze({
  viewName: 'civic-motion',
  frameIntervalMs: 1_600,
  beacon: Object.freeze({
    rootName: EASTBROOK_TOWN_ROOT_NAME,
    batchName: 'eastbrookTownMicroEmissiveBatch',
    maskAttribute: 'eastbrookCivicMask',
    programCacheKey: 'eastbrook-civic-beacon-v1',
  }),
  modes: Object.freeze([
    Object.freeze({ id: 'motion-on', reduceMotion: false }),
    Object.freeze({ id: 'reduced-motion', reduceMotion: true }),
  ]),
});

const MAILBOX_ASSET_URL = '/models/props/mailbox_pillar.glb';
const NOTICEBOARD_ASSET_URL = '/models/props/eastbrook_noticeboard.glb';
export const EASTBROOK_POLISH_BASELINE_REVISION = '3ab740db453bd8b5858a52c304edc811c9d520ca';
export const EASTBROOK_POLISH_PROVENANCE_INPUTS = Object.freeze({
  townAssetSourceFingerprint: 'scripts/assets/eastbrook_town/source_fingerprint.mjs',
  authoritativeLayout: 'src/sim/eastbrook_layout.ts',
  civicShader: 'src/render/eastbrook_civic_beacon.ts',
  townRuntime: 'src/render/eastbrook_town.ts',
  mailboxRuntime: 'src/render/mailbox.ts',
  noticeboardRuntime: 'src/render/noticeboard.ts',
  rendererIntegration: 'src/render/renderer.ts',
  viewPriorityPolicy: 'src/render/prewarm_policy.ts',
  mailboxSourceFingerprint: 'scripts/assets/eastbrook_mailbox/source_fingerprint.mjs',
  mailboxGlb: 'public/models/props/mailbox_pillar.glb',
  noticeboardSourceFingerprint: 'scripts/assets/eastbrook_noticeboard/source_fingerprint.mjs',
  noticeboardGlb: 'public/models/props/eastbrook_noticeboard.glb',
  captureContract: 'polish-v2',
});
const POLISH_BASELINE_PROVENANCE_CONTRACT = Object.freeze({
  mode: 'baseline-revision',
  baselineRevision: EASTBROOK_POLISH_BASELINE_REVISION,
});
const POLISH_V2_PROVENANCE_CONTRACT = Object.freeze({
  mode: 'composite-sha256',
  algorithm: 'sha256',
  baselineRevision: EASTBROOK_POLISH_BASELINE_REVISION,
  inputs: EASTBROOK_POLISH_PROVENANCE_INPUTS,
});
const TOWN_ROOT_ATTRIBUTION_TARGET = Object.freeze({
  key: 'town-root',
  kind: 'scene-root',
  rootName: EASTBROOK_TOWN_ROOT_NAME,
});
const MAILBOX_ATTRIBUTION_TARGET = Object.freeze({
  key: 'mailbox',
  kind: 'layout-entity',
  layoutServiceKey: 'mailbox',
  layoutServiceId: 'mailbox_eastbrook',
  templateId: 'mailbox',
  runtimeBodyName: null,
});
const NOTICEBOARD_ATTRIBUTION_TARGET = Object.freeze({
  key: 'noticeboard',
  kind: 'layout-entity',
  layoutServiceKey: 'noticeboard',
  layoutServiceId: 'eastbrook_noticeboard',
  templateId: 'noticeboard_eastbrook',
  runtimeBodyName: 'eastbrookNoticeboard',
});

export const EASTBROOK_TOWN_CAPTURE_CONTRACTS = Object.freeze({
  'rebuild-v1': Object.freeze({
    id: 'rebuild-v1',
    layoutId: 'eastbrook_civic_layout_v1',
    sourceComparison: 'feature-worktree',
    views: EASTBROOK_TOWN_CAPTURE_VIEWS,
    placementInventory: EASTBROOK_TOWN_REBUILD_PLACEMENT_INVENTORY,
    townTriangles: EASTBROOK_TOWN_HISTORICAL_TRIANGLES,
    assetUrls: Object.freeze([...EASTBROOK_TOWN_NEW_ASSET_URLS, MAILBOX_ASSET_URL]),
    attributionTargets: Object.freeze([TOWN_ROOT_ATTRIBUTION_TARGET, MAILBOX_ATTRIBUTION_TARGET]),
    overlayRecordCounts: Object.freeze({ obbs: 43, circles: 1, points: 30, gates: 6 }),
    motionCapture: null,
  }),
  'polish-baseline': Object.freeze({
    id: 'polish-baseline',
    layoutId: 'eastbrook_civic_layout_v1',
    sourceComparison: 'polish-baseline-worktree',
    views: EASTBROOK_TOWN_POLISH_MATCHED_CAPTURE_VIEWS,
    placementInventory: EASTBROOK_TOWN_REBUILD_PLACEMENT_INVENTORY,
    townTriangles: EASTBROOK_TOWN_HISTORICAL_TRIANGLES,
    assetUrls: Object.freeze([...EASTBROOK_TOWN_NEW_ASSET_URLS, MAILBOX_ASSET_URL]),
    attributionTargets: Object.freeze([TOWN_ROOT_ATTRIBUTION_TARGET, MAILBOX_ATTRIBUTION_TARGET]),
    overlayRecordCounts: Object.freeze({ obbs: 43, circles: 1, points: 30, gates: 6 }),
    motionCapture: null,
    polishProvenance: POLISH_BASELINE_PROVENANCE_CONTRACT,
  }),
  'polish-v2': Object.freeze({
    id: 'polish-v2',
    layoutId: 'eastbrook_civic_layout_v2',
    sourceComparison: 'polish-v2-worktree',
    views: EASTBROOK_TOWN_POLISH_MATCHED_CAPTURE_VIEWS,
    placementInventory: EASTBROOK_TOWN_POLISH_V2_PLACEMENT_INVENTORY,
    townTriangles: EASTBROOK_TOWN_POLISH_V2_TRIANGLES,
    assetUrls: Object.freeze([
      ...EASTBROOK_TOWN_NEW_ASSET_URLS,
      MAILBOX_ASSET_URL,
      NOTICEBOARD_ASSET_URL,
    ]),
    attributionTargets: Object.freeze([
      TOWN_ROOT_ATTRIBUTION_TARGET,
      Object.freeze({
        ...MAILBOX_ATTRIBUTION_TARGET,
        runtimeBodyName: 'ravenpostMailbox',
      }),
      NOTICEBOARD_ATTRIBUTION_TARGET,
    ]),
    overlayRecordCounts: Object.freeze({ obbs: 43, circles: 1, points: 32, gates: 6 }),
    motionCapture: EASTBROOK_TOWN_MOTION_CAPTURE,
    polishProvenance: POLISH_V2_PROVENANCE_CONTRACT,
  }),
});

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function canonicalSha256(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function assertSha256(value, label) {
  if (!/^[a-f0-9]{64}$/i.test(value ?? '')) throw new Error(`${label} must be a SHA-256 digest`);
}

export function deriveEastbrookPolishCompositeProvenance({
  townAssetSourceFingerprint,
  authoritativeLayoutSha256,
  civicShaderSha256,
  townRuntimeSha256,
  mailboxRuntimeSha256,
  noticeboardRuntimeSha256,
  rendererIntegrationSha256,
  viewPriorityPolicySha256,
  mailboxSourceFingerprint,
  mailboxGlbSha256,
  noticeboardSourceFingerprint,
  noticeboardGlbSha256,
}) {
  const digests = {
    townAssetSourceFingerprint,
    authoritativeLayoutSha256,
    civicShaderSha256,
    townRuntimeSha256,
    mailboxRuntimeSha256,
    noticeboardRuntimeSha256,
    rendererIntegrationSha256,
    viewPriorityPolicySha256,
    mailboxSourceFingerprint,
    mailboxGlbSha256,
    noticeboardSourceFingerprint,
    noticeboardGlbSha256,
  };
  for (const [label, digest] of Object.entries(digests)) assertSha256(digest, label);
  const captureContractSha256 = canonicalSha256(EASTBROOK_TOWN_CAPTURE_CONTRACTS['polish-v2']);
  const components = {
    townAsset: {
      source: EASTBROOK_POLISH_PROVENANCE_INPUTS.townAssetSourceFingerprint,
      sourceFingerprint: townAssetSourceFingerprint,
    },
    authoritativeLayout: {
      path: EASTBROOK_POLISH_PROVENANCE_INPUTS.authoritativeLayout,
      sha256: authoritativeLayoutSha256,
    },
    civicShader: {
      path: EASTBROOK_POLISH_PROVENANCE_INPUTS.civicShader,
      sha256: civicShaderSha256,
    },
    runtimeRender: {
      town: {
        path: EASTBROOK_POLISH_PROVENANCE_INPUTS.townRuntime,
        sha256: townRuntimeSha256,
      },
      mailbox: {
        path: EASTBROOK_POLISH_PROVENANCE_INPUTS.mailboxRuntime,
        sha256: mailboxRuntimeSha256,
      },
      noticeboard: {
        path: EASTBROOK_POLISH_PROVENANCE_INPUTS.noticeboardRuntime,
        sha256: noticeboardRuntimeSha256,
      },
      renderer: {
        path: EASTBROOK_POLISH_PROVENANCE_INPUTS.rendererIntegration,
        sha256: rendererIntegrationSha256,
      },
      viewPriorityPolicy: {
        path: EASTBROOK_POLISH_PROVENANCE_INPUTS.viewPriorityPolicy,
        sha256: viewPriorityPolicySha256,
      },
    },
    mailbox: {
      source: EASTBROOK_POLISH_PROVENANCE_INPUTS.mailboxSourceFingerprint,
      sourceFingerprint: mailboxSourceFingerprint,
      glb: {
        path: EASTBROOK_POLISH_PROVENANCE_INPUTS.mailboxGlb,
        sha256: mailboxGlbSha256,
      },
    },
    noticeboard: {
      source: EASTBROOK_POLISH_PROVENANCE_INPUTS.noticeboardSourceFingerprint,
      sourceFingerprint: noticeboardSourceFingerprint,
      glb: {
        path: EASTBROOK_POLISH_PROVENANCE_INPUTS.noticeboardGlb,
        sha256: noticeboardGlbSha256,
      },
    },
    captureContract: {
      id: EASTBROOK_POLISH_PROVENANCE_INPUTS.captureContract,
      sha256: captureContractSha256,
    },
  };
  return {
    schemaVersion: 1,
    mode: 'composite-sha256',
    algorithm: 'sha256',
    baselineRevision: EASTBROOK_POLISH_BASELINE_REVISION,
    fingerprint: canonicalSha256({ algorithm: 'sha256', components }),
    components,
  };
}

function townCaptureContract(contractId) {
  const contract = EASTBROOK_TOWN_CAPTURE_CONTRACTS[contractId];
  if (!contract) throw new Error(`unknown Eastbrook town capture contract: ${contractId}`);
  return contract;
}

function finiteVector2(value) {
  return Number.isFinite(value?.x) && Number.isFinite(value?.z);
}

export function assertTownAttributionTargetState({ targets, contractId, requestedVisible }) {
  const contract = townCaptureContract(contractId);
  if (!Array.isArray(targets) || targets.length !== contract.attributionTargets.length) {
    throw new Error(`${contractId}: attribution target inventory is incomplete`);
  }
  const atlasTextureUuids = new Set();
  for (const [index, expected] of contract.attributionTargets.entries()) {
    const target = targets[index];
    if (Object.hasOwn(target ?? {}, 'entityId')) {
      throw new Error(`${contractId}: attribution metadata must not expose transient entity ids`);
    }
    const expectedRootName =
      expected.kind === 'scene-root'
        ? expected.rootName
        : (expected.runtimeBodyName ?? `layout-entity:${expected.key}`);
    if (
      target?.key !== expected.key ||
      target.kind !== expected.kind ||
      target.rootName !== expectedRootName ||
      target.layoutId !== contract.layoutId ||
      (target.templateId ?? null) !== (expected.templateId ?? null) ||
      (target.layoutServiceId ?? null) !== (expected.layoutServiceId ?? null)
    ) {
      throw new Error(
        `${contractId}: attribution target inventory does not match stable layout ids`,
      );
    }
    if (target.present !== true || target.visible !== requestedVisible) {
      throw new Error(
        `${contractId}: attribution target ${expected.key} visibility is incorrect ` +
          `(present=${String(target?.present)}, visible=${String(target?.visible)}, ` +
          `requested=${String(requestedVisible)}, childMeshes=${String(target?.childMeshCount)})`,
      );
    }
    if (!Number.isInteger(target.childMeshCount) || target.childMeshCount <= 0) {
      throw new Error(`${contractId}: attribution target ${expected.key} has no shipping meshes`);
    }
    if (contractId === 'polish-v2') {
      const atlas = target.surfaceAtlas;
      if (
        atlas?.url !== EASTBROOK_TOWN_SURFACE_ATLAS_URL ||
        typeof atlas.textureUuid !== 'string' ||
        atlas.textureUuid.length === 0 ||
        !Number.isInteger(atlas.materialBindings) ||
        atlas.materialBindings < 1
      ) {
        throw new Error(`${contractId}: attribution target ${expected.key} lacks the shared atlas`);
      }
      atlasTextureUuids.add(atlas.textureUuid);
    }
  }
  if (contractId === 'polish-v2' && atlasTextureUuids.size !== 1) {
    throw new Error(`${contractId}: standalone roots do not share one atlas texture identity`);
  }
}

export function assertTownNpcFacingOverlay({ overlay, contractId }) {
  const contract = townCaptureContract(contractId);
  if (overlay?.requested !== true) {
    throw new Error(`${contractId}: NPC-facing arrows require the requested collider overlay`);
  }
  const facing = overlay.npcFacings;
  if (
    facing?.sourceLayoutId !== contract.layoutId ||
    !Number.isFinite(facing.arrowLength) ||
    facing.arrowLength <= 0 ||
    !Array.isArray(facing.records) ||
    facing.records.length === 0
  ) {
    throw new Error(`${contractId}: NPC-facing arrow inventory is incomplete`);
  }
  const ids = new Set();
  for (const record of facing.records) {
    if (Object.hasOwn(record ?? {}, 'entityId')) {
      throw new Error(`${contractId}: facing metadata must not expose transient entity ids`);
    }
    if (
      typeof record?.id !== 'string' ||
      record.id.length === 0 ||
      ids.has(record.id) ||
      !finiteVector2(record.position) ||
      !finiteVector2(record.end) ||
      !Number.isFinite(record.facing)
    ) {
      throw new Error(`${contractId}: NPC-facing arrow inventory contains invalid records`);
    }
    ids.add(record.id);
    const expectedEnd = {
      x: record.position.x + Math.sin(record.facing) * facing.arrowLength,
      z: record.position.z + Math.cos(record.facing) * facing.arrowLength,
    };
    if (
      Math.abs(record.end.x - expectedEnd.x) > 1e-6 ||
      Math.abs(record.end.z - expectedEnd.z) > 1e-6
    ) {
      throw new Error(`${contractId}: facing arrow endpoint does not match authored facing`);
    }
  }
}

export function assertTownMotionEvidence({ evidence, contractId }) {
  const contract = townCaptureContract(contractId);
  const expected = contract.motionCapture;
  if (!expected) {
    if (evidence !== null) throw new Error(`${contractId}: motion evidence must be absent`);
    return;
  }
  if (
    evidence?.viewName !== expected.viewName ||
    evidence.frameIntervalMs !== expected.frameIntervalMs ||
    JSON.stringify(evidence.beacon) !== JSON.stringify(expected.beacon) ||
    !Array.isArray(evidence.modes) ||
    evidence.modes.length !== expected.modes.length ||
    evidence.contact?.defaultRuntimeReduceMotion !== true ||
    typeof evidence.contact.defaultReducedMotionOutput !== 'string' ||
    !evidence.contact.defaultReducedMotionOutput.endsWith('.png') ||
    evidence.contact.pairedFrameCount !== expected.modes.length * 2 ||
    evidence.restored !== true
  ) {
    throw new Error(`${contractId}: civic motion evidence is incomplete`);
  }
  for (const [index, expectedMode] of expected.modes.entries()) {
    const mode = evidence.modes[index];
    if (mode?.id !== expectedMode.id || mode.runtimeReduceMotion !== expectedMode.reduceMotion) {
      throw new Error(`${contractId}: ${expectedMode.id} runtime reduce-motion state is incorrect`);
    }
    if (
      !Array.isArray(mode.frames) ||
      mode.frames.length !== 2 ||
      mode.frames[0]?.phase !== 't0' ||
      mode.frames[1]?.phase !== 't1' ||
      mode.frames.some(
        (frame) =>
          typeof frame.output !== 'string' ||
          !frame.output.endsWith('.png') ||
          !Number.isInteger(frame.bytes) ||
          frame.bytes <= 0 ||
          !/^[a-f0-9]{64}$/.test(frame.sha256 ?? ''),
      )
    ) {
      throw new Error(`${contractId}: ${expectedMode.id} paired frame evidence is incomplete`);
    }
  }
}

export function selectCaptureConfiguration(env) {
  if (!env.GAME_URL || !env.SHOT_PREFIX) {
    throw new Error('GAME_URL and SHOT_PREFIX are required');
  }
  if (!['0', '1'].includes(env.EXPECT_ARMOURY ?? '')) {
    throw new Error('EXPECT_ARMOURY must be 0 or 1');
  }
  const captureScope = env.CAPTURE_SCOPE ?? 'armoury';
  if (!['armoury', 'town'].includes(captureScope)) {
    throw new Error('CAPTURE_SCOPE must be armoury or town');
  }
  if (
    captureScope === 'town' &&
    env.EXPECT_TOWN !== undefined &&
    !['0', '1'].includes(env.EXPECT_TOWN)
  ) {
    throw new Error('EXPECT_TOWN must be 0 or 1 when provided for CAPTURE_SCOPE=town');
  }
  const expectedArmoury = env.EXPECT_ARMOURY === '1';
  const expectedTown =
    captureScope === 'town' && env.EXPECT_TOWN !== undefined ? env.EXPECT_TOWN === '1' : null;
  if (
    env.TOWN_CONTRACT !== undefined &&
    !Object.hasOwn(EASTBROOK_TOWN_CAPTURE_CONTRACTS, env.TOWN_CONTRACT)
  ) {
    throw new Error('TOWN_CONTRACT must be rebuild-v1, polish-baseline, or polish-v2');
  }
  if (env.TOWN_CONTRACT !== undefined && (captureScope !== 'town' || expectedTown !== true)) {
    throw new Error('TOWN_CONTRACT requires EXPECT_TOWN=1 with CAPTURE_SCOPE=town');
  }
  const townContractId =
    captureScope === 'town' && expectedTown === true ? (env.TOWN_CONTRACT ?? 'rebuild-v1') : null;
  const townContract = townContractId ? townCaptureContract(townContractId) : null;
  const availableProfiles =
    captureScope === 'town' ? EASTBROOK_TOWN_CAPTURE_PROFILES : EASTBROOK_ARMOURY_CAPTURE_PROFILES;
  const availableViews =
    captureScope === 'town'
      ? (townContract?.views ?? EASTBROOK_TOWN_CAPTURE_VIEWS)
      : EASTBROOK_ARMOURY_CAPTURE_VIEWS;
  const profiles = availableProfiles.filter(
    (profile) => !env.PROFILE_NAME || profile.name === env.PROFILE_NAME,
  );
  const views = availableViews.filter((view) => !env.VIEW_NAME || view.name === env.VIEW_NAME);
  if (profiles.length === 0) throw new Error(`Unknown PROFILE_NAME: ${env.PROFILE_NAME}`);
  if (views.length === 0) throw new Error(`Unknown VIEW_NAME: ${env.VIEW_NAME}`);
  if (env.MEASURE_PERF !== undefined && !['0', '1'].includes(env.MEASURE_PERF)) {
    throw new Error('MEASURE_PERF must be 0 or 1 when provided');
  }
  const measurePerf = env.MEASURE_PERF === '1';
  if (
    measurePerf &&
    captureScope === 'armoury' &&
    !profiles.some((profile) => profile.name === 'desktop-ultra')
  ) {
    throw new Error(
      'MEASURE_PERF=1 requires PROFILE_NAME=desktop-ultra or the default profile set',
    );
  }
  const perfScenarios = captureScope === 'town' ? EASTBROOK_TOWN_PERF_SCENARIOS : [];
  const perfViewName = captureScope === 'town' ? null : 'close';
  if (measurePerf && perfViewName && !views.some((view) => view.name === perfViewName)) {
    throw new Error(`MEASURE_PERF=1 requires VIEW_NAME=${perfViewName} or the default view set`);
  }
  if (measurePerf && captureScope === 'town' && env.PERF_OUT && profiles.length > 1) {
    throw new Error('PERF_OUT with town performance requires PROFILE_NAME to prevent overwrite');
  }
  if (captureScope === 'town' && env.METADATA_OUT && profiles.length > 1) {
    throw new Error('METADATA_OUT with town capture requires PROFILE_NAME to prevent overwrite');
  }
  return {
    gameUrl: env.GAME_URL.replace(/\/+$/, ''),
    shotPrefix: env.SHOT_PREFIX,
    expectedArmoury,
    expectedTown,
    townContractId,
    townContract,
    captureScope,
    measurePerf,
    perfScenarios,
    sourceRevision:
      env.SOURCE_REVISION ??
      (townContractId === 'polish-baseline'
        ? EASTBROOK_POLISH_BASELINE_REVISION
        : expectedTown === false
          ? 'pull/2356/head'
          : 'working-tree'),
    profiles,
    views,
  };
}

const RELEASE_BASE_INN_LOT = Object.freeze({
  kind: 'inn',
  x: 12,
  z: -6,
  w: 6,
  d: 7,
  rot: 2.4,
});
const FEATURE_ARMOURY_LOT = Object.freeze({
  kind: 'inn',
  landmark: 'eastbrook_grand_armoury',
  x: 17.5,
  z: -5.5,
  w: 13,
  d: 9,
  rot: -Math.PI / 2,
});
const TOWN_ARMOURY_LOT = Object.freeze({
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
});

export function assertMatchedLotIdentity(lot, expectedArmoury) {
  const expected = expectedArmoury ? FEATURE_ARMOURY_LOT : RELEASE_BASE_INN_LOT;
  for (const [key, value] of Object.entries(expected)) {
    if (lot?.[key] !== value) {
      throw new Error(`matched lot ${key}: expected ${value}, got ${lot?.[key]}`);
    }
  }
  if (!expectedArmoury && Object.hasOwn(lot ?? {}, 'landmark')) {
    throw new Error(`matched base lot landmark: expected omitted, got ${lot.landmark}`);
  }
}

export function assertTownArmouryIdentity(lot, expectedTown) {
  if (typeof expectedTown !== 'boolean') {
    throw new Error('town armoury identity requires an expectedTown boolean');
  }
  const expected = expectedTown ? TOWN_ARMOURY_LOT : FEATURE_ARMOURY_LOT;
  for (const [key, value] of Object.entries(expected)) {
    if (lot?.[key] !== value) {
      throw new Error(`town armoury ${key}: expected ${value}, got ${lot?.[key]}`);
    }
  }
  if (!expectedTown) {
    for (const key of ['id', 'assetId', 'height']) {
      if (Object.hasOwn(lot ?? {}, key)) {
        throw new Error(`town armoury ${key}: expected omitted, got ${lot[key]}`);
      }
    }
  }
}

export const EASTBROOK_ARMOURY_PERF_CONTRACT = Object.freeze({
  withoutShadows: Object.freeze({ calls: 6, triangles: 8_226, lines: 0, points: 0 }),
  withShadows: Object.freeze({ calls: 10, triangles: 15_844, lines: 0, points: 0 }),
  shadowPass: Object.freeze({ calls: 4, triangles: 7_618, lines: 0, points: 0 }),
});

export function median(values) {
  if (values.length === 0 || values.some((value) => !Number.isFinite(value))) {
    throw new Error('performance evidence must contain only finite numeric samples');
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export function round(value, digits = 2) {
  if (!Number.isFinite(value)) throw new Error('performance evidence must be finite');
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function percentile(values, quantile) {
  if (values.length === 0 || values.some((value) => !Number.isFinite(value))) {
    throw new Error('performance samples must contain finite values');
  }
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(quantile * sorted.length) - 1))];
}

export function summarizePerformanceEvidence({ samples, rafDeltasMs, report, assetFailures }) {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new Error('performance samples are required');
  }
  if (!Array.isArray(rafDeltasMs) || rafDeltasMs.length === 0) {
    throw new Error('requestAnimationFrame performance samples are required');
  }
  const values = (key) => samples.map((sample) => sample[key]);
  const medians = (keys) =>
    Object.fromEntries(keys.map((key) => [key, round(median(values(key)))]));
  const worst = (keys) =>
    Object.fromEntries(keys.map((key) => [key, round(Math.max(...values(key)))]));
  const renderKeys = ['calls', 'shadowDraws', 'triangles', 'lines', 'points', 'cpuSubmitMs'];
  const resourceKeys = ['geometries', 'textures', 'programs', 'heapUsedMb'];
  const raf = rafDeltasMs.filter((value) => Number.isFinite(value) && value > 0);
  if (raf.length !== rafDeltasMs.length || raf.length === 0) {
    throw new Error('requestAnimationFrame performance samples must be finite and positive');
  }
  const longTasks = report?.browser?.longTasks ?? {};
  const inputToVisible = report?.input?.intentToVisible ?? {};
  const renderer = report?.renderer ?? {};
  return {
    timingBasis: 'CPU and requestAnimationFrame timing only; GPU timing was not measured',
    renderMedian: medians(renderKeys),
    renderWorst: worst(renderKeys),
    resourcesMedian: medians(resourceKeys),
    resourcesWorst: worst(resourceKeys),
    rafFrameInterval: {
      samples: raf.length,
      meanMs: round(raf.reduce((sum, value) => sum + value, 0) / raf.length),
      p95Ms: round(percentile(raf, 0.95)),
      p99Ms: round(percentile(raf, 0.99)),
      maxMs: round(Math.max(...raf)),
      long50: raf.filter((value) => value >= 50).length,
    },
    longTasks: {
      count: longTasks.count ?? 0,
      p95Ms: round(longTasks.p95 ?? 0),
      maxMs: round(longTasks.max ?? 0),
    },
    rendererCpu: {
      worldP95Ms: round(percentile(values('rendererWorldMs'), 0.95)),
      submitP95Ms: round(percentile(values('cpuSubmitMs'), 0.95)),
    },
    inputToVisibleP95Ms: (inputToVisible.count ?? 0) > 0 ? round(inputToVisible.p95 ?? 0) : null,
    context: {
      lost: renderer.contextLost ?? Math.max(...values('contextLost')),
      restored: renderer.contextRestored ?? 0,
    },
    assetFailures: [...(assetFailures ?? [])],
  };
}

export function deltaCounts(visible, hidden) {
  return {
    calls: round(visible.renderMedian.calls - hidden.renderMedian.calls),
    triangles: round(visible.renderMedian.triangles - hidden.renderMedian.triangles),
    lines: round(visible.renderMedian.lines - hidden.renderMedian.lines),
    points: round(visible.renderMedian.points - hidden.renderMedian.points),
  };
}

export function subtractCounts(total, subset) {
  return {
    calls: round(total.calls - subset.calls),
    triangles: round(total.triangles - subset.triangles),
    lines: round(total.lines - subset.lines),
    points: round(total.points - subset.points),
  };
}

export function deriveArmouryPerformanceDeltas(conditions) {
  const armouryWithShadows = deltaCounts(conditions.visibleShadowOn, conditions.hiddenShadowOn);
  const armouryWithoutShadows = deltaCounts(
    conditions.visibleShadowOff,
    conditions.hiddenShadowOff,
  );
  return {
    armouryWithShadows,
    armouryWithoutShadows,
    shadowPassAttribution: subtractCounts(armouryWithShadows, armouryWithoutShadows),
  };
}

export function deriveTownPerformanceDeltas(conditions) {
  const townWithShadows = deltaCounts(conditions.visibleShadowOn, conditions.hiddenShadowOn);
  const townWithoutShadows = deltaCounts(conditions.visibleShadowOff, conditions.hiddenShadowOff);
  return {
    townWithoutShadows,
    townWithShadows,
    shadowPassAttribution: subtractCounts(townWithShadows, townWithoutShadows),
  };
}

const EXPECTED_CAPTURE_PROXY_PATHS = new Set(['/api/project-stats', '/api/site-presence']);

export function expectedCaptureProxyResponse(url, status) {
  if (status !== 502) return false;
  try {
    return EXPECTED_CAPTURE_PROXY_PATHS.has(new URL(url).pathname);
  } catch {
    return false;
  }
}

export function expectedCaptureProxyConsoleError(message) {
  return /^Failed to load resource: the server responded with a status of 502 \(Bad Gateway\)$/i.test(
    message,
  );
}

export function expectedCaptureProxyConsoleSource(message, sourceUrl) {
  return expectedCaptureProxyConsoleError(message) && expectedCaptureProxyResponse(sourceUrl, 502);
}

export function assertNoCaptureErrors(pageErrors, consoleErrors) {
  if (pageErrors.length > 0) throw new Error(pageErrors.join(' | '));
  if (consoleErrors.length > 0) throw new Error(consoleErrors.join(' | '));
}

// Local capture runs have no API server, and headless Chrome can reject only
// Three's environment-prefilter shaders while the game scene itself renders.
// The training dummy also logs a tolerated one-frame preload race on the exact
// release base. Every other console error remains fatal.
export function expectedCaptureEnvironmentError(message) {
  return (
    /Failed to fetch project stats/i.test(message) ||
    (/THREE\.WebGLProgram: Shader Error/.test(message) &&
      /Material Name: (?:EquirectangularToCubeUV|SphericalGaussianBlur)/.test(message)) ||
    /character visual unavailable, skipping view \(mob_training_dummy\)/.test(message)
  );
}

function assertNear(actual, expected, label, epsilon = 0.02) {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > epsilon) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

function assertVector(actual, expected, label) {
  if (!actual) throw new Error(`${label} is unavailable`);
  assertNear(actual.x, expected.x, `${label}.x`);
  assertNear(actual.y, expected.y, `${label}.y`);
  assertNear(actual.z, expected.z, `${label}.z`);
}

export function assertCaptureRenderState({
  renderState,
  expectedSeed,
  profile,
  view,
  expectedArmoury,
  playerState,
  requireArmouryVisible = true,
}) {
  if (renderState.seed !== expectedSeed) {
    throw new Error(`expected world seed ${expectedSeed}, got ${renderState.seed}`);
  }
  if (renderState.tier !== profile.tier) {
    throw new Error(`expected ${profile.tier} tier, got ${renderState.tier}`);
  }
  if (renderState.autoGovernor !== false) throw new Error('graphics governor must be disabled');
  if (renderState.settings.graphicsDefaultApplied !== true) {
    throw new Error('graphicsDefaultApplied must remain true');
  }
  for (const [key, value] of Object.entries(profile.settings)) {
    if (renderState.settings[key] !== value) {
      throw new Error(`setting ${key}: expected ${value}, got ${renderState.settings[key]}`);
    }
  }
  if (renderState.assetPresent !== expectedArmoury) {
    throw new Error(
      `expected armoury presence ${expectedArmoury}, got ${renderState.assetPresent}`,
    );
  }
  if (expectedArmoury && requireArmouryVisible && !renderState.asset?.visible) {
    throw new Error(`armoury is not visibly framed in the ${view.name} view`);
  }
  if (!expectedArmoury && renderState.asset !== null) {
    throw new Error('release-base armoury asset details must be null');
  }
  assertVector(renderState.camera, view.camera, 'camera');
  assertVector(renderState.target, view.target, 'target');
  if (!renderState.editorCamera) throw new Error('renderer editor camera is not active');
  assertVector(renderState.editorCamera.camera, view.camera, 'editorCamera.camera');
  assertVector(renderState.editorCamera.target, view.target, 'editorCamera.target');
  assertNear(renderState.player.x, playerState.x, 'player.x');
  assertNear(renderState.player.y, playerState.y, 'player.y');
  assertNear(renderState.player.z, playerState.z, 'player.z');
  assertNear(renderState.player.facing, playerState.facing, 'player.facing');
}

function assertExactJson(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

export function assertTownCaptureMetadata({
  metadata,
  contractId = null,
  expectedTown,
  expectedArmoury,
  profile,
  view,
  playerState,
  expectedSeed,
  settleMs,
  expectedPolishProvenance = null,
}) {
  if (metadata?.schemaVersion !== 2 || metadata.captureScope !== 'town') {
    throw new Error('town metadata schema or capture scope is invalid');
  }
  const metadataContractId = metadata.townContract?.id ?? null;
  if (contractId !== null && metadataContractId !== contractId) {
    throw new Error('town capture contract id does not match the requested contract');
  }
  const resolvedContractId = contractId ?? metadataContractId;
  const captureContract = resolvedContractId ? townCaptureContract(resolvedContractId) : null;
  const expectedComparison = expectedTown
    ? (captureContract?.sourceComparison ?? 'feature-worktree')
    : 'pr-2356-head';
  if (
    metadata.source?.comparison !== expectedComparison ||
    typeof metadata.source?.revision !== 'string' ||
    metadata.source.revision.length === 0
  ) {
    throw new Error('capture source provenance is incomplete');
  }
  if (
    (expectedTown && !/^[a-f0-9]{64}$/i.test(metadata.source.fingerprint ?? '')) ||
    (!expectedTown && metadata.source.fingerprint !== null)
  ) {
    throw new Error('capture source fingerprint is incomplete');
  }
  if (captureContract) {
    if (
      captureContract.polishProvenance?.mode === 'baseline-revision' &&
      metadata.source.revision !== captureContract.polishProvenance.baselineRevision
    ) {
      throw new Error('polish baseline source revision does not match the pinned revision');
    }
    assertExactJson(
      metadata.townContract,
      {
        id: captureContract.id,
        layoutId: captureContract.layoutId,
        sourceComparison: captureContract.sourceComparison,
        placementInventory: captureContract.placementInventory,
        townTriangles: captureContract.townTriangles,
        assetUrls: captureContract.assetUrls,
        attributionTargets: captureContract.attributionTargets,
        overlayRecordCounts: captureContract.overlayRecordCounts,
        motionCapture: captureContract.motionCapture,
        ...(captureContract.polishProvenance
          ? { polishProvenance: captureContract.polishProvenance }
          : {}),
      },
      'town capture contract',
    );
    if (captureContract.polishProvenance) {
      if (!expectedPolishProvenance) {
        throw new Error('expected polish provenance is missing from the capture assertion');
      }
      assertExactJson(
        metadata.polishProvenance,
        expectedPolishProvenance,
        'polish capture provenance',
      );
    }
    assertTownAttributionTargetState({
      targets: metadata.observed?.contractTargets,
      contractId: captureContract.id,
      requestedVisible: true,
    });
    const contractAssetStates = metadata.observed?.contractAssetStates;
    if (
      !Array.isArray(contractAssetStates) ||
      contractAssetStates.length !== captureContract.assetUrls.length ||
      contractAssetStates.some(
        (state, index) =>
          state.url !== captureContract.assetUrls[index] || state.state !== 'loaded',
      )
    ) {
      throw new Error('town contract asset inventory is incomplete');
    }
    if (
      view.name === captureContract.motionCapture?.viewName &&
      metadata.captureMode !== 'performance'
    ) {
      assertTownMotionEvidence({
        evidence: metadata.motionEvidence,
        contractId: captureContract.id,
      });
    } else if (metadata.motionEvidence !== null) {
      throw new Error('motion evidence was attached to a non-motion capture view');
    }
  }
  const expectedInventory = expectedTownPlacementInventory(expectedTown, resolvedContractId);
  assertExactJson(
    metadata.expected,
    {
      armoury: expectedArmoury,
      bankerChestCount: 1,
      townRoot: expectedTown,
      inventory: expectedInventory,
      newAssetUrls: EASTBROOK_TOWN_NEW_ASSET_URLS,
      surfaceAtlasUrl: EASTBROOK_TOWN_SURFACE_ATLAS_URL,
      timing: EASTBROOK_TOWN_CAPTURE_TIMING,
    },
    'expected town metadata',
  );
  if (metadata.observed?.armouryPresent !== expectedArmoury) {
    throw new Error(
      `armoury presence: expected ${expectedArmoury}, got ${metadata.observed?.armouryPresent}`,
    );
  }
  if (expectedArmoury) {
    assertTownArmouryIdentity(metadata.observed?.armouryRecord, expectedTown);
  }
  if (metadata.observed?.bankerChestPresent !== true) {
    throw new Error('banker chest presence: expected true');
  }
  if (metadata.observed?.bankerChestCount !== 1) {
    throw new Error(`banker chest count: expected 1, got ${metadata.observed?.bankerChestCount}`);
  }
  const root = metadata.observed?.townRoot;
  if (
    root?.name !== EASTBROOK_TOWN_ROOT_NAME ||
    root.present !== expectedTown ||
    root.visible !== expectedTown
  ) {
    throw new Error(`town root presence: expected ${expectedTown} at ${EASTBROOK_TOWN_ROOT_NAME}`);
  }
  const expectedRootAssetUrls = expectedTown ? EASTBROOK_TOWN_NEW_ASSET_URLS : [];
  if (JSON.stringify(root.newAssetUrls) !== JSON.stringify(expectedRootAssetUrls)) {
    throw new Error('town root asset URLs do not match the expected rebuild inventory');
  }
  const expectedRootBuildingIds = expectedTown ? expectedInventory.rebuild.buildings : [];
  if (JSON.stringify(root.buildingIds) !== JSON.stringify(expectedRootBuildingIds)) {
    throw new Error('town root building IDs do not match the expected rebuild inventory');
  }
  if (expectedTown) {
    const drawStats = root.drawStats;
    if (
      root.childMeshCount !== 18 ||
      drawStats?.colorDraws !== 18 ||
      drawStats.shadowDraws !== 9 ||
      drawStats.triangles !==
        (captureContract?.townTriangles ?? EASTBROOK_TOWN_HISTORICAL_TRIANGLES) ||
      drawStats.buildingCount !== 6 ||
      drawStats.roofHideTargetCount !== 6 ||
      drawStats.microBatchCount !== 2 ||
      drawStats.wallBatchCount !== 4 ||
      drawStats.wallSegmentCount !== 26 ||
      drawStats.gateCount !== 6 ||
      root.wallSegmentCount !== 26 ||
      root.gateCount !== 6
    ) {
      throw new Error('town root draw stats are incomplete');
    }
  } else if (
    root.childMeshCount !== 0 ||
    root.drawStats !== null ||
    root.wallSegmentCount !== 0 ||
    root.gateCount !== 0
  ) {
    throw new Error('town root draw stats must be absent from the baseline');
  }
  assertExactJson(
    metadata.observed?.inventory?.legacy,
    expectedInventory.legacy,
    'legacy placement inventory',
  );
  assertExactJson(
    metadata.observed?.inventory?.rebuild,
    expectedInventory.rebuild,
    'rebuild placement inventory',
  );
  const assetStates = metadata.observed?.assetStates;
  if (
    !Array.isArray(assetStates) ||
    assetStates.length !== EASTBROOK_TOWN_NEW_ASSET_URLS.length ||
    assetStates.some((state, index) => state.url !== EASTBROOK_TOWN_NEW_ASSET_URLS[index])
  ) {
    throw new Error('asset URL inventory does not match the nine shipping assets');
  }
  const expectedAssetState = expectedTown ? 'loaded' : 'not-requested';
  if (assetStates.some((state) => state.state !== expectedAssetState)) {
    throw new Error(`asset load state: expected every asset to be ${expectedAssetState}`);
  }
  const surfaceAtlas = metadata.observed?.surfaceAtlas;
  if (
    surfaceAtlas?.url !== EASTBROOK_TOWN_SURFACE_ATLAS_URL ||
    surfaceAtlas.state !== expectedAssetState
  ) {
    throw new Error(
      `surface atlas load state: expected ${expectedAssetState}; observed ${JSON.stringify(surfaceAtlas)}`,
    );
  }
  if (expectedTown) {
    const consumers = surfaceAtlas.consumers;
    const expectedConsumerNames = {
      townRoot: EASTBROOK_TOWN_ROOT_NAME,
      armoury: 'eastbrookGrandArmoury',
      bankerChest: 'bankerChestDecoration',
    };
    const consumerRoots = [];
    let consumerBindings = 0;
    for (const [consumerName, expectedRootName] of Object.entries(expectedConsumerNames)) {
      const consumer = consumers?.[consumerName];
      if (
        consumer?.present !== true ||
        !Array.isArray(consumer.roots) ||
        consumer.roots.length === 0
      ) {
        throw new Error('surface atlas bindings are incomplete or do not share one texture');
      }
      let observedBindings = 0;
      for (const rootRecord of consumer.roots) {
        const rootMetadata = rootRecord.metadata;
        if (
          rootRecord.name !== expectedRootName ||
          JSON.stringify(Object.keys(rootMetadata ?? {}).sort()) !==
            JSON.stringify(['materialBindings', 'textureUuid', 'url']) ||
          rootMetadata.url !== EASTBROOK_TOWN_SURFACE_ATLAS_URL ||
          typeof rootMetadata.textureUuid !== 'string' ||
          rootMetadata.textureUuid.length === 0 ||
          !Number.isInteger(rootMetadata.materialBindings) ||
          rootMetadata.materialBindings < 1 ||
          rootRecord.observed?.materialBindings !== rootMetadata.materialBindings ||
          JSON.stringify(rootRecord.observed?.textureUuids) !==
            JSON.stringify([rootMetadata.textureUuid])
        ) {
          throw new Error('surface atlas bindings are incomplete or do not share one texture');
        }
        observedBindings += rootRecord.observed.materialBindings;
        consumerRoots.push(rootRecord);
      }
      if (consumer.materialBindings !== observedBindings) {
        throw new Error('surface atlas bindings are incomplete or do not share one texture');
      }
      consumerBindings += observedBindings;
    }
    const declaredTextureUuids = [
      ...new Set(consumerRoots.map((rootRecord) => rootRecord.metadata.textureUuid)),
    ];
    if (
      surfaceAtlas.sharedTextureIdentity !== true ||
      surfaceAtlas.textureUuids?.length !== 1 ||
      declaredTextureUuids.length !== 1 ||
      declaredTextureUuids[0] !== surfaceAtlas.textureUuids[0] ||
      consumerBindings < 3
    ) {
      throw new Error('surface atlas bindings are incomplete or do not share one texture');
    }
  } else {
    const expectedConsumerPresence = { townRoot: false, armoury: true, bankerChest: true };
    if (
      surfaceAtlas.sharedTextureIdentity !== false ||
      surfaceAtlas.textureUuids?.length !== 0 ||
      Object.entries(expectedConsumerPresence).some(([consumerName, present]) => {
        const consumer = surfaceAtlas.consumers?.[consumerName];
        return (
          consumer?.present !== present ||
          consumer.materialBindings !== 0 ||
          !Array.isArray(consumer.roots) ||
          consumer.roots.length !== (present ? 1 : 0) ||
          consumer.roots.some(
            (rootRecord) =>
              rootRecord.metadata !== null ||
              rootRecord.observed?.materialBindings !== 0 ||
              rootRecord.observed?.textureUuids?.length !== 0,
          )
        );
      })
    ) {
      throw new Error('surface atlas bindings must be absent from the baseline');
    }
  }

  const renderer = metadata.renderer;
  if (!renderer?.vendor || !renderer?.renderer) throw new Error('renderer vendor is unavailable');
  if (renderer.tier !== profile.tier) {
    throw new Error(`renderer tier: expected ${profile.tier}, got ${renderer.tier}`);
  }
  for (const [key, value] of Object.entries(profile.settings)) {
    if (renderer.settings?.[key] !== value) {
      throw new Error(
        `renderer settings ${key}: expected ${value}, got ${renderer.settings?.[key]}`,
      );
    }
  }
  if (renderer.governorEnabled !== false) throw new Error('graphics governor must be disabled');
  if (renderer.contextLost !== 0 || renderer.contextRestored !== 0) {
    throw new Error(
      `renderer context loss was observed (lost=${renderer.contextLost}, restored=${renderer.contextRestored})`,
    );
  }
  for (const key of [
    'calls',
    'triangles',
    'geometries',
    'textures',
    'programs',
    'contextLost',
    'contextRestored',
  ]) {
    const value = renderer.resources?.[key];
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`renderer resources ${key} is unavailable`);
    }
  }

  const viewport = metadata.viewport;
  assertExactJson(viewport?.expected, profile.viewport, 'expected viewport');
  if (
    viewport?.observed?.cssWidth !== profile.viewport.width ||
    viewport.observed.cssHeight !== profile.viewport.height
  ) {
    throw new Error('CSS viewport does not match the capture profile');
  }
  if (viewport.observed.devicePixelRatio !== profile.viewport.deviceScaleFactor) {
    throw new Error(
      `device pixel ratio: expected ${profile.viewport.deviceScaleFactor}, got ${viewport.observed.devicePixelRatio}`,
    );
  }
  if (
    viewport.physical?.width !== profile.viewport.width * profile.viewport.deviceScaleFactor ||
    viewport.physical?.height !== profile.viewport.height * profile.viewport.deviceScaleFactor
  ) {
    throw new Error('physical screenshot viewport is incorrect');
  }
  assertExactJson(viewport.observed, viewport.initial, 'viewport mutation');
  if (profile.mobile) {
    if (
      viewport.observed.touch !== true ||
      viewport.observed.maxTouchPoints <= 0 ||
      viewport.touchHudVisible !== true
    ) {
      throw new Error('touch HUD and touch-capable viewport must be visible on mobile');
    }
  }

  if (metadata.world?.seed !== expectedSeed) {
    throw new Error(`world seed: expected ${expectedSeed}, got ${metadata.world?.seed}`);
  }
  assertVector(metadata.world?.player, playerState, 'metadata player');
  assertNear(metadata.world?.player?.facing, playerState.facing, 'metadata player.facing');
  assertVector(metadata.world?.camera, view.camera, 'metadata camera');
  assertVector(metadata.world?.target, view.target, 'metadata target');
  if (metadata.settle?.requestedMs !== settleMs || metadata.settle?.completed !== true) {
    throw new Error(`settle window: expected completed ${settleMs}ms wait`);
  }
  if (
    !Number.isFinite(metadata.settle.observedMs) ||
    metadata.settle.observedMs < settleMs ||
    metadata.settle.boot?.bootSettleMs !== EASTBROOK_TOWN_CAPTURE_TIMING.bootSettleMs ||
    !Number.isFinite(metadata.settle.boot?.navigationAndBootMs) ||
    metadata.settle.boot.navigationAndBootMs < EASTBROOK_TOWN_CAPTURE_TIMING.bootSettleMs ||
    !Number.isFinite(metadata.settle.boot?.preloadWaitMs) ||
    metadata.settle.boot.preloadWaitMs < 0
  ) {
    throw new Error('settle window or cold preload evidence is incomplete');
  }

  const diagnostics = metadata.diagnostics;
  if (diagnostics?.pageErrors?.length > 0 || diagnostics?.consoleErrors?.length > 0) {
    throw new Error('capture errors are present in town metadata');
  }
  if (diagnostics?.assetFailures?.length > 0) {
    throw new Error('asset failures are present in town metadata');
  }

  const overlayExpected = view.name === 'interaction-collider-overlay';
  const overlay = metadata.overlay;
  if (
    overlay?.requested !== overlayExpected ||
    overlay.installedDuringCapture !== overlayExpected
  ) {
    throw new Error('capture overlay request/install state is incorrect');
  }
  if (overlay?.removedAfterCapture !== true) {
    throw new Error('capture overlay was not removed after screenshot');
  }
  const overlayRecordTypes = ['obbs', 'circles', 'points', 'gates'];
  if (
    overlayRecordTypes.some(
      (type) =>
        !Array.isArray(overlay?.records?.[type]) ||
        overlay.records[type].length !== overlay.recordCounts?.[type],
    )
  ) {
    throw new Error('capture overlay record inventory does not match its counts');
  }
  if (overlayExpected) {
    const expectedSource = expectedTown ? 'eastbrook-layout' : 'zone1-legacy-collision-records';
    if (overlay.source !== expectedSource) {
      throw new Error(`capture overlay source: expected ${expectedSource}, got ${overlay.source}`);
    }
    const expectedRecordCounts = expectedTown
      ? (captureContract?.overlayRecordCounts ?? { obbs: 43, circles: 1, points: 30, gates: 6 })
      : { obbs: 6, circles: 5, points: 0, gates: 0 };
    if (JSON.stringify(overlay.recordCounts) !== JSON.stringify(expectedRecordCounts)) {
      throw new Error('capture overlay record inventory is incomplete');
    }
    const finite = (...values) => values.every(Number.isFinite);
    if (
      overlay.records.obbs.some(
        (record) =>
          !record.id ||
          !finite(
            record.center?.x,
            record.center?.z,
            record.halfWidth,
            record.halfDepth,
            record.rotation,
          ) ||
          record.halfWidth <= 0 ||
          record.halfDepth <= 0,
      ) ||
      overlay.records.circles.some(
        (record) => !record.id || !finite(record.x, record.z, record.radius) || record.radius <= 0,
      ) ||
      overlay.records.points.some((record) => !record.id || !finite(record.x, record.z)) ||
      overlay.records.gates.some(
        (record) =>
          !record.id ||
          !finite(
            record.center?.x,
            record.center?.z,
            record.start?.x,
            record.start?.z,
            record.end?.x,
            record.end?.z,
            record.width,
          ) ||
          record.width <= 0,
      )
    ) {
      throw new Error('capture overlay record inventory contains invalid records');
    }
    if (captureContract) {
      assertTownNpcFacingOverlay({ overlay, contractId: captureContract.id });
    }
  } else if (
    overlay.source !== null ||
    overlay.unsupportedReason !== null ||
    overlayRecordTypes.some((type) => overlay.recordCounts[type] !== 0)
  ) {
    throw new Error('capture overlay was unexpectedly active for a normal view');
  }
  assertCaptureCleanupState({ cleanup: metadata.cleanup, label: 'capture cleanup' });
}

export function assertPerformanceBlockState({ raw, label, meshVisible, shadowEnabled }) {
  if (raw.observed.shadowMapEnabled !== shadowEnabled) {
    throw new Error(`${label}: shadow-map state did not match the requested block`);
  }
  if (raw.observed.sunCastShadow !== shadowEnabled) {
    throw new Error(`${label}: sun shadow state did not match the requested block`);
  }
  if (meshVisible === null) return;

  const shippingVisibleMeshes = raw.restorationContract.meshVisible.filter(Boolean).length;
  const expectedVisibleMeshes = meshVisible ? shippingVisibleMeshes : 0;
  if (raw.armouryChildMeshes <= 0 || raw.observed.wrapperVisible !== true) {
    throw new Error(`${label}: armoury wrapper or child meshes were unavailable`);
  }
  if (raw.observed.visibleMeshes !== expectedVisibleMeshes) {
    throw new Error(
      `${label}: expected ${expectedVisibleMeshes} visible child meshes, got ${raw.observed.visibleMeshes}`,
    );
  }
}

export function assertTownPerformanceBlockState({
  raw,
  label,
  rootVisible,
  shadowEnabled,
  contractId = null,
}) {
  const expectedTriangles = contractId
    ? townCaptureContract(contractId).townTriangles
    : EASTBROOK_TOWN_HISTORICAL_TRIANGLES;
  if (raw.targetName !== EASTBROOK_TOWN_ROOT_NAME) {
    throw new Error(
      `${label}: performance target must be ${EASTBROOK_TOWN_ROOT_NAME}, got ${raw.targetName}`,
    );
  }
  if (
    raw.observed.rootName !== EASTBROOK_TOWN_ROOT_NAME ||
    raw.observed.rootPresent !== true ||
    raw.targetChildMeshes !== 18
  ) {
    throw new Error(`${label}: ${EASTBROOK_TOWN_ROOT_NAME} root is unavailable`);
  }
  if (raw.observed.rootVisible !== rootVisible) {
    throw new Error(
      `${label}: root visibility expected ${rootVisible}, got ${raw.observed.rootVisible}`,
    );
  }
  if (raw.observed.shadowMapEnabled !== shadowEnabled) {
    throw new Error(`${label}: shadow-map state did not match the requested block`);
  }
  if (raw.observed.sunCastShadow !== shadowEnabled) {
    throw new Error(`${label}: sun shadow state did not match the requested block`);
  }
  const drawStats = raw.drawStats;
  if (
    drawStats?.colorDraws !== 18 ||
    drawStats.shadowDraws !== 9 ||
    drawStats.triangles !== expectedTriangles ||
    drawStats.buildingCount !== 6 ||
    drawStats.wallBatchCount !== 4 ||
    drawStats.wallSegmentCount !== 26 ||
    drawStats.gateCount !== 6
  ) {
    throw new Error(`${label}: rebuilt town draw stats are incomplete`);
  }
}

export function assertTownBaselinePerformanceBlockState({ raw, label, shadowEnabled }) {
  if (
    raw.targetName !== EASTBROOK_TOWN_ROOT_NAME ||
    raw.targetChildMeshes !== 0 ||
    raw.observed?.rootName !== EASTBROOK_TOWN_ROOT_NAME ||
    raw.observed.rootPresent !== false ||
    raw.observed.rootVisible !== null ||
    raw.drawStats !== null
  ) {
    throw new Error(`${label}: baseline target must be absent ${EASTBROOK_TOWN_ROOT_NAME}`);
  }
  if (raw.observed.shadowMapEnabled !== shadowEnabled) {
    throw new Error(`${label}: shadow-map state did not match the requested block`);
  }
  if (raw.observed.sunCastShadow !== shadowEnabled) {
    throw new Error(`${label}: sun shadow state did not match the requested block`);
  }
}

export function assertPerformanceStateRestored({ restored, original, label }) {
  if (JSON.stringify(restored) !== JSON.stringify(original)) {
    throw new Error(`${label}: runtime visibility or renderer settings were not restored`);
  }
}

export function assertCaptureCleanupState({ cleanup, label }) {
  if (cleanup.overlayCount !== 0) {
    throw new Error(`${label}: capture overlay was not removed`);
  }
  for (const key of [
    'rootVisibilityRestored',
    'shadowMapRestored',
    'sunShadowRestored',
    'infoAutoResetRestored',
  ]) {
    if (cleanup[key] !== true) {
      throw new Error(`${label}: ${key} is false`);
    }
  }
  if (Object.hasOwn(cleanup, 'reduceMotionRestored') && cleanup.reduceMotionRestored !== true) {
    throw new Error(`${label}: reduceMotionRestored is false`);
  }
}

function assertCounts(actual, expected, label) {
  for (const [key, value] of Object.entries(expected)) {
    if (actual?.[key] !== value) {
      throw new Error(`${label}.${key}: expected ${value}, got ${actual?.[key]}`);
    }
  }
}

export function assertArmouryPerformanceContract(deltas) {
  if (!deltas) throw new Error('armoury performance deltas are unavailable');
  assertCounts(
    deltas.armouryWithoutShadows,
    EASTBROOK_ARMOURY_PERF_CONTRACT.withoutShadows,
    'armouryWithoutShadows',
  );
  assertCounts(
    deltas.armouryWithShadows,
    EASTBROOK_ARMOURY_PERF_CONTRACT.withShadows,
    'armouryWithShadows',
  );
  assertCounts(
    deltas.shadowPassAttribution,
    EASTBROOK_ARMOURY_PERF_CONTRACT.shadowPass,
    'shadowPassAttribution',
  );
}
