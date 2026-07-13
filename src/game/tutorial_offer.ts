// Should we offer the starter tutorial for the class the player just created?
//
// Pure decision core with an injected store, so a Vitest drives every arm without
// a DOM or a server. The rule, in one line: offer the tutorial the first time an
// account ever makes a character of a class, and never nag about that class again
// whatever the player answers.
//
// "Never played this class" is derived from the character ROSTER, which the server
// already returns from GET /api/characters with each character's class on it. That
// is deliberately the whole source of truth for "played": it needs no schema, no
// endpoint, and it is correct across devices, because the roster is server state.
// The store below only remembers the ANSWER (accepted or declined), so a player who
// says no is not asked again on the next character of that class.

import type { PlayerClass } from '../sim/types';

export const TUTORIAL_ANSWERED_KEY = 'woc.starterTutorial.answered.v1';

/** The classes this account has already been offered the tutorial for. */
export interface TutorialAnswerStore {
  read(): PlayerClass[];
  write(classes: PlayerClass[]): void;
}

/** localStorage-backed store. Defensive: any unreadable or malformed blob reads
 *  as "nothing answered yet", which at worst offers the tutorial one extra time. */
export function localTutorialAnswerStore(
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = safeLocalStorage(),
): TutorialAnswerStore {
  return {
    read(): PlayerClass[] {
      if (!storage) return [];
      try {
        const raw = storage.getItem(TUTORIAL_ANSWERED_KEY);
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((c): c is PlayerClass => typeof c === 'string');
      } catch {
        return [];
      }
    },
    write(classes: PlayerClass[]): void {
      if (!storage) return;
      try {
        storage.setItem(TUTORIAL_ANSWERED_KEY, JSON.stringify([...new Set(classes)]));
      } catch {
        // A full or blocked storage costs the player one extra offer, never a crash.
      }
    },
  };
}

function safeLocalStorage(): Pick<Storage, 'getItem' | 'setItem'> | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** A character on the account's roster, as far as this decision cares. */
export interface RosterEntry {
  class: PlayerClass;
}

/**
 * Offer the tutorial for `cls` when BOTH hold:
 *  - the account has answered no tutorial offer for this class before, and
 *  - the roster held no OTHER character of this class before this one.
 *
 * `roster` is the roster BEFORE the new character was created. Passing the roster
 * after creation would always find the new character and never offer anything, so
 * the caller snapshots it first (main.ts does exactly that).
 */
export function shouldOfferTutorial(
  cls: PlayerClass,
  rosterBeforeCreate: readonly RosterEntry[],
  answered: readonly PlayerClass[],
): boolean {
  if (answered.includes(cls)) return false;
  return !rosterBeforeCreate.some((c) => c.class === cls);
}

/** Record that the player answered the offer for this class, either way. */
export function rememberTutorialAnswer(store: TutorialAnswerStore, cls: PlayerClass): void {
  const answered = store.read();
  if (answered.includes(cls)) return;
  store.write([...answered, cls]);
}
