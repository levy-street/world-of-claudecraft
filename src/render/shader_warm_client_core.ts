// The shader warm client's bookkeeping: which programs were asked for (once
// each, by their text), who waits on them, what a gate did when it could not
// wait, and when the worker should pause. Host-agnostic (RENDER_PURE_CORES):
// no worker, no DOM, no clock of its own; the host (shader_warm_client.ts)
// carries the messages and the frame readings.
//
// THE POLICY, in one place. The worker warms a program for the game's link
// to be a hit, which only pays when the link has LEAD: content the camera is
// not among yet (a streamed reveal key beyond the ring, the post-paint
// catalogs, an approaching zone). A gate that must draw NOW (an actionable
// or live entity view, an imminent reveal) gains nothing from waiting and
// would only add the worker's round trip to its hold, and a gate created
// before the reveal links under the curtain where nothing is felt and where
// the renderer state is still moving (the step-1 measurement: the
// point-light census and the post pipeline settle after those gates were
// created, so their keys move). Those are the named bypasses, each counted,
// so the readout says how often the worker was NOT the path.
//
// The modes exist so the policy can be measured rather than believed:
// `?shaderwarm=off` (the default) never asks the worker, `reveal` holds the
// reveal lane only, `all` holds every gate below the actionable floor.

import { programSourceHash } from './shader_warm_audit_core';
import type { ShaderWarmSource } from './shader_warm_protocol';

export type ShaderWarmMode = 'off' | 'reveal' | 'all';

export type ShaderWarmBypass =
  | 'mode-off'
  | 'unavailable'
  | 'before-reveal'
  | 'actionable'
  | 'live-view'
  | 'imminent'
  | 'piece-mismatch'
  | 'nothing-to-warm';

/** Held gates expiring in a row before the client retires the worker for the
 *  rest of the renderer's life: three is one too many to be one slow link,
 *  and each expiry is a reveal delayed by the whole hold cap. */
export const SHADER_WARM_TIMEOUT_BREAKER = 3;

export interface ShaderWarmPolicyInputs {
  mode: ShaderWarmMode;
  /** The worker is ready (spawned, context up, extensions matched). */
  available: boolean;
  /** The first reveal happened: the census and the pipeline are settled. */
  armed: boolean;
  priority: number;
  imminent: boolean;
  /** The queue's floors, so the core does not import the queue. */
  liveViewPriority: number;
  actionablePriority: number;
}

export type ShaderWarmDecision = { hold: true } | { hold: false; bypass: ShaderWarmBypass };

/** Whether a gate holds its link for the worker, or links as before. */
export function shaderWarmDecision(inputs: ShaderWarmPolicyInputs): ShaderWarmDecision {
  if (inputs.mode === 'off') return { hold: false, bypass: 'mode-off' };
  if (!inputs.available) return { hold: false, bypass: 'unavailable' };
  if (!inputs.armed) return { hold: false, bypass: 'before-reveal' };
  if (inputs.priority >= inputs.actionablePriority) return { hold: false, bypass: 'actionable' };
  if (inputs.imminent) return { hold: false, bypass: 'imminent' };
  if (inputs.priority >= inputs.liveViewPriority && inputs.mode !== 'all') {
    return { hold: false, bypass: 'live-view' };
  }
  return { hold: true };
}

/** `?shaderwarm=off|reveal|all`; anything else is the default, OFF: the
 *  first measured cell (tmp/REPORT_worker-step2_2026-08-28.md) showed every
 *  held piece warm but no frame gain while the catalogs and the zone
 *  prepares still link cold, so the worker ships opt-in until every producer
 *  is a requester and a cell shows the win. */
export function readShaderWarmMode(search: string): ShaderWarmMode {
  const match = /[?&]shaderwarm=([^&]*)/.exec(search);
  const value = match ? decodeURIComponent(match[1] ?? '') : '';
  if (value === 'off' || value === 'all' || value === 'reveal') return value;
  return 'off';
}

