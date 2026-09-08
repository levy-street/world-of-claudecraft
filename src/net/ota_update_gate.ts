// The visible OTA update gate for the native shells (Phase 1 of the mobile
// OTA program; see docs/ota-updates.md "Visible updates").
//
// Problem being solved: with the plugin's autoUpdate mode the update check,
// the full-bundle download, and the apply are all INVISIBLE (the apply waits
// for the next app backgrounding). A player on a stale store install opens
// the app, taps Play, and hits the incompatible-version dead end with no clue
// that the fix is already downloading behind them.
//
// This module turns those native events into a visible flow with two faces:
// - Boot/pre-world: while a download runs before the player enters the world,
//   an overlay shows live percent progress with no dismiss action (a skipped
//   update leaves the player on a stale bundle headed for the
//   incompatible-version dead end, so the gate holds until the update lands);
//   once the plugin has STAGED the finished download and the player has not
//   entered the world, the bundle is applied immediately via a WebView reload
//   instead of waiting for a backgrounding.
// - The incompatible-version rejection: when the server refuses the bundle's
//   world-layout epoch, this gate claims the screen in "fatal" mode instead of
//   the dead-end overlay: progress for a download in flight, then auto-apply
//   once staged (there is nothing playable behind it). With nothing in flight
//   it asks the plugin for a bundle staged before this context existed and
//   hands the dead-end overlay back only on a miss.
//
// "Staged" is load-bearing. The plugin emits downloadComplete before it has
// verified the bundle or recorded it as the next bundle, so an apply issued on
// that event switches to nothing and merely reloads the stale client (the
// "still incompatible until I force-quit the app" report). The apply keys on
// the later updateAvailable event, which names the verified bundle, and
// switches to it by id. A download can also finish before this JS context
// exists (cold start, or the context an earlier apply reloaded), and no event
// replays, so the gate asks the plugin for an already-staged bundle at install
// and again when the incompatible rejection lands with nothing in flight.
//
// In-world sessions are never interrupted: while body is game-active the
// overlay stays hidden and a staged download falls back to the plugin's own
// apply-on-background behavior.
//
// Split on the reconnect_policy.ts pattern: pure, directly-testable state
// functions (reduce/model/decide) plus one thin installer that wires them to
// the duck-typed plugin glue in native_ota.ts. The overlay painter is
// INJECTED (src/ui/ota_update_overlay.ts, wired by main.ts) so this module
// stays DOM-free.

import { ONLINE_WORLD_INCOMPATIBLE_MESSAGE } from '../world_api';
import { applyPendingOtaUpdate, pendingOtaBundleId, watchOtaUpdates } from './native_ota';
import { NATIVE_APP } from './online';

export type OtaGatePhase = 'idle' | 'downloading' | 'ready' | 'applying' | 'failed';

export interface OtaGateState {
  phase: OtaGatePhase;
  /** Last reported download percent, 0..100. */
  percent: number;
  /**
   * The session died on the incompatible-version rejection and this gate took
   * over the recovery: the overlay switches to the "update required" copy and
   * applies the bundle the moment it is ready.
   */
  fatal: boolean;
  /**
   * The plugin has verified the download and recorded (or is recording) it as
   * the next bundle. The only state an apply is allowed from: before it, there
   * is nothing to switch to and a reload would boot the same stale client.
   */
  staged: boolean;
  /** The staged bundle's id when the plugin named one; null means "ask the plugin". */
  stagedId: string | null;
}

export type OtaGateEvent =
  | { type: 'progress'; percent: number }
  | { type: 'complete' }
  | { type: 'staged'; bundleId: string | null }
  | { type: 'failed' }
  | { type: 'incompatible' }
  | { type: 'applying' };

/** What the overlay painter renders; null means "show nothing". */
export interface OtaOverlayModel {
  phase: 'downloading' | 'applying';
  percent: number;
  fatal: boolean;
}

export function initialOtaGateState(): OtaGateState {
  return { phase: 'idle', percent: 0, fatal: false, staged: false, stagedId: null };
}

