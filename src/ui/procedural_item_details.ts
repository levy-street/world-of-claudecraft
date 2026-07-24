export interface ItemDetailModifierTarget {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}

export interface ItemDetailModifierDocument extends ItemDetailModifierTarget {
  readonly hidden: boolean;
  readonly body: {
    classList: {
      toggle(name: string, force?: boolean): boolean;
      remove(name: string): void;
    };
  };
}

const ADVANCED_ITEM_DETAILS_CLASS = 'item-details-advanced';

/**
 * Exposes possible procedural roll ranges while Alt is held.
 *
 * The state is a body class because the tooltip HTML is already mounted when
 * the modifier changes. CSS can reveal the existing range spans immediately,
 * without rebuilding the tooltip or drawing from gameplay RNG.
 */
export function installItemDetailModifier(
  documentTarget: ItemDetailModifierDocument,
  windowTarget: ItemDetailModifierTarget,
): () => void {
  const set = (shown: boolean): void => {
    documentTarget.body.classList.toggle(ADVANCED_ITEM_DETAILS_CLASS, shown);
  };
  const onKeyDown = (event: Event): void => {
    const keyboard = event as KeyboardEvent;
    if (keyboard.key === 'Alt' || keyboard.altKey) set(true);
  };
  const onKeyUp = (event: Event): void => {
    const keyboard = event as KeyboardEvent;
    if (keyboard.key === 'Alt' || !keyboard.altKey) set(false);
  };
  const clear = (): void => set(false);
  const onVisibility = (): void => {
    if (documentTarget.hidden) clear();
  };

  windowTarget.addEventListener('keydown', onKeyDown);
  windowTarget.addEventListener('keyup', onKeyUp);
  windowTarget.addEventListener('blur', clear);
  documentTarget.addEventListener('visibilitychange', onVisibility);

  return () => {
    windowTarget.removeEventListener('keydown', onKeyDown);
    windowTarget.removeEventListener('keyup', onKeyUp);
    windowTarget.removeEventListener('blur', clear);
    documentTarget.removeEventListener('visibilitychange', onVisibility);
    documentTarget.body.classList.remove(ADVANCED_ITEM_DETAILS_CLASS);
  };
}
