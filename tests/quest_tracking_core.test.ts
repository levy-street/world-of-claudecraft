// The local quest tracking set: the presentation-only exclusion list behind the
// atlas rail's Untrack control, the map's objective badges, and the HUD tracker.
// Host-agnostic, so the whole decision (default-tracked, per-character keying,
// persistence, the revision counter every repaint signature folds in) is exercised
// here over a fake storage with no browser in sight.

import { describe, expect, it } from 'vitest';
import {
  parseUntrackedQuestIds,
  QUEST_UNTRACK_KEY_PREFIX,
  QuestTrackingState,
  questUntrackStorageKey,
  serializeUntrackedQuestIds,
} from '../src/ui/quest_tracking_core';

/** A minimal in-memory Storage stand-in; `rows` is the assertion surface. */
function fakeStorage(seed: Record<string, string> = {}) {
  const rows = new Map<string, string>(Object.entries(seed));
  return {
    rows,
    getItem: (key: string) => rows.get(key) ?? null,
    setItem: (key: string, value: string) => {
      rows.set(key, value);
    },
  };
}

describe('quest_tracking_core: the stored row', () => {
  it('keys the row per character, so two characters never share a choice', () => {
    const a = questUntrackStorageKey('warrior', 'Aldric');
    const b = questUntrackStorageKey('mage', 'Aldric');
    const c = questUntrackStorageKey('warrior', 'Brienne');
    expect(a.startsWith(QUEST_UNTRACK_KEY_PREFIX)).toBe(true);
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('reads a missing, corrupt, or wrongly shaped row as nothing untracked', () => {
    expect([...parseUntrackedQuestIds(null)]).toEqual([]);
    expect([...parseUntrackedQuestIds('not json')]).toEqual([]);
    expect([...parseUntrackedQuestIds('{"a":1}')]).toEqual([]);
    expect([...parseUntrackedQuestIds('[1, true, null, ""]')]).toEqual([]);
  });

  it('round-trips ids and serializes them sorted (an unchanged set is byte-stable)', () => {
    const raw = serializeUntrackedQuestIds(['q_b', 'q_a']);
    expect(raw).toBe('["q_a","q_b"]');
    expect([...parseUntrackedQuestIds(raw)]).toEqual(['q_a', 'q_b']);
  });
});

describe('quest_tracking_core: the live set', () => {
  it('tracks every quest by default, including one it has never seen', () => {
    const state = new QuestTrackingState(fakeStorage());
    state.useCharacter('warrior', 'Aldric');
    expect(state.isTracked('q_intro')).toBe(true);
    expect(state.untrackedIds().size).toBe(0);
  });

  it('untracks a quest, persists it, and tracks it again on request', () => {
    const storage = fakeStorage();
    const state = new QuestTrackingState(storage);
    state.useCharacter('warrior', 'Aldric');
    const key = questUntrackStorageKey('warrior', 'Aldric');

    state.setTracked('q_intro', false);
    expect(state.isTracked('q_intro')).toBe(false);
    expect([...state.untrackedIds()]).toEqual(['q_intro']);
    expect(storage.rows.get(key)).toBe('["q_intro"]');

    state.setTracked('q_intro', true);
    expect(state.isTracked('q_intro')).toBe(true);
    expect(storage.rows.get(key)).toBe('[]');
  });

  it('loads the character row on first use and re-keys on a character switch', () => {
    const storage = fakeStorage({
      [questUntrackStorageKey('warrior', 'Aldric')]: '["q_intro"]',
      [questUntrackStorageKey('mage', 'Brienne')]: '["q_ore"]',
    });
    const state = new QuestTrackingState(storage);
    state.useCharacter('warrior', 'Aldric');
    expect([...state.untrackedIds()]).toEqual(['q_intro']);
    state.useCharacter('mage', 'Brienne');
    expect([...state.untrackedIds()]).toEqual(['q_ore']);
    state.useCharacter('warrior', 'Aldric');
    expect([...state.untrackedIds()]).toEqual(['q_intro']);
  });

  it('re-reads nothing while the character is unchanged (the per-frame call is free)', () => {
    const key = questUntrackStorageKey('warrior', 'Aldric');
    const storage = fakeStorage({ [key]: '["q_intro"]' });
    let reads = 0;
    const state = new QuestTrackingState({
      getItem: (k: string) => {
        reads++;
        return storage.getItem(k);
      },
      setItem: storage.setItem,
    });
    state.useCharacter('warrior', 'Aldric');
    state.useCharacter('warrior', 'Aldric');
    state.useCharacter('warrior', 'Aldric');
    expect(reads).toBe(1);
  });

  it('bumps the revision on every real change and on none of the no-op ones', () => {
    // The revision is the ONLY thing a rail's repaint signature can see move: the
    // set is not part of any world snapshot, so a frozen revision means a stale rail.
    const state = new QuestTrackingState(fakeStorage());
    state.useCharacter('warrior', 'Aldric');
    const start = state.revision();
    state.setTracked('q_intro', true); // already tracked
    expect(state.revision()).toBe(start);
    state.setTracked('q_intro', false);
    expect(state.revision()).toBeGreaterThan(start);
    const afterUntrack = state.revision();
    state.setTracked('q_intro', false); // already untracked
    expect(state.revision()).toBe(afterUntrack);
    state.setTracked('q_intro', true);
    expect(state.revision()).toBeGreaterThan(afterUntrack);
  });

  it('keeps working in-session when storage is unavailable or throws', () => {
    const state = new QuestTrackingState(null);
    state.useCharacter('warrior', 'Aldric');
    state.setTracked('q_intro', false);
    expect(state.isTracked('q_intro')).toBe(false);

    const hostile = new QuestTrackingState({
      getItem: () => {
        throw new Error('storage disabled');
      },
      setItem: () => {
        throw new Error('storage disabled');
      },
    });
    hostile.useCharacter('warrior', 'Aldric');
    expect(hostile.untrackedIds().size).toBe(0);
    hostile.setTracked('q_intro', false);
    expect(hostile.isTracked('q_intro')).toBe(false);
  });
});
