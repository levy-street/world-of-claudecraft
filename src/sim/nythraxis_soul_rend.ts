// Soul Rend release: the Nythraxis stack mechanic gives way to Bone Storm.
//
// Soul Rend asks the marked raiders to collapse onto one point so the
// detonation splits between them. Bone Storm asks the whole raid to spread and
// run from the whirl and the charges. The two cannot be answered at once: a
// storm that begins while marks are live either runs into a stacked raid
// (every raider in the huddle eats the whirl and the slam together) or forces
// the marks to resolve unstacked (a guaranteed kill on heroic). So the instant
// a storm begins, every live mark is released: the aura leaves its bearer and
// the mark deals nothing. The Soul Rend cadence itself is untouched; the next
// marks come on their normal timer once the storm ends. The other edge is a
// storm due just AFTER a detonation, when the raid is still huddled: the
// encounter arms a settle (NYTHRAXIS_SOUL_REND_SETTLE_SECONDS, read only by
// the storm cast) so the storm never opens on a freshly stacked raid.
//
// `src/sim`-pure: no rng, no wall clock, no DOM. The driver in
// encounters/nythraxis.ts calls releaseNythraxisSoulRendMarks from
// startNythraxisBoneStorm.

import type { Entity, NythraxisSoulRendMark } from './types';

export const NYTHRAXIS_SOUL_REND_AURA_ID = 'nythraxis_soul_rend';
/**
 * Seconds after a Soul Rend detonation before Bone Storm may begin: the same
 * gap the body-owning majors keep between each other, so the huddle has the
 * time it already gets after any other major to spread out.
 */
export const NYTHRAXIS_SOUL_REND_SETTLE_SECONDS = 6;

/**
 * Strip every live Soul Rend mark without resolving it: the aura comes off
 * each bearer. The caller empties the encounter's mark list (the list is the
 * encounter's, the auras are the bearers').
 */
export function releaseNythraxisSoulRendMarks(
  entities: ReadonlyMap<number, Entity>,
  marks: readonly NythraxisSoulRendMark[],
): void {
  for (const mark of marks) {
    const bearer = entities.get(mark.playerId);
    if (!bearer) continue;
    bearer.auras = bearer.auras.filter((a) => a.id !== NYTHRAXIS_SOUL_REND_AURA_ID);
  }
}
