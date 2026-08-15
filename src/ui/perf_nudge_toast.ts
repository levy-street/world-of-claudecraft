// Performance nudge: a one-time, dismissible, shell-level toast shown when the
// client perf-doctor finds a MACHINE-LOCAL cause of bad performance (software
// rendering, or a hybrid laptop stuck on its integrated GPU). A sibling of the
// boot-time software-rendering notice (gpu_notice_toast.ts), never a refactor
// of it (packet 0 ruling R16). State transitions live in the pure view-core
// (src/ui/perf_nudge_view.ts); this module is the thin DOM consumer (it owns a
// fixed-position element on document.body; styles in src/styles/shell.css
// "performance nudge toast" section). Assembled by src/game/perf_nudge.ts after
// real gameplay frames, so it works in-world on both game entries.

import { t } from './i18n';
import {
  dismissPerfNudge,
  type PerfNudgeState,
  perfNudgeDismissalValue,
  resolvePerfNudge,
} from './perf_nudge_view';

// Per-install dismissal keyed by the TRIGGERING ID SET (ruling R16): the stored
// value is perfNudgeDismissalValue(ids), so the same causes never re-nag while
// a different trigger set re-arms the toast. A session-only fallback applies
// when storage is unavailable (hardened private modes).
const DISMISSED_KEY = 'woc_perf_nudge_dismissed';

function readDismissedValue(): string {
  try {
    return (typeof localStorage !== 'undefined' && localStorage.getItem(DISMISSED_KEY)) || '';
  } catch {
    return '';
  }
}

function writeDismissedValue(value: string): void {
  try {
    localStorage.setItem(DISMISSED_KEY, value);
  } catch {
    // Storage unavailable: the in-memory dismissal still hides it this session.
  }
}

export interface PerfNudgeToastInput {
  suggestionIds: readonly string[];
  softwareNoticeAlreadyShown: boolean;
  desktopShell: boolean;
}

/** Returns true when the nudge was actually shown (the assembler stops then). */
export function initPerfNudgeToast(input: PerfNudgeToastInput): boolean {
  const dismissalValue = perfNudgeDismissalValue(input.suggestionIds);
  let state: PerfNudgeState = resolvePerfNudge({
    suggestionIds: input.suggestionIds,
    softwareNoticeAlreadyShown: input.softwareNoticeAlreadyShown,
    // An empty dismissal value means nothing nudge-worthy; never read that as
    // dismissed (an empty stored value would otherwise match it).
    dismissedBefore: dismissalValue !== '' && readDismissedValue() === dismissalValue,
    desktopShell: input.desktopShell,
  });
  if (!state.shown) return false;
  const bodyKey = state.bodyKey;
  if (!bodyKey) return false;

  let root: HTMLDivElement | null = null;
  let message: HTMLSpanElement | null = null;
  let dismissButton: HTMLButtonElement | null = null;

  const ensureDom = (): void => {
    if (root) return;
    root = document.createElement('div');
    root.id = 'perf-nudge';
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'polite');
    root.hidden = true;
    message = document.createElement('span');
    message.className = 'perf-nudge-message';
    dismissButton = document.createElement('button');
    dismissButton.type = 'button';
    dismissButton.className = 'perf-nudge-dismiss';
    dismissButton.addEventListener('click', () => {
      state = dismissPerfNudge(state);
      writeDismissedValue(dismissalValue);
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
    message.textContent = t(bodyKey);
    dismissButton.textContent = t('perfNudge.dismiss');
  };

  render();

  // Locale flips re-render whatever is currently shown (the language selector
  // dispatches this on both the shell and the in-game options path).
  document.addEventListener('woc:languagechange', render);
  return true;
}
