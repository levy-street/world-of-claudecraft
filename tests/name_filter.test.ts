// server/auth.ts offensiveName(), hardened with the multilingual LDNOOBW list on
// top of obscenity's curated English dataset. Verifies broad profanity coverage
// and leetspeak/confusable evasions are blocked, while the classic
// Scunthorpe-problem legitimate names still pass (the curated allowlist).
import { describe, it, expect } from 'vitest';
import { offensiveName } from '../server/auth';

describe('offensiveName — global banned/curse/naughty word hardening', () => {
  it('blocks profanity across languages (LDNOOBW)', () => {
    for (const n of ['Fuckface', 'Asshole', 'Shitlord', 'Bastardo', 'Connard', 'Stronzo', 'Putain', 'Wichser']) {
      expect(offensiveName(n), n).toBe(true);
    }
  });

  it('blocks leetspeak / confusable / spaced-out evasions', () => {
    for (const n of ['Sh1tlord', '@sshole', 'F u c k']) {
      expect(offensiveName(n), n).toBe(true);
    }
  });

  it('allows legitimate Scunthorpe-problem names', () => {
    for (const n of ['Cassandra', 'Scunthorpe', 'Therapist', 'Cockburn', 'Peacock', 'Analyst', 'Sussex', 'Assemble', 'Aragorn', 'Persephone', 'Bartholomew']) {
      expect(offensiveName(n), n).toBe(false);
    }
  });

  it('ignores non-strings', () => {
    expect(offensiveName(undefined)).toBe(false);
    expect(offensiveName(42)).toBe(false);
  });
});
