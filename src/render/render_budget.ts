import { GFX_BUCKET_BANDS, type GfxBucketBands, type GfxRuntimeBudget, type GfxTier } from './gfx';
import {
  type PostShedChain,
  postShedFloor,
  postShedStepDown,
  postShedStepUp,
} from './post_shed_core';
import {
  createTerrainDetailShedState,
  resetTerrainDetailShed,
  type TerrainDetailGfxRequest,
  type TerrainDetailShedState,
  terrainDetailShedApplies,
  updateTerrainDetailShed,
} from './terrain_detail_shed_core';

export type RenderBudgetMode = 'disabled' | 'stable' | 'degrading' | 'recovering';
export type RenderBudgetReason =
  | 'disabled'
  | 'startup'
  | 'stable'
  | 'frame'
  | 'frame-cap'
  | 'submit'
  | 'submit-stall'
  | 'draw'
  | 'grass'
  | 'recover'
  /** Everything the governor owns sits at its floor and the frame is still
   *  over budget: the terminal state on a GPU-bound machine (the fleet used
   *  to read it as a healthy 'stable'). */
  | 'floored';

export interface RenderBudgetLevels {
  grass: number;
  foliage: number;
  vfx: number;
  lighting: number;
  resolution: number;
  /** Terrain-detail shed (terrain_detail_shed_core.ts): 1 = the tier's own
   *  terrainRelief/surfaceDetailTaps/surfaceDetailClampK request, 0 = high's
   *  own profile, the floor every tier already ships. Dwell-hysteresis
   *  timed rather than instant-stepped like the buckets above (see
   *  RenderBudgetGovernor.update): a chunk-edge relief pop is far more
   *  visible than one frame of a lighter grass carpet. */
  detail: number;
  /** Post-processing shed (post_shed_core.ts): 1 = the tier's full chain,
   *  each 0.25 step applies one more rung (SMAA to the fused FXAA grade,
   *  bloom tail mips, bloom off, AO passthrough). Stepped by the same
   *  degrade/recover machinery and cooldowns as the buckets above; floored
   *  at the deepest rung the session's chain carries. */
  post: number;
}

export interface RenderBudgetCaps {
  targetCalls: number;
  urgentCalls: number;
  targetTriangles: number;
  urgentTriangles: number;
  targetGrassTufts: number;
  urgentGrassTufts: number;
  minGrassLevel: number;
  minFoliageLevel: number;
  minVfxLevel: number;
  minLightingLevel: number;
}

/** Where the external-frame-cap probe stands (see RenderBudgetGovernor.update):
 *  'idle' (no probe, no verdict), the three phases of a probe in flight, or
 *  'refused' (the last probe showed that shedding moves the cadence). Rides
 *  the perf beacon's rendererBudget block so a floored fleet row can be told
 *  from a probe caught mid-flight. */
export type RenderBudgetFrameCapProbe = 'idle' | 'shed' | 'floor' | 'restored' | 'refused';

export interface RenderBudgetState {
  enabled: boolean;
  mode: RenderBudgetMode;
  reason: RenderBudgetReason;
  pressure: number;
  frameMsEma: number;
  submitMsEma: number;
  externalFrameCap: boolean;
  frameCapProbe?: RenderBudgetFrameCapProbe;
  stallPressure: number;
  recentSubmitStalls: number;
  lastSubmitStallMs: number;
  stallHoldSeconds: number;
  stableSeconds: number;
  cooldownSeconds: number;
  levels: RenderBudgetLevels;
  caps: RenderBudgetCaps;
}

export interface RenderBudgetSample {
  dt: number;
  frameMs: number;
  totalMs: number;
  submitMs: number;
  calls: number;
  triangles: number;
  grassVisibleTufts: number;
  grassVisibleChunks: number;
  activeViews: number;
  createdViews: number;
  minRenderScale: number;
  maxRenderScale: number;
}

export interface RenderBudgetGovernorOptions {
  tier: GfxTier;
  budget: GfxRuntimeBudget;
  enabled: boolean;
  /** The session's own static terrain-detail request (the three `GFX` knobs,
   *  snapshotted here): the shed is admitted when it sits above the floor
   *  (an Advanced session on tier high may dial relief 3 and 4 taps) or when
   *  the tier's `detail` band is governable. Absent, the band alone decides. */
  terrainDetail?: Readonly<TerrainDetailGfxRequest>;
  /** The `?terraindetail=<0..1>` dev pin (render_dev_flags.ts): skips the
   *  terrain-detail shed's hysteresis and holds the level exactly here, with
   *  or without an enabled governor. */
  pinnedDetailLevel?: number | null;
  /** Which sheddable post passes the session built (`PostPipeline.shedChain`,
   *  the plan's own static answer, so `?smaa=off`, `?n8ao=off` and the
   *  grade-only mixes agree with the painter): the level ladders over
   *  exactly the rungs that change this chain, floored beside the tier band.
   *  Absent or `null` (no composer, the `?postshed=off` kill switch), the
   *  level holds 1. The renderer builds the composer after the governor, so
   *  it hands the chain over through `setPostShedChain`. */
  postShed?: Readonly<PostShedChain> | null;
  /** The `?postshed=<0..1>` dev pin (render_dev_flags.ts): holds the `post`
   *  level exactly here, with or without an enabled governor, and keeps the
   *  ladder's own steps off it. */
  pinnedPostLevel?: number | null;
}

