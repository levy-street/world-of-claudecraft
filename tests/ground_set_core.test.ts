import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GROUND_SET,
  groundSetFromQuery,
  PAINTED_GROUND_SETS,
  PHOTO_GROUND_SET,
} from '../src/render/ground_set_core';

// The `?ground=` switch decides which ground set the overworld terrain loads.
// Its value used to be spliced straight into texture file names, so any string
// in the address became a request for a file of that name. The switch is an
// allowlist now: these cases hold it to the sets that really ship.

const TERRAIN_DIR = new URL('../public/textures/terrain/', import.meta.url);
/** terrain.ts as code: its comments are cut, so a commented-out line can satisfy no pin. */
const terrainSource = (): string =>
  readFileSync(new URL('../src/render/terrain.ts', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('groundSetFromQuery', () => {
  it('wears the painted set when the switch is absent', () => {
    expect(DEFAULT_GROUND_SET).toBe('Painted');
    for (const search of [
      '',
      '?',
      '?gfx=ultra',
      '?cel=on&zonehaze=off',
      '?grounds=photo',
      '?underground=photo',
    ]) {
      expect(groundSetFromQuery(search), search).toBe('Painted');
    }
  });

  it('puts the photo layers back on ?ground=photo', () => {
    expect(PHOTO_GROUND_SET).toBe('photo');
    expect(groundSetFromQuery('?ground=photo')).toBe('photo');
    expect(groundSetFromQuery('?gfx=low&ground=photo&cel=on')).toBe('photo');
    // a search string with no leading question mark parses the same way
    expect(groundSetFromQuery('ground=photo')).toBe('photo');
  });

  it('accepts a painted set by its own name', () => {
    expect([...PAINTED_GROUND_SETS]).toContain(DEFAULT_GROUND_SET);
    for (const set of PAINTED_GROUND_SETS) {
      expect(groundSetFromQuery(`?ground=${set}`)).toBe(set);
    }
  });

  it('falls back to the default for every value outside the allowlist', () => {
    for (const value of [
      '',
      // the old grammar: a suffix spliced onto "Painted"
      'Red',
      // near misses of the two real names
      'painted',
      'PAINTED',
      'Photo',
      'PHOTO',
      'photos',
      'photo%20',
      // file names and paths
      'Painted_Meadow_Color.jpg',
      'Grass001',
      '../Grass001',
      '..%2F..%2Fsecret',
      'Painted%2F..%2Fx',
      '%00',
      // names that exist on every object
      'constructor',
      '__proto__',
      'toString',
    ]) {
      expect(groundSetFromQuery(`?ground=${value}`), value).toBe(DEFAULT_GROUND_SET);
    }
    // the first value is the one read, so a second cannot override it
    expect(groundSetFromQuery('?ground=Red&ground=photo')).toBe(DEFAULT_GROUND_SET);
    expect(groundSetFromQuery('?ground=photo&ground=Red')).toBe('photo');
  });
});

describe('the painted ground sets and the files on disk', () => {
  /** The file names terrain.ts builds per painted set, as the text either side
   *  of the set's prefix, read off its own template literals so a renamed layer
   *  cannot leave this suite checking the old name. */
  function paintedFileShapes(): { before: string; after: string }[] {
    return [
      ...terrainSource().matchAll(/`([A-Za-z_]*)\$\{PAINTED_GROUND\}([A-Za-z_]*\.(?:jpg|png))`/g),
    ].map((m) => ({ before: m[1], after: m[2] }));
  }

  it('reads the five files of a painted set off terrain.ts', () => {
    expect(
      paintedFileShapes()
        .map(({ before, after }) => `${before}Painted${after}`)
        .sort(),
    ).toEqual([
      'GroundAO_Packed_Painted.png',
      // (no earth or rock normal map: the painted ground draws flat detail normals by
      // design, and only the meadow's is read, by the Wildheart Basin floor)
      'Painted_Earth_Color.jpg',
      'Painted_Meadow_Color.jpg',
      'Painted_Meadow_NormalGL.png',
      'Painted_Rock_Color.jpg',
    ]);
  });

  it('ships every file of every set on the allowlist', () => {
    const onDisk = new Set(readdirSync(TERRAIN_DIR));
    for (const set of PAINTED_GROUND_SETS) {
      for (const { before, after } of paintedFileShapes()) {
        const file = `${before}${set}${after}`;
        expect(onDisk.has(file), `public/textures/terrain/${file} is missing`).toBe(true);
      }
    }
  });

  it('allowlists every painted set that ships, and no other', () => {
    // a set announces itself by its meadow colour layer
    const shipped = readdirSync(TERRAIN_DIR).flatMap((name) => {
      const set = /^(Painted[A-Za-z0-9]*)_Meadow_Color\.jpg$/.exec(name)?.[1];
      return set ? [set] : [];
    });
    expect(shipped.sort()).toEqual([...PAINTED_GROUND_SETS].sort());
  });
});

describe('terrain.ts and the switch', () => {
  it('takes its ground set from the allowlisted parser, read once at module load', () => {
    const terrain = terrainSource();
    expect(terrain).toContain(
      "const GROUND_SET = groundSetFromQuery(typeof location === 'undefined' ? '' : location.search);",
    );
    expect(terrain).toContain(
      'const PAINTED_GROUND = GROUND_SET === PHOTO_GROUND_SET ? null : GROUND_SET;',
    );
    // no second, unchecked read of the address beside it: the one read is the parser's
    // argument above
    expect(terrain.match(/location\.search/g)).toHaveLength(1);
    // and every painted file name is spelled from the allowlisted value alone: the one
    // interpolation any terrain file name carries is PAINTED_GROUND
    const spliced = [...terrain.matchAll(/`[^`]*\$\{([^}]+)\}[^`]*\.(?:jpg|png)`/g)].map(
      (match) => match[1],
    );
    expect(spliced.length).toBeGreaterThan(0);
    expect([...new Set(spliced)]).toEqual(['PAINTED_GROUND']);
  });
});