export function reduceOtaGateEvent(state: OtaGateState, event: OtaGateEvent): OtaGateState {
  switch (event.type) {
    case 'progress':
      // Never demote a completed/applying bundle back to "downloading": the
      // plugin can emit a trailing 100% tick after downloadComplete.
      if (state.phase === 'ready' || state.phase === 'applying') return state;
      return { ...state, phase: 'downloading', percent: event.percent };
    case 'complete':
      if (state.phase === 'applying') return state;
      return { ...state, phase: 'ready', percent: 100 };
    case 'staged':
      if (state.phase === 'applying') return state;
      return {
        ...state,
        phase: 'ready',
        percent: 100,
        staged: true,
        stagedId: event.bundleId ?? state.stagedId,
      };
    case 'failed':
      // A bundle already staged outlives a later failure report: it is still
      // the fix, and the plugin still applies it on the next backgrounding.
      if (state.phase === 'applying' || state.staged) return state;
      return { ...state, phase: 'failed' };
    case 'incompatible':
      return { ...state, fatal: true };
    case 'applying':
      return { ...state, phase: 'applying', percent: 100 };
  }
}

export function otaOverlayModel(state: OtaGateState, inWorld: boolean): OtaOverlayModel | null {
  if (state.phase === 'idle' || state.phase === 'failed') return null;
  // Never veil live play; the plugin's apply-on-background still covers it.
  if (inWorld && !state.fatal) return null;
  if (state.phase === 'downloading') {
    return { phase: 'downloading', percent: state.percent, fatal: state.fatal };
  }
  // 'ready' renders as applying: the plugin is verifying and staging the
  // downloaded bundle, and the auto-apply fires the moment it reports staged,
  // so the player never sees a stalled "ready" state.
  return { phase: 'applying', percent: 100, fatal: state.fatal };
}

export function shouldAutoApplyOta(state: OtaGateState, inWorld: boolean): boolean {
  if (state.phase !== 'ready' || !state.staged) return false;
  if (state.fatal) return true;
  return !inWorld;
}

/**
 * How long a completed download may sit unverified before the gate stops
 * holding the screen for it: after this, it asks the plugin once for a staged
 * bundle and otherwise steps aside (the plugin's own apply-on-background is
 * still armed). Verification is a checksum over the downloaded files, so
 * anything near this long means the plugin is not going to stage it.
 */
export const OTA_STAGING_GRACE_MS = 30_000;

export type OtaGateScheduler = (fn: () => void, ms: number) => () => void;

const defaultSchedule: OtaGateScheduler = (fn, ms) => {
  const handle = setTimeout(fn, ms);
  return () => clearTimeout(handle);
};

export interface OtaUpdateGateDeps {
  overlay: {
    render(model: OtaOverlayModel): void;
    hide(): void;
  };
  /** Whether live play is on screen (main.ts: body.game-active). */
  isInWorld(): boolean;
  /**
   * Fatal-mode dead end: the update could not be downloaded or applied while
   * this gate owned the incompatible-version recovery, so the caller should
   * restore its own fatal overlay (the pre-gate behavior).
   */
  onFatalRecoveryFailed?(): void;
  /** Injectable for tests; default to the real plugin glue. */
  native?: boolean;
  watch?: typeof watchOtaUpdates;
  apply?: typeof applyPendingOtaUpdate;
  pending?: typeof pendingOtaBundleId;
  schedule?: OtaGateScheduler;
  incompatibleReason?: string;
}

export interface OtaUpdateGate {
  /**
   * Claim an ended session's disconnect reason: returns true (and takes over
   * the screen) for the incompatible-version rejection, false for any other
   * reason, which the caller shows as usual. With an update downloading or
   * staged the gate paints progress and applies; with nothing in flight it
   * asks the plugin for a bundle it never heard about, applies a hit, and on
   * a miss hands the screen back through onFatalRecoveryFailed. Claiming
   * before the plugin answers keeps the caller's dead-end overlay, which
   * clears the resume marker, off the screen until it is the truth.
   */
  handleIncompatibleDisconnect(reason: string | undefined): boolean;
  /** Snapshot for tests/diagnostics. */
  state(): Readonly<OtaGateState>;
}

const INERT_GATE: OtaUpdateGate = {
  handleIncompatibleDisconnect: () => false,
  state: () => initialOtaGateState(),
};

