// Which armor detail a body on a character preview draws (the pure rule, 2026-10-05;
// CharacterPreview in preview.ts is its thin consumer). Three-free, so a Vitest reads the table
// the preview applies.
//
// A body built directly draws FULL detail by default (woc_armor_core.ts wocArmorTierFor: on the
// high preset and above that is a set's medium file with its top file laid over it, and the top
// file is the largest of the three). That is right for the one character a player looks at up
// close for long, their own. It was wrong for the two stages that put MANY sets up, each for a
// moment: flipping through every class and both bodies in the creator fetched and held a top
// file for each, and inspecting a player fetched the top file of every set they wore. A stage
// therefore says what it shows, and only what a player has made their own draws the top levels:
//
//   stage      what it shows                              armor detail
//   own        the viewer's own character (the sheet,     full (the default: a preview that
//              the roster's pick, a redesign draft)       says nothing draws as it always did)
//   inspect    someone else's character                   crowd, never a top file
//   creator    a class nobody has made yet                crowd until that class and body is
//                                                         chosen, then full for that one
//
// CHOSEN is an act of the player on the appearance editor for the body on the stage (opening a
// face category, the camera's close-up, or changing any option of the look: the mount in
// src/ui/appearance_editor_mount.ts sends it). Picking a class or the body type is browsing: it
// puts another body on the stage and chooses nothing. One class and body is chosen at a time; the
// choice is remembered while others are flipped to, so coming back to it draws full detail again.
// Choosing another forgets it, and so does leaving the creator (CharacterPreview.leaveCreator):
// a choice lasts one visit.
//
// Only the armor TEXTURES step down. The geometry levels ride the same files (woc_lod_core.ts),
// so a preview, which is a close-up, keeps the level a body built directly draws
// (previewArmorBuildOptions): the crowd's coarser level would save no download here.
//
// The rule reads the detail alone; which file a detail draws is still wocArmorTierFor over the
// STATIC graphics profile. On the low preset and on phones every detail draws the low file, so
// nothing changes there (tests/preview_armor_detail_core.test.ts pins it), and sharpness is
// cosmetic only (docs/design/graphics-settings-fairness.md).
import type { GeometryLodLevel } from '../assets/geometry_lod_core';
import type { WocArmorDetail, WocTierProfile } from './woc_armor_core';
import { wocLodLevelFor } from './woc_lod_core';

/** What a preview stage shows, as far as its armor detail goes (the table above). */
export type PreviewArmorSurface = 'own' | 'inspect' | 'creator';

/**
 * The armor detail the body on a stage draws now. `staged` is the body on the stage (its
 * visual key: one class and one body fit; null with nothing on it) and `chosen` the body the
 * creator's player chose last (null: none yet). Full is the fall-through on purpose: a stage
 * that never says what it shows draws as every body built directly always has.
 */
export function previewArmorDetail(
  surface: PreviewArmorSurface,
  staged: string | null,
  chosen: string | null,
): WocArmorDetail {
  if (surface === 'inspect') return 'crowd';
  if (surface === 'creator') return staged !== null && staged === chosen ? 'full' : 'crowd';
  return 'full';
}

/**
 * The chosen body after the player acted on the appearance of the body on the stage. Only the
 * creator chooses (an editor's pick on a real character, the roster's redesign, is no choice:
 * that stage draws full detail already), and only a body that is there.
 */
export function previewChosenBody(
  surface: PreviewArmorSurface,
  staged: string | null,
  chosen: string | null,
): string | null {
  return surface === 'creator' && staged !== null ? staged : chosen;
}

/**
 * The build options of a preview body that draws `detail` (AssembleOptions, assets.ts): its
 * armor detail, and the geometry level a body built directly draws under this profile whatever
 * that detail is (the header says why).
 */
export function previewArmorBuildOptions(
  profile: WocTierProfile,
  detail: WocArmorDetail,
): { readonly wocArmorDetail: WocArmorDetail; readonly wocLod: GeometryLodLevel } {
  return { wocArmorDetail: detail, wocLod: wocLodLevelFor(profile, 'full') };
}
