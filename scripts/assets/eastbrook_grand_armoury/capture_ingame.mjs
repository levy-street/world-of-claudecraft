// Capture matched in-game evidence and optional A/B performance measurements for
// the Eastbrook Grand Armoury from a running World of ClaudeCraft client.
//
// Required environment variables:
//   GAME_URL        Base URL of the running worktree, such as http://127.0.0.1:5184
//   SHOT_PREFIX     Output prefix, normally before or after
//   EXPECT_ARMOURY  0 for the release base, 1 for the feature worktree
//
// Optional environment variables:
//   OUT_DIR         Screenshot directory; defaults to docs/screenshots/eastbrook-grand-armoury
//   CAPTURE_SCOPE   armoury (default) or town
//   EXPECT_TOWN     strict town-root expectation, 0 for PR 2356 or 1 for rebuild
//   TOWN_CONTRACT   rebuild-v1 (default), polish-baseline, or polish-v2;
//                   requires EXPECT_TOWN=1
//   PROFILE_NAME    desktop-ultra or mobile-low; omit to capture both
//   VIEW_NAME       one scope-specific view; omit to capture every view
//   MEASURE_PERF    1 to record warmed actual-game A/B blocks
//   PERF_OUT        Performance JSON path; town requires PROFILE_NAME when explicit
//   METADATA_OUT    Town metadata JSON path; requires PROFILE_NAME when capturing both
//   SOURCE_REVISION Exact served revision/source id for evidence provenance
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH } from '../../browser_path.mjs';
import { enterOfflineGame } from '../../enter_offline_game.mjs';
import { suppressGpuNotice } from '../../lib/gpu_notice_suppress.mjs';
import { frameStats, normalizeReport } from '../../profiler/metrics.mjs';
import { eastbrookMailboxSourceFingerprint } from '../eastbrook_mailbox/source_fingerprint.mjs';
import { eastbrookNoticeboardSourceFingerprint } from '../eastbrook_noticeboard/source_fingerprint.mjs';
import { eastbrookTownSourceFingerprint } from '../eastbrook_town/source_fingerprint.mjs';
import {
  assertArmouryPerformanceContract,
  assertCaptureCleanupState,
  assertCaptureRenderState,
  assertMatchedLotIdentity,
  assertNoCaptureErrors,
  assertPerformanceBlockState,
  assertPerformanceStateRestored,
  assertTownArmouryIdentity,
  assertTownAttributionTargetState,
  assertTownBaselinePerformanceBlockState,
  assertTownCaptureMetadata,
  assertTownMotionEvidence,
  assertTownNpcFacingOverlay,
  assertTownPerformanceBlockState,
  deriveArmouryPerformanceDeltas,
  deriveEastbrookPolishCompositeProvenance,
  deriveTownPerformanceDeltas,
  EASTBROOK_ARMOURY_CAPTURE_SEED,
  EASTBROOK_ARMOURY_PLAYER_STATE,
  EASTBROOK_POLISH_PROVENANCE_INPUTS,
  EASTBROOK_TOWN_CAPTURE_TIMING,
  EASTBROOK_TOWN_CAPTURE_VIEWS,
  EASTBROOK_TOWN_MOTION_CAPTURE,
  EASTBROOK_TOWN_NEW_ASSET_URLS,
  EASTBROOK_TOWN_ROOT_NAME,
  EASTBROOK_TOWN_SURFACE_ATLAS_URL,
  expectedCaptureEnvironmentError,
  expectedCaptureProxyConsoleError,
  expectedCaptureProxyConsoleSource,
  expectedCaptureProxyResponse,
  expectedTownPlacementInventory,
  median,
  round,
  selectCaptureConfiguration,
  summarizePerformanceEvidence,
} from './capture_contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const captureConfig = selectCaptureConfiguration(process.env);
const GAME_URL = captureConfig.gameUrl;
const SHOT_PREFIX = captureConfig.shotPrefix;
const captureScope = captureConfig.captureScope;
const expectedTown = captureConfig.expectedTown;
const townContractId = captureConfig.townContractId;
const townContract = captureConfig.townContract;
const townOutputSegment =
  townContractId === 'polish-v2'
    ? 'polish'
    : townContractId === 'polish-baseline'
      ? 'polish-baseline'
      : expectedTown === true
        ? 'after'
        : expectedTown === false
          ? 'before'
          : 'exploratory';
const TOWN_EVIDENCE_ROOT = path.join(ROOT, 'docs/screenshots/eastbrook-vale-rebuild');
const OUT_DIR = path.resolve(
  process.env.OUT_DIR ??
    (captureScope === 'town'
      ? path.join(TOWN_EVIDENCE_ROOT, townOutputSegment)
      : path.join(ROOT, 'docs/screenshots/eastbrook-grand-armoury')),
);
const MEASURE_PERF = captureConfig.measurePerf;
const EXPECTED_SEED = EASTBROOK_ARMOURY_CAPTURE_SEED;
const CHARACTER_CLASS = 'warrior';
const CHARACTER_NAME = 'Armourist';
const PLAYER_STATE = EASTBROOK_ARMOURY_PLAYER_STATE;
const PERF_WARMUP_MS = EASTBROOK_TOWN_CAPTURE_TIMING.perfWarmupMs;
const PERF_SAMPLE_MS = EASTBROOK_TOWN_CAPTURE_TIMING.perfSampleMs;
const PERF_REPEATS = EASTBROOK_TOWN_CAPTURE_TIMING.perfRepeats;

const expectedArmoury = captureConfig.expectedArmoury;
const profiles = captureConfig.profiles;
const views = captureConfig.views;
const perfScenarios = captureConfig.perfScenarios;
const sourceRevision = captureConfig.sourceRevision;
const captureAssetUrls = townContract?.assetUrls ?? EASTBROOK_TOWN_NEW_ASSET_URLS;
const townSourceFingerprint =
  captureScope === 'town' && expectedTown === true ? eastbrookTownSourceFingerprint(ROOT) : null;
const sha256RepoFile = (relativePath) =>
  createHash('sha256')
    .update(readFileSync(path.join(ROOT, relativePath)))
    .digest('hex');
const polishProvenance =
  townContract?.polishProvenance?.mode === 'baseline-revision'
    ? {
        schemaVersion: 1,
        mode: 'baseline-revision',
        baselineRevision: townContract.polishProvenance.baselineRevision,
      }
    : townContract?.polishProvenance?.mode === 'composite-sha256'
      ? deriveEastbrookPolishCompositeProvenance({
          townAssetSourceFingerprint: townSourceFingerprint,
          authoritativeLayoutSha256: sha256RepoFile(
            EASTBROOK_POLISH_PROVENANCE_INPUTS.authoritativeLayout,
          ),
          civicShaderSha256: sha256RepoFile(EASTBROOK_POLISH_PROVENANCE_INPUTS.civicShader),
          townRuntimeSha256: sha256RepoFile(EASTBROOK_POLISH_PROVENANCE_INPUTS.townRuntime),
          mailboxRuntimeSha256: sha256RepoFile(EASTBROOK_POLISH_PROVENANCE_INPUTS.mailboxRuntime),
          noticeboardRuntimeSha256: sha256RepoFile(
            EASTBROOK_POLISH_PROVENANCE_INPUTS.noticeboardRuntime,
          ),
          rendererIntegrationSha256: sha256RepoFile(
            EASTBROOK_POLISH_PROVENANCE_INPUTS.rendererIntegration,
          ),
          viewPriorityPolicySha256: sha256RepoFile(
            EASTBROOK_POLISH_PROVENANCE_INPUTS.viewPriorityPolicy,
          ),
          mailboxSourceFingerprint: eastbrookMailboxSourceFingerprint(ROOT),
          mailboxGlbSha256: sha256RepoFile(EASTBROOK_POLISH_PROVENANCE_INPUTS.mailboxGlb),
          noticeboardSourceFingerprint: eastbrookNoticeboardSourceFingerprint(ROOT),
          noticeboardGlbSha256: sha256RepoFile(EASTBROOK_POLISH_PROVENANCE_INPUTS.noticeboardGlb),
        })
      : null;

mkdirSync(OUT_DIR, { recursive: true });

function townPerformanceOutputPath(profileName) {
  if (process.env.PERF_OUT) return path.resolve(process.env.PERF_OUT);
  if (captureScope !== 'town') {
    return path.join(OUT_DIR, `${SHOT_PREFIX ?? 'capture'}-performance.json`);
  }
  return path.join(
    TOWN_EVIDENCE_ROOT,
    'performance',
    `${SHOT_PREFIX ?? 'capture'}-${profileName}-town.json`,
  );
}

function townMetadataOutputPath(profileName) {
  if (process.env.METADATA_OUT) return path.resolve(process.env.METADATA_OUT);
  return path.join(
    TOWN_EVIDENCE_ROOT,
    'metadata',
    `${SHOT_PREFIX ?? 'capture'}-${profileName}-town.json`,
  );
}

function writeCaptureMetadata(profileName, records) {
  const metadataOutput = townMetadataOutputPath(profileName);
  mkdirSync(path.dirname(metadataOutput), { recursive: true });
  writeFileSync(
    metadataOutput,
    `${JSON.stringify(
      {
        schemaVersion: 2,
        captureScope: 'town',
        shotPrefix: SHOT_PREFIX,
        profile: profileName,
        townContractId,
        sourceRevision,
        sourceFingerprint: townSourceFingerprint,
        polishProvenance,
        records,
      },
      null,
      2,
    )}\n`,
  );
  return metadataOutput;
}

function captureAssetUrlForNetwork(requestUrl) {
  const candidates = [...captureAssetUrls, EASTBROOK_TOWN_SURFACE_ATLAS_URL];
  return (
    candidates.find((assetUrl) => {
      const extension = path.extname(assetUrl);
      const stem = path.basename(assetUrl, extension);
      return requestUrl.includes(`/${stem}${extension}`) || requestUrl.includes(`/${stem}.`);
    }) ?? null
  );
}

function observedTownAssetStates(
  renderState,
  successfulAssetResponses,
  assetFailures,
  assetUrls = EASTBROOK_TOWN_NEW_ASSET_URLS,
) {
  const loadedFromRoot = new Set(renderState.townRoot.newAssetUrls);
  return assetUrls.map((url) => ({
    url,
    state: assetFailures.some((failure) => failure.assetUrl === url)
      ? 'failed'
      : loadedFromRoot.has(url) || successfulAssetResponses.has(url)
        ? 'loaded'
        : 'not-requested',
  }));
}

async function resolveTownContractTargets(page) {
  if (!townContract) return { refs: [], targets: [] };
  return page.evaluate(async (contract) => {
    const game = window.__game;
    const renderer = game?.renderer;
    if (!game?.sim?.entities || !renderer?.views) {
      throw new Error('town attribution requires the offline entity roster and renderer views');
    }
    const { EASTBROOK_LAYOUT } = await import('/src/sim/eastbrook_layout.ts');
    if (EASTBROOK_LAYOUT.id !== contract.layoutId) {
      throw new Error(
        `town contract ${contract.id} expected layout ${contract.layoutId}, got ${EASTBROOK_LAYOUT.id}`,
      );
    }
    const refs = [];
    const targets = [];
    const meshCount = (root) => {
      let count = 0;
      root?.traverse((object) => {
        if (object.isMesh) count++;
      });
      return count;
    };
    const surfaceAtlas = (root) => {
      const record = root?.userData?.eastbrookSurfaceAtlas;
      return record
        ? {
            url: record.url ?? null,
            textureUuid: record.textureUuid ?? null,
            materialBindings: record.materialBindings ?? null,
          }
        : null;
    };
    for (const descriptor of contract.attributionTargets) {
      if (descriptor.kind === 'scene-root') {
        const root = renderer.scene.getObjectByName(descriptor.rootName);
        refs.push({
          key: descriptor.key,
          kind: descriptor.kind,
          rootName: descriptor.rootName,
          layoutId: EASTBROOK_LAYOUT.id,
          layoutServiceId: null,
          templateId: null,
          surfaceAtlas: surfaceAtlas(root),
        });
        targets.push({
          key: descriptor.key,
          kind: descriptor.kind,
          rootName: descriptor.rootName,
          layoutId: EASTBROOK_LAYOUT.id,
          layoutServiceId: null,
          templateId: null,
          present: !!root,
          visible: root?.visible ?? null,
          childMeshCount: meshCount(root),
          surfaceAtlas: surfaceAtlas(root),
        });
        continue;
      }
      const service = EASTBROOK_LAYOUT.services[descriptor.layoutServiceKey];
      if (
        service?.id !== descriptor.layoutServiceId ||
        service.templateId !== descriptor.templateId
      ) {
        throw new Error(`town contract ${contract.id} has stale ${descriptor.key} layout ids`);
      }
      const entity = [...game.sim.entities.values()].find(
        (candidate) =>
          candidate.kind === 'object' &&
          candidate.templateId === descriptor.templateId &&
          Math.abs(candidate.pos.x - service.position.x) < 1e-6 &&
          Math.abs(candidate.pos.z - service.position.z) < 1e-6,
      );
      const view = entity ? renderer.views.get(entity.id) : null;
      const objectBody = view?.objectMesh ?? null;
      const namedBody = descriptor.runtimeBodyName
        ? objectBody?.name === descriptor.runtimeBodyName
          ? objectBody
          : objectBody?.getObjectByName(descriptor.runtimeBodyName)
        : objectBody;
      refs.push({
        key: descriptor.key,
        kind: descriptor.kind,
        rootName: descriptor.runtimeBodyName ?? `layout-entity:${descriptor.key}`,
        layoutId: EASTBROOK_LAYOUT.id,
        layoutServiceId: service.id,
        templateId: service.templateId,
        surfaceAtlas: surfaceAtlas(namedBody),
        entityId: entity?.id ?? null,
        runtimeBodyName: descriptor.runtimeBodyName ?? null,
      });
      targets.push({
        key: descriptor.key,
        kind: descriptor.kind,
        rootName: descriptor.runtimeBodyName ?? `layout-entity:${descriptor.key}`,
        layoutId: EASTBROOK_LAYOUT.id,
        layoutServiceId: service.id,
        templateId: service.templateId,
        present: !!namedBody,
        visible: namedBody?.visible ?? null,
        childMeshCount: meshCount(namedBody),
        surfaceAtlas: surfaceAtlas(namedBody),
      });
    }
    return { refs, targets };
  }, townContract);
}

