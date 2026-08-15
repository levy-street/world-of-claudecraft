// KTX2 CPU-side mip release: drop the transcoded mip chains of world-only GLB
// textures from the JS heap once the GPU has them, without breaking WebGL
// context recovery.
//
// Why: every KTX2 texture keeps its full transcoded mip chain on
// `texture.mipmaps` after upload (three re-uploads from that CPU copy on
// context restore), and across the shipped model set those chains are 3x to 6x
// the size of the source KTX2 payloads. This module trades them for a retained
// copy of the SOURCE bytes (captured by ktx2_support before the transcode
// worker detaches them) plus a re-transcode on context loss.
//
// The three r165 contract this module is written against
// (WebGLTextures.uploadTexture):
// - `texture.onUpdate(texture)` fires after a completed GPU upload: the exact
//   moment the CPU mip copies stop being needed on the happy path.
// - A fresh context re-uploads from `texture.mipmaps`: `mipmaps[0].width`
//   sizes the immutable texStorage2D allocation (mipmaps.length levels) and
//   each level's `data` feeds compressedTexSubImage2D / texSubImage2D.
// - Released textures therefore keep FULL-SHAPE STUBS (real level count and
//   dimensions, zero-length data), never an empty array: a stub upload
//   allocates the correct storage where an empty mipmaps array would be a
//   per-frame TypeError.
// - Release also clears `texture.source.dataReady`, three's own upload-write
//   gate: a stub upload allocates storage and SKIPS every sub-image write (no
//   GL errors, contents zeroed), and restore sets it back before requesting
//   the re-upload.
//
// Restore story (pinned by tests/ktx2_mip_release.test.ts): on
// `webglcontextlost` (in-place GPU loss AND the graphics-rebuild context
// recycle, both fire on the game canvas) every released texture starts an
// async re-transcode from its retained source; completion swaps the real mips
// back in, restores dataReady, and sets needsUpdate; the re-upload's onUpdate
// re-releases them to stubs. Until a texture's transcode lands, an upload
// shows it black rather than crashing; the graphics-rebuild curtain awaits
// ktx2MipsRestored() so that path never reveals stubs. The in-place GPU-loss
// path (no curtain) accepts a black window of a few seconds on the affected
// world props while the workers catch up: a designed, self-healing transient
// on an exceptional recovery path.
//
// Retention bounds: both registries hold their textures WEAKLY. A texture the
// world never references again (for example the normal/roughness maps a
// Lambert-tier material build discards) is garbage-collected together with
// its retained source, exactly as it was before this module existed. Retained
// source bytes are therefore bounded by the LIVE texture set and are surfaced
// to the residency diagnostic via ktx2RetainedSourceBytes().
//
// Scope: release is OPT-IN (enableKtx2MipRelease, called only by the game
// entry src/main.ts) and category-scoped to model roots only the world
// renderer draws. The character preview, portrait and armory renderers in the
// game page, and the editor/guide entries' extra renderers, upload the SAME
// cached texture objects into their own contexts, and a second context needs
// the CPU mips; every category one of them can draw stays exempt.
//
// Profile gate: release is additionally ACTIVE only on non-constrained-memory
// profiles (the enable call injects a live GFX.constrainedMemory probe, which
// covers the whole iOS WebKit ladder including tight-iOS plus phone-class
// constrained browsers). Constrained profiles keep resident CPU mips, exactly
// the pre-release behavior: their in-place context loss is semi-routine
// (backgrounding) and the uncurtained restore's black-props window would
// violate eviction invisibility right where loss is most common. Enabling on
// iOS is a follow-up that requires a curtained in-place restore first
// (tracked by issue 3218).
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';

export interface Ktx2MipLevel {
  width: number;
  height: number;
  data: Uint8Array;
}

/** The structural slice of THREE.CompressedTexture this module manages. */
interface ReleasableCompressedTexture {
  isCompressedTexture?: boolean;
  isCompressedArrayTexture?: boolean;
  isCompressedCubeTexture?: boolean;
  mipmaps?: unknown;
  format: number;
  needsUpdate: boolean;
  source?: { dataReady: boolean };
  onUpdate: ((texture: unknown) => void) | null;
  addEventListener(type: string, listener: () => void): void;
}

/** Model roots drawn ONLY by the world renderer in the game entry: safe to
 *  drop CPU mips after that one context uploads them. */
export const KTX2_MIP_RELEASABLE_MODEL_ROOTS: readonly string[] = [
  'battleground',
  'biome',
  'city',
  'dungeon',
  'foliage',
  'medieval_village_v2',
  'props',
  'quest',
  'resources',
];

