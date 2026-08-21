// The blocked-state half of the "Space reopens the last-used menu" fix (the
// pointer-only blur in src/ui/pointer_blur.ts is the primary half). While
// gameplay input is blocked (a modal window, a prompt, the camera prompt, or a
// graphics rebuild pause; see gameplay_input_gate.ts), Input.onKeyDown returns
// BEFORE its Space preventDefault, so the browser natively activates whatever
// button still holds document focus on keyup. That is correct for a button
// INSIDE the blocking surface (the prompt-dialog family, the options window,
// and the player card depend on native Space activation while they block), and
// wrong for any HUD chrome button left focused from before the surface opened.
//
// The discriminator is the dialog root: every blocking surface in this tree
// roots its controls under [role="dialog"] or [aria-modal="true"] (the
// markDialogRoot contract, the prompt-stack prompts, the player card modal,
// the camera prompt, the mobile More tray, and the emote wheel + emote editor,
// which hud.ts marks explicitly for this guard), so a focused BUTTON outside
// any dialog root is stale by definition while input is blocked. The pin in
// tests/pointer_blur.test.ts keeps the two explicit marks from regressing. Non-modal panel
// buttons (bags, bank, map) keep their deliberate Space activation either way: a
// focused panel button's keydown never reaches the window handler (the hud.ts
// panel guard stops propagation), whether or not its panel is dialog-rooted (the
// bags and bank windows are; the map window is a plain .window.panel).
//
// The guard SUPPRESSES the activation and leaves focus where it is: at keydown
// time it cannot tell stale pointer focus from the place a keyboard user just
// Tabbed to (Chromium flips :focus-visible on the very keypress), every further
// Space lands in the same guard, and the unblocked path prevents Space anyway,
// so dropping focus would cost a keyboard user their place for no Space gain.
// Known residuals: (1) Enter on a stale mouse-focused chrome button still
// natively activates it while blocked (the guard is Space-only; Enter carries
// the same keydown-time ambiguity, and a blur here would only have shielded it
// incidentally), which the pointer-only drop on every wired surface is the real
// answer to; (2) the graphics rebuild pause blocks input with no surface at all,
// so a keyboard-focused chrome button loses its Space activation during that
// pause (short, and every other blocked state puts focus inside a dialog root).
//
// Host-agnostic (everything reached off the passed element) so it unit-tests
// in plain Node; input.ts passes document.activeElement. Registered as a pure
// core in tests/architecture.test.ts (UI_PURE_CORES, a src/game leaf like
// presentation_gate.ts), so the purity sweep keeps it import-free.

/** The slice of an element the staleness check needs. */
export interface FocusedChromeEl {
  tagName: string;
  closest(selector: string): unknown;
}

/** True when `active` is a focused chrome BUTTON outside every dialog root:
 *  the stale-focus case whose native Space activation must be suppressed while
 *  gameplay input is blocked. */
export function isStaleChromeButton(active: FocusedChromeEl | null | undefined): boolean {
  if (active?.tagName !== 'BUTTON') return false;
  return active.closest('[role="dialog"], [aria-modal="true"]') === null;
}
