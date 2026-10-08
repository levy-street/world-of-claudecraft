import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { characterPreloadUrls } from '../src/render/characters/manifest';
import { WOC_SPLIT_DIR } from '../src/render/characters/woc_armor_core';
import { WOC_HEAD_TYPES, wocHeadLookUrls } from '../src/render/characters/woc_head_catalog';
import {
  WOC_SKIN_DIR,
  wocFileKind,
  wocFilesOnDisk,
  wocShippedFiles,
} from './helpers/woc_shipped_files';

// The size RATCHET for the WOC player character files (the 2026-09-25 character size gameplan,
// step 1). Before the split every class shipped as its own file repeating the body, the face,
// the rig, every clip and the high texture tier, and every player downloaded all 18 of them at
// login (233.6 MB). Now a body type is one base and one animation library, each armor set ships
// as a low file, a medium file and a top file (the top mip level of each of the medium file's
// maps, 2026-10-03) with one texture atlas per map kind, the modular head library
// ships split (a core file per head type plus one file per hairstyle and per facial-hair
// texture), and nothing of a WOC body is in the boot preload (tests/woc_character.test.ts pins
// that).
//
// Two gates:
// - BUDGETS: what each kind of file may weigh. Since the PR 4360 review (N17) a budget is its
//   kind's largest shipped file plus a margin of about 5%, where the budgets used to leave a
//   file room to double. The ceilings below bind a rebuild; the budget is the second number a
//   maintainer has to move, deliberately, before a kind can grow past that margin. A budget
//   more than BUDGET_SLACK above its kind's largest file fails too, so a budget comes down
//   with its files. For the record, the budgets this table carried until then: 0.5 MB a base
//   (the 2026-09-25 gameplan's 1.5 MB, lowered 2026-10-01 when the original face left the
//   file), 1.5 MB a library (the gameplan's) or a head core (since the 2026-09-30 split),
//   0.6 MB a hairstyle or beard file, 0.4 and 1.5 MB a low and a medium armor file (the
//   gameplan's, relaxed by the owner 2026-09-28: "2mb is all g for characters"), 2.0 MB a top
//   file and 2.5 MB a high pair.
// - CEILINGS: every shipped file pinned at its size when it last shrank (rounded up to the next
//   KiB). A rebuild that grows any file fails here and names it. After a change that shrinks
//   files, LOWER their ceilings in the same change; the ratchet only works if it tightens.
//   Raising a ceiling is a maintainer decision, justified in the PR body, and never above the
//   file's budget.
//
// A file that is not in the table fails too (a new set lands with its row), and a row whose
// file is gone fails (a removed set takes its row with it).
//
// The 16 class under-armor atlases (public/textures/skins/woc/: standalone KTX2 files, one
// drawn over a body's own uvs while its chest slot is worn) are in the ratchet since the same
// review, a row each in UNDER_ARMOR_CEILINGS and a budget of their own.
//
// Bytes are all this file can see. What they hide is pinned beside it: every texture's size,
// mip chain and codec (tests/woc_texture_budget.test.ts), every file's triangles at each
// level of detail (tests/woc_triangle_budget.test.ts) and the glTF extensions in use
// (tests/woc_material_extensions.test.ts).

const MB = 1_000_000;

/** How far above its kind's largest shipped file a budget may sit before it must come down. */
const BUDGET_SLACK = 0.1;

/**
 * Bytes a file of each kind may weigh: the kind's largest shipped file when the row was last
 * pinned (2026-10-05, named beside it) plus about 5%, rounded up to a thousand.
 */
