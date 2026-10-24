// The TRIANGLE ratchet of the WOC character files: what each file draws at each of the three
// levels of detail a character can be drawn at. The byte ratchet beside it
// (tests/woc_character_size_budget.test.ts) cannot hold this. A level of detail is an index
// list of a few kilobytes, so a rebuild that drops or loosens one changes what a whole crowd
// draws (a body is 8,456 triangles at level 0 and 5,072 at MID) while its file gets SMALLER,
// and a mesh that trades texture bytes for triangles stays inside its byte ceiling too.
//
// A file is counted at LEVEL 0 (its own index lists), at MID and at FAR (the WOC_lod lists,
// src/render/assets/woc_lod_plugin.ts), the way the runtime draws it: per node, each primitive
// at the level it would draw when that level is asked of it
// (tests/helpers/woc_shipped_files.ts wocGlbTriangles). Who draws which level is
// src/render/characters/woc_lod_core.ts: level 0 is the local player's own character on Medium
// and above (and previews and portraits), MID is every other character and everyone on Low and
// phones, FAR is the far bake.
//
// Two gates, both literals:
// - TRIANGLES: every mesh file pinned at exactly what it draws at each level. Triangle counts
//   are whole numbers a build either keeps or changes, so the pin is an equality, both ways: a
//   file that gains triangles fails, and so does one that loses them, or whose MID or FAR list
//   went missing (it then draws the next finer level, and the count goes UP).
// - CEILINGS: what a file of each kind may draw at each level, its kind's largest file plus at
//   most 5%. This is the second number a maintainer has to move, deliberately, before a kind
//   can grow past that margin, and a NEW file is held to it from its first row. A ceiling more
//   than TIGHT above its kind's largest file fails too, so it comes down when geometry does.
// To change a count deliberately (a new piece, a denser or a lighter rebuild), rebuild, copy
// the row the failure message prints into TRIANGLES, and say why in the PR body.
import { describe, expect, it } from 'vitest';
import { WOC_SPLIT_DIR } from '../src/render/characters/woc_armor_core';
import {
  readWocGlb,
  type WocFileKind,
  type WocShippedFile,
  type WocTriangles,
  wocGlbTriangles,
  wocShippedFiles,
} from './helpers/woc_shipped_files';

/** Every shipped WOC file that carries geometry (relative to the split directory), with the
 *  triangles it draws at [level 0, MID, FAR]. Pinned 2026-10-05 (the PR 4360 review, N17).
 *  A hairstyle whose MID equals its level 0 ships no mid list (it saved too little to keep):
 *  head_type_b_hair_braid and head_type_b_hair_waves, and no other file. A set's low and
 *  medium files share their geometry and can still differ at FAR: each file's levels are
 *  simplified against its own atlas uvs. */
