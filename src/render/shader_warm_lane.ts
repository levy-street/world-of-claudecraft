// The shader warm worker for the LANES that link whole roots as queue units
// (the streamed-zone prepares, the post-paint resume of the boot manifest,
// the local player's ghost variants): the same "ask, wait, then link" the
// gates do (shader_warm_gate.ts), shaped for a caller that runs one unit per
// root through background_gpu_queue.run, or that must assemble under a
// material swap it cannot hold across a wait.
//
// The queue is serial by default (a unit occupies it until its promise
// settles), so the wait for the worker never happens inside a unit: the dry
// assembly rides the queue as its own unit at the caller's priority, the
// hold runs between units, and the caller submits its link unit afterwards,
// exactly as it did before. A bypass (mode off, not armed, no worker) costs
// one policy read and nothing else.

import type * as THREE from 'three';
import type { CompileArmHost } from './compile_arms';
import { collectRootProgramSources } from './program_sources';
import { REVEAL_GATE_WATCHDOG_MS } from './reveal_gate';
import { announceProgramSources, expectRootProgramSources } from './shader_warm_audit';
import {
  holdShaderPrograms,
  noteShaderWarmAssembly,
  noteShaderWarmBypass,
  noteShaderWarmHold,
  shaderWarmDecide,
} from './shader_warm_client';

/** The longest a lane waits for a root's warm before it links cold: the
 *  gates' own cap (half the reveal watchdog). */
export const SHADER_WARM_LANE_HOLD_CAP_MS = REVEAL_GATE_WATCHDOG_MS / 2;

/** The caller's queue: a unit at a priority under a label. */
export type WarmLaneRun = (
  work: () => unknown | Promise<unknown>,
  priority: number,
  label: string,
) => Promise<unknown>;

export interface WarmRootOptions {
  priority: number;
  /** The label of the assembly unit (a `kind:instance` the budget can learn). */
  label: string;
  run: WarmLaneRun;
  /** The colour arm's offscreen variant too (the zone prewarm compiles it). */
  includeOffscreenVariant?: boolean;
  holdCapMs?: number;
  now?: () => number;
  schedule?: (callback: () => void, ms: number) => () => void;
}

export interface HoldOutcome {
  warm: boolean;
  timedOut: boolean;
  holdMs: number;
}

/** A root's warm request as the lanes hand it around: the promise a hold
 *  waits on, and the way to give the request up when the hold expires (the
 *  root links cold then, and the worker must not spend a slot on it). */
export interface RootWarmRequest {
  warm: Promise<boolean>;
  abandon(): void;
  /** When the cap clock this request is bounded by started, on the lane's own
   *  clock. The request is made INSIDE a queue unit and the hold begins when
   *  that unit's promise settles, so a lane that let the two drift would tell
   *  the client a cap it does not own (shader_warm_client.ts, the
   *  cannot-serve rule). Absent on a caller's own stand-in: the hold then
   *  starts its clock itself. */
  startedAtMs?: number;
}

function defaultSchedule(callback: () => void, ms: number): () => void {
  const handle = setTimeout(callback, ms);
  return () => clearTimeout(handle);
}

const defaultNow = (): number => performance.now();

/** Wait for a warm, bounded by the cap; a late warm after the cap is ignored,
 *  and the request behind it is abandoned (the root links cold now).
 *
 *  The cap clock starts where the REQUEST was made, not where this hold was
 *  entered: the assembly rides a serial queue whose unit can settle well after
 *  it ran, and the client was told the request's instant, so a clock started
 *  here would leave the two pricing different windows and the client's
 *  cannot-serve rule reading a cap that had already run down. */
export function holdForWarm(
  request: RootWarmRequest,
  holdCapMs: number,
  now: () => number = defaultNow,
  schedule: (callback: () => void, ms: number) => () => void = defaultSchedule,
): Promise<HoldOutcome> {
  const enteredAt = now();
  const startedAt = request.startedAtMs ?? enteredAt;
  const remainingMs = Math.max(0, holdCapMs - (enteredAt - startedAt));
  return new Promise<HoldOutcome>((resolve) => {
    let done = false;
    let cancelCap: () => void = () => {};
    const finish = (isWarm: boolean, timedOut: boolean): void => {
      if (done) return;
      done = true;
      cancelCap();
      resolve({ warm: isWarm, timedOut, holdMs: now() - startedAt });
    };
    cancelCap = schedule(() => {
      request.abandon();
      finish(false, true);
    }, remainingMs);
    request.warm.then(
      (isWarm) => finish(isWarm, false),
      () => finish(false, false),
    );
  });
}

/**
 * Ask the worker for `root`'s programs NOW, synchronously on the caller's
 * frame: the dry assembly under whatever state the caller set (a material
 * swap it cannot hold across a wait), the audit announcement, the request.
 * Returns the warm promise, or null on a bypass or when there is nothing
 * to warm (the audit still sees the root). Never throws.
 */