interface ExternalFrameCapProbe {
  /** shed: the ladder is being spent (degrade with every rung eligible);
   *  floor: dwelling at the floors; restored: dwelling at the levels the
   *  probe started from. */
  phase: 'shed' | 'floor' | 'restored';
  settleS: number;
  emaFloor: number;
  /** Whether the shed phase moved any rung: a probe that found the session
   *  already at the floors has no low/high pair of its own and tries the
   *  band baselines as its high state instead of the origin. */
  shedMoved: boolean;
}

const CAPS_BY_TIER: Record<GfxTier, RenderBudgetCaps> = {
  // Low must stay monotonically lighter than medium on every axis: it used to carry
  // LOOSER caps and HIGHER quality floors than medium, so a player who dropped from
  // medium to low got a heavier frame. Targets/urgents are medium x 0.9 rounded to
  // clean values, and the four floors mirror low's band minima in GFX_BUCKET_BANDS
  // (which now equal medium's), so low can always shed at least as far as medium.
  low: {
    targetCalls: 380,
    urgentCalls: 560,
    targetTriangles: 1_600_000,
    urgentTriangles: 2_350_000,
    targetGrassTufts: 3_400,
    urgentGrassTufts: 4_900,
    minGrassLevel: 0.5,
    minFoliageLevel: 0.5,
    minVfxLevel: 0.58,
    minLightingLevel: 0.45,
  },
  medium: {
    targetCalls: 420,
    urgentCalls: 620,
    targetTriangles: 1_800_000,
    urgentTriangles: 2_600_000,
    targetGrassTufts: 3_800,
    urgentGrassTufts: 5_500,
    minGrassLevel: 0.5,
    minFoliageLevel: 0.5,
    minVfxLevel: 0.58,
    minLightingLevel: 0.45,
  },
  high: {
    targetCalls: 620,
    urgentCalls: 860,
    targetTriangles: 4_500_000,
    urgentTriangles: 6_500_000,
    targetGrassTufts: 6_000,
    urgentGrassTufts: 8_500,
    minGrassLevel: 0.6,
    minFoliageLevel: 0.6,
    minVfxLevel: 0.68,
    minLightingLevel: 0.62,
  },
  ultra: {
    targetCalls: 820,
    urgentCalls: 1_100,
    targetTriangles: 6_500_000,
    urgentTriangles: 9_000_000,
    targetGrassTufts: 8_000,
    urgentGrassTufts: 11_000,
    minGrassLevel: 0.78,
    minFoliageLevel: 0.78,
    minVfxLevel: 0.86,
    minLightingLevel: 0.78,
  },
  // Insane: the everything-on showcase preset. Slightly looser caps than
  // ultra (it deliberately draws more), same quality floors: the governor may
  // still shed density in a genuine disaster but never below ultra's floor.
  insane: {
    targetCalls: 900,
    urgentCalls: 1_200,
    targetTriangles: 7_500_000,
    urgentTriangles: 10_000_000,
    targetGrassTufts: 8_000,
    urgentGrassTufts: 11_000,
    minGrassLevel: 0.78,
    minFoliageLevel: 0.78,
    minVfxLevel: 0.86,
    minLightingLevel: 0.78,
  },
};

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function positiveRatio(value: number, target: number): number {
  if (!Number.isFinite(value) || value <= 0 || target <= 0) return 0;
  return value / target;
}

function copyLevels(levels: RenderBudgetLevels): RenderBudgetLevels {
  return {
    grass: round2(levels.grass),
    foliage: round2(levels.foliage),
    vfx: round2(levels.vfx),
    lighting: round2(levels.lighting),
    resolution: round2(levels.resolution),
    detail: round2(levels.detail),
    post: round2(levels.post),
  };
}

function copyCaps(caps: RenderBudgetCaps): RenderBudgetCaps {
  return { ...caps };
}

const URGENT_FOLIAGE_STEP = 0.14;
const URGENT_GRASS_STEP = 0.14;
const URGENT_LIGHTING_STEP = 0.12;
const URGENT_VFX_STEP = 0.08;

/** Non-resolution states visited by repeated urgent degradation.
 * applyPointLightBudget already pins a counted light at its visible ancestry root, so
 * hidden descendants cannot drift the live program's drawn-light count. Renderer
 * prewarm still walks this urgent ladder as defense in depth for legitimate budget
 * transitions behind the loading cover. It omits the normal-pressure ladder's smaller
 * steps; grass, foliage and VFX levels do not select shader programs themselves. */