const WOC_SIZE_BUDGETS = {
  /** The rig, the body and its one map: a base ends at the neck (the modular head packs are
   *  the head, and the handoff's original face never ships: it was three quarters of each
   *  base until 2026-10-01, so a base that grows by a megabyte is carrying a head again).
   *  base_female: 361,116. */
  base: 380_000,
  /** A fit's animation library: the rig's nodes and every clip. anims_female: 682,864. */
  anims: 718_000,
  /** A head type's CORE file (woc_head_catalog.ts wocHeadCoreUrl): the base head and every
   *  eye, brow, nose, mouth, ear and piercing piece, which every character of the type
   *  downloads (the split, 2026-09-30, woc_head_pack_split.mjs, replaced the whole-library
   *  pack and its 3.5 MB budget). One budget per head type: Type B ships separate left and
   *  right brow and ear paints and six eyelid paints where Type A shares them, so its core is
   *  two thirds larger (head_type_a_core: 894,480; head_type_b_core: 1,477,780, held at the
   *  1.5 MB a core always had). */
  headCoreA: 940_000,
  headCoreB: 1_500_000,
  /** One hairstyle (wocHeadPieceUrl), streamed only when a look wears it.
   *  head_type_a_hair_waves: 155,760. */
  hair: 164_000,
  /** A head type's shared facial-hair file, seven beards cut from one texture.
   *  head_type_a_beards: 281,000. */
  beards: 296_000,
  /** A beard that ships in a file of its own. head_type_a_beard_handlebar: 61,656. */
  beard: 65_000,
  /** One armor set's low file (its colour atlas 1024 x 512 since the 2026-10-05 rebuild,
   *  PR 4360 review N3). female_druid_low: 214,100. */
  armorLow: 225_000,
  /** Its medium file. male_warrior_medium: 787,392. */
  armorMedium: 827_000,
  /** Its top file (2026-10-03): the top mip level of each of the medium file's maps.
   *  male_warrior_top: 1,600,368. */
  armorTop: 1_681_000,
  /** One class under-armor atlas (512 x 512 since the 2026-10-05 rebuild, PR 4360 review
   *  N3). female_paladin_underarmor: 44,299. */
  underArmor: 46_500,
} as const;

/** The high tier, which has no file of its own: a set's medium and top files together, what
 *  the local player downloads for its own set (the whole high file's budget, unchanged: it
 *  already sits within 5% of the largest pair, the male warrior's 2,387,760). */
const WOC_HIGH_PAIR_BUDGET = 2.5 * MB;

/** Every shipped WOC file (relative to the split directory), at its size when it last shrank,
 *  rounded up to the next KiB. */
