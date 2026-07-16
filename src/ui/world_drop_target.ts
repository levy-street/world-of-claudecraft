// "Drag it out of the bag and drop it on the world to destroy it": the classic
// gesture that replaced right-click-destroys on the bags grid (right-click now
// uses/equips, like every other classic client).
//
// The world canvas is the drop target because dropping ONTO the world is what the
// player means by throwing a stack away; every other surface (a window, the action
// bar, the paperdoll) owns its own drop. Nothing is ever destroyed silently: the
// drop only OPENS the existing destroy prompt (confirm + quantity), which is also
// what protects a misfire, and a noDiscard item still refuses.
//
// Thin DOM consumer: the accept/refuse decision is the pure bagDestroyAction
// (bags_view.ts), the same one the tooltip hint reads.

import type { ItemDragState } from './item_drag_state';

export interface WorldDropTargetDeps {
  /** The world canvas (or any element standing in for the world surface). */
  root(): HTMLElement;
  /** The shared in-flight drag handle the bags grid publishes to. */
  state: ItemDragState;
  /** Whether the stack in flight can be destroyed right now (pure decision:
   *  'discard' opens the prompt, 'discardBlocked' refuses with feedback, 'none'
   *  means the drop is inert, e.g. a vendor/trade window owns the item). */
  destroyAction(itemId: string): 'discard' | 'discardBlocked' | 'none';
  /** Open the destroy prompt for the dropped stack (confirm + quantity). */
  promptDestroy(itemId: string, count: number): void;
  /** Refusal toast for a protected (noDiscard) item. */
  showBlocked(): void;
}

/** Wire the world canvas as the destroy drop target for a dragged bag stack.
 *  Called once at HUD construction; the listeners live for the session. */
export function installWorldDropTarget(deps: WorldDropTargetDeps): void {
  const el = deps.root();

  el.addEventListener('dragover', (e) => {
    const drag = deps.state.get();
    // Only a bag stack drops here. A hotbar/ability drag (or a file dragged in
    // from the desktop) leaves the canvas inert, exactly as before.
    if (!drag || deps.destroyAction(drag.itemId) === 'none') return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  });

  el.addEventListener('drop', (e) => {
    const drag = deps.state.get();
    if (!drag) return;
    const action = deps.destroyAction(drag.itemId);
    if (action === 'none') return;
    e.preventDefault();
    deps.state.end();
    if (action === 'discardBlocked') {
      deps.showBlocked();
      return;
    }
    deps.promptDestroy(drag.itemId, drag.count);
  });
}

/** The touch arm of the same gesture: the pointer released over the world (no
 *  window, no paperdoll socket under the finger). Shares the decision + prompt
 *  with the HTML5 drop above so the two gestures can never diverge. */
export function dropOnWorld(
  deps: Pick<WorldDropTargetDeps, 'destroyAction' | 'promptDestroy' | 'showBlocked'>,
  itemId: string,
  count: number,
): void {
  const action = deps.destroyAction(itemId);
  if (action === 'none') return;
  if (action === 'discardBlocked') {
    deps.showBlocked();
    return;
  }
  deps.promptDestroy(itemId, count);
}
