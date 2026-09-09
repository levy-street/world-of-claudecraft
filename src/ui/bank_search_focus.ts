// The bank window's search-box focus carry: capture the caret of a focused
// `.bag-search` input BEFORE a full rebuild wipes it, restore it onto the
// fresh input AFTER. A sibling of bank_window.ts (the rebuild it serves) so
// both panes that carry a search box (the personal bank's filter bar and the
// guild history) share one rule instead of two copies, and so the window
// stays under its ratchet.
//
// WHY THIS EXISTS: the slow-band refreshIfChanged can land a data repaint (a
// deposit's echo, another officer's op) moments after the player focused the
// search box, and every keystroke in the history search repaints too. The
// rebuild replaces the input node, and stealing focus to the close button
// mid-typing was a live bug (proven by the online browser smoke probe). The
// fresh input's VALUE is re-installed from the owner's remembered query; only
// focus and caret need carrying across, which is all this does.
//
// Host-agnostic on purpose: no `document` or `window`, only the root it is
// handed and the element the caller says was active, so a fake DOM can drive
// it and the architecture sweep classifies it as a plain module.

/** The caret of the focused search box, or null when it was not focused. */
export interface SearchCaret {
  start: number | null;
  end: number | null;
}

const SEARCH_SELECTOR = '.bag-search';

/** Capture BEFORE the wipe: the caret when `active` is the root's search box. */
export function captureSearchCaret(root: ParentNode, active: Element | null): SearchCaret | null {
  const search = root.querySelector(SEARCH_SELECTOR) as HTMLInputElement | null;
  if (search === null || active !== search) return null;
  return { start: search.selectionStart, end: search.selectionEnd };
}

/**
 * Restore AFTER the rebuild onto the fresh search box. True when focus landed
 * there; false when there was nothing to restore or the rebuild dropped the
 * box (the bank emptied), so the caller can fall through to its own ladder.
 * preventScroll: the scroll offset was just restored, and on a short phone
 * the box can sit far above the fold (focus_restore.ts records the why).
 */
export function restoreSearchCaret(root: ParentNode, caret: SearchCaret | null): boolean {
  if (caret === null) return false;
  const fresh = root.querySelector(SEARCH_SELECTOR) as HTMLInputElement | null;
  if (fresh === null) return false;
  fresh.focus({ preventScroll: true });
  fresh.setSelectionRange(caret.start, caret.end);
  return true;
}
