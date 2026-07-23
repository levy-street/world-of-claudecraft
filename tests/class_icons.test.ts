import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { PlayerClass } from '../src/sim/types';
import { classIconUrl } from '../src/ui/portrait_chip';

// Painted class portraits (CraftPix RPG icon art) shown on the pre-game choose /
// create screens instead of the 3D model snapshot. public/ui/class-icons/<cls>.webp
// is the source of truth (WebP only). Provenance recorded in CREDITS.md.
const CLASSES: PlayerClass[] = [
  'warrior',
  'paladin',
  'hunter',
  'rogue',
  'priest',
  'shaman',
  'mage',
  'warlock',
  'druid',
];
const DIR = fileURLToPath(new URL('../public/ui/class-icons', import.meta.url));

describe('class portrait icons', () => {
  it('ships a valid committed webp for every playable class, resolved by classIconUrl', () => {
    for (const cls of CLASSES) {
      expect(classIconUrl(cls)).toBe(`/ui/class-icons/${cls}.webp`);
      const path = `${DIR}/${cls}.webp`;
      expect(existsSync(path), `${cls}.webp missing`).toBe(true);
      // Valid WebP container: "RIFF"...."WEBP".
      const buf = readFileSync(path);
      expect(buf.subarray(0, 4).toString('ascii')).toBe('RIFF');
      expect(buf.subarray(8, 12).toString('ascii')).toBe('WEBP');
    }
  });

  it('holds only the nine class webps (webp-only, no extras)', () => {
    const files = readdirSync(DIR).sort();
    expect(files).toEqual(CLASSES.map((c) => `${c}.webp`).sort());
  });
});
