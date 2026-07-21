import { describe, expect, it } from 'vitest';
import {
  cleanEscalationConfig,
  DEFAULT_ESCALATION,
  escalate,
  findHardWord,
  maskText,
  normalizeWord,
  parseWordList,
} from '../server/chat_filter';

// This repository is open source and intentionally contains NO plaintext slurs.
// The hard tier's wordlist is operator-seeded at runtime (never in the repo);
// these fixtures are base64-encoded and decoded only at runtime so the filter
// can be exercised against genuine offensive input without the repo carrying it.
const dec = (b64: string) => Buffer.from(b64, 'base64').toString('utf8');
const F = {
  slur: dec('bmlnZ2Vy'),
  slurPlural: dec('bmlnZ2Vycw=='),
  affixMan: dec('bmlnZ2VybWFu'),
  affix2: dec('bmlnZ2VyZmFnZ290'),
  leet: dec('bjFnZzNy'),
  upper: dec('TklHR0VS'),
  atSign: dec('bmlnZ0A='),
  sixes: dec('bmk2NkA='),
  diacritic9: dec('bsOuOTllcg=='),
  diacritic2: dec('Y2jDrm5r'),
  circled: dec('4pOd4pOY4pOW4pOW4pOU4pOh'),
  math: dec('8J2Tt/Cdk7LwnZOw8J2TsPCdk67wnZO7'),
  fullwidth: dec('bmnvvYfvvYdlcg=='),
  variant2: dec('bmVncm9pZA=='),
  gap1: dec('Z29vaw=='), // an operator-seeded slur
  gap2: dec('d2V0YmFjaw=='),
  benign: dec('c25pZ2dlcg=='), // a real, non-slur word that embeds the slur
};

describe('normalizeWord', () => {
  it('lowercases, de-leets confusables, and strips non-letters', () => {
    expect(normalizeWord(F.upper.replace(/I/g, '1').replace(/E/g, '3'))).toBe(F.slur); // leet + case
    expect(normalizeWord('f.u_c-k')).toBe('fuck');
    expect(normalizeWord('@$$')).toBe('ass');
    expect(normalizeWord('123')).toBe('ie'); // 1->i, 2 dropped, 3->e
  });
});

describe('parseWordList', () => {
  it('splits on whitespace/commas and normalizes each term', () => {
    expect(parseWordList('Fuck, sh1t\n bitch')).toEqual(['fuck', 'shit', 'bitch']);
    expect(parseWordList('   ')).toEqual([]);
  });
});

describe('maskText (soft, cosmetic)', () => {
  it('masks tokens containing a soft term, preserving length', () => {
    expect(maskText('oh shit really', ['shit'])).toBe('oh **** really');
    expect(maskText('that is shitty', ['shit'])).toBe('that is ******'); // substring match
  });

  it('catches leet-spelled evasions', () => {
    expect(maskText('sh1t', ['shit'])).toBe('****');
  });

  it('returns the text unchanged when no terms are configured', () => {
    expect(maskText('anything goes', [])).toBe('anything goes');
  });
});

