// Pure, host-agnostic core for Clique-style mouseover casting: given the unit
// the cursor is currently over, decide whether a pressed ability should be
// redirected onto it instead of the current target.
//
// DOM-free and sim-free (the caller passes the two ability fields and an
// existence probe), so the whole rule is unit-testable without a HUD. Extracted
// from Hud.castSlot when the target-of-target frame joined the party/raid rows
// as a hover source: the decision is now shared by more than one frame, so it
// stops being an inline branch in the coordinator.
// Registered in tests/architecture.test.ts UI_PURE_CORES.

/** The two ability fields the redirect rule reads. */
export interface MouseoverCastAbility {
  requiresTarget: boolean;
  targetType?: 'enemy' | 'friendly' | 'any';
}

export interface MouseoverCastInput {
  /** Whether the mouseoverCast Interface option is on (default on). */
  enabled: boolean;
  /** The ability the player just pressed. */
  ability: MouseoverCastAbility;
  /** Whether the client still knows that entity: a hovered unit can go stale
   *  between the mouseenter and the press (it left interest scope, it was
   *  removed), and casting at a vanished id would be a wasted press. */
  exists(id: number): boolean;
}

/**
 * The entity a press should be redirected onto, or null to cast normally.
 *
 * Deliberately narrow, matching what shipped for the party frames: only a
 * FRIENDLY ability that needs a target redirects, so hovering a unit frame
 * never steals an offensive press or an AOE from the current target. 'any'
 * abilities are not redirected either, since their friendly reading is the
 * ambiguous one and the current target is the safer answer.
 */
export function mouseoverCastTarget(
  hoveredId: number | null,
  input: MouseoverCastInput,
): number | null {
  if (hoveredId === null || !input.enabled) return null;
  const { requiresTarget, targetType } = input.ability;
  if (!requiresTarget || targetType !== 'friendly') return null;
  return input.exists(hoveredId) ? hoveredId : null;
}
