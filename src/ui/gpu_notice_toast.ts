// GPU notice: a one-time, dismissible, shell-level toast shown when the session
// runs on a software rasterizer (WARP, SwiftShader, llvmpipe), when a browser
// session sits on the integrated GPU of a likely hybrid machine (issue #2119),
// or, inside the desktop shell, when the machine has a dedicated GPU the
// session is not using. Since Chromium 141 removed the automatic SwiftShader
// fallback, the Windows no-GPU shape is the D3D11 WARP device: the game still
// boots and plays (low tier), but at a slideshow frame rate with no
// explanation; this toast is that explanation. State transitions live in the
// pure view-core (src/ui/gpu_notice_view.ts); this module is the thin DOM
// consumer (it owns a fixed-position element on document.body; styles in
// src/styles/shell.css "software rendering notice" section, shared by every
// variant). It works on both the pre-game shell and in-world, like the desktop
// update toast it is modeled on.
//
// The desktop shell publishes its verdict over the bridge, which can land
// EITHER before this notice inits (the shell integration boots long before the
// renderer exists) or after it. Both orders are supported: a pre-init verdict
// is held here and folded into initGpuNotice, and a post-init verdict re-runs
// the resolve and builds the DOM lazily if the notice becomes shown.

import {
  type DesktopPlatform,
  dismissGpuNotice,
  formatGpuNoticeSignature,
  type GpuNoticeState,
  type GpuNoticeVerdict,
  gpuNoticeBodyKey,
  gpuNoticeVerdictsEqual,
  mergeGpuNoticeVerdicts,
  parseGpuNoticeSignature,
  resolveGpuNotice,
} from './gpu_notice_view';
import { t } from './i18n';

// Per-install dismissal: the notice explains a machine-level condition, so once
// a player has read it, never nag again for the SAME verdict (the stored value
// is the dismissed-component signature; a verdict that adds a component
// re-arms). A session-only fallback applies when storage is unavailable, e.g.
// hardened private modes.
const DISMISSED_KEY = 'woc_gpu_notice_dismissed';

// Read-only compatibility with the separate per-variant key v0.36.0 installs
// wrote for a dismissed hybrid notice (before the hybrid variant merged into
// the signature scheme above). Never written here; '1' means the player
// already closed the hybrid notice once.
const LEGACY_HYBRID_DISMISSED_KEY = 'woc_gpu_notice_hybrid_dismissed';

const NO_VERDICT: GpuNoticeVerdict = {
  softwareRendering: false,
  discreteInactive: false,
  hybridGpuLikely: false,
};

function readDismissedSignature(): string {
  try {
    return (typeof localStorage !== 'undefined' && localStorage.getItem(DISMISSED_KEY)) || '';
  } catch {
    return '';
  }
}

function readLegacyHybridDismissed(): boolean {
  try {
    return (
      typeof localStorage !== 'undefined' &&
      localStorage.getItem(LEGACY_HYBRID_DISMISSED_KEY) === '1'
    );
  } catch {
    return false;
  }
}

function writeDismissedSignature(value: string): void {
  try {
    localStorage.setItem(DISMISSED_KEY, value);
  } catch {
    // Storage unavailable: the in-memory dismissal still hides it this session.
  }
}

// The shell verdict, OR-accumulated across pushes: a machine-level condition
// does not un-arm mid-session, and accumulating keeps a later partial payload
// from dropping a component that already fired. Held at module scope so it
// survives the init race in either direction. The hybrid component never comes
// from the shell (the shell forces the discrete adapter, so there is nothing
// to detect), which is why pushes carry only the two shell-sourced booleans.
let shellVerdict: GpuNoticeVerdict = NO_VERDICT;

// The live notice instance's re-resolve hook, or null before initGpuNotice runs.
let applyShellVerdict: ((verdict: GpuNoticeVerdict) => void) | null = null;

// The live instance's DOM teardown (root + woc:languagechange listener), or
// null while no DOM was ever built. Called by the next initGpuNotice so a
// re-init cannot strand a previous root and its listener.
let disposeNotice: (() => void) | null = null;

// Which components the shown notice ACCOUNTED FOR this session, latched true
// and never cleared by a dismissal: the perf-nudge sibling suppresses its
// redundant arms on "the boot notice already said this" (packet 0 ruling R16),
// which stays true after the player closes the notice. When both the software
// and discrete components are armed, the software body wins the copy yet BOTH
// count as accounted for (an armed-at-render latch, not a which-body-was-read
// latch), on purpose: the software copy carries the identical remedy (update
// drivers, Windows High performance), and surfacing the integrated-GPU nudge
// instead would assert the shell picked the gaming GPU, exactly false on such
// a machine (the post-crash WARP-flip shape reports both components at once).
// Re-litigated and KEPT in phase 3 QA, with one honesty correction: the
// discrete arm of the suppression this feeds is unreachable in production
// wiring today (perf_doctor gates 'integrated-gpu' on !desktopShell, and a
// discrete verdict only exists inside the shell), so these semantics are
// defense-in-depth for the day that analyzer gate changes, not a load-bearing
// guard now. Reset by initGpuNotice (a new boot).
let displayed: GpuNoticeVerdict = NO_VERDICT;

