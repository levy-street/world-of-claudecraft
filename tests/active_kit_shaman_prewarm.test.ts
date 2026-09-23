import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  activeKitPrewarmEntry,
  cancelActiveAbilityKit,
  ensureActiveAbilityKit,
  resumeActiveAbilityKit,
  resumeSceneAbilityKits,
} from '../src/render/ability_vfx/active_kit_prewarm';
import * as contacts from '../src/render/ability_vfx/contact_assets';
import * as canvases from '../src/render/ability_vfx/fx_textures';
import * as assets from '../src/render/ability_vfx/production_assets';
import { type BackgroundGpuQueue, GPU_WORK_PRIORITY } from '../src/render/background_gpu_queue';
import type { PrewarmResumeUnit } from '../src/render/prewarm_resume';

const SHAMAN_LABELS = [
  'upload-big:active-shaman-shared-canvases',
  'upload-big:active-shaman-warrior-rock',
  'upload-big:active-shaman-smoke',
];

afterEach(() => vi.restoreAllMocks());

function fixture(cls = 'shaman', loadAssets?: (cls: string) => Promise<boolean>) {
  const scene = {};
  const textures = new Map<string, THREE.Texture>();
  const texture = (id: string) => {
    let value = textures.get(id);
    if (!value) {
      value = new THREE.Texture();
      textures.set(id, value);
    }
    return value;
  };
  const shared = Object.fromEntries(
    [
      'noise',
      'ribbon',
      'rune',
      'ember',
      'rime',
      'crack',
      'leapFracture',
      'shamanFracture',
      'char',
      'overlay',
    ].map((id) => [id, texture(id)]),
  ) as unknown as canvases.AbilityVfxTextures;
  const flipbook = vi
    .spyOn(canvases, 'flipbookSheet')
    .mockImplementation((id) => texture(id) as THREE.CanvasTexture);
  const sharedCanvases = vi.spyOn(canvases, 'abilityVfxTextures').mockReturnValue(shared);
  const contact = vi.spyOn(contacts, 'contactTexture').mockImplementation(texture);
  const rock = vi.spyOn(assets, 'warriorRockTexture').mockImplementation(() => texture('rock'));
  const baked = vi.spyOn(assets, 'bakedTexture').mockImplementation(texture);
  vi.spyOn(assets, 'warriorBloodTexture').mockImplementation(() => texture('blood'));
  vi.spyOn(assets, 'warriorSteelTexture').mockImplementation(() => texture('steel'));
  vi.spyOn(assets, 'warriorPressureTexture').mockImplementation(() => texture('pressure'));
  const queue = {
    run: vi.fn(
      async (
        work: PrewarmResumeUnit['run'],
        _priority: number,
        _label: string,
        _options: { releaseTail: boolean },
      ) => {
        await work();
      },
    ),
  };
  const geometry = vi.fn((): PrewarmResumeUnit[] => []);
  const upload = vi.fn();
  const entry = activeKitPrewarmEntry(scene, cls, {
    assets: loadAssets,
    queue: queue as unknown as Pick<BackgroundGpuQueue, 'run'>,
    geometry,
    texture: upload,
  });
  return {
    scene,
    entry,
    queue,
    geometry,
    upload,
    flipbook,
    sharedCanvases,
    contact,
    rock,
    baked,
    texture,
    shared,
    close: () => {
      cancelActiveAbilityKit(scene);
      for (const value of textures.values()) value.dispose();
    },
  };
}

