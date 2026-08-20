// Shared fail-soft coordinator for the renderer's async shader-compile gates:
// new-view creation (Renderer.gateViewOnCompile) and live material-variant
// swaps on an already-visible entity. KHR_parallel_shader_compile lets a
// program link off the main thread, but the returned work cannot be cancelled.
// A timeout is therefore diagnostic only: revealing the target at that point
// would make its first draw synchronously finish the same link while the async
// compile remains active. The queue also BOUNDS how many streamed views can
// have driver link work in flight during an online snapshot burst: the shared
// queue's released-tail cap, or strict serialization on the local fallback.

import type { GpuWorkRunOptions } from './background_gpu_queue';
import { recordGpuPrepEvent } from './gpu_prep_events';
import { linkPieceLabel } from './link_piece_core';

export interface CompileGateScheduler {
  setTimeout: (cb: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
}

export interface CompileGateResult {
  failed: boolean;
  timedOut: boolean;
}

export interface CompileGateOptions {
  onTimeout?: () => void;
  /** Off switches the default `gate-timeout` telemetry for this gate; the
   *  caller's own onTimeout still runs. */
  recordTimeoutEvent?: boolean;
  priority?: number;
  /** Names this gate's unit in the shared queue's per-unit timing stats. */
  label?: string;
  scheduler?: CompileGateScheduler;
}

/** What a gate piece may read of its OWN deadline: whether it has fired. A
 *  piece that keeps polling the driver after its compile resolves (the
 *  variant settle, program_variant_settle.ts) ends that poll here, so the one
 *  timeout constant still bounds the whole piece; a closed gate (its queue
 *  rejected) reads as fired, so nothing polls a context that is going away. */
export interface PieceDeadline {
  readonly fired: boolean;
}

/** One queue unit of a pieced gate: the compile of one material group, handed
 *  its own deadline. */
export type CompileGatePiece = (deadline: PieceDeadline) => Promise<unknown>;

export interface CompileGateWorkQueue {
  run<T>(
    work: () => T | Promise<T>,
    priority?: number,
    label?: string,
    options?: GpuWorkRunOptions,
  ): Promise<T>;
}

const defaultScheduler: CompileGateScheduler = {
  setTimeout: (cb, ms) => setTimeout(cb, ms) as unknown as number,
  clearTimeout: (id) => clearTimeout(id),
};

/**
 * Waits for one non-cancellable compile to settle. The timeout records a slow
 * driver and may notify diagnostics, but never resolves the gate early. A
 * rejection or synchronous throw is fail-soft because no compile remains
 * active and the caller can safely fall back to first-draw compilation.
 *
 * The timeout also lands in the GPU-preparation ring by default, so a capture
 * can count slow links instead of the timeout being inert whenever no caller
 * passes onTimeout. That record is write-only telemetry: the gate's own
 * decisions never read it back, which is what keeps this module deterministic
 * (its ageMs is the deadline that elapsed, not a clock reading).
 */
function reportGateTimeout(timeoutMs: number, options: CompileGateOptions): void {
  if (options.recordTimeoutEvent !== false) {
    recordGpuPrepEvent({
      kind: 'gate-timeout',
      key: options.label ?? 'compile-gate',
      ageMs: timeoutMs,
    });
  }
  options.onTimeout?.();
}

/** A piece's settle, fail-soft like the whole gate's: a rejection or a
 *  synchronous throw leaves no compile active, so it only marks the piece
 *  failed. */
function settleCompilePiece(piece: () => Promise<unknown>): Promise<boolean> {
  try {
    return piece().then(
      () => false,
      () => true,
    );
  } catch {
    return Promise.resolve(true);
  }
}

export function awaitCompileGate(
  compile: () => Promise<unknown>,
  timeoutMs: number,
  options: CompileGateOptions = {},
): Promise<CompileGateResult> {
  const scheduler = options.scheduler ?? defaultScheduler;
  return new Promise<CompileGateResult>((resolve) => {
    let timedOut = false;
    let settled = false;
    const guard = scheduler.setTimeout(() => {
      if (settled) return;
      timedOut = true;
      reportGateTimeout(timeoutMs, options);
    }, timeoutMs);
    const finish = (failed: boolean): void => {
      if (settled) return;
      settled = true;
      scheduler.clearTimeout(guard);
      resolve({ failed, timedOut });
    };
    try {
      compile().then(
        () => finish(false),
        () => finish(true),
      );
    } catch {
      finish(true);
    }
  });
}

/** Bounds live compile gates so online entity bursts cannot pile up driver
 *  work: strictly serial on the local fallback, cap-bounded on the shared
 *  queue. There, a gate declares releaseTail: after the synchronous compile
 *  prologue, the awaited remainder is the driver's off-thread link (three
 *  polls KHR_parallel_shader_compile on a timer), so the queue keeps draining
 *  other lanes while it settles, under the queue's released-tail cap. Gates
 *  may therefore overlap and settle OUT OF ORDER. The gate's own contract is
 *  unchanged: its result still resolves only when the link settles, so a
 *  gated view is revealed no earlier than before. */
export class CompileGateQueue {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly sharedQueue?: CompileGateWorkQueue) {}

  run(
    compile: () => Promise<unknown>,
    timeoutMs: number,
    options: CompileGateOptions = {},
  ): Promise<CompileGateResult> {
    return this.submit(() => awaitCompileGate(compile, timeoutMs, options), options);
  }

