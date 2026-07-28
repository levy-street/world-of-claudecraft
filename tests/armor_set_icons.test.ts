import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hasArmoredBody } from '../src/render/characters/manifest';
import { ALL_CLASSES } from '../src/sim/types';
import { armorSetIconUrl } from '../src/ui/character_appearance';

// The art on the level-20 armor-set toggle in the character sheet's chroma row.
// public/ui/armor-sets/<cls>.webp is the source of truth (WebP only, same
// convention as public/ui/class-icons/). Provenance recorded in CREDITS.md.
const DIR = fileURLToPath(new URL('../public/ui/armor-sets', import.meta.url));

describe('level-20 armor-set icons', () => {
  it('ships a valid committed webp for every class, resolved by armorSetIconUrl', () => {
    for (const cls of ALL_CLASSES) {
      expect(armorSetIconUrl(cls)).toBe(`/ui/armor-sets/${cls}.webp`);
      const path = `${DIR}/${cls}.webp`;
      expect(existsSync(path), `${cls}.webp missing`).toBe(true);
      // Valid WebP container: "RIFF"...."WEBP". A PNG renamed to .webp would decode
      // nowhere and the toggle would render as a broken image.
      const buf = readFileSync(path);
      expect(buf.subarray(0, 4).toString('ascii'), cls).toBe('RIFF');
      expect(buf.subarray(8, 12).toString('ascii'), cls).toBe('WEBP');
    }
  });

  it('holds only those nine files, in WebP only', () => {
    const files = readdirSync(DIR).sort();
    expect(files).toEqual(ALL_CLASSES.map((cls) => `${cls}.webp`).sort());
  });

  it('covers exactly the classes that ship an armored body', () => {
    // If a class ever ships an armored GLB with no icon (or the reverse) the toggle
    // renders a broken image or the art goes unused, so pin the two sets together.
    const withBody = ALL_CLASSES.filter((cls) => hasArmoredBody(cls)).sort();
    const withIcon = readdirSync(DIR)
      .map((f) => f.replace(/\.webp$/, ''))
      .sort();

    expect(withIcon).toEqual(withBody);
  });
});
