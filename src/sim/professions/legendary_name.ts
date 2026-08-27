// The sim-side SHAPE validator for a player-chosen legendary name
// (Masterwrought phase 13, R3: the orange promotion stamps the normalized
// name onto the promoted copy as ItemInstancePayload.name). A pure leaf
// (no SimContext, no rng, no clock), host-agnostic like tools.ts's
// isLegalCrafterName: the same rule answers the offline Sim, the server, and
// any client preview. SHAPE ONLY, deliberately: the online server separately
// screens CONTENT (offensiveName, the pet_rename split) before the command
// reaches the sim, so a slur that fits this alphabet is the server's refusal,
// never this module's.
//
// The persisted-load twin is item_instance_load.ts's `name` arm, which is
// deliberately LOOSER (printable ASCII within its own byte ceiling, the
// signer doctrine) so shipped names outlive a later widening of this shape.

/** Maximum length of a normalized legendary name, in characters. The shape
 *  below derives its repeat bound from this, so the two cannot drift. */
export const MAX_LEGENDARY_NAME_LENGTH = 32;

// Start with a letter, then letters, spaces, apostrophes, and hyphens only:
// 2..MAX_LEGENDARY_NAME_LENGTH characters total.
const LEGENDARY_NAME_SHAPE = new RegExp(
  `^[A-Za-z][A-Za-z' -]{1,${MAX_LEGENDARY_NAME_LENGTH - 1}}$`,
);

/**
 * Normalize a raw player-supplied legendary name and validate its shape:
 * trim, collapse every inner whitespace run to one space, then hold the
 * result to LEGENDARY_NAME_SHAPE. Returns the normalized string, or null for
 * anything that is not a legal name (non-strings included; total on
 * `unknown` so a malformed wire value can never throw here).
 */
export function normalizeLegendaryName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().replace(/\s+/g, ' ');
  return LEGENDARY_NAME_SHAPE.test(normalized) ? normalized : null;
}
