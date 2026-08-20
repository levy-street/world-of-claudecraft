// Sub-span telemetry for the CPU build ledger: a producer that wants the
// STEPS inside one build timed (the composed character body: assemble,
// materials, halo, far bake, mixer) wraps each step in `timeBuildSpan` and the
// renderer routes the spans into its ledger (`setBuildSpanSink`). Host module:
// it reads the clock, so it is not a pure core; nothing here decides anything.
// Kinds prefixed `view-part:` file under the ledger's `part` lane
// (build_ledger_core.buildLedgerLane): kept per kind, out of the frame spend,
// the worst frame and the slowest ring, so a sub-span never double counts the
// milliseconds its enclosing `view:<class>` build already owns.

export type BuildSpanSink = (kind: string, ms: number, atMs: number) => void;

let sink: BuildSpanSink | null = null;

export function setBuildSpanSink(next: BuildSpanSink | null): void {
  sink = next;
}

/** No-op when no sink is installed. */
export function recordBuildSpan(kind: string, ms: number, atMs: number): void {
  if (sink) sink(kind, ms, atMs);
}

/** Runs `run`, records its main-thread ms under `kind`, and returns its
 *  result. A throw is recorded too, then rethrown, so a failed build still
 *  shows the time it burned. */
export function timeBuildSpan<T>(kind: string, run: () => T): T {
  const started = performance.now();
  try {
    return run();
  } finally {
    recordBuildSpan(kind, performance.now() - started, started);
  }
}
