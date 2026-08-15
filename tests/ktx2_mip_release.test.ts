// Behavioral pins for src/render/assets/ktx2_mip_release.ts: post-upload CPU
// mip release for world-only KTX2 textures, the full-shape stub invariant a
// fresh WebGL context's texStorage allocation depends on, and the
// context-loss re-transcode restore story. Uses real THREE.CompressedTexture
// instances and simulates three r165's upload contract (texture.onUpdate fires
// after a completed GPU upload) directly, so every pin runs in plain Node.
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  armKtx2MipRelease,
  classifyGltfKtx2Textures,
  dismissKtx2Source,
  enableKtx2MipRelease,
  isKtx2MipReleasableUrl,
  isKtx2MipReleaseEnabled,
  KTX2_MIP_EXEMPT_MODEL_ROOTS,
  KTX2_MIP_RELEASABLE_MODEL_ROOTS,
  type Ktx2MipLevel,
  ktx2MipReleaseInternalsForTest,
  ktx2MipsOnContextLost,
  ktx2MipsRestored,
  ktx2RetainedSourceBytes,
  setKtx2MipRederive,
  stashKtx2TranscodeSource,
} from '../src/render/assets/ktx2_mip_release';
import { residencyBudget } from '../src/render/assets/residency_budget';

const ROOT = path.resolve(__dirname, '..');

afterEach(() => {
  ktx2MipReleaseInternalsForTest.reset();
  vi.restoreAllMocks();
});

function makeMips(levels: number, size = 8): Ktx2MipLevel[] {
  const mips: Ktx2MipLevel[] = [];
  let w = size;
  // Rectangular on purpose: a stub construction that transposed width and
  // height would still pass against a square fixture.
  let h = Math.max(1, size >> 1);
  for (let i = 0; i < levels; i++) {
    mips.push({ width: w, height: h, data: new Uint8Array(Math.max(16, w * h)).fill(7) });
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
  }
  return mips;
}

function makeTexture(levels = 4): THREE.CompressedTexture {
  return new THREE.CompressedTexture(
    makeMips(levels) as unknown as ImageData[],
    8,
    4,
    THREE.RGBA_ETC2_EAC_Format,
    THREE.UnsignedByteType,
  );
}

const SOURCE_BYTES = [11, 22, 33, 44, 55];

function makeSource(): ArrayBuffer {
  return new Uint8Array(SOURCE_BYTES).buffer;
}

/** three r165 WebGLTextures.uploadTexture's post-upload callback. */
function simulateUpload(tex: THREE.CompressedTexture): void {
  (tex as unknown as { onUpdate: ((t: unknown) => void) | null }).onUpdate?.(tex);
}

function mipsOf(tex: THREE.CompressedTexture): Ktx2MipLevel[] {
  return tex.mipmaps as unknown as Ktx2MipLevel[];
}

function armedTexture(levels = 4): THREE.CompressedTexture {
  enableKtx2MipRelease(() => false);
  const tex = makeTexture(levels);
  stashKtx2TranscodeSource(tex, makeSource());
  armKtx2MipRelease(tex);
  return tex;
}

