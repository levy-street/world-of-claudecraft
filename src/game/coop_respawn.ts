// Pure couch co-op respawn scheduler. A dead co-op player cannot run a ghost
// back to a corpse: the shared camera stays with the living players, so the
// classic corpse run would strand them off-screen. Instead each co-op slot
// gets this timer: a short countdown at the body, then an automatic spirit
// release and a Spirit Healer resurrection (the sim's normal rules, sickness
// included), then one 'regroup' signal the host may use to bring the player
// back to the party (offline hosts teleport via Sim.movePlayerNear; online
// hosts cannot teleport and instead show the walk-back chip).
//
// No DOM, no timers of its own — the host feeds `step()` the entity's
// dead/ghost flags and the frame delta, and acts on the returned action.

/** How long a dead co-op player lies at the body before the auto-release. */
export const COOP_RESPAWN_COUNTDOWN_MS = 8000;
/** Resurrect retry cadence while a ghost (the first attempt can land mid-walk). */
export const COOP_RESURRECT_RETRY_MS = 1000;

export type CoopRespawnAction = 'release' | 'resurrect' | 'regroup';

type Phase = 'alive' | 'counting' | 'ghost' | 'reviving';

export class CoopRespawnTimer {
  private phase: Phase = 'alive';
  private waitedMs = 0;

  /** Countdown still to run, for the HUD chip; 0 outside the counting phase. */
  remainingMs(): number {
    return this.phase === 'counting' ? Math.max(0, COOP_RESPAWN_COUNTDOWN_MS - this.waitedMs) : 0;
  }

  /**
   * Advance one frame. Returns at most one action:
   * - 'release'   fire releaseSpirit(pid) (once, after the countdown)
   * - 'resurrect' fire resurrectAtSpiritHealer(pid) (retried each second)
   * - 'regroup'   the player is alive again; offline hosts may teleport them
   *               back to the party now
   */
  step(state: { dead: boolean; ghost: boolean }, dtMs: number): CoopRespawnAction | null {
    const dt = Math.max(0, dtMs);
    if (!state.dead) {
      const revived = this.phase === 'ghost' || this.phase === 'reviving';
      this.phase = 'alive';
      this.waitedMs = 0;
      return revived ? 'regroup' : null;
    }
    if (!state.ghost) {
      // Dead at the body: run the countdown, then ask for the release. An
      // external release (another local player pressed nothing; the sim can
      // also release on its own rules) simply skips ahead via the ghost arm.
      if (this.phase !== 'counting') {
        this.phase = 'counting';
        this.waitedMs = 0;
      }
      this.waitedMs += dt;
      if (this.waitedMs >= COOP_RESPAWN_COUNTDOWN_MS) {
        this.phase = 'ghost';
        this.waitedMs = 0;
        return 'release';
      }
      return null;
    }
    // A ghost: ask for the Spirit Healer resurrect, pacing the retries (the
    // request is a no-op while out of the healer's range, e.g. mid-glide).
    if (this.phase !== 'ghost' && this.phase !== 'reviving') {
      this.phase = 'ghost';
      this.waitedMs = 0;
    }
    if (this.phase === 'ghost') {
      this.phase = 'reviving';
      this.waitedMs = 0;
      return 'resurrect';
    }
    this.waitedMs += dt;
    if (this.waitedMs >= COOP_RESURRECT_RETRY_MS) {
      this.waitedMs = 0;
      return 'resurrect';
    }
    return null;
  }
}
