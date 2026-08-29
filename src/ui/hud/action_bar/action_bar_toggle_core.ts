// Pure model for the small plus/minus controls at the end of the primary action
// bar: which optional-row setting each button changes next, given the current
// row visibility. Plus reveals the next hidden optional row (secondary, then
// third, honoring the dependency rule in action_bar_visibility_core.ts); minus
// hides the topmost visible one (third, then secondary). A null action means
// the button has nothing left to do and renders disabled.

import type { ActionBarVisibility, ActionBarVisibilitySetting } from './action_bar_visibility_core';

export interface ActionBarToggleAction {
  setting: ActionBarVisibilitySetting;
  value: boolean;
}

export interface ActionBarToggleModel {
  /** The setting change a plus click applies, or null when both rows show. */
  expand: ActionBarToggleAction | null;
  /** The setting change a minus click applies, or null when no row shows. */
  collapse: ActionBarToggleAction | null;
}

export function actionBarToggleModel(visibility: ActionBarVisibility): ActionBarToggleModel {
  const expand: ActionBarToggleAction | null = !visibility.secondary
    ? { setting: 'showSecondaryActionBar', value: true }
    : !visibility.third
      ? { setting: 'showThirdActionBar', value: true }
      : null;
  const collapse: ActionBarToggleAction | null = visibility.third
    ? { setting: 'showThirdActionBar', value: false }
    : visibility.secondary
      ? { setting: 'showSecondaryActionBar', value: false }
      : null;
  return { expand, collapse };
}
