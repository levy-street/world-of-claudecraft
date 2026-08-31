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
// The three upload contract this module is written against
// (WebGLTextures.uploadTexture; authored on r165, every premise re-verified
// against the installed r185 source in phase 6 QA of the desktop train):
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
// ktx2MipsRestored() so that path normally never reveals stubs, bounded by
// KTX2_RESTORE_MAX_WAIT_MS so a large session-wide backlog cannot hold the
// curtain past a few seconds (any restore still in flight past the bound
// keeps running and swaps in on its own next render). The in-place GPU-loss
// path (no curtain) accepts a black window of a few seconds on the affected
// world props while the workers catch up: a designed, self-healing transient
// on an exceptional recovery path.
//
// Upload pacing: when the caller passes a BackgroundGpuQueue or queue
// supplier to ktx2MipsOnContextLost, each restore's re-upload (the mipmap
// swap-in plus needsUpdate) runs as one queued unit at
// GPU_WORK_PRIORITY.BACKGROUND instead of firing the moment its transcode
// resolves. A shared 4-worker transcode pool draining a large session-wide
// backlog (desktop hosts never evict prepared zones, see zone_eviction_core.ts)
// lands many transcodes close together; setting needsUpdate on all of them
// unpaced bunches their re-uploads into whichever live frame happens to be
// current when they settle, an unbudgeted GPU work burst on a canvas that JUST
// recovered from a context loss. Queuing spreads that cost across frames under
// the same admission budget every other GPU producer answers to (see
// "GPU work: every new producer is a client of the scheduler" in
// src/render/CLAUDE.md). No queue (the caller has none, or none is live) falls
// back to the pre-existing immediate behavior, and a queue that refuses or has
// been shut down (a renderer rebuild mid-restore) does too: this stage is a
// self-healing cosmetic transient, never worth stranding a texture on stubs
// over.
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
import { type BackgroundGpuQueue, GPU_WORK_PRIORITY } from '../background_gpu_queue';

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
type BackgroundGpuQueueSource =
  | BackgroundGpuQueue
  | (() => BackgroundGpuQueue | undefined | Promise<BackgroundGpuQueue | undefined>);

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
 *  textures already restoring are left to their in-flight transcode.
 *
 *  Started MOST-RECENTLY-ARMED FIRST, reversing the registry's session
 *  insertion order: on the graphics-rebuild path (the only path with a bound,
 *  see ktx2MipsRestored) the entries that armed most recently are the ones the
 *  player most likely still has in view, and the shared transcode pool only
 *  has capacity to land some of a large session-wide backlog before the bound
 *  fires. Kicking off oldest-first would spend that capacity on zones the
 *  player is no longer near, at the direct expense of the ones they are
 *  standing next to. Correctness does not depend on order (every entry starts
 *  its own restore), only which finish before an unrelated caller stops
 *  awaiting them.
 *
 *  `queue` can be the CURRENT renderer's background_gpu_queue, or a supplier
 *  that resolves one when a restore is ready to apply. The supplier form is
 *  load-bearing for graphics rebuilds: the context-loss event fires after the
 *  old queue shuts down and before the candidate renderer exists, so the live
 *  queue must be bound later, at apply time. Omit it (or pass none) to keep
 *  the pre-existing immediate-upload behavior. */
export function ktx2MipsOnContextLost(queue?: BackgroundGpuQueueSource): void {
  if (!rederive) return;
  const released: [ReleasableCompressedTexture, ReleaseEntry][] = [];
  for (const pair of entries.entries()) {
    if (pair[1].state === 'released') released.push(pair);
  }
  for (let i = released.length - 1; i >= 0; i--) {
    const [tex, entry] = released[i] as [ReleasableCompressedTexture, ReleaseEntry];
    startRestore(tex, entry, queue);
  }
}

