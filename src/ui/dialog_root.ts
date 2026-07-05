// Thin DOM helper for a cold-window dialog root. About a dozen window painters (and the
// hud.ts quest dialog) set the same role=dialog + aria-modal + one accessible name +
// tabindex micro-pattern by hand; this folds it into one call so the shape can never drift
// between them. Those sites shipped inline and deliberately left the rule-of-three
// duplication; this helper extracts it.
//
// COLD-window helper by design: the writes are raw setAttribute, NOT routed through the
// PainterHost write-elision facet. That facet is the per-frame hot-path boundary; these
// dialog roots are cold (set once per open, byte-identical to the prior inline code), so
// routing them through the elider would buy nothing and is outside its scope. markDialogRoot
// touches the DOM, so it is NOT a registered pure core.
//
// Exactly ONE accessible name: aria-labelledby SHADOWS aria-label in the accessible-name
// computation, so a root must carry one, never both. labelledBy wins when
// given; the opposite attribute is always cleared so a root that switches its name across
// renders (the options window names itself per sub-view) never leaves a stale one behind.

export interface DialogRootOptions {
  /** Associate the name with an existing element id (preferred; shadows aria-label). */
  labelledBy?: string;
  /** A literal accessible name (already localized via t()), when there is no title id. */
  label?: string;
  /** aria-modal value; defaults to false (these roots trap focus but do not inert the page). */
  modal?: boolean;
}

export function markDialogRoot(el: HTMLElement, opts: DialogRootOptions): void {
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', opts.modal ? 'true' : 'false');
  el.setAttribute('tabindex', '-1');
  if (opts.labelledBy !== undefined) {
    el.removeAttribute('aria-label');
    el.setAttribute('aria-labelledby', opts.labelledBy);
  } else if (opts.label !== undefined) {
    el.removeAttribute('aria-labelledby');
    el.setAttribute('aria-label', opts.label);
  }
}
