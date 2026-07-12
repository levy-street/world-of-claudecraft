import { describe, expect, it } from 'vitest';
import {
  type ConsumableBarLayout,
  consumableBarPreferenceKey,
  createConsumableBarPreferences,
  type StorageLike,
} from '../src/ui/consumable_bar_preferences_core';

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();
  reads = 0;
  writes = 0;
  getItem(key: string): string | null {
    this.reads++;
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.writes++;
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const kinds: Record<string, string> = {
  potion: 'potion',
  elixir: 'elixir',
  food: 'food',
  drink: 'drink',
  sword: 'weapon',
};
const lookup = (id: string) => (kinds[id] ? { kind: kinds[id] } : undefined);
const automatic: ConsumableBarLayout = ['potion', 'elixir', 'food', 'drink', null, null];

describe('ConsumableBarPreferences', () => {
  it('isolates online and offline character scopes', () => {
    expect(consumableBarPreferenceKey('char:7')).not.toBe(
      consumableBarPreferenceKey('offline:mage:Ada'),
    );
  });

  it('starts in automatic mode and reads storage only once', () => {
    const storage = new MemoryStorage();
    const prefs = createConsumableBarPreferences({ storage, scope: 'char:7', lookup });
    expect(prefs.layout()).toBeNull();
    expect(prefs.layout()).toBeNull();
    expect(storage.reads).toBe(1);
  });

  it('seeds the first assignment from the caller automatic layout', () => {
    const prefs = createConsumableBarPreferences({
      storage: new MemoryStorage(),
      scope: 'char:7',
      lookup,
    });
    expect(prefs.assign('food', 0, automatic).layout).toEqual([
      'food',
      'elixir',
      null,
      'drink',
      null,
      null,
    ]);
  });

  it('moves an existing assignment and toggles the current slot empty', () => {
    const prefs = createConsumableBarPreferences({
      storage: new MemoryStorage(),
      scope: 'char:7',
      lookup,
    });
    expect(prefs.assign('food', 5, automatic).layout).toEqual([
      'potion',
      'elixir',
      null,
      'drink',
      null,
      'food',
    ]);
    expect(prefs.assign('food', 5, automatic).layout).toEqual([
      'potion',
      'elixir',
      null,
      'drink',
      null,
      null,
    ]);
  });

  it('rejects invalid slots and non-consumables without changing layout', () => {
    const prefs = createConsumableBarPreferences({
      storage: new MemoryStorage(),
      scope: 'char:7',
      lookup,
    });
    expect(prefs.assign('sword', 0, automatic).ok).toBe(false);
    expect(prefs.assign('food', 6, automatic).ok).toBe(false);
    expect(prefs.layout()).toBeNull();
  });

  it('ignores corrupt or invalid saved layouts', () => {
    const storage = new MemoryStorage();
    storage.values.set(consumableBarPreferenceKey('char:7'), '{broken');
    expect(
      createConsumableBarPreferences({ storage, scope: 'char:7', lookup }).layout(),
    ).toBeNull();
    storage.values.set(
      consumableBarPreferenceKey('char:8'),
      JSON.stringify({ version: 1, slots: ['sword', null, null, null, null, null] }),
    );
    expect(
      createConsumableBarPreferences({ storage, scope: 'char:8', lookup }).layout(),
    ).toBeNull();
  });

  it('persists custom layout and reset', () => {
    const storage = new MemoryStorage();
    const prefs = createConsumableBarPreferences({ storage, scope: 'char:7', lookup });
    prefs.assign('food', 0, automatic);
    expect(storage.values.get(consumableBarPreferenceKey('char:7'))).toContain('food');
    expect(prefs.reset()).toBe(true);
    expect(prefs.layout()).toBeNull();
    expect(storage.values.has(consumableBarPreferenceKey('char:7'))).toBe(false);
  });

  it('keeps the updated in-memory layout when storage throws', () => {
    const storage = new MemoryStorage();
    storage.setItem = () => {
      throw new Error('quota');
    };
    const prefs = createConsumableBarPreferences({ storage, scope: 'char:7', lookup });
    const result = prefs.assign('food', 0, automatic);
    expect(result.ok).toBe(true);
    expect(result.saved).toBe(false);
    expect(prefs.layout()?.[0]).toBe('food');
  });
});