/** Bound on how long the graphics-rebuild curtain (`ktx2MipsRestored`'s
 *  default) may hold for outstanding restores before revealing anyway. The
 *  `entries` registry is session-wide and weakly keyed: a long session that has
 *  visited many zones can carry a large backlog of released textures that are
 *  no longer near the player, and every graphics-preset switch's context
 *  recycle kicks off a restore for ALL of them (ktx2MipsOnContextLost), not
 *  just the ones the rebuilt scene is about to show. Without a bound this made
 *  a routine settings change hold the curtain for however long that backlog
 *  took to drain through the shared transcode worker pool. Set to the
 *  TIGHTEST of this rebuild's sibling bounds (renderer.ts's
 *  VIEW_PREWARM_MAX_MS = 3000, far_terrain.ts's FAR_VISTA_ENTRY_MAX_WAIT_MS =
 *  4000), not the loosest: this stage protects a purely cosmetic,
 *  self-healing transient (a stub-black texture that repaints itself once its
 *  restore lands), while the other two protect a horizon pop and real
 *  first-draw links, so it is the stage that can most afford to give up early.
 *  A restore still in flight past the bound keeps running and swaps in on its
 *  own next render: the same accepted transient the in-place GPU-loss path
 *  already lives with (see the module header). */
export const KTX2_RESTORE_MAX_WAIT_MS = 3000;

/** Resolves once every re-transcode in flight at call time has settled
 *  (success or failure), or after `maxWaitMs`, whichever comes first; resolves
 *  to `true` on the former, `false` on the latter (so a caller can tell
 *  whether the bound actually fired). The graphics-rebuild curtain awaits this
 *  (at the default bound) so a reveal normally shows no stub-black world
 *  textures, without risking an unbounded hold against a large session-wide
 *  backlog. `Infinity` (or any other non-finite value) waits outright, same as
 *  waitForPrefetch's Infinity arm in prewarm_resume.ts: setTimeout would
 *  otherwise coerce it to fire almost immediately, the exact opposite of what
 *  a caller spelling "no bound" means. */
export function ktx2MipsRestored(maxWaitMs: number = KTX2_RESTORE_MAX_WAIT_MS): Promise<boolean> {
  const settled = Promise.allSettled([...inflightRestores]).then(() => true as const);
  if (inflightRestores.size === 0 || !Number.isFinite(maxWaitMs)) return settled;
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      // Dev-channel English: a field recurrence of the reported hang must be
      // visible, not silently absorbed by the bound that replaced it.
      console.warn(
        `[ktx2] restore bound hit with ${inflightRestores.size} texture(s) still restoring; continuing in the background`,
      );
      resolve(false);
    }, maxWaitMs);
    void settled.then(() => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(true);
    });
  });
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

function startRestore(
  tex: ReleasableCompressedTexture,
  entry: ReleaseEntry,
  queue?: BackgroundGpuQueueSource,
): void {
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
      // Re-checked at the point of application, not just above: when queued,
      // time passes between the transcode settling and this unit actually
      // running, and the texture can be disposed or lose a race with a
      // second context loss in between.
      const applyRestore = (): void => {
        if (entries.get(tex) !== entry || entry.state !== 'restoring') return;
        tex.mipmaps = fresh.mipmaps;
        if (tex.source) tex.source.dataReady = true;
        entry.state = 'armed';
        // Re-upload on the next render; that upload's onUpdate re-releases.
        tex.needsUpdate = true;
      };
      const queueAtApply = Promise.resolve().then(() =>
        typeof queue === 'function' ? queue() : queue,
      );
      return queueAtApply.then(
        (uploadQueue) => {
          if (!uploadQueue) {
            applyRestore();
            return;
          }
          // See the module header's "Upload pacing" section: a queued unit at
          // the cosmetic BACKGROUND tier so a large backlog's re-uploads
          // spread across frames instead of bursting into whichever one they
          // settle in.
          return uploadQueue
            .run(applyRestore, GPU_WORK_PRIORITY.BACKGROUND, 'ktx2-restore:upload')
            .catch(() => {
              // The queue refused or was shut down (a renderer rebuild/teardown
              // raced this restore): apply directly rather than strand the
              // texture on stubs forever, matching the no-queue path above.
              applyRestore();
            });
        },
        () => {
          applyRestore();
        },
      );
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
