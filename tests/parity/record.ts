// Parity recorder: drives a Scenario and produces a committed-golden Trace.
//
// The Recorder installs the default-off Rng observer (src/sim/rng.ts) for the
// duration of a recording, accumulates the per-tick SimEvent stream and the rng
// draw-order fingerprint, and samples full player + tracked-entity state on a
// fixed cadence. Everything it captures is deterministic: same seed + same drive
// script => identical Trace (the gate asserts this by recording twice).
//
// Draw-order policy: we observe the SHARED `sim.rng` (mulberry32) only. Each draw
// folds its 32-bit mulberry output into a rolling FNV-1a digest in draw order, so
// the digest pins both the draw COUNT and the draw ORDER across the ~109 shared
// draw sites. We deliberately do NOT tag draws with a callsite (a stack-derived
// tag churns on every sim.ts edit, which is exactly what the refactor does); the
// (count + ordered value) fingerprint catches reordering without that churn.
// Construction-time draws happen before the observer can exist (the Rng is born
// inside the Sim ctor), so they are pinned by the frame-0 state sample instead.

import type { Sim } from '../../src/sim/sim';
import type { SimEvent } from '../../src/sim/types';
import {
  digest,
  eventDigest,
  FNV_OFFSET,
  type Frame,
  fnv1aStepU32,
  round6,
  sampleEntity,
  samplePlayerMeta,
  type Trace,
} from './trace';

export const DEFAULT_SAMPLE_EVERY = 20;

// A scenario builds a Sim and drives it through the Recorder. `build()` only
// constructs the world; ALL setup + stepping happens in `drive()` so the rng
// observer (installed between the two) captures every draw the scenario causes.
export interface Scenario {
  name: string;
  // Notes on the systems / shared entry points this scenario exercises; stored
  // verbatim in the golden so coverage is auditable.
  coverage: string[];
  // Optional per-scenario sampling cadence (ticks between frames). Heavy
  // multi-player scenarios use a coarser cadence to stay within the size budget.
  sampleEvery?: number;
  build(): Sim;
  drive(rec: Recorder): void;
}

// Quantize a mulberry32 output in [0,1) back to its exact 32-bit integer. next()
// returns int/2^32, so this reconstructs `int` losslessly (ints < 2^32 are exact
// floats) — a perfect, collision-resistant value to fold into the draw digest.
function drawToU32(value: number): number {
  return Math.round(value * 4294967296) >>> 0;
}

export class Recorder {
  readonly sim: Sim;
  readonly sampleEvery: number;
  // Every event emitted across the whole recording (never reset) — for coverage
  // assertions in tests. The per-frame digest uses a separate windowed buffer.
  readonly allEvents: SimEvent[] = [];
  // Scratch anchors a scenario can stash for its coverage test (e.g. a transient
  // entity id that may despawn before the run ends). Not part of the golden.
  readonly notes: Record<string, unknown> = {};

  private readonly trackIds = new Set<number>();
  private readonly frames: Frame[] = [];
  private windowEvents: SimEvent[] = [];
  private tickIndex = 0;
  private drawCount = 0;
  private rollHash = FNV_OFFSET;
  private started = false;

  constructor(sim: Sim, sampleEvery: number = DEFAULT_SAMPLE_EVERY) {
    this.sim = sim;
    this.sampleEvery = sampleEvery;
  }

  // Install the rng observer and record the initial (pre-drive) frame.
  begin(): void {
    if (this.started) return;
    this.started = true;
    this.sim.rng.setObserver((value) => {
      this.drawCount++;
      this.rollHash = fnv1aStepU32(this.rollHash, drawToU32(value));
    });
    this.pushFrame('init', true);
  }

  // Register mob / pet entity ids to sample as entities. Players are always
  // sampled (iterated from sim.players); call this for mobs, pets, corpses, etc.
  track(...ids: number[]): void {
    for (const id of ids) this.trackIds.add(id);
  }