export function renderBudgetShaderPrewarmLevels(
  state: Pick<RenderBudgetState, 'levels' | 'caps'>,
): RenderBudgetLevels[] {
  let current = copyLevels(state.levels);
  const sequence: RenderBudgetLevels[] = [];
  for (let i = 0; i < 16; i++) {
    const next: RenderBudgetLevels = {
      grass: Math.max(state.caps.minGrassLevel, round2(current.grass - URGENT_GRASS_STEP)),
      foliage: Math.max(state.caps.minFoliageLevel, round2(current.foliage - URGENT_FOLIAGE_STEP)),
      vfx: Math.max(state.caps.minVfxLevel, round2(current.vfx - URGENT_VFX_STEP)),
      lighting: Math.max(
        state.caps.minLightingLevel,
        round2(current.lighting - URGENT_LIGHTING_STEP),
      ),
      resolution: current.resolution,
      // Live uniforms, not a define: the terrain-detail shed never selects a
      // shader program, and the post shed's one extra program (the FXAA grade
      // twin) compiles under the presentation prewarm. The scene-program walk
      // leaves both levels untouched, same as resolution above.
      detail: current.detail,
      post: current.post,
    };
    if (
      next.grass === current.grass &&
      next.foliage === current.foliage &&
      next.vfx === current.vfx &&
      next.lighting === current.lighting
    )
      break;
    sequence.push(next);
    current = next;
  }
  return sequence;
}
const SUBMIT_STALL_MS = 120;
const SUBMIT_STALL_URGENT_MS = 250;
const SUBMIT_STALL_HOLD_SECONDS: Record<GfxTier, number> = {
  low: 18,
  medium: 14,
  high: 8,
  ultra: 6,
  insane: 6,
};
const SUBMIT_STALL_URGENT_HOLD_SECONDS: Record<GfxTier, number> = {
  low: 30,
  medium: 24,
  high: 14,
  ultra: 12,
  insane: 12,
};
const SUBMIT_STALL_RECOVERY_CEILING_MS = 42;
const EXTERNAL_FRAME_CAP_MIN_MS = 28;
const EXTERNAL_FRAME_CAP_MAX_MS = 48;
/** Consecutive frames the cap candidate may fail before a latched cap or a
 *  running probe is dropped: one hitch frame (a view build, a GPU spike) is
 *  not a cadence change. */
const EXTERNAL_FRAME_CAP_LAPSE_FRAMES = 3;
/** Dwell at each end of the cap probe (floors, then the restored levels)
 *  before its cadence is read: the frame EMA (alpha 0.08) is within a few
 *  percent of a steady input after two seconds at 24 fps. */
const EXTERNAL_FRAME_CAP_PROBE_SETTLE_S = 2;
/** The restored cadence must exceed the floored cadence by this share for
 *  the probe to conclude that shedding does move the frame. Under vsync one
 *  step change in the pattern (a 33 / 50 mix losing its 50s) is far larger. */
const EXTERNAL_FRAME_CAP_PROBE_HELPED = 0.1;
/** A refusal younger than this survives an upward lapse: walking into a
 *  heavier zone on a GPU-bound machine must not buy a fresh probe (and its
 *  restored-baseline dwell) every time, so at most one probe per minute. */
const EXTERNAL_FRAME_CAP_REFUSAL_HOLD_S = 60;

export class RenderBudgetGovernor {
  private readonly tier: GfxTier;
  private readonly budget: GfxRuntimeBudget;
  private readonly enabled: boolean;
  private readonly caps: RenderBudgetCaps;
  private readonly bands: GfxBucketBands;
  private mode: RenderBudgetMode;
  private reason: RenderBudgetReason;
  private pressure = 0;
  private frameMsEma = 16.7;
  private submitMsEma = 0;
  private externalFrameCap = false;
  /** Consecutive frames the cap candidate has failed (see update()). */
  private capMissFrames = 0;
  /** The cap probe in flight, if any (see update()). */
  private capProbe: ExternalFrameCapProbe | null = null;
  /** The levels the probe episode started from, restored after the floor
   *  dwell. Held outside the probe so a probe interrupted by a lapse (a
   *  multi-frame hitch) and resumed from the floors still restores what the
   *  session had before, never the floors; dropped once a verdict is in or
   *  the ordinary ladder or recovery reshapes the levels. */
  private capProbeOrigin: RenderBudgetLevels | null = null;
  /** A probe concluded that shedding moves the cadence: no cap. Sticky
   *  until the candidate lapses upward (the workload changed) after the
   *  hold below, so the floored session is not re-probed forever. */
  private capRefused = false;
  private capRefusedAgeS = 0;
  /** True from an over-budget degrade() attempt in which every eligible rung
   *  already sat at its floor, until the next level change in either
   *  direction: the ladder has nothing left to shed under the current
   *  pressure (a mild frame band that engages no rung clears it). Backs the
   *  'floored' reason. */
  private ladderExhausted = false;
  private stallPressure = 0;
  private recentSubmitStalls = 0;
  private lastSubmitStallMs = 0;
  private stallHoldSeconds = 0;
  private stableSeconds = 0;
  private cooldownSeconds = 0;
  private levels: RenderBudgetLevels = {
    grass: 1,
    foliage: 1,
    vfx: 1,
    lighting: 1,
    resolution: 1,
    detail: 1,
    post: 1,
  };
  private readonly detailShed: TerrainDetailShedState = createTerrainDetailShedState();
  private readonly detailShedApplies: boolean;
  private readonly pinnedDetailLevel: number | null;
  private postShedChain: Readonly<PostShedChain> | null;
  private readonly pinnedPostLevel: number | null;

  constructor(options: RenderBudgetGovernorOptions) {
    this.tier = options.tier;
    this.budget = options.budget;
    this.enabled = options.enabled;
    this.caps = CAPS_BY_TIER[options.tier];
    this.bands = GFX_BUCKET_BANDS[options.tier];
    this.detailShedApplies =
      this.bands.detail.governable ||
      (options.terrainDetail !== undefined && terrainDetailShedApplies(options.terrainDetail));
    this.pinnedDetailLevel = options.pinnedDetailLevel ?? null;
    this.postShedChain = this.governablePostShedChain(options.postShed ?? null);
    this.pinnedPostLevel = options.pinnedPostLevel ?? null;
    this.mode = options.enabled ? 'stable' : 'disabled';
    this.reason = options.enabled ? 'startup' : 'disabled';
  }

