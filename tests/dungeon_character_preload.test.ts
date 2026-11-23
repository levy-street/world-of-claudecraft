import * as THREE from 'three';
import { expect, it, vi } from 'vitest';

const pending = vi.hoisted(() => ({
  url: '',
  resolve: null as (() => void) | null,
  reject: null as ((error: Error) => void) | null,
}));
vi.mock('../src/render/assets/loader', () => ({
  loadGltf: vi.fn((url: string) => {
    const gltf = { scene: new THREE.Group(), animations: [] };
    if (url !== pending.url) return Promise.resolve(gltf);
    return new Promise((resolve, reject) => {
      pending.resolve = () => resolve(gltf);
      pending.reject = reject;
    });
  }),
  loadTexture: vi.fn(async () => new THREE.Texture()),
  loadKtx2Texture: vi.fn(async () => new THREE.Texture()),
  releaseGltf: vi.fn(),
}));

it('holds iOS dungeon arrival for its bodies and retries a failed download', async () => {
  const { gfxInternalsForTest } = await import('../src/render/gfx');
  const restore = gfxInternalsForTest.overrideSettings({ iosMemoryProfile: true });
  const { dungeonAndBuddyBodyUrls, dungeonCharacterBodyUrls } = await import(
    '../src/render/characters/rift_body_stream_core'
  );
  pending.url = dungeonCharacterBodyUrls('hollow_crypt').find((url) =>
    dungeonAndBuddyBodyUrls().has(url),
  )!;
  expect(pending.url).toBeTruthy();
  const { Renderer } = await import('../src/render/renderer');
  const { DUNGEON_LIST, instanceOrigin } = await import('../src/sim/data');
  const dungeon = DUNGEON_LIST.find((entry) => entry.interior === 'hollow_crypt')!;
  const origin = instanceOrigin(dungeon.index, 0);
  const renderer = { zoneIdAt: () => null } as unknown as InstanceType<typeof Renderer>;
  const ready = () => Renderer.prototype.isZoneReadyAt.call(renderer, origin.x, origin.z);
  const prepared = () => Renderer.prototype.isZonePreparedAt.call(renderer, origin.x, origin.z);
  const prepare = () => Renderer.prototype.prepareZoneAt.call(renderer, origin.x, origin.z);
  try {
    // main.ts uses this predicate to decide whether to raise arrival cover.
    expect(ready()).toBe(false);
    expect(prepared()).toBe(false);
    let settled = false;
    const first = prepare();
    const rejected = expect(first).rejects.toThrow('download failed');
    void first.then(
      () => {
        settled = true;
      },
      () => {},
    );
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(pending.reject).not.toBeNull();
    pending.reject!(new Error('download failed'));
    await rejected;
    expect(ready()).toBe(false);
    const second = prepare();
    pending.resolve!();
    await second;
    expect(ready()).toBe(true);
    expect(prepared()).toBe(true);
    expect(settled).toBe(false);
  } finally {
    restore();
  }
}, 60000);
