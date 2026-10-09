import { accountSettingsValue } from './account_settings_profile';

/** Shared account preference wire contract. Gameplay and character progress never travel here. */
export type DeviceType = 'desktop' | 'phone' | 'tablet';
export type AccountSettingsEntries = Record<string, string>;
export const ACCOUNT_SETTINGS_MAX_BYTES = 49_152;
export const ACCOUNT_SETTINGS_MAX_KEYS = 256;
const KEYS = new Set([
  'locale',
  'woc_settings',
  'woc_theme',
  'woc_keybinds',
  'woc_gamepad',
  'woc_player_frame_pos',
  'woc_target_frame_pos',
  'woc_party_frame_pos',
  'woc_player_frame_pos_hidden',
  'woc_target_frame_pos_hidden',
  'woc_party_frame_pos_hidden',
  'woc_chat_geometry',
  'woc_meters_frame_heal',
  'woc_meters_frame_threat',
  'woc_meters_detached',
  'woc_warlock_doom_frame_pos',
  'woc_warlock_doom_frame_pos_hidden',
  'woc_mobile_chat_bottom',
  'woc_layout_reset_epoch',
  'chatTimestamps',
  'chatClock',
  'clock24h',
  'minimapZoom',
  'woc_haptics_on',
  'ev_music_on',
  'woc_keyboard_layout',
  'woc_keyboard_legends',
  'woc_party_collapsed',
  'woc_homepage_music_muted',
  'woc_bag_filter',
  'woc_bank_filter',
  'woc_crafting_tab',
  'woc_guild_hide_offline',
  'paladinDevotionAnchor',
  'procOverlayAnchor',
  'warlockDoomAnchor',
]);
const PREFIXES = ['woc_hud_frame_', 'woc_target_auras_', 'woc_chat_'];
export function isDeviceType(value: unknown): value is DeviceType {
  return value === 'desktop' || value === 'phone' || value === 'tablet';
}
export function isAccountSettingsKey(key: string): boolean {
  return (
    key.length <= 100 &&
    (KEYS.has(key) ||
      PREFIXES.some(
        (prefix) => key.startsWith(prefix) && /^[a-z0-9_]+$/.test(key.slice(prefix.length)),
      ))
  );
}
/** Strict ingress validation; limits cover JSON serialization including escaped strings. */
export function validateAccountSettingsEntries(input: unknown): AccountSettingsEntries | null {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return null;
  const keys = Object.keys(input);
  if (keys.length > ACCOUNT_SETTINGS_MAX_KEYS) return null;
  const result: AccountSettingsEntries = Object.create(null);
  for (const key of keys) {
    const value = (input as Record<string, unknown>)[key];
    if (!isAccountSettingsKey(key) || typeof value !== 'string' || value.length > 32_768)
      return null;
    result[key] = accountSettingsValue(key, value);
  }
  return new TextEncoder().encode(JSON.stringify(result)).length <= ACCOUNT_SETTINGS_MAX_BYTES
    ? result
    : null;
}
/** Filter local snapshots and older durable rows through the same closed preference boundary. */
export function sanitizeAccountSettingsEntries(input: unknown): AccountSettingsEntries {
  const result: AccountSettingsEntries = Object.create(null);
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return result;
  for (const key of Object.keys(input).sort()) {
    const value = (input as Record<string, unknown>)[key];
    if (!isAccountSettingsKey(key) || typeof value !== 'string' || value.length > 32_768) continue;
    const normalized = accountSettingsValue(key, value);
    const next = { ...result, [key]: normalized };
    if (validateAccountSettingsEntries(next)) result[key] = normalized;
  }
  return result;
}
