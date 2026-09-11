// The options window's shell, one thin DOM adapter over the ui-* window-shell
// primitives (src/styles/library.css, src/ui/library/CLAUDE.md).
//
// The shape it mounts is head, then ONE scrolling body, and the caller appends
// its action row to the ROOT afterwards, which makes that row a SIBLING of the
// scroller rather than its last child. That sibling relationship is the whole
// point: a settings page with an Apply, Reset or Confirm row must keep the row
// in view however long the page runs (the Graphics dial list is the case that
// prompted it), and no amount of body content can push it away.
//
// Its own module rather than a method on the options painter: the painter is at
// its line ceiling (tests/monolith_budget.test.ts) and this is generic chrome,
// not options logic.

/**
 * Reset `root` to a window shell: the given head markup, then an empty
 * `.ui-win-body` scroller, which is returned for the caller to fill.
 *
 * `bodyClass` rides ON the scroller (never a wrapper around it), so a legacy
 * per-window body class and its selectors keep working unchanged.
 */
export function mountViewShell(
  root: HTMLElement,
  headHtml: string,
  bodyClass?: string,
): HTMLElement {
  root.innerHTML = headHtml;
  const body = document.createElement('div');
  body.className = bodyClass ? `${bodyClass} ui-win-body` : 'ui-win-body';
  root.appendChild(body);
  return body;
}
