// Behavioral coverage for src/render/assets/ktx2_support.ts: the shared KTX2
// transcoder that loader.ts attaches to the one GLTFLoader. The highest
// consequence branches are the no-probe fallbacks: a host whose THREE probe
// renderer cannot be built must first try a raw context for the REAL
// capability answer (keeping textures GPU-compressed), and only a host with no
// context at all falls back to transcoding into plain RGBA.
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ktx2MipReleaseInternalsForTest } from '../src/render/assets/ktx2_mip_release';
import {
  buildKtx2Rederive,
  ktx2InternalsForTest,
  ktx2Loader,
  ktx2WorkerConfigFromRawContext,
  wrapKtx2CreateTexture,
} from '../src/render/assets/ktx2_support';

afterEach(() => {
  ktx2InternalsForTest.reset();
  ktx2MipReleaseInternalsForTest.reset();
  vi.restoreAllMocks();
});

describe('ktx2 transcoder support', () => {
  it('memoizes one loader instance across calls', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const first = ktx2Loader();
    expect(ktx2Loader()).toBe(first);
  });

  it('falls back to an all-false workerConfig on a DOM-less host, with a warning', () => {
    // Plain Node has no document: the probe throws and the fallback arm runs.
    expect(typeof document).toBe('undefined');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const loader = ktx2Loader();
    // All-false support flags force the RGBA transcode target, the one every
    // WebGL implementation accepts; parse keeps working instead of throwing
    // "Missing initialization with .detectSupport".
    expect(loader.workerConfig).toMatchObject({
      astcSupported: false,
      etc1Supported: false,
      etc2Supported: false,
      dxtSupported: false,
      bptcSupported: false,
      pvrtcSupported: false,
    });
    // The fallback silently restores the decoded-bitmap footprint the KTX2
    // conversion exists to remove, so it must announce itself.
    expect(warn).toHaveBeenCalledWith('[ktx2] no probe context; transcoding to uncompressed RGBA');
  });

  it('probes a raw context for REAL capability when the THREE probe renderer fails', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fakeGl = {
      getExtension: (name: string) =>
        name === 'WEBGL_compressed_texture_s3tc' || name === 'EXT_texture_compression_bptc'
          ? {}
          : null,
    };
    const fakeCanvas = {
      width: 0,
      height: 0,
      addEventListener: () => {},
      removeEventListener: () => {},
      // Deliberately too bare for THREE.WebGLRenderer (its capability queries
      // throw), but a perfectly good raw context for getExtension probing:
      // exactly the "renderer probe failed, context exists" host class.
      getContext: () => fakeGl,
    };
    (globalThis as { document?: unknown }).document = {
      createElement: () => fakeCanvas,
    };
    try {
      const loader = ktx2Loader();
      // The provable capability answer, not the RGBA surrender: a mutant that
      // restores the old always-RGBA fallback goes red on dxt/bptc here.
      expect(loader.workerConfig).toMatchObject({
        astcSupported: false,
        etc1Supported: false,
        etc2Supported: false,
        dxtSupported: true,
        bptcSupported: true,
        pvrtcSupported: false,
      });
      expect(warn).toHaveBeenCalledWith(
        '[ktx2] no probe renderer; using raw WebGL context capability',
      );
      expect(warn).not.toHaveBeenCalledWith(
        '[ktx2] no probe context; transcoding to uncompressed RGBA',
      );
    } finally {
      delete (globalThis as { document?: unknown }).document;
    }
  });

  it('reaches the RGBA arm when a canvas exists but yields no context (exhausted pool)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fakeCanvas = {
      width: 0,
      height: 0,
      addEventListener: () => {},
      removeEventListener: () => {},
      getContext: () => null,
    };
    (globalThis as { document?: unknown }).document = {
      createElement: () => fakeCanvas,
    };
    try {
      const loader = ktx2Loader();
      expect(loader.workerConfig).toMatchObject({
        astcSupported: false,
        etc1Supported: false,
        etc2Supported: false,
        dxtSupported: false,
        bptcSupported: false,
        pvrtcSupported: false,
      });
      expect(warn).toHaveBeenCalledWith(
        '[ktx2] no probe context; transcoding to uncompressed RGBA',
      );
    } finally {
      delete (globalThis as { document?: unknown }).document;
    }
  });

  it('falls back to a WebGL1 raw context and releases the probe context afterwards', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const loseContext = vi.fn();
    const fakeGl = {
      getExtension: (name: string) => {
        if (name === 'WEBGL_lose_context') return { loseContext };
        return name === 'WEBGL_compressed_texture_etc' ? {} : null;
      },
    };
    const fakeCanvas = {
      width: 0,
      height: 0,
      addEventListener: () => {},
      removeEventListener: () => {},
      // webgl2 unavailable; only a WebGL1 context exists on this host.
      getContext: (kind: string) => (kind === 'webgl' ? fakeGl : null),
    };
    (globalThis as { document?: unknown }).document = {
      createElement: () => fakeCanvas,
    };
    try {
      const loader = ktx2Loader();
      expect(loader.workerConfig).toMatchObject({ etc2Supported: true, dxtSupported: false });
      // The probe context counts against the browser's live-context cap and
      // must be released as soon as the capability answer is taken.
      expect(loseContext).toHaveBeenCalledTimes(1);
    } finally {
      delete (globalThis as { document?: unknown }).document;
    }
  });

  const FLAG_TO_EXTENSION = [
    ['astcSupported', 'WEBGL_compressed_texture_astc'],
    ['etc1Supported', 'WEBGL_compressed_texture_etc1'],
    ['etc2Supported', 'WEBGL_compressed_texture_etc'],
    ['dxtSupported', 'WEBGL_compressed_texture_s3tc'],
    ['bptcSupported', 'EXT_texture_compression_bptc'],
    ['pvrtcSupported', 'WEBGL_compressed_texture_pvrtc'],
  ] as const;

  it.each(FLAG_TO_EXTENSION)('maps %s to exactly %s', (flag, extension) => {
    // Per-flag positive case: swapping any two extension names transcodes
    // into a format the GPU cannot sample, so each pair is pinned one by one.
    const config = ktx2WorkerConfigFromRawContext({
      getExtension: (name: string) => (name === extension ? {} : null),
    });
    for (const [otherFlag] of FLAG_TO_EXTENSION) {
      expect(config[otherFlag], otherFlag).toBe(otherFlag === flag);
    }
  });

  it('honors the WebKit-prefixed pvrtc alias, exactly like three detectSupport', () => {
    // three r165's WebGL arm ORs WEBKIT_WEBGL_compressed_texture_pvrtc into
    // pvrtcSupported; an old WebKit host exposing only the prefixed name must
    // get the same answer from the raw probe.
    const config = ktx2WorkerConfigFromRawContext({
      getExtension: (name: string) =>
        name === 'WEBKIT_WEBGL_compressed_texture_pvrtc' ? {} : null,
    });
    for (const [flag] of FLAG_TO_EXTENSION) {
      expect(config[flag], flag).toBe(flag === 'pvrtcSupported');
    }
  });

  it('derives the workerConfig flags from the real extension names three queries', () => {
    const asked: string[] = [];
    const gl = {
      getExtension: (name: string) => {
        asked.push(name);
        return name === 'WEBGL_compressed_texture_etc' ? {} : null;
      },
    };
    expect(ktx2WorkerConfigFromRawContext(gl)).toEqual({
      astcSupported: false,
      etc1Supported: false,
      etc2Supported: true,
      dxtSupported: false,
      bptcSupported: false,
      pvrtcSupported: false,
    });
    expect(asked.sort()).toEqual([
      'EXT_texture_compression_bptc',
      'WEBGL_compressed_texture_astc',
      'WEBGL_compressed_texture_etc',
      'WEBGL_compressed_texture_etc1',
      'WEBGL_compressed_texture_pvrtc',
      'WEBGL_compressed_texture_s3tc',
      'WEBKIT_WEBGL_compressed_texture_pvrtc',
    ]);
  });

  it('points the transcoder at the shipped /basis/ files', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(ktx2Loader().transcoderPath).toBe('/basis/');
  });

  it('reset() forgets the memoized instance', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const first = ktx2Loader();
    ktx2InternalsForTest.reset();
    expect(ktx2Loader()).not.toBe(first);
  });
});

