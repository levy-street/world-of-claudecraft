// Pure policy for the world-entry prewarm (renderer.ts's prewarmInitialScene).
//
// The prewarm builds views + compiles shaders up front so the first in-world frames
// do not hitch. On desktop it runs a full manifest with a generous budget. On
// phone-class WebKit that same manifest is a world-entry process-kill risk two ways:
//   - main-thread occupancy trips iOS's responsiveness watchdog (RAM-independent), and
//   - a fully warmed manifest re-inflates the GPU footprint past the per-process
//     memory ceiling (skinned rig views, whole-scene textures, biome env cubemaps).
// So constrained devices run a deliberately MINIMAL prewarm: a small budget, only the
// entries needed to enter without a first-frame stall, a hard cap on how many nearby
// character views build synchronously (the rest stream in lazily per frame), shader
// linking spread group-by-group, and (with parallel compile) the compile ordered
// before the first full-scene pass so that pass draws already-linked programs.
//
// This module is the DECISION layer (Three/DOM-free, deterministic, unit-tested);
// renderer.ts is the thin consumer that runs the manifest the policy describes.

import { EASTBROOK_LAYOUT } from '../sim/eastbrook_layout';

/** Manifest entries a constrained device still runs; everything else is skipped. */
export const CONSTRAINED_PREWARM_KEEP: readonly string[] = [
  'views.required',
  'views.landmarks',
  'views.persistent-portals',
  'views.nearby',
  'world.settle-state',
  'textures.scene',
  'programs.compile',
  'world.initial-frame',
  'render.settle-passes',
];

/**
 * Entries the minimal manifest still SKIPS at entry but whose explicit resume
 * units run afterwards, in the same bounded background lane a deadline-dropped
 * entry uses. This is the constrained-device answer to warm-up work that is too
 * expensive for the entry window yet guaranteed to be needed seconds later: the
 * ability-VFX impact sheets are procedurally drawn canvases whose first use is
 * the first spell impact of that school, i.e. mid-combat.
 *
 * Membership is an opt-in per entry, never a blanket rule: everything else the
 * minimal manifest skips is skipped for GPU-footprint reasons (the phone-class
 * per-process memory ceiling) and must stay skipped. An id here is by
 * construction NOT in CONSTRAINED_PREWARM_KEEP.
 */
export const CONSTRAINED_PREWARM_RESUME: readonly string[] = ['vfx.ability-primitives'];

/** Whole-scene GPU submits that can synchronously link every visible program
 * when KHR_parallel_shader_compile is unavailable. They cannot be interrupted
 * once WebGL enters the driver, so omit them to preserve the entry hard limit.
 * world.settle-state joins them: its lazy world builds (and a woken water
 * height-field's real submits) have no internal deadline on a profile whose
 * whole point is bounded main-thread slices. The cost of skipping it is that
 * textures.scene (which still runs here) collects against pre-settle state,
 * an accepted residual misalignment: this profile also skips the compile
 * monolith and the initial frame, the two consumers the alignment mostly
 * serves. */
export const BLOCKING_PREWARM_ENTRIES_WITHOUT_PARALLEL_COMPILE: readonly string[] = [
  'world.settle-state',
  'world.initial-frame',
  'programs.compile',
  'programs.budget-variants',
  'sky.current-zone',
  'render.settle-passes',
];

export const CONSTRAINED_TEXTURE_BATCH_SIZE = 4;
export const CONSTRAINED_TEXTURE_MAX_MS = 1200;
export const CONSTRAINED_ENTRY_VIEW_RAMP_MS = 300;
export const NEARBY_LANDMARK_STREAM_RADIUS = 16;

export interface MandatoryLandmarkCandidate {
  kind: string;
  templateId: string | null;
  pos: { x: number; z: number };
}

export interface MandatoryLandmarkPartition<T> {
  /** Service landmarks actionable from the current entry position. */
  mandatory: T[];
  /** Every other candidate, including remote service landmarks. */
  ordinary: T[];
}

function authoredLandmarkInteractionRadius(templateId: string | null): number | null {
  if (templateId === EASTBROOK_LAYOUT.services.mailbox.templateId) {
    return EASTBROOK_LAYOUT.services.mailbox.interactionRadius;
  }
  if (templateId === EASTBROOK_LAYOUT.services.noticeboard.templateId) {
    return EASTBROOK_LAYOUT.services.noticeboard.interactionRadius;
  }
  return null;
}

