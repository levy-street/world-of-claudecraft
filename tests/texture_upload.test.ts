import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { uploadDataTextureInChunks } from '../src/render/texture_upload';

describe('chunked DataTexture upload', () => {
  it('uploads complete rows in bounded batches and yields before each batch', async () => {
    const updateRanges: { start: number; count: number }[] = [];
    const texture = Object.assign(new THREE.DataTexture(new Uint16Array(8 * 5 * 4), 8, 5), {
      updateRanges,
      clearUpdateRanges: () => {
        updateRanges.length = 0;
      },
      addUpdateRange: (start: number, count: number) => {
        updateRanges.push({ start, count });
      },
    });
    const calls: { start: number; count: number }[][] = [];
    const target = {
      initTexture: (candidate: THREE.Texture) => {
        expect(candidate).toBe(texture);
        calls.push(texture.updateRanges.map((range) => ({ ...range })));
        texture.clearUpdateRanges();
      },
    };
    const beforeChunk = vi.fn(async () => undefined);
    const chunks = await uploadDataTextureInChunks(target, texture, {
      // Each row is 8 * RGBA * uint16 = 64 bytes, so this selects two rows.
      maxChunkBytes: 128,
      beforeChunk,
    });

    expect(chunks).toBe(3);
    expect(beforeChunk).toHaveBeenCalledTimes(3);
    expect(calls).toEqual([
      [
        { start: 0, count: 32 },
        { start: 32, count: 32 },
      ],
      [
        { start: 64, count: 32 },
        { start: 96, count: 32 },
      ],
      [{ start: 128, count: 32 }],
    ]);
  });

  it('clears stale pre-existing update ranges before the first batch', async () => {
    // QA mutation gap: every other rig starts with an empty updateRanges
    // array, so the module's initial clearUpdateRanges() was unobservable. A
    // texture carrying a range from an aborted earlier upload must not leak
    // it into the first batch (the consumer would re-upload a stale region
    // and the first chunk would overshoot its byte budget).
    const updateRanges: { start: number; count: number }[] = [{ start: 512, count: 7 }];
    const texture = Object.assign(new THREE.DataTexture(new Uint16Array(8 * 2 * 4), 8, 2), {
      updateRanges,
      clearUpdateRanges: () => {
        updateRanges.length = 0;
      },
      addUpdateRange: (start: number, count: number) => {
        updateRanges.push({ start, count });
      },
    });
    const calls: { start: number; count: number }[][] = [];
    const target = {
      initTexture: () => {
        calls.push(texture.updateRanges.map((range) => ({ ...range })));
        texture.clearUpdateRanges();
      },
    };
    await uploadDataTextureInChunks(target, texture, { maxChunkBytes: 64 });
    expect(calls[0]).toEqual([{ start: 0, count: 32 }]);
    for (const batch of calls) {
      expect(batch).not.toContainEqual({ start: 512, count: 7 });
    }
  });

  it('takes the bounded path on a plain DataTexture (native ranges since 0.185)', async () => {
    // Premise pin: the installed three ships the update-range API on every
    // texture, so the module's production consumers, the sky env/dome HDR
    // DataTextures behind prewarmTextureInIdle (renderer.ts prepareZoneSky
    // and the deferred sky resume), upload bounded with no polyfill (the
    // forward-compatible arm this module always carried). Bone palettes never
    // route through here; Skeleton.update pays whole-texture uploads on every
    // three in the train.
    const texture = new THREE.DataTexture(new Uint16Array(8 * 5 * 4), 8, 5);
    expect(Array.isArray(texture.updateRanges)).toBe(true);
    expect(typeof texture.addUpdateRange).toBe('function');
    expect(typeof texture.clearUpdateRanges).toBe('function');

    const initTexture = vi.fn();
    const beforeChunk = vi.fn(async () => undefined);
    const chunks = await uploadDataTextureInChunks({ initTexture }, texture, {
      maxChunkBytes: 128,
      beforeChunk,
    });

    expect(chunks).toBe(3);
    expect(beforeChunk).toHaveBeenCalledTimes(3);
    expect(initTexture).toHaveBeenCalledTimes(3);
    // Nothing consumed the ranges (no real GL upload here), so all five row
    // ranges accumulate in order.
    expect(texture.updateRanges).toEqual([
      { start: 0, count: 32 },
      { start: 32, count: 32 },
      { start: 64, count: 32 },
      { start: 96, count: 32 },
      { start: 128, count: 32 },
    ]);
  });

  it('uses one valid upload when a texture lacks the range API', async () => {
    const texture = Object.assign(new THREE.DataTexture(new Uint16Array(8 * 5 * 4), 8, 5), {
      addUpdateRange: undefined,
    }) as unknown as THREE.DataTexture;
    const initTexture = vi.fn();
    const beforeChunk = vi.fn(async () => undefined);
    const chunks = await uploadDataTextureInChunks({ initTexture }, texture, {
      maxChunkBytes: 128,
      beforeChunk,
    });

    expect(chunks).toBe(1);
    expect(beforeChunk).toHaveBeenCalledOnce();
    expect(initTexture).toHaveBeenCalledOnce();
    expect(initTexture).toHaveBeenCalledWith(texture);
  });

  it('falls back to one normal upload for non-data textures', async () => {
    const initTexture = vi.fn();
    const beforeChunk = vi.fn(async () => undefined);
    const chunks = await uploadDataTextureInChunks({ initTexture }, new THREE.Texture(), {
      beforeChunk,
    });
    expect(chunks).toBe(1);
    expect(beforeChunk).toHaveBeenCalledOnce();
    expect(initTexture).toHaveBeenCalledOnce();
  });

  it('awaits an injected per-chunk GPU scheduler', async () => {
    const texture = new THREE.Texture();
    const initTexture = vi.fn();
    let release!: () => void;
    const uploadChunk = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const upload = uploadDataTextureInChunks({ initTexture }, texture, { uploadChunk });

    await Promise.resolve();
    expect(uploadChunk).toHaveBeenCalledWith(texture);
    expect(initTexture).not.toHaveBeenCalled();
    release();
    await expect(upload).resolves.toBe(1);
  });
});
