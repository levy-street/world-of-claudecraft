import { describe, expect, test } from 'vitest';
import {
  DEBUFF_AURA_KINDS,
  isDebuffAura,
  isDispellableAura,
  isPartyFrameRelevantAura,
  isPlayerRemovableAura,
} from '../src/sim/aura_classify';
import { partyAuraPriority } from '../src/sim/combat/chronomancy';
import { createPlayer, recalcPlayerStats } from '../src/sim/entity';
import {
  CHEATER_MARK_AURA_ID,
  CHEATER_MARK_MAX_SECONDS,
  cheaterMarkAfterPlayed,
  cheaterMarkAura,
  isCheaterMarkActive,
  normalizeCheaterMark,
  normalizeCheaterMarkSeconds,
} from '../src/sim/moderation';
import {
  partyFrameAuras,
  partyFrameAurasForViewer,
  preparePartyFrameAuras,
} from '../src/sim/party_frame_info';
import { type Aura, type Entity, PARTY_MEMBER_AURA_CAP } from '../src/sim/types';

// EVERY field of the entity except its aura list. Deliberately not a curated
// list of derived stat names: the two players compared below are built from
// identical arguments and differ only by the aura, so any field that moves is
// the aura's doing, and a derived field added to recalcPlayerStats later is
// covered the day it appears rather than silently escaping a hand-kept roster.
function entityExceptAuras(e: Entity): Record<string, unknown> {
  const { auras: _auras, ...rest } = e as unknown as Record<string, unknown> & { auras: unknown };
  return rest;
}

// A real dispellable magic debuff, the negative control for the party-frame and
// dispel pins: anything that stops surfacing or removing THIS one has over-reached.
function magicDebuff(index: number): Aura {
  return {
    id: `test_curse_${index}`,
    name: `Test Curse ${index}`,
    kind: 'dot',
    remaining: 30,
    duration: 30,
    value: 10,
    sourceId: 99,
    school: 'shadow',
  };
}

describe('normalizeCheaterMarkSeconds', () => {
  test('clamps a value above the ceiling down to it', () => {
    expect(normalizeCheaterMarkSeconds(CHEATER_MARK_MAX_SECONDS + 5_000)).toBe(
      CHEATER_MARK_MAX_SECONDS,
    );
  });

  test.each([
    ['negative', -1, 0],
    ['NaN', Number.NaN, 0],
    // Infinity collapses to 0 (no mark) rather than clamping to the ceiling: a
    // garbage budget must fail towards no sanction, never towards the maximum one.
    ['Infinity', Number.POSITIVE_INFINITY, 0],
    ['fractional', 90.7, 90],
    ['zero', 0, 0],
  ])('coerces a %s input', (_label, input, expected) => {
    expect(normalizeCheaterMarkSeconds(input)).toBe(expected);
  });

  test.each([
    ['a string', '600'],
    ['null', null],
    ['undefined', undefined],
    ['an object', { secondsRemaining: 600 }],
  ])('rejects %s as 0', (_label, input) => {
    expect(normalizeCheaterMarkSeconds(input)).toBe(0);
  });
});

describe('normalizeCheaterMark', () => {
  test('builds a mark from a positive budget', () => {
    expect(normalizeCheaterMark(3_600)).toEqual({ secondsRemaining: 3_600 });
  });

  test('returns undefined rather than a zeroed record when the budget is spent', () => {
    // Absent-when-empty: an unmarked account must serialize byte-identically to
    // one from before this system existed.
    expect(normalizeCheaterMark(0)).toBeUndefined();
    expect(normalizeCheaterMark(-10)).toBeUndefined();
  });
});

describe('isCheaterMarkActive', () => {
  test('is false for an absent mark', () => {
    expect(isCheaterMarkActive(undefined)).toBe(false);
  });

  test('is false for a spent budget even if the record survived', () => {
    expect(isCheaterMarkActive({ secondsRemaining: 0 })).toBe(false);
  });

  test('is true while budget remains', () => {
    expect(isCheaterMarkActive({ secondsRemaining: 1 })).toBe(true);
  });
});