  /** The composer is built after the governor: hand it the chain the
   *  pipeline actually built. A chain the tier band does not admit (the
   *  grade-only tiers) or that carries no sheddable pass holds the level at 1. */
  setPostShedChain(chain: Readonly<PostShedChain> | null): void {
    this.postShedChain = this.governablePostShedChain(chain);
  }

  private governablePostShedChain(
    chain: Readonly<PostShedChain> | null,
  ): Readonly<PostShedChain> | null {
    if (!chain || !this.bands.post.governable) return null;
    return postShedFloor(chain) < this.bands.post.min ? null : chain;
  }

  reset(renderScale: number, minRenderScale: number, maxRenderScale: number): RenderBudgetState {
    const scale = Math.min(Math.max(renderScale, minRenderScale), maxRenderScale);
    this.levels = this.enabled
      ? {
          grass: this.bands.grass.baseline,
          foliage: this.bands.foliage.baseline,
          vfx: this.bands.vfx.baseline,
          lighting: this.bands.lighting.baseline,
          resolution: round2(scale),
          detail: this.bands.detail.baseline,
          post: this.bands.post.baseline,
        }
      : {
          grass: 1,
          foliage: 1,
          vfx: 1,
          lighting: 1,
          resolution: round2(scale),
          detail: 1,
          post: 1,
        };
    resetTerrainDetailShed(this.detailShed);
    this.updateDetailShed(0, 0);
    // The dev pin is the one write that ignores the ladder; both ladder arms
    // are gated on it, so asserting it here holds it for the session.
    if (this.pinnedDetailLevel != null) {
      this.detailShed.level = this.pinnedDetailLevel;
      this.detailShed.target = this.pinnedDetailLevel;
      this.levels.detail = this.pinnedDetailLevel;
    }
    if (this.pinnedPostLevel != null) this.levels.post = this.pinnedPostLevel;
    this.frameMsEma = 16.7;
    this.submitMsEma = 0;
    this.externalFrameCap = false;
    this.capMissFrames = 0;
    this.capProbe = null;
    this.capProbeOrigin = null;
    this.capRefused = false;
    this.capRefusedAgeS = 0;
    this.ladderExhausted = false;
    this.stallPressure = 0;
    this.recentSubmitStalls = 0;
    this.lastSubmitStallMs = 0;
    this.stallHoldSeconds = 0;
    this.stableSeconds = 0;
    this.cooldownSeconds = this.enabled ? 0.5 : 0;
    this.pressure = 0;
    this.mode = this.enabled ? 'stable' : 'disabled';
    this.reason = this.enabled ? 'startup' : 'disabled';
    return this.state();
  }

  state(out?: RenderBudgetState): RenderBudgetState {
    const state =
      out ??
      ({
        enabled: this.enabled,
        mode: this.mode,
        reason: this.reason,
        pressure: 0,
        frameMsEma: 0,
        submitMsEma: 0,
        externalFrameCap: false,
        stallPressure: 0,
        recentSubmitStalls: 0,
        lastSubmitStallMs: 0,
        stallHoldSeconds: 0,
        stableSeconds: 0,
        cooldownSeconds: 0,
        levels: copyLevels(this.levels),
        caps: copyCaps(this.caps),
      } satisfies RenderBudgetState);
    state.enabled = this.enabled;
    state.mode = this.mode;
    state.reason = this.reason;
    state.pressure = round2(this.pressure);
    state.frameMsEma = round2(this.frameMsEma);
    state.submitMsEma = round2(this.submitMsEma);
    state.externalFrameCap = this.externalFrameCap;
    state.frameCapProbe = this.capProbe
      ? this.capProbe.phase
      : this.capRefused
        ? 'refused'
        : 'idle';
    state.stallPressure = round2(this.stallPressure);
    state.recentSubmitStalls = round2(this.recentSubmitStalls);
    state.lastSubmitStallMs = round2(this.lastSubmitStallMs);
    state.stallHoldSeconds = round2(this.stallHoldSeconds);
    state.stableSeconds = round2(this.stableSeconds);
    state.cooldownSeconds = round2(this.cooldownSeconds);
    state.levels.grass = round2(this.levels.grass);
    state.levels.foliage = round2(this.levels.foliage);
    state.levels.vfx = round2(this.levels.vfx);
    state.levels.lighting = round2(this.levels.lighting);
    state.levels.resolution = round2(this.levels.resolution);
    state.levels.detail = round2(this.levels.detail);
    state.levels.post = round2(this.levels.post);
    state.caps.targetCalls = this.caps.targetCalls;
    state.caps.urgentCalls = this.caps.urgentCalls;
    state.caps.targetTriangles = this.caps.targetTriangles;
    state.caps.urgentTriangles = this.caps.urgentTriangles;
    state.caps.targetGrassTufts = this.caps.targetGrassTufts;
    state.caps.urgentGrassTufts = this.caps.urgentGrassTufts;
    state.caps.minGrassLevel = this.caps.minGrassLevel;
    state.caps.minFoliageLevel = this.caps.minFoliageLevel;
    state.caps.minVfxLevel = this.caps.minVfxLevel;
    state.caps.minLightingLevel = this.caps.minLightingLevel;
    return state;
  }