const CEILINGS: Readonly<Record<string, number>> = {
  // Re-pinned 2026-10-03 (level of detail), every changed file at the next KiB of its new size.
  // Every base, low and medium armor file and head file now carries a mid and a far index list
  // per primitive (the WOC_lod extension, scripts/assets/woc_character/lod_indices.mjs): about
  // 16 KB a base, 11 KB a low or medium armor file, 37 KB (Type A) and 44 KB (Type B) a head
  // core, 2 to 14 KB a hairstyle and 30 to 34 KB a beards file; the top files carry none. The
  // same full build took in the day's other work: the male warrior set rebuilt at a third of its
  // triangles (low and medium files down 112 KB and 58 KB, top file up 8 KB: rebaked maps), the
  // same-day armor atlas change (the female rogue files moved) and the animation libraries' one
  // shared timeline (both libraries down about a third).
  // Medium re-pinned and top rows new 2026-10-03 (the owner's file-size pass: a texture's top
  // mip level is three quarters of its bytes and only a close-up samples it). The medium and
  // high tiers are ONE layout and ONE encode now, cut along each map's top level
  // (build_woc_split.mjs, ktx2_levels.mjs): every medium file carries the full layout's maps at
  // half size (all 18 shrank, 18.18 MB to 11.80 MB, the male warrior 1248848 to 845888 bytes)
  // and each top file only those maps' top levels, which the runtime lays over the medium file
  // for the local player (woc_armor_packs.ts). The 18 high files no longer ship (32.78 MB); a
  // medium and top pair is the old high file's bytes plus a 2 KB GLB shell. Low files unchanged.
  // Paladin re-pinned 2026-10-02, both fits (owner's armor cleanup and his brightness call).
  // Male: the shoulders, gauntlets and boots are on new clean UVs, each with its own colour bake
  // where a left and right piece used to share the right side's map, so the set's atlas holds
  // ten pieces' maps instead of seven. Both fits: every "Clean UV" colour map (those six, the
  // female boots, gauntlets, shoulders and waist, both helms) is back at the paint's true
  // brightness (the DIFFUSE bake had darkened them to 0.58x and 0.48x in linear light), and the
  // female boots, gauntlets and shoulders carry an occlusion baked from outside instead of from
  // inside the shell. Brighter, less crushed maps compress a little larger: male low +15.3 KB,
  // medium +31.6 KB, high +2.0 KB; female low +3.0 KB, medium +26.1 KB, high +54.0 KB, all far
  // inside their budgets. Each takes the next KiB.
  // Re-pinned 2026-10-01 (owner fixes: the female Paladin/Warrior boots' heel fin removed,
  // the male hoods' head part dropped 0.008 with the Type A head seat): the pieces' areas moved,
  // so each set's atlas re-laid out and the KTX2 sizes shifted both ways with no new content;
  // female_paladin_high +16.8 KB and male_warlock_medium +32 KB are the largest, all far inside
  // their budgets. Every changed file takes the next KiB of its new size.
  // Priest, Mage and Warlock re-pinned 2026-09-30 (the owner's caster cloth: new tunic, gloves
  // and boots with baked maps and packed UVs): every file shrank (high tier 13-26%) except
  // male_mage_low, which grew 9.4 KB (4%, far inside the 400 KB low budget) and takes the next KiB.
  // Lowered 2026-09-29 (owner's animation feedback round): a two-hander rides the one-hand
  // idle, gaits and jump out of combat now, so the library dropped its nine two-hand copies of
  // those (62 -> 55 clips) while gaining the side runs and a longer backpedal. Lowered again
  // 2026-09-30: no two-hand stance, so the four unused *_2H combat clips left too (55 -> 51).
  'anims_female.glb': 683008,
  'anims_male.glb': 666624,
  'armor/female_druid_low.glb': 215040,
  'armor/female_druid_medium.glb': 686080,
  'armor/female_druid_top.glb': 1230848, // 2026-10-03: new, the medium maps' top levels
  'armor/female_hunter_low.glb': 207872,
  'armor/female_hunter_medium.glb': 620544,
  'armor/female_hunter_top.glb': 1043456, // 2026-10-03: new, the medium maps' top levels
  'armor/female_mage_low.glb': 206848,
  'armor/female_mage_medium.glb': 605184,
  'armor/female_mage_top.glb': 949248, // 2026-10-03: new, the medium maps' top levels
  'armor/female_paladin_low.glb': 200704,
  'armor/female_paladin_medium.glb': 663552,
  'armor/female_paladin_top.glb': 1186816, // 2026-10-03: new, the medium maps' top levels
  'armor/female_priest_low.glb': 214016,
  'armor/female_priest_medium.glb': 662528,
  'armor/female_priest_top.glb': 1078272, // 2026-10-03: new, the medium maps' top levels
  'armor/female_rogue_low.glb': 203776,
  'armor/female_rogue_medium.glb': 619520,
  'armor/female_rogue_top.glb': 987136, // 2026-10-03: new, the medium maps' top levels
  'armor/female_shaman_low.glb': 210944,
  'armor/female_shaman_medium.glb': 731136,
  'armor/female_shaman_top.glb': 1334272, // 2026-10-03: new, the medium maps' top levels
  'armor/female_warlock_low.glb': 200704,
  'armor/female_warlock_medium.glb': 570368,
  'armor/female_warlock_top.glb': 865280, // 2026-10-03: new, the medium maps' top levels
  'armor/female_warrior_low.glb': 207872,
  'armor/female_warrior_medium.glb': 732160,
  'armor/female_warrior_top.glb': 1545216, // 2026-10-03: new, the medium maps' top levels
  'armor/male_druid_low.glb': 192512,
  'armor/male_druid_medium.glb': 680960,
  'armor/male_druid_top.glb': 1283072, // 2026-10-03: new, the medium maps' top levels
  'armor/male_hunter_low.glb': 195584,
  'armor/male_hunter_medium.glb': 710656,
  'armor/male_hunter_top.glb': 1321984, // 2026-10-03: new, the medium maps' top levels
  'armor/male_mage_low.glb': 209920,
  'armor/male_mage_medium.glb': 625664,
  'armor/male_mage_top.glb': 992256, // 2026-10-03: new, the medium maps' top levels
  'armor/male_paladin_low.glb': 195584,
  'armor/male_paladin_medium.glb': 737280,
  'armor/male_paladin_top.glb': 1385472, // 2026-10-03: new, the medium maps' top levels
  'armor/male_priest_low.glb': 210944,
  'armor/male_priest_medium.glb': 637952,
  'armor/male_priest_top.glb': 1029120, // 2026-10-03: new, the medium maps' top levels
  'armor/male_rogue_low.glb': 177152,
  'armor/male_rogue_medium.glb': 610304,
  'armor/male_rogue_top.glb': 1045504, // 2026-10-03: new, the medium maps' top levels
  'armor/male_shaman_low.glb': 184320,
  'armor/male_shaman_medium.glb': 702464,
  'armor/male_shaman_top.glb': 1325056, // 2026-10-03: new, the medium maps' top levels
  'armor/male_warlock_low.glb': 197632,
  'armor/male_warlock_medium.glb': 548864,
  'armor/male_warlock_top.glb': 823296, // 2026-10-03: new, the medium maps' top levels
  'armor/male_warrior_low.glb': 189440,
  'armor/male_warrior_medium.glb': 787456,
  'armor/male_warrior_top.glb': 1600512, // 2026-10-03: new, the medium maps' top levels
  // Bases lowered 2026-10-01 (owner: the old heads never ship): the split build measures the
  // handoff's original face, then strips it (build_woc_split.mjs stripOriginalFace), so a base
  // is the rig, the body and its map. The female base dropped from 1381016 to 344976 bytes and
  // the male from 1323632 to 327276; nothing else in the delivery moved.
  'base_female.glb': 361472,
  'base_male.glb': 343040,
  // The modular head library (Type A on the male rig, Type B on the female): built by
  // scripts/assets/woc_character/woc_head_pack.py, compressed, then split 2026-09-30 by
  // woc_head_pack_split.mjs into the catalog's streamed files. They replace the 3.0 and 3.4 MB
  // whole-library packs (head_type_a.glb, head_type_b.glb), which no longer ship.
  // Type A core lowered 2026-10-01 (the owner's male head fixes: bald crown raised, the
  // side-part undercut cut clear of the ears, the shoulder-length rear gap closed): the core
  // shrank 1.3 KB; the shoulder and undercut files stay inside their KiB. Same day, the hair
  // snug pass (topknot, quiff and shoulder length pulled in onto the scalp) shrank those three
  // files again, and the Type A seat dropped 0.008 (every file re-encoded inside its KiB).
  // Later that day the lower neck was scaled out to meet the collar and its old dark shadow paint
  // evened out (core shrank 18.7 KB), and the quiff and undercut were pulled in to the head
  // (+0.7 KB and +1.1 KB, each takes the next KiB).
  // Same day, three hairstyles crossed over each way (owner: "use a few of the female hairs
  // as options for male and vice versa"): Type A gained ponytail, braid and waves, Type B
  // undercut, topknot and shoulder, each a new streamed file at the next KiB of its size.
  // Both cores re-pinned 2026-10-02: each core's colour textures are packed into ONE atlas at
  // build time (scripts/assets/woc_character/head_atlas.mjs), so a face can draw as one mesh
  // instead of a dozen materials (the crowd draw-call work, woc_head_merge.ts). Texels are
  // copied, never resampled: Type A's nine sources lose the corners no UV reaches and the core
  // shrinks 103 KB; Type B's fifteen gain their gutters and the eyelid shells' wrapped rows
  // (their UVs run past the edge), and the core grows 17 KB (1.2%, inside the 1.5 MB budget).
  // Every hair and beard file is byte for byte what it was.
  // Both cores lowered later that day: the atlas brings its own mip levels, built per cell
  // (head_atlas.mjs headAtlasMipLevels: levels made from the whole image averaged a cell with
  // its neighbour, or with the black beside it, from level 4), and its uvs keep 16 bits where
  // the pack-wide 12 were half a texel on it. The levels are plain box averages, which encode
  // smaller than the encoder's own sharper ones: Type A drops 13.3 KB and Type B 23.4 KB, so
  // Type B is now 6 KB UNDER its size before the atlas; the finer uvs cost 64 and 56 bytes.
  // The atlas's level 0 and every hair and beard file are byte for byte what they were.
  // Every hair and beard file lowered 2026-10-03 (grey hair): each texture only hair materials
  // sample now ships as its linear luminance in grey, encoded ETC1S at quality 255 instead of
  // UASTC (woc_head_pack_compress.mjs, hair_grey.mjs; the head tint reads nothing of a hair texel
  // but that luminance, src/render/characters/woc_head_tint.ts). Their textures are 64 to 69%
  // smaller (scalp caps 53 to 63%), so the hair and beard files of each type halved: Type A
  // 2969584 to 1503420 bytes, Type B 2909304 to 1524836. Geometry and level of detail are byte
  // for byte what they were, and so are both cores. Each changed file takes the next KiB.
  'head_type_a_beard_handlebar.glb': 62464,
  'head_type_a_beards.glb': 281600,
  'head_type_a_core.glb': 894976,
  'head_type_a_hair_braid.glb': 116736,
  'head_type_a_hair_long.glb': 101376,
  'head_type_a_hair_mohawk.glb': 99328,
  'head_type_a_hair_ponytail.glb': 113664,
  'head_type_a_hair_quiff.glb': 116736,
  'head_type_a_hair_shoulder.glb': 112640,
  'head_type_a_hair_swept.glb': 96256,
  'head_type_a_hair_topknot.glb': 110592,
  'head_type_a_hair_undercut.glb': 141312,
  'head_type_a_hair_waves.glb': 156672,
  'head_type_b_beard_handlebar.glb': 55296,
  'head_type_b_beards.glb': 270336,
  'head_type_b_core.glb': 1478656,
  'head_type_b_hair_bob.glb': 122880,
  'head_type_b_hair_braid.glb': 116736,
  'head_type_b_hair_crown.glb': 109568,
  'head_type_b_hair_curls.glb': 118784,
  'head_type_b_hair_ponytail.glb': 116736,
  'head_type_b_hair_shoulder.glb': 107520,
  'head_type_b_hair_topknot.glb': 106496,
  'head_type_b_hair_twins.glb': 115712,
  'head_type_b_hair_undercut.glb': 136192,
  'head_type_b_hair_waves.glb': 153600,
};

