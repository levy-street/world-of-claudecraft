import { describe, expect, it } from 'vitest';
import { isBlocked, resolvePosition } from '../src/sim/colliders';
import { EASTBROOK_LAYOUT } from '../src/sim/eastbrook_layout';

const captureContract =
  // @ts-expect-error The executable capture contract intentionally ships as plain Node ESM.
  await import('../scripts/assets/eastbrook_grand_armoury/capture_contract.mjs');
const {
  assertTownAttributionTargetState,
  assertTownMotionEvidence,
  assertTownNpcFacingOverlay,
  assertTownPerformanceBlockState,
  EASTBROOK_TOWN_CAPTURE_CONTRACTS,
  EASTBROOK_TOWN_CAPTURE_VIEWS,
  EASTBROOK_TOWN_MOTION_CAPTURE,
  EASTBROOK_TOWN_POLISH_CAPTURE_VIEWS,
  EASTBROOK_TOWN_POLISH_MATCHED_CAPTURE_VIEWS,
  EASTBROOK_TOWN_POLISH_MATCHED_VIEW_OVERRIDES,
  EASTBROOK_TOWN_POLISH_V2_PLACEMENT_INVENTORY,
  EASTBROOK_TOWN_REBUILD_PLACEMENT_INVENTORY,
  EASTBROOK_POLISH_BASELINE_REVISION,
  EASTBROOK_POLISH_PROVENANCE_INPUTS,
  EASTBROOK_TOWN_ROOT_NAME,
  EASTBROOK_TOWN_SURFACE_ATLAS_URL,
  EASTBROOK_ARMOURY_CAPTURE_SEED,
  deriveEastbrookPolishCompositeProvenance,
  expectedTownPlacementInventory,
  selectCaptureConfiguration,
} = captureContract;

interface AttributionTargetFixture {
  key: string;
  kind: string;
  rootName: string;
  layoutId: string;
  layoutServiceId?: string;
  templateId: string | null;
  surfaceAtlas: { url: string; textureUuid: string; materialBindings: number };
  present: boolean;
  visible: boolean;
  childMeshCount: number;
}

function validPolishAttributionTargets(): AttributionTargetFixture[] {
  return [
    {
      key: 'town-root',
      kind: 'scene-root',
      rootName: EASTBROOK_TOWN_ROOT_NAME,
      layoutId: 'eastbrook_civic_layout_v2',
      templateId: null,
      surfaceAtlas: {
        url: EASTBROOK_TOWN_SURFACE_ATLAS_URL,
        textureUuid: 'shared-eastbrook-atlas',
        materialBindings: 14,
      },
      present: true,
      visible: false,
      childMeshCount: 18,
    },
    {
      key: 'mailbox',
      kind: 'layout-entity',
      rootName: 'ravenpostMailbox',
      layoutId: 'eastbrook_civic_layout_v2',
      layoutServiceId: 'mailbox_eastbrook',
      templateId: 'mailbox',
      surfaceAtlas: {
        url: EASTBROOK_TOWN_SURFACE_ATLAS_URL,
        textureUuid: 'shared-eastbrook-atlas',
        materialBindings: 2,
      },
      present: true,
      visible: false,
      childMeshCount: 2,
    },
    {
      key: 'noticeboard',
      kind: 'layout-entity',
      rootName: 'eastbrookNoticeboard',
      layoutId: 'eastbrook_civic_layout_v2',
      layoutServiceId: 'eastbrook_noticeboard',
      templateId: 'noticeboard_eastbrook',
      surfaceAtlas: {
        url: EASTBROOK_TOWN_SURFACE_ATLAS_URL,
        textureUuid: 'shared-eastbrook-atlas',
        materialBindings: 2,
      },
      present: true,
      visible: false,
      childMeshCount: 2,
    },
  ];
}

function validNpcFacingOverlay() {
  return {
    requested: true,
    npcFacings: {
      sourceLayoutId: 'eastbrook_civic_layout_v2',
      arrowLength: 1.5,
      records: [
        {
          id: 'merchant_elsbeth',
          position: { x: 5, z: 7 },
          facing: Math.PI,
          end: { x: 5, z: 5.5 },
        },
        {
          id: 'trader_niall',
          position: { x: -4, z: 8 },
          facing: Math.PI / 2,
          end: { x: -2.5, z: 8 },
        },
      ],
    },
  };
}

function validTownMotionEvidence() {
  return {
    viewName: 'civic-motion',
    frameIntervalMs: 1_600,
    beacon: structuredClone(EASTBROOK_TOWN_MOTION_CAPTURE.beacon),
    contact: {
      defaultReducedMotionOutput: '/tmp/polish-civic-motion.png',
      defaultRuntimeReduceMotion: true,
      pairedFrameCount: 4,
    },
    modes: [
      {
        id: 'motion-on',
        runtimeReduceMotion: false,
        frames: [
          {
            phase: 't0',
            output: '/tmp/polish-civic-motion-motion-on-t0.png',
            bytes: 120_000,
            sha256: 'a'.repeat(64),
          },
          {
            phase: 't1',
            output: '/tmp/polish-civic-motion-motion-on-t1.png',
            bytes: 120_000,
            sha256: 'b'.repeat(64),
          },
        ],
      },
      {
        id: 'reduced-motion',
        runtimeReduceMotion: true,
        frames: [
          {
            phase: 't0',
            output: '/tmp/polish-civic-motion-reduced-motion-t0.png',
            bytes: 120_000,
            sha256: 'c'.repeat(64),
          },
          {
            phase: 't1',
            output: '/tmp/polish-civic-motion-reduced-motion-t1.png',
            bytes: 120_000,
            sha256: 'd'.repeat(64),
          },
        ],
      },
    ],
    restored: true,
  };
}