/** Model roots a SECOND renderer can upload (character-creation preview,
 *  portrait rig, armory inspect, dev outfit audit all build CharacterVisuals
 *  from these caches): their CPU mips must stay resident. Kept in an explicit
 *  list so tests can prove every on-disk root was consciously classified. */
export const KTX2_MIP_EXEMPT_MODEL_ROOTS: readonly string[] = [
  'chars',
  'creatures',
  'mounts',
  'tools',
  'weapons',
];

type RederiveResult = { mipmaps: Ktx2MipLevel[]; format: number };
type Ktx2RederiveFn = (source: ArrayBuffer) => Promise<RederiveResult>;

type ReleaseState = 'armed' | 'released' | 'restoring';

interface ReleaseEntry {
  source: ArrayBuffer;
  shape: { width: number; height: number }[] | null;
  state: ReleaseState;
  releasedBytes: number;
  priorOnUpdate: ((texture: unknown) => void) | null;
}

/** A Map whose KEYS are held weakly but stay enumerable while alive: lookup
 *  through a WeakMap, iteration through pruned WeakRefs. Lets a texture the
 *  world dropped be garbage-collected together with its registry entry (the
 *  retained source bytes included) instead of being pinned for the session. */
class WeakKeyRegistry<K extends object, V> {
  private values = new WeakMap<K, V>();
  private refFor = new WeakMap<K, WeakRef<K>>();
  private refs = new Set<WeakRef<K>>();

  set(key: K, value: V): void {
    if (!this.refFor.has(key)) {
      const ref = new WeakRef(key);
      this.refFor.set(key, ref);
      this.refs.add(ref);
    }
    this.values.set(key, value);
  }

  get(key: K): V | undefined {
    return this.values.get(key);
  }

  has(key: K): boolean {
    return this.values.has(key);
  }

  delete(key: K): void {
    const ref = this.refFor.get(key);
    if (ref) this.refs.delete(ref);
    this.refFor.delete(key);
    this.values.delete(key);
  }

  /** Live entries only; dead WeakRefs are pruned as they are encountered. */
  *entries(): Generator<[K, V]> {
    for (const ref of this.refs) {
      const key = ref.deref();
      if (key === undefined || !this.values.has(key)) {
        this.refs.delete(ref);
        continue;
      }
      yield [key, this.values.get(key) as V];
    }
  }

  count(): number {
    let n = 0;
    for (const _ of this.entries()) n++;
    return n;
  }

  clear(): void {
    this.values = new WeakMap();
    this.refFor = new WeakMap();
    this.refs.clear();
  }
}

let releaseEnabled = false;
// Live profile probe injected at enable time (reads the CURRENT GFX binding,
// which initGfxTier and graphics rebuilds reassign): constrained-memory
// profiles never release, see the module header.
let constrainedProbe: (() => boolean) | null = null;
let rederive: Ktx2RederiveFn | null = null;
// Source bytes stashed at transcode time, waiting for the loader to classify
// the texture's model category (classification runs in the same promise chain
// as the GLB parse, always before any upload can fire).
const pendingSources = new WeakKeyRegistry<ReleasableCompressedTexture, ArrayBuffer>();
const entries = new WeakKeyRegistry<ReleasableCompressedTexture, ReleaseEntry>();
const inflightRestores = new Set<Promise<void>>();
const EMPTY_MIP_DATA = new Uint8Array(0);

/** Game-entry opt-in. Must run before any GLB parse resolves (src/main.ts
 *  calls it at module evaluation, ahead of every asset fetch resolution).
 *  The editor and guide entries never call it, keeping their extra renderers
 *  (asset thumbnails, wiki viewer) on resident CPU mips.
 *  `isProfileConstrained` is read LIVE at every arm and release decision, so
 *  constrained-memory profiles (see the module header) never release even if
 *  the profile resolves or rebuilds after early classifications. */
export function enableKtx2MipRelease(isProfileConstrained: () => boolean): void {
  releaseEnabled = true;
  constrainedProbe = isProfileConstrained;
}

/** True when release is opted in AND the current profile allows it. Read by
 *  ktx2_support's capture wrapper too: an inactive profile skips the source
 *  copy entirely (no transient duplicate during parse). */
export function isKtx2MipReleaseEnabled(): boolean {
  return releaseEnabled && constrainedProbe !== null && !constrainedProbe();
}

/** ktx2_support wires the real worker re-transcode here at loader creation. */
export function setKtx2MipRederive(fn: Ktx2RederiveFn): void {
  rederive = fn;
}

function isPlainCompressedTexture(tex: ReleasableCompressedTexture): boolean {
  if (tex.isCompressedTexture !== true) return false;
  if (tex.isCompressedArrayTexture === true || tex.isCompressedCubeTexture === true) return false;
  const mips = tex.mipmaps;
  if (!Array.isArray(mips) || mips.length === 0) return false;
  const first = mips[0] as Partial<Ktx2MipLevel> | undefined;
  return first?.data instanceof Uint8Array && typeof first.width === 'number';
}

