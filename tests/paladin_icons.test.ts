import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { PALADIN_CHOICE_ROWS } from '../src/sim/content/choice_rows_classic';
import { talentRowOptionIconRef } from '../src/ui/talent_icons';

const PALADIN_CORE_ICON_IDS = [
  'divine_ascension',
  'hushbrand',
  'guardian_covenant',
  'devotion_ward',
  'solar_step',
  'solar_invocation',
  'hammer_of_grace',
  'sacred_form',
  'aegis_first_dawn',
  'radiant_devotion',
  'dawn_devotion',
  'grace_devotion',
  'recall_the_fallen',
  'beacon_of_light',
  'final_edict',
  'dawnfall',
  'valkyrs_calling',
  'faithforged_guard',
  'mercy_lance',
  'dawns_embrace',
  'radiant_chorus',
  'life_covenant',
  'vowkeeper_strike',
  'bastion_rite',
  'sunward_disc',
  'sacred_challenge',
] as const;

const PALADIN_ICON_DIR = 'public/ui/skills/paladin';
const PALADIN_TALENT_IDS = PALADIN_CHOICE_ROWS.rows.flatMap((row) =>
  row.options.map((option) => option.id),
);

function pixelRmse(a: Buffer, b: Buffer): number {
  let squaredError = 0;
  for (let index = 0; index < a.length; index += 1) {
    const delta = a[index] - b[index];
    squaredError += delta * delta;
  }
  return Math.sqrt(squaredError / a.length);
}

async function normalizedPixels(filename: string): Promise<Buffer> {
  return sharp(`${PALADIN_ICON_DIR}/${filename}`)
    .resize(32, 32, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer();
}

describe('Paladin core icon identity', () => {
  it('gives every new ability an explicit procedural recipe instead of a fallback', () => {
    const source = readFileSync('src/ui/icons.ts', 'utf8');
    for (const id of PALADIN_CORE_ICON_IDS) {
      expect(source, id).toMatch(new RegExp(`\\n\\s*${id}: r\\(`));
    }
  });

  it('uses the five-charge Ascension seal primitive for Divine Ascension', () => {
    const source = readFileSync('src/ui/icons.ts', 'utf8');
    expect(source).toContain('ascension_seal(ctx, pal)');
    expect(source).toMatch(/divine_ascension: r\([\s\S]*?\{ p: 'ascension_seal', \.\.\.BIG \}/);
  });

  it('gives every Paladin choice talent its own painted icon', () => {
    const refs = PALADIN_CHOICE_ROWS.rows.flatMap((row) =>
      row.options.map((option) => ({
        option,
        ref: talentRowOptionIconRef(option),
      })),
    );

    expect(refs).toHaveLength(18);
    for (const { option, ref } of refs) {
      expect(ref, option.id).toEqual({
        kind: 'image',
        url: `/ui/skills/paladin/${option.id}.webp`,
      });
    }
    expect(new Set(refs.map(({ ref }) => ('url' in ref ? ref.url : ''))).size).toBe(refs.length);
  });

  it('keeps every Paladin choice talent artwork visually distinct at the binary level', () => {
    const hashes = PALADIN_TALENT_IDS.map((id) => {
      const bytes = readFileSync(`${PALADIN_ICON_DIR}/${id}.webp`);
      return createHash('sha256').update(bytes).digest('hex');
    });

    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it('does not reuse or lightly re-encode any Paladin ability artwork for a talent', async () => {
    const abilityFiles = readdirSync(PALADIN_ICON_DIR).filter(
      (filename) => filename.endsWith('.webp') && !filename.startsWith('pal_r'),
    );
    const talentFiles = PALADIN_TALENT_IDS.map((id) => `${id}.webp`);
    const allFiles = [...talentFiles, ...abilityFiles];
    const pixels = new Map(
      await Promise.all(
        allFiles.map(async (filename) => [filename, await normalizedPixels(filename)] as const),
      ),
    );
    const pixelsFor = (filename: string): Buffer => {
      const value = pixels.get(filename);
      if (!value) throw new Error(`Missing normalized pixels for ${filename}`);
      return value;
    };

    for (let left = 0; left < talentFiles.length; left += 1) {
      for (let right = left + 1; right < talentFiles.length; right += 1) {
        expect(
          pixelRmse(pixelsFor(talentFiles[left]), pixelsFor(talentFiles[right])),
          `${talentFiles[left]} visually duplicates ${talentFiles[right]}`,
        ).toBeGreaterThan(20);
      }
      for (const abilityFile of abilityFiles) {
        expect(
          pixelRmse(pixelsFor(talentFiles[left]), pixelsFor(abilityFile)),
          `${talentFiles[left]} visually duplicates ${abilityFile}`,
        ).toBeGreaterThan(20);
      }
    }
  });
});