/** Every shipped under-armor atlas (relative to WOC_SKIN_DIR), at its size when it was pinned
 *  (2026-10-05, the PR 4360 review), rounded up to the next KiB. The same rules as CEILINGS. */
const UNDER_ARMOR_CEILINGS: Readonly<Record<string, number>> = {
  'druid_underarmor.ktx2': 33792,
  'female_druid_underarmor.ktx2': 34816,
  'female_hunter_underarmor.ktx2': 33792,
  'female_mage_underarmor.ktx2': 28672,
  'female_paladin_underarmor.ktx2': 45056,
  'female_priest_underarmor.ktx2': 39936,
  'female_rogue_underarmor.ktx2': 30720,
  'female_shaman_underarmor.ktx2': 36864,
  'female_warlock_underarmor.ktx2': 27648,
  'hunter_underarmor.ktx2': 31744,
  'mage_underarmor.ktx2': 19456,
  'paladin_underarmor.ktx2': 44032,
  'priest_underarmor.ktx2': 37888,
  'rogue_underarmor.ktx2': 28672,
  'shaman_underarmor.ktx2': 34816,
  'warlock_underarmor.ktx2': 22528,
};

const repoRoot = path.resolve(__dirname, '..');
const splitDir = path.join(repoRoot, 'public', WOC_SPLIT_DIR);
const skinDir = path.join(repoRoot, 'public', WOC_SKIN_DIR);

function shippedFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else out.push(path.relative(splitDir, p).split(path.sep).join('/'));
    }
  };
  walk(splitDir);
  return out.sort();
}

type BudgetRow = keyof typeof WOC_SIZE_BUDGETS;

/** The budget row a shipped file answers to, by its url under public/ (the naming rules are
 *  tests/helpers/woc_shipped_files.ts wocFileKind, which throws for anything that is not a
 *  WOC character file). A head core's row is its head type's. */
function budgetRowOf(url: string): BudgetRow {
  const file = wocFileKind(url);
  if (file.kind === 'headCore') return file.type === 'b' ? 'headCoreB' : 'headCoreA';
  return file.kind;
}

/** The budget of a split file, named relative to the split directory like a CEILINGS row. */
function budgetOf(file: string): number {
  return WOC_SIZE_BUDGETS[budgetRowOf(`${WOC_SPLIT_DIR}/${file}`)];
}

describe('WOC character size ratchet', () => {
  it('ships only split files, every one of them with a ceiling row', () => {
    expect(existsSync(splitDir)).toBe(true);
    const files = shippedFiles();
    expect(files.filter((f) => !(f in CEILINGS))).toEqual([]);
    expect(Object.keys(CEILINGS).filter((f) => !files.includes(f))).toEqual([]);
    // the one-file-per-class GLBs the split replaced are gone for good
    const players = readdirSync(path.join(repoRoot, 'public', 'models', 'chars', 'players'));
    expect(players.filter((f) => /^woc_.*\.glb$/.test(f))).toEqual([]);
  });

  for (const [file, ceiling] of Object.entries(CEILINGS)) {
    it(`${file} stays at or under its ceiling and its budget`, () => {
      const abs = path.join(splitDir, file);
      if (!existsSync(abs)) return; // reported by the row check above
      const size = statSync(abs).size;
      const budget = budgetOf(file);
      expect(
        size,
        `${file} is ${size} bytes, over its ${ceiling}-byte ceiling (budget ${budget}). A ` +
          'rebuild must never grow a character file: find what grew (a texture, a clip, the ' +
          'mesh) before touching the table. See the header of this test.',
      ).toBeLessThanOrEqual(ceiling);
      expect(ceiling, `${file}: a ceiling above its budget`).toBeLessThanOrEqual(budget);
    });
  }

  it('keeps every ceiling tight: no row sits more than 16 KiB above its file', () => {
    const slack = Object.entries(CEILINGS).filter(([file, ceiling]) => {
      const abs = path.join(splitDir, file);
      return existsSync(abs) && ceiling - statSync(abs).size > 16 * 1024;
    });
    expect(
      slack.map(([file]) => file),
      'lower these ceilings to the files they pin',
    ).toEqual([]);
  });

  it('downloads at most one base and one library before a WOC body is built, and never armor', () => {
    // the boot gate carries nothing of the split files: a fresh login streams the base and
    // library of the body type it builds, and each armor set the first time one is worn
    expect(characterPreloadUrls(false).filter((u) => u.startsWith(`${WOC_SPLIT_DIR}/`))).toEqual(
      [],
    );
    // one body type, at the tier a login lands on, sits well inside the gameplan's login
    // budget (about 3 MB): about 1.3 MB since the original face left the base (2026-10-01)
    for (const fit of ['male', 'female'] as const) {
      const login = [`base_${fit}.glb`, `anims_${fit}.glb`].map(
        (f) => statSync(path.join(splitDir, f)).size,
      );
      expect(
        login.reduce((a, b) => a + b, 0),
        fit,
      ).toBeLessThanOrEqual(1.5 * MB);
    }
    // plus the head a new character of each type wears: its body's base and library, the
    // type's core file and the default look's hair and beard files (the rest of the head
    // library streams only when a look picks it). 3.25 MB: Type B lands at about 3.0 MB
    // (its core ships separate left and right brow and ear paints and six eyelid paints,
    // where Type A shares them); the split halved both heads from the 3 MB whole packs, and
    // the bases lost the megabyte of original face they used to carry.
    for (const type of ['a', 'b'] as const) {
      const { fit, defaults } = WOC_HEAD_TYPES[type];
      const files = [
        `${WOC_SPLIT_DIR}/base_${fit}.glb`,
        `${WOC_SPLIT_DIR}/anims_${fit}.glb`,
        ...wocHeadLookUrls(type, defaults),
      ];
      const bytes = files.map((f) => statSync(path.join(repoRoot, 'public', f)).size);
      expect(
        bytes.reduce((a, b) => a + b, 0),
        `Type ${type} login: ${files.map((f, i) => `${path.basename(f)} ${bytes[i]}`).join(' + ')}`,
      ).toBeLessThanOrEqual(3.25 * MB);
    }
    for (const kind of ['low', 'medium', 'top']) {
      expect(Object.keys(CEILINGS).filter((f) => f.endsWith(`_${kind}.glb`))).toHaveLength(18);
    }
    // the retired whole high files are gone for good
    expect(Object.keys(CEILINGS).filter((f) => f.endsWith('_high.glb'))).toEqual([]);
  });

  it('keeps the high tier, a medium and a top file together, inside the high budget', () => {
    for (const file of Object.keys(CEILINGS).filter((f) => f.endsWith('_medium.glb'))) {
      const pair = [file, file.replace(/_medium\.glb$/, '_top.glb')];
      const bytes = pair.map((f) => statSync(path.join(splitDir, f)).size);
      expect(bytes[0] + bytes[1], `${pair.join(' + ')}: ${bytes.join(' + ')}`).toBeLessThanOrEqual(
        WOC_HIGH_PAIR_BUDGET,
      );
    }
  });

  it('keeps every budget tight: none more than a tenth above the largest file of its kind', () => {
    // the largest shipped file of each row, read off the real files (the delivery pin's and
    // the head catalog's: tests/helpers/woc_shipped_files.ts)
    const largest = new Map<BudgetRow, number>();
    for (const { url } of wocShippedFiles()) {
      const row = budgetRowOf(url);
      const size = statSync(path.join(repoRoot, 'public', url)).size;
      largest.set(row, Math.max(largest.get(row) ?? 0, size));
    }
    // every row has a file, and every file a row
    expect([...largest.keys()].sort()).toEqual(Object.keys(WOC_SIZE_BUDGETS).sort());
    let pair = 0;
    for (const file of Object.keys(CEILINGS).filter((f) => f.endsWith('_medium.glb'))) {
      const top = file.replace(/_medium\.glb$/, '_top.glb');
      pair = Math.max(
        pair,
        statSync(path.join(splitDir, file)).size + statSync(path.join(splitDir, top)).size,
      );
    }
    const rows: [string, number, number][] = [
      ...[...largest].map(([row, size]): [string, number, number] => [
        row,
        WOC_SIZE_BUDGETS[row],
        size,
      ]),
      ['a high pair (medium + top)', WOC_HIGH_PAIR_BUDGET, pair],
    ];
    const over = rows.filter(([, budget, size]) => size > budget);
    expect(
      over.map(([row, budget, size]) => `${row}: largest file ${size}, budget ${budget}`),
      'a kind over its budget: find what grew before raising a budget (a maintainer decision)',
    ).toEqual([]);
    const slack = rows.filter(([, budget, size]) => budget > size * (1 + BUDGET_SLACK));
    expect(
      slack.map(([row, budget, size]) => `${row}: budget ${budget}, largest file ${size}`),
      'lower these budgets to their kind (its largest file plus about 5%, a thousand up)',
    ).toEqual([]);
  });
});

