// Lifetime played-time math over the accumulator pair every host persists
// (PlayerMeta.totalPlayedSeconds, the baseline folded at save, plus joinedAt,
// the sim-clock stamp of this session's world entry). One formula shared by
// the /playtime chat readout, the save fold in serializeCharacter, the Sim
// facade's playtimeSeconds getter, and the server's self-wire emit, so no
// reader can drift from what the save persists. Pure leaf: no SimContext, no
// rng, no wall clock (time is the caller's sim clock), unit-tested directly
// in tests/playtime.test.ts.

/** The two PlayerMeta fields the lifetime total is derived from. */
export interface PlaytimeMeta {
  /** sim.time when this character entered the world (session-only). */
  joinedAt: number;
  /** Seconds played across every session BEFORE this one (persisted). */
  totalPlayedSeconds: number;
}

/**
 * The running lifetime total in UNFLOORED seconds: the persisted baseline plus
 * this session's elapsed sim time. Unfloored so repeated save folds never lose
 * sub-second remainders (only displays floor); the max(0, ...) guard keeps a
 * caller with a not-yet-advanced clock from ever shrinking the baseline.
 */
export function livePlaytimeSeconds(meta: PlaytimeMeta, time: number): number {
  return meta.totalPlayedSeconds + Math.max(0, time - meta.joinedAt);
}