describe('mip-release capture wiring', () => {
  it('copies the source BEFORE the detach and delegates with the host binding intact', async () => {
    const captured: { texture: unknown; source: ArrayBuffer }[] = [];
    const seen: { self: unknown; config: object | undefined }[] = [];
    const result = { fake: 'texture' };
    const host = {
      // A method (not an arrow) so a wrapper that drops the .call(this)
      // binding goes red on the `self` pin below. Three's real _createTexture
      // reads this.init() and this.workerPool, so the binding is load-bearing.
      _createTexture(this: unknown, buffer: ArrayBuffer, config?: object) {
        seen.push({ self: this, config });
        // Mimic three's KTX2Loader: the worker hand-off detaches the buffer.
        structuredClone(buffer, { transfer: [buffer] });
        // Premise check: without a real detach, the copy pin is vacuous.
        expect(buffer.byteLength).toBe(0);
        return Promise.resolve(result);
      },
    };
    expect(
      wrapKtx2CreateTexture(host, (texture, source) => captured.push({ texture, source })),
    ).toBe(true);
    const src = new Uint8Array([5, 4, 3, 2]).buffer;
    const config = { lowLevel: true };
    const out = await host._createTexture(src, config);
    expect(out).toBe(result);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.self).toBe(host);
    expect(seen[0]?.config).toBe(config);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.texture).toBe(result);
    // A mutant copying AFTER the original call sees a detached (empty) buffer.
    expect([...new Uint8Array(captured[0]?.source as ArrayBuffer)]).toEqual([5, 4, 3, 2]);
  });

  it('fails soft (no wrap) when the private hook is missing', () => {
    expect(wrapKtx2CreateTexture({}, () => {})).toBe(false);
  });

  it('skips the source copy entirely when capture is not enabled (editor/guide)', async () => {
    const captured: unknown[] = [];
    const result = { fake: 'texture' };
    const receivedDetached: boolean[] = [];
    const host = {
      _createTexture(this: unknown, buffer: ArrayBuffer) {
        // Without a capture copy, the original receives the caller's buffer
        // untouched (still attached).
        receivedDetached.push(buffer.byteLength === 0);
        return Promise.resolve(result);
      },
    };
    expect(
      wrapKtx2CreateTexture(
        host,
        (texture, source) => captured.push({ texture, source }),
        () => false,
      ),
    ).toBe(true);
    const out = await host._createTexture(new Uint8Array([9, 8]).buffer);
    expect(out).toBe(result);
    expect(receivedDetached).toEqual([false]);
    expect(captured).toEqual([]);
  });

  it('fails soft on the LIVE loader when a three bump removes the private hook', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const proto = KTX2Loader.prototype as unknown as { _createTexture?: unknown };
    const saved = proto._createTexture;
    proto._createTexture = undefined;
    try {
      const loader = ktx2Loader();
      expect(warn).toHaveBeenCalledWith(
        '[ktx2] KTX2Loader._createTexture unavailable; mip release inactive',
      );
      expect(ktx2MipReleaseInternalsForTest.hasRederive()).toBe(false);
      expect(Object.hasOwn(loader, '_createTexture')).toBe(false);
    } finally {
      proto._createTexture = saved;
    }
  });

  it('wires the capture wrapper and restore transcoder onto the shared loader', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const loader = ktx2Loader();
    // The wrapper lands as an instance own-property over the prototype hook,
    // and the mip-release registry received its re-transcode function.
    expect(Object.hasOwn(loader, '_createTexture')).toBe(true);
    expect(ktx2MipReleaseInternalsForTest.hasRederive()).toBe(true);
  });
});

