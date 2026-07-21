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

/** Manifest entries a constrained device still runs; everything else is skipped. */
export const CONSTRAINED_PREWARM_KEEP: readonly string[] = [
  'views.required',
  'views.nearby',
  'programs.compile',
  'world.initial-frame',
  'render.settle-passes',
];

export interface PrewarmPolicyInput {
  /** GFX.constrainedMemory: the phone-class memory-ceiling profile is active. */
  constrainedMemory: boolean;
  /** KHR_parallel_shader_compile is available (compileAsync links off-thread). */
  asyncCompileSupported: boolean;
  /** LOW_GFX: the Lambert/no-shadow tier (its own smaller view budget already). */
  lowGfx: boolean;
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
  /** Restrict the manifest to CONSTRAINED_PREWARM_KEEP. */
  minimalManifest: boolean;
}

/**
 * Resolve every prewarm knob from the device profile. The constrained arms are the
 * watchdog + memory fix; the unconstrained arm reproduces the historical desktop
 * behavior exactly (full manifest, generous budgets, no reordering).
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
      compileBeforeFirstFrame: false,
      skipMonolithCompile: false,
      minimalManifest: false,
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
    // Without parallel compile the monolith is one giant synchronous block, so link
    // group-by-group per entry instead. With it, the async compile entry links
    // off-thread and per-entry passes only starve the manifest.
    linkPassPerEntry: !asyncCompileSupported,
    compileBeforeFirstFrame: asyncCompileSupported,
    skipMonolithCompile: !asyncCompileSupported,
    minimalManifest: true,
  };
}

/** True when this manifest entry runs under the given policy. */
export function prewarmEntryRuns(id: string, policy: PrewarmPolicy): boolean {
  if (!policy.minimalManifest) return true;
  return CONSTRAINED_PREWARM_KEEP.includes(id);
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
