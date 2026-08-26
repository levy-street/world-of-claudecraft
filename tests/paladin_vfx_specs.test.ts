import { describe, expect, it } from 'vitest';
import { abilityVfxFullSpec, abilityVfxSpec } from '../src/render/ability_vfx_registry';
import {
  HAMMER_OF_GRACE_VFX_FULL_SPEC,
  HAMMER_OF_GRACE_VFX_SPEC,
} from '../src/render/paladin_vfx_specs';

describe('Paladin ability VFX specs', () => {
  it('routes Hammer of Grace through its authored holy projectile identity', () => {
    expect(abilityVfxSpec('hammer_of_grace')).toBe(HAMMER_OF_GRACE_VFX_SPEC);
    expect(abilityVfxFullSpec('hammer_of_grace')).toBe(HAMMER_OF_GRACE_VFX_FULL_SPEC);
    expect(HAMMER_OF_GRACE_VFX_SPEC).toMatchObject({
      p: 'holy',
      a: 'bolt',
      b: { v: 28, h: 1.05 },
    });
    expect(HAMMER_OF_GRACE_VFX_FULL_SPEC).toMatchObject({
      archetype: 'bolt',
      palette: 'holy',
      motifs: ['gavel'],
      motifAt: 'target',
    });
  });
});
