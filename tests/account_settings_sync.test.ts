import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyAccountSettings,
  readPendingAccountSettings,
  snapshotAccountSettings,
  startAccountSettingsSync,
} from '../src/game/account_settings_sync';

class MemoryStorage implements Storage {
  constructor(private values = new Map<string, string>()) {}
  get length(): number {
    return this.values.size;
  }
  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }
  getItem(key: string): string | null {
    return this.values.get(String(key)) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(String(key), String(value));
  }
  removeItem(key: string): void {
    this.values.delete(String(key));
  }
  clear(): void {
    this.values.clear();
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('account settings preference storage boundary', () => {
  it('seeds selected character controls while never uploading secrets or ability layouts', () => {
    const storage = new MemoryStorage();
    storage.setItem('woc_keybinds:char:7', '{"jump":["KeyJ"]}');
    storage.setItem('woc_keybinds:char:8', '{"jump":["KeyK"]}');
    storage.setItem('woc_token', 'secret');
    storage.setItem('woc_gamepad_xhb:char:7', 'class abilities');
    storage.setItem('ev_music_on', '0');
    storage.setItem('locale', 'ja_JP');
    expect(snapshotAccountSettings(storage, 7)).toEqual({
      woc_keybinds: '{"jump":["KeyJ"]}',
      ev_music_on: '0',
      locale: 'ja_JP',
    });
    applyAccountSettings(storage, { woc_keybinds: '{"jump":["Space"]}' });
    expect(snapshotAccountSettings(storage)).toEqual({ woc_keybinds: '{"jump":["Space"]}' });
    expect(storage.getItem('woc_keybinds:char:7')).toContain('KeyJ');
    expect(storage.getItem('woc_token')).toBe('secret');
    expect(storage.getItem('ev_music_on')).toBeNull();
  });

  it('rolls back a failed apply and filters an oversized local value', () => {
    const storage = new MemoryStorage();
    storage.setItem('ev_music_on', '0');
    const original = storage.setItem.bind(storage);
    storage.setItem = (key, value) => {
      if (key === 'woc_theme' && value === 'dark') throw new Error('quota');
      original(key, value);
    };
    expect(() => applyAccountSettings(storage, { ev_music_on: '1', woc_theme: 'dark' })).toThrow(
      'quota',
    );
    expect(snapshotAccountSettings(storage)).toEqual({ ev_music_on: '0' });
    original('woc_settings', 'x'.repeat(40_000));
    expect(snapshotAccountSettings(storage)).toEqual({ ev_music_on: '0' });
  });
});

describe('account settings save queue', () => {
  it('clears an acknowledged legacy journal after stripping its machine fields', async () => {
    const storage = new MemoryStorage();
    const journalKey = 'woc_account_settings_pending:17:desktop';
    storage.setItem(
      journalKey,
      JSON.stringify({ woc_settings: '{"graphicsPreset":4,"cameraSpeed":1}' }),
    );
    const pending = readPendingAccountSettings(storage, journalKey);
    if (!pending) throw new Error('missing legacy pending profile');
    const save = vi.fn().mockResolvedValue(undefined);
    const sync = startAccountSettingsSync({ storage, save, journalKey, initialPending: pending });
    try {
      await sync.flush();
      expect(save).toHaveBeenCalledWith({ woc_settings: '{"cameraSpeed":1}' }, false);
      expect(storage.getItem(journalKey)).toBeNull();
    } finally {
      sync.stop();
    }
  });
  it('keeps same-origin tab profiles isolated while each saves with its own credential', async () => {
    const values = new Map<string, string>();
    const tabA = new MemoryStorage(values);
    const tabB = new MemoryStorage(values);
    const events = new EventTarget();
    tabA.setItem('woc_theme', 'account-a');
    tabA.setItem('ev_music_on', '0');
    const saveA = vi.fn().mockResolvedValue(undefined);
    const saveB = vi.fn().mockResolvedValue(undefined);
    const syncA = startAccountSettingsSync({
      storage: tabA,
      save: saveA,
      eventTarget: events as unknown as Window,
    });
    // A second tab loads its own account's values into shared browser storage.
    tabB.setItem('woc_theme', 'account-b');
    tabB.setItem('ev_music_on', '1');
    const syncB = startAccountSettingsSync({ storage: tabB, save: saveB });
    try {
      events.dispatchEvent(
        Object.assign(new Event('storage'), { storageArea: tabA, key: 'woc_theme' }),
      );
      await syncA.flush();
      expect(saveA).not.toHaveBeenCalled();
      // The requested value already exists in shared storage, but differs from A's profile.
      tabA.setItem('ev_music_on', '1');
      await syncA.flush();
      expect(saveA).toHaveBeenCalledWith({ woc_theme: 'account-a', ev_music_on: '1' }, false);
      tabB.setItem('woc_theme', 'account-b-edited');
      await syncB.flush();
      expect(saveB).toHaveBeenCalledWith(
        { woc_theme: 'account-b-edited', ev_music_on: '1' },
        false,
      );
    } finally {
      syncB.stop();
      syncA.stop();
    }
  });

  it('shares one slow drain across repeated flushes and coalesces all intervening edits', async () => {
    vi.useFakeTimers();
    const storage = new MemoryStorage();
    let resolve!: () => void;
    const save = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((done) => {
            resolve = done;
          }),
      )
      .mockResolvedValue(undefined);
    const sync = startAccountSettingsSync({ storage, save });
    try {
      storage.setItem('ev_music_on', '0');
      const flight = sync.flush();
      await Promise.resolve();
      for (let index = 1; index <= 100; index++) {
        storage.setItem('ev_music_on', String(index));
        await vi.advanceTimersByTimeAsync(750);
        expect(sync.flush()).toBe(flight);
        expect(sync.flush(true)).toBe(flight);
      }
      expect(save).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
      resolve();
      await flight;
      expect(save).toHaveBeenCalledTimes(2);
      expect(save.mock.calls[1][0]).toEqual({ ev_music_on: '100' });
    } finally {
      sync.stop();
    }
  });

  it('journals the latest in-flight edits for exact account and device recovery after reload', async () => {
    const storage = new MemoryStorage();
    const key = 'woc_account_settings_pending:17:desktop';
    let resolve!: () => void;
    const firstSave = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const first = startAccountSettingsSync({ storage, save: firstSave, journalKey: key });
    storage.setItem('ev_music_on', '0');
    const active = first.flush();
    await Promise.resolve();
    storage.setItem('ev_music_on', '1');
    expect(readPendingAccountSettings(storage, key)).toEqual({ ev_music_on: '1' });
    expect(
      readPendingAccountSettings(storage, 'woc_account_settings_pending:18:desktop'),
    ).toBeNull();
    expect(readPendingAccountSettings(storage, 'woc_account_settings_pending:17:phone')).toBeNull();
    first.stop();
    resolve();
    await active;
    const recovered = readPendingAccountSettings(storage, key);
    if (!recovered) throw new Error('missing pending account settings');
    applyAccountSettings(storage, { ev_music_on: '0' });
    applyAccountSettings(storage, recovered);
    const nextSave = vi.fn().mockResolvedValue(undefined);
    const next = startAccountSettingsSync({
      storage,
      save: nextSave,
      journalKey: key,
      initialPending: recovered,
    });
    try {
      await next.flush();
      expect(nextSave).toHaveBeenCalledWith({ ev_music_on: '1' }, false);
      expect(readPendingAccountSettings(storage, key)).toBeNull();
    } finally {
      next.stop();
    }
  });

  it('coalesces local writes, includes deletions, and never watches session storage', async () => {
    vi.useFakeTimers();
    const storage = new MemoryStorage();
    const session = new MemoryStorage();
    const save = vi.fn().mockResolvedValue(undefined);
    const sync = startAccountSettingsSync({ storage, save });
    try {
      storage.setItem('ev_music_on', '0');
      storage.setItem('ev_music_on', '1');
      session.setItem('ev_music_on', '0');
      storage.setItem('woc_token', 'secret');
      await vi.advanceTimersByTimeAsync(750);
      expect(save).toHaveBeenCalledTimes(1);
      expect(save.mock.calls[0][0]).toEqual({ ev_music_on: '1' });
      storage.removeItem('ev_music_on');
      await sync.flush();
      expect(save.mock.calls[1][0]).toEqual({});
    } finally {
      sync.stop();
    }
  });

  it('serializes an active save and sends only the newest pending snapshot', async () => {
    const storage = new MemoryStorage();
    let resolve!: () => void;
    const save = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((done) => {
            resolve = done;
          }),
      )
      .mockResolvedValue(undefined);
    const sync = startAccountSettingsSync({ storage, save });
    try {
      storage.setItem('ev_music_on', '0');
      const flush = sync.flush();
      await Promise.resolve();
      storage.setItem('ev_music_on', '1');
      storage.setItem('ev_music_on', '2');
      expect(save).toHaveBeenCalledTimes(1);
      resolve();
      await flush;
      expect(save).toHaveBeenCalledTimes(2);
      expect(save.mock.calls[1][0]).toEqual({ ev_music_on: '2' });
    } finally {
      sync.stop();
    }
  });

  it('retains rejected changes with bounded retries and suppresses disposed account callbacks', async () => {
    vi.useFakeTimers();
    const storage = new MemoryStorage();
    const error = new Error('offline');
    const save = vi.fn().mockRejectedValue(error);
    const onError = vi.fn();
    const sync = startAccountSettingsSync({ storage, save, onError });
    storage.setItem('ev_music_on', '0');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(save).toHaveBeenCalledTimes(4);
    expect(onError).toHaveBeenCalledTimes(1);
    save.mockResolvedValue(undefined);
    await sync.flush();
    expect(save.mock.calls[4][0]).toEqual({ ev_music_on: '0' });
    sync.stop();
    storage.setItem('ev_music_on', '1');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(save).toHaveBeenCalledTimes(5);
    let reject!: (reason: unknown) => void;
    const next = startAccountSettingsSync({
      storage,
      save: () =>
        new Promise((_done, fail) => {
          reject = fail;
        }),
      onError,
    });
    storage.setItem('ev_music_on', '2');
    const pending = next.flush();
    const expected = expect(pending).rejects.toThrow('offline');
    await Promise.resolve();
    next.stop();
    reject(error);
    await expected;
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('captures login edits while paused without saving a premature profile', async () => {
    vi.useFakeTimers();
    const storage = new MemoryStorage();
    storage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 1, cameraSpeed: 0.7 }));
    const save = vi.fn();
    const onChange = vi.fn();
    const sync = startAccountSettingsSync({
      storage,
      save,
      onChange,
      paused: true,
      journalKey: 'pending',
    });
    try {
      storage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 4, cameraSpeed: 0.7 }));
      expect(onChange).not.toHaveBeenCalled();
      storage.setItem('locale', 'ja_JP');
      storage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 4, cameraSpeed: 1 }));
      await vi.advanceTimersByTimeAsync(20_000);
      await sync.flush();
      expect(onChange.mock.calls).toEqual([
        ['locale', 'ja_JP', null],
        ['woc_settings', '{"cameraSpeed":1}', '{"cameraSpeed":0.7}'],
      ]);
      expect(save).not.toHaveBeenCalled();
      expect(storage.getItem('pending')).toBeNull();
    } finally {
      sync.stop();
    }
  });

  it('reports one failed change once across retries, then reports the next change', async () => {
    vi.useFakeTimers();
    const storage = new MemoryStorage();
    const onError = vi.fn();
    const save = vi.fn().mockRejectedValue(new Error('offline'));
    const sync = startAccountSettingsSync({ storage, save, onError });
    try {
      storage.setItem('ev_music_on', '0');
      await vi.advanceTimersByTimeAsync(20_000);
      expect(onError).toHaveBeenCalledTimes(1);
      storage.setItem('ev_music_on', '1');
      await vi.advanceTimersByTimeAsync(20_000);
      expect(save).toHaveBeenCalledTimes(8);
      expect(onError).toHaveBeenCalledTimes(2);
    } finally {
      sync.stop();
    }
  });
});
