// Which shader programs the driver minted INSIDE a live draw, after the
// loading curtain is gone.
//
// Everything else in the prep machinery reports what it PREPARED. Nothing
// reported what escaped: a variant no prewarm entry covered links on its first
// draw, synchronously, and the only way to see it was the external capture kit
// (scripts/profiler). three keeps the answer in plain sight, because
// `renderer.info.programs` is the live WebGLProgram list, so a diff of that list
// around the frame's render call names every program a session minted there.
//
// AROUND the render call, not per frame: compileAsync's synchronous prologue
// also pushes WebGLPrograms onto that list, so every gate, prewarm piece and
// background compile mints programs between two frames legitimately. The host
// therefore ABSORBS the list right before it draws (those are prep) and
// collects right after (those are escapes).
//
// Pure bookkeeping: no Three, no DOM, no clock. The renderer hands in the list
// and records the labels this returns; the diff itself is host-agnostic, which
// is what makes it testable without a GL context.
//
// Allocation discipline (this runs every frame): the list LENGTH is compared
// first and the walk happens only when it moved, the walk itself is one
// number compare per entry against the id high-water mark (three's program
// ids are monotonic), and the labels land in a caller-owned array; only a
// program that IS new costs a string.

/** The fields this core reads off three's WebGLProgram. */
export interface LiveProgramEntry {
  /** three's monotonically increasing program id (WebGLProgram `id`). */
  id?: number;
  cacheKey?: string;
  /** three's shader name, which for a built-in material IS its type. */
  name?: string;
}

export interface LiveProgramWatch {
  /** The highest program id adopted so far: three mints ids monotonically
   *  (WebGLProgram's programIdCount), so everything at or below it is known
   *  and a walk needs one number compare per entry, no allocation. */
  maxId: number;
  /** Identities of programs that carry no numeric id (a host other than
   *  three's), so a walk can still tell them apart. Bounded by such programs
   *  ever seen, which is none with three. */
  knownWithoutId: Set<string>;
  lastLength: number;
  armed: boolean;
}

export function createLiveProgramWatch(): LiveProgramWatch {
  return { maxId: -1, knownWithoutId: new Set<string>(), lastLength: 0, armed: false };
}

/**
 * How a program is remembered. The id first: three mints it once per LINK
 * (programIdCount++), so a cache hit keeps its id and a genuinely new link
 * always brings a fresh one, which a cacheKey alone cannot say after a
 * program was released and relinked.
 */
export function liveProgramIdentity(program: LiveProgramEntry): string {
  if (typeof program.id === 'number') return `#${program.id}`;
  return program.cacheKey ?? program.name ?? '';
}

/** What the recorded event is named after. */
export function liveProgramLabel(program: LiveProgramEntry): string {
  return program.name || program.cacheKey || 'program';
}

/** True when `program` is not yet known to `watch`; adopting it as known is
 *  the caller's call (absorb and collect both do, collect reports it too). */
function adopt(watch: LiveProgramWatch, program: LiveProgramEntry): boolean {
  if (typeof program.id === 'number') {
    if (program.id <= watch.maxId) return false;
    watch.maxId = program.id;
    return true;
  }
  const identity = program.cacheKey ?? program.name ?? '';
  if (watch.knownWithoutId.has(identity)) return false;
  watch.knownWithoutId.add(identity);
  return true;
}

/**
 * Adopt the current list as the baseline and start watching. Called at the
 * reveal receipt: every program linked behind the curtain is prep, not an
 * escape, so only what appears AFTER this point is reported.
 */
export function armLiveProgramWatch(
  watch: LiveProgramWatch,
  programs: readonly LiveProgramEntry[] | undefined,
): void {
  disarmLiveProgramWatch(watch);
  watch.armed = true;
  if (!programs) return;
  for (const program of programs) adopt(watch, program);
  watch.lastLength = programs.length;
}

export function disarmLiveProgramWatch(watch: LiveProgramWatch): void {
  watch.armed = false;
  watch.maxId = -1;
  watch.knownWithoutId.clear();
  watch.lastLength = 0;
}

/**
 * Adopt every program minted since the last call as prep, silently. Called
 * right before the frame's render: what the queue's compile prologues pushed
 * between two frames is preparation, and only what the draw itself mints
 * afterwards is an escape. Same cost profile as the collect below.
 */
export function absorbLivePrograms(
  watch: LiveProgramWatch,
  programs: readonly LiveProgramEntry[] | undefined,
): void {
  if (!watch.armed || !programs) return;
  if (programs.length === watch.lastLength) return;
  for (const program of programs) adopt(watch, program);
  watch.lastLength = programs.length;
}

/**
 * Labels of the programs that appeared since the last absorb or collect,
 * pushed into `out` (caller-owned, cleared here). Zero work before the arm,
 * and zero beyond a length compare on a draw that left the list as long as
 * it was; a walk (when the length moved either way) is one number compare
 * per entry, and only a NEW program costs a label.
 *
 * A list that shrank is three destroying a program (under the repo's patch a
 * released program stays listed, parked, until the retention bound evicts
 * it; only that eviction shrinks the list); the walk still runs, so a destroy
 * and a mint inside the same interval that happen to cancel out in length
 * are the one shape this misses (a destroyed id is never reused, so nothing
 * else is; a parked program re-acquired keeps its id and is no mint). Memory
 * is two numbers with three: the id high-water mark and the last length.
 */
export function collectNewLivePrograms(
  watch: LiveProgramWatch,
  programs: readonly LiveProgramEntry[] | undefined,
  out: string[],
): number {
  out.length = 0;
  if (!watch.armed || !programs) return 0;
  if (programs.length === watch.lastLength) return 0;
  for (const program of programs) {
    if (adopt(watch, program)) out.push(liveProgramLabel(program));
  }
  watch.lastLength = programs.length;
  return out.length;
}