  update(sample: RenderBudgetSample, out?: RenderBudgetState): RenderBudgetState {
    if (!Number.isFinite(sample.dt) || sample.dt <= 0) return this.state(out);
    const frameMs = Math.min(250, Math.max(0, sample.frameMs));
    const totalMs = Math.min(250, Math.max(0, sample.totalMs));
    const rawSubmitMs = Math.max(0, sample.submitMs);
    const submitMs = Math.min(250, rawSubmitMs);
    const frameCost = Math.max(frameMs, totalMs);
    this.frameMsEma += (frameCost - this.frameMsEma) * 0.08;
    this.submitMsEma += (submitMs - this.submitMsEma) * 0.12;
    this.stallPressure = Math.max(
      this.stallPressure * Math.exp(-sample.dt / 12),
      positiveRatio(rawSubmitMs, SUBMIT_STALL_MS),
    );

    if (!this.enabled) {
      this.mode = 'disabled';
      this.reason = 'disabled';
      this.pressure = 0;
      this.externalFrameCap = false;
      this.capProbe = null;
      this.updateDetailShed(sample.dt, 0);
      return this.state(out);
    }

    const minRenderScale = Math.min(sample.maxRenderScale, Math.max(0.5, sample.minRenderScale));
    const maxRenderScale = Math.max(minRenderScale, Math.min(1, sample.maxRenderScale));
    this.levels.resolution = Math.min(
      maxRenderScale,
      Math.max(minRenderScale, this.levels.resolution),
    );

    if (this.capRefused) this.capRefusedAgeS += sample.dt;
    if (this.cooldownSeconds > 0) {
      this.cooldownSeconds = Math.max(0, this.cooldownSeconds - sample.dt);
    }
    if (this.stallHoldSeconds > 0) {
      this.stallHoldSeconds = Math.max(0, this.stallHoldSeconds - sample.dt);
    }

    const rawFramePressure = Math.max(
      positiveRatio(this.frameMsEma, this.budget.dropFrameMs),
      positiveRatio(totalMs, this.budget.dropFrameMs),
    );
    const submitPressure = Math.max(
      positiveRatio(this.submitMsEma, Math.max(8, this.budget.dropFrameMs * 0.58)),
      positiveRatio(submitMs, Math.max(8, this.budget.dropFrameMs * 0.58)),
    );
    const drawPressure = Math.max(
      positiveRatio(sample.calls, this.caps.targetCalls),
      positiveRatio(sample.triangles, this.caps.targetTriangles),
    );
    const grassPressure = positiveRatio(sample.grassVisibleTufts, this.caps.targetGrassTufts);
    const cadenceMs = Math.max(frameMs, this.frameMsEma);
    const renderWorkHasHeadroom =
      totalMs <= this.budget.recoverFrameMs &&
      submitMs <= Math.max(8, this.budget.recoverFrameMs * 0.7) &&
      this.submitMsEma <= Math.max(8, this.budget.dropFrameMs * 0.58) &&
      rawSubmitMs <= SUBMIT_STALL_RECOVERY_CEILING_MS &&
      this.stallPressure < 0.5 &&
      drawPressure < 1 &&
      grassPressure < 1;
    // Every reading here is CPU-side, so a GPU-bound frame stepping at 33 ms
    // under vsync with an idle main thread is indistinguishable from a 30 Hz
    // display cap. The candidate alone therefore never asserts the cap: it
    // opens a PROBE (advanceCapProbe) that sheds every rung the governor
    // owns, dwells at the floors, restores the levels it started from and
    // dwells again, and reads the cadence at both ends. A cadence that did
    // not move is the cap, latched here and behaving as before (frame
    // pressure suppressed, recovery on measured headroom); a cadence that
    // shedding does move is a GPU-bound frame, refused as a cap and shed
    // again under the normal rules. A latched cap, a probe or a refusal
    // lapses once the candidate has failed for a few consecutive frames.
    const externalFrameCapCandidate =
      rawFramePressure >= 1 &&
      cadenceMs >= EXTERNAL_FRAME_CAP_MIN_MS &&
      cadenceMs <= EXTERNAL_FRAME_CAP_MAX_MS &&
      renderWorkHasHeadroom;
    this.capMissFrames = externalFrameCapCandidate ? 0 : this.capMissFrames + 1;
    if (this.capMissFrames >= EXTERNAL_FRAME_CAP_LAPSE_FRAMES) {
      // A lapse DOWNWARD (the frame fell under budget or under the window)
      // during a probe is the probe's answer: shedding moved the cadence, no
      // cap. Only a lapse upward or a lost CPU headroom (the workload changed)
      // clears a refusal; a downward one never does, or a session whose
      // floors run fast would climb, flip back into the window, and be shed
      // to the floors again on every cycle.
      const downward = rawFramePressure < 1 || cadenceMs < EXTERNAL_FRAME_CAP_MIN_MS;
      if (this.capProbe && downward) {
        this.capRefused = true;
        this.capRefusedAgeS = 0;
        this.capProbeOrigin = null;
      } else if (!downward && this.capRefusedAgeS >= EXTERNAL_FRAME_CAP_REFUSAL_HOLD_S) {
        this.capRefused = false;
      }
      this.externalFrameCap = false;
      this.capProbe = null;
    }
    if (
      externalFrameCapCandidate &&
      this.capRefused &&
      this.capRefusedAgeS >= EXTERNAL_FRAME_CAP_REFUSAL_HOLD_S
    ) {
      this.capRefused = false;
    }
    if (
      externalFrameCapCandidate &&
      !this.externalFrameCap &&
      !this.capRefused &&
      this.capProbe === null
    ) {
      this.capProbe = { phase: 'shed', settleS: 0, emaFloor: 0, shedMoved: false };
      if (this.capProbeOrigin === null) this.capProbeOrigin = copyLevels(this.levels);
    }
    const framePressure = this.externalFrameCap ? 0 : rawFramePressure;
    this.pressure = Math.max(
      framePressure,
      submitPressure,
      drawPressure,
      grassPressure,
      this.stallPressure,
    );

    // Terrain-detail shed: dwell-hysteresis timed (shadow_cadence_core.ts's
    // shape, not the instant per-frame steps below), so it runs independently
    // of the degrade/recover branches and answers only to THIS frame's
    // pressure reading.
    this.updateDetailShed(sample.dt, this.pressure);

    const submitStall = rawSubmitMs >= SUBMIT_STALL_MS;
    if (submitStall) {
      this.recentSubmitStalls = Math.min(99, this.recentSubmitStalls + 1);
      this.lastSubmitStallMs = rawSubmitMs;
      this.stallHoldSeconds = Math.max(
        this.stallHoldSeconds,
        rawSubmitMs >= SUBMIT_STALL_URGENT_MS
          ? SUBMIT_STALL_URGENT_HOLD_SECONDS[this.tier]
          : SUBMIT_STALL_HOLD_SECONDS[this.tier],
      );
    } else if (this.stallHoldSeconds <= 0 && this.recentSubmitStalls > 0) {
      this.recentSubmitStalls = Math.max(0, this.recentSubmitStalls - sample.dt / 12);
    }

    const urgent =
      submitStall ||
      (!this.externalFrameCap && frameMs >= this.budget.urgentFrameMs) ||
      totalMs >= this.budget.urgentFrameMs ||
      submitMs >= Math.max(12, this.budget.urgentFrameMs * 0.58) ||
      sample.calls >= this.caps.urgentCalls ||
      sample.triangles >= this.caps.urgentTriangles ||
      sample.grassVisibleTufts >= this.caps.urgentGrassTufts;
    const overBudget =
      this.pressure >= 1 ||
      (!this.externalFrameCap && this.frameMsEma >= this.budget.dropFrameMs) ||
      totalMs >= this.budget.dropFrameMs ||
      submitMs >= Math.max(8, this.budget.dropFrameMs * 0.58);

    // The probe's two dwells hold the ladder still (the restored levels
    // would be shed on the spot otherwise); a real submit stall still wins.
    const probeDwell = this.advanceCapProbe(sample.dt, minRenderScale, maxRenderScale);
    if (
      (submitStall || overBudget) &&
      (submitStall || this.cooldownSeconds <= 0) &&
      (submitStall || !probeDwell)
    ) {
      const probing = this.capProbe?.phase === 'shed';
      const step = this.degrade(
        urgent,
        minRenderScale,
        {
          frame: framePressure,
          submit: submitStall ? Math.max(submitPressure, this.stallPressure) : submitPressure,
          draw: drawPressure,
          grass: grassPressure,
        },
        probing,
      );
      this.ladderExhausted = step === 'exhausted';
      if (step === 'exhausted' && probing && this.capProbe) {
        // The probe's dwells are not the terminal state: no 'floored' there.
        this.ladderExhausted = false;
        this.capProbe.phase = 'floor';
        this.capProbe.settleS = 0;
      }
      if (step === 'changed') {
        if (probing && this.capProbe) this.capProbe.shedMoved = true;
        else this.capProbeOrigin = null;
        this.stableSeconds = 0;
        this.mode = 'degrading';
        this.reason = submitStall
          ? 'submit-stall'
          : sample.grassVisibleTufts >= this.caps.targetGrassTufts
            ? 'grass'
            : submitPressure >= framePressure && submitPressure >= drawPressure
              ? 'submit'
              : drawPressure >= framePressure
                ? 'draw'
                : 'frame';
        this.cooldownSeconds = submitStall
          ? Math.max(
              this.cooldownSeconds,
              this.budget.cooldownSeconds * (rawSubmitMs >= SUBMIT_STALL_URGENT_MS ? 4 : 2.5),
            )
          : urgent || probing
            ? this.budget.cooldownSeconds * 0.55
            : this.budget.cooldownSeconds;
        return this.state(out);
      }
    }

    if (this.stallHoldSeconds > 0) {
      this.stableSeconds = 0;
      this.mode = 'degrading';
      this.reason = 'submit-stall';
      return this.state(out);
    }

    // Measured headroom, the gate on ALL recovery: every clause is a real cost
    // reading, never inferred from wall cadence.
    const canRecover =
      (this.externalFrameCap || this.frameMsEma <= this.budget.recoverFrameMs) &&
      totalMs <= this.budget.recoverFrameMs &&
      submitMs <= Math.max(8, this.budget.recoverFrameMs * 0.7) &&
      rawSubmitMs <= SUBMIT_STALL_RECOVERY_CEILING_MS &&
      this.stallPressure < 0.5;
    // Scene-density headroom, the gate on the climb ABOVE baseline only. Raising a
    // bucket past its baseline widens the drawn ring and grows these very counters,
    // so gating the return TO baseline on them lets the ladder close its own gate
    // and strand the buckets it has not restored yet (resolution recovers last).
    // Deliberate: dense frames no longer reset stableSeconds, so one frame under
    // the line at a fire slot permits one enrich step. The rate bound is the
    // stableSeconds reset on each fired step plus the recoverStableSeconds
    // recharge (the 1.5x cooldown is shorter on every tier and never binds);
    // the at-slot re-check only picks WHICH frame may fire, so repeated dips
    // can walk quality to the band maxima at one step per recharge window.
    // Only degrade() ever lowers quality.
    const canEnrich =
      sample.calls <= this.caps.targetCalls * 0.9 &&
      sample.triangles <= this.caps.targetTriangles * 0.9 &&
      sample.grassVisibleTufts <= this.caps.targetGrassTufts * 0.9;

    if (canRecover) {
      this.stableSeconds += sample.dt;
      if (this.stableSeconds >= this.budget.recoverStableSeconds && this.cooldownSeconds <= 0) {
        const changed = this.recover(maxRenderScale, canEnrich);
        if (changed) {
          this.ladderExhausted = false;
          this.capProbe = null;
          this.capProbeOrigin = null;
          this.mode = 'recovering';
          this.reason = 'recover';
          this.stableSeconds = 0;
          this.cooldownSeconds = this.budget.cooldownSeconds * 1.5;
          return this.state(out);
        }
      }
    } else {
      this.stableSeconds = 0;
    }

    this.mode = 'stable';
    this.reason = this.externalFrameCap
      ? 'frame-cap'
      : overBudget && this.ladderExhausted
        ? 'floored'
        : 'stable';
    return this.state(out);
  }