function summarizePerfBlock(raw) {
  const evidence = summarizePerformanceEvidence({
    samples: raw.samples,
    rafDeltasMs: raw.rafDeltasMs,
    report: raw.report,
    assetFailures: raw.assetFailures ?? [],
  });
  return {
    label: raw.label,
    armouryChildMeshes: raw.armouryChildMeshes,
    ...(raw.targetName
      ? {
          targetName: raw.targetName,
          targetChildMeshes: raw.targetChildMeshes,
          drawStats: raw.drawStats,
          targets: raw.targets ?? [],
        }
      : {}),
    requested: raw.requested,
    observed: raw.observed,
    ...evidence,
    rafFrameIntervalStats: frameStats(raw.rafDeltasMs, 60),
    perfReportSummary: normalizeReport(raw.report),
  };
}

function summarizePerfCondition(blocks) {
  const summaries = blocks.map((block) => block.summary);
  return {
    blocks: summaries.length,
    renderMedian: {
      calls: round(median(summaries.map((summary) => summary.renderMedian.calls))),
      shadowDraws: round(median(summaries.map((summary) => summary.renderMedian.shadowDraws))),
      triangles: round(median(summaries.map((summary) => summary.renderMedian.triangles))),
      lines: round(median(summaries.map((summary) => summary.renderMedian.lines))),
      points: round(median(summaries.map((summary) => summary.renderMedian.points))),
      cpuSubmitMs: round(median(summaries.map((summary) => summary.renderMedian.cpuSubmitMs))),
    },
    renderWorst: {
      calls: Math.max(...summaries.map((summary) => summary.renderWorst.calls)),
      shadowDraws: Math.max(...summaries.map((summary) => summary.renderWorst.shadowDraws)),
      triangles: Math.max(...summaries.map((summary) => summary.renderWorst.triangles)),
      lines: Math.max(...summaries.map((summary) => summary.renderWorst.lines)),
      points: Math.max(...summaries.map((summary) => summary.renderWorst.points)),
      cpuSubmitMs: Math.max(...summaries.map((summary) => summary.renderWorst.cpuSubmitMs)),
    },
    resourcesMedian: {
      geometries: round(median(summaries.map((summary) => summary.resourcesMedian.geometries))),
      textures: round(median(summaries.map((summary) => summary.resourcesMedian.textures))),
      programs: round(median(summaries.map((summary) => summary.resourcesMedian.programs))),
      heapUsedMb: round(median(summaries.map((summary) => summary.resourcesMedian.heapUsedMb))),
    },
    resourcesWorst: {
      geometries: Math.max(...summaries.map((summary) => summary.resourcesWorst.geometries)),
      textures: Math.max(...summaries.map((summary) => summary.resourcesWorst.textures)),
      programs: Math.max(...summaries.map((summary) => summary.resourcesWorst.programs)),
      heapUsedMb: Math.max(...summaries.map((summary) => summary.resourcesWorst.heapUsedMb)),
    },
    rafFrameIntervalStats: frameStats(
      blocks.flatMap((block) => block.rafDeltasMs),
      60,
    ),
    cpuSubmitMsMedian: round(median(summaries.map((summary) => summary.renderMedian.cpuSubmitMs))),
  };
}

async function stageView(page, view) {
  return page.evaluate(
    async ({ expectedSeed, playerState, viewState, requestedScope }) => {
      const game = window.__game;
      if (!game?.sim?.player || !game.renderer) throw new Error('game runtime is unavailable');
      if (game.sim.cfg.seed !== expectedSeed) {
        throw new Error(`expected world seed ${expectedSeed}, got ${game.sim.cfg.seed}`);
      }
      const [{ isBlocked }, { groundHeight }, { ZONE1_PROPS }] = await Promise.all([
        import('/src/sim/colliders.ts'),
        import('/src/sim/world.ts'),
        import('/src/sim/content/zone1.ts'),
      ]);
      if (isBlocked(expectedSeed, playerState.x, playerState.z, 0.5)) {
        throw new Error('matched capture player anchor is blocked at body radius 0.5');
      }
      if (isBlocked(expectedSeed, viewState.target.x, viewState.target.z, 0)) {
        throw new Error(`matched ${viewState.name} camera target is inside a collider`);
      }
      const player = game.sim.player;
      const playerY = groundHeight(playerState.x, playerState.z, expectedSeed);
      player.pos.x = playerState.x;
      player.pos.y = playerY;
      player.pos.z = playerState.z;
      player.prevPos.x = player.pos.x;
      player.prevPos.y = player.pos.y;
      player.prevPos.z = player.pos.z;
      player.facing = playerState.facing;
      player.dead = false;
      player.hp = player.maxHp = 999999;
      game.input?.clearTouchMove?.();
      game.input?.setTouchLook?.(false);

      const vector = (value) =>
        game.renderer.camera.position.clone().set(value.x, value.y, value.z);
      game.renderer.editorCam = {
        pos: vector(viewState.camera),
        target: vector(viewState.target),
      };
      // Apply the editor pose immediately as well as through the next render
      // tick. Headless mobile pages can briefly throttle rAF during startup;
      // without this assignment the integrity read can observe the stale chase
      // camera even though editorCam is already correct.
      game.renderer.camera.position.copy(game.renderer.editorCam.pos);
      game.renderer.cameraLookAt.copy(game.renderer.editorCam.target);
      game.renderer.camera.lookAt(game.renderer.cameraLookAt);
      game.renderer.camera.updateMatrixWorld();

      document.querySelector('.tut-skip')?.click();
      document.querySelector('.camera-prompt-confirm')?.click();
      let style = document.getElementById('eastbrook-armoury-capture-style');
      if (!style) {
        style = document.createElement('style');
        style.id = 'eastbrook-armoury-capture-style';
        style.textContent = `
          .nameplate,
          #banner,
          #subzone-banner,
          #quest-banner {
            display: none !important;
          }
        `;
        document.head.appendChild(style);
      }

      return {
        seed: game.sim.cfg.seed,
        lot:
          requestedScope === 'town'
            ? (ZONE1_PROPS.buildings.find(
                (building) => building.landmark === 'eastbrook_grand_armoury',
              ) ?? null)
            : (ZONE1_PROPS.buildings.find((building) => building.kind === 'inn') ?? null),
        player: {
          x: player.pos.x,
          y: player.pos.y,
          z: player.pos.z,
          facing: player.facing,
        },
        camera: { ...viewState.camera },
        target: { ...viewState.target },
      };
    },
    {
      expectedSeed: EXPECTED_SEED,
      playerState: PLAYER_STATE,
      viewState: view,
      requestedScope: captureScope,
    },
  );
}

async function readRenderState(page) {
  return page.evaluate(async () => {
    const game = window.__game;
    const { GFX } = await import('/src/render/gfx.ts');
    const renderer = game.renderer;
    const camera = renderer.camera;
    const armoury = renderer.scene.getObjectByName('eastbrookGrandArmoury');
    let asset = null;
    if (armoury) {
      armoury.updateWorldMatrix(true, true);
      camera.updateMatrixWorld();
      const meshes = [];
      armoury.traverse((child) => {
        if (child.isMesh) meshes.push(child);
      });
      const corners = [];
      const worldBounds = {
        min: { x: Infinity, y: Infinity, z: Infinity },
        max: { x: -Infinity, y: -Infinity, z: -Infinity },
      };
      for (const mesh of meshes) {
        mesh.geometry.computeBoundingBox();
        const box = mesh.geometry.boundingBox;
        if (!box) continue;
        for (const x of [box.min.x, box.max.x]) {
          for (const y of [box.min.y, box.max.y]) {
            for (const z of [box.min.z, box.max.z]) {
              const world = camera.position.clone().set(x, y, z).applyMatrix4(mesh.matrixWorld);
              worldBounds.min.x = Math.min(worldBounds.min.x, world.x);
              worldBounds.min.y = Math.min(worldBounds.min.y, world.y);
              worldBounds.min.z = Math.min(worldBounds.min.z, world.z);
              worldBounds.max.x = Math.max(worldBounds.max.x, world.x);
              worldBounds.max.y = Math.max(worldBounds.max.y, world.y);
              worldBounds.max.z = Math.max(worldBounds.max.z, world.z);
              corners.push(world.project(camera));
            }
          }
        }
      }
      if (corners.length === 0) throw new Error('armoury contains no bounded meshes');
      const projectedBounds = {
        minX: Math.min(...corners.map((point) => point.x)),
        maxX: Math.max(...corners.map((point) => point.x)),
        minY: Math.min(...corners.map((point) => point.y)),
        maxY: Math.max(...corners.map((point) => point.y)),
        minZ: Math.min(...corners.map((point) => point.z)),
        maxZ: Math.max(...corners.map((point) => point.z)),
      };
      const meshHierarchyVisible = (mesh) => {
        for (let object = mesh; object && object !== armoury; object = object.parent) {
          if (!object.visible) return false;
        }
        return true;
      };
      const colourWritableMeshes = meshes.filter((mesh) => {
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        return (
          meshHierarchyVisible(mesh) && materials.some((material) => material.colorWrite !== false)
        );
      }).length;
      let hierarchyVisible = true;
      for (let object = armoury; object; object = object.parent)
        hierarchyVisible &&= object.visible;
      const projectedOnScreen =
        projectedBounds.maxX >= -1 &&
        projectedBounds.minX <= 1 &&
        projectedBounds.maxY >= -1 &&
        projectedBounds.minY <= 1 &&
        projectedBounds.maxZ >= -1 &&
        projectedBounds.minZ <= 1;
      asset = {
        name: armoury.name,
        hierarchyVisible,
        meshCount: meshes.length,
        visibleMeshCount: meshes.filter(meshHierarchyVisible).length,
        colourWritableMeshes,
        projectedBounds,
        projectedOnScreen,
        visible: hierarchyVisible && colourWritableMeshes > 0 && projectedOnScreen,
        worldBounds,
      };
    }
    const settings = JSON.parse(localStorage.getItem('woc_settings') ?? '{}');
    const perfStats = renderer.perfStats();
    const townRoot = renderer.scene.getObjectByName('eastbrookTownRebuild');
    let townRootChildMeshCount = 0;
    townRoot?.traverse((object) => {
      if (object.isMesh) townRootChildMeshCount++;
    });
    let bankerChestCount = 0;
    const bankerChests = [];
    renderer.scene.traverse((object) => {
      if (object.name === 'bankerChestDecoration') {
        bankerChestCount++;
        bankerChests.push(object);
      }
    });
    const atlasUrl = '/textures/eastbrook_surface_atlas.webp';
    const textureSourceUrl = (texture) => {
      const source = texture?.source?.data ?? texture?.image;
      if (typeof source === 'string') return source;
      return source?.currentSrc ?? source?.src ?? '';
    };
    const isAtlasTexture = (texture) =>
      textureSourceUrl(texture).includes('/eastbrook_surface_atlas.');
    const atlasConsumer = (objects) => {
      const roots = objects.map((object) => {
        const record = object?.userData?.eastbrookSurfaceAtlas;
        const metadata =
          record && typeof record === 'object'
            ? {
                url: record.url ?? null,
                textureUuid: record.textureUuid ?? null,
                materialBindings: record.materialBindings ?? null,
              }
            : null;
        const observedTextureUuids = new Set();
        let observedMaterialBindings = 0;
        object?.traverse((child) => {
          const materials = child.material
            ? Array.isArray(child.material)
              ? child.material
              : [child.material]
            : [];
          for (const material of materials) {
            const texture = material.map;
            if (!texture || (texture.uuid !== metadata?.textureUuid && !isAtlasTexture(texture))) {
              continue;
            }
            observedTextureUuids.add(texture.uuid);
            // Count mesh/material slots, matching the runtime metadata's
            // traversal contract. Instanced wall meshes intentionally share a
            // material object but still contribute distinct draw bindings.
            observedMaterialBindings++;
          }
        });
        return {
          name: object.name,
          metadata,
          observed: {
            materialBindings: observedMaterialBindings,
            textureUuids: [...observedTextureUuids],
          },
        };
      });
      const textureUuids = [
        ...new Set(
          roots.flatMap((root) => [
            ...(root.metadata?.textureUuid ? [root.metadata.textureUuid] : []),
            ...root.observed.textureUuids,
          ]),
        ),
      ];
      return {
        present: objects.length > 0,
        materialBindings: roots.reduce((total, root) => total + root.observed.materialBindings, 0),
        roots,
        textureUuids,
      };
    };
    const atlasConsumers = {
      townRoot: atlasConsumer(townRoot ? [townRoot] : []),
      armoury: atlasConsumer(armoury ? [armoury] : []),
      bankerChest: atlasConsumer(bankerChests),
    };
    const atlasTextureUuids = [
      ...new Set(Object.values(atlasConsumers).flatMap((consumer) => consumer.textureUuids)),
    ];
    const atlasRootLoaded = (root) =>
      root.metadata?.url === atlasUrl &&
      typeof root.metadata.textureUuid === 'string' &&
      root.metadata.textureUuid.length > 0 &&
      Number.isInteger(root.metadata.materialBindings) &&
      root.metadata.materialBindings >= 1 &&
      root.observed.materialBindings === root.metadata.materialBindings &&
      root.observed.textureUuids.length === 1 &&
      root.observed.textureUuids[0] === root.metadata.textureUuid;
    const atlasLoaded =
      Object.values(atlasConsumers).every(
        (consumer) =>
          consumer.present && consumer.roots.length > 0 && consumer.roots.every(atlasRootLoaded),
      ) && atlasTextureUuids.length === 1;
    const atlasObserved = Object.values(atlasConsumers).some((consumer) =>
      consumer.roots.some((root) => root.metadata !== null || root.observed.materialBindings > 0),
    );
    return {
      seed: game.sim.cfg.seed,
      tier: GFX.tier,
      autoGovernor: GFX.autoGovernor,
      settings,
      assetPresent: !!armoury,
      asset,
      player: {
        x: game.sim.player.pos.x,
        y: game.sim.player.pos.y,
        z: game.sim.player.pos.z,
        facing: game.sim.player.facing,
      },
      camera: {
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
      },
      target: {
        x: renderer.cameraLookAt.x,
        y: renderer.cameraLookAt.y,
        z: renderer.cameraLookAt.z,
      },
      editorCamera: renderer.editorCam
        ? {
            camera: {
              x: renderer.editorCam.pos.x,
              y: renderer.editorCam.pos.y,
              z: renderer.editorCam.pos.z,
            },
            target: {
              x: renderer.editorCam.target.x,
              y: renderer.editorCam.target.y,
              z: renderer.editorCam.target.z,
            },
          }
        : null,
      gl: { vendor: perfStats.glVendor, renderer: perfStats.glRenderer },
      context: {
        lost: perfStats.contextLost,
        restored: perfStats.contextRestored,
      },
      townRoot: townRoot
        ? {
            name: townRoot.name,
            present: true,
            visible: townRoot.visible,
            childMeshCount: townRootChildMeshCount,
            newAssetUrls: [...(townRoot.userData.newAssetUrls ?? [])],
            assetUrls: [...(townRoot.userData.assetUrls ?? [])],
            buildingIds: [...(townRoot.userData.buildingIds ?? [])],
            drawStats: townRoot.userData.drawStats ?? null,
            wallSegmentCount: townRoot.userData.wallSegmentCount ?? 0,
            gateCount: townRoot.userData.gateCount ?? 0,
          }
        : {
            name: 'eastbrookTownRebuild',
            present: false,
            visible: false,
            childMeshCount: 0,
            newAssetUrls: [],
            assetUrls: [],
            buildingIds: [],
            drawStats: null,
            wallSegmentCount: 0,
            gateCount: 0,
          },
      bankerChestCount,
      surfaceAtlas: {
        url: atlasUrl,
        state: atlasLoaded ? 'loaded' : atlasObserved ? 'failed' : 'not-requested',
        textureUuids: atlasTextureUuids,
        sharedTextureIdentity: atlasLoaded,
        consumers: Object.fromEntries(
          Object.entries(atlasConsumers).map(([name, consumer]) => [
            name,
            {
              present: consumer.present,
              materialBindings: consumer.materialBindings,
              roots: consumer.roots,
            },
          ]),
        ),
      },
      resources: {
        calls: perfStats.calls,
        triangles: perfStats.triangles,
        geometries: perfStats.geometries,
        textures: perfStats.textures,
        programs: perfStats.programs,
        contextLost: perfStats.contextLost,
        contextRestored: perfStats.contextRestored,
      },
    };
  });
}

