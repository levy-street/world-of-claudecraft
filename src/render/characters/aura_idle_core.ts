// A standing body whose idle is replaced while an aura rides it.
//
// Balgath's Blinded window is fourteen seconds long and he keeps fighting through it, so it
// cannot be a one-shot (it would end long before the window) and it must not be a base
// state of its own (he still walks, swings and casts while blinded, and every one of those
// must keep outranking it). What it IS: the pose he holds BETWEEN those things, hunched and
// groping with a hand over the socket, instead of his usual stance. So the ClipMap names an
// idle loop per aura id (`ClipMap.idleByAura`), the base machine keeps its states, and only
// the clip the idle states resolve to changes while the aura is on him.
//
// Data, not a Balgath branch: a second creature earns a held aura pose by adding a row.
// Node-only (RENDER_PURE_CORES): no three.js, no DOM.

/** The aura facts this reads: a structural subset of a sim `Aura`. */
export interface AuraIdFact {
  id: string;
}

/**
 * The idle loop an aura on this body asks for, or null for the rig's ordinary idle.
 *
 * The FIRST row in the map's insertion order that the body carries wins, so when two auras
 * with poses ride at once the ClipMap author picks the precedence by writing them in order.
 * Allocation-free: this runs once per rig per frame.
 */
export function auraIdleClip(
  map: Readonly<Record<string, string>> | undefined,
  auras: readonly AuraIdFact[] | undefined,
): string | null {
  if (!map || !auras || auras.length === 0) return null;
  for (const id in map) {
    for (let i = 0; i < auras.length; i++) if (auras[i].id === id) return map[id];
  }
  return null;
}
