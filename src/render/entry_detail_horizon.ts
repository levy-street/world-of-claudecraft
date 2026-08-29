// Stateful adapter for the pure post-entry detail-horizon admission policy.
// Renderer supplies readiness samples; this object owns the reveal reset and
// monotone ring state so the coordinator carries no policy bookkeeping.

import {
  advanceEntryDetailHorizon,
  createEntryDetailHorizonState,
  ENTRY_DETAIL_HORIZON_HEADROOM_MS,
  ENTRY_DETAIL_HORIZON_STEPS,
  type EntryDetailHorizonState,
  entrySceneryCullFar,
} from './entry_detail_horizon_core';
import { type InitialFrameCompileRecord, initialFrameDeferral } from './initial_frame_core';

export interface EntryDetailHorizonSample {
  enabled: boolean;
  targetFar: number;
  compileReady: boolean;
  terrainReadyFar: number;
  frameMs: number;
  externallyPaced?: boolean;
}

export type EntryDetailHorizonHoldReason =
  | 'inactive'
  | 'compile-debt'
  | 'terrain'
  | 'frame'
  | 'stabilizing'
  | 'advanced'
  | 'complete';

export interface EntryDetailHorizonSnapshot {
  active: boolean;
  cap: number;
  /** The ring the reveal-gated scenery culled at this frame (`sceneryCullFar`),
   *  null once the horizon is inactive. Distinct from `cap`: before the far
   *  stand-in is complete the horizon cannot tick and `cap` reads the target,
   *  while scenery already culls at the open ring. */
  sceneryCap: number | null;
  targetFar: number;
  nextCap: number | null;
  stableFrames: number;
  armedAtMs: number | null;
  holdReason: EntryDetailHorizonHoldReason;
  transitions: { from: number; to: number; atMs: number }[];
}

export class EntryDetailHorizonAdmission {
  private state: EntryDetailHorizonState;
  private active = false;
  private demand: number;
  private armedAtMs: number | null = null;
  private holdReason: EntryDetailHorizonHoldReason = 'inactive';
  private readonly transitions: { from: number; to: number; atMs: number }[] = [];

  constructor(
    private readonly targetFar: number,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.state = createEntryDetailHorizonState(targetFar);
    this.demand = targetFar;
  }

  arm(liveFar: number, enabled: boolean): number {
    if (!enabled) {
      this.active = false;
      this.demand = liveFar;
      this.armedAtMs = null;
      this.holdReason = 'inactive';
      this.transitions.length = 0;
      return liveFar;
    }
    this.state = createEntryDetailHorizonState(this.targetFar);
    this.active = !this.state.complete;
    this.demand = this.state.cap;
    this.armedAtMs = this.now();
    this.holdReason = this.active ? 'stabilizing' : 'complete';
    this.transitions.length = 0;
    return Math.min(liveFar, this.demand);
  }

  advanceFromFrame(
    enabled: boolean,
    targetFar: number,
    records: readonly InitialFrameCompileRecord[] | null,
    terrainReadyFar: number,
    frameMs: number,
    externallyPaced = false,
  ): number {
    // Entry completion is permanent. Avoid walking the retained diagnostics
    // lifecycle or allocating a LinkDebt/sample on every later outdoor frame.
    if (!enabled || !this.active) {
      this.demand = targetFar;
      return this.demand;
    }
    return this.advance({
      enabled,
      targetFar,
      compileReady: records === null || initialFrameDeferral(records) === null,
      terrainReadyFar,
      frameMs,
      externallyPaced,
    });
  }

  private advance(sample: EntryDetailHorizonSample): number {
    if (sample.enabled && this.active) {
      const previousCap = this.state.cap;
      this.holdReason = this.reasonFor(sample);
      this.state = advanceEntryDetailHorizon(this.state, sample);
      this.active = !this.state.complete;
      if (this.state.cap > previousCap) {
        this.transitions.push({ from: previousCap, to: this.state.cap, atMs: this.now() });
        this.holdReason = 'advanced';
      } else if (!this.active) {
        this.holdReason = 'complete';
      }
    }
    this.demand = sample.enabled && this.active ? this.state.cap : sample.targetFar;
    return this.demand;
  }

  private reasonFor(sample: EntryDetailHorizonSample): EntryDetailHorizonHoldReason {
    if (!sample.compileReady) return 'compile-debt';
    if (sample.terrainReadyFar < this.nextCap(sample.targetFar)) return 'terrain';
    if (
      !sample.externallyPaced &&
      (!Number.isFinite(sample.frameMs) || sample.frameMs > ENTRY_DETAIL_HORIZON_HEADROOM_MS)
    ) {
      return 'frame';
    }
    return 'stabilizing';
  }

  private nextCap(targetFar: number): number {
    const step = Math.min(this.state.step + 1, ENTRY_DETAIL_HORIZON_STEPS.length - 1);
    return Math.min(targetFar, ENTRY_DETAIL_HORIZON_STEPS[step]);
  }

  demandFar(): number {
    return this.demand;
  }

  /** The cull far reveal-gated scenery consults this frame (entry_detail_horizon_core).
   *  Holds at the open ring while the horizon is active even on the frames the
   *  horizon cannot tick (before the far stand-in is complete `advanceFromFrame`
   *  is not fed): that window is the one the rule exists for. */
  sceneryCullFar(cullFar: number): number {
    return this.active ? entrySceneryCullFar(cullFar, this.state) : cullFar;
  }

  snapshot(): EntryDetailHorizonSnapshot {
    return {
      active: this.active,
      cap: this.demand,
      sceneryCap: this.active ? this.state.cap : null,
      targetFar: this.targetFar,
      nextCap: this.active ? this.nextCap(this.targetFar) : null,
      stableFrames: this.state.stableFrames,
      armedAtMs: this.armedAtMs,
      holdReason: this.holdReason,
      transitions: this.transitions.slice(),
    };
  }
}