/** Retain a texture's source KTX2 bytes until the loader classifies it.
 *  Non-plain results (raw DataTextures, array/cube containers) are ignored:
 *  only the 2D transcode path this module understands is ever released. */
export function stashKtx2TranscodeSource(texture: unknown, source: ArrayBuffer): void {
  const tex = texture as ReleasableCompressedTexture;
  if (!isPlainCompressedTexture(tex)) return;
  pendingSources.set(tex, source);
  tex.addEventListener('dispose', () => {
    pendingSources.delete(tex);
    entries.delete(tex);
  });
}

/** Drop a stashed source without arming release (exempt categories). Also
 *  DISARMS an entry that is still 'armed' (mips intact, nothing uploaded and
 *  released yet): the hook is unwound and the texture behaves as if it had
 *  never been classified. An entry already released stays registered: its
 *  restore capability is the only path back to real mips. */
export function dismissKtx2Source(texture: unknown): void {
  const tex = texture as ReleasableCompressedTexture;
  pendingSources.delete(tex);
  const entry = entries.get(tex);
  if (entry && entry.state === 'armed') {
    tex.onUpdate = entry.priorOnUpdate;
    entries.delete(tex);
  }
}

/** Arm post-upload mip release for one texture. No-op unless the game entry
 *  opted in and a restore source was stashed: a texture that cannot be
 *  re-derived is never released. */
export function armKtx2MipRelease(texture: unknown): void {
  const tex = texture as ReleasableCompressedTexture;
  const source = pendingSources.get(tex);
  pendingSources.delete(tex);
  if (!isKtx2MipReleaseEnabled() || !source || entries.has(tex) || !isPlainCompressedTexture(tex))
    return;
  const entry: ReleaseEntry = {
    source,
    shape: null,
    state: 'armed',
    releasedBytes: 0,
    priorOnUpdate: typeof tex.onUpdate === 'function' ? tex.onUpdate : null,
  };
  entries.set(tex, entry);
  tex.onUpdate = (t: unknown) => {
    entry.priorOnUpdate?.(t);
    releaseAfterUpload(tex, entry);
  };
}

function releaseAfterUpload(tex: ReleasableCompressedTexture, entry: ReleaseEntry): void {
  // 'restoring' uploads are stub uploads on a fresh context; 'released' cannot
  // re-fire (no needsUpdate is ever set on stubs).
  if (entry.state !== 'armed') return;
  // Re-check the profile at RELEASE time: a texture armed before the profile
  // settled (early deferred loads classify before initGfxTier, and a graphics
  // rebuild can re-resolve it) must keep resident mips on a profile that
  // turned constrained. The armed entry stays inert: today's behavior.
  if (!isKtx2MipReleaseEnabled()) return;
  const mips = tex.mipmaps;
  if (!Array.isArray(mips) || mips.length === 0) return;
  const levels = mips as Ktx2MipLevel[];
  entry.shape = levels.map((m) => ({ width: m.width, height: m.height }));
  entry.releasedBytes = levels.reduce((sum, m) => sum + (m.data?.byteLength ?? 0), 0);
  // Full-shape stubs (see the module header): identical level count and
  // dimensions keep a fresh context's texStorage2D allocation correct.
  tex.mipmaps = entry.shape.map((s) => ({
    width: s.width,
    height: s.height,
    data: EMPTY_MIP_DATA,
  }));
  // three's own upload-write gate: a stub upload allocates storage and skips
  // every sub-image write instead of issuing zero-length GL calls.
  if (tex.source) tex.source.dataReady = false;
  entry.state = 'released';
}

/** Kick the re-transcode for every released texture. Wired to the game
 *  canvas's webglcontextlost listener in src/main.ts, which fires for both
 *  in-place GPU loss and the graphics-rebuild context recycle. Idempotent:
 *  textures already restoring are left to their in-flight transcode. */
export function ktx2MipsOnContextLost(): void {
  if (!rederive) return;
  for (const [tex, entry] of entries.entries()) {
    if (entry.state === 'released') startRestore(tex, entry);
  }
}

/** Resolves when every re-transcode in flight at call time has settled
 *  (success or failure). The graphics-rebuild curtain awaits this so a reveal
 *  never shows stub-black world textures. */
export function ktx2MipsRestored(): Promise<void> {
  return Promise.allSettled([...inflightRestores]).then(() => undefined);
}

/** Source bytes currently retained for restore (stashed plus armed/released),
 *  so the residency diagnostic can report the cost side of the mip release
 *  instead of silently under-counting. The Renderer's build summary feeds
 *  this in as a pre-counted ResidencySource (residency_budget.ts stays a
 *  pure function of its sources argument). */
