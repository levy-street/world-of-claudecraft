// Pure decision for the "Verbose combat text" option (a client-only display toggle).
//
// When verbose combat text is on, the HUD floats a relevant-status FCT floater when an aura
// FADES off a unit the local player cares about, so a player sees their DoTs/HoTs/buffs falling
// off without having to watch the aura frames. This module owns the one non-trivial decision:
// WHICH fades are relevant. It is host-agnostic and DOM/i18n-free (no `t()`, no entity reads):
// the HUD resolves the target entity + localized name and passes only ids/flags here, so this
// stays a pure function a Vitest drives directly.
//
// Relevance is a client-side relationship test (the `aura` SimEvent carries no source, so the
// HUD cannot know who applied it; these three cover the cases the feature is for):
//  - the aura is on the LOCAL PLAYER (your own buffs / debuffs / HoTs-on-you fading), or
//  - the aura is on your CURRENT TARGET (a DoT / debuff you are watching fall off an enemy), or
//  - the aura is on a PARTY / RAID MEMBER (a HoT / buff fading off an ally you are supporting).
// A GAINED aura never floats here (the request is "falling off"); gains still ride the combat
// log as before.

/** The ids + flags the HUD supplies for one `aura` fade event. Ids only, no entities: the
 *  relevance test never reads an entity, so the pure core needs neither the world nor the DOM. */
export interface VerboseAuraFadeInput {
  /** The player's live "Verbose combat text" setting. */
  readonly verbose: boolean;
  /** The `aura` event's `gained` flag. A gained aura never floats (only fades do). */
  readonly gained: boolean;
  /** The `aura` event's `targetId`: the unit the aura is on. */
  readonly targetId: number;
  /** The local player's entity id. */
  readonly playerId: number;
  /** The local player's current target id, or null when nothing is targeted. */
  readonly currentTargetId: number | null;
  /** The pids of the local player's party / raid members (excludes the player is fine). */
  readonly partyMemberIds: readonly number[];
}

/**
 * Whether a faded aura should float a verbose status floater over `targetId`. Pure: same input
 * always yields the same answer. Off / gained / an unrelated unit all return false, so the HUD
 * only pays the projection + spawn for a fade the player cares about.
 */
export function shouldFloatAuraFade(input: VerboseAuraFadeInput): boolean {
  if (!input.verbose || input.gained) return false;
  const { targetId, playerId, currentTargetId, partyMemberIds } = input;
  if (targetId === playerId) return true;
  if (currentTargetId !== null && targetId === currentTargetId) return true;
  return partyMemberIds.includes(targetId);
}