  /**
   * One gate cut into pieces (compile_gate_pieces.ts: one per material group
   * of the root), each its own queue unit labelled `${label}:${index}`, so
   * the queue paces the driver's per-program work between them and its
   * released-tail cap bounds how many of the gate's links pile on the driver
   * at once. The deadline is PER PIECE: each piece arms `timeoutMs` when its
   * own work starts and disarms it when it settles, so the constant keeps
   * the meaning it had for a whole root (the driver latency of one unit) and
   * the queue's pacing between pieces never burns it. The gate times out
   * when any piece does (recorded once per gate, under the gate label, by
   * the first piece to fire). The result aggregates the pieces (any failure
   * fails it) and resolves only when every piece settled, so readiness
   * marking and the reveal happen exactly as for a whole-root gate. Serial
   * on the local fallback. Each piece receives its own deadline, so work it
   * runs after its compile resolves (the variant settle) ends when that
   * deadline fires: such a piece resolves with the gate already timed out.
   */
  runPieces(
    pieces: CompileGatePiece[],
    timeoutMs: number,
    options: CompileGateOptions = {},
  ): Promise<CompileGateResult> {
    if (pieces.length === 0) return Promise.resolve({ failed: false, timedOut: false });
    const scheduler = options.scheduler ?? defaultScheduler;
    let timedOut = false;
    // The queue rejected the gate (shutdown): live timers are cleared and a
    // piece released after that arms none, so a closed gate records nothing.
    let closed = false;
    const armed = new Set<number>();
    const disarmAll = (): void => {
      closed = true;
      for (const guard of armed) scheduler.clearTimeout(guard);
      armed.clear();
    };
    const closedDeadline: PieceDeadline = { fired: true };
    const settled = pieces.map((piece, index) =>
      this.submit(
        () => {
          if (closed) return settleCompilePiece(() => piece(closedDeadline));
          let pieceSettled = false;
          let fired = false;
          // Reads the closed flag too: a disarmed timer never fires, and a
          // piece still polling past that must stop as if it had.
          const deadline: PieceDeadline = {
            get fired() {
              return fired || closed;
            },
          };
          const guard = scheduler.setTimeout(() => {
            armed.delete(guard);
            if (pieceSettled) return;
            fired = true;
            const first = !timedOut;
            timedOut = true;
            if (first) reportGateTimeout(timeoutMs, options);
          }, timeoutMs);
          armed.add(guard);
          return settleCompilePiece(() => piece(deadline)).then((failed) => {
            pieceSettled = true;
            if (armed.delete(guard)) scheduler.clearTimeout(guard);
            return failed;
          });
        },
        options.label === undefined
          ? options
          : { ...options, label: linkPieceLabel(options.label, index) },
      ),
    );
    return Promise.all(settled).then(
      (failures) => ({ failed: failures.some(Boolean), timedOut }),
      (error) => {
        disarmAll();
        throw error;
      },
    );
  }

  private submit<T>(work: () => Promise<T>, options: CompileGateOptions): Promise<T> {
    if (this.sharedQueue) {
      return this.sharedQueue.run(work, options.priority, options.label, { releaseTail: true });
    }
    const result = this.tail.then(work);
    this.tail = result;
    return result;
  }
}

/**
 * Strictly serial lane for gates whose targets arrive in a BURST and whose
 * first draw pays for every link still in flight on the driver: the composed
 * far bakes of a crowd crossing the far band (twenty wraps minted inside a
 * second). Released tails let all of their links pile onto the driver's compile
 * threads at once, and on drivers that finish a program lazily at its first
 * use (measured on the Intel iGPU: 360 to 380 ms for one settled program
 * behind a dozen queued links) the settled bake still stalled. One gate's link
 * at a time, in arrival order, keeps that queue one wrap deep. `start` runs the
 * gate and must call the settle callback exactly once (also on failure), or the
 * lane stalls; the renderer's gates always do (recovery calls it too).
 */
export class SerialGateLane {
  private tail: Promise<void> = Promise.resolve();
  private depth = 0;

  /** Gates enqueued and not yet settled (diagnostics and tests). */
  get pending(): number {
    return this.depth;
  }

  /** Queue one gate: `start` runs when the lane is free and gets the settle
   *  callback to hand to the gate; `onSettled` (the caller's own reaction)
   *  runs on that settle, before the next gate starts. */
  enqueue(start: (settled: () => void) => void, onSettled: () => void = () => {}): void {
    this.depth++;
    this.tail = this.tail.then(
      () =>
        new Promise<void>((resolve) => {
          let done = false;
          start(() => {
            if (done) return;
            done = true;
            this.depth--;
            onSettled();
            resolve();
          });
        }),
    );
  }
}

/**
 * Clears a shared "which target is this pending swap for" token, but only if it
 * still names `owner`. Some renderer.ts call sites reuse ONE EntityView field
 * across a family of mutually exclusive gated swaps instead of one pending flag
 * per swap target (e.g. shapeshift-form creation: sheep/bear/cat/travel share a
 * single formCompilePending token because at most one of them is ever active or
 * newly built per entity per frame). The shared CompileGateQueue bounds gates
 * to a small overlap (they can settle out of order), so a NEWER swap can be
 * registered, or even settle, while an OLDER one is still in flight (a fast
 * form-to-form reswap before the first compile settles).
 * Without this guard, the older gate's onSettled would clear the token as soon
 * as it resolves, revealing the newer target before its own compile is done:
 * exactly the freeze this gate exists to prevent. Passing the raw setter
 * (`current => null`) instead of this guard is only safe when the field is
 * dedicated to a single target, as mountCompilePending/visualCompilePending are.
 */
export function settlePendingSwap<T>(current: T | null, owner: T): T | null {
  return current === owner ? null : current;
}