describe('post-upload mip release', () => {
  it('replaces the mip chain with full-shape zero-byte stubs after upload', () => {
    const tex = armedTexture(4);
    const original = mipsOf(tex).map((m) => ({ width: m.width, height: m.height }));
    const originalBytes = mipsOf(tex).reduce((s, m) => s + m.data.byteLength, 0);
    expect(originalBytes).toBeGreaterThan(0);

    simulateUpload(tex);

    const stubs = mipsOf(tex);
    // The texStorage shape invariant: a fresh context reads mipmaps[0].width
    // and mipmaps.length for its immutable allocation, so the stub chain must
    // carry the SAME level count and per-level dimensions as the real one. A
    // mutant that empties the array or collapses levels goes red here.
    expect(stubs.map((m) => ({ width: m.width, height: m.height }))).toEqual(original);
    for (const stub of stubs) expect(stub.data.byteLength).toBe(0);
    // three's own upload-write gate: with dataReady false a stub upload
    // allocates storage and skips every sub-image write (no GL error storm).
    expect(tex.source.dataReady).toBe(false);
    expect(ktx2MipReleaseInternalsForTest.stateOf(tex)).toBe('released');
    expect(ktx2MipReleaseInternalsForTest.releasedBytes()).toBe(originalBytes);
  });

  it('keeps real mips resident until an upload actually completes', () => {
    const tex = armedTexture(3);
    expect(mipsOf(tex)[0]?.data.byteLength).toBeGreaterThan(0);
    expect(ktx2MipReleaseInternalsForTest.stateOf(tex)).toBe('armed');
  });

  it('never releases without the game-entry opt-in (editor/guide safety)', () => {
    expect(isKtx2MipReleaseEnabled()).toBe(false);
    const tex = makeTexture(3);
    stashKtx2TranscodeSource(tex, makeSource());
    armKtx2MipRelease(tex);
    simulateUpload(tex);
    expect(mipsOf(tex)[0]?.data.byteLength).toBeGreaterThan(0);
    expect(ktx2MipReleaseInternalsForTest.entryCount()).toBe(0);
    // The stash is dropped, not leaked, when release is disabled.
    expect(ktx2MipReleaseInternalsForTest.pendingCount()).toBe(0);
  });

  it('never arms on a constrained-memory profile, and never releases on a live flip', () => {
    // The EM-ruled profile gate: constrained profiles (the iOS WebKit ladder,
    // phone-class browsers) keep resident CPU mips because their semi-routine
    // in-place context loss has no curtained restore. Desktop arms (every
    // other test in this file passes a () => false probe); constrained never
    // does, and the stash is dropped, not leaked.
    let constrained = true;
    enableKtx2MipRelease(() => constrained);
    const tex = makeTexture(3);
    stashKtx2TranscodeSource(tex, makeSource());
    armKtx2MipRelease(tex);
    expect(ktx2MipReleaseInternalsForTest.entryCount()).toBe(0);
    expect(ktx2MipReleaseInternalsForTest.pendingCount()).toBe(0);
    simulateUpload(tex);
    expect(mipsOf(tex)[0]?.data.byteLength).toBeGreaterThan(0);

    // The probe is read LIVE at release time too: a texture armed while the
    // profile read desktop (early deferred loads classify before initGfxTier
    // settles the profile) must stay resident if the profile turns
    // constrained before its first upload. The armed entry sits inert.
    constrained = false;
    const early = makeTexture(3);
    stashKtx2TranscodeSource(early, makeSource());
    armKtx2MipRelease(early);
    expect(ktx2MipReleaseInternalsForTest.stateOf(early)).toBe('armed');
    constrained = true;
    simulateUpload(early);
    expect(mipsOf(early)[0]?.data.byteLength).toBeGreaterThan(0);
    expect(early.source.dataReady).toBe(true);
    expect(ktx2MipReleaseInternalsForTest.stateOf(early)).toBe('armed');
  });

  it('never arms a texture without a stashed restore source', () => {
    enableKtx2MipRelease(() => false);
    const tex = makeTexture(3);
    armKtx2MipRelease(tex);
    simulateUpload(tex);
    expect(mipsOf(tex)[0]?.data.byteLength).toBeGreaterThan(0);
    expect(ktx2MipReleaseInternalsForTest.entryCount()).toBe(0);
  });

  it('ignores non-2D-compressed transcode results (raw/array/cube containers)', () => {
    enableKtx2MipRelease(() => false);
    const data = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    stashKtx2TranscodeSource(data, makeSource());
    expect(ktx2MipReleaseInternalsForTest.pendingCount()).toBe(0);
    const arrayLike = makeTexture(2) as THREE.CompressedTexture & {
      isCompressedArrayTexture?: boolean;
    };
    arrayLike.isCompressedArrayTexture = true;
    stashKtx2TranscodeSource(arrayLike, makeSource());
    expect(ktx2MipReleaseInternalsForTest.pendingCount()).toBe(0);
  });

  it('drops its bookkeeping when the texture is disposed', () => {
    const tex = armedTexture(2);
    simulateUpload(tex);
    expect(ktx2MipReleaseInternalsForTest.entryCount()).toBe(1);
    tex.dispose();
    expect(ktx2MipReleaseInternalsForTest.entryCount()).toBe(0);
    // A loss after dispose must not transcode for the dead texture.
    const rederive = vi.fn();
    setKtx2MipRederive(rederive);
    ktx2MipsOnContextLost();
    expect(rederive).not.toHaveBeenCalled();
  });
});