export function requestRootWarm(
  arms: CompileArmHost,
  root: THREE.Object3D,
  priority: number,
  includeOffscreenVariant = false,
  now: () => number = defaultNow,
  holdCapMs: number = SHADER_WARM_LANE_HOLD_CAP_MS,
): RootWarmRequest | null {
  if (!decideRootWarm(arms, root, priority, includeOffscreenVariant)) return null;
  return requestDecidedRootWarm(arms, root, priority, includeOffscreenVariant, now, holdCapMs);
}

/** The request once the policy said hold: the one place that assembles. A
 *  dry assembly that throws (no patch, a renderer on its way out) is the
 *  worker being unavailable to this root; an empty one is nothing to warm.
 *  The cap goes in with the request, and so does the instant it starts at:
 *  the client judges the worker against the bound this lane will actually
 *  give up at, over the window this lane actually owns
 *  (shader_warm_client.ts). */
function requestDecidedRootWarm(
  arms: CompileArmHost,
  root: THREE.Object3D,
  priority: number,
  includeOffscreenVariant: boolean,
  now: () => number,
  holdCapMs: number,
): RootWarmRequest | null {
  const started = now();
  let sources: ReturnType<typeof collectRootProgramSources> | null = null;
  try {
    sources = collectRootProgramSources(arms, root, includeOffscreenVariant);
    announceProgramSources(arms, root, sources);
  } catch {
    sources = null;
  }
  noteShaderWarmAssembly(now() - started);
  if (sources === null) {
    noteShaderWarmBypass('unavailable');
    return null;
  }
  if (sources.length === 0) {
    noteShaderWarmBypass('nothing-to-warm');
    return null;
  }
  const startedAtMs = now();
  const hold = holdShaderPrograms(sources, priority, holdCapMs, startedAtMs);
  return {
    warm: hold.settled.then(
      (outcomes) => outcomes.every((outcome) => outcome === 'warmed'),
      () => false,
    ),
    abandon: hold.abandon,
    startedAtMs,
  };
}

/** The hold on a request, counted in the readout. Never throws. */
export async function holdRootWarm(
  request: RootWarmRequest,
  holdCapMs: number = SHADER_WARM_LANE_HOLD_CAP_MS,
  now: () => number = defaultNow,
  schedule?: (callback: () => void, ms: number) => () => void,
): Promise<HoldOutcome> {
  const outcome = await holdForWarm(request, holdCapMs, now, schedule);
  try {
    noteShaderWarmHold(outcome.warm, outcome.timedOut, outcome.holdMs);
  } catch {
    // The readout (and the breaker it may trip) never reaches the lane.
  }
  return outcome;
}

/**
 * Warm `root`'s programs ahead of its link, when the policy holds, the dry
 * assembly riding the caller's queue as its own unit. Resolves once they are
 * warm, on the cap, or at once on a bypass; the caller then runs its link
 * unit as before. Never throws.
 */
export async function warmRootBeforeLink(
  arms: CompileArmHost,
  root: THREE.Object3D,
  options: WarmRootOptions,
): Promise<HoldOutcome | null> {
  const includeOffscreenVariant = options.includeOffscreenVariant ?? false;
  // The policy first, on the caller's frame: a bypassed root costs no unit.
  if (!decideRootWarm(arms, root, options.priority, includeOffscreenVariant)) return null;
  const now = options.now ?? defaultNow;
  const holdCapMs = options.holdCapMs ?? SHADER_WARM_LANE_HOLD_CAP_MS;
  const request: { warm: RootWarmRequest | null } = { warm: null };
  try {
    await options.run(
      () => {
        request.warm = requestDecidedRootWarm(
          arms,
          root,
          options.priority,
          includeOffscreenVariant,
          now,
          holdCapMs,
        );
      },
      options.priority,
      options.label,
    );
  } catch {
    // The queue refused the unit (a shutdown): the worker is unavailable to
    // this root, the link goes cold, counted.
    noteShaderWarmBypass('unavailable');
    request.warm = null;
  }
  if (!request.warm) return null;
  return holdRootWarm(request.warm, holdCapMs, now, options.schedule);
}

/** The policy read, with the audit announcement on a bypass (the same
 *  variants the lane would have linked). */
function decideRootWarm(
  arms: CompileArmHost,
  root: THREE.Object3D,
  priority: number,
  includeOffscreenVariant: boolean,
): boolean {
  let context: ReturnType<NonNullable<CompileArmHost['context']>> = null;
  try {
    context = arms.context?.() ?? null;
  } catch {
    context = null;
  }
  const decision = context
    ? shaderWarmDecide(context, priority, false)
    : ({ hold: false, bypass: 'unavailable' } as const);
  if (decision.hold) return true;
  if (!context) noteShaderWarmBypass('unavailable');
  expectRootProgramSources(arms, root, undefined, includeOffscreenVariant);
  return false;
}

/** Warm several roots (a batch unit's) ahead of their link: every root is
 *  asked first, so the worker paces the whole set, then the hold covers the
 *  slowest. */
export async function warmRootsBeforeLink(
  arms: CompileArmHost,
  roots: readonly THREE.Object3D[],
  options: WarmRootOptions,
): Promise<void> {
  await Promise.all(roots.map((root) => warmRootBeforeLink(arms, root, options)));
}
