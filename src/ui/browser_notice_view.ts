// Pure view-core for the unsupported-browser notice (DOM-free, Node-tested).
// The thin DOM consumer is src/game/browser_notice.ts; the detection helper
// is src/game/browser_detect.ts.
//
// The notice is advisory only: it never blocks play or gating. A dismissed
// notice never re-nags; a supported browser never sees it at all.

export interface BrowserNoticeState {
  shown: boolean;
  dismissed: boolean;
}

/** Resolve the initial state: show only on an unsupported browser, never re-nag. */
export function resolveBrowserNotice(input: {
  unsupported: boolean;
  dismissedBefore: boolean;
}): BrowserNoticeState {
  return {
    shown: input.unsupported && !input.dismissedBefore,
    dismissed: input.dismissedBefore,
  };
}

/** The player closed the notice: hide it and remember the dismissal. */
export function dismissBrowserNotice(_state: BrowserNoticeState): BrowserNoticeState {
  return { shown: false, dismissed: true };
}