  // Advance n ticks, folding the returned events into the window and sampling
  // whenever the cadence lands. Returns the events from this call's ticks.
  tick(n = 1): SimEvent[] {
    const produced: SimEvent[] = [];
    for (let i = 0; i < n; i++) {
      const ev = this.sim.tick();
      produced.push(...ev);
      this.windowEvents.push(...ev);
      this.allEvents.push(...ev);
      this.tickIndex++;
      if (this.tickIndex % this.sampleEvery === 0) this.pushFrame();
    }
    return produced;
  }

  // Force a labelled frame now (used after an out-of-tick internal mutation, or
  // at a meaningful checkpoint). Drains any queued sim events into the window
  // first so a one-shot internal emit is still digested.
  snapshot(label?: string): void {
    const queued = this.sim.drainEvents();
    if (queued.length) {
      this.windowEvents.push(...queued);
      this.allEvents.push(...queued);
    }
    this.pushFrame(label, true);
  }

  // `full` attaches the verbose player/entity samples (checkpoint frames only).
  // Every frame still pins the full-state DIGEST, so trajectory drift is caught
  // at the sample point even when the verbose body is omitted.
  private pushFrame(label?: string, full = false): void {
    const sim = this.sim as unknown as {
      tickCount: number;
      time: number;
      nextId: number;
      players: Map<number, unknown>;
      entities: Map<number, unknown>;
    };
    const playerIds = [...sim.players.keys()].sort((a, b) => a - b);
    const entityIds = [...new Set([...playerIds, ...this.trackIds])].sort((a, b) => a - b);
    const players = playerIds.map((pid) => samplePlayerMeta(sim.players.get(pid) as never));
    const entities = entityIds
      .map((id) => sim.entities.get(id))
      .filter((e): e is object => e !== undefined)
      .map((e) => sampleEntity(e as never));
    const frame: Frame = {
      tick: sim.tickCount,
      time: round6(sim.time),
      nextId: sim.nextId,
      state: digest({ players, entities }),
      events: eventDigest(this.windowEvents),
      rng: { draws: this.drawCount, digest: (this.rollHash >>> 0).toString(16).padStart(8, '0') },
    };
    if (label !== undefined) frame.label = label;
    if (full) {
      frame.players = players;
      frame.entities = entities;
    }
    this.frames.push(frame);
    this.windowEvents = [];
  }

  // Detach the observer and assemble the Trace. Always records a final frame so
  // the end state + trailing events + final draw fingerprint are pinned. Drain
  // any queued out-of-tick emits first (a scenario may end on a direct internal
  // call), so the final eventDigest never silently loses events.
  finish(scenario: Scenario): Trace {
    const queued = this.sim.drainEvents();
    if (queued.length) {
      this.windowEvents.push(...queued);
      this.allEvents.push(...queued);
    }
    this.pushFrame('final', true);
    this.sim.rng.setObserver(null);
    return {
      scenario: scenario.name,
      seed: (this.sim as unknown as { cfg: { seed: number } }).cfg.seed,
      sampleEvery: this.sampleEvery,
      ticks: this.tickIndex,
      coverage: scenario.coverage,
      draws: this.drawCount,
      drawDigest: (this.rollHash >>> 0).toString(16).padStart(8, '0'),
      frames: this.frames,
    };
  }
}

// Record a scenario into a Trace plus the live Recorder (the Recorder exposes
// allEvents + the final sim for coverage assertions in tests).
export function record(scenario: Scenario): { trace: Trace; rec: Recorder } {
  const sim = scenario.build();
  const rec = new Recorder(sim, scenario.sampleEvery ?? DEFAULT_SAMPLE_EVERY);
  rec.begin();
  scenario.drive(rec);
  const trace = rec.finish(scenario);
  return { trace, rec };
}

// Record a scenario into a Trace (the gate's entry point).
export function recordTrace(scenario: Scenario): Trace {
  return record(scenario).trace;
}
