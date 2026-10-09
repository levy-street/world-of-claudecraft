import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_SETTINGS_MAX_BYTES,
  sanitizeAccountSettingsEntries,
  validateAccountSettingsEntries,
} from '../src/account_settings_contract';
import { LOCAL_MACHINE_SETTINGS } from '../src/account_settings_profile';
import { applyAccountSettings, snapshotAccountSettings } from '../src/game/account_settings_sync';

class Store implements Storage {
  values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  key(i: number) {
    return [...this.values.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.values.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.values.set(k, v);
  }
  removeItem(k: string) {
    this.values.delete(k);
  }
  clear() {
    this.values.clear();
  }
}

describe('account settings machine boundary', () => {
  it.each([...LOCAL_MACHINE_SETTINGS])(
    'keeps %s local even when an older server row includes it',
    (field) => {
      const store = new Store();
      store.setItem('woc_settings', JSON.stringify({ [field]: 1, cameraSpeed: 0.7 }));
      applyAccountSettings(store, { woc_settings: JSON.stringify({ [field]: 4, cameraSpeed: 1 }) });
      expect(JSON.parse(store.getItem('woc_settings') ?? '{}')[field]).toBe(1);
      expect(JSON.parse(snapshotAccountSettings(store).woc_settings)[field]).toBeUndefined();
    },
  );
  it('retains this machines safe graphics choice and first-run detection while applying account preferences', () => {
    const store = new Store();
    store.setItem(
      'woc_settings',
      JSON.stringify({
        graphicsPreset: 1,
        graphicsDefaultApplied: false,
        renderScale: 0.5,
        cameraSpeed: 0.7,
      }),
    );
    const oldServer = {
      woc_settings: JSON.stringify({
        graphicsPreset: 4,
        graphicsDefaultApplied: true,
        renderScale: 1,
        cameraSpeed: 1,
      }),
    };
    applyAccountSettings(store, oldServer);
    expect(JSON.parse(store.getItem('woc_settings') ?? '{}')).toEqual({
      graphicsPreset: 1,
      graphicsDefaultApplied: false,
      renderScale: 0.5,
      cameraSpeed: 1,
    });
    expect(JSON.parse(snapshotAccountSettings(store).woc_settings)).toEqual({ cameraSpeed: 1 });
    expect(JSON.parse(validateAccountSettingsEntries(oldServer)?.woc_settings ?? '{}')).toEqual({
      cameraSpeed: 1,
    });
    applyAccountSettings(store, {});
    expect(JSON.parse(store.getItem('woc_settings') ?? '{}')).toEqual({
      graphicsPreset: 1,
      graphicsDefaultApplied: false,
      renderScale: 0.5,
    });
  });
  it('bounds corrupt or oversized local snapshots without preventing world entry', () => {
    const store = new Store();
    store.setItem('woc_settings', 'x'.repeat(40000));
    store.setItem('ev_music_on', '0');
    for (let i = 0; i < 300; i++) store.setItem(`woc_hud_frame_${i}`, '界'.repeat(1000));
    const snapshot = snapshotAccountSettings(store);
    expect(snapshot.ev_music_on).toBe('0');
    expect(snapshot.woc_settings).toBeUndefined();
    expect(Object.keys(snapshot).length).toBeLessThanOrEqual(256);
    expect(new TextEncoder().encode(JSON.stringify(snapshot)).length).toBeLessThanOrEqual(
      ACCOUNT_SETTINGS_MAX_BYTES,
    );
    expect(validateAccountSettingsEntries(snapshot)).not.toBeNull();
    expect(sanitizeAccountSettingsEntries(Object.fromEntries([...store.values].reverse()))).toEqual(
      snapshot,
    );
  });
});