const TRIANGLES: Readonly<Record<string, readonly [lod0: number, mid: number, far: number]>> = {
  'armor/female_druid_low.glb': [4271, 3569, 2219],
  'armor/female_druid_medium.glb': [4271, 3569, 2219],
  'armor/female_hunter_low.glb': [3729, 3371, 2447],
  'armor/female_hunter_medium.glb': [3729, 3371, 2447],
  'armor/female_mage_low.glb': [4435, 3809, 2425],
  'armor/female_mage_medium.glb': [4435, 3809, 2425],
  'armor/female_paladin_low.glb': [3756, 3348, 2382],
  'armor/female_paladin_medium.glb': [3756, 3348, 2382],
  'armor/female_priest_low.glb': [4435, 3779, 2364],
  'armor/female_priest_medium.glb': [4435, 3779, 2364],
  'armor/female_rogue_low.glb': [3729, 3371, 2447],
  'armor/female_rogue_medium.glb': [3729, 3371, 2447],
  'armor/female_shaman_low.glb': [4300, 3842, 2408],
  'armor/female_shaman_medium.glb': [4300, 3842, 2408],
  'armor/female_warlock_low.glb': [4435, 3749, 2304],
  'armor/female_warlock_medium.glb': [4435, 3749, 2304],
  'armor/female_warrior_low.glb': [3558, 3134, 2459],
  'armor/female_warrior_medium.glb': [3558, 3134, 2459],
  'armor/male_druid_low.glb': [3618, 3030, 1816],
  'armor/male_druid_medium.glb': [3618, 3030, 1816],
  'armor/male_hunter_low.glb': [3076, 2880, 2001],
  'armor/male_hunter_medium.glb': [3076, 2880, 2001],
  'armor/male_mage_low.glb': [4434, 3858, 2395],
  'armor/male_mage_medium.glb': [4434, 3858, 2395],
  'armor/male_paladin_low.glb': [3095, 2899, 1916],
  'armor/male_paladin_medium.glb': [3095, 2899, 1916],
  'armor/male_priest_low.glb': [4434, 3858, 2285],
  'armor/male_priest_medium.glb': [4434, 3858, 2285],
  'armor/male_rogue_low.glb': [3076, 2880, 2001],
  'armor/male_rogue_medium.glb': [3076, 2880, 2001],
  'armor/male_shaman_low.glb': [3647, 3401, 2052],
  'armor/male_shaman_medium.glb': [3647, 3401, 2052],
  'armor/male_warlock_low.glb': [4434, 3768, 2274],
  'armor/male_warlock_medium.glb': [4434, 3768, 2274],
  'armor/male_warrior_low.glb': [4497, 3679, 1506],
  'armor/male_warrior_medium.glb': [4497, 3679, 1506],
  'base_female.glb': [8456, 5072, 2283],
  'base_male.glb': [8388, 5032, 2263],
  'head_type_a_beard_handlebar.glb': [1470, 588, 224],
  'head_type_a_beards.glb': [8881, 6397, 5616],
  'head_type_a_core.glb': [22469, 9101, 2745],
  'head_type_a_hair_braid.glb': [3428, 3084, 1126],
  'head_type_a_hair_long.glb': [1999, 1199, 796],
  'head_type_a_hair_mohawk.glb': [1959, 979, 782],
  'head_type_a_hair_ponytail.glb': [3429, 2743, 751],
  'head_type_a_hair_quiff.glb': [3430, 1620, 588],
  'head_type_a_hair_shoulder.glb': [3429, 2259, 490],
  'head_type_a_hair_swept.glb': [2000, 1000, 830],
  'head_type_a_hair_topknot.glb': [3430, 1648, 370],
  'head_type_a_hair_undercut.glb': [3429, 1885, 1414],
  'head_type_a_hair_waves.glb': [3429, 2743, 2204],
  'head_type_b_beard_handlebar.glb': [1470, 588, 194],
  'head_type_b_beards.glb': [8882, 6482, 5604],
  'head_type_b_core.glb': [26008, 11476, 5166],
  'head_type_b_hair_bob.glb': [3429, 1869, 1047],
  'head_type_b_hair_braid.glb': [3428, 3428, 919],
  'head_type_b_hair_crown.glb': [3430, 1864, 418],
  'head_type_b_hair_curls.glb': [3429, 2445, 1438],
  'head_type_b_hair_ponytail.glb': [3430, 2744, 754],
  'head_type_b_hair_shoulder.glb': [3429, 1957, 567],
  'head_type_b_hair_topknot.glb': [3429, 1913, 359],
  'head_type_b_hair_twins.glb': [3428, 1890, 516],
  'head_type_b_hair_undercut.glb': [3429, 1773, 1357],
  'head_type_b_hair_waves.glb': [3430, 3430, 2230],
};

/** How far above its kind's largest file a ceiling may sit before it must be lowered. */
const TIGHT = 0.1;

type Ceiling = Readonly<Record<'lod0' | 'mid' | 'far', number>>;

/**
 * Triangles a file of each kind may draw at each level: the largest file of the kind at that
 * level (named beside each row, as pinned 2026-10-05) plus at most 5%.
 */
const TRIANGLE_CEILINGS = {
  // base_female: 8,456 / 5,072 / 2,283
  base: { lod0: 8_800, mid: 5_300, far: 2_390 },
  // one set's ten pieces. Level 0 male_warrior (4,497, its shoulders one mesh drawn twice),
  // MID male_mage (3,858), FAR female_warrior (2,458 low, 2,459 medium)
  armorLow: { lod0: 4_700, mid: 4_050, far: 2_580 },
  armorMedium: { lod0: 4_700, mid: 4_050, far: 2_580 },
  // head_type_a_core: 22,469 / 9,101 / 2,745. Every piece of a head type, of which a look
  // draws one per slot.
  headCoreA: { lod0: 23_500, mid: 9_550, far: 2_880 },
  // head_type_b_core: 26,008 / 11,476 / 5,166
  headCoreB: { lod0: 27_300, mid: 12_000, far: 5_420 },
  // level 0 head_type_a_hair_quiff and several more (3,430); MID and FAR
  // head_type_b_hair_waves, which draws its level 0 at MID (3,430) and 2,230 at FAR
  hair: { lod0: 3_600, mid: 3_600, far: 2_340 },
  // a head type's seven shared beards, of which a look draws one: head_type_b_beards at level
  // 0 and MID (8,882 / 6,482), head_type_a_beards at FAR (5,616)
  beards: { lod0: 9_320, mid: 6_800, far: 5_890 },
  // the handlebar: 1,470 / 588 / 224
  beard: { lod0: 1_540, mid: 615, far: 235 },
} as const satisfies Record<string, Ceiling>;

/** The files that carry no geometry of their own, and exactly what their JSON holds instead:
 *  an animation library has no mesh at all, and a top file one degenerate triangle wearing
 *  its maps (build_woc_split.mjs cutTopLevels), with no level of detail. */
const NO_GEOMETRY: Partial<Record<WocFileKind, WocTriangles>> = {
  anims: { lod0: 0, mid: 0, far: 0 },
  armorTop: { lod0: 1, mid: 1, far: 1 },
};

type Budgeted = keyof typeof TRIANGLE_CEILINGS;

