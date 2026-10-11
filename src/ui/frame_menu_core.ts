import type { TranslationKey } from './i18n.catalog';
import { frameRowSettingKey } from './interface_unlock_core';

export const FRAME_MENU_GROUPS = [
  ['units', 'hudChrome.frameMenus.units'],
  ['bars', 'hudChrome.frameMenus.bars'],
  ['trackers', 'hudChrome.frameMenus.trackers'],
  ['auras', 'hudChrome.frameMenus.auras'],
  ['combat', 'hudChrome.frameMenus.combat'],
  ['other', 'hudChrome.frameMenus.other'],
] as const satisfies readonly (readonly [string, TranslationKey])[];

export function frameMenuGroup(id: string): (typeof FRAME_MENU_GROUPS)[number][0] {
  if (
    ['playerFrame', 'targetFrame', 'targetOfTarget', 'partyFrames', 'petFrame'].includes(id) ||
    id.startsWith('focusTarget')
  )
    return 'units';
  if (id.startsWith('actionBar') || ['petBar', 'stanceBar', 'xpBar'].includes(id)) return 'bars';
  if (id.endsWith('Tracker') || id === 'trackerGroup') return 'trackers';
  if (
    id.startsWith('auraTrack_') ||
    ['auraGroup', 'targetDots', 'buffBar', 'debuffBar'].includes(id)
  )
    return 'auras';
  if (
    [
      'castBar',
      'swingBar',
      'swingBarOffhand',
      'targetSwingBar',
      'damageMeter',
      'procOverlay',
      'doomMeter',
      'paladinDevotion',
    ].includes(id)
  )
    return 'combat';
  return 'other';
}

/** Shared by the frame shortcut and the full Interface panel. */
export function frameSettingRelated(id: string, key: string): boolean {
  if (key === 'playerFrameHealthText' || key === 'targetFrameHealthText') return false;
  if (key === 'frameSnapToGrid' || key === frameRowSettingKey(id)) return true;
  if (frameMenuGroup(id) === 'trackers' && key === 'combineTrackerFrames') return true;
  if (frameMenuGroup(id) === 'auras' && key === 'combineAuraFrames') return true;
  if (id === 'auraGroup') return /^(show.*Track|showTargetDots|showUtilityModes)$/.test(key);
  if (id === 'trackerGroup') return /^(show.*Tracker|combineTrackerFrames)$/.test(key);
  if (id.startsWith('actionBar'))
    return /^(actionBar[123]Vertical|actionBarsVertical|combineActionBars|hideUnusedActionSlots|lockActionBars|showSecondaryActionBar|showThirdActionBar|showAttackButton)$/.test(
      key,
    );
  if (id.startsWith('focusTarget'))
    return key === 'showEmptyFocusFrames' || key === 'mouseoverCast' || key.startsWith(id);
  if (id === 'partyFrames') return key.startsWith('partyFrame') || key === 'mouseoverCast';
  if (id === 'playerFrame')
    return (
      key.startsWith('playerFrame') ||
      [
        'lockPlayerFrameToActionBar',
        'aurasOnPlayerFrame',
        'auraBarBelowFrame',
        'alwaysShowAllBuffs',
        'showWalletOnPlayerCard',
      ].includes(key)
    );
  if (id === 'targetFrame')
    return (
      key.startsWith('targetFrame') ||
      ['showTargetOfTarget', 'moveTargetOfTargetIndependently', 'showTargetSwingTimer'].includes(
        key,
      )
    );
  if (id === 'targetOfTarget')
    return ['showTargetOfTarget', 'moveTargetOfTargetIndependently'].includes(key);
  if (id === 'buffBar')
    return [
      'buffsLeftToRight',
      'aurasOnPlayerFrame',
      'auraBarBelowFrame',
      'alwaysShowAllBuffs',
    ].includes(key);
  if (id === 'debuffBar') return key === 'debuffsLeftToRight';
  if (id === 'auraTrack_utility') return key === 'showUtilityModes';
  if (id === 'menu') return key === 'menuRailHorizontal';
  if (id === 'minimap') return /minimap/i.test(key);
  if (id === 'chat') return /^(chat|compactChat|filterProfanity)/.test(key);
  if (id === 'petFrame') return key === 'showPetFrame' || key.startsWith('petFrame');
  return false;
}
