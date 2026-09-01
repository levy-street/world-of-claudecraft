// The restart strip's pure core: what the strip shows given what is pending,
// what the panel around it is doing, and where its own restart request stands.
// DOM-free; src/ui/restart_strip_painter.ts paints it, and the options window composes
// it at the foot of any panel that hosts a next-launch setting
// (src/game/desktop_next_launch_settings.ts). Pinned by
// tests/restart_strip_core.test.ts.

/** Where the strip's own restart request stands. */
export type RestartRequestPhase = 'idle' | 'restarting' | 'failed';

export interface RestartStripInput {
  /** At least one next-launch setting differs from what this launch runs on. */
  pending: boolean;
  /** The host panel has unapplied in-page changes: Apply keeps the hand. */
  dirty: boolean;
  /** The host panel is applying: nothing else may act until it settles. */
  busy: boolean;
  phase: RestartRequestPhase;
}

/**
 * What the strip shows:
 * - `hidden`: nothing pending, or the host panel's own Apply comes first (a
 *   restart would throw away a draft the player has not applied, and a panel
 *   mid-apply must settle before anything else acts);
 * - `ready`: the restart is offered;
 * - `restarting`: asked, waiting for the shell to take the window down;
 * - `failed`: the shell answered that the new process never started; the
 *   offer stands again, with the reason.
 */
export type RestartStripState = 'hidden' | 'ready' | 'restarting' | 'failed';

export function restartStripState({
  pending,
  dirty,
  busy,
  phase,
}: RestartStripInput): RestartStripState {
  if (!pending) return 'hidden';
  if (dirty || busy) return 'hidden';
  if (phase === 'restarting') return 'restarting';
  if (phase === 'failed') return 'failed';
  return 'ready';
}