describe('active Shaman texture preparation', () => {
  it('prepares a waiting Shaman even if the independent Warrior asset request fails', async () => {
    let reject!: (error: Error) => void;
    const assets = vi.fn((cls: string) =>
      cls === 'warrior'
        ? new Promise<boolean>((_resolve, failed) => {
            reject = failed;
          })
        : Promise.resolve(true),
    );
    const f = fixture('warrior', assets);
    try {
      const warrior = ensureActiveAbilityKit(f.scene, 'warrior');
      const sameClass = ensureActiveAbilityKit(f.scene, 'warrior');
      const shaman = ensureActiveAbilityKit(f.scene, 'shaman');
      reject(new Error('Warrior download failed'));
      await expect(warrior).rejects.toThrow('Warrior download failed');
      await expect(sameClass).rejects.toThrow('Warrior download failed');
      await shaman;
      expect(assets.mock.calls).toEqual([['warrior'], ['shaman']]);
      expect(f.queue.run.mock.calls.map((call) => call[2])).toEqual(SHAMAN_LABELS);
    } finally {
      f.close();
    }
  });
  it('production entry warms only the real local Shaman without unrelated Warrior downloads', async () => {
    const f = fixture('shaman');
    let present!: () => void;
    const firstPaint = new Promise<void>((resolve) => {
      present = resolve;
    });
    try {
      resumeSceneAbilityKits(f.scene, firstPaint, 'shaman');
      await Promise.resolve();
      expect(f.queue.run).not.toHaveBeenCalled();
      present();
      await firstPaint;
      // Observe production scheduling; never start either recipe from this test.
      await vi.waitFor(() => expect(f.queue.run).toHaveBeenCalledTimes(3));
      expect(f.queue.run.mock.calls.map((call) => call[2]).slice(0, SHAMAN_LABELS.length)).toEqual(
        SHAMAN_LABELS,
      );
      expect(f.queue.run).toHaveBeenCalledTimes(3);
      expect(f.upload).toHaveBeenCalledWith(f.shared.shamanFracture);
      expect(f.upload).not.toHaveBeenCalledWith(f.texture('blood'));
    } finally {
      f.close();
    }
  });

  it('registers lazily and uploads exactly the live Shaman recipe once through synchronous queue units', async () => {
    const f = fixture();
    try {
      expect(f.entry.required).toBe(false);
      f.entry.run();
      expect(f.entry.progress()).toEqual({ done: 0, planned: 3, trimmed: true });
      expect(f.queue.run).not.toHaveBeenCalled();
      for (const builder of [f.flipbook, f.sharedCanvases, f.contact, f.rock, f.baked])
        expect(builder).not.toHaveBeenCalled();
      await ensureActiveAbilityKit(f.scene);
      expect(f.queue.run.mock.calls.map((call) => call[2])).toEqual(SHAMAN_LABELS);
      for (const call of f.queue.run.mock.calls) {
        expect(call[1]).toBe(GPU_WORK_PRIORITY.ACTIONABLE_VIEW);
        expect(call[3]).toEqual({ releaseTail: false });
      }
      expect(f.flipbook).not.toHaveBeenCalled();
      expect(f.sharedCanvases).toHaveBeenCalledOnce();
      expect(f.contact).not.toHaveBeenCalled();
      expect(f.rock).toHaveBeenCalledOnce();
      expect(f.baked).toHaveBeenCalledExactlyOnceWith('smoke');
      expect(f.geometry).not.toHaveBeenCalled();
      expect(f.upload.mock.calls.map(([value]) => value)).toEqual([
        ...Object.values(f.shared),
        f.texture('rock'),
        f.texture('smoke'),
      ]);
      expect(f.upload).toHaveBeenCalledWith(f.shared.shamanFracture);
      expect(f.upload).toHaveBeenCalledTimes(12);
      await ensureActiveAbilityKit(f.scene);
      expect(f.queue.run).toHaveBeenCalledTimes(3);
      expect(f.upload).toHaveBeenCalledTimes(12);
      expect(f.entry.progress()).toEqual({ done: 3, planned: 3, trimmed: false });
    } finally {
      f.close();
    }
  });

  it.each(['warrior-rock', 'smoke'])(
    'keeps absent %s as unpaid work and retries without repeating completed uploads',
    async (missing) => {
      const f = fixture();
      try {
        if (missing === 'warrior-rock') f.rock.mockReturnValueOnce(null);
        if (missing === 'smoke') f.baked.mockReturnValueOnce(null);
        await expect(ensureActiveAbilityKit(f.scene)).rejects.toThrow(missing);
        expect(f.entry.progress().trimmed).toBe(true);
        await ensureActiveAbilityKit(f.scene);
        expect(f.queue.run).toHaveBeenCalledTimes(4);
        expect(f.upload).toHaveBeenCalledTimes(12);
        expect(f.entry.progress()).toEqual({ done: 3, planned: 3, trimmed: false });
      } finally {
        f.close();
      }
    },
  );

  it.each([
    ['warrior', 'shaman'],
    ['shaman', 'warrior'],
  ])('waits for both recipes when switching from an in-flight %s to %s', async (first, next) => {
    const f = fixture(first);
    let release!: () => void;
    try {
      f.queue.run.mockImplementationOnce(
        (work) =>
          new Promise<void>((resolve) => {
            release = () => void Promise.resolve(work()).then(resolve);
          }),
      );
      const initial = ensureActiveAbilityKit(f.scene);
      let switchedReady = false;
      const switched = ensureActiveAbilityKit(f.scene, next).then(() => {
        switchedReady = true;
      });
      await Promise.resolve();
      expect(switchedReady).toBe(false);
      expect(f.upload).not.toHaveBeenCalled();
      release();
      await Promise.all([initial, switched]);
      expect(f.queue.run).toHaveBeenCalledTimes(13);
      expect(
        f.queue.run.mock.calls.map((call) => call[2]).filter((id) => id.includes('shaman')),
      ).toEqual(SHAMAN_LABELS);
      expect(f.upload).toHaveBeenCalledTimes(22);
      await ensureActiveAbilityKit(f.scene, first);
      await ensureActiveAbilityKit(f.scene, next);
      expect(f.queue.run).toHaveBeenCalledTimes(13);
    } finally {
      f.close();
    }
  });

  it('cancels queued Shaman work before any lazy builder or upload reaches a retired scene', async () => {
    const f = fixture();
    let release!: () => void;
    try {
      f.queue.run.mockImplementationOnce(
        (work) =>
          new Promise<void>((resolve) => {
            release = () => void Promise.resolve(work()).then(resolve);
          }),
      );
      const task = ensureActiveAbilityKit(f.scene);
      const switching = ensureActiveAbilityKit(f.scene, 'warrior');
      cancelActiveAbilityKit(f.scene);
      release();
      await Promise.all([task, switching]);
      expect(f.queue.run).toHaveBeenCalledTimes(1);
      expect(f.flipbook).not.toHaveBeenCalled();
      expect(f.upload).not.toHaveBeenCalled();
    } finally {
      f.close();
    }
  });

  it('keeps a remote Shaman recipe outside the queue until first paint', async () => {
    const f = fixture('mage');
    let reveal!: () => void;
    try {
      resumeActiveAbilityKit(
        f.scene,
        new Promise<void>((resolve) => {
          reveal = resolve;
        }),
        'shaman',
      );
      await Promise.resolve();
      await ensureActiveAbilityKit(f.scene);
      expect(f.queue.run).not.toHaveBeenCalled();
      reveal();
      await Promise.resolve();
      await ensureActiveAbilityKit(f.scene, 'shaman');
      expect(f.queue.run.mock.calls.map((call) => call[2])).toEqual(SHAMAN_LABELS);
    } finally {
      f.close();
    }
  });
});
