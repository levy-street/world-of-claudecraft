import { describe, it, expect } from 'vitest';
import { designSpecForTraits, traitProfile } from '../server/nft_trait_profiles';
import { normalizeDesignSpec, SKIN_PATTERNS, SKIN_FINISHES, SKIN_DENSITIES, type SkinDesignSpec } from '../src/world_api';
import type { NftAttribute } from '../server/nft_ownership';

const HEX6 = /^#[0-9a-f]{6}$/;

function assertValidSpec(spec: SkinDesignSpec): void {
  expect(spec.primary).toMatch(HEX6);
  expect(spec.secondary).toMatch(HEX6);
  expect(spec.accent).toMatch(HEX6);
  expect(SKIN_PATTERNS).toContain(spec.pattern);
  expect(SKIN_FINISHES).toContain(spec.finish);
  expect(SKIN_DENSITIES).toContain(spec.density);
  expect(spec.emissive === null || HEX6.test(spec.emissive)).toBe(true);
  // Round-trips through the shared validator the renderer trusts.
  expect(normalizeDesignSpec(spec)).toEqual(spec);
}

describe('BAYC profile', () => {
  it('maps Solid Gold fur to a metallic gold body', () => {
    const spec = designSpecForTraits('bayc', [{ trait_type: 'Fur', value: 'Solid Gold' }, { trait_type: 'Background', value: 'Blue' }]);
    expect(spec.finish).toBe('metallic');
    expect(spec.primary).toBe('#d4af37');
    expect(spec.accent).toBe('#4f86d1'); // background blue
    assertValidSpec(spec);
  });
  it('maps Zombie fur to an emissive green and Laser Eyes to a red glow override', () => {
    const zombie = designSpecForTraits('bayc', [{ trait_type: 'Fur', value: 'Zombie' }]);
    expect(zombie.emissive).toBe('#7cff5a');
    const laser = designSpecForTraits('bayc', [{ trait_type: 'Fur', value: 'Zombie' }, { trait_type: 'Eyes', value: 'Laser Eyes' }]);
    expect(laser.emissive).toBe('#ff2a2a');
    assertValidSpec(zombie);
    assertValidSpec(laser);
  });
  it('maps Trippy fur to a high-density emissive multi-colour look', () => {
    const spec = designSpecForTraits('bayc', [{ trait_type: 'Fur', value: 'Trippy' }]);
    expect(spec.density).toBe('high');
    expect(spec.emissive).not.toBeNull();
    assertValidSpec(spec);
  });
});

describe('CryptoPunks profile', () => {
  it('maps Type to a base palette and accessories to accents', () => {
    const alien = designSpecForTraits('cryptopunks', [{ trait_type: 'Type', value: 'Alien' }]);
    expect(alien.primary).toBe('#9fe8e8');
    const zombie = designSpecForTraits('cryptopunks', [{ trait_type: 'Type', value: 'Zombie' }]);
    expect(zombie.emissive).toBe('#7cff5a');
    const mohawk = designSpecForTraits('cryptopunks', [{ trait_type: 'Type', value: 'Male' }, { trait_type: 'accessory', value: 'Mohawk' }]);
    expect(mohawk.accent).toBe('#ff3030');
    expect(mohawk.pattern).toBe('chevron');
    [alien, zombie, mohawk].forEach(assertValidSpec);
  });
});

describe('generic mapper', () => {
  it('produces a valid spec for an arbitrary collection', () => {
    const attrs: NftAttribute[] = [
      { trait_type: 'Background', value: 'Purple' },
      { trait_type: 'Body', value: 'Galaxy' },
      { trait_type: 'Clothes', value: 'Striped Tee' },
      { trait_type: 'Eyes', value: 'Laser' },
    ];
    const spec = designSpecForTraits('some-unknown-collection', attrs); // falls back to generic
    expect(spec.pattern).toBe('stripes'); // from "Striped Tee"
    expect(spec.emissive).toBe('#ff2a2a'); // laser eyes
    assertValidSpec(spec);
  });
  it('is deterministic: same traits -> identical spec', () => {
    const attrs: NftAttribute[] = [{ trait_type: 'X', value: 'mystery' }, { trait_type: 'Y', value: 'unknown-value' }];
    expect(designSpecForTraits('generic', attrs)).toEqual(designSpecForTraits('generic', attrs));
  });
  it('handles an empty attribute set without throwing', () => {
    assertValidSpec(designSpecForTraits('generic', []));
  });
  it('falls back to the generic profile for an unknown id', () => {
    expect(traitProfile('nope').id).toBe('generic');
  });
});
