// The once-per-class offer rule. The whole point of the feature is that it is
// offered exactly once and never nags, so each arm gets its own negative case.

import { beforeEach, describe, expect, it } from 'vitest';
import {
  localTutorialAnswerStore,
  rememberTutorialAnswer,
  shouldOfferTutorial,
  TUTORIAL_ANSWERED_KEY,
  type TutorialAnswerStore,
} from '../src/game/tutorial_offer';
import type { PlayerClass } from '../src/sim/types';

function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    raw: map,
  };
}

describe('starter tutorial offer rule', () => {
  it('offers a class the account has never played', () => {
    expect(shouldOfferTutorial('mage', [{ class: 'warrior' }], [])).toBe(true);
    expect(shouldOfferTutorial('mage', [], [])).toBe(true);
  });

  it('does not offer a class the account already has a character of', () => {
    // The second mage is not a first mage, whatever the answer store says.
    expect(shouldOfferTutorial('mage', [{ class: 'mage' }], [])).toBe(false);
    expect(shouldOfferTutorial('mage', [{ class: 'warrior' }, { class: 'mage' }], [])).toBe(false);
  });

  it('does not re-ask a class the player already answered, even after declining', () => {
    // Declining is an answer. A player who said no to the mage isle must not be
    // asked again the next time they roll a mage.
    expect(shouldOfferTutorial('mage', [], ['mage'])).toBe(false);
    // ...but an unanswered class on the same account still gets its offer.
    expect(shouldOfferTutorial('rogue', [], ['mage'])).toBe(true);
  });

  it('remembers an answer once and does not duplicate it', () => {
    const storage = memoryStorage();
    const store = localTutorialAnswerStore(storage);
    rememberTutorialAnswer(store, 'druid');
    rememberTutorialAnswer(store, 'druid');
    rememberTutorialAnswer(store, 'priest');
    expect(store.read()).toEqual(['druid', 'priest']);
    expect(JSON.parse(storage.raw.get(TUTORIAL_ANSWERED_KEY)!)).toEqual(['druid', 'priest']);
  });

  it('reads a corrupt or absent store as "nothing answered yet"', () => {
    // Worst case is one extra offer, never a crash on the character-create path.
    expect(localTutorialAnswerStore(memoryStorage()).read()).toEqual([]);
    expect(
      localTutorialAnswerStore(memoryStorage({ [TUTORIAL_ANSWERED_KEY]: 'not json' })).read(),
    ).toEqual([]);
    expect(
      localTutorialAnswerStore(memoryStorage({ [TUTORIAL_ANSWERED_KEY]: '{"mage":true}' })).read(),
    ).toEqual([]);
  });

  it('survives a storage that throws (private mode) without breaking the offer', () => {
    const hostile: Pick<Storage, 'getItem' | 'setItem'> = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    const store = localTutorialAnswerStore(hostile);
    expect(store.read()).toEqual([]);
    expect(() => rememberTutorialAnswer(store, 'mage')).not.toThrow();
  });

  it('the roster snapshot is the one taken BEFORE the character was created', () => {
    // The regression this guards: reading the roster after the create call always
    // finds the new character, so the offer would never fire for anyone.
    const rosterAfterCreate = [{ class: 'mage' as PlayerClass }];
    expect(shouldOfferTutorial('mage', rosterAfterCreate, [])).toBe(false);
    const rosterBeforeCreate: { class: PlayerClass }[] = [];
    expect(shouldOfferTutorial('mage', rosterBeforeCreate, [])).toBe(true);
  });
});
