// Offline character persistence: SimConfig.characterState hydrates the primary
// player from a serializeCharacter save (the server's own persistence shape),
// and src/game/offline_save.ts stores/loads that shape in localStorage.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearOfflineSave,
  loadOfflineSave,
  mountOfflineAutosave,
  offlineSaveKey,
  storeOfflineSave,
} from '../src/game/offline_save';
import { Sim } from '../src/sim/sim';
import { terrainHeight } from '../src/sim/world';

const makeSim = (state?: ReturnType<Sim['serializeCharacter']>) =>
  new Sim({
    seed: 42,
    playerClass: 'warrior',
    playerName: 'Continu',
    autoEquip: true,
    characterState: state ?? undefined,
  });

describe('SimConfig.characterState', () => {
  it('resumes level and position for the primary player', () => {
    const sim = makeSim();
    sim.setPlayerLevel(7);
    const p = sim.player;
    p.pos.x += 40;
    p.pos.z += 25;
    p.pos.y = terrainHeight(p.pos.x, p.pos.z, sim.cfg.seed);
    p.prevPos = { ...p.pos };
    const state = sim.serializeCharacter(sim.playerId);
    expect(state).not.toBeNull();

    const resumed = makeSim(state);
    expect(resumed.player.level).toBe(7);
    expect(Math.abs(resumed.player.pos.x - p.pos.x)).toBeLessThan(5);
    expect(Math.abs(resumed.player.pos.z - p.pos.z)).toBeLessThan(5);
  });

  it('an omitted characterState still creates a fresh level 1 character', () => {
    const sim = makeSim();
    expect(sim.player.level).toBe(1);
  });
});

describe('offline_save storage', () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
  });

  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it('round-trips a serialized character keyed per class and name', () => {
    const sim = makeSim();
    sim.setPlayerLevel(4);
    const state = sim.serializeCharacter(sim.playerId);
    if (!state) throw new Error('no state');
    storeOfflineSave('warrior', 'Continu', state);
    const loaded = loadOfflineSave('warrior', 'Continu');
    expect(loaded?.level).toBe(4);
    // The name key is case-insensitive, like the offline keybind namespace.
    expect(loadOfflineSave('warrior', 'CONTINU')?.level).toBe(4);
    // A different class or name is a different slot.
    expect(loadOfflineSave('mage', 'Continu')).toBeNull();
    expect(loadOfflineSave('warrior', 'Other')).toBeNull();
    clearOfflineSave('warrior', 'Continu');
    expect(loadOfflineSave('warrior', 'Continu')).toBeNull();
  });

  it('corrupt or shapeless JSON loads as null instead of throwing', () => {
    store.set(offlineSaveKey('warrior', 'Continu'), '{not json');
    expect(loadOfflineSave('warrior', 'Continu')).toBeNull();
    store.set(offlineSaveKey('warrior', 'Continu'), JSON.stringify({ hello: 1 }));
    expect(loadOfflineSave('warrior', 'Continu')).toBeNull();
  });

  it('autosave flushes on the interval and again on unmount', () => {
    vi.useFakeTimers();
    try {
      const sim = makeSim();
      sim.setPlayerLevel(3);
      const stop = mountOfflineAutosave(sim, 'warrior', 'Continu');
      expect(loadOfflineSave('warrior', 'Continu')).toBeNull();
      vi.advanceTimersByTime(30_000);
      expect(loadOfflineSave('warrior', 'Continu')?.level).toBe(3);
      sim.setPlayerLevel(5);
      stop();
      expect(loadOfflineSave('warrior', 'Continu')?.level).toBe(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it('no localStorage host degrades to no save, never a throw', () => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(loadOfflineSave('warrior', 'Continu')).toBeNull();
    const sim = makeSim();
    const state = sim.serializeCharacter(sim.playerId);
    if (!state) throw new Error('no state');
    expect(() => storeOfflineSave('warrior', 'Continu', state)).not.toThrow();
  });
});