describe('buildKtx2Rederive (the restore transcode)', () => {
  it('delegates to the UNWRAPPED original with the loader binding and extracts the chain', async () => {
    const mips = [{ width: 2, height: 2, data: new Uint8Array(4) }];
    const seen: unknown[] = [];
    const dispose = vi.fn();
    const fakeLoader = {};
    const original = function (this: unknown, buffer: ArrayBuffer): Promise<unknown> {
      seen.push(this, buffer);
      return Promise.resolve({ mipmaps: mips, format: 33779, dispose });
    };
    const rederive = buildKtx2Rederive(fakeLoader, original);
    const src = new Uint8Array([1]).buffer;
    await expect(rederive(src)).resolves.toEqual({ mipmaps: mips, format: 33779 });
    expect(seen[0]).toBe(fakeLoader);
    expect(seen[1]).toBe(src);
    // Only the chain and format survive; the throwaway texture is disposed.
    expect(dispose).toHaveBeenCalledTimes(1);
    // A restore transcode never re-stashes: the registry stays untouched
    // (re-stashing per context loss would grow it unboundedly).
    expect(ktx2MipReleaseInternalsForTest.pendingCount()).toBe(0);
  });

  it('rejects when the transcode returns no usable mip chain, disposing the result', async () => {
    const dispose = vi.fn();
    const rederive = buildKtx2Rederive({}, async () => ({ dispose }));
    await expect(rederive(new Uint8Array([1]).buffer)).rejects.toThrow(
      'ktx2 restore transcode returned no mip chain',
    );
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
