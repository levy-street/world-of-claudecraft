import type { GameSettings } from '../game/settings';
import { frameSettingRelated } from './frame_menu_core';
import type { InterfaceTab } from './options_view';

export const INTERFACE_OFF_MENU_KEYS: Record<InterfaceTab, readonly (keyof GameSettings)[]> = {
  general: ['uiScale'],
  frames: [
    'playerFrameScale',
    'targetFrameScale',
    'partyFrameScale',
    // The interface editor's dimension drags (movable_frame.ts,
    // resizeMode 'dimensions') write these; no slider shows them, so the
    // Frames reset must name them explicitly.
    'playerFrameWidth',
    'playerFrameHeight',
    'targetFrameWidth',
    'targetFrameHeight',
    'petFrameWidth',
    'petFrameHeight',
    'focusTarget1Width',
    'focusTarget1Height',
    'focusTarget2Width',
    'focusTarget2Height',
    'focusTarget3Width',
    'focusTarget3Height',
    'showPetFrame',
    'showEmptyFocusFrames',
    'partyFrameWidth',
    'partyFrameHeight',
    'partyFrameColumns',
    'partyFrameSpacing',
    'buffsLeftToRight',
    'debuffsLeftToRight',
    'lockPlayerFrameToActionBar',
    'actionBar1Vertical',
    'actionBar2Vertical',
    'actionBar3Vertical',
    'menuRailHorizontal',
    'frameSnapToGrid',
    'combineActionBars',
    'combineTrackerFrames',
    'combineAuraFrames',
    'moveTargetOfTargetIndependently',
    'hideUnusedActionSlots',
    'mouseoverCast',
    'lockActionBars',
  ],
  chat: [],
  combat: [],
};

/** Include retired sizing keys, scoped to the selected frame when opened from its shortcut. */
export function interfaceResetKeys(
  tab: InterfaceTab,
  frameId: string | null,
  visible: readonly (keyof GameSettings)[],
): (keyof GameSettings)[] {
  return [
    ...visible,
    ...INTERFACE_OFF_MENU_KEYS[tab].filter((key) => !frameId || frameSettingRelated(frameId, key)),
  ];
}
