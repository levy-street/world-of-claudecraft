import { describe, expect, it } from 'vitest';
import {
  perfectingCandidateLocation,
  perfectingCandidateState,
} from '../src/ui/hud/professions/perfecting_candidate_view';
import type { PerfectingCandidate } from '../src/ui/hud/professions/perfecting_view';

describe('shared Perfecting copy presentation', () => {
  it('keeps promotion cosmetic while showing actual partial progress', () => {
    expect(perfectingCandidateState('track', 2, 4)).toBe('Rank 2 of 4');
    expect(perfectingCandidateState('perfected', 4, 4)).toBe('Perfected');
    expect(perfectingCandidateState('promoted', 4, 4)).toBe('Legendary');
    expect(perfectingCandidateState('promoted', 1, 4)).toBe('Rank 1 of 4');
  });

  it('labels bag ordinal rather than absolute inventory cell, and distinguishes worn shared slots', () => {
    const refs = [
      { bag: 2, itemId: 'x' },
      { bag: 8, itemId: 'x' },
    ];
    const candidates: PerfectingCandidate[] = refs.map((ref) => ({
      ref,
      itemId: ref.itemId,
      worn: false,
      identity: String(ref.bag),
      selected: false,
      state: 'track',
      rank: 0,
      ranks: 4,
      chosenName: null,
    }));
    expect(perfectingCandidateLocation(refs[1], candidates)).toBe('Bag copy 2 of 2');
    expect(perfectingCandidateLocation({ bag: 99, itemId: 'x' }, candidates)).toBeNull();
    expect(perfectingCandidateLocation({ slot: 'waist', itemId: 'x' }, [])).toBe('Worn (Waist)');
    expect(perfectingCandidateLocation({ slot: 'ring2', itemId: 'x' }, [])).toBe('Worn (Finger 2)');
  });
});
