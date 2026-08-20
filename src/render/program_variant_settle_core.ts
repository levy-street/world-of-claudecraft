// The host-agnostic half of a compile gate piece's variant settle
// (program_variant_settle.ts): which linked programs of the piece still need
// a readiness poll, what one poll pass concludes about them, and how the next
// pass is spaced. Three-free (RENDER_PURE_CORES, tests/architecture.test.ts):
// a plain Vitest drives it with stub programs.
//
// Why a settle beyond compileAsync. three's compileAsync polls ONE program per
// material, `materialProperties.currentProgram`, the variant the last
// acquisition for that material resolved to, and drops the material from its
// pending set once that slot answers ready. A material one piece links can
// carry several variants at once in `materialProperties.programs` (skinned
// and rigid, morph counts, the shadow depth twin's own map), and a material
// SHARED by concurrent gates (the composed bodies' skin detail, jewels and
// class tints) has its current slot repointed by another gate's prologue
// mid-poll, so a compileAsync that resolved proved only the slot it happened
// to poll last: the sibling variants link unpolled, are never marked ready,
// the touch tail skips them, and they pay their link at their first draw or
// uniform query in a live frame (production 2026-08-18: 28 composed-body
// programs, 39 to 125 ms each, 808 ms in five minutes). The settle enumerates
// EVERY variant of the piece's materials and polls each until it answers
// ready or the piece's deadline fires.

/** The slice of a three WebGLProgram the poll needs. `isReady()` is three's
 *  own KHR_parallel_shader_compile completion query and a synchronous driver
 *  round trip whenever its cached answer is a latched false, so it is asked
 *  ONLY from the gate's asynchronous poll (spaced like three's own
 *  compileAsync poll), never from a synchronous walk on the draw path
 *  (linked_program_readiness.ts owns that rule). */
export interface PollableProgramLike {
  isReady(): boolean;
}

/** three's compileAsync reschedule interval at its floor: `POLL_INTERVAL_MIN_MS`
 *  inside the patched WebGLRenderer.compileAsync, a local constant three does
 *  not export. A cadence, not a hold: the piece's deadline bounds the wait. */
export const PROGRAM_VARIANT_POLL_INTERVAL_MS = 10;

/** three's cap on the same interval (`POLL_INTERVAL_MAX_MS`), reached by
 *  doubling while passes stay expensive. */
export const PROGRAM_VARIANT_POLL_INTERVAL_MAX_MS = 320;

/** three's `POLL_PASS_BUDGET_MS`: a pass that cost at least this much had
 *  queries waiting on the GPU process, so readiness is far and the next pass
 *  backs off. */
export const PROGRAM_VARIANT_POLL_PASS_BUDGET_MS = 2;

/** Every distinct program across `programSets` that no settle has proved
 *  ready yet, first-seen order kept. A set may be missing (a material three
 *  never prepared has no `programs` map). */
export function pendingProgramVariants<P>(
  programSets: Iterable<Iterable<P> | undefined>,
  isKnownReady: (program: P) => boolean,
): P[] {
  const pending: P[] = [];
  const seen = new Set<P>();
  for (const programs of programSets) {
    if (!programs) continue;
    for (const program of programs) {
      if (seen.has(program)) continue;
      seen.add(program);
      if (!isKnownReady(program)) pending.push(program);
    }
  }
  return pending;
}

export interface ProgramVariantPollPass<P> {
  /** The programs that answered ready on this pass, in order. */
  ready: P[];
  /** The programs still linking after this pass, in order. */
  pending: P[];
}

/** One poll pass: every pending program asked exactly once. */
export function pollProgramVariants<P extends PollableProgramLike>(
  pending: readonly P[],
): ProgramVariantPollPass<P> {
  const ready: P[] = [];
  const stillPending: P[] = [];
  for (const program of pending) {
    if (program.isReady()) ready.push(program);
    else stillPending.push(program);
  }
  return { ready, pending: stillPending };
}

/** The interval before the next pass, three's own rule: a cheap pass resets
 *  to the floor, an expensive one doubles the current interval up to the cap,
 *  whether or not it made progress (expensive queries mean readiness is far
 *  anyway, and N concurrent pollers each paying a slow query at the floor
 *  would own the main thread). */
export function nextProgramVariantPollMs(passMs: number, currentMs: number): number {
  return passMs < PROGRAM_VARIANT_POLL_PASS_BUDGET_MS
    ? PROGRAM_VARIANT_POLL_INTERVAL_MS
    : Math.min(PROGRAM_VARIANT_POLL_INTERVAL_MAX_MS, currentMs * 2);
}