export function installOtaUpdateGate(deps: OtaUpdateGateDeps): OtaUpdateGate {
  const native = deps.native ?? NATIVE_APP;
  if (!native) return INERT_GATE;
  const watch = deps.watch ?? watchOtaUpdates;
  const apply = deps.apply ?? applyPendingOtaUpdate;
  const pending = deps.pending ?? pendingOtaBundleId;
  const schedule = deps.schedule ?? defaultSchedule;
  const incompatibleReason = deps.incompatibleReason ?? ONLINE_WORLD_INCOMPATIBLE_MESSAGE;

  let state = initialOtaGateState();
  let cancelStagingWatch: (() => void) | null = null;

  const paint = (): void => {
    const model = otaOverlayModel(state, deps.isInWorld());
    if (model) deps.overlay.render(model);
    else deps.overlay.hide();
  };

  const disarmStagingWatch = (): void => {
    cancelStagingWatch?.();
    cancelStagingWatch = null;
  };

  const maybeApply = (): void => {
    if (!shouldAutoApplyOta(state, deps.isInWorld())) {
      paint();
      return;
    }
    disarmStagingWatch();
    state = reduceOtaGateEvent(state, { type: 'applying' });
    paint();
    void apply({ bundleId: state.stagedId }).then((applied) => {
      // On success the WebView reloads and this context is gone; reaching
      // here with false means nothing was switched (plugin absent, no bundle
      // to name, or the bridge call failed).
      if (applied) return;
      state = { ...state, phase: 'ready' };
      if (state.fatal) {
        // Nothing left to try in fatal mode: hand the screen back to the
        // caller's own dead-end overlay rather than showing "restarting"
        // forever. Hiding is load-bearing, not cosmetic: the caller's
        // recovery overlay stacks BELOW this scrim, so a repaint here would
        // bury its only action. The plugin still applies the staged bundle
        // on the next launch or backgrounding.
        deps.overlay.hide();
        deps.onFatalRecoveryFailed?.();
      } else {
        // Pre-world boot flow: fall back silently to apply-on-background.
        deps.overlay.hide();
      }
    });
  };

  const onStaged = (bundleId: string | null): void => {
    disarmStagingWatch();
    state = reduceOtaGateEvent(state, { type: 'staged', bundleId });
    maybeApply();
  };

  const onFailed = (): void => {
    disarmStagingWatch();
    const wasFatal = state.fatal;
    state = reduceOtaGateEvent(state, { type: 'failed' });
    paint();
    if (wasFatal && state.phase === 'failed') deps.onFatalRecoveryFailed?.();
  };

  // Ask the plugin for a bundle this context never saw download. Anything it
  // names is staged by definition (the plugin only records verified bundles).
  const probeStaged = (onNone?: () => void): void => {
    void pending().then((bundleId) => {
      if (bundleId) onStaged(bundleId);
      else onNone?.();
    });
  };

  const armStagingWatch = (): void => {
    disarmStagingWatch();
    cancelStagingWatch = schedule(() => {
      cancelStagingWatch = null;
      if (state.phase !== 'ready' || state.staged) return;
      probeStaged(() => {
        // Re-check: the staged event may have landed while the probe ran.
        if (state.phase !== 'ready' || state.staged) return;
        onFailed();
      });
    }, OTA_STAGING_GRACE_MS);
  };

  watch({
    onProgress: (percent) => {
      state = reduceOtaGateEvent(state, { type: 'progress', percent });
      paint();
    },
    onComplete: () => {
      state = reduceOtaGateEvent(state, { type: 'complete' });
      // Nothing to switch to yet: hold the screen ("applying") until the
      // plugin reports the bundle staged, bounded by the grace window.
      if (!state.staged) armStagingWatch();
      maybeApply();
    },
    onStaged,
    onFailed,
  });

  // A download that finished before this context booted left no event to
  // catch; the plugin's own record is the only trace.
  probeStaged();

  const isUpdateInFlight = (): boolean =>
    state.phase === 'downloading' || state.phase === 'ready' || state.phase === 'applying';

  return {
    handleIncompatibleDisconnect: (reason) => {
      if (reason !== incompatibleReason) return false;
      state = reduceOtaGateEvent(state, { type: 'incompatible' });
      if (isUpdateInFlight()) {
        maybeApply();
        return true;
      }
      // Nothing known in flight (no check answered yet, the download already
      // failed, or it finished before this context existed). The plugin may
      // still hold the fix, so the screen is claimed NOW and the plugin asked.
      // A hit applies in fatal mode (the session is dead either way) with the
      // caller's resume marker intact, so the reload lands back in the world
      // on the new bundle; a miss hands back through onFatalRecoveryFailed,
      // whose dead-end overlay is what drops that marker, so it paints only
      // once there is provably nothing to apply. Fatal outlives a miss: a
      // download that starts later (the plugin re-checks on foreground)
      // paints and applies in fatal mode over the same dead end.
      probeStaged(() => {
        // Re-check: a download may have started while the probe ran, and the
        // gate then owns the screen through its own apply or failure paths.
        if (isUpdateInFlight()) return;
        deps.onFatalRecoveryFailed?.();
      });
      return true;
    },
    state: () => state,
  };
}
