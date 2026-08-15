// Browser-level transaction coverage for the player-facing live graphics path.
// The real Options painter stages both requests, the real coordinator owns the
// commit/rollback, and real Three renderers recycle one WebGL2 context.

import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GraphicsRebuildCoordinator } from '../../src/game/graphics_rebuild_coordinator';
import {
  type GraphicsSettingsSnapshot,
  graphicsSettingsSnapshotsEqual,
  normalizeGraphicsSettingsSnapshot,
} from '../../src/game/graphics_rebuild_core';
import { Settings } from '../../src/game/settings';
import {
  preflightWebGL2ContextRecycle,
  type RecycledRendererContext,
  recycleWebGL2Context,
} from '../../src/render/context_recycle';
import type { OptionsHooks } from '../../src/ui/hud';
import { t } from '../../src/ui/i18n';
import { OptionsWindow, type OptionsWindowDeps } from '../../src/ui/options_window';
import { cleanup, host, stubDeps } from './_harness';

interface TestWorld {
  id: string;
  tick: number;
  player: { hp: number };
}

interface TestNetwork {
  id: string;
  sequence: number;
  connected: boolean;
  paused: boolean;
  pauseHistory: boolean[];
  setPaused(paused: boolean): void;
}

interface TestRenderer {
  webgl: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  profile: GraphicsSettingsSnapshot;
  world: TestWorld;
  network: TestNetwork;
  constructedWhilePaused: boolean;
}

const SETTINGS_KEY = 'woc_settings';

afterEach(() => {
  cleanup();
  localStorage.removeItem(SETTINGS_KEY);
});

function draw(renderer: TestRenderer): void {
  if (
    renderer.scene.userData.world !== renderer.world ||
    renderer.scene.userData.network !== renderer.network
  ) {
    throw new Error('Renderer ownership changed during the graphics transaction');
  }
  renderer.camera.userData.worldTick = renderer.world.tick;
  renderer.camera.userData.networkSequence = renderer.network.sequence;
  renderer.webgl.setPixelRatio(1);
  renderer.webgl.setSize(32, 32, false);
  renderer.webgl.render(renderer.scene, renderer.camera);
}

function dominantPixel(context: WebGL2RenderingContext): [number, number, number, number] {
  const pixel = new Uint8Array(4);
  context.readPixels(16, 16, 1, 1, context.RGBA, context.UNSIGNED_BYTE, pixel);
  return [pixel[0] ?? 0, pixel[1] ?? 0, pixel[2] ?? 0, pixel[3] ?? 0];
}

function profileColor(profile: GraphicsSettingsSnapshot): THREE.Color {
  if (profile.graphicsPreset === 3) return new THREE.Color(0xc52d35);
  if (profile.graphicsPreset === 2) return new THREE.Color(0x24c86a);
  return new THREE.Color(0x316ee8);
}

function makeRenderer(
  profile: GraphicsSettingsSnapshot,
  world: TestWorld,
  network: TestNetwork,
  pair?: RecycledRendererContext,
): TestRenderer {
  const canvas = pair?.canvas ?? document.createElement('canvas');
  if (!pair) document.body.appendChild(canvas);
  const webgl = new THREE.WebGLRenderer({
    canvas,
    ...(pair ? { context: pair.context } : {}),
    antialias: false,
    preserveDrawingBuffer: true,
  });
  const scene = new THREE.Scene();
  scene.background = profileColor(profile);
  scene.userData.world = world;
  scene.userData.network = network;
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 10);
  camera.position.z = 1;
  return {
    webgl,
    scene,
    camera,
    profile,
    world,
    network,
    constructedWhilePaused: network.paused,
  };
}