/** Runtime-streaming fallback priority. Entry readiness uses the mandatory
 * radius-aware partition below and never relies on this ordinary queue rank. */
export function interactionLandmarkViewPriority(
  templateId: string | null,
  distanceSq: number,
): number | null {
  if (authoredLandmarkInteractionRadius(templateId) === null) return null;
  // A readable service landmark already inside the immediate town view should
  // stream before the NPC backlog after entry. Farther landmarks retain their
  // ordinary rank, so this never turns into whole-world eager instantiation.
  return distanceSq <= NEARBY_LANDMARK_STREAM_RADIUS * NEARBY_LANDMARK_STREAM_RADIUS ? 0.5 : 1.5;
}

/**
 * Separate actionable service landmarks from the ordinary entry backlog. Only the
 * authored interaction radii qualify: recognizing a template never instantiates its
 * view when the player entered elsewhere in the world.
 */
export function partitionMandatoryLandmarkCandidates<T extends MandatoryLandmarkCandidate>(
  candidates: Iterable<T>,
  origin: { x: number; z: number },
): MandatoryLandmarkPartition<T> {
  const mandatory: T[] = [];
  const ordinary: T[] = [];
  for (const candidate of candidates) {
    const radius = authoredLandmarkInteractionRadius(candidate.templateId);
    const dx = candidate.pos.x - origin.x;
    const dz = candidate.pos.z - origin.z;
    if (candidate.kind === 'object' && radius !== null && dx * dx + dz * dz <= radius * radius) {
      mandatory.push(candidate);
    } else ordinary.push(candidate);
  }
  return { mandatory, ordinary };
}

/** A landmark is entry-ready only after its real view exists and its bounded
 * async-compile gate has cleared. No-parallel-compile views begin cleared. */
export function mandatoryLandmarkViewsReady<T extends { compilePending: boolean }>(
  mandatoryIds: readonly number[],
  views: ReadonlyMap<number, T>,
): boolean {
  for (const id of mandatoryIds) {
    const view = views.get(id);
    if (!view || view.compilePending) return false;
  }
  return true;
}

export interface PrewarmPolicyInput {
  /** GFX.constrainedMemory: the phone-class memory-ceiling profile is active. */
  constrainedMemory: boolean;
  /** KHR_parallel_shader_compile is available (compileAsync links off-thread). */
  asyncCompileSupported: boolean;
  /** LOW_GFX: the Lambert/no-shadow tier (its own smaller view budget already). */
  lowGfx: boolean;
  /** Keep desktop Insane's full manifest behind the entry cover instead of resuming it live. */
  finishFullManifestBeforeReveal: boolean;
  /** Desktop defaults, injected so the constants stay owned by renderer.ts. */
  defaultMaxMs: number;
  constrainedMaxMs: number;
  defaultCompileMaxMs: number;
  constrainedCompileMaxMs: number;
  maxViewsLow: number;
  maxViewsHigh: number;
  maxViewsConstrained: number;
}

export interface PrewarmPolicy {
  /** Total prewarm wall-clock budget (ms). */
  maxMs: number;
  /** Budget for the programs.compile step (ms). */
  compileMaxMs: number;
  /** Cap on nearby character views built synchronously at entry. */
  maxViews: number;
  /** Yield the event loop (setTimeout 0) between manifest entries. */
  yieldBetweenEntries: boolean;
  /** Run a render (link) pass after each entry, group-by-group. */
  linkPassPerEntry: boolean;
  /** Move programs.compile ahead of world.initial-frame. */
  compileBeforeFirstFrame: boolean;
  /** Skip the monolithic programs.compile block entirely. */
  skipMonolithCompile: boolean;
  /** Omit uninterruptible whole-scene submits when shader linking is synchronous. */
  skipFullScenePasses: boolean;
  /** Restrict the manifest to CONSTRAINED_PREWARM_KEEP. */
  minimalManifest: boolean;
  /** Textures initialized before yielding the event loop; 0 uses the synchronous desktop path. */
  textureBatchSize: number;
  /** Maximum wall-clock time for the bounded constrained texture pass. */
  textureMaxMs: number;
  /** Ignore the soft manifest deadline so expensive work cannot spill into first live frames. */
  finishFullManifestBeforeReveal: boolean;
}

