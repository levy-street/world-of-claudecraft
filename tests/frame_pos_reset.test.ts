import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  FRAME_POS_RESET_KEYS,
  LAYOUT_RESET_EPOCH,
  LAYOUT_RESET_EPOCH_KEY,
  resetFramePositionsOnce,
} from '../src/ui/frame_pos_reset';

// Minimal Storage stand-in backed by a Map; the module only needs get/set/remove.
function fakeStorage(seed: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

describe('resetFramePositionsOnce', () => {
  it('pins the storage keys the v0.24.1 reset clears', () => {
    // Load-bearing wire tokens: these must match the MovableFrame keys in hud.ts.
    expect(FRAME_POS_RESET_KEYS).toEqual(['woc_player_frame_pos', 'woc_target_frame_pos']);
    expect(LAYOUT_RESET_EPOCH_KEY).toBe('woc_layout_reset_epoch');
    expect(LAYOUT_RESET_EPOCH).toBe(1);
  });

  it('clears both frame positions and stamps the epoch on a first run', () => {
    const storage = fakeStorage({
      woc_player_frame_pos: '{"left":610,"top":190}',
      woc_target_frame_pos: '{"left":40,"top":80}',
    });
    expect(resetFramePositionsOnce(storage)).toBe(true);
    expect(storage.getItem('woc_player_frame_pos')).toBeNull();
    expect(storage.getItem('woc_target_frame_pos')).toBeNull();
    expect(storage.getItem(LAYOUT_RESET_EPOCH_KEY)).toBe(String(LAYOUT_RESET_EPOCH));
  });

  it('runs the reset even when no positions are saved (still stamps the epoch)', () => {
    const storage = fakeStorage();
    expect(resetFramePositionsOnce(storage)).toBe(true);
    expect(storage.getItem(LAYOUT_RESET_EPOCH_KEY)).toBe(String(LAYOUT_RESET_EPOCH));
  });

  it('is a no-op on the second run: positions re-saved after the reset survive', () => {
    const storage = fakeStorage();
    resetFramePositionsOnce(storage);
    storage.setItem('woc_player_frame_pos', '{"left":100,"top":100}');
    expect(resetFramePositionsOnce(storage)).toBe(false);
    expect(storage.getItem('woc_player_frame_pos')).toBe('{"left":100,"top":100}');
  });

  it('re-runs when the stored epoch is older than the current one', () => {
    const storage = fakeStorage({
      [LAYOUT_RESET_EPOCH_KEY]: '0',
      woc_player_frame_pos: '{"left":610,"top":190}',
    });
    expect(resetFramePositionsOnce(storage)).toBe(true);
    expect(storage.getItem('woc_player_frame_pos')).toBeNull();
  });

  it('treats a corrupt epoch marker as unseen, resets once, and repairs the marker', () => {
    const storage = fakeStorage({
      [LAYOUT_RESET_EPOCH_KEY]: 'garbage',
      woc_player_frame_pos: '{"left":610,"top":190}',
    });
    expect(resetFramePositionsOnce(storage)).toBe(true);
    expect(storage.getItem('woc_player_frame_pos')).toBeNull();
    expect(storage.getItem(LAYOUT_RESET_EPOCH_KEY)).toBe(String(LAYOUT_RESET_EPOCH));
    expect(resetFramePositionsOnce(storage)).toBe(false);
  });

  it('does not re-run for a future epoch (a downgrade never re-clears)', () => {
    const storage = fakeStorage({
      [LAYOUT_RESET_EPOCH_KEY]: String(LAYOUT_RESET_EPOCH + 1),
      woc_player_frame_pos: '{"left":610,"top":190}',
    });
    expect(resetFramePositionsOnce(storage)).toBe(false);
    expect(storage.getItem('woc_player_frame_pos')).toBe('{"left":610,"top":190}');
  });

  it('runs before the movers construct in hud.ts (they apply a saved pos at construction)', () => {
    // Source-order guard: moving the reset below the MovableFrame constructors
    // (which read the keys and detach the player frame) silently reintroduces
    // the stale-position replay this module exists to clear.
    const hudSrc = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
    const movers = hudSrc.slice(hudSrc.indexOf('private initFrameMovers('));
    const resetAt = movers.indexOf('resetFramePositionsOnce(localStorage)');
    const firstMoverAt = movers.indexOf('new MovableFrame(');
    expect(resetAt).toBeGreaterThan(-1);
    expect(firstMoverAt).toBeGreaterThan(-1);
    expect(resetAt).toBeLessThan(firstMoverAt);
  });

  it('swallows storage failures and reports no reset', () => {
    const storage = {
      getItem: () => {
        throw new Error('storage unavailable');
      },
      setItem: () => {
        throw new Error('storage unavailable');
      },
      removeItem: () => {
        throw new Error('storage unavailable');
      },
    };
    expect(resetFramePositionsOnce(storage)).toBe(false);
  });
});