  /** Advances the cap probe's two dwells. Returns true while a dwell holds
   *  the ladder still. The 'shed' phase is driven by degrade() itself. At
   *  the end of the floor dwell the levels the probe started from come back
   *  at once (a probe that proves a cap must not cost a capped display a
   *  minute of climbing); at the end of the restored dwell the two cadences
   *  decide: moved means shedding works (no cap, refused until the candidate
   *  lapses, the normal rules shed again), unmoved means the cap. */
  private advanceCapProbe(dt: number, minRenderScale: number, maxRenderScale: number): boolean {
    const probe = this.capProbe;
    if (!probe || probe.phase === 'shed') return false;
    probe.settleS += dt;
    if (probe.settleS < EXTERNAL_FRAME_CAP_PROBE_SETTLE_S) return true;
    if (probe.phase === 'floor') {
      probe.emaFloor = this.frameMsEma;
      probe.phase = 'restored';
      probe.settleS = 0;
      // A probe that shed nothing (the session was already at the floors,
      // after a real disaster or an interrupted probe) still needs a high
      // state to compare against: the band baselines, the levels a capped
      // session would hold.
      const high: RenderBudgetLevels =
        this.capProbeOrigin && probe.shedMoved
          ? this.capProbeOrigin
          : {
              grass: this.bands.grass.baseline,
              foliage: this.bands.foliage.baseline,
              vfx: this.bands.vfx.baseline,
              lighting: this.bands.lighting.baseline,
              resolution: maxRenderScale,
              detail: this.bands.detail.baseline,
              post: this.bands.post.baseline,
            };
      this.levels.grass = high.grass;
      this.levels.foliage = high.foliage;
      this.levels.vfx = high.vfx;
      this.levels.lighting = high.lighting;
      this.levels.resolution = Math.min(maxRenderScale, Math.max(minRenderScale, high.resolution));
      this.restoreDetailAfterCapProbe(high.detail);
      if (this.pinnedPostLevel == null) this.levels.post = high.post;
      return true;
    }
    const helped = this.frameMsEma > probe.emaFloor * (1 + EXTERNAL_FRAME_CAP_PROBE_HELPED);
    this.capProbe = null;
    this.capProbeOrigin = null;
    if (helped) {
      this.capRefused = true;
      this.capRefusedAgeS = 0;
      return false;
    }
    // The latch frame's pressures were read before the verdict: hold the
    // ladder once more so the restored levels are not shed on the spot.
    this.externalFrameCap = true;
    return true;
  }

