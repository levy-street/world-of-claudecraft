// Self-heal for a WebGL context loss that never comes back.
//
// three.js's own WebGLRenderer already registers a webglcontextlost listener
// that calls event.preventDefault() for the entire life of a live renderer
// (three.module.js, onContextLost), which is what actually requests browser
// auto-restoration during ordinary play; context_recycle.ts's own short-lived
// listener covers the one window three's does not, the deliberate
// dispose-then-reconstruct gap of a graphics-preset rebuild. Neither of those
// promises a restore ever ARRIVES: a genuinely dead GPU/driver (the process
// was killed, video memory is gone for good) leaves the browser's own retry
// unresolved forever. Before this module nothing on the game canvas noticed
// that outcome: draw calls on a lost context are silent no-ops, the
// requestAnimationFrame loop keeps ticking (FPS stays reported), and every
// DOM-driven HUD element (health bars, nameplates, minimap, chat) keeps
// working untouched, since none of that depends on the canvas. The result is
// a "half broken" client with no error and no way back short of a manual
// reload the player has no prompt to try.
//
// attachContextRecoveryHandlers arms a bounded watchdog on every loss
// (belt-and-suspenders preventDefault included, since it costs nothing and
// covers a canvas with no live renderer yet). If webglcontextrestored fires
// first, play continues (KTX2 textures re-transcode in the background per
// ktx2_mip_release.ts; that is an existing, separately-documented brief
// cosmetic window) and the watchdog cancels with no callback. If the window
// elapses with no restore, onStuck runs once, so the caller can offer a clear
// way out instead of leaving the player staring at a dead canvas forever.
//
// Two false-positive guards, because a fixed timer alone is not safe here:
// - Backgrounding (a phone lock, an app switch, a hidden tab) is itself one
//   of the most common real causes of a context loss, and a hidden page's
//   timers are throttled or suspended, so a bare timeout can fire LATE, well
//   after the tab is visible and the context has already restored. The
//   watchdog never escalates while hidden; it waits for the tab to come back
//   and gives the loss a FRESH window from there, rather than counting
//   throttled background time against it.
// - A restore can race the watchdog's own timer even while visible (the
//   'webglcontextrestored' event and this module's callback both run on the
//   same queue, but nothing guarantees ordering against a timer that was
//   already due). `isStillLost` is re-checked immediately before escalating;
//   if the context is already alive, the watchdog stands down silently.
import { DEFAULT_RECYCLE_TIMEOUT_MS } from './context_recycle';

export interface ContextLossScheduler {
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(id: number): void;
}

const defaultScheduler: ContextLossScheduler = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs) as unknown as number,
  clearTimeout: (id) => clearTimeout(id),
};

export interface ContextLossVisibility {
  isHidden(): boolean;
  /** Registers `callback` for the next time the page becomes visible; returns
   *  an unsubscribe. May fire more than once if never unsubscribed. */
  onVisible(callback: () => void): () => void;
}

