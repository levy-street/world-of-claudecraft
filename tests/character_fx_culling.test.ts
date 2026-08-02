import { describe, expect, it } from 'vitest';
import { shouldRunCharacterFx } from '../src/render/character_fx_culling_core';

describe('character FX culling', () => {
  it('sleeps cosmetic FX for off-screen non-actionable entities', () => {
    expect(shouldRunCharacterFx(false, false)).toBe(false);
  });

  it('keeps visible character FX live', () => {
    expect(shouldRunCharacterFx(true, false)).toBe(true);
  });

  it('keeps off-screen actionable telegraphs live', () => {
    expect(shouldRunCharacterFx(false, true)).toBe(true);
  });
});
