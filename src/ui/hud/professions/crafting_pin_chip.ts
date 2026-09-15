import { FOCUS_KEY_ATTR } from '../../focus_restore';
import { formatNumber, t } from '../../i18n';
import { RECIPE_TRACK_CAP, type RecipePinToggleResult } from '../../recipe_tracker_view';

export interface CraftingPinChipDeps {
  recipePinned(recipeId: string): boolean;
  onToggleRecipePin(recipeId: string): RecipePinToggleResult;
  announce(text: string): void;
}

export function renderCraftingPinChip(
  doc: Document,
  recipeId: string,
  resultName: string,
  deps: CraftingPinChipDeps,
): HTMLButtonElement {
  const pinBtn = doc.createElement('button');
  pinBtn.type = 'button';
  pinBtn.className = 'crafting-pin-chip';
  pinBtn.setAttribute(FOCUS_KEY_ATTR, `pin:${recipeId}`);
  const paintPin = (pinned: boolean): void => {
    pinBtn.setAttribute('aria-pressed', pinned ? 'true' : 'false');
    pinBtn.textContent = t(
      pinned ? 'hudChrome.recipeTracker.unpin' : 'hudChrome.recipeTracker.pin',
    );
    pinBtn.setAttribute(
      'aria-label',
      t(pinned ? 'hudChrome.recipeTracker.unpinAria' : 'hudChrome.recipeTracker.pinAria', {
        name: resultName,
      }),
    );
  };
  paintPin(deps.recipePinned(recipeId));
  pinBtn.addEventListener('click', () => {
    const result = deps.onToggleRecipePin(recipeId);
    if (result.full) {
      deps.announce(
        t('hudChrome.recipeTracker.pinFull', {
          cap: formatNumber(RECIPE_TRACK_CAP, { maximumFractionDigits: 0 }),
        }),
      );
      return;
    }
    paintPin(result.pinned.has(recipeId));
  });
  return pinBtn;
}
