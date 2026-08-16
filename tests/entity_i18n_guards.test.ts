// The entity-text stale-client guards (R34 family) in src/ui/entity_i18n.ts:
// knownLetterId's own-property membership, and tEntity's Record-indexed arms
// reading through ownEntry so a wire-supplied PROTOTYPE key ('constructor',
// '__proto__') falls back to the raw id like any other unknown id instead of
// rendering a Function's fields ("Object", undefined) or throwing
// (set.bonuses.find on a Function).
import { afterEach, describe, expect, it } from 'vitest';
import {
  authoredLettersById,
  QUEST_LETTERS,
  WYRMFALL_CORE_LETTER,
} from '../src/sim/content/letters';
import { knownLetterId, tEntity } from '../src/ui/entity_i18n';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';

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
  // world_entity_i18n is imported LAZILY, inside the tests: its module load
  // walks LETTER_IDS through orderedValues and throws for an id the shared map
  // lacks, and with a top-level import that throw preempts every assertion in
  // this file (a suite that fails to load reports zero tests, so the guard's
  // own message never prints; the phase 10 QA mutation probe hit exactly that
  // legibility gap). Lazy, the named pins below run first and say what broke.
  const translatableIds = async (): Promise<string[]> => {
    const { worldEntityText } = await import('../src/ui/world_entity_i18n');
    return Object.keys(worldEntityText.en.entities.letters);
  };
  const authored = Object.keys(authoredLettersById());

  afterEach(() => setLanguage('en'));

  it('the Wyrmfall Core reward letter is in the shared map and known (the letter that fell through)', () => {
    // Runs BEFORE the ordering-guard import below on purpose: this is the
    // decisive, legible pin. authoredLettersById is the ONE source both
    // registries now derive from, so a row dropped from it reds here by name.
    expect(WYRMFALL_CORE_LETTER.letterId).toBe('wyrmfall_core_reward');
    expect(authored).toContain('wyrmfall_core_reward');
    expect(knownLetterId('wyrmfall_core_reward')).toBe(true);
  });

  it('every authored letter is translatable (has a LETTER_IDS ordering row), both directions', async () => {
    // The load-bearing arm: LETTER_IDS is a hand-kept ORDER list, so a letter
    // added to letters.ts without a row is unknown to the catalog (this reds),
    // and a LETTER_IDS row for an id the map lacks makes world_entity_i18n's
    // own orderedValues throw (which this await surfaces as a failure of THIS
    // test rather than an unloadable file).
    const translatable = await translatableIds();
    expect(authored.length).toBeGreaterThan(0);
    expect([...authored].sort()).toEqual([...translatable].sort());
  });

  it('every translatable letter id is a known letter', async () => {
    // Structurally implied while both registries derive from the one builder
    // (translatable is a subset of authored by construction); kept as the
    // regression it guards: a hand-seeded map reintroduced on either side.
    const translatable = await translatableIds();
    expect(translatable.length).toBeGreaterThan(0);
    for (const id of translatable) expect(knownLetterId(id), id).toBe(true);
  });

  it('renders the Wyrmfall letter in a real non-English locale (the reported symptom)', async () => {
    // The defect was the mailbox falling back to wire English in EVERY locale
    // because knownLetterId was false; the English self-comparison cannot see
    // that, so the subject is read under a locale whose overlay carries the
    // fill, and must differ from the English source.
    await ensureLocaleLoaded('ja_JP');
    setLanguage('ja_JP');
    const subject = tEntity({ kind: 'letter', id: 'wyrmfall_core_reward', field: 'subject' });
    expect(subject).not.toBe(WYRMFALL_CORE_LETTER.subject);
    expect(subject.length).toBeGreaterThan(0);
    setLanguage('en');
    expect(tEntity({ kind: 'letter', id: 'wyrmfall_core_reward', field: 'subject' })).toBe(
      WYRMFALL_CORE_LETTER.subject,
    );
  });
});
