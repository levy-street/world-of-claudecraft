// The post-entry creature stream is BACKGROUND work (src/render/characters/assets.ts
// startStreamedCharacterPreloads, over assets/load_queue_core.ts). On the iOS memory profile
// it queues every creature body at first paint, two at a time, and before this a file a
// player needed right then (an armor set, a hairstyle, a mount) waited behind all of it
// (PR 4360 review, B1). Here: the stream asks the loader at background priority, and a
// body a view needs NOW, still held by the stream, is asked for once more as a demand, which
// is what moves its waiting start up (tests/render_asset_load_priority.test.ts pins that on
// the loader itself).
import { afterEach, describe, expect, it, vi } from 'vitest';

type Call = { url: string; priority: string };

/** The iOS memory profile (the only one that streams creature bodies), a recording loader
 *  whose loads never land, and a fresh character assets module over both. */
async function iosWorld() {
  vi.resetModules();
  const calls: Call[] = [];
  const cache = new Map<string, Promise<unknown>>();
  vi.doMock('../src/render/assets/loader', () => ({
    loadGltf: vi.fn((url: string, opts?: { priority?: string }) => {
      calls.push({ url, priority: opts?.priority ?? 'demand' });
      let p = cache.get(url);
      if (!p) {
        p = new Promise(() => undefined);
        cache.set(url, p);
      }
      return p;
    }),
    loadTexture: vi.fn(() => new Promise(() => undefined)),
    loadKtx2Texture: vi.fn(() => new Promise(() => undefined)),
    releaseGltf: vi.fn(),
  }));
  const gfx = await import('../src/render/gfx');
  const restoreGfx = gfx.gfxInternalsForTest.overrideSettings({ iosMemoryProfile: true });
  const assets = await import('../src/render/characters/assets');
  return { calls, assets, restoreGfx };
}

const isCreature = (url: string): boolean =>
  url.includes('models/creatures/') || url.includes('models/chars/enemies/');

let restore: (() => void) | null = null;

afterEach(() => {
  restore?.();
  restore = null;
  vi.doUnmock('../src/render/assets/loader');
  vi.resetModules();
});

describe('the post-entry creature stream', () => {
  it('stays out of the boot gate and queues every body as background work', async () => {
    const { calls, assets, restoreGfx } = await iosWorld();
    restore = restoreGfx;
    // nothing of it at import: the stream starts at first paint
    expect(calls.filter((c) => isCreature(c.url))).toEqual([]);
    const boot = calls.length;
    const started = assets.startStreamedCharacterPreloads();
    const stream = calls.slice(boot);
    // a profile that streamed nothing would prove nothing
    expect(started).toBeGreaterThan(50);
    expect(stream).toHaveLength(started);
    for (const call of stream) {
      expect(isCreature(call.url), call.url).toBe(true);
      expect(call.priority, call.url).toBe('background');
    }
    // idempotent: a second kick queues nothing
    expect(assets.startStreamedCharacterPreloads()).toBe(0);
    expect(calls).toHaveLength(boot + started);
  });

  it('asks again as a demand, once, for a body a view needs while the stream holds it', async () => {
    const { calls, assets, restoreGfx } = await iosWorld();
    restore = restoreGfx;
    assets.startStreamedCharacterPreloads();
    const creature = calls.find((c) => isCreature(c.url))?.url as string;
    const before = calls.length;
    // the view-build miss path (resolvedGltf) kicks the body it could not find
    assets.ensureCharacterUrl(creature);
    expect(calls.slice(before)).toEqual([{ url: creature, priority: 'demand' }]);
    // every later frame's retry rides the same fetch: no further loader traffic
    assets.ensureCharacterUrl(creature);
    assets.ensureCharacterUrl(creature);
    expect(calls).toHaveLength(before + 1);
  });

  it('leaves a body nobody asked for in its place in the stream', async () => {
    const { calls, assets, restoreGfx } = await iosWorld();
    restore = restoreGfx;
    assets.startStreamedCharacterPreloads();
    const creatures = calls.filter((c) => isCreature(c.url)).map((c) => c.url);
    assets.ensureCharacterUrl(creatures[3]);
    // only the one that was asked for was promoted
    expect(calls.filter((c) => c.priority === 'demand' && isCreature(c.url))).toEqual([
      { url: creatures[3], priority: 'demand' },
    ]);
  });

  it('does not ask twice for a body that was a demand all along', async () => {
    const { calls, assets, restoreGfx } = await iosWorld();
    restore = restoreGfx;
    // a streamed weapon skin is fetched on demand, never by the bulk stream
    const { weaponSkinModelUrls } = await import('../src/render/characters/manifest');
    const skin = weaponSkinModelUrls()[0];
    const before = calls.length;
    assets.ensureCharacterUrl(skin);
    assets.ensureCharacterUrl(skin);
    expect(calls.slice(before)).toEqual([{ url: skin, priority: 'demand' }]);
  });
});
