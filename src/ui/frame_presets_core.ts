import { transferKeyAllowed } from './settings_transfer_core';

export const FRAME_PRESET_LIMIT = 10;
export const FRAME_PRESETS_MAX_LENGTH = 1024 * 1024;
export const FRAME_PRESETS_KEY = 'woc_frame_presets_v1';
export const FRAME_PRESET_SETTINGS = new Set([
  'playerFrameScale',
  'targetFrameScale',
  'partyFrameScale',
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
  'combineActionBars',
  'combineTrackerFrames',
  'combineAuraFrames',
  'moveTargetOfTargetIndependently',
  'hideUnusedActionSlots',
  'uiScale',
  'partyFrameStyle',
  'partyFrameHealthText',
  'partyFrameSort',
  'partyFrameShowResource',
  'partyFrameShowAbsorbs',
  'partyFrameShowAuras',
  'partyFrameShowPets',
  'partyFrameShowSelf',
  'aurasOnPlayerFrame',
  'auraBarBelowFrame',
  'alwaysShowAllBuffs',
  'showTargetOfTarget',
  'showTargetSwingTimer',
  'showSecondaryActionBar',
  'showThirdActionBar',
  'showAttackButton',
  'showReliquaryTracker',
  'showTargetDots',
  'showDefensivesTrack',
  'showSelfBuffTrack',
  'showOffensiveTrack',
  'showUtilityTrack',
  'showUtilityModes',
  'showFriendlyTrack',
  'showShieldTrack',
] as const);
type FramePresetSetting = typeof FRAME_PRESET_SETTINGS extends Set<infer Key> ? Key : never;
export interface FramePreset {
  name: string;
  geometry: Record<string, string>;
  settings: Partial<Record<FramePresetSetting, number | boolean>>;
}
export function framePresetGeometryKey(key: string): boolean {
  return (
    transferKeyAllowed('frames', key) ||
    [
      'woc_player_frame_pos_hidden',
      'woc_target_frame_pos_hidden',
      'woc_party_frame_pos_hidden',
      'woc_actionbar_bind_banner',
      'woc_party_collapsed',
      'woc_target_auras_filter',
      'woc_target_auras_visible',
      'woc_target_auras_visible_rows',
      'woc_target_auras_show_sources',
      'woc_target_auras_opacity',
      'woc_chat_frame_hidden',
    ].includes(key)
  );
}
export function parseFramePresets(text: string | null): (FramePreset | null)[] {
  const empty = () => Array<FramePreset | null>(FRAME_PRESET_LIMIT).fill(null);
  if (!text || text.length > FRAME_PRESETS_MAX_LENGTH) return empty();
  try {
    const data = JSON.parse(text);
    if (data?.v !== 1 || !Array.isArray(data.slots)) return empty();
    return empty().map((_, index) => {
      const slot = data.slots[index];
      if (
        !slot ||
        typeof slot.name !== 'string' ||
        !slot.name.trim() ||
        !slot.geometry ||
        typeof slot.geometry !== 'object' ||
        Array.isArray(slot.geometry) ||
        !slot.settings ||
        typeof slot.settings !== 'object' ||
        Array.isArray(slot.settings)
      )
        return null;
      const geometry: Record<string, string> = {};
      const settings: Partial<Record<FramePresetSetting, number | boolean>> = {};
      for (const [key, value] of Object.entries(slot.geometry))
        if (framePresetGeometryKey(key) && typeof value === 'string' && value.length <= 128 * 1024)
          geometry[key] = value;
      for (const [key, value] of Object.entries(slot.settings))
        if (
          isFramePresetSetting(key) &&
          (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)))
        )
          Object.assign(settings, { [key]: value });
      return { name: slot.name.slice(0, 40), geometry, settings };
    });
  } catch {
    return empty();
  }
}

export function isFramePresetSetting(key: string): key is FramePresetSetting {
  return FRAME_PRESET_SETTINGS.has(key as FramePresetSetting);
}

/** A portable saved layout, with the same allowlists as local preset storage. */
export function encodeFramePreset(preset: FramePreset): string {
  return JSON.stringify({ woc: 'woc-frame-preset', v: 1, preset });
}
export function decodeFramePreset(text: string): FramePreset | null {
  if (text.length > FRAME_PRESETS_MAX_LENGTH) return null;
  try {
    const data = JSON.parse(text);
    if (data?.woc !== 'woc-frame-preset' || data.v !== 1) return null;
    const preset = parseFramePresets(JSON.stringify({ v: 1, slots: [data.preset] }))[0];
    return preset?.name.trim() ? { ...preset, name: preset.name.trim() } : null;
  } catch {
    return null;
  }
}
