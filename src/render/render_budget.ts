import { GFX_BUCKET_BANDS, type GfxBucketBands, type GfxRuntimeBudget, type GfxTier } from './gfx';

export type RenderBudgetMode = 'disabled' | 'stable' | 'degrading' | 'recovering';
export type RenderBudgetReason = 'disabled' | 'startup' | 'stable' | 'frame' | 'frame-cap' | 'submit' | 'submit-stall' | 'draw' | 'grass' | 'recover';

export interface RenderBudgetLevels {
  grass: number;
  foliage: number;
  vfx: number;
  lighting: number;
  resolution: number;
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

export interface RenderBudgetState {
  enabled: boolean;
  mode: RenderBudgetMode;
  reason: RenderBudgetReason;
  pressure: number;
  frameMsEma: number;
  submitMsEma: number;
  externalFrameCap: boolean;
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
}

const CAPS_BY_TIER: Record<GfxTier, RenderBudgetCaps> = {
  low: {
    targetCalls: 560,
    urgentCalls: 760,
    targetTriangles: 2_200_000,
    urgentTriangles: 3_000_000,
    targetGrassTufts: 5_600,
    urgentGrassTufts: 7_600,
    minGrassLevel: 0.62,
    minFoliageLevel: 0.68,
    minVfxLevel: 0.84,
    minLightingLevel: 0.78,
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
  };
}

function copyCaps(caps: RenderBudgetCaps): RenderBudgetCaps {
  return { ...caps };
}

const SUBMIT_STALL_MS = 120;
const SUBMIT_STALL_URGENT_MS = 250;
const SUBMIT_STALL_HOLD_SECONDS: Record<GfxTier, number> = { low: 18, medium: 14, high: 8, ultra: 6 };
const SUBMIT_STALL_URGENT_HOLD_SECONDS: Record<GfxTier, number> = { low: 30, medium: 24, high: 14, ultra: 12 };
const SUBMIT_STALL_RECOVERY_CEILING_MS = 42;
const EXTERNAL_FRAME_CAP_MIN_MS = 28;
const EXTERNAL_FRAME_CAP_MAX_MS = 48;

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
  private stallPressure = 0;
  private recentSubmitStalls = 0;
  private lastSubmitStallMs = 0;
  private stallHoldSeconds = 0;
  private stableSeconds = 0;
  private cooldownSeconds = 0;
  private levels: RenderBudgetLevels = { grass: 1, foliage: 1, vfx: 1, lighting: 1, resolution: 1 };

  constructor(options: RenderBudgetGovernorOptions) {
    this.tier = options.tier;
    this.budget = options.budget;
    this.enabled = options.enabled;
    this.caps = CAPS_BY_TIER[options.tier];
    this.bands = GFX_BUCKET_BANDS[options.tier];
    this.mode = options.enabled ? 'stable' : 'disabled';
    this.reason = options.enabled ? 'startup' : 'disabled';
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
      }
      : { grass: 1, foliage: 1, vfx: 1, lighting: 1, resolution: round2(scale) };
    this.frameMsEma = 16.7;
    this.submitMsEma = 0;
    this.externalFrameCap = false;
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

  state(): RenderBudgetState {
    return {
      enabled: this.enabled,
      mode: this.mode,
      reason: this.reason,
      pressure: round2(this.pressure),
      frameMsEma: round2(this.frameMsEma),
      submitMsEma: round2(this.submitMsEma),
      externalFrameCap: this.externalFrameCap,
      stallPressure: round2(this.stallPressure),
      recentSubmitStalls: round2(this.recentSubmitStalls),
      lastSubmitStallMs: round2(this.lastSubmitStallMs),
      stallHoldSeconds: round2(this.stallHoldSeconds),
      stableSeconds: round2(this.stableSeconds),
      cooldownSeconds: round2(this.cooldownSeconds),
      levels: copyLevels(this.levels),
      caps: copyCaps(this.caps),
    };
  }

