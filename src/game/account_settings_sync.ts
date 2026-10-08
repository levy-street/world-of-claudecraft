import {
  type AccountSettingsEntries,
  isAccountSettingsKey,
  validateAccountSettingsEntries,
} from '../account_settings_contract';

export function snapshotAccountSettings(
  storage: Storage,
  characterId?: number,
): AccountSettingsEntries {
  const entries: AccountSettingsEntries = Object.create(null);
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key && isAccountSettingsKey(key)) {
      const value = storage.getItem(key);
      if (value !== null) entries[key] = value;
    }
  }
  if (characterId !== undefined) {
    const keybinds = storage.getItem(`woc_keybinds:char:${characterId}`);
    if (keybinds !== null) entries.woc_keybinds = keybinds;
  }
  const validated = validateAccountSettingsEntries(entries);
  if (!validated) throw new Error('local account settings exceed storage limits');
  return validated;
}

/** Replace only preferences. A failed write restores the prior snapshot before entry fails. */
export function applyAccountSettings(storage: Storage, input: AccountSettingsEntries): void {
  const entries = validateAccountSettingsEntries(input);
  if (!entries) throw new Error('invalid account settings entries');
  const previous = snapshotAccountSettings(storage);
  const keys = new Set([...Object.keys(previous), ...Object.keys(entries)]);
  try {
    for (const key of keys) {
      if (entries[key] === undefined) storage.removeItem(key);
      else storage.setItem(key, entries[key]);
    }
  } catch (error) {
    for (const key of keys) {
      try {
        if (previous[key] === undefined) storage.removeItem(key);
        else storage.setItem(key, previous[key]);
      } catch {
        /* Best effort when the browser has made storage unavailable. */
      }
    }
    throw error;
  }
}

export interface AccountSettingsSyncOptions {
  storage: Storage;
  save: (entries: AccountSettingsEntries, keepalive?: boolean) => Promise<unknown>;
  onError?: (error: unknown) => void;
  eventTarget?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  storagePrototype?: Pick<Storage, 'setItem' | 'removeItem' | 'clear'>;
  debounceMs?: number;
  /** Non-secret stable account ID and physical device family, never a credential. */
  journalKey?: string;
  initialPending?: AccountSettingsEntries;
}

export function readPendingAccountSettings(
  storage: Storage,
  journalKey: string,
): AccountSettingsEntries | null {
  const raw = storage.getItem(journalKey);
  if (raw === null) return null;
  try {
    return validateAccountSettingsEntries(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** One active save and one latest snapshot. Retry traffic is bounded per local change. */
export function startAccountSettingsSync(options: AccountSettingsSyncOptions): {
  flush: (keepalive?: boolean) => Promise<void>;
  stop: () => void;
} {
  const { storage, save, onError } = options;
  const prototype = options.storagePrototype ?? Object.getPrototypeOf(storage);
  const originalSet = prototype.setItem;
  const originalRemove = prototype.removeItem;
  const originalClear = prototype.clear;
  let stopped = false;
  let pending: AccountSettingsEntries | null = options.initialPending
    ? validateAccountSettingsEntries(options.initialPending)
    : null;
  if (options.initialPending && !pending) throw new Error('invalid pending account settings');
  // localStorage is shared by tabs, credentials are not. Keep this session's profile
  // independent of other tabs and update it only through this tab's own mutations.
  let profile = pending ?? snapshotAccountSettings(storage);
  let active: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let retries = 0;
  const clearTimer = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const report = (error: unknown) => {
    if (!stopped) {
      try {
        onError?.(error);
      } catch {
        /* An observer must not alter Storage write semantics. */
      }
    }
  };
  const schedule = (delay: number) => {
    clearTimer();
    timer = setTimeout(() => {
      void flush();
    }, delay);
  };
  const changed = (key: string | null, value: string | null = null) => {
    if (stopped) return;
    try {
      const next: AccountSettingsEntries = key === null ? Object.create(null) : { ...profile };
      if (key !== null) {
        if (value === null) delete next[key];
        else next[key] = value;
      }
      const validated = validateAccountSettingsEntries(next);
      if (!validated) throw new Error('local account settings exceed storage limits');
      profile = validated;
      pending = validated;
      if (options.journalKey) storage.setItem(options.journalKey, JSON.stringify(pending));
      retries = 0;
      if (!active) schedule(options.debounceMs ?? 750);
    } catch (error) {
      report(error);
    }
  };
  const wrappedSet = function (this: Storage, key: string, value: string): void {
    const watched = this === storage && isAccountSettingsKey(String(key));
    const before = watched ? this.getItem(key) : null;
    originalSet.call(this, key, value);
    if (watched) {
      const after = this.getItem(key);
      if (before !== after || (profile[key] ?? null) !== after) changed(key, after);
    }
  };
  const wrappedRemove = function (this: Storage, key: string): void {
    const watched = this === storage && isAccountSettingsKey(String(key));
    const before = watched ? this.getItem(key) : null;
    originalRemove.call(this, key);
    if (watched && (before !== null || profile[key] !== undefined)) changed(key);
  };
  const wrappedClear = function (this: Storage): void {
    originalClear.call(this);
    if (this === storage) changed(null);
  };
  prototype.setItem = wrappedSet;
  prototype.removeItem = wrappedRemove;
  prototype.clear = wrappedClear;

  function flush(keepalive = false): Promise<void> {
    clearTimer();
    if (stopped) return Promise.resolve();
    // Every caller shares the entire drain, with no extra per-change waiters.
    // Unload cannot safely race an older request; the durable journal covers reload.
    if (active) return active;
    if (!pending) return Promise.resolve();
    active = Promise.resolve()
      .then(async () => {
        while (!stopped && pending) {
          const entries = pending;
          pending = null;
          try {
            await save(entries, keepalive);
            retries = 0;
            if (
              !stopped &&
              options.journalKey &&
              !pending &&
              storage.getItem(options.journalKey) === JSON.stringify(entries)
            )
              storage.removeItem(options.journalKey);
          } catch (error) {
            if (!stopped) {
              pending ??= entries;
              report(error);
              if (++retries <= 3) schedule(1_000 * retries);
            }
            throw error;
          }
        }
      })
      .finally(() => {
        active = null;
      });
    // One rejection observer per flight, including automatic timer/unload flushes.
    void active.catch(() => {});
    return active;
  }
  // Cross-tab storage events must never enqueue another account's preference map.
  // The tab that made those edits is responsible for saving them under its credential.
  const onPageHide = () => {
    void flush(true);
  };
  options.eventTarget?.addEventListener('pagehide', onPageHide);
  if (pending) schedule(options.debounceMs ?? 750);
  return {
    flush,
    stop() {
      stopped = true;
      pending = null;
      clearTimer();
      if (prototype.setItem === wrappedSet) prototype.setItem = originalSet;
      if (prototype.removeItem === wrappedRemove) prototype.removeItem = originalRemove;
      if (prototype.clear === wrappedClear) prototype.clear = originalClear;
      options.eventTarget?.removeEventListener('pagehide', onPageHide);
    },
  };
}
