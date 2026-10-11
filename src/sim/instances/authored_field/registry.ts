// Which interior keys are open fields with their own ground height, and
// where that height comes from. The ONE lookup world.ts groundHeight and the
// interior collider seam consult, so a new authored field is a single row
// here plus its content record.
//
// The Wildheart Basin left its bespoke height function for a field record of
// its own (content/wildheart_basin_layout.ts), so every open-air dungeon now
// rides this one engine.

import { DROWNED_TEMPLE_FIELD } from '../../content/drowned_temple_layout';
import { GRAVEWYRM_SANCTUM_FIELD } from '../../content/gravewyrm_sanctum_layout';
import { HOLLOW_CRYPT_FIELD } from '../../content/hollow_crypt_layout';
import { SUNKEN_BASTION_FIELD } from '../../content/sunken_bastion_layout';
import { WILDHEART_BASIN_FIELD } from '../../content/wildheart_basin_layout';
import { authoredFieldHeight } from './height';
import type { AuthoredFieldDef } from './types';

const AUTHORED_FIELDS: Readonly<Record<string, AuthoredFieldDef>> = {
  hollow_crypt: HOLLOW_CRYPT_FIELD,
  sunken_bastion: SUNKEN_BASTION_FIELD,
  drowned_temple: DROWNED_TEMPLE_FIELD,
  wildheart: WILDHEART_BASIN_FIELD,
  gravewyrm_sanctum: GRAVEWYRM_SANCTUM_FIELD,
};

const hollowCryptHeight = (x: number, z: number): number =>
  authoredFieldHeight(HOLLOW_CRYPT_FIELD, x, z);

const sunkenBastionHeight = (x: number, z: number): number =>
  authoredFieldHeight(SUNKEN_BASTION_FIELD, x, z);

const drownedTempleHeight = (x: number, z: number): number =>
  authoredFieldHeight(DROWNED_TEMPLE_FIELD, x, z);

const wildheartBasinHeight = (x: number, z: number): number =>
  authoredFieldHeight(WILDHEART_BASIN_FIELD, x, z);

const gravewyrmSanctumHeight = (x: number, z: number): number =>
  authoredFieldHeight(GRAVEWYRM_SANCTUM_FIELD, x, z);

const FIELD_HEIGHTS: Readonly<Record<string, (lx: number, lz: number) => number>> = {
  wildheart: wildheartBasinHeight,
  hollow_crypt: hollowCryptHeight,
  sunken_bastion: sunkenBastionHeight,
  drowned_temple: drownedTempleHeight,
  gravewyrm_sanctum: gravewyrmSanctumHeight,
};

/** The authored field record for an interior key, or null. */
export function authoredFieldFor(interior: string): AuthoredFieldDef | null {
  return AUTHORED_FIELDS[interior] ?? null;
}

/** Instance-local ground height function of an open-field interior, or null
 *  for a flat or room-plan interior. */
export function instancedFieldHeight(
  interior: string,
): ((lx: number, lz: number) => number) | null {
  return FIELD_HEIGHTS[interior] ?? null;
}