/**
 * The components the rendered body accounted for this session. On a
 * multi-component verdict the software copy wins yet all latch true: this is
 * "what the notice covered", not "which body text the player read".
 */
export function gpuNoticeDisplayed(): GpuNoticeVerdict {
  return { ...displayed };
}

/**
 * The desktop shell's GPU verdict arrived. Before initGpuNotice it is held for
 * the notice to fold in; after it, the live notice re-resolves and appears if
 * the new component is not already covered by a persisted dismissal.
 */
export function updateGpuNoticeShellVerdict(verdict: {
  softwareRendering: boolean;
  discreteInactive: boolean;
}): void {
  shellVerdict = mergeGpuNoticeVerdicts(shellVerdict, {
    softwareRendering: verdict.softwareRendering,
    discreteInactive: verdict.discreteInactive,
    hybridGpuLikely: false,
  });
  applyShellVerdict?.(shellVerdict);
}

// Returns true when the notice was shown by this init call. Whether a component
// was ever displayed (including by a later shell verdict) is gpuNoticeDisplayed.
export function initGpuNotice(input: {
  softwareRendering: boolean;
  discreteInactive?: boolean;
  hybridGpuLikely?: boolean;
  desktopShell: boolean;
  desktopPlatform: DesktopPlatform;
}): boolean {
  // A fresh boot: drop any previous instance (its hook, its DOM, and its
  // language listener) and the per-session display latch. shellVerdict is
  // deliberately KEPT: it carries a verdict that arrived before this init (the
  // common order, the shell integration boots with the page), so it is
  // cross-instance state, not instance state.
  applyShellVerdict = null;
  disposeNotice?.();
  disposeNotice = null;
  displayed = NO_VERDICT;

  const localVerdict: GpuNoticeVerdict = {
    softwareRendering: input.softwareRendering,
    discreteInactive: input.discreteInactive === true,
    hybridGpuLikely: input.hybridGpuLikely === true,
  };
  let verdict = mergeGpuNoticeVerdicts(localVerdict, shellVerdict);
  // Session fallback for the dismissal when storage writes are unavailable.
  let memoDismissed = '';
  const dismissedSignature = (): string => readDismissedSignature() || memoDismissed;

  let state: GpuNoticeState = resolveGpuNotice({
    ...verdict,
    dismissedSignature: dismissedSignature(),
    legacyHybridDismissed: readLegacyHybridDismissed(),
  });

  let root: HTMLDivElement | null = null;
  let message: HTMLSpanElement | null = null;
  let dismissButton: HTMLButtonElement | null = null;

  const ensureDom = (): void => {
    if (root) return;
    const created = document.createElement('div');
    root = created;
    created.id = 'gpu-notice';
    created.setAttribute('role', 'status');
    created.setAttribute('aria-live', 'polite');
    created.hidden = true;
    message = document.createElement('span');
    message.className = 'gpu-notice-message';
    dismissButton = document.createElement('button');
    dismissButton.type = 'button';
    dismissButton.className = 'gpu-notice-dismiss';
    dismissButton.addEventListener('click', () => {
      // MERGE the armed components into what is already stored rather than
      // overwrite it: the stored signature can carry components from an
      // earlier different-verdict dismissal (including the legacy '1', which
      // parses as software), and dropping them would re-nag a verdict the
      // player already closed. Bounded by construction: the parse admits only
      // known components and the set dedupes.
      const signature = formatGpuNoticeSignature([
        ...new Set([...parseGpuNoticeSignature(dismissedSignature()), ...state.components]),
      ]);
      state = dismissGpuNotice(state);
      memoDismissed = signature;
      writeDismissedSignature(signature);
      render();
    });
    created.append(message, dismissButton);
    document.body.appendChild(created);
    // Locale flips re-render whatever is currently shown (the language selector
    // dispatches this on both the shell and the in-game options path). Bound
    // with the DOM so a session that never shows the notice adds no listener.
    document.addEventListener('woc:languagechange', render);
    // The teardown rides with the DOM for the same reason: only an init that
    // built the node owes one, and the NEXT init runs it so a re-init leaves
    // exactly one root and one listener.
    disposeNotice = () => {
      document.removeEventListener('woc:languagechange', render);
      created.remove();
    };
  };

  const render = (): void => {
    if (!state.shown) {
      if (root) root.hidden = true;
      return;
    }
    ensureDom();
    if (!root || !message || !dismissButton) return;
    root.hidden = false;
    message.textContent = t(
      gpuNoticeBodyKey({
        desktopShell: input.desktopShell,
        desktopPlatform: input.desktopPlatform,
        verdict,
      }),
    );
    dismissButton.textContent = t('gpuNotice.dismiss');
    displayed = mergeGpuNoticeVerdicts(displayed, verdict);
  };

  applyShellVerdict = (next: GpuNoticeVerdict): void => {
    const merged = mergeGpuNoticeVerdicts(localVerdict, next);
    if (gpuNoticeVerdictsEqual(merged, verdict)) return;
    verdict = merged;
    state = resolveGpuNotice({
      ...verdict,
      dismissedSignature: dismissedSignature(),
      legacyHybridDismissed: readLegacyHybridDismissed(),
    });
    render();
  };

  render();
  return state.shown;
}
