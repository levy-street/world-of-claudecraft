// Capture matched Fenbridge rebuild evidence from a running World of
// ClaudeCraft client. This is intentionally a thin browser orchestrator; the
// immutable contract and its integrity checks live in capture_contract.mjs.
//
// Required:
//   GAME_URL          running worktree URL, for example http://127.0.0.1:5184
//   SHOT_PREFIX       normally before or after
//   EXPECT_FENBRIDGE  0 for the release base, 1 for the rebuild
//
// Optional:
//   ACCEPTANCE_MODE   1 requires the renderer root/inventory/overlay contract
//   PROFILE_NAME      desktop-ultra or mobile-low
//   VIEW_NAME         one named view from capture_contract.mjs
//   OUT_DIR           screenshot directory
//   METADATA_OUT      explicit batch metadata path
//   SOURCE_REVISION   exact served revision/source identifier

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH } from '../../browser_path.mjs';
import { enterOfflineGame } from '../../enter_offline_game.mjs';
import { suppressGpuNotice } from '../../lib/gpu_notice_suppress.mjs';
import {
  assertFenbridgeCaptureArtifactFiles,
  assertFenbridgeCaptureBatchMetadata,
  assertFenbridgeCaptureMetadata,
  assertFenbridgeCaptureRenderState,
  captureFrameFilename,
  captureMetadataFilename,
  classifyFenbridgePlacementInventory,
  FENBRIDGE_CAPTURE_CHARACTER,
  FENBRIDGE_CAPTURE_HOOK_CONTRACT,
  FENBRIDGE_CAPTURE_SEED,
  FENBRIDGE_CAPTURE_TIMING,
  FENBRIDGE_EXPECTED_LOCAL_PROXY_502_PATHS,
  FENBRIDGE_GAMEPLAY_CONTRACT,
  FENBRIDGE_LAYOUT_ID,
  FENBRIDGE_LOCKED_ROUTE_ANCHORS,
  FENBRIDGE_PLAYER_STATE,
  FENBRIDGE_REBUILD_REQUIRED_IDS,
  FENBRIDGE_REPEATED_ASSET_REQUIREMENTS,
  FENBRIDGE_REQUIRED_ASSET_REQUEST_URLS,
  FENBRIDGE_STREAMING_CONTRACT,
  FENBRIDGE_TOWN_ROOT_NAME,
  FENBRIDGE_TRAVERSAL_BODY_RADII,
  fenbridgeAcceptanceReadiness,
  fenbridgeAssetRequestMatches,
  fenbridgePngFrameEvidence,
  selectFenbridgeCaptureConfiguration,
} from './capture_contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const config = selectFenbridgeCaptureConfiguration(process.env);
const outputDir = path.resolve(ROOT, config.outputDir);
// The shared contract keeps this below the real sixteen-code-point offline
// character-name limit; tests pin that boundary so capture cannot silently
// strand itself on the character picker.
const character = FENBRIDGE_CAPTURE_CHARACTER;

mkdirSync(outputDir, { recursive: true });

function metadataPath() {
  if (config.metadataOut) return path.resolve(config.metadataOut);
  return path.join(
    ROOT,
    'docs/screenshots/fenbridge-rebuild/metadata',
    captureMetadataFilename(config.shotPrefix, 'batch'),
  );
}

function buildBatchMetadata(profileBatches, complete) {
  return {
    schemaVersion: 1,
    captureScope: 'fenbridge-town-batch',
    complete,
    contract: {
      layoutId: FENBRIDGE_LAYOUT_ID,
      rootName: FENBRIDGE_TOWN_ROOT_NAME,
      expectedFenbridge: config.expectedFenbridge,
      acceptanceMode: config.acceptanceMode,
    },
    source: { revision: config.sourceRevision },
    profiles: profileBatches,
  };
}

