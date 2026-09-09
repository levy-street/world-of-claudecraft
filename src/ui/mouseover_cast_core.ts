// Clique-style mouseover casting: which unit a friendly ability pressed while the
// cursor sits over a party/raid frame actually lands on.
//
// The staleness guard used to be "the hovered member's ENTITY is in the client's
// interest scope", which silently broke the one case a raid needs most. A member who
// RELEASES stands as a ghost at the graveyard, far outside the ~120 yd snapshot
// scope, so the caster's client drops their entity: every mouseover combat
// resurrection (Temporal Reversal, Recall the Fallen) then fell through to the
// current target, which in a raid is the boss, and answered "You must target a dead
// ally in your group". The authoritative sim accepts the override for exactly this
// case (a released ghost is still `dead`, and resurrection reach is measured to the
// BODY, not to the spirit: src/sim/combat/resurrection_reach.ts), so the ROSTER is
// the right guard instead: a pid on the local party/raid roster is a real, live
// member whether or not this client can currently see them. Interest scope is a
// rendering budget, never a targeting rule.
//
// Pure core: no DOM, no world type, both hosts drive it through the two callbacks
// (the offline Sim knows every entity; ClientWorld knows the ones in scope).

/** The only two ability fields the redirect decision reads. */
export interface MouseoverCastAbility {
  requiresTarget?: boolean;
  targetType?: string;
}

export interface MouseoverCastInputs {
  /** The Interface option (mouseoverCast, on by default). */
  enabled: boolean;
  /** Whether this client currently holds the entity (in interest scope). */
  hasEntity: (pid: number) => boolean;
  /** The local player's party/raid roster (pids, self included; null when solo).
   *  A callback, and read ONLY when the entity is out of scope: the offline Sim
   *  rebuilds its whole party model (aura + aggro sweeps) on every partyInfo read,
   *  and this runs on every ability press. */
  partyMemberPids: () => readonly number[] | null;
}

/**
 * The pid a mouseover cast should be redirected to, or null to leave the press on
 * the classic current-target-else-self path.
 *
 * Only friendly targeted abilities redirect (a hostile cast never rides a party
 * frame), and only to a hovered unit this client can still vouch for: one it holds
 * an entity for, or one the party wire still lists as a member.
 */
export function mouseoverCastTargetPid(
  hoveredPid: number | null,
  ability: MouseoverCastAbility | null | undefined,
  inputs: MouseoverCastInputs,
): number | null {
  if (hoveredPid === null || !inputs.enabled) return null;
  if (!ability?.requiresTarget || ability.targetType !== 'friendly') return null;
  if (inputs.hasEntity(hoveredPid)) return hoveredPid;
  return inputs.partyMemberPids()?.includes(hoveredPid) ? hoveredPid : null;
}