const defaultVisibility: ContextLossVisibility = {
  isHidden: () => typeof document !== 'undefined' && document.hidden,
  onVisible: (callback) => {
    if (typeof document === 'undefined') return () => {};
    const handler = (): void => {
      if (!document.hidden) callback();
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  },
};

/** How long an unrestored context loss is tolerated (while the page is
 *  VISIBLE; see the header) before escalating. DERIVED from (not just
 *  documented against) context_recycle.ts's own DEFAULT_RECYCLE_TIMEOUT_MS,
 *  with a fixed margin, so a normal graphics-preset switch's own worst case
 *  can never trip this watchdog even if that timeout is later retuned; the
 *  test suite pins the ordering directly rather than trusting the margin. */
export const CONTEXT_LOSS_ESCALATE_MS = DEFAULT_RECYCLE_TIMEOUT_MS + 5_000;

export interface WebglContextWatchdogOptions {
  escalateMs?: number;
  scheduler?: ContextLossScheduler;
  visibility?: ContextLossVisibility;
  /** Re-checked immediately before escalating; escalates unconditionally if
   *  omitted. Give this the canvas's live `isContextLost()` read. */
  isStillLost?: () => boolean;
}

/**
 * Arms a bounded watchdog on context loss: if not restored within
 * `escalateMs` of VISIBLE time, calls `onStuck()` once. A restore before then
 * cancels it with no callback. Re-entrant: a loss while already armed is a
 * no-op (the running timer/wait is what matters, matching one loss awaiting
 * one restore).
 */
export class WebglContextWatchdog {
  private timer: number | null = null;
  private unsubscribeVisible: (() => void) | null = null;
  // Latched permanently once onStuck has fired: a later, SEPARATE loss must
  // never escalate a second time. fatalOverlay runs clearPlayMarker()
  // unconditionally before its own first-reason-wins overlay guard, so a
  // second escalation landing on an overlay a caller raised with
  // `keepResumeMarker: true` (the duplicate-session case) would erase the
  // marker that caller deliberately kept, even though the DOM overlay itself
  // never changes. lost() is the only re-entry point after a loss ends
  // (restored() clears the pre-escalation timer/wait, not this), so gating
  // it here covers every path.
  private escalated = false;
  private readonly escalateMs: number;
  private readonly scheduler: ContextLossScheduler;
  private readonly visibility: ContextLossVisibility;
  private readonly isStillLost: () => boolean;

  constructor(
    private readonly onStuck: () => void,
    options: WebglContextWatchdogOptions = {},
  ) {
    this.escalateMs = options.escalateMs ?? CONTEXT_LOSS_ESCALATE_MS;
    this.scheduler = options.scheduler ?? defaultScheduler;
    this.visibility = options.visibility ?? defaultVisibility;
    this.isStillLost = options.isStillLost ?? (() => true);
  }

  lost(): void {
    if (this.escalated || this.timer !== null || this.unsubscribeVisible !== null) return;
    this.arm();
  }

  private arm(): void {
    this.timer = this.scheduler.setTimeout(() => this.onTimerFired(), this.escalateMs);
  }

  private onTimerFired(): void {
    this.timer = null;
    if (this.visibility.isHidden()) {
      this.unsubscribeVisible = this.visibility.onVisible(() => {
        this.unsubscribeVisible?.();
        this.unsubscribeVisible = null;
        if (this.isStillLost()) this.arm();
      });
      return;
    }
    if (this.isStillLost()) {
      this.escalated = true;
      this.onStuck();
    }
  }

  restored(): void {
    if (this.timer !== null) {
      this.scheduler.clearTimeout(this.timer);
      this.timer = null;
    }
    this.unsubscribeVisible?.();
    this.unsubscribeVisible = null;
  }

  /** For a teardown that outlives a pending loss (attachContextRecoveryHandlers
   *  wires this to a REAL `pagehide`, `persisted === false`, so a full page
   *  navigation is already underway; a bfcache freeze does not reach this,
   *  see that function's own doc); stops the watchdog with no callback. */
  dispose(): void {
    this.restored();
  }
}

export interface ContextRecoveryCallbacks {
  /** Runs on every distinct loss, restorable or not (existing diagnostics/KTX2 hooks). */
  onLost(): void;
  onRestored(): void;
  /** Runs once if the loss is still unrestored after the escalation window. */
  onStuck(): void;
}

/** Wires preventDefault + the watchdog onto one canvas's context-loss pair,
 *  ahead of the caller's own diagnostics. Call once, for the game canvas's
 *  whole lifetime (the canvas persists across a graphics-preset rebuild's
 *  context recycle, so this never re-attaches). `isStillLost` defaults to
 *  the canvas's own live WebGL2 context, which `getContext('webgl2')`
 *  returns without side effects once a context already exists. The watchdog
 *  disposes only on a REAL teardown (`pagehide` with `persisted === false`),
 *  mirroring context_release.ts's own bfcache check: that module deliberately
 *  keeps a frozen page's WebGL context alive across the freeze, so a loss the
 *  watchdog is already timing can still be genuinely, still-lost when the
 *  page comes back, and disposing on a mere freeze would strand it with no
 *  watchdog left to ever report it. `pageshow` with `persisted === true`
 *  re-arms instead, in case the freeze left the loss unresolved. */
export function attachContextRecoveryHandlers(
  canvas: HTMLCanvasElement,
  callbacks: ContextRecoveryCallbacks,
  options: {
    escalateMs?: number;
    scheduler?: ContextLossScheduler;
    visibility?: ContextLossVisibility;
    isStillLost?: () => boolean;
    pageTeardown?: Pick<EventTarget, 'addEventListener'>;
  } = {},
): void {
  // Defaults to escalating (true) whenever a live answer isn't available (no
  // WebGL2 context at all): only a POSITIVE confirmation of "restored" stands
  // the watchdog down, so an unusual host can never silently suppress
  // escalation. Shared with the pageshow re-arm below, so both read the exact
  // same live-context answer.
  const isStillLost =
    options.isStillLost ?? (() => canvas.getContext('webgl2')?.isContextLost() !== false);
  const watchdog = new WebglContextWatchdog(callbacks.onStuck, {
    escalateMs: options.escalateMs,
    scheduler: options.scheduler,
    visibility: options.visibility,
    isStillLost,
  });
  let lossObserved = false;
  const observeLoss = (): void => {
    watchdog.lost();
    if (lossObserved) return;
    lossObserved = true;
    callbacks.onLost();
  };
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    observeLoss();
  });
  canvas.addEventListener('webglcontextrestored', () => {
    lossObserved = false;
    watchdog.restored();
    callbacks.onRestored();
  });
  const pageTeardown = options.pageTeardown ?? (typeof window === 'undefined' ? undefined : window);
  pageTeardown?.addEventListener('pagehide', (event) => {
    if (!(event as PageTransitionEvent).persisted) watchdog.dispose();
  });
  pageTeardown?.addEventListener('pageshow', (event) => {
    if ((event as PageTransitionEvent).persisted && isStillLost()) observeLoss();
  });
}
