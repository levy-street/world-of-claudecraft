// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LinkedProgramTouchQueue } from '../src/render/linked_program_touch_lane';
import {
  RAID_BOSS_GUIDE_MODEL_SPECS,
  RaidBossGuideModelController,
  type RaidBossGuideModelViewer,
} from '../src/ui/raid_boss_guide_model_controller';

function options(boss: 'ignivar' | 'varkhul') {
  const name = boss === 'ignivar' ? 'Ignivar' : 'Varkhul';
  return {
    boss,
    name,
    posterUrl: `/ui/mobs/${boss}.webp`,
    canvasLabel: `Rotatable 3D model of ${name}`,
    loadingText: 'Loading model...',
    errorText: `Could not load the 3D model of ${name}.`,
    hintText: 'Drag to turn the model.',
    viewButtonText: 'View in 3D',
    viewButtonLabel: `View ${name} in 3D`,
  } as const;
}

describe('RaidBossGuideModelController', () => {
  let slot: HTMLDivElement;
  let viewer: RaidBossGuideModelViewer;
  let createViewer: ReturnType<
    typeof vi.fn<(stage: HTMLElement, label: string) => Promise<RaidBossGuideModelViewer>>
  >;

  beforeEach(() => {
    document.body.innerHTML = '<div id="slot"></div>';
    const mounted = document.querySelector<HTMLDivElement>('#slot');
    if (!mounted) throw new Error('model slot fixture did not mount');
    slot = mounted;
    viewer = {
      load: vi.fn(async () => undefined),
      destroy: vi.fn(),
      onContextLost: vi.fn(),
      setLabel: vi.fn(),
      setOnscreen: vi.fn(),
    };
    createViewer = vi.fn(async () => viewer);
  });

  it('pins the shipped Ignivar and Varkhul model framing', () => {
    expect(RAID_BOSS_GUIDE_MODEL_SPECS).toEqual({
      ignivar: {
        url: 'models/creatures/ignivar_herald.glb',
        idle: 'Idle',
        height: 2.65,
        yaw: 0,
      },
      varkhul: {
        url: 'models/creatures/varkhul_forgefather.glb',
        idle: 'Idle',
        height: 3,
        yaw: 0,
      },
    });
  });

  it('keeps the heavy 3D scene behind a dynamic import', () => {
    const source = readFileSync('src/ui/raid_boss_guide_model_controller.ts', 'utf8');

    expect(source).toContain("await import('../guide/viewer/scene')");
    expect(source).not.toMatch(/^import .*guide\/viewer\/scene/m);
  });

  it('forwards a live GPU touch-queue provider to the lazy viewer factory', async () => {
    const run: LinkedProgramTouchQueue['run'] = async <T>(work: () => T | Promise<T>): Promise<T> =>
      await work();
    const queue: LinkedProgramTouchQueue = { run };
    const touchQueue = vi.fn(() => queue);
    const queueAwareFactory = vi.fn(
      async (
        _stage: HTMLElement,
        _label: string,
        currentTouchQueue?: () => LinkedProgramTouchQueue | null,
      ) => {
        expect(currentTouchQueue?.()).toBe(queue);
        return viewer;
      },
    );
    const controller = new RaidBossGuideModelController(
      document,
      queueAwareFactory,
      () => true,
      () => false,
      touchQueue,
    );

    controller.mount(slot, options('ignivar'));

    await vi.waitFor(() => expect(queueAwareFactory).toHaveBeenCalledOnce());
    expect(touchQueue).toHaveBeenCalledOnce();
  });

  it('loads the selected boss GLB and keeps its poster as the loading fallback', async () => {
    const controller = new RaidBossGuideModelController(document, createViewer, () => true);

    controller.mount(slot, options('ignivar'));

    expect(slot.querySelector<HTMLImageElement>('.rbg-model-poster')?.src).toContain(
      '/ui/mobs/ignivar.webp',
    );
    expect(slot.querySelector<HTMLElement>('.rbg-model-viewer')?.dataset.state).toBe('loading');
    await vi.waitFor(() =>
      expect(viewer.load).toHaveBeenCalledWith(RAID_BOSS_GUIDE_MODEL_SPECS.ignivar, null),
    );
    expect(slot.querySelector<HTMLElement>('.rbg-model-viewer')?.dataset.state).toBe('ready');
  });

  it('reattaches one persistent viewer without reloading the same boss after a journal render', async () => {
    const supportsWebGL = vi.fn(() => true);
    const controller = new RaidBossGuideModelController(document, createViewer, supportsWebGL);
    controller.mount(slot, options('ignivar'));
    await vi.waitFor(() => expect(viewer.load).toHaveBeenCalledOnce());

    document.body.innerHTML = '<div id="replacement"></div>';
    const replacement = document.querySelector<HTMLDivElement>('#replacement');
    if (!replacement) throw new Error('replacement slot fixture did not mount');
    controller.mount(replacement, options('ignivar'));

    expect(createViewer).toHaveBeenCalledOnce();
    expect(viewer.load).toHaveBeenCalledOnce();
    expect(supportsWebGL).toHaveBeenCalledOnce();
    expect(replacement.querySelector('.rbg-model-viewer')).not.toBeNull();
  });

  it('relocalizes a retained loading status without restarting the GLB request', async () => {
    viewer.load = vi.fn(() => new Promise<void>(() => undefined));
    const controller = new RaidBossGuideModelController(document, createViewer, () => true);
    controller.mount(slot, options('ignivar'));
    await vi.waitFor(() => expect(viewer.load).toHaveBeenCalledOnce());

    controller.mount(slot, {
      ...options('ignivar'),
      loadingText: 'Cargando modelo...',
    });

    expect(slot.querySelector('.rbg-model-status')?.textContent).toBe('Cargando modelo...');
    expect(slot.querySelector<HTMLElement>('.rbg-model-viewer')?.dataset.state).toBe('loading');
    expect(viewer.load).toHaveBeenCalledOnce();
  });

  it('reuses the WebGL context and loads the other boss when the selected tab changes', async () => {
    const controller = new RaidBossGuideModelController(document, createViewer, () => true);
    controller.mount(slot, options('ignivar'));
    await vi.waitFor(() => expect(viewer.load).toHaveBeenCalledTimes(1));

    controller.mount(slot, options('varkhul'));

    await vi.waitFor(() =>
      expect(viewer.load).toHaveBeenLastCalledWith(RAID_BOSS_GUIDE_MODEL_SPECS.varkhul, null),
    );
    expect(createViewer).toHaveBeenCalledOnce();
    expect(viewer.setLabel).toHaveBeenLastCalledWith('Rotatable 3D model of Varkhul');
  });

  it('destroys the viewer and removes its retained host when the guide closes', async () => {
    const controller = new RaidBossGuideModelController(document, createViewer, () => true);
    controller.mount(slot, options('ignivar'));
    await vi.waitFor(() => expect(viewer.load).toHaveBeenCalledOnce());

    controller.destroy();

    expect(viewer.destroy).toHaveBeenCalledOnce();
    expect(document.querySelector('.rbg-model-viewer')).toBeNull();
  });

  it('keeps the uncropped poster and avoids a GPU context when WebGL is unavailable', () => {
    const controller = new RaidBossGuideModelController(document, createViewer, () => false);

    controller.mount(slot, options('varkhul'));

    expect(createViewer).not.toHaveBeenCalled();
    expect(slot.querySelector<HTMLElement>('.rbg-model-viewer')?.dataset.state).toBe('nowebgl');
    expect(slot.querySelector<HTMLImageElement>('.rbg-model-poster')?.alt).toBe('Varkhul');
  });

  it('waits for explicit activation when reduced motion is preferred', async () => {
    const controller = new RaidBossGuideModelController(
      document,
      createViewer,
      () => true,
      () => true,
    );

    controller.mount(slot, options('ignivar'));

    expect(createViewer).not.toHaveBeenCalled();
    expect(slot.querySelector<HTMLElement>('.rbg-model-viewer')?.dataset.state).toBe('idle');
    slot.querySelector<HTMLButtonElement>('.rbg-model-load')?.click();
    await vi.waitFor(() => expect(viewer.load).toHaveBeenCalledOnce());
    expect(slot.querySelector<HTMLElement>('.rbg-model-viewer')?.dataset.state).toBe('ready');
  });

  it('hands focus from manual loading to the finished canvas', async () => {
    let resolveLoad: (() => void) | undefined;
    let canvas: HTMLCanvasElement | undefined;
    viewer.load = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    const focusFactory = vi.fn(async (stage: HTMLElement) => {
      canvas = document.createElement('canvas');
      canvas.tabIndex = 0;
      stage.append(canvas);
      return viewer;
    });
    const controller = new RaidBossGuideModelController(
      document,
      focusFactory,
      () => true,
      () => true,
    );
    controller.mount(slot, options('ignivar'));
    const loadButton = slot.querySelector<HTMLButtonElement>('.rbg-model-load');
    loadButton?.focus();

    loadButton?.click();

    expect(document.activeElement).toBe(slot.querySelector('.rbg-model-status'));
    await vi.waitFor(() => expect(viewer.load).toHaveBeenCalledOnce());
    resolveLoad?.();
    await vi.waitFor(() => expect(document.activeElement).toBe(canvas));
    expect(canvas?.dataset.focusKey).toBe('model-canvas');
  });

  it('destroys a viewer that finishes being created after the guide closes', async () => {
    let resolveViewer: ((value: RaidBossGuideModelViewer) => void) | undefined;
    const delayedFactory = vi.fn(
      () =>
        new Promise<RaidBossGuideModelViewer>((resolve) => {
          resolveViewer = resolve;
        }),
    );
    const controller = new RaidBossGuideModelController(document, delayedFactory, () => true);

    controller.mount(slot, options('ignivar'));
    await vi.waitFor(() => expect(delayedFactory).toHaveBeenCalledOnce());
    controller.destroy();
    resolveViewer?.(viewer);

    await vi.waitFor(() => expect(viewer.destroy).toHaveBeenCalledOnce());
    expect(viewer.load).not.toHaveBeenCalled();
    expect(document.querySelector('.rbg-model-viewer')).toBeNull();
  });

  it('does not restore a model whose GLB finishes loading after the guide closes', async () => {
    let resolveLoad: (() => void) | undefined;
    viewer.load = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    const controller = new RaidBossGuideModelController(document, createViewer, () => true);

    controller.mount(slot, options('varkhul'));
    await vi.waitFor(() => expect(viewer.load).toHaveBeenCalledOnce());
    controller.destroy();
    resolveLoad?.();

    await vi.waitFor(() => expect(viewer.destroy).toHaveBeenCalledOnce());
    expect(document.querySelector('.rbg-model-viewer')).toBeNull();
  });

  it('returns to the poster and offers a retry when loading fails', async () => {
    const error = new Error('broken GLB');
    viewer.load = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(undefined);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const controller = new RaidBossGuideModelController(document, createViewer, () => true);

    controller.mount(slot, options('ignivar'));

    await vi.waitFor(() =>
      expect(slot.querySelector<HTMLElement>('.rbg-model-viewer')?.dataset.state).toBe('error'),
    );
    expect(slot.querySelector('.rbg-model-status')?.textContent).toBe(
      'Could not load the 3D model of Ignivar.',
    );
    expect(log).toHaveBeenCalledWith('Raid boss guide model failed to load', error);
    controller.mount(slot, {
      ...options('ignivar'),
      errorText: 'No se pudo cargar el modelo 3D de Ignivar.',
    });
    expect(slot.querySelector('.rbg-model-status')?.textContent).toBe(
      'No se pudo cargar el modelo 3D de Ignivar.',
    );
    expect(viewer.load).toHaveBeenCalledOnce();
    slot.querySelector<HTMLButtonElement>('.rbg-model-load')?.click();
    await vi.waitFor(() => expect(viewer.load).toHaveBeenCalledTimes(2));
    expect(slot.querySelector<HTMLElement>('.rbg-model-viewer')?.dataset.state).toBe('ready');
    log.mockRestore();
  });

  it('releases a lost context and restores the poster fallback', async () => {
    let contextLost: (() => void) | undefined;
    let canvas: HTMLCanvasElement | undefined;
    viewer.onContextLost = vi.fn((callback: () => void) => {
      contextLost = callback;
    });
    const contextFactory = vi.fn(async (stage: HTMLElement) => {
      canvas = document.createElement('canvas');
      canvas.tabIndex = 0;
      stage.append(canvas);
      return viewer;
    });
    const controller = new RaidBossGuideModelController(document, contextFactory, () => true);

    controller.mount(slot, options('varkhul'));
    await vi.waitFor(() =>
      expect(slot.querySelector<HTMLElement>('.rbg-model-viewer')?.dataset.state).toBe('ready'),
    );
    canvas?.focus();
    contextLost?.();

    expect(viewer.destroy).toHaveBeenCalledOnce();
    expect(slot.querySelector<HTMLElement>('.rbg-model-viewer')?.dataset.state).toBe('error');
    expect(slot.querySelector('.rbg-model-status')?.textContent).toBe(
      'Could not load the 3D model of Varkhul.',
    );
    expect(document.activeElement).toBe(slot.querySelector('.rbg-model-load'));
    controller.mount(slot, options('varkhul'));
    expect(contextFactory).toHaveBeenCalledOnce();
    expect(slot.querySelector<HTMLElement>('.rbg-model-viewer')?.dataset.state).toBe('error');
  });
});
