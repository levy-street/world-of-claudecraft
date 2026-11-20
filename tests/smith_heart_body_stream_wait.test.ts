// A raid body still on the wire is waited for quietly, never "not preloaded".
//
// The Smith's Heart's own bodies (the Hammer Vein Warder first: the raid's
// first trash, standing at its door) load behind the raid's arrival cover, on
// demand (rift_body_stream_core.ts dungeonCharacterBodyUrls), on every host.
// A view the renderer asked for before its body landed used to throw out of
// the build ("character asset not preloaded: models/creatures/
// heart_hammer_warder.glb"), logged as "character visual unavailable,
// skipping view": a loud preload-set bug's message for what is only a body
// still downloading (the night of 2026-11-20 read it as the loading screen's
// hang). Now the build waits quietly while every missing file is such an
// on-demand dungeon body, kicking its fetch, and the view's retry builds it
// once it lands; any other missing file still fails loudly.
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

const pending = vi.hoisted(() => ({
  match: 'heart_hammer_warder.glb',
  resolve: null as (() => void) | null,
  calls: [] as string[],
}));
vi.mock('../src/render/assets/loader', () => ({
  loadGltf: vi.fn((url: string) => {
    pending.calls.push(url);
    const gltf = { scene: new THREE.Group(), animations: [] };
    if (!url.endsWith(pending.match)) return Promise.resolve(gltf);
    return new Promise((resolve) => {
      pending.resolve = () => resolve(gltf);
    });
  }),
  loadTexture: vi.fn(async () => new THREE.Texture()),
  loadKtx2Texture: vi.fn(async () => new THREE.Texture()),
  releaseGltf: vi.fn(),
}));

describe('bodyStreamVerdict', () => {
  it('reads ready, a quiet wait, or a real miss', async () => {
    const { bodyStreamVerdict } = await import('../src/render/characters/rift_body_stream_core');
    const resident = new Set(['a', 'b']);
    const streams = new Set(['c', 'd']);
    const has = (u: string) => resident.has(u);
    const st = (u: string) => streams.has(u);
    expect(bodyStreamVerdict(['a', 'b'], has, st)).toBe('ready');
    expect(bodyStreamVerdict(['a', 'c'], has, st)).toBe('await');
    expect(bodyStreamVerdict(['c', 'd'], has, st)).toBe('await');
    // One file that should have been resident is a miss, even beside a streaming one.
    expect(bodyStreamVerdict(['c', 'x'], has, st)).toBe('miss');
    expect(bodyStreamVerdict(['x'], has, st)).toBe('miss');
  });
});

describe("the Smith's Heart's first trash body", () => {
  it('loads at the raid arrival with the rest of its bodies', async () => {
    const { dungeonCharacterBodyUrls, dungeonAndBuddyBodyUrls } = await import(
      '../src/render/characters/rift_body_stream_core'
    );
    const { VISUALS } = await import('../src/render/characters/manifest');
    const url = VISUALS.smith_heart_hammer_warder.url;
    expect(url).toMatch(/heart_hammer_warder\.glb$/);
    expect(dungeonCharacterBodyUrls('smith_heart')).toContain(url);
    expect(dungeonAndBuddyBodyUrls().has(url)).toBe(true);
  });

  it('is waited for quietly while it downloads, and builds once it lands', async () => {
    const assets = await import('../src/render/characters/assets');
    const { createCharacterVisual } = await import('../src/render/characters');
    const { VISUALS } = await import('../src/render/characters/manifest');
    const url = VISUALS.smith_heart_hammer_warder.url;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(assets.characterVisualAwaitingStream('smith_heart_hammer_warder')).toBe(true);
      // ...and asking kicked its fetch.
      expect(pending.calls.some((u) => u.endsWith('heart_hammer_warder.glb'))).toBe(true);
      const warder = {
        id: 1,
        kind: 'mob',
        templateId: 'heart_hammer_warder',
        color: 0x8a6430,
        skin: 0,
        auras: [],
        mainhandItemId: null,
        offhandItemId: null,
      } as unknown as Parameters<typeof createCharacterVisual>[0];
      expect(createCharacterVisual(warder)).toBeNull();
      const logged = [...warn.mock.calls, ...error.mock.calls].map((c) => c.map(String).join(' '));
      expect(logged.filter((l) => /not preloaded|visual unavailable/.test(l))).toEqual([]);
      pending.resolve?.();
      await vi.waitFor(() =>
        expect(assets.characterVisualAwaitingStream('smith_heart_hammer_warder')).toBe(false),
      );
      expect(assets.visualAssetsResident('smith_heart_hammer_warder', false)).toBe(true);
      expect(url).toBeTruthy();
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });
});
