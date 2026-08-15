// Consumes the desktop shell's display changes: the main process watches the
// monitor the window sits on and pushes a new reading when its scale factor or
// identity changes. The page has no equivalent signal, because the renderer's
// viewport poll reacts to SIZE changes and a monitor re-scaling (or a drag to a
// differently scaled monitor at the same window size) changes no size at all.
//
// Lives in src/game so main.ts stays a firewall (composition only) and so the
// renderer keeps a single consumer of the signal.

import type { DesktopBridge, DesktopDisplayChange } from '../runtime';

// Where a validated change is forwarded, or null until the renderer registers
// itself. A change that arrives before then is dropped on purpose rather than
// latched: the renderer reads window.devicePixelRatio live when it is
// constructed, so it already comes up with the current reading, and replaying a
// stale change into it would only re-resolve to the same value.
let target: (() => void) | null = null;

/** Register (or clear, with null) the renderer-side handler for a display change. */
export function setDisplayChangeTarget(cb: (() => void) | null): void {
  target = cb;
}

function isDisplayChange(raw: unknown): raw is DesktopDisplayChange {
  if (!raw || typeof raw !== 'object') return false;
  const candidate = raw as Partial<DesktopDisplayChange>;
  return typeof candidate.scaleFactor === 'number' && Number.isFinite(candidate.scaleFactor);
}

/**
 * Subscribe to the shell's display changes. Returns the unsubscribe hook, or a
 * no-op on a bridge without onDisplayChanged (older shell, or a plain browser),
 * so neither the web build nor an outdated install changes behavior at all.
 *
 * The payload is re-validated here even though the preload already checked it:
 * the shell is a separately installed binary, and the one whitelisted numeric
 * field is all that is ever read (extra fields a future or tampered shell might
 * send are simply never forwarded, because nothing but the notify call crosses).
 */
export function initDesktopDisplayChange(bridge: DesktopBridge): () => void {
  target = null;
  const subscribe = bridge.onDisplayChanged;
  if (typeof subscribe !== 'function') return () => {};
  return subscribe.call(bridge, (raw: DesktopDisplayChange) => {
    if (!isDisplayChange(raw)) return;
    target?.();
  });
}