/**
 * What a manifest entry actually got done before a deadline (or a pending
 * asset prefetch) stopped it. `trimmed` is the load-bearing bit: it means the
 * entry deliberately stopped or deferred with planned work remaining, so the
 * summary must never call it completed. The counts are informational context
 * for the perf report; entries whose remaining work is unknowable (a scan cut
 * short mid-iteration) may report done without planned.
 */
export interface PrewarmEntryProgress {
  done?: number;
  planned?: number;
  trimmed: boolean;
}

/**
 * The honest status for an entry whose run() returned without throwing. A
 * deadline-trimmed or prefetch-deferred entry is 'partial', never 'completed':
 * the historical bug was entities.player-archetypes hitting its build deadline
 * having built ZERO visuals and still reporting completed, which made the boot
 * starvation invisible in every prewarm summary.
 */
export function resolvePrewarmEntryStatus(
  progress: PrewarmEntryProgress | null | undefined,
): 'completed' | 'partial' {
  return progress?.trimmed ? 'partial' : 'completed';
}

/**
 * How long the sky manifest entry may wait inline for the decoupled HDRI
 * prefetch (fetch + worker decode, started at prewarm begin) before deferring
 * the remaining uploads to the background lane. The tail entries
 * (world.initial-frame, programs.compile) are deadlineExempt on the async
 * desktop arm and start regardless; what the reserve actually buys is compile
 * RUN time before prewarmCompileUnitDeadline stops the unit loop: a slow
 * network must never starve that window the way the old inline await did
 * (measured 11.5s of a 12s boot budget).
 * finishFullManifestBeforeReveal (desktop Insane) waits without bound: that
 * profile's contract is a complete manifest behind the loading cover, and its
 * runEntry ignores the soft deadline anyway.
 */
export function skyAssetInlineWaitMs(input: {
  nowMs: number;
  deadlineMs: number;
  reserveMs: number;
  finishFullManifestBeforeReveal: boolean;
}): number {
  if (input.finishFullManifestBeforeReveal) return Number.POSITIVE_INFINITY;
  return Math.max(0, input.deadlineMs - Math.max(0, input.reserveMs) - input.nowMs);
}

export interface SkyBiomePartition<T> {
  /** Biomes whose decoded assets are already resident and can upload inline. */
  resident: T[];
  /** Biomes still in flight; their uploads join the background lane on arrival. */
  missing: T[];
}

/** Split the initial sky biomes by decoded-asset residency at entry time. */
export function partitionResidentSkyBiomes<T>(
  biomes: readonly T[],
  isResident: (biome: T) => boolean,
): SkyBiomePartition<T> {
  const resident: T[] = [];
  const missing: T[] = [];
  for (const biome of biomes) {
    if (isResident(biome)) resident.push(biome);
    else missing.push(biome);
  }
  return { resident, missing };
}

/** True when a soft-deadline manifest entry should resume after world reveal. */
export function prewarmEntryShouldDefer(
  entryStartedMs: number,
  deadlineMs: number,
  hardDeadlineMs: number,
  deadlineExempt: boolean,
  finishFullManifestBeforeReveal: boolean,
): boolean {
  if (entryStartedMs >= hardDeadlineMs) return true;
  return entryStartedMs >= deadlineMs && !deadlineExempt && !finishFullManifestBeforeReveal;
}

/** The mesh-shape bits three folds into a program's cache key, structurally
 * typed so this decision layer stays Three-free. */
export interface ProgramContentMeshShape {
  isSkinnedMesh?: boolean;
  isInstancedMesh?: boolean;
  /** An instanceColor buffer flips USE_INSTANCING_COLOR into the key. */
  hasInstanceColor?: boolean;
  isBatchedMesh?: boolean;
  /** morphAttributes.position PRESENT: three defines USE_MORPHTARGETS on
   *  presence, even for an empty array, so present-with-zero and absent are
   *  distinct variants. */
  hasMorphPositions?: boolean;
  /** The EXACT morph target count: three keys morphTargetsCount, so a
   *  boolean here hid variants (a morphs=2 and a morphs=6 mesh relinked at
   *  draw time against a morphs=4 stand-in). */
  morphTargetCount?: number;
  morphNormalCount?: number;
  morphColorCount?: number;
  /** geometry.attributes.tangent flips vertexTangents. */
  hasTangents?: boolean;
  /** geometry.attributes.color itemSize (4 flips vertexAlphas); 0 = none. */
  vertexColorItemSize?: number;
  castShadow?: boolean;
}

