import { accountSettingsValue } from '../account_settings_profile';
import { BOOL_SETTINGS, type BoolSettingKey, defaultBoolSetting, SETTING_RANGES } from './settings';

/** Settings.save materializes defaults; those fields are not explicit edits. */
export function accountGameSettingsBaseline(value: string | null): Record<string, unknown> {
  let stored: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(value ?? '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      stored = parsed as Record<string, unknown>;
  } catch {
    /* Corrupt settings load their ordinary defaults. */
  }
  const result: Record<string, unknown> = {};
  for (const [key, range] of Object.entries(SETTING_RANGES)) result[key] = stored[key] ?? range.def;
  const interfaceMode = typeof result.interfaceMode === 'number' ? result.interfaceMode : 0;
  for (const key of Object.keys(BOOL_SETTINGS) as BoolSettingKey[]) {
    result[key] = stored[key] ?? defaultBoolSetting(key, { interfaceMode });
  }
  return JSON.parse(
    accountSettingsValue('woc_settings', JSON.stringify({ ...result, ...stored })),
  ) as Record<string, unknown>;
}

export function accountGameSettingsEqual(previous: string | null, next: string | null): boolean {
  const before = accountGameSettingsBaseline(previous);
  const after = accountGameSettingsBaseline(next);
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].every(
    (key) => before[key] === after[key],
  );
}
