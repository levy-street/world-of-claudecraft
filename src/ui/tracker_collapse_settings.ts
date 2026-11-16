// The {available, collapsed, setCollapsed} port a collapsible HUD rail's
// controller takes to persist its own collapse choice (QuestTrackerController,
// MapSidebarController): `available()` guards against reading or writing before
// Hud.attachOptions has run, since every such controller is built inside Hud's
// constructor, ahead of that call. One factory over a boolean settings key
// instead of a copy of this closure trio per rail.

import type { BoolSettingKey } from '../game/settings';
import type { OptionsHooks } from './hud';

export interface TrackerCollapseSettingsPort {
  available(): boolean;
  collapsed(): boolean;
  setCollapsed(collapsed: boolean): void;
}

/** The quest tracker's two persisted collapses: the Quests section, and the
 *  World Quests section's own (QuestTrackerSettingsPort). */
export function questTrackerCollapseSettings(
  hooks: () => OptionsHooks | null,
): TrackerCollapseSettingsPort & {
  worldQuestsCollapsed(): boolean;
  setWorldQuestsCollapsed(collapsed: boolean): void;
} {
  const worldQuests = trackerCollapseSettings(hooks, 'worldQuestTrackerCollapsed');
  return {
    ...trackerCollapseSettings(hooks, 'questTrackerCollapsed'),
    worldQuestsCollapsed: worldQuests.collapsed,
    setWorldQuestsCollapsed: worldQuests.setCollapsed,
  };
}

export function trackerCollapseSettings(
  hooks: () => OptionsHooks | null,
  key: BoolSettingKey,
): TrackerCollapseSettingsPort {
  return {
    available: () => hooks() !== null,
    collapsed: () => (hooks()?.settings.get(key) ?? false) === true,
    setCollapsed: (collapsed) => {
      hooks()?.settings.set(key, collapsed);
    },
  };
}
