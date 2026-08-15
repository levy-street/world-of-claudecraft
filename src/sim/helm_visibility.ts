// Helmet-visibility preference (the paperdoll eye toggle): a purely cosmetic
// per-entity flag the renderer reads to leave the composed kit's head piece off.
// Server-authoritative like `weaponStowed`: it rides the entity wire as a
// compact flag so every client renders (and portraits) a player the way that
// player chose to present. Unlike the sheathe it is a standing wardrobe
// preference, not an action: nothing in combat clears it and the dead can set
// it (a ghost's wardrobe should come back the way they left it). Pure leaf
// module (threat.ts pattern): no rng, no SimContext, importable directly by
// system modules and tests.

import type { Entity } from './types';

/** Apply the preference. A setter rather than a toggle so it is idempotent:
 *  the paperdoll sends the state it is showing, and a click that races a
 *  snapshot cannot flip the flag back by being applied twice. */
export function setHelmHidden(e: Entity, hidden: boolean): void {
  e.helmHidden = hidden;
}
