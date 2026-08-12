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
//   an overlay shows live percent progress with a "continue without
//   updating" escape hatch; when the download completes and the player has
//   neither dismissed the overlay nor entered the world, the staged bundle is
//   applied immediately via a WebView reload instead of waiting for a
//   backgrounding.
// - The incompatible-version rejection: when the server refuses the bundle's
//   world-layout epoch and a download is in flight (or already staged), the
//   dead-end fatal overlay is replaced by this gate in "fatal" mode: progress,
//   then auto-apply, no dismiss (there is nothing playable behind it).
//
// In-world sessions are never interrupted: while body is game-active the
// overlay stays hidden and a completed download falls back to the plugin's
// own apply-on-background behavior.
//
// Split on the reconnect_policy.ts pattern: pure, directly-testable state
// functions (reduce/model/decide) plus one thin installer that wires them to
// the duck-typed plugin glue in native_ota.ts. The overlay painter is
// INJECTED (src/ui/ota_update_overlay.ts, wired by main.ts) so this module
// stays DOM-free.

import { ONLINE_WORLD_INCOMPATIBLE_MESSAGE } from '../world_api';
import { applyPendingOtaUpdate, watchOtaUpdates } from './native_ota';
import { NATIVE_APP } from './online';

export type OtaGatePhase = 'idle' | 'downloading' | 'ready' | 'applying' | 'failed';

export interface OtaGateState {
  phase: OtaGatePhase;
  /** Last reported download percent, 0..100. */
  percent: number;
  /** Player chose "continue without updating"; stop surfacing the overlay. */
  dismissed: boolean;
  /**
   * The session died on the incompatible-version rejection and this gate took
   * over the recovery: the overlay switches to the "update required" copy,
   * loses its dismiss action, and applies the bundle the moment it is ready.
   */
  fatal: boolean;
}

export type OtaGateEvent =
  | { type: 'progress'; percent: number }
  | { type: 'complete' }
  | { type: 'failed' }
  | { type: 'dismiss' }
  | { type: 'incompatible' }
  | { type: 'applying' };

/** What the overlay painter renders; null means "show nothing". */
export interface OtaOverlayModel {
  phase: 'downloading' | 'applying';
  percent: number;
  showContinue: boolean;
  fatal: boolean;
}

export function initialOtaGateState(): OtaGateState {
  return { phase: 'idle', percent: 0, dismissed: false, fatal: false };
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
    case 'failed':
      if (state.phase === 'applying') return state;
      return { ...state, phase: 'failed' };
    case 'dismiss':
      return { ...state, dismissed: true };
    case 'incompatible':
      // Fatal mode overrides an earlier dismissal: the session is dead, so
      // "continue without updating" no longer means anything.
      return { ...state, fatal: true, dismissed: false };
    case 'applying':
      return { ...state, phase: 'applying', percent: 100 };
  }
}

export function otaOverlayModel(state: OtaGateState, inWorld: boolean): OtaOverlayModel | null {
  if (state.phase === 'idle' || state.phase === 'failed') return null;
  if (state.dismissed && !state.fatal) return null;
  // Never veil live play; the plugin's apply-on-background still covers it.
  if (inWorld && !state.fatal) return null;
  if (state.phase === 'downloading') {
    return {
      phase: 'downloading',
      percent: state.percent,
      showContinue: !state.fatal,
      fatal: state.fatal,
    };
  }
  // 'ready' renders as applying: the auto-apply decision below fires in the
  // same event turn, so the player never sees a stalled "ready" state.
  return { phase: 'applying', percent: 100, showContinue: false, fatal: state.fatal };
}

export function shouldAutoApplyOta(state: OtaGateState, inWorld: boolean): boolean {
  if (state.phase !== 'ready') return false;
  if (state.fatal) return true;
  return !state.dismissed && !inWorld;
}

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
  incompatibleReason?: string;
}

export interface OtaUpdateGate {
  /**
   * Claim an ended session's disconnect reason: returns true (and takes over
   * the screen) only for the incompatible-version rejection while an update
   * is downloading or staged. On false the caller shows its usual overlay.
   */
  handleIncompatibleDisconnect(reason: string | undefined): boolean;
  /** The overlay's "continue without updating" action. */
  dismiss(): void;
  /** Snapshot for tests/diagnostics. */
  state(): Readonly<OtaGateState>;
}

const INERT_GATE: OtaUpdateGate = {
  handleIncompatibleDisconnect: () => false,
  dismiss: () => {},
  state: () => initialOtaGateState(),
};

export function installOtaUpdateGate(deps: OtaUpdateGateDeps): OtaUpdateGate {
  const native = deps.native ?? NATIVE_APP;
  if (!native) return INERT_GATE;
  const watch = deps.watch ?? watchOtaUpdates;
  const apply = deps.apply ?? applyPendingOtaUpdate;
  const incompatibleReason = deps.incompatibleReason ?? ONLINE_WORLD_INCOMPATIBLE_MESSAGE;

  let state = initialOtaGateState();

  const paint = (): void => {
    const model = otaOverlayModel(state, deps.isInWorld());
    if (model) deps.overlay.render(model);
    else deps.overlay.hide();
  };

  const maybeApply = (): void => {
    if (!shouldAutoApplyOta(state, deps.isInWorld())) {
      paint();
      return;
    }
    state = reduceOtaGateEvent(state, { type: 'applying' });
    paint();
    void apply().then((applied) => {
      // On success the WebView reloads and this context is gone; reaching
      // here with false means the reload path is unavailable (plugin absent
      // or the bridge call failed).
      if (applied) return;
      state = { ...state, phase: 'ready' };
      if (state.fatal) {
        // Nothing left to try in fatal mode: hand the screen back to the
        // caller's own dead-end overlay rather than showing "restarting"
        // forever. The plugin still applies the staged bundle on the next
        // launch or backgrounding.
        paint();
        deps.onFatalRecoveryFailed?.();
      } else {
        // Pre-world boot flow: fall back silently to apply-on-background.
        deps.overlay.hide();
      }
    });
  };

  watch({
    onProgress: (percent) => {
      state = reduceOtaGateEvent(state, { type: 'progress', percent });
      paint();
    },
    onComplete: () => {
      state = reduceOtaGateEvent(state, { type: 'complete' });
      maybeApply();
    },
    onFailed: () => {
      const wasFatal = state.fatal;
      state = reduceOtaGateEvent(state, { type: 'failed' });
      paint();
      if (wasFatal) deps.onFatalRecoveryFailed?.();
    },
  });

  return {
    handleIncompatibleDisconnect: (reason) => {
      if (reason !== incompatibleReason) return false;
      // Only claim the recovery when an update is actually in flight or
      // staged; with nothing to offer (no check answered yet, or the download
      // already failed) the caller's overlay is the honest answer.
      if (state.phase !== 'downloading' && state.phase !== 'ready' && state.phase !== 'applying') {
        return false;
      }
      state = reduceOtaGateEvent(state, { type: 'incompatible' });
      maybeApply();
      return true;
    },
    dismiss: () => {
      state = reduceOtaGateEvent(state, { type: 'dismiss' });
      paint();
    },
    state: () => state,
  };
}