function writeMetadata(profileBatches, complete = false) {
  const output = metadataPath();
  const metadata = buildBatchMetadata(profileBatches, complete);
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(metadata, null, 2)}\n`);
  return { output, metadata };
}

function expectedEnvironmentConsoleError(message) {
  return (
    /Failed to fetch project stats/i.test(message) ||
    (/THREE\.WebGLProgram: Shader Error/.test(message) &&
      /Material Name: (?:EquirectangularToCubeUV|SphericalGaussianBlur)/.test(message)) ||
    /character visual unavailable, skipping view \(mob_training_dummy\)/.test(message)
  );
}

// These client reports legitimately target the production API. A standalone
// Vite evidence server has no API process behind its proxy, so its 502s are an
// environment condition rather than a renderer or asset failure.
function expectedProxyConsoleError(message, sourceUrl) {
  if (!/^Failed to load resource: the server responded with a status of 502/i.test(message)) {
    return false;
  }
  try {
    return FENBRIDGE_EXPECTED_LOCAL_PROXY_502_PATHS.includes(new URL(sourceUrl).pathname);
  } catch {
    return false;
  }
}

function expectedProxyResponse(url, status) {
  if (status !== 502) return false;
  try {
    return FENBRIDGE_EXPECTED_LOCAL_PROXY_502_PATHS.includes(new URL(url).pathname);
  } catch {
    return false;
  }
}

function fenbridgeAssetPath(url) {
  try {
    const pathname = new URL(url).pathname;
    return FENBRIDGE_REQUIRED_ASSET_REQUEST_URLS.some((logicalUrl) =>
      fenbridgeAssetRequestMatches(logicalUrl, pathname),
    )
      ? pathname
      : null;
  } catch {
    return null;
  }
}

async function configureMobileProfile(page, profile) {
  if (!profile.mobile) return;
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

async function installCaptureNoticeDismissal(page) {
  await page.evaluate(() => {
    const dismiss = () => {
      const notices = [
        ['gpu-notice', '.gpu-notice-dismiss'],
        ['perf-nudge', '.perf-nudge-dismiss'],
      ];
      for (const [rootId, buttonSelector] of notices) {
        const root = document.getElementById(rootId);
        if (root?.isConnected && !root.hidden) root.querySelector(buttonSelector)?.click();
      }
    };
    const html = document.documentElement;
    if (html.dataset.fenbridgeCaptureNoticeDismissal !== '1') {
      const observer = new MutationObserver(dismiss);
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['hidden'],
      });
      html.dataset.fenbridgeCaptureNoticeDismissal = '1';
    }
    dismiss();
  });
}

async function dismissCaptureNotices(page) {
  await page.evaluate(() => {
    const gpuNotice = document.getElementById('gpu-notice');
    const performanceNotice = document.getElementById('perf-nudge');
    if (gpuNotice?.isConnected && !gpuNotice.hidden) {
      gpuNotice.querySelector('.gpu-notice-dismiss')?.click();
    }
    if (performanceNotice?.isConnected && !performanceNotice.hidden) {
      performanceNotice.querySelector('.perf-nudge-dismiss')?.click();
    }
  });
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

async function exerciseCrossZoneStreaming(page) {
  return page.evaluate(
    async ({ seed, playerState, streamingContract }) => {
      const game = window.__game;
      if (!game?.sim?.player || !game.renderer) throw new Error('game runtime is unavailable');
      if (game.sim.cfg.seed !== seed) {
        throw new Error(`expected world seed ${seed}, got ${game.sim.cfg.seed}`);
      }
      const { groundHeight } = await import('/src/sim/world.ts');
      const renderer = game.renderer;
      if (
        typeof renderer.isZonePreparedAt !== 'function' ||
        typeof renderer.isZoneReadyAt !== 'function' ||
        typeof renderer.zoneIdAt !== 'function'
      ) {
        throw new Error('renderer zone-streaming readiness API is unavailable');
      }

      const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
      const setPlayer = (x, z, facing = playerState.facing) => {
        const y = groundHeight(x, z, seed);
        const player = game.sim.player;
        player.pos.x = x;
        player.pos.y = y;
        player.pos.z = z;
        player.prevPos.x = x;
        player.prevPos.y = y;
        player.prevPos.z = z;
        player.facing = facing;
        player.dead = false;
        player.hp = player.maxHp = 999_999;
      };

      game.renderer.editorCam = null;
      game.input?.clearTouchMove?.();
      game.input?.setTouchLook?.(false);
      const targetReadyBeforeCrossing = renderer.isZoneReadyAt(
        streamingContract.target.x,
        streamingContract.target.z,
      );

      setPlayer(streamingContract.from.x, streamingContract.from.z, streamingContract.travelFacing);
      await nextFrame();
      await nextFrame();
      const fromZone = renderer.zoneIdAt(streamingContract.from.x, streamingContract.from.z);
      const targetReadyAtFrom = renderer.isZoneReadyAt(
        streamingContract.target.x,
        streamingContract.target.z,
      );

      const startedAt = performance.now();
      const deadline = startedAt + streamingContract.timeoutMs;
      setPlayer(
        streamingContract.crossing.x,
        streamingContract.crossing.z,
        streamingContract.travelFacing,
      );
      await nextFrame();
      await nextFrame();
      const crossingZone = renderer.zoneIdAt(
        streamingContract.crossing.x,
        streamingContract.crossing.z,
      );
      const targetReadyAtCrossing = renderer.isZoneReadyAt(
        streamingContract.target.x,
        streamingContract.target.z,
      );

      // Do not invoke prepareZoneAt/prewarmZoneAt here. Moving over the real
      // boundary lets the game loop and visible-zone queue own the transition;
      // this poll waits on the same public readiness predicate gameplay uses.
      const readinessStartedAt = performance.now();
      let stableFrames = 0;
      while (stableFrames < streamingContract.readyStableFrames) {
        if (performance.now() > deadline) {
          throw new Error(
            `timed out waiting for ${streamingContract.target.zoneId} streaming readiness`,
          );
        }
        stableFrames = renderer.isZoneReadyAt(
          streamingContract.target.x,
          streamingContract.target.z,
        )
          ? stableFrames + 1
          : 0;
        await nextFrame();
      }

      setPlayer(playerState.x, playerState.z, playerState.facing);
      const playerGroundY = groundHeight(playerState.x, playerState.z, seed);
      if (Math.abs(playerGroundY - playerState.y) > 0.001) {
        throw new Error(
          `Fenbridge player anchor height drifted: expected ${playerState.y}, got ${playerGroundY}`,
        );
      }

      const result = {
        fromZone,
        crossingZone,
        targetZone: renderer.zoneIdAt(streamingContract.target.x, streamingContract.target.z),
        targetReadyBeforeCrossing,
        targetReadyAtFrom,
        targetReadyAtCrossing,
        readinessPath: targetReadyAtFrom ? 'prestreamed' : 'automatic-wait',
        readinessApi: 'renderer.isZoneReadyAt',
        readinessDeadlineStartedBeforeCrossing: true,
        readinessPollStartedAfterCrossing: true,
        directPrepareZoneAtCalled: false,
        directPrewarmZoneAtCalled: false,
        waitedForReady: true,
        targetPrepared: renderer.isZonePreparedAt(
          streamingContract.target.x,
          streamingContract.target.z,
        ),
        targetReady: renderer.isZoneReadyAt(streamingContract.target.x, streamingContract.target.z),
        readyStableFrames: stableFrames,
        waitMs: Math.round((performance.now() - readinessStartedAt) * 10) / 10,
        crossingToReadyMs: Math.round((performance.now() - startedAt) * 10) / 10,
        stats:
          typeof renderer.zoneStreamingStats === 'function' ? renderer.zoneStreamingStats() : null,
      };
      window.__fenbridgeCaptureStreaming = result;
      return result;
    },
    {
      seed: FENBRIDGE_CAPTURE_SEED,
      playerState: FENBRIDGE_PLAYER_STATE,
      streamingContract: FENBRIDGE_STREAMING_CONTRACT,
    },
  );
}

async function setCaptureOverlay(page, requested) {
  return page.evaluate(
    async ({ requestedVisible, rootName, overlayName }) => {
      const renderer = window.__game?.renderer;
      if (!renderer) throw new Error('renderer is unavailable');
      const root = renderer.scene.getObjectByName(rootName);
      const rootController = root?.userData?.setFenbridgeCaptureOverlay;
      const rendererController = renderer.setFenbridgeCaptureOverlay;
      const controller =
        typeof rendererController === 'function'
          ? { owner: renderer, fn: rendererController, source: 'renderer' }
          : typeof rootController === 'function'
            ? {
                owner: root.userData,
                fn: rootController,
                source: 'root.userData',
              }
            : null;
      if (controller) await controller.fn.call(controller.owner, requestedVisible);
      const overlay = renderer.scene.getObjectByName(overlayName);
      let hierarchyVisible = Boolean(overlay);
      for (let object = overlay; object; object = object.parent)
        hierarchyVisible &&= object.visible;
      const captureRecords = overlay?.userData?.captureRecords ?? {};
      const recordIds = {};
      const recordCounts = {};
      let renderableCount = 0;
      overlay?.traverse((object) => {
        if (object.isMesh || object.isLine || object.isLineSegments || object.isPoints) {
          renderableCount++;
        }
      });
      for (const kind of ['colliders', 'routes', 'services']) {
        const records = Array.isArray(captureRecords[kind]) ? captureRecords[kind] : [];
        recordIds[kind] = records.map((record, index) =>
          typeof record === 'string'
            ? record
            : String(record?.id ?? record?.name ?? record?.placementId ?? `${kind}-${index}`),
        );
        recordCounts[kind] = records.length;
      }
      return {
        requested: requestedVisible,
        supported: Boolean(controller),
        visible: Boolean(overlay) && hierarchyVisible,
        source: controller?.source ?? null,
        objectName: overlay?.name ?? null,
        renderableCount,
        recordIds,
        recordCounts,
      };
    },
    {
      requestedVisible: requested,
      rootName: FENBRIDGE_CAPTURE_HOOK_CONTRACT.rootName,
      overlayName: FENBRIDGE_CAPTURE_HOOK_CONTRACT.overlayName,
    },
  );
}

async function stageView(page, view) {
  const overlay = await setCaptureOverlay(page, view.overlay === 'collision-routes');
  const state = await page.evaluate(
    async ({ seed, playerState, viewState }) => {
      const game = window.__game;
      if (!game?.sim?.player || !game.renderer) throw new Error('game runtime is unavailable');
      const [{ isBlocked }, { groundHeight }] = await Promise.all([
        import('/src/sim/colliders.ts'),
        import('/src/sim/world.ts'),
      ]);
      if (isBlocked(seed, playerState.x, playerState.z, 0.5)) {
        throw new Error('Fenbridge capture player anchor is blocked at body radius 0.5');
      }
      const playerY = groundHeight(playerState.x, playerState.z, seed);
      if (Math.abs(playerY - playerState.y) > 0.001) {
        throw new Error(
          `Fenbridge player anchor height drifted: expected ${playerState.y}, got ${playerY}`,
        );
      }
      const player = game.sim.player;
      player.pos.x = playerState.x;
      player.pos.y = playerY;
      player.pos.z = playerState.z;
      player.prevPos.x = player.pos.x;
      player.prevPos.y = player.pos.y;
      player.prevPos.z = player.pos.z;
      player.facing = playerState.facing;
      player.dead = false;
      player.hp = player.maxHp = 999_999;
      game.input?.clearTouchMove?.();
      game.input?.setTouchLook?.(false);

      const vector = (value) =>
        game.renderer.camera.position.clone().set(value.x, value.y, value.z);
      game.renderer.editorCam = {
        pos: vector(viewState.camera),
        target: vector(viewState.target),
      };
      // Mirror the editor pose immediately. A throttled startup rAF must not
      // leave the first integrity sample on the stale chase camera.
      game.renderer.camera.position.copy(game.renderer.editorCam.pos);
      game.renderer.cameraLookAt.copy(game.renderer.editorCam.target);
      game.renderer.camera.lookAt(game.renderer.cameraLookAt);
      game.renderer.camera.updateMatrixWorld();

      let style = document.getElementById('fenbridge-capture-style');
      if (!style) {
        style = document.createElement('style');
        style.id = 'fenbridge-capture-style';
        style.textContent = `
          .nameplate,
          #banner,
          #subzone-banner,
          #quest-banner { display: none !important; }
        `;
        document.head.appendChild(style);
      }
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await new Promise((resolve) => requestAnimationFrame(resolve));
      return {
        playerCollisionClear: !isBlocked(seed, player.pos.x, player.pos.z, 0.5),
      };
    },
    {
      seed: FENBRIDGE_CAPTURE_SEED,
      playerState: FENBRIDGE_PLAYER_STATE,
      viewState: view,
    },
  );
  return { ...state, overlay };
}

async function readRenderState(page, profile, streaming, playerCollisionClear) {
  return page.evaluate(
    async ({ profileState, streamingState, collisionClear }) => {
      const game = window.__game;
      const { GFX } = await import('/src/render/gfx.ts');
      const renderer = game.renderer;
      const camera = renderer.camera;
      const perf = renderer.perfStats();
      const settings = JSON.parse(localStorage.getItem('woc_settings') ?? '{}');
      const touch = navigator.maxTouchPoints > 0 && window.matchMedia('(pointer: coarse)').matches;
      const isVisibleElement = (element) => {
        if (!element?.isConnected) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity) > 0 &&
          rect.width > 0 &&
          rect.height > 0
        );
      };
      const canvas = document.getElementById('game-canvas');
      const canvasRect = canvas?.getBoundingClientRect();
      const touchHud = document.getElementById('mobile-controls');
      const touchHudControls = touchHud
        ? [
            ...touchHud.querySelectorAll(
              'button, input, select, textarea, [role="button"], [tabindex]',
            ),
          ]
        : [];
      return {
        seed: game.sim.cfg.seed,
        tier: GFX.tier,
        autoGovernor: GFX.autoGovernor,
        effectiveRenderScale: perf.effectiveRenderScale,
        settings,
        player: {
          x: game.sim.player.pos.x,
          y: game.sim.player.pos.y,
          z: game.sim.player.pos.z,
          facing: game.sim.player.facing,
        },
        playerCollisionClear: collisionClear,
        zoneId: renderer.zoneIdAt(game.sim.player.pos.x, game.sim.player.pos.z),
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
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          deviceScaleFactor: window.devicePixelRatio,
          physicalWidth: Math.round(window.innerWidth * window.devicePixelRatio),
          physicalHeight: Math.round(window.innerHeight * window.devicePixelRatio),
        },
        mobile: document.body.classList.contains('mobile-touch'),
        touch,
        canvas: {
          connected: canvas?.isConnected === true,
          visible: isVisibleElement(canvas),
          cssWidth: Math.round(canvasRect?.width ?? 0),
          cssHeight: Math.round(canvasRect?.height ?? 0),
          backingWidth: canvas?.width ?? 0,
          backingHeight: canvas?.height ?? 0,
          pixelRatio: renderer.webgl.getPixelRatio(),
          frameCount: renderer.webgl.info.render.frame,
        },
        touchHud: {
          exists: Boolean(touchHud),
          visible: isVisibleElement(touchHud),
          interactiveCount: touchHudControls.length,
          visibleInteractiveCount: touchHudControls.filter(isVisibleElement).length,
        },
        notices: {
          gpu: isVisibleElement(document.getElementById('gpu-notice')),
          performance: isVisibleElement(document.getElementById('perf-nudge')),
        },
        streaming: streamingState,
        profileName: profileState.name,
      };
    },
    {
      profileState: profile,
      streamingState: streaming,
      collisionClear: playerCollisionClear,
    },
  );
}

async function readFenbridgeGameplayEvidence(page) {
  return page.evaluate(
    async ({ gameplayContract, bodyRadii, lockedRouteAnchors, seed }) => {
      const [
        { FENBRIDGE_LAYOUT },
        { ZONE2_ITEMS, ZONE2_QUESTS },
        { findPath, PLAYER_MAX_CLIMB_SLOPE, PLAYER_SWIM_DEPTH },
        { isBlocked, pathCrossesFence },
        { groundHeight, waterLevelAt },
      ] = await Promise.all([
        import('/src/sim/fenbridge_layout.ts'),
        import('/src/sim/content/zone2.ts'),
        import('/src/sim/pathfind.ts'),
        import('/src/sim/colliders.ts'),
        import('/src/sim/world.ts'),
      ]);
      const sim = window.__game?.sim;
      if (!sim) throw new Error('live Fenbridge simulation is unavailable');
      const worldContent = sim.worldContent ?? sim.cfg.world;
      if (!worldContent?.services) {
        throw new Error('live Fenbridge world service registry is unavailable');
      }
      const entities = [...sim.entities.values()];
      const snapshotEntity = (entity) =>
        entity
          ? {
              entityId: entity.id,
              kind: entity.kind,
              templateId: entity.templateId,
              itemId: entity.objectItemId,
              lootable: entity.lootable,
              dead: entity.dead,
              x: entity.pos.x,
              z: entity.pos.z,
            }
          : null;
      const near = (left, right, tolerance = 0.01) =>
        Math.hypot(left.x - right.x, left.z - right.z) <= tolerance;

      const expectedNpcIds = new Set(gameplayContract.npcs.map((expected) => expected.id));
      const npcs = entities
        .filter((entity) => entity.kind === 'npc' && expectedNpcIds.has(entity.templateId))
        .map(snapshotEntity);
      const mailboxLayout = FENBRIDGE_LAYOUT.services.mailbox;
      const mailboxServiceMatches = (worldContent.services.mailboxes ?? []).filter((mailbox) =>
        near(mailbox, mailboxLayout.position),
      );
      const mailboxService = mailboxServiceMatches[0];
      const mailboxEntities = entities.filter(
        (entity) =>
          entity.kind === 'object' &&
          entity.templateId === mailboxLayout.templateId &&
          near(entity.pos, mailboxLayout.position),
      );
      const stationLayout = FENBRIDGE_LAYOUT.services.stations[0];
      const stationMatches = (worldContent.services.stations ?? []).filter(
        (candidate) => candidate.id === stationLayout.id,
      );
      const station = stationMatches[0];
      const graveyardLayout = FENBRIDGE_LAYOUT.services.graveyard;
      const graveyardMatches = (worldContent.services.graveyards ?? []).filter(
        (candidate) => candidate.id === graveyardLayout.id,
      );
      const graveyard = graveyardMatches[0];
      const healerMatches = entities.filter(
        (entity) =>
          entity.kind === 'npc' &&
          entity.templateId === graveyardLayout.healerTemplateId &&
          near(entity.pos, graveyardLayout.position),
      );
      const healer = healerMatches[0];
      const musterOrders = entities
        .filter(
          (entity) =>
            entity.kind === 'object' && entity.objectItemId === gameplayContract.quest.itemId,
        )
        .map((entity) => {
          const placement = FENBRIDGE_LAYOUT.repeated.musterOrders.find((order) =>
            near(entity.pos, order.position),
          );
          return {
            ...snapshotEntity(entity),
            placementId: placement?.id ?? null,
          };
        });
      const questDefinition = ZONE2_QUESTS[gameplayContract.quest.id];
      const questObjective = questDefinition?.objectives?.find(
        (objective) =>
          objective.type === 'collect' && objective.itemId === gameplayContract.quest.itemId,
      );

      const square = { x: 3, z: 303 };
      const destinations = [
        { id: 'south-causeway', point: lockedRouteAnchors['south-causeway'] },
        ...FENBRIDGE_LAYOUT.wall.gates.map((gate) => ({
          id: gate.id,
          point: lockedRouteAnchors[gate.id],
        })),
        ...FENBRIDGE_LAYOUT.services.npcs.map((npc) => ({
          id: npc.id,
          point: npc.position,
        })),
        ...FENBRIDGE_LAYOUT.services.stations.map((service) => ({
          id: service.id,
          point: service.position,
        })),
        {
          id: mailboxLayout.id,
          point: mailboxLayout.frontStandingPoint,
        },
        { id: graveyardLayout.id, point: graveyardLayout.position },
        {
          id: FENBRIDGE_LAYOUT.civic.musterBoard.id,
          point: FENBRIDGE_LAYOUT.civic.musterBoard.frontStandingPoint,
        },
        {
          id: FENBRIDGE_LAYOUT.civic.provisionStall.id,
          point: FENBRIDGE_LAYOUT.civic.provisionStall.customerStandingPoint,
        },
        ...FENBRIDGE_LAYOUT.repeated.musterOrders.map((order) => ({
          id: order.id,
          point: order.position,
        })),
        ...FENBRIDGE_LAYOUT.buildings.map((building) => ({
          id: `${building.id}:entrance`,
          point: building.frontStandingPoint,
        })),
      ];

      const routeRecord = (destinationId, from, to, bodyRadius, direction) => {
        const options = {
          seed,
          bodyRadius,
          maxClimbSlope: PLAYER_MAX_CLIMB_SLOPE,
          minGround: (x, z) => waterLevelAt(x, z, seed) - PLAYER_SWIM_DEPTH,
          maxSpan: 128,
        };
        const waypoints = findPath(from, to, options);
        const points = [from, ...waypoints];
        const startClear = !isBlocked(seed, from.x, from.z, bodyRadius);
        const endClear = !isBlocked(seed, to.x, to.z, bodyRadius);
        let clear = startClear && endClear;
        let sampleCount = 1;
        for (let segmentIndex = 1; segmentIndex < points.length; segmentIndex++) {
          const start = points[segmentIndex - 1];
          const end = points[segmentIndex];
          if (pathCrossesFence(start.x, start.z, end.x, end.z, bodyRadius)) {
            clear = false;
          }
          const dx = end.x - start.x;
          const dz = end.z - start.z;
          const distance = Math.hypot(dx, dz);
          const steps = Math.max(1, Math.ceil(distance / 0.25));
          let previousHeight = groundHeight(start.x, start.z, seed);
          for (let step = 1; step <= steps; step++) {
            const t = step / steps;
            const x = start.x + dx * t;
            const z = start.z + dz * t;
            const height = groundHeight(x, z, seed);
            const stepLength = distance / steps;
            if (
              height < waterLevelAt(x, z, seed) - PLAYER_SWIM_DEPTH ||
              isBlocked(seed, x, z, bodyRadius) ||
              (stepLength > 1e-6 &&
                height > previousHeight &&
                (height - previousHeight) / stepLength > PLAYER_MAX_CLIMB_SLOPE)
            ) {
              clear = false;
            }
            previousHeight = height;
            sampleCount++;
          }
        }
        return {
          destinationId,
          bodyRadius,
          direction,
          clear,
          startClear,
          endClear,
          waypointCount: waypoints.length,
          sampleCount,
          start: { x: from.x, z: from.z },
          end: { x: to.x, z: to.z },
        };
      };
      const routes = [];
      for (const destination of destinations) {
        for (const bodyRadius of bodyRadii) {
          routes.push(routeRecord(destination.id, square, destination.point, bodyRadius, 'out'));
          routes.push(routeRecord(destination.id, destination.point, square, bodyRadius, 'back'));
        }
      }

      return {
        npcs,
        mailbox: {
          id: mailboxLayout.id,
          templateId: mailboxLayout.templateId,
          registrationCount: mailboxServiceMatches.length,
          service: mailboxService ? { x: mailboxService.x, z: mailboxService.z } : null,
          entityCount: mailboxEntities.length,
          entity: snapshotEntity(mailboxEntities[0]),
        },
        station: station
          ? {
              registrationCount: stationMatches.length,
              id: station.id,
              type: station.type,
              zoneId: station.zoneId,
              masterNpcId: station.masterNpcId,
              x: station.pos.x,
              z: station.pos.z,
            }
          : null,
        graveyard: graveyard
          ? {
              registrationCount: graveyardMatches.length,
              id: graveyard.id,
              name: graveyard.name,
              x: graveyard.x,
              z: graveyard.z,
              healerCount: healerMatches.length,
              healer: snapshotEntity(healer),
            }
          : null,
        rest: { ...FENBRIDGE_LAYOUT.services.rest },
        musterOrders,
        quest: {
          id: questDefinition?.id ?? null,
          giverNpcId: questDefinition?.giverNpcId ?? null,
          turnInNpcId: questDefinition?.turnInNpcId ?? null,
          itemId: questObjective?.itemId ?? null,
          count: questObjective?.count ?? null,
          itemQuestId: ZONE2_ITEMS[gameplayContract.quest.itemId]?.questId ?? null,
          state: sim.questState(gameplayContract.quest.id),
        },
        traversability: { routes },
      };
    },
    {
      gameplayContract: FENBRIDGE_GAMEPLAY_CONTRACT,
      bodyRadii: FENBRIDGE_TRAVERSAL_BODY_RADII,
      lockedRouteAnchors: FENBRIDGE_LOCKED_ROUTE_ANCHORS,
      seed: FENBRIDGE_CAPTURE_SEED,
    },
  );
}

async function readObservedFenbridgeState(page, overlayState, gameplayEvidence) {
  const observed = await page.evaluate(
    async ({
      rootName,
      overlayName,
      repeatedKeys,
      requiredPlacementIds,
      overlaySnapshot,
      gameplaySnapshot,
    }) => {
      const { ZONE2_PROPS } = await import('/src/sim/content/zone2.ts');
      const game = window.__game;
      const renderer = game.renderer;
      const root = renderer.scene.getObjectByName(rootName);
      const rootData = root?.userData ?? {};
      const captureData = rootData.captureContract ?? rootData.fenbridgeCapture ?? {};
      const plainCounts = (value) =>
        value instanceof Map
          ? Object.fromEntries(value.entries())
          : value && typeof value === 'object'
            ? { ...value }
            : {};

      const sceneRepeatedCounts = Object.fromEntries(repeatedKeys.map((key) => [key, 0]));
      const scenePlacementIds = new Set();
      const appendScenePlacementIds = (target, value) => {
        if (Array.isArray(value)) {
          for (const entry of value) appendScenePlacementIds(target, entry);
        } else if (typeof value === 'string') {
          target.add(value);
        }
      };
      const visibleWithinRoot = (object) => {
        for (let current = object; current && current !== root; current = current.parent) {
          if (current.visible === false) return false;
        }
        return root?.visible === true;
      };
      let childMeshCount = 0;
      for (const child of root?.children ?? []) {
        child.traverse((object) => {
          if (object.isMesh && visibleWithinRoot(object)) childMeshCount++;
          const taggedPlacementIds = new Set();
          if (requiredPlacementIds.includes(object.name)) {
            taggedPlacementIds.add(object.name);
          }
          appendScenePlacementIds(taggedPlacementIds, object.userData?.placementId);
          appendScenePlacementIds(taggedPlacementIds, object.userData?.placementIds);
          if ([...taggedPlacementIds].some((id) => requiredPlacementIds.includes(id))) {
            let hasVisibleMesh = false;
            object.traverse((descendant) => {
              hasVisibleMesh ||= descendant.isMesh === true && visibleWithinRoot(descendant);
            });
            if (hasVisibleMesh) {
              for (const id of taggedPlacementIds) {
                scenePlacementIds.add(id);
              }
            }
          }
          const key = object.userData?.assetKey ?? object.userData?.placementAssetKey;
          if (
            object.isMesh &&
            visibleWithinRoot(object) &&
            Object.hasOwn(sceneRepeatedCounts, key)
          ) {
            const taggedCount = object.userData?.placementCount;
            // InstancedMesh.count is the live GPU draw count. Never let a
            // declarative placementCount tag spoof that rendered evidence;
            // the tag is only meaningful for non-instanced mesh batches.
            const multiplicity =
              object.isInstancedMesh && Number.isInteger(object.count)
                ? object.count
                : Number.isInteger(taggedCount)
                  ? taggedCount
                  : 1;
            sceneRepeatedCounts[key] += multiplicity;
          }
        });
      }

      const overlayObject = renderer.scene.getObjectByName(overlayName);
      let overlayVisible = Boolean(overlayObject);
      for (let object = overlayObject; object; object = object.parent) {
        overlayVisible &&= object.visible;
      }
      const layoutId = captureData.layoutId ?? rootData.layoutId ?? null;
      const rootAssetUrls = Array.isArray(rootData.assetUrls) ? rootData.assetUrls : [];
      const captureAssetUrls = Array.isArray(captureData.assetUrls) ? captureData.assetUrls : [];
      const entities = [...game.sim.entities.values()];
      const hierarchyIsVisible = (object) => {
        for (let current = object; current; current = current.parent) {
          if (current.visible === false) return false;
        }
        return Boolean(object);
      };
      const meshCount = (object) => {
        let count = 0;
        object?.traverse((child) => {
          if (child.isMesh && hierarchyIsVisible(child)) count++;
        });
        return count;
      };
      const entityView = (entity) =>
        entity
          ? renderer.scene.children.find((child) => child.userData?.entityId === entity.id)
          : null;
      const entityVisual = (entity) => {
        const view = entityView(entity);
        const count = meshCount(view);
        return {
          rendered: Boolean(view) && count > 0,
          entityId: entity?.id ?? null,
          templateId: entity?.templateId ?? null,
          meshCount: count,
        };
      };
      const gameplayNpcIds = new Set((gameplaySnapshot?.npcs ?? []).map((npc) => npc.templateId));
      const renderedNpcTemplateIds = entities
        .filter((entity) => gameplayNpcIds.has(entity.templateId) && entityVisual(entity).rendered)
        .map((entity) => entity.templateId);
      const mailboxEntity = entities.find(
        (entity) => entity.id === gameplaySnapshot?.mailbox?.entity?.entityId,
      );
      const spiritHealerEntity = entities.find(
        (entity) => entity.id === gameplaySnapshot?.graveyard?.healer?.entityId,
      );
      const musterEntities = entities.filter((entity) =>
        (gameplaySnapshot?.musterOrders ?? []).some((order) => order.entityId === entity.id),
      );
      const renderedMusterOrderCount = musterEntities.filter(
        (entity) => entityVisual(entity).rendered,
      ).length;
      sceneRepeatedCounts.fenbridge_muster_order = renderedMusterOrderCount;
      const petra = entities.find((entity) => entity.templateId === 'bursar_petra_vell');
      const petraView = entityView(petra);
      const bankerChest = petraView?.getObjectByName('bankerChestDecoration');
      const bankerChestMeshCount = meshCount(bankerChest);
      let tanneryInstanceCount = 0;
      renderer.scene.traverse((object) => {
        if (
          object.name === 'stationProps:tanningRack' &&
          object.isInstancedMesh &&
          hierarchyIsVisible(object) &&
          Number.isInteger(object.count)
        ) {
          tanneryInstanceCount = Math.max(tanneryInstanceCount, object.count);
        }
      });

      return {
        root: {
          name: rootName,
          present: Boolean(root),
          visible: root?.visible ?? false,
          layoutId,
          childMeshCount,
          hookFields: {
            layoutId: typeof layoutId === 'string',
            placementIds:
              Array.isArray(rootData.placementIds) || Array.isArray(captureData.placementIds),
            assetPlacementCounts: Boolean(
              rootData.assetPlacementCounts ?? captureData.assetPlacementCounts,
            ),
            assetUrls: Array.isArray(rootData.assetUrls) || Array.isArray(captureData.assetUrls),
          },
        },
        assets: {
          declaredUrls: [...new Set([...captureAssetUrls, ...rootAssetUrls])],
          requests: [],
          failures: [],
        },
        overlay: {
          ...overlaySnapshot,
          visible: Boolean(overlayObject) && overlayVisible,
        },
        gameplay: gameplaySnapshot,
        serviceVisuals: {
          renderedNpcTemplateIds: [...new Set(renderedNpcTemplateIds)].sort(),
          mailbox: entityVisual(mailboxEntity),
          bankerChest: {
            rendered: Boolean(bankerChest) && bankerChestMeshCount > 0,
            entityId: petra?.id ?? null,
            templateId: petra?.templateId ?? null,
            meshCount: bankerChestMeshCount,
          },
          spiritHealer: entityVisual(spiritHealerEntity),
          tannery: {
            rendered: tanneryInstanceCount > 0,
            instanceCount: tanneryInstanceCount,
          },
          renderedMusterOrderCount,
        },
        hookContract: {
          rendererController: typeof renderer.setFenbridgeCaptureOverlay === 'function',
          rootController: typeof rootData.setFenbridgeCaptureOverlay === 'function',
        },
        inventorySnapshot: {
          props: {
            buildings: ZONE2_PROPS.buildings ?? [],
            wells: ZONE2_PROPS.wells ?? [],
            stalls: ZONE2_PROPS.stalls ?? [],
            campfires: ZONE2_PROPS.campfires ?? [],
            fences: ZONE2_PROPS.fences ?? [],
          },
          root: {
            placementIds: rootData.placementIds ?? [],
            buildingIds: rootData.buildingIds ?? [],
            placementInventory: rootData.placementInventory ?? {},
            capturePlacementIds: captureData.placementIds ?? [],
            capturePlacementInventory: captureData.placementInventory ?? {},
            assetPlacementCounts: {
              ...plainCounts(rootData.assetPlacementCounts),
              ...plainCounts(captureData.assetPlacementCounts),
            },
            gateCount: captureData.gateCount ?? rootData.gateCount ?? null,
            wallSegmentCount: captureData.wallSegmentCount ?? rootData.wallSegmentCount ?? null,
            boardwalkCount: captureData.boardwalkCount ?? rootData.boardwalkCount ?? null,
          },
          sceneRepeatedCounts,
          scenePlacementIds: [...scenePlacementIds],
        },
      };
    },
    {
      rootName: FENBRIDGE_TOWN_ROOT_NAME,
      overlayName: FENBRIDGE_CAPTURE_HOOK_CONTRACT.overlayName,
      repeatedKeys: Object.keys(FENBRIDGE_REPEATED_ASSET_REQUIREMENTS),
      requiredPlacementIds: FENBRIDGE_REBUILD_REQUIRED_IDS,
      overlaySnapshot: overlayState,
      gameplaySnapshot: gameplayEvidence,
    },
  );
  const inventory = classifyFenbridgePlacementInventory(observed.inventorySnapshot);
  delete observed.inventorySnapshot;
  return { ...observed, inventory };
}

const profileBatches = [];

for (const profile of config.profiles) {
  console.log(`Fenbridge capture profile: ${profile.name}`);
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    args: [
      `--window-size=${profile.viewport.width},${profile.viewport.height}`,
      '--disable-dev-shm-usage',
      '--autoplay-policy=no-user-gesture-required',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
    ],
    defaultViewport: profile.viewport,
  });
  const records = [];
  profileBatches.push({
    profile: {
      name: profile.name,
      tier: profile.tier,
      viewport: profile.viewport,
    },
    records,
  });
  let page;
  try {
    page = await browser.newPage();
    const diagnostics = {
      pageErrors: [],
      consoleErrors: [],
      requestFailures: [],
    };
    const assetRequests = new Set();
    const assetFailures = [];
    const pendingExpectedProxyErrors = [];
    page.on('pageerror', (error) => diagnostics.pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = message.text();
      const sourceUrl = message.location().url;
      const genericProxyError =
        /^Failed to load resource: the server responded with a status of 502/i.test(text);
      const pairedProxyError = genericProxyError && pendingExpectedProxyErrors.length > 0;
      if (pairedProxyError) pendingExpectedProxyErrors.shift();
      if (
        !expectedEnvironmentConsoleError(text) &&
        !expectedProxyConsoleError(text, sourceUrl) &&
        !pairedProxyError
      ) {
        diagnostics.consoleErrors.push(sourceUrl ? `${text} [source ${sourceUrl}]` : text);
      }
    });
    page.on('response', (response) => {
      if (expectedProxyResponse(response.url(), response.status())) {
        pendingExpectedProxyErrors.push(new URL(response.url()).pathname);
      }
      const assetPath = fenbridgeAssetPath(response.url());
      if (!assetPath) return;
      assetRequests.add(assetPath);
      if (!response.ok() && response.status() !== 304) {
        assetFailures.push(`${assetPath}: HTTP ${response.status()} ${response.statusText()}`);
      }
    });
    page.on('requestfailed', (request) => {
      const assetPath = fenbridgeAssetPath(request.url());
      if (!assetPath) return;
      const failure = `${assetPath}: ${request.failure()?.errorText ?? 'request failed'}`;
      assetFailures.push(failure);
      diagnostics.requestFailures.push(failure);
    });

    await configureMobileProfile(page, profile);
    await page.evaluateOnNewDocument(
      ({ settings, introKey }) => {
        localStorage.setItem('woc_settings', JSON.stringify(settings));
        localStorage.setItem(introKey, '1');
      },
      {
        settings: profile.settings,
        introKey: `woc_spawn_intro_seen:offline:${character.className}:${character.name}`,
      },
    );
    await suppressGpuNotice(page);
    await page.goto(`${config.gameUrl}/${profile.query}`, {
      waitUntil: 'networkidle0',
      timeout: 60_000,
    });
    await installCaptureNoticeDismissal(page);
    const booted = await enterOfflineGame(page, {
      charClass: character.className,
      charName: character.name,
      settleMs: FENBRIDGE_CAPTURE_TIMING.bootSettleMs,
      gameBootTimeoutMs: FENBRIDGE_CAPTURE_TIMING.gameBootTimeoutMs,
    });
    if (!booted) throw new Error('offline game did not boot');
    await dismissCaptureNotices(page);

    const streaming = await exerciseCrossZoneStreaming(page);
    const gameplayEvidence = config.expectedFenbridge
      ? await readFenbridgeGameplayEvidence(page)
      : null;
    for (const view of config.views) {
      console.log(`Staging ${profile.name}/${view.name}`);
      const staged = await stageView(page, view);
      try {
        await delay(FENBRIDGE_CAPTURE_TIMING.viewSettleMs);
        await dismissCaptureNotices(page);
        const renderState = await readRenderState(
          page,
          profile,
          streaming,
          staged.playerCollisionClear,
        );
        assertFenbridgeCaptureRenderState({ renderState, profile, view });

        const observed = await readObservedFenbridgeState(page, staged.overlay, gameplayEvidence);
        observed.assets.requests = [...assetRequests].sort();
        observed.assets.failures = [...new Set(assetFailures)].sort();
        const metadata = {
          schemaVersion: 1,
          captureScope: 'fenbridge-town',
          contract: {
            layoutId: FENBRIDGE_LAYOUT_ID,
            rootName: FENBRIDGE_TOWN_ROOT_NAME,
            expectedFenbridge: config.expectedFenbridge,
            acceptanceMode: config.acceptanceMode,
          },
          source: { revision: config.sourceRevision },
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
          streaming,
          renderState,
          observed,
          diagnostics: {
            pageErrors: [...diagnostics.pageErrors],
            consoleErrors: [...diagnostics.consoleErrors],
            requestFailures: [...diagnostics.requestFailures],
          },
          frame: null,
        };
        metadata.acceptance = fenbridgeAcceptanceReadiness(metadata, {
          requireFrame: false,
        });
        records.push(metadata);
        const { output: metadataOutput } = writeMetadata(profileBatches);
        assertFenbridgeCaptureMetadata({
          metadata,
          profile,
          view,
          expectedFenbridge: config.expectedFenbridge,
          acceptanceMode: config.acceptanceMode,
          requireFrame: false,
        });

        const frameName = captureFrameFilename(config.shotPrefix, view.name, profile.name);
        const frameOutput = path.join(outputDir, frameName);
        await page.screenshot({ path: frameOutput });
        metadata.frame = fenbridgePngFrameEvidence(frameOutput);
        metadata.observed.assets.requests = [...assetRequests].sort();
        metadata.observed.assets.failures = [...new Set(assetFailures)].sort();
        metadata.diagnostics = {
          pageErrors: [...diagnostics.pageErrors],
          consoleErrors: [...diagnostics.consoleErrors],
          requestFailures: [...diagnostics.requestFailures],
        };
        metadata.acceptance = fenbridgeAcceptanceReadiness(metadata);
        writeMetadata(profileBatches);
        assertFenbridgeCaptureMetadata({
          metadata,
          profile,
          view,
          expectedFenbridge: config.expectedFenbridge,
          acceptanceMode: config.acceptanceMode,
        });
        console.log(`Wrote ${frameOutput} and ${metadataOutput}`);
      } finally {
        await setCaptureOverlay(page, false).catch(() => {});
      }
    }
  } finally {
    await browser.close();
  }
}

const finalBatch = buildBatchMetadata(profileBatches, true);
assertFenbridgeCaptureBatchMetadata({
  metadata: finalBatch,
  expectedFenbridge: config.expectedFenbridge,
  acceptanceMode: config.acceptanceMode,
});
assertFenbridgeCaptureArtifactFiles(finalBatch);
const { output: finalMetadataOutput } = writeMetadata(profileBatches, true);
console.log(`Wrote complete Fenbridge capture batch ${finalMetadataOutput}`);
