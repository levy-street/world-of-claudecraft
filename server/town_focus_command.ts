// The set_town_focus wire body, extracted whole from server/game.ts's
// dispatch switch (server/CLAUDE.md, "New WS/loop-side behavior": pure
// decision logic behind a host-agnostic module, never grown inline in the
// switch). The case label stays in game.ts: the command-schema suite scans
// that switch for the dispatch universe.

import { RESPEC_TIER_CONFIG, type RespecPaymentTier } from '../src/sim/professions/focus';

/** Routes the set_town_focus frame: an object/array-shaped `allocation` is
 *  filtered down to its numeric entries only (a non-number value for a key
 *  is silently dropped, not a whole-frame refusal, matching the pre-extraction
 *  behavior), and a malformed or absent `allocation` is a no-op. The payment
 *  tier picks which RESPEC_TIER_CONFIG row prices the re-spec. Untrusted
 *  input, so it is checked against the real config keys rather than cast; a
 *  missing/malformed tier (an older client, or a hand-crafted frame) falls
 *  back to 'time', the free tier, so it never charges a client that never
 *  chose a tier. `pid` always comes from the caller's authenticated session. */
export function applyTownFocusCommand(
  sim: {
    setTownFocus(allocation: Record<string, number>, tier: RespecPaymentTier, pid?: number): void;
  },
  msg: Readonly<Record<string, unknown>>,
  pid: number,
): void {
  if (!msg.allocation || typeof msg.allocation !== 'object') return;
  const allocation: Record<string, number> = {};
  for (const [k, v] of Object.entries(msg.allocation as Record<string, unknown>)) {
    if (typeof v === 'number') allocation[k] = v;
  }
  const tier: RespecPaymentTier =
    typeof msg.tier === 'string' && Object.hasOwn(RESPEC_TIER_CONFIG, msg.tier)
      ? (msg.tier as RespecPaymentTier)
      : 'time';
  sim.setTownFocus(allocation, tier, pid);
}
