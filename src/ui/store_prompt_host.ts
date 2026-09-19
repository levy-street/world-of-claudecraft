// Where a Store decision prompt (store_decision_prompt.ts) mounts.
//
// Ordinarily #prompt-stack: it sits inside #ui and hud.css lifts it to z-index
// 96 while a decision is active, above the 50-89 window band. The two inspect
// overlays (armory_inspect.ts and mount_inspect_controller.ts) do NOT live in
// #ui: they mount on document.body at z-index 90, and #ui is itself a
// position:fixed stacking context at z-index 10 (base.css). Nothing inside #ui,
// whatever its own z-index, can paint above a body-level overlay. So a purchase
// confirm raised from an open inspector mounted UNDER the overlay's dimmer and
// behind its dialog: invisible to the player, while its focused Confirm button
// still took Enter (the "click does nothing, click then Enter buys it" report).
// Hit-testing hid the fault too: the controller makes the overlay inert, and
// inert elements are skipped by pointer hit-testing, so the covered prompt was
// still clickable by a player who knew where it was.
//
// While an inspect overlay is open the prompt therefore takes a body-level
// sibling host, #store-prompt-stack, which hud.css floors above the overlay
// with the same geometry as #prompt-stack. The host exists only while a
// decision is up; the nonmodal purchase result stays in #prompt-stack.

/** The body-level host a Store decision takes while an inspect overlay is up. */
export const STORE_PROMPT_HOST_ID = 'store-prompt-stack';

/** Both inspect overlays (the mount panel adds its own class on top of this one). */
export const INSPECT_OVERLAY_SELECTOR = '.armory-inspect-overlay';

/** Every place a modal Store or prompt-stack prompt can mount, for the HUD's
 *  game-key gate (Hud.promptModalOpen): a modal prompt in either host must
 *  block game keybinds the same way. */
export const MODAL_PROMPT_SELECTOR = `#prompt-stack .prompt[aria-modal="true"], #${STORE_PROMPT_HOST_ID} .prompt[aria-modal="true"]`;

/** The element a Store decision prompt must be appended to right now, or null
 *  when the page has no #prompt-stack (the prompt cannot open at all). The
 *  body-level host is minted on first use and reused while it exists. */
export function resolveStorePromptHost(): HTMLElement | null {
  const stack = document.getElementById('prompt-stack');
  if (!stack) return null;
  if (!document.querySelector(INSPECT_OVERLAY_SELECTOR)) return stack;
  const existing = document.getElementById(STORE_PROMPT_HOST_ID);
  if (existing) return existing;
  const host = document.createElement('div');
  host.id = STORE_PROMPT_HOST_ID;
  document.body.appendChild(host);
  return host;
}

/** Drop the body-level host once its last prompt is gone. #prompt-stack is
 *  page chrome and is never removed; a host that still holds a prompt stays. */
export function releaseStorePromptHost(host: HTMLElement): void {
  if (host.id !== STORE_PROMPT_HOST_ID || host.childElementCount > 0) return;
  host.remove();
}