/**
 * Program-content keys for compile-unit dedupe: one key per material slot,
 * covering the object and geometry bits of three r165's program cache key
 * this repo can produce (skinning, instancing and instance colour, batched
 * meshes, morph position/normal/colour presence and counts, tangents, vertex
 * colour item size, shadow casting). Not covered, on purpose: BatchedMesh
 * colour textures (batchingColor) and Points uv presence (pointsUvs), which
 * the repo does not produce on this path; adopt either and this key must
 * learn it. A coarser key elects a stand-in
 * whose program variant differs, and every other geometry shape of that
 * material is SKIPPED by the dedupe and relinks synchronously at first draw,
 * which is the stall the compile lane exists to prevent. In-repo fidelity
 * precedent: occluderGhostVariantKey (occluder_ghost_prewarm.ts).
 */
export function prewarmProgramContentKeys(
  shape: ProgramContentMeshShape,
  materialIds: readonly string[],
): string[] {
  const token =
    `${shape.isSkinnedMesh ? 's' : 'm'}${shape.isInstancedMesh ? 'i' : ''}` +
    `${shape.hasInstanceColor ? 'ic' : ''}${shape.isBatchedMesh ? 'b' : ''}` +
    `${shape.hasMorphPositions ? 'P' : ''}p${shape.morphTargetCount ?? 0}` +
    `n${shape.morphNormalCount ?? 0}k${shape.morphColorCount ?? 0}` +
    `${shape.hasTangents ? 't' : ''}v${shape.vertexColorItemSize ?? 0}` +
    `${shape.castShadow ? 'c' : ''}`;
  return materialIds.map((id) => `${token}:${id}`);
}

/** Where the programs.compile unit loop must stop so world.initial-frame (the
 * one uninterruptible whole-scene submit that links whatever compile did not
 * reach) always has room before the GPU-submit guard. Without the reserve, an
 * exempt compile that lawfully consumed the whole soft budget left the frame
 * starting past the deadline, cancelled outright, and the initial scene's
 * programs linked at first LIVE draw instead (measured: 102-318 ms submit
 * stalls, 17 programs in one frame). Mirrors prewarmBuildDeadline's reserve,
 * one pipeline stage later. */
export function prewarmCompileUnitDeadline(
  gpuSubmitDeadlineMs: number,
  frameReserveMs: number,
): number {
  return gpuSubmitDeadlineMs - Math.max(0, frameReserveMs);
}

/** Build cutoff paired with the entry policy. Full Insane prewarm may use the
 * soft-deadline reserve, but it still stops at the independent hard deadline. */
export function prewarmBuildDeadline(
  deadlineMs: number,
  hardDeadlineMs: number,
  reserveMs: number,
  finishFullManifestBeforeReveal: boolean,
): number {
  return Math.min(
    hardDeadlineMs,
    finishFullManifestBeforeReveal ? hardDeadlineMs : deadlineMs - Math.max(0, reserveMs),
  );
}

/** Run temporary prewarm state under a guaranteed behavioral restore. */
export async function withRestoredPrewarmState<T, R>(
  capture: () => T,
  restore: (state: T) => void,
  work: () => R | Promise<R>,
): Promise<R> {
  const original = capture();
  try {
    return await work();
  } finally {
    restore(original);
  }
}

/**
 * Resolve every prewarm knob from the device profile. The constrained arms are the
 * watchdog + memory fix. The unconstrained arm keeps the full desktop manifest and
 * budgets, while parallel compile is moved ahead of the first whole-scene submit.
 */