describe('context-loss restore story', () => {
  it('re-transcodes from a COPY of the retained source and re-releases after re-upload', async () => {
    const tex = armedTexture(4);
    simulateUpload(tex);
    const freshMips = makeMips(4);
    const calls: number[][] = [];
    setKtx2MipRederive(async (source) => {
      calls.push([...new Uint8Array(source)]);
      // Mimic the real transcode: the worker hand-off DETACHES the input.
      structuredClone(source, { transfer: [source] });
      // Premise check: on a host where transfer were a no-op, the copy pins
      // below would be vacuous, so fail loudly instead.
      expect(source.byteLength).toBe(0);
      return { mipmaps: freshMips, format: tex.format as number };
    });

    const versionBefore = tex.version;
    const sourceVersionBefore = tex.source.version;
    ktx2MipsOnContextLost();
    expect(ktx2MipReleaseInternalsForTest.stateOf(tex)).toBe('restoring');
    await ktx2MipsRestored();

    // Real mips are back and a re-upload was requested. three r165 gates the
    // actual re-upload (and its onUpdate) on SOURCE.version, which only the
    // needsUpdate setter bumps: a bare version++ mutant must go red here.
    expect(tex.mipmaps as unknown).toBe(freshMips);
    expect(tex.version).toBe(versionBefore + 1);
    expect(tex.source.version).toBe(sourceVersionBefore + 1);
    // The upload-write gate reopens with the real data present.
    expect(tex.source.dataReady).toBe(true);
    expect(ktx2MipReleaseInternalsForTest.stateOf(tex)).toBe('armed');

    // The re-upload's onUpdate releases back to stubs: the steady-state cycle.
    simulateUpload(tex);
    expect(mipsOf(tex)).toHaveLength(4);
    expect(mipsOf(tex)[0]?.data.byteLength).toBe(0);

    // A SECOND loss still restores: the retained source survived the first
    // (detaching) hand-off, which proves the per-restore copy. A mutant that
    // passes the retained buffer itself goes red on the byte assertion.
    ktx2MipsOnContextLost();
    await ktx2MipsRestored();
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(SOURCE_BYTES);
  });

  it('ktx2MipsRestored gates on the in-flight transcode (the rebuild-curtain contract)', async () => {
    const tex = armedTexture(2);
    simulateUpload(tex);
    const freshMips = makeMips(2);
    setKtx2MipRederive(async (source) => {
      structuredClone(source, { transfer: [source] });
      // Settle behind a macrotask so microtask drift alone cannot satisfy the
      // await: a ktx2MipsRestored() that resolves immediately must go red.
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { mipmaps: freshMips, format: tex.format as number };
    });
    ktx2MipsOnContextLost();
    expect(mipsOf(tex)[0]?.data.byteLength).toBe(0);
    await ktx2MipsRestored();
    // Immediately after the gate, the real chain is already in place.
    expect(tex.mipmaps as unknown).toBe(freshMips);
  });

  it('does not restart a transcode already in flight on a second loss', () => {
    const tex = armedTexture(2);
    simulateUpload(tex);
    const rederive = vi.fn(() => new Promise<never>(() => {}));
    setKtx2MipRederive(rederive);
    ktx2MipsOnContextLost();
    ktx2MipsOnContextLost();
    expect(rederive).toHaveBeenCalledTimes(1);
    expect(ktx2MipReleaseInternalsForTest.stateOf(tex)).toBe('restoring');
  });

  it('leaves stubs in place when the transcode comes back with a different format', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tex = armedTexture(4);
    simulateUpload(tex);
    setKtx2MipRederive(async () => ({
      mipmaps: makeMips(4),
      format: (tex.format as number) + 1,
    }));
    const versionBefore = tex.version;
    ktx2MipsOnContextLost();
    await ktx2MipsRestored();
    // The GPU allocation cannot be reshaped: stubs stay, no upload requested,
    // the write gate stays closed, and the entry returns to released so a
    // later loss can retry.
    expect(mipsOf(tex)[0]?.data.byteLength).toBe(0);
    expect(tex.version).toBe(versionBefore);
    expect(tex.source.dataReady).toBe(false);
    expect(ktx2MipReleaseInternalsForTest.stateOf(tex)).toBe('released');
    expect(warn).toHaveBeenCalledWith(
      '[ktx2] restore transcode shape changed; texture left released',
    );
  });

  it('leaves stubs in place when the transcode returns a different level count', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tex = armedTexture(4);
    simulateUpload(tex);
    // Same format, fewer levels: the immutable texStorage allocation cannot
    // absorb a reshaped chain either, so this arm must behave like the format
    // mismatch above.
    setKtx2MipRederive(async () => ({
      mipmaps: makeMips(3),
      format: tex.format as number,
    }));
    ktx2MipsOnContextLost();
    await ktx2MipsRestored();
    expect(mipsOf(tex)).toHaveLength(4);
    expect(mipsOf(tex)[0]?.data.byteLength).toBe(0);
    expect(ktx2MipReleaseInternalsForTest.stateOf(tex)).toBe('released');
    expect(warn).toHaveBeenCalledWith(
      '[ktx2] restore transcode shape changed; texture left released',
    );
  });

  it('survives a transcode failure and stays retryable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tex = armedTexture(2);
    simulateUpload(tex);
    const rederive = vi
      .fn<(source: ArrayBuffer) => Promise<{ mipmaps: Ktx2MipLevel[]; format: number }>>()
      .mockRejectedValue(new Error('worker died'));
    setKtx2MipRederive(rederive);
    ktx2MipsOnContextLost();
    await ktx2MipsRestored();
    expect(ktx2MipReleaseInternalsForTest.stateOf(tex)).toBe('released');
    expect(warn).toHaveBeenCalledWith(
      '[ktx2] restore transcode failed; texture left released',
      expect.any(Error),
    );
    ktx2MipsOnContextLost();
    expect(rederive).toHaveBeenCalledTimes(2);
  });

  it('discards a transcode that resolves after the texture was disposed', async () => {
    const tex = armedTexture(2);
    simulateUpload(tex);
    let resolveTranscode: (r: { mipmaps: Ktx2MipLevel[]; format: number }) => void = () => {};
    setKtx2MipRederive(
      () =>
        new Promise((resolve) => {
          resolveTranscode = resolve;
        }),
    );
    ktx2MipsOnContextLost();
    tex.dispose();
    resolveTranscode({ mipmaps: makeMips(2), format: tex.format as number });
    await ktx2MipsRestored();
    expect(mipsOf(tex)[0]?.data.byteLength).toBe(0);
  });

  it('discards a transcode that rejects after the texture was disposed, without warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tex = armedTexture(2);
    simulateUpload(tex);
    let rejectTranscode: (err: Error) => void = () => {};
    setKtx2MipRederive(
      () =>
        new Promise((_resolve, reject) => {
          rejectTranscode = reject;
        }),
    );
    ktx2MipsOnContextLost();
    tex.dispose();
    rejectTranscode(new Error('late failure'));
    await ktx2MipsRestored();
    expect(warn).not.toHaveBeenCalledWith(
      '[ktx2] restore transcode failed; texture left released',
      expect.any(Error),
    );
  });
});

