// Pure dependency rule for the optional desktop action-bar rows. The third row
// cannot be visible without the secondary row, and hiding the secondary row
// collapses both optional rows in one deterministic state transition.

export type ActionBarVisibilitySetting = 'showSecondaryActionBar' | 'showThirdActionBar';

export interface ActionBarVisibility {
  secondary: boolean;
  third: boolean;
}

export function resolveActionBarVisibility(
  current: ActionBarVisibility,
  setting: ActionBarVisibilitySetting,
  requested: boolean,
): ActionBarVisibility {
  if (setting === 'showSecondaryActionBar') {
    return {
      secondary: requested,
      third: requested && current.third,
    };
  }
  return {
    secondary: current.secondary,
    third: current.secondary && requested,
  };
}
