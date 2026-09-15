// Whether a mouse click's own handler CLAIMED focus for a modal dialog, so the
// input layer's post-click focus drop (Input.releaseMouseActivatedFocus) must
// leave it alone.
//
// The drop exists for the button the mouse activated: left focused, it would
// replay on the next Space/Enter meant for jump or chat. But a click handler
// can open a modal (the confirm-dialog family: Disenchant, Salvage, the vendor
// sell confirm) and focus its OK button synchronously, in the SAME click. The
// window-level drop then ran on that freshly focused OK button and blurred it,
// so Enter no longer confirmed a disenchant or a sale (the "Enter to confirm
// stopped working" report). The discriminator: focus now sits inside an
// aria-modal dialog that the click target is NOT inside, which can only mean the
// handler moved it there. A click on a button INSIDE the modal (mouse-confirming
// it) still drops, exactly as before.
//
// Host-agnostic (everything reached off the passed nodes) so it unit-tests in
// plain Node against hand-rolled fakes, the pointer_blur.ts precedent.

/** The slice of a node the rule reads. `closest` is optional so a minimal fake, or
 *  a node already detached by a rebuild, degrades to "not inside a modal". */
export interface ClaimedFocusNode {
  closest?(selector: string): unknown;
}

/** An aria-modal dialog root: the confirm-dialog family (hud.ts confirmDialog)
 *  and the #prompt-stack prompts (installPromptDialog) both stamp this pair. */
export const MODAL_DIALOG_SELECTOR = '[role="dialog"][aria-modal="true"]';

function modalOf(node: unknown): unknown {
  const n = node as ClaimedFocusNode | null | undefined;
  return n?.closest?.(MODAL_DIALOG_SELECTOR) ?? null;
}

/** True when `active` (the focused element after the click ran) sits inside an
 *  aria-modal dialog that `target` (the clicked node) does not: the click handler
 *  opened that modal and parked focus in it, so the focus is keyboard-owned. */
export function clickClaimedModalFocus(active: ClaimedFocusNode, target: unknown): boolean {
  const activeModal = modalOf(active);
  if (!activeModal) return false;
  return activeModal !== modalOf(target);
}