describe('WOC under-armor atlas size ratchet', () => {
  it('ships exactly the atlases the delivery pins, every one of them with a ceiling row', () => {
    const pinned = wocShippedFiles()
      .filter((file) => file.kind === 'underArmor')
      .map((file) => path.posix.basename(file.url));
    expect(pinned).toHaveLength(16);
    expect(Object.keys(UNDER_ARMOR_CEILINGS).sort()).toEqual(pinned);
    // and nothing else ships beside them: a PNG master here is dead weight in every deploy
    // (tests/skin_atlas_ktx2_compression.test.ts), a KTX2 no manifest names is a stray
    const onDisk = wocFilesOnDisk()
      .filter((url) => url.startsWith(`${WOC_SKIN_DIR}/`))
      .map((url) => url.slice(WOC_SKIN_DIR.length + 1));
    expect(onDisk).toEqual(pinned);
  });

  for (const [file, ceiling] of Object.entries(UNDER_ARMOR_CEILINGS)) {
    it(`${file} stays at or under its ceiling and its budget`, () => {
      const abs = path.join(skinDir, file);
      if (!existsSync(abs)) return; // reported by the row check above
      const size = statSync(abs).size;
      expect(
        size,
        `${file} is ${size} bytes, over its ${ceiling}-byte ceiling (budget ` +
          `${WOC_SIZE_BUDGETS.underArmor}). A rebuild must never grow an atlas: find what grew ` +
          '(its size in texels is tests/woc_texture_budget.test.ts) before touching the table.',
      ).toBeLessThanOrEqual(ceiling);
      expect(ceiling, `${file}: a ceiling above its budget`).toBeLessThanOrEqual(
        WOC_SIZE_BUDGETS.underArmor,
      );
    });
  }

  it('keeps every ceiling tight: no row sits more than 16 KiB above its atlas', () => {
    const slack = Object.entries(UNDER_ARMOR_CEILINGS).filter(([file, ceiling]) => {
      const abs = path.join(skinDir, file);
      return existsSync(abs) && ceiling - statSync(abs).size > 16 * 1024;
    });
    expect(
      slack.map(([file]) => file),
      'lower these ceilings to the atlases they pin',
    ).toEqual([]);
  });
});
