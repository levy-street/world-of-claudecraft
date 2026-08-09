// GPU notice family: a one-time, dismissible, shell-level toast covering two
// independent triggers (see src/ui/gpu_notice_view.ts):
// - software rendering (WARP/SwiftShader/llvmpipe): since Chromium 141
//   removed the automatic SwiftShader fallback, the Windows no-GPU shape is
//   the D3D11 WARP device, which still boots and plays (low tier) but at a
//   slideshow frame rate with no explanation; this toast is that explanation.
// - hybrid-GPU-likely (issue #2119): an integrated GPU on a machine that
//   likely also has a discrete one, where the page has no lever to switch
//   adapters (electron/gpu_preference.cjs already solves this in the desktop
//   shell; the browser path only has per-OS guidance).
// State transitions live in the pure view-core (src/ui/gpu_notice_view.ts);
// this module is the thin DOM consumer (it owns a fixed-position element on
// document.body; styles in src/styles/shell.css "software rendering notice"
// section, shared by both variants). It works on both the pre-game shell and
// in-world, like the desktop update toast it is modeled on.

import {
  type DesktopPlatform,
  dismissGpuNotice,
  type GpuNoticeState,
  gpuNoticeBodyKey,
  resolveGpuNotice,
} from './gpu_notice_view';
import { t } from './i18n';

// Per-install dismissal, one key per variant: each explains a different
// machine-level condition, so dismissing the software notice must never
// suppress a later hybrid one and vice versa. A session-only fallback applies
// when storage is unavailable (e.g. hardened private modes).
const SOFTWARE_DISMISSED_KEY = 'woc_gpu_notice_dismissed';
const HYBRID_DISMISSED_KEY = 'woc_gpu_notice_hybrid_dismissed';

function readDismissed(key: string): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeDismissed(key: string): void {
  try {
    localStorage.setItem(key, '1');
  } catch {
    // Storage unavailable: the in-memory dismissal still hides it this session.
  }
}

// Returns true when the notice was shown this boot, so the perf-nudge sibling
// can suppress its redundant software arm (packet 0 ruling R16); everything
// else here is unchanged by that packet.
export function initGpuNotice(input: {
  softwareRendering: boolean;
  hybridGpuLikely: boolean;
  desktopShell: boolean;
  desktopPlatform: DesktopPlatform;
}): boolean {
  let state: GpuNoticeState = resolveGpuNotice({
    softwareRendering: input.softwareRendering,
    hybridGpuLikely: input.hybridGpuLikely,
    softwareDismissedBefore: readDismissed(SOFTWARE_DISMISSED_KEY),
    hybridDismissedBefore: readDismissed(HYBRID_DISMISSED_KEY),
  });
  if (!state.shown || !state.variant) return false;

  let root: HTMLDivElement | null = null;
  let message: HTMLSpanElement | null = null;
  let dismissButton: HTMLButtonElement | null = null;

  const ensureDom = (): void => {
    if (root) return;
    root = document.createElement('div');
    root.id = 'gpu-notice';
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'polite');
    root.hidden = true;
    message = document.createElement('span');
    message.className = 'gpu-notice-message';
    dismissButton = document.createElement('button');
    dismissButton.type = 'button';
    dismissButton.className = 'gpu-notice-dismiss';
    dismissButton.addEventListener('click', () => {
      const key = state.variant === 'hybrid' ? HYBRID_DISMISSED_KEY : SOFTWARE_DISMISSED_KEY;
      state = dismissGpuNotice(state);
      writeDismissed(key);
      render();
    });
    root.append(message, dismissButton);
    document.body.appendChild(root);
  };

  const render = (): void => {
    if (!state.shown || !state.variant) {
      if (root) root.hidden = true;
      return;
    }
    ensureDom();
    if (!root || !message || !dismissButton) return;
    root.hidden = false;
    message.textContent = t(
      gpuNoticeBodyKey({
        variant: state.variant,
        desktopShell: input.desktopShell,
        desktopPlatform: input.desktopPlatform,
      }),
    );
    dismissButton.textContent = t('gpuNotice.dismiss');
  };

  render();

  // Locale flips re-render whatever is currently shown (the language selector
  // dispatches this on both the shell and the in-game options path).
  document.addEventListener('woc:languagechange', render);
  return true;
}