  update(sample: RenderBudgetSample): RenderBudgetState {
    if (!Number.isFinite(sample.dt) || sample.dt <= 0) return this.state();
    const frameMs = Math.min(250, Math.max(0, sample.frameMs));
    const totalMs = Math.min(250, Math.max(0, sample.totalMs));
    const rawSubmitMs = Math.max(0, sample.submitMs);
    const submitMs = Math.min(250, rawSubmitMs);
    const frameCost = Math.max(frameMs, totalMs);
    this.frameMsEma += (frameCost - this.frameMsEma) * 0.08;
    this.submitMsEma += (submitMs - this.submitMsEma) * 0.12;
    this.stallPressure = Math.max(this.stallPressure * Math.exp(-sample.dt / 12), positiveRatio(rawSubmitMs, SUBMIT_STALL_MS));

    if (!this.enabled) {
      this.mode = 'disabled';
      this.reason = 'disabled';
      this.pressure = 0;
      this.externalFrameCap = false;
      return this.state();
    }

    const minRenderScale = Math.min(sample.maxRenderScale, Math.max(0.5, sample.minRenderScale));
    const maxRenderScale = Math.max(minRenderScale, Math.min(1, sample.maxRenderScale));
    this.levels.resolution = Math.min(maxRenderScale, Math.max(minRenderScale, this.levels.resolution));

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
    const renderWorkHasHeadroom = totalMs <= this.budget.recoverFrameMs
      && submitMs <= Math.max(8, this.budget.recoverFrameMs * 0.7)
      && this.submitMsEma <= Math.max(8, this.budget.dropFrameMs * 0.58)
      && rawSubmitMs <= SUBMIT_STALL_RECOVERY_CEILING_MS
      && this.stallPressure < 0.5
      && drawPressure < 1
      && grassPressure < 1;
    this.externalFrameCap = rawFramePressure >= 1
      && cadenceMs >= EXTERNAL_FRAME_CAP_MIN_MS
      && cadenceMs <= EXTERNAL_FRAME_CAP_MAX_MS
      && renderWorkHasHeadroom;
    const framePressure = this.externalFrameCap ? 0 : rawFramePressure;
    this.pressure = Math.max(framePressure, submitPressure, drawPressure, grassPressure, this.stallPressure);

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

    const urgent = submitStall
      || (!this.externalFrameCap && frameMs >= this.budget.urgentFrameMs)
      || totalMs >= this.budget.urgentFrameMs
      || submitMs >= Math.max(12, this.budget.urgentFrameMs * 0.58)
      || sample.calls >= this.caps.urgentCalls
      || sample.triangles >= this.caps.urgentTriangles
      || sample.grassVisibleTufts >= this.caps.urgentGrassTufts;
    const overBudget = this.pressure >= 1
      || (!this.externalFrameCap && this.frameMsEma >= this.budget.dropFrameMs)
      || totalMs >= this.budget.dropFrameMs
      || submitMs >= Math.max(8, this.budget.dropFrameMs * 0.58);

    if ((submitStall || overBudget) && (submitStall || this.cooldownSeconds <= 0)) {
      const changed = this.degrade(urgent, minRenderScale, {
        frame: framePressure,
        submit: submitStall ? Math.max(submitPressure, this.stallPressure) : submitPressure,
        draw: drawPressure,
        grass: grassPressure,
      });
      if (changed) {
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
          ? Math.max(this.cooldownSeconds, this.budget.cooldownSeconds * (rawSubmitMs >= SUBMIT_STALL_URGENT_MS ? 4 : 2.5))
          : urgent ? this.budget.cooldownSeconds * 0.55 : this.budget.cooldownSeconds;
        return this.state();
      }
    }

    if (this.stallHoldSeconds > 0) {
      this.stableSeconds = 0;
      this.mode = 'degrading';
      this.reason = 'submit-stall';
      return this.state();
    }

    const canRecover = (this.externalFrameCap || this.frameMsEma <= this.budget.recoverFrameMs)
      && totalMs <= this.budget.recoverFrameMs
      && submitMs <= Math.max(8, this.budget.recoverFrameMs * 0.7)
      && rawSubmitMs <= SUBMIT_STALL_RECOVERY_CEILING_MS
      && this.stallPressure < 0.5
      && sample.calls <= this.caps.targetCalls * 0.9
      && sample.triangles <= this.caps.targetTriangles * 0.9
      && sample.grassVisibleTufts <= this.caps.targetGrassTufts * 0.9;

    if (canRecover) {
      this.stableSeconds += sample.dt;
      if (this.stableSeconds >= this.budget.recoverStableSeconds && this.cooldownSeconds <= 0) {
        const changed = this.recover(maxRenderScale);
        if (changed) {
          this.mode = 'recovering';
          this.reason = 'recover';
          this.stableSeconds = 0;
          this.cooldownSeconds = this.budget.cooldownSeconds * 1.5;
          return this.state();
        }
      }
    } else {
      this.stableSeconds = 0;
    }

    this.mode = 'stable';
    this.reason = this.externalFrameCap ? 'frame-cap' : 'stable';
    return this.state();
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

  private degrade(
    urgent: boolean,
    minRenderScale: number,
    pressure: { frame: number; submit: number; draw: number; grass: number },
  ): boolean {
    let changed = false;

    const drawDominant = pressure.draw >= pressure.frame && pressure.draw >= pressure.submit;
    const foliageStep = urgent ? 0.14 : 0.08;
    if ((urgent || drawDominant || pressure.draw >= 1.08)
      && this.reduceLevel('foliage', this.caps.minFoliageLevel, foliageStep)) {
      changed = true;
    }

    const grassStep = urgent ? 0.14 : 0.08;
    if ((urgent || pressure.grass >= 1 || (drawDominant && this.levels.foliage <= this.caps.minFoliageLevel + 0.001))
      && this.reduceLevel('grass', this.caps.minGrassLevel, grassStep)) {
      changed = true;
    }

    const lightingStep = urgent ? 0.12 : 0.07;
    const environmentFloored = this.levels.foliage <= this.caps.minFoliageLevel + 0.001
      && this.levels.grass <= this.caps.minGrassLevel + 0.001;
    if ((urgent || pressure.submit >= 1 || environmentFloored)
      && this.reduceLevel('lighting', this.caps.minLightingLevel, lightingStep)) {
      changed = true;
    }

    const vfxStep = urgent ? 0.08 : 0.05;
    const lightingDone = this.levels.lighting <= this.caps.minLightingLevel + 0.001;
    const severeFramePressure = pressure.frame >= 1.25 || pressure.submit >= 1.25;
    if ((severeFramePressure || (!urgent && environmentFloored && lightingDone && (pressure.frame >= 1 || pressure.submit >= 1)))
      && this.reduceLevel('vfx', this.caps.minVfxLevel, vfxStep)) {
      changed = true;
    }

    const resolutionStep = urgent ? this.budget.urgentDropStep : this.budget.dropStep;
    const vfxDone = this.levels.vfx <= this.caps.minVfxLevel + 0.001;
    if ((severeFramePressure || (environmentFloored && lightingDone && vfxDone))
      && this.reduceLevel('resolution', minRenderScale, resolutionStep)) {
      changed = true;
    }
    return changed;
  }

  private recover(maxRenderScale: number): boolean {
    if (this.raiseLevel('grass', this.bands.grass.baseline, 0.08)) return true;
    if (this.raiseLevel('lighting', this.bands.lighting.baseline, 0.08)) return true;
    if (this.raiseLevel('vfx', this.bands.vfx.baseline, 0.08)) return true;
    if (this.raiseLevel('foliage', this.bands.foliage.baseline, 0.08)) return true;
    if (this.raiseLevel('foliage', this.bands.foliage.max, 0.08)) return true;
    if (this.raiseLevel('vfx', this.bands.vfx.max, 0.08)) return true;
    if (this.raiseLevel('grass', this.bands.grass.max, 0.06)) return true;
    if (this.raiseLevel('lighting', this.bands.lighting.max, 0.05)) return true;
    if (this.raiseLevel('resolution', maxRenderScale, this.budget.recoverStep)) return true;
    return false;
  }
}
