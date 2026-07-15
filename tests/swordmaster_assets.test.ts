import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import mapping from '../public/ui/skills/swordmaster/mapping.json';
import { SWORDMASTER_ABILITIES } from '../src/sim/content/swordmaster';
import { talentsFor } from '../src/sim/content/talents';
import { abilityImageUrl } from '../src/ui/icons';
import { talentSpecIconRef } from '../src/ui/talent_icons';

const expectedAbilityIds = Object.keys(SWORDMASTER_ABILITIES).sort();
const expectedSpecIds = ['azure_blade', 'duelist', 'tempest'];

describe('SwordMaster authored icon assets', () => {
  it('keeps every class ability wired to one documented image without orphans', () => {
    const mapped = mapping.abilities.map((entry) => entry.abilityId).sort();
    expect(mapped).toEqual(expectedAbilityIds);

    for (const abilityId of expectedAbilityIds) {
      expect(abilityImageUrl(abilityId)).toBe(`/ui/skills/swordmaster/${abilityId}.webp`);
    }
  });

  it('keeps every specialization wired to its documented authored crest', () => {
    const talents = talentsFor('swordmaster');
    expect(talents).toBeDefined();
    expect(talents?.specs.map((spec) => spec.id).sort()).toEqual(expectedSpecIds);
    expect(mapping.specializations.map((entry) => entry.specId).sort()).toEqual(expectedSpecIds);

    for (const spec of talents?.specs ?? []) {
      expect(talentSpecIconRef(spec)).toEqual({
        kind: 'image',
        url: `/ui/specs/swordmaster/${spec.id}.webp`,
      });
    }
  });

  it('ships every ability and spec image as a real 128px WebP', async () => {
    const paths = [
      ...mapping.abilities.map((entry) => `public/ui/skills/swordmaster/${entry.output}`),
      ...mapping.specializations.map((entry) => entry.output),
    ];

    for (const path of paths) {
      const file = resolve(path);
      expect(existsSync(file), path).toBe(true);
      const meta = await sharp(file).metadata();
      expect({ format: meta.format, width: meta.width, height: meta.height }, path).toEqual({
        format: 'webp',
        width: mapping.iconSize,
        height: mapping.iconSize,
      });
    }
  });
});