describe('findHardWord (hard, punitive — the admin hard list is the SOLE trigger)', () => {
  it('matches a LISTED word through leet, case, plurals, diacritics, and Unicode', () => {
    expect(findHardWord(`you are a ${F.slur}`, [F.slur])).toBe(F.slur);
    expect(findHardWord(F.leet, [F.slur])).toBe(F.slur); // n1gg3r → nigger
    expect(findHardWord(F.upper, [F.slur])).toBe(F.slur); // case-insensitive
    expect(findHardWord(`two ${F.slurPlural} here`, [F.slur])).toBe(F.slur); // trailing-s plural
    expect(findHardWord(F.diacritic9, [F.slur])).toBe(F.slur); // accent + 9-as-g
    expect(findHardWord(F.math, [F.slur])).toBe(F.slur); // mathematical-script glyphs
    expect(findHardWord(F.fullwidth, [F.slur])).toBe(F.slur); // fullwidth glyphs
  });

  it('enforces NOTHING with an empty hard list (the list is the only trigger)', () => {
    expect(findHardWord(F.slur, [])).toBeNull();
    expect(findHardWord(F.affixMan, [])).toBeNull();
    expect(findHardWord('anything goes', [])).toBeNull();
  });

  it('does NOT substring-match innocent words (whole-token; no whitelist needed)', () => {
    expect(findHardWord(F.benign, [F.slur])).toBeNull(); // "snigger" embeds the slur
    expect(findHardWord('what a classy pass', ['ass'])).toBeNull();
    expect(findHardWord('assassin guild', ['ass'])).toBeNull();
    expect(findHardWord('that is despicable', ['spic'])).toBeNull();
    expect(findHardWord('perfectly fine message', [F.slur])).toBeNull();
  });

  it('does NOT catch affixed/variant forms unless the operator lists them', () => {
    // Accepted trade-off: <slur>+suffix and unrelated variants are distinct
    // tokens, so a bare listing does not reach them...
    expect(findHardWord(`you stupid ${F.affixMan}`, [F.slur])).toBeNull();
    expect(findHardWord(`what a ${F.variant2}`, [F.slur])).toBeNull();
    // ...but an operator can add the exact variant, and then it matches.
    expect(findHardWord(F.affixMan, [F.affixMan])).toBe(F.affixMan);
    expect(findHardWord(`what a ${F.variant2}`, [F.variant2])).toBe(F.variant2);
  });

  it('matches operator-seeded words and their plurals', () => {
    expect(findHardWord(`go away ${F.gap1}`, [F.gap1])).toBe(F.gap1);
    expect(findHardWord(`${F.gap2}s`, [F.gap2])).toBe(F.gap2); // plural strip
  });
});

describe('escalate', () => {
  const cfg = { warningsBeforeMute: 1, muteLadderSeconds: [600, 3600, 86400] };

  it('warns for the first offense, then walks the mute ladder, capping at the last', () => {
    expect(escalate(0, cfg)).toEqual({ kind: 'warning', muteSeconds: 0, strikes: 1 });
    expect(escalate(1, cfg)).toEqual({ kind: 'mute', muteSeconds: 600, strikes: 2 });
    expect(escalate(2, cfg)).toEqual({ kind: 'mute', muteSeconds: 3600, strikes: 3 });
    expect(escalate(3, cfg)).toEqual({ kind: 'mute', muteSeconds: 86400, strikes: 4 });
    expect(escalate(9, cfg)).toEqual({ kind: 'mute', muteSeconds: 86400, strikes: 10 }); // clamps
  });

  it('mutes immediately when warningsBeforeMute is 0', () => {
    expect(escalate(0, { warningsBeforeMute: 0, muteLadderSeconds: [600] })).toEqual({
      kind: 'mute', muteSeconds: 600, strikes: 1,
    });
  });

  it('never mutes when the ladder is empty', () => {
    expect(escalate(5, { warningsBeforeMute: 1, muteLadderSeconds: [] })).toEqual({
      kind: 'warning', muteSeconds: 0, strikes: 6,
    });
  });
});

describe('cleanEscalationConfig', () => {
  it('falls back to defaults on garbage input', () => {
    expect(cleanEscalationConfig({})).toEqual(DEFAULT_ESCALATION);
    expect(cleanEscalationConfig({ warningsBeforeMute: -3, muteLadderSeconds: 'nope' })).toEqual(DEFAULT_ESCALATION);
  });

  it('keeps valid values and drops non-positive ladder entries', () => {
    expect(cleanEscalationConfig({ warningsBeforeMute: 2, muteLadderSeconds: [60, -1, 0, 120] })).toEqual({
      warningsBeforeMute: 2,
      muteLadderSeconds: [60, 120],
    });
  });
});
