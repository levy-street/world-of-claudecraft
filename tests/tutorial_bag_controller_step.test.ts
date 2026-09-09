import { describe, expect, it } from 'vitest';
import { tutorialBagControllerStep } from '../src/game/tutorial_bag_controller_step';

describe('tutorialBagControllerStep', () => {
  it.each([
    [
      'enterHud',
      {
        bagsOpen: false,
        blockingWindowOpen: false,
        blockingWindowCloseFocused: false,
        padFocusActive: false,
        bagsButtonFocused: false,
        itemFocused: false,
      },
    ],
    [
      'navigateToBags',
      {
        bagsOpen: false,
        blockingWindowOpen: false,
        blockingWindowCloseFocused: false,
        padFocusActive: true,
        bagsButtonFocused: false,
        itemFocused: false,
      },
    ],
    [
      'openBags',
      {
        bagsOpen: false,
        blockingWindowOpen: false,
        blockingWindowCloseFocused: false,
        padFocusActive: true,
        bagsButtonFocused: true,
        itemFocused: false,
      },
    ],
    [
      'navigateToItem',
      {
        bagsOpen: true,
        blockingWindowOpen: false,
        blockingWindowCloseFocused: false,
        padFocusActive: true,
        bagsButtonFocused: false,
        itemFocused: false,
      },
    ],
    [
      'useItem',
      {
        bagsOpen: true,
        blockingWindowOpen: false,
        blockingWindowCloseFocused: false,
        padFocusActive: true,
        bagsButtonFocused: false,
        itemFocused: true,
      },
    ],
    [
      'navigateToBlockingWindowClose',
      {
        bagsOpen: true,
        blockingWindowOpen: true,
        blockingWindowCloseFocused: false,
        padFocusActive: true,
        bagsButtonFocused: false,
        itemFocused: false,
      },
    ],
    [
      'closeBlockingWindow',
      {
        bagsOpen: true,
        blockingWindowOpen: true,
        blockingWindowCloseFocused: true,
        padFocusActive: true,
        bagsButtonFocused: false,
        itemFocused: false,
      },
    ],
  ] as const)('returns %s from the live UI state', (expected, state) => {
    expect(tutorialBagControllerStep(state)).toBe(expected);
  });

  it('moves backward when the Bags window closes or HUD focus is released', () => {
    expect(
      tutorialBagControllerStep({
        bagsOpen: false,
        blockingWindowOpen: false,
        blockingWindowCloseFocused: false,
        padFocusActive: true,
        bagsButtonFocused: true,
        itemFocused: true,
      }),
    ).toBe('openBags');
    expect(
      tutorialBagControllerStep({
        bagsOpen: false,
        blockingWindowOpen: false,
        blockingWindowCloseFocused: false,
        padFocusActive: false,
        bagsButtonFocused: true,
        itemFocused: true,
      }),
    ).toBe('enterHud');
    expect(
      tutorialBagControllerStep({
        bagsOpen: true,
        blockingWindowOpen: false,
        blockingWindowCloseFocused: false,
        padFocusActive: false,
        bagsButtonFocused: false,
        itemFocused: true,
      }),
    ).toBe('navigateToItem');
  });
});
