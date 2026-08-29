// Host adapter over reveal_gate_core: wires a cull's first-reveal hold to the
// renderer's live compile gate. One gate instance per consumer (the props
// view, each town's static cull), each with its own roots provider and key
// namespace (the props gate serves two disjoint ones: the far-cell grid keys
// and the `cull:` band keys). The compile itself rides the caller-supplied host, so
// this module owns only the settle plumbing, and its contract is absolute:
// every requested key MUST settle, whatever the compiles do, or scenery
// stays hidden forever. Three independent escapes guarantee it: per-root
// rejections and synchronous throws are absorbed (this runs inside a
// per-frame cull consult, so nothing may escape), and a cancelable watchdog
// covers a link that never resolves (compile-gate timeouts are
// diagnostic-only and cannot resolve early; see compile_gate.ts). The timer
// is cleared on the winning path so a settled key leaves nothing pending,
// and a watchdog reveal says so on the dev channel and records a
// machine-readable gpu-prep event (the gated_scene_attach shape).
//
// Each root is reported to the core as its own compile lands, so a consumer
// with independently revealable roots (a town: every static batch plus every
// building group) can show them one at a time instead of paying the whole
// key's first draw in the frame the last link settles.
//
// Between the two there is a SOFT deadline, derived from the learned cost of
// a reveal compile when the host offers one. It is a report, never an escape:
// past it the gate records how much of the key linked and keeps waiting, so
// the only thing that ever reveals an unlinked root early is still the hard
// watchdog. That distinction is the whole point: revealing early is exactly
// the stall the gate exists to prevent, and what a capture was missing was
// not another escape but the evidence that a key was slow.
//
// There is NO wall-clock reveal bound: a held root shows when its own compile
// lands and otherwise stays hidden, so this module owns exactly one clock, the
// watchdog's. What an IMMINENT consult buys instead is queue position: the
// request carries the flag down to the compile host, which submits that key's
// link, upload and touch pieces at the imminent priority so the decor the
// camera stands in is what the driver links first. Every gate joins the
// arrival-cover registry on creation, so a teleport's loading screen can wait
// on exactly those holds before it lifts. Under the entry cover's ESTABLISHING
// SHOT (arrival_cover.ts: the first-spawn cinematic's wide opening view) every
// consult is imminent, since everything that view reveals is what the player
// sees first; that too only reorders and extends the covered wait, it never
// reveals early.

import { arrivalEstablishingShotActive, registerRevealGateForArrival } from './arrival_cover';
import {
  gpuPrepNow,
  noteRevealImminentHold,
  noteRevealKeyHeld,
  noteRevealRootPiecewise,
  noteRevealRootReach,
  noteRevealRootsAtWatchdog,
  recordGpuPrepEvent,
} from './gpu_prep_events';
import {
  createRevealGateCore,
  type RevealGateCore,
  type RevealGateReadiness,
} from './reveal_gate_core';

export const REVEAL_GATE_WATCHDOG_MS = 10_000;

/** The floor of the soft deadline. Below it a single slow frame, a tab
 *  restore or one queued unit ahead in the lane would fire it, and a report
 *  that fires on healthy sessions reports nothing. */
export const REVEAL_SOFT_DEADLINE_MIN_MS = 1_000;

export interface RevealCompileHost {
  /** Compile one root's programs; resolves (or rejects) when settled.
   *  `imminent` is the consult's answer to "is the camera already among this
   *  key's objects", and the host turns it into queue priority; a caller that
   *  owns a stronger claim (the occluder-fade gate's edge frame) may name the
   *  priority outright. */
  compile(root: object, imminent: boolean, priority?: number): Promise<unknown>;
  /** Optional page-entry barrier. Roots and holds are registered immediately,
   * but cosmetic GPU work and both timeout clocks begin only after it settles. */
  startAfterInitialPaint?: () => Promise<void> | null | undefined;
  /** Injectable watchdog scheduler; returns a cancel function. Defaults to
   *  setTimeout/clearTimeout. */
  schedule?: (onTimeout: () => void, ms: number) => () => void;
  /** How long this key's compiles are expected to take, from the host's
   *  learned cost model, given the roots just submitted. Absent (or at/above
   *  the watchdog) arms no soft deadline, which is the historical behaviour. */
  expectedMs?: (key: string, rootCount: number, roots: readonly object[]) => number;
}

export interface RevealGate extends RevealGateCore {
  /** A consumer revealed one root before its key warmed, because that root's
   *  own compile landed. Telemetry only: the gate never decides anything from
   *  it, so a consumer that does not report loses a counter, never a reveal. */
  noteRootRevealed(key: string): void;
  /** A consumer revealed one root before its key warmed because the root sits
   *  inside its reach floor (colliders at arm's length), linked or not. Kept
   *  apart from the piecewise count: these are the fairness reveals, the ones
   *  that may still draw cold. */
  noteRootRevealedAtReach(key: string): void;
}

const defaultSchedule = (onTimeout: () => void, ms: number): (() => void) => {
  const timer = setTimeout(onTimeout, ms);
  return () => clearTimeout(timer);
};