export function resolvePrewarmPolicy(input: PrewarmPolicyInput): PrewarmPolicy {
  const { constrainedMemory, asyncCompileSupported, lowGfx } = input;
  const baseMaxViews = lowGfx ? input.maxViewsLow : input.maxViewsHigh;
  if (!constrainedMemory) {
    return {
      maxMs: input.defaultMaxMs,
      compileMaxMs: input.defaultCompileMaxMs,
      maxViews: baseMaxViews,
      yieldBetweenEntries: false,
      linkPassPerEntry: false,
      compileBeforeFirstFrame: asyncCompileSupported,
      skipMonolithCompile: !asyncCompileSupported,
      skipFullScenePasses: !asyncCompileSupported,
      minimalManifest: false,
      textureBatchSize: 0,
      textureMaxMs: 0,
      finishFullManifestBeforeReveal: input.finishFullManifestBeforeReveal,
    };
  }
  return {
    maxMs: input.constrainedMaxMs,
    compileMaxMs: input.constrainedCompileMaxMs,
    // Cap nearby views hard: a populated production hub would otherwise build dozens
    // of skinned rigs (each a bone-matrix DataTexture + skin uploads) synchronously
    // at entry, the spike that kills Medium on-device in production but not in an
    // empty local world. The rest stream in via the per-frame view-create budget.
    maxViews: Math.min(baseMaxViews, input.maxViewsConstrained),
    yieldBetweenEntries: true,
    // A full-scene render is itself the synchronous shader-link monolith when the
    // extension is absent. Never enter that uninterruptible driver call inside the
    // loading gate; first-sight compile gates handle later streamed views instead.
    linkPassPerEntry: false,
    compileBeforeFirstFrame: asyncCompileSupported,
    skipMonolithCompile: !asyncCompileSupported,
    skipFullScenePasses: !asyncCompileSupported,
    minimalManifest: true,
    textureBatchSize: CONSTRAINED_TEXTURE_BATCH_SIZE,
    textureMaxMs: CONSTRAINED_TEXTURE_MAX_MS,
    // Never extend the loading gate on the constrained WebKit profile: its
    // smaller manifest and hard deadline are process-survival requirements.
    finishFullManifestBeforeReveal: false,
  };
}

/**
 * Keep optional view creation out of the first live submit, then stream one
 * view per frame for a short wall-clock window covered by the loading fade. Required
 * player and target views bypass this budget in Renderer.createRequiredViews.
 */
export function constrainedEntryViewCreateBudget(
  constrainedMemory: boolean,
  runtimeElapsedMs: number,
  baseBudget: number,
): number {
  const base = Math.max(0, Math.floor(baseBudget));
  if (!constrainedMemory) return base;
  if (runtimeElapsedMs <= 0) return 0;
  if (runtimeElapsedMs <= CONSTRAINED_ENTRY_VIEW_RAMP_MS) return Math.min(1, base);
  return base;
}

/** Remaining slots in the one total entry-view budget shared by required,
 * persistent-portal, and nearby-view substeps. */
export function remainingPrewarmViewBudget(maxViews: number, createdViews: number): number {
  return Math.max(0, Math.floor(maxViews) - Math.max(0, Math.floor(createdViews)));
}

/** True when this manifest entry runs under the given policy. */
export function prewarmEntryRuns(id: string, policy: PrewarmPolicy): boolean {
  if (
    policy.skipFullScenePasses &&
    BLOCKING_PREWARM_ENTRIES_WITHOUT_PARALLEL_COMPILE.includes(id)
  ) {
    return false;
  }
  if (!policy.minimalManifest) return true;
  return CONSTRAINED_PREWARM_KEEP.includes(id);
}

/**
 * True when a minimal-manifest skip should still hand this entry's explicit
 * units to the background resume lane. Only meaningful for an entry
 * prewarmEntryRuns already rejected, so the unconstrained arm is always false.
 */
export function prewarmEntryResumesAfterSkip(id: string, policy: PrewarmPolicy): boolean {
  if (!policy.minimalManifest) return false;
  return CONSTRAINED_PREWARM_RESUME.includes(id);
}

/**
 * The manifest id order after applying the policy: when compileBeforeFirstFrame is
 * set, programs.compile moves to just before world.initial-frame so the first
 * full-scene pass draws already-linked programs instead of force-linking them in one
 * synchronous block. Otherwise the order is unchanged. Pure over ids for testing.
 */
export function orderedPrewarmIds(ids: readonly string[], policy: PrewarmPolicy): string[] {
  if (!policy.compileBeforeFirstFrame) return [...ids];
  const compileIdx = ids.indexOf('programs.compile');
  const frameIdx = ids.indexOf('world.initial-frame');
  if (frameIdx < 0 || compileIdx < 0 || compileIdx <= frameIdx) return [...ids];
  const out = [...ids];
  const [compileId] = out.splice(compileIdx, 1);
  out.splice(out.indexOf('world.initial-frame'), 0, compileId);
  return out;
}