async function readViewportSnapshot(page) {
  return page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.cssText = [
      'position:fixed',
      'visibility:hidden',
      'pointer-events:none',
      'padding-top:env(safe-area-inset-top)',
      'padding-right:env(safe-area-inset-right)',
      'padding-bottom:env(safe-area-inset-bottom)',
      'padding-left:env(safe-area-inset-left)',
    ].join(';');
    document.body.appendChild(probe);
    const style = getComputedStyle(probe);
    const safeAreaProbe = {
      top: Number.parseFloat(style.paddingTop) || 0,
      right: Number.parseFloat(style.paddingRight) || 0,
      bottom: Number.parseFloat(style.paddingBottom) || 0,
      left: Number.parseFloat(style.paddingLeft) || 0,
    };
    probe.remove();
    const mobileControls = document.getElementById('mobile-controls');
    const mobileStyle = mobileControls ? getComputedStyle(mobileControls) : null;
    const mobileRect = mobileControls?.getBoundingClientRect();
    return {
      cssWidth: window.innerWidth,
      cssHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      maxTouchPoints: navigator.maxTouchPoints,
      touch:
        document.body.classList.contains('mobile-touch') && matchMedia('(pointer: coarse)').matches,
      viewportMeta: document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? '',
      safeAreaProbe,
      touchHudVisible: Boolean(
        mobileControls &&
          mobileStyle?.display !== 'none' &&
          mobileStyle?.visibility !== 'hidden' &&
          Number(mobileStyle?.opacity ?? 1) > 0 &&
          (mobileRect?.width ?? 0) > 0 &&
          (mobileRect?.height ?? 0) > 0,
      ),
    };
  });
}

function inventoryOrder(observed, expected) {
  const observedSet = new Set(observed);
  return [
    ...expected.filter((id) => observedSet.delete(id)),
    ...[...observedSet].sort((left, right) => left.localeCompare(right)),
  ];
}

async function readTownPlacementInventory(page, contractId = null) {
  const legacyExpected = expectedTownPlacementInventory(false, contractId).legacy;
  const rebuildExpected = expectedTownPlacementInventory(true, contractId).rebuild;
  const observed = await page.evaluate(async () => {
    const { ZONE1_PROPS } = await import('/src/sim/content/zone1.ts');
    const renderer = window.__game.renderer;
    const root = renderer.scene.getObjectByName('eastbrookTownRebuild');
    const close = (left, right) => Math.abs(left - right) < 1e-8;
    const sameBuilding = (building, expected) =>
      building.kind === expected.kind &&
      close(building.x, expected.x) &&
      close(building.z, expected.z) &&
      close(building.w, expected.w) &&
      close(building.d, expected.d) &&
      close(building.rot, expected.rot);
    const legacyBuildings = [
      {
        id: 'legacy_eastbrook_house_northeast',
        kind: 'house',
        x: 10,
        z: 12,
        w: 7,
        d: 6,
        rot: -0.4,
      },
      {
        id: 'legacy_eastbrook_house_northwest',
        kind: 'house',
        x: -10,
        z: 10,
        w: 6,
        d: 5,
        rot: 0.5,
      },
      {
        id: 'legacy_eastbrook_chapel',
        kind: 'chapel',
        x: -16,
        z: -8,
        w: 5,
        d: 7,
        rot: 0.9,
      },
    ];
    const legacyStalls = [
      ['legacy_eastbrook_provisioner_stall', -8.5, 3, Math.PI / 2],
      ['legacy_eastbrook_smithy_stall', 9.5, 17.5, -2.7],
      ['legacy_eastbrook_world_market_stall', 0, 11.5, Math.PI],
    ];
    const legacyFences = [
      ['legacy_eastbrook_fence_east', 16, 16, 22, 4],
      ['legacy_eastbrook_fence_west', -16, 14, -20, 2],
    ];
    const legacyArtisan = [
      ['engineering_workbench', 2, 20],
      ['alchemy_cauldron', 5, 23],
      ['cooking_spit', 9, 25],
      ['leatherworking_rack', 13, 24],
      ['tailoring_loom', 13.5, 20.5],
      ['inscription_lectern', 19.5, 14.5],
      ['enchanting_altar', 16, 13],
      ['jewelcrafting_bench', 15, 9],
      ['mining_ore_cart', 3, 12],
      ['herbalism_drying_rack', 1, 16],
    ];
    const inventory = {
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
    };

    for (const building of ZONE1_PROPS.buildings) {
      if (building.landmark === 'eastbrook_grand_armoury') continue;
      if (building.id?.startsWith('eastbrook_')) {
        inventory.rebuild.buildings.push(building.id);
        continue;
      }
      const match = legacyBuildings.find((candidate) => sameBuilding(building, candidate));
      inventory.legacy.buildings.push(
        match?.id ??
          `unclassified-building:${building.kind}:${building.x}:${building.z}:${building.w}:${building.d}:${building.rot}`,
      );
    }
    for (const well of ZONE1_PROPS.wells) {
      if (well.id?.startsWith('eastbrook_')) inventory.rebuild.wells.push(well.id);
      else if (close(well.x, 0) && close(well.z, 2) && close(well.r, 1.5)) {
        inventory.legacy.wells.push('legacy_eastbrook_well');
      } else inventory.legacy.wells.push(`unclassified-well:${well.x}:${well.z}:${well.r}`);
    }
    for (const stall of ZONE1_PROPS.stalls) {
      if (stall.id?.startsWith('eastbrook_')) inventory.rebuild.stalls.push(stall.id);
      else {
        const match = legacyStalls.find(
          ([, x, z, rotation]) =>
            close(stall.x, x) && close(stall.z, z) && close(stall.rot, rotation),
        );
        inventory.legacy.stalls.push(
          match?.[0] ?? `unclassified-stall:${stall.x}:${stall.z}:${stall.rot}`,
        );
      }
    }
    for (const [x, z] of ZONE1_PROPS.campfires) {
      if (Math.hypot(x, z) > 30) continue;
      inventory.legacy.campfires.push(
        close(x, 3) && close(z, -4) ? 'legacy_eastbrook_town_fire' : `unclassified-fire:${x}:${z}`,
      );
    }
    for (const fence of ZONE1_PROPS.fences) {
      if (fence.id?.startsWith('eastbrook_')) inventory.rebuild.fences.push(fence.id);
      else {
        const match = legacyFences.find(
          ([, x1, z1, x2, z2]) =>
            close(fence.x1, x1) &&
            close(fence.z1, z1) &&
            close(fence.x2, x2) &&
            close(fence.z2, z2),
        );
        inventory.legacy.fences.push(
          match?.[0] ?? `unclassified-fence:${fence.x1}:${fence.z1}:${fence.x2}:${fence.z2}`,
        );
      }
    }
    inventory.rebuild.benches.push(...(ZONE1_PROPS.benches ?? []).map((entry) => entry.id));
    inventory.rebuild.walls.push(...(ZONE1_PROPS.walls ?? []).map((entry) => entry.id));

    const artisan = renderer.scene.getObjectByName('artisanRowProps');
    for (const child of artisan?.children ?? []) {
      const match = legacyArtisan.find(
        ([, x, z]) => close(child.position.x, x) && close(child.position.z, z),
      );
      inventory.legacy.artisanRow.push(
        match?.[0] ?? `unclassified-artisan:${child.position.x}:${child.position.z}`,
      );
    }
    if (root) {
      const { EASTBROOK_LAYOUT } = await import('/src/sim/eastbrook_layout.ts');
      inventory.rebuild.gates.push(...EASTBROOK_LAYOUT.wall.gates.map((gate) => gate.id));
    }
    return inventory;
  });
  return {
    legacy: Object.fromEntries(
      Object.entries(observed.legacy).map(([key, ids]) => [
        key,
        inventoryOrder(ids, legacyExpected[key]),
      ]),
    ),
    rebuild: Object.fromEntries(
      Object.entries(observed.rebuild).map(([key, ids]) => [
        key,
        inventoryOrder(ids, rebuildExpected[key]),
      ]),
    ),
  };
}

async function readRuntimeMutationState(page) {
  return page.evaluate(() => {
    const renderer = window.__game.renderer;
    const root = renderer.scene.getObjectByName('eastbrookTownRebuild');
    return {
      rootVisible: root?.visible ?? null,
      shadowMapEnabled: renderer.webgl.shadowMap.enabled,
      sunCastShadow: renderer.sun?.castShadow ?? null,
      infoAutoReset: renderer.webgl.info.autoReset,
      reduceMotionSetting: renderer.reduceMotionSetting,
      overlayCount: document.querySelectorAll('#eastbrook-capture-overlay').length,
    };
  });
}