export interface ShaderWarmRequestSource {
  vertex: string;
  fragment: string;
  index0Attribute: string;
}

export type ShaderWarmOutcome = 'warmed' | 'failed';

interface ShaderWarmEntry {
  id: number;
  outcome: ShaderWarmOutcome | null;
  waiters: Array<(outcome: ShaderWarmOutcome) => void>;
  priority: number;
}

export interface ShaderWarmRequestStats {
  /** Sources handed in, before the dedupe. */
  asked: number;
  /** Distinct programs sent to the worker. */
  sent: number;
  warmed: number;
  failed: number;
  /** Requests answered from an earlier warm (the same text asked again). */
  deduped: number;
  /** Gates that held their link for the worker. */
  held: number;
  /** Of the held gates, those whose every program was warm when the hold
   *  ended. */
  heldWarm: number;
  /** Held gates that gave up on the hold cap and linked cold. */
  heldTimedOut: number;
  bypassed: Record<ShaderWarmBypass, number>;
  /** Hold durations, summed, so a mean is one division away. */
  holdMs: number;
  /** The gates' dry assembly time, summed (one queue unit per held piece). */
  dryAssembleMs: number;
  /** The worker's own link times (submission to resolution), so a capture
   *  can say how long the GPU process took per program under this load. */
  links: { count: number; sumMs: number; maxMs: number };
}

export interface ShaderWarmRequests {
  /** Ask for a set of programs. The returned ids are the worker's; already
   *  warm ones are not re-sent and are not in `toSend`. */
  request(
    sources: readonly ShaderWarmRequestSource[],
    priority: number,
  ): { ids: number[]; toSend: ShaderWarmSource[] };
  /** Resolves with the outcomes of `ids`, in order, once every one settled. */
  whenSettled(ids: readonly number[]): Promise<ShaderWarmOutcome[]>;
  /** True when the id was pending and is settled now. */
  settle(id: number, outcome: ShaderWarmOutcome): boolean;
  /** Every unsettled request fails now (the worker died). */
  failAll(): void;
  /** Requests sent and not settled: someone is waiting on each of them. */
  pendingCount(): number;
  noteHeld(warm: boolean, timedOut: boolean, holdMs: number): void;
  noteBypass(bypass: ShaderWarmBypass): void;
  noteAssembly(ms: number): void;
  noteLink(ms: number): void;
  stats(): ShaderWarmRequestStats;
}

