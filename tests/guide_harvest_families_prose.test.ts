import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  HARVEST_COMPONENT_ITEMS,
  HARVEST_COMPONENT_SPECIMENS,
} from '../src/sim/content/professions';
import { guideStrings } from '../src/ui/i18n.catalog/guide';
import { stripComments } from './helpers/strip_comments';

// Two guide sentences enumerate the corpse-harvest families by name:
// guide.professions.harvestBodyFamilies lists every family a corpse can pay,
// and guide.profPages.specimenBodyFamilies splits them into the specimen
// families and "the other N" that sign the yield itself. Both are written from
// the live maps, so they go stale the moment a family is wired without the
// prose moving (#2905 wired claw and tusk; Masterwrought Phase 11m wired horn
// and gills). This pin DERIVES the expected words from HARVEST_COMPONENT_ITEMS
// and HARVEST_COMPONENT_SPECIMENS rather than restating a list: a map key with
// no word row here throws, a family the prose forgot fails, and a family the
// prose still names after the map dropped it fails too.

// Map key -> the English word the guide prose uses for that family. The plural
// form is what harvestBodyFamilies lists; the singular is what
// specimenBodyFamilies lists. Only the WORDS live here; which keys are expected
// comes from the maps.
const FAMILY_WORDS: Readonly<Record<string, { one: string; many: string }>> = {
  hide: { one: 'hide', many: 'hides' },
  fang: { one: 'fang', many: 'fangs' },
  claw: { one: 'claw', many: 'claws' },
  tusk: { one: 'tusk', many: 'tusks' },
  horn: { one: 'horn', many: 'horns' },
  gills: { one: 'gills', many: 'gills' },
  silk: { one: 'silk', many: 'silk' },
  venomSac: { one: 'venom', many: 'venom' },
  cloth: { one: 'cloth', many: 'cloth' },
  meat: { one: 'meat', many: 'meat' },
};

// The prose spells the specimen-less count out ("the other five"); a count past
// this table is a signal the sentence needs rewriting, not a bigger table.
const COUNT_WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
] as const;

function wordFor(key: string, form: 'one' | 'many'): string {
  const row = FAMILY_WORDS[key];
  if (!row) {
    throw new Error(
      `no guide word for harvest family "${key}": add it to FAMILY_WORDS and to both guide sentences`,
    );
  }
  return row[form];
}

// "a, b, c, and d" -> ['a', 'b', 'c', 'd'] (Oxford comma, the "and" stripped).
function splitList(s: string): string[] {
  return s
    .split(', ')
    .map((w) => w.replace(/^and /, '').trim())
    .filter((w) => w.length > 0);
}

function sorted(words: readonly string[]): string[] {
  return [...words].sort();
}

// Locates one sentence arm; the hint names the anchor so a prose rewrite that
// moves an anchor fails with the sentence shape, not a null deref.
function matchOrFail(re: RegExp, text: string, hint: string): RegExpExecArray {
  const m = re.exec(text);
  if (!m) throw new Error(`${hint}; got: ${text.slice(0, 160)}`);
  return m;
}

const itemKeys = Object.keys(HARVEST_COMPONENT_ITEMS);
const specimenKeys = Object.keys(HARVEST_COMPONENT_SPECIMENS);
const specimenlessKeys = itemKeys.filter((k) => !(k in HARVEST_COMPONENT_SPECIMENS));

describe('guide harvest-family prose derives from the live harvest maps', () => {
  it('harvestBodyFamilies names exactly the HARVEST_COMPONENT_ITEMS families, once each', () => {
    const m = matchOrFail(
      / for (.+?), straight from the corpse/,
      guideStrings.professions.harvestBodyFamilies,
      'the family list sits between "for" and "straight from the corpse"',
    );
    const listed = splitList(m[1]);
    expect(listed.length, `duplicate family in: ${listed.join(', ')}`).toBe(new Set(listed).size);
    expect(sorted(listed)).toEqual(sorted(itemKeys.map((k) => wordFor(k, 'many'))));
  });

  it('specimenBodyFamilies parenthetical names exactly the HARVEST_COMPONENT_SPECIMENS families', () => {
    const m = matchOrFail(
      /perfect specimen to give \(([^)]+)\)/,
      guideStrings.profPages.specimenBodyFamilies,
      'the specimen list is the parenthetical after "perfect specimen to give"',
    );
    const listed = splitList(m[1]);
    expect(listed.length).toBe(new Set(listed).size);
    expect(sorted(listed)).toEqual(sorted(specimenKeys.map((k) => wordFor(k, 'one'))));
  });

  it('specimenBodyFamilies counts and names exactly the specimen-less families', () => {
    const m = matchOrFail(
      /the other (\w+), (.+?), sign the yield itself\./,
      guideStrings.profPages.specimenBodyFamilies,
      'the specimen-less arm reads "the other N, a, b, ..., sign the yield itself."',
    );
    expect(specimenlessKeys.length, 'count word table').toBeLessThan(COUNT_WORDS.length);
    expect(m[1]).toBe(COUNT_WORDS[specimenlessKeys.length]);
    const listed = splitList(m[2]);
    expect(listed.length).toBe(new Set(listed).size);
    expect(sorted(listed)).toEqual(sorted(specimenlessKeys.map((k) => wordFor(k, 'one'))));
  });

  it('every specimen family is also a paying family (the derivation premise)', () => {
    for (const k of specimenKeys) expect(itemKeys, `specimen family ${k}`).toContain(k);
  });

  it('the gathering guide page renders the CURRENT keys, never the retired ones', () => {
    // The pins above cover only the keys the page renders TODAY. The retired
    // pre-#2905 values (harvestBodyChoice, specimenBody) stay in the catalog
    // with their reviewed translations, still naming four families, so a
    // re-point back at either would ship stale prose with every arm above
    // green (11m QA). Comments in the page mention the retired names as
    // history, so the scan strips comments first and harvests exact quoted
    // key literals (specimenBody is a PREFIX of specimenBodyFamilies; a
    // substring check could not tell them apart). The pin assumes
    // single-quoted literals, the style Biome enforces repo-wide; a key built
    // as a template literal or computed string would escape the negative
    // arms, and the two positive arms are what prove the matcher still sees
    // the page at all.
    const src = stripComments(
      readFileSync(new URL('../src/guide/pages/professions_gathering.ts', import.meta.url), 'utf8'),
    );
    const keys = [...src.matchAll(/'(guide\.[A-Za-z0-9_.]+)'/g)].map((m) => m[1]);
    expect(keys).toContain('guide.professions.harvestBodyFamilies');
    expect(keys).toContain('guide.profPages.specimenBodyFamilies');
    expect(keys).not.toContain('guide.professions.harvestBodyChoice');
    expect(keys).not.toContain('guide.profPages.specimenBody');
  });
});