describe('Options live graphics rebuild transaction', () => {
  it('reuses canvas/context, preserves world and network state, and rolls back an injected failure', async () => {
    const oldProfile = normalizeGraphicsSettingsSnapshot({ graphicsPreset: 3 });
    const targetProfile = normalizeGraphicsSettingsSnapshot({ graphicsPreset: 2 });
    const failedProfile = normalizeGraphicsSettingsSnapshot({ graphicsPreset: 1 });
    const settings = new Settings();
    settings.patch(oldProfile);

    const world: TestWorld = { id: 'world-identity', tick: 417, player: { hp: 823 } };
    const network: TestNetwork = {
      id: 'socket-identity',
      sequence: 991,
      connected: true,
      paused: false,
      pauseHistory: [],
      setPaused(paused) {
        this.paused = paused;
        this.pauseHistory.push(paused);
      },
    };
    const originalWorld = world;
    const originalNetwork = network;

    let applied = oldProfile;
    let current = makeRenderer(oldProfile, world, network);
    draw(current);
    const firstRenderer = current;
    const originalCanvas = current.webgl.domElement;
    const originalContext = current.webgl.getContext() as WebGL2RenderingContext;
    expect(current.webgl.capabilities.isWebGL2).toBe(true);
    const before = dominantPixel(originalContext);
    expect(before[0]).toBeGreaterThan(before[1] + 60);

    let failNextCandidate = false;
    const builds: TestRenderer[] = [];
    const coordinator = new GraphicsRebuildCoordinator<
      GraphicsSettingsSnapshot,
      TestRenderer,
      RecycledRendererContext
    >({
      currentRenderer: () => current,
      captureSettings: () => applied,
      settingsEqual: graphicsSettingsSnapshotsEqual,
      preflightContext: (renderer) =>
        preflightWebGL2ContextRecycle(renderer.webgl.getContext() as WebGL2RenderingContext),
      setClientPaused: (paused) => network.setPaused(paused),
      resetInput: () => {},
      showOpaqueCurtain: () => {},
      awaitCurtainPaint: async () => {},
      hideOpaqueCurtain: () => {},
      prepareTargetAssets: async () => {},
      resetAuxiliaryRenderers: () => {},
      captureRendererContext: (renderer) => ({
        canvas: renderer.webgl.domElement,
        context: renderer.webgl.getContext() as WebGL2RenderingContext,
      }),
      shutdownRenderer: async (renderer) => {
        const pair = {
          canvas: renderer.webgl.domElement,
          context: renderer.webgl.getContext() as WebGL2RenderingContext,
        };
        renderer.webgl.dispose();
        return pair;
      },
      recycleContext: (pair) => recycleWebGL2Context(pair, { timeoutMs: 5_000 }),
      activateProfile: (profile) => profile.graphicsPreset,
      resetProfileResources: () => {},
      buildRenderer: (profile, pair) => {
        const renderer = makeRenderer(profile, world, network, pair);
        builds.push(renderer);
        return renderer;
      },
      prepareCurrentZone: async () => {},
      prepareNeighborZones: async () => {},
      prewarmRenderer: async () => {},
      validateRenderer: (renderer) => {
        if (failNextCandidate && renderer.profile.graphicsPreset === failedProfile.graphicsPreset) {
          failNextCandidate = false;
          throw new Error('injected candidate validation failure');
        }
        draw(renderer);
      },
      commit: (renderer, profile) => {
        current = renderer;
        applied = normalizeGraphicsSettingsSnapshot(profile);
        settings.patch(profile);
      },
      suspendEntryDiagnostics: () => {},
      resumeEntryDiagnostics: () => {},
      markCrashPhase: () => {},
      clearCrashMarker: () => {},
      isContextFailure: () => false,
      showFatalReload: () => {},
    });

    const hooks = stubDeps<OptionsHooks>({
      settings,
      onSettingChange: (key, value) => settings.set(key as never, value as never),
      graphicsApplied: () => applied,
      applyGraphics: async (profile) => {
        const outcome = await coordinator.rebuild(profile);
        if (outcome.status === 'applied' || outcome.status === 'unchanged') return 'applied';
        return outcome.status === 'fatal' ? 'fatal' : 'failed';
      },
      perfOverlay: stubDeps({ setPlacement: () => {} }),
      theme: stubDeps({ get: () => ({ preset: 'classic', custom: {} }) }),
      gamepad: stubDeps({ entries: () => [], kind: () => 'generic' }),
    });
    const root = host('options-menu');
    root.style.display = 'none';
    const options = new OptionsWindow(
      stubDeps<OptionsWindowDeps>({
        root: () => root,
        world: () => world as never,
        options: () => hooks,
        auraOverlays: () => ({ setPlacement: () => {} }) as never,
        bugReport: () => null,
        captureFocus: () => null,
        focusFirstInteractive: (scope, selector) =>
          scope
            .querySelector<HTMLElement>(selector ?? 'button:not(:disabled), input:not(:disabled)')
            ?.focus(),
      }),
    );

    const openGraphics = (): void => {
      const button = [...root.querySelectorAll<HTMLButtonElement>('.opt-btn')].find(
        (candidate) => candidate.textContent === t('hud.options.graphics'),
      );
      expect(button).toBeTruthy();
      button?.click();
    };
    const choosePreset = (value: number): void => {
      const button = root.querySelector<HTMLButtonElement>(
        `.set-choice button[data-value="${value}"]`,
      );
      expect(button).toBeTruthy();
      button?.click();
    };
    const applyDraft = (): void => {
      const button = root.querySelector<HTMLButtonElement>('[data-graphics-apply]');
      expect(button?.disabled).toBe(false);
      button?.click();
    };

    options.toggle();
    openGraphics();
    choosePreset(targetProfile.graphicsPreset);
    applyDraft();
    await vi.waitFor(() => expect(applied.graphicsPreset).toBe(targetProfile.graphicsPreset), {
      timeout: 10_000,
    });

    expect(current).not.toBe(firstRenderer);
    expect(current.webgl.domElement).toBe(originalCanvas);
    expect(current.webgl.getContext()).toBe(originalContext);
    expect(originalCanvas.getContext('webgl2')).toBe(originalContext);
    const appliedPixel = dominantPixel(originalContext);
    expect(appliedPixel[1]).toBeGreaterThan(appliedPixel[0] + 60);
    expect(current.world).toBe(originalWorld);
    expect(current.network).toBe(originalNetwork);
    expect(current.scene.userData.world).toBe(originalWorld);
    expect(current.scene.userData.network).toBe(originalNetwork);
    expect(current.constructedWhilePaused).toBe(true);
    expect(network.pauseHistory).toEqual([true, false]);
    expect(network.paused).toBe(false);
    expect(world).toEqual({ id: 'world-identity', tick: 417, player: { hp: 823 } });
    expect(network).toMatchObject({ id: 'socket-identity', sequence: 991, connected: true });

    const rendererBeforeFailure = current;
    failNextCandidate = true;
    choosePreset(failedProfile.graphicsPreset);
    applyDraft();
    await vi.waitFor(
      () => {
        expect(root.querySelector('[role="alert"]')?.textContent).toBe(
          t('hudChrome.options.graphicsFailed'),
        );
      },
      { timeout: 10_000 },
    );

    expect(current).not.toBe(rendererBeforeFailure);
    expect(current).toBe(builds.at(-1));
    expect(applied).toEqual(targetProfile);
    expect(settings.get('graphicsPreset')).toBe(targetProfile.graphicsPreset);
    expect(current.profile).toEqual(targetProfile);
    expect(current.webgl.domElement).toBe(originalCanvas);
    expect(current.webgl.getContext()).toBe(originalContext);
    const restoredPixel = dominantPixel(originalContext);
    expect(restoredPixel[1]).toBeGreaterThan(restoredPixel[0] + 60);
    expect(current.world).toBe(originalWorld);
    expect(current.network).toBe(originalNetwork);
    expect(current.scene.userData.world).toBe(originalWorld);
    expect(current.scene.userData.network).toBe(originalNetwork);
    expect(builds.every((renderer) => renderer.constructedWhilePaused)).toBe(true);
    expect(network.pauseHistory).toEqual([true, false, true, false]);
    expect(network.paused).toBe(false);

    current.webgl.forceContextLoss();
    current.webgl.dispose();
  });
});
