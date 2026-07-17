// Software-rendering notice: a one-time, dismissible, shell-level toast shown
// when the session runs on a software rasterizer (WARP, SwiftShader, llvmpipe).
// Since Chromium 141 removed the automatic SwiftShader fallback, the Windows
// no-GPU shape is the D3D11 WARP device: the game still boots and plays (low
// tier), but at a slideshow frame rate with no explanation; this toast is that
// explanation. State transitions live in the pure view-core
// (src/ui/gpu_notice_view.ts); this module is the thin DOM consumer (it owns a
// fixed-position element on document.body; styles in src/styles/shell.css
// "software rendering notice" section). It works on both the pre-game shell
// and in-world, like the desktop update toast it is modeled on.

import {
  dismissGpuNotice,
  type GpuNoticeState,
  gpuNoticeBodyKey,
  resolveGpuNotice,
} from './gpu_notice_view';
import { t } from './i18n';

// Per-install dismissal: the notice explains a machine-level condition, so once
// a player has read it, never nag again (a session-only fallback applies when
// storage is unavailable, e.g. hardened private modes).
const DISMISSED_KEY = 'woc_gpu_notice_dismissed';

function readDismissed(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeDismissed(): void {
  try {
    localStorage.setItem(DISMISSED_KEY, '1');
  } catch {
    // Storage unavailable: the in-memory dismissal still hides it this session.
  }
}

export function initGpuNotice(input: { softwareRendering: boolean; desktopShell: boolean }): void {
  let state: GpuNoticeState = resolveGpuNotice({
    softwareRendering: input.softwareRendering,
    dismissedBefore: readDismissed(),
  });
  if (!state.shown) return;

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
      state = dismissGpuNotice(state);
      writeDismissed();
      render();
    });
    root.append(message, dismissButton);
    document.body.appendChild(root);
  };

  const render = (): void => {
    if (!state.shown) {
      if (root) root.hidden = true;
      return;
    }
    ensureDom();
    if (!root || !message || !dismissButton) return;
    root.hidden = false;
    message.textContent = t(gpuNoticeBodyKey(input.desktopShell));
    dismissButton.textContent = t('gpuNotice.dismiss');
  };

  render();

  // Locale flips re-render whatever is currently shown (the language selector
  // dispatches this on both the shell and the in-game options path).
  document.addEventListener('woc:languagechange', render);
}
