// The character sheet / Inspect COLD-OPEN gate, the pure half.
//
// Opening the sheet used to pay every unlinked program of the paperdoll
// context inside one synchronous draw (measured 131 to 293 ms on the 3090,
// 387 to 434 ms on the Intel iGPU) because nothing else ever compiles on that
// second context: the only compileAsync lives in CharacterPreview.prewarm, and
// the post-entry lane that drives it PAUSES while the sheet is open. The gate
// holds the preview's draws while the host links, uploads and touches, then
// reveals; the host shows a 2D stand-in for the whole armed window.
//
// This module owns the decisions and no Three, no DOM and no clock: the host
// passes the reading it already has, so a test can pin an exact escape age
// instead of racing a timer.
//
// Two rules the measurements paid for:
// - ALREADY-LINKED SKIP. One `linked` signature is shared with prewarm(), so a
//   scheduled warm and an open never compile the same visual twice, and a
//   per-skin prewarm unit after the first still does its texture work while
//   skipping its compileAsync.
// - A BOUNDED ESCAPE. A driver link is not cancellable and a lost context
//   never resolves, so an unbounded hold would leave the sheet EMPTY forever:
//   the reveal-watchdog defect again. Past the soft deadline the host draws
//   anyway and records the escape once (takeEscape), exactly like the reveal
//   gates' soft deadline.

/** Soft deadline for one armed window. Long enough for a cold link plus its
 *  touch pieces on the slowest machine measured (434 ms), short enough that a
 *  stuck driver shows the player a character instead of an empty panel. */
export const PREVIEW_OPEN_GATE_ESCAPE_MS = 1500;

interface PreviewOpenGateOptions {
  escapeMs?: number;
}

export interface PreviewOpenGate {
  /** Arm for the mounted visual `sig`. True when the gate is now HOLDING the
   *  preview's draws (the host must run the warm and show its stand-in);
   *  false when `sig` is already linked on this context, or is absent, so
   *  there is nothing to hold for. A re-arm supersedes any warm in flight. */
  arm(sig: string | null, nowMs: number): boolean;
  isArmed(): boolean;
  /** Whether a draw site may draw. Pure read: past the soft deadline it
   *  reports true whether or not the escape has been taken, so a host that
   *  never calls takeEscape still cannot wedge. */
  shouldRender(nowMs: number): boolean;
  /** Release the hold ONCE, past the soft deadline, and report how long the
   *  window had been armed so the host can record the escape. Null when there
   *  is nothing to escape (not armed, or still inside the deadline). */
  takeEscape(nowMs: number): number | null;
  /** How long the current window has been armed; 0 when nothing is armed. */
  armedAgeMs(nowMs: number): number;
  /** Claim the current arm for one warm pass. The returned token identifies
   *  the arm, so a later arm can supersede this pass; null when not armed. */
  beginWarm(): number | null;
  /** End the pass started at `token`. True when this pass still owns the arm
   *  (the host reveals and hides its stand-in) and `sig` is recorded as
   *  linked; false when a later arm superseded it, in which case nothing is
   *  recorded: the scene it compiled is no longer the scene on screen. */
  finishWarm(token: number, sig: string | null): boolean;
  /** Drop the armed state without revealing (destroy, context loss). */
  cancel(): void;
  /** Record what a warm outside the gate (prewarm) linked. */
  noteLinked(sig: string | null): void;
  /** Forget the linked signature: a visual REBUILD disposes its materials and
   *  three releases a program with the last material holding it, so a
   *  signature seen before can be cold again. */
  forgetLinked(): void;
  isLinked(sig: string | null): boolean;
  linkedSig(): string | null;
}

export function createPreviewOpenGate(options: PreviewOpenGateOptions = {}): PreviewOpenGate {
  const escapeMs = Math.max(0, options.escapeMs ?? PREVIEW_OPEN_GATE_ESCAPE_MS);
  let armed = false;
  let armedAt = 0;
  // Bumped by every arm and every cancel, so a warm pass carries the identity
  // of the arm it started under and can never reveal a superseded one.
  let generation = 0;
  let linked: string | null = null;

  const pastDeadline = (nowMs: number): boolean => nowMs - armedAt >= escapeMs;

  return {
    arm(sig, nowMs): boolean {
      if (sig === null || sig === linked) return false;
      generation++;
      armed = true;
      armedAt = nowMs;
      return true;
    },
    isArmed: () => armed,
    shouldRender: (nowMs) => !armed || pastDeadline(nowMs),
    takeEscape(nowMs): number | null {
      if (!armed || !pastDeadline(nowMs)) return null;
      const ageMs = nowMs - armedAt;
      armed = false;
      return ageMs;
    },
    armedAgeMs: (nowMs) => (armed ? nowMs - armedAt : 0),
    beginWarm: () => (armed ? generation : null),
    finishWarm(token, sig): boolean {
      if (token !== generation) return false;
      linked = sig;
      armed = false;
      return true;
    },
    cancel(): void {
      generation++;
      armed = false;
    },
    noteLinked(sig): void {
      linked = sig;
    },
    forgetLinked(): void {
      linked = null;
    },
    isLinked: (sig) => sig !== null && sig === linked,
    linkedSig: () => linked,
  };
}
