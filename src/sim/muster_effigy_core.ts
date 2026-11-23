// The Straw Foreman's shared facts: the ids, names and numbers both the sim system
// (muster_effigy.ts) and the presentation (the aura tooltip, the reticle, the effigy rig)
// read. A pure leaf (no SimContext), so src/ui and src/render may import it.

import { MUSTER_BOSS_TEMPLATE_ID } from './content/mirefen_muster';
import { ZONE2_MOBS } from './content/zone2';

/** The drillmaster's mallet cue (src/sim/muster_drill.ts): the windup and the landing. */
export const MUSTER_MALLET_POUND_ABILITY = 'muster_mallet_pound';

/** Aura id of the effigy's standing plank hide (a permanent buff_dr on the effigy). */
export const EFFIGY_WARD_AURA_ID = 'muster_effigy_ward';
/** Aura id of a player's own open window on the effigy (an inert timer on the player). */
export const EFFIGY_OPENED_AURA_ID = 'muster_effigy_opened';
/** The plank hide's display name (localized by the client's sim-aura resolver). */
export const EFFIGY_WARD_NAME = 'Plank Hide';
/** The open window's display name (localized by the client's sim-aura resolver). */
export const EFFIGY_OPENED_NAME = 'Lantern Out';

// Read off the content table rather than the merged MOBS, so this module-level mirror
// never depends on data.ts having finished evaluating (the damage path imports it).
const BALGATH_WARD = ZONE2_MOBS[MUSTER_BOSS_TEMPLATE_ID]?.eyeWard;
/** The plank hide turns away what Barrowhide does. Mirrors Balgath's eyeWard.reduction. */
export const EFFIGY_WARD_REDUCTION = BALGATH_WARD?.reduction ?? 0.6;
/** A player's window lasts Balgath's own blind. Mirrors his eyeWard.blindSeconds. */
export const EFFIGY_WINDOW_SECONDS = BALGATH_WARD?.blindSeconds ?? 14;

/** Does this aura list carry this viewer's open window on the effigy? */
export function hasEffigyWindow(auras: readonly { id?: string }[] | undefined): boolean {
  return !!auras && auras.some((a) => a.id === EFFIGY_OPENED_AURA_ID);
}