function captureCleanupState(baseline, observed) {
  return {
    overlayCount: observed.overlayCount,
    rootVisibilityRestored: observed.rootVisible === baseline.rootVisible,
    shadowMapRestored: observed.shadowMapEnabled === baseline.shadowMapEnabled,
    sunShadowRestored: observed.sunCastShadow === baseline.sunCastShadow,
    infoAutoResetRestored: observed.infoAutoReset === baseline.infoAutoReset,
    reduceMotionRestored: observed.reduceMotionSetting === baseline.reduceMotionSetting,
  };
}

async function installTownCaptureOverlay(page) {
  return page.evaluate(async () => {
    document.getElementById('eastbrook-capture-overlay')?.remove();
    const game = window.__game;
    const renderer = game.renderer;
    const camera = renderer.camera;
    const root = renderer.scene.getObjectByName('eastbrookTownRebuild');
    const [{ groundHeight }, { ZONE1_PROPS }, { colliderInternalsForTest }] = await Promise.all([
      import('/src/sim/world.ts'),
      import('/src/sim/content/zone1.ts'),
      import('/src/sim/colliders.ts'),
    ]);
    const obbs = [];
    const circles = [];
    const points = [];
    const gates = [];
    const facingArrows = [];
    const facingArrowLength = 1.5;
    let facingSourceLayoutId = null;
    const close = (left, right) => Math.abs(left - right) < 1e-8;
    const collisionSources = [];
    const addCollisionSource = (type, x, z, id, category) => {
      collisionSources.push({ type, x, z, id, category });
    };
    for (const [index, building] of ZONE1_PROPS.buildings.entries()) {
      addCollisionSource(
        'obb',
        building.x,
        building.z,
        building.id ?? building.landmark ?? `legacy-building:${index}`,
        'building',
      );
    }
    for (const [index, well] of ZONE1_PROPS.wells.entries()) {
      addCollisionSource('circle', well.x, well.z, well.id ?? `legacy-well:${index}`, 'well');
    }
    for (const [index, stall] of ZONE1_PROPS.stalls.entries()) {
      addCollisionSource(
        stall.w !== undefined && stall.d !== undefined ? 'obb' : 'circle',
        stall.x,
        stall.z,
        stall.id ?? `legacy-stall:${index}`,
        'stall',
      );
    }
    for (const [index, prop] of [
      ...(ZONE1_PROPS.benches ?? []),
      ...(ZONE1_PROPS.walls ?? []),
    ].entries()) {
      addCollisionSource(
        'obb',
        prop.x,
        prop.z,
        prop.id ?? `legacy-static-obb:${index}`,
        prop.id?.startsWith('eastbrook_wall_') ? 'wall' : 'bench',
      );
    }
    for (const [index, fence] of ZONE1_PROPS.fences.entries()) {
      addCollisionSource(
        'obb',
        (fence.x1 + fence.x2) / 2,
        (fence.z1 + fence.z2) / 2,
        fence.id ?? `legacy-fence:${index}`,
        'fence',
      );
    }
    for (const [index, [x, z]] of ZONE1_PROPS.campfires.entries()) {
      if (Math.hypot(x, z) <= 30) {
        addCollisionSource('circle', x, z, `legacy-town-fire:${index}`, 'service');
      }
    }
    const staticColliders = colliderInternalsForTest.staticWorldColliders(game.sim.cfg.seed);
    const usedColliderIndexes = new Set();
    for (const sourceRecord of collisionSources) {
      const colliderIndex = staticColliders.findIndex(
        (collider, index) =>
          !usedColliderIndexes.has(index) &&
          collider.type === sourceRecord.type &&
          close(collider.x, sourceRecord.x) &&
          close(collider.z, sourceRecord.z),
      );
      if (colliderIndex < 0) {
        throw new Error(`capture overlay could not resolve collider ${sourceRecord.id}`);
      }
      usedColliderIndexes.add(colliderIndex);
      const collider = staticColliders[colliderIndex];
      if (collider.type === 'obb') {
        obbs.push({
          id: sourceRecord.id,
          center: { x: collider.x, z: collider.z },
          halfWidth: collider.hw,
          halfDepth: collider.hd,
          rotation: collider.rot,
          category: sourceRecord.category,
        });
      } else {
        circles.push({
          id: sourceRecord.id,
          x: collider.x,
          z: collider.z,
          radius: collider.r,
          category: sourceRecord.category,
        });
      }
    }
    let source = 'zone1-legacy-collision-records';
    if (root) {
      source = 'eastbrook-layout';
      const { EASTBROOK_LAYOUT } = await import('/src/sim/eastbrook_layout.ts');
      facingSourceLayoutId = EASTBROOK_LAYOUT.id;
      const noticeboardFootprint = EASTBROOK_LAYOUT.services.noticeboard?.footprint;
      if (noticeboardFootprint) {
        const colliderIndex = staticColliders.findIndex(
          (collider, index) =>
            !usedColliderIndexes.has(index) &&
            collider.type === 'obb' &&
            close(collider.x, noticeboardFootprint.center.x) &&
            close(collider.z, noticeboardFootprint.center.z),
        );
        if (colliderIndex < 0) {
          throw new Error(`capture overlay could not resolve collider ${noticeboardFootprint.id}`);
        }
        usedColliderIndexes.add(colliderIndex);
        const collider = staticColliders[colliderIndex];
        obbs.push({
          id: noticeboardFootprint.id,
          center: { x: collider.x, z: collider.z },
          halfWidth: collider.hw,
          halfDepth: collider.hd,
          rotation: collider.rot,
          category: 'service',
        });
      }
      for (const building of [
        ...EASTBROOK_LAYOUT.preservedBuildings,
        ...EASTBROOK_LAYOUT.buildings,
      ]) {
        points.push({
          ...building.frontStandingPoint,
          id: `${building.id}:entrance`,
          category: 'entrance',
        });
      }
      for (const [id, service] of Object.entries({
        playerStart: EASTBROOK_LAYOUT.services.playerStart,
        mailbox: EASTBROOK_LAYOUT.services.mailbox,
        noticeboard: EASTBROOK_LAYOUT.services.noticeboard,
        graveyard: EASTBROOK_LAYOUT.services.graveyard,
      })) {
        if (!service) continue;
        points.push({ ...service.position, id, category: 'service' });
      }
      for (const npc of EASTBROOK_LAYOUT.services.npcs) {
        points.push({ ...npc.position, id: npc.id, category: 'npc' });
        facingArrows.push({
          id: npc.id,
          position: { ...npc.position },
          facing: npc.facing,
          end: {
            x: npc.position.x + Math.sin(npc.facing) * facingArrowLength,
            z: npc.position.z + Math.cos(npc.facing) * facingArrowLength,
          },
        });
      }
      for (const station of EASTBROOK_LAYOUT.services.stations) {
        points.push({
          ...station.position,
          id: station.id,
          category: 'station',
        });
      }
      const bursar = EASTBROOK_LAYOUT.services.npcs.find((npc) => npc.id === 'bursar_fernando');
      if (bursar) {
        const local = EASTBROOK_LAYOUT.services.bankerChest.preferredLocalPlacement;
        const cosine = Math.cos(bursar.facing);
        const sine = Math.sin(bursar.facing);
        points.push({
          x: bursar.position.x + local.x * cosine + local.z * sine,
          z: bursar.position.z - local.x * sine + local.z * cosine,
          id: EASTBROOK_LAYOUT.services.bankerChest.id,
          category: 'service',
        });
      }
      gates.push(
        ...EASTBROOK_LAYOUT.wall.gates.map((gate) => ({
          id: gate.id,
          center: gate.crossing,
          start: gate.start,
          end: gate.end,
          width: gate.width,
        })),
      );
    }

    const canvas = document.createElement('canvas');
    canvas.id = 'eastbrook-capture-overlay';
    canvas.width = Math.round(window.innerWidth * window.devicePixelRatio);
    canvas.height = Math.round(window.innerHeight * window.devicePixelRatio);
    canvas.style.cssText = [
      'position:fixed',
      'inset:0',
      'width:100vw',
      'height:100vh',
      'pointer-events:none',
      'z-index:2147483646',
    ].join(';');
    document.body.appendChild(canvas);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('capture overlay canvas context is unavailable');
    context.scale(window.devicePixelRatio, window.devicePixelRatio);
    context.lineWidth = 2;
    context.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    context.textBaseline = 'bottom';
    const colour = {
      building: '#38bdf8',
      stall: '#f59e0b',
      fence: '#fb7185',
      wall: '#ef4444',
      bench: '#a78bfa',
      well: '#22d3ee',
      entrance: '#f8fafc',
      service: '#facc15',
      npc: '#4ade80',
      station: '#c084fc',
      gate: '#ffffff',
    };
    const project = (point) => {
      const y = groundHeight(point.x, point.z, game.sim.cfg.seed) + 0.18;
      const projected = camera.position.clone().set(point.x, y, point.z).project(camera);
      return {
        x: ((projected.x + 1) / 2) * window.innerWidth,
        y: ((1 - projected.y) / 2) * window.innerHeight,
        visible: projected.z >= -1 && projected.z <= 1,
      };
    };
    const drawPolyline = (worldPoints, category, closePath = true) => {
      const projected = worldPoints.map(project);
      if (!projected.some((point) => point.visible)) return;
      context.strokeStyle = colour[category] ?? '#ffffff';
      context.beginPath();
      context.moveTo(projected[0].x, projected[0].y);
      for (let index = 1; index < projected.length; index++) {
        context.lineTo(projected[index].x, projected[index].y);
      }
      if (closePath) context.closePath();
      context.stroke();
    };
    for (const obb of obbs) {
      const cosine = Math.cos(obb.rotation);
      const sine = Math.sin(obb.rotation);
      const local = (x, z) => ({
        x: obb.center.x + x * cosine + z * sine,
        z: obb.center.z - x * sine + z * cosine,
      });
      drawPolyline(
        [
          local(-obb.halfWidth, -obb.halfDepth),
          local(obb.halfWidth, -obb.halfDepth),
          local(obb.halfWidth, obb.halfDepth),
          local(-obb.halfWidth, obb.halfDepth),
        ],
        obb.category,
      );
    }
    for (const circle of circles) {
      const ring = Array.from({ length: 32 }, (_, index) => {
        const angle = (Math.PI * 2 * index) / 32;
        return {
          x: circle.x + Math.cos(angle) * circle.radius,
          z: circle.z + Math.sin(angle) * circle.radius,
        };
      });
      drawPolyline(ring, circle.category);
    }
    for (const point of points) {
      const projected = project(point);
      if (!projected.visible) continue;
      context.fillStyle = colour[point.category] ?? '#ffffff';
      context.beginPath();
      context.arc(projected.x, projected.y, 3.5, 0, Math.PI * 2);
      context.fill();
      context.fillText(point.id, projected.x + 5, projected.y - 3);
    }
    for (const arrow of facingArrows) {
      drawPolyline([arrow.position, arrow.end], 'npc', false);
      const start = project(arrow.position);
      const tip = project(arrow.end);
      if (!start.visible || !tip.visible) continue;
      const dx = tip.x - start.x;
      const dy = tip.y - start.y;
      const length = Math.hypot(dx, dy);
      if (length <= 1e-6) continue;
      const ux = dx / length;
      const uy = dy / length;
      const baseX = tip.x - ux * 8;
      const baseY = tip.y - uy * 8;
      context.strokeStyle = colour.npc;
      context.beginPath();
      context.moveTo(tip.x, tip.y);
      context.lineTo(baseX - uy * 4, baseY + ux * 4);
      context.moveTo(tip.x, tip.y);
      context.lineTo(baseX + uy * 4, baseY - ux * 4);
      context.stroke();
    }
    for (const gate of gates) {
      drawPolyline([gate.start, gate.end], 'gate', false);
      const projected = project(gate.center);
      if (!projected.visible) continue;
      context.fillStyle = colour.gate;
      context.fillRect(projected.x - 3, projected.y - 3, 6, 6);
      context.fillText(`${gate.id} (${gate.width})`, projected.x + 5, projected.y - 3);
    }
    context.fillStyle = 'rgba(2, 6, 23, 0.78)';
    context.fillRect(8, 8, 430, 48);
    context.fillStyle = '#f8fafc';
    context.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace';
    context.fillText(`CAPTURE-ONLY COLLIDER PROOF: ${source}`, 16, 29);
    context.fillText(
      `OBB ${obbs.length} | circles ${circles.length} | points ${points.length} | gates ${gates.length}`,
      16,
      48,
    );
    return {
      requested: true,
      installedDuringCapture: true,
      removedAfterCapture: false,
      source,
      unsupportedReason: null,
      recordCounts: {
        obbs: obbs.length,
        circles: circles.length,
        points: points.length,
        gates: gates.length,
      },
      records: {
        obbs,
        circles,
        points,
        gates,
      },
      npcFacings: {
        sourceLayoutId: facingSourceLayoutId,
        arrowLength: facingArrowLength,
        records: facingArrows,
      },
    };
  });
}