describe('Eastbrook polish capture contract', () => {
  it('keeps the accepted 15-view rebuild evidence immutable and adds eight polish subjects', () => {
    expect(EASTBROOK_TOWN_CAPTURE_VIEWS).toHaveLength(15);
    expect(EASTBROOK_TOWN_POLISH_CAPTURE_VIEWS.map((view: { name: string }) => view.name)).toEqual([
      'stall-world-market',
      'stall-provisions',
      'apothecary-lin',
      'ravenpost-mailbox',
      'noticeboard',
      'civic-motion',
      'ravenpost-chronicler',
      'west-wall-quartermaster',
    ]);
    expect(
      EASTBROOK_TOWN_POLISH_CAPTURE_VIEWS.map((view: { subject: string }) => view.subject),
    ).toEqual([
      'eastbrook_market_stall_world_market',
      'eastbrook_market_stall_provisions',
      'apothecary_lin',
      'mailbox_eastbrook',
      'eastbrook_noticeboard',
      'eastbrook_civic_well_beacon',
      'chronicler_saul',
      'fury',
    ]);
  });

  it('separates historical rebuild evidence from matched polish before/after contracts', () => {
    expect(Object.keys(EASTBROOK_TOWN_CAPTURE_CONTRACTS)).toEqual([
      'rebuild-v1',
      'polish-baseline',
      'polish-v2',
    ]);
    expect(EASTBROOK_TOWN_CAPTURE_CONTRACTS['rebuild-v1']).toMatchObject({
      id: 'rebuild-v1',
      layoutId: 'eastbrook_civic_layout_v1',
      sourceComparison: 'feature-worktree',
      views: EASTBROOK_TOWN_CAPTURE_VIEWS,
      placementInventory: EASTBROOK_TOWN_REBUILD_PLACEMENT_INVENTORY,
      townTriangles: 29_644,
      attributionTargets: [
        {
          key: 'town-root',
          kind: 'scene-root',
          rootName: EASTBROOK_TOWN_ROOT_NAME,
        },
        {
          key: 'mailbox',
          kind: 'layout-entity',
          layoutServiceKey: 'mailbox',
          templateId: 'mailbox',
          runtimeBodyName: null,
        },
      ],
      motionCapture: null,
    });
    expect(EASTBROOK_TOWN_CAPTURE_CONTRACTS['rebuild-v1'].views).toBe(EASTBROOK_TOWN_CAPTURE_VIEWS);
    expect(EASTBROOK_TOWN_CAPTURE_CONTRACTS['polish-baseline']).toMatchObject({
      id: 'polish-baseline',
      layoutId: 'eastbrook_civic_layout_v1',
      sourceComparison: 'polish-baseline-worktree',
      views: EASTBROOK_TOWN_POLISH_MATCHED_CAPTURE_VIEWS,
      placementInventory: EASTBROOK_TOWN_REBUILD_PLACEMENT_INVENTORY,
      townTriangles: 29_644,
      attributionTargets: [
        {
          key: 'town-root',
          kind: 'scene-root',
          rootName: EASTBROOK_TOWN_ROOT_NAME,
        },
        {
          key: 'mailbox',
          kind: 'layout-entity',
          layoutServiceKey: 'mailbox',
          templateId: 'mailbox',
          runtimeBodyName: null,
        },
      ],
      motionCapture: null,
    });
    expect(EASTBROOK_TOWN_CAPTURE_CONTRACTS['polish-v2']).toMatchObject({
      id: 'polish-v2',
      layoutId: 'eastbrook_civic_layout_v2',
      sourceComparison: 'polish-v2-worktree',
      placementInventory: EASTBROOK_TOWN_POLISH_V2_PLACEMENT_INVENTORY,
      townTriangles: 28_330,
      attributionTargets: [
        {
          key: 'town-root',
          kind: 'scene-root',
          rootName: EASTBROOK_TOWN_ROOT_NAME,
        },
        {
          key: 'mailbox',
          kind: 'layout-entity',
          layoutServiceKey: 'mailbox',
          templateId: 'mailbox',
          runtimeBodyName: 'ravenpostMailbox',
        },
        {
          key: 'noticeboard',
          kind: 'layout-entity',
          layoutServiceKey: 'noticeboard',
          templateId: 'noticeboard_eastbrook',
          runtimeBodyName: 'eastbrookNoticeboard',
        },
      ],
      motionCapture: EASTBROOK_TOWN_MOTION_CAPTURE,
    });
    expect(EASTBROOK_TOWN_CAPTURE_CONTRACTS['rebuild-v1'].assetUrls).toContain(
      '/models/props/mailbox_pillar.glb',
    );
    expect(EASTBROOK_TOWN_CAPTURE_CONTRACTS['rebuild-v1'].assetUrls).not.toContain(
      '/models/props/eastbrook_noticeboard.glb',
    );
    expect(EASTBROOK_TOWN_CAPTURE_CONTRACTS['polish-baseline'].assetUrls).toEqual(
      EASTBROOK_TOWN_CAPTURE_CONTRACTS['rebuild-v1'].assetUrls,
    );
    expect(EASTBROOK_TOWN_CAPTURE_CONTRACTS['polish-baseline'].assetUrls).not.toContain(
      '/models/props/eastbrook_noticeboard.glb',
    );
    expect(EASTBROOK_TOWN_CAPTURE_CONTRACTS['polish-v2'].assetUrls).toContain(
      '/models/props/eastbrook_noticeboard.glb',
    );
    expect(EASTBROOK_TOWN_CAPTURE_CONTRACTS['polish-baseline'].views).toBe(
      EASTBROOK_TOWN_CAPTURE_CONTRACTS['polish-v2'].views,
    );
    expect(EASTBROOK_TOWN_CAPTURE_CONTRACTS['polish-v2'].views).toBe(
      EASTBROOK_TOWN_POLISH_MATCHED_CAPTURE_VIEWS,
    );
  });

  it('pins baseline revision provenance and hashes every v2 polish input separately', async () => {
    expect(EASTBROOK_POLISH_BASELINE_REVISION).toBe('3ab740db453bd8b5858a52c304edc811c9d520ca');
    expect(EASTBROOK_TOWN_CAPTURE_CONTRACTS['polish-baseline'].polishProvenance).toEqual({
      mode: 'baseline-revision',
      baselineRevision: EASTBROOK_POLISH_BASELINE_REVISION,
    });
    expect(EASTBROOK_TOWN_CAPTURE_CONTRACTS['polish-v2'].polishProvenance).toEqual({
      mode: 'composite-sha256',
      algorithm: 'sha256',
      baselineRevision: EASTBROOK_POLISH_BASELINE_REVISION,
      inputs: EASTBROOK_POLISH_PROVENANCE_INPUTS,
    });

    const [
      { createHash },
      { readFile },
      townFingerprint,
      mailboxFingerprint,
      noticeboardFingerprint,
    ] = await Promise.all([
      import('node:crypto'),
      import('node:fs/promises'),
      import('../scripts/assets/eastbrook_town/source_fingerprint.mjs'),
      import('../scripts/assets/eastbrook_mailbox/source_fingerprint.mjs'),
      import('../scripts/assets/eastbrook_noticeboard/source_fingerprint.mjs'),
    ]);
    const repoRoot = new URL('../', import.meta.url);
    const fileSha256 = async (relativePath: string) =>
      createHash('sha256')
        .update(await readFile(new URL(relativePath, repoRoot)))
        .digest('hex');
    const provenance = deriveEastbrookPolishCompositeProvenance({
      townAssetSourceFingerprint: townFingerprint.eastbrookTownSourceFingerprint(),
      authoritativeLayoutSha256: await fileSha256(
        EASTBROOK_POLISH_PROVENANCE_INPUTS.authoritativeLayout,
      ),
      civicShaderSha256: await fileSha256(EASTBROOK_POLISH_PROVENANCE_INPUTS.civicShader),
      townRuntimeSha256: await fileSha256(EASTBROOK_POLISH_PROVENANCE_INPUTS.townRuntime),
      mailboxRuntimeSha256: await fileSha256(EASTBROOK_POLISH_PROVENANCE_INPUTS.mailboxRuntime),
      noticeboardRuntimeSha256: await fileSha256(
        EASTBROOK_POLISH_PROVENANCE_INPUTS.noticeboardRuntime,
      ),
      rendererIntegrationSha256: await fileSha256(
        EASTBROOK_POLISH_PROVENANCE_INPUTS.rendererIntegration,
      ),
      viewPriorityPolicySha256: await fileSha256(
        EASTBROOK_POLISH_PROVENANCE_INPUTS.viewPriorityPolicy,
      ),
      mailboxSourceFingerprint: mailboxFingerprint.eastbrookMailboxSourceFingerprint(),
      mailboxGlbSha256: await fileSha256(EASTBROOK_POLISH_PROVENANCE_INPUTS.mailboxGlb),
      noticeboardSourceFingerprint: noticeboardFingerprint.eastbrookNoticeboardSourceFingerprint(),
      noticeboardGlbSha256: await fileSha256(EASTBROOK_POLISH_PROVENANCE_INPUTS.noticeboardGlb),
    });
    expect(provenance).toMatchObject({
      schemaVersion: 1,
      mode: 'composite-sha256',
      algorithm: 'sha256',
      baselineRevision: EASTBROOK_POLISH_BASELINE_REVISION,
      // Deliberately re-pinned for the release/v0.33.0 resync of the
      // draw-call diet branch: the seal fingerprints src/render/renderer.ts,
      // so it re-mints whenever the renderer coordinator moves. Exactly one
      // component leaf moves here, runtimeRender.renderer.sha256, folding the
      // census hooks and the diet's batching seams into the streaming,
      // zone-feature cull, fog and parkour deltas already pinned by the base.
      // Every Eastbrook line in renderer.ts is byte-identical across that
      // delta, so the accepted evidence still depicts this tree. No recapture.
      fingerprint: '1effaf5e7adb130ff44dc188ceec515848ca53b55a499b49a910f40231cb7fc7',
      components: {
        captureContract: {
          id: 'polish-v2',
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
        runtimeRender: {
          viewPriorityPolicy: {
            path: 'src/render/prewarm_policy.ts',
            sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          },
        },
      },
    });
  });

  it('literal-pins v2 service framing overrides without mutating historical rebuild views', () => {
    expect(EASTBROOK_TOWN_POLISH_MATCHED_VIEW_OVERRIDES).toEqual({
      'bank-and-chest': {
        camera: { x: 5, y: 7, z: 2 },
        target: { x: 14.156943251329539, y: 3.2, z: 8.685223202016726 },
      },
      'smithy-and-forge': {
        camera: { x: 10, y: 7, z: 8 },
        target: { x: 3.687633548766497, y: 3, z: 15.598153967032626 },
      },
      'inn-and-kitchens': {
        camera: { x: 0, y: 8, z: 8 },
        target: { x: -10.018829436136041, y: 3, z: 13.621842145917809 },
      },
      'chapel-and-weaving': {
        camera: { x: 0, y: 12, z: 4 },
        target: { x: -13.2, y: 3, z: -10.5 },
      },
      'toolworks-service-perimeter': {
        camera: { x: 4, y: 7, z: -9 },
        target: { x: 5, y: 5, z: -14.25 },
      },
      'stall-world-market': {
        camera: { x: -6, y: 6, z: 0 },
        target: { x: -5.75, y: 2.5, z: 7 },
      },
    });
    expect(EASTBROOK_TOWN_POLISH_MATCHED_CAPTURE_VIEWS).toHaveLength(23);
    const overridden = new Set(Object.keys(EASTBROOK_TOWN_POLISH_MATCHED_VIEW_OVERRIDES));
    for (const historical of EASTBROOK_TOWN_CAPTURE_VIEWS) {
      const matched = EASTBROOK_TOWN_POLISH_MATCHED_CAPTURE_VIEWS.find(
        (view: { name: string }) => view.name === historical.name,
      );
      expect(matched, historical.name).toBeDefined();
      if (overridden.has(historical.name)) expect(matched).not.toBe(historical);
      else expect(matched).toBe(historical);
    }
  });

  it('keeps every matched polish target collider-clear and service cameras on public faces', () => {
    for (const view of EASTBROOK_TOWN_POLISH_MATCHED_CAPTURE_VIEWS) {
      expect(
        isBlocked(EASTBROOK_ARMOURY_CAPTURE_SEED, view.target.x, view.target.z, 0),
        `${view.name} target`,
      ).toBe(false);
    }
    const serviceSubjects = new Map([
      ['bank-and-chest', ['eastbrook_bank']],
      ['smithy-and-forge', ['eastbrook_smithy']],
      ['inn-and-kitchens', ['eastbrook_inn']],
      ['chapel-and-weaving', ['eastbrook_chapel', 'eastbrook_weaving_workshop']],
      ['toolworks-service-perimeter', ['eastbrook_toolworks']],
    ]);
    for (const [viewName, buildingIds] of serviceSubjects) {
      const view = EASTBROOK_TOWN_POLISH_MATCHED_CAPTURE_VIEWS.find(
        (candidate: { name: string }) => candidate.name === viewName,
      );
      expect(view, viewName).toBeDefined();
      if (!view) throw new Error(`missing matched service view ${viewName}`);
      expect(
        isBlocked(EASTBROOK_ARMOURY_CAPTURE_SEED, view.camera.x, view.camera.z, 0.5),
        `${viewName} camera`,
      ).toBe(false);
      expect(
        isBlocked(EASTBROOK_ARMOURY_CAPTURE_SEED, view.target.x, view.target.z, 0.5),
        `${viewName} target`,
      ).toBe(false);
      for (const buildingId of buildingIds) {
        const building = EASTBROOK_LAYOUT.buildings.find(
          (candidate) => candidate.id === buildingId,
        );
        expect(building, buildingId).toBeDefined();
        if (!building) throw new Error(`missing service building ${buildingId}`);
        const publicFront = {
          x: building.frontStandingPoint.x - building.position.x,
          z: building.frontStandingPoint.z - building.position.z,
        };
        const cameraSide = {
          x: view.camera.x - building.position.x,
          z: view.camera.z - building.position.z,
        };
        expect(
          publicFront.x * cameraSide.x + publicFront.z * cameraSide.z,
          `${viewName} must photograph ${buildingId}'s public face`,
        ).toBeGreaterThan(0);
      }
    }
    const worldMarketView = EASTBROOK_TOWN_POLISH_MATCHED_CAPTURE_VIEWS.find(
      (candidate: { name: string }) => candidate.name === 'stall-world-market',
    );
    const worldMarketStall = EASTBROOK_LAYOUT.market.stalls.find(
      (stall) => stall.id === 'eastbrook_market_stall_world_market',
    );
    expect(worldMarketView).toBeDefined();
    expect(worldMarketStall).toBeDefined();
    if (!worldMarketView || !worldMarketStall) throw new Error('missing World Market view/stall');
    const stallPublicFront = {
      x: worldMarketStall.frontStandingPoint.x - worldMarketStall.position.x,
      z: worldMarketStall.frontStandingPoint.z - worldMarketStall.position.z,
    };
    const stallCameraSide = {
      x: worldMarketView.camera.x - worldMarketStall.position.x,
      z: worldMarketView.camera.z - worldMarketStall.position.z,
    };
    expect(
      stallPublicFront.x * stallCameraSide.x + stallPublicFront.z * stallCameraSide.z,
      'World Market camera must remain on the public side',
    ).toBeGreaterThan(0);
  });

  it('pins the final toolworks seam and stable noticeboard capture anchors', () => {
    const toolworks = EASTBROOK_LAYOUT.buildings.find(
      (building) => building.id === 'eastbrook_toolworks',
    );
    const toolworksStation = EASTBROOK_LAYOUT.services.stations.find(
      (station) => station.id === 'station_eastbrook_toolworks',
    );
    const toolworksView = EASTBROOK_TOWN_POLISH_MATCHED_CAPTURE_VIEWS.find(
      (view: { name: string }) => view.name === 'toolworks-service-perimeter',
    );
    expect(toolworks).toBeDefined();
    expect(toolworksView).toBeDefined();
    if (!toolworks || !toolworksView) throw new Error('missing toolworks capture seam');
    expect(toolworks).toMatchObject({
      position: { x: 6.2, z: -18 },
      rotation: -0.3006056700423954,
      frontStandingPoint: { x: 5.089629608322198, z: -14.4181600268458 },
    });
    expect(toolworksStation?.position).toEqual(toolworks?.frontStandingPoint);
    expect(
      Math.hypot(
        toolworksView.target.x - toolworks.frontStandingPoint.x,
        toolworksView.target.z - toolworks.frontStandingPoint.z,
      ),
      'shared target must remain beside the final toolworks interaction anchor',
    ).toBeLessThan(0.25);
    expect(EASTBROOK_LAYOUT.services.noticeboard.entityId).toBe(2_000_000_001);
    expect(EASTBROOK_TOWN_CAPTURE_CONTRACTS['polish-v2'].overlayRecordCounts).toEqual({
      obbs: 43,
      circles: 1,
      points: 32,
      gates: 6,
    });
  });

  it('keeps historical placement and draw truth by default while selecting polish-v2 explicitly', () => {
    const historical = expectedTownPlacementInventory(true);
    expect(historical.rebuild).toBe(EASTBROOK_TOWN_REBUILD_PLACEMENT_INVENTORY);
    expect(historical.rebuild.stalls).toEqual([
      'eastbrook_market_stall_world_market',
      'eastbrook_market_stall_provisions',
      'eastbrook_market_stall_artisans',
    ]);
    expect(expectedTownPlacementInventory(true, 'rebuild-v1').rebuild).toBe(
      EASTBROOK_TOWN_REBUILD_PLACEMENT_INVENTORY,
    );
    expect(expectedTownPlacementInventory(true, 'polish-baseline').rebuild).toBe(
      EASTBROOK_TOWN_REBUILD_PLACEMENT_INVENTORY,
    );
    expect(expectedTownPlacementInventory(true, 'polish-v2').rebuild).toBe(
      EASTBROOK_TOWN_POLISH_V2_PLACEMENT_INVENTORY,
    );
    expect(EASTBROOK_TOWN_POLISH_V2_PLACEMENT_INVENTORY.stalls).toEqual([
      'eastbrook_market_stall_world_market',
      'eastbrook_market_stall_provisions',
    ]);

    const perfRaw = (triangles: number) => ({
      targetName: EASTBROOK_TOWN_ROOT_NAME,
      targetChildMeshes: 18,
      observed: {
        rootName: EASTBROOK_TOWN_ROOT_NAME,
        rootPresent: true,
        rootVisible: true,
        shadowMapEnabled: true,
        sunCastShadow: true,
      },
      drawStats: {
        colorDraws: 18,
        shadowDraws: 9,
        triangles,
        buildingCount: 6,
        wallBatchCount: 4,
        wallSegmentCount: 26,
        gateCount: 6,
      },
    });
    const assertPerf = (triangles: number, contractId?: string) =>
      assertTownPerformanceBlockState({
        raw: perfRaw(triangles),
        label: contractId ?? 'historical-direct-call',
        rootVisible: true,
        shadowEnabled: true,
        ...(contractId ? { contractId } : {}),
      });
    expect(() => assertPerf(29_644)).not.toThrow();
    expect(() => assertPerf(29_644, 'rebuild-v1')).not.toThrow();
    expect(() => assertPerf(29_644, 'polish-baseline')).not.toThrow();
    expect(() => assertPerf(28_330, 'polish-v2')).not.toThrow();
    expect(() => assertPerf(29_644, 'polish-v2')).toThrow('draw stats');
  });

  it('aims every added view at a collision-clear point beside its stable layout subject', () => {
    const subjectPoints = new Map<string, { x: number; z: number }>();
    for (const stall of EASTBROOK_LAYOUT.market.stalls) {
      subjectPoints.set(stall.id, stall.frontStandingPoint);
    }
    subjectPoints.set(EASTBROOK_LAYOUT.services.mailbox.id, {
      x: EASTBROOK_LAYOUT.services.mailbox.position.x,
      z: EASTBROOK_LAYOUT.services.mailbox.position.z + 1.3,
    });
    subjectPoints.set(
      EASTBROOK_LAYOUT.services.noticeboard.id,
      EASTBROOK_LAYOUT.services.noticeboard.frontStandingPoint,
    );
    subjectPoints.set(EASTBROOK_LAYOUT.civic.wellBeacon.id, {
      x: EASTBROOK_LAYOUT.civic.wellBeacon.position.x,
      z: EASTBROOK_LAYOUT.civic.wellBeacon.position.z - 2,
    });
    for (const npc of EASTBROOK_LAYOUT.services.npcs) {
      subjectPoints.set(npc.id, npc.position);
    }
    for (const view of EASTBROOK_TOWN_POLISH_CAPTURE_VIEWS) {
      const expected = subjectPoints.get(view.subject);
      expect(expected, view.name).toBeDefined();
      if (!expected) throw new Error(`missing subject point for ${view.name}`);
      expect(view.target.x, `${view.name}.target.x`).toBeCloseTo(expected.x, 2);
      expect(view.target.z, `${view.name}.target.z`).toBeCloseTo(expected.z, 2);
      expect(
        isBlocked(EASTBROOK_ARMOURY_CAPTURE_SEED, view.target.x, view.target.z, 0.5),
        `${view.name} target`,
      ).toBe(false);
      // The camera is an ELEVATED point: a low standable prop (a headstone, a
      // bench) whose top sits below the camera's altitude does not contain it.
      // Route the check through the height-aware resolver so only full-height
      // geometry and props reaching the camera's y count as blockers.
      const cameraResolved = resolvePosition(
        EASTBROOK_ARMOURY_CAPTURE_SEED,
        view.camera.x,
        view.camera.z,
        0.5,
        false,
        undefined,
        { y: view.camera.y, lift: 0 },
      );
      expect(
        Math.abs(cameraResolved.x - view.camera.x) > 1e-4 ||
          Math.abs(cameraResolved.z - view.camera.z) > 1e-4,
        `${view.name} camera`,
      ).toBe(false);
    }
  });

  it('pins public-facing NPC portraits at Lin, Saul, and FURY authored positions', () => {
    const expectedViews = {
      'apothecary-lin': {
        subject: 'apothecary_lin',
        camera: { x: 1.8, y: 6, z: 6 },
        target: { x: 2.8431593444121797, y: 2.5, z: 9.717148252611294 },
      },
      'ravenpost-chronicler': {
        subject: 'chronicler_saul',
        camera: { x: -10, y: 6.5, z: -11 },
        target: { x: 0, y: 2.5, z: -14.5 },
      },
      'west-wall-quartermaster': {
        subject: 'fury',
        camera: { x: -16, y: 6, z: -3 },
        target: { x: -22.5, y: 2.5, z: -7.5 },
      },
    };
    for (const [name, expected] of Object.entries(expectedViews)) {
      const view = EASTBROOK_TOWN_POLISH_CAPTURE_VIEWS.find(
        (candidate: { name: string }) => candidate.name === name,
      );
      const npc = EASTBROOK_LAYOUT.services.npcs.find(
        (candidate) => candidate.id === expected.subject,
      );
      expect(view, name).toEqual({ name, ...expected });
      expect(npc, expected.subject).toBeDefined();
      if (!view || !npc) throw new Error(`missing portrait contract ${name}`);
      expect({ x: view.target.x, z: view.target.z }).toEqual(npc.position);
      const cameraOffset = {
        x: view.camera.x - npc.position.x,
        z: view.camera.z - npc.position.z,
      };
      expect(
        cameraOffset.x * Math.sin(npc.facing) + cameraOffset.z * Math.cos(npc.facing),
        `${name} camera must remain on the NPC's public-facing side`,
      ).toBeGreaterThan(0);
    }
  });

  it('photographs the Ravenpost mailbox from its authored public +Z face', () => {
    const view = EASTBROOK_TOWN_POLISH_CAPTURE_VIEWS.find(
      (candidate: { name: string }) => candidate.name === 'ravenpost-mailbox',
    );
    expect(view).toBeDefined();
    if (!view) throw new Error('missing Ravenpost mailbox capture view');
    const mailbox = EASTBROOK_LAYOUT.services.mailbox;
    const authoredPublicFront = {
      x: view.target.x - mailbox.position.x,
      z: view.target.z - mailbox.position.z,
    };
    const cameraSide = {
      x: view.camera.x - mailbox.position.x,
      z: view.camera.z - mailbox.position.z,
    };
    expect(
      authoredPublicFront.x * cameraSide.x + authoredPublicFront.z * cameraSide.z,
      'mailbox camera must remain on the public/front side',
    ).toBeGreaterThan(0);
  });

  it('selects polish evidence explicitly without changing the historical default', () => {
    const baseEnv = {
      GAME_URL: 'http://127.0.0.1:5183',
      SHOT_PREFIX: 'polish',
      EXPECT_ARMOURY: '1',
      CAPTURE_SCOPE: 'town',
      EXPECT_TOWN: '1',
    };
    const rebuild = selectCaptureConfiguration(baseEnv);
    expect(rebuild.townContractId).toBe('rebuild-v1');
    expect(rebuild.views).toEqual(EASTBROOK_TOWN_CAPTURE_VIEWS);

    const polish = selectCaptureConfiguration({
      ...baseEnv,
      TOWN_CONTRACT: 'polish-v2',
    });
    expect(polish.townContractId).toBe('polish-v2');
    expect(polish.townContract).toBe(EASTBROOK_TOWN_CAPTURE_CONTRACTS['polish-v2']);
    expect(polish.views).toEqual(EASTBROOK_TOWN_POLISH_MATCHED_CAPTURE_VIEWS);
    const baseline = selectCaptureConfiguration({
      ...baseEnv,
      TOWN_CONTRACT: 'polish-baseline',
    });
    expect(baseline.townContractId).toBe('polish-baseline');
    expect(baseline.sourceRevision).toBe(EASTBROOK_POLISH_BASELINE_REVISION);
    expect(baseline.views).toEqual(polish.views);
    expect(
      baseline.views.map((view: { name: string; camera: object; target: object }) => ({
        name: view.name,
        camera: view.camera,
        target: view.target,
      })),
    ).toEqual(
      polish.views.map((view: { name: string; camera: object; target: object }) => ({
        name: view.name,
        camera: view.camera,
        target: view.target,
      })),
    );
    expect(() => selectCaptureConfiguration({ ...baseEnv, TOWN_CONTRACT: 'polish-v3' })).toThrow(
      'TOWN_CONTRACT must be rebuild-v1, polish-baseline, or polish-v2',
    );
    expect(() =>
      selectCaptureConfiguration({
        ...baseEnv,
        EXPECT_TOWN: '0',
        TOWN_CONTRACT: 'polish-v2',
      }),
    ).toThrow('TOWN_CONTRACT requires EXPECT_TOWN=1');
    expect(() =>
      selectCaptureConfiguration({
        ...baseEnv,
        CAPTURE_SCOPE: 'armoury',
        TOWN_CONTRACT: 'polish-v2',
      }),
    ).toThrow('TOWN_CONTRACT requires EXPECT_TOWN=1 with CAPTURE_SCOPE=town');
  });

  it('requires stable layout/template attribution records and excludes transient entity ids', () => {
    const targets = validPolishAttributionTargets();
    const assertTargets = (candidate: AttributionTargetFixture[]) =>
      assertTownAttributionTargetState({
        targets: candidate,
        contractId: 'polish-v2',
        requestedVisible: false,
      });
    expect(() => assertTargets(targets)).not.toThrow();
    expect(JSON.stringify(targets)).not.toContain('entityId');

    const failures: Array<[string, string, (candidate: AttributionTargetFixture[]) => void]> = [
      ['key', 'stable layout ids', (candidate) => (candidate[1].key = 'wrong-mailbox')],
      ['kind', 'stable layout ids', (candidate) => (candidate[1].kind = 'scene-root')],
      [
        'layoutId',
        'stable layout ids',
        (candidate) => (candidate[1].layoutId = 'eastbrook_civic_layout_v1'),
      ],
      [
        'templateId',
        'stable layout ids',
        (candidate) => (candidate[1].templateId = 'wrong-mailbox-template'),
      ],
      [
        'layoutServiceId',
        'stable layout ids',
        (candidate) => (candidate[1].layoutServiceId = 'wrong-mailbox-service'),
      ],
      ['present', 'visibility is incorrect', (candidate) => (candidate[1].present = false)],
      [
        'childMeshCount',
        'has no shipping meshes',
        (candidate) => (candidate[1].childMeshCount = 0),
      ],
      [
        'non-integer childMeshCount',
        'has no shipping meshes',
        (candidate) => (candidate[1].childMeshCount = 1.5),
      ],
      [
        'atlas URL',
        'lacks the shared atlas',
        (candidate) => (candidate[1].surfaceAtlas.url = '/textures/wrong.webp'),
      ],
      [
        'empty atlas UUID',
        'lacks the shared atlas',
        (candidate) => (candidate[1].surfaceAtlas.textureUuid = ''),
      ],
      [
        'non-string atlas UUID',
        'lacks the shared atlas',
        (candidate) => (candidate[1].surfaceAtlas.textureUuid = 7 as unknown as string),
      ],
      [
        'atlas bindings',
        'lacks the shared atlas',
        (candidate) => (candidate[1].surfaceAtlas.materialBindings = 0),
      ],
      [
        'non-integer atlas bindings',
        'lacks the shared atlas',
        (candidate) => (candidate[1].surfaceAtlas.materialBindings = 1.5),
      ],
    ];
    for (const [label, message, mutate] of failures) {
      const changed = validPolishAttributionTargets();
      mutate(changed);
      expect(() => assertTargets(changed), label).toThrow(message);
    }

    const missing = validPolishAttributionTargets();
    missing.pop();
    expect(() => assertTargets(missing)).toThrow('attribution target inventory');
    expect(() =>
      assertTownAttributionTargetState({
        targets: null,
        contractId: 'polish-v2',
        requestedVisible: false,
      }),
    ).toThrow('attribution target inventory');
    const transient = validPolishAttributionTargets() as unknown as Array<Record<string, unknown>>;
    transient[1].entityId = 301;
    expect(() =>
      assertTownAttributionTargetState({
        targets: transient,
        contractId: 'polish-v2',
        requestedVisible: false,
      }),
    ).toThrow('transient entity ids');
    const unsharedAtlas = validPolishAttributionTargets();
    unsharedAtlas[2].surfaceAtlas.textureUuid = 'different-atlas';
    expect(() => assertTargets(unsharedAtlas)).toThrow('share one atlas texture identity');
  });

  it('validates NPC-facing arrows as stable layout records', () => {
    const overlay = validNpcFacingOverlay();
    type Overlay = ReturnType<typeof validNpcFacingOverlay>;
    const assertOverlay = (candidate: Overlay) =>
      assertTownNpcFacingOverlay({ overlay: candidate, contractId: 'polish-v2' });
    expect(() => assertTownNpcFacingOverlay({ overlay, contractId: 'polish-v2' })).not.toThrow();

    const failures: Array<[string, string, (candidate: Overlay) => void]> = [
      [
        'requested',
        'require the requested collider overlay',
        (candidate) => (candidate.requested = false),
      ],
      [
        'source layout',
        'arrow inventory is incomplete',
        (candidate) => (candidate.npcFacings.sourceLayoutId = 'eastbrook_civic_layout_v1'),
      ],
      [
        'arrow length',
        'arrow inventory is incomplete',
        (candidate) => (candidate.npcFacings.arrowLength = 0),
      ],
      [
        'non-finite arrow length',
        'arrow inventory is incomplete',
        (candidate) => (candidate.npcFacings.arrowLength = Number.POSITIVE_INFINITY),
      ],
      [
        'empty records',
        'arrow inventory is incomplete',
        (candidate) => (candidate.npcFacings.records = []),
      ],
      [
        'records non-array',
        'arrow inventory is incomplete',
        (candidate) =>
          (candidate.npcFacings.records = null as unknown as ReturnType<
            typeof validNpcFacingOverlay
          >['npcFacings']['records']),
      ],
      [
        'duplicate ids',
        'contains invalid records',
        (candidate) => (candidate.npcFacings.records[1].id = candidate.npcFacings.records[0].id),
      ],
      [
        'empty id',
        'contains invalid records',
        (candidate) => (candidate.npcFacings.records[0].id = ''),
      ],
      [
        'non-string id',
        'contains invalid records',
        (candidate) => (candidate.npcFacings.records[0].id = 7 as unknown as string),
      ],
      [
        'position.x',
        'contains invalid records',
        (candidate) => (candidate.npcFacings.records[0].position.x = Number.NaN),
      ],
      [
        'position.z',
        'contains invalid records',
        (candidate) => (candidate.npcFacings.records[0].position.z = Number.POSITIVE_INFINITY),
      ],
      [
        'end.x',
        'contains invalid records',
        (candidate) => (candidate.npcFacings.records[0].end.x = Number.NaN),
      ],
      [
        'end.z',
        'contains invalid records',
        (candidate) => (candidate.npcFacings.records[0].end.z = Number.NEGATIVE_INFINITY),
      ],
      [
        'facing',
        'contains invalid records',
        (candidate) => (candidate.npcFacings.records[0].facing = Number.NaN),
      ],
    ];
    for (const [label, message, mutate] of failures) {
      const changed = validNpcFacingOverlay();
      mutate(changed);
      expect(() => assertOverlay(changed), label).toThrow(message);
    }

    const badEnd = structuredClone(overlay);
    badEnd.npcFacings.records[0].end.x += 0.2;
    expect(() => assertOverlay(badEnd)).toThrow('facing arrow endpoint');
    const badEndZ = structuredClone(overlay);
    badEndZ.npcFacings.records[0].end.z += 0.2;
    expect(() => assertOverlay(badEndZ)).toThrow('facing arrow endpoint');
    const transient = structuredClone(overlay) as typeof overlay & {
      npcFacings: { records: Array<Record<string, unknown>> };
    };
    transient.npcFacings.records[0].entityId = 92;
    expect(() =>
      assertTownNpcFacingOverlay({
        overlay: transient,
        contractId: 'polish-v2',
      }),
    ).toThrow('transient entity ids');
  });

  it('pins paired motion-on frames and a paired reduced-motion proof', () => {
    expect(EASTBROOK_TOWN_MOTION_CAPTURE).toEqual({
      viewName: 'civic-motion',
      frameIntervalMs: 1_600,
      beacon: {
        rootName: EASTBROOK_TOWN_ROOT_NAME,
        batchName: 'eastbrookTownMicroEmissiveBatch',
        maskAttribute: 'eastbrookCivicMask',
        programCacheKey: 'eastbrook-civic-beacon-v1',
      },
      modes: [
        { id: 'motion-on', reduceMotion: false },
        { id: 'reduced-motion', reduceMotion: true },
      ],
    });
    const evidence = validTownMotionEvidence();
    type Evidence = ReturnType<typeof validTownMotionEvidence>;
    const assertEvidence = (candidate: Evidence) =>
      assertTownMotionEvidence({ evidence: candidate, contractId: 'polish-v2' });
    expect(() => assertTownMotionEvidence({ evidence, contractId: 'polish-v2' })).not.toThrow();

    const failures: Array<[string, string, (candidate: Evidence) => void]> = [
      [
        'view',
        'civic motion evidence is incomplete',
        (candidate) => (candidate.viewName = 'noticeboard'),
      ],
      [
        'interval',
        'civic motion evidence is incomplete',
        (candidate) => (candidate.frameIntervalMs = 1_599),
      ],
      [
        'beacon identity',
        'civic motion evidence is incomplete',
        (candidate) => (candidate.beacon.batchName = 'wrongBeaconBatch'),
      ],
      [
        'beacon root',
        'civic motion evidence is incomplete',
        (candidate) => (candidate.beacon.rootName = 'wrongTownRoot'),
      ],
      [
        'beacon mask',
        'civic motion evidence is incomplete',
        (candidate) => (candidate.beacon.maskAttribute = 'wrongMask'),
      ],
      [
        'beacon program',
        'civic motion evidence is incomplete',
        (candidate) => (candidate.beacon.programCacheKey = 'wrong-program'),
      ],
      [
        'contact runtime mode',
        'civic motion evidence is incomplete',
        (candidate) => (candidate.contact.defaultRuntimeReduceMotion = false),
      ],
      [
        'contact output',
        'civic motion evidence is incomplete',
        (candidate) => (candidate.contact.defaultReducedMotionOutput = '/tmp/contact.webp'),
      ],
      [
        'non-string contact output',
        'civic motion evidence is incomplete',
        (candidate) => (candidate.contact.defaultReducedMotionOutput = 7 as unknown as string),
      ],
      [
        'contact frame count',
        'civic motion evidence is incomplete',
        (candidate) => (candidate.contact.pairedFrameCount = 3),
      ],
      ['mode count', 'civic motion evidence is incomplete', (candidate) => candidate.modes.pop()],
      [
        'modes non-array',
        'civic motion evidence is incomplete',
        (candidate) =>
          (candidate.modes = null as unknown as ReturnType<
            typeof validTownMotionEvidence
          >['modes']),
      ],
      [
        'mode identity',
        'motion-on runtime reduce-motion state',
        (candidate) => (candidate.modes[0].id = 'wrong-mode'),
      ],
      [
        'mode runtime state',
        'motion-on runtime reduce-motion state',
        (candidate) => (candidate.modes[0].runtimeReduceMotion = true),
      ],
      [
        'second mode runtime state',
        'reduced-motion runtime reduce-motion state',
        (candidate) => (candidate.modes[1].runtimeReduceMotion = false),
      ],
      [
        'frame count',
        'paired frame evidence is incomplete',
        (candidate) => candidate.modes[0].frames.pop(),
      ],
      [
        'frames non-array',
        'paired frame evidence is incomplete',
        (candidate) =>
          (candidate.modes[0].frames = null as unknown as ReturnType<
            typeof validTownMotionEvidence
          >['modes'][number]['frames']),
      ],
      [
        'frame phase',
        'paired frame evidence is incomplete',
        (candidate) => (candidate.modes[0].frames[0].phase = 't1'),
      ],
      [
        't1 frame phase',
        'paired frame evidence is incomplete',
        (candidate) => (candidate.modes[0].frames[1].phase = 't0'),
      ],
      [
        'frame output',
        'paired frame evidence is incomplete',
        (candidate) => (candidate.modes[0].frames[0].output = '/tmp/frame.webp'),
      ],
      [
        'non-string frame output',
        'paired frame evidence is incomplete',
        (candidate) => (candidate.modes[0].frames[0].output = 7 as unknown as string),
      ],
      [
        'frame bytes',
        'paired frame evidence is incomplete',
        (candidate) => (candidate.modes[0].frames[0].bytes = 0),
      ],
      [
        'non-integer frame bytes',
        'paired frame evidence is incomplete',
        (candidate) => (candidate.modes[0].frames[0].bytes = 1.5),
      ],
      [
        'frame SHA',
        'paired frame evidence is incomplete',
        (candidate) => (candidate.modes[0].frames[0].sha256 = 'not-a-sha'),
      ],
      [
        'reduced-motion cleanup',
        'civic motion evidence is incomplete',
        (candidate) => (candidate.restored = false),
      ],
    ];
    for (const [label, message, mutate] of failures) {
      const changed = validTownMotionEvidence();
      mutate(changed);
      expect(() => assertEvidence(changed), label).toThrow(message);
    }

    expect(() =>
      assertTownMotionEvidence({ evidence: null, contractId: 'rebuild-v1' }),
    ).not.toThrow();
    expect(() =>
      assertTownMotionEvidence({
        evidence: null,
        contractId: 'polish-baseline',
      }),
    ).not.toThrow();
    expect(() =>
      assertTownMotionEvidence({
        evidence: validTownMotionEvidence(),
        contractId: 'polish-baseline',
      }),
    ).toThrow('motion evidence must be absent');
  });

  it('wires stable targets, facing arrows, motion pairs, and contract metadata into the helper', async () => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(
      new URL('../scripts/assets/eastbrook_grand_armoury/capture_ingame.mjs', import.meta.url),
      'utf8',
    );
    for (const call of [
      'resolveTownContractTargets(page)',
      'readTownPlacementInventory(page, townContractId)',
      'assertTownAttributionTargetState({',
      'assertTownNpcFacingOverlay({ overlay, contractId: townContractId })',
      'captureTownMotionEvidence(',
      'assertTownMotionEvidence({ evidence, contractId: townContractId })',
      'const objectBody = view?.objectMesh ?? null;',
      'const body = view?.objectMesh;',
      'target.root.visible = requestedRootVisible',
      'npcFacings:',
      'polishProvenance',
      'deriveEastbrookPolishCompositeProvenance({',
      'TOWN_CONTRACT',
    ]) {
      expect(source, call).toContain(call);
    }
    expect(source).not.toContain('renderer.views.get(ref.entityId)?.group');
    expect(source).not.toMatch(/renderer\.views\.get\(\d+\)/);

    const metadataAssertionAt = source.indexOf('assertTownCaptureMetadata({');
    const metadataAssertionEnd = source.indexOf('\n          });', metadataAssertionAt);
    const metadataAssertion = source.slice(metadataAssertionAt, metadataAssertionEnd);
    expect(metadataAssertionAt).toBeGreaterThan(-1);
    expect(metadataAssertionEnd).toBeGreaterThan(metadataAssertionAt);
    expect(metadataAssertion).toContain('contractId: townContractId,');
    expect(metadataAssertion).toContain('expectedPolishProvenance: polishProvenance,');

    expect(source).toContain(
      'const measurement = await measureTownScenario(page, assetFailures, townContractId);',
    );
    const measureAt = source.indexOf('async function measureTownScenario(');
    const measureEnd = source.indexOf('\nasync function measurePerformance(', measureAt);
    const measureBlock = source.slice(measureAt, measureEnd);
    expect(measureAt).toBeGreaterThan(-1);
    expect(measureEnd).toBeGreaterThan(measureAt);
    expect(measureBlock).toContain('attributionRefs: attribution.refs,\n              contractId,');
    expect(measureBlock).toContain(
      'await measureTownDirectRenderAttribution(page, attribution.refs, contractId)',
    );
  });
});
