import { describe, expect, it } from 'vitest';
import { findSessionByName } from '../server/session_by_name';

const s = (name: string) => ({ name });

describe('findSessionByName', () => {
  it('prefers an exact-case match over case-insensitive ones', () => {
    const exact = s('Mira');
    expect(findSessionByName([s('mira'), exact, s('MIRA')], 'Mira')).toBe(exact);
  });

  it('accepts a unique case-insensitive match and trims the typed name', () => {
    const mira = s('Mira Sun');
    expect(findSessionByName([s('Tor'), mira], '  mira sun ')).toBe(mira);
  });

  it('resolves nobody when the case-insensitive match is ambiguous or absent', () => {
    expect(findSessionByName([s('Mira'), s('MIRA')], 'mira')).toBeNull();
    expect(findSessionByName([s('Tor')], 'Mira')).toBeNull();
    expect(findSessionByName([], 'Mira')).toBeNull();
  });
});