  private restoreDetailAfterCapProbe(level: number): void {
    if (this.pinnedDetailLevel != null) return;
    this.detailShed.level = level;
    this.detailShed.target = level;
    this.detailShed.overSeconds = 0;
    this.detailShed.calmSeconds = 0;
    this.levels.detail = level;
  }

  /** Runs on every update, the disabled branch included, so the dev pin holds
   *  with the governor off and a disabled governor resets the level through
   *  the core. A session admitted by neither its band nor its own request
   *  (the high/medium/low table profiles, which sit at the floor) never
   *  touches the level unless pinned: it stays at the band baseline. */
  private updateDetailShed(dt: number, pressure: number): void {
    if (!this.detailShedApplies && this.pinnedDetailLevel == null) return;
    updateTerrainDetailShed(this.detailShed, dt, pressure, this.enabled, this.pinnedDetailLevel);
    this.levels.detail = this.detailShed.level;
  }

  /** One rung of the post ladder in either direction, over the rungs the
   *  session's chain actually carries (post_shed_core.ts postShedLadder), so
   *  a step never arms a cooldown for a pass that was never built. */
  private stepPostShed(direction: -1 | 1): boolean {
    const chain = this.postShedChain;
    if (!chain) return false;
    const next =
      direction < 0
        ? postShedStepDown(chain, this.levels.post)
        : Math.min(this.bands.post.baseline, postShedStepUp(chain, this.levels.post));
    if (Math.abs(next - this.levels.post) < 0.001) return false;
    this.levels.post = round2(next);
    return true;
  }

  private reduceLevel(key: keyof RenderBudgetLevels, floor: number, step: number): boolean {
    if (this.levels[key] <= floor + 0.001) return false;
    this.levels[key] = Math.max(floor, round2(this.levels[key] - step));
    return true;
  }

