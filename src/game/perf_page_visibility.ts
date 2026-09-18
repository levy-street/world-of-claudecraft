// The browser arm of the PerfMonitor hidden-time ledger.
//
// A background tab stops its rAF frames while wall seconds keep counting, so
// the session fps average (frames / visible seconds) was permanently diluted
// after every background stint: the ledger that discounts hidden time was fed
// only by the desktop shell's presentation push. This binds the page's own
// visibility to the same ledger. Inert in the shell, whose document stays
// 'visible' while minimized (backgroundThrottling is off there), and
// document-free so a test drives it with a stub.

export interface PageVisibilityDocument {
  readonly visibilityState: string;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

export interface PageHiddenSink {
  setPageHidden(hidden: boolean, now?: number): void;
}

/** Anything but 'visible' (so 'hidden' and the rare 'prerender') is hidden. */
export function pageHiddenFromState(visibilityState: string): boolean {
  return visibilityState !== 'visible';
}

/**
 * Feed the page's visibility into the monitor's ledger: once at bind time (a
 * monitor created behind a hidden tab starts hidden) and on every change.
 * Returns the unsubscribe hook.
 */
export function bindPerfPageVisibility(
  perf: PageHiddenSink,
  doc: PageVisibilityDocument,
  now?: () => number,
): () => void {
  const apply = (): void => {
    perf.setPageHidden(pageHiddenFromState(doc.visibilityState), now?.());
  };
  apply();
  doc.addEventListener('visibilitychange', apply);
  return () => doc.removeEventListener('visibilitychange', apply);
}
