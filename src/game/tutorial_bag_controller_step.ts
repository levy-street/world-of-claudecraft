export type TutorialBagControllerStep =
  | 'enterHud'
  | 'navigateToBlockingWindowClose'
  | 'closeBlockingWindow'
  | 'navigateToBags'
  | 'openBags'
  | 'navigateToItem'
  | 'useItem';

export interface TutorialBagControllerState {
  bagsOpen: boolean;
  blockingWindowOpen: boolean;
  blockingWindowCloseFocused: boolean;
  padFocusActive: boolean;
  bagsButtonFocused: boolean;
  itemFocused: boolean;
}

export function tutorialBagControllerStep(
  state: TutorialBagControllerState,
): TutorialBagControllerStep {
  if (state.blockingWindowOpen) {
    if (!state.padFocusActive) return 'enterHud';
    return state.blockingWindowCloseFocused
      ? 'closeBlockingWindow'
      : 'navigateToBlockingWindowClose';
  }
  if (!state.bagsOpen) {
    if (!state.padFocusActive) return 'enterHud';
    return state.bagsButtonFocused ? 'openBags' : 'navigateToBags';
  }
  return state.padFocusActive && state.itemFocused ? 'useItem' : 'navigateToItem';
}
