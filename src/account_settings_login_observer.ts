import {
  ACCOUNT_SETTINGS_MAX_BYTES,
  ACCOUNT_SETTINGS_MAX_KEYS,
  type AccountSettingsEntries,
  isAccountSettingsKey,
  sanitizeAccountSettingsEntries,
} from './account_settings_contract';
import { accountGameSettingsBaseline } from './game/account_settings_comparison';
import { startAccountSettingsSync } from './game/account_settings_sync';

function settingsObject(value: string | null): Record<string, unknown> {
  try {
    const parsed = value === null ? {} : JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** Homepage edits are deltas, never an uninitialized account profile. */
export function observeAccountSettingsLogin(
  storage: Storage,
  journalKey: string,
  onError?: (error: unknown) => void,
) {
  let cleared = false;
  let changes: Record<string, string | null> = Object.create(null);
  let settingsChanges: Record<string, { value: unknown } | null> = Object.create(null);
  let settingsBaseline = accountGameSettingsBaseline(storage.getItem('woc_settings'));
  try {
    const raw = storage.getItem(journalKey);
    if (raw && new TextEncoder().encode(raw).length <= ACCOUNT_SETTINGS_MAX_BYTES) {
      const saved = JSON.parse(raw);
      if (saved && typeof saved === 'object' && saved.changes && !Array.isArray(saved.changes)) {
        cleared = saved.cleared === true;
        for (const key of Object.keys(saved.changes).slice(0, ACCOUNT_SETTINGS_MAX_KEYS)) {
          const value = saved.changes[key];
          if (isAccountSettingsKey(key) && (value === null || typeof value === 'string'))
            changes[key] = value;
        }
        if (
          saved.settingsChanges &&
          typeof saved.settingsChanges === 'object' &&
          !Array.isArray(saved.settingsChanges)
        ) {
          for (const [field, patch] of Object.entries(saved.settingsChanges).slice(
            0,
            ACCOUNT_SETTINGS_MAX_KEYS,
          )) {
            if (
              patch === null ||
              (patch && typeof patch === 'object' && Object.hasOwn(patch, 'value'))
            )
              settingsChanges[field] = patch as { value: unknown } | null;
          }
        }
      }
    }
  } catch {
    // Invalid recovery data must not prevent login.
  }
  const observer = startAccountSettingsSync({
    storage,
    paused: true,
    onError,
    save: async () => {},
    onChange: (key, value) => {
      const next = key === null ? Object.create(null) : { ...changes };
      let nextSettings = key === null ? Object.create(null) : { ...settingsChanges };
      if (key === null || (key === 'woc_settings' && value === null))
        settingsBaseline = accountGameSettingsBaseline(null);
      if (key === 'woc_settings' && value !== null) {
        const current = accountGameSettingsBaseline(value);
        for (const field of new Set([...Object.keys(settingsBaseline), ...Object.keys(current)])) {
          // A Settings write materializes defaults for previously absent fields.
          // Compare effective values so unrelated cloud preferences still win.
          if (JSON.stringify(settingsBaseline[field]) !== JSON.stringify(current[field]))
            nextSettings[field] = Object.hasOwn(current, field) ? { value: current[field] } : null;
        }
        settingsBaseline = current;
      } else if (key !== null) {
        next[key] = value;
        if (key === 'woc_settings') nextSettings = Object.create(null);
      }
      const nextCleared = cleared || key === null;
      const serialized = JSON.stringify({
        cleared: nextCleared,
        changes: next,
        settingsChanges: nextSettings,
      });
      if (
        Object.keys(next).length + Object.keys(nextSettings).length > ACCOUNT_SETTINGS_MAX_KEYS ||
        new TextEncoder().encode(serialized).length > ACCOUNT_SETTINGS_MAX_BYTES
      )
        throw new Error('homepage account settings exceed storage limits');
      storage.setItem(journalKey, serialized);
      changes = next;
      settingsChanges = nextSettings;
      cleared = nextCleared;
    },
  });
  return {
    stop: observer.stop,
    hasChanges: () =>
      cleared || Object.keys(changes).length > 0 || Object.keys(settingsChanges).length > 0,
    applyTo(entries: AccountSettingsEntries): AccountSettingsEntries {
      const merged = cleared ? Object.create(null) : { ...entries };
      for (const [key, value] of Object.entries(changes)) {
        if (value === null) delete merged[key];
        else merged[key] = value;
      }
      if (Object.keys(settingsChanges).length > 0) {
        const settings = Object.assign(
          Object.create(null),
          settingsObject(merged.woc_settings ?? null),
        );
        for (const [field, patch] of Object.entries(settingsChanges)) {
          if (patch === null) delete settings[field];
          else settings[field] = patch.value;
        }
        merged.woc_settings = JSON.stringify(settings);
      }
      return sanitizeAccountSettingsEntries(merged);
    },
    acknowledge: () => storage.removeItem(journalKey),
  };
}
