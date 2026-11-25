import { afterEach, describe, expect, it } from 'vitest';
import {
  clearPaladinConsecrationSpecs,
  notePaladinConsecrationAscended,
  notePaladinConsecrationSpec,
  paladinConsecrationAscendedAt,
  paladinConsecrationSpecAt,
} from '../src/render/ability_vfx/paladin_consecration_spec';

describe("Holy Ground's cast notes", () => {
  afterEach(() => clearPaladinConsecrationSpecs());

  it('marks the zone an Ascension charge empowered, and only that one', () => {
    notePaladinConsecrationSpec(0, 0, 2, 1000);
    notePaladinConsecrationSpec(20, 0, 1, 1000);
    expect(paladinConsecrationAscendedAt(0, 0, 1100)).toBe(false);
    // The charge's cue comes after the cast note, where the Paladin stood.
    notePaladinConsecrationAscended(0.5, 0, 1050);
    expect(paladinConsecrationAscendedAt(0, 0, 1100)).toBe(true);
    expect(paladinConsecrationAscendedAt(20, 0, 1100)).toBe(false);
    expect(paladinConsecrationSpecAt(0, 0, 1100)).toBe(2);
    // Stale notes are forgotten.
    expect(paladinConsecrationAscendedAt(0, 0, 9000)).toBe(false);
  });

  it('keeps an Ascension note without a spec from hiding the caster’s spec', () => {
    // The cue arrives with no cast note nearby: it stands alone, specless.
    notePaladinConsecrationAscended(5, 5, 1000);
    expect(paladinConsecrationAscendedAt(5, 5, 1100)).toBe(true);
    expect(paladinConsecrationSpecAt(5, 5, 1100)).toBeNull();
    notePaladinConsecrationSpec(5, 5, 1, 1050);
    expect(paladinConsecrationSpecAt(5, 5, 1100)).toBe(1);
  });
});