async function removeTownCaptureOverlay(page) {
  return page.evaluate(() => {
    document.getElementById('eastbrook-capture-overlay')?.remove();
    return document.querySelectorAll('#eastbrook-capture-overlay').length === 0;
  });
}

async function captureTownMotionEvidence(page, output, defaultOutput) {
  const motionContract = townContract?.motionCapture;
  if (!motionContract) return null;
  if (motionContract !== EASTBROOK_TOWN_MOTION_CAPTURE) {
    throw new Error('polish motion capture contract is not the canonical civic contract');
  }
  const original = await page.evaluate((beacon) => {
    const renderer = window.__game.renderer;
    const root = renderer.scene.getObjectByName(beacon.rootName);
    const batch = root?.getObjectByName(beacon.batchName);
    const attribute = batch?.geometry?.getAttribute?.(beacon.maskAttribute);
    const materials = batch?.material
      ? Array.isArray(batch.material)
        ? batch.material
        : [batch.material]
      : [];
    const decorated = materials.find(
      (material) =>
        material.userData?.eastbrookCivicBeacon?.maskAttribute === beacon.maskAttribute &&
        material.userData.eastbrookCivicBeacon.programCacheKey === beacon.programCacheKey,
    );
    if (!root || !batch || !attribute || !decorated) {
      throw new Error('civic motion capture could not resolve the shipping beacon shader contract');
    }
    return {
      reduceMotionSetting: renderer.reduceMotionSetting,
      mediaReducedMotion: renderer.reduceMotionMql?.matches ?? false,
    };
  }, motionContract.beacon);
  const modes = [];
  if (original.reduceMotionSetting !== true) {
    throw new Error('the default historical capture must enter civic proof with reduceMotion=true');
  }
  try {
    for (const mode of motionContract.modes) {
      const runtimeReduceMotion = await page.evaluate((reduceMotion) => {
        const renderer = window.__game.renderer;
        renderer.reduceMotionSetting = reduceMotion;
        return renderer.reduceMotionSetting || (renderer.reduceMotionMql?.matches ?? false);
      }, mode.reduceMotion);
      if (runtimeReduceMotion !== mode.reduceMotion) {
        throw new Error(
          `${mode.id} could not establish runtime reduce-motion=${mode.reduceMotion}`,
        );
      }
      await delay(120);
      const stem = output.endsWith('.png') ? output.slice(0, -4) : output;
      const frames = [];
      for (const [index, phase] of ['t0', 't1'].entries()) {
        if (index > 0) await delay(motionContract.frameIntervalMs);
        const frameOutput = `${stem}-${mode.id}-${phase}.png`;
        await page.screenshot({ path: frameOutput });
        const bytes = readFileSync(frameOutput);
        frames.push({
          phase,
          output: frameOutput,
          bytes: bytes.byteLength,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        });
      }
      modes.push({ id: mode.id, runtimeReduceMotion, frames });
    }
  } finally {
    await page.evaluate((reduceMotionSetting) => {
      window.__game.renderer.reduceMotionSetting = reduceMotionSetting;
    }, original.reduceMotionSetting);
  }
  const restored = await page.evaluate(
    (initial) =>
      window.__game.renderer.reduceMotionSetting === initial.reduceMotionSetting &&
      (window.__game.renderer.reduceMotionMql?.matches ?? false) === initial.mediaReducedMotion,
    original,
  );
  const evidence = {
    viewName: motionContract.viewName,
    frameIntervalMs: motionContract.frameIntervalMs,
    beacon: { ...motionContract.beacon },
    contact: {
      defaultReducedMotionOutput: defaultOutput,
      defaultRuntimeReduceMotion: original.reduceMotionSetting,
      pairedFrameCount: modes.reduce((count, mode) => count + mode.frames.length, 0),
    },
    modes,
    restored,
  };
  assertTownMotionEvidence({ evidence, contractId: townContractId });
  return evidence;
}

