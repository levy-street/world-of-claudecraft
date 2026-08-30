import { describe, expect, it } from 'vitest';
import {
  findLiveSessionForCharacter,
  type LiveCharacterSessionLike,
  resolveLiveCharacterFrom,
} from '../../server/live_character_resolver';

function session(overrides: Partial<LiveCharacterSessionLike> = {}): LiveCharacterSessionLike {
  return {
    accountId: 7,
    characterId: 41,
    pid: 100,
    left: false,
    escrowQuarantined: false,
    ...overrides,
  };
}

describe('resolveLiveCharacterFrom', () => {
  it('resolves the one live session for the account', () => {
    const sessions = [
      session({ accountId: 8, characterId: 90, pid: 900 }),
      session(),
      session({ accountId: 9, characterId: 91, pid: 901 }),
    ];
    expect(resolveLiveCharacterFrom(sessions, 7)).toEqual({ characterId: 41, pid: 100 });
  });

  it('refuses two live sessions as ambiguous', () => {
    const sessions = [session(), session({ characterId: 42, pid: 101 })];
    expect(resolveLiveCharacterFrom(sessions, 7)).toBeNull();
  });

  it('resolves the live session past a quarantined one, in either order', () => {
    const live = session();
    const quarantined = session({ characterId: 42, pid: 101, escrowQuarantined: true });
    expect(resolveLiveCharacterFrom([live, quarantined], 7)).toEqual({
      characterId: 41,
      pid: 100,
    });
    expect(resolveLiveCharacterFrom([quarantined, live], 7)).toEqual({
      characterId: 41,
      pid: 100,
    });
  });

  it('skips a left session', () => {
    const sessions = [session({ left: true }), session({ characterId: 42, pid: 101 })];
    expect(resolveLiveCharacterFrom(sessions, 7)).toEqual({ characterId: 42, pid: 101 });
  });

  it('answers null for an empty table and for only-absent sessions', () => {
    expect(resolveLiveCharacterFrom([], 7)).toBeNull();
    expect(
      resolveLiveCharacterFrom(
        [session({ left: true }), session({ escrowQuarantined: true, pid: 101 })],
        7,
      ),
    ).toBeNull();
  });

  it('answers null when no session belongs to the account', () => {
    expect(resolveLiveCharacterFrom([session({ accountId: 8 })], 7)).toBeNull();
  });
});

describe('findLiveSessionForCharacter', () => {
  it('returns the live session object itself', () => {
    const live = session();
    expect(findLiveSessionForCharacter([live], 41)).toBe(live);
  });

  it('picks the live session when a quarantined one shares the character id', () => {
    const live = session({ pid: 100 });
    const quarantined = session({ pid: 101, escrowQuarantined: true });
    // Either iteration order: a first-match walk without the absence rule
    // would answer the quarantined session (whose save always refuses).
    expect(findLiveSessionForCharacter([quarantined, live], 41)).toBe(live);
    expect(findLiveSessionForCharacter([live, quarantined], 41)).toBe(live);
  });

  it('skips left sessions and answers null when only absent sessions match', () => {
    const left = session({ left: true });
    const quarantined = session({ escrowQuarantined: true });
    expect(findLiveSessionForCharacter([left, quarantined], 41)).toBeNull();
  });

  it('answers null for an empty table or an unknown character', () => {
    expect(findLiveSessionForCharacter([], 41)).toBeNull();
    expect(findLiveSessionForCharacter([session()], 42)).toBeNull();
  });
});