/** The ceiling row a file answers to, or null for a file with no geometry and none to pin. */
function ceilingRow(file: WocShippedFile): Budgeted | null {
  switch (file.kind) {
    case 'headCore':
      return file.type === 'b' ? 'headCoreB' : 'headCoreA';
    case 'base':
    case 'armorLow':
    case 'armorMedium':
    case 'hair':
    case 'beards':
    case 'beard':
      return file.kind;
    case 'anims':
    case 'armorTop':
    case 'underArmor':
      return null;
  }
}

const LEVELS = ['lod0', 'mid', 'far'] as const;
const GLBS = wocShippedFiles().filter((file) => file.kind !== 'underArmor');
const COUNTS = new Map(GLBS.map((file) => [file.url, wocGlbTriangles(readWocGlb(file.url).json)]));
const triangles = (file: WocShippedFile): WocTriangles => COUNTS.get(file.url) as WocTriangles;
/** A file's name the way a TRIANGLES row spells it. */
const rowName = (file: WocShippedFile): string => file.url.slice(WOC_SPLIT_DIR.length + 1);

describe('WOC character triangle ratchet', () => {
  it('pins every mesh file: a row for each of the 84 GLBs that draws, none for one that is gone', () => {
    expect(GLBS).toHaveLength(84);
    const drawing = GLBS.filter((file) => ceilingRow(file) !== null);
    expect(drawing.map(rowName)).toEqual(Object.keys(TRIANGLES).sort());
    // the rest carry no geometry, each by its kind's pin below
    const neither = GLBS.filter((file) => ceilingRow(file) === null && !NO_GEOMETRY[file.kind]);
    expect(neither.map(rowName), 'files with neither a row nor a no-geometry pin').toEqual([]);
    // no stale ceiling: every row is one a shipped file answers to
    expect([...new Set(drawing.map(ceilingRow))].sort()).toEqual(
      Object.keys(TRIANGLE_CEILINGS).sort(),
    );
  });

  it.each(GLBS.map((file) => [rowName(file), file] as const))(
    "%s draws exactly its pinned triangles, inside its kind's ceilings",
    (name, file) => {
      const drawn = triangles(file);
      const row = ceilingRow(file);
      if (!row) {
        expect(drawn, `${name}: a ${file.kind} file carries no geometry of its own`).toEqual(
          NO_GEOMETRY[file.kind],
        );
        return;
      }
      const counts = [drawn.lod0, drawn.mid, drawn.far];
      expect(
        counts,
        `${name} draws ${counts.join(' / ')} triangles at level 0 / MID / FAR, not what ` +
          'TRIANGLES pins for it. More at MID or FAR with level 0 unchanged is a level of ' +
          'detail gone missing or loosened. If the change is deliberate, re-pin its row as ' +
          `'${name}': [${counts.join(', ')}], and say why in the PR body.`,
      ).toEqual(TRIANGLES[name]);
      // a coarser level never draws more than the one it stands in for
      expect(drawn.mid, `${name}: MID against level 0`).toBeLessThanOrEqual(drawn.lod0);
      expect(drawn.far, `${name}: FAR against MID`).toBeLessThanOrEqual(drawn.mid);
      for (const level of LEVELS) {
        expect(
          drawn[level],
          `${name} draws ${drawn[level]} triangles at ${level}, over the ${row} ceiling of ` +
            `${TRIANGLE_CEILINGS[row][level]}. Raising a ceiling is a maintainer decision: find ` +
            'what grew first (see the header of this test).',
        ).toBeLessThanOrEqual(TRIANGLE_CEILINGS[row][level]);
      }
    },
  );

  it('keeps every ceiling tight: none more than a tenth above its kind and level', () => {
    const slack: string[] = [];
    for (const row of Object.keys(TRIANGLE_CEILINGS) as Budgeted[]) {
      const files = GLBS.filter((file) => ceilingRow(file) === row);
      for (const level of LEVELS) {
        const largest = Math.max(...files.map((file) => triangles(file)[level]));
        // not vacuous: a kind whose files read as empty would make every ceiling "tight"
        expect(largest, `${row} ${level}`).toBeGreaterThan(0);
        const ceiling = TRIANGLE_CEILINGS[row][level];
        if (ceiling > largest * (1 + TIGHT)) {
          slack.push(`${row} ${level}: ceiling ${ceiling}, largest file ${largest}`);
        }
      }
    }
    expect(slack, 'lower these ceilings to their kind (largest file plus at most 5%)').toEqual([]);
  });

  it('counts the files that ship no mid list: two hairstyles, and nothing else', () => {
    // a file whose MID equals its level 0 hands every crowd character its full geometry, so
    // which files do is a literal: one more name here is a mid list that went missing
    const noMid = GLBS.filter((file) => ceilingRow(file) !== null)
      .filter((file) => triangles(file).mid === triangles(file).lod0)
      .map(rowName);
    expect(noMid).toEqual(['head_type_b_hair_braid.glb', 'head_type_b_hair_waves.glb']);
  });
});