  private raiseLevel(key: keyof RenderBudgetLevels, ceiling: number, step: number): boolean {
    if (this.levels[key] >= ceiling - 0.001) return false;
    this.levels[key] = Math.min(ceiling, round2(this.levels[key] + step));
    return true;
  }

  /** One over-budget step down the ladder. 'idle' means no rung was even
   *  eligible under this pressure (the mild frame band below the severe
   *  line engages nothing by design); 'exhausted' means every eligible rung
   *  already sat at its floor: the governor has nothing left to shed here.
   *  `exhaustive` (the cap probe) makes every rung eligible at the ordinary
   *  step sizes, so the probe reaches the floors in a few cooldowns. */
  private degrade(
    urgent: boolean,
    minRenderScale: number,
    pressure: { frame: number; submit: number; draw: number; grass: number },
    exhaustive = false,
  ): 'changed' | 'exhausted' | 'idle' {
    let changed = false;
    let eligible = false;

    const drawDominant = pressure.draw >= pressure.frame && pressure.draw >= pressure.submit;
    const foliageStep = urgent ? URGENT_FOLIAGE_STEP : 0.08;
    if (exhaustive || urgent || drawDominant || pressure.draw >= 1.08) {
      eligible = true;
      if (this.reduceLevel('foliage', this.caps.minFoliageLevel, foliageStep)) changed = true;
    }

    const grassStep = urgent ? URGENT_GRASS_STEP : 0.08;
    if (
      exhaustive ||
      urgent ||
      pressure.grass >= 1 ||
      (drawDominant && this.levels.foliage <= this.caps.minFoliageLevel + 0.001)
    ) {
      eligible = true;
      if (this.reduceLevel('grass', this.caps.minGrassLevel, grassStep)) changed = true;
    }

    const lightingStep = urgent ? URGENT_LIGHTING_STEP : 0.07;
    const environmentFloored =
      this.levels.foliage <= this.caps.minFoliageLevel + 0.001 &&
      this.levels.grass <= this.caps.minGrassLevel + 0.001;
    if (exhaustive || urgent || pressure.submit >= 1 || environmentFloored) {
      eligible = true;
      if (this.reduceLevel('lighting', this.caps.minLightingLevel, lightingStep)) changed = true;
    }

    const vfxStep = urgent ? URGENT_VFX_STEP : 0.05;
    const lightingDone = this.levels.lighting <= this.caps.minLightingLevel + 0.001;
    const severeFramePressure = pressure.frame >= 1.25 || pressure.submit >= 1.25;
    if (
      exhaustive ||
      severeFramePressure ||
      (!urgent &&
        environmentFloored &&
        lightingDone &&
        (pressure.frame >= 1 || pressure.submit >= 1))
    ) {
      eligible = true;
      if (this.reduceLevel('vfx', this.caps.minVfxLevel, vfxStep)) changed = true;
    }

    // The post shed takes the resolution rung's place on the composer tiers,
    // where the region path is off (post_plan_core.ts: every full-frame pass
    // costs the chain its dynamic resolution) and a resolution step is
    // DEFERRED rather than applied: it only reaches the allocation scale at
    // the next applyResolution (a resize or a display change). One rung per
    // over-budget step, only once the density buckets sit at their floors or
    // the frame is severely over, so a fight sheds grass and lights before it
    // loses its edge AA, its bloom and its occlusion.
    const vfxDone = this.levels.vfx <= this.caps.minVfxLevel + 0.001;
    const lastResort =
      exhaustive || severeFramePressure || (environmentFloored && lightingDone && vfxDone);
    if (lastResort) {
      eligible = true;
      if (this.pinnedPostLevel == null && this.stepPostShed(-1)) changed = true;
      const resolutionStep = urgent ? this.budget.urgentDropStep : this.budget.dropStep;
      if (this.reduceLevel('resolution', minRenderScale, resolutionStep)) changed = true;
    }
    return changed ? 'changed' : eligible ? 'exhausted' : 'idle';
  }

  /** Phase A restores what pressure took, quality buckets before render scale, and runs on
   * measured headroom alone. Phase B climbs past the baselines and additionally needs scene
   * density under the draw caps. Returning false claims nothing: no cooldown, no mode change. */
  private recover(maxRenderScale: number, allowAboveBaseline: boolean): boolean {
    if (this.raiseLevel('grass', this.bands.grass.baseline, 0.08)) return true;
    if (this.raiseLevel('lighting', this.bands.lighting.baseline, 0.08)) return true;
    if (this.raiseLevel('vfx', this.bands.vfx.baseline, 0.08)) return true;
    if (this.raiseLevel('foliage', this.bands.foliage.baseline, 0.08)) return true;
    // Shed last, so restored after the density buckets and before render
    // scale: each rung back is a whole pass returning, so it waits for the
    // cheaper restores to prove their headroom first.
    if (this.pinnedPostLevel == null && this.stepPostShed(1)) return true;
    if (this.raiseLevel('resolution', maxRenderScale, this.budget.recoverStep)) return true;
    if (!allowAboveBaseline) return false;
    if (this.raiseLevel('foliage', this.bands.foliage.max, 0.08)) return true;
    if (this.raiseLevel('vfx', this.bands.vfx.max, 0.08)) return true;
    if (this.raiseLevel('grass', this.bands.grass.max, 0.06)) return true;
    if (this.raiseLevel('lighting', this.bands.lighting.max, 0.05)) return true;
    return false;
  }
}
