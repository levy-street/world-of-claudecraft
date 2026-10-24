// @vitest-environment happy-dom

// The encounter journal's turntable on a dungeon page: a boss with no 3D model
// holds no WebGL context and never shows the previous boss, and closing the
// journal releases only the GLB files it was the first to bring into the cache.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type RaidBossGuideGltfCache,
  RaidBossGuideModelController,
  type RaidBossGuideModelSpec,
  type RaidBossGuideModelViewer,
} from '../src/ui/raid_boss_guide_model_controller';

const SPEC: RaidBossGuideModelSpec = {
  url: 'models/creatures/woc_sanctum_korgath.glb',
  idle: 'Idle',
  height: 6.8,
};

function options(boss: string, spec: RaidBossGuideModelSpec | null) {
  return {
    boss,
    spec,
    tint: null,
    name: boss,
    posterUrl: `/ui/mobs/${boss}.webp`,
    canvasLabel: `Rotatable 3D model of ${boss}`,
    loadingText: 'Loading model...',
    errorText: 'Could not load the model.',
    hintText: 'Drag to turn the model.',
    viewButtonText: 'View in 3D',
    viewButtonLabel: `View ${boss} in 3D`,
  };
}

describe('RaidBossGuideModelController on dungeon pages', () => {
  let slot: HTMLDivElement;
  let viewer: RaidBossGuideModelViewer;
  let resolveLoad: () => void;
  let cache: RaidBossGuideGltfCache & { cached: Set<string> };

  beforeEach(() => {
    document.body.innerHTML = '<div id="slot"></div>';
    slot = document.querySelector<HTMLDivElement>('#slot') as HTMLDivElement;
    viewer = {
      load: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveLoad = resolve;
          }),
      ),
      destroy: vi.fn(),
      onContextLost: vi.fn(),
      setLabel: vi.fn(),
      setOnscreen: vi.fn(),
    };
    const cached = new Set<string>(['models/creatures/already_in_world.glb']);
    cache = {
      cached,
      isCached: vi.fn((url: string) => cached.has(url)),
      release: vi.fn((url: string) => {
        cached.delete(url);
      }),
    };
  });

  function controller() {
    return new RaidBossGuideModelController(
      document,
      async () => viewer,
      () => true,
      () => false,
      () => null,
      cache,
    );
  }

  it('drops the previous viewer for a portrait-only boss and never shows the old model', async () => {
    const c = controller();
    c.mount(slot, options('korgath_the_bound', SPEC));
    await vi.waitFor(() => expect(viewer.load).toHaveBeenCalledOnce());

    c.mount(slot, options('mere_hydra_head_center', null));
    expect(viewer.destroy).toHaveBeenCalledOnce();
    expect(slot.querySelector<HTMLElement>('.rbg-model-viewer')?.dataset.state).toBe('nowebgl');

    resolveLoad();
    await Promise.resolve();
    await Promise.resolve();
    expect(slot.querySelector<HTMLElement>('.rbg-model-viewer')?.dataset.state).toBe('nowebgl');
  });

  it('releases on close only the GLB files the journal brought into the cache', async () => {
    const c = controller();
    c.mount(slot, options('korgath_the_bound', SPEC));
    await vi.waitFor(() => expect(viewer.load).toHaveBeenCalledOnce());
    resolveLoad();
    await vi.waitFor(() =>
      expect(slot.querySelector<HTMLElement>('.rbg-model-viewer')?.dataset.state).toBe('ready'),
    );
    c.mount(slot, options('world_boss', { ...SPEC, url: 'models/creatures/already_in_world.glb' }));
    await vi.waitFor(() => expect(viewer.load).toHaveBeenCalledTimes(2));
    resolveLoad();

    c.destroy();
    expect(cache.release).toHaveBeenCalledTimes(1);
    expect(cache.release).toHaveBeenCalledWith(SPEC.url);
    expect(cache.cached.has('models/creatures/already_in_world.glb')).toBe(true);
  });

  it('releases the weapon attachments it brought in along with the body', async () => {
    const c = controller();
    const armed: RaidBossGuideModelSpec = {
      ...SPEC,
      attach: [
        { url: 'models/weapons/korgath_maul.glb', bone: 'handslot.r' },
        { url: 'models/creatures/already_in_world.glb', bone: 'handslot.l' },
      ],
    };
    c.mount(slot, options('korgath_the_bound', armed));
    await vi.waitFor(() => expect(viewer.load).toHaveBeenCalledOnce());
    resolveLoad();
    await vi.waitFor(() =>
      expect(slot.querySelector<HTMLElement>('.rbg-model-viewer')?.dataset.state).toBe('ready'),
    );

    c.destroy();
    expect(cache.release).toHaveBeenCalledTimes(2);
    expect(cache.release).toHaveBeenCalledWith(SPEC.url);
    expect(cache.release).toHaveBeenCalledWith('models/weapons/korgath_maul.glb');
    expect(cache.cached.has('models/creatures/already_in_world.glb')).toBe(true);
  });
});
