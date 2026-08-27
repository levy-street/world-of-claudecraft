// A compile gate as a REQUESTER of the shader warm worker: before a piece
// links, its programs are dry-assembled (program_sources.ts, the same arms
// the link will use), handed to the worker (shader_warm_client.ts), and the
// piece is submitted to the queue only once they are warm, so its link is a
// cache hit. A gate that cannot wait (the named bypasses in
// shader_warm_client_core.ts) submits as before; a gate whose hold outlives
// the cap submits cold and counts the miss. No new queue, no new lane: the
// pieces still ride the caller's own gate queue, one unit per piece, at the
// caller's priority and under the labels one submission would have given
// them; only WHEN each piece is submitted moves.
//
// The dry assembly is itself queue work: it runs three's assembly (the regex
// passes) once per piece, so it rides the gate queue as its own unit at the
// caller's priority, budgeted like a compile prologue, never on the frame
// that created the gate. A bypassed gate does no assembly at all: the policy
// is read first, and the mode-off arm is the pre-worker path to the byte.
// The audit (shader_warm_audit.ts, `?perf` only) gets the same sources from
// the assembly unit; a bypassed gate is announced through the audit's own
// dry pass, a no-op without the flags.

import type * as THREE from 'three';
import type { CompileArmHost } from './compile_arms';
import type { CompileGatePiece, CompileGateResult } from './compile_gate';
import { linkPiecesOf } from './compile_gate_pieces';
import { collectRootProgramSources, type ProgramSourceEntry } from './program_sources';
import { REVEAL_GATE_WATCHDOG_MS } from './reveal_gate';
import { announceProgramSources, expectRootProgramSources } from './shader_warm_audit';
import {
  noteShaderWarmAssembly,
  noteShaderWarmBypass,
  noteShaderWarmHold,
  shaderWarmDecide,
  warmShaderPrograms,
} from './shader_warm_client';

/** The longest a piece waits for its warm before it links cold: half the
 *  reveal watchdog (reveal_gate.ts), so a piece that gives up still leaves
 *  the queue the other half to link it before the hard escape reveals the
 *  root unlinked. At the full bound the two fired together and the cold
 *  link started with no budget left. */
export const SHADER_WARM_HOLD_CAP_MS = REVEAL_GATE_WATCHDOG_MS / 2;

/** Submit some of the gate's pieces to the caller's queue now; `firstIndex`
 *  is the index of `pieces[0]` in the gate's cut, so the unit labels match
 *  one whole submission's. */
export type WarmedPiecesSubmit = (
  pieces: CompileGatePiece[],
  firstIndex: number,
) => Promise<CompileGateResult>;

export interface WarmedPiecesOptions {
  priority: number;
  imminent: boolean;
  submit: WarmedPiecesSubmit;
  holdCapMs?: number;
  now?: () => number;
  /** Injectable timer for the hold cap; returns the cancel. */
  schedule?: (callback: () => void, ms: number) => () => void;
}

function defaultSchedule(callback: () => void, ms: number): () => void {
  const handle = setTimeout(callback, ms);
  return () => clearTimeout(handle);
}

function merge(results: CompileGateResult[]): CompileGateResult {
  return {
    failed: results.some((result) => result.failed),
    timedOut: results.some((result) => result.timedOut),
  };
}

/**
 * Run the gate's pieces (linkPieceWork's, in linkPiecesOf order) through the
 * worker when the policy says so. Resolves with the merged gate result once
 * every piece's submission settled, exactly as one `submit(pieces, 0)` would.
 */
export function runPiecesWarmed(
  arms: CompileArmHost,
  target: THREE.Object3D,
  pieces: CompileGatePiece[],
  options: WarmedPiecesOptions,
): Promise<CompileGateResult> {
  const { priority, submit } = options;
  if (pieces.length === 0) return submit(pieces, 0);
  let context: ReturnType<NonNullable<CompileArmHost['context']>> = null;
  try {
    context = arms.context?.() ?? null;
  } catch {
    // A context on its way out: the gate links as before.
    context = null;
  }
  const decision = context
    ? shaderWarmDecide(context, priority, options.imminent)
    : ({ hold: false, bypass: 'unavailable' } as const);
  if (!decision.hold) {
    if (!context) noteShaderWarmBypass('unavailable');
    // The audit's own dry pass, a no-op without the perf flags.
    for (const [representative] of linkPiecesOf(target)) {
      expectRootProgramSources(arms, representative);
    }
    return submit(pieces, 0);
  }
  const representatives = linkPiecesOf(target).map(([representative]) => representative);
  if (representatives.length !== pieces.length) {
    noteShaderWarmBypass('piece-mismatch');
    return submit(pieces, 0);
  }
  const now = options.now ?? (() => performance.now());
  const schedule = options.schedule ?? defaultSchedule;
  const holdCapMs = options.holdCapMs ?? SHADER_WARM_HOLD_CAP_MS;
  let anyHeld = false;
  const settled = pieces.map((piece, index) => {
    const representative = representatives[index];
    if (!representative) return submit([piece], index);
    // The assembly unit: rides the queue, announces to the audit, asks the
    // worker, and resolves at once (the hold waits outside the queue, so no
    // unit holds a slot while the worker links).
    let sources: ProgramSourceEntry[] = [];
    let warm: Promise<boolean> | null = null;
    const assemble: CompileGatePiece = () => {
      const started = now();
      try {
        sources = collectRootProgramSources(arms, representative);
        announceProgramSources(arms, representative, sources);
      } catch {
        sources = [];
      }
      noteShaderWarmAssembly(now() - started);
      if (sources.length > 0) {
        warm = warmShaderPrograms(sources, priority).then(
          (outcomes) => outcomes.every((outcome) => outcome === 'warmed'),
          () => false,
        );
      }
      return Promise.resolve();
    };
    return submit([assemble], index).then((assembled) => {
      const pending = warm;
      if (!pending || assembled.failed) return submit([piece], index);
      anyHeld = true;
      const startedAt = now();
      return new Promise<CompileGateResult>((resolve, reject) => {
        let done = false;
        let cancelCap: () => void = () => {};
        const finish = (isWarm: boolean, timedOut: boolean): void => {
          if (done) return;
          done = true;
          cancelCap();
          noteShaderWarmHold(isWarm, timedOut, now() - startedAt);
          submit([piece], index).then(resolve, reject);
        };
        cancelCap = schedule(() => finish(false, true), holdCapMs);
        pending.then((isWarm) => finish(isWarm, false));
      });
    });
  });
  return Promise.all(settled).then((results) => {
    if (!anyHeld) noteShaderWarmBypass('nothing-to-warm');
    return merge(results);
  });
}