const noCancel = (): void => undefined;

/**
 * The soft deadline for a key whose link is `unitCount` queue units (gate
 * pieces, one per material group of its roots) of about `perUnitMs` each,
 * clamped into [REVEAL_SOFT_DEADLINE_MIN_MS, REVEAL_GATE_WATCHDOG_MS].
 * An unlearned or nonsense cost falls back to the floor rather than to no
 * deadline at all: a budget with no samples is exactly when a report helps.
 */
export function revealSoftDeadlineMs(perUnitMs: number, unitCount: number): number {
  const roots = Number.isFinite(unitCount) && unitCount > 1 ? Math.floor(unitCount) : 1;
  const predicted = Number.isFinite(perUnitMs) && perUnitMs > 0 ? perUnitMs * roots : 0;
  if (predicted <= REVEAL_SOFT_DEADLINE_MIN_MS) return REVEAL_SOFT_DEADLINE_MIN_MS;
  return predicted < REVEAL_GATE_WATCHDOG_MS ? predicted : REVEAL_GATE_WATCHDOG_MS;
}

/** Module-owned scratch for the readiness reads, which only ever happen
 *  synchronously inside one escape or deadline callback. */
const readiness: RevealGateReadiness = { ready: 0, total: 0 };

export function createRevealGate(
  host: RevealCompileHost,
  rootsFor: (key: string) => readonly object[],
): RevealGate {
  const schedule = host.schedule ?? defaultSchedule;
  const gate: RevealGateCore = createRevealGateCore(
    (key, imminent) => {
      let roots: readonly object[] = [];
      try {
        roots = rootsFor(key);
      } catch (error) {
        console.error('Reveal gate roots lookup failed', key, error);
      }
      gate.noteRoots(key, roots);
      const rootCount = gate.readiness(key, readiness).total;
      noteRevealKeyHeld(rootCount);
      const startCompiles = (): void => {
        const requestedAtMs = gpuPrepNow();
        const compiles = roots.map((root) => {
          const settleRoot = (): void => gate.settleRoot(key, root);
          try {
            return Promise.resolve(host.compile(root, imminent)).then(settleRoot, settleRoot);
          } catch (error) {
            console.error('Reveal gate compile request failed', key, error);
            settleRoot();
            return undefined;
          }
        });
        let settled = false;
        let cancelSoftDeadline: () => void = noCancel;
        const cancelWatchdog = schedule(() => {
          // A key another owner settled meanwhile (the occluder-fade gate's
          // escalation) is warm: nothing to reveal, nothing to report.
          if (settled || gate.state(key) === 'warm') return;
          settled = true;
          cancelSoftDeadline();
          console.warn(`Reveal gate watchdog revealed ${key} before its compiles settled`);
          const { ready, total } = gate.readiness(key, readiness);
          recordGpuPrepEvent({
            kind: 'reveal-watchdog',
            key,
            ageMs: gpuPrepNow() - requestedAtMs,
            readyRoots: ready,
            totalRoots: total,
          });
          noteRevealRootsAtWatchdog(total - ready);
          gate.settle(key);
        }, REVEAL_GATE_WATCHDOG_MS);
        let softMs = 0;
        if (host.expectedMs) {
          try {
            softMs = host.expectedMs(key, rootCount, roots);
          } catch (error) {
            console.error('Reveal gate expected-cost lookup failed', key, error);
          }
        }
        if (Number.isFinite(softMs) && softMs > 0 && softMs < REVEAL_GATE_WATCHDOG_MS) {
          cancelSoftDeadline = schedule(() => {
            if (settled || gate.state(key) === 'warm') return;
            const { ready, total } = gate.readiness(key, readiness);
            recordGpuPrepEvent({
              kind: 'reveal-soft-deadline',
              key,
              ageMs: gpuPrepNow() - requestedAtMs,
              readyRoots: ready,
              totalRoots: total,
            });
          }, softMs);
        }
        void Promise.all(compiles).then(() => {
          cancelWatchdog();
          cancelSoftDeadline();
          if (settled) return;
          settled = true;
          gate.settle(key);
        });
      };
      let startAfterInitialPaint: Promise<void> | null | undefined;
      try {
        startAfterInitialPaint = rootCount > 0 ? host.startAfterInitialPaint?.() : null;
      } catch (error) {
        console.error('Reveal gate initial-paint lookup failed', key, error);
      }
      if (startAfterInitialPaint) {
        void Promise.resolve(startAfterInitialPaint).then(startCompiles, startCompiles);
      } else {
        startCompiles();
      }
    },
    { onImminentHold: noteRevealImminentHold },
  );
  const allow = gate.allow;
  const revealGate = Object.assign(gate, {
    allow(key: string, imminent?: boolean): boolean {
      return allow(key, imminent === true || arrivalEstablishingShotActive());
    },
    noteRootRevealed(_key: string): void {
      noteRevealRootPiecewise();
    },
    noteRootRevealedAtReach(_key: string): void {
      noteRevealRootReach();
    },
  });
  registerRevealGateForArrival(revealGate);
  return revealGate;
}
