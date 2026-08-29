// One-shot ownership boundary between one curtained entry and post-manifest
// GPU debt. The page-entry coordinator owns an instance and releases it only
// after a world frame paints; direct/rebuild prewarms omit the gate.

export interface PrewarmResumeStartGate {
  readonly wait: Promise<void>;
  release(): void;
  armBackstop(options: PrewarmResumeStartGateBackstop): void;
}

export interface PrewarmResumeStartGateBackstop {
  timeoutMs: number;
  schedule(onTimeout: () => void, ms: number): () => void;
}

export const PREWARM_RESUME_START_BACKSTOP_MS = 2_000;

export function createPrewarmResumeStartGate(
  initialBackstop?: PrewarmResumeStartGateBackstop,
): PrewarmResumeStartGate {
  let resolveWait!: () => void;
  let settled = false;
  let cancelBackstop: (() => void) | null = null;
  const wait = new Promise<void>((resolve) => {
    resolveWait = resolve;
  });
  const release = (): void => {
    if (settled) return;
    settled = true;
    cancelBackstop?.();
    cancelBackstop = null;
    resolveWait();
  };
  const armBackstop = (options: PrewarmResumeStartGateBackstop): void => {
    if (settled || cancelBackstop) return;
    cancelBackstop = options.schedule(release, Math.max(0, options.timeoutMs));
  };
  const gate = { wait, release, armBackstop };
  if (initialBackstop) armBackstop(initialBackstop);
  return gate;
}