describe('cheaterMarkAfterPlayed', () => {
  test('burns played seconds off the budget', () => {
    expect(cheaterMarkAfterPlayed({ secondsRemaining: 3_600 }, 600)).toEqual({
      secondsRemaining: 3_000,
    });
  });

  test('expires to undefined once the budget is exactly spent', () => {
    expect(cheaterMarkAfterPlayed({ secondsRemaining: 600 }, 600)).toBeUndefined();
  });

  test('expires to undefined when overshot rather than going negative', () => {
    expect(cheaterMarkAfterPlayed({ secondsRemaining: 600 }, 10_000)).toBeUndefined();
  });

  test('does not mutate the input record', () => {
    const mark = { secondsRemaining: 3_600 };
    cheaterMarkAfterPlayed(mark, 600);
    expect(mark.secondsRemaining).toBe(3_600);
  });

  test.each([
    ['negative elapsed', -500],
    ['NaN elapsed', Number.NaN],
  ])('burns nothing on %s, so a stalled clock cannot shorten a sanction', (_label, elapsed) => {
    expect(cheaterMarkAfterPlayed({ secondsRemaining: 600 }, elapsed)).toEqual({
      secondsRemaining: 600,
    });
  });

  test('an absent mark stays absent', () => {
    expect(cheaterMarkAfterPlayed(undefined, 600)).toBeUndefined();
  });
});

describe('cheaterMarkAura', () => {
  const aura = cheaterMarkAura({ secondsRemaining: 3_600 }, 42);

  test('counts down the played budget as its remaining duration', () => {
    // The aura IS the timer: one second in world is one second of /played, so a
    // second clock would only drift from this one.
    expect(aura.remaining).toBe(3_600);
    expect(aura.duration).toBe(3_600);
  });

  test('carries the stable persisted id', () => {
    expect(aura.id).toBe(CHEATER_MARK_AURA_ID);
    expect(CHEATER_MARK_AURA_ID).toBe('cheater_mark');
  });

  test('is sourced from the wearer', () => {
    expect(aura.sourceId).toBe(42);
  });

  test('clamps an out-of-range budget', () => {
    expect(cheaterMarkAura({ secondsRemaining: Number.MAX_SAFE_INTEGER }, 1).remaining).toBe(
      CHEATER_MARK_MAX_SECONDS,
    );
  });

  // ---------------------------------------------------------------------------
  // The load-bearing rule: a sanction is VISIBILITY, never POWER.
  // src/sim/moderation/CLAUDE.md names these three as a maintainer decision to
  // change. Each is pinned separately so one regressing cannot hide behind another.
  // ---------------------------------------------------------------------------
  test('POWER-NEUTRAL: carries a zero value so no fold can move a stat', () => {
    expect(aura.value).toBe(0);
  });

  test('POWER-NEUTRAL: uses the dedicated inert kind, not a real debuff kind', () => {
    expect(aura.kind).toBe('cheater_mark');
  });

  test('POWER-NEUTRAL: the stat fold produces identical output with the mark on', () => {
    // Behavioral, not textual: run the REAL stat-fold entry point over the same
    // player twice, once carrying the mark, and compare every derived number. A
    // source-text assertion would have gone red on any future comment naming the
    // kind while staying green on a fold arm that read it through a variable.
    const bare = createPlayer(1, 'warrior', { x: 0, y: 0, z: 0 }, 'Bare');
    const marked = createPlayer(1, 'warrior', { x: 0, y: 0, z: 0 }, 'Bare');
    marked.auras.push(cheaterMarkAura({ secondsRemaining: 3_600 }, marked.id));

    recalcPlayerStats(bare, 'warrior', {}, undefined, {});
    recalcPlayerStats(marked, 'warrior', {}, undefined, {});

    expect(marked.auras.some((a) => a.id === CHEATER_MARK_AURA_ID)).toBe(true);
    expect(entityExceptAuras(marked)).toEqual(entityExceptAuras(bare));
  });

  test('POWER-NEUTRAL: the derived snapshot is sensitive enough to catch a real fold', () => {
    // The control for the pin above: an aura the fold DOES read must move the
    // snapshot, or "identical output" would prove nothing.
    const drained = createPlayer(1, 'warrior', { x: 0, y: 0, z: 0 }, 'Bare');
    const bare = createPlayer(1, 'warrior', { x: 0, y: 0, z: 0 }, 'Bare');
    drained.auras.push({
      id: 'test_drain',
      name: 'Test Drain',
      kind: 'buff_allstats_pct',
      remaining: 30,
      duration: 30,
      value: -0.5,
      sourceId: 1,
      school: 'shadow',
    });

    recalcPlayerStats(bare, 'warrior', {}, undefined, {});
    recalcPlayerStats(drained, 'warrior', {}, undefined, {});

    expect(entityExceptAuras(drained)).not.toEqual(entityExceptAuras(bare));
  });

  test('no player counter can shed it', () => {
    expect(aura.undispellable).toBe(true);
    expect(isPlayerRemovableAura(aura)).toBe(false);
  });

  test('rides the physical school, so a dispel is refused even without the flag', () => {
    // Two independent guards, pinned independently. The repo's other inert
    // markers (flag_carried, internal_cd) ride physical for exactly this reason:
    // one boolean is one careless edit away from making the tag dispel food.
    expect(aura.school).toBe('physical');
    const flagDropped = { ...aura, undispellable: undefined };
    expect(isDispellableAura(flagDropped, false)).toBe(false);
    expect(isDispellableAura(flagDropped, true)).toBe(false);
    // The controls, one per arm: the same call DOES clear a real magic debuff
    // off an ally, and DOES purge a real magic buff off an enemy. Without the
    // second, the offensive-arm refusal above would be vacuous: a harmful kind
    // is never offensively dispellable regardless of school or flag.
    expect(isDispellableAura(magicDebuff(0), false)).toBe(true);
    expect(isDispellableAura({ ...magicDebuff(0), kind: 'buff_ap', value: 10 }, true)).toBe(true);
  });

  test('sorts into the debuff bar', () => {
    expect(DEBUFF_AURA_KINDS.has('cheater_mark')).toBe(true);
    expect(isDebuffAura(aura.kind, aura.value)).toBe(true);
  });
});

