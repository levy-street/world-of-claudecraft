// The entity-text stale-client guards (R34 family) in src/ui/entity_i18n.ts:
// knownLetterId's own-property membership, and tEntity's Record-indexed arms
// reading through ownEntry so a wire-supplied PROTOTYPE key ('constructor',
// '__proto__') falls back to the raw id like any other unknown id instead of
// rendering a Function's fields ("Object", undefined) or throwing
// (set.bonuses.find on a Function).
import { describe, expect, it } from 'vitest';
import {
  authoredLettersById,
  QUEST_LETTERS,
  WYRMFALL_CORE_LETTER,
} from '../src/sim/content/letters';
import { knownLetterId, tEntity } from '../src/ui/entity_i18n';
import { worldEntityText } from '../src/ui/world_entity_i18n';

const SHIPPED_LETTER = Object.values(QUEST_LETTERS)[0]?.letterId ?? '';
if (!SHIPPED_LETTER) throw new Error('no shipped quest letter in content');

describe('knownLetterId', () => {
  it('claims a shipped letter and refuses unknown and prototype ids', () => {
    expect(knownLetterId(SHIPPED_LETTER)).toBe(true);
    expect(knownLetterId('letter_from_a_future_expansion')).toBe(false);
    expect(knownLetterId('constructor')).toBe(false);
    expect(knownLetterId('__proto__')).toBe(false);
  });
});

describe('tEntity prototype-key fallback (the ownEntry arms)', () => {
  it('every Record-indexed kind renders a prototype key as the raw id', () => {
    expect(tEntity({ kind: 'quest', id: 'constructor', field: 'title' })).toBe('constructor');
    expect(tEntity({ kind: 'mob', id: 'constructor', field: 'name' })).toBe('constructor');
    expect(tEntity({ kind: 'npc', id: 'constructor', field: 'name' })).toBe('constructor');
    // The itemSet arm THREW before the guard (set.bonuses.find on a
    // Function); the raw-id return is also the never-throws pin.
    expect(tEntity({ kind: 'itemSet', id: 'constructor', field: 'bonus2' })).toBe('constructor');
  });

  it('a genuinely unknown id keeps the same raw-id contract', () => {
    expect(tEntity({ kind: 'quest', id: 'q_future_expansion', field: 'title' })).toBe(
      'q_future_expansion',
    );
    expect(tEntity({ kind: 'mob', id: 'future_mob', field: 'name' })).toBe('future_mob');
  });
});

// The two letter registries used to hand-seed separate copies of the
// letterId map, and the Wyrmfall Core letter (Masterwrought phase 04) reached
// world_entity_i18n (so its translation keys and non-Latin fills existed) but
// never entity_i18n, so knownLetterId read false and the mailbox fell back to
// wire English in every locale. Both now derive from letters.ts
// authoredLettersById; this pins the key sets equal in BOTH directions so a
// letter cannot be translatable-but-unknown (or known-but-untranslatable)
// again. The Wyrmfall row is named because it is the letter that fell through.
describe('letter registries agree (world_entity_i18n vs entity_i18n)', () => {
  const translatable = Object.keys(worldEntityText.en.entities.letters);
  const authored = Object.keys(authoredLettersById());

  it('every translatable letter id is a known letter', () => {
    expect(translatable.length).toBeGreaterThan(0);
    for (const id of translatable) expect(knownLetterId(id), id).toBe(true);
  });

  it('every authored letter is translatable (has a LETTER_IDS ordering row)', () => {
    expect(authored.length).toBeGreaterThan(0);
    expect([...authored].sort()).toEqual([...translatable].sort());
  });

  it('the Wyrmfall Core reward letter is known and translatable', () => {
    expect(WYRMFALL_CORE_LETTER.letterId).toBe('wyrmfall_core_reward');
    expect(knownLetterId('wyrmfall_core_reward')).toBe(true);
    expect(translatable).toContain('wyrmfall_core_reward');
    expect(tEntity({ kind: 'letter', id: 'wyrmfall_core_reward', field: 'subject' })).toBe(
      WYRMFALL_CORE_LETTER.subject,
    );
  });
});