export function ktx2RetainedSourceBytes(): number {
  let total = 0;
  for (const [, source] of pendingSources.entries()) total += source.byteLength;
  for (const [, entry] of entries.entries()) total += entry.source.byteLength;
  return total;
}

function startRestore(tex: ReleasableCompressedTexture, entry: ReleaseEntry): void {
  if (!rederive) return;
  entry.state = 'restoring';
  // Pass a copy: the transcode transfers its input buffer to the worker
  // (detaching it in this thread), and the retained source must survive
  // repeated context losses.
  const restore = rederive(entry.source.slice(0)).then(
    (fresh) => {
      if (entries.get(tex) !== entry || entry.state !== 'restoring') return;
      if (fresh.format !== tex.format || fresh.mipmaps.length !== (entry.shape?.length ?? -1)) {
        // Dev-channel English: the transcode target changed mid-session; the
        // GPU allocation cannot be reshaped, so the texture stays on stubs.
        console.warn('[ktx2] restore transcode shape changed; texture left released');
        entry.state = 'released';
        return;
      }
      tex.mipmaps = fresh.mipmaps;
      if (tex.source) tex.source.dataReady = true;
      entry.state = 'armed';
      // Re-upload on the next render; that upload's onUpdate re-releases.
      tex.needsUpdate = true;
    },
    (err: unknown) => {
      if (entries.get(tex) !== entry) return;
      // Dev-channel English: the texture stays on stubs (black) but the
      // session survives; the next context loss retries.
      console.warn('[ktx2] restore transcode failed; texture left released', err);
      entry.state = 'released';
    },
  );
  inflightRestores.add(restore);
  void restore.finally(() => inflightRestores.delete(restore));
}

/** True when a model URL's category is drawn only by the world renderer.
 *  Matches both raw ('models/props/x.glb') and origin-resolved URLs. */
export function isKtx2MipReleasableUrl(url: string): boolean {
  const match = /(?:^|\/)models\/([^/]+)\//.exec(url);
  return match !== null && KTX2_MIP_RELEASABLE_MODEL_ROOTS.includes(match[1] ?? '');
}

// Every material map slot GLTFLoader can populate from our GLB pipeline
// (basic PBR; occlusion lands on aoMap). alphaMap is included for safety: an
// unclassified compressed texture would retain its stashed source until the
// texture itself is garbage-collected.
const CLASSIFIED_MAP_SLOTS = [
  'map',
  'normalMap',
  'emissiveMap',
  'roughnessMap',
  'metalnessMap',
  'aoMap',
  'alphaMap',
] as const;

interface GltfSceneLike {
  scene?: { traverse?: (cb: (o: unknown) => void) => void };
}

/** Classify every material texture of a parsed GLB: world-only categories arm
 *  post-upload release, everything else dismisses its stashed source. Runs in
 *  loadGltf's resolve chain, so classification always precedes first upload.
 *  Fails soft on partial GLTF shapes (test doubles), like polishGltfTextures. */
export function classifyGltfKtx2Textures(gltf: GLTF | GltfSceneLike, url: string): void {
  const scene = (gltf as GltfSceneLike).scene;
  if (typeof scene?.traverse !== 'function') return;
  const releasable = isKtx2MipReleasableUrl(url);
  const seen = new Set<unknown>();
  scene.traverse((o) => {
    const mesh = o as { isMesh?: boolean; material?: unknown };
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (!mat) continue;
      for (const slot of CLASSIFIED_MAP_SLOTS) {
        const tex = (mat as Record<string, unknown>)[slot];
        if (!tex || typeof tex !== 'object' || seen.has(tex)) continue;
        seen.add(tex);
        if (releasable) armKtx2MipRelease(tex);
        else dismissKtx2Source(tex);
      }
    }
  });
}

export const ktx2MipReleaseInternalsForTest = {
  reset(): void {
    releaseEnabled = false;
    constrainedProbe = null;
    rederive = null;
    pendingSources.clear();
    entries.clear();
    inflightRestores.clear();
  },
  isEnabled: (): boolean => releaseEnabled,
  hasRederive: (): boolean => rederive !== null,
  pendingCount: (): number => pendingSources.count(),
  entryCount: (): number => entries.count(),
  stateOf: (texture: unknown): ReleaseState | null =>
    entries.get(texture as ReleasableCompressedTexture)?.state ?? null,
  releasedBytes: (): number => {
    let total = 0;
    for (const [, e] of entries.entries()) {
      if (e.state === 'released' || e.state === 'restoring') total += e.releasedBytes;
    }
    return total;
  },
};
