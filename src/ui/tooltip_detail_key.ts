// Tracks whether the tooltip "more detail" modifier (Shift) is held, and tells
// the HUD when it flips so a visible tooltip can repaint in place. Holding
// Shift over an ability shows its detail block (ability_tooltip_detail_core.ts).
//
// The transition rule is a pure function a Vitest drives with plain event
// shapes; the class is the thin listener owner.

export interface DetailKeyEvent {
  type: string;
  key?: string;
}

/** The next held state after `event`, given the current one. A window blur
 *  always clears it: the keyup for a Shift released while another window had
 *  focus never arrives, and a stuck detail mode would be worse than none. */
export function detailHeldAfter(held: boolean, event: DetailKeyEvent): boolean {
  if (event.type === 'blur') return false;
  if (event.key !== 'Shift') return held;
  if (event.type === 'keydown') return true;
  if (event.type === 'keyup') return false;
  return held;
}

type ListenerTarget = Pick<Window, 'addEventListener' | 'removeEventListener'>;

export class TooltipDetailKey {
  private held = false;

  isHeld(): boolean {
    return this.held;
  }

  /** Listen on `target`; `onChange` runs only when the held state flips (key
   *  auto-repeat fires keydown many times, and each must not repaint). Returns
   *  the uninstall. */
  install(target: ListenerTarget, onChange: () => void): () => void {
    const handle = (event: Event) => {
      const next = detailHeldAfter(this.held, event as KeyboardEvent);
      if (next === this.held) return;
      this.held = next;
      onChange();
    };
    target.addEventListener('keydown', handle);
    target.addEventListener('keyup', handle);
    target.addEventListener('blur', handle);
    return () => {
      target.removeEventListener('keydown', handle);
      target.removeEventListener('keyup', handle);
      target.removeEventListener('blur', handle);
    };
  }
}
