// The per-character pinned-recipe store (src/ui/recipe_pins_store.ts): key
// shape, lazy re-key on a character switch, persistence on change only, the cap
// refusal, and the degraded paths (corrupt or throwing storage).

import { describe, expect, it } from 'vitest';
import { type RecipePinStorage, RecipePinStore } from '../src/ui/recipe_pins_store';
import { RECIPE_TRACK_CAP } from '../src/ui/recipe_tracker_view';

function memStorage(): RecipePinStorage & { map: Map<string, string>; writes: number } {
  const map = new Map<string, string>();
  return {
    map,
    writes: 0,
    getItem: (k) => map.get(k) ?? null,
    setItem(k, v) {
      this.writes++;
      map.set(k, v);
    },
  };
}

function store(storage: RecipePinStorage | null, identity = { cls: 'mage', name: 'Ada' }) {
  const s = new RecipePinStore({
    world: () => ({ cfg: { playerClass: identity.cls }, player: { name: identity.name } }),
    storage: () => storage,
    known: (id) => id !== 'gone',
  });
  return s;
}

describe('RecipePinStore', () => {
  it('persists under woc_recipe_pins_<class>_<name> in pin order', () => {
    const mem = memStorage();
    const s = store(mem);
    expect(s.toggle('b').changed).toBe(true);
    expect(s.toggle('a').changed).toBe(true);
    expect(mem.map.get('woc_recipe_pins_mage_Ada')).toBe('["b","a"]');
    expect([...s.pinned]).toEqual(['b', 'a']);
    expect(s.has('a')).toBe(true);
    expect(s.has('zzz')).toBe(false);
  });

  it('loads the saved set lazily, dropping unknown ids', () => {
    const mem = memStorage();
    mem.map.set('woc_recipe_pins_mage_Ada', '["gone","x","y"]');
    expect([...store(mem).pinned]).toEqual(['x', 'y']);
  });

  it('re-keys when the character changes, so two characters keep separate lists', () => {
    const mem = memStorage();
    const identity = { cls: 'mage', name: 'Ada' };
    const s = store(mem, identity);
    s.toggle('a');
    identity.name = 'Bea';
    expect(s.pinned.size).toBe(0);
    s.toggle('b');
    expect(mem.map.get('woc_recipe_pins_mage_Ada')).toBe('["a"]');
    expect(mem.map.get('woc_recipe_pins_mage_Bea')).toBe('["b"]');
  });

  it('refuses an add at the cap without a write, and unpins free a slot', () => {
    const mem = memStorage();
    const s = store(mem);
    for (let i = 0; i < RECIPE_TRACK_CAP; i++) s.toggle(`r${i}`);
    const before = mem.writes;
    const refused = s.toggle('extra');
    expect(refused.full).toBe(true);
    expect(refused.changed).toBe(false);
    expect(mem.writes).toBe(before);
    expect(s.toggle('r0').changed).toBe(true);
    expect(s.toggle('extra').changed).toBe(true);
    expect(s.has('extra')).toBe(true);
  });

  it('starts unpinned on corrupt storage and keeps in-session pins when storage throws', () => {
    const corrupt = memStorage();
    corrupt.map.set('woc_recipe_pins_mage_Ada', '{oops');
    expect(store(corrupt).pinned.size).toBe(0);

    const throwing: RecipePinStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    const s = store(throwing);
    expect(s.toggle('a').changed).toBe(true);
    expect(s.has('a')).toBe(true);

    const absent = store(null);
    expect(absent.toggle('a').changed).toBe(true);
    expect(absent.has('a')).toBe(true);
  });
});
