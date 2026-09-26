// Pure, host-agnostic core for Clique-style mouseover casting: given the unit
// the cursor is currently over, decide whether a pressed ability should be
// redirected onto it instead of the current target.
//
// The target-of-target frame joined the party/raid rows and focus frames as a
// hover source, so the redirect rule lives here rather than in the HUD
// coordinator. The staleness guard is intentionally two-tiered: an in-scope
// entity is always safe, and a party/raid roster member is safe even when the
// online client has dropped their entity from interest scope, which keeps combat
// resurrections working on released ghosts at the graveyard.
//
// A dual-purpose heal (targetType 'any' with a heal effect: the paladin's Solar
// Invocation, Scouring Mercy) redirects too. Leaving it off sent a raid-frame
// mouseover heal to the current target, which with nothing selected answered "You
// have no target."; the sim honors the override for it (src/sim/combat/
// dual_purpose_target.ts, whose isDualPurposeHeal both sides read).
//
// Pure core: no DOM, no world type, both hosts drive it through the two callbacks
// (the offline Sim knows every entity; ClientWorld knows the ones in scope).

import { isDualPurposeHeal } from '../sim/combat/dual_purpose_target';

/** The only ability fields the redirect decision reads. */
export interface MouseoverCastAbility {
  requiresTarget?: boolean;
  targetType?: string;
  effects?: readonly { readonly type: string }[];
}

export interface MouseoverCastInput {
  /** Whether the mouseoverCast Interface option is on (default on). */
  enabled: boolean;
  /** The ability the player just pressed. */
  ability: MouseoverCastAbility | null | undefined;
  /** Whether the client still knows that entity. */
  exists(id: number): boolean;
  /** Local party/raid roster fallback for out-of-interest party members. */
  partyMemberPids?: () => readonly number[] | null;
}

export interface MouseoverCastInputs {
  /** The Interface option (mouseoverCast, on by default). */
  enabled: boolean;
  /** Whether this client currently holds the entity. */
  hasEntity: (pid: number) => boolean;
  /** The local player's party/raid roster. */
  partyMemberPids: () => readonly number[] | null;
}

/**
 * The entity a press should be redirected onto, or null to leave the press on
 * the classic current-target-else-self path.
 *
 * Only friendly targeted abilities and dual-purpose heals redirect (a hostile cast
 * never rides a party frame), and only to a hovered unit this client can still
 * vouch for: one it holds an entity for, or one the party wire still lists as a
 * member.
 */
export function mouseoverCastTarget(
  hoveredId: number | null,
  input: MouseoverCastInput,
): number | null {
  if (hoveredId === null || !input.enabled) return null;
  if (!input.ability?.requiresTarget) return null;
  if (input.ability.targetType !== 'friendly' && !isDualPurposeHeal(input.ability)) return null;
  if (input.exists(hoveredId)) return hoveredId;
  return input.partyMemberPids?.()?.includes(hoveredId) ? hoveredId : null;
}

/** Compatibility wrapper for the focus-target controller's existing seam. */
export function mouseoverCastTargetPid(
  hoveredPid: number | null,
  ability: MouseoverCastAbility | null | undefined,
  inputs: MouseoverCastInputs,
): number | null {
  return mouseoverCastTarget(hoveredPid, {
    enabled: inputs.enabled,
    ability,
    exists: inputs.hasEntity,
    partyMemberPids: inputs.partyMemberPids,
  });
}