describe('category policy', () => {
  it('pins both category lists to literals: moving a root between them is a conscious change', () => {
    // These are the load-bearing safety lists. The exempt roots are drawn by
    // SECOND renderers (character preview, portrait, armory, dev outfit
    // audit), which need the CPU mips for their own upload; reclassifying one
    // as releasable ships stub-black textures in those rigs. A loop over the
    // exported constants cannot catch that (both sides move together), so the
    // membership is pinned literally here.
    expect([...KTX2_MIP_RELEASABLE_MODEL_ROOTS]).toEqual([
      'battleground',
      'biome',
      'city',
      'dungeon',
      'foliage',
      'medieval_village_v2',
      'props',
      'quest',
      'resources',
    ]);
    expect([...KTX2_MIP_EXEMPT_MODEL_ROOTS]).toEqual([
      'chars',
      'creatures',
      'mounts',
      'tools',
      'weapons',
    ]);
  });

  it('releases only world-only model categories', () => {
    for (const root of KTX2_MIP_RELEASABLE_MODEL_ROOTS) {
      expect(isKtx2MipReleasableUrl(`models/${root}/x.glb`), root).toBe(true);
      expect(isKtx2MipReleasableUrl(`https://cdn.example/models/${root}/x.glb`), root).toBe(true);
    }
    for (const root of KTX2_MIP_EXEMPT_MODEL_ROOTS) {
      expect(isKtx2MipReleasableUrl(`models/${root}/x.glb`), root).toBe(false);
    }
    // Unknown roots and non-model urls stay exempt: fail-safe by default.
    expect(isKtx2MipReleasableUrl('models/futuredir/x.glb')).toBe(false);
    expect(isKtx2MipReleasableUrl('textures/skins/mage/alt_a.ktx2')).toBe(false);
    // The models/ segment must sit at a path boundary: a lookalike parent
    // directory never qualifies (pins the regex anchor).
    expect(isKtx2MipReleasableUrl('assets/xmodels/props/x.glb')).toBe(false);
  });

  it('classifies every model root on disk explicitly', () => {
    // A NEW public/models root defaults to exempt (safe), but must be
    // consciously classified into one of the two lists so the safety
    // reasoning (which renderers can draw it) is actually reviewed.
    const roots = fs
      .readdirSync(path.join(ROOT, 'public', 'models'), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    const classified = [...KTX2_MIP_RELEASABLE_MODEL_ROOTS, ...KTX2_MIP_EXEMPT_MODEL_ROOTS].sort();
    expect(classified).toEqual(roots);
  });

  it('arms releasable-category GLB textures and dismisses exempt ones', () => {
    enableKtx2MipRelease(() => false);
    const releasableTex = makeTexture(3);
    stashKtx2TranscodeSource(releasableTex, makeSource());
    const gltfLike = (
      tex: unknown,
    ): { scene: { traverse: (cb: (o: unknown) => void) => void } } => ({
      scene: {
        traverse: (cb) => cb({ isMesh: true, material: [{ map: tex, normalMap: null }] }),
      },
    });
    classifyGltfKtx2Textures(gltfLike(releasableTex), 'models/props/barrel.glb');
    simulateUpload(releasableTex);
    expect(mipsOf(releasableTex)[0]?.data.byteLength).toBe(0);

    const exemptTex = makeTexture(3);
    stashKtx2TranscodeSource(exemptTex, makeSource());
    classifyGltfKtx2Textures(gltfLike(exemptTex), 'models/chars/mage_classic.glb');
    simulateUpload(exemptTex);
    expect(mipsOf(exemptTex)[0]?.data.byteLength).toBeGreaterThan(0);
    // Exempt classification drops the stashed source instead of leaking it.
    expect(ktx2MipReleaseInternalsForTest.pendingCount()).toBe(0);
  });

  it('classifies every material map slot, on array and single materials alike', () => {
    enableKtx2MipRelease(() => false);
    const slots = [
      'map',
      'normalMap',
      'emissiveMap',
      'roughnessMap',
      'metalnessMap',
      'aoMap',
      'alphaMap',
    ];
    const textures = slots.map(() => makeTexture(2));
    for (const tex of textures) stashKtx2TranscodeSource(tex, makeSource());
    const arrayMaterial: Record<string, unknown> = {};
    const singleMaterial: Record<string, unknown> = {};
    slots.forEach((slot, i) => {
      // Split the seven slots across BOTH material shapes so shrinking the
      // slot list, or collapsing the array/single-material ternary, strands a
      // stashed source and goes red below.
      (i < 4 ? arrayMaterial : singleMaterial)[slot] = textures[i];
    });
    classifyGltfKtx2Textures(
      {
        scene: {
          traverse: (cb: (o: unknown) => void) => {
            cb({ isMesh: true, material: [arrayMaterial] });
            cb({ isMesh: true, material: singleMaterial });
          },
        },
      },
      'models/props/kit.glb',
    );
    expect(ktx2MipReleaseInternalsForTest.pendingCount()).toBe(0);
    for (const tex of textures) {
      simulateUpload(tex);
      expect(mipsOf(tex)[0]?.data.byteLength).toBe(0);
    }
  });

  it('drops a stashed source when the texture is disposed before classification', () => {
    enableKtx2MipRelease(() => false);
    const tex = makeTexture(2);
    stashKtx2TranscodeSource(tex, makeSource());
    expect(ktx2MipReleaseInternalsForTest.pendingCount()).toBe(1);
    tex.dispose();
    expect(ktx2MipReleaseInternalsForTest.pendingCount()).toBe(0);
  });

  it('dismiss DISARMS an armed entry before its first upload (mips stay resident)', () => {
    const tex = armedTexture(3);
    expect(ktx2MipReleaseInternalsForTest.entryCount()).toBe(1);
    dismissKtx2Source(tex);
    expect(ktx2MipReleaseInternalsForTest.entryCount()).toBe(0);
    // The unwound hook must not release on a later upload.
    simulateUpload(tex);
    expect(mipsOf(tex)[0]?.data.byteLength).toBeGreaterThan(0);
    expect(tex.source.dataReady).toBe(true);
  });

  it('dismiss leaves a RELEASED entry registered: restore is its only path back', () => {
    const tex = armedTexture(2);
    simulateUpload(tex);
    dismissKtx2Source(tex);
    expect(ktx2MipReleaseInternalsForTest.stateOf(tex)).toBe('released');
  });

  it('reports retained source bytes to the residency diagnostic', () => {
    const tex = armedTexture(2);
    expect(ktx2RetainedSourceBytes()).toBe(SOURCE_BYTES.length);
    simulateUpload(tex);
    expect(ktx2RetainedSourceBytes()).toBe(SOURCE_BYTES.length);
    // residencyBudget is a pure function of its sources argument: the caller
    // (the Renderer's build summary, pinned below) feeds the retained bytes in
    // as a pre-counted source, so the released mip chains (which truthfully
    // read ~0) cannot present the release as free.
    expect(residencyBudget([])).toEqual([]);
    const buckets = residencyBudget([
      { label: 'ktx2 restore sources', bytes: ktx2RetainedSourceBytes() },
    ]);
    expect(buckets).toEqual([
      { category: 'ktx2 restore sources', bytes: SOURCE_BYTES.length, count: 1 },
    ]);
    tex.dispose();
    expect(ktx2RetainedSourceBytes()).toBe(0);
    expect(
      residencyBudget([{ label: 'ktx2 restore sources', bytes: ktx2RetainedSourceBytes() }]),
    ).toEqual([]);
  });

  it('fails soft on partial GLTF shapes', () => {
    expect(() => classifyGltfKtx2Textures({}, 'models/props/x.glb')).not.toThrow();
    expect(() => classifyGltfKtx2Textures({ scene: {} }, 'models/props/x.glb')).not.toThrow();
  });
});

describe('wiring pins (source scans, anchor style per docs/qa-gate.md)', () => {
  const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

  /** The source between an anchor and the next occurrence of `until`: lets a
   *  positional pin assert a call sits INSIDE a specific block, so moving it
   *  into dead code elsewhere in the file cannot stay green. */
  const between = (source: string, anchor: string, until: string): string => {
    const start = source.indexOf(anchor);
    expect(start, anchor).toBeGreaterThanOrEqual(0);
    const end = source.indexOf(until, start + anchor.length);
    expect(end, `${anchor} ... ${until}`).toBeGreaterThan(start);
    return source.slice(start, end);
  };

  it('loader.ts classifies GLB textures and dismisses standalone atlases', () => {
    const loaderSrc = read('src/render/assets/loader.ts');
    expect(loaderSrc).toContain('classifyGltfKtx2Textures(gltf, resolved)');
    expect(loaderSrc).toContain('dismissKtx2Source(tex)');
  });

  it("renderer.ts feeds the retained restore-source bytes into the residency table's sources", () => {
    // residencyBudget is a pure function of its argument, so the cost side of
    // the mip release shows up only if the one real caller passes it in.
    const rendererSrc = read('src/render/renderer.ts');
    const sources = between(rendererSrc, 'residencyBudget([', ']),');
    expect(sources).toContain("label: 'ktx2 restore sources'");
    expect(sources).toContain('bytes: ktx2RetainedSourceBytes()');
  });

  it('main.ts opts in and wires both recovery paths, at their load-bearing positions', () => {
    const mainSrc = read('src/main.ts');
    // (1) The opt-in must run before the deferred preload lane opens: a GLB
    // that classifies before the switch is on would be dismissed and never
    // release. Moving the call into startGame after the preloads stays red.
    // The injected probe must be the live constrained-memory read (the
    // EM-ruled profile gate; GFX is reassigned by initGfxTier and rebuilds).
    const enableAt = mainSrc.indexOf('enableKtx2MipRelease(() => GFX.constrainedMemory)');
    const deferredAt = mainSrc.indexOf('beginDeferredPreloads()');
    expect(enableAt).toBeGreaterThanOrEqual(0);
    expect(deferredAt).toBeGreaterThanOrEqual(0);
    expect(enableAt).toBeLessThan(deferredAt);
    // (2) The re-transcode kick must sit INSIDE the canvas webglcontextlost
    // listener (it serves both in-place loss and the rebuild recycle).
    expect(
      between(mainSrc, "addEventListener('webglcontextlost'", 'webglcontextrestored'),
    ).toContain('ktx2MipsOnContextLost()');
    // (3) The curtain gate must sit INSIDE the rebuild prewarm step, after the
    // far-vista hold, so the reveal never shows stub-black world textures.
    expect(between(mainSrc, 'prewarmRenderer: async (next)', 'validateRenderer')).toContain(
      'await ktx2MipsRestored()',
    );
    for (const entry of ['src/editor/main.ts', 'src/guide/main.ts']) {
      expect(read(entry), entry).not.toContain('enableKtx2MipRelease');
    }
  });
});