async function measurePerfBlock(page, { label, meshVisible, shadowEnabled }) {
  const raw = await page.evaluate(
    async ({
      label: blockLabel,
      meshVisible: requestedMeshVisible,
      shadowEnabled: requestedShadow,
      warmupMs,
      sampleMs,
    }) => {
      const game = window.__game;
      const renderer = game.renderer;
      const webgl = renderer.webgl;
      const info = webgl.info;
      const armoury = renderer.scene.getObjectByName('eastbrookGrandArmoury');
      const meshes = [];
      armoury?.traverse((child) => {
        if (child.isMesh) meshes.push(child);
      });
      if (requestedMeshVisible !== null && !armoury) {
        throw new Error('feature performance block requires the armoury wrapper');
      }

      const original = {
        wrapperVisible: armoury?.visible ?? null,
        meshVisible: meshes.map((mesh) => mesh.visible),
        shadowMapEnabled: webgl.shadowMap.enabled,
        sunCastShadow: renderer.sun?.castShadow ?? null,
        infoAutoReset: info.autoReset,
      };
      const waitForMs = (ms) =>
        new Promise((resolve) => {
          const start = performance.now();
          const tick = (now) => {
            if (now - start >= ms) resolve();
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });

      try {
        if (requestedMeshVisible !== null) {
          meshes.forEach((mesh, index) => {
            mesh.visible = requestedMeshVisible ? original.meshVisible[index] : false;
          });
        }
        webgl.shadowMap.enabled = requestedShadow;
        if (renderer.sun) renderer.sun.castShadow = requestedShadow;
        await waitForMs(warmupMs);
        if (armoury && armoury.visible !== original.wrapperVisible) {
          throw new Error('armoury wrapper visibility changed during performance setup');
        }

        game.perf.reset();
        info.autoReset = false;
        info.reset();
        const samples = [];
        const rafDeltasMs = [];
        const result = await new Promise((resolve) => {
          let start = 0;
          let previous = 0;
          const sample = (now) => {
            if (start === 0) {
              start = now;
              previous = now;
              info.reset();
              requestAnimationFrame(sample);
              return;
            }
            rafDeltasMs.push(now - previous);
            previous = now;
            const publicPerfStats = renderer.perfStats();
            const memory = performance.memory;
            samples.push({
              calls: info.render.calls,
              shadowDraws: requestedShadow
                ? meshes.filter((mesh) => mesh.visible && mesh.castShadow).length
                : 0,
              triangles: info.render.triangles,
              lines: info.render.lines,
              points: info.render.points,
              cpuSubmitMs: publicPerfStats.lastFrame?.phaseMs?.submit ?? 0,
              rendererWorldMs: publicPerfStats.lastFrame?.phaseMs?.world ?? 0,
              geometries: info.memory.geometries,
              textures: info.memory.textures,
              programs: info.programs?.length ?? 0,
              heapUsedMb: memory ? memory.usedJSHeapSize / (1024 * 1024) : 0,
              contextLost: publicPerfStats.contextLost ?? 0,
            });
            if (now - start >= sampleMs) {
              resolve({ report: game.perf.report(), samples, rafDeltasMs });
              return;
            }
            info.reset();
            requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        });

        return {
          label: blockLabel,
          armouryChildMeshes: meshes.length,
          requested: {
            meshVisible: requestedMeshVisible,
            shadowEnabled: requestedShadow,
          },
          observed: {
            wrapperVisible: armoury?.visible ?? null,
            visibleMeshes: meshes.filter((mesh) => mesh.visible).length,
            shadowMapEnabled: webgl.shadowMap.enabled,
            sunCastShadow: renderer.sun?.castShadow ?? null,
          },
          restorationContract: original,
          ...result,
        };
      } finally {
        meshes.forEach((mesh, index) => {
          mesh.visible = original.meshVisible[index];
        });
        webgl.shadowMap.enabled = original.shadowMapEnabled;
        if (renderer.sun && original.sunCastShadow !== null) {
          renderer.sun.castShadow = original.sunCastShadow;
        }
        info.autoReset = original.infoAutoReset;
        info.reset();
      }
    },
    {
      label,
      meshVisible,
      shadowEnabled,
      warmupMs: PERF_WARMUP_MS,
      sampleMs: PERF_SAMPLE_MS,
    },
  );
  assertPerformanceBlockState({ raw, label, meshVisible, shadowEnabled });
  const restored = await page.evaluate(() => {
    const renderer = window.__game.renderer;
    const armoury = renderer.scene.getObjectByName('eastbrookGrandArmoury');
    const meshVisible = [];
    armoury?.traverse((child) => {
      if (child.isMesh) meshVisible.push(child.visible);
    });
    return {
      wrapperVisible: armoury?.visible ?? null,
      meshVisible,
      shadowMapEnabled: renderer.webgl.shadowMap.enabled,
      sunCastShadow: renderer.sun?.castShadow ?? null,
      infoAutoReset: renderer.webgl.info.autoReset,
    };
  });
  assertPerformanceStateRestored({
    restored,
    original: raw.restorationContract,
    label,
  });
  return {
    summary: summarizePerfBlock(raw),
    rafDeltasMs: raw.rafDeltasMs,
  };
}

async function measureDirectRenderAttribution(page) {
  const raw = await page.evaluate(() => {
    const renderer = window.__game.renderer;
    const webgl = renderer.webgl;
    const info = webgl.info;
    const armoury = renderer.scene.getObjectByName('eastbrookGrandArmoury');
    if (!armoury) throw new Error('direct attribution requires the armoury wrapper');
    const meshes = [];
    armoury.traverse((child) => {
      if (child.isMesh) meshes.push(child);
    });
    const original = {
      wrapperVisible: armoury.visible,
      meshVisible: meshes.map((mesh) => mesh.visible),
      shadowMapEnabled: webgl.shadowMap.enabled,
      sunCastShadow: renderer.sun?.castShadow ?? null,
      infoAutoReset: info.autoReset,
    };
    const sequence = [];

    try {
      info.autoReset = false;
      for (const shadowEnabled of [true, false]) {
        webgl.shadowMap.enabled = shadowEnabled;
        if (renderer.sun) renderer.sun.castShadow = shadowEnabled;
        // Both orders make the attribution independent of render-list warmup.
        for (const meshVisible of [true, false, false, true]) {
          meshes.forEach((mesh, index) => {
            mesh.visible = meshVisible ? original.meshVisible[index] : false;
          });
          info.reset();
          webgl.render(renderer.scene, renderer.camera);
          sequence.push({
            label: `direct-${meshVisible ? 'visible' : 'hidden'}-shadow-${shadowEnabled ? 'on' : 'off'}`,
            armouryChildMeshes: meshes.length,
            requested: { meshVisible, shadowEnabled },
            observed: {
              wrapperVisible: armoury.visible,
              visibleMeshes: meshes.filter((mesh) => mesh.visible).length,
              shadowMapEnabled: webgl.shadowMap.enabled,
              sunCastShadow: renderer.sun?.castShadow ?? null,
            },
            render: {
              calls: info.render.calls,
              triangles: info.render.triangles,
              lines: info.render.lines,
              points: info.render.points,
            },
          });
        }
      }
      return { sequence, restorationContract: original };
    } finally {
      meshes.forEach((mesh, index) => {
        mesh.visible = original.meshVisible[index];
      });
      webgl.shadowMap.enabled = original.shadowMapEnabled;
      if (renderer.sun && original.sunCastShadow !== null) {
        renderer.sun.castShadow = original.sunCastShadow;
      }
      info.autoReset = original.infoAutoReset;
      info.reset();
    }
  });

  for (const entry of raw.sequence) {
    assertPerformanceBlockState({
      raw: { ...entry, restorationContract: raw.restorationContract },
      label: entry.label,
      meshVisible: entry.requested.meshVisible,
      shadowEnabled: entry.requested.shadowEnabled,
    });
  }
  const restored = await page.evaluate(() => {
    const renderer = window.__game.renderer;
    const armoury = renderer.scene.getObjectByName('eastbrookGrandArmoury');
    const meshVisible = [];
    armoury?.traverse((child) => {
      if (child.isMesh) meshVisible.push(child.visible);
    });
    return {
      wrapperVisible: armoury?.visible ?? null,
      meshVisible,
      shadowMapEnabled: renderer.webgl.shadowMap.enabled,
      sunCastShadow: renderer.sun?.castShadow ?? null,
      infoAutoReset: renderer.webgl.info.autoReset,
    };
  });
  assertPerformanceStateRestored({
    restored,
    original: raw.restorationContract,
    label: 'direct-attribution',
  });

  const conditions = {};
  for (const [name, meshVisible, shadowEnabled] of [
    ['visibleShadowOn', true, true],
    ['hiddenShadowOn', false, true],
    ['visibleShadowOff', true, false],
    ['hiddenShadowOff', false, false],
  ]) {
    const entries = raw.sequence.filter(
      (entry) =>
        entry.requested.meshVisible === meshVisible &&
        entry.requested.shadowEnabled === shadowEnabled,
    );
    conditions[name] = {
      samples: entries.length,
      renderMedian: {
        calls: median(entries.map((entry) => entry.render.calls)),
        triangles: median(entries.map((entry) => entry.render.triangles)),
        lines: median(entries.map((entry) => entry.render.lines)),
        points: median(entries.map((entry) => entry.render.points)),
      },
    };
  }
  const deltas = deriveArmouryPerformanceDeltas(conditions);
  assertArmouryPerformanceContract(deltas);
  return { sequence: raw.sequence, conditions, deltas };
}

async function measureTownPerfBlock(
  page,
  { label, rootVisible, shadowEnabled, assetFailures, attributionRefs = [], contractId = null },
) {
  const raw = await page.evaluate(
    async ({
      label: blockLabel,
      rootName,
      rootVisible: requestedRootVisible,
      shadowEnabled: requestedShadow,
      warmupMs,
      sampleMs,
      attributionRefs: requestedAttributionRefs,
    }) => {
      const game = window.__game;
      const renderer = game.renderer;
      const webgl = renderer.webgl;
      const info = webgl.info;
      const root = renderer.scene.getObjectByName(rootName);
      if (!root && requestedRootVisible !== null) {
        throw new Error(`${rootName} is unavailable for town attribution`);
      }
      const meshes = [];
      root?.traverse((child) => {
        if (child.isMesh) meshes.push(child);
      });
      const resolveAttributionRoot = (ref) => {
        if (ref.kind === 'scene-root') return renderer.scene.getObjectByName(ref.rootName);
        const view = renderer.views.get(ref.entityId);
        const body = view?.objectMesh;
        if (!ref.runtimeBodyName) return body;
        return body?.name === ref.runtimeBodyName
          ? body
          : body?.getObjectByName(ref.runtimeBodyName);
      };
      const attributionRoots = requestedAttributionRefs.map((ref) => ({
        ref,
        root: resolveAttributionRoot(ref),
      }));
      if (requestedRootVisible !== null && attributionRoots.some((target) => !target.root)) {
        throw new Error('one or more stable Eastbrook attribution targets are unavailable');
      }
      const meshCount = (targetRoot) => {
        let count = 0;
        targetRoot?.traverse((child) => {
          if (child.isMesh) count++;
        });
        return count;
      };
      const shadowDrawCount = (targetRoot) => {
        let count = 0;
        targetRoot?.traverse((child) => {
          if (!child.isMesh || !child.castShadow) return;
          count += Math.max(1, child.geometry?.groups?.length ?? 0);
        });
        return count;
      };
      const drawStats = root?.userData.drawStats ?? null;
      const standaloneShadowDraws = attributionRoots
        .filter((target) => target.ref.key !== 'town-root')
        .reduce((count, target) => count + shadowDrawCount(target.root), 0);
      const original = {
        rootVisible: root?.visible ?? null,
        targetVisibility: attributionRoots.map((target) => target.root?.visible ?? null),
        shadowMapEnabled: webgl.shadowMap.enabled,
        sunCastShadow: renderer.sun?.castShadow ?? null,
        infoAutoReset: info.autoReset,
      };
      const waitForMs = (ms) =>
        new Promise((resolve) => {
          const start = performance.now();
          const tick = (now) => {
            if (now - start >= ms) resolve();
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
      try {
        if (requestedRootVisible !== null) {
          for (const target of attributionRoots) target.root.visible = requestedRootVisible;
        }
        webgl.shadowMap.enabled = requestedShadow;
        if (renderer.sun) renderer.sun.castShadow = requestedShadow;
        await waitForMs(warmupMs);
        game.perf.reset();
        // Exercise the production intent -> rendered-frame telemetry seam.
        // The marker is the same one Input invokes after a real move/look/zoom
        // gesture; the normal game loop, not this helper, closes each sample
        // with markInputVisible after renderer.sync. Multiple rAF-separated
        // intents make the reported p95 meaningful without moving the matched
        // camera or player state used for A/B attribution.
        for (let inputProbe = 0; inputProbe < 5; inputProbe++) {
          game.perf.markInputIntent('look', performance.now());
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }
        info.autoReset = false;
        info.reset();
        const samples = [];
        const rafDeltasMs = [];
        const result = await new Promise((resolve) => {
          let start = 0;
          let previous = 0;
          const sample = (now) => {
            if (start === 0) {
              start = now;
              previous = now;
              info.reset();
              requestAnimationFrame(sample);
              return;
            }
            rafDeltasMs.push(now - previous);
            previous = now;
            const publicPerfStats = renderer.perfStats();
            const memory = performance.memory;
            samples.push({
              calls: info.render.calls,
              shadowDraws:
                root && requestedRootVisible && requestedShadow
                  ? (drawStats?.shadowDraws ?? 0) + standaloneShadowDraws
                  : 0,
              triangles: info.render.triangles,
              lines: info.render.lines,
              points: info.render.points,
              cpuSubmitMs: publicPerfStats.lastFrame?.phaseMs?.submit ?? 0,
              rendererWorldMs: publicPerfStats.lastFrame?.phaseMs?.world ?? 0,
              geometries: info.memory.geometries,
              textures: info.memory.textures,
              programs: info.programs?.length ?? 0,
              heapUsedMb: memory ? memory.usedJSHeapSize / (1024 * 1024) : 0,
              contextLost: publicPerfStats.contextLost ?? 0,
            });
            if (now - start >= sampleMs) {
              resolve({ report: game.perf.report(), samples, rafDeltasMs });
              return;
            }
            info.reset();
            requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        });
        return {
          label: blockLabel,
          targetName: rootName,
          targetChildMeshes: meshes.length,
          requested: {
            rootVisible: requestedRootVisible,
            shadowEnabled: requestedShadow,
          },
          observed: {
            rootName: root?.name ?? rootName,
            rootPresent: !!root,
            rootVisible: root?.visible ?? null,
            shadowMapEnabled: webgl.shadowMap.enabled,
            sunCastShadow: renderer.sun?.castShadow ?? null,
          },
          drawStats,
          targets: attributionRoots.map(({ ref, root: targetRoot }) => ({
            key: ref.key,
            kind: ref.kind,
            rootName: ref.rootName,
            layoutId: ref.layoutId,
            layoutServiceId: ref.layoutServiceId,
            templateId: ref.templateId,
            surfaceAtlas: ref.surfaceAtlas,
            present: !!targetRoot,
            visible: targetRoot?.visible ?? null,
            childMeshCount: meshCount(targetRoot),
          })),
          restorationContract: original,
          ...result,
        };
      } finally {
        attributionRoots.forEach((target, index) => {
          if (target.root && original.targetVisibility[index] !== null) {
            target.root.visible = original.targetVisibility[index];
          }
        });
        if (attributionRoots.length === 0 && root && original.rootVisible !== null) {
          root.visible = original.rootVisible;
        }
        webgl.shadowMap.enabled = original.shadowMapEnabled;
        if (renderer.sun && original.sunCastShadow !== null) {
          renderer.sun.castShadow = original.sunCastShadow;
        }
        info.autoReset = original.infoAutoReset;
        info.reset();
      }
    },
    {
      label,
      rootName: EASTBROOK_TOWN_ROOT_NAME,
      rootVisible,
      shadowEnabled,
      warmupMs: PERF_WARMUP_MS,
      sampleMs: PERF_SAMPLE_MS,
      attributionRefs,
    },
  );
  raw.assetFailures = assetFailures;
  if (rootVisible === null) {
    assertTownBaselinePerformanceBlockState({ raw, label, shadowEnabled });
  } else {
    assertTownPerformanceBlockState({
      raw,
      label,
      rootVisible,
      shadowEnabled,
      contractId,
    });
    if (contractId) {
      assertTownAttributionTargetState({
        targets: raw.targets,
        contractId,
        requestedVisible: rootVisible,
      });
    }
  }
  const restored = await page.evaluate(
    ({ rootName, attributionRefs: requestedAttributionRefs }) => {
      const renderer = window.__game.renderer;
      const root = renderer.scene.getObjectByName(rootName);
      const targetVisibility = requestedAttributionRefs.map((ref) => {
        const view = ref.kind === 'scene-root' ? null : renderer.views.get(ref.entityId);
        const body = view?.objectMesh;
        const targetRoot =
          ref.kind === 'scene-root'
            ? renderer.scene.getObjectByName(ref.rootName)
            : !ref.runtimeBodyName
              ? body
              : body?.name === ref.runtimeBodyName
                ? body
                : body?.getObjectByName(ref.runtimeBodyName);
        return targetRoot?.visible ?? null;
      });
      return {
        rootVisible: root?.visible ?? null,
        targetVisibility,
        shadowMapEnabled: renderer.webgl.shadowMap.enabled,
        sunCastShadow: renderer.sun?.castShadow ?? null,
        infoAutoReset: renderer.webgl.info.autoReset,
      };
    },
    { rootName: EASTBROOK_TOWN_ROOT_NAME, attributionRefs },
  );
  assertPerformanceStateRestored({
    restored,
    original: raw.restorationContract,
    label,
  });
  return { summary: summarizePerfBlock(raw), rafDeltasMs: raw.rafDeltasMs };
}

async function measureTownDirectRenderAttribution(page, attributionRefs = [], contractId = null) {
  const raw = await page.evaluate(
    ({ rootName, attributionRefs: requestedAttributionRefs }) => {
      const renderer = window.__game.renderer;
      const webgl = renderer.webgl;
      const info = webgl.info;
      const root = renderer.scene.getObjectByName(rootName);
      if (!root) throw new Error(`${rootName} is unavailable for direct attribution`);
      const resolveAttributionRoot = (ref) => {
        if (ref.kind === 'scene-root') return renderer.scene.getObjectByName(ref.rootName);
        const view = renderer.views.get(ref.entityId);
        const body = view?.objectMesh;
        if (!ref.runtimeBodyName) return body;
        return body?.name === ref.runtimeBodyName
          ? body
          : body?.getObjectByName(ref.runtimeBodyName);
      };
      const attributionRoots = requestedAttributionRefs.map((ref) => ({
        ref,
        root: resolveAttributionRoot(ref),
      }));
      if (attributionRoots.some((target) => !target.root)) {
        throw new Error('one or more stable Eastbrook attribution targets are unavailable');
      }
      const meshCount = (targetRoot) => {
        let count = 0;
        targetRoot?.traverse((child) => {
          if (child.isMesh) count++;
        });
        return count;
      };
      const meshes = [];
      root.traverse((child) => {
        if (child.isMesh) meshes.push(child);
      });
      const drawStats = root.userData.drawStats ?? null;
      const original = {
        rootVisible: root.visible,
        targetVisibility: attributionRoots.map((target) => target.root.visible),
        shadowMapEnabled: webgl.shadowMap.enabled,
        sunCastShadow: renderer.sun?.castShadow ?? null,
        infoAutoReset: info.autoReset,
      };
      const sequence = [];
      try {
        info.autoReset = false;
        for (const shadowEnabled of [true, false]) {
          webgl.shadowMap.enabled = shadowEnabled;
          if (renderer.sun) renderer.sun.castShadow = shadowEnabled;
          for (const requestedRootVisible of [true, false, false, true]) {
            for (const target of attributionRoots) target.root.visible = requestedRootVisible;
            if (attributionRoots.length === 0) root.visible = requestedRootVisible;
            info.reset();
            webgl.render(renderer.scene, renderer.camera);
            sequence.push({
              label: `direct-town-${requestedRootVisible ? 'visible' : 'hidden'}-shadow-${
                shadowEnabled ? 'on' : 'off'
              }`,
              targetName: rootName,
              targetChildMeshes: meshes.length,
              requested: { rootVisible: requestedRootVisible, shadowEnabled },
              observed: {
                rootName: root.name,
                rootPresent: true,
                rootVisible: root.visible,
                shadowMapEnabled: webgl.shadowMap.enabled,
                sunCastShadow: renderer.sun?.castShadow ?? null,
              },
              drawStats,
              targets: attributionRoots.map(({ ref, root: targetRoot }) => ({
                key: ref.key,
                kind: ref.kind,
                rootName: ref.rootName,
                layoutId: ref.layoutId,
                layoutServiceId: ref.layoutServiceId,
                templateId: ref.templateId,
                surfaceAtlas: ref.surfaceAtlas,
                present: !!targetRoot,
                visible: targetRoot.visible,
                childMeshCount: meshCount(targetRoot),
              })),
              render: {
                calls: info.render.calls,
                triangles: info.render.triangles,
                lines: info.render.lines,
                points: info.render.points,
              },
            });
          }
        }
        return { sequence, restorationContract: original };
      } finally {
        attributionRoots.forEach((target, index) => {
          target.root.visible = original.targetVisibility[index];
        });
        if (attributionRoots.length === 0) root.visible = original.rootVisible;
        webgl.shadowMap.enabled = original.shadowMapEnabled;
        if (renderer.sun && original.sunCastShadow !== null) {
          renderer.sun.castShadow = original.sunCastShadow;
        }
        info.autoReset = original.infoAutoReset;
        info.reset();
      }
    },
    { rootName: EASTBROOK_TOWN_ROOT_NAME, attributionRefs },
  );
  for (const entry of raw.sequence) {
    assertTownPerformanceBlockState({
      raw: entry,
      label: entry.label,
      rootVisible: entry.requested.rootVisible,
      shadowEnabled: entry.requested.shadowEnabled,
      contractId,
    });
    if (contractId) {
      assertTownAttributionTargetState({
        targets: entry.targets,
        contractId,
        requestedVisible: entry.requested.rootVisible,
      });
    }
  }
  const restored = await page.evaluate(
    ({ rootName, attributionRefs: requestedAttributionRefs }) => {
      const renderer = window.__game.renderer;
      const root = renderer.scene.getObjectByName(rootName);
      return {
        rootVisible: root?.visible ?? null,
        targetVisibility: requestedAttributionRefs.map((ref) => {
          const view = ref.kind === 'scene-root' ? null : renderer.views.get(ref.entityId);
          const body = view?.objectMesh;
          const targetRoot =
            ref.kind === 'scene-root'
              ? renderer.scene.getObjectByName(ref.rootName)
              : !ref.runtimeBodyName
                ? body
                : body?.name === ref.runtimeBodyName
                  ? body
                  : body?.getObjectByName(ref.runtimeBodyName);
          return targetRoot?.visible ?? null;
        }),
        shadowMapEnabled: renderer.webgl.shadowMap.enabled,
        sunCastShadow: renderer.sun?.castShadow ?? null,
        infoAutoReset: renderer.webgl.info.autoReset,
      };
    },
    { rootName: EASTBROOK_TOWN_ROOT_NAME, attributionRefs },
  );
  assertPerformanceStateRestored({
    restored,
    original: raw.restorationContract,
    label: 'direct-town-attribution',
  });
  const conditions = {};
  for (const [name, rootVisible, shadowEnabled] of [
    ['visibleShadowOn', true, true],
    ['hiddenShadowOn', false, true],
    ['visibleShadowOff', true, false],
    ['hiddenShadowOff', false, false],
  ]) {
    const entries = raw.sequence.filter(
      (entry) =>
        entry.requested.rootVisible === rootVisible &&
        entry.requested.shadowEnabled === shadowEnabled,
    );
    conditions[name] = {
      samples: entries.length,
      renderMedian: {
        calls: median(entries.map((entry) => entry.render.calls)),
        triangles: median(entries.map((entry) => entry.render.triangles)),
        lines: median(entries.map((entry) => entry.render.lines)),
        points: median(entries.map((entry) => entry.render.points)),
      },
    };
  }
  const deltas = deriveTownPerformanceDeltas(conditions);
  return { sequence: raw.sequence, conditions, deltas };
}

async function measureTownScenario(page, assetFailures, contractId = null) {
  const blocks = [];
  const attribution =
    expectedTown === true && townContract
      ? await resolveTownContractTargets(page)
      : { refs: [], targets: [] };
  if (contractId) {
    assertTownAttributionTargetState({
      targets: attribution.targets,
      contractId,
      requestedVisible: true,
    });
  }
  if (expectedTown === true) {
    for (const shadowEnabled of [true, false]) {
      for (let repeat = 1; repeat <= PERF_REPEATS; repeat++) {
        const visibilityOrder = repeat % 2 === 1 ? [true, false] : [false, true];
        for (const rootVisible of visibilityOrder) {
          const label = `town-${rootVisible ? 'visible' : 'hidden'}-shadow-${shadowEnabled ? 'on' : 'off'}-${repeat}`;
          blocks.push({
            condition: `${rootVisible ? 'visible' : 'hidden'}Shadow${shadowEnabled ? 'On' : 'Off'}`,
            result: await measureTownPerfBlock(page, {
              label,
              rootVisible,
              shadowEnabled,
              assetFailures,
              attributionRefs: attribution.refs,
              contractId,
            }),
          });
        }
      }
    }
  } else {
    for (const shadowEnabled of [true, false]) {
      for (let repeat = 1; repeat <= PERF_REPEATS; repeat++) {
        const label = `town-baseline-total-shadow-${shadowEnabled ? 'on' : 'off'}-${repeat}`;
        const result = await measureTownPerfBlock(page, {
          label,
          rootVisible: null,
          shadowEnabled,
          assetFailures,
        });
        blocks.push({
          condition: `baselineTotalShadow${shadowEnabled ? 'On' : 'Off'}`,
          result,
        });
      }
    }
  }
  const conditions = {};
  for (const condition of new Set(blocks.map((block) => block.condition))) {
    conditions[condition] = summarizePerfCondition(
      blocks.filter((block) => block.condition === condition).map((block) => block.result),
    );
  }
  const sampledDeltas = expectedTown === true ? deriveTownPerformanceDeltas(conditions) : null;
  const directRenderAttribution =
    expectedTown === true
      ? await measureTownDirectRenderAttribution(page, attribution.refs, contractId)
      : null;
  return {
    attributionTargets: attribution.targets,
    sequence: blocks.map((block) => block.result.summary),
    conditions,
    sampledDeltas,
    directRenderAttribution,
    deltas: directRenderAttribution?.deltas ?? null,
  };
}

async function measurePerformance(
  page,
  sceneState,
  renderState,
  viewName = 'close',
  profileName = 'desktop-ultra',
) {
  const blocks = [];
  if (expectedArmoury) {
    for (const shadowEnabled of [true, false]) {
      for (let repeat = 1; repeat <= PERF_REPEATS; repeat++) {
        const visibilityOrder = repeat % 2 === 1 ? [true, false] : [false, true];
        for (const meshVisible of visibilityOrder) {
          const label = `${meshVisible ? 'visible' : 'hidden'}-shadow-${shadowEnabled ? 'on' : 'off'}-${repeat}`;
          blocks.push({
            condition: `${meshVisible ? 'visible' : 'hidden'}Shadow${shadowEnabled ? 'On' : 'Off'}`,
            result: await measurePerfBlock(page, {
              label,
              meshVisible,
              shadowEnabled,
            }),
          });
        }
      }
    }
  } else {
    for (const shadowEnabled of [true, false]) {
      for (let repeat = 1; repeat <= PERF_REPEATS; repeat++) {
        blocks.push({
          condition: `baseTotalShadow${shadowEnabled ? 'On' : 'Off'}`,
          result: await measurePerfBlock(page, {
            label: `base-total-shadow-${shadowEnabled ? 'on' : 'off'}-${repeat}`,
            meshVisible: null,
            shadowEnabled,
          }),
        });
      }
    }
  }

  const conditions = {};
  for (const condition of new Set(blocks.map((block) => block.condition))) {
    conditions[condition] = summarizePerfCondition(
      blocks.filter((block) => block.condition === condition).map((block) => block.result),
    );
  }
  let deltas = null;
  let sampledDeltas = null;
  let directRenderAttribution = null;
  if (expectedArmoury) {
    sampledDeltas = deriveArmouryPerformanceDeltas(conditions);
    directRenderAttribution = await measureDirectRenderAttribution(page);
    deltas = directRenderAttribution.deltas;
  }

  return {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    gameUrl: GAME_URL,
    shotPrefix: SHOT_PREFIX,
    expectedArmoury,
    profile: profileName,
    view: viewName,
    timingBasis:
      'uncapped requestAnimationFrame throughput and game CPU submit phase, not GPU timing',
    sample: {
      warmupMs: PERF_WARMUP_MS,
      sampleMs: PERF_SAMPLE_MS,
      repeats: PERF_REPEATS,
    },
    world: sceneState,
    gl: renderState.gl,
    settings: renderState.settings,
    initialResources: renderState.resources,
    sequence: blocks.map((block) => block.result.summary),
    conditions,
    deltas,
    sampledDeltas,
    directRenderAttribution,
  };
}

async function measureTownPerformance(page, profile, coldStart, diagnostics, assetFailures) {
  const scenarios = [];
  let initialRenderState = null;
  for (const scenario of perfScenarios) {
    const view = (townContract?.views ?? EASTBROOK_TOWN_CAPTURE_VIEWS).find(
      (candidate) => candidate.name === scenario.viewName,
    );
    if (!view) throw new Error(`town performance view is unavailable: ${scenario.viewName}`);
    const sceneState = await stageView(page, view);
    if (typeof expectedTown === 'boolean') {
      assertTownArmouryIdentity(sceneState.lot, expectedTown);
    }
    const settleStartedAt = Date.now();
    await delay(EASTBROOK_TOWN_CAPTURE_TIMING.viewSettleMs);
    const settleObservedMs = Date.now() - settleStartedAt;
    const renderState = await readRenderState(page);
    initialRenderState ??= renderState;
    assertCaptureRenderState({
      renderState,
      expectedSeed: EXPECTED_SEED,
      profile,
      view,
      expectedArmoury,
      playerState: PLAYER_STATE,
      requireArmouryVisible: false,
    });
    const measurement = await measureTownScenario(page, assetFailures, townContractId);
    scenarios.push({
      name: scenario.name,
      view: scenario.viewName,
      world: sceneState,
      settle: {
        requestedMs: EASTBROOK_TOWN_CAPTURE_TIMING.viewSettleMs,
        observedMs: settleObservedMs,
      },
      ...measurement,
    });
  }
  return {
    schemaVersion: 2,
    capturedAt: new Date().toISOString(),
    captureScope: 'town',
    gameUrl: GAME_URL,
    shotPrefix: SHOT_PREFIX,
    source: {
      comparison:
        townContract?.sourceComparison ??
        (expectedTown === true
          ? 'feature-worktree'
          : expectedTown === false
            ? 'pr-2356-head'
            : 'exploratory'),
      revision: sourceRevision,
      fingerprint: townSourceFingerprint,
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
          attributionTargets: townContract.attributionTargets.map((target) => ({
            ...target,
          })),
          overlayRecordCounts: townContract.overlayRecordCounts,
          motionCapture: townContract.motionCapture,
          ...(townContract.polishProvenance
            ? { polishProvenance: townContract.polishProvenance }
            : {}),
        }
      : null,
    expectedArmoury,
    expectedTown,
    profile: profile.name,
    timingBasis: 'CPU and requestAnimationFrame timing only; GPU timing was not measured',
    coldStart,
    sample: {
      phase: 'warmed',
      warmupMs: PERF_WARMUP_MS,
      sampleMs: PERF_SAMPLE_MS,
      repeats: PERF_REPEATS,
    },
    gl: initialRenderState?.gl ?? null,
    settings: initialRenderState?.settings ?? profile.settings,
    initialResources: initialRenderState?.resources ?? null,
    scenarios,
    assetFailures,
    captureDiagnostics: diagnostics,
  };
}

for (const profile of profiles) {
  console.log(`capture profile: ${profile.name}`);
  const deterministicScreenshotArgs = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
  const actualPerformanceArgs = ['--ignore-gpu-blocklist', '--enable-gpu'];
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    // Chrome's macOS headless compositor performs a startup WebGL
    // loss/restore while switching to Metal. Native performance evidence uses
    // the real headful compositor so a context-loss run is rejected rather
    // than normalized into the samples.
    headless: MEASURE_PERF ? false : 'new',
    args: [
      `--window-size=${profile.viewport.width},${profile.viewport.height}`,
      '--disable-dev-shm-usage',
      '--autoplay-policy=no-user-gesture-required',
      '--enable-precise-memory-info',
      ...(MEASURE_PERF ? actualPerformanceArgs : deterministicScreenshotArgs),
    ],
    defaultViewport: profile.viewport,
  });
  let page = null;
  try {
    page = await browser.newPage();
    const pageErrors = [];
    const consoleErrors = [];
    const ignoredConsoleErrors = [];
    const pendingProxyFailures = [];
    const observedProxyFailures = [];
    const successfulAssetResponses = new Set();
    const assetFailures = [];
    const metadataRecords = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('response', (response) => {
      if (expectedCaptureProxyResponse(response.url(), response.status())) {
        const pathname = new URL(response.url()).pathname;
        pendingProxyFailures.push(pathname);
        observedProxyFailures.push(pathname);
      }
      const assetUrl = captureAssetUrlForNetwork(response.url());
      if (!assetUrl) return;
      // A settings refresh can revalidate an already-loaded GLB or atlas while
      // the paired motion frames are being captured. HTTP 304 confirms that
      // cached response; it is not an asset-load failure.
      if (response.ok() || response.status() === 304) successfulAssetResponses.add(assetUrl);
      else {
        assetFailures.push({
          assetUrl,
          requestUrl: response.url(),
          status: response.status(),
          reason: response.statusText(),
        });
      }
    });
    page.on('requestfailed', (request) => {
      const assetUrl = captureAssetUrlForNetwork(request.url());
      if (!assetUrl) return;
      assetFailures.push({
        assetUrl,
        requestUrl: request.url(),
        status: null,
        reason: request.failure()?.errorText ?? 'request failed',
      });
    });
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = message.text();
      const sourceUrl = message.location().url;
      if (expectedCaptureEnvironmentError(text)) {
        ignoredConsoleErrors.push(text);
      } else if (expectedCaptureProxyConsoleSource(text, sourceUrl)) {
        ignoredConsoleErrors.push(`${text} [matched ${new URL(sourceUrl).pathname}]`);
      } else if (expectedCaptureProxyConsoleError(text) && pendingProxyFailures.length > 0) {
        ignoredConsoleErrors.push(`${text} [matched ${pendingProxyFailures.shift()}]`);
      } else {
        consoleErrors.push(sourceUrl ? `${text} [source ${sourceUrl}]` : text);
      }
    });

    if (profile.mobile) {
      await page.emulate({
        viewport: profile.viewport,
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
          '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      });
      const cdp = await page.target().createCDPSession();
      await cdp.send('Emulation.setEmulatedMedia', {
        features: [
          { name: 'pointer', value: 'coarse' },
          { name: 'hover', value: 'none' },
        ],
      });
    }

    await page.evaluateOnNewDocument(
      ({ settings, introKey, enablePerf }) => {
        localStorage.setItem('woc_settings', JSON.stringify(settings));
        localStorage.setItem(introKey, '1');
        if (enablePerf) localStorage.setItem('woc_perf', '1');
      },
      {
        settings: profile.settings,
        introKey: `woc_spawn_intro_seen:offline:${CHARACTER_CLASS}:${CHARACTER_NAME}`,
        enablePerf: MEASURE_PERF,
      },
    );
    await suppressGpuNotice(page);
    const coldStartedAt = Date.now();
    await page.goto(`${GAME_URL}/${profile.query}`, {
      waitUntil: 'networkidle0',
      timeout: 60000,
    });
    console.log(`page ready: ${profile.name}`);
    if (profile.mobile) {
      await page.evaluate(() => document.body.classList.add('mobile-touch'));
    }
    const booted = await enterOfflineGame(page, {
      charClass: CHARACTER_CLASS,
      charName: CHARACTER_NAME,
      settleMs: EASTBROOK_TOWN_CAPTURE_TIMING.bootSettleMs,
      gameBootTimeoutMs: 60000,
    });
    if (!booted) throw new Error('offline game did not boot');
    const coldCompletedAt = Date.now();
    const coldRuntime = await page.evaluate(() => {
      const report = window.__game.perf.report();
      const perfStats = window.__game.renderer.perfStats();
      return {
        preloadWaitMs: report.assets?.preload?.waitMs ?? null,
        preload: report.assets?.preload ?? null,
        rendererPrewarm: perfStats.prewarm ?? null,
      };
    });
    const coldStart = {
      navigationAndBootMs: coldCompletedAt - coldStartedAt,
      bootSettleMs: EASTBROOK_TOWN_CAPTURE_TIMING.bootSettleMs,
      ...coldRuntime,
    };
    console.log(`game ready: ${profile.name}`);
    const initialViewportSnapshot = await readViewportSnapshot(page);
    const { touchHudVisible: initialTouchHudVisible, ...initialViewport } = initialViewportSnapshot;
    if (profile.mobile && !initialTouchHudVisible) {
      throw new Error('mobile touch HUD is not visible after game boot');
    }
    const runtimeBaseline = await readRuntimeMutationState(page);
    const townInventory =
      captureScope === 'town' ? await readTownPlacementInventory(page, townContractId) : null;

    for (const view of views) {
      console.log(`staging view: ${profile.name}/${view.name}`);
      const sceneState = await stageView(page, view);
      if (captureScope === 'town') {
        if (typeof expectedTown === 'boolean') {
          assertTownArmouryIdentity(sceneState.lot, expectedTown);
        }
      } else {
        assertMatchedLotIdentity(sceneState.lot, expectedArmoury);
      }
      const settleStartedAt = Date.now();
      const settleDeadline = settleStartedAt + EASTBROOK_TOWN_CAPTURE_TIMING.viewSettleMs;
      do {
        await delay(Math.max(1, settleDeadline - Date.now()));
      } while (Date.now() < settleDeadline);
      const settleObservedMs = Date.now() - settleStartedAt;
      const renderState = await readRenderState(page);
      assertCaptureRenderState({
        renderState,
        expectedSeed: EXPECTED_SEED,
        profile,
        view,
        expectedArmoury,
        playerState: PLAYER_STATE,
        requireArmouryVisible:
          captureScope !== 'town' ||
          [
            'elevated-overview',
            'planning-top-down',
            'armoury-facade',
            'armoury-relation',
            'side-rear-proof',
          ].includes(view.name),
      });
      const townContractState = townContract ? await resolveTownContractTargets(page) : null;
      if (townContractState) {
        assertTownAttributionTargetState({
          targets: townContractState.targets,
          contractId: townContractId,
          requestedVisible: true,
        });
      }
      assertNoCaptureErrors(pageErrors, consoleErrors);

      const output = path.join(OUT_DIR, `${SHOT_PREFIX}-${view.name}-${profile.name}.png`);
      let overlay = {
        requested: false,
        installedDuringCapture: false,
        removedAfterCapture: true,
        source: null,
        unsupportedReason: null,
        recordCounts: { obbs: 0, circles: 0, points: 0, gates: 0 },
        records: { obbs: [], circles: [], points: [], gates: [] },
        npcFacings: { sourceLayoutId: null, arrowLength: 1.5, records: [] },
      };
      let motionEvidence = null;
      try {
        if (captureScope === 'town' && view.name === 'interaction-collider-overlay') {
          overlay = await installTownCaptureOverlay(page);
          if (townContract) {
            assertTownNpcFacingOverlay({ overlay, contractId: townContractId });
          }
        }
        if (!MEASURE_PERF) {
          console.log(`writing screenshot: ${output}`);
          await page.screenshot({ path: output });
          if (townContract?.motionCapture?.viewName === view.name) {
            motionEvidence = await captureTownMotionEvidence(page, output, output);
          }
        }
      } finally {
        const removed = await removeTownCaptureOverlay(page);
        overlay.removedAfterCapture = removed;
      }
      assertNoCaptureErrors(pageErrors, consoleErrors);
      const cleanup = captureCleanupState(runtimeBaseline, await readRuntimeMutationState(page));
      assertCaptureCleanupState({
        cleanup,
        label: `${profile.name}/${view.name}`,
      });
      const viewportSnapshot = await readViewportSnapshot(page);
      const { touchHudVisible, ...observedViewport } = viewportSnapshot;
      if (captureScope === 'town') {
        const expectedInventory =
          typeof expectedTown === 'boolean'
            ? expectedTownPlacementInventory(expectedTown, townContractId)
            : null;
        const metadata = {
          schemaVersion: 2,
          captureScope: 'town',
          captureMode: MEASURE_PERF ? 'performance' : 'screenshots',
          source: {
            comparison:
              townContract?.sourceComparison ??
              (expectedTown === true
                ? 'feature-worktree'
                : expectedTown === false
                  ? 'pr-2356-head'
                  : 'exploratory'),
            revision: sourceRevision,
            fingerprint: townSourceFingerprint,
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
                attributionTargets: townContract.attributionTargets.map((target) => ({
                  ...target,
                })),
                overlayRecordCounts: townContract.overlayRecordCounts,
                motionCapture: townContract.motionCapture,
                ...(townContract.polishProvenance
                  ? { polishProvenance: townContract.polishProvenance }
                  : {}),
              }
            : null,
          expected: {
            armoury: expectedArmoury,
            bankerChestCount: 1,
            townRoot: expectedTown,
            inventory: expectedInventory,
            newAssetUrls: [...EASTBROOK_TOWN_NEW_ASSET_URLS],
            surfaceAtlasUrl: EASTBROOK_TOWN_SURFACE_ATLAS_URL,
            timing: { ...EASTBROOK_TOWN_CAPTURE_TIMING },
          },
          observed: {
            armouryPresent: renderState.assetPresent,
            armouryRecord: sceneState.lot,
            bankerChestPresent: renderState.bankerChestCount > 0,
            bankerChestCount: renderState.bankerChestCount,
            townRoot: renderState.townRoot,
            inventory: townInventory,
            assetStates: observedTownAssetStates(
              renderState,
              successfulAssetResponses,
              assetFailures,
            ),
            surfaceAtlas: renderState.surfaceAtlas,
            contractTargets: townContractState?.targets ?? [],
            contractAssetStates: townContract
              ? observedTownAssetStates(
                  renderState,
                  successfulAssetResponses,
                  assetFailures,
                  captureAssetUrls,
                )
              : [],
          },
          renderer: {
            vendor: renderState.gl.vendor,
            renderer: renderState.gl.renderer,
            tier: renderState.tier,
            settings: renderState.settings,
            governorEnabled: renderState.autoGovernor,
            contextLost: renderState.context.lost,
            contextRestored: renderState.context.restored,
            resources: renderState.resources,
          },
          viewport: {
            expected: { ...profile.viewport },
            initial: initialViewport,
            observed: observedViewport,
            physical: {
              width: profile.viewport.width * profile.viewport.deviceScaleFactor,
              height: profile.viewport.height * profile.viewport.deviceScaleFactor,
            },
            touchHudVisible,
          },
          world: {
            seed: sceneState.seed,
            lot: sceneState.lot,
            player: sceneState.player,
            camera: sceneState.camera,
            target: sceneState.target,
          },
          settle: {
            requestedMs: EASTBROOK_TOWN_CAPTURE_TIMING.viewSettleMs,
            observedMs: settleObservedMs,
            completed: settleObservedMs >= EASTBROOK_TOWN_CAPTURE_TIMING.viewSettleMs,
            boot: coldStart,
          },
          overlay,
          motionEvidence,
          diagnostics: {
            pageErrors: [...pageErrors],
            consoleErrors: [...consoleErrors],
            ignoredConsoleErrors: [...ignoredConsoleErrors],
            expectedFailures: [...observedProxyFailures],
            assetFailures: [...assetFailures],
          },
          cleanup,
        };
        if (typeof expectedTown === 'boolean') {
          assertTownCaptureMetadata({
            metadata,
            contractId: townContractId,
            expectedTown,
            expectedArmoury,
            profile,
            view,
            playerState: PLAYER_STATE,
            expectedSeed: EXPECTED_SEED,
            settleMs: EASTBROOK_TOWN_CAPTURE_TIMING.viewSettleMs,
            expectedPolishProvenance: polishProvenance,
          });
        }
        metadataRecords.push({
          output: MEASURE_PERF ? null : output,
          ...metadata,
        });
      }
      console.log(
        JSON.stringify(
          {
            output: MEASURE_PERF ? null : output,
            profile: profile.name,
            view: view.name,
            sceneState,
            renderState,
            pageErrors,
            consoleErrors,
            ignoredConsoleErrors,
          },
          null,
          2,
        ),
      );
    }

    if (captureScope === 'town' && !MEASURE_PERF) {
      const metadataOutput = writeCaptureMetadata(profile.name, metadataRecords);
      console.log(JSON.stringify({ metadataOutput, records: metadataRecords.length }, null, 2));
    }

    if (MEASURE_PERF) {
      let performance;
      if (captureScope === 'town') {
        performance = await measureTownPerformance(
          page,
          profile,
          coldStart,
          {
            pageErrors: [...pageErrors],
            consoleErrors: [...consoleErrors],
            ignoredConsoleErrors: [...ignoredConsoleErrors],
            expectedFailures: [...observedProxyFailures],
          },
          [...assetFailures],
        );
      } else {
        const perfView = views.find((view) => view.name === 'close');
        if (!perfView) throw new Error('selected capture views are missing close');
        const sceneState = await stageView(page, perfView);
        assertMatchedLotIdentity(sceneState.lot, expectedArmoury);
        await delay(EASTBROOK_TOWN_CAPTURE_TIMING.viewSettleMs);
        const renderState = await readRenderState(page);
        assertCaptureRenderState({
          renderState,
          expectedSeed: EXPECTED_SEED,
          profile,
          view: perfView,
          expectedArmoury,
          playerState: PLAYER_STATE,
        });
        performance = await measurePerformance(
          page,
          sceneState,
          renderState,
          perfView.name,
          profile.name,
        );
      }
      performance.assetFailures = [...assetFailures];
      performance.captureDiagnostics = {
        pageErrors: [...pageErrors],
        consoleErrors: [...consoleErrors],
        ignoredConsoleErrors: [...ignoredConsoleErrors],
        expectedFailures: [...observedProxyFailures],
        assetFailures: [...assetFailures],
      };
      assertNoCaptureErrors(pageErrors, consoleErrors);
      const performanceOutput = townPerformanceOutputPath(profile.name);
      mkdirSync(path.dirname(performanceOutput), { recursive: true });
      writeFileSync(performanceOutput, `${JSON.stringify(performance, null, 2)}\n`);
      const cleanup = captureCleanupState(runtimeBaseline, await readRuntimeMutationState(page));
      assertCaptureCleanupState({
        cleanup,
        label: `${profile.name}/performance`,
      });
      console.log(JSON.stringify({ performanceOutput, performance, cleanup }, null, 2));
    }
  } finally {
    if (page && !page.isClosed()) {
      await removeTownCaptureOverlay(page).catch(() => false);
    }
    const closePromise = browser.close();
    const closed = await Promise.race([
      closePromise.then(
        () => true,
        () => false,
      ),
      delay(5000).then(() => false),
    ]);
    if (!closed) {
      // Chromium can finish writing a mobile SwiftShader capture yet leave its
      // control connection open. Terminate only this helper's child process so
      // automated evidence runs do not leak capture processes.
      browser.process()?.kill('SIGKILL');
      browser.disconnect();
    }
  }
}