export function createShaderWarmRequests(): ShaderWarmRequests {
  const byHash = new Map<string, ShaderWarmEntry>();
  const byId = new Map<number, ShaderWarmEntry>();
  let nextId = 1;
  let unsettled = 0;
  const stats: ShaderWarmRequestStats = {
    asked: 0,
    sent: 0,
    warmed: 0,
    failed: 0,
    deduped: 0,
    held: 0,
    heldWarm: 0,
    heldTimedOut: 0,
    bypassed: {
      'mode-off': 0,
      unavailable: 0,
      'before-reveal': 0,
      actionable: 0,
      'live-view': 0,
      imminent: 0,
      'piece-mismatch': 0,
      'nothing-to-warm': 0,
    },
    holdMs: 0,
    dryAssembleMs: 0,
    links: { count: 0, sumMs: 0, maxMs: 0 },
  };
  return {
    request(sources, priority) {
      const ids: number[] = [];
      const toSend: ShaderWarmSource[] = [];
      for (const source of sources) {
        stats.asked++;
        const hash = `${programSourceHash(source.vertex, source.fragment)}|${source.index0Attribute}`;
        let entry = byHash.get(hash);
        if (entry) {
          stats.deduped++;
        } else {
          entry = { id: nextId++, outcome: null, waiters: [], priority };
          byHash.set(hash, entry);
          byId.set(entry.id, entry);
          stats.sent++;
          unsettled++;
          toSend.push({
            id: entry.id,
            vertex: source.vertex,
            fragment: source.fragment,
            index0Attribute: source.index0Attribute,
            priority,
          });
        }
        ids.push(entry.id);
      }
      return { ids, toSend };
    },
    whenSettled(ids) {
      return Promise.all(
        ids.map(
          (id) =>
            new Promise<ShaderWarmOutcome>((resolve) => {
              const entry = byId.get(id);
              if (!entry) {
                resolve('failed');
                return;
              }
              if (entry.outcome) resolve(entry.outcome);
              else entry.waiters.push(resolve);
            }),
        ),
      );
    },
    settle(id, outcome) {
      const entry = byId.get(id);
      if (!entry || entry.outcome) return false;
      entry.outcome = outcome;
      unsettled--;
      if (outcome === 'warmed') stats.warmed++;
      else stats.failed++;
      const waiters = entry.waiters;
      entry.waiters = [];
      for (const waiter of waiters) waiter(outcome);
      return true;
    },
    failAll() {
      for (const entry of byId.values()) {
        if (entry.outcome) continue;
        entry.outcome = 'failed';
        unsettled--;
        stats.failed++;
        const waiters = entry.waiters;
        entry.waiters = [];
        for (const waiter of waiters) waiter('failed');
      }
    },
    pendingCount: () => unsettled,
    noteHeld(warm, timedOut, holdMs) {
      stats.held++;
      if (warm) stats.heldWarm++;
      if (timedOut) stats.heldTimedOut++;
      stats.holdMs += Math.max(0, holdMs);
    },
    noteBypass(bypass) {
      stats.bypassed[bypass]++;
    },
    noteAssembly(ms) {
      stats.dryAssembleMs += Math.max(0, ms);
    },
    noteLink(ms) {
      const linkMs = Math.max(0, ms);
      stats.links.count++;
      stats.links.sumMs += linkMs;
      stats.links.maxMs = Math.max(stats.links.maxMs, linkMs);
    },
    stats: () => ({ ...stats, bypassed: { ...stats.bypassed }, links: { ...stats.links } }),
  };
}

/**
 * The pause signal: an exponential average of the frame time, paused above
 * two vsync periods and resumed under a period and a half, so the worker
 * never adds GPU work to a frame that is already late and never flaps on a
 * single long frame. The bounds are the display's, not a machine's.
 *
 * It applies to BACKGROUND warming only: a request a gate is holding its
 * link for has a consumer waiting, and pausing it only delays that reveal
 * (the first iGPU cell measured exactly that: the main thread's own cold
 * links made the frames long, the pause starved the worker, 35 of 57 held
 * pieces expired at the cap). The host pauses the worker only while no
 * request is unsettled (`pendingCount() === 0`), whatever the average says.
 */
export const SHADER_WARM_FRAME_PERIOD_MS = 1000 / 60;
export const SHADER_WARM_PAUSE_ABOVE_MS = SHADER_WARM_FRAME_PERIOD_MS * 2;
export const SHADER_WARM_RESUME_BELOW_MS = SHADER_WARM_FRAME_PERIOD_MS * 1.5;
const FRAME_EMA_WEIGHT = 0.2;

export interface ShaderWarmPauseState {
  emaMs: number;
  paused: boolean;
}

export function createShaderWarmPauseState(): ShaderWarmPauseState {
  return { emaMs: SHADER_WARM_FRAME_PERIOD_MS, paused: false };
}

/** Feed one frame; returns the transition, if any. */
export function noteShaderWarmFrame(
  state: ShaderWarmPauseState,
  frameMs: number,
): 'pause' | 'resume' | null {
  const ms = Number.isFinite(frameMs) ? Math.max(0, Math.min(250, frameMs)) : 0;
  state.emaMs += (ms - state.emaMs) * FRAME_EMA_WEIGHT;
  if (!state.paused && state.emaMs > SHADER_WARM_PAUSE_ABOVE_MS) {
    state.paused = true;
    return 'pause';
  }
  if (state.paused && state.emaMs < SHADER_WARM_RESUME_BELOW_MS) {
    state.paused = false;
    return 'resume';
  }
  return null;
}
