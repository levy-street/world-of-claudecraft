// Idle-fade for non-critical mobile HUD chrome (the action-bar icons and the
// minimap-side quick-access rail): dims after a stretch of no touch input and
// snaps back to full opacity on the next touch, so idle chrome recedes without
// ever touching anything the graphics-settings fairness rule protects (HP/
// target/cast bars, joysticks, the Attack button stay untouched by callers).
// Pure DOM-adjacent logic, no window/localStorage reads, so it imports cleanly
// under Vitest's plain-Node env per src/game/CLAUDE.md.

export const CHROME_FADE_IDLE_MS = 3000;
export const CHROME_FADE_IDLE_CLASS = 'mobile-chrome-idle';

export interface ChromeFadeTarget {
  classList: Pick<DOMTokenList, 'add' | 'remove'>;
}

export interface ChromeFadeTimers {
  setTimeout: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (id: ReturnType<typeof setTimeout>) => void;
}

export interface ChromeFadeHandle {
  /** Call on any touch activity: clears the idle dim and restarts the timer. */
  touch(): void;
  /** Stop the timer (e.g. when touch controls deactivate). */
  dispose(): void;
}

/** Starts an idle-fade timer against `target`, dimming it via
 * {@link CHROME_FADE_IDLE_CLASS} after `idleMs` of inactivity. Timers are
 * injected so this is fully testable with fake timers. */
const defaultTimers: ChromeFadeTimers = {
  // Bound wrappers, not bare `{ setTimeout, clearTimeout }`: browsers require
  // `window` as the call receiver (a WebIDL method, unlike Node's timers), so
  // calling a destructured reference off any other object throws "Illegal
  // invocation" at runtime while still passing under Vitest's fake timers.
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (id) => clearTimeout(id),
};

export function startChromeFade(
  target: ChromeFadeTarget,
  timers: ChromeFadeTimers = defaultTimers,
  idleMs = CHROME_FADE_IDLE_MS,
): ChromeFadeHandle {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const arm = () => {
    target.classList.remove(CHROME_FADE_IDLE_CLASS);
    if (timer !== null) timers.clearTimeout(timer);
    timer = timers.setTimeout(() => target.classList.add(CHROME_FADE_IDLE_CLASS), idleMs);
  };
  arm();

  return {
    touch: arm,
    dispose: () => {
      if (timer !== null) timers.clearTimeout(timer);
      timer = null;
    },
  };
}
