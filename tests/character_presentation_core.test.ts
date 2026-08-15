import { describe, expect, it } from 'vitest';
import {
  characterPresentationCasting,
  nextRecklessnessSkullsLatch,
  shouldRunCharacterPresentationWork,
} from '../src/render/character_presentation_core';

describe('character presentation work', () => {
  it('sleeps only an off-screen cosmetic actor', () => {
    expect(shouldRunCharacterPresentationWork(false, false)).toBe(false);
    expect(shouldRunCharacterPresentationWork(true, false)).toBe(true);
    expect(shouldRunCharacterPresentationWork(false, true)).toBe(true);
    expect(shouldRunCharacterPresentationWork(true, true)).toBe(true);
  });

  it('treats Water Jet visual channels as actionable casts', () => {
    expect(characterPresentationCasting(null, true, false)).toBe(true);
    expect(characterPresentationCasting('fireball', false, false)).toBe(true);
    expect(characterPresentationCasting(null, true, true)).toBe(false);
    expect(characterPresentationCasting('fireball', false, true)).toBe(false);
    expect(characterPresentationCasting('fireball', true, true)).toBe(false);
  });

  it('latches one Recklessness burst per real aura activation', () => {
    let latch = false;

    latch = nextRecklessnessSkullsLatch(false, true, latch);
    expect(latch).toBe(false);
    latch = nextRecklessnessSkullsLatch(true, false, latch);
    expect(latch).toBe(false);
    latch = nextRecklessnessSkullsLatch(true, true, latch);
    expect(latch).toBe(true);
    latch = nextRecklessnessSkullsLatch(true, false, latch);
    expect(latch).toBe(true);
    latch = nextRecklessnessSkullsLatch(true, true, latch);
    expect(latch).toBe(true);
    latch = nextRecklessnessSkullsLatch(false, true, latch);
    expect(latch).toBe(false);
    latch = nextRecklessnessSkullsLatch(true, true, latch);
    expect(latch).toBe(true);
  });
});