// A party/raid frame draws at most PARTY_MEMBER_AURA_CAP auras and sorts harmful
// ones first, so a mark that counted as party-frame relevant would push a real
// dispellable debuff off the marked player's healer's frame. That is an
// information handicap, forbidden by the same power-neutrality rule as a stat
// change. The tag's render surfaces are the nameplate and the target frame.
describe('cheaterMarkAura: never on a party or raid frame', () => {
  const aura = cheaterMarkAura({ secondsRemaining: 3_600 }, 42);

  test('is not party-frame relevant, despite classifying as a debuff', () => {
    expect(isDebuffAura(aura.kind, aura.value)).toBe(true);
    expect(isPartyFrameRelevantAura(aura)).toBe(false);
  });

  test('sorts to the bottom tier instead of tier 0 beside real debuffs', () => {
    expect(partyAuraPriority(aura)).toBe(3);
    expect(partyAuraPriority(magicDebuff(0))).toBe(0);
  });

  test('takes no slot, so a full cap of real debuffs all still show', () => {
    const debuffs = Array.from({ length: PARTY_MEMBER_AURA_CAP }, (_, i) => magicDebuff(i));
    // The mark FIRST in the array: without the exclusion the stable sort would
    // have kept it ahead of the tier-0 debuffs and evicted the last one.
    const shown = partyFrameAuras([aura, ...debuffs]);

    expect(shown).toHaveLength(PARTY_MEMBER_AURA_CAP);
    expect(shown.some((row) => row.id === CHEATER_MARK_AURA_ID)).toBe(false);
    for (const debuff of debuffs) {
      expect(shown.some((row) => row.id === debuff.id)).toBe(true);
    }
  });

  test('takes no slot on the SERVER path either, prepare plus per-viewer cap', () => {
    // The offline strip calls partyFrameAuras; the server snapshot builder calls
    // preparePartyFrameAuras once and then partyFrameAurasForViewer per viewer.
    // Both filter through isPartyFrameRelevantAura, so pin both rather than
    // assuming the pair agrees.
    const debuffs = Array.from({ length: PARTY_MEMBER_AURA_CAP }, (_, i) => magicDebuff(i));
    const prepared = preparePartyFrameAuras([aura, ...debuffs]);
    const shown = partyFrameAurasForViewer(prepared, aura.sourceId);

    expect(prepared.some((row) => row.summary.id === CHEATER_MARK_AURA_ID)).toBe(false);
    expect(shown).toHaveLength(PARTY_MEMBER_AURA_CAP);
    expect(shown.some((row) => row.id === CHEATER_MARK_AURA_ID)).toBe(false);
    for (const debuff of debuffs) {
      expect(shown.some((row) => row.id === debuff.id)).toBe(true);
    }
  });
});
